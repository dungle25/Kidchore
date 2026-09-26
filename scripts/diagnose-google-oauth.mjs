/**
 * Shows the exact parameters Supabase sends to Google, so the values configured in
 * Google Cloud Console can be compared character by character.
 *
 * A redirect_uri mismatch or a bad client secret in the Supabase provider settings
 * surfaces as "Unable to exchange external code" at token exchange time, which is a
 * confusing place to debug from. This makes the expected values explicit.
 *
 * Usage: node scripts/diagnose-google-oauth.mjs
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const authorizeUrl =
  `${supabaseUrl}/auth/v1/authorize?provider=google` +
  `&redirect_to=${encodeURIComponent("http://localhost:3000/auth/callback")}`;

const res = await fetch(authorizeUrl, {
  headers: { apikey: anon },
  redirect: "manual",
});

console.log(`authorize -> HTTP ${res.status}`);

const location = res.headers.get("location");
if (!location) {
  console.log("No redirect location. Supabase refused the request:");
  console.log((await res.text()).slice(0, 400));
  process.exit(1);
}

const google = new URL(location);
console.log("\n=== what Supabase asks Google for ===");
for (const [key, value] of google.searchParams.entries()) {
  const shown = key === "state" ? `${value.slice(0, 24)}...` : value;
  console.log(`  ${key.padEnd(20)} ${shown}`);
}

console.log("\n=== values that must match Google Cloud Console exactly ===");
console.log(`  client_id     ${google.searchParams.get("client_id")}`);
console.log(`  redirect_uri  ${google.searchParams.get("redirect_uri")}`);
console.log(`  scope         ${google.searchParams.get("scope")}`);

const redirectUri = google.searchParams.get("redirect_uri");
console.log("\n=== checklist for Google Cloud Console ===");
console.log(
  [
    "1. APIs & Services -> Credentials -> the OAuth 2.0 Client ID whose client_id is above.",
    `2. Authorized redirect URIs must contain EXACTLY: ${redirectUri}`,
    "   No trailing slash, no trailing space, https not http.",
    "3. The Client secret pasted into Supabase must belong to THAT SAME client id.",
    "   A secret from a different client is the most common cause of this error.",
    "4. Re-copy the secret and check for a leading/trailing space.",
    "5. OAuth consent screen -> if Publishing status is 'Testing',",
    "   add your Google account under Test users.",
  ].join("\n")
);

console.log("\n=== where to look in Supabase ===");
console.log(
  "  Dashboard -> Authentication -> Logs, filter by error. The Auth log line for this");
console.log(
  "  attempt usually names the underlying Google error (e.g. invalid_client or");
console.log("  redirect_uri_mismatch), which pins down which of the items above is wrong.");
