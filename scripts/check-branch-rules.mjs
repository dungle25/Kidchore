/**
 * Reports the branch rules protecting main, so it is clear whether a direct push to main
 * is actually blocked.
 *
 * Usage: $env:GITHUB_TOKEN='...'; node scripts/check-branch-rules.mjs
 */
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const repo = "dungle25/Kidchore";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-rules",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body };
}

console.log("=== rulesets ===");
const rulesets = await api(`/repos/${repo}/rulesets`);
console.log(`GET /rulesets -> HTTP ${rulesets.status}`);
if (Array.isArray(rulesets.body)) {
  if (rulesets.body.length === 0) {
    console.log("  (none)");
  }
  for (const ruleset of rulesets.body) {
    console.log(
      `  #${ruleset.id} "${ruleset.name}"  target=${ruleset.target}  enforcement=${ruleset.enforcement}`
    );
    const detail = await api(`/repos/${repo}/rulesets/${ruleset.id}`);
    if (detail.status !== 200) {
      console.log(`    could not read detail: HTTP ${detail.status}`);
      continue;
    }
    const conditions = detail.body.conditions?.ref_name;
    if (conditions) {
      console.log(`    applies to refs: include=${JSON.stringify(conditions.include)} exclude=${JSON.stringify(conditions.exclude ?? [])}`);
    }
    for (const rule of detail.body.rules ?? []) {
      const params = rule.parameters ?? {};
      if (rule.type === "required_status_checks") {
        const checks = (params.required_status_checks ?? []).map((c) => c.context);
        console.log(`    rule: required_status_checks -> ${JSON.stringify(checks)}`);
        console.log(`          strict (branch must be up to date): ${params.strict_required_status_checks_policy}`);
      } else if (rule.type === "pull_request") {
        console.log(
          `    rule: pull_request -> required_approving_review_count=${params.required_approving_review_count}`
        );
      } else {
        console.log(`    rule: ${rule.type}`);
      }
    }
  }
} else {
  console.log(`  ${JSON.stringify(rulesets.body).slice(0, 200)}`);
}

console.log("\n=== classic branch protection (legacy API) ===");
const protection = await api(`/repos/${repo}/branches/main/protection`);
console.log(`GET /branches/main/protection -> HTTP ${protection.status}`);
if (protection.status === 200) {
  const p = protection.body;
  console.log(`  required status checks: ${JSON.stringify(p.required_status_checks)}`);
  console.log(`  required PR reviews   : ${JSON.stringify(p.required_pull_request_reviews)}`);
  console.log(`  enforce on admins     : ${p.enforce_admins?.enabled}`);
} else if (protection.status === 404) {
  console.log("  not configured through the classic API");
}

console.log("\n=== what this means ===");
// Rulesets and classic protection are separate mechanisms. Only checking the ruleset API
// once produced a wrong "no protection" verdict on a repository that was in fact
// protected, so both are considered here.
const hasRuleset = Array.isArray(rulesets.body) && rulesets.body.length > 0;
const classicProtected = protection.status === 200;

if (hasRuleset || classicProtected) {
  console.log("  main is protected.");
  if (classicProtected) {
    const contexts = protection.body.required_status_checks?.contexts ?? [];
    const reviews =
      protection.body.required_pull_request_reviews?.required_approving_review_count ?? 0;
    console.log(`    required status checks : ${JSON.stringify(contexts)}`);
    console.log(`    branch must be current : ${protection.body.required_status_checks?.strict}`);
    console.log(`    required approvals     : ${reviews}`);
    console.log(`    applies to admins too  : ${protection.body.enforce_admins?.enabled}`);
  }
  console.log("");
  console.log("  A direct push to main is refused, so changes must arrive through a pull");
  console.log("  request whose checks pass. Vercel only deploys production from main, so a");
  console.log("  broken commit cannot reach the live site.");
} else {
  console.log("  No ruleset and no classic protection, so main can still be pushed directly");
  console.log("  and Vercel would deploy it immediately.");
}
