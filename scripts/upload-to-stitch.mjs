/**
 * Uploads the exported screens to a Google Stitch project.
 *
 * This is the piece of Google's `code-to-design` workflow that cannot be an MCP call. The
 * official Stitch MCP exposes fifteen tools and not one of them takes a file: a file has
 * to travel as base64, base64 of even a small page is far larger than a model's output
 * limit, and the call gets truncated. Google ships a Python script to work around it;
 * this is the same REST contract in Node, so the repository does not grow a Python
 * dependency to use its own tooling.
 *
 * The contract, read from Google's upload_to_stitch.py:
 *
 *   POST {apiUrl}/v1/projects/{projectId}/screens:batchCreate
 *   X-Goog-Api-Key: <key>
 *
 *   HTML/Markdown ->  screen.htmlCode    + screenType DOCUMENT
 *   Images        ->  screen.screenshot  + screenType IMAGE
 *
 * `requests` is an array, so every screen goes in one call rather than eleven.
 *
 * The API key is read from `.env.local` (gitignored) as STITCH_API_KEY, never from an
 * argument: a key on a command line ends up in shell history and in the process list.
 *
 * Usage:
 *   node scripts/upload-to-stitch.mjs --project-id <id> [--dir .stitch] [--dry-run]
 *
 * Before running for real, pass --dry-run: it prints exactly what would be sent.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const API_URL = "https://stitch.googleapis.com";

/** Straight from Google's script, so the MIME type the API expects is the one it gets. */
const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".html": "text/html",
  ".htm": "text/html",
  ".md": "text/markdown",
};

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const projectId = option("project-id");
const dir = option("dir", ".stitch");
const apiUrl = option("api-url", API_URL);
const dryRun = args.includes("--dry-run");

if (!projectId) {
  console.error("--project-id is required. Find it with: node scripts/stitch-projects.mjs");
  process.exit(1);
}

function loadEnv() {
  return Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

const env = loadEnv();
const apiKey = env.STITCH_API_KEY;
if (!apiKey) {
  console.error("STITCH_API_KEY is not set in .env.local. See .env.example.");
  process.exit(1);
}

const manifestPath = path.join(dir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`${manifestPath} not found. Run: npm run export:html`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

/**
 * Builds one CreateScreenRequest.
 *
 * The route path goes in as the title, which is what Google's skill asks for: it is the
 * only thing that makes a screen identifiable in Stitch later, and after eleven uploads
 * "Screen 7" tells nobody anything.
 */
function buildRequest(file, route) {
  const extension = path.extname(file).toLowerCase();
  const mimeType = MIME_TYPES[extension];
  if (!mimeType) throw new Error(`unsupported file type: ${file}`);

  const fileObject = {
    fileContentBase64: readFileSync(file).toString("base64"),
    mimeType,
  };

  if (mimeType === "text/html" || mimeType === "text/markdown") {
    return {
      screen: {
        htmlCode: fileObject,
        screenType: "DOCUMENT",
        isCreatedByClient: true,
        generatedBy: mimeType === "text/html" ? "UserUploadedHtml" : "UserUploadedUserMd",
        title: route,
      },
    };
  }

  return {
    screen: { screenshot: fileObject, screenType: "IMAGE", isCreatedByClient: true, title: route },
  };
}

const requests = [];
const described = [];

for (const entry of manifest.screens ?? []) {
  const file = path.join(dir, entry.file);
  if (!existsSync(file)) {
    console.error(`missing: ${file}`);
    process.exit(1);
  }
  requests.push(buildRequest(file, entry.route));
  described.push({ file: entry.file, route: entry.route, bytes: statSync(file).size });
}

// The design system is a screen of its own in Stitch, and the next step in Google's
// workflow builds from it.
const designFile = path.join(dir, "DESIGN.md");
if (existsSync(designFile)) {
  requests.push(buildRequest(designFile, "DESIGN.md"));
  described.push({ file: "DESIGN.md", route: "DESIGN.md", bytes: statSync(designFile).size });
}

if (requests.length === 0) {
  console.error(`Nothing to upload in ${dir}/. Run: npm run export:html`);
  process.exit(1);
}

console.log(`Project:  ${projectId}`);
console.log(`Endpoint: ${apiUrl}/v1/projects/${projectId}/screens:batchCreate`);
console.log(`Sending ${requests.length} screen(s):\n`);
for (const item of described) {
  console.log(`  ${item.route.padEnd(22)} ${item.file.padEnd(30)} ${(item.bytes / 1024).toFixed(0)} KB`);
}

if (dryRun) {
  // The key is deliberately not echoed, not even masked: this output is the thing a
  // person pastes into a chat when something goes wrong.
  console.log("\n--dry-run: nothing was sent.");
  process.exit(0);
}

const response = await fetch(`${apiUrl}/v1/projects/${projectId}/screens:batchCreate`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
  body: JSON.stringify({
    parent: `projects/${projectId}`,
    requests,
    createScreenInstances: true,
  }),
});

const body = await response.text();
console.log(`\nHTTP ${response.status}`);

if (!response.ok) {
  console.error(body.slice(0, 2000));
  if (response.status === 403 || response.status === 401) {
    console.error(
      "\nThe key was rejected. Check that STITCH_API_KEY in .env.local is the one from your MCP client config (the X-Goog-Api-Key value)."
    );
  }
  if (response.status === 404) {
    console.error(`\nNo project ${projectId} on this account. List them: node scripts/stitch-projects.mjs`);
  }
  process.exit(1);
}

let created = null;
try {
  created = JSON.parse(body);
} catch {
  // A body that is not JSON is still a success if the status says so; do not pretend
  // otherwise just because it cannot be parsed.
}

const screens = created?.screens ?? [];
console.log(`Created ${screens.length || requests.length} screen(s).`);
for (const screen of screens) console.log(`  ${screen.name ?? "?"}  ${screen.title ?? ""}`);
console.log(`\nOpen Stitch and the screens are in project ${projectId}.`);
