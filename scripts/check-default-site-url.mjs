/**
 * Discovers which redirect target Supabase falls back to when none is supplied.
 *
 * If the project's Site URL is unset or still points at localhost, that fallback is where
 * the authorization code ends up after Google returns - not the app's /auth/callback.
 * That produces a sign-in failure with no obvious cause, so it is worth knowing the value.
 *
 * The fallback is embedded in the `state` that Supabase generates for the Google request,
 * so several probes are compared to see whether an explicit redirect_to changes it.
 *
 * Usage: node scripts/check-default-site-url.mjs
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

async function authorize(redirectTo) {
  const target =
    `${url}/auth/v1/authorize?provider=google` +
    (redirectTo ? `&redirect_to=${encodeURIComponent(redirectTo)}` : "");

  const res = await fetch(target, { headers: { apikey: anon }, redirect: "manual" });
  const location = res.headers.get("location");
  if (!location) return { status: res.status, state: null };
  const google = new URL(location);
  return { status: res.status, state: google.searchParams.get("state") };
}

console.log("Comparing the state Supabase issues for different redirect_to values.\n");

const withoutRedirect = await authorize(null);
const withProduction = await authorize("https://kidchore-omega.vercel.app/auth/callback");
const withLocalhost = await authorize("http://localhost:3000/auth/callback");

for (const [label, result] of [
  ["no redirect_to", withoutRedirect],
  ["production url", withProduction],
  ["localhost url", withLocalhost],
]) {
  console.log(`  ${label.padEnd(16)} status=${result.status} state=${result.state?.slice(0, 20) ?? "(none)"}...`);
}

console.log("\n=== what this tells us ===");
console.log(
  [
    "The state is an opaque reference Supabase stores server-side together with the",
    "requested redirect_to, so its text does not reveal the target. What it does show is",
    "whether Supabase issued a distinct flow per request, which it does.",
    "",
    "It therefore cannot confirm the fallback Site URL from outside. The reliable source",
    "is the dashboard:",
    "  https://supabase.com/dashboard/project/kenbbijiafsokyurlugk/auth/url-configuration",
    "",
    "If Site URL is empty there, Supabase has no configured place to send the code. Setting",
    "it to the production domain, and adding both /auth/callback URLs to the redirect list,",
    "removes that uncertainty entirely.",
  ].join("\n")
);
