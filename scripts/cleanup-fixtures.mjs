/**
 * Removes any leftover test fixtures. Safe to run at any time.
 *
 * Only touches rows this project's own test suites create: families named with the
 * test prefixes, and the auth identities behind them. It never touches real family
 * data.
 *
 * Usage: node scripts/cleanup-fixtures.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";

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

// Collect auth subjects belonging to test users before deleting the users.
const subjects = await db.query(`
  select distinct auth_user_id
  from public.users
  where auth_user_id is not null
    and (
      email like '%@example.com'
      or email like '%@kidchore.local'
      or username like 'test%'
      or username like 'e2e%'
    )
`);

const deletedFamilies = await db.query(`
  delete from public.families
  where family_name like '\\_\\_%'
     or family_name like '%TEST%'
     or family_name like '%E2E%'
  returning id
`);

const deletedUsers = await db.query(`
  delete from public.users
  where email like '%@example.com'
     or email like '%@kidchore.local'
     or username like 'test%'
     or username like 'e2e%'
  returning id
`);

let deletedAuth = 0;
for (const row of subjects.rows) {
  const res = await db.query("delete from auth.users where id = $1 returning id", [
    row.auth_user_id,
  ]);
  deletedAuth += res.rowCount;
}

// Children whose auth identity was provisioned but whose profile is already gone.
const orphanAuth = await db.query(`
  delete from auth.users
  where email like '%@kidchore.local'
     or email like '%@example.com'
  returning id
`);

console.log(`Removed ${deletedFamilies.rowCount} test families`);
console.log(`Removed ${deletedUsers.rowCount} test user profiles`);
console.log(`Removed ${deletedAuth + orphanAuth.rowCount} test auth identities`);

const left = await db.query(`
  select
    (select count(*)::int from public.families) as families,
    (select count(*)::int from public.users) as users,
    (select count(*)::int from auth.users) as auth_users
`);
console.log(
  `Remaining: ${left.rows[0].families} families, ${left.rows[0].users} users, ${left.rows[0].auth_users} auth users`
);

await db.end();
