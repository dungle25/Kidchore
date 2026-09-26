/**
 * Reports whether a pull request is mergeable and what is still blocking it.
 *
 * With branch protection requiring both a passing check and an approving review, the
 * merge button can stay disabled even when CI is green. This makes the remaining
 * requirement explicit instead of leaving it to guesswork.
 *
 * Usage: $env:GITHUB_TOKEN='...'; node scripts/gh-pr-status.mjs [prNumber]
 */
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const repo = "dungle25/Kidchore";
const prNumber = process.argv[2] ?? "1";

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-pr-status",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const pr = await api(`/repos/${repo}/pulls/${prNumber}`);
if (pr.status !== 200) {
  console.error(`Could not read PR #${prNumber}: HTTP ${pr.status}`);
  process.exit(1);
}

const p = pr.body;
console.log(`PR #${p.number}: ${p.title}`);
console.log(`  ${p.head.ref} -> ${p.base.ref}`);
console.log(`  state          : ${p.state}${p.merged ? " (merged)" : ""}`);
console.log(`  mergeable      : ${p.mergeable}`);
console.log(`  mergeable_state: ${p.mergeable_state}`);
console.log(`  url            : ${p.html_url}`);

console.log("\n=== checks on the head commit ===");
const checks = await api(`/repos/${repo}/commits/${p.head.sha}/check-runs`);
if (checks.status === 200 && Array.isArray(checks.body.check_runs)) {
  if (checks.body.check_runs.length === 0) console.log("  (none reported)");
  for (const run of checks.body.check_runs) {
    console.log(`  ${run.name}: ${run.status}/${run.conclusion ?? "-"}`);
  }
} else {
  console.log(`  could not read check runs: HTTP ${checks.status}`);
}

console.log("\n=== reviews ===");
const reviews = await api(`/repos/${repo}/pulls/${prNumber}/reviews`);
if (reviews.status === 200 && Array.isArray(reviews.body)) {
  const approvals = reviews.body.filter((r) => r.state === "APPROVED");
  if (reviews.body.length === 0) console.log("  (no reviews yet)");
  for (const r of reviews.body) {
    console.log(`  ${r.user.login}: ${r.state}`);
  }
  console.log(`  approving reviews: ${approvals.length}`);
} else {
  console.log(`  could not read reviews: HTTP ${reviews.status}`);
}

console.log("\n=== what is still required ===");
const blockers = [];
if (p.mergeable_state === "blocked") blockers.push("branch protection is blocking the merge");
if (p.mergeable_state === "behind") blockers.push("the head branch is behind main");
if (p.mergeable_state === "dirty") blockers.push("there are merge conflicts");

const reviewsList = Array.isArray(reviews.body) ? reviews.body : [];
const approvals = reviewsList.filter((r) => r.state === "APPROVED").length;

if (blockers.length === 0) {
  console.log("  nothing reported by the API");
}
for (const b of blockers) console.log(`  - ${b}`);

console.log("");
console.log("  Branch protection on main requires:");
console.log("    * the check \"Lint, typecheck and build\" to pass");
console.log("    * 1 approving review");
console.log("    * the branch to be up to date with main");
console.log("");
if (approvals === 0) {
  console.log("  0 approvals so far, so the merge button stays disabled until someone");
  console.log("  approves. GitHub does not let you approve your own pull request, which is");
  console.log("  why a pull request opened by the token cannot be self-approved.");
}
