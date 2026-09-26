"use server";

import { revalidatePath } from "next/cache";
import { callRpc, requireAuth, requireRole } from "@/lib/dal";
import { describeDbError, type Recurrence } from "@/lib/domain";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toResult(error: unknown): ActionResult {
  return { ok: false, error: describeDbError(error) };
}

/**
 * Child submits a completed chore.
 *
 * Note there is no child id parameter: the database derives the child from the
 * session, so one child cannot submit another's task even by tampering with the
 * request.
 */
export async function submitTask(
  instanceId: string,
  proofImageUrl?: string | null
): Promise<ActionResult> {
  try {
    const { db } = await requireRole("CHILD");
    await callRpc(db, "submit_task_instance", {
      p_instance_id: instanceId,
      p_proof_image_url: proofImageUrl ?? null,
    });
    revalidatePath("/kid/dashboard");
    revalidatePath("/kid/tasks");
    revalidatePath("/parent/dashboard");
    revalidatePath("/parent/chores");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

/** Parent approves a submission and awards points exactly once. */
export async function approveTask(instanceId: string): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");
    await callRpc(db, "approve_task_instance", { p_instance_id: instanceId });
    revalidatePath("/parent/dashboard");
    revalidatePath("/parent/chores");
    revalidatePath("/kid/dashboard");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function rejectTask(
  instanceId: string,
  reason: string
): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");
    await callRpc(db, "reject_task_instance", {
      p_instance_id: instanceId,
      p_reason: reason,
    });
    revalidatePath("/parent/dashboard");
    revalidatePath("/parent/chores");
    revalidatePath("/kid/dashboard");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export interface TaskInput {
  id?: string | null;
  title: string;
  description: string | null;
  pointsReward: number;
  recurrence: Recurrence;
  requireProofImage: boolean;
  assignedToUserId: string | null;
}

/** Creates or updates a chore definition. */
export async function saveTask(input: TaskInput): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");

    if (!input.title.trim()) return { ok: false, error: "Vui lòng nhập tên việc." };
    if (!Number.isInteger(input.pointsReward) || input.pointsReward <= 0) {
      return { ok: false, error: "Số điểm phải là số nguyên lớn hơn 0." };
    }

    if (input.id) {
      await callRpc(db, "update_task", {
        p_task_id: input.id,
        p_title: input.title,
        p_description: input.description,
        p_points_reward: input.pointsReward,
        p_recurrence: input.recurrence,
        p_require_proof_image: input.requireProofImage,
        p_assigned_to_user_id: input.assignedToUserId,
        p_category_id: null,
      });
    } else {
      await callRpc(db, "create_task", {
        p_title: input.title,
        p_description: input.description,
        p_points_reward: input.pointsReward,
        p_recurrence: input.recurrence,
        p_require_proof_image: input.requireProofImage,
        p_assigned_to_user_id: input.assignedToUserId,
        p_category_id: null,
      });
    }

    revalidatePath("/parent/tasks");
    revalidatePath("/parent/dashboard");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  try {
    const { db } = await requireRole("PARENT");
    await callRpc(db, "delete_task", { p_task_id: taskId });
    revalidatePath("/parent/tasks");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

/** Generates today's task instances. Idempotent, so it is safe to call often. */
export async function generateToday(): Promise<ActionResult & { created?: number }> {
  try {
    const { db } = await requireRole("PARENT");
    const created = await callRpc<number>(db, "generate_task_instances", {
      p_date: new Date().toISOString().slice(0, 10),
    });
    revalidatePath("/parent/dashboard");
    revalidatePath("/kid/dashboard");
    return { ok: true, created: Number(created ?? 0) };
  } catch (error) {
    return toResult(error);
  }
}

/** Reads the parent view model. Used by pages; kept here to share one code path. */
export async function fetchParentOverview() {
  const { db } = await requireRole("PARENT");
  return callRpc(db, "parent_overview");
}

/** Reads the child view model. */
export async function fetchKidDashboard() {
  const auth = await requireAuth();
  return callRpc(auth.db, "kid_dashboard");
}
