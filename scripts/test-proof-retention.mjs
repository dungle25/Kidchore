/**
 * Proof-photo retention: what gets deleted, what must never be.
 *
 * The dangerous half of a retention policy is the part that deletes too much. A photo
 * belonging to a chore that is still **waiting for a parent** must survive however old it
 * is, or the parent loses the evidence for the decision they have not made yet - and no
 * screen would say why. That case is asserted here explicitly, with a 40-day-old pending
 * submission.
 *
 * The rule itself lives in SQL (`public.expired_proof_instances`, migration 0014) so that
 * the app's sweep and the cleanup script cannot disagree; this suite drives it through both
 * of the doors that exist - the family-scoped one the app uses, and the unfiltered one the
 * script uses - plus the pure path-from-URL helper that turns a stored URL into the object
 * the Storage API has to delete.
 *
 * Usage: node scripts/test-proof-retention.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  PROOF_BUCKET,
  PROOF_RETENTION_DAYS,
  hasLiveProof,
  proofObjectPath,
} from "../lib/proof-retention.ts";
import { createHmac } from "node:crypto";
import { sslForDatabase } from "./lib/database-ssl.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

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

// ---------------------------------------------------------------------------
// The pure part: a stored URL has to become an object path before it can be deleted.
// ---------------------------------------------------------------------------

console.log("1. Turning a stored URL back into an object path");
{
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const path1 = "family-id/child-id/abc.jpg";
  check(
    "a URL this bucket serves yields its object path",
    proofObjectPath(`${base}/storage/v1/object/public/${PROOF_BUCKET}/${path1}`) === path1,
    String(proofObjectPath(`${base}/storage/v1/object/public/${PROOF_BUCKET}/${path1}`))
  );
  check(
    "a percent-encoded path is decoded",
    proofObjectPath(`${base}/storage/v1/object/public/${PROOF_BUCKET}/a%20b.jpg`) === "a b.jpg",
    String(proofObjectPath(`${base}/storage/v1/object/public/${PROOF_BUCKET}/a%20b.jpg`))
  );
  check(
    "a query string is not part of the path",
    proofObjectPath(`${base}/storage/v1/object/public/${PROOF_BUCKET}/x.jpg?width=10`) === "x.jpg",
    String(proofObjectPath(`${base}/storage/v1/object/public/${PROOF_BUCKET}/x.jpg?width=10`))
  );
  // Every one of these must be refused: this string decides which object is deleted.
  check("null is refused", proofObjectPath(null) === null);
  check("an empty string is refused", proofObjectPath("") === null);
  check("another bucket is refused", proofObjectPath(`${base}/storage/v1/object/public/avatars/x.jpg`) === null);
  check("an external URL is refused", proofObjectPath("https://example.com/x.jpg") === null);
  check("a bucket with no object is refused", proofObjectPath(`${base}/storage/v1/object/public/${PROOF_BUCKET}/`) === null);
  check("a malformed escape is refused", proofObjectPath(`${base}/storage/v1/object/public/${PROOF_BUCKET}/%E0%A4%A`) === null);

  check(
    "a row that still has its photo counts as live",
    hasLiveProof({ proof_image_url: "x", proof_deleted_at: null })
  );
  check(
    "a row whose photo was removed does not",
    !hasLiveProof({ proof_image_url: "x", proof_deleted_at: "2026-01-01T00:00:00Z" })
  );
  check("a row that never had a photo does not", !hasLiveProof({ proof_image_url: null }));
  check("the documented window is 30 days", PROOF_RETENTION_DAYS === 30, String(PROOF_RETENTION_DAYS));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTH_PARENT = "77777777-7777-4777-8777-777777777777";
const AUTH_CHILD = "88888888-8888-4888-8888-888888888888";
const FAMILY_NAME = "__RETENTION_FAMILY__";
const CHILD_NAME = "Retention Bé";

const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: sslForDatabase(env.DATABASE_URL),
});
await db.connect();

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const uploadedPaths = [];
/** Object path per fixture label, so a check can ask Storage about a specific photo. */
const proofPaths = {};
let familyId = null;

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

