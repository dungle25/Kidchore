import { callRpc, requireParentPage } from "@/lib/dal";
import type { FamilyInvite, ParentOverview } from "@/lib/domain";
import { ErrorNote } from "@/components/ui";
import FamilyManager from "./family-manager";
import InviteParents from "./invite-parents";

export const metadata = { title: "Gia đình — KidChore" };

/** Manage the children in this family: accounts, PINs and point corrections. */
export default async function ParentFamilyPage() {
  const { db } = await requireParentPage();

  let overview: ParentOverview | null = null;
  let error: string | null = null;

  try {
    overview = await callRpc<ParentOverview>(db, "parent_overview");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Không tải được dữ liệu.";
  }

  // A failure here must not take the whole page down: the children are the reason
  // somebody opened this screen, and the invite panel is secondary.
  let invites: FamilyInvite[] = [];
  try {
    invites = await callRpc<FamilyInvite[]>(db, "list_family_invites");
  } catch {
    invites = [];
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Gia đình</h1>
        <p className="text-sm text-slate-500">
          Tạo tài khoản cho các bé, đặt lại mã PIN và điều chỉnh điểm khi cần.
        </p>
      </header>

      {error || !overview ? (
        <ErrorNote message={`Không tải được dữ liệu: ${error ?? "không rõ lỗi"}`} />
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            <p>
              <strong>{overview.family.family_name}</strong> · bạn đăng nhập với vai
              trò bố/mẹ
              {overview.parent.email ? ` (${overview.parent.email})` : ""}.
            </p>
          </div>
          <FamilyManager kids={overview.children} />
          <InviteParents invites={invites} />
        </>
      )}
    </div>
  );
}
