/**
 * Browser UI regression suite.
 *
 * Why this exists next to `scripts/test-e2e.mjs`: that suite proves the *server* renders
 * the right data, by fetching HTML and looking for strings. It cannot see any of what a
 * person actually experiences - a layout that collapses, a button that stops responding,
 * a client component that throws on hydration, a navigation bar that ends up off-screen,
 * an active tab that stops being marked, a tap target that shrinks below a thumb. Those
 * are exactly the changes a UI edit makes, and none of them change the HTML the HTTP
 * suite reads.
 *
 * So this suite drives a real browser against the real app:
 *   * it renders every screen for a parent and a child, at the viewport each is designed
 *     for, and fails on a page error or a console error;
 *   * it signs a child in through the PIN screen rather than minting a cookie, so the
 *     sign-in UI is covered rather than bypassed;
 *   * it presses the buttons a child presses and checks what appears;
 *   * it asserts the layout contracts that are in the code as Tailwind classes (the fixed
 *     bottom bar, the sidebar that appears at `md`, the desktop-only/mobile-only halves
 *     of the parent navigation) instead of trusting that a class edit was harmless.
 *
 * Run it whenever UI changes - by hand with `npm run test:ui`, or through
 * `npm run test:all`, which is what CI runs. It needs a real project (it creates its own
 * family and removes it again) and a browser: it drives the Edge or Chrome already on the
 * machine through `playwright-core`, which ships no browser of its own.
 *
 * Usage:
 *   node scripts/test-ui.mjs [baseUrl] [--start-server] [--reuse-build]
 *
 * `--start-server` builds and starts the app itself. `--reuse-build` skips the build,
 * which is what `npm run test:all` passes because the suite before it has just built.
 */
import pg from "pg";
import {
  DESKTOP,
  PHONE,
  SESSION_COOKIE,
  launchInstalledBrowser,
  loadEnv,
  mintToken,
} from "./lib/design-capture.mjs";
import { ensureServer, root } from "./lib/app-server.mjs";

const args = process.argv.slice(2);
const startServer = args.includes("--start-server");
const reuseBuild = args.includes("--reuse-build");
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000";

// The suites are run from the repository root, and reading `.env.local` is relative.
// Resolving from this file instead would mean a second path convention to keep in step.
process.chdir(root);

const env = loadEnv();

