#!/usr/bin/env node
/**
 * Small GitHub helper: open a pull request, read its state, read the check results,
 * comment, merge, or dump the branch protection rules for main.
 *
 * Written to replace a pile of one-off `gh-*.mjs` scripts that each hard-coded a
 * branch name and a pull request body. Those went stale the moment the pull request
 * they were written for was merged; this one is driven entirely by its arguments.
 *
 * Usage
 *   node scripts/gh-pr.mjs status
 *   node scripts/gh-pr.mjs checks [--number 3 | --ref <sha>]
 *   node scripts/gh-pr.mjs open --head feat/x --title "..." --body-file pr.md
 *   node scripts/gh-pr.mjs comment --number 3 --body "text"
 *   node scripts/gh-pr.mjs merge --number 3 --method squash
 *   node scripts/gh-pr.mjs protection
 *
 * The token comes from GITHUB_TOKEN, or from .env.local when that is set instead.
 * It needs `repo` (or Contents+Pull requests read/write) on the repository.
 */

import { readFileSync } from "node:fs";

// ---- arguments ----

const argv = process.argv.slice(2);
const command = argv.shift();

if (!command || command === "--help" || command === "-h") {
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const header = source.slice(source.indexOf("/**") + 3, source.indexOf("*/"));
  console.log(header.replace(/^ \* ?/gm, "").trim());
  process.exit(command ? 0 : 1);
}

function option(name, { required = false, fallback = undefined } = {}) {
  const index = argv.indexOf(`--${name}`);
  const value = index === -1 ? fallback : argv[index + 1];
  if (required && (value === undefined || value.startsWith("--"))) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function bodyOption() {
  const file = option("body-file");
  if (file) return readFileSync(file, "utf8");
  const inline = option("body");
  if (inline) return inline;
  throw new Error("--body or --body-file is required");
}

// ---- token ----

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  // The `.env*` files are gitignored, so the token never leaves this machine.
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const match = text.match(/^GITHUB_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // No .env.local; fall through to the error below.
  }
  console.error("GITHUB_TOKEN is not set, and .env.local has no GITHUB_TOKEN.");
  process.exit(1);
}

const token = readToken();
const repo = option("repo", { fallback: "dungle25/Kidchore" });

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-gh-pr",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function api(path, init) {
  const res = await fetch(`https://api.github.com${path}`, { headers, ...init });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

/** Fails loudly instead of printing a half-empty report. */
async function must(path, init) {
  const result = await api(path, init);
  if (!result.ok) {
    console.error(`HTTP ${result.status} for ${path}`);
    console.error(typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2));
    process.exit(1);
  }
  return result.data;
}

// ---- commands ----

async function pullRequest() {
  const number = option("number");
  if (number) {
    return must(`/repos/${repo}/pulls/${number}`);
  }
  const head = option("head");
  if (!head) throw new Error("pass --number <n> or --head <branch>");
  const owner = repo.split("/")[0];
  const list = await must(`/repos/${repo}/pulls?head=${owner}:${head}&state=all&per_page=10`);
  if (list.length === 0) {
    console.error(`No pull request found for branch ${head}.`);
    process.exit(1);
  }
  return list[0];
}

/** The colour of a check conclusion, for a readable one-line summary. */
function mark(conclusion) {
  if (conclusion === "success") return "PASS";
  if (conclusion === "skipped" || conclusion === "neutral") return "SKIP";
  if (conclusion === null || conclusion === undefined) return "....";
  return "FAIL";
}

async function showChecks(pr) {
  const sha = option("ref", { fallback: pr?.head?.sha });
  if (!sha) throw new Error("pass --ref <sha> or --number <n>");

  const runs = await must(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`);
  const statuses = await must(`/repos/${repo}/commits/${sha}/status`);

  console.log(`Checks for ${sha.slice(0, 7)}`);
  for (const run of runs.check_runs) {
    const seconds =
      run.started_at && run.completed_at
        ? ` ${Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000)}s`
        : "";
    console.log(`  ${mark(run.conclusion).padEnd(4)} ${run.name}${seconds}`);
    if (run.conclusion && !["success", "skipped", "neutral"].includes(run.conclusion)) {
      console.log(`       ${run.html_url}`);
    }
  }
  for (const status of statuses.statuses) {
    // A commit status has four states, not two. `pending` is the normal one while
    // Vercel builds, and calling it a failure sends you hunting for a problem that
    // does not exist.
    const label =
      status.state === "success" ? "PASS" : status.state === "pending" ? "...." : "FAIL";
    console.log(`  ${label} ${status.context} (commit status: ${status.state})`);
  }
  if (runs.check_runs.length === 0 && statuses.statuses.length === 0) {
    console.log("  (nothing reported yet)");
  }

  const pending = runs.check_runs.filter((r) => r.status !== "completed");
  const failed = runs.check_runs.filter(
    (r) => r.status === "completed" && !["success", "skipped", "neutral"].includes(r.conclusion)
  );
  console.log("");
  console.log(
    `${runs.check_runs.length} check(s): ${failed.length} failed, ${pending.length} still running.`
  );
  process.exitCode = failed.length > 0 ? 1 : 0;
}

async function showStatus(pr) {
  const reviews = await must(`/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`);
  const reviewers = new Set(
    reviews.filter((r) => r.state === "APPROVED").map((r) => r.user.login)
  );

  console.log(`PR #${pr.number} — ${pr.title}`);
  console.log(`  ${pr.html_url}`);
  console.log(`  ${pr.head.ref} -> ${pr.base.ref}`);
  console.log(`  state: ${pr.state}${pr.merged ? " (merged)" : ""}${pr.draft ? " (draft)" : ""}`);
  console.log(`  mergeable_state: ${pr.mergeable_state}`);
  console.log(`  commits: ${pr.commits}, files: ${pr.changed_files}, +${pr.additions}/-${pr.deletions}`);
  console.log(`  approvals: ${reviewers.size === 0 ? "none" : [...reviewers].join(", ")}`);
  console.log("");
  await showChecks(pr);
}

