import { callRpc, requireParentPage } from "@/lib/dal";
import type { ParentOverview } from "@/lib/domain";
import { ErrorNote } from "@/components/ui";
import RewardManager from "./reward-manager";

export const metadata = { title: "Phần thưởng — KidChore" };

/** Reward catalogue and the queue of redemption requests awaiting approval. */
export default async function ParentRewardsPage() {
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
        <h1 className="text-2xl font-bold text-slate-800">Phần thưởng</h1>
        <p className="text-sm text-slate-500">
          Quản lý kho phần thưởng và duyệt yêu cầu đổi của các bé.
        </p>
      </header>

      {error || !overview ? (
        <ErrorNote message={`Không tải được dữ liệu: ${error ?? "không rõ lỗi"}`} />
      ) : (
        <RewardManager
          requests={overview.pending_redemptions}
          rewards={overview.rewards}
        />
      )}
    </div>
  );
}
