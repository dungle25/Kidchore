"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth-actions";

const links = [
  { href: "/kid/dashboard", label: "Hôm nay", icon: "🏠" },
  { href: "/kid/tasks", label: "Việc của con", icon: "📋" },
  { href: "/kid/rewards", label: "Đổi quà", icon: "🎁" },
];

/**
 * Child navigation.
 *
 * Large, icon-led targets along the bottom of the screen, which is where a child
 * holds a tablet. There is no sidebar: the bottom bar keeps everything in reach of
 * a thumb and keeps the page content wide.
 */
export default function KidNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t-2 border-violet-100 bg-white pb-[env(safe-area-inset-bottom)]">
      {links.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs font-bold transition ${
              active ? "text-violet-700" : "text-slate-400"
            }`}
          >
            <span className="text-2xl" aria-hidden>
              {link.icon}
            </span>
            {link.label}
          </Link>
        );
      })}
      <form action={signOut} className="flex flex-1 flex-col items-center">
        <button
          type="submit"
          className="flex w-full flex-col items-center gap-1 py-3 text-xs font-bold text-slate-400"
        >
          <span className="text-2xl" aria-hidden>
            🚪
          </span>
          Thoát
        </button>
      </form>
    </nav>
  );
}
