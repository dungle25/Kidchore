"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { callRpc, requireAuth, requireRole } from "@/lib/dal";
import { describeDbError, type Recurrence } from "@/lib/domain";
import { createAdminClient } from "@/lib/supabase-server";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Bucket holding proof-of-work photos. Created in migration 0006. */
const PROOF_BUCKET = "proof-images";

/** Must stay in step with the bucket's own limits in migration 0006. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function toResult(error: unknown): ActionResult {
  return { ok: false, error: describeDbError(error) };
}

/**
 * Stores a proof photo and returns its public URL.
 *
 * The server re-checks the type and size rather than trusting the browser: anything
 * reaching a Server Action is attacker-controlled, and the bucket's limits are a
 * backstop rather than the first line of defence.
 *
 * The object path starts with the caller's family id, so a child cannot choose a path
 * and two households can never collide. A random name is appended so an object cannot
 * be guessed from a task id.
 *
 * Uploads use the service-role client because `storage.objects` has RLS enabled with
 * no policies, which is what keeps the publishable key away from Storage.
 */
export async function uploadProofImage(
  formData: FormData
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    // A child submits proof, so the caller must be a child. Parents never upload on a
    // child's behalf, which keeps authorship of the evidence unambiguous.
    const { db, session } = await requireRole("CHILD");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Chưa chọn ảnh." };
    }
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      return { ok: false, error: "Chỉ nhận ảnh JPG, PNG hoặc WEBP." };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        error: `Ảnh quá lớn (${Math.round(file.size / 1024 / 1024)}MB). Vui lòng chọn ảnh nhỏ hơn 2MB.`,
      };
    }

    // Read the family from the database rather than decoding the token, so the path
    // always reflects what the database currently believes.
    const me = await callRpc<{ family_id?: string } | null>(db, "current_app_user");
    const familyId = me?.family_id;
    if (!familyId) return { ok: false, error: "Không xác định được gia đình." };

    const extension = EXTENSION_BY_TYPE[file.type] ?? "jpg";
    const objectPath = `${familyId}/${session.sub}/${randomUUID()}.${extension}`;

    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage
      .from(PROOF_BUCKET)
      .upload(objectPath, file, {
        contentType: file.type,
        upsert: false,
        cacheControl: "3600",
      });

    if (uploadError) {
      return { ok: false, error: `Không tải ảnh lên được: ${uploadError.message}` };
    }

    const { data } = admin.storage.from(PROOF_BUCKET).getPublicUrl(objectPath);
    return { ok: true, url: data.publicUrl };
  } catch (error) {
    return { ok: false, error: describeDbError(error) };
  }
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
