"use client";

import type { Badge } from "@/lib/domain";

/**
 * Badge grid.
 *
 * Earned badges are shown in full colour and unearned ones greyed with their progress, so
 * the next goal is always visible. A child seeing "3/7" has something to aim at; a child
 * seeing only the badges they already hold has nothing.
 */
export default function BadgeGrid({ badges }: { badges: Badge[] }) {
  if (badges.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Chưa có huy hiệu nào để hiển thị.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {badges.map((badge) => {
        const percent = badge.target > 0 ? Math.round((badge.progress / badge.target) * 100) : 0;

        return (
          <li
            key={badge.code}
            className={`rounded-2xl border-2 p-3 text-center ${
              badge.earned
                ? "border-amber-300 bg-amber-50"
                : "border-slate-200 bg-white"
            }`}
          >
            <p
              className={`text-3xl ${badge.earned ? "" : "opacity-30 grayscale"}`}
              aria-hidden
            >
              {badge.icon}
            </p>
            <p
              className={`mt-1 text-sm font-bold ${
                badge.earned ? "text-amber-900" : "text-slate-600"
              }`}
            >
              {badge.title}
            </p>

            {badge.earned ? (
              <p className="mt-1 text-xs font-semibold text-amber-700">Đã đạt 🎉</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-slate-500">
                  {badge.progress}/{badge.target}
                </p>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all duration-500"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
