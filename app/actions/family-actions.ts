"use server";

import { revalidatePath } from "next/cache";
import { callRpc, requireRole } from "@/lib/dal";
import { describeDbError } from "@/lib/domain";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toResult(error: unknown): ActionResult {
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
 * Adds or removes points by hand.
 *
 * Always recorded as a MANUAL_ADJUSTMENT transaction, so the audit trail stays
 * complete even for corrections.
 *
 * Returns the balance the database ended up with, so a caller showing the child's
 * points displays the authoritative number instead of adding the amount locally.
 * Two parents on two devices can spend the same points, and local arithmetic would
 * then show a balance the child never had.
 */
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

export async function adjustPoints(input: {
  childId: string;
  amount: number;
  description: string;
}): Promise<ActionResult & { balance?: number }> {
  try {
    const { db } = await requireRole("PARENT");

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

    revalidatePath("/parent/family");
    revalidatePath("/parent/dashboard");
    revalidatePath("/kid/dashboard");
    return { ok: true, balance: Number(balance) };
  } catch (error) {
    return toResult(error);
  }
}
