/**
 * Checks the deployed login page for anything that could keep an old build alive in a
 * browser, and confirms the removed Google parameters are really gone.
 *
 * Two things worth ruling out before asking someone to retry a sign-in:
 *   - a service worker, which would keep serving a cached bundle after a deploy;
 *   - any remaining reference to the provider parameters that were removed.
 *
 * Usage: node scripts/check-live-freshness.mjs [baseUrl]
 */
const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";

console.log(`deployment: ${base}\n`);

const res = await fetch(`${base}/login`, { cache: "no-store" });
const html = await res.text();

console.log("=== caching layers ===");
let foundServiceWorker = false;
for (const path of ["/sw.js", "/service-worker.js", "/workbox-sw.js"]) {
  const r = await fetch(base + path, { redirect: "manual" });
  if (r.status === 200) foundServiceWorker = true;
  console.log(`  ${path.padEnd(22)} HTTP ${r.status}`);
}
console.log(`  service worker registered in HTML: ${/serviceWorker/.test(html) ? "YES" : "no"}`);
console.log(
  `  cache-control on /login: ${res.headers.get("cache-control") ?? "(none)"}`
);

console.log("\n=== bundles ===");
const scripts = [...new Set([...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]))];
console.log(`  count: ${scripts.length}`);

let accessType = false;
let promptConsent = false;
for (const src of scripts) {
  const js = await (await fetch(src.startsWith("http") ? src : base + src)).text();
  if (js.includes("access_type")) accessType = true;
  if (/prompt["']?\s*:\s*["']consent/.test(js) || js.includes('"consent"')) promptConsent = true;
}

console.log(`  any bundle references access_type : ${accessType}`);
console.log(`  any bundle references consent     : ${promptConsent}`);

console.log("\n=== verdict ===");
if (foundServiceWorker) {
  console.log("  A service worker exists. A browser may keep an older bundle until it is");
  console.log("  updated, so a hard reload (or a fresh private window) may be needed.");
} else {
  console.log("  No service worker. A normal private window will load the current build.");
}
if (accessType || promptConsent) {
  console.log("  A bundle still references the removed Google parameters. Investigate.");
} else {
  console.log("  The removed Google parameters are absent from every bundle.");
}
