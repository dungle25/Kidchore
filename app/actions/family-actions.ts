"use server";

import { revalidatePath } from "next/cache";
import { callRpc, requireRole } from "@/lib/dal";
import { describeDbError } from "@/lib/domain";
import { notifyEvent } from "@/lib/push";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Result of a points adjustment.
 *
 * Split into two branches so a caller cannot read `balance` without having handled the
 * failure, and so a call the database refused can never look like it moved the balance.
 */
export type AdjustPointsResult =
  | { ok: true; balance: number }
  | { ok: false; error: string };

function toResult(error: unknown): { ok: false; error: string } {
  return { ok: false, error: describeDbError(error) };
}

/**
 * Creates a child account.
 *
 * The PIN is passed straight through to the database, where it is hashed with
 * bcrypt before storage. It is never persisted, logged or returned by this layer.
 */
export async function createChild(input: {
  displayName: string;
  username: string;
  pin: string;
}): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");

    const displayName = input.displayName.trim();
    const username = input.username.trim().toLowerCase();

    if (!displayName) return { ok: false, error: "Vui lòng nhập tên của bé." };
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      return {
        ok: false,
        error:
          "Tên đăng nhập cần 3-30 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới.",
      };
    }
    if (!/^[0-9]{4,8}$/.test(input.pin)) {
      return { ok: false, error: "Mã PIN gồm 4 đến 8 chữ số." };
    }

    await callRpc(db, "create_child", {
      p_display_name: displayName,
      p_username: username,
      p_pin: input.pin,
      p_avatar_url: null,
    });

    revalidatePath("/parent/family");
    revalidatePath("/parent/dashboard");
    revalidatePath("/login");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function setChildPin(
  childId: string,
  pin: string
): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");
    if (!/^[0-9]{4,8}$/.test(pin)) {
      return { ok: false, error: "Mã PIN gồm 4 đến 8 chữ số." };
    }
    await callRpc(db, "set_child_pin", { p_child_id: childId, p_pin: pin });
    revalidatePath("/parent/family");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function renameChild(
  childId: string,
  displayName: string
): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");
    if (!displayName.trim()) {
      return { ok: false, error: "Vui lòng nhập tên của bé." };
    }
    await callRpc(db, "rename_child", {
      p_child_id: childId,
      p_display_name: displayName.trim(),
    });
    revalidatePath("/parent/family");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Repairs children who have a PIN but no auth identity, so they cannot sign in.
 *
 * This can only happen for rows created before identities were provisioned
 * automatically. Exposed as an explicit action rather than done silently, so a
 * parent can see that something was wrong and that it has been fixed.
 */
export async function repairChildIdentities(): Promise<
  ActionResult & { fixed?: number }
> {
  try {
    const { db } = await requireRole("PARENT");
    const fixed = await callRpc<number>(db, "repair_child_identities");
    revalidatePath("/parent/family");
    revalidatePath("/login");
    return { ok: true, fixed: Number(fixed ?? 0) };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Adds or removes points by hand.
 *
 * Always recorded as a MANUAL_ADJUSTMENT transaction, so the audit trail stays
 * complete even for corrections.
 *
 * A deduction is never clamped to the remaining balance: since migration 0010 the balance
 * may go negative, so the amount the parent asked for is the amount recorded. This is
 * what makes "phạt nhanh" honest — the child with nothing left to take is still punished,
 * and the punishment leaves a trace instead of being silently dropped.
 *
 * Returns the balance the database ended up with, so a caller showing the child's points
 * displays the authoritative number instead of adding the amount locally. Two parents on
 * two devices can spend the same points, and local arithmetic would then show a balance
 * the child never had.
 */
export async function adjustPoints(input: {
  childId: string;
  amount: number;
  description: string;
}): Promise<AdjustPointsResult> {
  try {
    const ctx = await requireRole("PARENT");
    const { db } = ctx;

    if (!Number.isInteger(input.amount) || input.amount === 0) {
      return { ok: false, error: "Vui lòng nhập số điểm khác 0." };
    }
    if (!input.description.trim()) {
      return { ok: false, error: "Vui lòng ghi lý do điều chỉnh điểm." };
    }

    const balance = await callRpc<number>(db, "adjust_points", {
      p_child_id: input.childId,
      p_amount: input.amount,
      p_description: input.description.trim(),
    });

    // Awaited, not fire-and-forget: a serverless function can be frozen the moment the
    // response is sent, so a floating promise is a notification that never arrives.
    // `notifyEvent` swallows its own failures, so a push service having a bad day
    // cannot turn a successful points change into an error for the parent.
    await notifyEvent(ctx, "POINTS_CHANGED", input.childId, { amount: input.amount });

    revalidatePath("/parent/family");
    revalidatePath("/parent/dashboard");
    revalidatePath("/kid/dashboard");
    return { ok: true, balance: Number(balance) };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Sets which avatar a child shows.
 *
 * The value is a preset key from `lib/avatars.ts`, not an emoji and not a URL. The
 * database validates the shape, so this layer only has to pass it through - and passing
 * it through is all it does, because the alternative (composing a URL here) is how a
 * column that ends up in `<img src>` acquires a value nobody validated.
 *
 * Not written to `point_transactions`: an avatar is not a points change.
 */
export async function setChildAvatar(
  childId: string,
  avatar: string | null
): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");
    await callRpc(db, "set_child_avatar", {
      p_child_id: childId,
      p_avatar: avatar,
    });
    revalidatePath("/parent/family");
    revalidatePath("/kid/dashboard");
    revalidatePath("/login");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Creates an invite code for a second parent.
 *
 * The code comes back in the return value and is **never** available again: the database
 * stores only its hash, so there is no "show me the code I made yesterday". The screen
 * says so, and offers to make another one instead.
 *
 * Full PARENT rights are what the code grants, which is why it is single-use, expires in
 * seven days, and can be revoked.
 */
export async function createInvite(): Promise<
  { ok: true; code: string } | { ok: false; error: string }
> {
  try {
    const { db } = await requireRole("PARENT");
    const code = await callRpc<string>(db, "create_family_invite");
    revalidatePath("/parent/family");
    return { ok: true, code: String(code) };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Revokes an invite that has not been used yet.
 *
 * The database scopes the update to the caller's own family, so passing somebody else's
 * invite id is refused rather than silently revoking a stranger's code.
 */
export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");
    await callRpc(db, "revoke_family_invite", { p_invite_id: inviteId });
    revalidatePath("/parent/family");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}
