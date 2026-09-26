"use client";

import { useState, useTransition } from "react";
import { generateToday } from "@/app/actions/task-actions";

/**
 * Creates today's task instances on demand.
 *
 * The database function is idempotent, so pressing this twice in a day creates
 * nothing new. It reports how many were added rather than implying failure when
 * the answer is zero.
 */
export default function GenerateTodayButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  function run() {
    startTransition(async () => {
      const result = await generateToday();
      if (result.ok) {
        setMessage({
          text:
            result.created && result.created > 0
              ? `Đã tạo ${result.created} việc cho hôm nay.`
              : "Hôm nay đã có đủ việc rồi.",
          ok: true,
        });
      } else {
        setMessage({ text: result.error ?? "Không tạo được việc.", ok: false });
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-60"
      >
        {pending ? "Đang tạo..." : "Tạo việc hôm nay"}
      </button>
      {message && (
        <span
          role="status"
          className={`text-sm ${message.ok ? "text-green-700" : "text-red-700"}`}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
