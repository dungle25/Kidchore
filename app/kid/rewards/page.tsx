import { callRpc, requireChildPage } from "@/lib/dal";
import type { KidRewards } from "@/lib/domain";
import { ErrorNote } from "@/components/ui";
import RewardShop from "./reward-shop";

export const metadata = { title: "Đổi quà — KidChore" };

/**
 * Reward shop.
 *
 * Read through `kid_rewards`, which already marks each reward as affordable and
 * flags rewards this child has an open request for. That keeps the affordability
 * rule in one place instead of re-deriving it in the UI.
 */
export default async function KidRewardsPage() {
  const { db } = await requireChildPage();

  let data: KidRewards | null = null;
  let error: string | null = null;

  try {
    data = await callRpc<KidRewards>(db, "kid_rewards");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không tải được dữ liệu.";
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold text-slate-800">Cửa hàng quà 🎁</h1>
        <p className="text-sm text-slate-500">
          Dùng điểm con kiếm được để đổi quà nhé!
        </p>
      </header>

      {error || !data ? (
        <ErrorNote message={`Không tải được dữ liệu: ${error ?? "không rõ lỗi"}`} />
      ) : (
        <RewardShop
          rewards={data.rewards}
          startingPoints={data.points_balance}
        />
      )}
    </div>
  );
}
