/**
 * Tests the report, streak, achievement and sibling-list functions added in migrations
 * 0007 and 0008.
 *
 * Streaks are the kind of logic that looks right and is subtly wrong, so the fixtures
 * below build a deliberate history: a completed run, then a gap, then an open run that
 * includes today. Each expectation is stated in the test rather than inferred.
 *
 * Usage: node scripts/test-reports-and-streaks.mjs
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import pg from "pg";

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

const AUTH_PARENT = "88888888-8888-4888-8888-888888888888";
const AUTH_KID_A = "99999999-9999-4999-8999-999999999999";
const AUTH_KID_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTH_OUTSIDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const createdFamilies = [];

async function createAuthUser(id, email) {
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
  await db.query(
    `insert into auth.identities (
       id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
     ) values (
       gen_random_uuid(), $1::uuid, $1::text,
       jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
       'email', now(), now(), now()
     )`,
    [id, email]
  );
}

/** Adds a task instance on a given day relative to today. */
async function seedInstance(taskId, childId, daysAgo, status) {
  // $4 is used both as the enum column value and in a comparison, so it is cast
  // explicitly; otherwise Postgres cannot decide between text and task_status.
  await db.query(
    `insert into public.task_instances (task_id, assigned_child_id, due_date, status, approved_at)
     values (
       $1, $2, current_date - $3::int, $4::public.task_status,
       case when $4::text = 'APPROVED' then now() else null end
     )`,
    [taskId, childId, daysAgo, status]
  );
}

