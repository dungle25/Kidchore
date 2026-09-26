/**
 * Captures the app's screens as images, for design work.
 *
 * Google Stitch takes images as input - a screenshot of an existing UI is an official way
 * to start a design there - and there is no way to import code. So getting this app into
 * Stitch means photographing it, and doing that by hand across eleven screens, with a PIN
 * for the child area and a Google sign-in for the parent area, is the part worth
 * automating.
 *
 * Drives the Edge or Chrome already on the machine through `playwright-core`, which has
 * no browser download of its own. Nothing here writes to the app or the database: it
 * signs a session token exactly the way the app does and renders pages.
 *
 * Usage:
 *   node scripts/screenshot-for-design.mjs [baseUrl] [--out <dir>]
 *
 * Defaults to the deployed app. Pass http://localhost:3000 to capture a local run.
 */
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outDir = outIndex === -1 ? "design-screenshots" : args[outIndex + 1];
const base = args.find((a) => a.startsWith("http")) ?? "https://kidchore-omega.vercel.app";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SESSION_COOKIE = "kidchore_session";

/** The same token the app mints, so the pages render as that person sees them. */
function mintToken(sub, role, name) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: "supabase",
    sub,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 3600,
    app_role: role,
    app_name: name,
  })}`;
  return `${input}.${createHmac("sha256", env.SUPABASE_JWT_SECRET).update(input).digest("base64url")}`;
}

/**
 * A phone for the child area, a laptop for the parent area.
 *
 * The two halves of the app are laid out for different devices on purpose - a child holds
 * a tablet, a parent reviews on a desk - so one viewport would misrepresent half of it.
 */
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/**
 * `fullPage: false` for the child screens.
 *
 * Their navigation is fixed to the bottom of the viewport, and a full-page capture of a
 * fixed element lands it in the middle of a tall image instead of where a person sees it.
 * The child screens are short enough that the viewport is the whole screen anyway.
 */
const SCREENS = [
  { name: "01-dang-nhap", path: "/login", who: "anon", viewport: PHONE, fullPage: true },
  { name: "02-be-hom-nay", path: "/kid/dashboard", who: "child", viewport: PHONE, fullPage: false },
  { name: "03-be-viec-cua-con", path: "/kid/tasks", who: "child", viewport: PHONE, fullPage: false },
  { name: "04-be-doi-qua", path: "/kid/rewards", who: "child", viewport: PHONE, fullPage: false },
  { name: "05-be-thanh-tich", path: "/kid/achievements", who: "child", viewport: PHONE, fullPage: false },
  { name: "06-bo-me-tong-quan", path: "/parent/dashboard", who: "parent", viewport: DESKTOP, fullPage: true },
  { name: "07-bo-me-duyet-bai", path: "/parent/chores", who: "parent", viewport: DESKTOP, fullPage: true },
  { name: "08-bo-me-viec-nha", path: "/parent/tasks", who: "parent", viewport: DESKTOP, fullPage: true },
  { name: "09-bo-me-gia-dinh", path: "/parent/family", who: "parent", viewport: DESKTOP, fullPage: true },
  { name: "10-bo-me-phan-thuong", path: "/parent/rewards", who: "parent", viewport: DESKTOP, fullPage: true },
  { name: "11-bo-me-bao-cao", path: "/parent/reports", who: "parent", viewport: DESKTOP, fullPage: true },
];

/** Phrases that mean the screenshot shows an empty list rather than a full one. */
const EMPTY_STATE_HINTS = [
  "không có việc nào",
  "Chưa có việc nào",
  "Chưa có bé nào",
  "chưa có phần thưởng",
  "Chưa có phần thưởng",
];

async function loadPeople() {
  const db = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const parent = (
    await db.query(
      `select display_name, auth_user_id from public.users
        where role = 'PARENT' and auth_user_id is not null
        order by created_at limit 1`
    )
  ).rows[0];
  const child = (
    await db.query(
      `select display_name, auth_user_id from public.users
        where role = 'CHILD' and auth_user_id is not null
        order by created_at limit 1`
    )
  ).rows[0];
  await db.end();
  return { parent, child };
}

const { parent, child } = await loadPeople();

if (!parent?.auth_user_id) {
  console.error(
    "No parent with a linked Google account was found. Sign in once as a parent before capturing."
  );
  process.exit(1);
}

const tokens = {
  parent: mintToken(parent.auth_user_id, "PARENT", parent.display_name),
  child: child?.auth_user_id ? mintToken(child.auth_user_id, "CHILD", child.display_name) : null,
};

console.log(`Capturing ${base} for design work`);
console.log(`  parent: ${parent.display_name}`);
console.log(`  child : ${child?.display_name ?? "(none found)"}`);
console.log(`  output: ${outDir}/\n`);

const { chromium } = await import("playwright-core");

// The browser already on the machine. Downloading Chromium for one screenshot run is a
// few hundred megabytes for nothing.
let browser = null;
const launchErrors = [];
for (const channel of ["msedge", "chrome"]) {
  try {
    browser = await chromium.launch({ channel });
    console.log(`Using the installed ${channel}.\n`);
    break;
  } catch (error) {
    // Kept, not swallowed: "neither browser could be started" with no reason is the kind
    // of message that costs an hour.
    launchErrors.push(`${channel}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}
if (!browser) {
  console.error("Neither Edge nor Chrome could be started.");
  for (const line of launchErrors) console.error(`  ${line}`);
  console.error("\nOr download a browser for Playwright: npx playwright install chromium");
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const captured = [];
const skipped = [];

for (const screen of SCREENS) {
  const token = screen.who === "anon" ? null : tokens[screen.who];

  if (screen.who !== "anon" && !token) {
    skipped.push(`${screen.name}: no ${screen.who} account to sign in as`);
    continue;
  }

  const context = await browser.newContext({
    viewport: screen.viewport,
    // Twice the pixels, because these images are going to a design tool where they get
    // zoomed into rather than viewed at their natural size.
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
  const file = path.join(outDir, `${screen.name}.png`);

  try {
    const response = await page.goto(`${base}${screen.path}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    // Web fonts settle after first paint; without this the first screenshot of a run has
    // fallback glyphs and the rest do not.
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(400);

    await page.screenshot({ path: file, fullPage: screen.fullPage });

    const text = await page.innerText("body").catch(() => "");
    const empty = EMPTY_STATE_HINTS.some((hint) => text.includes(hint));

    captured.push({
      name: screen.name,
      status: response?.status() ?? 0,
      empty,
      // A page that redirected to sign-in would otherwise look like a successful capture.
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
  if (shot.onLoginScreen && shot.name !== "01-dang-nhap") notes.push("ended up on the sign-in screen");
  if (shot.empty) notes.push("empty list — a weaker design reference");
  console.log(`  ${shot.name}.png${notes.length ? `   (${notes.join("; ")})` : ""}`);
}

if (skipped.length > 0) {
  console.log("\nNot captured:");
  for (const line of skipped) console.log(`  ${line}`);
}

console.log(
  `\n${captured.length} image(s) in ${outDir}/. Upload them to stitch.withgoogle.com — the MCP has no image upload.`
);
