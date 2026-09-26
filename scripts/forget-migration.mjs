// Development helper: forget that a migration has been applied, so the next
// `npm run db:migrate` applies it again.
//
// Legitimate ONLY for a migration that has never been committed or shared - i.e. one
// still being written locally. For anything that has been pushed, the rule in
// CONVENTIONS.md section 2 applies: add a new migration instead of editing an old one.
import { readFileSync } from "node:fs";
import pg from "pg";

const filename = process.argv[2];
if (!filename) {
  console.error("usage: node scripts/forget-migration.mjs <filename.sql>");
  process.exit(1);
}

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const result = await client.query("delete from public._migrations where filename = $1", [
  filename,
]);
console.log(`forgot ${result.rowCount} row(s) for ${filename}; run npm run db:migrate next`);
await client.end();
