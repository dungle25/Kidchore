/**
 * Compares the Supabase credentials baked into a deployment against the local ones.
 *
 * A wrong or truncated value on Vercel produces exactly the failure we are chasing: the
 * OAuth redirect starts (the browser builds the URL with the public project URL), but the
 * callback's `exchangeCodeForSession` fails against Auth, and the user lands back on
 * /login with a red message. The public values are inlined into the client bundle, so
 * they can be read and checked from outside.
 *
 * Only the public values are compared. Server-only secrets cannot be read this way.
 *
 * Usage: node scripts/compare-deployment-credentials.mjs [baseUrl]
 */
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";

const local = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// ---- Read what the deployment actually shipped ----
const html = await (await fetch(`${base}/login`)).text();
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);

let bundleText = "";
for (const src of scripts) {
  const url = src.startsWith("http") ? src : base + src;
  try {
    bundleText += await (await fetch(url)).text();
  } catch {
    /* ignore an unreachable chunk */
  }
}

const deployedUrl = bundleText.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[0] ?? null;
const deployedKey = bundleText.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0] ?? null;

console.log(`Deployment: ${base}\n`);
console.log("=== Supabase URL ===");
console.log(`  local    : ${local.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`  deployed : ${deployedUrl ?? "(not found in bundle)"}`);
const urlMatches = deployedUrl === local.NEXT_PUBLIC_SUPABASE_URL;
console.log(`  match    : ${urlMatches ? "YES" : "NO"}`);

console.log("\n=== publishable key ===");
const localKey = local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
console.log(`  local    : ${localKey?.slice(0, 18)}... (len ${localKey?.length})`);
console.log(
  `  deployed : ${deployedKey ? `${deployedKey.slice(0, 18)}... (len ${deployedKey.length})` : "(not found in bundle)"}`
);
const keyMatches = deployedKey === localKey;
console.log(`  match    : ${keyMatches ? "YES" : "NO"}`);

// ---- Does the deployed key actually work against the project? ----
console.log("\n=== is the deployed key functional? ===");
let deployedKeyWorks = null;
if (deployedKey && deployedUrl) {
  const res = await fetch(`${deployedUrl}/auth/v1/settings`, {
    headers: { apikey: deployedKey },
  }).catch(() => null);
  deployedKeyWorks = res?.status === 200;
  console.log(`  GET ${deployedUrl}/auth/v1/settings -> HTTP ${res?.status ?? "error"}`);
  console.log(`  key accepted: ${deployedKeyWorks ? "YES" : "NO"}`);
} else {
  console.log("  skipped: could not extract both values from the bundle");
}

console.log("\n=== verdict ===");
if (urlMatches && keyMatches) {
  console.log("  The deployment uses the same Supabase project and key as this machine.");
  console.log("  A mismatch here is NOT the cause of the sign-in failure.");
} else {
  console.log("  MISMATCH. Fix the Vercel environment variables, then redeploy:");
  if (!urlMatches) console.log("    NEXT_PUBLIC_SUPABASE_URL differs");
  if (!keyMatches) console.log("    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY differs");
}

process.exit(urlMatches && keyMatches ? 0 : 1);
