/**
 * Tries to read the project's redirect URL configuration through the Management API.
 *
 * `/auth/v1/settings` was proven not to expose these values, so this probes the
 * Management API instead, which is the API the dashboard itself uses. It needs a
 * personal access token rather than a project key, so it is expected to fail with the
 * keys available here; the point is to establish definitively whether the configuration
 * can be verified from outside at all.
 *
 * Usage: node scripts/probe-management-api.mjs
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

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

console.log(`project ref: ${ref}\n`);

const candidates = [
  {
    label: "Management API: auth config",
    url: `https://api.supabase.com/v1/projects/${ref}/config/auth`,
    token: process.env.SUPABASE_ACCESS_TOKEN,
  },
  {
    label: "Management API with service key (expected to fail)",
    url: `https://api.supabase.com/v1/projects/${ref}/config/auth`,
    token: env.SUPABASE_SERVICE_ROLE_KEY,
  },
];

for (const { label, url, token } of candidates) {
  if (!token) {
    console.log(`${label}\n  skipped: no token available\n`);
    continue;
  }
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = (await res.text()).slice(0, 300);
    console.log(`${label}\n  HTTP ${res.status}`);
    console.log(`  ${text.replace(/\s+/g, " ")}\n`);
  } catch (error) {
    console.log(`${label}\n  error: ${error.message}\n`);
  }
}

console.log("=== what this means ===");
console.log(
  [
    "The Management API is the only endpoint that exposes redirect URLs, and it requires",
    "a personal access token (a 'sbp_' token from the account settings), not a project key.",
    "",
    "Without that token the redirect configuration cannot be verified programmatically.",
    "The reliable checks that remain are:",
    "  1. The dashboard shows the values and reports a successful save.",
    "  2. A real sign-in in a private window reaches /onboarding.",
  ].join("\n")
);
