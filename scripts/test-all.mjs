/**
 * Runs every database-backed test suite in one go and reports a single summary.
 *
 * The suites are separate scripts so each can be run alone while working on one area.
 * CI needs them together: one command, one pass/fail, and a summary table in the job
 * output showing which suite failed rather than only that something did.
 *
 * Usage:
 *   node scripts/test-all.mjs              # everything
 *   node scripts/test-all.mjs --quick      # skip the HTTP suite, which needs a server
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";

const quick = process.argv.includes("--quick");

const suites = [
  {
    name: "Business logic",
    script: "scripts/test-flows.mjs",
    needs: [],
  },
  {
    name: "Onboarding",
    script: "scripts/test-onboarding.mjs",
    needs: [],
  },
  {
    name: "Storage upload",
    script: "scripts/test-storage-upload.mjs",
    needs: [],
  },
  {
    name: "Reports and streaks",
    script: "scripts/test-reports-and-streaks.mjs",
    needs: [],
  },
  {
    name: "Quick award",
    script: "scripts/test-quick-award.mjs",
    needs: [],
  },
  {
    name: "HTTP end to end",
    script: "scripts/test-e2e.mjs",
    // The suite builds and starts the app itself, then stops it again, so one command
    // covers everything. Skipped in a quick run because the build takes a while.
    args: ["--start-server"],
    skipWhenQuick: true,
  },
];

if (!existsSync(".env.local")) {
  console.error(
    "No .env.local found. These suites need a real database and Storage bucket."
  );
  process.exit(1);
}

const results = [];

for (const suite of suites) {
  if (quick && suite.skipWhenQuick) {
    results.push({ ...suite, outcome: "skipped" });
    console.log(`\n${"=".repeat(64)}\nSKIP  ${suite.name} (quick run)\n${"=".repeat(64)}`);
    continue;
  }

  console.log(`\n${"=".repeat(64)}\nRUN   ${suite.name}  (${suite.script})\n${"=".repeat(64)}`);

  const started = Date.now();
  const run = spawnSync(process.execPath, [suite.script, ...(suite.args ?? [])], {
    stdio: "inherit",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const outcome = run.status === 0 ? "passed" : "failed";
  results.push({ ...suite, outcome, seconds });
}

console.log(`\n${"=".repeat(64)}\nSUMMARY\n${"=".repeat(64)}`);

const width = Math.max(...results.map((r) => r.name.length));
for (const result of results) {
  const mark =
    result.outcome === "passed" ? "PASS" : result.outcome === "skipped" ? "SKIP" : "FAIL";
  const time = result.seconds ? `${result.seconds}s` : "";
  console.log(`  ${mark}  ${result.name.padEnd(width)}  ${time}`);
}

const failed = results.filter((r) => r.outcome === "failed");
const passed = results.filter((r) => r.outcome === "passed").length;

console.log(
  `\n  ${passed} suite(s) passed, ${failed.length} failed, ${
    results.filter((r) => r.outcome === "skipped").length
  } skipped.`
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "### Database test suites",
    "",
    "| Suite | Result | Time |",
    "| --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.name} | ${
          r.outcome === "passed" ? "✅ passed" : r.outcome === "skipped" ? "⏭️ skipped" : "❌ failed"
        } | ${r.seconds ? `${r.seconds}s` : ""} |`
    ),
    "",
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}

process.exit(failed.length === 0 ? 0 : 1);
