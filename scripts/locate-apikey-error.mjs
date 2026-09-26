/**
 * Locates which Supabase endpoint produces the error the user saw:
 *   {"message":"No API key found in request",
 *    "hint":"No `apikey` request header or url param was found."}
 *
 * That wording is PostgREST's, not GoTrue's, so the request that failed did not reach
 * Auth. This compares candidate URLs with and without the apikey header to find the
 * exact combination that yields that message, which identifies the real request path.
 *
 * Usage: node scripts/locate-apikey-error.mjs
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

const TARGET = "No API key found in request";

const cases = [
  ["/auth/v1/authorize", "no apikey", {}],
  ["/auth/v1/authorize", "with apikey", { apikey: key }],
  ["/rest/v1/auth/v1/authorize", "no apikey", {}],
  ["/rest/v1/auth/v1/authorize", "with apikey", { apikey: key }],
  ["/rest/v1/", "no apikey", {}],
  ["/rest/v1/", "with apikey", { apikey: key }],
];

console.log(`Looking for the exact source of: "${TARGET}"\n`);

for (const [path, label, headers] of cases) {
  const target = `${url}${path}?provider=google`;
  let status = 0;
  let body = "";
  try {
    const res = await fetch(target, { headers, redirect: "manual" });
    status = res.status;
    body = (await res.text()).slice(0, 200);
  } catch (error) {
    body = `fetch error: ${error.message}`;
  }

  const match = body.includes(TARGET);
  console.log(`${match ? "MATCH " : "      "} ${path.padEnd(30)} ${label.padEnd(12)} HTTP ${status}`);
  if (body) console.log(`        ${body.replace(/\s+/g, " ").slice(0, 150)}`);
}

console.log("\n=== interpretation ===");
console.log(
  [
    "If only the /rest/v1/... paths produce that message, the failing request was a",
    "PostgREST call, which means the browser was pointed at the REST endpoint instead of",
    "the Auth endpoint.",
    "",
    "If /auth/v1/authorize also produces it without the apikey header, then the client is",
    "simply not sending the header and the auth path is otherwise correct. A redirect",
    "cannot carry a header at all, so the user would have to have reached that URL via a",
    "fetch, not a navigation.",
  ].join("\n")
);
