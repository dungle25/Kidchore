/**
 * Reads Supabase Auth audit log entries straight from the database.
 *
 * The dashboard's log view is not reachable through the project's API keys, but when
 * "write audit logs to the database" is enabled the same events land in
 * `auth.audit_log_entries`. That table is readable with the database connection string
 * already used for migrations, which makes the OAuth failure diagnosable without asking
 * anyone to copy logs out of a browser.
 *
 * Usage: node scripts/read-auth-audit-logs.mjs [limit]
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const limit = Number(process.argv[2] ?? 25);

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

// Does the table exist, and is anything being written to it?
const exists = await db.query(`
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'audit_log_entries'
  ) as present
`);

if (!exists.rows[0].present) {
  console.log("auth.audit_log_entries does not exist in this project.");
  await db.end();
  process.exit(0);
}

const columns = await db.query(`
  select column_name, data_type
  from information_schema.columns
  where table_schema = 'auth' and table_name = 'audit_log_entries'
  order by ordinal_position
`);
console.log("=== columns ===");
for (const c of columns.rows) console.log(`  ${c.column_name.padEnd(22)} ${c.data_type}`);

const count = await db.query("select count(*)::int as n from auth.audit_log_entries");
console.log(`\n=== total rows: ${count.rows[0].n} ===`);

const rows = await db.query(
  `select id, payload, created_at
   from auth.audit_log_entries
   order by created_at desc
   limit $1`,
  [limit]
);

if (rows.rows.length === 0) {
  console.log("\nTable is empty. Either logging was just enabled, or no auth event has");
  console.log("happened since. Trigger the failure once and run this again.");
  await db.end();
  process.exit(0);
}

console.log(`\n=== ${rows.rows.length} most recent entries (newest first) ===\n`);

for (const row of rows.rows) {
  const p = row.payload ?? {};
  const when = row.created_at?.toISOString?.() ?? String(row.created_at);

  // The interesting fields vary by action; surface the ones that explain failures.
  const interesting = {
    action: p.action,
    provider: p.provider,
    error: p.error,
    error_code: p.error_code,
    msg: p.msg,
    status: p.status,
    path: p.path,
    actor: p.actor_username ?? p.actor_id,
  };

  const parts = Object.entries(interesting)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);

  const looksLikeFailure = /error|fail|denied|invalid|unable/i.test(JSON.stringify(p));

  console.log(`${looksLikeFailure ? "!! " : "   "}${when}`);
  console.log(`   ${parts.join("  ") || "(no recognised fields)"}`);

  // For a failure, print the whole payload - that is where the Google error name lives.
  if (looksLikeFailure) {
    console.log(`   full payload: ${JSON.stringify(p)}`);
  }
  console.log("");
}

await db.end();
