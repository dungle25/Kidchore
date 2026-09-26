import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  GOOGLE_COOKIE,
  GOOGLE_COOKIE_MAX_AGE,
} from "@/lib/auth-constants";
import { sessionCookieOptions, signSessionToken } from "@/lib/session";
import {
  clearSupabaseAuthCookies,
  createSupabaseAuthServerClient,
} from "@/lib/supabase-oauth";

/**
 * Completes the Google sign-in redirect.
 *
 * Steps, in order:
 *   1. Exchange the OAuth code for a Supabase session (the PKCE code verifier is
 *      read from the cookie that `@supabase/ssr` wrote before the redirect).
 *   2. Resolve that identity to an app user.
 *   3. Mint the app's own HttpOnly session cookie and discard the Supabase one.
 *   4. Send the user to onboarding, or straight to their dashboard.
 *
 * Google user ids are trusted here only because the token was just exchanged
 * server-side with the project's own auth service.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const fail = (message: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);

  if (oauthError) {
    return fail(errorDescription || "Đăng nhập Google bị huỷ.");
  }
  if (!code) {
    return fail("Thiếu mã xác thực từ Google. Vui lòng thử lại.");
  }

  const supabase = await createSupabaseAuthServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    return fail("Không thể xác thực với Google. Vui lòng thử lại.");
  }

  const authUserId = data.user.id;
  const email = data.user.email ?? "";
  const cookieStore = await cookies();

  // Any row already linked to this Google identity is a returning user.
  const { data: linked } = await supabase
    .from("users")
    .select("id, display_name, role")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (linked?.role === "CHILD") {
    // A child account should never come through Google; send them to PIN sign-in.
    await clearSupabaseAuthCookies();
    return fail("Tài khoản của bé đăng nhập bằng mã PIN, không dùng Google.");
  }

  if (linked) {
    const token = signSessionToken({
      sub: authUserId,
      role: "PARENT",
      name: linked.display_name || email,
    });
    cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
    await clearSupabaseAuthCookies();
    return NextResponse.redirect(`${origin}/parent/dashboard`);
  }

  // Not onboarded yet. Hold the Google session in a short-lived HttpOnly cookie so
  // the onboarding step can create the family on this user's behalf.
  cookieStore.set(GOOGLE_COOKIE, data.session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GOOGLE_COOKIE_MAX_AGE,
  });

  // The Supabase session itself is no longer needed; the short-lived cookie above
  // is what onboarding uses. Clearing now avoids leaving a stale session behind.
  await clearSupabaseAuthCookies();

  return NextResponse.redirect(`${origin}/onboarding`);
}
