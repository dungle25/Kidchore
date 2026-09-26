import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_TTL_SECONDS } from "./auth-constants";
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

    const claims = JSON.parse(
      Buffer.from(claimsPart, "base64url").toString("utf8")
    ) as {
      sub?: string;
      exp?: number;
      app_role?: string;
      app_name?: string;
    };

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
