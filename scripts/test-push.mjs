/**
 * Tests web push subscriptions and recipient resolution.
 *
 * No notification is actually delivered here: pushing needs the VAPID private key and a
 * real device, and a test that depends on Apple's push service would fail for reasons
 * that have nothing to do with this code. What IS tested is the part that can leak data
 * or notify the wrong person - who may register a device, who may be told about an
 * event, and what the message says.
 *
 * The rule the whole design rests on: a caller announces an event, and the DATABASE
 * decides who hears about it. So every check below asks one of two questions:
 * "can someone register a device that is not theirs", or "can someone cause a
 * notification to reach a person the event is not about".
 *
 * Usage: node scripts/test-push.mjs
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

/** PostgREST reports a `raise exception` as 4xx with the message in `message`. */
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
  parent: "11111111-1111-4111-8111-11111111a001",
  childA: "11111111-1111-4111-8111-11111111a002",
  childB: "11111111-1111-4111-8111-11111111a003",
  otherParent: "11111111-1111-4111-8111-11111111a004",
  otherChild: "11111111-1111-4111-8111-11111111a005",
};

const FAMILY = "__PUSH_TEST__";
const OTHER_FAMILY = "__PUSH_TEST_OTHER__";

const tokens = {
  parent: mint(AUTH.parent, "PARENT", "Push Phụ Huynh"),
  childA: mint(AUTH.childA, "CHILD", "Push Bé A"),
  childB: mint(AUTH.childB, "CHILD", "Push Bé B"),
  otherParent: mint(AUTH.otherParent, "PARENT", "Push Phụ Huynh Khác"),
  otherChild: mint(AUTH.otherChild, "CHILD", "Push Bé Khác"),
};

const endpoint = (name) => `https://push.example.com/${FAMILY}/${name}`;

async function makeAuthUser(id) {
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
    // The whole id, not a prefix: every fixture id in this file starts with the same
    // characters, and auth.users has a unique index on email.
    [id, `push-${id}@example.com`]
  );
}

let familyId = null;
let otherFamilyId = null;

