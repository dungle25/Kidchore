import Link from "next/link";
import { callRpc, requireChildPage } from "@/lib/dal";
import type { KidDashboard } from "@/lib/domain";
import { ErrorNote } from "@/components/ui";
import KidTaskList from "../tasks/kid-task-list";

export const metadata = { title: "Hôm nay — KidChore" };

/**
 * Child home screen.
 *
 * Leads with the points balance and today's outstanding work, because that is the
 * only thing a child needs to know when they open the app.
 */
export default async function KidDashboardPage() {
  const { db } = await requireChildPage();

  let dashboard: KidDashboard | null = null;
  let error: string | null = null;

  try {
    dashboard = await callRpc<KidDashboard>(db, "kid_dashboard");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không tải được dữ liệu.";
  }

  if (error || !dashboard) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold text-slate-800">Hôm nay</h1>
        <ErrorNote message={`Không tải được dữ liệu: ${error ?? "không rõ lỗi"}`} />
      </div>
    );
  }

  const { child, tasks_today, approved_total, pending_review } = dashboard;
  const remaining = tasks_today.filter(
    (task) => task.status !== "SUBMITTED" && task.status !== "APPROVED"
  );

  return (
    <div className="space-y-5">
      <header className="rounded-2xl bg-white p-5 shadow-sm">
        <h1 className="text-3xl font-extrabold text-slate-800">
          Chào {child.display_name}! 👋
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {remaining.length > 0
            ? `Hôm nay con còn ${remaining.length} việc cần làm.`
            : "Hôm nay con đã làm hết việc rồi!"}
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* A negative balance is not a display glitch: it is điểm nợ the child has to work
            off, so the card stops looking like a reward the moment it crosses zero. */}
        <div
          className={`rounded-2xl bg-gradient-to-r p-5 text-white shadow ${
            child.points_balance < 0
              ? "from-rose-500 to-red-600"
              : "from-green-500 to-emerald-600"
          }`}
        >
          <p className="text-sm font-medium opacity-90">
            {child.points_balance < 0
              ? `Con đang nợ ${Math.abs(child.points_balance)} điểm`
              : "Điểm của con"}
          </p>
          <p className="text-4xl font-extrabold">
            {child.points_balance < 0 ? `-${Math.abs(child.points_balance)}` : child.points_balance}
          </p>
          {child.points_balance < 0 && (
            <p className="mt-1 text-xs opacity-90">Làm việc để trả hết nợ nhé!</p>
          )}
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase text-slate-500">
            Đã hoàn thành
          </p>
          <p className="mt-1 text-3xl font-extrabold text-slate-800">
            {approved_total}
          </p>
          <p className="text-xs text-slate-400">việc được duyệt</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase text-slate-500">
            Đang chờ duyệt
          </p>
          <p className="mt-1 text-3xl font-extrabold text-slate-800">
            {pending_review}
          </p>
          <p className="text-xs text-slate-400">việc đã gửi</p>
        </div>
      </section>

      <div className="flex gap-2">
        <Link
          href="/kid/rewards"
          className="flex-1 rounded-xl bg-violet-600 px-4 py-3 text-center font-bold text-white shadow transition hover:bg-violet-700"
        >
          Đổi quà 🎁
        </Link>
        <Link
          href="/kid/tasks"
          className="flex-1 rounded-xl bg-white px-4 py-3 text-center font-bold text-violet-700 shadow-sm transition hover:bg-violet-50"
        >
          Xem tất cả việc
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-800">Việc hôm nay</h2>
        <KidTaskList tasks={tasks_today} />
      </section>
    </div>
  );
}
