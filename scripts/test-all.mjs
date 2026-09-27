/**
 * Runs every test suite in one go and reports a single summary.
 *
 * The suites are separate scripts so each can be run alone while working on one area. CI
 * needs them together: one command, one pass/fail, and a summary table in the job output
 * showing which suite failed rather than only that something did.
 *
 * Suites that need no database run first, so a pure logic bug is reported before the slow
 * database work starts. `--quick` skips only the HTTP suite, which needs a full build.
 *
 * Usage:
 *   node scripts/test-all.mjs              # everything
 *   node scripts/test-all.mjs --quick      # skip the HTTP suite
 *   node scripts/test-all.mjs --no-db      # only the suites that need no database
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const noDb = args.includes("--no-db");

/** Pure logic, no database and no server. Safe to run anywhere, including the CI job that
 * deliberately has no secrets. */
const unitSuites = [
  {
    name: "CI configuration",
    script: "scripts/validate-ci.mjs",
    needsDb: false,
  },
  {
    name: "Report day alignment",
    script: "scripts/test-report-days.mjs",
    needsDb: false,
  },
  {
    // Runs its assertions under TZ=UTC: the bug it covers - a timestamp formatted in
    // whatever timezone the code happens to run in - is invisible on a Vietnamese machine,
    // where the server and the browser would agree by accident.
    name: "Timestamp formatting",
    script: "scripts/test-format-date.mjs",
    needsDb: false,
  },
  {
    name: "Suggested chores and quick add",
    script: "scripts/test-suggested-tasks.mjs",
    needsDb: false,
  },
  {
    name: "Invite code input",
    script: "scripts/test-invite-code.mjs",
    needsDb: false,
  },
  {
    name: "Approval grouping",
    script: "scripts/test-approval-groups.mjs",
    needsDb: false,
  },
  {
    // Runs in the job that has no secrets, which is exactly where a check for
    // credentials committed by mistake belongs.
    name: "No committed credentials",
    script: "scripts/check-no-secrets.mjs",
    needsDb: false,
  },
];

/** These read and write a real database. */
const databaseSuites = [
  {
    name: "Business logic",
    script: "scripts/test-flows.mjs",
  },
  {
    name: "Onboarding",
    script: "scripts/test-onboarding.mjs",
  },
  {
    name: "Storage upload",
    script: "scripts/test-storage-upload.mjs",
  },
  {
    name: "Reports and streaks",
    script: "scripts/test-reports-and-streaks.mjs",
  },
  {
    name: "Quick award and penalty",
    script: "scripts/test-quick-award.mjs",
  },
  {
    name: "Push subscriptions and recipients",
    script: "scripts/test-push.mjs",
  },
  {
    name: "Family invites",
    script: "scripts/test-invites.mjs",
  },
  {
    name: "Child avatars",
    script: "scripts/test-child-avatars.mjs",
  },
  {
    name: "HTTP end to end",
    script: "scripts/test-e2e.mjs",
    // The suite builds and starts the app itself, then stops it again, so one command
    // covers everything. Skipped in a quick run because the build takes a while.
    extraArgs: ["--start-server"],
    skipWhenQuick: true,
  },
  {
    // Last, and after the suite above: it drives a real browser through the screens a
    // person uses, which is the only thing that catches a layout or client-component
    // regression. `--reuse-build` is safe here because the HTTP suite has just built the
    // app in this same run, and a second full build would only add minutes.
    name: "UI regression (browser)",
    script: "scripts/test-ui.mjs",
    extraArgs: ["--start-server", "--reuse-build"],
    skipWhenQuick: true,
  },
];

// Only the database suites need a real project. `--no-db` is meant to run in the CI job
// that deliberately has no secrets, so the check is skipped for it.
if (!noDb && !existsSync(".env.local")) {
  console.error(
    "No .env.local found. The database suites need a real project and Storage bucket."
  );
  console.error("Use --no-db to run only the suites that need no database.");
  process.exit(1);
}

const results = [];

const suites = noDb ? unitSuites : [...unitSuites, ...databaseSuites];

for (const suite of suites) {
  if (quick && suite.skipWhenQuick) {
    results.push({ ...suite, outcome: "skipped" });
    console.log(`\n${"=".repeat(64)}\nSKIP  ${suite.name} (quick run)\n${"=".repeat(64)}`);
    continue;
  }

  console.log(`\n${"=".repeat(64)}\nRUN   ${suite.name}  (${suite.script})\n${"=".repeat(64)}`);

  const started = Date.now();
  const run = spawnSync(process.execPath, [suite.script, ...(suite.extraArgs ?? [])], {
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
    `### Test suites${noDb ? " (no database)" : ""}`,
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
