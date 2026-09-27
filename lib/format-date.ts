/**
 * Timestamp formatting for the screens.
 *
 * This lives in `lib/` rather than in `components/ui.tsx` so it can be tested without a
 * browser, the same reason `report-days.ts`, `suggested-tasks.ts` and `invite-code.ts`
 * live here.
 *
 * **The timezone is fixed on purpose.** Without it, `toLocaleString` formats in whatever
 * timezone the code happens to run in: on Vercel that is UTC for the server render and the
 * visitor's own zone in the browser. A parent in Việt Nam was therefore shown "nộp lúc
 * 04:35" for a chore submitted at 11:35 local time, and `app/parent/chores/approval-list.tsx`
 * is a client component, so the same timestamp could render once on the server and then be
 * replaced on hydration - a text mismatch, which React reports as an error.
 *
 * That bug is invisible on a developer machine: server and browser share one timezone
 * there, so nothing differs. It only appears in production, which is why the test that
 * covers it runs the assertions under `TZ=UTC` (see `scripts/test-format-date.mjs`).
 *
 * The family app is single-locale (`vi-VN` is hardcoded above) and single-timezone, so one
 * constant is the honest model. If families in other zones are ever supported, this is the
 * one place to read a per-family setting from.
 */
export const FAMILY_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Formats a timestamp in the family's locale **and** timezone. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", {
    timeZone: FAMILY_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
