import { callRpc, requireParentPage } from "@/lib/dal";
import type { ParentReports } from "@/lib/domain";
import { EmptyState, ErrorNote, SectionCard, StatCard } from "@/components/ui";
import ChildReportCard from "./child-report-card";
import RangePicker from "./range-picker";

export const metadata = { title: "Báo cáo — KidChore" };

/** Windows a parent can pick between. Clamped again in the database, which is the authority. */
export const REPORT_RANGES = [7, 30, 90] as const;
export const DEFAULT_RANGE = 30;

/**
 * Completion report per child.
 *
 * Everything comes from `parent_reports`, which authorises the caller and limits the data
 * to their own family. The page does no aggregation of its own: totals, the streak and the
 * daily series are all computed in the database, so the numbers here cannot drift from the
 * ones the child sees.
 */
export default async function ParentReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { db } = await requireParentPage();
  const params = await searchParams;

  // An unknown value falls back rather than erroring: a hand-edited URL should still show
  // a report.
  const requested = Number(params.days);
  const days = (REPORT_RANGES as readonly number[]).includes(requested)
    ? requested
    : DEFAULT_RANGE;

  let reports: ParentReports | null = null;
  let error: string | null = null;

  try {
    reports = await callRpc<ParentReports>(db, "parent_reports", { p_days: days });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không tải được dữ liệu.";
  }

  if (!reports) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-800">Báo cáo</h1>
        <ErrorNote message={`Không tải được dữ liệu: ${error}`} />
      </div>
    );
  }

  const { family_totals: familyTotals, children } = reports;
  const rate =
    familyTotals.assigned > 0
      ? Math.round((familyTotals.approved / familyTotals.assigned) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Báo cáo</h1>
          <p className="text-sm text-slate-500">
            {reports.days} ngày gần nhất · {reports.from} → {reports.to}
          </p>
        </div>
        <RangePicker ranges={[...REPORT_RANGES]} current={reports.days} />
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Việc đã giao"
          value={familyTotals.assigned}
          hint={`${reports.days} ngày`}
          tone="blue"
        />
        <StatCard
          label="Đã hoàn thành"
          value={familyTotals.approved}
          hint={`${reports.days} ngày`}
          tone="green"
        />
        <StatCard
          label="Tỷ lệ hoàn thành"
          value={`${rate}%`}
          hint="Tính trên toàn gia đình"
          tone="violet"
        />
        <StatCard
          label="Số bé"
          value={children.length}
          hint="Có trong báo cáo"
          tone="amber"
        />
      </section>

      {children.length === 0 ? (
        <EmptyState
          icon="📊"
          title="Chưa có bé nào"
          description="Thêm tài khoản cho con trong mục Gia đình, rồi giao việc để bắt đầu có số liệu."
        />
      ) : (
        <>
          {children.map((child) => (
            <ChildReportCard
              key={child.id}
              child={child}
              from={reports.from}
              days={reports.days}
            />
          ))}

          <SectionCard
            title="Cách đọc biểu đồ"
            description="Mỗi ô là một ngày, cũ nhất bên trái"
          >
            <ul className="space-y-1 text-sm text-slate-600">
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-sm bg-green-500 align-middle" />
                Ngày hoàn thành hết việc được giao
              </li>
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-sm bg-amber-400 align-middle" />
                Có việc nhưng chưa xong hết
              </li>
              <li>
                <span className="mr-2 inline-block h-3 w-3 rounded-sm bg-slate-200 align-middle" />
                Ngày đó không giao việc nào
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-400">
              Ngày không giao việc được bỏ qua khi tính chuỗi, để bé không bị phạt vì hôm
              đó bố/mẹ không giao việc.
            </p>
          </SectionCard>
        </>
      )}
    </div>
  );
}
