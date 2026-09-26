import type { Metadata } from "next";
import { requireParentPage, callRpc } from "@/lib/dal";
import { vapidPublicKey } from "@/lib/env";
import type { ParentOverview } from "@/lib/domain";
import EnableNotifications from "@/components/push/enable-notifications";
import ParentNav from "@/components/parent/parent-nav";
import SessionKeepAlive from "@/components/session-keep-alive";

export const metadata: Metadata = {
  title: "Bố/mẹ — KidChore",
};

/**
 * Parent shell.
 *
 * The family name for the navigation is fetched here so every parent page can
 * render it without each one loading it again.
 */
export default async function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db } = await requireParentPage();

  // A failure here should not blank the whole area; fall back to a neutral label.
  let familyName = "Gia đình";
  try {
    const overview = await callRpc<ParentOverview>(db, "parent_overview");
    familyName = overview?.family?.family_name ?? familyName;
  } catch {
    familyName = "Gia đình";
  }

  return (
    <div className="flex min-h-dvh bg-slate-100">
      <SessionKeepAlive />
      <ParentNav familyName={familyName} />
      <main className="flex-1 overflow-y-auto px-4 pb-24 pt-5 md:px-8 md:pb-8">
        <EnableNotifications vapidPublicKey={vapidPublicKey} />
        {children}
      </main>
    </div>
  );
}
