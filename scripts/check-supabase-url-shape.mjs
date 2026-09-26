/**
 * Checks the Supabase URL for a path suffix that would produce the malformed OAuth URL.
 *
 * The failure requires the auth client's base URL to end in something like "/rest/v1",
 * because auth-js appends "/auth/v1/authorize" to it. A URL stored with a trailing path
 * would explain the observed request exactly, and it is easy to introduce by pasting the
 * REST endpoint instead of the project URL.
 *
 * Checks both the local value and every occurrence of the project host in the deployed
 * client bundles.
 *
 * Usage: node scripts/check-supabase-url-shape.mjs [baseUrl]
 */
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// ---- local value ----
const localUrl = env.NEXT_PUBLIC_SUPABASE_URL;
console.log("=== local .env.local ===");
console.log(`  value : ${JSON.stringify(localUrl)}`);
try {
  const parsed = new URL(localUrl);
  console.log(`  href  : ${parsed.href}`);
  console.log(`  path  : ${JSON.stringify(parsed.pathname)}`);
  const cleanPath = parsed.pathname === "/" || parsed.pathname === "";
  console.log(`  path is clean: ${cleanPath ? "YES" : "NO - this would corrupt the auth URL"}`);
} catch {
  console.log("  value is not a valid absolute URL");
}

// ---- every string in the deployed bundles that contains the ref ----
console.log("\n=== deployed client bundles ===");
const html = await (await fetch(`${base}/login`, { cache: "no-store" })).text();
const scripts = [...new Set([...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]))];

const seen = new Set();
for (const src of scripts) {
  const url = src.startsWith("http") ? src : base + src;
  const js = await (await fetch(url)).text().catch(() => "");

  // Capture host plus anything that follows it, to see whether a path is attached.
  for (const match of js.matchAll(/https:\/\/[a-z0-9]+\.supabase\.co[^"'\s\\`)]{0,40}/g)) {
    seen.add(match[0]);
  }
}

if (seen.size === 0) {
  console.log("  no supabase URLs found in the bundles");
} else {
  for (const value of [...seen].sort()) {
    const hasPath = /\.supabase\.co\/.+/.test(value);
    console.log(`  ${hasPath ? "PATH!" : "ok   "} ${JSON.stringify(value)}`);
  }
}

console.log("\n=== verdict ===");
const anyDeployedHasPath = [...seen].some((v) => /\.supabase\.co\/.+/.test(v));
if (anyDeployedHasPath) {
  console.log("  A deployed value carries a path after the host. That is the cause of the");
  console.log("  malformed /rest/v1/auth/v1/authorize URL. Correct the environment variable");
  console.log("  in Vercel to be only the project URL, then redeploy.");
} else {
  console.log("  Neither the local value nor the deployed bundles carry a path after the host.");
  console.log("  The base URL is well-formed, so the malformed request came from somewhere");
  console.log("  else - most likely an api key that Supabase rejects for the Auth endpoint.");
}

// How does the auth endpoint respond to this exact key?
console.log("\n=== is the publishable key accepted by the Auth endpoint? ===");
const probe = await fetch(
  `${localUrl}/auth/v1/settings`,
  { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } }
);
console.log(`  GET /auth/v1/settings with this key -> HTTP ${probe.status}`);
if (probe.status !== 200) {
  console.log(`  body: ${(await probe.text()).slice(0, 200)}`);
  console.log("  A non-200 here means the key itself is being rejected.");
}
