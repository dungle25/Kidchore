"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary.
 *
 * Never shows the raw exception to a child or parent: that leaks internals and is
 * unreadable. The message is logged for the developer and the user gets a way
 * forward, including the digest that lets a specific failure be traced in logs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 text-center shadow-sm">
        <p className="text-4xl" aria-hidden>
          😕
        </p>
        <h1 className="text-xl font-bold text-slate-800">Có lỗi xảy ra</h1>
        <p className="text-sm text-slate-500">
          Ứng dụng gặp sự cố ngoài dự kiến. Bạn thử lại giúp mình nhé. Nếu vẫn lỗi,
          có thể máy chủ dữ liệu đang tạm nghỉ.
        </p>

        {error.digest && (
          <p className="text-xs text-slate-400">Mã lỗi: {error.digest}</p>
        )}

        <div className="flex justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
          >
            Thử lại
          </button>
          <Link
            href="/"
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Về trang chủ
          </Link>
        </div>
      </div>
    </main>
  );
}
