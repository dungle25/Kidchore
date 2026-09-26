/**
 * Moves a branch ref back to a given commit through the API.
 *
 * Needed because the branch refuses force-pushes, while an ordinary push can still slip
 * past the ruleset's bypass. This is the way to undo an accidental commit on a protected
 * branch without leaving a revert commit behind.
 *
 * Usage:
 *   $env:GITHUB_TOKEN='...'; node scripts/gh-reset-branch.mjs <branch> <targetSha> [--apply]
 */
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const repo = "dungle25/Kidchore";
const branch = process.argv[2];
let targetSha = process.argv[3];
const apply = process.argv.includes("--apply");

if (!branch || !targetSha) {
  console.error("Usage: node scripts/gh-reset-branch.mjs <branch> <targetSha> [--apply]");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-reset",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function api(path, init) {
  const res = await fetch(`https://api.github.com${path}`, { headers, ...init });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// The refs API rejects an abbreviated sha, so resolve whatever was passed to the full
// 40-character form first. A short sha is far easier to copy from a log.
if (!/^[0-9a-f]{40}$/i.test(targetSha)) {
  const resolved = await api(`/repos/${repo}/commits/${targetSha}`);
  if (resolved.status !== 200) {
    console.error(`Could not resolve ${targetSha}: HTTP ${resolved.status}`);
    process.exit(1);
  }
  console.log(`resolved ${targetSha} -> ${resolved.body.sha}`);
  targetSha = resolved.body.sha;
}

const current = await api(`/repos/${repo}/commits/${branch}`);
console.log(`branch ${branch} is currently at ${current.body?.sha?.slice(0, 7)}`);
console.log(`target commit            ${targetSha.slice(0, 7)}`);

if (current.body?.sha === targetSha) {
  console.log("Already at the target; nothing to do.");
  process.exit(0);
}

// Show what moving the ref would drop, so the change is never a surprise.
const compare = await api(`/repos/${repo}/compare/${targetSha}...${current.body?.sha}`);
if (compare.status === 200) {
  console.log(`\ncommits that would be dropped (${compare.body.ahead_by}):`);
  for (const commit of compare.body.commits ?? []) {
    const filesChanged = commit.files?.length ?? 0;
    console.log(`  ${commit.sha.slice(0, 7)}  ${commit.commit.message.split("\n")[0]}  [${filesChanged} file(s)]`);
  }
  const totalFiles = (compare.body.files ?? []).length;
  console.log(`files differing overall: ${totalFiles}`);
  if (totalFiles > 0) {
    console.log("");
    console.log("WARNING: this move would discard real content changes, not just an empty");
    console.log("commit. Review the list above before applying.");
  }
}

if (!apply) {
  console.log("\nReport only. Re-run with --apply to move the ref.");
  process.exit(0);
}

const res = await api(`/repos/${repo}/git/refs/heads/${branch}`, {
  method: "PATCH",
  body: JSON.stringify({ sha: targetSha, force: true }),
});

if (res.status === 200) {
  console.log(`\nMoved ${branch} to ${res.body.object.sha.slice(0, 7)}`);
} else {
  console.error(`\nFailed: HTTP ${res.status}`);
  console.error(JSON.stringify(res.body, null, 2));
  process.exit(1);
}
