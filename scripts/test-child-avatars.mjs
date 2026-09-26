/**
 * Tests child avatars: what gets stored, who may set one, and what gets drawn.
 *
 * Two kinds of check in one file, because they are the same feature seen from both ends:
 * the pure ones decide what a child sees, the database ones decide who is allowed to
 * change it.
 *
 * The last section is a regression guard. Migration 0013 replaces `create_child` to apply
 * the same avatar rule there, and `create_child` is the one function in this app that a
 * mistake is expensive in: it provisions a sign-in identity in the same transaction, and
 * it maps a duplicate username to a readable error. Both of those are easy to lose while
 * editing something else, and neither would fail loudly.
 *
 * Usage: node scripts/test-child-avatars.mjs
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import pg from "pg";
import { makeIdentityGuard } from "./lib/test-cleanup.mjs";
import { AVATAR_CHOICES, DEFAULT_AVATAR, avatarOf, isImageAvatar, isPresetAvatar } from "../lib/avatars.ts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = env.SUPABASE_JWT_SECRET;

function mint(sub, role, name) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    iss: "supabase", sub, role: "authenticated", aud: "authenticated",
    iat: now, exp: now + 3600, app_role: role, app_name: name,
  })}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

async function rpc(token, fn, args = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function rpcError(token, fn, args) {
  const { status, data } = await rpc(token, fn, args);
  if (status < 400) return null;
  return typeof data === "object" && data ? String(data.message ?? "") : String(data);
}

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

console.log("Testing child avatars...\n");

// ---- 1. The list itself ----
console.log("1. The preset list");

const keys = AVATAR_CHOICES.map((c) => c.key);
check("there is more than one to choose from", AVATAR_CHOICES.length >= 8, String(AVATAR_CHOICES.length));
check("every key is unique", new Set(keys).size === keys.length, keys.join(","));
check(
  "every key matches the shape the database accepts",
  keys.every((key) => /^[a-z0-9-]{1,32}$/.test(key)),
  keys.filter((k) => !/^[a-z0-9-]{1,32}$/.test(k)).join(",")
);
check("every choice has an emoji", AVATAR_CHOICES.every((c) => c.emoji.length > 0), "");
check("every choice has a Vietnamese label", AVATAR_CHOICES.every((c) => c.label.trim().length > 0), "");
check(
  "no two choices share an emoji",
  new Set(AVATAR_CHOICES.map((c) => c.emoji)).size === AVATAR_CHOICES.length,
  ""
);

// ---- 2. What gets drawn ----
console.log("\n2. What gets drawn");

check("nothing stored draws the default", avatarOf(null).value === DEFAULT_AVATAR, avatarOf(null).value);
check("an empty string draws the default", avatarOf("").value === DEFAULT_AVATAR, avatarOf("").value);
check("whitespace draws the default", avatarOf("   ").value === DEFAULT_AVATAR, avatarOf("   ").value);

const fox = AVATAR_CHOICES.find((c) => c.key === "fox");
check("a known key draws its emoji", avatarOf("fox").value === fox.emoji, avatarOf("fox").value);
check("a known key is recognised as a preset", isPresetAvatar("fox"), "");

// The failure this prevents: a child seeing the word "fox" next to their name because a
// key was removed from the list but not from the database.
check(
  "an unknown key falls back to the default, not to the key itself",
  avatarOf("dragon").value === DEFAULT_AVATAR && avatarOf("dragon").value !== "dragon",
  avatarOf("dragon").value
);

check("an https URL is treated as an image", avatarOf("https://example.com/a.png").kind === "image", "");
check(
  "a non-https URL is not treated as an image",
  avatarOf("http://example.com/a.png").kind === "emoji" && !isImageAvatar("http://example.com/a.png"),
  ""
);
check(
  "a javascript: value is not treated as an image",
  !isImageAvatar("javascript:alert(1)") && avatarOf("javascript:alert(1)").kind === "emoji",
  ""
);
check("every preset key draws something, never an image", keys.every((k) => avatarOf(k).kind === "emoji"), "");

// ---- 3. Who may set one ----
console.log("\n3. Who may set one");

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const guard = await makeIdentityGuard(db);

const AUTH = {
  parentA: "55555555-5555-4555-8555-55555555c001",
  childA: "55555555-5555-4555-8555-55555555c002",
  parentB: "55555555-5555-4555-8555-55555555c003",
  childB: "55555555-5555-4555-8555-55555555c004",
};
const FAMILY = "__AVATAR_TEST__";
const OTHER_FAMILY = "__AVATAR_TEST_OTHER__";

async function makeAuthUser(id, email) {
  await db.query("delete from auth.identities where user_id = $1", [id]);
  await db.query("delete from auth.users where id = $1", [id]);
  await db.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new, email_change
     ) values (
       $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2::varchar,
       extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 10)), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
       '{}'::jsonb, now(), now(), '', '', '', ''
     )`,
    [id, email]
  );
}

let familyId = null;
let otherFamilyId = null;

try {
  await db.query("delete from public.families where family_name in ($1, $2)", [FAMILY, OTHER_FAMILY]);
  for (const [name, id] of Object.entries(AUTH)) await makeAuthUser(id, `avatar.${name}@example.com`);

  familyId = (
    await db.query("insert into public.families (family_name) values ($1) returning id", [FAMILY])
  ).rows[0].id;
  otherFamilyId = (
    await db.query("insert into public.families (family_name) values ($1) returning id", [OTHER_FAMILY])
  ).rows[0].id;

  await db.query(
    `insert into public.users (family_id, role, display_name, auth_user_id)
     values ($1, 'PARENT', 'Bố A', $2)`,
    [familyId, AUTH.parentA]
  );
  await db.query(
    `insert into public.users (family_id, role, display_name, auth_user_id)
     values ($1, 'PARENT', 'Bố B', $2)`,
    [otherFamilyId, AUTH.parentB]
  );

  const parentToken = mint(AUTH.parentA, "PARENT", "Bố A");

  // Created through the real function, which is also what the regression section checks.
  const created = await rpc(parentToken, "create_child", {
    p_display_name: "Bé Nhà A",
    p_username: "avatarkid",
    p_pin: "2468",
    p_avatar_url: "panda",
  });
  const childId = created.data?.id;
  check("a child can be created with an avatar", created.status < 400, JSON.stringify(created.data));
  check("and the avatar is stored", created.data?.avatar_url === "panda", String(created.data?.avatar_url));

  // The child's sign-in identity is generated by create_child, not chosen here, so the
  // token has to be minted from what it actually provisioned. Hard-coding an id would
  // make the child look signed out and the role check would pass for the wrong reason.
  const childToken = mint(created.data?.auth_user_id, "CHILD", "Bé Nhà A");

  const otherChild = await db.query(
    `insert into public.users (family_id, role, display_name, username, pin_code)
     values ($1, 'CHILD', 'Bé Nhà B', 'avatarkidb', public.hash_pin('1357')) returning id`,
    [otherFamilyId]
  );
  const otherChildId = otherChild.rows[0].id;

  const set = await rpc(parentToken, "set_child_avatar", { p_child_id: childId, p_avatar: "rocket" });
  check("a parent can change their own child's avatar", set.status < 400, JSON.stringify(set.data));
  const afterSet = await db.query("select avatar_url from public.users where id = $1", [childId]);
  check("the new avatar is stored", afterSet.rows[0].avatar_url === "rocket", String(afterSet.rows[0].avatar_url));

  const cleared = await rpc(parentToken, "set_child_avatar", { p_child_id: childId, p_avatar: null });
  check("a parent can clear it", cleared.status < 400, JSON.stringify(cleared.data));
  const afterClear = await db.query("select avatar_url from public.users where id = $1", [childId]);
  check("clearing stores null", afterClear.rows[0].avatar_url === null, String(afterClear.rows[0].avatar_url));

  // ---- 4. Values that must be refused ----
  console.log("\n4. Values that must be refused");

  for (const [label, value] of [
    ["an https URL", "https://evil.example.com/pixel.png"],
    ["a javascript: value", "javascript:alert(1)"],
    ["a data URI", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
    ["upper case", "Fox"],
    ["spaces", "red fox"],
    ["a colon", "preset:fox"],
    ["a slash", "../../etc/passwd"],
    ["over 32 characters", "a".repeat(33)],
  ]) {
    const refused = await rpcError(parentToken, "set_child_avatar", { p_child_id: childId, p_avatar: value });
    check(`${label} is refused`, Boolean(refused?.includes("INVALID_AVATAR")), String(refused));
  }

  const stillNull = await db.query("select avatar_url from public.users where id = $1", [childId]);
  check("none of those changed the row", stillNull.rows[0].avatar_url === null, String(stillNull.rows[0].avatar_url));

  // ---- 5. Cross-family and roles ----
  console.log("\n5. Cross-family and roles");

  const crossFamily = await rpcError(parentToken, "set_child_avatar", {
    p_child_id: otherChildId,
    p_avatar: "fox",
  });
  check(
    "a parent cannot set another family's child's avatar",
    Boolean(crossFamily?.includes("CHILD_NOT_FOUND")),
    String(crossFamily)
  );

  const parentRowId = (
    await db.query("select id from public.users where family_id = $1 and role = 'PARENT'", [familyId])
  ).rows[0].id;
  const onParent = await rpcError(parentToken, "set_child_avatar", {
    p_child_id: parentRowId,
    p_avatar: "fox",
  });
  check(
    "the target must be a child, not a parent",
    Boolean(onParent?.includes("CHILD_NOT_FOUND")),
    String(onParent)
  );

  const asChild = await rpcError(childToken, "set_child_avatar", { p_child_id: childId, p_avatar: "fox" });
  check(
    "a child cannot set an avatar",
    Boolean(asChild?.includes("PARENT_ROLE_REQUIRED")),
    String(asChild)
  );

  const asAnon = await rpc(anon, "set_child_avatar", { p_child_id: childId, p_avatar: "fox" });
  check("anon cannot set an avatar", asAnon.status >= 400, String(asAnon.status));

  // ---- 6. The avatar reaches the screens that show it ----
  console.log("\n6. The avatar reaches the screens that show it");

  await rpc(parentToken, "set_child_avatar", { p_child_id: childId, p_avatar: "dino" });

  const profiles = await rpc(anon, "list_child_profiles");
  const mine = (Array.isArray(profiles.data) ? profiles.data : []).find((p) => p.username === "avatarkid");
  check(
    "the sign-in screen's profile list carries the avatar",
    mine?.avatar_url === "dino",
    JSON.stringify(mine)
  );
  check(
    "and still carries nothing else private",
    mine && !("pin_code" in mine) && !("points_balance" in mine),
    JSON.stringify(mine)
  );

  const overview = await rpc(parentToken, "parent_overview");
  const overviewChild = (overview.data?.children ?? []).find((c) => c.id === childId);
  check(
    "the parent's own view carries the avatar",
    overviewChild?.avatar_url === "dino",
    JSON.stringify(overviewChild?.avatar_url)
  );

  // ---- 7. Regression guard on create_child ----
  console.log("\n7. create_child still does what it did");

  const identity = await db.query(
    "select auth_user_id from public.users where id = $1",
    [childId]
  );
  check(
    "creating a child still provisions a sign-in identity",
    Boolean(identity.rows[0]?.auth_user_id),
    String(identity.rows[0]?.auth_user_id)
  );
  check(
    "and the returned row reflects it",
    created.data?.auth_user_id === identity.rows[0]?.auth_user_id,
    `returned=${created.data?.auth_user_id} stored=${identity.rows[0]?.auth_user_id}`
  );

  const duplicate = await rpcError(parentToken, "create_child", {
    p_display_name: "Bé Trùng",
    p_username: "avatarkid",
    p_pin: "1111",
  });
  check(
    "a duplicate username still produces a readable error",
    Boolean(duplicate?.includes("USERNAME_TAKEN")),
    String(duplicate)
  );

  const noAvatar = await rpc(parentToken, "create_child", {
    p_display_name: "Bé Không Ảnh",
    p_username: "avatarkid2",
    p_pin: "9999",
  });
  check("a child can still be created with no avatar at all", noAvatar.status < 400, JSON.stringify(noAvatar.data));
  check("and that leaves it null", noAvatar.data?.avatar_url === null, String(noAvatar.data?.avatar_url));

  const badAvatar = await rpcError(parentToken, "create_child", {
    p_display_name: "Bé Ảnh Lạ",
    p_username: "avatarkid3",
    p_pin: "8888",
    p_avatar_url: "https://evil.example.com/x.png",
  });
  check(
    "creating with a URL as the avatar is refused too",
    Boolean(badAvatar?.includes("INVALID_AVATAR")),
    String(badAvatar)
  );
  const notCreated = await db.query("select id from public.users where username = 'avatarkid3'");
  check("and no child was created by that attempt", notCreated.rows.length === 0, "");
} finally {
  if (familyId) await db.query("delete from public.families where id = $1", [familyId]).catch(() => {});
  if (otherFamilyId) await db.query("delete from public.families where id = $1", [otherFamilyId]).catch(() => {});
  await db
    .query("delete from public.families where family_name in ($1, $2)", [FAMILY, OTHER_FAMILY])
    .catch(() => {});
  const removed = await guard.removeCreated();
  for (const id of Object.values(AUTH)) {
    await db.query("delete from auth.identities where user_id = $1", [id]).catch(() => {});
    await db.query("delete from auth.users where id = $1", [id]).catch(() => {});
  }
  await db.end();
  console.log(`\nAvatar fixtures removed (${removed} identity/identities).`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