async function open() {
  const head = option("head", { required: true });
  const base = option("base", { fallback: "main" });
  const title = option("title", { required: true });
  const body = bodyOption();
  const owner = repo.split("/")[0];

  const existing = await must(`/repos/${repo}/pulls?head=${owner}:${head}&state=open`);
  if (existing.length > 0) {
    console.log(`A pull request is already open for ${head}: #${existing[0].number}`);
    console.log(`  ${existing[0].html_url}`);
    return;
  }

  const created = await api(`/repos/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, body, head, base }),
  });

  if (created.status !== 201) {
    console.error(`Could not open the pull request: HTTP ${created.status}`);
    console.error(JSON.stringify(created.data, null, 2));
    console.error(`Open it by hand: https://github.com/${repo}/pull/new/${head}`);
    process.exit(1);
  }

  console.log(`PR created: #${created.data.number}`);
  console.log(`  ${created.data.html_url}`);
}

async function comment() {
  const number = option("number", { required: true });
  const body = bodyOption();
  const created = await must(`/repos/${repo}/issues/${number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  console.log(`Comment added: ${created.html_url}`);
}

async function merge() {
  const number = option("number", { required: true });
  const method = option("method", { fallback: "squash" });
  if (!["squash", "merge", "rebase"].includes(method)) {
    throw new Error("--method must be squash, merge or rebase");
  }
  // The default message would list every commit; a merge commit is not what this
  // branch strategy wants, and squash is the one that keeps main readable.
  const result = await api(`/repos/${repo}/pulls/${number}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: method }),
  });
  if (!result.ok) {
    console.error(`Could not merge: HTTP ${result.status}`);
    console.error(JSON.stringify(result.data, null, 2));
    process.exit(1);
  }
  console.log(`Merged: ${result.data.sha}`);
  console.log(`  ${result.data.message}`);
}

async function protection() {
  // `--approvals 0` turns the approval requirement off. The web UI's dropdown only
  // offers 1..6, so a solo repository that wants "CI is the gate, not review" has to
  // go through the API. Sending the whole object is required: the endpoint replaces
  // the review settings rather than patching one field.
  const approvals = option("approvals");
  if (approvals !== undefined) {
    const count = Number(approvals);
    if (!Number.isInteger(count) || count < 0 || count > 6) {
      throw new Error("--approvals must be an integer between 0 and 6");
    }
    await must(`/repos/${repo}/branches/main/protection/required_pull_request_reviews`, {
      method: "PATCH",
      body: JSON.stringify({ required_approving_review_count: count }),
    });
    console.log(`required_approving_review_count set to ${count}`);
  }

  const rules = await must(`/repos/${repo}/branches/main/protection`);
  const reviews = rules.required_pull_request_reviews;
  const checks = rules.required_status_checks;

  console.log(`Branch protection for ${repo}@main`);
  console.log(`  enforce_admins: ${rules.enforce_admins?.enabled ?? "?"}`);
  console.log(`  required_approving_review_count: ${reviews?.required_approving_review_count ?? 0}`);
  console.log(`  require_code_owner_reviews: ${reviews?.require_code_owner_reviews ?? false}`);
  console.log(`  dismiss_stale_reviews: ${reviews?.dismiss_stale_reviews ?? false}`);
  console.log(`  require_last_push_approval: ${reviews?.require_last_push_approval ?? false}`);
  console.log(`  required status checks: ${checks ? checks.contexts.join(", ") : "none"}`);
  console.log(`  strict (branch must be up to date): ${checks?.strict ?? false}`);
  if (checks?.checks?.length) {
    // The newer rules API can hold an app_id per check; a mismatch is a silent block.
    for (const check of checks.checks) {
      console.log(`    - ${check.context} (app_id ${check.app_id ?? "any"})`);
    }
  }
  console.log(`  allow_force_pushes: ${rules.allow_force_pushes?.enabled ?? false}`);
  console.log(`  allow_deletions: ${rules.allow_deletions?.enabled ?? false}`);
}

try {
  if (command === "status") {
    await showStatus(await pullRequest());
  } else if (command === "checks") {
    await showChecks(option("number") ? await pullRequest() : null);
  } else if (command === "open") {
    await open();
  } else if (command === "comment") {
    await comment();
  } else if (command === "merge") {
    await merge();
  } else if (command === "protection") {
    await protection();
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
