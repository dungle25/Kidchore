/**
 * Closes the last unverified link on the deployed instance: creating a child and having
 * that child sign in with a PIN.
 *
 * The other production suite seeds rows directly, which skips `create_child` and the
 * auth identity it provisions. This calls the real RPC as a parent, then authenticates
 * the resulting child the way the login screen does, and finally exercises the child's
 * own pages. It cleans up completely and never touches the real family's data.
 *
 * Usage: node scripts/test-deployed-child-flow.mjs [baseUrl]
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import pg from "pg";
import { makeIdentityGuard } from "./lib/test-cleanup.mjs";
import { sslForDatabase } from "./lib/database-ssl.mjs";

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

function mintToken(sub, role, name) {
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
  return `${input}.${createHmac("sha256", env.SUPABASE_JWT_SECRET).update(input).digest("base64url")}`;
}

/** Calls a Postgres function as a specific user, the way the app does. */
async function rpc(token, fn, args) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args ?? {}),
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
  ssl: sslForDatabase(env.DATABASE_URL),
});
await db.connect();

/** Snapshot taken before anything is created, so cleanup can spare existing identities. */
const guard = await makeIdentityGuard(db);

const AUTH_PARENT = "77777777-7777-4777-8777-777777777777";
const TEST_FAMILY = "__CHILD_FLOW__";
const TEST_USERNAME = "childflowkid";
let familyId = null;

try {
  console.log(`Verifying the child flow on ${base}\n`);

  await db.query("delete from public.families where family_name = $1", [TEST_FAMILY]);
  await db.query("delete from auth.identities where user_id = $1", [AUTH_PARENT]);
  await db.query("delete from auth.users where id = $1", [AUTH_PARENT]);

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
    [AUTH_PARENT, "childflow.parent@example.com"]
  );

  const fam = await db.query(
    "insert into public.families (family_name) values ($1) returning id",
    [TEST_FAMILY]
  );
  familyId = fam.rows[0].id;

  await db.query(
    `insert into public.users (family_id, role, display_name, email, auth_user_id)
     values ($1, 'PARENT', 'PH Phụ Huynh', 'childflow.parent@example.com', $2)`,
    [familyId, AUTH_PARENT]
  );

  const parentToken = mintToken(AUTH_PARENT, "PARENT", "PH Phụ Huynh");

  // ---- 1. Create a child through the real RPC ----
  console.log("1. Adding a child (what the Gia đình screen does)");
  const created = await rpc(parentToken, "create_child", {
    p_display_name: "Bé Luồng",
    p_username: TEST_USERNAME,
    p_pin: "8642",
  });
  check(
    "create_child succeeds",
    created.status === 200 && created.data?.id,
    `status=${created.status} :: ${JSON.stringify(created.data)?.slice(0, 160)}`
  );

  const childId = created.data?.id;

  const link = await db.query(
    "select auth_user_id, pin_code from public.users where id = $1",
    [childId]
  );
  check(
    "the child was given an auth identity automatically",
    Boolean(link.rows[0]?.auth_user_id),
    `auth_user_id=${link.rows[0]?.auth_user_id}`
  );
  check(
    "the PIN was stored as a bcrypt hash",
    /^\$2[aby]\$/.test(link.rows[0]?.pin_code ?? ""),
    `pin_code starts with ${String(link.rows[0]?.pin_code).slice(0, 4)}`
  );

  // ---- 2. The child appears on the login screen ----
  console.log("\n2. The child can be picked on the login screen");
  const loginPage = await (await fetch(`${base}/login`, { cache: "no-store" })).text();
  check(
    "the login page lists the new child",
    loginPage.includes(TEST_USERNAME) && loginPage.includes("Bé Luồng"),
    "child not listed"
  );

  // ---- 3. PIN sign-in resolves a session subject ----
  console.log("\n3. PIN sign-in");
  const wrongPin = await rpc(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "child_login_verify", {
    p_username: TEST_USERNAME,
    p_pin: "0000",
  });
  check(
    "a wrong PIN returns nothing",
    wrongPin.status === 200 && wrongPin.data === null,
    `status=${wrongPin.status} data=${JSON.stringify(wrongPin.data)}`
  );

  const rightPin = await rpc(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "child_login_verify", {
    p_username: TEST_USERNAME,
    p_pin: "8642",
  });
  check(
    "the correct PIN returns the child",
    rightPin.status === 200 && rightPin.data?.display_name === "Bé Luồng",
    `status=${rightPin.status} :: ${JSON.stringify(rightPin.data)?.slice(0, 120)}`
  );

  // The app signs in with the auth subject, not the profile id.
  const childToken = mintToken(
    link.rows[0].auth_user_id,
    "CHILD",
    "Bé Luồng"
  );

  // ---- 4. The child can use their own pages ----
  console.log("\n4. The child's session works on the deployment");
  const kidDash = await get("/kid/dashboard", childToken);
  check(
    "kid dashboard returns 200",
    kidDash.status === 200,
    `status=${kidDash.status} location=${kidDash.location ?? ""}`
  );
  check(
    "it greets the child",
    kidDash.body.includes("Bé Luồng"),
    "child name missing from HTML"
  );

  const kidRewards = await get("/kid/rewards", childToken);
  check("kid rewards returns 200", kidRewards.status === 200, `status=${kidRewards.status}`);

  // ---- 5. Child cannot reach parent pages ----
  console.log("\n5. The child is confined to their own area");
  const childInParent = await get("/parent/dashboard", childToken);
  check(
    "a child is redirected out of the parent area",
    childInParent.status === 307 && (childInParent.location ?? "").includes("/kid"),
    `status=${childInParent.status} location=${childInParent.location}`
  );
  const childInFamily = await get("/parent/family", childToken);
  check(
    "a child cannot open the family management screen",
    childInFamily.status === 307,
    `status=${childInFamily.status}`
  );

  // ---- 6. A child cannot create another child ----
  console.log("\n6. A child cannot use parent-only functions");
  const escalate = await rpc(childToken, "create_child", {
    p_display_name: "Bé Lạ",
    p_username: "shouldnotwork",
    p_pin: "1111",
  });
  check(
    "create_child is refused for a child session",
    escalate.status !== 200,
    `status=${escalate.status} :: ${JSON.stringify(escalate.data)?.slice(0, 120)}`
  );
} finally {
  if (familyId) {
    await db
      .query("delete from public.families where id = $1", [familyId])
      .catch(() => {});
  }
  await db
    .query("delete from public.families where family_name = $1", [TEST_FAMILY])
    .catch(() => {});
  // Remove only the identities this run created. Deleting every `@kidchore.local`
  // address would also delete the ones belonging to real children, because
  // `create_child` generates identities with exactly that address shape. That mistake
  // was made once and it locked a real child out of their account.
  const removed = await guard.removeCreated();
  await db.query("delete from auth.identities where user_id = $1", [AUTH_PARENT]).catch(() => {});
  await db.query("delete from auth.users where id = $1", [AUTH_PARENT]).catch(() => {});
  await db.end();
  console.log(`\nChild-flow fixtures removed (${removed} identity/identities).`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
