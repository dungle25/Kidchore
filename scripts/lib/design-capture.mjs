/**
 * Shared pieces for the design-capture scripts.
 *
 * `screenshot-for-design.mjs` and `export-static-html.mjs` differ only in what they write
 * out: a PNG, or a self-contained HTML file. Everything before that is identical - read
 * the environment, find who to sign in as, mint their session, drive the browser already
 * on the machine - and duplicating it would mean two places to fix when the app's routes
 * or the session format change.
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

/** The app's own session cookie. */
export const SESSION_COOKIE = "kidchore_session";

/**
 * The child area is laid out for a tablet in a pair of hands, the parent area for a desk.
 * One viewport would misrepresent half the app, so both scripts use these two.
 */
export const PHONE = { width: 390, height: 844 };
export const DESKTOP = { width: 1440, height: 900 };

/**
 * Every screen worth capturing, with the viewport it is designed for.
 *
 * `fullPage: false` on the child screens: their navigation is fixed to the bottom of the
 * viewport, and a full-page capture of a fixed element puts it in the middle of a tall
 * image instead of where a person sees it.
 */
export const SCREENS = [
  { name: "dang-nhap", route: "/login", who: "anon", viewport: PHONE, fullPage: true },
  { name: "be-hom-nay", route: "/kid/dashboard", who: "child", viewport: PHONE, fullPage: false },
  { name: "be-viec-cua-con", route: "/kid/tasks", who: "child", viewport: PHONE, fullPage: false },
  { name: "be-doi-qua", route: "/kid/rewards", who: "child", viewport: PHONE, fullPage: false },
  { name: "be-thanh-tich", route: "/kid/achievements", who: "child", viewport: PHONE, fullPage: false },
  { name: "bo-me-tong-quan", route: "/parent/dashboard", who: "parent", viewport: DESKTOP, fullPage: true },
  { name: "bo-me-duyet-bai", route: "/parent/chores", who: "parent", viewport: DESKTOP, fullPage: true },
  { name: "bo-me-viec-nha", route: "/parent/tasks", who: "parent", viewport: DESKTOP, fullPage: true },
  { name: "bo-me-gia-dinh", route: "/parent/family", who: "parent", viewport: DESKTOP, fullPage: true },
  { name: "bo-me-phan-thuong", route: "/parent/rewards", who: "parent", viewport: DESKTOP, fullPage: true },
  { name: "bo-me-bao-cao", route: "/parent/reports", who: "parent", viewport: DESKTOP, fullPage: true },
];

/** Reads `.env.local`. Mirrors the other scripts rather than importing a Next.js loader. */
export function loadEnv() {
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

/** The same token the app mints, so the pages render as that person sees them. */
export function mintToken(env, sub, role, name) {
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
 * A parent and a child to sign in as, taken from the real data.
 *
 * The point of these captures is to show the app as it actually looks, so an empty
 * fixture family would defeat it.
 */
export async function loadPeople(env) {
  const { default: pg } = await import("pg");
  const db = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const one = async (role) =>
    (
      await db.query(
        `select display_name, auth_user_id from public.users
          where role = $1 and auth_user_id is not null
          order by created_at limit 1`,
        [role]
      )
    ).rows[0];

  const parent = await one("PARENT");
  const child = await one("CHILD");
  await db.end();
  return { parent, child };
}

/**
 * Starts the Edge or Chrome already on the machine.
 *
 * `playwright-core` deliberately ships no browser, and downloading Chromium for a handful
 * of captures is a few hundred megabytes for nothing. Both failures are reported
 * together: "neither browser could be started" on its own costs an hour of guessing.
 *
 * The bundled Chromium is the last attempt rather than the first, so a developer machine
 * uses the browser it already has and downloads nothing. CI has no branded browser it can
 * rely on, so it installs Chromium (`npx playwright-core install chromium`) and lands here.
 */
export async function launchInstalledBrowser() {
  const { chromium } = await import("playwright-core");
  const errors = [];

  for (const channel of ["msedge", "chrome"]) {
    try {
      const browser = await chromium.launch({ channel });
      return { browser, channel };
    } catch (error) {
      errors.push(
        `${channel}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`
      );
    }
  }

  try {
    const browser = await chromium.launch();
    return { browser, channel: "chromium" };
  } catch (error) {
    errors.push(
      `chromium: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`
    );
  }

  console.error("No browser could be started.");
  for (const line of errors) console.error(`  ${line}`);
  console.error("\nOr download a browser for Playwright: npx playwright-core install chromium");
  process.exit(1);
}

/** The screens a given role can actually reach. */
export function screensFor(screens, tokens) {
  return screens.filter((screen) => screen.who === "anon" || tokens[screen.who]);
}