/** A proof-image URL shaped like the ones the bucket serves. Nothing fetches it. */
const PROOF_URL = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/proof-images/${encodeURIComponent("__ui__/proof.jpg")}`;

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    failures.push(`${label}${detail ? ` :: ${detail}` : ""}`);
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTH_PARENT = "55555555-5555-4555-8555-555555555555";
const AUTH_CHILD = "66666666-6666-4666-8666-666666666666";
const FAMILY_NAME = "__UI_FAMILY__";
const PARENT_NAME = "UI Phụ Huynh";
const CHILD_NAME = "UI Bé";
const CHILD_USERNAME = "uibec";
const CHILD_PIN = "2468";

const TASK_PLAIN = "UI Việc thường";
const TASK_NEEDS_PHOTO = "UI Việc cần ảnh";
const TASK_SUBMITTED = "UI Việc đã gửi";
const REWARD_TITLE = "UI Phần thưởng";

let browser = null;
let managedServer = null;
let db = null;
const createdFamilyIds = [];

const dbClient = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * The identities the fixtures hang off. `auth_user_id` has a real foreign key to
 * `auth.users`, so the rows must exist there first - created the same way migration
 * 0005 provisions a child, so the suite does not test a link the app never has.
 */
async function createAuthUser(id, email) {
  await dbClient.query("delete from auth.identities where user_id = $1", [id]);
  await dbClient.query("delete from auth.users where id = $1", [id]);
  await dbClient.query(
    `insert into auth.users (
       id, instance_id, aud, role, email,
       encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new, email_change
     ) values (
       $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2::varchar,
       extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 10)), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
       '{}'::jsonb, now(), now(), '', '', '', ''
     )`,
    [id, email]
  );
  await dbClient.query(
    `insert into auth.identities (
       id, user_id, provider_id, identity_data, provider,
       last_sign_in_at, created_at, updated_at
     ) values (
       gen_random_uuid(), $1::uuid, $1::text,
       jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
       'email', now(), now(), now()
     )`,
    [id, email]
  );
}

async function createFixtures() {
  await dbClient.query("delete from public.families where family_name = $1", [FAMILY_NAME]);

  await createAuthUser(AUTH_PARENT, "ui.parent@example.com");
  await createAuthUser(AUTH_CHILD, "ui.child@example.com");

  const family = await dbClient.query(
    "insert into public.families (family_name) values ($1) returning id",
    [FAMILY_NAME]
  );
  createdFamilyIds.push(family.rows[0].id);
  const familyId = family.rows[0].id;

  await dbClient.query(
    `insert into public.users (family_id, role, display_name, email, auth_user_id)
     values ($1, 'PARENT', $2, 'ui.parent@example.com', $3)`,
    [familyId, PARENT_NAME, AUTH_PARENT]
  );

  // The avatar is set here rather than through public.set_child_avatar(): that function
  // authorizes through auth.uid(), which a plain database connection does not have, and
  // its authorization path is already covered by scripts/test-e2e.mjs. What the UI suite
  // needs is a child who already has an avatar, so the picker can be checked in its
  // "change it" state rather than its "choose one" state.
  const child = await dbClient.query(
    `insert into public.users
       (family_id, role, display_name, username, avatar_url, auth_user_id, pin_code)
     values ($1, 'CHILD', $2, $3, 'dino', $4, public.hash_pin($5)) returning id`,
    [familyId, CHILD_NAME, CHILD_USERNAME, AUTH_CHILD, CHILD_PIN]
  );
  const childId = child.rows[0].id;

  // Three chores, because the child's list renders differently by state and the whole
  // point of the grouping is that each state lands in the right section.
  const plain = await dbClient.query(
    `insert into public.tasks (family_id, title, description, points_reward, recurrence, assigned_to_user_id)
     values ($1, $2, 'Mô tả thường', 5, 'DAILY', $3) returning id`,
    [familyId, TASK_PLAIN, childId]
  );
  await dbClient.query(
    `insert into public.task_instances (task_id, assigned_child_id, due_date, status)
     values ($1, $2, current_date, 'PENDING')`,
    [plain.rows[0].id, childId]
  );

  const needsPhoto = await dbClient.query(
    `insert into public.tasks
       (family_id, title, description, points_reward, recurrence, assigned_to_user_id, require_proof_image)
     values ($1, $2, 'Phải gửi ảnh', 9, 'DAILY', $3, true) returning id`,
    [familyId, TASK_NEEDS_PHOTO, childId]
  );
  await dbClient.query(
    `insert into public.task_instances (task_id, assigned_child_id, due_date, status)
     values ($1, $2, current_date, 'PENDING')`,
    [needsPhoto.rows[0].id, childId]
  );

  const submitted = await dbClient.query(
    `insert into public.tasks (family_id, title, description, points_reward, recurrence, assigned_to_user_id)
     values ($1, $2, 'Đang chờ duyệt', 3, 'DAILY', $3) returning id`,
    [familyId, TASK_SUBMITTED, childId]
  );
  await dbClient.query(
    `insert into public.task_instances
       (task_id, assigned_child_id, due_date, status, proof_image_url)
     values ($1, $2, current_date, 'SUBMITTED', $3)`,
    [submitted.rows[0].id, childId, PROOF_URL]
  );

  await dbClient.query(
    `insert into public.rewards (family_id, title, points_required, stock)
     values ($1, $2, 10, -1)`,
    [familyId, REWARD_TITLE]
  );

  return familyId;
}

/**
 * The PIN card a given child is rendered in.
 *
 * Every child profile in the database is on the sign-in screen - that is what
 * `list_child_profiles()` returns, so the screen can show tappable avatars - which means
 * the "Vào" button is not unique to this child and has to be scoped to their own card.
 * The card is found by the handle printed under the child's name.
 */
function pinCard(page, username) {
  return page.locator("form").filter({ has: page.getByText(`@${username}`, { exact: true }) });
}

/**
 * The card a chore is rendered in.
 *
 * Anchored on the chore's own heading - the text is the part that must not change without
 * somebody noticing - and then walked up to the nearest card. The class is what makes the
 * two "Đã làm xong" buttons distinguishable: both cards carry the same button, and
 * without the scope a click would match two elements and fail as ambiguous.
 */
function cardFor(page, title) {
  return page
    .getByRole("heading", { name: title, exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
}

// ---------------------------------------------------------------------------
// Browser plumbing
// ---------------------------------------------------------------------------

/**
 * Console errors that are not the app's fault.
 *
 * The fixture points its proof photo at a storage object that does not exist - the upload
 * path is covered by scripts/test-storage-upload.mjs - and Chromium reports the failed
 * image load as a console error. Anything else is a genuine finding: a hydration
 * mismatch, a thrown client component, a broken import.
 */
const IGNORED_CONSOLE = [/Failed to load resource.*\/storage\/v1\/object\/public\/proof-images\//];

/** A context that fails loudly if the page throws, which is the point of the sweep. */
async function newContext({ viewport, token }) {
  const context = await browser.newContext({
    viewport,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  });

  const errors = [];
  context.on("page", (page) => {
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
      errors.push(`console: ${text}`);
    });
  });

  if (token) {
    await context.addCookies([
      { name: SESSION_COOKIE, value: token, url: base, httpOnly: true, sameSite: "Lax" },
    ]);
  }

  return { context, errors };
}

/**
 * Opens a screen and waits for it to settle.
 *
 * `networkidle` rather than `load`: several screens fetch after paint, and a check that
 * runs before that has arrived would be testing a loading state.
 */
async function visit(page, route, { expectStatus = 200 } = {}) {
  const response = await page.goto(`${base}${route}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const status = response?.status() ?? 0;
  if (expectStatus !== null) {
    check(`GET ${route} responds ${expectStatus}`, status === expectStatus, `status=${status}`);
  } else {
    check(`GET ${route} responds`, status > 0 && status < 400, `status=${status}`);
  }
  return status;
}

