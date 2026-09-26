import type { Metadata } from "next";
import { callRpc, requireChildPage } from "@/lib/dal";
import KidNav, { type Sibling } from "@/components/kid/kid-nav";
import SessionKeepAlive from "@/components/session-keep-alive";
import SiblingSwitcher from "@/components/kid/sibling-switcher";

export const metadata: Metadata = {
  title: "Bé — KidChore",
};

/**
 * Child shell.
 *
 * Bright, roomy and thumb-reachable. Bottom padding clears the fixed navigation so the
 * last card is never hidden behind it.
 *
 * The sibling list is read once here rather than per page, because both the switcher and
 * the navigation need it and a family tablet should make moving between profiles quick.
 */
export default async function KidLayout({ children }: { children: React.ReactNode }) {
  const { db, session } = await requireChildPage();

  // A failure here must not blank the child's screen; the switcher simply disappears.
  let siblings: Sibling[] = [];
  try {
    siblings = await callRpc<Sibling[]>(db, "kid_siblings");
  } catch {
    siblings = [];
  }

  const me = siblings.find((sibling) => sibling.is_me);
  const others = siblings.filter((sibling) => !sibling.is_me);
  const myName = me?.display_name ?? session.name ?? "bé";

  return (
    <div className="min-h-dvh bg-gradient-to-b from-violet-50 to-slate-50">
      <SessionKeepAlive />
      <div className="mx-auto max-w-3xl px-4 pb-32 pt-6">
        {others.length > 0 && <SiblingSwitcher siblings={others} />}
        <main>{children}</main>
      </div>
      <KidNav name={myName} />
    </div>
  );
}
