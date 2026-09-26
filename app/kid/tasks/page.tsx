import Link from "next/link";
import { callRpc, requireChildPage } from "@/lib/dal";
import type { KidDashboard } from "@/lib/domain";
import { ErrorNote } from "@/components/ui";
import KidTaskList from "./kid-task-list";

export const metadata = { title: "Việc của con — KidChore" };

/**
 * The full set of chores the child still has to do.
 *
 * This is the same data the dashboard summarises, shown in full so a child can work
 * through the list without hunting for it.
 */
export default async function KidTasksPage() {
  const { db } = await requireChildPage();

  let dashboard: KidDashboard | null = null;
  let error: string | null = null;

  try {
    dashboard = await callRpc<KidDashboard>(db, "kid_dashboard");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không tải được dữ liệu.";
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Việc của con</h1>
          <p className="text-sm text-slate-500">
            Làm xong thì bấm nút để gửi cho bố/mẹ nhé!
          </p>
        </div>
        <Link
          href="/kid/dashboard"
          className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm"
        >
          Về trang chính
        </Link>
      </header>

      {error || !dashboard ? (
        <ErrorNote message={`Không tải được dữ liệu: ${error ?? "không rõ lỗi"}`} />
      ) : (
        <KidTaskList tasks={dashboard.tasks_today} />
      )}
    </div>
  );
}
