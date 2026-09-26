/**
 * Exports each screen as a single self-contained HTML file, for Google Stitch.
 *
 * This is the step Google's own `code-to-design` skill calls `extract-static-html`, and
 * it is the route they recommend for moving an existing web app into Stitch. Uploading
 * HTML gives Stitch the real structure - elements, classes, text - instead of pixels,
 * which is the difference between a design it can edit and a picture of one.
 *
 * The inlining is what makes the file self-contained: every stylesheet, font and image
 * ends up inside the one file, so it renders the same with no server and no network.
 * Google's version of this script uses Puppeteer; this uses the Playwright stack the
 * repository already has, and reuses the session signing the app itself uses so that
 * pages behind a PIN or a Google sign-in can be captured at all.
 *
 * Usage:
 *   node scripts/export-static-html.mjs [baseUrl] [--out <dir>] [--only <substring>]
 *
 * Output goes to `.stitch/`, which is where the rest of the Stitch workflow expects it.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
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
const outDir = option("out", ".stitch");
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
const skipped = screens.filter((screen) => screen.who !== "anon" && !tokens[screen.who]);

console.log(`Exporting self-contained HTML from ${base}`);
console.log(`  parent: ${parent.display_name}`);
console.log(`  child : ${child?.display_name ?? "(none found)"}`);
console.log(`  output: ${outDir}/\n`);

const { browser, channel } = await launchInstalledBrowser();
console.log(`Using the installed ${channel}.\n`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/**
 * Runs inside the page. Turns the live DOM into something that renders with no server.
 *
 * Written as a string rather than a function reference so it survives being handed to
 * `page.evaluate` - and so it is obvious that nothing here has access to Node.
 */
const INLINE_ASSETS = `async function inlineAssets(origin) {
  // 1. Fonts first, because the CSS pass below rewrites @font-face URLs.
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const match = /url\\((['"]?)([^'")]+)\\1\\)/.exec(rule.style.src || "");
      if (!match) continue;
      const url = new URL(match[2], sheet.href || origin);
      // Same-origin only: next/font self-hosts its files, and anything else is third
      // party. A font left unresolved degrades to the fallback, which is fine; a font
      // fetched cross-origin usually fails CORS and takes the whole pass down.
      if (url.origin !== origin) continue;
      try {
        const data = await fetch(url.href).then((r) => r.arrayBuffer());
        const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
        rule.style.src = rule.style.src.replace(match[2], 'data:font/woff2;base64,' + base64);
      } catch { /* leave the URL; the fallback font applies */ }
    }
  }

  // 2. Every stylesheet, flattened to inline <style> tags.
  const css = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.cssRules) css.push(Array.from(sheet.cssRules).map((r) => r.cssText).join("\\n"));
    } catch { /* cross-origin sheet; skip rather than fail the whole capture */ }
  }
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((el) => el.remove());
  const style = document.createElement("style");
  style.textContent = css.join("\\n");
  document.head.appendChild(style);

  // 3. Images, including the srcset entries Next.js generates for /_next/image.
  const toDataUri = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(blob);
    });
  };

  const images = Array.from(document.querySelectorAll("img"));
  let inlined = 0;
  let failed = 0;
  for (const img of images) {
    const src = img.getAttribute("src");
    if (src && !src.startsWith("data:")) {
      try {
        img.setAttribute("src", await toDataUri(new URL(src, origin).href));
        inlined += 1;
      } catch { failed += 1; }
    }
    // A srcset that fails has to go, or the browser prefers the broken candidate over
    // the working src.
    if (img.hasAttribute("srcset")) img.removeAttribute("srcset");
  }
  for (const source of Array.from(document.querySelectorAll("source[srcset]"))) {
    source.removeAttribute("srcset");
  }

  // 4. Scripts, dev overlays and Next's hydration payload: none of it belongs in a
  //    static design file, and all of it is dead weight or noise.
  document.querySelectorAll("script, next-route-announcer, [data-nextjs-toast]").forEach((el) => el.remove());
  document.querySelectorAll("link[rel='preload'], link[rel='prefetch'], link[rel='modulepreload']").forEach((el) => el.remove());

  // 5. Browser chrome, not page content. These point at root-relative paths, which
  //    resolve to the drive root once the file is opened from disk - four failed
  //    requests that look like a broken export and are nothing of the sort. A tab icon
  //    has no meaning in a design file anyway.
  document
    .querySelectorAll("link[rel='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon'], link[rel='mask-icon'], link[rel='manifest']")
    .forEach((el) => el.remove());

  return { inlined, failed, stylesheets: css.length };
}`;

const written = [];

for (const [index, screen] of screens.entries()) {
  const token = screen.who === "anon" ? null : tokens[screen.who];
  if (screen.who !== "anon" && !token) continue;

  const context = await browser.newContext({
    viewport: screen.viewport,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  });
  if (token) {
    await context.addCookies([
      { name: SESSION_COOKIE, value: token, url: base, httpOnly: true, sameSite: "Lax" },
    ]);
  }

  const page = await context.newPage();
  // Numbered so the folder, and the Stitch project, come out in the order a person would
  // walk through the app.
  const file = path.join(outDir, `${String(index + 1).padStart(2, "0")}-${screen.name}.html`);

  try {
    const response = await page.goto(`${base}${screen.route}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    // Next.js hydrates after first paint; capturing before that yields a half-built page.
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const stats = await page.evaluate(`(${INLINE_ASSETS})(${JSON.stringify(new URL(base).origin)})`);

    // The route goes into the title so the screen is identifiable in Stitch.
    await page.evaluate((route) => {
      document.title = route;
    }, screen.route);

    const html = await page.content();
    writeFileSync(file, html, "utf8");

    written.push({
      name: path.basename(file),
      route: screen.route,
      status: response?.status() ?? 0,
      bytes: Buffer.byteLength(html, "utf8"),
      ...stats,
    });
  } catch (error) {
    console.error(`  FAILED  ${screen.name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
}

await browser.close();

// The design system belongs in the same folder, because the upload step takes them one
// after the other and a folder with half of the pair is a trap.
const designSource = path.join("docs", "DESIGN.md");
const hasDesign = existsSync(designSource);
if (hasDesign) {
  copyFileSync(designSource, path.join(outDir, "DESIGN.md"));
}

// A manifest, so the upload step does not have to guess which file is which route. The
// route is what Stitch shows as the screen title, and it is the one thing that has to
// survive the trip from here to there.
writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify(
    {
      base,
      exportedAt: new Date().toISOString(),
      screens: written.map((item) => ({ file: item.name, route: item.route })),
      hasDesignSystem: hasDesign,
    },
    null,
    2
  ),
  "utf8"
);

console.log("Exported:");
for (const item of written) {
  const notes = [];
  if (item.status !== 200) notes.push(`HTTP ${item.status}`);
  if (item.failed > 0) notes.push(`${item.failed} image(s) not inlined`);
  console.log(
    `  ${item.name.padEnd(30)} ${(item.bytes / 1024).toFixed(0)} KB   ${item.inlined} image(s), ${item.stylesheets} stylesheet(s)` +
      (notes.length ? `   (${notes.join("; ")})` : "")
  );
}

if (skipped.length > 0) {
  console.log("\nNot exported:");
  for (const screen of skipped) console.log(`  ${screen.name}: no ${screen.who} account`);
}

console.log(`\n${written.length} file(s) in ${outDir}/, plus manifest.json.`);
console.log("Upload with: npm run stitch:upload -- --project-id <id> --dry-run");
