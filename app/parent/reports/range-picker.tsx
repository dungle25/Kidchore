"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Window selector for the report.
 *
 * Plain links rather than a client-side control, so each range is a real URL that can be
 * shared or bookmarked, and the page stays a server component.
 */
export default function RangePicker({
  ranges,
  current,
}: {
  ranges: number[];
  current: number;
}) {
  const pathname = usePathname();

  const labels: Record<number, string> = {
    7: "7 ngày",
    30: "30 ngày",
    90: "3 tháng",
  };

  return (
    <nav className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {ranges.map((range) => {
        const active = range === current;
        return (
          <Link
            key={range}
            href={`${pathname}?days=${range}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-violet-600 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {labels[range] ?? `${range} ngày`}
          </Link>
        );
      })}
    </nav>
  );
}
