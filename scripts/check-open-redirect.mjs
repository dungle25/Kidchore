/**
 * Determines whether Supabase actually honours an arbitrary `redirect_to`.
 *
 * `check-redirect-allowlist.mjs` shows the authorize endpoint starts the flow for any
 * target, including a host we do not own. That alone is not proof of a vulnerability:
 * what matters is where the flow ends up. If Supabase only redirects to
 * `<site_url>/?code=...` and ignores `redirect_to`, there is no open redirect.
 *
 * This does not complete a Google login. It inspects the authorize request and the
 * redirect that Supabase would perform, and reports what it can determine.
 *
 * Usage: node scripts/check-open-redirect.mjs
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

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const attackerTarget = "https://attacker.example.net/steal";

// Step 1: ask Supabase to start a flow that should end on a host we do not own.
const authorize =
  `${url}/auth/v1/authorize?provider=google` +
  `&redirect_to=${encodeURIComponent(attackerTarget)}`;

const res = await fetch(authorize, {
  headers: { apikey: anon },
  redirect: "manual",
});

console.log(`authorize -> HTTP ${res.status}`);

const location = res.headers.get("location");
if (!location) {
  console.log("No redirect. Body:");
  console.log((await res.text()).slice(0, 300));
  process.exit(0);
}

const google = new URL(location);
console.log(`  redirected to      : ${google.host}`);
console.log(`  client_id          : ${google.searchParams.get("client_id")}`);
console.log(`  redirect_uri       : ${google.searchParams.get("redirect_uri")}`);

// The `state` parameter is what carries the caller's redirect_to through the flow.
// It is an opaque reference on Supabase's side, so its contents are not readable here.
const state = google.searchParams.get("state");
console.log(`  state              : ${state ? `${state.slice(0, 18)}... (opaque)` : "(none)"}`);

console.log("\n=== what this shows ===");
console.log(
  [
    `Supabase started a flow whose redirect_to was ${attackerTarget}.`,
    "That means the authorize endpoint does not reject foreign hosts.",
    "",
    "Whether that is exploitable depends on where Supabase sends the code AFTER Google",
    "returns. That final step needs a real Google login and cannot be checked from here.",
    "",
    "Either way the fix is the same and is worth doing regardless:",
    "  Authentication -> URL Configuration",
    "    Site URL      -> your real domain",
    "    Redirect URLs -> only your own /auth/callback endpoints",
    "With those set, Supabase refuses redirect_to values that are not on the list.",
  ].join("\n")
);

// Confirm the settings that decide the final hop.
const settings = await (
  await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } })
).json();

console.log("\n=== current URL configuration ===");
console.log(`  site_url       : ${settings.site_url ?? "(not set)"}`);
console.log(`  uri_allow_list : ${JSON.stringify(settings.uri_allow_list ?? null)}`);

if (!settings.site_url && !settings.uri_allow_list) {
  console.log(
    "\n  Both are empty. Until they are set, every redirect_to is accepted, so the app"
  );
  console.log(
    "  is relying on nothing but the randomness of the code to protect the callback."
  );
}
