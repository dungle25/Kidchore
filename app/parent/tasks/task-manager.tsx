"use client";

import { useState, useTransition } from "react";
import { deleteTask, saveTask } from "@/app/actions/task-actions";
import { EmptyState } from "@/components/ui";
import type { ParentChild, ParentTask, Recurrence } from "@/lib/domain";
import SuggestedTasks from "./suggested-tasks";

const RECURRENCE_LABELS: Record<Recurrence, string> = {
  DAILY: "Hằng ngày",
  WEEKLY: "Hằng tuần",
  MONTHLY: "Hằng tháng",
  ONE_TIME: "Một lần",
};

/**
 * Chore definitions.
 *
 * A definition is a template; today's instances are generated from it by
 * `generate_task_instances`. Leaving the assignee empty means "every child", which
 * the database expands at generation time.
 */
export default function TaskManager({
  tasks,
  kids,
}: {
  tasks: ParentTask[];
  kids: ParentChild[];
}) {
  const [rows, setRows] = useState(tasks);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ParentTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const assigned = String(formData.get("assignedToUserId") ?? "");
    const input = {
      id: editing?.id ?? null,
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "") || null,
      pointsReward: Number(formData.get("pointsReward") ?? 0),
      recurrence: String(formData.get("recurrence") ?? "DAILY") as Recurrence,
      requireProofImage: formData.get("requireProofImage") === "on",
      assignedToUserId: assigned || null,
    };

    setBusy(true);
    setFeedback(null);
    startTransition(async () => {
      const result = await saveTask(input);
      setBusy(false);
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không lưu được.", ok: false });
        return;
      }
      setFeedback({
        text: input.id ? "Đã cập nhật việc." : "Đã thêm việc mới.",
        ok: true,
      });
      setShowForm(false);
      setEditing(null);
      if (input.id) {
        setRows((current) =>
          current.map((row) =>
            row.id === input.id
              ? {
                  ...row,
                  title: input.title,
                  description: input.description,
                  points_reward: input.pointsReward,
                  recurrence: input.recurrence,
                  require_proof_image: input.requireProofImage,
                  assigned_to_user_id: input.assignedToUserId,
                  assigned_to_name:
                    kids.find((c) => c.id === input.assignedToUserId)
                      ?.display_name ?? null,
                }
              : row
          )
        );
      } else {
        // A full reload will supply the real id; this keeps the list responsive.
        setRows((current) => [
          {
            id: `pending-${Date.now()}`,
            title: input.title,
            description: input.description,
            points_reward: input.pointsReward,
            recurrence: input.recurrence,
            require_proof_image: input.requireProofImage,
            assigned_to_user_id: input.assignedToUserId,
            assigned_to_name:
              kids.find((c) => c.id === input.assignedToUserId)?.display_name ??
              null,
            category_id: null,
            created_at: new Date().toISOString(),
          },
          ...current,
        ]);
      }
    });
  }

  function onDelete(task: ParentTask) {
    setBusy(true);
    setFeedback(null);
    startTransition(async () => {
      const result = await deleteTask(task.id);
      setBusy(false);
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không xoá được.", ok: false });
        return;
      }
      setRows((current) => current.filter((row) => row.id !== task.id));
      setFeedback({ text: `Đã xoá “${task.title}”.`, ok: true });
    });
  }

  return (
    <div className="space-y-4">
      <SuggestedTasks
        existingTitles={rows.map((row) => row.title)}
        onAdded={(created) => {
          // The rows the server created, with their real ids, so the list is correct
          // immediately instead of after a manual reload.
          setRows((current) => [...created, ...current]);
          setFeedback({ text: `Đã thêm ${created.length} việc từ danh sách gợi ý.`, ok: true });
        }}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setShowForm((value) => !value);
          }}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          {showForm ? "Đóng" : "+ Thêm việc"}
        </button>
      </div>

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

      {showForm && (
        <form
          action={onSubmit}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Tên việc</span>
              <input
                name="title"
                required
                defaultValue={editing?.title ?? ""}
                placeholder="Dọn phòng ngủ"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Mô tả</span>
              <input
                name="description"
                defaultValue={editing?.description ?? ""}
                placeholder="Gấp chăn và cất đồ chơi"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Số điểm thưởng</span>
              <input
                name="pointsReward"
                type="number"
                min={1}
                required
                defaultValue={editing?.points_reward ?? 10}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Lặp lại</span>
              <select
                name="recurrence"
                defaultValue={editing?.recurrence ?? "DAILY"}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
              >
                {Object.entries(RECURRENCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Giao cho</span>
              <select
                name="assignedToUserId"
                defaultValue={editing?.assigned_to_user_id ?? ""}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
              >
                <option value="">Tất cả các bé</option>
                {kids.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.display_name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              name="requireProofImage"
              type="checkbox"
              defaultChecked={editing?.require_proof_image ?? false}
              className="h-4 w-4"
            />
            Yêu cầu bé gửi ảnh bằng chứng
          </label>

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {busy ? "Đang lưu..." : editing ? "Cập nhật" : "Thêm việc"}
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="📋"
          title="Chưa có việc nào"
          description="Tạo việc đầu tiên, sau đó bấm “Tạo việc hôm nay” ở trang Tổng quan để sinh việc cho các bé."
        />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {rows.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{task.title}</p>
                <p className="text-xs text-slate-400">
                  {task.points_reward} điểm · {RECURRENCE_LABELS[task.recurrence]} ·{" "}
                  {task.assigned_to_name ?? "Tất cả các bé"}
                  {task.require_proof_image && " · cần ảnh"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(task);
                    setShowForm(true);
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Sửa
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(task)}
                  disabled={busy}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  Xoá
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
