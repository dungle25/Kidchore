/**
 * Tests the quick bonus and quick penalty paths used by the parent dashboard card.
 *
 * A one-tap award and a one-tap penalty must be just as safe as the fuller form on the
 * Gia đình screen: both go through the same `adjust_points` function, so each tap must be
 * recorded in the audit log, be refused for a child session, never cross a family
 * boundary, and never be able to push a balance below zero.
 *
 * Usage: node scripts/test-quick-award.mjs
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import pg from "pg";
import { makeIdentityGuard } from "./lib/test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = env.SUPABASE_JWT_SECRET;

function mint(sub, role, name) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: "supabase",
    sub,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 3600,
    app_role: role,
    app_name: name,
  })}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

async function rpc(token, fn, args = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const guard = await makeIdentityGuard(db);

const AUTH_PARENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AUTH_CHILD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TEST_FAMILY = "__QUICK_AWARD__";
let familyId = null;

try {
  console.log("Testing quick bonus points...\n");

  await db.query("delete from public.families where family_name = $1", [TEST_FAMILY]);
  for (const id of [AUTH_PARENT, AUTH_CHILD]) {
    await db.query("delete from auth.identities where user_id = $1", [id]);
    await db.query("delete from auth.users where id = $1", [id]);
    await db.query(
      `insert into auth.users (
         id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change_token_new, email_change
       ) values (
         $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2::varchar,
         extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 10)), now(),
         jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
         '{}'::jsonb, now(), now(), '', '', '', ''
       )`,
      [id, `${id.slice(0, 6)}@example.com`]
    );
  }

  const fam = await db.query(
    "insert into public.families (family_name) values ($1) returning id",
    [TEST_FAMILY]
  );
  familyId = fam.rows[0].id;

  await db.query(
    `insert into public.users (family_id, role, display_name, auth_user_id)
     values ($1, 'PARENT', 'QA Phụ Huynh', $2)`,
    [familyId, AUTH_PARENT]
  );
  const child = await db.query(
    `insert into public.users (family_id, role, display_name, username, auth_user_id, pin_code)
     values ($1, 'CHILD', 'QA Bé', 'quickawardkid', $2, public.hash_pin('1212')) returning id`,
    [familyId, AUTH_CHILD]
  );
  const childId = child.rows[0].id;

  const parentToken = mint(AUTH_PARENT, "PARENT", "QA Phụ Huynh");
  const childToken = mint(AUTH_CHILD, "CHILD", "QA Bé");

  // ---- 1. Each offered amount works ----
  console.log("1. The three offered amounts");
  for (const amount of [1, 3, 5]) {
    const res = await rpc(parentToken, "adjust_points", {
      p_child_id: childId,
      p_amount: amount,
      p_description: `Thưởng nhanh +${amount} điểm`,
    });
    check(
      `+${amount} is awarded`,
      res.status === 200,
      `status=${res.status} :: ${JSON.stringify(res.data)?.slice(0, 120)}`
    );
  }

  const balance = await db.query(
    "select points_balance from public.users where id = $1",
    [childId]
  );
  check(
    "the balance is 1 + 3 + 5 = 9",
    balance.rows[0].points_balance === 9,
    `balance=${balance.rows[0].points_balance}`
  );

  // ---- 2. Every award is in the audit log ----
  console.log("\n2. Each award is recorded, not a silent balance change");
  const tx = await db.query(
    `select amount, type, description
     from public.point_transactions
     where user_id = $1
     order by created_at`,
    [childId]
  );
  check("three transactions were written", tx.rows.length === 3, `count=${tx.rows.length}`);
  check(
    "they are all MANUAL_ADJUSTMENT",
    tx.rows.every((r) => r.type === "MANUAL_ADJUSTMENT"),
    JSON.stringify(tx.rows.map((r) => r.type))
  );
  check(
    "each carries a readable reason",
    tx.rows.every((r) => (r.description ?? "").includes("Thưởng nhanh")),
    JSON.stringify(tx.rows.map((r) => r.description))
  );
  check(
    "the amounts match what was awarded",
    JSON.stringify(tx.rows.map((r) => r.amount).sort((a, b) => a - b)) ===
      JSON.stringify([1, 3, 5]),
    JSON.stringify(tx.rows.map((r) => r.amount))
  );

  // ---- 3. The child sees the points ----
  console.log("\n3. The child's own view reflects the bonus");
  const kidDash = await rpc(childToken, "kid_dashboard");
  check(
    "the child's balance is 9",
    kidDash.data?.child?.points_balance === 9,
    `balance=${kidDash.data?.child?.points_balance}`
  );

  // ---- 4. A child cannot award points ----
  console.log("\n4. Authorization");
  const childAwards = await rpc(childToken, "adjust_points", {
    p_child_id: childId,
    p_amount: 100,
    p_description: "tự thưởng",
  });
  check(
    "a child session cannot award points",
    childAwards.status !== 200,
    `status=${childAwards.status}`
  );

  const afterChildAttempt = await db.query(
    "select points_balance from public.users where id = $1",
    [childId]
  );
  check(
    "the balance is unchanged after that attempt",
    afterChildAttempt.rows[0].points_balance === 9,
    `balance=${afterChildAttempt.rows[0].points_balance}`
  );

  const anonAward = await rpc(anon, "adjust_points", {
    p_child_id: childId,
    p_amount: 100,
    p_description: "anon",
  });
  check(
    "anon cannot award points",
    anonAward.status === 401 || anonAward.status === 403,
    `status=${anonAward.status}`
  );

  // ---- 5. A parent cannot award to another family's child ----
  console.log("\n5. Family isolation");
  const otherFam = await db.query(
    "insert into public.families (family_name) values ('__QUICK_AWARD_OTHER__') returning id"
  );
  const outsider = await db.query(
    `insert into public.users (family_id, role, display_name, username)
     values ($1, 'CHILD', 'Bé Ngoài', 'outsidekid') returning id`,
    [otherFam.rows[0].id]
  );

  const crossAward = await rpc(parentToken, "adjust_points", {
    p_child_id: outsider.rows[0].id,
    p_amount: 50,
    p_description: "cross family",
  });
  check(
    "a parent cannot award points to another family's child",
    crossAward.status !== 200,
    `status=${crossAward.status} :: ${JSON.stringify(crossAward.data)?.slice(0, 120)}`
  );

  const outsiderBalance = await db.query(
    "select points_balance from public.users where id = $1",
    [outsider.rows[0].id]
  );
  check(
    "the other family's child is untouched",
    outsiderBalance.rows[0].points_balance === 0,
    `balance=${outsiderBalance.rows[0].points_balance}`
  );

  // ---- 6. Removing points stays possible, but is a deliberate act ----
  console.log("\n6. The same function still allows a deliberate deduction");
  const deduct = await rpc(parentToken, "adjust_points", {
    p_child_id: childId,
    p_amount: -4,
    p_description: "Trừ vì không giữ lời",
  });
  check("a deduction is accepted", deduct.status === 200, `status=${deduct.status}`);

  const afterDeduct = await db.query(
    "select points_balance from public.users where id = $1",
    [childId]
  );
  check(
    "the balance reflects the deduction (9 - 4 = 5)",
    afterDeduct.rows[0].points_balance === 5,
    `balance=${afterDeduct.rows[0].points_balance}`
  );

  const overdraft = await rpc(parentToken, "adjust_points", {
    p_child_id: childId,
    p_amount: -999,
    p_description: "trừ quá số dư",
  });
  check(
    "a deduction below zero is refused by the balance constraint",
    overdraft.status !== 200,
    `status=${overdraft.status} :: ${JSON.stringify(overdraft.data)?.slice(0, 140)}`
  );

  const finalBalance = await db.query(
    "select points_balance from public.users where id = $1",
    [childId]
  );
  check(
    "the failed overdraft left the balance alone",
    finalBalance.rows[0].points_balance === 5,
    `balance=${finalBalance.rows[0].points_balance}`
  );

  // ---- 7. Quick penalty: the mirror of the award ----
  console.log("\n7. A quick penalty deducts exactly what was tapped");
  const penalty = await rpc(parentToken, "adjust_points", {
    p_child_id: childId,
    p_amount: -3,
    p_description: "Phạt nhanh -3 điểm",
  });
  check(
    "a quick penalty of 3 is accepted",
    penalty.status === 200,
    `status=${penalty.status} :: ${JSON.stringify(penalty.data)?.slice(0, 120)}`
  );
  check(
    "the function answers with the new balance (5 - 3 = 2)",
    Number(penalty.data) === 2,
    `data=${JSON.stringify(penalty.data)}`
  );

  const afterPenalty = await db.query(
    "select points_balance from public.users where id = $1",
    [childId]
  );
  check(
    "the stored balance is 2",
    afterPenalty.rows[0].points_balance === 2,
    `balance=${afterPenalty.rows[0].points_balance}`
  );

  const penaltyTx = await db.query(
    `select amount, type, description
     from public.point_transactions
     where user_id = $1
     order by created_at desc
     limit 1`,
    [childId]
  );
  check("the penalty wrote a transaction", penaltyTx.rows.length === 1, `count=${penaltyTx.rows.length}`);
  check(
    "it is a MANUAL_ADJUSTMENT, like every other hand-made change",
    penaltyTx.rows[0]?.type === "MANUAL_ADJUSTMENT",
    JSON.stringify(penaltyTx.rows[0]?.type)
  );
  check(
    "its amount is negative",
    penaltyTx.rows[0]?.amount === -3,
    `amount=${penaltyTx.rows[0]?.amount}`
  );
  check(
    "its description reads as Vietnamese, not a bare number",
    (penaltyTx.rows[0]?.description ?? "").includes("Phạt nhanh"),
    JSON.stringify(penaltyTx.rows[0]?.description)
  );

  const kidAfterPenalty = await rpc(childToken, "kid_dashboard");
  check(
    "the child's own view shows the reduced balance",
    kidAfterPenalty.data?.child?.points_balance === 2,
    `balance=${kidAfterPenalty.data?.child?.points_balance}`
  );

  // ---- 8. Penalties are as restricted as awards ----
  console.log("\n8. Authorization and family isolation for penalties");
  // Attempted while the balance is 2, so a refusal can only come from the role check and
  // not from the balance constraint.
  const childPenalty = await rpc(childToken, "adjust_points", {
    p_child_id: childId,
    p_amount: -1,
    p_description: "tự trừ điểm",
  });
  check(
    "a child session cannot deduct its own points",
    childPenalty.status !== 200,
    `status=${childPenalty.status} :: ${JSON.stringify(childPenalty.data)?.slice(0, 120)}`
  );

  const afterChildPenalty = await db.query(
    "select points_balance from public.users where id = $1",
    [childId]
  );
  check(
    "the balance is untouched after the child's attempt",
    afterChildPenalty.rows[0].points_balance === 2,
    `balance=${afterChildPenalty.rows[0].points_balance}`
  );

  const crossPenalty = await rpc(parentToken, "adjust_points", {
    p_child_id: outsider.rows[0].id,
    p_amount: -1,
    p_description: "Phạt nhanh -1 điểm",
  });
  check(
    "a parent cannot penalise another family's child",
    crossPenalty.status !== 200,
    `status=${crossPenalty.status} :: ${JSON.stringify(crossPenalty.data)?.slice(0, 120)}`
  );

  const outsiderAfterPenalty = await db.query(
    "select points_balance from public.users where id = $1",
    [outsider.rows[0].id]
  );
  check(
    "the other family's child is untouched",
    outsiderAfterPenalty.rows[0].points_balance === 0,
    `balance=${outsiderAfterPenalty.rows[0].points_balance}`
  );

  // ---- 9. A penalty can never push the balance below zero ----
  console.log("\n9. A penalty can never push the balance below zero");
  const toOne = await rpc(parentToken, "adjust_points", {
    p_child_id: childId,
    p_amount: -1,
    p_description: "Phạt nhanh -1 điểm",
  });
  check("-1 from 2 is accepted", toOne.status === 200, `status=${toOne.status}`);

  // The card keeps "-1" enabled at every balance above zero, so this is the tap a parent
  // uses to walk a small balance down to exactly zero.
  const toZero = await rpc(parentToken, "adjust_points", {
    p_child_id: childId,
    p_amount: -1,
    p_description: "Phạt nhanh -1 điểm",
  });
  check(
    "-1 again reaches exactly zero",
    toZero.status === 200 && Number(toZero.data) === 0,
    `status=${toZero.status} :: ${JSON.stringify(toZero.data)}`
  );

  // The two taps above are the last ones allowed to succeed. Everything from here is
  // refused, so the audit log must not grow.
  const txBeforeRefusals = await db.query(
    "select count(*)::int as n from public.point_transactions where user_id = $1",
    [childId]
  );

  const belowZero = await rpc(parentToken, "adjust_points", {
    p_child_id: childId,
    p_amount: -1,
    p_description: "Phạt nhanh -1 điểm",
  });
  check(
    "one more point is refused at zero",
    belowZero.status !== 200,
    `status=${belowZero.status} :: ${JSON.stringify(belowZero.data)?.slice(0, 140)}`
  );

  const overdraftPenalty = await rpc(parentToken, "adjust_points", {
    p_child_id: childId,
    p_amount: -5,
    p_description: "Phạt nhanh -5 điểm",
  });
  check(
    "a penalty larger than the balance is refused, not clamped",
    overdraftPenalty.status !== 200,
    `status=${overdraftPenalty.status} :: ${JSON.stringify(overdraftPenalty.data)?.slice(0, 140)}`
  );
  check(
    "the refusal names the constraint the card maps to a Vietnamese message",
    JSON.stringify(overdraftPenalty.data ?? "").includes("users_points_balance_check"),
    JSON.stringify(overdraftPenalty.data)?.slice(0, 160)
  );

  const afterRefusals = await db.query(
    "select points_balance from public.users where id = $1",
    [childId]
  );
  check(
    "the balance stayed at zero",
    afterRefusals.rows[0].points_balance === 0,
    `balance=${afterRefusals.rows[0].points_balance}`
  );

  const txAfterRefusals = await db.query(
    "select count(*)::int as n from public.point_transactions where user_id = $1",
    [childId]
  );
  check(
    "a refused penalty writes no audit entry",
    txAfterRefusals.rows[0].n === txBeforeRefusals.rows[0].n,
    `before=${txBeforeRefusals.rows[0].n} after=${txAfterRefusals.rows[0].n}`
  );

  // ---- 10. The card sends what the checks above assume ----
  console.log("\n10. The card's penalty path matches this test");
  // The component cannot be executed here (React client component), so this reads the
  // literal it sends. Step 7 asserts the same string arrived in the database, so the two
  // cannot drift apart unnoticed.
  const cardSource = readFileSync("app/parent/dashboard/child-card.tsx", "utf8");
  check(
    "the card sends the mirrored penalty description",
    cardSource.includes("`Phạt nhanh -${amount} điểm`"),
    ""
  );
  check(
    "the card sends the mirrored negative amount",
    cardSource.includes("-amount,"),
    ""
  );
  check(
    "the card disables a penalty larger than the displayed balance",
    cardSource.includes("const affordable = balance >= amount;") &&
      cardSource.includes("disabled={pending || !affordable}"),
    ""
  );
  check(
    "the card offers a one-tap undo instead of rewriting the log",
    cardSource.includes("Hoàn tác") && cardSource.includes("`Hoàn tác phạt nhanh +${amount} điểm`"),
    ""
  );

  // Closes the loop with step 9: the constraint name that arrived in the refusal payload
  // is the key the UI looks up to turn it into Vietnamese. If the constraint is ever
  // renamed, this fails instead of the parent silently getting the generic error text.
  const domainSource = readFileSync("lib/domain.ts", "utf8");
  check(
    "the domain error table has an entry for the real constraint name",
    domainSource.includes("users_points_balance_check:"),
    ""
  );
} finally {
  if (familyId) {
    await db.query("delete from public.families where id = $1", [familyId]).catch(() => {});
  }
  await db
    .query("delete from public.families where family_name = '__QUICK_AWARD_OTHER__'")
    .catch(() => {});
  await db
    .query("delete from public.families where family_name = $1", [TEST_FAMILY])
    .catch(() => {});
  const removed = await guard.removeCreated();
  for (const id of [AUTH_PARENT, AUTH_CHILD]) {
    await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
    await db.query("delete from auth.users where id = $1", [id]).catch(() => {});
  }
  await db.end();
  console.log(`\nQuick-award fixtures removed (${removed} identity/identities).`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
