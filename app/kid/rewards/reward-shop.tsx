"use client";

import { useState, useTransition } from "react";
import { requestReward } from "@/app/actions/reward-actions";
import { formatStock } from "@/components/ui";
import type { KidReward } from "@/lib/domain";

/**
 * Reward shop.
 *
 * A child sees exactly what they can afford right now. Rewards they cannot afford
 * stay visible but disabled, which is what makes the goal concrete, and the running
 * points balance updates locally after a successful request so the effect is
 * immediate.
 */
export default function RewardShop({
  rewards,
  startingPoints,
}: {
  rewards: KidReward[];
  startingPoints: number;
}) {
  // The balance only changes once a parent approves, so it is read once here and
  // is not part of the mutable state below.
  const points = startingPoints;
  const [rows, setRows] = useState(rewards);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [, startTransition] = useTransition();

  function request(reward: KidReward) {
    setBusyId(reward.id);
    setFeedback(null);

    startTransition(async () => {
      const result = await requestReward(reward.id);
      setBusyId(null);

      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không gửi được yêu cầu.", ok: false });
        return;
      }

      setRows((current) =>
        current.map((row) =>
          row.id === reward.id ? { ...row, already_requested: true } : row
        )
      );
      // Points are only deducted once a parent approves, so the balance is unchanged.
      setFeedback({
        text: `Đã gửi yêu cầu đổi “${reward.title}”. Chờ bố/mẹ duyệt nhé! 🎉`,
        ok: true,
      });
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-violet-200 bg-white p-8 text-center">
        <p className="text-5xl" aria-hidden>
          🏪
        </p>
        <p className="mt-3 text-lg font-bold text-slate-700">
          Cửa hàng đang trống
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Nhờ bố/mẹ thêm phần thưởng cho con nhé.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 p-5 text-white shadow">
        <p className="text-sm font-medium opacity-90">Điểm của con</p>
        <p className="text-4xl font-extrabold">{points} điểm</p>
      </div>

      {feedback && (
        <p
          role="status"
          className={`rounded-xl p-3 text-sm font-medium ${
            feedback.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"
          }`}
        >
          {feedback.text}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((reward) => {
          const affordable = points >= reward.points_required;
          const outOfStock = reward.stock === 0;
          const disabled = !affordable || outOfStock || reward.already_requested;

          return (
            <div
              key={reward.id}
              className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${
                disabled ? "border-slate-200" : "border-violet-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg font-bold text-slate-800">
                  {reward.icon ? `${reward.icon} ` : ""}
                  {reward.title}
                </h3>
                <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">
                  {reward.points_required}
                </span>
              </div>

              {reward.description && (
                <p className="mt-1 text-sm text-slate-500">{reward.description}</p>
              )}

              <p className="mt-2 text-xs text-slate-400">
                Còn lại: {formatStock(reward.stock)}
              </p>

              {!affordable && !outOfStock && (
                <p className="mt-2 text-xs font-medium text-violet-600">
                  Cần thêm {reward.points_required - points} điểm nữa
                </p>
              )}

              <button
                type="button"
                onClick={() => request(reward)}
                disabled={disabled || busyId === reward.id}
                className={`mt-3 w-full rounded-xl py-3 text-base font-bold transition ${
                  disabled
                    ? "cursor-not-allowed bg-slate-100 text-slate-400"
                    : "bg-violet-600 text-white hover:bg-violet-700"
                } disabled:opacity-70`}
              >
                {busyId === reward.id
                  ? "Đang gửi..."
                  : reward.already_requested
                    ? "Đã gửi yêu cầu ⏳"
                    : outOfStock
                      ? "Hết rồi 🔒"
                      : !affordable
                        ? "Chưa đủ điểm 🔒"
                        : "Đổi quà ✨"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
