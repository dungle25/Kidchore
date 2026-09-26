/**
 * Reports whether a real Google signup has completed end to end.
 *
 * A successful Google login should leave an auth.users row (from Supabase Auth) and,
 * after onboarding, a public.families row plus a PARENT public.users row linked by
 * auth_user_id. Checking those is stronger evidence than a screenshot of a page.
 *
 * Usage: node scripts/check-onboarding-state.mjs
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

console.log("=== Supabase Auth users (real sign-ins) ===");
const authUsers = await db.query(`
  select id, email, provider, created_at, last_sign_in_at
  from (
    select u.id, u.email, u.created_at, u.last_sign_in_at,
           coalesce(i.provider, u.raw_app_meta_data->>'provider', 'email') as provider
    from auth.users u
    left join auth.identities i on i.user_id = u.id
    where u.email not like '%@kidchore.local'
  ) s
  order by created_at
`);
if (authUsers.rows.length === 0) {
  console.log("  (none yet)");
}
for (const u of authUsers.rows) {
  console.log(`  ${u.email}  provider=${u.provider}`);
  console.log(`    created=${u.created_at?.toISOString?.() ?? u.created_at}`);
}

console.log("\n=== App families ===");
const families = await db.query(
  "select id, family_name, created_at from public.families order by created_at"
);
if (families.rows.length === 0) console.log("  (none yet)");
for (const f of families.rows) {
  console.log(`  ${f.family_name}  (${f.id})`);
}

console.log("\n=== App users ===");
const users = await db.query(`
  select u.id, u.role, u.display_name, u.email, u.username, u.points_balance,
         (u.auth_user_id is not null) as linked,
         (u.pin_code is not null) as has_pin,
         f.family_name
  from public.users u
  left join public.families f on f.id = u.family_id
  order by u.role, u.display_name
`);
if (users.rows.length === 0) console.log("  (none yet)");
for (const u of users.rows) {
  const bits = [`role=${u.role}`, `linked=${u.linked}`];
  if (u.role === "CHILD") bits.push(`pin=${u.has_pin}`, `points=${u.points_balance}`);
  console.log(`  ${u.display_name.padEnd(22)} ${bits.join("  ")}  [${u.family_name ?? "no family"}]`);
}

console.log("\n=== Verdict ===");
const hasParent = users.rows.some((u) => u.role === "PARENT");
const hasFamily = families.rows.length > 0;
const hasChild = users.rows.some((u) => u.role === "CHILD");

if (hasFamily && hasParent) {
  console.log("  Google signup and onboarding completed: a family and a linked parent exist.");
} else if (authUsers.rows.length > 0) {
  console.log("  A Google identity exists but onboarding has not completed yet.");
  console.log("  (the user authenticated but never submitted the onboarding form)");
} else {
  console.log("  No Google sign-in recorded yet.");
}
if (hasChild) {
  console.log("  A child account exists, so PIN sign-in can be tested too.");
}

await db.end();
