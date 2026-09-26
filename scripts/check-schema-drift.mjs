// Does the live database actually hold the function bodies that db/migrations/*.sql
// says it should?
//
// A migration whose file was edited AFTER it was applied leaves the ledger warning
// "CHANGED since applied!" behind. That warning says the file moved, not that the
// database drifted - this compares the two to find out which.
//
// Only the body is compared. PostgreSQL stores the body of a plpgsql function as the
// source text that was sent, so bodies are comparable verbatim; the header that
// pg_get_functiondef reconstructs is not, because it spells types the long way
// (`integer` where the file says `int`).
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const dir = new URL("../db/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

/** The text between the outermost $fn$ (or $$) delimiters, whitespace-normalised. */
function bodyOf(text) {
  // The `as` clause always starts its own line in these files. Anchoring there avoids
  // matching `cast(x as text)` further down inside the body.
  const match = text.match(/(?:^|\n)\s*as\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/);
  if (!match) return null;
  return match[2].replace(/\s+/g, " ").trim().toLowerCase();
}

/** Every function the file defines, with its body. */
function functionsIn(text) {
  const found = new Map();
  const header = /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi;
  const hits = [...text.matchAll(header)];
  for (let i = 0; i < hits.length; i += 1) {
    const name = hits[i][1].toLowerCase();
    const chunk = text.slice(hits[i].index, i + 1 < hits.length ? hits[i + 1].index : text.length);
    const body = bodyOf(chunk);
    if (body) found.set(name, body);
  }
  return found;
}

const expected = new Map();
for (const file of files) {
  for (const [name, body] of functionsIn(readFileSync(new URL(file, dir), "utf8"))) {
    // A later file legitimately redefines a function; the last one wins, which is the
    // same order the runner applies them in.
    expected.set(name, { file, body });
  }
}

const { rows } = await client.query(
  `select p.proname, p.prosrc
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
    order by p.proname`
);

let drifted = 0;
let checked = 0;
for (const row of rows) {
  const want = expected.get(row.proname);
  if (!want) {
    console.log(`  ??  ${row.proname}: defined in the database but not in any migration file`);
    drifted += 1;
    continue;
  }
  checked += 1;
  const live = row.prosrc.replace(/\s+/g, " ").trim().toLowerCase();
  if (live !== want.body) {
    drifted += 1;
    console.log(`  DRIFT  ${row.proname}  (last defined in ${want.file})`);
    console.log(`         database body differs from the file by ${Math.abs(live.length - want.body.length)} characters`);
  }
}

const missing = [...expected.keys()].filter((name) => !rows.some((r) => r.proname === name));
for (const name of missing) {
  console.log(`  GONE   ${name}: in ${expected.get(name).file} but not in the database`);
  drifted += 1;
}

console.log("");
console.log(`${checked} function(s) compared, ${drifted} problem(s).`);
await client.end();
process.exit(drifted > 0 ? 1 : 0);
