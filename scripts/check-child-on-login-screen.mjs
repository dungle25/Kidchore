/**
 * Confirms the deployed sign-in screen offers each child account and a PIN field.
 *
 * Reads only what any anonymous visitor sees, so it needs no credentials and no PIN.
 *
 * Implementation note: React inserts a comment marker between adjacent text nodes, so a
 * rendered username appears as `@<!-- -->ken159`. Matching on the pattern `@name` finds
 * nothing; the hidden `name="username"` input carries the real value and is the reliable
 * thing to read.
 *
 * Usage: node scripts/check-child-on-login-screen.mjs [baseUrl]
 */
const base = process.argv[2] ?? "https://kidchore-omega.vercel.app";

const res = await fetch(`${base}/login`, { cache: "no-store" });
const html = await res.text();

console.log(`GET ${base}/login -> HTTP ${res.status}\n`);

if (res.status !== 200) {
  console.log("The sign-in page did not load.");
  process.exit(1);
}

// One hidden input per child form; its value is the username the action receives.
const usernames = [...html.matchAll(/name="username"\s+value="([^"]+)"/g)].map((m) => m[1]);

// The display name sits in the card heading next to the avatar.
const displayNames = [...html.matchAll(/text-lg font-semibold text-slate-800">([^<]+)</g)].map(
  (m) => m[1]
);

const pins = [...html.matchAll(/name="pin"/g)].length;
const emptyNotice = /Chưa có bé nào được tạo/.test(html);

console.log(`child forms with a username : ${usernames.length}`);
console.log(`PIN inputs                  : ${pins}`);
console.log(`"no children yet" notice    : ${emptyNotice}`);

for (let i = 0; i < usernames.length; i += 1) {
  const name = displayNames[i] ?? "(unknown)";
  console.log(`  ${name.padEnd(18)} @${usernames[i]}  pin=${i < pins ? "yes" : "no"}`);
}

console.log("\n=== verdict ===");
if (usernames.length > 0 && usernames.length === pins) {
  console.log("  Every child account is selectable and has its own PIN field, so a child can");
  console.log("  sign in from this deployment.");
  console.log("");
  console.log("  The remaining step is a person typing the PIN chosen when the account was");
  console.log("  created, which cannot be checked without knowing it.");
} else if (emptyNotice) {
  console.log("  No child with a PIN exists yet. Create one under Gia đình as a parent.");
} else {
  console.log("  Unexpected state: usernames and PIN fields do not line up. Inspect the page.");
  process.exit(1);
}
