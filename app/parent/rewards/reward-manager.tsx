"use client";

import { useState, useTransition } from "react";
import {
  approveRedemption,
  deleteReward,
  rejectRedemption,
  saveReward,
} from "@/app/actions/reward-actions";
import { EmptyState, formatStock } from "@/components/ui";
import type { ParentReward, PendingRedemption } from "@/lib/domain";

/**
 * Reward requests plus the reward catalogue.
 *
 * The two are kept on one screen because managing the store and clearing the queue
 * are the same job. Every action awaits its server call and surfaces the real
 * result, so a rejected redemption (insufficient points at approval time, for
 * instance) is explained rather than silently ignored.
 */
export default function RewardManager({
  requests,
  rewards,
}: {
  requests: PendingRedemption[];
  rewards: ParentReward[];
}) {
  const [queue, setQueue] = useState(requests);
  const [catalogue, setCatalogue] = useState(rewards);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [, startTransition] = useTransition();

  // Add/edit form state.
  const [editing, setEditing] = useState<ParentReward | null>(null);
  const [showForm, setShowForm] = useState(false);

  function decide(item: PendingRedemption, approve: boolean) {
    setBusyId(item.id);
    setFeedback(null);
    startTransition(async () => {
      const result = approve
        ? await approveRedemption(item.id)
        : await rejectRedemption(item.id, "Bố/mẹ từ chối");

      setBusyId(null);

      if (!result.ok) {
        // Keep the row: it was not processed.
        setFeedback({ text: result.error ?? "Không xử lý được.", ok: false });
        return;
      }

      setQueue((current) => current.filter((row) => row.id !== item.id));
      setFeedback({
        text: approve
          ? `Đã duyệt “${item.reward_title}” cho ${item.child_name} và trừ ${item.points_spent} điểm.`
          : `Đã từ chối yêu cầu “${item.reward_title}”.`,
        ok: true,
      });
    });
  }

  function onSave(formData: FormData) {
    const id = String(formData.get("id") ?? "") || null;
    const input = {
      id,
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "") || null,
      pointsRequired: Number(formData.get("pointsRequired") ?? 0),
      stock: Number(formData.get("stock") ?? -1),
      icon: String(formData.get("icon") ?? "") || null,
      isActive: formData.get("isActive") === "on",
    };

    setBusyId("form");
    setFeedback(null);
    startTransition(async () => {
      const result = await saveReward(input);
      setBusyId(null);

      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không lưu được.", ok: false });
        return;
      }

      setFeedback({
        text: id ? "Đã cập nhật phần thưởng." : "Đã thêm phần thưởng mới.",
        ok: true,
      });
      setShowForm(false);
      setEditing(null);
      // Re-fetch on the next navigation; optimistic local update keeps it responsive.
      if (id) {
        setCatalogue((current) =>
          current.map((reward) =>
            reward.id === id
              ? {
                  ...reward,
                  title: input.title,
                  description: input.description,
                  points_required: input.pointsRequired,
                  stock: input.stock,
                  icon: input.icon,
                  is_active: input.isActive,
                }
              : reward
          )
        );
      } else {
        setCatalogue((current) => [
          ...current,
          {
            id: `pending-${Date.now()}`,
            title: input.title,
            description: input.description,
            points_required: input.pointsRequired,
            stock: input.stock,
            icon: input.icon,
            is_active: input.isActive,
          },
        ]);
      }
    });
  }

  function onDelete(reward: ParentReward) {
    setBusyId(reward.id);
    setFeedback(null);
    startTransition(async () => {
      const result = await deleteReward(reward.id);
      setBusyId(null);
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không xoá được.", ok: false });
        return;
      }
      setCatalogue((current) => current.filter((row) => row.id !== reward.id));
      setFeedback({ text: `Đã xoá “${reward.title}”.`, ok: true });
    });
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <p
          role="status"
          className={`rounded-lg border p-3 text-sm ${
            feedback.ok
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {feedback.text}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-800">
          Yêu cầu đổi thưởng ({queue.length})
        </h2>

        {queue.length === 0 ? (
          <EmptyState
            icon="🎁"
            title="Không có yêu cầu nào"
            description="Khi bé đổi thưởng, yêu cầu sẽ hiện ở đây để bố/mẹ duyệt."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {queue.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-800">
                    {item.reward_icon ? `${item.reward_icon} ` : ""}
                    {item.reward_title}
                  </h3>
                  <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                    {item.points_spent} điểm
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {item.child_name} ·{" "}
                  {item.child_balance < 0
                    ? `đang nợ ${Math.abs(item.child_balance)} điểm`
                    : `hiện có ${item.child_balance} điểm`}
                </p>
                {item.reward_description && (
                  <p className="mt-1 text-sm text-slate-600">
                    {item.reward_description}
                  </p>
                )}

                {item.child_balance < item.points_spent && (
                  <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                    Bé không còn đủ điểm cho phần thưởng này.
                  </p>
                )}

                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => decide(item, true)}
                    disabled={busyId === item.id}
                    className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
                  >
                    {busyId === item.id ? "Đang xử lý..." : "Duyệt & trừ điểm"}
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(item, false)}
                    disabled={busyId === item.id}
                    className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                  >
                    Từ chối
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">
            Kho phần thưởng ({catalogue.length})
          </h2>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowForm((value) => !value);
            }}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            {showForm ? "Đóng" : "+ Thêm phần thưởng"}
          </button>
        </div>

        {showForm && (
          <form
            action={onSave}
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="font-medium text-slate-700">Tên phần thưởng</span>
                <input
                  name="title"
                  required
                  defaultValue={editing?.title ?? ""}
                  placeholder="Xem TV 30 phút"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="font-medium text-slate-700">Biểu tượng</span>
                <input
                  name="icon"
                  defaultValue={editing?.icon ?? ""}
                  placeholder="📺"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">Mô tả</span>
                <input
                  name="description"
                  defaultValue={editing?.description ?? ""}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="font-medium text-slate-700">Số điểm cần</span>
                <input
                  name="pointsRequired"
                  type="number"
                  min={1}
                  required
                  defaultValue={editing?.points_required ?? 30}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="font-medium text-slate-700">
                  Số lượng (-1 = không giới hạn)
                </span>
                <input
                  name="stock"
                  type="number"
                  min={-1}
                  defaultValue={editing?.stock ?? -1}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                name="isActive"
                type="checkbox"
                defaultChecked={editing ? editing.is_active : true}
                className="h-4 w-4"
              />
              Đang mở cho các bé đổi
            </label>

            <button
              type="submit"
              disabled={busyId === "form"}
              className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {busyId === "form" ? "Đang lưu..." : editing ? "Cập nhật" : "Thêm"}
            </button>
          </form>
        )}

        {catalogue.length === 0 ? (
          <EmptyState
            icon="🏪"
            title="Kho phần thưởng đang trống"
            description="Thêm phần thưởng để các bé có mục tiêu phấn đấu."
          />
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {catalogue.map((reward) => (
              <li
                key={reward.id}
                className="flex flex-wrap items-center justify-between gap-2 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">
                    {reward.icon ? `${reward.icon} ` : ""}
                    {reward.title}
                    {!reward.is_active && (
                      <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        đang ẩn
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    {reward.points_required} điểm · {formatStock(reward.stock)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(reward);
                      setShowForm(true);
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(reward)}
                    disabled={busyId === reward.id}
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    Xoá
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
