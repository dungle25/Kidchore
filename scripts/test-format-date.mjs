/**
 * Timestamp formatting, with the timezone bug that shipped this as its reason to exist.
 *
 * The assertions run under `TZ=UTC` (see the re-exec below). That matters: the bug was
 * `toLocaleString("vi-VN", {...})` with no `timeZone`, which formats in whatever zone the
 * process runs in. On a developer machine in Việt Nam, dropping `timeZone` changes nothing
 * - server and browser agree - so a test that ran in the local zone would pass with the
 * bug still in place. Under UTC, a missing `timeZone` shifts every timestamp by 7 hours and
 * the test fails.
 *
 * Usage: node scripts/test-format-date.mjs
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Re-run under UTC unless we are already there. `stdio: "inherit"` keeps the output in one
// place, and the child's exit code is this script's exit code.
if (process.env.TZ !== "UTC") {
  const rerun = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, TZ: "UTC" },
    stdio: "inherit",
  });
  process.exit(rerun.status ?? 1);
}

const { FAMILY_TIME_ZONE, formatDateTime } = await import("../lib/format-date.ts");

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

// The guard itself is asserted, so this suite cannot silently pass by having failed to
// arrange the one condition it exists for.
check(
  "the assertions really are running under UTC",
  Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC",
  `timeZone=${Intl.DateTimeFormat().resolvedOptions().timeZone}`
);
check("the family timezone is the one the app documents", FAMILY_TIME_ZONE === "Asia/Ho_Chi_Minh", FAMILY_TIME_ZONE);

// Nothing to show must render as nothing, not as "Invalid Date".
check("an empty value renders as an empty string", formatDateTime("") === "", JSON.stringify(formatDateTime("")));
check("null renders as an empty string", formatDateTime(null) === "", JSON.stringify(formatDateTime(null)));
check(
  "undefined renders as an empty string",
  formatDateTime(undefined) === "",
  JSON.stringify(formatDateTime(undefined))
);
check(
  "an unparseable value renders as an empty string",
  formatDateTime("not a date") === "",
  JSON.stringify(formatDateTime("not a date"))
);

// 04:35 UTC is 11:35 in Việt Nam (UTC+7).
//
// The exact string is pinned on purpose. It is what `vi-VN` gives under this Node's ICU
// ("HH:mm DD-MM", not the "DD/MM HH:mm" one might guess), and Chromium was checked to
// produce byte-identical output for the same options - which is why the server render and
// the hydrated client cannot disagree once the timezone is fixed. If an ICU upgrade ever
// changes the separator, this failing is the correct outcome: what parents see changes.
check(
  "a UTC timestamp is shown in the family's timezone",
  formatDateTime("2026-09-27T04:35:00Z") === "11:35 27-09",
  formatDateTime("2026-09-27T04:35:00Z")
);

// The case the bug was reported for: late-evening UTC is already the next day in Việt Nam,
// so both the time and the date have to roll over.
check(
  "a timestamp just before midnight UTC is shown as the next day locally",
  formatDateTime("2026-09-26T20:00:00Z") === "03:00 27-09",
  formatDateTime("2026-09-26T20:00:00Z")
);

// 17:00 UTC is midnight in Việt Nam: the boundary in the other direction.
check(
  "midnight locally is not shown as the previous day",
  formatDateTime("2026-09-26T17:00:00Z") === "00:00 27-09",
  formatDateTime("2026-09-26T17:00:00Z")
);

// A value that already carries an offset must be converted, not taken at face value.
check(
  "a timestamp with an explicit offset is converted",
  formatDateTime("2026-09-27T11:35:00+07:00") === "11:35 27-09",
  formatDateTime("2026-09-27T11:35:00+07:00")
);

// Single-digit days and hours still get two digits, so a column of timestamps lines up.
check(
  "day and hour are always two digits",
  formatDateTime("2026-01-02T01:05:00Z") === "08:05 02-01",
  formatDateTime("2026-01-02T01:05:00Z")
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
