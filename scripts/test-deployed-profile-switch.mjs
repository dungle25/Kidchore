/**
 * Verifies the profile-switching screens on a deployment.
 *
 * The switch flow is a URL plus a form:
 *   * `/login` lists every child and their own PIN field
 *   * `/login?switchTo=<username>` shows only that child, with the PIN field autofocused
 *   * an unknown username falls back to a "not found" message rather than an empty screen
 *   * **and all of that has to keep working while already signed in**, because that is
 *     the only situation in which anybody actually switches: a child is signed in, taps
 *     a sibling's avatar, and lands here. This section was missing, and a proxy rule
 *     that redirected signed-in visitors away from `/login` made the whole feature a
 *     button that did nothing for as long as it took a person to notice by hand.
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
const AUTH_CHILD_ONE = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const AUTH_CHILD_TWO = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const TEST_FAMILY = "__SWITCH_TEST__";
let familyId = null;

/**
 * `public.users.auth_user_id` has a real foreign key to `auth.users`, so a child who is
 * meant to be signable-in needs a row there. Without one the signed-in half of this
 * suite silently skipped itself, which is exactly how the bug below survived.
 */
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
}

/** A session cookie for a child fixture, signed the way the app signs them. */
async function childCookie(authUserId, name) {
  const { createHmac } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const signingInput = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: "supabase",
    sub: authUserId,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 3600,
    app_role: "CHILD",
    app_name: name,
  })}`;
  const signature = createHmac("sha256", env.SUPABASE_JWT_SECRET)
    .update(signingInput)
    .digest("base64url");
  return `kidchore_session=${signingInput}.${signature}`;
}

/** Fetches without following redirects, so a bounce to the dashboard is observable. */
async function get(path, cookie) {
  const res = await fetch(`${base}${path}`, {
    redirect: "manual",
    cache: "no-store",
    headers: cookie ? { Cookie: cookie } : {},
  });
  const html = res.status === 200 ? await res.text() : "";
  return {
    status: res.status,
    location: res.headers.get("location"),
    // Reading the switch screen must never mint a session; the PIN exchange is the only
    // thing that may set this cookie.
    setCookie: res.headers.get("set-cookie"),
    html,
  };
}

function unescapeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * The fields Next.js embeds in a Server Action form for progressive enhancement.
 *
 * Their names are `$ACTION_...`, and they carry the action id. Replaying them is what
 * makes it possible to test a form the way a browser submits it, instead of testing the
 * database function underneath and hoping the wiring in between is fine. One switch bug
 * already slipped through because only the page around the form was checked.
 */
function actionFields(html) {
  const fields = new Map();
  for (const match of html.matchAll(
    /<input type="hidden" name="(\$ACTION[^"]*)"(?: value="([^"]*)")?\/?>/g
  )) {
    fields.set(match[1], unescapeHtml(match[2] ?? ""));
  }
  return fields;
}

/** Reads the claim out of an app session cookie, so the identity can be checked. */
function sessionClaims(setCookie) {
  const value = /kidchore_session=([^;]+)/.exec(String(setCookie ?? ""))?.[1];
  if (!value) return null;
  const part = value.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

try {
  console.log(`Checking profile switching on ${base}\n`);

  // Real children already exist for the family, but the checks below need two siblings to
  // be meaningful, so a throwaway family with two children is used instead.
  await db.query("delete from public.families where family_name = $1", [TEST_FAMILY]);
  await createAuthUser(AUTH_PARENT, "switch.parent@example.com");
  await createAuthUser(AUTH_CHILD_ONE, "switch.one@example.com");
  await createAuthUser(AUTH_CHILD_TWO, "switch.two@example.com");

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

  for (const [name, username, pin, authId] of [
    ["Bé Một", "switchone", "1234", AUTH_CHILD_ONE],
    ["Bé Hai", "switchtwo", "5678", AUTH_CHILD_TWO],
  ]) {
    await db.query(
      `insert into public.users (family_id, role, display_name, username, pin_code, auth_user_id)
       values ($1, 'CHILD', $2, $3, public.hash_pin($4), $5)`,
      [familyId, name, username, pin, authId]
    );
  }

  // ---- 1. The sign-in screen lists the children ----
  console.log("1. Sign-in screen, signed out");
  const loginRes = await get("/login");
  const login = loginRes.html;
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
  console.log("\n2. Switch route narrows to one child, signed out");
  const switchedRes = await get("/login?switchTo=switchtwo");
  const switched = switchedRes.html;
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
  const unknown = (await get("/login?switchTo=doesnotexist")).html;
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
  const oneCookie = await childCookie(AUTH_CHILD_ONE, "Bé Một");

  const kidPage = await get("/kid/dashboard", oneCookie);
  check("the child dashboard renders", kidPage.status === 200, `status=${kidPage.status}`);
  check(
    "it shows which profile is in use",
    kidPage.html.includes("Đang dùng"),
    "profile label missing"
  );
  check(
    "it offers the sibling as a switch target",
    kidPage.html.includes("Đổi sang bé khác") && kidPage.html.includes("switchtwo"),
    "switcher missing"
  );
  check(
    "the switcher links to the PIN screen for that sibling",
    kidPage.html.includes("/login?switchTo=switchtwo"),
    "switch link missing"
  );
  check(
    "the child's own profile is not offered as a switch target",
    !kidPage.html.includes("/login?switchTo=switchone"),
    "self offered as a switch target"
  );

  // ---- 5. Switching while already signed in ----
  // This is the case a real person is in. It was untested, and the flow was broken.
  console.log("\n5. Switching while already signed in");

  const signedInSwitch = await get("/login?switchTo=switchtwo", oneCookie);
  check(
    "a signed-in child reaches the switch screen instead of being bounced away",
    signedInSwitch.status === 200,
    `status=${signedInSwitch.status} location=${signedInSwitch.location ?? "-"}`
  );
  check(
    "and that screen is the sibling's PIN pad",
    childrenOn(signedInSwitch.html).join(",") === "switchtwo",
    `found=${childrenOn(signedInSwitch.html).join(",")}`
  );
  check(
    "the switch screen never hands out a session on its own",
    !signedInSwitch.setCookie,
    `set-cookie=${signedInSwitch.setCookie ?? "-"}`
  );

  const signedInNav = await get("/login", oneCookie);
  check(
    'the "Đổi bé" button in the child area also reaches the picker',
    signedInNav.status === 200 && childrenOn(signedInNav.html).length >= 2,
    `status=${signedInNav.status} found=${childrenOn(signedInNav.html).join(",")}`
  );
  check(
    "and it does not offer a child the parent's Google sign-in",
    !signedInNav.html.includes("Đăng nhập bằng Google"),
    "google button shown to a signed-in child"
  );

  const parentCookie = await childCookie(AUTH_PARENT, "PH Switch");
  const parentOnLogin = await get("/login", parentCookie);
  check(
    "a signed-in parent can still open the sign-in screen",
    parentOnLogin.status === 200,
    `status=${parentOnLogin.status} location=${parentOnLogin.location ?? "-"}`
  );

  // ---- 6. The switch itself, submitted the way a browser submits it ----
  // Everything above checks the page around the form. This submits it, because "the
  // screen opens" and "the profile actually changes" are different claims, and only the
  // second one is the feature.
  console.log("\n6. Submitting the sibling's PIN actually switches");

  async function submitPin(html, username, pin, cookie) {
    const body = new FormData();
    for (const [name, value] of actionFields(html)) body.append(name, value);
    body.append("username", username);
    body.append("pin", pin);

    const res = await fetch(`${base}/login?switchTo=${username}`, {
      method: "POST",
      body,
      redirect: "manual",
      headers: { Cookie: cookie },
    });
    return { status: res.status, setCookie: res.headers.get("set-cookie") };
  }

  const switchPage = await get("/login?switchTo=switchtwo", oneCookie);
  check(
    "the form carries a Server Action the browser can submit",
    actionFields(switchPage.html).size > 0,
    "no $ACTION fields rendered"
  );

  const wrongPin = await submitPin(switchPage.html, "switchtwo", "0000", oneCookie);
  check(
    "a wrong PIN does not switch the profile",
    !sessionClaims(wrongPin.setCookie),
    `claim=${JSON.stringify(sessionClaims(wrongPin.setCookie))}`
  );

  const rightPin = await submitPin(switchPage.html, "switchtwo", "5678", oneCookie);
  const switchedClaims = sessionClaims(rightPin.setCookie);
  check(
    "the sibling's PIN issues a session for the sibling",
    switchedClaims?.sub === AUTH_CHILD_TWO,
    `sub=${switchedClaims?.sub ?? "-"} expected=${AUTH_CHILD_TWO}`
  );
  check(
    "and the new session names the sibling",
    switchedClaims?.app_name === "Bé Hai",
    `app_name=${switchedClaims?.app_name ?? "-"}`
  );
  check(
    "and it is a child session, not an escalation",
    switchedClaims?.app_role === "CHILD",
    `app_role=${switchedClaims?.app_role ?? "-"}`
  );

  const asSibling = await get("/kid/dashboard", `kidchore_session=${
    /kidchore_session=([^;]+)/.exec(String(rightPin.setCookie))[1]
  }`);
  check(
    "the switched session opens the sibling's own dashboard",
    asSibling.status === 200 && asSibling.html.includes("Bé Hai"),
    `status=${asSibling.status}`
  );
} finally {
  if (familyId) {
    await db.query("delete from public.families where id = $1", [familyId]).catch(() => {});
  }
  await db
    .query("delete from public.families where family_name = $1", [TEST_FAMILY])
    .catch(() => {});
  for (const id of [AUTH_PARENT, AUTH_CHILD_ONE, AUTH_CHILD_TWO]) {
    await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
    await db.query("delete from auth.users where id = $1", [id]).catch(() => {});
  }
  await db.end();
  console.log("\nSwitch fixtures removed.");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
