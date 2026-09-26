"use client";

import Link from "next/link";
import Avatar from "@/components/avatar";
import type { Sibling } from "./kid-nav";

/**
 * One-tap profile switching for siblings sharing a tablet.
 *
 * Each button links to the PIN screen narrowed to that child, so switching takes a tap
 * and a four-digit PIN. The PIN is not optional: without it one child could open a
 * sibling's profile and spend their points, which is the situation the PIN exists for.
 *
 * Renders nothing when the child has no siblings, so an only child never sees a control
 * that would do nothing.
 */
export default function SiblingSwitcher({ siblings }: { siblings: Sibling[] }) {
  if (siblings.length === 0) return null;

  return (
    <section className="mb-5 rounded-2xl border border-violet-100 bg-white p-3 shadow-sm">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
        Đổi sang bé khác
      </h2>
      <div className="flex flex-wrap gap-2">
        {siblings.map((sibling) => (
          <Link
            key={sibling.username}
            href={`/login?switchTo=${encodeURIComponent(sibling.username)}`}
            className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 py-2 pl-2 pr-4 transition hover:bg-violet-100"
          >
            <Avatar value={sibling.avatar_url} size={36} className="bg-white" />
            <span className="text-sm font-semibold text-violet-900">
              {sibling.display_name}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
