/**
 * Tests inviting a second parent into a family.
 *
 * Accepting an invite makes the caller a full PARENT: approve chores, award and deduct
 * points, edit and delete chores, manage rewards, read everything about the children.
 * So most of what is checked here is the ways it must **not** work - a used code, an
 * expired one, a revoked one, a code from another family, a caller who already belongs
 * somewhere, a child, an anonymous caller.
 *
 * The last section is the point of the whole feature: once the second parent is in, they
 * must see the same household and be able to act on it, including receiving the
 * notifications.
 *
 * Usage: node scripts/test-invites.mjs
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

/** `email` is included because the invite flow reads it from the Google token. */
function mint(sub, role, name, email) {
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
    ...(email ? { email } : {}),
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

async function rpcError(token, fn, args) {
  const { status, data } = await rpc(token, fn, args);
  if (status < 400) return null;
  return typeof data === "object" && data ? String(data.message ?? "") : String(data);
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

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const guard = await makeIdentityGuard(db);

const AUTH = {
  parentA: "22222222-2222-4222-8222-22222222b001",
  spouse: "22222222-2222-4222-8222-22222222b002",
  thirdParty: "22222222-2222-4222-8222-22222222b003",
  parentB: "22222222-2222-4222-8222-22222222b004",
  spare1: "22222222-2222-4222-8222-22222222b005",
  spare2: "22222222-2222-4222-8222-22222222b006",
};

const FAMILY = "__INVITE_TEST__";
const OTHER_FAMILY = "__INVITE_TEST_OTHER__";

const tokens = {
  parentA: mint(AUTH.parentA, "PARENT", "Bố A", "invite.parenta@example.com"),
  spouse: mint(AUTH.spouse, "PARENT", "Mẹ B", "invite.spouse@example.com"),
  thirdParty: mint(AUTH.thirdParty, "PARENT", "Người Lạ", "invite.third@example.com"),
  parentB: mint(AUTH.parentB, "PARENT", "Bố B", "invite.parentb@example.com"),
  spare1: mint(AUTH.spare1, "PARENT", "Ông", "invite.spare1@example.com"),
  spare2: mint(AUTH.spare2, "PARENT", "Bà", "invite.spare2@example.com"),
};

async function makeAuthUser(id, email) {
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
    [id, email]
  );
}

let familyId = null;
let otherFamilyId = null;

try {
  console.log("Testing family invites...\n");

  await db.query("delete from public.families where family_name in ($1, $2)", [
    FAMILY,
    OTHER_FAMILY,
  ]);
  for (const [key, id] of Object.entries(AUTH)) {
    await makeAuthUser(id, `invite.${key}@example.com`);
  }

  familyId = (
    await db.query("insert into public.families (family_name) values ($1) returning id", [FAMILY])
  ).rows[0].id;
  otherFamilyId = (
    await db.query("insert into public.families (family_name) values ($1) returning id", [
      OTHER_FAMILY,
    ])
  ).rows[0].id;

  await db.query(
    `insert into public.users (family_id, role, display_name, email, auth_user_id)
     values ($1, 'PARENT', 'Bố A', 'invite.parenta@example.com', $2)`,
    [familyId, AUTH.parentA]
  );
  await db.query(
    `insert into public.users (family_id, role, display_name, email, auth_user_id)
     values ($1, 'PARENT', 'Bố B', 'invite.parentb@example.com', $2)`,
    [otherFamilyId, AUTH.parentB]
  );

  const child = await rpc(tokens.parentA, "create_child", {
    p_display_name: "Bé Nhà A",
    p_username: "invitekid",
    p_pin: "1357",
    p_avatar_url: null,
  });
  const childId = child.data?.id;

  const task = (
    await db.query(
      `insert into public.tasks (family_id, title, points_reward, recurrence)
       values ($1, 'Invite: quét nhà', 5, 'DAILY') returning id`,
      [familyId]
    )
  ).rows[0].id;
  const instance = (
    await db.query(
      `insert into public.task_instances (task_id, assigned_child_id, due_date, status, completed_at)
       values ($1, $2, current_date, 'SUBMITTED', now()) returning id`,
      [task, childId]
    )
  ).rows[0].id;

  // ---- 1. Creating ----
  console.log("1. Creating an invite");

  const created = await rpc(tokens.parentA, "create_family_invite");
  const code = String(created.data ?? "");
  check("a parent can create an invite", created.status < 400 && code.length > 0, JSON.stringify(created.data));
  check(
    "the code is 12 characters from the unambiguous alphabet",
    /^[A-HJ-NP-Z2-9]{12}$/.test(code),
    code
  );
  check(
    "no letter that is easy to mistype is used",
    !/[IO01]/.test(code),
    code
  );

  const stored = await db.query(
    `select id, code_hash, family_id, expires_at, accepted_at
       from public.family_invites where family_id = $1`,
    [familyId]
  );
  check("the invite is stored", stored.rows.length === 1, JSON.stringify(stored.rows.length));
  check(
    "the code itself is never stored",
    !JSON.stringify(stored.rows).includes(code),
    "the plaintext code appears in the table"
  );
  check(
    "only the hash is stored",
    /^[0-9a-f]{64}$/.test(stored.rows[0]?.code_hash ?? ""),
    String(stored.rows[0]?.code_hash)
  );
  check(
    "it belongs to the creator's family",
    stored.rows[0]?.family_id === familyId,
    String(stored.rows[0]?.family_id)
  );

  const listed = await rpc(tokens.parentA, "list_family_invites");
  const listedRows = Array.isArray(listed.data) ? listed.data : [];
  check("a parent can list their invites", listedRows.length >= 1, JSON.stringify(listed.data));
  check(
    "listing never returns a code",
    !JSON.stringify(listedRows).includes(code),
    "the code leaked into the list"
  );

  const anonCreate = await rpc(anon, "create_family_invite");
  check("anon cannot create an invite", anonCreate.status >= 400, String(anonCreate.status));

  const childToken = mint(
    (await db.query("select auth_user_id from public.users where id = $1", [childId])).rows[0]
      ?.auth_user_id ?? AUTH.parentA,
    "CHILD",
    "Bé Nhà A"
  );
  const childCreate = await rpcError(childToken, "create_family_invite");
  check(
    "a child cannot create an invite",
    Boolean(childCreate?.includes("PARENT_ROLE_REQUIRED")),
    String(childCreate)
  );

  // ---- 2. Accepting ----
  console.log("\n2. Accepting an invite");

  const anonAccept = await rpc(anon, "accept_family_invite", {
    p_code: code,
    p_display_name: "Mẹ B",
  });
  check("anon cannot accept an invite", anonAccept.status >= 400, String(anonAccept.status));

  const wrongCode = await rpcError(tokens.spouse, "accept_family_invite", {
    p_code: "ZZZZZZZZZZZZ",
    p_display_name: "Mẹ B",
  });
  check(
    "a wrong code is refused without saying why",
    Boolean(wrongCode?.includes("INVITE_INVALID_OR_EXPIRED")),
    String(wrongCode)
  );

  // Dashes and lower case are what a person actually pastes out of a chat message.
  const prettyCode = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`.toLowerCase();
  const accepted = await rpc(tokens.spouse, "accept_family_invite", {
    p_code: prettyCode,
    p_display_name: "Mẹ B",
  });
  check("the spouse joins with the code", accepted.status < 400, JSON.stringify(accepted.data));

  const spouseRow = (
    await db.query("select id, family_id, role, email, display_name from public.users where auth_user_id = $1", [
      AUTH.spouse,
    ])
  ).rows[0];
  check("and becomes a parent of the same family", spouseRow?.family_id === familyId, JSON.stringify(spouseRow));
  check("with the PARENT role", spouseRow?.role === "PARENT", String(spouseRow?.role));
  check(
    "the Google email is recorded so a later sign-in finds them",
    spouseRow?.email === "invite.spouse@example.com",
    String(spouseRow?.email)
  );
  check(
    "the display name is theirs, not Google's",
    spouseRow?.display_name === "Mẹ B",
    String(spouseRow?.display_name)
  );

  const afterAccept = await db.query(
    "select accepted_at, accepted_by_user_id from public.family_invites where id = $1",
    [stored.rows[0].id]
  );
  check(
    "the invite is marked used and by whom",
    Boolean(afterAccept.rows[0]?.accepted_at) &&
      afterAccept.rows[0]?.accepted_by_user_id === spouseRow.id,
    JSON.stringify(afterAccept.rows[0])
  );

  // ---- 3. Ways it must not work ----
  console.log("\n3. Ways it must not work");

  const secondUse = await rpcError(tokens.thirdParty, "accept_family_invite", {
    p_code: code,
    p_display_name: "Người Lạ",
  });
  check(
    "a used code cannot be used again",
    Boolean(secondUse?.includes("INVITE_INVALID_OR_EXPIRED")),
    String(secondUse)
  );
  const thirdRow = await db.query("select id from public.users where auth_user_id = $1", [
    AUTH.thirdParty,
  ]);
  check("and no account was created for the second attempt", thirdRow.rows.length === 0, "");

  const spouseAgain = await rpc(tokens.spouse, "accept_family_invite", {
    p_code: code,
    p_display_name: "Mẹ B đổi tên",
  });
  check(
    "someone who already has a family is returned as-is, not moved",
    spouseAgain.data?.family_id === familyId,
    JSON.stringify(spouseAgain.data)
  );

  // Expired: inserted directly, because waiting seven days is not a test.
  const expiredCode = "EXPIRED12345";
  await db.query(
    `insert into public.family_invites (family_id, code_hash, created_by_user_id, expires_at)
     values ($1, encode(digest($2, 'sha256'), 'hex'), $3, now() - interval '1 day')`,
    [familyId, expiredCode, spouseRow.id]
  );
  const expired = await rpcError(tokens.thirdParty, "accept_family_invite", {
    p_code: expiredCode,
    p_display_name: "Người Lạ",
  });
  check(
    "an expired code is refused",
    Boolean(expired?.includes("INVITE_INVALID_OR_EXPIRED")),
    String(expired)
  );

  const fresh = await rpc(tokens.parentA, "create_family_invite");
  const freshCode = String(fresh.data);
  const revoked = await rpc(tokens.parentA, "revoke_family_invite", {
    p_invite_id: (
      await db.query(
        "select id from public.family_invites where code_hash = encode(digest($1, 'sha256'), 'hex')",
        [freshCode]
      )
    ).rows[0].id,
  });
  check("a parent can revoke an invite", revoked.status < 400, JSON.stringify(revoked.data));
  const revokedUse = await rpcError(tokens.thirdParty, "accept_family_invite", {
    p_code: freshCode,
    p_display_name: "Người Lạ",
  });
  check(
    "a revoked code is refused",
    Boolean(revokedUse?.includes("INVITE_INVALID_OR_EXPIRED")),
    String(revokedUse)
  );

  // ---- 4. Cross-family ----
  console.log("\n4. Another family");

  const otherInvite = await rpc(tokens.parentB, "create_family_invite");
  const otherCode = String(otherInvite.data);
  const otherInviteId = (
    await db.query(
      "select id from public.family_invites where family_id = $1 and accepted_at is null",
      [otherFamilyId]
    )
  ).rows[0].id;

  const crossRevoke = await rpcError(tokens.parentA, "revoke_family_invite", {
    p_invite_id: otherInviteId,
  });
  check(
    "a parent cannot revoke another family's invite",
    Boolean(crossRevoke?.includes("INVITE_NOT_REVOCABLE")),
    String(crossRevoke)
  );

  const otherList = await rpc(tokens.parentA, "list_family_invites");
  check(
    "a parent's invite list shows only their own family",
    (Array.isArray(otherList.data) ? otherList.data : []).every(
      (row) => row.id !== otherInviteId
    ),
    JSON.stringify(otherList.data)
  );

  const crossAccept = await rpcError(tokens.thirdParty, "accept_family_invite", {
    p_code: otherCode,
    p_display_name: "Người Lạ",
  });
  check(
    "a code from another family is still just a code - it works, and joins THAT family",
    crossAccept === null,
    String(crossAccept)
  );
  const thirdFamily = (
    await db.query("select family_id from public.users where auth_user_id = $1", [AUTH.thirdParty])
  ).rows[0]?.family_id;
  check(
    "and it joins the family that issued it, not the one that tried",
    thirdFamily === otherFamilyId,
    String(thirdFamily)
  );

  // ---- 5. The second parent has the same household and the same powers ----
  console.log("\n5. The second parent is a real parent");

  const overview = await rpc(tokens.spouse, "parent_overview");
  const seenChildren = (overview.data?.children ?? []).map((c) => c.display_name);
  check(
    "the spouse sees the same children",
    seenChildren.includes("Bé Nhà A"),
    JSON.stringify(seenChildren)
  );
  check(
    "and the same chores",
    (overview.data?.tasks ?? []).some((t) => t.title === "Invite: quét nhà"),
    JSON.stringify((overview.data?.tasks ?? []).map((t) => t.title))
  );

  const approved = await rpc(tokens.spouse, "approve_task_instance", { p_instance_id: instance });
  check(
    "the spouse can approve a chore the other parent never touched",
    approved.status < 400,
    JSON.stringify(approved.data)
  );
  const awarded = await rpc(tokens.spouse, "adjust_points", {
    p_child_id: childId,
    p_amount: 3,
    p_description: "Mẹ thưởng thêm",
  });
  check("and can award points", awarded.status < 400 && awarded.data === 8, JSON.stringify(awarded.data));

  // Both parents must be told when the child does something, or the second parent is a
  // parent nobody ever notifies.
  for (const [token, name] of [
    [tokens.parentA, "parent-a"],
    [tokens.spouse, "spouse"],
  ]) {
    await rpc(token, "register_push_subscription", {
      p_endpoint: `https://push.example.com/${FAMILY}/${name}`,
      p_p256dh: `${name}-key`,
      p_auth: `${name}-auth`,
    });
  }

  const secondInstance = (
    await db.query(
      `insert into public.task_instances (task_id, assigned_child_id, due_date, status, completed_at)
       values ($1, $2, current_date + 1, 'SUBMITTED', now()) returning id`,
      [task, childId]
    )
  ).rows[0].id;
  const recipients = await rpc(childToken, "push_recipients", {
    p_kind: "TASK_SUBMITTED",
    p_subject_id: secondInstance,
  });
  const endpoints = (Array.isArray(recipients.data) ? recipients.data : []).map((r) => r.endpoint);
  check(
    "both parents are notified when the child submits",
    endpoints.length === 2 &&
      endpoints.includes(`https://push.example.com/${FAMILY}/parent-a`) &&
      endpoints.includes(`https://push.example.com/${FAMILY}/spouse`),
    JSON.stringify(endpoints)
  );

  // ---- 6. Limits ----
  console.log("\n6. Limits");

  for (const token of [tokens.spare1, tokens.spare2]) {
    const invite = await rpc(tokens.parentA, "create_family_invite");
    await rpc(token, "accept_family_invite", {
      p_code: String(invite.data),
      p_display_name: "Ông bà",
    });
  }
  const parentsNow = (
    await db.query("select count(*)::int as n from public.users where family_id = $1 and role = 'PARENT'", [
      familyId,
    ])
  ).rows[0].n;
  check("the family now has the maximum number of parents", parentsNow === 4, String(parentsNow));

  const overCapInvite = await rpc(tokens.parentA, "create_family_invite");
  // A fifth prospective parent needs a fresh identity; reuse the third party's is wrong
  // because they already belong elsewhere, so this uses one more throwaway Google user.
  const extraAuth = "22222222-2222-4222-8222-22222222b00f";
  await makeAuthUser(extraAuth, "invite.extra@example.com");
  const overCap = await rpcError(
    mint(extraAuth, "PARENT", "Người Thứ Năm", "invite.extra@example.com"),
    "accept_family_invite",
    { p_code: String(overCapInvite.data), p_display_name: "Người Thứ Năm" }
  );
  check(
    "a fifth parent is refused",
    Boolean(overCap?.includes("FAMILY_FULL")),
    String(overCap)
  );

  // The rejection must not have burned the invitation, or the parent would have to guess
  // whether the failure was theirs or the code's.
  const stillUsable = await db.query(
    "select accepted_at from public.family_invites where code_hash = encode(digest($1, 'sha256'), 'hex')",
    [String(overCapInvite.data)]
  );
  check(
    "a refused acceptance leaves the invite unused",
    stillUsable.rows[0]?.accepted_at === null,
    JSON.stringify(stillUsable.rows[0])
  );

  const many = (
    await db.query(
      `select count(*)::int as n from public.family_invites
        where family_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()`,
      [familyId]
    )
  ).rows[0].n;
  check("active invites are counted", many >= 1, String(many));

  let lastError = null;
  for (let i = 0; i < 6; i += 1) {
    lastError = await rpcError(tokens.parentA, "create_family_invite");
  }
  check(
    "a family cannot pile up unlimited live codes",
    Boolean(lastError?.includes("TOO_MANY_ACTIVE_INVITES")),
    String(lastError)
  );
} finally {
  if (familyId) {
    await db.query("delete from public.families where id = $1", [familyId]).catch(() => {});
  }
  if (otherFamilyId) {
    await db.query("delete from public.families where id = $1", [otherFamilyId]).catch(() => {});
  }
  await db
    .query("delete from public.families where family_name in ($1, $2)", [FAMILY, OTHER_FAMILY])
    .catch(() => {});
  const removed = await guard.removeCreated();
  for (const id of [...Object.values(AUTH), "22222222-2222-4222-8222-22222222b00f"]) {
    await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
    await db.query("delete from auth.users where id = $1", [id]).catch(() => {});
  }
  await db.end();
  console.log(`\nInvite fixtures removed (${removed} identity/identities).`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
