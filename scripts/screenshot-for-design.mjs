/**
 * Captures the app's screens as PNG images, for design work.
 *
 * Google Stitch takes images as input, and this is the quickest way to get something in
 * front of a designer. For anything serious prefer `export-static-html.mjs`: Stitch can
 * edit HTML, whereas a PNG is only a picture of it.
 *
 * Drives the Edge or Chrome already on the machine through `playwright-core`, which has
 * no browser download of its own. Nothing here writes to the app or the database: it
 * signs a session token exactly the way the app does and renders pages.
 *
 * Usage:
 *   node scripts/screenshot-for-design.mjs [baseUrl] [--out <dir>] [--only <substring>]
 *
 * Defaults to the deployed app. Pass http://localhost:3000 to capture a local run.
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  SCREENS,
  SESSION_COOKIE,
  launchInstalledBrowser,
  loadEnv,
  loadPeople,
  mintToken,
} from "./lib/design-capture.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const outDir = option("out", "design-screenshots");
const only = option("only", null);
const base = args.find((a) => a.startsWith("http")) ?? "https://kidchore-omega.vercel.app";

const env = loadEnv();
const { parent, child } = await loadPeople(env);

if (!parent?.auth_user_id) {
  console.error("No parent with a linked Google account was found. Sign in once as a parent first.");
  process.exit(1);
}

const tokens = {
  parent: mintToken(env, parent.auth_user_id, "PARENT", parent.display_name),
  child: child?.auth_user_id ? mintToken(env, child.auth_user_id, "CHILD", child.display_name) : null,
};

const screens = SCREENS.filter((screen) => !only || screen.name.includes(only));

console.log(`Capturing ${base} for design work`);
console.log(`  parent: ${parent.display_name}`);
console.log(`  child : ${child?.display_name ?? "(none found)"}`);
console.log(`  output: ${outDir}/\n`);

const { browser, channel } = await launchInstalledBrowser();
console.log(`Using the installed ${channel}.\n`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/** Phrases that mean a capture shows an empty list rather than a full one. */
const EMPTY_STATE_HINTS = [
  "không có việc nào",
  "Chưa có việc nào",
  "Chưa có bé nào",
  "chưa có phần thưởng",
  "Chưa có phần thưởng",
];

const captured = [];
const skipped = [];

for (const [index, screen] of screens.entries()) {
  const token = screen.who === "anon" ? null : tokens[screen.who];
  if (screen.who !== "anon" && !token) {
    skipped.push(`${screen.name}: no ${screen.who} account to sign in as`);
    continue;
  }

  // Numbered so the folder sorts in the order a person would walk through the app.
  const file = path.join(outDir, `${String(index + 1).padStart(2, "0")}-${screen.name}.png`);

  const context = await browser.newContext({
    viewport: screen.viewport,
    // Twice the pixels: these images get zoomed into rather than viewed at natural size.
    deviceScaleFactor: 2,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  });

  if (token) {
    await context.addCookies([
      { name: SESSION_COOKIE, value: token, url: base, httpOnly: true, sameSite: "Lax" },
    ]);
  }

  const page = await context.newPage();

  try {
    const response = await page.goto(`${base}${screen.route}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    // Web fonts settle after first paint; without this the first capture of a run has
    // fallback glyphs and the rest do not.
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(400);

    await page.screenshot({ path: file, fullPage: screen.fullPage });

    const text = await page.innerText("body").catch(() => "");
    captured.push({
      name: path.basename(file),
      status: response?.status() ?? 0,
      empty: EMPTY_STATE_HINTS.some((hint) => text.includes(hint)),
      // A page that redirected to sign-in would otherwise look like a good capture.
      onLoginScreen: page.url().includes("/login"),
    });
  } catch (error) {
    skipped.push(`${screen.name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
}

await browser.close();

console.log("Captured:");
for (const shot of captured) {
  const notes = [];
  if (shot.status !== 200) notes.push(`HTTP ${shot.status}`);
  if (shot.onLoginScreen && !shot.name.includes("dang-nhap")) notes.push("ended up on the sign-in screen");
  if (shot.empty) notes.push("empty list — a weaker design reference");
  console.log(`  ${shot.name}${notes.length ? `   (${notes.join("; ")})` : ""}`);
}

if (skipped.length > 0) {
  console.log("\nNot captured:");
  for (const line of skipped) console.log(`  ${line}`);
}

console.log(`\n${captured.length} image(s) in ${outDir}/.`);
