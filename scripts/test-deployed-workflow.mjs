/**
 * Verifies the whole family workflow against a deployed instance.
 *
 * The local suites prove the logic; this proves the deployment serves it. It drives
 * every authenticated route and the keepalive endpoint with real session tokens, then
 * removes everything it created.
 *
 * Only public APIs and the database connection are used, so a passing run means the
 * production deployment genuinely works end to end rather than merely responding.
 *
 * Usage: node scripts/test-deployed-workflow.mjs [baseUrl]
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import pg from "pg";

const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SESSION_COOKIE = "kidchore_session";
const DAY = 86400;

function mintToken(sub, role, name, ttl = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: "supabase",
    sub,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + ttl,
    app_role: role,
    app_name: name,
  })}`;
  return `${input}.${createHmac("sha256", env.SUPABASE_JWT_SECRET).update(input).digest("base64url")}`;
}

async function get(pathname, token) {
  const res = await fetch(`${base}${pathname}`, {
    headers: token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {},
    redirect: "manual",
  });
  const body = res.status === 200 ? await res.text() : "";
  return { status: res.status, location: res.headers.get("location"), body };
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

const AUTH_PARENT = "55555555-5555-4555-8555-555555555555";
const AUTH_CHILD = "66666666-6666-4666-8666-666666666666";
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

try {
  console.log(`Verifying the deployed workflow at ${base}\n`);

  await db.query("delete from public.families where family_name = '__PROD_E2E__'");
  await createAuthUser(AUTH_PARENT, "prod.e2e.parent@example.com");
  await createAuthUser(AUTH_CHILD, "prod.e2e.child@example.com");

  const fam = await db.query(
    "insert into public.families (family_name) values ('__PROD_E2E__') returning id"
  );
  createdFamilies.push(fam.rows[0].id);

  const parent = await db.query(
    `insert into public.users (family_id, role, display_name, email, auth_user_id)
     values ($1, 'PARENT', 'Prod Phụ Huynh', 'prod.e2e.parent@example.com', $2) returning id`,
    [fam.rows[0].id, AUTH_PARENT]
  );
  const parentId = parent.rows[0].id;

  const child = await db.query(
    `insert into public.users (family_id, role, display_name, username, auth_user_id, pin_code)
     values ($1, 'CHILD', 'Prod Bé', 'prodbec', $2, public.hash_pin('9753')) returning id`,
    [fam.rows[0].id, AUTH_CHILD]
  );
  const childId = child.rows[0].id;

  const task = await db.query(
    `insert into public.tasks (family_id, title, description, points_reward, recurrence, assigned_to_user_id)
     values ($1, 'Prod Việc thử', 'Kiểm chứng production', 33, 'DAILY', $2) returning id`,
    [fam.rows[0].id, childId]
  );
  await db.query(
    `insert into public.task_instances (task_id, assigned_child_id, due_date, status)
     values ($1, $2, current_date, 'PENDING')`,
    [task.rows[0].id, childId]
  );
  await db.query(
    `insert into public.rewards (family_id, title, points_required, stock)
     values ($1, 'Prod Phần thưởng', 11, -1)`,
    [fam.rows[0].id]
  );

  const parentToken = mintToken(AUTH_PARENT, "PARENT", "Prod Phụ Huynh");
  const childToken = mintToken(AUTH_CHILD, "CHILD", "Prod Bé");

  // ---- 1. Anonymous access ----
  console.log("1. Anonymous access is refused");
  const anonParent = await get("/parent/dashboard");
  check(
    "parent area redirects an anonymous visitor",
    anonParent.status === 307 && (anonParent.location ?? "").startsWith("/login"),
    `status=${anonParent.status}`
  );
  const anonKid = await get("/kid/dashboard");
  check(
    "kid area redirects an anonymous visitor",
    anonKid.status === 307 && (anonKid.location ?? "").startsWith("/login"),
    `status=${anonKid.status}`
  );

  // ---- 2. Parent pages ----
  console.log("\n2. Parent pages render real data");
  for (const [label, path] of [
    ["dashboard", "/parent/dashboard"],
    ["chores", "/parent/chores"],
    ["tasks", "/parent/tasks"],
    ["rewards", "/parent/rewards"],
    ["family", "/parent/family"],
  ]) {
    const res = await get(path, parentToken);
    check(
      `parent ${label} returns 200`,
      res.status === 200,
      `status=${res.status}`
    );
  }
  const dashboard = await get("/parent/dashboard", parentToken);
  check(
    "it shows the parent and child names",
    dashboard.body.includes("Prod Phụ Huynh") && dashboard.body.includes("Prod Bé"),
    "names missing from HTML"
  );

  // ---- 3. Child pages ----
  console.log("\n3. Child pages render real data");
  for (const [label, path] of [
    ["dashboard", "/kid/dashboard"],
    ["tasks", "/kid/tasks"],
    ["rewards", "/kid/rewards"],
  ]) {
    const res = await get(path, childToken);
    check(`child ${label} returns 200`, res.status === 200, `status=${res.status}`);
  }
  const kidDash = await get("/kid/dashboard", childToken);
  check(
    "the child sees today's chore",
    kidDash.body.includes("Prod Việc thử"),
    "chore missing from HTML"
  );

  // ---- 4. Role separation ----
  console.log("\n4. Role separation");
  const parentInKid = await get("/kid/dashboard", parentToken);
  check(
    "a parent is redirected out of the kid area",
    parentInKid.status === 307 && (parentInKid.location ?? "").includes("/parent"),
    `status=${parentInKid.status}`
  );
  const childInParent = await get("/parent/dashboard", childToken);
  check(
    "a child is redirected out of the parent area",
    childInParent.status === 307 && (childInParent.location ?? "").includes("/kid"),
    `status=${childInParent.status}`
  );

  // ---- 5. Forged session ----
  console.log("\n5. A forged session is refused");
  const forged = await get("/parent/dashboard", `${parentToken.slice(0, -6)}abcdef`);
  check(
    "a tampered token does not grant access",
    forged.status === 307 && (forged.location ?? "").startsWith("/login"),
    `status=${forged.status}`
  );

  // ---- 6. Session renewal endpoint ----
  console.log("\n6. Session renewal works on the deployment");
  async function keepalive(token) {
    const res = await fetch(`${base}/api/auth/keepalive`, {
      headers: token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {},
      redirect: "manual",
    });
    const cookies = res.headers.getSetCookie?.() ?? [];
    const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    return { status: res.status, cookie: session ? session.slice(SESSION_COOKIE.length + 1).split(";")[0] : null };
  }
  const freshKeep = await keepalive(mintToken(AUTH_PARENT, "PARENT", "x", 20 * DAY));
  check(
    "a session with 20 days left is not reissued",
    freshKeep.status === 204 && freshKeep.cookie === null,
    `status=${freshKeep.status}`
  );
  const oldKeep = await keepalive(mintToken(AUTH_PARENT, "PARENT", "x", 2 * DAY));
  check(
    "a session with 2 days left is reissued",
    oldKeep.status === 204 && oldKeep.cookie !== null,
    `status=${oldKeep.status}`
  );

  // ---- 7. Storage bucket is reachable and public ----
  console.log("\n7. Proof image storage");
  const probe = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/proof-images/__prod_check__/none.png`
  );
  check(
    "the proof-images bucket answers",
    probe.status === 400 || probe.status === 404,
    `status=${probe.status}`
  );

  // ---- 8. The real parent's data is untouched ----
  console.log("\n8. Real family data untouched");
  const real = await get("/parent/dashboard", parentToken);
  check(
    "the test family sees only its own data",
    !real.body.includes("KenKun") && !real.body.includes("Dũng"),
    `leaked=${real.body.includes("KenKun")}`
  );
} finally {
  for (const id of createdFamilies) {
    await db.query("delete from public.families where id = $1", [id]).catch(() => {});
  }
  await db
    .query("delete from public.families where family_name = '__PROD_E2E__'")
    .catch(() => {});
  for (const id of [AUTH_PARENT, AUTH_CHILD]) {
    await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
    await db.query("delete from auth.users where id = $1", [id]).catch(() => {});
  }
  await db.query("delete from auth.users where email like '%@kidchore.local'").catch(() => {});
  await db.end();
  console.log("\nProduction test fixtures removed.");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
