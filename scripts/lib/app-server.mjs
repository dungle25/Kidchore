/**
 * Brings the app up for a suite that needs a real server to talk to.
 *
 * `scripts/test-e2e.mjs` used to own this, and the browser UI suite needs exactly the
 * same behaviour: build, start, wait until it answers, and stop it again afterwards.
 * A second copy would be a second place to fix the day `next start` changes its flags,
 * and the two would drift into "works in the HTTP suite, hangs in the UI suite".
 *
 * The caller owns the returned process and must kill it. Nothing here exits the process
 * on success; a build that fails, or a server that never answers, exits non-zero with a
 * message that says which of the two happened.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** The repository root, resolved from this file rather than from the current directory. */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Runs the Next.js CLI in this repository.
 *
 * Through `node node_modules/next/dist/bin/next` rather than `npx next`: since Node 18.20
 * a `.cmd` shim cannot be spawned without a shell, and `npx` on Windows is `npx.cmd`, so
 * `spawn("npx.cmd", ...)` fails with `EINVAL` on the Node versions this project uses. A
 * shell would work around it but concatenates arguments without escaping, and the path
 * below is what npx would have resolved to anyway, so this is both correct and faster.
 */
function next(args) {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    console.error(`Next.js is not installed at ${nextBin}. Run npm ci first.`);
    process.exit(1);
  }
  return spawn(process.execPath, [nextBin, ...args], { cwd: root, stdio: "inherit" });
}

/**
 * Waits until the app answers on `/login`.
 *
 * `/login` rather than `/`: the entry point redirects, and a redirect is a response the
 * server can only produce once it is actually serving.
 */
export async function waitForServer(base, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/login`, { redirect: "manual" });
      if (res.status > 0) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * Builds (unless told to reuse a build) and starts the app, then waits for it.
 *
 * `next start` serves whatever is in `.next`, which is why the build runs by default:
 * a suite that tested a stale build would report a UI that no longer exists. The one
 * exception is a caller that has just built the app itself - `npm run test:all` runs the
 * HTTP suite first, which builds - and there `reuseBuild` saves a second full build
 * without weakening anything, because the build in `.next` is this run's.
 */
export async function ensureServer({ base = "http://localhost:3000", reuseBuild = false } = {}) {
  const hasBuild = existsSync(path.join(root, ".next", "BUILD_ID"));
  if (!reuseBuild || !hasBuild) {
    console.log("Building the app...");
    const build = next(["build"]);
    const buildCode = await new Promise((resolve) => build.on("exit", resolve));
    if (buildCode !== 0) {
      console.error(`Build failed with exit code ${buildCode}.`);
      process.exit(1);
    }
  } else {
    console.log("Reusing the build already in .next.");
  }

  console.log("Starting the server...");
  const server = next(["start"]);

  const healthy = await waitForServer(base);
  if (!healthy) {
    server.kill();
    console.error(`The server did not answer on ${base} in time.`);
    process.exit(1);
  }
  console.log(`Server is up on ${base}.\n`);
  return server;
}
