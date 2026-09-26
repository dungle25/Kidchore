/**
 * Verifies a deployment actually received its environment variables.
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so if the
 * Vercel build ran without them the deployed page is broken in a way that only shows up
 * when someone tries to sign in. Checking the bundle is a direct way to find that out
 * without clicking through the UI.
 *
 * Server-only secrets (the JWT secret and service role key) are deliberately not in the
 * bundle and cannot be checked from here; they are exercised by the onboarding step.
 *
 * Usage: node scripts/check-deployment-env.mjs [baseUrl]
 */
const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";

console.log(`Checking ${base}\n`);

let html;
try {
  const res = await fetch(base + "/login");
  html = await res.text();
  console.log(`GET /login -> HTTP ${res.status}, ${html.length} bytes`);
} catch (error) {
  console.error(`Cannot reach ${base}: ${error.message}`);
  process.exit(1);
}

// Next.js emits its client chunks as <script src="..."> tags.
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
console.log(`client bundles referenced: ${scripts.length}`);

const wanted = [
  ["Supabase project URL", "supabase.co"],
  ["publishable key", "sb_publishable_"],
];

const found = Object.fromEntries(wanted.map(([label]) => [label, false]));

for (const src of scripts) {
  const url = src.startsWith("http") ? src : base + src;
  let js;
  try {
    js = await (await fetch(url)).text();
  } catch {
    continue;
  }
  for (const [label, needle] of wanted) {
    if (js.includes(needle)) found[label] = true;
  }
  if (Object.values(found).every(Boolean)) break;
}

console.log("");
let problems = 0;
for (const [label] of wanted) {
  const ok = found[label];
  if (!ok) problems += 1;
  console.log(`  ${ok ? "ok  " : "MISSING"}  ${label} present in client bundle`);
}

console.log("\n=== server-only secrets ===");
console.log(
  "  Not visible in the bundle by design. They are used by the sign-in and"
);
console.log(
  "  onboarding actions, so completing onboarding on this domain proves they are set."
);

console.log(
  `\n${problems === 0 ? "PASS: the deployment has its public environment variables." : `FAIL: ${problems} value(s) missing from the build.`}`
);
process.exit(problems === 0 ? 0 : 1);