try {
  console.log("Testing push subscriptions and recipients...\n");

  await db.query("delete from public.families where family_name in ($1, $2)", [
    FAMILY,
    OTHER_FAMILY,
  ]);
  for (const id of Object.values(AUTH)) await makeAuthUser(id);

  familyId = (
    await db.query("insert into public.families (family_name) values ($1) returning id", [FAMILY])
  ).rows[0].id;
  otherFamilyId = (
    await db.query("insert into public.families (family_name) values ($1) returning id", [
      OTHER_FAMILY,
    ])
  ).rows[0].id;

  // The parent row itself is not needed: the endpoints are what the checks read, and
  // `push_recipients` resolves the parent from the family rather than from an id.
  await db.query(
    `insert into public.users (family_id, role, display_name, auth_user_id)
     values ($1, 'PARENT', 'Push Phụ Huynh', $2)`,
    [familyId, AUTH.parent]
  );
  const childA = (
    await db.query(
      `insert into public.users (family_id, role, display_name, username, auth_user_id, pin_code)
       values ($1, 'CHILD', 'Push Bé A', 'pushkida', $2, public.hash_pin('1111')) returning id`,
      [familyId, AUTH.childA]
    )
  ).rows[0].id;
  const childB = (
    await db.query(
      `insert into public.users (family_id, role, display_name, username, auth_user_id, pin_code)
       values ($1, 'CHILD', 'Push Bé B', 'pushkidb', $2, public.hash_pin('2222')) returning id`,
      [familyId, AUTH.childB]
    )
  ).rows[0].id;
  await db.query(
    `insert into public.users (family_id, role, display_name, auth_user_id)
     values ($1, 'PARENT', 'Push Phụ Huynh Khác', $2)`,
    [otherFamilyId, AUTH.otherParent]
  );
  await db.query(
    `insert into public.users (family_id, role, display_name, username, auth_user_id, pin_code)
     values ($1, 'CHILD', 'Push Bé Khác', 'pushkidother', $2, public.hash_pin('3333'))`,
    [otherFamilyId, AUTH.otherChild]
  );

  // ---- fixtures for the events ----
  const task = (
    await db.query(
      `insert into public.tasks (family_id, title, points_reward, recurrence)
       values ($1, 'Push: rửa bát', 5, 'DAILY') returning id`,
      [familyId]
    )
  ).rows[0].id;

  // Child A: one instance already submitted (the thing a parent reviews)...
  const submitted = (
    await db.query(
      `insert into public.task_instances (task_id, assigned_child_id, due_date, status, completed_at)
       values ($1, $2, current_date, 'SUBMITTED', now()) returning id`,
      [task, childA]
    )
  ).rows[0].id;

  // ...and one still pending, which is what TASK_ASSIGNED counts. It needs its own
  // task: `task_instances_unique_per_day` allows one instance per task, child and day.
  const pendingTask = (
    await db.query(
      `insert into public.tasks (family_id, title, points_reward, recurrence)
       values ($1, 'Push: quét nhà', 4, 'DAILY') returning id`,
      [familyId]
    )
  ).rows[0].id;
  await db.query(
    `insert into public.task_instances (task_id, assigned_child_id, due_date, status)
     values ($1, $2, current_date, 'PENDING')`,
    [pendingTask, childA]
  );

  const reward = (
    await db.query(
      `insert into public.rewards (family_id, title, points_required, stock)
       values ($1, 'Push: kem', 3, -1) returning id`,
      [familyId]
    )
  ).rows[0].id;
  await db.query("update public.users set points_balance = 10 where id = $1", [childA]);
  const redemption = (
    await db.query(
      `insert into public.redemption_requests (reward_id, child_id, points_spent, status)
       values ($1, $2, 3, 'REQUESTED') returning id`,
      [reward, childA]
    )
  ).rows[0].id;

  // ---- 1. Registering a device ----
  console.log("1. Registering a device");

  const registered = await rpc(tokens.childA, "register_push_subscription", {
    p_endpoint: endpoint("kid-a"),
    p_p256dh: "BKxQ2Q_p256dh_key_for_tests",
    p_auth: "auth_secret_for_tests",
    p_user_agent: "test-runner",
  });
  check("a child can register an endpoint", registered.status < 400, JSON.stringify(registered.data));

  const rowA = await db.query("select user_id, last_seen_at from public.push_subscriptions where endpoint = $1", [
    endpoint("kid-a"),
  ]);
  check(
    "the stored row belongs to the caller, not to a parameter",
    rowA.rows.length === 1 && rowA.rows[0].user_id === childA,
    JSON.stringify(rowA.rows)
  );

  // The shared-tablet case: the same browser profile subscribes again after a different
  // child signs in, and the row has to move with them or the tablet keeps notifying the
  // previous child.
  await rpc(tokens.childB, "register_push_subscription", {
    p_endpoint: endpoint("kid-a"),
    p_p256dh: "BKxQ2Q_p256dh_key_for_tests",
    p_auth: "auth_secret_for_tests",
  });
  const moved = await db.query("select user_id from public.push_subscriptions where endpoint = $1", [
    endpoint("kid-a"),
  ]);
  check(
    "the same device re-registering moves to whoever signed in now",
    moved.rows.length === 1 && moved.rows[0].user_id === childB,
    JSON.stringify(moved.rows)
  );

  // Put it back on child A for the remaining checks.
  await rpc(tokens.childA, "register_push_subscription", {
    p_endpoint: endpoint("kid-a"),
    p_p256dh: "BKxQ2Q_p256dh_key_for_tests",
    p_auth: "auth_secret_for_tests",
  });

  const notHttps = await rpcError(tokens.childA, "register_push_subscription", {
    p_endpoint: "http://insecure.example.com/x",
    p_p256dh: "k",
    p_auth: "a",
  });
  check("a non-https endpoint is refused", Boolean(notHttps), String(notHttps));

  const noKeys = await rpcError(tokens.childA, "register_push_subscription", {
    p_endpoint: endpoint("no-keys"),
    p_p256dh: "",
    p_auth: "",
  });
  check("an endpoint with empty keys is refused", Boolean(noKeys), String(noKeys));

  const anonRegister = await rpc(anon, "register_push_subscription", {
    p_endpoint: endpoint("anon"),
    p_p256dh: "k",
    p_auth: "a",
  });
  check("anon cannot register an endpoint at all", anonRegister.status >= 400, String(anonRegister.status));

  // ---- 2. Deleting a device ----
  console.log("\n2. Deleting a device");

  await rpc(tokens.childA, "register_push_subscription", {
    p_endpoint: endpoint("kid-b"),
    p_p256dh: "k2",
    p_auth: "a2",
  });
  await rpc(tokens.childA, "delete_push_subscription", { p_endpoint: endpoint("kid-b") });
  const deleted = await db.query("select 1 from public.push_subscriptions where endpoint = $1", [
    endpoint("kid-b"),
  ]);
  check("a child can delete their own endpoint", deleted.rows.length === 0, "");

  await rpc(tokens.childB, "delete_push_subscription", { p_endpoint: endpoint("kid-a") });
  const notDeleted = await db.query("select 1 from public.push_subscriptions where endpoint = $1", [
    endpoint("kid-a"),
  ]);
  check(
    "a child cannot delete another person's endpoint",
    notDeleted.rows.length === 1,
    "the row was removed by somebody who does not own it"
  );

  // ---- 3. Who hears about a child-raised event ----
  console.log("\n3. Events raised by a child reach the parents");

  await rpc(tokens.parent, "register_push_subscription", {
    p_endpoint: endpoint("parent"),
    p_p256dh: "parent_key",
    p_auth: "parent_auth",
  });

  const submittedPush = await rpc(tokens.childA, "push_recipients", {
    p_kind: "TASK_SUBMITTED",
    p_subject_id: submitted,
  });
  const submittedRows = Array.isArray(submittedPush.data) ? submittedPush.data : [];
  check(
    "a submitted chore tells the parent",
    submittedRows.length === 1 && submittedRows[0].endpoint === endpoint("parent"),
    JSON.stringify(submittedPush.data)
  );
  check(
    "and tells nobody else",
    submittedRows.every((r) => r.endpoint === endpoint("parent")),
    ""
  );
  check(
    "the message names the child and the chore without any client input",
    Boolean(submittedRows[0]?.body?.includes("Push Bé A")) &&
      Boolean(submittedRows[0]?.body?.includes("rửa bát")),
    String(submittedRows[0]?.body)
  );

  const wrongInstance = await rpcError(tokens.childB, "push_recipients", {
    p_kind: "TASK_SUBMITTED",
    p_subject_id: submitted,
  });
  check(
    "a child cannot announce a sibling's chore",
    Boolean(wrongInstance?.includes("NOT_YOUR_TASK_INSTANCE")),
    String(wrongInstance)
  );

  const parentAsChild = await rpcError(tokens.parent, "push_recipients", {
    p_kind: "TASK_SUBMITTED",
    p_subject_id: submitted,
  });
  check(
    "a parent cannot raise a child-raised event",
    Boolean(parentAsChild?.includes("CHILD_ROLE_REQUIRED")),
    String(parentAsChild)
  );

  const requestedPush = await rpc(tokens.childA, "push_recipients", {
    p_kind: "REWARD_REQUESTED",
    p_subject_id: redemption,
  });
  const requestedRows = Array.isArray(requestedPush.data) ? requestedPush.data : [];
  check(
    "a reward request tells the parent",
    requestedRows.length === 1 && requestedRows[0].endpoint === endpoint("parent"),
    JSON.stringify(requestedPush.data)
  );

  const wrongReward = await rpcError(tokens.childB, "push_recipients", {
    p_kind: "REWARD_REQUESTED",
    p_subject_id: redemption,
  });
  check(
    "a child cannot announce a sibling's reward request",
    Boolean(wrongReward?.includes("NOT_YOUR_REWARD_REQUEST")),
    String(wrongReward)
  );

  // ---- 4. Who hears about a parent-raised event ----
  console.log("\n4. Events raised by a parent reach one child");

  const approvedPush = await rpc(tokens.parent, "push_recipients", {
    p_kind: "TASK_APPROVED",
    p_subject_id: submitted,
  });
  const approvedRows = Array.isArray(approvedPush.data) ? approvedPush.data : [];
  check(
    "approving a chore tells exactly the child who did it",
    approvedRows.length === 1 && approvedRows[0].endpoint === endpoint("kid-a"),
    JSON.stringify(approvedPush.data)
  );
  check(
    "the approval message carries the points from the task, not from the caller",
    Boolean(approvedRows[0]?.body?.includes("5")),
    String(approvedRows[0]?.body)
  );

  const crossFamily = await rpcError(tokens.otherParent, "push_recipients", {
    p_kind: "TASK_APPROVED",
    p_subject_id: submitted,
  });
  check(
    "another family's parent cannot notify this family's child",
    Boolean(crossFamily?.includes("CHILD_NOT_IN_FAMILY")),
    String(crossFamily)
  );

  const pointsNoAmount = await rpcError(tokens.parent, "push_recipients", {
    p_kind: "POINTS_CHANGED",
    p_subject_id: childA,
  });
  check(
    "a points change without an amount is refused",
    Boolean(pointsNoAmount?.includes("AMOUNT_REQUIRED")),
    String(pointsNoAmount)
  );

  const pointsPush = await rpc(tokens.parent, "push_recipients", {
    p_kind: "POINTS_CHANGED",
    p_subject_id: childA,
    p_amount: 7,
  });
  const pointsRows = Array.isArray(pointsPush.data) ? pointsPush.data : [];
  check(
    "a points change reaches the child",
    pointsRows.length === 1 && pointsRows[0].endpoint === endpoint("kid-a"),
    JSON.stringify(pointsPush.data)
  );
  check(
    "the message states the amount that was passed",
    Boolean(pointsRows[0]?.title?.includes("7")),
    String(pointsRows[0]?.title)
  );
  check(
    "and the balance from the database, not from the caller",
    Boolean(pointsRows[0]?.body?.includes("10")),
    String(pointsRows[0]?.body)
  );

  const negative = await rpc(tokens.parent, "push_recipients", {
    p_kind: "POINTS_CHANGED",
    p_subject_id: childA,
    p_amount: -3,
  });
  const negativeRows = Array.isArray(negative.data) ? negative.data : [];
  check(
    "a penalty says it is a deduction",
    Boolean(negativeRows[0]?.title?.includes("Bị trừ")),
    String(negativeRows[0]?.title)
  );

  const crossFamilyPoints = await rpcError(tokens.parent, "push_recipients", {
    p_kind: "POINTS_CHANGED",
    p_subject_id: AUTH.otherChild,
    p_amount: 1,
  });
  check(
    "a parent cannot notify another family's child about points",
    Boolean(crossFamilyPoints?.includes("CHILD_NOT_IN_FAMILY")),
    String(crossFamilyPoints)
  );

  const amountNotAllowed = await rpcError(tokens.parent, "push_recipients", {
    p_kind: "TASK_APPROVED",
    p_subject_id: submitted,
    p_amount: 5,
  });
  check(
    "an amount is refused for every kind except POINTS_CHANGED",
    Boolean(amountNotAllowed?.includes("AMOUNT_NOT_ALLOWED")),
    String(amountNotAllowed)
  );

  const unknownKind = await rpcError(tokens.parent, "push_recipients", {
    p_kind: "TASK_EXPLODED",
    p_subject_id: submitted,
  });
  check(
    "an unrecognised kind is refused rather than silently sending nothing",
    Boolean(unknownKind?.includes("UNKNOWN_NOTIFICATION_KIND")),
    String(unknownKind)
  );

  const childRaisesParentEvent = await rpcError(tokens.childA, "push_recipients", {
    p_kind: "TASK_APPROVED",
    p_subject_id: submitted,
  });
  check(
    "a child cannot raise a parent-raised event",
    Boolean(childRaisesParentEvent?.includes("PARENT_ROLE_REQUIRED")),
    String(childRaisesParentEvent)
  );

  const approvedRedemption = await rpc(tokens.parent, "push_recipients", {
    p_kind: "REDEMPTION_APPROVED",
    p_subject_id: redemption,
  });
  const approvedRedemptionRows = Array.isArray(approvedRedemption.data) ? approvedRedemption.data : [];
  check(
    "approving a reward tells the requesting child",
    approvedRedemptionRows.length === 1 &&
      approvedRedemptionRows[0].endpoint === endpoint("kid-a"),
    JSON.stringify(approvedRedemption.data)
  );

  const rejectedRedemption = await rpc(tokens.parent, "push_recipients", {
    p_kind: "REDEMPTION_REJECTED",
    p_subject_id: redemption,
  });
  const rejectedRedemptionRows = Array.isArray(rejectedRedemption.data) ? rejectedRedemption.data : [];
  check(
    "rejecting a reward tells the requesting child",
    rejectedRedemptionRows.length === 1 &&
      rejectedRedemptionRows[0].endpoint === endpoint("kid-a"),
    JSON.stringify(rejectedRedemption.data)
  );

  // ---- 5. Today's chores ----
  console.log("\n5. Today's chores announce a count, not a pile of messages");

  const assigned = await rpc(tokens.parent, "push_recipients", {
    p_kind: "TASK_ASSIGNED",
    p_subject_id: childA,
  });
  const assignedRows = Array.isArray(assigned.data) ? assigned.data : [];
  check(
    "a child with a chore waiting is told once",
    assignedRows.length === 1 && assignedRows[0].endpoint === endpoint("kid-a"),
    JSON.stringify(assigned.data)
  );
  check(
    "the message counts what is actually pending",
    Boolean(assignedRows[0]?.body?.includes("1 việc")),
    String(assignedRows[0]?.body)
  );

  const assignedNone = await rpc(tokens.parent, "push_recipients", {
    p_kind: "TASK_ASSIGNED",
    p_subject_id: childB,
  });
  check(
    "a child with nothing pending gets no notification at all",
    Array.isArray(assignedNone.data) && assignedNone.data.length === 0,
    JSON.stringify(assignedNone.data)
  );

  // ---- 6. The table itself is unreachable ----
  console.log("\n6. The subscriptions table is not readable from a client");

  const anonSelect = await fetch(`${url}/rest/v1/push_subscriptions?select=endpoint`, {
    headers: { apikey: anon },
  });
  check(
    "anon cannot select subscriptions",
    anonSelect.status >= 400,
    `HTTP ${anonSelect.status}`
  );

  const childSelect = await fetch(`${url}/rest/v1/push_subscriptions?select=endpoint`, {
    headers: { apikey: anon, Authorization: `Bearer ${tokens.childA}` },
  });
  check(
    "a signed-in child cannot select them either",
    childSelect.status >= 400,
    `HTTP ${childSelect.status}`
  );

  // ---- 7. Nothing else leaks through the RPC ----
  console.log("\n7. The RPC returns only what is needed to send");

  const columns = submittedRows[0] ? Object.keys(submittedRows[0]).sort().join(",") : "";
  check(
    "recipient rows expose exactly the delivery columns and the message",
    columns === "auth,body,endpoint,p256dh,recipient_user_id,tag,title,url",
    columns
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
  for (const id of Object.values(AUTH)) {
    await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
    await db.query("delete from auth.users where id = $1", [id]).catch(() => {});
  }
  await db.end();
  console.log(`\nPush fixtures removed (${removed} identity/identities).`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
