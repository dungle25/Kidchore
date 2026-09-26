/**
 * Adds an empty commit on top of a branch through the API.
 *
 * Used to record that an accidental empty commit is being undone, on a branch that
 * refuses force-pushes. The commit carries no file changes, so it only affects history,
 * not content.
 *
 * Usage:
 *   $env:GITHUB_TOKEN='...'; node scripts/gh-empty-commit.mjs <branch> "<message>" [--apply]
 */
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const repo = "dungle25/Kidchore";
const branch = process.argv[2];
const message = process.argv[3];
const apply = process.argv.includes("--apply");

if (!branch || !message) {
  console.error('Usage: node scripts/gh-empty-commit.mjs <branch> "<message>" [--apply]');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-empty-commit",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function api(path, init) {
  const res = await fetch(`https://api.github.com${path}`, { headers, ...init });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const head = await api(`/repos/${repo}/git/ref/heads/${branch}`);
if (head.status !== 200) {
  console.error(`Could not read ${branch}: HTTP ${head.status}`);
  process.exit(1);
}
const parentSha = head.body.object.sha;
const parent = await api(`/repos/${repo}/git/commits/${parentSha}`);

console.log(`branch ${branch} at ${parentSha.slice(0, 7)}`);
console.log(`tree   ${parent.body.tree.sha.slice(0, 7)} (unchanged by this commit)`);
console.log(`message: ${message.split("\n")[0]}`);

if (!apply) {
  console.log("\nReport only. Re-run with --apply to create the commit.");
  process.exit(0);
}

const created = await api(`/repos/${repo}/git/commits`, {
  method: "POST",
  body: JSON.stringify({
    message,
    tree: parent.body.tree.sha,
    parents: [parentSha],
  }),
});

if (created.status !== 201) {
  console.error(`Could not create the commit: HTTP ${created.status}`);
  console.error(JSON.stringify(created.body, null, 2));
  process.exit(1);
}
console.log(`\ncreated commit ${created.body.sha.slice(0, 7)}`);

const moved = await api(`/repos/${repo}/git/refs/heads/${branch}`, {
  method: "PATCH",
  body: JSON.stringify({ sha: created.body.sha, force: false }),
});

if (moved.status === 200) {
  console.log(`moved ${branch} to ${moved.body.object.sha.slice(0, 7)}`);
} else {
  console.error(`Could not move the ref: HTTP ${moved.status}`);
  console.error(JSON.stringify(moved.body, null, 2));
  console.error("");
  console.error("A fast-forward was refused, which means the branch is protected against");
  console.error("this too. The commit was created but the branch was not updated.");
  process.exit(1);
}
