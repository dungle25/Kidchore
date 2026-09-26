import Link from "next/link";
import { callRpc, requireParentPage } from "@/lib/dal";
import type { ParentOverview } from "@/lib/domain";
import {
  EmptyState,
  ErrorNote,
  SectionCard,
  StatCard,
  formatDateTime,
  formatPoints,
} from "@/components/ui";
import GenerateTodayButton from "./generate-today-button";

export const metadata = { title: "Tổng quan — KidChore" };

/**
 * Parent dashboard.
 *
 * Everything here comes from a single `parent_overview` call, which returns only
 * this family's data. When that call fails the page says so instead of inventing
 * numbers, so a broken backend can never look like a working one.
 */
export default async function ParentDashboardPage() {
  const { db } = await requireParentPage();

  let overview: ParentOverview | null = null;
  let error: string | null = null;

  try {
    overview = await callRpc<ParentOverview>(db, "parent_overview");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không tải được dữ liệu.";
  }

  if (!overview) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-800">Tổng quan</h1>
        <ErrorNote message={`Không tải được dữ liệu: ${error}`} />
      </div>
    );
  }

  const { children, pending_approvals, pending_redemptions, recent_activity } =
    overview;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Xin chào, {overview.parent.display_name}
          </h1>
          <p className="text-sm text-slate-500">
            {overview.family.family_name} · {children.length} bé
          </p>
        </div>
        <GenerateTodayButton />
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Chờ duyệt"
          value={pending_approvals.length}
          hint="Bài các bé vừa nộp"
          tone="blue"
        />
        <StatCard
          label="Đổi thưởng"
          value={pending_redemptions.length}
          hint="Yêu cầu đang chờ"
          tone="violet"
        />
        <StatCard
          label="Số bé"
          value={children.length}
          hint="Trong gia đình"
          tone="green"
        />
        <StatCard
          label="Điểm đã thưởng"
          value={overview.points_awarded_30d}
          hint="30 ngày gần đây"
          tone="amber"
        />
      </section>

      {children.length === 0 ? (
        <EmptyState
          icon="👶"
          title="Chưa có bé nào"
          description="Thêm tài khoản cho con để bắt đầu giao việc và thưởng điểm."
          action={
            <Link
              href="/parent/family"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              Thêm bé
            </Link>
          }
        />
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {children.map((child) => (
            <div
              key={child.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-800">{child.display_name}</p>
                <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                  {child.points_balance} điểm
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Đã hoàn thành {child.approved_total} việc
                {child.pending_review > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium text-blue-600">
                      {child.pending_review} chờ duyệt
                    </span>
                  </>
                )}
              </p>
              {!child.can_sign_in && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  ⚠️ Bé chưa đăng nhập được — vào mục Gia đình để sửa.
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      <SectionCard
        title="Việc đang chờ duyệt"
        description="Bấm để sang trang duyệt"
        action={
          pending_approvals.length > 0 ? (
            <Link
              href="/parent/chores"
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Duyệt ngay ({pending_approvals.length})
            </Link>
          ) : null
        }
      >
        {pending_approvals.length === 0 ? (
          <p className="text-sm text-slate-500">
            Không có bài nào đang chờ. Khi bé bấm “Đã làm xong”, việc sẽ hiện ở đây.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending_approvals.slice(0, 5).map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {item.task_title}
                  </p>
                  <p className="text-xs text-slate-400">
                    {item.child_name} · {item.points_reward} điểm
                  </p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">
                  {formatDateTime(item.completed_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard
        title="Yêu cầu đổi thưởng"
        action={
          pending_redemptions.length > 0 ? (
            <Link
              href="/parent/rewards"
              className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              Xem ({pending_redemptions.length})
            </Link>
          ) : null
        }
      >
        {pending_redemptions.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có yêu cầu đổi thưởng nào.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending_redemptions.slice(0, 5).map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {item.reward_title}
                  </p>
                  <p className="text-xs text-slate-400">
                    {item.child_name} · {item.points_spent} điểm
                  </p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">
                  {formatDateTime(item.requested_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Hoạt động gần đây" description="20 giao dịch điểm mới nhất">
        {recent_activity.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có hoạt động nào.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent_activity.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-700">
                    {entry.child_name ?? "—"}
                    {entry.description ? ` · ${entry.description}` : ""}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatDateTime(entry.created_at)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold ${
                    entry.amount >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {formatPoints(entry.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
