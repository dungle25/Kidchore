"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth-actions";

const links = [
  { href: "/kid/dashboard", label: "Hôm nay", icon: "🏠" },
  { href: "/kid/tasks", label: "Việc của con", icon: "📋" },
  { href: "/kid/rewards", label: "Đổi quà", icon: "🎁" },
  { href: "/kid/achievements", label: "Thành tích", icon: "🏆" },
];

export interface Sibling {
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_me: boolean;
}

/**
 * Child navigation.
 *
 * Large, icon-led targets along the bottom of the screen, which is where a child holds a
 * tablet. There is no sidebar: the bottom bar keeps everything in reach of a thumb and
 * keeps page content wide.
 *
 * The action slot is a link rather than a form, because switching still goes through the
 * PIN screen; a passwordless switch would let one child spend a sibling's points.
 */
export default function KidNav({
  name,
  actionHref = "/login",
  actionLabel = "Đổi bé",
  actionIcon = "👥",
}: {
  /** The child currently signed in, shown so it is obvious whose profile is open. */
  name: string;
  actionHref?: string;
  actionLabel?: string;
  actionIcon?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-violet-100 bg-white pb-[env(safe-area-inset-bottom)]">
      {/* Whose profile is open. Easy to miss on a shared tablet otherwise. */}
      <p className="border-b border-violet-50 px-4 py-1.5 text-center text-[11px] font-semibold text-violet-700">
        Đang dùng: {name}
      </p>

      <div className="flex">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-bold transition ${
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

        <Link
          href={actionHref}
          className="flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-bold text-violet-700"
        >
          <span className="text-2xl" aria-hidden>
            {actionIcon}
          </span>
          {actionLabel}
        </Link>

        <form action={signOut} className="flex flex-1 flex-col items-center">
          <button
            type="submit"
            className="flex w-full flex-col items-center gap-1 py-2.5 text-xs font-bold text-slate-400"
          >
            <span className="text-2xl" aria-hidden>
              🚪
            </span>
            Thoát
          </button>
        </form>
      </div>
    </nav>
  );
}
