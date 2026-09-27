/**
 * Removes proof photos that have passed their retention window.
 *
 * The app already sweeps a family's expired photos after every approval
 * (`app/actions/proof-cleanup.ts`) so nobody has to schedule anything. This script is for
 * the two cases that sweep cannot cover: a family that stopped using the app while its
 * photos are still spending quota, and a one-off cleanup after the fact. It is also what a
 * cron job would call if you ever want the sweep to be independent of use.
 *
 * The rule for "expired" is not repeated here - it is `public.expired_proof_instances`, the
 * same function the app's sweep goes through (migration 0014). Two copies of that rule is
 * how a photo gets deleted while a parent is still looking at it.
 *
 * Dry run by default, like `cleanup-fixtures.mjs`: printing what would go is the safe way
 * to run a delete command for the first time.
 *
 * Usage:
 *   node scripts/purge-proof-images.mjs [--days 30] [--apply] [--family <uuid>]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { PROOF_BUCKET, PROOF_RETENTION_DAYS, proofObjectPath } from "../lib/proof-retention.ts";
import { sslForDatabase } from "./lib/database-ssl.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const days = Number(option("days", PROOF_RETENTION_DAYS));
const familyId = option("family", null);

if (!Number.isInteger(days) || days < 1) {
  console.error("--days must be a positive whole number.");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: sslForDatabase(env.DATABASE_URL),
});
await db.connect();

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { rows } = await db.query(
  "select instance_id, proof_image_url from public.expired_proof_instances($1, $2)",
  [familyId, days]
);

console.log(
  `Proof photos decided more than ${days} day(s) ago: ${rows.length}${familyId ? ` in family ${familyId}` : ""}`
);

if (rows.length === 0) {
  await db.end();
  process.exit(0);
}

let removed = 0;
let skipped = 0;

for (const row of rows) {
  const objectPath = proofObjectPath(row.proof_image_url);
  if (!objectPath) {
    // A URL this script cannot turn into a path is left alone rather than guessed at:
    // deleting the wrong object is worse than leaving one row behind.
    skipped += 1;
    console.log(`  skip  ${row.instance_id}  unrecognised URL`);
    continue;
  }

  if (!apply) {
    console.log(`  would remove  ${objectPath}  (instance ${row.instance_id})`);
    continue;
  }

  const { error } = await admin.storage.from(PROOF_BUCKET).remove([objectPath]);
  if (error && !/not found/i.test(error.message)) {
    skipped += 1;
    console.error(`  FAIL  ${objectPath}: ${error.message}`);
    continue;
  }

  // Object first, then the record: a crash in between leaves a row that still claims to
  // have a photo, which the next run retries. The reverse order would leave an
  // unreferenced object that nothing will ever delete.
  await db.query("update public.task_instances set proof_deleted_at = now() where id = $1", [
    row.instance_id,
  ]);
  removed += 1;
  console.log(`  removed  ${objectPath}  (instance ${row.instance_id})`);
}

console.log(
  apply
    ? `\n${removed} photo(s) removed, ${skipped} skipped. The rows keep proof_image_url and now carry proof_deleted_at.`
    : `\nDry run: ${rows.length} photo(s) would be removed, ${skipped} skipped. Re-run with --apply to delete.`
);

await db.end();