const parentToken = mintToken(env, AUTH_PARENT, "PARENT", PARENT_NAME);
const childToken = mintToken(env, AUTH_CHILD, "CHILD", CHILD_NAME);

/**
 * Waits for something to appear, and reports whether it did.
 *
 * `check()` on its own is an instantaneous question, and asking it one line after a
 * navigation races the render: the URL changes before the DOM does, so an assertion can
 * run against the previous screen and report a missing heading that is about to arrive.
 * Every check whose subject has just been navigated to goes through here first.
 *
 * Two matching rules that are easy to get wrong, both of which produced false failures
 * while this suite was being written:
 *   * a regex given as an accessible name is matched against the **whole** name, so
 *     `/Chào Bé/` does not match "Chào Bé! 👋" while the plain string does;
 *   * a plain string is a case-insensitive substring match, which is what these checks
 *     want, because the emoji and punctuation around a heading are not the point.
 */
async function appears(locator, timeout = 15_000) {
  return locator
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

/** Lets a freshly navigated page finish rendering and fetching. */
async function settle(page) {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

try {
  // The browser comes up before anything is written, so a machine with no browser
  // installed leaves no fixtures behind.
  const launched = await launchInstalledBrowser();
  browser = launched.browser;

  if (startServer) {
    managedServer = await ensureServer({ base, reuseBuild });
  } else {
    try {
      await fetch(`${base}/login`, { redirect: "manual" });
    } catch {
      console.error(
        `\nCannot reach ${base}. Start the app first (npm run dev, or npm run build && npm start), or pass --start-server.`
      );
      process.exit(1);
    }
  }

  console.log(`\nDriving ${base} with the installed ${launched.channel}.`);

  db = dbClient;
  await db.connect();
  await createFixtures();
  console.log("Fixtures created.");

  // ---- 1. The sign-in screen, as an anonymous visitor sees it ----
  section("1. Sign-in screen");
  {
    const { context, errors } = await newContext({ viewport: PHONE });
    const page = await context.newPage();

    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: 15_000 }).catch(() => {});
    check(
      "an anonymous visitor at / is sent to the sign-in screen",
      page.url().includes("/login"),
      `url=${page.url()}`
    );
    await settle(page);

    check(
      "the screen separates the two audiences",
      (await appears(page.getByRole("heading", { name: "Dành cho bố/mẹ" }))) &&
        (await appears(page.getByRole("heading", { name: "Dành cho các bé" }))),
      "one of the two section headings is missing"
    );
    check(
      "it offers the Google button for parents",
      await appears(page.getByRole("button", { name: "Đăng nhập bằng Google" })),
      "Google button not visible"
    );
    check(
      "it lists this family's child by name and handle",
      (await appears(page.getByText(CHILD_NAME, { exact: true }))) &&
        (await appears(page.getByText(`@${CHILD_USERNAME}`, { exact: true }))),
      "the child profile card is not on the screen"
    );

    // A wrong PIN has to say so on the screen rather than do nothing.
    await page.getByLabel(`Mã PIN của ${CHILD_NAME}`).fill("0000");
    await pinCard(page, CHILD_USERNAME).getByRole("button", { name: "Vào" }).click();
    const alert = page.getByRole("alert");
    await alert.waitFor({ timeout: 15_000 }).catch(() => {});
    check(
      "a wrong PIN shows an error on the screen",
      (await alert.count()) > 0 && page.url().includes("/login"),
      `alerts=${await alert.count()} url=${page.url()}`
    );

    check("the sign-in screen logs no browser errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // ---- 2. A child signs in through the PIN screen ----
  section("2. Child signs in through the UI");
  {
    const { context, errors } = await newContext({ viewport: PHONE });
    const page = await context.newPage();

    await visit(page, "/login");
    await page.getByLabel(`Mã PIN của ${CHILD_NAME}`).fill(CHILD_PIN);
    await pinCard(page, CHILD_USERNAME).getByRole("button", { name: "Vào" }).click();
    await page.waitForURL(/\/kid\/dashboard/, { timeout: 20_000 }).catch(() => {});
    check(
      "the correct PIN signs the child in and lands on their home screen",
      page.url().includes("/kid/dashboard"),
      `url=${page.url()}`
    );
    await settle(page);

    check(
      "the home screen greets the child by name",
      await appears(page.getByRole("heading", { name: `Chào ${CHILD_NAME}` })),
      "greeting heading missing"
    );
    check(
      "the navigation says whose profile is open",
      await appears(page.getByText(`Đang dùng: ${CHILD_NAME}`)),
      "the profile line is missing from the child navigation"
    );
    check(
      "the points card is on the home screen",
      await appears(page.getByText("Điểm của con", { exact: true })),
      "points balance card missing"
    );
    check(
      "the child's chore is listed",
      await appears(page.getByRole("heading", { name: TASK_PLAIN })),
      "the fixture chore is not on the screen"
    );

    // ---- 3. Submitting a chore, which is the child's main action ----
    // Both wait states and the grouping are asserted through the DOM markers the app
    // renders for exactly this purpose (`data-group` on the heading), rather than by
    // searching the page for the words - "Chưa làm" is both a heading and a card's status
    // label, so a text search would not say which of the two it found.
    section("3. A child submits a chore");
    const groupCount = async (key) =>
      Number(
        (
          await page.locator(`[data-group="${key}"] span`).last().innerText()
        ).trim()
      );

    const todoBefore = await groupCount("todo");
    check(
      "the two unfinished chores are counted under the todo heading",
      todoBefore === 2,
      `count=${todoBefore}`
    );

    const plainCard = cardFor(page, TASK_PLAIN);
    await plainCard.getByRole("button", { name: /Đã làm xong/ }).click();
    const status = page.getByRole("status");
    await status.waitFor({ timeout: 20_000 }).catch(() => {});
    check(
      "sending a chore confirms it on the screen",
      (await status.innerText().catch(() => "")).includes(`Đã gửi “${TASK_PLAIN}”`),
      `status="${await status.innerText().catch(() => "")}"`
    );
    check(
      "the card moves to the waiting state",
      (await plainCard.getByText("Chờ bố/mẹ duyệt").count()) === 1,
      "the card still reads as unfinished"
    );
    check(
      "and it is no longer counted as unfinished",
      (await groupCount("todo")) === 1,
      `count=${await groupCount("todo")}`
    );

    // A chore that requires a photo must refuse to be sent without one.
    const photoCard = cardFor(page, TASK_NEEDS_PHOTO);
    await photoCard.getByRole("button", { name: /Đã làm xong/ }).click();
    await page.waitForTimeout(500);
    check(
      "a chore that needs a photo refuses to send without one",
      (await status.innerText().catch(() => "")).includes("cần ảnh bằng chứng"),
      `status="${await status.innerText().catch(() => "")}"`
    );
    check(
      "and it stays unfinished",
      (await groupCount("todo")) === 1,
      `count=${await groupCount("todo")}`
    );

    // The card state above is client state; a reload proves the submit reached the server.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    check(
      "the submitted chore is still submitted after a reload",
      (await cardFor(page, TASK_PLAIN).getByText("Chờ bố/mẹ duyệt").count()) === 1,
      "the submission did not persist"
    );
    check(
      "and it is filed under the waiting group",
      (await page.locator('[data-group="waiting"] span').last().innerText()).trim() === "2",
      `waiting count=${await page.locator('[data-group="waiting"] span').last().innerText()}`
    );

    // ---- 4. Navigation between the child screens ----
    section("4. Child navigation");
    const kidNav = page.locator("nav.fixed");
    await kidNav.getByRole("link", { name: "Việc của con" }).click();
    await page.waitForURL(/\/kid\/tasks/, { timeout: 15_000 }).catch(() => {});
    check("tapping a nav item opens that screen", page.url().includes("/kid/tasks"), `url=${page.url()}`);
    check(
      "the open screen is marked in the navigation",
      (await kidNav.getByRole("link", { name: "Việc của con" }).getAttribute("aria-current")) ===
        "page",
      "aria-current is not on the open screen's link"
    );

    await kidNav.getByRole("link", { name: "Đổi quà" }).click();
    await page.waitForURL(/\/kid\/rewards/, { timeout: 15_000 }).catch(() => {});
    check(
      "the reward shop lists the family's reward",
      page.url().includes("/kid/rewards") &&
        (await page.getByText(REWARD_TITLE).count()) > 0,
      `url=${page.url()}`
    );

    await kidNav.getByRole("link", { name: "Thành tích" }).click();
    await page.waitForURL(/\/kid\/achievements/, { timeout: 15_000 }).catch(() => {});
    check(
      "the achievements screen opens",
      page.url().includes("/kid/achievements"),
      `url=${page.url()}`
    );

    await kidNav.getByRole("link", { name: "Hôm nay" }).click();
    await page.waitForURL(/\/kid\/dashboard/, { timeout: 15_000 }).catch(() => {});
    check("and back to today", page.url().includes("/kid/dashboard"), `url=${page.url()}`);

    // ---- 5. Layout contracts on a tablet-sized screen ----
    section("5. Child layout contracts");
    const nav = page.locator("nav.fixed");
    const navBox = await nav.boundingBox();
    check(
      "the child navigation is pinned to the bottom of the viewport",
      Boolean(navBox) && Math.abs(navBox.y + navBox.height - PHONE.height) <= 2,
      navBox ? `nav bottom=${Math.round(navBox.y + navBox.height)} viewport=${PHONE.height}` : "no nav"
    );
    check(
      "it spans the full width",
      Boolean(navBox) && Math.abs(navBox.width - PHONE.width) <= 2,
      navBox ? `nav width=${Math.round(navBox.width)} viewport=${PHONE.width}` : "no nav"
    );

    // 44px is the tap-target minimum the parent navigation documents; the child bar is
    // the one that gets used by a six-year-old, so it is the one worth measuring.
    const linkBox = await page.getByRole("link", { name: "Hôm nay" }).boundingBox();
    check(
      "its tap targets are at least 44px tall",
      Boolean(linkBox) && linkBox.height >= 44,
      linkBox ? `height=${Math.round(linkBox.height)}` : "no box"
    );

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    check(
      "the screen does not scroll sideways on a phone",
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`
    );

    check("the child screens log no browser errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // ---- 6. The parent area, at the width it is designed for ----
  section("6. Parent screens at desktop width");
  {
    const { context, errors } = await newContext({ viewport: DESKTOP, token: parentToken });
    const page = await context.newPage();

    await visit(page, "/parent/dashboard");
    const sidebar = page.locator("aside");
    check(
      "the desktop sidebar is shown and the mobile bar is not",
      (await sidebar.isVisible()) &&
        !(await page.locator("nav.fixed").isVisible()),
      `sidebar=${await sidebar.isVisible()} bottomBar=${await page.locator("nav.fixed").isVisible()}`
    );
    check(
      "the sidebar names the family",
      (await sidebar.getByText(FAMILY_NAME).count()) === 1,
      "family name missing from the sidebar"
    );
    for (const label of ["Tổng quan", "Duyệt việc", "Việc", "Thưởng", "Báo cáo", "Gia đình"]) {
      check(
        `the parent navigation offers "${label}"`,
        (await page.getByRole("link", { name: label, exact: true }).count()) > 0,
        "nav item missing"
      );
    }
    check(
      "the open screen is marked in the parent navigation",
      (await page
        .getByRole("link", { name: "Tổng quan", exact: true })
        .getAttribute("aria-current")) === "page",
      "aria-current is not on Tổng quan"
    );

    await visit(page, "/parent/chores");
    check(
      "the approval queue groups the submission under the child",
      (await page.locator("[data-child-heading]").count()) === 1 &&
        (await page.getByRole("heading", { name: TASK_SUBMITTED }).count()) === 1,
      "the submitted chore is not in the queue"
    );
    check(
      "the proof photo is offered to the parent",
      (await page.locator(`img[src="${PROOF_URL}"]`).count()) === 1,
      "proof image missing"
    );

    await visit(page, "/parent/tasks");
    check(
      "the tasks screen lists the chore and the quick-add catalogue",
      (await page.getByText(TASK_PLAIN).count()) > 0 &&
        (await page.getByText("Thêm nhanh việc thường làm").count()) > 0,
      "chore or quick-add panel missing"
    );

    await visit(page, "/parent/rewards");
    check(
      "the rewards screen lists the family's reward",
      (await page.getByText(REWARD_TITLE).count()) > 0,
      "reward missing"
    );

    await visit(page, "/parent/family");
    check(
      "the family screen offers to change the child's avatar",
      (await page.getByText(`Đổi ảnh cho ${CHILD_NAME}`).count()) === 1,
      "avatar picker missing"
    );

    await visit(page, "/parent/reports");
    check(
      "the reports screen renders",
      (await page.locator("main").count()) > 0,
      "no main element"
    );

    check("the parent screens log no browser errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // ---- 7. The parent layout at phone width ----
  section("7. Parent screens at phone width");
  {
    const { context, errors } = await newContext({ viewport: PHONE, token: parentToken });
    const page = await context.newPage();

    await visit(page, "/parent/dashboard");
    const bottomBarVisible = await page.locator("nav.fixed").isVisible();
    const sidebarVisible = await page.locator("aside").isVisible();
    check(
      "the sidebar gives way to the bottom bar below the md breakpoint",
      bottomBarVisible && !sidebarVisible,
      `bottomBar=${bottomBarVisible} sidebar=${sidebarVisible}`
    );
    const barBox = await page.locator("nav.fixed").boundingBox();
    check(
      "the bottom bar is pinned to the bottom of the viewport",
      Boolean(barBox) && Math.abs(barBox.y + barBox.height - PHONE.height) <= 2,
      barBox ? `bottom=${Math.round(barBox.y + barBox.height)} viewport=${PHONE.height}` : "no bar"
    );
    check("the parent screens log no browser errors on a phone", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // ---- 8. Signing out ----
  section("8. Signing out");
  {
    const { context, errors } = await newContext({ viewport: PHONE, token: childToken });
    const page = await context.newPage();

    await visit(page, "/kid/dashboard");
    await page.getByRole("button", { name: "Thoát" }).click();
    await page.waitForURL(/\/login/, { timeout: 20_000 }).catch(() => {});
    check(
      "signing out returns the child to the sign-in screen",
      page.url().includes("/login"),
      `url=${page.url()}`
    );

    // The cookie is deleted, not merely redirected away from: asking for the child area
    // again has to land back on the sign-in screen.
    await page
      .goto(`${base}/kid/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    check(
      "and the child area is closed again",
      page.url().includes("/login"),
      `url=${page.url()}`
    );
    check("signing out logs no browser errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
} catch (error) {
  fail += 1;
  failures.push(`unexpected: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`\nThe suite stopped early: ${error instanceof Error ? error.stack : error}`);
} finally {
  if (browser) await browser.close().catch(() => {});

  if (db) {
    // Delete the families first: users.auth_user_id is `on delete set null`, so the
    // link is gone afterwards and the auth rows would be left behind as orphans.
    for (const id of createdFamilyIds) {
      await db.query("delete from public.families where id = $1", [id]).catch(() => {});
    }
    await db
      .query("delete from public.families where family_name = $1", [FAMILY_NAME])
      .catch(() => {});
    for (const id of [AUTH_PARENT, AUTH_CHILD]) {
      await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
      await db.query("delete from auth.users where id = $1", [id]).catch(() => {});
    }
    await db.end().catch(() => {});
    console.log("\nUI fixtures removed.");
  }

  if (managedServer) {
    managedServer.kill();
    console.log("Stopped the server this run started.");
  }
}

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const line of failures) console.log(`  - ${line}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
