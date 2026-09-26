"use server";

import { revalidatePath } from "next/cache";
import { callRpc, requireRole } from "@/lib/dal";
import { describeDbError } from "@/lib/domain";
import { notifyEvent } from "@/lib/push";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toResult(error: unknown): ActionResult {
  return { ok: false, error: describeDbError(error) };
}

/**
 * Child asks to redeem a reward.
 *
 * No child id is accepted: the database takes the child from the session and
 * re-checks the balance, so a tampered request cannot spend points that are not
 * there.
 */
export async function requestReward(rewardId: string): Promise<ActionResult> {
  try {
    const ctx = await requireRole("CHILD");
    // `request_reward` returns the row it inserted, and the notification needs that id
    // as its subject: the database re-reads the request to compose the message, so
    // nothing about the reward is taken from the client.
    const request = await callRpc<{ id: string }>(ctx.db, "request_reward", {
      p_reward_id: rewardId,
    });
    await notifyEvent(ctx, "REWARD_REQUESTED", request.id);
    revalidatePath("/kid/rewards");
    revalidatePath("/parent/dashboard");
    revalidatePath("/parent/rewards");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

/** Parent approves a redemption, deducting points and stock exactly once. */
export async function approveRedemption(
  requestId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireRole("PARENT");
    await callRpc(ctx.db, "approve_redemption", { p_request_id: requestId });
    await notifyEvent(ctx, "REDEMPTION_APPROVED", requestId);
    revalidatePath("/parent/rewards");
    revalidatePath("/parent/dashboard");
    revalidatePath("/kid/dashboard");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function rejectRedemption(
  requestId: string,
  reason: string
): Promise<ActionResult> {
  try {
    const ctx = await requireRole("PARENT");
    await callRpc(ctx.db, "reject_redemption", {
      p_request_id: requestId,
      p_reason: reason,
    });
    await notifyEvent(ctx, "REDEMPTION_REJECTED", requestId);
    revalidatePath("/parent/rewards");
    revalidatePath("/parent/dashboard");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export interface RewardInput {
  id?: string | null;
  title: string;
  description: string | null;
  pointsRequired: number;
  stock: number;
  icon: string | null;
  isActive: boolean;
}

export async function saveReward(input: RewardInput): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");

    if (!input.title.trim()) {
      return { ok: false, error: "Vui lòng nhập tên phần thưởng." };
    }
    if (!Number.isInteger(input.pointsRequired) || input.pointsRequired <= 0) {
      return { ok: false, error: "Số điểm phải là số nguyên lớn hơn 0." };
    }
    // -1 means unlimited; anything else must be zero or positive.
    if (!Number.isInteger(input.stock) || input.stock < -1) {
      return {
        ok: false,
        error: "Số lượng phải là -1 (không giới hạn) hoặc số nguyên không âm.",
      };
    }

    await callRpc(db, "upsert_reward", {
      p_reward_id: input.id ?? null,
      p_title: input.title,
      p_description: input.description,
      p_points_required: input.pointsRequired,
      p_stock: input.stock,
      p_icon: input.icon,
      p_is_active: input.isActive,
    });

    revalidatePath("/parent/rewards");
    revalidatePath("/kid/rewards");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function deleteReward(rewardId: string): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");
    await callRpc(db, "delete_reward", { p_reward_id: rewardId });
    revalidatePath("/parent/rewards");
    revalidatePath("/kid/rewards");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}
