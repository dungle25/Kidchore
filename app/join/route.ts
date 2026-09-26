import { NextResponse, type NextRequest } from "next/server";
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE } from "@/lib/auth-constants";
import { normaliseInviteCode } from "@/lib/invite-code";

/**
 * Landing page for an invitation link: `/join?code=XXXX-XXXX-XXXX`.
 *
 * The person tapping it is not signed in yet, and signing in means a round trip through
 * Google, so the code has to be parked somewhere that survives it. It goes in an
 * HttpOnly cookie rather than staying in the URL: a code in the address bar ends up in
 * browser history, in the Referer header of the next request, and in the access log of
 * every hop along the way - and this code is worth a full parent account.
 *
 * From here the visitor lands on the sign-in screen, which says what they were invited
 * to. `/onboarding` picks the code back up afterwards.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = normaliseInviteCode(searchParams.get("code") ?? "");

  // A link with no usable code is not worth an error screen: send them to sign in as
  // usual and let them paste the code by hand if they have it.
  if (!code) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const response = NextResponse.redirect(new URL("/login?invite=1", origin));
  response.cookies.set(INVITE_COOKIE, code, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE,
  });
  return response;
}
