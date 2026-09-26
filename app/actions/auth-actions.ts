"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { describeDbError, type ChildProfile } from "@/lib/domain";
import { SESSION_COOKIE, GOOGLE_COOKIE } from "@/lib/auth-constants";
import { sessionCookieOptions, signSessionToken } from "@/lib/session";
import { createAdminClient, createAnonClient, createUserClient } from "@/lib/supabase-server";

export interface ActionState {
  error?: string;
  success?: string;
}

/**
 * Lists the child profiles shown as tappable avatars on the sign-in screen.
 *
 * Exposed to signed-out visitors on purpose, which is why the database function
 * behind it returns display data only and never a PIN hash.
 */
export async function listChildProfiles(): Promise<ChildProfile[]> {
  // Anon, not service role: `list_child_profiles` is granted to `anon` precisely
  // because this screen runs before anyone has signed in, and it returns no PIN hash.
  const anon = createAnonClient();
  const { data, error } = await anon.rpc("list_child_profiles");
  if (error) return [];
  return (data ?? []) as ChildProfile[];
}

/**
 * Signs a child in with their PIN.
 *
 * The PIN is verified with bcrypt inside Postgres and the auth identity is
 * resolved in the same database call, so neither the PIN hash nor the identity
 * ever travels to the browser. Only a successful verification yields a session.
 */
export async function signInWithPin(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const username = String(formData.get("username") ?? "").trim();
  const pin = String(formData.get("pin") ?? "").trim();

  if (!username) return { error: "Vui lòng chọn tên của bé." };
  if (!/^[0-9]{4,8}$/.test(pin)) return { error: "Mã PIN gồm 4 đến 8 chữ số." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("child_login_subject", {
    p_username: username,
    p_pin: pin,
  });

  if (error) return { error: describeDbError(error) };
  if (!data) return { error: "Mã PIN không đúng. Bé thử lại nhé." };

  const resolved = data as { subject: string; display_name: string };

  const token = signSessionToken({
    sub: resolved.subject,
    role: "CHILD",
    name: resolved.display_name,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
  redirect("/kid/dashboard");
}

/**
 * Creates a family for a signed-in Google user who has no household yet.
 *
 * The database function is idempotent and also adopts an existing parent row with
 * the same verified email, so signing in again never forks the family.
 */
export async function completeOnboarding(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const familyName = String(formData.get("familyName") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();

  if (!familyName) return { error: "Vui lòng nhập tên gia đình." };
  if (!displayName) return { error: "Vui lòng nhập tên của bạn." };

  const cookieStore = await cookies();
  const googleToken = cookieStore.get(GOOGLE_COOKIE)?.value;
  if (!googleToken) {
    return { error: "Phiên đăng nhập Google đã hết hạn. Vui lòng đăng nhập lại." };
  }

  // Runs as the Google user, so auth.uid() inside the function is that identity.
  const db = createUserClient(googleToken);
  const { data, error } = await db.rpc("bootstrap_parent", {
    p_display_name: displayName,
    p_family_name: familyName,
  });

  if (error) return { error: describeDbError(error) };

  const parent = data as { id: string; display_name: string };
  const { data: subject } = await db.rpc("auth_subject_for_user", {
    p_user_id: parent.id,
  });

  if (!subject) {
    return { error: "Không thể hoàn tất thiết lập. Vui lòng thử lại." };
  }

  const token = signSessionToken({
    sub: subject as string,
    role: "PARENT",
    name: parent.display_name,
  });

  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
  cookieStore.delete(GOOGLE_COOKIE);
  redirect("/parent/dashboard");
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(GOOGLE_COOKIE);
  redirect("/login");
}
