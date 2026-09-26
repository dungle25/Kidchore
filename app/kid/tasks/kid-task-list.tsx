"use client";

import { useRef, useState, useTransition } from "react";
import { submitTask, uploadProofImage } from "@/app/actions/task-actions";
import {
  ACCEPTED_IMAGE_TYPES,
  compressImage,
  formatBytes,
} from "@/lib/image-compression";
import type { KidTask } from "@/lib/domain";

const STATUS_LABEL: Record<KidTask["status"], string> = {
  PENDING: "Chưa làm",
  SUBMITTED: "Chờ bố/mẹ duyệt",
  APPROVED: "Đã xong",
  REJECTED: "Bị trả lại",
};

interface Picked {
  file: File;
  previewUrl: string;
  /** Size of the original file, before compression. */
  originalBytes: number;
}

/**
 * Today's chores with a large "done" button.
 *
 * When a chore requires proof, the child picks a photo first. The image is downscaled
 * in the browser before it is sent, which is what keeps a daily habit from filling the
 * storage quota. After submitting, the card switches to a waiting state rather than
 * disappearing: the child needs to see that the work was sent and is now with a
 * parent. A rejected chore can be submitted again, with the parent's reason shown.
 */
export default function KidTaskList({ tasks }: { tasks: KidTask[] }) {
  const [rows, setRows] = useState(tasks);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [picked, setPicked] = useState<Record<string, Picked>>({});
  const [, startTransition] = useTransition();
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function clearPick(taskId: string) {
    setPicked((current) => {
      // Release the preview so object URLs are not leaked.
      const previous = current[taskId];
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    const input = inputRefs.current[taskId];
    if (input) input.value = "";
  }

  /** Compresses the chosen photo and keeps a local preview. */
  async function onPick(task: KidTask, file: File | undefined) {
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setFeedback({ text: "Chỉ chọn được ảnh JPG, PNG hoặc WEBP.", ok: false });
      return;
    }

    setPreparing(task.id);
    setFeedback(null);

    try {
      const result = await compressImage(file);
      const previewUrl = URL.createObjectURL(result.file);
      setPicked((current) => {
        const previous = current[task.id];
        if (previous) URL.revokeObjectURL(previous.previewUrl);
        return {
          ...current,
          [task.id]: {
            file: result.file,
            previewUrl,
            originalBytes: result.originalBytes,
          },
        };
      });

      if (!result.usedOriginal && result.compressedBytes < result.originalBytes) {
        setFeedback({
          text: `Đã nén ảnh từ ${formatBytes(result.originalBytes)} xuống ${formatBytes(result.compressedBytes)}.`,
          ok: true,
        });
      }
    } catch {
      setFeedback({ text: "Không xử lý được ảnh này. Bé thử ảnh khác nhé.", ok: false });
    } finally {
      setPreparing(null);
    }
  }

  function submit(task: KidTask) {
    const chosen = picked[task.id];

    if (task.require_proof_image && !chosen && !task.proof_image_url) {
      setFeedback({
        text: `Việc “${task.title}” cần ảnh bằng chứng. Bé chọn ảnh trước nhé.`,
        ok: false,
      });
      return;
    }

    setBusyId(task.id);
    setFeedback(null);

    startTransition(async () => {
      let proofUrl: string | null = null;

      if (chosen) {
        setFeedback({ text: "Đang tải ảnh lên...", ok: true });
        const payload = new FormData();
        payload.append("file", chosen.file);
        const upload = await uploadProofImage(payload);

        if (!upload.ok || !upload.url) {
          setBusyId(null);
          setFeedback({ text: upload.error ?? "Không tải ảnh lên được.", ok: false });
          return;
        }
        proofUrl = upload.url;
      }

      const result = await submitTask(task.id, proofUrl);
      setBusyId(null);

      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không nộp được.", ok: false });
        return;
      }

      setRows((current) =>
        current.map((row) =>
          row.id === task.id
            ? {
                ...row,
                status: "SUBMITTED",
                rejection_reason: null,
                proof_image_url: proofUrl ?? row.proof_image_url,
              }
            : row
        )
      );
      clearPick(task.id);
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
            feedback.ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"
          }`}
        >
          {feedback.text}
        </p>
      )}

      {rows.map((task) => {
        const done = task.status === "SUBMITTED" || task.status === "APPROVED";
        const chosen = picked[task.id];

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

            {/* An already submitted photo stays visible so the child can confirm it. */}
            {task.proof_image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={task.proof_image_url}
                alt={`Ảnh bằng chứng cho ${task.title}`}
                className="mt-3 max-h-48 rounded-xl border border-slate-200 object-cover"
              />
            )}

            {task.require_proof_image && !done && (
              <div className="mt-3 rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/50 p-3">
                <p className="text-sm font-semibold text-violet-800">
                  📷 Việc này cần ảnh bằng chứng
                </p>

                {chosen ? (
                  <div className="mt-2 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={chosen.previewUrl}
                      alt="Ảnh bé vừa chọn"
                      className="h-20 w-20 rounded-lg border border-violet-200 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-700">Đã chọn ảnh</p>
                      <p className="text-xs text-slate-500">
                        {formatBytes(chosen.file.size)}
                        {chosen.originalBytes > chosen.file.size &&
                          ` (từ ${formatBytes(chosen.originalBytes)})`}
                      </p>
                      <button
                        type="button"
                        onClick={() => clearPick(task.id)}
                        className="mt-1 text-xs font-medium text-red-600 underline"
                      >
                        Chọn ảnh khác
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <input
                      ref={(element) => {
                        inputRefs.current[task.id] = element;
                      }}
                      type="file"
                      accept={ACCEPTED_IMAGE_TYPES.join(",")}
                      // `capture` lets a phone open the camera directly.
                      capture="environment"
                      onChange={(event) => onPick(task, event.target.files?.[0])}
                      className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-violet-700"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      {preparing === task.id
                        ? "Đang xử lý ảnh..."
                        : "Chọn ảnh, hoặc nhờ bố/mẹ chụp giúp con."}
                    </p>
                  </>
                )}
              </div>
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
                  disabled={busyId === task.id || preparing === task.id}
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
