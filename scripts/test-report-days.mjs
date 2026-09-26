/**
 * Tests the day alignment used by the completion report.
 *
 * `child_daily_completion` returns only the days that had work. If the report rendered
 * that array directly, the gaps would vanish and a month with eleven empty days would look
 * identical to a full one. These checks pin the expansion, including the edges.
 *
 * The module is imported directly, so the test cannot drift from the implementation the
 * component uses.
 *
 * Usage: node scripts/test-report-days.mjs
 */
import { buildSeries, cellDay, cellLabel, cellTone, parseDay } from "../lib/report-days.ts";

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

/** Builds a daily entry the way the database would return it. */
function day(dayString, assigned, approved) {
  return {
    day: dayString,
    assigned,
    approved,
    complete: assigned > 0 && approved === assigned,
  };
}

console.log("Day alignment for the completion report\n");

// ---- 1. Length and edges ----
console.log("1. The series always covers the whole window");
const empty = buildSeries([], "2026-03-01", 30);
check("an empty series still has one cell per day", empty.length === 30, `length=${empty.length}`);
check(
  "every cell of an empty series is null",
  empty.every((cell) => cell === null),
  "a cell was not null"
);
check(
  "the first day is the window start",
  cellDay("2026-03-01", 0) === "2026-03-01",
  cellDay("2026-03-01", 0)
);
check(
  "the last day is start + days - 1",
  cellDay("2026-03-01", 29) === "2026-03-30",
  cellDay("2026-03-01", 29)
);

// ---- 2. Gaps are preserved ----
console.log("\n2. Gaps are kept rather than closed");
const sparse = buildSeries(
  [day("2026-03-02", 2, 2), day("2026-03-05", 1, 0)],
  "2026-03-01",
  6
);
check("the series length matches the window", sparse.length === 6, `length=${sparse.length}`);
check("day 0 (nothing assigned) is null", sparse[0] === null, JSON.stringify(sparse[0]));
check("day 1 lands in the right cell", sparse[1]?.day === "2026-03-02", JSON.stringify(sparse[1]));
check("days 2 and 3 stay null", sparse[2] === null && sparse[3] === null, "a gap was filled");
check("day 4 lands in the right cell", sparse[4]?.day === "2026-03-05", JSON.stringify(sparse[4]));
check("day 5 is null", sparse[5] === null, JSON.stringify(sparse[5]));

// ---- 3. Order is not assumed ----
console.log("\n3. Input order does not matter");
const unsorted = buildSeries(
  [day("2026-03-04", 1, 1), day("2026-03-02", 1, 1)],
  "2026-03-02",
  3
);
check(
  "an out-of-order input still lands in the right cells",
  unsorted[0]?.day === "2026-03-02" && unsorted[2]?.day === "2026-03-04",
  JSON.stringify(unsorted.map((c) => c?.day ?? null))
);

// ---- 4. Entries outside the window are ignored ----
console.log("\n4. Entries outside the window are ignored");
const outside = buildSeries(
  [day("2026-02-28", 1, 1), day("2026-03-02", 1, 1), day("2026-04-01", 1, 1)],
  "2026-03-01",
  3
);
check(
  "only the in-window day appears",
  outside[0] === null && outside[1]?.day === "2026-03-02" && outside[2] === null,
  JSON.stringify(outside.map((c) => c?.day ?? null))
);

// ---- 5. Month rollover ----
console.log("\n5. Crossing a month boundary");
const rollover = buildSeries([day("2026-03-01", 1, 1)], "2026-02-27", 4);
check(
  "February to March is handled without an off-by-one",
  rollover[2]?.day === "2026-03-01",
  JSON.stringify(rollover.map((c) => c?.day ?? null))
);
check(
  "a leap day is handled",
  cellDay("2028-02-28", 1) === "2028-02-29",
  cellDay("2028-02-28", 1)
);

// ---- 6. Tone and label ----
console.log("\n6. Cell colour and tooltip");
check("a day with no work is grey", cellTone(null) === "none", cellTone(null));
check(
  "a fully approved day is green",
  cellTone(day("2026-03-01", 3, 3)) === "complete",
  cellTone(day("2026-03-01", 3, 3))
);
check(
  "a partly approved day is amber",
  cellTone(day("2026-03-01", 3, 1)) === "partial",
  cellTone(day("2026-03-01", 3, 1))
);
check(
  "a day with work but nothing approved is amber, not green",
  cellTone(day("2026-03-01", 2, 0)) === "partial",
  cellTone(day("2026-03-01", 2, 0))
);
check(
  "the label for a spent day names the counts",
  cellLabel(day("2026-03-01", 3, 2)) === "chưa xong 2/3",
  cellLabel(day("2026-03-01", 3, 2))
);
check(
  "the label for a gap says so",
  cellLabel(null) === "không giao việc",
  cellLabel(null)
);

// ---- 7. Parsing ----
console.log("\n7. Date parsing");
check(
  "a date string parses as UTC midnight",
  new Date(parseDay("2026-03-01")).toISOString() === "2026-03-01T00:00:00.000Z",
  new Date(parseDay("2026-03-01")).toISOString()
);
check(
  "parsing is not affected by the local timezone offset",
  cellDay("2026-03-01", 0) === "2026-03-01",
  cellDay("2026-03-01", 0)
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
