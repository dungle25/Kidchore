/**
 * Checks whether the real child account still has its sign-in identity.
 *
 * Test cleanup deletes `auth.users` rows with a generated `@kidchore.local` address. That
 * pattern also matches identities provisioned for real children by `create_child`, so a
 * careless cleanup could unlink a real child and lock them out. This reports the current
 * state without changing anything.
 *
 * Usage: node scripts/check-child-identity.mjs
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

console.log("=== every app user ===");
const users = await db.query(`
  select u.id, u.role, u.display_name, u.username, u.auth_user_id,
         (u.pin_code is not null) as has_pin,
         f.family_name
  from public.users u
  left join public.families f on f.id = u.family_id
  order by u.role, u.display_name
`);
for (const u of users.rows) {
  const linked = u.auth_user_id ? "linked" : "NOT LINKED";
  console.log(
    `  ${String(u.role).padEnd(7)} ${String(u.display_name).padEnd(10)} @${String(u.username ?? "-").padEnd(14)} pin=${u.has_pin}  ${linked}  [${u.family_name}]`
  );
}

console.log("\n=== auth.users rows ===");
const authUsers = await db.query(
  "select id, email, created_at from auth.users order by created_at"
);
for (const a of authUsers.rows) {
  console.log(`  ${a.email}  ${a.created_at.toISOString().slice(0, 19)}`);
}

console.log("\n=== generated child identities (@kidchore.local) ===");
const generated = await db.query(
  "select id, email from auth.users where email like '%@kidchore.local'"
);
if (generated.rows.length === 0) {
  console.log("  (none)");
}
for (const g of generated.rows) {
  // Which app user does this identity belong to, if any?
  const owner = await db.query(
    "select display_name, username from public.users where auth_user_id = $1",
    [g.id]
  );
  const who = owner.rows[0];
  console.log(
    `  ${g.email}  -> ${who ? `${who.display_name} (@${who.username})` : "ORPHAN, belongs to no app user"}`
  );
}

console.log("\n=== diagnosis ===");
const brokenChildren = users.rows.filter(
  (u) => u.role === "CHILD" && u.has_pin && !u.auth_user_id
);
if (brokenChildren.length > 0) {
  console.log(`  ${brokenChildren.length} child(ren) have a PIN but no sign-in identity, so`);
  console.log("  they cannot log in. Fix with the in-app repair, or:");
  for (const c of brokenChildren) {
    console.log(`    - ${c.display_name} (@${c.username})`);
  }
  console.log("");
  console.log("  A parent can repair this from the app: Gia đình -> 'Sửa ngay'.");
  console.log("  Or run: select public.repair_child_identities();  as that parent.");
} else {
  console.log("  Every child with a PIN also has a sign-in identity.");
}

await db.end();
