/**
 * Downloads the raw log of a workflow job and prints the lines around any error.
 * Usage: $env:GITHUB_TOKEN='...'; node scripts/gh-logs.mjs [runId]
 */
import { writeFileSync } from "node:fs";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const repo = "dungle25/Kidchore";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-logs",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const runId = process.argv[2];
if (!runId) {
  console.error("Pass a run id, e.g. node scripts/gh-logs.mjs 36229085011");
  process.exit(1);
}

const jobs = await api(`/repos/${repo}/actions/runs/${runId}/jobs`);
if (jobs.status !== 200) {
  console.error(`Could not list jobs: HTTP ${jobs.status}`);
  process.exit(1);
}

for (const job of jobs.body.jobs ?? []) {
  if (job.conclusion !== "failure") continue;

  console.log(`\n=== Job: ${job.name} ===`);
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`, {
    headers: { ...headers, Accept: "application/vnd.github+json" },
    redirect: "follow",
  });

  if (!res.ok) {
    console.error(`Could not download log: HTTP ${res.status}`);
    continue;
  }

  const text = await res.text();
  writeFileSync(`ci-log-${job.id}.txt`, text, "utf8");

  const lines = text.split(/\r?\n/);
  // Print each failing region with a little context, plus the tail of the log.
  const errorIndexes = [];
  lines.forEach((line, i) => {
    if (/error TS\d+|##\[error\]|npm error|ELIFECYCLE/i.test(line)) errorIndexes.push(i);
  });

  if (errorIndexes.length) {
    console.log(`--- error lines (${errorIndexes.length} matches) ---`);
    const shown = new Set();
    for (const index of errorIndexes.slice(0, 40)) {
      for (let i = Math.max(0, index - 2); i <= Math.min(lines.length - 1, index + 2); i++) {
        if (shown.has(i)) continue;
        shown.add(i);
        console.log(lines[i]);
      }
      console.log("");
    }
  } else {
    console.log("--- no obvious error lines; printing last 40 lines ---");
    console.log(lines.slice(-40).join("\n"));
  }

  console.log(`\n(full log saved to ci-log-${job.id}.txt)`);
}
