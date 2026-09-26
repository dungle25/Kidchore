/**
 * Reads the state of the GitHub target repository.
 * Usage: $env:GITHUB_TOKEN='...'; node scripts/gh-status.mjs
 */
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "kidchore-status",
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

const repo = await api("/repos/dungle25/Kidchore");
console.log(`GET /repos/dungle25/Kidchore -> HTTP ${repo.status}`);

if (repo.status !== 200) {
  console.log(`  ${JSON.stringify(repo.body)?.slice(0, 200)}`);
  console.log("\nThe repository does not exist yet.");
  process.exit(2);
}

console.log(`  full_name      : ${repo.body.full_name}`);
console.log(`  private        : ${repo.body.private}`);
console.log(`  default_branch : ${repo.body.default_branch}`);
console.log(`  empty          : ${repo.body.size === 0}`);
console.log(`  permissions    : ${JSON.stringify(repo.body.permissions ?? {})}`);
console.log(`  pushed_at      : ${repo.body.pushed_at}`);

const branches = await api("/repos/dungle25/Kidchore/branches");
console.log(`\nBranches -> HTTP ${branches.status}`);
if (Array.isArray(branches.body)) {
  if (branches.body.length === 0) console.log("  (none)");
  for (const b of branches.body) console.log(`  ${b.name} @ ${b.commit.sha.slice(0, 7)}`);
}

const prs = await api("/repos/dungle25/Kidchore/pulls?state=all&per_page=20");
console.log(`\nPull requests -> HTTP ${prs.status}`);
if (Array.isArray(prs.body)) {
  if (prs.body.length === 0) console.log("  (none)");
  for (const p of prs.body) {
    console.log(`  #${p.number} [${p.state}] ${p.title} (${p.head.ref} -> ${p.base.ref})`);
  }
}

// Can this token push? Only a repo with write access can receive a push.
const canPush = repo.body.permissions?.push === true;
console.log(`\nToken can push to this repo: ${canPush ? "YES" : "NO"}`);
