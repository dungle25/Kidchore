import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth-constants";
import {
  shouldRenewSession,
  signSessionToken,
  verifySessionToken,
  sessionCookieHeader,
} from "@/lib/session";

/**
 * Extends a session that is close to expiring.
 *
 * This exists because the proxy cannot do it. A proxy handler that continues a
 * request with `NextResponse.next()` has its own headers and cookies discarded, and
 * a proxy that returns a Response directly replaces the page with an empty body. A
 * route handler has neither limitation: it can set cookies and still return a normal
 * JSON response.
 *
 * Called by a small client component in the authenticated layouts, so a family that
 * uses the app regularly is never signed out merely because 30 days passed. A
 * session that is genuinely abandoned is left to expire.
 *
 * Always returns 204 and never throws: this is a convenience endpoint, and a failure
 * here must not surface to the user. Worst case the cookie is not extended and they
 * sign in again later.
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    const session = verifySessionToken(token);

    // No session, or it has plenty of life left: nothing to do.
    if (!session || !shouldRenewSession(token)) {
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    }

    const renewed = signSessionToken({
      sub: session.sub,
      role: session.role,
      name: session.name,
    });

    return new Response(null, {
      status: 204,
      headers: {
        "set-cookie": sessionCookieHeader(renewed),
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }
}
