import { callRpc, requireParentPage } from "@/lib/dal";
import type { ParentOverview } from "@/lib/domain";
import { EmptyState, ErrorNote } from "@/components/ui";
import ApprovalList from "./approval-list";

export const metadata = { title: "Duyệt việc — KidChore" };

/** Review queue for submissions the children have marked as done. */
export default async function ParentChoresPage() {
  const { db } = await requireParentPage();

  let approvals: ParentOverview["pending_approvals"] = [];
  let error: string | null = null;

  try {
    const overview = await callRpc<ParentOverview>(db, "parent_overview");
    approvals = overview.pending_approvals;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không tải được dữ liệu.";
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Duyệt việc của các bé</h1>
        <p className="text-sm text-slate-500">
          Kiểm tra bài các bé nộp rồi cộng điểm. Mỗi bài chỉ được cộng điểm một lần.
        </p>
      </header>

      {error && <ErrorNote message={`Không tải được dữ liệu: ${error}`} />}

      {!error && approvals.length === 0 ? (
        <EmptyState
          icon="🎉"
          title="Không có bài nào chờ duyệt"
          description="Khi bé bấm “Đã làm xong” ở trang của bé, bài sẽ xuất hiện ở đây để bố/mẹ duyệt."
        />
      ) : (
        !error && <ApprovalList items={approvals} />
      )}
    </div>
  );
}
