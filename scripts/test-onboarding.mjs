/**
 * Verifies the onboarding path: a fresh Google identity creating its first family.
 *
 * This is the one flow a real user hits before anything else, and it was not covered by
 * the other suites. It calls `bootstrap_parent` with a session token exactly like the
 * one the callback mints, then cleans up.
 *
 * Usage: node scripts/test-onboarding.mjs
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import pg from "pg";
import { makeIdentityGuard } from "./lib/test-cleanup.mjs";
import { sslForDatabase } from "./lib/database-ssl.mjs";

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

function mint(sub, email) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: "supabase",
    sub,
    aud: "authenticated",
    role: "authenticated",
    iat: now,
    exp: now + 3600,
    email,
  })}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

async function rpc(token, fn, args) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: anon,
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

const AUTH_ID = "44444444-4444-4444-8444-444444444444";
const EMAIL = "onboarding.test@example.com";
let familyId = null;

try {
  // Clean any residue from an interrupted run.
  await db.query("delete from public.families where family_name = '__ONBOARD_TEST__'");
  await db.query("delete from auth.identities where user_id = $1", [AUTH_ID]);
  await db.query("delete from auth.users where id = $1", [AUTH_ID]);

  // A brand new Google identity, exactly as Supabase Auth would have created it.
  await db.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new, email_change
     ) values (
       $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2,
       extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 10)), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
       '{}'::jsonb, now(), now(), '', '', '', ''
     )`,
    [AUTH_ID, EMAIL]
  );

  const token = mint(AUTH_ID, EMAIL);

  // ---- 1. Before onboarding, this identity has no app user ----
  console.log("1. Fresh identity has no household yet");
  const before = await rpc(token, "current_app_user_id");
  check(
    "current_app_user_id is null before onboarding",
    before.status === 200 && before.data === null,
    `status=${before.status} data=${JSON.stringify(before.data)}`
  );

  const overviewBefore = await rpc(token, "parent_overview");
  check(
    "parent_overview refuses an identity with no household",
    overviewBefore.status !== 200,
    `status=${overviewBefore.status} :: ${JSON.stringify(overviewBefore.data)?.slice(0, 120)}`
  );

  // ---- 2. bootstrap_parent creates the family and the parent ----
  console.log("\n2. bootstrap_parent creates the household");
  const boot = await rpc(token, "bootstrap_parent", {
    p_display_name: "Bố Test",
    p_family_name: "__ONBOARD_TEST__",
  });
  check(
    "bootstrap_parent succeeds",
    boot.status === 200,
    `status=${boot.status} :: ${JSON.stringify(boot.data)?.slice(0, 200)}`
  );
  check(
    "it returns the new parent user",
    boot.data?.role === "PARENT" && boot.data?.display_name === "Bố Test",
    JSON.stringify(boot.data)?.slice(0, 200)
  );
  check(
    "the parent is linked to the Google identity",
    boot.data?.auth_user_id === AUTH_ID,
    `auth_user_id=${boot.data?.auth_user_id}`
  );
  familyId = boot.data?.family_id ?? null;
  check("a family id was assigned", Boolean(familyId), String(familyId));

  // ---- 3. The identity can now use the app ----
  console.log("\n3. The new household is usable");
  const after = await rpc(token, "current_app_user_id");
  check(
    "current_app_user_id now resolves",
    after.status === 200 && after.data === boot.data?.id,
    `status=${after.status} data=${JSON.stringify(after.data)}`
  );

  const overview = await rpc(token, "parent_overview");
  check(
    "parent_overview works and reports the family name",
    overview.status === 200 && overview.data?.family?.family_name === "__ONBOARD_TEST__",
    `status=${overview.status} family=${overview.data?.family?.family_name}`
  );
  check(
    "the new family starts with no children",
    Array.isArray(overview.data?.children) && overview.data.children.length === 0,
    `children=${JSON.stringify(overview.data?.children)?.slice(0, 80)}`
  );

  // ---- 4. Calling it again must not fork the household ----
  console.log("\n4. Second call is idempotent");
  const again = await rpc(token, "bootstrap_parent", {
    p_display_name: "Bố Test",
    p_family_name: "Tên khác",
  });
  check(
    "a second call returns the same user",
    again.status === 200 && again.data?.id === boot.data?.id,
    `status=${again.status} id=${again.data?.id}`
  );

  // The check must be scoped to this run's family. Counting every family in the database
  // breaks as soon as a real household exists, which is exactly what happened once the
  // family for this deployment was created.
  const families = await db.query(
    `select count(*)::int as n
     from public.families
     where id = $1 or family_name = '__ONBOARD_TEST__'`,
    [familyId]
  );
  check(
    "the second call did not create another family",
    families.rows[0].n === 1,
    `matching families=${families.rows[0].n}`
  );

  // ---- 5. Onboarding can be completed with the child flow afterwards ----
  console.log("\n5. A child can then be created and sign in");
  const child = await rpc(token, "create_child", {
    p_display_name: "Bé Test",
    p_username: "onboardkid",
    p_pin: "2468",
  });
  check(
    "a child can be created in the new family",
    child.status === 200,
    `status=${child.status} :: ${JSON.stringify(child.data)?.slice(0, 160)}`
  );

  const login = await rpc(anon, "child_login_verify", {
    p_username: "onboardkid",
    p_pin: "2468",
  });
  check(
    "the child can sign in with that PIN",
    login.status === 200 && login.data?.display_name === "Bé Test",
    `status=${login.status} data=${JSON.stringify(login.data)?.slice(0, 120)}`
  );
} finally {
  if (familyId) {
    await db.query("delete from public.families where id = $1", [familyId]).catch(() => {});
  }
  await db.query("delete from public.families where family_name = '__ONBOARD_TEST__'").catch(() => {});
  // Remove only identities created by this run. Matching on the `@kidchore.local`
  // address instead would also delete identities belonging to real children, because
  // create_child generates exactly that address shape.
  const removed = await guard.removeCreated();
  await db.query("delete from auth.identities where user_id = $1", [AUTH_ID]).catch(() => {});
  await db.query("delete from auth.users where id = $1", [AUTH_ID]).catch(() => {});
  await db.end();
  console.log(`\nOnboarding fixtures removed (${removed} identity/identities).`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
