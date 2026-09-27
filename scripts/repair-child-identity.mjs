/**
 * Repairs a child account that has a PIN but no sign-in identity.
 *
 * In the app a parent can do this from Gia đình -> "Sửa ngay", which calls the
 * `repair_child_identities` function. That path needs a parent session. This script exists
 * for the case where the parent cannot get in, or where the repair has to be applied
 * directly with database access.
 *
 * It mirrors exactly what migration 0005 does for a new child, so the result is identical
 * to the in-app repair.
 *
 * Usage:
 *   node scripts/repair-child-identity.mjs            # report only, changes nothing
 *   node scripts/repair-child-identity.mjs --apply    # create the missing identities
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sslForDatabase } from "./lib/database-ssl.mjs";

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
  ssl: sslForDatabase(env.DATABASE_URL),
});
await db.connect();

/** Children who can be selected to sign in but have no identity to sign in with. */
const broken = await db.query(`
  select u.id, u.display_name, u.username, u.family_id, f.family_name
  from public.users u
  join public.families f on f.id = u.family_id
  where u.role = 'CHILD'
    and u.pin_code is not null
    and u.auth_user_id is null
  order by u.display_name
`);

console.log(`Children with a PIN but no sign-in identity: ${broken.rows.length}`);
for (const child of broken.rows) {
  console.log(`  ${child.display_name} (@${child.username}) in ${child.family_name}`);
}

if (broken.rows.length === 0) {
  console.log("\nNothing to repair.");
  await db.end();
  process.exit(0);
}

if (!apply) {
  console.log("\nReport only. Re-run with --apply to create the missing identities.");
  await db.end();
  process.exit(0);
}

console.log("\nCreating identities...");
let repaired = 0;

for (const child of broken.rows) {
  // Same shape as migration 0005: a deterministic, non-routable address derived from the
  // profile id, so it can never collide with a real one.
  const email = `${child.id}@kidchore.local`;
  const newId = randomUUID();

  await db.query("begin");
  try {
    await db.query(
      `insert into auth.users (
         id, instance_id, aud, role, email,
         encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at,
         confirmation_token, recovery_token, email_change_token_new, email_change
       ) values (
         $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2,
         extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 10)), now(),
         jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
         jsonb_build_object('kidchore_child', true),
         now(), now(), '', '', '', ''
       )`,
      [newId, email]
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
      [newId, email]
    );

    await db.query("update public.users set auth_user_id = $1 where id = $2", [
      newId,
      child.id,
    ]);

    await db.query("commit");
    console.log(`  repaired ${child.display_name} (@${child.username})`);
    repaired += 1;
  } catch (error) {
    await db.query("rollback");
    console.error(`  FAILED for ${child.display_name}: ${error.message}`);
  }
}

console.log(`\n${repaired} of ${broken.rows.length} repaired.`);

// Confirm the result rather than assuming the writes succeeded.
const after = await db.query(`
  select count(*)::int as n
  from public.users
  where role = 'CHILD' and pin_code is not null and auth_user_id is null
`);
console.log(
  after.rows[0].n === 0
    ? "Every child with a PIN now has a sign-in identity."
    : `${after.rows[0].n} child(ren) still without an identity.`
);

await db.end();
