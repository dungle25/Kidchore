"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth-actions";

const links = [
  { href: "/parent/dashboard", label: "Tổng quan", icon: "🏠" },
  { href: "/parent/chores", label: "Duyệt việc", icon: "✅" },
  { href: "/parent/tasks", label: "Việc", icon: "📋" },
  { href: "/parent/rewards", label: "Thưởng", icon: "🎁" },
  { href: "/parent/reports", label: "Báo cáo", icon: "📊" },
  { href: "/parent/family", label: "Gia đình", icon: "👨‍👩‍👧" },
];

/**
 * Parent navigation.
 *
 * Renders as a sidebar on wide screens and a bottom bar on phones, which is where
 * most of this will actually be used. Targets are at least 44px tall so they are
 * comfortably tappable.
 */
export default function ParentNav({ familyName }: { familyName: string }) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-100 p-5">
          <p className="text-lg font-bold text-slate-800">KidChore</p>
          <p className="truncate text-xs text-slate-400" title={familyName}>
            {familyName}
          </p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition ${
                  active
                    ? "bg-violet-100 text-violet-800"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span aria-hidden>{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <form action={signOut} className="border-t border-slate-100 p-3">
          <button
            type="submit"
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-slate-100"
          >
            Đăng xuất
          </button>
        </form>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                active ? "text-violet-700" : "text-slate-500"
              }`}
            >
              <span className="text-lg" aria-hidden>
                {link.icon}
              </span>
              {link.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
