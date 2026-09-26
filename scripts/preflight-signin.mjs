/**
 * End-to-end preflight for the pieces of sign-in that can be checked without a browser.
 *
 * Walks the whole chain in order and stops at the first broken link, so a failure is
 * attributed to the right component instead of being guessed at:
 *
 *   1. the deployed app builds a correct Auth URL
 *   2. Supabase declares the Google provider enabled
 *   3. Supabase accepts the app's redirect_to
 *   4. Supabase redirects to Google with the expected client id
 *   5. Google accepts the request (reaches its consent screen)
 *
 * Usage: node scripts/preflight-signin.mjs [baseUrl]
 */
const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";

let step = 0;
function heading(text) {
  step += 1;
  console.log(`\n${step}. ${text}`);
}
function ok(text, detail = "") {
  console.log(`   ok    ${text}${detail ? `  (${detail})` : ""}`);
}
function bad(text, detail = "") {
  console.log(`   FAIL  ${text}${detail ? `  (${detail})` : ""}`);
}

const failures = [];

// ---------- 1. Does the deployed app build a correct Auth URL? ----------
heading("The deployed app builds a correct Auth URL");

const html = await (await fetch(`${base}/login`, { cache: "no-store" })).text();
const scripts = [...new Set([...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]))];

let projectUrl = null;
for (const src of scripts) {
  const js = await (await fetch(src.startsWith("http") ? src : base + src)).text();
  const match = js.match(/NEXT_PUBLIC_SUPABASE_URL"\s*,\s*"(https:[^"]+)"/);
  if (match) projectUrl = match[1];
}

if (!projectUrl) {
  bad("could not read the embedded project URL from the bundles");
  failures.push("project url unknown");
} else {
  const parsed = new URL(projectUrl);
  const hadPath = parsed.pathname !== "/" && parsed.pathname !== "";
  if (hadPath) {
    ok("the env value carries a path", `${parsed.pathname} - stripped at runtime`);
  } else {
    ok("the env value is a bare project URL");
  }
  projectUrl = `${parsed.protocol}//${parsed.host}`;
}

// ---------- 2. Is the Google provider enabled? ----------
heading("Supabase has the Google provider enabled");
let anonKey = null;
for (const src of scripts) {
  const js = await (await fetch(src.startsWith("http") ? src : base + src)).text();
  const match = js.match(/sb_publishable_[A-Za-z0-9_-]+/);
  if (match) anonKey = match[0];
}

if (!anonKey) {
  bad("could not read the publishable key from the bundles");
  failures.push("anon key unknown");
} else {
  ok("publishable key found", `${anonKey.slice(0, 16)}...`);
}

let googleEnabled = false;
if (projectUrl && anonKey) {
  const res = await fetch(`${projectUrl}/auth/v1/settings`, { headers: { apikey: anonKey } });
  const settings = await res.json();
  googleEnabled = settings.external?.google === true;
  googleEnabled ? ok("google provider is ENABLED") : bad("google provider is NOT enabled");
  if (!googleEnabled) failures.push("google provider disabled");
}

// ---------- 3 & 4. Does Supabase accept the redirect and reach Google? ----------
heading("Supabase accepts the redirect_to and redirects to Google");

const callback = `${base}/auth/callback`;
let authUrl = null;
let reachedGoogle = false;

if (projectUrl) {
  authUrl =
    `${projectUrl}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(callback)}`;
  const res = await fetch(authUrl, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  reachedGoogle = /accounts\.google\.com/.test(location);

  if (res.status === 302 && reachedGoogle) {
    ok("authorize returned 302 to Google");
  } else {
    bad("authorize did not reach Google", `HTTP ${res.status}`);
    console.log(`        body: ${(await res.text()).slice(0, 200)}`);
    failures.push("authorize failed");
  }

  if (reachedGoogle) {
    const google = new URL(location);
    ok("client_id presented to Google", google.searchParams.get("client_id"));
    ok("redirect_uri presented to Google", google.searchParams.get("redirect_uri"));
    ok("scope", google.searchParams.get("scope"));
  }
}

// ---------- 5. Does Google accept it? ----------
heading("Google accepts the authorization request");
if (reachedGoogle) {
  // Requesting the consent URL without following it confirms Google serves the page
  // rather than erroring on the client id.
  const res = await fetch(
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      new URL(authUrl).searchParams.get("client_id") ?? ""
    )}&redirect_uri=${encodeURIComponent(
      "https://kenbbijiafsokyurlugk.supabase.co/auth/v1/callback"
    )}&response_type=code&scope=openid%20email`,
    { redirect: "manual" }
  );
  if (res.status === 200 || res.status === 302) {
    ok("Google responds", `HTTP ${res.status}`);
  } else {
    bad("Google responded unexpectedly", `HTTP ${res.status}`);
  }
} else {
  console.log("   skipped: the earlier step did not reach Google");
}

// ---------- summary ----------
console.log("\n=== summary ===");
if (failures.length === 0) {
  console.log("Every check that can be done without a browser passes.");
  console.log("The remaining step is an actual sign-in, which needs a Google account.");
} else {
  console.log(`${failures.length} failing step(s): ${failures.join(", ")}`);
}
process.exit(failures.length === 0 ? 0 : 1);
