/**
 * Tests how the approval queue is grouped by child.
 *
 * No database and no browser: this is the decision about what a parent sees, and the
 * cases that matter are the ones a single-child fixture would never reach - two children
 * interleaved in the queue, a child with several submissions, and the name order that
 * decides whether the page reshuffles itself between renders.
 *
 * Usage: node scripts/test-approval-groups.mjs
 */
import { groupApprovalsByChild } from "../lib/approval-groups.ts";

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

/** Only the fields the grouping reads; the rest of PendingApproval is irrelevant here. */
function submission(id, childId, childName, points) {
  return {
    id,
    child_id: childId,
    child_name: childName,
    task_title: `Việc ${id}`,
    points_reward: points,
  };
}

const shape = (blocks) =>
  blocks.map((b) => (b.kind === "header" ? `H:${b.childName}` : `T:${b.item.id}`)).join(" ");

console.log("Testing approval grouping...\n");

// ---- 1. Empty ----
console.log("1. Nothing waiting");
check("an empty queue produces nothing to render", groupApprovalsByChild([]).length === 0, "");

// ---- 2. One child ----
console.log("\n2. One child");
const one = groupApprovalsByChild([
  submission("a", "k1", "Ken", 5),
  submission("b", "k1", "Ken", 3),
]);
check("a single child still gets a heading", shape(one) === "H:Ken T:a T:b", shape(one));
check(
  "the heading counts their submissions",
  one[0].count === 2,
  String(one[0].count)
);
check(
  "and totals the points at stake",
  one[0].points === 8,
  String(one[0].points)
);

// ---- 3. Two children, interleaved ----
console.log("\n3. Two children, interleaved in the queue");
// This is the case the issue was about: without grouping, a parent has to read the small
// grey line under each card to know who they are about to pay.
const interleaved = groupApprovalsByChild([
  submission("a", "k1", "Ken", 5),
  submission("b", "k2", "Kun", 2),
  submission("c", "k1", "Ken", 3),
  submission("d", "k2", "Kun", 4),
]);
check(
  "each child's submissions end up together",
  shape(interleaved) === "H:Ken T:a T:c H:Kun T:b T:d",
  shape(interleaved)
);
check(
  "the second child's total is their own",
  interleaved[3].points === 6,
  String(interleaved[3].points)
);
check(
  "and every submission is still rendered exactly once",
  interleaved.filter((b) => b.kind === "task").length === 4,
  String(interleaved.filter((b) => b.kind === "task").length)
);

// ---- 4. Order ----
console.log("\n4. Order");
const order = groupApprovalsByChild([
  submission("a", "k3", "Bống", 1),
  submission("b", "k1", "An", 1),
  submission("c", "k2", "Đào", 1),
]);
// Vietnamese collation, not the default: without it "Đ" sorts after "Z" and the list
// reads as if it were ordered at random.
check(
  "children are ordered by name, Vietnamese collation",
  shape(order) === "H:An T:b H:Bống T:a H:Đào T:c",
  shape(order)
);
check(
  "the same input always produces the same order",
  shape(groupApprovalsByChild([
    submission("c", "k2", "Đào", 1),
    submission("a", "k3", "Bống", 1),
    submission("b", "k1", "An", 1),
  ])) === "H:An T:b H:Bống T:a H:Đào T:c",
  "order depends on input order"
);

// ---- 5. Edge cases ----
console.log("\n5. Edge cases");
const sameName = groupApprovalsByChild([
  submission("a", "k1", "Ken", 1),
  submission("b", "k2", "Ken", 1),
]);
check(
  "two children with the same name stay separate",
  sameName.filter((b) => b.kind === "header").length === 2,
  shape(sameName)
);

const zeroPoints = groupApprovalsByChild([submission("a", "k1", "Ken", 0)]);
check("a zero-point submission still totals zero, not undefined", zeroPoints[0].points === 0, String(zeroPoints[0].points));

// The heading and the card both contain the child's name, which is why the heading is
// identified by an attribute in the DOM rather than by its text.
const card = interleaved.find((b) => b.kind === "task");
check(
  "a task block carries its own item, unchanged",
  card.item.id === "a" && card.item.child_name === "Ken",
  JSON.stringify(card.item)
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
