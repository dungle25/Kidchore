/**
 * Reports the review-related settings that decide whether an automated approval works.
 *
 * Two things matter:
 *   * the login of the pull request author, because GitHub blocks an identity from
 *     approving its own pull request;
 *   * whether stale reviews are dismissed, because that decides if an approval granted
 *     before CI finishes is thrown away when the branch changes.
 *
 * Usage: $env:GITHUB_TOKEN='...'; node scripts/check-pr-review-rules.mjs [prNumber]
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
  "User-Agent": "kidchore-review-rules",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const pr = await api(`/repos/${repo}/pulls/${prNumber}`);
if (pr.status === 200) {
  console.log("=== pull request author ===");
  console.log(`  #${prNumber} by ${pr.body.user.login} (${pr.body.user.type})`);
  console.log(`  author_association: ${pr.body.author_association}`);
  console.log("");
  console.log("  GitHub refuses a review from the identity that authored the pull request.");
  console.log("  A review submitted by the workflow token is attributed to");
  console.log("  'github-actions[bot]', which is a different identity, so it can approve.");
}

console.log("\n=== branch protection review settings ===");
const protection = await api(`/repos/${repo}/branches/main/protection`);
if (protection.status === 200) {
  const reviews = protection.body.required_pull_request_reviews;
  if (!reviews) {
    console.log("  no review requirement configured");
  } else {
    console.log(`  required approving reviews : ${reviews.required_approving_review_count}`);
    console.log(`  dismiss stale reviews      : ${reviews.dismiss_stale_reviews}`);
    console.log(`  require code owner reviews : ${reviews.require_code_owner_reviews}`);
    console.log(`  require last push approval : ${reviews.require_last_push_approval}`);
    if (reviews.dismiss_stale_reviews) {
      console.log("");
      console.log("  IMPORTANT: stale reviews are dismissed. An approval granted before CI");
      console.log("  finishes, or before any later push, is discarded. The approval must");
      console.log("  therefore happen after the checks have passed on the final commit.");
    }
  }
  const checks = protection.body.required_status_checks;
  if (checks) {
    console.log(`  required status checks     : ${JSON.stringify(checks.contexts)}`);
    console.log(`  strict (up to date)        : ${checks.strict}`);
  }
} else {
  console.log(`  could not read: HTTP ${protection.status}`);
}

console.log("\n=== rulesets (if any) ===");
const rulesets = await api(`/repos/${repo}/rulesets`);
if (Array.isArray(rulesets.body) && rulesets.body.length > 0) {
  for (const r of rulesets.body) {
    console.log(`  #${r.id} ${r.name} enforcement=${r.enforcement}`);
  }
} else {
  console.log("  (none)");
}

console.log("\n=== existing reviews on the pull request ===");
const reviews = await api(`/repos/${repo}/pulls/${prNumber}/reviews`);
if (Array.isArray(reviews.body)) {
  if (reviews.body.length === 0) console.log("  (none)");
  for (const r of reviews.body) {
    console.log(`  ${r.user.login} (${r.user.type}): ${r.state}`);
  }
}
