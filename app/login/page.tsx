import Link from "next/link";
import { listChildProfiles } from "@/app/actions/auth-actions";
import GoogleLoginButton from "./google-login-button";
import PinLoginForm from "./pin-login-form";

export const metadata = {
  title: "Đăng nhập — KidChore",
};

/**
 * Sign-in screen for the whole family.
 *
 * Bố/mẹ use Google; các bé use a PIN. The two are visually separated so it is
 * obvious to a child which part is theirs.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Failures here must not break the page: without profiles the PIN section simply
  // explains that no child exists yet.
  let profiles: Awaited<ReturnType<typeof listChildProfiles>> = [];
  try {
    profiles = await listChildProfiles();
  } catch {
    profiles = [];
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center">
          <h1 className="text-3xl font-bold text-slate-800">KidChore</h1>
          <p className="mt-1 text-sm text-slate-500">
            Quản lý việc nhà và thói quen cho cả gia đình
          </p>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Dành cho bố/mẹ</h2>
          <p className="text-sm text-slate-500">
            Đăng nhập để quản lý việc, duyệt bài và phần thưởng.
          </p>
          <GoogleLoginButton />
        </section>

        <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Dành cho các bé</h2>
          <p className="text-sm text-slate-500">
            Chọn tên của con rồi nhập mã PIN.
          </p>
          <PinLoginForm profiles={profiles} />
        </section>

        <p className="text-center text-xs text-slate-400">
          Bằng việc đăng nhập, bạn đồng ý cho ứng dụng lưu dữ liệu trong gia đình
          mình.{" "}
          <Link href="/" className="underline">
            Về trang chủ
          </Link>
        </p>
      </div>
    </main>
  );
}
