/**
 * Produces the environment variable values needed by Vercel, written to
 * vercel-env.txt (gitignored) so they can be pasted without hunting through files.
 *
 * Also sanity-checks each value, because a deployment that fails on a malformed secret
 * is much harder to debug than one that fails here.
 *
 * Usage: node scripts/export-vercel-env.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
];

// DATABASE_URL is deliberately excluded: it is only used by the migration script, and
// giving the Vercel runtime a direct Postgres connection would widen the blast radius
// for no benefit.
const NOT_NEEDED = ["DATABASE_URL"];

let problems = 0;
const lines = [
  "# KidChore — environment variables for Vercel",
  "# Paste each into Vercel -> Settings -> Environment Variables.",
  "# Apply to Production, Preview and Development.",
  "",
];

for (const key of REQUIRED) {
  const value = env[key];

  if (!value) {
    console.log(`  MISSING  ${key}`);
    problems += 1;
    continue;
  }

  // Cheap shape checks that catch the common copy-paste mistakes.
  let verdict = "ok";
  if (key === "NEXT_PUBLIC_SUPABASE_URL") {
    verdict = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(value)
      ? "ok"
      : "unexpected URL shape";
  } else if (key.endsWith("_KEY") || key.endsWith("_SECRET")) {
    verdict = value.length >= 40 ? `ok (${value.length} chars)` : "suspiciously short";
  }

  if (!verdict.startsWith("ok")) problems += 1;

  console.log(`  ${verdict.padEnd(22)} ${key}`);
  lines.push(`${key}=${value}`, "");
}

console.log("\nNot needed by the running app:");
for (const key of NOT_NEEDED) {
  console.log(`  ${key} ${env[key] ? "(set locally, used only for migrations)" : "(unset)"}`);
}

lines.push(
  "# Not needed: DATABASE_URL. It is only used by scripts/migrate.mjs.",
  ""
);

writeFileSync("vercel-env.txt", lines.join("\n"), "utf8");
console.log("\nWrote vercel-env.txt (gitignored).");
console.log(problems === 0 ? "All four values look well-formed." : `${problems} problem(s) found.`);
process.exit(problems === 0 ? 0 : 1);
