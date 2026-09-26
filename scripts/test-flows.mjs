/**
 * End-to-end verification of the database layer.
 *
 * Proves the things the whole app depends on:
 *   1. A JWT we sign ourselves is accepted by PostgREST and resolves auth.uid().
 *   2. The RPC layer authorizes by identity, not by client-supplied ids.
 *   3. The core flows work: submit -> approve -> points, and reward redemption.
 *   4. Idempotency guards actually prevent double-awarding points.
 *   5. The publishable key can no longer touch the tables.
 *
 * Test data is created in its own family and removed at the end.
 *
 * Usage: node scripts/test-flows.mjs
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { makeIdentityGuard } from "./lib/test-cleanup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const { NEXT_PUBLIC_SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON } =
  env;
const JWT_SECRET = env.SUPABASE_JWT_SECRET;

/** Signs a session token exactly the way lib/supabase-server.ts does. */
function mintToken(userId, role, name) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const signingInput = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: "supabase",
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    iat: now,
    exp: now + 3600,
    app_role: role,
    app_name: name,
  })}`;
  const sig = createHmac("sha256", JWT_SECRET).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}

async function rpc(token, fn, args = {}) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON,
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
function codeOf(data) {
  return typeof data === "object" && data ? (data.code ?? data.message ?? "") : String(data);
}

const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

/** Snapshot taken before anything is created, so cleanup can spare existing identities. */
const guard = await makeIdentityGuard(db);

let familyId = null;
let authUserIds = [];
try {
  console.log("Setting up an isolated test family...\n");

  // Identity in this app is linked through users.auth_user_id, which points at
  // auth.users. Create real auth users through the admin API so the link is
  // genuine, then mint session tokens for those subjects exactly as the app does.
  // Any leftover account from an interrupted run is removed first, so repeated
  // runs are safe.
  const adminHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  async function deleteAuthUserByEmail(email) {
    const listRes = await fetch(
      `${URL_}/auth/v1/admin/users?per_page=200`,
      { headers: adminHeaders }
    );
    if (!listRes.ok) return;
    const list = await listRes.json();
    for (const u of list.users ?? []) {
      if (u.email?.toLowerCase() === email.toLowerCase()) {
        await fetch(`${URL_}/auth/v1/admin/users/${u.id}`, {
          method: "DELETE",
          headers: adminHeaders,
        });
      }
    }
  }

  async function createAuthUser(email) {
    await deleteAuthUserByEmail(email);
    const res = await fetch(`${URL_}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email, email_confirm: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`admin create user failed: ${JSON.stringify(data)}`);
    return data.id;
  }

  // Clear any residue from an interrupted earlier run, so the suite is repeatable.
  await db.query("delete from public.families where family_name = '__TEST_FAMILY__'");
  await db.query(
    "delete from public.users where email in ('test.parent@example.com','test.childa@example.com','test.childb@example.com')"
  );

  const parentAuthId = await createAuthUser("test.parent@example.com");
  const childAAuthId = await createAuthUser("test.childa@example.com");
  const childBAuthId = await createAuthUser("test.childb@example.com");
  authUserIds = [parentAuthId, childAAuthId, childBAuthId];

  const fam = await db.query(
    "insert into public.families (family_name) values ('__TEST_FAMILY__') returning id"
  );
  familyId = fam.rows[0].id;

  const parent = await db.query(
    `insert into public.users (family_id, role, display_name, email, auth_user_id)
     values ($1, 'PARENT', 'Test Parent', 'test.parent@example.com', $2) returning id`,
    [familyId, parentAuthId]
  );
  const parentId = parent.rows[0].id;

  // Child A and B let us prove cross-child access is denied.
  const childA = await db.query(
    `insert into public.users (family_id, role, display_name, username, auth_user_id)
     values ($1, 'CHILD', 'Child A', 'testchilda', $2) returning id`,
    [familyId, childAAuthId]
  );
  const childAId = childA.rows[0].id;

  // Child B exists solely to prove cross-child access is denied.
  await db.query(
    `insert into public.users (family_id, role, display_name, username, auth_user_id)
     values ($1, 'CHILD', 'Child B', 'testchildb', $2)`,
    [familyId, childBAuthId]
  );

  // Seed a task and today's instance for child A.
  const task = await db.query(
    `insert into public.tasks (family_id, title, description, points_reward, recurrence, assigned_to_user_id)
     values ($1, 'Test chore', 'Do the thing', 25, 'DAILY', $2) returning id`,
    [familyId, childAId]
  );
  const taskId = task.rows[0].id;
  const inst = await db.query(
    `insert into public.task_instances (task_id, assigned_child_id, due_date, status)
     values ($1, $2, current_date, 'PENDING') returning id`,
    [taskId, childAId]
  );
  const instanceId = inst.rows[0].id;

  const reward = await db.query(
    `insert into public.rewards (family_id, title, points_required, stock)
     values ($1, 'Test reward', 10, 2) returning id`,
    [familyId]
  );
  const rewardId = reward.rows[0].id;

  // ---- 1. auth.uid() resolves from our self-signed JWT ----
  // The JWT `sub` must be the AUTH user id, because public.users.auth_user_id is
  // what links an identity to an app user. Minting with users.id would resolve to
  // nothing, which is exactly how the app behaves for an unlinked account.
  console.log("1. Self-signed JWT is accepted and auth.uid() resolves");
  const parentToken = mintToken(parentAuthId, "PARENT", "Test Parent");
  const childAToken = mintToken(childAAuthId, "CHILD", "Child A");
  const childBToken = mintToken(childBAuthId, "CHILD", "Child B");

  const whoami = await rpc(parentToken, "current_app_user_id");
  check(
    "current_app_user_id returns the parent id",
    whoami.status === 200 && whoami.data === parentId,
    `status=${whoami.status} data=${JSON.stringify(whoami.data)}`
  );

  const badToken = mintToken(parentAuthId, "PARENT", "x").slice(0, -4) + "aaaa";
  const forged = await rpc(badToken, "current_app_user_id");
  check(
    "a tampered signature is rejected outright",
    forged.status === 401 || forged.status === 403,
    `status=${forged.status} data=${JSON.stringify(forged.data)?.slice(0, 120)}`
  );

  // ---- 2. Role enforcement ----
  console.log("\n2. Role-based authorization");
  const childTriesParent = await rpc(childAToken, "require_parent");
  check(
    "child cannot call require_parent",
    childTriesParent.status !== 200 &&
      codeOf(childTriesParent.data).includes("42501"),
    `status=${childTriesParent.status} :: ${codeOf(childTriesParent.data)}`
  );

  const parentTriesKid = await rpc(parentToken, "kid_dashboard");
  check(
    "parent cannot call kid_dashboard",
    parentTriesKid.status !== 200,
    `status=${parentTriesKid.status}`
  );

  // ---- 3. Child submits, parent approves, points are paid ----
  console.log("\n3. Core flow: submit -> approve -> points");
  const submit = await rpc(childAToken, "submit_task_instance", {
    p_instance_id: instanceId,
  });
  check(
    "child submits own task",
    submit.status === 200 && submit.data?.status === "SUBMITTED",
    `status=${submit.status} :: ${JSON.stringify(submit.data)?.slice(0, 120)}`
  );

  const crossSubmit = await rpc(childBToken, "submit_task_instance", {
    p_instance_id: instanceId,
  });
  check(
    "another child cannot submit this instance",
    crossSubmit.status !== 200,
    `status=${crossSubmit.status}`
  );

  const approve = await rpc(parentToken, "approve_task_instance", {
    p_instance_id: instanceId,
  });
  check(
    "parent approves the submission",
    approve.status === 200 && approve.data?.status === "APPROVED",
    `status=${approve.status} :: ${JSON.stringify(approve.data)?.slice(0, 160)}`
  );

  const balance = await db.query(
    "select points_balance from public.users where id = $1",
    [childAId]
  );
  check(
    "child was paid exactly 25 points",
    balance.rows[0].points_balance === 25,
    `balance=${balance.rows[0].points_balance}`
  );

  // ---- 4. Idempotency ----
  console.log("\n4. Idempotency guards");
  const approveAgain = await rpc(parentToken, "approve_task_instance", {
    p_instance_id: instanceId,
  });
  check(
    "second approval is rejected",
    approveAgain.status !== 200,
    `status=${approveAgain.status}`
  );
  const balance2 = await db.query(
    "select points_balance from public.users where id = $1",
    [childAId]
  );
  check(
    "balance is unchanged after the duplicate approval",
    balance2.rows[0].points_balance === 25,
    `balance=${balance2.rows[0].points_balance}`
  );

  // ---- 5. Reward redemption ----
  console.log("\n5. Reward redemption");
  const request = await rpc(childAToken, "request_reward", {
    p_reward_id: rewardId,
  });
  check(
    "child requests a reward",
    request.status === 200 && request.data?.status === "REQUESTED",
    `status=${request.status} :: ${JSON.stringify(request.data)?.slice(0, 160)}`
  );
  check(
    "points_spent is recorded (the original function omitted this)",
    request.data?.points_spent === 10,
    `points_spent=${request.data?.points_spent}`
  );

  const dupRequest = await rpc(childAToken, "request_reward", {
    p_reward_id: rewardId,
  });
  check(
    "duplicate open request is rejected",
    dupRequest.status !== 200,
    `status=${dupRequest.status}`
  );

  const approveRedemption = await rpc(parentToken, "approve_redemption", {
    p_request_id: request.data?.id,
  });
  check(
    "parent approves the redemption",
    approveRedemption.status === 200,
    `status=${approveRedemption.status} :: ${JSON.stringify(approveRedemption.data)?.slice(0, 160)}`
  );

  const after = await db.query(
    "select points_balance from public.users where id = $1",
    [childAId]
  );
  check(
    "10 points were deducted (25 - 10 = 15)",
    after.rows[0].points_balance === 15,
    `balance=${after.rows[0].points_balance}`
  );

  const stock = await db.query("select stock from public.rewards where id = $1", [
    rewardId,
  ]);
  check("stock decremented from 2 to 1", stock.rows[0].stock === 1, `stock=${stock.rows[0].stock}`);

  // ---- 6. Unlimited stock stays visible ----
  console.log("\n6. Unlimited stock (-1) handling");
  await db.query("update public.rewards set stock = -1 where id = $1", [rewardId]);
  const kidRewards = await rpc(childAToken, "kid_rewards");
  const unlimitedVisible = (kidRewards.data?.rewards ?? []).some(
    (r) => r.id === rewardId
  );
  check(
    "a stock=-1 reward is still offered to the child",
    unlimitedVisible,
    `rewards=${JSON.stringify(kidRewards.data?.rewards)?.slice(0, 200)}`
  );

  // ---- 7. PIN login ----
  console.log("\n7. Child PIN sign-in (bcrypt verified inside Postgres)");
  const created = await rpc(parentToken, "create_child", {
    p_display_name: "Pin Kid",
    p_username: "testpinkid",
    p_pin: "4821",
  });
  check(
    "parent creates a child with a PIN",
    created.status === 200,
    `status=${created.status} :: ${JSON.stringify(created.data)?.slice(0, 160)}`
  );

  const noAuth = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const okLogin = await rpc(noAuth, "child_login_verify", {
    p_username: "testpinkid",
    p_pin: "4821",
  });
  check(
    "correct PIN returns the child identity",
    okLogin.status === 200 && okLogin.data?.display_name === "Pin Kid",
    `status=${okLogin.status} :: ${JSON.stringify(okLogin.data)?.slice(0, 160)}`
  );
  check(
    "the response contains no pin hash",
    !JSON.stringify(okLogin.data ?? {}).includes("$2"),
    `data=${JSON.stringify(okLogin.data)?.slice(0, 160)}`
  );

  const badLogin = await rpc(noAuth, "child_login_verify", {
    p_username: "testpinkid",
    p_pin: "0000",
  });
  check(
    "wrong PIN returns null",
    badLogin.status === 200 && badLogin.data === null,
    `status=${badLogin.status} data=${JSON.stringify(badLogin.data)}`
  );

  // The PIN alone is not enough: the profile must also own an auth identity, or the
  // session token would have no valid subject. create_child provisions it.
  const subjectRes = await rpc(env.SUPABASE_SERVICE_ROLE_KEY, "child_login_subject", {
    p_username: "testpinkid",
    p_pin: "4821",
  });
  check(
    "a created child can actually obtain a session subject",
    subjectRes.status === 200 && typeof subjectRes.data?.subject === "string",
    `status=${subjectRes.status} :: ${JSON.stringify(subjectRes.data)?.slice(0, 160)}`
  );

  const linkedRow = await db.query(
    "select auth_user_id from public.users where username = 'testpinkid'"
  );
  check(
    "the child profile is linked to an auth identity",
    Boolean(linkedRow.rows[0]?.auth_user_id),
    `auth_user_id=${linkedRow.rows[0]?.auth_user_id}`
  );

  if (subjectRes.data?.subject) {
    const childSessionToken = mintToken(subjectRes.data.subject, "CHILD", "Pin Kid");
    const kidView = await rpc(childSessionToken, "kid_dashboard");
    check(
      "the child's own session works end to end",
      kidView.status === 200 && kidView.data?.child?.display_name === "Pin Kid",
      `status=${kidView.status} :: ${JSON.stringify(kidView.data)?.slice(0, 160)}`
    );
  }

  // ---- 8. Tables remain unreachable with the publishable key ----
  console.log("\n8. Direct table access is denied");
  for (const table of ["users", "task_instances", "point_transactions"]) {
    const r = await fetch(
      `${URL_}/rest/v1/${table}?select=*&limit=1`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }
    );
    check(
      `direct select on ${table} is denied`,
      r.status === 401 || r.status === 403,
      `status=${r.status}`
    );
  }
} finally {
  // Collect the auth identities BEFORE deleting the family.
  //
  // users.auth_user_id is `on delete set null`, so once the family cascade runs, the
  // link is gone and the auth rows become unreachable orphan accounts. Reading them
  // first is what makes this cleanup complete.
  const linked = familyId
    ? await db.query(
        "select auth_user_id from public.users where family_id = $1 and auth_user_id is not null",
        [familyId]
      )
    : { rows: [] };

  if (familyId) {
    await db.query("delete from public.families where id = $1", [familyId]);
  }

  // Identities this run created. The guard compares against a snapshot taken at startup,
  // so an identity that already existed is never removed. Selecting every
  // `@kidchore.local` row instead would also match identities belonging to real children,
  // because create_child generates exactly that address shape; doing that once locked a
  // real child out of their account.
  const removedCreated = await guard.removeCreated();

  // The identities this script created explicitly, plus any linked to the test family.
  const explicit = new Set([
    ...authUserIds,
    ...linked.rows.map((r) => r.auth_user_id),
  ]);
  let removedExplicit = 0;
  for (const id of explicit) {
    if (!id || guard.existedBefore(id)) continue;
    const res = await db
      .query("delete from auth.users where id = $1", [id])
      .catch(() => ({ rowCount: 0 }));
    await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
    removedExplicit += res.rowCount ?? 0;
  }

  console.log(
    `\nTest family and ${removedCreated + removedExplicit} auth identit${
      removedCreated + removedExplicit === 1 ? "y" : "ies"
    } removed.`
  );
  await db.end();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
