import Link from "next/link";
import { listChildProfiles } from "@/app/actions/auth-actions";
import { getAuthContext } from "@/lib/dal";
import GoogleLoginButton from "./google-login-button";
import PinPad from "./pin-login-form";

export const metadata = {
  title: "Đăng nhập — KidChore",
};

/**
 * Sign-in screen for the whole family.
 *
 * Bố/mẹ use Google; các bé use a PIN. The two are visually separated so it is
 * obvious to a child which part is theirs.
 *
 * Two ways to arrive here while already signed in, and both mean "switch profile":
 * the sibling avatars link to `?switchTo=<username>`, and "Đổi bé" in the child area
 * links to `/login` with no parameter. So a signed-in child is shown the picker rather
 * than the parent section - the Google button is not something a child mid-switch
 * should be offered.
 *
 * The PIN is still required either way, so this is a shortcut rather than a way around
 * authentication. See proxy.ts for why `/login` stays reachable while signed in.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; switchTo?: string; invite?: string }>;
}) {
  const { error, switchTo, invite } = await searchParams;

  // Failures here must not break the page: without profiles the PIN section simply
  // explains that no child exists yet.
  let profiles: Awaited<ReturnType<typeof listChildProfiles>> = [];
  try {
    profiles = await listChildProfiles();
  } catch {
    profiles = [];
  }

  const session = await getAuthContext();
  const switching = Boolean(switchTo) || session?.session.role === "CHILD";

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center">
          <h1 className="text-3xl font-bold text-slate-800">
            {switching ? "Đổi bé" : "KidChore"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {switching
              ? "Nhập mã PIN của bé để vào."
              : "Quản lý việc nhà và thói quen cho cả gia đình"}
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

        {/* Arrived through an invitation link. Said here rather than on a page of its
            own, because the next step is exactly the Google button below. */}
        {invite && !switching && (
          <p className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
            Bạn được mời vào một gia đình trên KidChore. Đăng nhập bằng Google bên dưới
            để tham gia.
          </p>
        )}

        {switching ? (
          <>
            <section className="space-y-3">
              <PinPad profiles={profiles} presetUsername={switchTo} autoFocus />
            </section>
            <p className="text-center text-sm">
              <Link href="/login" className="text-violet-700 underline">
                Chọn bé khác
              </Link>
            </p>
          </>
        ) : (
          <>
            <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-800">
                Dành cho bố/mẹ
              </h2>
              <p className="text-sm text-slate-500">
                Đăng nhập để quản lý việc, duyệt bài và phần thưởng.
              </p>
              <GoogleLoginButton />
            </section>

            <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-800">
                Dành cho các bé
              </h2>
              <p className="text-sm text-slate-500">
                Chọn tên của con rồi nhập mã PIN.
              </p>
              <PinPad profiles={profiles} />
            </section>
          </>
        )}

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
