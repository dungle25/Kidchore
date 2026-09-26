"use client";

import { useState, useTransition } from "react";
import { adjustPoints } from "@/app/actions/family-actions";
import type { ParentChild } from "@/lib/domain";

/** The amounts offered as one-tap awards. Small, so a parent can be generous often. */
const AMOUNTS = [1, 3, 5] as const;

/**
 * A child's card on the parent dashboard, with quick bonus points.
 *
 * The quick award covers the everyday case the chore flow does not: a child does
 * something worth recognising on the spot, and a parent should not have to invent a task
 * to reward it.
 *
 * It reuses `adjust_points`, so every tap is written to `point_transactions` as a
 * MANUAL_ADJUSTMENT with a reason. The points are auditable and appear in the child's
 * history rather than as an unexplained jump.
 *
 * Points are only ever added here, never subtracted. Taking points away from a child in
 * one tap is a different decision that deserves the fuller form on the Gia đình screen,
 * where a reason is typed deliberately.
 *
 * The whole card is a client component rather than just the buttons, so the displayed
 * balance reflects an award immediately. Relying on the server refresh alone would leave
 * the number stale until the next navigation, which looks like the award did nothing.
 */
export default function ChildCard({ child }: { child: ParentChild }) {
  const [pending, startTransition] = useTransition();
  const [busyAmount, setBusyAmount] = useState<number | null>(null);
  const [balance, setBalance] = useState(child.points_balance);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

  function award(amount: number) {
    setBusyAmount(amount);
    setResult(null);

    startTransition(async () => {
      const response = await adjustPoints({
        childId: child.id,
        amount,
        description: `Thưởng nhanh +${amount} điểm`,
      });
      setBusyAmount(null);

      if (response.ok) {
        setBalance((current) => current + amount);
        setResult({ text: `Đã thưởng ${amount} điểm cho ${child.display_name}.`, ok: true });
      } else {
        setResult({ text: response.error ?? "Không thưởng được.", ok: false });
      }
    });
  }

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-800">{child.display_name}</p>
        <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
          {balance} điểm
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

      {/* mt-auto keeps the award row aligned across cards of different heights. */}
      <div className="mt-auto pt-3">
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-xs font-medium text-slate-500">Thưởng nhanh</span>
          <div className="flex gap-1.5">
            {AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => award(amount)}
                disabled={pending}
                aria-label={`Thưởng ${amount} điểm cho ${child.display_name}`}
                className="min-w-[2.75rem] rounded-lg border border-green-300 bg-green-50 px-2 py-1.5 text-sm font-bold text-green-800 transition hover:bg-green-100 disabled:opacity-50"
              >
                {busyAmount === amount ? "…" : `+${amount}`}
              </button>
            ))}
          </div>
        </div>

        {result && (
          <p
            role="status"
            className={`mt-2 text-xs font-medium ${
              result.ok ? "text-green-700" : "text-red-700"
            }`}
          >
            {result.text}
          </p>
        )}
      </div>
    </div>
  );
}
