import type { Metadata } from "next";
import KidNav from "@/components/kid/kid-nav";

export const metadata: Metadata = {
  title: "Bé — KidChore",
};

/**
 * Child shell.
 *
 * Bright, roomy and thumb-reachable. Bottom padding clears the fixed navigation so
 * the last card is never hidden behind it.
 */
export default function KidLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-violet-50 to-slate-50">
      <main className="mx-auto max-w-3xl px-4 pb-28 pt-6">{children}</main>
      <KidNav />
    </div>
  );
}
