"use client";

import type { ChildReport } from "@/lib/domain";
import { buildSeries, cellDay, cellLabel, cellTone } from "@/lib/report-days";

const CELL_TONE: Record<string, string> = {
  complete: "bg-green-500",
  partial: "bg-amber-400",
  none: "bg-slate-200",
};

/**
 * One child's report: totals, streak and a daily completion strip.
 *
 * The strip is plain divs rather than an SVG or a charting library. It carries a handful of
 * categories and has to work on a phone, so a grid of coloured squares with a tooltip per
 * cell says what is needed without adding a dependency.
 *
 * The day alignment lives in lib/report-days.ts so it can be tested from Node. It matters:
 * the daily series only lists days that had work, and rendering it directly would close the
 * gaps silently.
 */
export default function ChildReportCard({
  child,
  from,
  days,
}: {
  child: ChildReport;
  from: string;
  days: number;
}) {
  const series = buildSeries(child.daily, from, days);
  const { totals, streak } = child;

  const rate = totals.assigned > 0 ? Math.round((totals.approved / totals.assigned) * 100) : 0;
  const outstanding = totals.submitted + totals.rejected;

  // Smaller cells for longer windows, so 90 days still fits a phone screen.
  const cellSize = days > 60 ? "h-2.5 w-2.5" : days > 30 ? "h-3 w-3" : "h-4 w-4";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-800">{child.display_name}</h2>
          <p className="text-xs text-slate-400">{child.points_balance} điểm hiện có</p>
        </div>

        <div className="flex items-center gap-2">
          {streak.current > 0 ? (
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800">
              🔥 {streak.current} ngày liên tiếp
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
              Chưa có chuỗi ngày
            </span>
          )}
          {streak.longest > streak.current && (
            <span className="text-xs text-slate-400">dài nhất {streak.longest}</span>
          )}
        </div>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-2">
          <p className="text-xs text-slate-500">Được giao</p>
          <p className="text-lg font-bold text-slate-800">{totals.assigned}</p>
        </div>
        <div className="rounded-lg bg-green-50 p-2">
          <p className="text-xs text-green-700">Hoàn thành</p>
          <p className="text-lg font-bold text-green-700">{totals.approved}</p>
        </div>
        <div className="rounded-lg bg-amber-50 p-2">
          <p className="text-xs text-amber-700">Chưa xong</p>
          <p className="text-lg font-bold text-amber-700">{outstanding}</p>
        </div>
        <div className="rounded-lg bg-violet-50 p-2">
          <p className="text-xs text-violet-700">Tỷ lệ</p>
          <p className="text-lg font-bold text-violet-700">{rate}%</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-500">Tiến độ từng ngày</p>
          <p className="text-xs text-slate-400">+{totals.points_earned} điểm từ việc</p>
        </div>

        <div
          className="flex flex-wrap gap-1"
          role="img"
          aria-label={`Tiến độ ${days} ngày của ${child.display_name}`}
        >
          {series.map((entry, offset) => {
            const day = cellDay(from, offset);
            return (
              <span
                key={day}
                title={`${day}: ${cellLabel(entry)}`}
                className={`${cellSize} rounded-sm ${CELL_TONE[cellTone(entry)]}`}
              />
            );
          })}
        </div>

        {totals.assigned === 0 && (
          <p className="mt-2 text-xs text-slate-400">
            Chưa giao việc nào cho bé trong khoảng này.
          </p>
        )}
      </div>
    </section>
  );
}
