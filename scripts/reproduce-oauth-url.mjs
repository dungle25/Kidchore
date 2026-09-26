/**
 * Reproduces the malformed OAuth URL that the browser client produced.
 *
 * The browser was sent to
 *   https://<ref>.supabase.co/rest/v1/auth/v1/authorize?...
 * which is wrong: the path should be /auth/v1/authorize. `/rest/v1` is the PostgREST
 * prefix and must never appear in an Auth URL.
 *
 * This builds the client the same way the app does and prints the URL that
 * signInWithOAuth would navigate to, so the fault can be located without a browser.
 *
 * Usage: node scripts/reproduce-oauth-url.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient, createServerClient } from "@supabase/ssr";

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
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const STORAGE_KEY = "kidchore-supabase-auth";

console.log(`supabase url: ${url}`);
console.log(`key prefix  : ${key.slice(0, 18)}...\n`);

/**
 * djb2 over the string - the same non-cryptographic hash newer auth-js versions use to
 * shorten a storage key suffix.
 */
function hashString(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** Mirrors the storage-key derivation inside the auth client. */
function deriveStorageKey() {
  const ref = new URL(url).hostname.split(".")[0];
  return `sb-${ref}-auth-token:${hashString(`${url}|${key}`)}`;
}

console.log("=== expected locations ===");
console.log(`  authorize endpoint should be: ${url}/auth/v1/authorize`);
console.log(`  storage key should be       : ${deriveStorageKey()}\n`);

// ---- 1. Plain createClient ----
console.log("=== createClient (supabase-js) ===");
try {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: "https://kidchore-omega.vercel.app/auth/callback", skipBrowserRedirect: true },
  });
  console.log(`  error: ${error ? error.message : "none"}`);
  console.log(`  url  : ${data?.url ?? "(none)"}`);
  report("createClient", data?.url);
} catch (error) {
  console.log(`  threw: ${error.message}`);
}

// ---- 2. createBrowserClient (@supabase/ssr), as the app uses ----
console.log("\n=== createBrowserClient (@supabase/ssr) ===");
try {
  const client = createBrowserClient(url, key, {
    cookieOptions: { name: STORAGE_KEY },
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType: "pkce" },
  });
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: "https://kidchore-omega.vercel.app/auth/callback", skipBrowserRedirect: true },
  });
  console.log(`  error: ${error ? error.message : "none"}`);
  console.log(`  url  : ${data?.url ?? "(none)"}`);
  report("createBrowserClient", data?.url);
} catch (error) {
  console.log(`  threw: ${error.message}`);
}

// ---- 3. createServerClient (@supabase/ssr) ----
console.log("\n=== createServerClient (@supabase/ssr) ===");
try {
  const client = createServerClient(url, key, {
    cookieOptions: { name: STORAGE_KEY },
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType: "pkce" },
  });
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: "https://kidchore-omega.vercel.app/auth/callback", skipBrowserRedirect: true },
  });
  console.log(`  error: ${error ? error.message : "none"}`);
  console.log(`  url  : ${data?.url ?? "(none)"}`);
  report("createServerClient", data?.url);
} catch (error) {
  console.log(`  threw: ${error.message}`);
}

function report(label, oauthUrl) {
  if (!oauthUrl) return;
  const bad = oauthUrl.includes("/rest/v1/");
  console.log(`  => ${bad ? "MALFORMED: contains /rest/v1/" : "path looks correct"}`);
  if (bad) {
    console.log(`     ${label} produced a URL with the PostgREST prefix in an Auth path.`);
  }
}
