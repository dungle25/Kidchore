"use client";

import { useState, useTransition } from "react";
import { approveTask, rejectTask } from "@/app/actions/task-actions";
import { formatDateTime } from "@/components/ui";
import { groupApprovalsByChild } from "@/lib/approval-groups";
import type { PendingApproval } from "@/lib/domain";

/**
 * Approval queue, grouped by the child who submitted.
 *
 * Flat was the wrong shape here: with more than one child the parent had to read the
 * small grey line under every card to work out who they were about to pay. The heading
 * carries the name, the number of submissions and the points at stake.
 *
 * Each card still acts independently and reports its own outcome. The server call is
 * awaited before the row is removed, so the UI never claims success for a write that
 * failed, and the idempotency guard in the database turns a double tap into a clear
 * message instead of paying the child twice.
 */
export default function ApprovalList({ items }: { items: PendingApproval[] }) {
  const [rows, setRows] = useState(items);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [, startTransition] = useTransition();

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function handleApprove(item: PendingApproval) {
    setBusyId(item.id);
    setFeedback(null);
    startTransition(async () => {
      const result = await approveTask(item.id);
      setBusyId(null);
      if (result.ok) {
        removeRow(item.id);
        setFeedback({
          text: `Đã duyệt “${item.task_title}” và cộng ${item.points_reward} điểm cho ${item.child_name}.`,
          ok: true,
        });
      } else {
        setFeedback({ text: result.error ?? "Không duyệt được.", ok: false });
      }
    });
  }

  function handleReject(item: PendingApproval) {
    const reason = (reasons[item.id] ?? "").trim();
    if (!reason) {
      setFeedback({ text: "Vui lòng ghi lý do trước khi từ chối.", ok: false });
      return;
    }

    setBusyId(item.id);
    setFeedback(null);
    startTransition(async () => {
      const result = await rejectTask(item.id, reason);
      setBusyId(null);
      if (result.ok) {
        removeRow(item.id);
        setFeedback({ text: `Đã từ chối “${item.task_title}”.`, ok: true });
      } else {
        setFeedback({ text: result.error ?? "Không từ chối được.", ok: false });
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        🎉 Không còn bài nào chờ duyệt.
        {feedback?.ok && (
          <span className="mt-2 block text-green-700">{feedback.text}</span>
        )}
      </p>
    );
  }

  const blocks = groupApprovalsByChild(rows);

  return (
    <div className="space-y-4">
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

      {blocks.map((block) => {
        if (block.kind === "header") {
          return (
            <h2
              key={`child-${block.childId}`}
              // The child's name also appears inside each card ("Ken · nộp lúc …"), so the
              // heading is named in the DOM too. Without this, anything checking the page
              // has to guess which of the two it just found.
              data-child-heading={block.childId}
              className="flex flex-wrap items-baseline gap-2 pt-3 text-base font-bold text-slate-700"
            >
              {block.childName}
              <span className="text-sm font-medium text-slate-400">
                {block.count} bài · +{block.points} điểm
              </span>
            </h2>
          );
        }

        const item = block.item;

        return (
          <div
            key={item.id}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-800">{item.task_title}</h3>
                {item.task_description && (
                  <p className="mt-0.5 text-sm text-slate-500">
                    {item.task_description}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  {item.child_name} · nộp lúc {formatDateTime(item.completed_at)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                +{item.points_reward} điểm
              </span>
            </div>

            {item.proof_image_url ? (
              <a
                href={item.proof_image_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.proof_image_url}
                  alt={`Ảnh bằng chứng cho ${item.task_title}`}
                  className="max-h-56 rounded-lg border border-slate-200 object-cover"
                />
              </a>
            ) : (
              item.require_proof_image && (
                <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                  Việc này yêu cầu ảnh bằng chứng nhưng bé chưa gửi ảnh.
                </p>
              )
            )}

            {/* 44px minimum on the approve button, the reject button and the reason field.
                Measured in a browser before this: 40px, 38px and 38px - under the minimum,
                on the one screen a parent uses one-handed with a phone in the other hand.
                `scripts/test-ui.mjs` now measures all three, so shrinking one fails CI. */}
            <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => handleApprove(item)}
                disabled={busyId === item.id}
                className="min-h-11 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
              >
                {busyId === item.id ? "Đang xử lý..." : "Duyệt & cộng điểm"}
              </button>

              <div className="flex flex-1 gap-2">
                <input
                  type="text"
                  value={reasons[item.id] ?? ""}
                  onChange={(event) =>
                    setReasons((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                  placeholder="Lý do từ chối"
                  aria-label={`Lý do từ chối ${item.task_title}`}
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleReject(item)}
                  disabled={busyId === item.id}
                  className="min-h-11 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                >
                  Từ chối
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
