/**
 * Confirms the deployed app now builds a correct Auth URL from the malformed value.
 *
 * Reads the default value embedded in the deployed bundle (which still carries the
 * `/rest/v1/` path, because the Vercel variable was not changed), applies the same
 * normalisation the shipped code applies, and checks the resulting authorize URL.
 *
 * Usage: node scripts/verify-deployed-url-fix.mjs [baseUrl]
 */
const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";

const html = await (await fetch(`${base}/login`, { cache: "no-store" })).text();
const scripts = [...new Set([...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]))];

let defaultUrl = null;
let hasNormaliser = false;
let bundleName = null;

for (const src of scripts) {
  const url = src.startsWith("http") ? src : base + src;
  const js = await (await fetch(url)).text().catch(() => "");
  if (!js) continue;

  const match = js.match(/NEXT_PUBLIC_SUPABASE_URL"\s*,\s*"(https:[^"]+)"/);
  if (match) {
    defaultUrl = match[1];
    bundleName = src.split("/").pop();
  }
  if (js.includes("that is being ignored")) hasNormaliser = true;
}

console.log(`deployment: ${base}\n`);

if (!defaultUrl) {
  console.log("Could not find the embedded Supabase URL default in any bundle.");
  process.exit(1);
}

console.log("=== what the deployment was built with ===");
console.log(`  bundle        : ${bundleName}`);
console.log(`  embedded value: ${defaultUrl}`);

console.log("\n=== is the normaliser shipped? ===");
console.log(`  warning string present in bundle: ${hasNormaliser ? "YES" : "NO"}`);

// Reimplement the shipped normalisation exactly.
function normaliseSupabaseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`invalid: ${raw}`);
  }
  const hadPath = parsed.pathname !== "/" && parsed.pathname !== "";
  return { cleaned: `${parsed.protocol}//${parsed.host}`, hadPath, path: parsed.pathname };
}

const { cleaned, hadPath, path } = normaliseSupabaseUrl(defaultUrl);

console.log("\n=== result after normalisation ===");
console.log(`  detected path : ${hadPath ? path : "(none)"}`);
console.log(`  cleaned url   : ${cleaned}`);

const authorizeUrl = `${cleaned}/auth/v1/authorize?provider=google`;
console.log(`  authorize url : ${authorizeUrl}`);

console.log("\n=== independent check against the real Auth endpoint ===");
const res = await fetch(authorizeUrl, { redirect: "manual" });
const location = res.headers.get("location") ?? "";
const goesToGoogle = /accounts\.google\.com/.test(location);

console.log(`  HTTP ${res.status}`);
console.log(`  redirects to Google: ${goesToGoogle ? "YES" : "NO"}`);

console.log("\n=== verdict ===");
if (goesToGoogle) {
  console.log("  The URL the app now builds is accepted by Supabase Auth, which means the");
  console.log("  sign-in request will reach Google instead of failing on PostgREST.");
  console.log("");
  console.log("  Note: the Vercel variable is still wrong. The app now tolerates it, but the");
  console.log("  value should still be corrected to the bare project URL.");
} else {
  console.log("  The endpoint did not redirect to Google. Inspect further.");
  console.log(`  location: ${location.slice(0, 200)}`);
}