async function createAuthUser(id, email) {
  await db.query("delete from auth.identities where user_id = $1", [id]);
  await db.query("delete from auth.users where id = $1", [id]);
  await db.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
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
       id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
     ) values (
       gen_random_uuid(), $1::uuid, $1::text,
       jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
       'email', now(), now(), now()
     )`,
    [id, email]
  );
}

/** Uploads a real object, because a row pointing at nothing would prove nothing. */
async function uploadProof(label) {
  const objectPath = `${FAMILY_NAME}/${label}-${Date.now()}.jpg`;
  const bytes = Buffer.from(`proof-${label}`);
  const { error } = await admin.storage.from(PROOF_BUCKET).upload(objectPath, bytes, {
    contentType: "image/jpeg",
  });
  if (error) throw new Error(`upload ${label} failed: ${error.message}`);
  uploadedPaths.push(objectPath);
  proofPaths[label] = objectPath;
  const { data } = admin.storage.from(PROOF_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

async function rpcAs(token, fn, args = {}) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/** Whether an object is still retrievable from Storage. */
async function objectExists(objectPath) {
  const { data, error } = await admin.storage.from(PROOF_BUCKET).download(objectPath);
  if (error) return false;
  return Boolean(data);
}

async function instanceRow(id) {
  return (
    await db.query(
      "select status, proof_image_url, proof_deleted_at from public.task_instances where id = $1",
      [id]
    )
  ).rows[0];
}

async function insertInstance({ title, status, daysAgo, proofUrl }) {
  const task = await db.query(
    `insert into public.tasks (family_id, title, points_reward, recurrence, assigned_to_user_id, require_proof_image)
     values ($1, $2, 5, 'DAILY', $3, true) returning id`,
    [familyId, title, childId]
  );
  const childIdRef = childId;
  const row = await db.query(
    `insert into public.task_instances
       (task_id, assigned_child_id, due_date, status, proof_image_url, completed_at, approved_at)
     values ($1, $2, current_date - $3::int, $4::public.task_status, $5,
             now() - make_interval(days => $3::int),
             case when $4::text = 'APPROVED' then now() - make_interval(days => $3::int) else null end)
     returning id`,
    [task.rows[0].id, childIdRef, daysAgo, status, proofUrl]
  );
  return row.rows[0].id;
}

let childId = null;

try {
  await db.query("delete from public.families where family_name = $1", [FAMILY_NAME]);
  await createAuthUser(AUTH_PARENT, "retention.parent@example.com");
  await createAuthUser(AUTH_CHILD, "retention.child@example.com");

  familyId = (
    await db.query("insert into public.families (family_name) values ($1) returning id", [
      FAMILY_NAME,
    ])
  ).rows[0].id;

  await db.query(
    `insert into public.users (family_id, role, display_name, email, auth_user_id)
     values ($1, 'PARENT', 'Retention Phụ Huynh', 'retention.parent@example.com', $2)`,
    [familyId, AUTH_PARENT]
  );
  childId = (
    await db.query(
      `insert into public.users (family_id, role, display_name, username, auth_user_id, pin_code)
       values ($1, 'CHILD', $2, 'retentionbe', $3, public.hash_pin('1357')) returning id`,
      [familyId, CHILD_NAME, AUTH_CHILD]
    )
  ).rows[0].id;

  console.log("\n2. Which photos a 30-day window selects");
  const oldApproved = await insertInstance({
    title: "Đã duyệt 40 ngày trước",
    status: "APPROVED",
    daysAgo: 40,
    proofUrl: await uploadProof("old-approved"),
  });
  const oldRejected = await insertInstance({
    title: "Bị trả lại 40 ngày trước",
    status: "REJECTED",
    daysAgo: 40,
    proofUrl: await uploadProof("old-rejected"),
  });
  const oldPending = await insertInstance({
    title: "Chờ duyệt 40 ngày trước",
    status: "SUBMITTED",
    daysAgo: 40,
    proofUrl: await uploadProof("old-pending"),
  });
  const recentApproved = await insertInstance({
    title: "Đã duyệt 5 ngày trước",
    status: "APPROVED",
    daysAgo: 5,
    proofUrl: await uploadProof("recent-approved"),
  });

  const selected = await db.query(
    "select instance_id from public.expired_proof_instances($1, $2)",
    [familyId, PROOF_RETENTION_DAYS]
  );
  const selectedIds = selected.rows.map((row) => row.instance_id);

  check("the 40-day-old approved photo is selected", selectedIds.includes(oldApproved));
  check("the 40-day-old rejected photo is selected", selectedIds.includes(oldRejected));
  check(
    "the 40-day-old PENDING photo is NOT selected",
    !selectedIds.includes(oldPending),
    "a submission no parent has looked at yet must keep its evidence"
  );
  check("the 5-day-old approved photo is NOT selected", !selectedIds.includes(recentApproved));
  check("exactly two photos are selected", selectedIds.length === 2, `${selectedIds.length}`);

  console.log("\n3. The app's own door is scoped to the caller's family");
  const parentToken = mintToken(AUTH_PARENT, "PARENT", "Retention Phụ Huynh");
  const viaApp = await rpcAs(parentToken, "expired_proofs_for_my_family", { p_days: 30 });
  check(
    "a parent sees their own expired photos",
    viaApp.status === 200 && Array.isArray(viaApp.data) && viaApp.data.length === 2,
    `status=${viaApp.status} rows=${Array.isArray(viaApp.data) ? viaApp.data.length : viaApp.data}`
  );
  const childToken = mintToken(AUTH_CHILD, "CHILD", CHILD_NAME);
  const asChild = await rpcAs(childToken, "expired_proofs_for_my_family", { p_days: 30 });
  check(
    "a child cannot call it at all",
    asChild.status >= 400,
    `status=${asChild.status}`
  );
  const anon = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/expired_proofs_for_my_family`, {
    method: "POST",
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_days: 30 }),
  });
  check(
    "and an anonymous caller cannot either",
    anon.status >= 400,
    `status=${anon.status}`
  );

  console.log("\n4. Removing the objects, the way the sweep does");
  let removed = 0;
  for (const row of selected.rows) {
    const { data: full } = await db.query(
      "select proof_image_url from public.task_instances where id = $1",
      [row.instance_id]
    ).then((r) => ({ data: r.rows[0] }));
    const objectPath = proofObjectPath(full.proof_image_url);
    const { error } = await admin.storage.from(PROOF_BUCKET).remove([objectPath]);
    if (!error) {
      await db.query("update public.task_instances set proof_deleted_at = now() where id = $1", [
        row.instance_id,
      ]);
      removed += 1;
    }
  }
  check("both objects were removed", removed === 2, `${removed}`);

  // The row being marked is not the claim; the claim is that the photo is no longer
  // retrievable. Asked of Storage directly.
  check(
    "the approved photo is really gone from Storage",
    !(await objectExists(proofPaths["old-approved"])),
    proofPaths["old-approved"]
  );
  check(
    "the rejected photo is gone as well",
    !(await objectExists(proofPaths["old-rejected"])),
    proofPaths["old-rejected"]
  );
  check(
    "the pending photo is still retrievable",
    await objectExists(proofPaths["old-pending"]),
    proofPaths["old-pending"]
  );
  check(
    "the recent photo is still retrievable",
    await objectExists(proofPaths["recent-approved"]),
    proofPaths["recent-approved"]
  );

  const approvedRow = await instanceRow(oldApproved);
  const rejectedRow = await instanceRow(oldRejected);
  const pendingRow = await instanceRow(oldPending);
  const recentRow = await instanceRow(recentApproved);

  check("the purged row is marked as deleted", Boolean(approvedRow.proof_deleted_at));
  check(
    "and keeps its URL, so history still knows there was a photo",
    Boolean(approvedRow.proof_image_url),
    String(approvedRow.proof_image_url)
  );
  check("the rejected row is marked too", Boolean(rejectedRow.proof_deleted_at));
  check(
    "the pending row is untouched",
    pendingRow.proof_deleted_at === null && Boolean(pendingRow.proof_image_url),
    JSON.stringify(pendingRow)
  );
  check(
    "the recent row is untouched",
    recentRow.proof_deleted_at === null && Boolean(recentRow.proof_image_url),
    JSON.stringify(recentRow)
  );

  console.log("\n5. A second run does nothing (the sweep is idempotent)");
  const again = await db.query(
    "select instance_id from public.expired_proof_instances($1, $2)",
    [familyId, PROOF_RETENTION_DAYS]
  );
  check("nothing is left to purge", again.rows.length === 0, `${again.rows.length} row(s)`);

  console.log("\n6. What the child's screen is told");
  const kidDashboard = await rpcAs(childToken, "kid_dashboard", {});
  const tasks = kidDashboard.data?.tasks_today ?? [];
  const rejectedCard = tasks.find((task) => task.title === "Bị trả lại 40 ngày trước");
  const pendingCard = tasks.find((task) => task.title === "Chờ duyệt 40 ngày trước");
  check(
    "the purged photo is reported to the screen as deleted",
    Boolean(rejectedCard?.proof_deleted_at),
    JSON.stringify(rejectedCard?.proof_deleted_at)
  );
  check(
    "so the card can say so instead of showing a broken image",
    rejectedCard ? !hasLiveProof(rejectedCard) : false,
    JSON.stringify(rejectedCard)
  );
  check(
    "the pending photo is still live on the screen",
    pendingCard ? hasLiveProof(pendingCard) : false,
    JSON.stringify(pendingCard)
  );
} finally {
  for (const objectPath of uploadedPaths) {
    await admin.storage.from(PROOF_BUCKET).remove([objectPath]).catch(() => {});
  }
  if (familyId) {
    await db.query("delete from public.families where id = $1", [familyId]).catch(() => {});
  }
  await db.query("delete from public.families where family_name = $1", [FAMILY_NAME]).catch(() => {});
  for (const id of [AUTH_PARENT, AUTH_CHILD]) {
    await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
    await db.query("delete from auth.users where id = $1", [id]).catch(() => {});
  }
  await db.end();
  console.log("\nRetention fixtures removed.");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
