/**
 * Removes leftovers from interrupted test runs. Safe to run at any time.
 *
 * WHAT IT WILL NOT DO
 *   It never deletes an auth identity by address pattern. `create_child` provisions child
 *   identities with a generated `@kidchore.local` address, so matching on that pattern
 *   also matches real children - doing so once deleted a real child's identity and locked
 *   them out of their account.
 *
 *   Instead, an identity is only removed when the app profile it belongs to is itself
 *   being removed as test residue. Identities belonging to real accounts are left alone,
 *   whatever their address looks like.
 *
 * Usage:
 *   node scripts/cleanup-fixtures.mjs           # report only
 *   node scripts/cleanup-fixtures.mjs --apply   # perform the cleanup
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const apply = process.argv.includes("--apply");

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

/** Families created by the test suites, recognised by their naming convention. */
const TEST_FAMILY_PATTERN = "^__(TEST|E2E|PROD|REPORTS|ONBOARD|CHILD|SWITCH|STREAK|DIAG)";
/** Usernames and emails created by the test suites. */
const TEST_EMAIL_PATTERN = "@example\\.com$|@kidchore\\.test$";
const TEST_USERNAME_PATTERN =
  "^(test|e2e|prod|childflow|switch|onboard|reports|outsider|debug|sub)";

const isTestProfile = `(coalesce(email, '') ~ '${TEST_EMAIL_PATTERN}' or coalesce(username, '') ~ '${TEST_USERNAME_PATTERN}')`;

console.log("=== test families that would be removed ===");
const families = await db.query(
  `select id, family_name,
          (select count(*)::int from public.users u where u.family_id = f.id) as members
   from public.families f
   where family_name ~ $1
   order by family_name`,
  [TEST_FAMILY_PATTERN]
);
if (families.rows.length === 0) console.log("  (none)");
for (const f of families.rows) {
  console.log(`  ${f.family_name}  (${f.members} member(s))`);
}

console.log("\n=== test user profiles that would be removed ===");
const users = await db.query(
  `select id, display_name, username, email, auth_user_id
   from public.users
   where ${isTestProfile}
   order by display_name`
);
if (users.rows.length === 0) console.log("  (none)");
for (const u of users.rows) {
  console.log(
    `  ${u.display_name} (@${u.username ?? "-"})  linked=${Boolean(u.auth_user_id)}`
  );
}

console.log("\n=== real accounts that are protected ===");
const real = await db.query(
  `select display_name, username, role, (auth_user_id is not null) as linked
   from public.users
   where not ${isTestProfile}
   order by role, display_name`
);
if (real.rows.length === 0) console.log("  (none)");
for (const u of real.rows) {
  console.log(
    `  ${String(u.role).padEnd(7)} ${u.display_name} (@${u.username ?? "-"})  linked=${u.linked}`
  );
}

if (!apply) {
  console.log(
    `\nReport only: ${families.rows.length} famil${families.rows.length === 1 ? "y" : "ies"} and ${users.rows.length} profile(s) would be removed.`
  );
  console.log("Re-run with --apply to perform it.");
  await db.end();
  process.exit(0);
}

console.log("\nApplying cleanup...");

// Collect identities before deleting, because the family cascade unlinks its members.
const doomedIdentities = new Set(
  users.rows.map((u) => u.auth_user_id).filter(Boolean)
);

let removedFamilies = 0;
for (const f of families.rows) {
  const members = await db.query(
    "select auth_user_id from public.users where family_id = $1 and auth_user_id is not null",
    [f.id]
  );
  for (const m of members.rows) doomedIdentities.add(m.auth_user_id);

  const res = await db.query("delete from public.families where id = $1", [f.id]);
  removedFamilies += res.rowCount ?? 0;
}

const removedUsers = await db.query(
  `delete from public.users where ${isTestProfile} returning id`
);

let removedIdentities = 0;
for (const id of doomedIdentities) {
  await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
  const res = await db
    .query("delete from auth.users where id = $1", [id])
    .catch(() => ({ rowCount: 0 }));
  removedIdentities += res.rowCount ?? 0;
}

console.log(`  removed ${removedFamilies} test families`);
console.log(`  removed ${removedUsers.rowCount} test profiles`);
console.log(`  removed ${removedIdentities} auth identities`);

console.log("\n=== remaining ===");
const left = await db.query(`
  select
    (select count(*)::int from public.families) as families,
    (select count(*)::int from public.users) as users,
    (select count(*)::int from auth.users) as auth_users
`);
console.log(
  `  ${left.rows[0].families} families, ${left.rows[0].users} users, ${left.rows[0].auth_users} auth users`
);

const broken = await db.query(`
  select count(*)::int as n from public.users
  where role = 'CHILD' and pin_code is not null and auth_user_id is null
`);
if (broken.rows[0].n > 0) {
  console.log(
    `  WARNING: ${broken.rows[0].n} child(ren) still have a PIN but no identity. Run scripts/repair-child-identity.mjs`
  );
}

await db.end();
