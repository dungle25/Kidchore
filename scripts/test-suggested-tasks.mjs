/**
 * Tests the quick-add catalogue and the rules that decide what a bulk add creates.
 *
 * No database and no browser: these are the decisions, and they are the part that is
 * easy to get subtly wrong. Two identical "Đánh răng" rows would generate two instances
 * every day from then on, and nobody would notice until a child asked why they were
 * being paid twice.
 *
 * Usage: node scripts/test-suggested-tasks.mjs
 */
import { SUGGESTED_TASKS, planQuickAdd, titleKey } from "../lib/suggested-tasks.ts";

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

console.log("Testing the suggested chore catalogue...\n");

// ---- 1. The catalogue itself ----
console.log("1. The catalogue is sane");

check("it is not empty", SUGGESTED_TASKS.length > 0, `${SUGGESTED_TASKS.length} entries`);

const emptyTitles = SUGGESTED_TASKS.filter((task) => !task.title.trim());
check("every chore has a name", emptyTitles.length === 0, JSON.stringify(emptyTitles));

const badPoints = SUGGESTED_TASKS.filter(
  (task) => !Number.isInteger(task.points) || task.points <= 0
);
check(
  "every chore has a positive whole number of points",
  badPoints.length === 0,
  JSON.stringify(badPoints)
);

const keys = SUGGESTED_TASKS.map((task) => titleKey(task.title));
const duplicateKeys = keys.filter((key, index) => keys.indexOf(key) !== index);
check(
  "no two suggested chores share a name",
  duplicateKeys.length === 0,
  `repeated: ${[...new Set(duplicateKeys)].join(", ")}`
);

const untrimmed = SUGGESTED_TASKS.filter((task) => task.title !== task.title.trim());
check(
  "no name has stray whitespace",
  untrimmed.length === 0,
  JSON.stringify(untrimmed.map((task) => task.title))
);

// A catalogue that is all or nothing on photos would make the "cần ảnh" column in the
// quick-add screen pointless.
check(
  "both photo-required and one-tap chores are offered",
  SUGGESTED_TASKS.some((task) => task.needsPhoto) &&
    SUGGESTED_TASKS.some((task) => !task.needsPhoto),
  ""
);

// ---- 2. What gets created ----
console.log("\n2. What a bulk add creates");

const plan = planQuickAdd(
  [
    { title: "Đánh răng", pointsReward: 2, requireProofImage: false },
    { title: "Rửa bát", pointsReward: 8, requireProofImage: true },
  ],
  []
);
check("a fresh family gets everything it picked", plan.toCreate.length === 2, JSON.stringify(plan));
check("nothing is skipped", plan.skipped.length === 0, JSON.stringify(plan.skipped));
check("nothing is rejected", plan.invalid.length === 0, JSON.stringify(plan.invalid));
check(
  "the photo flag is carried through",
  plan.toCreate[1].requireProofImage === true && plan.toCreate[0].requireProofImage === false,
  JSON.stringify(plan.toCreate)
);

// ---- 3. Duplicates ----
console.log("\n3. Duplicates");

const existing = planQuickAdd([{ title: "Đánh răng", pointsReward: 2, requireProofImage: false }], [
  "đánh răng",
]);
check(
  "a chore the family already has is skipped, ignoring case",
  existing.toCreate.length === 0 && existing.skipped.length === 1,
  JSON.stringify(existing)
);

const spaced = planQuickAdd(
  [{ title: "  Rửa bát  ", pointsReward: 8, requireProofImage: true }],
  ["Rửa bát"]
);
check(
  "surrounding spaces do not create a second copy",
  spaced.toCreate.length === 0 && spaced.skipped.length === 1,
  JSON.stringify(spaced)
);

// The check against existing rows cannot catch this one: neither copy exists yet.
const twiceInBatch = planQuickAdd(
  [
    { title: "Quét nhà", pointsReward: 5, requireProofImage: true },
    { title: "quét nhà ", pointsReward: 9, requireProofImage: false },
  ],
  []
);
check(
  "the same chore twice in one batch is created once",
  twiceInBatch.toCreate.length === 1 && twiceInBatch.skipped.length === 1,
  JSON.stringify(twiceInBatch)
);
check(
  "and the first copy wins, so the parent's own edit is the one kept",
  twiceInBatch.toCreate[0]?.pointsReward === 5,
  JSON.stringify(twiceInBatch.toCreate)
);

// ---- 4. Refused input ----
console.log("\n4. Input that cannot be saved");

for (const [label, points] of [
  ["zero", 0],
  ["negative", -3],
  ["fractional", 2.5],
  ["not a number", Number("abc")],
]) {
  const result = planQuickAdd(
    [{ title: "Tưới cây", pointsReward: points, requireProofImage: false }],
    []
  );
  check(
    `${label} points is refused with a reason`,
    result.toCreate.length === 0 &&
      result.invalid.length === 1 &&
      Boolean(result.invalid[0].reason),
    JSON.stringify(result)
  );
}

const blank = planQuickAdd([{ title: "   ", pointsReward: 5, requireProofImage: false }], []);
check(
  "a blank name is ignored rather than saved as an empty chore",
  blank.toCreate.length === 0 && blank.skipped.length === 0 && blank.invalid.length === 0,
  JSON.stringify(blank)
);

// ---- 5. Order and trimming ----
console.log("\n5. Order and trimming");

const ordered = planQuickAdd(
  [
    { title: "  Đánh răng ", pointsReward: 2, requireProofImage: false },
    { title: "Rửa bát", pointsReward: 8, requireProofImage: true },
    { title: "Quét nhà", pointsReward: 5, requireProofImage: true },
  ],
  ["Rửa bát"]
);
check(
  "the order the parent sees is the order they are created in",
  ordered.toCreate.map((item) => item.title).join(" | ") === "Đánh răng | Quét nhà",
  JSON.stringify(ordered.toCreate.map((item) => item.title))
);
check(
  "names are stored trimmed",
  ordered.toCreate[0].title === "Đánh răng",
  JSON.stringify(ordered.toCreate[0])
);

// The catalogue is what the screen pre-fills, so it has to survive its own rules.
const wholeCatalogue = planQuickAdd(
  SUGGESTED_TASKS.map((task) => ({
    title: task.title,
    pointsReward: task.points,
    requireProofImage: task.needsPhoto,
  })),
  []
);
check(
  "adding the whole catalogue at once creates every entry",
  wholeCatalogue.toCreate.length === SUGGESTED_TASKS.length &&
    wholeCatalogue.invalid.length === 0,
  JSON.stringify(wholeCatalogue.invalid)
);

const secondTime = planQuickAdd(
  SUGGESTED_TASKS.map((task) => ({
    title: task.title,
    pointsReward: task.points,
    requireProofImage: task.needsPhoto,
  })),
  SUGGESTED_TASKS.map((task) => task.title)
);
check(
  "pressing the button a second time creates nothing",
  secondTime.toCreate.length === 0 && secondTime.skipped.length === SUGGESTED_TASKS.length,
  JSON.stringify(secondTime)
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
