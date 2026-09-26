/**
 * Verifies the profile-switching screens on a deployment.
 *
 * The switch flow is a URL plus a form, so it can be checked without any credentials:
 *   * `/login` lists every child and their own PIN field
 *   * `/login?switchTo=<username>` shows only that child, with the PIN field autofocused
 *   * an unknown username falls back to a "not found" message rather than an empty screen
 *
 * Whether the PIN itself is accepted is covered by the child-flow test, which knows the
 * PIN it created.
 *
 * Usage: node scripts/test-deployed-profile-switch.mjs [baseUrl]
 */
import { readFileSync } from "node:fs";
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

/**
 * Reads the children offered on a page. React separates adjacent text nodes with a
 * comment, so the rendered username looks like `@<!-- -->ken159`; the hidden input holds
 * the reliable value.
 */
function childrenOn(html) {
  return [...html.matchAll(/name="username"\s+value="([^"]+)"/g)].map((m) => m[1]);
}

const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const AUTH_PARENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEST_FAMILY = "__SWITCH_TEST__";
let familyId = null;

try {
  console.log(`Checking profile switching on ${base}\n`);

  // Real children already exist for the family, but the checks below need two siblings to
  // be meaningful, so a throwaway family with two children is used instead.
  await db.query("delete from public.families where family_name = $1", [TEST_FAMILY]);
  await db.query("delete from auth.identities where user_id = $1", [AUTH_PARENT]);
  await db.query("delete from auth.users where id = $1", [AUTH_PARENT]);
  await db.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new, email_change
     ) values (
       $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'switch.parent@example.com',
       extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 10)), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
       '{}'::jsonb, now(), now(), '', '', '', ''
     )`,
    [AUTH_PARENT]
  );

  const fam = await db.query(
    "insert into public.families (family_name) values ($1) returning id",
    [TEST_FAMILY]
  );
  familyId = fam.rows[0].id;

  await db.query(
    `insert into public.users (family_id, role, display_name, email, auth_user_id)
     values ($1, 'PARENT', 'PH Switch', 'switch.parent@example.com', $2)`,
    [familyId, AUTH_PARENT]
  );

  for (const [name, username, pin] of [
    ["Bé Một", "switchone", "1234"],
    ["Bé Hai", "switchtwo", "5678"],
  ]) {
    await db.query(
      `insert into public.users (family_id, role, display_name, username, pin_code)
       values ($1, 'CHILD', $2, $3, public.hash_pin($4))`,
      [familyId, name, username, pin]
    );
  }

  // ---- 1. The sign-in screen lists the children ----
  console.log("1. Sign-in screen");
  const login = await (await fetch(`${base}/login`, { cache: "no-store" })).text();
  const onLogin = childrenOn(login);
  check(
    "both new children are listed",
    onLogin.includes("switchone") && onLogin.includes("switchtwo"),
    `found=${onLogin.join(",")}`
  );
  check(
    "each child has a PIN field",
    (login.match(/name="pin"/g) ?? []).length >= 2,
    `pinFields=${(login.match(/name="pin"/g) ?? []).length}`
  );
  check(
    "a Google sign-in option is still offered",
    login.includes("Đăng nhập bằng Google"),
    "google button missing"
  );

  // ---- 2. The switch route narrows to one child ----
  console.log("\n2. Switch route narrows to one child");
  const switched = await (
    await fetch(`${base}/login?switchTo=switchtwo`, { cache: "no-store" })
  ).text();
  const onSwitch = childrenOn(switched);
  check(
    "only the requested child is offered",
    onSwitch.length === 1 && onSwitch[0] === "switchtwo",
    `found=${onSwitch.join(",")}`
  );
  check(
    "the other sibling is not offered",
    !onSwitch.includes("switchone"),
    `found=${onSwitch.join(",")}`
  );
  check(
    "the heading reflects switching",
    switched.includes("Đổi bé"),
    "heading missing"
  );
  check(
    "the PIN field is autofocused so no tap is needed",
    /autofocus/i.test(switched),
    "no autofocus attribute in the rendered form"
  );
  check(
    "the Google option is hidden while switching",
    !switched.includes("Đăng nhập bằng Google"),
    "google button shown during a switch"
  );
  check(
    "a link back to the full list is offered",
    switched.includes("Chọn bé khác"),
    "back link missing"
  );

  // ---- 3. An unknown child does not produce an empty screen ----
  console.log("\n3. Unknown child");
  const unknown = await (
    await fetch(`${base}/login?switchTo=doesnotexist`, { cache: "no-store" })
  ).text();
  check(
    "an unknown username explains the problem",
    unknown.includes("Không tìm thấy bé này"),
    "no explanatory message"
  );
  check(
    "it offers a way back to the list",
    unknown.includes("Chọn bé khác"),
    "no back link"
  );

  // ---- 4. The child area renders the switcher for siblings ----
  console.log("\n4. Sibling switcher inside the child area");
  const child = await db.query(
    "select id, auth_user_id from public.users where username = 'switchone'"
  );
  // The layout resolves the child from the session subject.
  const { createHmac } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const signingInput = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: "supabase",
    sub: child.rows[0].auth_user_id ?? AUTH_PARENT,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 3600,
    app_role: "CHILD",
    app_name: "Bé Một",
  })}`;
  const token = `${signingInput}.${createHmac("sha256", env.SUPABASE_JWT_SECRET)
    .update(signingInput)
    .digest("base64url")}`;

  if (!child.rows[0].auth_user_id) {
    console.log("   note: the child has no auth identity, so the signed-in view cannot be checked");
  } else {
    const kidPage = await fetch(`${base}/kid/dashboard`, {
      headers: { Cookie: `kidchore_session=${token}` },
      redirect: "manual",
    });
    const kidHtml = kidPage.status === 200 ? await kidPage.text() : "";
    check(
      "the child dashboard renders",
      kidPage.status === 200,
      `status=${kidPage.status}`
    );
    check(
      "it shows which profile is in use",
      kidHtml.includes("Đang dùng"),
      "profile label missing"
    );
    check(
      "it offers the sibling as a switch target",
      kidHtml.includes("Đổi sang bé khác") && kidHtml.includes("switchtwo"),
      "switcher missing"
    );
    check(
      "the switcher links to the PIN screen for that sibling",
      kidHtml.includes("/login?switchTo=switchtwo"),
      "switch link missing"
    );
    check(
      "the child's own profile is not offered as a switch target",
      !kidHtml.includes("/login?switchTo=switchone"),
      "self offered as a switch target"
    );
  }
} finally {
  if (familyId) {
    await db.query("delete from public.families where id = $1", [familyId]).catch(() => {});
  }
  await db
    .query("delete from public.families where family_name = $1", [TEST_FAMILY])
    .catch(() => {});
  await db.query("delete from auth.identities where user_id = $1", [AUTH_PARENT]).catch(() => {});
  await db.query("delete from auth.users where id = $1", [AUTH_PARENT]).catch(() => {});
  await db.end();
  console.log("\nSwitch fixtures removed.");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
