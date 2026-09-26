import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 text-center shadow-sm">
        <p className="text-4xl" aria-hidden>
          🧭
        </p>
        <h1 className="text-xl font-bold text-slate-800">Không tìm thấy trang</h1>
        <p className="text-sm text-slate-500">
          Đường dẫn này không tồn tại hoặc đã được thay đổi.
        </p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
        >
          Về trang chủ
        </Link>
      </div>
    </main>
  );
}
