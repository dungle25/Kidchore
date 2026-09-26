import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./auth-constants";
import { getJwtSecret } from "./env";

/**
 * Session token minting and verification.
 *
 * Deliberately free of any Supabase import so that `proxy.ts` - which runs on the
 * network boundary for every request - can verify a session without pulling a
 * database client into its bundle.
 *
 * The token is a JWT signed with the Supabase project's JWT secret. Because the
 * `sub` claim is the user's auth identity, PostgREST accepts the same token and
 * resolves `auth.uid()` to that user, which is what lets the database functions
 * authorize the request. A forged cookie cannot impersonate anyone, because the
 * HMAC signature is the only thing that makes it valid.
 */

export interface SessionPayload {
  /** The auth identity (public.users.auth_user_id), i.e. the JWT `sub`. */
  sub: string;
  role: "PARENT" | "CHILD";
  /** Display only; never used for authorization. */
  name: string;
}

const ISSUER = "supabase";
const AUDIENCE = "authenticated";

interface SessionClaims {
  sub?: string;
  exp?: number;
  app_role?: string;
  app_name?: string;
}

/**
 * Decodes the claims part of a token WITHOUT verifying it.
 *
 * Only for callers that have already established the signature is good, or that only
 * need a value they are about to fail closed on anyway. Exported functions verify
 * first; keeping the decode in one place means the "split into three parts" rule
 * cannot be got wrong in one place and right in another.
 */
function decodeClaims(token: string): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as SessionClaims;
  } catch {
    return null;
  }
}

/**
 * Renew a session once fewer than this many seconds remain. Seven days means a
 * family that opens the app even once a week stays signed in indefinitely, while a
 * session that is genuinely abandoned still expires.
 */
export const RENEWAL_THRESHOLD_SECONDS = 60 * 60 * 24 * 7;

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export function signSessionToken(payload: SessionPayload): string {
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${base64UrlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  )}.${base64UrlEncode(
    JSON.stringify({
      iss: ISSUER,
      sub: payload.sub,
      aud: AUDIENCE,
      role: "authenticated",
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
      app_role: payload.role,
      app_name: payload.name,
    })
  )}`;

  const signature = createHmac("sha256", getJwtSecret())
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

/**
 * Verifies a session token. Returns null for anything malformed, tampered with or
 * expired, so callers only ever deal with a trustworthy payload.
 *
 * The MAC is compared in constant time so a wrong signature cannot be discovered
 * byte by byte.
 */
export function verifySessionToken(
  token: string | undefined
): SessionPayload | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerPart, claimsPart, signaturePart] = parts;

  try {
    const expected = createHmac("sha256", getJwtSecret())
      .update(`${headerPart}.${claimsPart}`)
      .digest();

    const provided = Buffer.from(signaturePart, "base64url");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return null;
    }

    const claims = decodeClaims(token);
    if (!claims) return null;

    if (!claims.sub || !claims.exp) return null;
    if (claims.exp * 1000 < Date.now()) return null;
    if (claims.app_role !== "PARENT" && claims.app_role !== "CHILD") return null;

    return {
      sub: claims.sub,
      role: claims.app_role,
      name: claims.app_name ?? "",
    };
  } catch {
    return null;
  }
}

/** Cookie options shared by every place a session cookie is written. */
export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/**
 * The same cookie as a `Set-Cookie` header value.
 *
 * Route handlers that build a Response by hand cannot use the `cookies()` helper, so
 * they need the serialized form. Deriving it from `sessionCookieOptions` keeps the
 * two representations from drifting apart.
 */
export function sessionCookieHeader(token: string, maxAge = SESSION_TTL_SECONDS): string {
  const options = sessionCookieOptions(maxAge);
  return [
    `${SESSION_COOKIE}=${token}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    options.httpOnly ? "HttpOnly" : "",
    `SameSite=${options.sameSite === "lax" ? "Lax" : options.sameSite}`,
    options.secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Clears the session cookie. */
export function clearedSessionCookieHeader(): string {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * How long until the token expires, in seconds. Negative when already expired.
 *
 * Used to decide whether a session should be extended. Returned separately from
 * `verifySessionToken` so the common path (a token with plenty of life left) does not
 * pay for parsing the claims twice.
 */
export function sessionSecondsRemaining(token: string | undefined): number {
  if (!token) return -1;
  const payload = verifySessionToken(token);
  if (!payload) return -1;

  const claims = decodeClaims(token);
  if (!claims?.exp) return -1;
  return claims.exp - Math.floor(Date.now() / 1000);
}

/**
 * Renew a session once it is close to expiring, so a family that uses the app
 * regularly is never logged out.
 *
 * Without this, a 30-day cookie expires on day 30 regardless of activity: a child
 * would be asked for their PIN again and a parent would have to sign in with
 * Google, purely because time passed. Renewing on activity turns the fixed window
 * into a sliding one.
 *
 * Only tokens that are still valid are renewed; an expired token is left alone so
 * the request is redirected to sign-in instead of being silently resurrected.
 */
export function shouldRenewSession(token: string | undefined): boolean {
  const remaining = sessionSecondsRemaining(token);
  return remaining > 0 && remaining < RENEWAL_THRESHOLD_SECONDS;
}
