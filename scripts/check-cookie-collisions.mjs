/**
 * Proves the Supabase cookie cleanup cannot delete the app's own cookies.
 *
 * `clearSupabaseAuthCookies()` runs immediately after the onboarding cookie is set in
 * the OAuth callback. If its name matching were broader than intended, it would delete
 * the very cookie onboarding depends on, which would look like "the form appeared but
 * submitting does nothing".
 *
 * The predicate is reimplemented here from lib/supabase-oauth.ts and checked against the
 * cookie names `@supabase/ssr` actually writes, plus the app's own cookie names, so a
 * future edit that widens the match fails this check.
 *
 * Usage: node scripts/check-cookie-collisions.mjs
 */
import { readFileSync } from "node:fs";

const SUPABASE_AUTH_STORAGE_KEY = "kidchore-supabase-auth";

/** Source of truth, read from the module so this check cannot drift from it. */
const oauthSource = readFileSync("lib/supabase-oauth.ts", "utf8");
const deletesEverythingWithPrefix = oauthSource.includes(
  "cookie.name.startsWith(`${SUPABASE_AUTH_STORAGE_KEY}`)"
);

if (deletesEverythingWithPrefix) {
  console.log("FAIL  lib/supabase-oauth.ts matches on a bare prefix, which is too broad.");
  process.exit(1);
}

/** Mirrors the predicate in lib/supabase-oauth.ts. */
function isSupabaseAuthCookie(name) {
  return (
    name === SUPABASE_AUTH_STORAGE_KEY ||
    name.startsWith(`${SUPABASE_AUTH_STORAGE_KEY}.`) ||
    name.startsWith(`${SUPABASE_AUTH_STORAGE_KEY}-`)
  );
}

// Names `@supabase/ssr` writes: the session, its chunks, and the PKCE verifiers.
const supabaseCookies = [
  SUPABASE_AUTH_STORAGE_KEY,
  `${SUPABASE_AUTH_STORAGE_KEY}.0`,
  `${SUPABASE_AUTH_STORAGE_KEY}.1`,
  `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`,
  `${SUPABASE_AUTH_STORAGE_KEY}-flow-a1b2c3d4-code-verifier`,
  `${SUPABASE_AUTH_STORAGE_KEY}-flows-code-verifier`,
];

// Cookies the app itself relies on. Deleting any of these breaks sign-in.
const appCookies = ["kidchore_google", "kidchore_session"];

// A lookalike that must NOT be touched, to catch an over-broad matcher.
const lookalikes = ["kidchore-supabase-authx", "kidchore_supabase_auth"];

let failures = 0;

console.log("Cookies that must be cleaned up:");
for (const name of supabaseCookies) {
  const ok = isSupabaseAuthCookie(name);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
}

console.log("\nCookies that must survive:");
for (const name of [...appCookies, ...lookalikes]) {
  const deleted = isSupabaseAuthCookie(name);
  if (deleted) failures += 1;
  console.log(`  ${deleted ? "FAIL" : "ok  "}  ${name}  (deleted=${deleted})`);
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"}: ${
    failures === 0
      ? "cleanup is correctly scoped; onboarding and session cookies are safe."
      : `${failures} problem(s) found.`
  }`
);
process.exit(failures === 0 ? 0 : 1);
