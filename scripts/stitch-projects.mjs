/**
 * Lists the Stitch projects on this account, or creates one.
 *
 * The upload needs a Stitch project id, and that is not the same thing as the Google
 * Cloud project id shown in the Cloud console - a distinction worth a script, because
 * copying the wrong one produces a 404 that explains nothing.
 *
 * The API key is read from `.env.local` (gitignored) as STITCH_API_KEY.
 *
 * Usage:
 *   node scripts/stitch-projects.mjs
 *   node scripts/stitch-projects.mjs --create "KidChore"
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const createIndex = args.indexOf("--create");
const titleToCreate = createIndex === -1 ? null : args[createIndex + 1];

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const apiKey = env.STITCH_API_KEY;
if (!apiKey) {
  console.error("STITCH_API_KEY is not set in .env.local. See .env.example.");
  process.exit(1);
}

if (titleToCreate) {
  if (titleToCreate.startsWith("--")) {
    console.error('--create needs a title, for example: --create "KidChore"');
    process.exit(1);
  }

  const response = await fetch("https://stitch.googleapis.com/v1/projects", {
    method: "POST",
    headers: { "X-Goog-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ title: titleToCreate }),
  });
  const body = await response.text();

  if (!response.ok) {
    console.error(`HTTP ${response.status}`);
    console.error(body.slice(0, 1000));
    process.exit(1);
  }

  const project = JSON.parse(body);
  const id = String(project.name ?? "").replace("projects/", "");
  console.log(`Created "${titleToCreate}"`);
  console.log(`  project id: ${id}`);
  console.log(`\nNext:\n  npm run stitch:upload -- --project-id ${id} --dry-run`);
  process.exit(0);
}

const response = await fetch("https://stitch.googleapis.com/v1/projects?pageSize=50", {
  headers: { "X-Goog-Api-Key": apiKey },
});

if (!response.ok) {
  console.error(`HTTP ${response.status}`);
  console.error((await response.text()).slice(0, 1000));
  process.exit(1);
}

const body = await response.json();
const projects = body.projects ?? [];

console.log(`${projects.length} Stitch project(s) on this account:\n`);
for (const project of projects) {
  const id = String(project.name).replace("projects/", "");
  console.log(`  ${id}`);
  console.log(`    title:   ${project.title ?? "(no title)"}`);
  console.log(`    created: ${project.createTime}`);
}

console.log("\nPass one of those ids to: node scripts/upload-to-stitch.mjs --project-id <id>");
