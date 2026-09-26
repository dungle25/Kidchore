import { callRpc, requireParentPage } from "@/lib/dal";
import type { ParentOverview } from "@/lib/domain";
import { EmptyState, ErrorNote } from "@/components/ui";
import TaskManager from "./task-manager";

export const metadata = { title: "Việc nhà — KidChore" };

/** Chore definitions: what can be assigned, how often, and for how many points. */
export default async function ParentTasksPage() {
  const { db } = await requireParentPage();

  let overview: ParentOverview | null = null;
  let error: string | null = null;

  try {
    overview = await callRpc<ParentOverview>(db, "parent_overview");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không tải được dữ liệu.";
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Việc nhà</h1>
        <p className="text-sm text-slate-500">
          Định nghĩa các việc và thói quen. Việc sẽ được sinh ra cho từng bé theo
          lịch lặp lại.
        </p>
      </header>

      {error || !overview ? (
        <ErrorNote message={`Không tải được dữ liệu: ${error ?? "không rõ lỗi"}`} />
      ) : overview.children.length === 0 ? (
        <EmptyState
          icon="👶"
          title="Chưa có bé nào"
          description="Thêm bé trong mục Gia đình trước, rồi mới giao việc được."
        />
      ) : (
        <TaskManager tasks={overview.tasks} kids={overview.children} />
      )}
    </div>
  );
}
