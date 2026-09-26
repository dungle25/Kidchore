"use client";

import { useState, useTransition } from "react";
import { createInvite, revokeInvite } from "@/app/actions/family-actions";
import type { FamilyInvite } from "@/lib/domain";
import { formatInviteCode } from "@/lib/invite-code";

type InviteStatus = "pending" | "used" | "revoked" | "expired";

function statusOf(invite: FamilyInvite): InviteStatus {
  if (invite.accepted_at) return "used";
  if (invite.revoked_at) return "revoked";
  if (new Date(invite.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
}

const STATUS_TEXT: Record<InviteStatus, string> = {
  pending: "Đang chờ",
  used: "Đã dùng",
  revoked: "Đã thu hồi",
  expired: "Hết hạn",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Inviting the other parent into the household.
 *
 * Everything about this screen follows from one decision: the database stores only a
 * hash of the code. So the code is shown once, big, at the moment it is made, and the
 * screen says plainly that it cannot be shown again - otherwise the first thing a parent
 * would do is close the page expecting to come back to it later.
 *
 * What the code grants is full parent rights over the children, which is why the copy
 * says so rather than presenting it as a harmless link.
 */
export default function InviteParents({ invites }: { invites: FamilyInvite[] }) {
  const [rows, setRows] = useState(invites);
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const joinLink =
    issued && typeof window !== "undefined"
      ? `${window.location.origin}/join?code=${issued}`
      : "";

  function onCreate() {
    setBusy(true);
    setError(null);
    setCopied(null);
    startTransition(async () => {
      const result = await createInvite();
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIssued(result.code);
      // A full reload will bring the real row; the list is not edited locally because the
      // server decides what is pending, used, or expired.
    });
  }

  function onRevoke(invite: FamilyInvite) {
    setBusy(true);
    setError(null);
    startTransition(async () => {
      const result = await revokeInvite(invite.id);
      setBusy(false);
      if (!result.ok) {
        setError(result.error ?? "Không thu hồi được mã mời.");
        return;
      }
      setRows((current) =>
        current.map((row) =>
          row.id === invite.id ? { ...row, revoked_at: new Date().toISOString() } : row
        )
      );
    });
  }

  async function copy(value: string, which: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
    } catch {
      // Clipboard access can be denied; the code is on screen to type by hand.
      setCopied(null);
    }
  }

  const pending = rows.filter((row) => statusOf(row) === "pending");

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="font-semibold text-slate-800">Mời bố/mẹ khác cùng dùng</h2>
        <p className="mt-1 text-sm text-slate-600">
          Người được mời đăng nhập bằng Google của họ, nhập mã này, và trở thành bố/mẹ
          trong cùng gia đình — thấy đủ các bé, việc và điểm như bạn.
        </p>
      </div>

      <button
        type="button"
        onClick={onCreate}
        disabled={busy}
        className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {busy ? "Đang tạo..." : issued ? "Tạo mã khác" : "Tạo mã mời"}
      </button>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {issued && (
        <div className="rounded-lg border-2 border-violet-300 bg-violet-50 p-4">
          <p className="text-sm font-semibold text-violet-900">
            Mã mời chỉ hiện một lần
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Gửi mã hoặc link dưới đây cho người kia ngay bây giờ. Đóng trang này là không
            xem lại được mã nữa — khi đó hãy tạo mã khác.
          </p>

          <p className="mt-3 select-all text-center text-2xl font-extrabold tracking-wider text-violet-900">
            {formatInviteCode(issued)}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copy(formatInviteCode(issued), "code")}
              className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-100"
            >
              {copied === "code" ? "Đã chép mã" : "Chép mã"}
            </button>
            <button
              type="button"
              onClick={() => void copy(joinLink, "link")}
              className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-100"
            >
              {copied === "link" ? "Đã chép link" : "Chép link"}
            </button>
          </div>

          <p className="mt-3 text-xs break-all text-slate-500">{joinLink}</p>
          <p className="mt-2 text-xs text-slate-500">
            Mã có hạn 7 ngày và chỉ dùng được một lần.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700">
            Mã đã tạo {pending.length > 0 ? `· ${pending.length} đang chờ` : ""}
          </h3>
          <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {rows.map((invite) => {
              const status = statusOf(invite);
              return (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-slate-700">
                      {invite.created_by_name ?? "Ai đó"} tạo ngày {formatDate(invite.created_at)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {status === "pending" && `Hết hạn ${formatDate(invite.expires_at)}`}
                      {status === "used" &&
                        `${invite.accepted_by_name ?? "Ai đó"} đã dùng${invite.accepted_at ? ` ngày ${formatDate(invite.accepted_at)}` : ""}`}
                      {status === "revoked" && "Bạn đã thu hồi"}
                      {status === "expired" && `Hết hạn ${formatDate(invite.expires_at)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        status === "pending"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {STATUS_TEXT[status]}
                    </span>
                    {status === "pending" && (
                      <button
                        type="button"
                        onClick={() => onRevoke(invite)}
                        disabled={busy}
                        className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        Thu hồi
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            Mã đã dùng hoặc đã thu hồi vẫn được giữ lại để bạn biết ai đã vào gia đình và
            khi nào.
          </p>
        </div>
      )}
    </section>
  );
}
