import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GOOGLE_COOKIE, INVITE_COOKIE, SESSION_COOKIE } from "@/lib/auth-constants";
import { verifySessionToken } from "@/lib/session";
import OnboardingForm from "./onboarding-form";

export const metadata: Metadata = {
  title: "Thiết lập gia đình — KidChore",
};

/**
 * Reads the email out of the short-lived Google access token.
 *
 * The token was already verified by Supabase Auth during the callback, and it is
 * read here on the server only to greet the user. Nothing is authorized from this
 * value.
 */
function emailFromGoogleToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const cookieStore = await cookies();

  // Already signed in with an app session: nothing to onboard.
  if (verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    redirect("/");
  }

  const googleToken = cookieStore.get(GOOGLE_COOKIE)?.value;
  if (!googleToken) {
    redirect("/login?error=" + encodeURIComponent("Vui lòng đăng nhập bằng Google trước."));
  }

  // Arriving through an invitation link: the code was parked in a cookie so it could
  // survive the Google round trip. `?code=` is accepted too, for a link that was
  // forwarded somewhere the cookie did not follow.
  const { code } = await searchParams;
  const inviteCode = code ?? cookieStore.get(INVITE_COOKIE)?.value ?? undefined;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center">
          <h1 className="text-3xl font-bold text-slate-800">Chào mừng!</h1>
          <p className="mt-1 text-sm text-slate-500">
            {inviteCode
              ? "Bạn được mời vào một gia đình trên KidChore."
              : "Chỉ còn một bước nữa để bắt đầu."}
          </p>
        </header>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <OnboardingForm
            email={emailFromGoogleToken(googleToken)}
            presetCode={inviteCode}
          />
        </section>
      </div>
    </main>
  );
}
