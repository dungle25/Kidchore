/**
 * Applies SQL migrations in db/migrations to the database in DATABASE_URL.
 *
 * Each file runs inside a single transaction, so a failure leaves the database
 * untouched rather than half-migrated. Already-applied files are skipped using a
 * small ledger table, making this safe to re-run.
 *
 * Usage:
 *   node scripts/migrate.mjs            # apply pending migrations
 *   node scripts/migrate.mjs --status   # show what is applied
 *   node scripts/migrate.mjs --dry-run  # list what would run
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { sslForDatabase } from "./lib/database-ssl.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const text = readFileSync(path.join(root, ".env.local"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    // The password contains percent-encoded characters; keep the URL encoded.
    env[key] = value;
  }
  return env;
}

const env = loadEnv();
const connectionString = env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const migrationsDir = path.join(root, "db", "migrations");

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("No migration files found.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString,
  // Hosted Supabase requires TLS; the local stack CI brings up does not speak it at all.
  // `sslForDatabase` answers from the URL, so the same script serves both.
  ssl: sslForDatabase(connectionString),
  application_name: "kidchore-migrate",
});

async function main() {
  await client.connect();
  const who = await client.query(
    "select current_database() db, current_user usr, version() ver"
  );
  console.log(`Connected to ${who.rows[0].db} as ${who.rows[0].usr}`);
  console.log(
    `Postgres: ${String(who.rows[0].ver).split(" ").slice(0, 2).join(" ")}\n`
  );

  await client.query(`
    create table if not exists public._migrations (
      filename text primary key,
      applied_at timestamptz not null default now(),
      checksum text not null
    )
  `);

  const applied = new Map(
    (await client.query("select filename, checksum from public._migrations")).rows.map(
      (r) => [r.filename, r.checksum]
    )
  );

  let pending = 0;
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    const checksum = String(
      (await import("node:crypto"))
        .createHash("sha256")
        .update(sql)
        .digest("hex")
    ).slice(0, 16);

    if (applied.has(file)) {
      const same = applied.get(file) === checksum;
      console.log(`  skip   ${file}${same ? "" : "  (CHANGED since applied!)"}`);
      continue;
    }

    if (args.has("--status") || args.has("--dry-run")) {
      console.log(`  TO RUN ${file}`);
      pending += 1;
      continue;
    }

    process.stdout.write(`  apply  ${file} ... `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into public._migrations (filename, checksum) values ($1, $2)",
        [file, checksum]
      );
      await client.query("commit");
      console.log("OK");
      pending += 1;
    } catch (error) {
      await client.query("rollback");
      console.log("FAILED");
      console.error(`\n${error.message}`);
      if (error.position) {
        const upto = sql.slice(0, Number(error.position));
        const line = upto.split("\n").length;
        console.error(`at line ${line} of ${file}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  if (args.has("--status")) {
    console.log(`\n${applied.size} applied, ${pending} pending.`);
    return;
  }
  if (args.has("--dry-run")) {
    console.log(`\n${pending} migration(s) would run.`);
    return;
  }

  console.log(`\nDone. ${pending} migration(s) applied.`);

  // Confirm the security posture we just established.
  const rls = await client.query(`
    select c.relname as table_name, c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `);
  console.log("\nRLS status:");
  for (const row of rls.rows) {
    console.log(
      `  ${row.table_name.padEnd(22)} ${row.rls_enabled ? "ENABLED" : "*** DISABLED ***"}`
    );
  }

  const policies = await client.query(`
    select count(*)::int as n from pg_policies where schemaname = 'public'
  `);
  console.log(`\nPolicies in public schema: ${policies.rows[0].n} (0 = default deny)`);

  const fns = await client.query(`
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname
  `);
  console.log(`\nFunctions in public schema: ${fns.rows.length}`);
  console.log("  " + fns.rows.map((r) => r.proname).join(", "));
}

main()
  .catch((error) => {
    console.error("\nMigration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
  });
