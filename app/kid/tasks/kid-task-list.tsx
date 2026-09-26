"use client";

import { useState, useTransition } from "react";
import { submitTask } from "@/app/actions/task-actions";
import type { KidTask } from "@/lib/domain";

const STATUS_LABEL: Record<KidTask["status"], string> = {
  PENDING: "Chưa làm",
  SUBMITTED: "Chờ bố/mẹ duyệt",
  APPROVED: "Đã xong",
  REJECTED: "Bị trả lại",
};

/**
 * Today's chores with a large "done" button.
 *
 * After submitting, the card switches to a waiting state rather than disappearing:
 * the child needs to see that the work was sent and is now with a parent. A rejected
 * task can be submitted again, and the parent's reason is shown.
 */
export default function KidTaskList({ tasks }: { tasks: KidTask[] }) {
  const [rows, setRows] = useState(tasks);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [, startTransition] = useTransition();

  function submit(task: KidTask) {
    setBusyId(task.id);
    setFeedback(null);

    startTransition(async () => {
      const result = await submitTask(task.id);
      setBusyId(null);

      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không nộp được.", ok: false });
        return;
      }

      setRows((current) =>
        current.map((row) =>
          row.id === task.id
            ? { ...row, status: "SUBMITTED", rejection_reason: null }
            : row
        )
      );
      setFeedback({
        text: `Đã gửi “${task.title}” cho bố/mẹ duyệt. Giỏi lắm! 🎉`,
        ok: true,
      });
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-violet-200 bg-white p-8 text-center">
        <p className="text-5xl" aria-hidden>
          🌟
        </p>
        <p className="mt-3 text-lg font-bold text-slate-700">
          Hôm nay con không có việc nào!
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Nghỉ ngơi thôi, hoặc nhờ bố/mẹ giao thêm việc nhé.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {feedback && (
        <p
          role="status"
          className={`rounded-xl p-3 text-sm font-medium ${
            feedback.ok
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-700"
          }`}
        >
          {feedback.text}
        </p>
      )}

      {rows.map((task) => {
        const done = task.status === "SUBMITTED" || task.status === "APPROVED";
        return (
          <div
            key={task.id}
            className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${
              task.status === "APPROVED"
                ? "border-green-200"
                : task.status === "SUBMITTED"
                  ? "border-blue-200"
                  : task.status === "REJECTED"
                    ? "border-amber-300"
                    : "border-violet-200"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-800">{task.title}</h3>
                {task.description && (
                  <p className="mt-0.5 text-sm text-slate-500">{task.description}</p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-800">
                +{task.points_reward}
              </span>
            </div>

            {task.status === "REJECTED" && task.rejection_reason && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                Bố/mẹ nhắn: {task.rejection_reason}
              </p>
            )}

            {task.require_proof_image && task.status !== "APPROVED" && (
              <p className="mt-3 text-xs text-slate-400">
                📷 Việc này cần ảnh bằng chứng. Nhờ bố/mẹ chụp giúp con nhé.
              </p>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <span
                className={`text-sm font-semibold ${
                  task.status === "APPROVED"
                    ? "text-green-600"
                    : task.status === "SUBMITTED"
                      ? "text-blue-600"
                      : task.status === "REJECTED"
                        ? "text-amber-600"
                        : "text-slate-400"
                }`}
              >
                {STATUS_LABEL[task.status]}
              </span>

              {!done && (
                <button
                  type="button"
                  onClick={() => submit(task)}
                  disabled={busyId === task.id}
                  className="rounded-xl bg-violet-600 px-6 py-3 text-base font-bold text-white transition hover:bg-violet-700 disabled:opacity-60"
                >
                  {busyId === task.id
                    ? "Đang gửi..."
                    : task.status === "REJECTED"
                      ? "Làm lại & gửi"
                      : "Đã làm xong 🚀"}
                </button>
              )}

              {task.status === "SUBMITTED" && (
                <span className="text-sm text-slate-400">Đợi bố/mẹ nhé ⏳</span>
              )}
              {task.status === "APPROVED" && (
                <span className="text-2xl" aria-hidden>
                  ✅
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
