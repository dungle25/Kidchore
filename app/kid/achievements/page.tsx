import { callRpc, requireChildPage } from "@/lib/dal";
import type { KidAchievements } from "@/lib/domain";
import { EmptyState, ErrorNote, formatDateTime, formatPoints } from "@/components/ui";
import BadgeGrid from "./badge-grid";

export const metadata = { title: "Thành tích — KidChore" };

/**
 * The child's own achievements.
 *
 * A child should be able to see what they have earned and what is next, which is what
 * makes the points feel worth collecting. Everything comes from `kid_achievements`, which
 * resolves the child from the session, so a child can only ever see their own record.
 */
export default async function KidAchievementsPage() {
  const { db } = await requireChildPage();

  let data: KidAchievements | null = null;
  let error: string | null = null;

  try {
    data = await callRpc<KidAchievements>(db, "kid_achievements");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không tải được dữ liệu.";
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold text-slate-800">Thành tích</h1>
        <ErrorNote message={`Không tải được dữ liệu: ${error}`} />
      </div>
    );
  }

  const earned = data.badges.filter((badge) => badge.earned).length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold text-slate-800">
          Thành tích của {data.child.display_name}
        </h1>
        <p className="text-sm text-slate-500">
          Con đã đạt {earned}/{data.badges.length} huy hiệu.
        </p>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 p-4 text-white shadow">
          <p className="text-xs font-medium opacity-90">Điểm</p>
          <p className="text-2xl font-extrabold">{data.child.points_balance}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-slate-500">Chuỗi hiện tại</p>
          <p className="mt-1 text-2xl font-extrabold text-orange-600">
            {data.streak.current}
          </p>
          <p className="text-xs text-slate-400">ngày liên tiếp</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-slate-500">Việc đã xong</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-800">
            {data.approved_total}
          </p>
          <p className="text-xs text-slate-400">được bố/mẹ duyệt</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-800">Huy hiệu</h2>
        <BadgeGrid badges={data.badges} />
        <p className="text-xs text-slate-400">
          Chuỗi dài nhất con từng đạt: {data.streak.longest} ngày.
          {data.streak.today_complete
            ? " Hôm nay con đã xong hết việc!"
            : " Hôm nay còn việc chưa xong."}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-800">Lịch sử điểm</h2>

        {data.history.length === 0 ? (
          <EmptyState
            icon="⭐"
            title="Chưa có điểm nào"
            description="Làm việc và gửi cho bố/mẹ duyệt để nhận điểm đầu tiên nhé."
          />
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border-2 border-slate-100 bg-white">
            {data.history.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-700">
                    {entry.description ?? entry.type}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatDateTime(entry.created_at)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-bold ${
                    entry.amount >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {formatPoints(entry.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
