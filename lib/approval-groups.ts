import type { PendingApproval } from "./domain";

/**
 * Grouping the approval queue by the child who submitted.
 *
 * Pure and free of React so the rules can be tested from Node. They are small but not
 * trivial - the ordering has to be stable or the page reshuffles itself between renders,
 * and the points total is the number a parent is actually deciding about.
 */

/** One rendered line: either a child's heading or one submission. */
export type ApprovalBlock =
  | {
      kind: "header";
      childId: string;
      childName: string;
      /** How many submissions are waiting from this child. */
      count: number;
      /** What approving all of them would be worth. */
      points: number;
    }
  | { kind: "task"; item: PendingApproval };

/**
 * Groups submissions by child, in name order.
 *
 * Name order rather than "whoever submitted first": the queue is read by a person
 * scanning for a child, and a list that reorders itself as submissions arrive is harder
 * to scan than one that does not. Vietnamese collation, because the names are Vietnamese
 * and `localeCompare` without it puts "Đ" after "Z".
 */
export function groupApprovalsByChild(items: PendingApproval[]): ApprovalBlock[] {
  const byChild = new Map<string, PendingApproval[]>();

  for (const item of items) {
    const list = byChild.get(item.child_id);
    if (list) list.push(item);
    else byChild.set(item.child_id, [item]);
  }

  const sorted = [...byChild.entries()].sort((a, b) =>
    a[1][0].child_name.localeCompare(b[1][0].child_name, "vi")
  );

  const blocks: ApprovalBlock[] = [];
  for (const [childId, list] of sorted) {
    blocks.push({
      kind: "header",
      childId,
      childName: list[0].child_name,
      count: list.length,
      points: list.reduce((sum, item) => sum + item.points_reward, 0),
    });
    for (const item of list) blocks.push({ kind: "task", item });
  }

  return blocks;
}
