import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-constants";
import { verifySessionToken } from "@/lib/session";

/**
 * Route protection.
 *
 * In Next.js 16 this file convention replaced `middleware.ts`; the exported
 * function is named `proxy`.
 *
 * These are optimistic checks only: they read and verify the session cookie, which
 * is cheap and needs no database round trip. They decide where a person should be
 * sent, but they are not the authorization boundary. The real checks live in
 * `lib/dal.ts` and, ultimately, in the database functions, which re-verify the
 * caller's role on every call. Skipping this file would be a navigation
 * inconvenience, not a security hole.
 */
export default function proxy(request: NextRequest) {
  const { pathname, origin } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);

  const isParentArea = pathname.startsWith("/parent");
  const isKidArea = pathname.startsWith("/kid");
  const isAuthArea =
    pathname === "/login" || pathname === "/onboarding" || pathname.startsWith("/auth");

  // Signed-in users have no reason to see the sign-in screen.
  if (isAuthArea && session && pathname === "/login") {
    const home = session.role === "PARENT" ? "/parent/dashboard" : "/kid/dashboard";
    return NextResponse.redirect(new URL(home, origin));
  }

  if (!isParentArea && !isKidArea) {
    return NextResponse.next();
  }

  // Not signed in at all.
  if (!session) {
    const login = new URL("/login", origin);
    // Remember where they were headed so we can send them back after sign-in.
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Signed in, but in the wrong area. Send them to their own home rather than
  // showing a page they cannot use.
  if (isParentArea && session.role !== "PARENT") {
    return NextResponse.redirect(new URL("/kid/dashboard", origin));
  }
  if (isKidArea && session.role !== "CHILD") {
    return NextResponse.redirect(new URL("/parent/dashboard", origin));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Run on application routes only. Static assets, image optimisation and the
   * favicon are excluded so auth logic can never block CSS, JS or icons.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
