"use client";

import { useState, useTransition } from "react";
import { addSuggestedTasks } from "@/app/actions/task-actions";
import type { ParentTask } from "@/lib/domain";
import { SUGGESTED_TASKS } from "@/lib/suggested-tasks";

interface Row {
  selected: boolean;
  points: number;
  needsPhoto: boolean;
}

/**
 * Adds the everyday chores in one go.
 *
 * The full form is still there for anything unusual. This exists because the first
 * thing a family does with the app is enter the dozen habits they already have, and
 * doing that one modal at a time on a phone is the point at which people give up.
 *
 * Every number is editable before anything is saved, and nothing is written until the
 * button is pressed: the catalogue is a starting point, not a decision the app makes
 * for the family. Chores whose title already exists are skipped by the server, so
 * pressing the button twice is harmless.
 */
export default function SuggestedTasks({
  existingTitles,
  onAdded,
}: {
  /** Titles already in the family's list, so they can be shown as already present. */
  existingTitles: string[];
  /** Called with the rows the server created, so the list updates without a reload. */
  onAdded: (created: ParentTask[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      SUGGESTED_TASKS.map((task) => [
        task.title,
        { selected: false, points: task.points, needsPhoto: task.needsPhoto },
      ])
    )
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [, startTransition] = useTransition();

  const taken = new Set(existingTitles.map((title) => title.trim().toLowerCase()));
  const available = SUGGESTED_TASKS.filter((task) => !taken.has(task.title.toLowerCase()));
  const chosen = available.filter((task) => rows[task.title]?.selected);

  function update(title: string, patch: Partial<Row>) {
    setRows((current) => ({ ...current, [title]: { ...current[title], ...patch } }));
  }

  function selectAll(selected: boolean) {
    setRows((current) => {
      const next = { ...current };
      for (const task of available) next[task.title] = { ...next[task.title], selected };
      return next;
    });
  }

  function onSubmit() {
    setBusy(true);
    setFeedback(null);
    startTransition(async () => {
      const result = await addSuggestedTasks(
        chosen.map((task) => ({
          title: task.title,
          pointsReward: rows[task.title].points,
          requireProofImage: rows[task.title].needsPhoto,
        }))
      );
      setBusy(false);

      if (!result.ok) {
        setFeedback({ text: result.error, ok: false });
        return;
      }

      if (result.created.length > 0) onAdded(result.created);
      setRows((current) => {
        const next = { ...current };
        for (const task of result.created) next[task.title] = { ...next[task.title], selected: false };
        return next;
      });

      // Say exactly what happened, including the parts that did not: "3 added, 11 already
      // there" is a different situation from "14 added", and a vague success message
      // would leave the parent counting rows to find out which one they got.
      const parts: string[] = [];
      if (result.created.length > 0) parts.push(`Đã thêm ${result.created.length} việc`);
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} việc đã có sẵn nên bỏ qua`);
      if (result.failed.length > 0) {
        parts.push(`${result.failed.length} việc lỗi (${result.failed[0].error})`);
      }
      setFeedback({
        text: parts.length > 0 ? `${parts.join(", ")}.` : "Không có gì để thêm.",
        ok: result.failed.length === 0,
      });
    });
  }

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-violet-900">Thêm nhanh việc thường làm</h2>
          <p className="text-xs text-slate-600">
            Chọn từ danh sách có sẵn, sửa điểm nếu muốn, rồi thêm một lần.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-100"
        >
          {open ? "Đóng" : "Mở danh sách"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {available.length === 0 ? (
            <p className="rounded-lg bg-white p-3 text-sm text-slate-600">
              Gia đình đã có hết các việc gợi ý rồi. Thêm việc khác bằng nút “+ Thêm việc”.
            </p>
          ) : (
            <>
              <div className="flex gap-3 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => selectAll(true)}
                  className="text-violet-700 underline"
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={() => selectAll(false)}
                  className="text-slate-500 underline"
                >
                  Bỏ chọn
                </button>
              </div>

              <ul className="divide-y divide-violet-100 overflow-hidden rounded-lg border border-violet-200 bg-white">
                {available.map((task) => {
                  const row = rows[task.title];
                  return (
                    <li key={task.title} className="flex flex-wrap items-center gap-3 p-3">
                      <label className="flex min-w-0 flex-1 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(event) => update(task.title, { selected: event.target.checked })}
                          className="h-5 w-5 shrink-0"
                        />
                        <span className="truncate font-medium text-slate-800">{task.title}</span>
                      </label>

                      <label className="flex items-center gap-1 text-xs text-slate-500">
                        <input
                          type="number"
                          min={1}
                          value={row.points}
                          onChange={(event) =>
                            update(task.title, { points: Number(event.target.value) })
                          }
                          className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center text-sm text-slate-800"
                        />
                        điểm
                      </label>

                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={row.needsPhoto}
                          onChange={(event) =>
                            update(task.title, { needsPhoto: event.target.checked })
                          }
                          className="h-4 w-4"
                        />
                        cần ảnh
                      </label>
                    </li>
                  );
                })}
              </ul>

              <button
                type="button"
                onClick={onSubmit}
                disabled={busy || chosen.length === 0}
                className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                {busy
                  ? "Đang thêm..."
                  : chosen.length === 0
                    ? "Chọn ít nhất một việc"
                    : `Thêm ${chosen.length} việc đã chọn`}
              </button>
            </>
          )}

          {taken.size > 0 && (
            <p className="text-xs text-slate-500">
              Đã ẩn {SUGGESTED_TASKS.length - available.length} việc vì gia đình đã có.
            </p>
          )}
        </div>
      )}

      {feedback && (
        <p
          role="status"
          className={`mt-3 rounded-lg border p-3 text-sm ${
            feedback.ok
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}
