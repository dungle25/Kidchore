/**
 * End-to-end HTTP test against a running server.
 *
 * Closes the gap the database tests cannot: that a session cookie issued by
 * lib/session.ts is accepted by proxy.ts, resolved by lib/dal.ts, authorized by the
 * database functions, and rendered into a page containing that user's real data.
 *
 * Creates its own family in the database, signs a token exactly the way the app
 * does, drives the running server over HTTP, then removes everything it created.
 *
 * Usage (with the app running):
 *   node scripts/test-e2e.mjs [baseUrl]
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const startServer = args.includes("--start-server");
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000";

/**
 * Runs `next build` then `next start`, and waits until the app answers.
 *
 * The HTTP suite needs a running server, and requiring the caller to start one made it
 * easy to run the suite with nothing listening, which surfaced as a confusing request
 * failure rather than a clear message. `npm run test:all` uses this so every suite can run
 * from one command.
 */
async function ensureServer() {
  const { spawn } = await import("node:child_process");

  // Call npx directly rather than going through a shell. Passing arguments to a shell
  // concatenates them without escaping, which Node warns about, and nothing here needs
  // shell features.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";

  console.log("Building the app for the HTTP suite...");
  const build = spawn(npx, ["next", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  const buildCode = await new Promise((resolve) => build.on("exit", resolve));
  if (buildCode !== 0) {
    console.error(`Build failed with exit code ${buildCode}.`);
    process.exit(1);
  }

  console.log("Starting the server...");
  const server = spawn(npx, ["next", "start"], {
    cwd: root,
    stdio: "inherit",
  });

  const healthy = await waitForServer();
  if (!healthy) {
    server.kill();
    console.error("The server did not answer in time.");
    process.exit(1);
  }
  console.log("Server is up.\n");
  return server;
}

async function waitForServer(timeoutMs = 60_000) {
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

let managedServer = null;

const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const secret = env.SUPABASE_JWT_SECRET;
const SESSION_COOKIE = "kidchore_session";

/**
 * A proof-image URL shaped exactly like the ones the storage bucket serves. The
 * upload path is covered by scripts/test-storage-upload.mjs; here it only needs to be a
 * value that the pages should render.
 */
const PROOF_URL = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/proof-images/${encodeURIComponent("__e2e__/proof.jpg")}`;

/** Signs a session token the same way lib/session.ts does. */
function mintToken(sub, role, name, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: "supabase",
    sub,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + ttlSeconds,
    app_role: role,
    app_name: name,
  })}`;
  const sig = createHmac("sha256", secret).update(input).digest("base64url");
  return `${input}.${sig}`;
}

const DAY = 60 * 60 * 24;

/** Reads the session cookie a response asks the browser to store. */
function readSessionCookie(res) {
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    if (cookie.startsWith(`${SESSION_COOKIE}=`)) {
      return {
        value: cookie.slice(SESSION_COOKIE.length + 1).split(";")[0],
        raw: cookie,
      };
    }
  }
  return null;
}

/** Reads the expiry claim from a token without verifying it. */
function tokenExpiry(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp;
}

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

/**
 * Fetches a path without following redirects, so a 307 to /login is observable.
 */
async function get(pathname, token) {
  const headers = {};
  if (token) headers.Cookie = `${SESSION_COOKIE}=${token}`;
  const res = await fetch(`${base}${pathname}`, { headers, redirect: "manual" });
  const body = res.status === 200 ? await res.text() : "";
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return {
    status: res.status,
    location: res.headers.get("location"),
    body,
    /**
     * The same HTML with Next's serialized RSC payload removed.
     *
     * Next streams the data the page was rendered from into inline <script> tags, so a
     * plain `body.includes(...)` can match text that never appears on screen - and any
     * check that compares *positions* will compare them in the data blob rather than in
     * the document. Use this for anything about what a person actually sees.
     */
    rendered: body.replace(/<script[\s\S]*?<\/script>/g, ""),
    sessionCookie: readSessionCookie(res),
    // Kept for diagnostics: shows exactly what the server asked the browser to store.
    allSetCookies: setCookies,
  };
}

const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

let familyId = null;
/** Every family this run creates, so cleanup is complete even after a failure. */
const createdFamilyIds = [];
const AUTH_PARENT = "11111111-1111-4111-8111-111111111111";
const AUTH_CHILD = "22222222-2222-4222-8222-222222222222";
const AUTH_OTHER = "33333333-3333-4333-8333-333333333333";

try {
  // With --start-server the suite brings the app up itself, which is what the combined
  // runner uses. Otherwise it expects an app already running and says so plainly.
  if (startServer) {
    managedServer = await ensureServer();
  }

  // Reachability first: a clear message beats a confusing ECONNREFUSED later.
  try {
    await fetch(`${base}/login`, { redirect: "manual" });
  } catch {
    console.error(
      `\nCannot reach ${base}. Start the app first (npm run dev, or npm run build && npm start), or pass --start-server.`
    );
    process.exit(1);
  }

  // Clear residue from any earlier interrupted run before creating anything.
  await db.query(
    "delete from public.families where family_name in ('__E2E_FAMILY__', '__E2E_OTHER__')"
  );

  /**
   * auth_user_id has a real foreign key to auth.users, so the identities must exist
   * there. These are inserted the same way migration 0005 provisions a child, which
   * keeps the test honest about that link instead of bypassing it.
   */
  async function createAuthUser(id, email) {
    await db.query("delete from auth.identities where user_id = $1", [id]);
    await db.query("delete from auth.users where id = $1", [id]);
    await db.query(
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
    await db.query(
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

  await createAuthUser(AUTH_PARENT, "e2e.parent@example.com");
  await createAuthUser(AUTH_CHILD, "e2e.child@example.com");

  const fam = await db.query(
    "insert into public.families (family_name) values ('__E2E_FAMILY__') returning id"
  );
  familyId = fam.rows[0].id;
  createdFamilyIds.push(familyId);

  const parent = await db.query(
    `insert into public.users (family_id, role, display_name, email, auth_user_id)
     values ($1, 'PARENT', 'E2E Phụ Huynh', 'e2e.parent@example.com', $2) returning id`,
    [familyId, AUTH_PARENT]
  );
  check("the parent profile was created", Boolean(parent.rows[0]?.id));

  const child = await db.query(
    `insert into public.users (family_id, role, display_name, username, auth_user_id, pin_code)
     values ($1, 'CHILD', 'E2E Bé', 'e2ebec', $2, public.hash_pin('1357')) returning id`,
    [familyId, AUTH_CHILD]
  );
  const childId = child.rows[0].id;

  const task = await db.query(
    `insert into public.tasks (family_id, title, description, points_reward, recurrence, assigned_to_user_id)
     values ($1, 'E2E Việc đặc biệt', 'Mô tả đặc biệt', 42, 'DAILY', $2) returning id`,
    [familyId, childId]
  );
  await db.query(
    `insert into public.task_instances (task_id, assigned_child_id, due_date, status)
     values ($1, $2, current_date, 'PENDING')`,
    [task.rows[0].id, childId]
  );

  await db.query(
    `insert into public.rewards (family_id, title, points_required, stock)
     values ($1, 'E2E Phần thưởng', 7, -1)`,
    [familyId]
  );

  const parentToken = mintToken(AUTH_PARENT, "PARENT", "E2E Phụ Huynh");
  const childToken = mintToken(AUTH_CHILD, "CHILD", "E2E Bé");

  // ---- 1. Anonymous access is refused ----
  console.log("\n1. Anonymous access");
  const anonParent = await get("/parent/dashboard");
  check(
    "parent area redirects an anonymous visitor to /login",
    anonParent.status === 307 && (anonParent.location ?? "").startsWith("/login"),
    `status=${anonParent.status} location=${anonParent.location}`
  );
  const anonKid = await get("/kid/dashboard");
  check(
    "kid area redirects an anonymous visitor to /login",
    anonKid.status === 307 && (anonKid.location ?? "").startsWith("/login"),
    `status=${anonKid.status} location=${anonKid.location}`
  );

  // ---- 2. Role separation ----
  console.log("\n2. Role separation");
  const parentInKid = await get("/kid/dashboard", parentToken);
  check(
    "a parent is redirected out of the kid area",
    parentInKid.status === 307 && (parentInKid.location ?? "").includes("/parent"),
    `status=${parentInKid.status} location=${parentInKid.location}`
  );
  const childInParent = await get("/parent/dashboard", childToken);
  check(
    "a child is redirected out of the parent area",
    childInParent.status === 307 && (childInParent.location ?? "").includes("/kid"),
    `status=${childInParent.status} location=${childInParent.location}`
  );

  // ---- 3. Parent pages render real data through the DAL ----
  console.log("\n3. Parent pages render this family's data");
  const parentDash = await get("/parent/dashboard", parentToken);
  check("parent dashboard returns 200", parentDash.status === 200, `status=${parentDash.status}`);
  check(
    "it greets the parent by name",
    parentDash.body.includes("E2E Phụ Huynh"),
    "name not found in HTML"
  );
  check(
    "it shows the family name",
    parentDash.body.includes("__E2E_FAMILY__"),
    "family name not found in HTML"
  );
  check(
    "it lists the child",
    parentDash.body.includes("E2E Bé"),
    "child name not found in HTML"
  );

  const parentFamily = await get("/parent/family", parentToken);
  check("family page returns 200", parentFamily.status === 200, `status=${parentFamily.status}`);
  check(
    "family page shows the child's username",
    parentFamily.body.includes("e2ebec"),
    "username not found in HTML"
  );

  const parentRewards = await get("/parent/rewards", parentToken);
  check(
    "rewards page shows the reward catalogue",
    parentRewards.status === 200 && parentRewards.body.includes("E2E Phần thưởng"),
    `status=${parentRewards.status}`
  );

  const parentTasks = await get("/parent/tasks", parentToken);
  check(
    "tasks page shows the chore definition",
    parentTasks.status === 200 && parentTasks.body.includes("E2E Việc đặc biệt"),
    `status=${parentTasks.status}`
  );
  // The quick-add catalogue is the first thing a new family uses, so it has to be on the
  // page. What it does once opened and pressed is covered by
  // scripts/test-suggested-tasks.mjs, which checks the rules without a browser.
  check(
    "the tasks page offers the quick-add catalogue",
    parentTasks.body.includes("Thêm nhanh việc thường làm"),
    "quick-add panel missing"
  );

  // ---- 4. Child pages render through the DAL ----
  console.log("\n4. Child pages render this child's data");
  const kidDash = await get("/kid/dashboard", childToken);
  check("kid dashboard returns 200", kidDash.status === 200, `status=${kidDash.status}`);
  check(
    "it greets the child by name",
    kidDash.body.includes("E2E Bé"),
    "child name not found in HTML"
  );
  check(
    "it shows today's chore",
    kidDash.body.includes("E2E Việc đặc biệt"),
    "chore title not found in HTML"
  );

  // The list is grouped by what the child can do next. The heading text is the same as a
  // card's status label ("Chưa làm" is both), so the group is identified by the
  // attribute rather than by the words - otherwise this would pass by finding the label
  // inside the card it was supposed to be filing.
  check(
    "an unfinished chore is filed under its group heading",
    kidDash.rendered.includes('data-group="todo"') &&
      kidDash.rendered.indexOf('data-group="todo"') <
        kidDash.rendered.indexOf("E2E Việc đặc biệt"),
    `heading@${kidDash.rendered.indexOf('data-group="todo"')} chore@${kidDash.rendered.indexOf("E2E Việc đặc biệt")}`
  );
  check(
    "a group with nothing in it is not shown",
    !kidDash.rendered.includes('data-group="waiting"') &&
      !kidDash.rendered.includes('data-group="done"'),
    "an empty group heading is rendered"
  );
  check(
    "the group heading counts the chores in it",
    /data-group="todo"[^>]*>[\s\S]{0,200}?<span[^>]*>1<\/span>/.test(kidDash.rendered),
    "no count next to the group heading"
  );

  const kidRewards = await get("/kid/rewards", childToken);
  check("kid rewards returns 200", kidRewards.status === 200, `status=${kidRewards.status}`);
  check(
    "an unlimited-stock reward is offered to the child",
    kidRewards.body.includes("E2E Phần thưởng"),
    "unlimited reward missing from the shop"
  );

  // ---- 5. Forged session is rejected ----
  console.log("\n5. Forged session");
  const forged = await get("/parent/dashboard", `${parentToken.slice(0, -6)}abcdef`);
  check(
    "a tampered session token does not grant access",
    forged.status === 307 && (forged.location ?? "").startsWith("/login"),
    `status=${forged.status} location=${forged.location}`
  );

  // ---- 6. Data isolation between families ----
  console.log("\n6. Data isolation");
  const otherAuth = "33333333-3333-4333-8333-333333333333";
  await createAuthUser(otherAuth, "e2e.other@example.com");

  const otherFam = await db.query(
    "insert into public.families (family_name) values ('__E2E_OTHER__') returning id"
  );
  createdFamilyIds.push(otherFam.rows[0].id);
  await db.query(
    `insert into public.users (family_id, role, display_name, auth_user_id)
     values ($1, 'PARENT', 'Người Lạ', $2)`,
    [otherFam.rows[0].id, otherAuth]
  );

  const otherToken = mintToken(otherAuth, "PARENT", "Người Lạ");
  const otherView = await get("/parent/dashboard", otherToken);
  check(
    "a signed-in user from another family sees none of this family's data",
    otherView.status === 200 &&
      !otherView.body.includes("E2E Bé") &&
      !otherView.body.includes("__E2E_FAMILY__"),
    `status=${otherView.status} childLeaked=${otherView.body.includes("E2E Bé")}`
  );

  await db.query("delete from public.families where id = $1", [otherFam.rows[0].id]);

  // ---- 7. Sliding session renewal ----
  // A 30-day cookie that never renews signs the whole family out on day 30 even if
  // they use the app daily. Renewal lives in a route handler because the proxy cannot
  // both set a cookie and render a page (see app/api/auth/keepalive/route.ts).
  console.log("\n7. Sliding session renewal");

  /** Calls the renewal endpoint the way the client component does. */
  async function keepalive(token) {
    const res = await fetch(`${base}/api/auth/keepalive`, {
      headers: token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {},
      redirect: "manual",
    });
    const cookies = res.headers.getSetCookie?.() ?? [];
    const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    return {
      status: res.status,
      cookie: session
        ? { value: session.slice(SESSION_COOKIE.length + 1).split(";")[0], raw: session }
        : null,
    };
  }

  const freshToken = mintToken(AUTH_PARENT, "PARENT", "E2E Phụ Huynh", 20 * DAY);
  const freshRes = await keepalive(freshToken);
  check(
    "a session with 20 days left is NOT reissued",
    freshRes.status === 204 && freshRes.cookie === null,
    `status=${freshRes.status} setCookie=${freshRes.cookie?.raw ?? "none"}`
  );

  const expiringToken = mintToken(AUTH_PARENT, "PARENT", "E2E Phụ Huynh", 2 * DAY);
  const expiringRes = await keepalive(expiringToken);
  if (!expiringRes.cookie) {
    console.log(`    [debug] keepalive status=${expiringRes.status}, no session cookie returned`);
  }
  check(
    "a session with 2 days left IS reissued",
    expiringRes.status === 204 && expiringRes.cookie !== null,
    `status=${expiringRes.status} setCookie=${expiringRes.cookie?.raw ?? "none"}`
  );

  if (expiringRes.cookie) {
    const before = tokenExpiry(expiringToken);
    const after = tokenExpiry(expiringRes.cookie.value);
    check(
      "the renewed token expires later than the one it replaces",
      after > before,
      `before=${new Date(before * 1000).toISOString()} after=${new Date(after * 1000).toISOString()}`
    );
    check(
      "the renewed token extends to roughly a full session lifetime",
      after > Math.floor(Date.now() / 1000) + 29 * DAY,
      `after=${new Date(after * 1000).toISOString()}`
    );
    check(
      "the renewed cookie is HttpOnly, SameSite=Lax and long-lived",
      /HttpOnly/i.test(expiringRes.cookie.raw) &&
        /SameSite=Lax/i.test(expiringRes.cookie.raw) &&
        /Max-Age=2592000/.test(expiringRes.cookie.raw),
      expiringRes.cookie.raw
    );

    // The refreshed token must actually work, not merely be well-formed.
    const followUp = await get("/parent/dashboard", expiringRes.cookie.value);
    check(
      "the refreshed session is accepted on the next request",
      followUp.status === 200 && followUp.body.includes("E2E Phụ Huynh"),
      `status=${followUp.status}`
    );
  }

  const expiredToken = mintToken(AUTH_PARENT, "PARENT", "E2E Phụ Huynh", -DAY);
  const expiredRes = await get("/parent/dashboard", expiredToken);
  check(
    "an already-expired session is NOT resurrected",
    expiredRes.status === 307 && (expiredRes.location ?? "").startsWith("/login"),
    `status=${expiredRes.status} location=${expiredRes.location}`
  );

  const anonKeepalive = await keepalive(null);
  check(
    "keepalive hands nothing to an anonymous caller",
    anonKeepalive.status === 204 && anonKeepalive.cookie === null,
    `status=${anonKeepalive.status} setCookie=${anonKeepalive.cookie?.raw ?? "none"}`
  );

  // ---- 8. Proof photos ----
  // A chore that requires proof shows the child a picker, and the stored image has to
  // reach the parent's approval screen. The upload path itself is exercised by
  // scripts/test-storage-upload.mjs; what is checked here is that an instance holding
  // a proof URL renders on both sides.
  console.log("\n8. Proof photos");

  const proofTask = await db.query(
    `insert into public.tasks
       (family_id, title, description, points_reward, recurrence, assigned_to_user_id, require_proof_image)
     values ($1, 'E2E Việc cần ảnh', 'Phải gửi ảnh', 13, 'DAILY', $2, true)
     returning id`,
    [familyId, childId]
  );
  const proofInstance = await db.query(
    `insert into public.task_instances
       (task_id, assigned_child_id, due_date, status, proof_image_url)
     values ($1, $2, current_date, 'SUBMITTED', $3)
     returning id`,
    [proofTask.rows[0].id, childId, PROOF_URL]
  );

  const kidDashWithProof = await get("/kid/dashboard", childToken);
  check(
    "the child sees the stored proof photo on their own chore",
    kidDashWithProof.status === 200 && kidDashWithProof.body.includes(PROOF_URL),
    `status=${kidDashWithProof.status} urlPresent=${kidDashWithProof.body.includes(PROOF_URL)}`
  );

  const parentChores = await get("/parent/chores", parentToken);
  check(
    "the parent sees the proof photo in the approval queue",
    parentChores.status === 200 && parentChores.body.includes(PROOF_URL),
    `status=${parentChores.status} urlPresent=${parentChores.body.includes(PROOF_URL)}`
  );
  check(
    "the approval queue labels the chore as awaiting review",
    parentChores.body.includes("E2E Việc cần ảnh"),
    "task title missing from the queue"
  );

  // An instance marked as needing proof but holding no photo should be flagged, so a
  // parent does not approve blind.
  await db.query("update public.task_instances set proof_image_url = null where id = $1", [
    proofInstance.rows[0].id,
  ]);
  const parentChoresNoPhoto = await get("/parent/chores", parentToken);
  check(
    "a required-but-missing photo is called out to the parent",
    parentChoresNoPhoto.body.includes("chưa gửi ảnh"),
    "missing-photo warning not rendered"
  );
} finally {
  // Collect linked auth identities BEFORE deleting the families: users.auth_user_id
  // is `on delete set null`, so afterwards the link is gone and the auth rows would
  // be left behind as unreachable orphan accounts.
  const linked = await db
    .query(
      `select auth_user_id from public.users
       where auth_user_id is not null
         and (family_id = any($1::uuid[]) or email like '%@example.com' or username like 'e2e%')`,
      [createdFamilyIds]
    )
    .catch(() => ({ rows: [] }));

  // Delete every family this run created, not just the last one. A failure partway
  // through must not leave fixtures behind.
  for (const id of createdFamilyIds) {
    await db.query("delete from public.families where id = $1", [id]).catch(() => {});
  }
  // Sweep any residue by name too, in case a family outlived its bookkeeping.
  await db
    .query(
      "delete from public.families where family_name in ('__E2E_FAMILY__', '__E2E_OTHER__')"
    )
    .catch(() => {});

  const authIds = new Set([
    AUTH_PARENT,
    AUTH_CHILD,
    AUTH_OTHER,
    ...linked.rows.map((r) => r.auth_user_id),
  ]);

  for (const id of authIds) {
    await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
    await db.query("delete from auth.users where id = $1", [id]).catch(() => {});
  }
  await db.end();
  console.log("\nE2E fixtures removed.");

  // Stop the server this run started, so nothing keeps the port after the suite ends.
  // This is inside the single finally block, so it happens on success and on a failure
  // part-way through alike.
  if (managedServer) {
    managedServer.kill();
    console.log("Stopped the server this run started.");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
