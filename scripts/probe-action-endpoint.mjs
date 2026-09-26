/**
 * Probes how a deployment responds to Server Action requests.
 *
 * Next.js answers a POST to a page route differently depending on whether the action id
 * is known: a 404 means the id is not in the server reference manifest, while other codes
 * mean the request reached an action but was rejected for its content (for example a
 * missing multipart body, or a validation error).
 *
 * That distinction is what tells apart "Server Actions are broken on this deployment"
 * from "my synthetic request was malformed".
 *
 * Usage: node scripts/probe-action-endpoint.mjs [baseUrl]
 */
const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";

async function post(path, headers, body) {
  try {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { Origin: base, ...headers },
      body,
      redirect: "manual",
    });
    const text = await res.text().catch(() => "");
    return { status: res.status, text };
  } catch (error) {
    return { status: 0, text: error.message };
  }
}

console.log(`Probing ${base}\n`);

// 1. A POST with no action id at all.
const noId = await post("/login", { "Content-Type": "text/plain;charset=UTF-8" }, "[]");
console.log(`1. POST /login without Next-Action        -> HTTP ${noId.status}`);
if (noId.text) console.log(`   ${noId.text.slice(0, 160).replace(/\s+/g, " ")}`);

// 2. A POST with a fabricated action id.
const fakeId = "0".repeat(42);
const fake = await post(
  "/login",
  { "Next-Action": fakeId, "Content-Type": "text/plain;charset=UTF-8" },
  "[]"
);
console.log(`\n2. POST /login with a fake action id      -> HTTP ${fake.status}`);
if (fake.text) console.log(`   ${fake.text.slice(0, 160).replace(/\s+/g, " ")}`);

// 3. A GET to a path that cannot exist, as a baseline for what a real 404 looks like.
const missing = await fetch(`${base}/definitely-not-a-route`).catch(() => null);
console.log(`\n3. GET /definitely-not-a-route (baseline) -> HTTP ${missing?.status}`);

console.log("\n=== how to read this ===");
console.log(
  [
    "  fake id -> 404 : the manifest lookup is working, so the id in my synthetic",
    "                   request simply is not a real action.",
    "  fake id -> 500 : the request reached the action layer but the payload was",
    "                   rejected. Server Actions are wired up.",
    "  fake id -> 200 : unusual; inspect the body.",
  ].join("\n")
);

console.log("\n=== the real test ===");
console.log(
  "  A synthetic request cannot fully stand in for the browser, because the id and the",
  "  multipart encoding are produced client-side. The definitive check is to press the",
  "  button in the browser and report what happens, plus any server-side log."
);