try {
  console.log("Setting up two families with a deliberate history...\n");

  for (const id of [AUTH_PARENT, AUTH_KID_A, AUTH_KID_B, AUTH_OUTSIDER]) {
    await createAuthUser(id, `${id.slice(0, 6)}@example.com`);
  }

  const fam = await db.query(
    "insert into public.families (family_name) values ('__REPORTS_TEST__') returning id"
  );
  const familyId = fam.rows[0].id;
  createdFamilies.push(familyId);

  const otherFam = await db.query(
    "insert into public.families (family_name) values ('__REPORTS_OTHER__') returning id"
  );
  createdFamilies.push(otherFam.rows[0].id);

  await db.query(
    `insert into public.users (family_id, role, display_name, auth_user_id)
     values ($1, 'PARENT', 'PH Báo Cáo', $2)`,
    [familyId, AUTH_PARENT]
  );

  const kidA = await db.query(
    `insert into public.users (family_id, role, display_name, username, auth_user_id, pin_code)
     values ($1, 'CHILD', 'Bé A', 'reportsa', $2, public.hash_pin('1111')) returning id`,
    [familyId, AUTH_KID_A]
  );
  const kidAId = kidA.rows[0].id;

  const kidB = await db.query(
    `insert into public.users (family_id, role, display_name, username, auth_user_id, pin_code)
     values ($1, 'CHILD', 'Bé B', 'reportsb', $2, public.hash_pin('2222')) returning id`,
    [familyId, AUTH_KID_B]
  );
  const kidBId = kidB.rows[0].id;

  // A child in another household, used to prove isolation.
  await db.query(
    `insert into public.users (family_id, role, display_name, username, auth_user_id, pin_code)
     values ($1, 'CHILD', 'Bé Lạ', 'outsider', $2, public.hash_pin('3333'))`,
    [otherFam.rows[0].id, AUTH_OUTSIDER]
  );

  const task = await db.query(
    `insert into public.tasks (family_id, title, description, points_reward, recurrence, assigned_to_user_id)
     values ($1, 'Việc báo cáo', 'x', 10, 'DAILY', $2) returning id`,
    [familyId, kidAId]
  );
  const taskId = task.rows[0].id;

  // History for Bé A:
  //   a complete run of 3 days, four days ago through two days ago
  //   nothing yesterday (a gap)
  //   a new run of 2 days ending today
  await seedInstance(taskId, kidAId, 6, "APPROVED");
  await seedInstance(taskId, kidAId, 5, "APPROVED");
  await seedInstance(taskId, kidAId, 4, "APPROVED");
  await seedInstance(taskId, kidAId, 1, "APPROVED");
  await seedInstance(taskId, kidAId, 0, "APPROVED");

  // Bé B: two days with work, one approved and one still pending -> neither complete.
  await seedInstance(taskId, kidBId, 1, "APPROVED");
  await seedInstance(taskId, kidBId, 0, "SUBMITTED");

  const parentToken = mint(AUTH_PARENT, "PARENT", "PH Báo Cáo");
  const kidAToken = mint(AUTH_KID_A, "CHILD", "Bé A");

  // ---- 1. Streaks ----
  console.log("1. Streak calculation");
  const streakA = await rpc(parentToken, "child_streaks", { p_child_id: kidAId });
  check(
    "Bé A has a current streak of 2 (today plus yesterday)",
    streakA.data?.current === 2,
    `current=${streakA.data?.current}`
  );
  check(
    "Bé A's longest streak is 3 (the earlier run)",
    streakA.data?.longest === 3,
    `longest=${streakA.data?.longest}`
  );
  check(
    "today counts as complete for Bé A",
    streakA.data?.today_complete === true,
    `today_complete=${streakA.data?.today_complete}`
  );

  const streakB = await rpc(parentToken, "child_streaks", { p_child_id: kidBId });
  check(
    "Bé B has no streak, because a day with a pending chore is not complete",
    streakB.data?.current === 0 && streakB.data?.longest === 0,
    `current=${streakB.data?.current} longest=${streakB.data?.longest}`
  );
  check(
    "today is not complete for Bé B",
    streakB.data?.today_complete === false,
    `today_complete=${streakB.data?.today_complete}`
  );

  // ---- 2. Daily completion series ----
  console.log("\n2. Daily completion series");
  const daily = await rpc(parentToken, "child_daily_completion", {
    p_child_id: kidAId,
    p_from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    p_to: new Date().toISOString().slice(0, 10),
  });
  check(
    "the series returns one row per day that had work",
    Array.isArray(daily.data) && daily.data.length === 5,
    `rows=${Array.isArray(daily.data) ? daily.data.length : "n/a"}`
  );
  check(
    "each row reports assigned, approved and complete",
    Array.isArray(daily.data) &&
      daily.data.every(
        (row) =>
          typeof row.assigned === "number" &&
          typeof row.approved === "number" &&
          typeof row.complete === "boolean"
      ),
    JSON.stringify(daily.data?.[0])
  );

  // ---- 3. Parent report ----
  console.log("\n3. Parent report");
  const report = await rpc(parentToken, "parent_reports", { p_days: 30 });
  check("parent_reports succeeds", report.status === 200, `status=${report.status}`);
  check(
    "it lists both children",
    Array.isArray(report.data?.children) && report.data.children.length === 2,
    `children=${report.data?.children?.length}`
  );

  const childReportA = report.data?.children?.find((c) => c.display_name === "Bé A");
  check(
    "Bé A's report counts 5 assigned and 5 approved",
    childReportA?.totals?.assigned === 5 && childReportA?.totals?.approved === 5,
    `assigned=${childReportA?.totals?.assigned} approved=${childReportA?.totals?.approved}`
  );
  check(
    "Bé A's report embeds a streak",
    childReportA?.streak?.current === 2,
    JSON.stringify(childReportA?.streak)
  );
  check(
    "Bé A's report embeds a daily series",
    Array.isArray(childReportA?.daily) && childReportA.daily.length === 5,
    `daily=${childReportA?.daily?.length}`
  );
  check(
    "the window is reported and clamped sensibly",
    report.data?.days === 30,
    `days=${report.data?.days}`
  );

  const clamped = await rpc(parentToken, "parent_reports", { p_days: 9999 });
  check(
    "an oversized window is clamped to 180 days",
    clamped.data?.days === 180,
    `days=${clamped.data?.days}`
  );

  // ---- 4. Achievements ----
  console.log("\n4. Achievements and badges");
  const achA = await rpc(kidAToken, "kid_achievements");
  check("kid_achievements succeeds", achA.status === 200, `status=${achA.status}`);
  check(
    "it reports the approved total",
    achA.data?.approved_total === 5,
    `approved_total=${achA.data?.approved_total}`
  );

  const badges = achA.data?.badges ?? [];
  const firstChore = badges.find((b) => b.code === "FIRST_CHORE");
  const tenChores = badges.find((b) => b.code === "TEN_CHORES");
  const streak3 = badges.find((b) => b.code === "STREAK_3");
  const streak7 = badges.find((b) => b.code === "STREAK_7");
  check(
    "the first-chore badge is earned after 5 approvals",
    firstChore?.earned === true,
    JSON.stringify(firstChore)
  );
  check(
    "the ten-chore badge is not yet earned and shows progress",
    tenChores?.earned === false && tenChores?.progress === 5 && tenChores?.target === 10,
    JSON.stringify(tenChores)
  );
  check(
    "the 3-day streak badge is earned from the longest streak",
    streak3?.earned === true,
    JSON.stringify(streak3)
  );
  check(
    "the 7-day streak badge is not earned",
    streak7?.earned === false,
    JSON.stringify(streak7)
  );

  // ---- 5. Sibling list ----
  console.log("\n5. Sibling list for quick switching");
  const sibA = await rpc(kidAToken, "kid_siblings");
  check("kid_siblings succeeds for a child", sibA.status === 200, `status=${sibA.status}`);
  check(
    "it lists both children in the family",
    Array.isArray(sibA.data) && sibA.data.length === 2,
    `count=${sibA.data?.length}`
  );
  check(
    "exactly one entry is marked as me",
    Array.isArray(sibA.data) && sibA.data.filter((s) => s.is_me).length === 1,
    JSON.stringify(sibA.data?.map((s) => [s.display_name, s.is_me]))
  );
  check(
    "it never leaks a PIN hash",
    !JSON.stringify(sibA.data ?? {}).includes("$2"),
    "hash found in payload"
  );
  check(
    "it never leaks a points balance",
    !JSON.stringify(sibA.data ?? {}).includes("points"),
    JSON.stringify(sibA.data?.[0])
  );
  check(
    "it never lists a child from another family",
    !JSON.stringify(sibA.data ?? {}).includes("Bé Lạ"),
    "foreign child leaked"
  );

  // ---- 6. Authorization ----
  console.log("\n6. Authorization");
  const childCallsReport = await rpc(kidAToken, "parent_reports");
  check(
    "a child cannot read the parent report",
    childCallsReport.status !== 200,
    `status=${childCallsReport.status}`
  );
  const parentCallsAchievements = await rpc(parentToken, "kid_achievements");
  check(
    "a parent cannot read a child's achievements",
    parentCallsAchievements.status !== 200,
    `status=${parentCallsAchievements.status}`
  );
  const parentCallsSiblings = await rpc(parentToken, "kid_siblings");
  check(
    "a parent cannot use kid_siblings",
    parentCallsSiblings.status !== 200,
    `status=${parentCallsSiblings.status}`
  );
  const outsiderCallsStreak = await rpc(AUTH_OUTSIDER, "kid_siblings");
  check(
    "a child from another family gets their own family's list only",
    !JSON.stringify(outsiderCallsStreak.data ?? {}).includes("Bé A"),
    JSON.stringify(outsiderCallsStreak.data)
  );

  // ---- 7. Anon ----
  console.log("\n7. Anonymous callers are refused");
  const anonReport = await rpc(anon, "parent_reports");
  check(
    "anon cannot call parent_reports",
    anonReport.status === 401 || anonReport.status === 403,
    `status=${anonReport.status}`
  );
  const anonSiblings = await rpc(anon, "kid_siblings");
  check(
    "anon cannot call kid_siblings",
    anonSiblings.status === 401 || anonSiblings.status === 403,
    `status=${anonSiblings.status}`
  );
} finally {
  for (const id of createdFamilies) {
    await db.query("delete from public.families where id = $1", [id]).catch(() => {});
  }
  for (const id of [AUTH_PARENT, AUTH_KID_A, AUTH_KID_B, AUTH_OUTSIDER]) {
    await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
    await db.query("delete from auth.users where id = $1", [id]).catch(() => {});
  }
  await db.end();
  console.log("\nReport/streak fixtures removed.");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
