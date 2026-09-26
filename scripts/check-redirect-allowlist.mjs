/**
 * Checks which redirect targets Supabase currently accepts.
 *
 * This answers a question that matters before deploying: if `site_url` is unset and the
 * allow list is empty, will Supabase still accept a production domain, or will the
 * redirect to /auth/callback be refused? Better to find out now than after a deploy.
 *
 * Nothing is written and no login is completed; this only inspects the redirect that
 * Supabase would perform.
 *
 * Usage: node scripts/check-redirect-allowlist.mjs
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
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const candidates = [
  ["local dev", "http://localhost:3000/auth/callback"],
  ["localhost, other port", "http://localhost:4321/auth/callback"],
  ["vercel production", "https://kidchore.vercel.app/auth/callback"],
  ["vercel preview", "https://kidchore-git-main-dungle25.vercel.app/auth/callback"],
  ["random external host", "https://evil.example.com/auth/callback"],
  ["127.0.0.1", "http://127.0.0.1:3000/auth/callback"],
];

console.log("Which redirect targets does Supabase accept right now?\n");
console.log("  (a 302 to accounts.google.com means accepted; anything else means refused)\n");

for (const [label, target] of candidates) {
  const authorize =
    `${url}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(target)}`;

  const res = await fetch(authorize, {
    headers: { apikey: key },
    redirect: "manual",
  });

  const location = res.headers.get("location") ?? "";
  const accepted = res.status === 302 && /accounts\.google\.com/.test(location);

  // The redirect_to Supabase actually remembers is visible in the Google request state,
  // but the simplest reliable signal is whether it proceeded at all.
  console.log(`  ${accepted ? "ACCEPTED" : "REFUSED "}  ${label.padEnd(22)} ${target}`);
  if (!accepted) {
    console.log(`             status=${res.status} location=${location.slice(0, 100)}`);
  }
}

console.log(
  "\nNote: acceptance here does not prove the final redirect lands where you expect."
);
console.log(
  "It only shows that Supabase is willing to start the flow for that target."
);
