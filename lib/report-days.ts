import type { DailyCompletion } from "./domain";

/**
 * Day alignment for the completion report.
 *
 * Kept in its own module, separate from the React component, so it can be tested from
 * Node. It is pure and easy to get subtly wrong, and it already has a history: the streak
 * calculation in SQL was wrong once in exactly this kind of date arithmetic, and the test
 * suite is what caught it.
 *
 * No `"use client"` here and no React import, so a plain Node test can load it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC for a `YYYY-MM-DD` string, which is how a Postgres `date` arrives. */
export function parseDay(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

/** Formats a UTC timestamp back to the `YYYY-MM-DD` form the database uses. */
export function formatDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** One cell of the report strip. `null` means no work was assigned that day. */
export type SeriesCell = DailyCompletion | null;

/**
 * Expands the sparse daily series into exactly one entry per day in the window.
 *
 * `child_daily_completion` only returns days that had work. Rendering that array directly
 * would silently close the gaps, so a month with eleven empty days would look identical to
 * a full month — and the gaps are the interesting part, because they show a week where
 * nothing was assigned.
 *
 * The returned array always has `days` entries, in ascending date order, with `from` as
 * the first. A cell for a day with no entry is `null`.
 */
export function buildSeries(
  daily: DailyCompletion[],
  from: string,
  days: number
): SeriesCell[] {
  const byDay = new Map(daily.map((entry) => [entry.day, entry]));
  const start = parseDay(from);

  return Array.from({ length: days }, (_, offset) => {
    const key = formatDayKey(start + offset * DAY_MS);
    return byDay.get(key) ?? null;
  });
}

/** The date key for a cell, whether or not work was assigned that day. */
export function cellDay(from: string, offset: number): string {
  return formatDayKey(parseDay(from) + offset * DAY_MS);
}

/** Which colour a cell takes. */
export function cellTone(entry: DailyCompletion | null): "complete" | "partial" | "none" {
  if (!entry) return "none";
  return entry.complete ? "complete" : "partial";
}

/** A readable tooltip for a cell. */
export function cellLabel(entry: DailyCompletion | null): string {
  if (!entry) return "không giao việc";
  return entry.complete
    ? `hoàn thành ${entry.approved}/${entry.assigned}`
    : `chưa xong ${entry.approved}/${entry.assigned}`;
}
