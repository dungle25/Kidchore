/**
 * Extracts every Supabase URL variant from the deployed client bundles and classifies it.
 *
 * A correct build contains the bare project URL. The REST endpoint
 * `.../rest/v1/` also appears, but only as an internal string from supabase-js, which is
 * harmless on its own. The question is whether a value with a path is used as the
 * *project URL*, because auth-js appends `/auth/v1/authorize` to it and would then build
 * `/rest/v1/auth/v1/authorize`.
 *
 * Distinguishing the two is done by looking at what surrounds each occurrence.
 *
 * Usage: node scripts/extract-supabase-urls.mjs [baseUrl]
 */
const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";

const html = await (await fetch(`${base}/login`, { cache: "no-store" })).text();
const scripts = [...new Set([...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]))];

console.log(`Scanning ${scripts.length} client bundles on ${base}\n`);

const occurrences = [];

for (const src of scripts) {
  const url = src.startsWith("http") ? src : base + src;
  const js = await (await fetch(url)).text().catch(() => "");
  if (!js) continue;

  const needle = ".supabase.co";
  let index = js.indexOf(needle);
  while (index !== -1) {
    // Take a window around the match so the surrounding code shows how it is used.
    const start = Math.max(0, index - 120);
    const end = Math.min(js.length, index + 60);
    occurrences.push({
      chunk: src.split("/").pop(),
      context: js.slice(start, end),
      at: index,
    });
    index = js.indexOf(needle, index + 1);
  }
}

console.log(`found ${occurrences.length} occurrence(s) of ".supabase.co"\n`);

/** Pulls out the URL literal itself (host plus any path immediately following). */
function extractUrl(context, needle = ".supabase.co") {
  const at = context.indexOf(needle);
  if (at === -1) return null;
  let start = at;
  while (start > 0 && !/["'`\s]/.test(context[start - 1])) start -= 1;
  let end = at + needle.length;
  while (end < context.length && !/["'`\s\\]/.test(context[end])) end += 1;
  return context.slice(start, end);
}

const urlCounts = new Map();
for (const occurrence of occurrences) {
  const value = extractUrl(occurrence.context);
  if (!value) continue;
  urlCounts.set(value, (urlCounts.get(value) ?? 0) + 1);
}

console.log("distinct URL literals:");
for (const [value, count] of [...urlCounts.entries()].sort()) {
  const hasPath = /\.supabase\.co\/.+/.test(value);
  console.log(`  ${hasPath ? "HAS PATH" : "bare    "}  ${value}  (x${count})`);
}

console.log("\n=== how each is used ===");
for (const occurrence of occurrences.slice(0, 8)) {
  console.log(`  [${occurrence.chunk}] ...${occurrence.context.replace(/\s+/g, " ")}`);
  console.log("");
}

// The decisive test: build the auth URL the way auth-js does, from each candidate.
console.log("=== what auth-js would build from each candidate ===");
for (const value of urlCounts.keys()) {
  const built = `${value}/auth/v1/authorize`;
  const bad = built.includes("/rest/v1/");
  console.log(`  ${bad ? "MALFORMED" : "ok       "}  ${built}`);
}

console.log("\n=== conclusion ===");
const anyMalformed = [...urlCounts.keys()].some((v) => `${v}/auth/v1/authorize`.includes("/rest/v1/"));
if (anyMalformed) {
  console.log("  A URL with a path is present. If that value is what the env var holds, the");
  console.log("  Auth URL becomes /rest/v1/auth/v1/authorize, which is exactly the failure.");
  console.log("  Fix: set NEXT_PUBLIC_SUPABASE_URL in Vercel to the bare project URL and");
  console.log("  redeploy (env changes require a new deployment).");
} else {
  console.log("  Only bare project URLs are present, so the env var is well-formed and the");
  console.log("  malformed URL must come from elsewhere.");
}
