import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "./domain";
import { SESSION_COOKIE } from "./auth-constants";
import { verifySessionToken, type SessionPayload } from "./session";
import { createUserClient } from "./supabase-server";

/**
 * Data Access Layer.
 *
 * Every server-side read and write goes through here, which is what makes the
 * authorization story auditable: the caller's identity always comes from the
 * signed cookie, never from a request parameter.
 *
 * The returned Supabase client carries the session JWT, so PostgREST resolves
 * `auth.uid()` to the real user and the SECURITY DEFINER functions in
 * db/migrations can authorize correctly. The publishable key is used only in the
 * `apikey` header, which identifies the project and grants no data access.
 */

export interface AuthContext {
  token: string;
  session: SessionPayload;
  db: ReturnType<typeof createUserClient>;
}

/** Returns the current session, or null when signed out. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);
  if (!session || !token) return null;
  return { token, session, db: createUserClient(token) };
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("NOT_AUTHENTICATED");
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
  }
}

/**
 * Requires a signed-in user. Use inside Server Actions, where throwing produces a
 * typed error the action can turn into a message rather than a redirect.
 */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new NotAuthenticatedError();
  return ctx;
}

/** Requires a signed-in user with a specific role. */
export async function requireRole(role: UserRole): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (ctx.session.role !== role) throw new ForbiddenError();
  return ctx;
}

/**
 * Page-level guards. These redirect instead of throwing, because a page that
 * throws for a signed-out visitor shows an error screen where a login redirect
 * is what the person actually needs.
 */
export async function requireParentPage(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (ctx.session.role !== "PARENT") redirect("/kid/dashboard");
  return ctx;
}

export async function requireChildPage(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (ctx.session.role !== "CHILD") redirect("/parent/dashboard");
  return ctx;
}

/**
 * Calls a database function as the current user.
 *
 * Supabase returns errors in the payload rather than throwing, so normalizing
 * here means every caller gets a real exception instead of silently reading
 * `data` as null.
 */
export async function callRpc<T>(
  db: AuthContext["db"],
  fn: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
