/**
 * Reports GitHub Actions workflow runs and their job/step status.
 * Usage: $env:GITHUB_TOKEN='...'; node scripts/gh-runs.mjs
 */
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-runs",
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

const repo = "dungle25/Kidchore";

const runs = await api(`/repos/${repo}/actions/runs?per_page=10`);
console.log(`Workflow runs -> HTTP ${runs.status}`);
if (runs.status !== 200) {
  console.log(JSON.stringify(runs.body)?.slice(0, 400));
  process.exit(1);
}

if (runs.body.total_count === 0) {
  console.log("  No workflow runs found.");
  console.log("\nThis usually means:");
  console.log("  - Actions is disabled for the repository, or");
  console.log("  - the workflow file was not present on the branch when it was pushed.");
  process.exit(0);
}

for (const run of runs.body.workflow_runs) {
  console.log(
    `\n  #${run.run_number} "${run.name}" [${run.status}/${run.conclusion ?? "-"}]`
  );
  console.log(`    event : ${run.event}  branch: ${run.head_branch}  sha: ${run.head_sha.slice(0, 7)}`);
  console.log(`    url   : ${run.html_url}`);

  const jobs = await api(`/repos/${repo}/actions/runs/${run.id}/jobs`);
  if (jobs.status !== 200) continue;

  for (const job of jobs.body.jobs ?? []) {
    console.log(`      job "${job.name}" [${job.status}/${job.conclusion ?? "-"}]`);
    for (const step of job.steps ?? []) {
      const mark =
        step.conclusion === "success"
          ? "ok"
          : step.conclusion === "skipped"
            ? "skip"
            : step.conclusion === "failure"
              ? "FAIL"
              : (step.conclusion ?? step.status);
      console.log(`        - ${step.name}: ${mark}`);
    }
  }
}
