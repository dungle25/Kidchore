/**
 * Waits for a Vercel deployment to serve the latest commit.
 *
 * The client bundle is fingerprinted, so a change to the login button produces a new
 * chunk name. Comparing the chunk list before and after tells us whether the new build
 * is live, which avoids guessing whether Vercel has finished.
 *
 * Usage: node scripts/wait-for-deployment.mjs [baseUrl] [timeoutSeconds]
 */
const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";
const timeoutSeconds = Number(process.argv[3] ?? 240);

/** Collects the client chunk URLs referenced by the login page. */
async function chunkList() {
  const res = await fetch(`${base}/login`, { cache: "no-store" });
  const html = await res.text();
  return [...new Set([...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]))].sort();
}

const before = await chunkList();
console.log(`chunks before: ${before.length}`);
console.log("waiting for a new build...\n");

const deadline = Date.now() + timeoutSeconds * 1000;
let deployed = false;
let attempt = 0;

while (Date.now() < deadline) {
  attempt += 1;
  await new Promise((r) => setTimeout(r, 15000));

  let now;
  try {
    now = await chunkList();
  } catch {
    console.log(`  ${attempt}: request failed, retrying`);
    continue;
  }

  const changed = JSON.stringify(now) !== JSON.stringify(before);
  console.log(
    `  ${attempt}: ${now.length} chunks ${changed ? "- CHANGED, new build is live" : "- unchanged"}`
  );

  if (changed) {
    deployed = true;
    break;
  }
}

if (!deployed) {
  console.log("\nNo new build detected within the timeout.");
  console.log("Vercel may still be building, or the deployment failed.");
  console.log("Check: https://vercel.com/dashboard -> your project -> Deployments");
  process.exit(1);
}

// Confirm the removed parameter is really gone from the live bundles.
let stillPresent = false;
const scripts = await chunkList();
for (const src of scripts) {
  const url = src.startsWith("http") ? src : base + src;
  const js = await (await fetch(url)).text().catch(() => "");
  if (js.includes("access_type") || js.includes("prompt=consent") || js.includes('"consent"')) {
    stillPresent = true;
    console.log(`  note: ${src.split("/").pop()} still mentions a consent parameter`);
  }
}

console.log(
  `\n${stillPresent ? "Still present in a bundle - inspect further." : "The extra Google parameters are gone from the live build."}`
);
