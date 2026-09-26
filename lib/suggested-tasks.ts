/**
 * A short catalogue of chores most families do every day.
 *
 * The parent form already handles a chore nobody has thought of yet: type a name, pick
 * the points, save. What it is bad at is the common case, which is setting up the same
 * dozen everyday things - brushing teeth, hanging the washing, tidying the toys - one
 * modal at a time. That is a five-minute job done on a phone, and it is the first thing
 * a new family has to get through before the app is worth anything to them.
 *
 * So this is a starting point, not a fixed list. Every value here is editable before
 * anything is saved, and nothing in the app depends on these titles: they are only
 * pre-filled text for a form the parent was going to fill in anyway.
 *
 * The points are deliberately small. A daily habit should be worth less than a big
 * one-off job, or the reward shop stops meaning anything; and a family that disagrees
 * can change each number on the way in.
 *
 * Ordered from the quickest to the heaviest, because that is the order a parent reads
 * them in and the order a child would do them.
 */
export interface SuggestedTask {
  title: string;
  /** Pre-filled points; the parent can change it before saving. */
  points: number;
  /** Whether this one normally needs a photo to prove it. */
  needsPhoto: boolean;
}

export const SUGGESTED_TASKS: readonly SuggestedTask[] = [
  { title: "Đánh răng", points: 2, needsPhoto: false },
  { title: "Rửa mặt", points: 2, needsPhoto: false },
  { title: "Gấp chăn màn", points: 3, needsPhoto: false },
  { title: "Xếp sách vở", points: 3, needsPhoto: false },
  { title: "Đổ rác", points: 3, needsPhoto: false },
  { title: "Tưới cây", points: 3, needsPhoto: false },
  { title: "Cho thú cưng ăn", points: 4, needsPhoto: false },
  { title: "Lau bàn ăn", points: 4, needsPhoto: true },
  { title: "Học bài, đọc sách", points: 5, needsPhoto: false },
  { title: "Dọn đồ chơi", points: 5, needsPhoto: true },
  { title: "Quét nhà", points: 5, needsPhoto: true },
  { title: "Xếp quần áo vào tủ", points: 5, needsPhoto: true },
  { title: "Phơi quần áo", points: 6, needsPhoto: true },
  { title: "Rửa bát", points: 8, needsPhoto: true },
];

/**
 * The key used to decide whether a chore already exists.
 *
 * Case and surrounding space are ignored, because "Rửa bát" and "rửa bát " are the same
 * chore to a person and would look like a duplicate in the list. Nothing cleverer than
 * that: two genuinely different chores that happen to share a name are the parent's
 * business, and the quick-add is the only place this is used.
 */
export function titleKey(title: string): string {
  return title.trim().toLowerCase();
}

export interface QuickAddItem {
  title: string;
  pointsReward: number;
  requireProofImage: boolean;
}

export interface QuickAddPlan {
  /** Rows to create, in the order they were submitted. */
  toCreate: QuickAddItem[];
  /** Titles already in the family list, or repeated within this batch. */
  skipped: string[];
  /** Titles that cannot be created, with the reason to show the parent. */
  invalid: { title: string; reason: string }[];
}

/**
 * Decides what a bulk add should actually create.
 *
 * Pure and separate from the Server Action so the rules can be tested without a
 * browser. They are the interesting part of the feature, and they are easy to get
 * subtly wrong:
 *
 *  - an existing title is skipped, because the likely mistake is pressing the button
 *    twice and two identical rows would then generate two instances every day, for good;
 *  - a title repeated *within* the same batch is skipped for the same reason - the check
 *    against existing rows would not catch it, since neither row exists yet;
 *  - points must be a positive whole number. `create_task` refuses anything else, so
 *    catching it here turns a round trip and a raw database error into a plain sentence.
 */
export function planQuickAdd(items: QuickAddItem[], existingTitles: string[]): QuickAddPlan {
  const taken = new Set(existingTitles.map(titleKey));
  const plan: QuickAddPlan = { toCreate: [], skipped: [], invalid: [] };

  for (const item of items) {
    const title = String(item?.title ?? "").trim();
    if (!title) continue;

    const key = titleKey(title);
    if (taken.has(key)) {
      plan.skipped.push(title);
      continue;
    }

    const points = Number(item?.pointsReward);
    if (!Number.isInteger(points) || points <= 0) {
      plan.invalid.push({ title, reason: "Số điểm phải là số nguyên lớn hơn 0." });
      continue;
    }

    taken.add(key);
    plan.toCreate.push({
      title,
      pointsReward: points,
      requireProofImage: Boolean(item?.requireProofImage),
    });
  }

  return plan;
}
