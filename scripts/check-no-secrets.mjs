/**
 * Fails if a credential is sitting in a file that git would publish.
 *
 * This exists because it happened: a Stitch API key was pasted into `.env.example`, which
 * is the one file `.gitignore` deliberately does **not** ignore - `.env*` is ignored and
 * `.env.example` is un-ignored so the template can be committed. A key pasted into the
 * template is therefore one `git add -A` away from a public repository, and nothing about
 * the file's name or contents says so.
 *
 * The scan covers what a `git add -A` would publish right now: every tracked file, plus
 * every new file that `.gitignore` does not exclude. Both halves matter, and the second one
 * was learned the hard way - a token was written into a brand-new `docs/` file and this
 * check reported "No credentials found", because a file that has not been `git add`ed yet is
 * invisible to `git ls-files`. The minutes between writing a file and staging it are exactly
 * when a pasted credential is most likely to be sitting in one.
 *
 * When git cannot be asked - the sandbox this repository was written in refuses to let Node
 * capture another program's output - it falls back to walking the tree and says so in its
 * output, so an approximate scan is never mistaken for an exact one.
 *
 * False positives to expect, and why they do not fire: `.env.example` contains
 * `postgresql://postgres.<project-ref>:<password>@...`, and every pattern below requires a
 * value with no `<` or `>` in it, so a placeholder cannot look like a secret.
 *
 * Usage: node scripts/check-no-secrets.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Patterns for the credentials this project actually handles, plus the common ones a
 * contributor might paste in. Deliberately narrow: a check that cries wolf gets disabled.
 */
const PATTERNS = [
  { name: "GitHub fine-grained token", re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  // Google's opaque token format, which is what a Stitch API key looks like.
  { name: "Google / Stitch API key", re: /AQ\.[A-Za-z0-9_\-]{30,}/g },
  { name: "Google API key", re: /AIza[A-Za-z0-9_\-]{30,}/g },
  { name: "OpenAI key", re: /sk-[A-Za-z0-9]{20,}/g },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  // Supabase's service_role and anon keys are both long-lived JWTs signed HS256.
  { name: "JWT (a Supabase key looks like this)", re: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_\-]{20,}/g },
  // A real connection string. `<password>` and friends cannot match: see the note above.
  { name: "Postgres URL with a password", re: /postgres(?:ql)?:\/\/[^:\s<>]+:[^@\s<>]{8,}@/g },
];

/** Never published, so a credential here is not a finding. */
const SKIP_DIRS = new Set([".git", "node_modules", ".next", ".stitch", "design-screenshots", ".worktrees"]);

/**
 * Every file a `git add -A` would publish right now.
 *
 * Two lists rather than one. `git ls-files` is what is committed; `--others
 * --exclude-standard` is what is new and not ignored. The second list is the point of the
 * change that added it: a credential pasted into a file that does not exist in git yet is
 * still one command away from being published.
 *
 * Both calls throw together if git cannot be run here, which is what sends the caller to
 * the filesystem fallback.
 */
function filesGitWouldPublish() {
  const list = (args) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean);

  try {
    const tracked = list(["ls-files"]);
    const untracked = list(["ls-files", "--others", "--exclude-standard"]);
    // A path cannot be in both lists, but the Set keeps that from mattering if it ever is.
    return { files: [...new Set([...tracked, ...untracked])], untracked: untracked.length, exact: true };
  } catch {
    return { files: null, untracked: 0, exact: false };
  }
}

/**
 * A small `.gitignore` matcher, for the fallback path only.
 *
 * Without it the fallback reports `.env.local` - the one file a credential is *supposed*
 * to be in - as a finding. A check that cries wolf on its own repository gets switched
 * off, which is worse than not having it.
 *
 * The supported syntax is what this project's `.gitignore` actually uses. Anything else
 * is reported rather than ignored: silently under-scanning is the failure mode that
 * matters here.
 */
function ignoreRules() {
  const lines = readFileSync(".gitignore", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const rules = [];
  for (const line of lines) {
    const negated = line.startsWith("!");
    const body = negated ? line.slice(1) : line;
    const directoryOnly = body.endsWith("/");
    const pattern = body.replace(/^\//, "").replace(/\/$/, "");

    const regex = new RegExp(
      `^${pattern
        .split("**")
        .map((part) => part.split("*").map((piece) => piece.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
        .join(".*")}`
    );

    // A pattern containing a slash is anchored to the repository root; one without is
    // matched against the file name at any depth. Both are how git reads them.
    rules.push({ negated, directoryOnly, anchored: body.includes("/"), regex });
  }
  return rules;
}

function isIgnored(relativePath, rules) {
  const normalised = relativePath.split(path.sep).join("/");
  const name = normalised.split("/").pop();
  let ignored = false;

  for (const rule of rules) {
    const subject = rule.anchored ? normalised : normalised.split("/").pop() ?? normalised;
    const matches = rule.directoryOnly
      ? rule.regex.test(subject) || normalised.includes(`${rule.regex.source.slice(1)}/`)
      : rule.regex.test(subject);
    // `!.env.example` has to be able to win, so the last matching rule decides.
    if (matches && (rule.anchored || rule.regex.test(subject) || rule.regex.test(name))) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

/** The fallback: everything that is neither generated nor listed in `.gitignore`. */
function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else found.push(path.relative(".", full));
  }
  return found;
}

const { files: gitFiles, untracked, exact } = filesGitWouldPublish();
const rules = exact ? [] : ignoreRules();
const files = gitFiles ?? walk(".").filter((file) => !isIgnored(file, rules));

console.log("Checking for credentials in files git would publish...");
if (!exact) {
  console.log(
    "  note: git could not be queried here, so this is a filesystem scan that skips\n" +
      "        anything .gitignore excludes. On CI the scan is exact."
  );
} else if (untracked > 0) {
  // Said out loud so the scope of the scan is never a guess: these files are not committed
  // yet, and they are still in scope because one `git add -A` puts them in a commit.
  console.log(`  including ${untracked} new file(s) that are not committed yet`);
}
console.log(`  ${files.length} file(s), ${PATTERNS.length} pattern(s)\n`);

const findings = [];

for (const file of files) {
  let text;
  try {
    const stats = statSync(file);
    if (!stats.isFile() || stats.size > 2 * 1024 * 1024) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  // A file with a NUL byte in the first block is binary; skip rather than report noise.
  if (text.includes("\0")) continue;

  for (const { name, re } of PATTERNS) {
    // A fresh lastIndex per file, because the patterns are global.
    for (const match of text.matchAll(re)) {
      const value = match[0];
      const line = text.slice(0, match.index).split("\n").length;
      // Never print the whole thing: this output goes into logs and chat messages.
      findings.push({ file, line, name, preview: `${value.slice(0, 8)}…(${value.length} chars)` });
    }
  }
}

if (findings.length === 0) {
  console.log("No credentials found.");
  process.exit(0);
}

console.error(`${findings.length} finding(s):\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.name}  ${finding.preview}`);
}
console.error(
  "\nA credential in a file git would publish is one commit away from a public repository.\n" +
    "Move it to `.env.local` (gitignored) and rotate it - deleting the line does not undo a\n" +
    "push that already happened."
);
process.exit(1);
