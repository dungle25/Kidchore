/**
 * Removes this family's expired proof photos, object by object.
 *
 * Not a Server Action, and deliberately not marked `"use server"`: it takes a Supabase
 * client, which cannot cross that boundary. It is a server-only helper that
 * `app/actions/task-actions.ts` calls.
 *
 * Called after a parent approves or rejects a chore, from `after()` in
 * `app/actions/task-actions.ts`, so it runs once the response has already gone out: the
 * parent never waits for it, and no scheduler, cron secret or extra environment variable
 * is needed. That is the whole reason for doing it here rather than in a job - a family
 * app on the free plan should not need infrastructure to stay under 1 GB, and cleanup
 * tied to use is cleanup that actually happens.
 *
 * It is idempotent and safe to run twice: the SQL only returns rows whose photo has not
 * been marked deleted, and marking happens only after the object is gone. Every failure is
 * swallowed and logged rather than thrown - this runs after the caller's answer, so there
 * is nobody left to receive an error, and failing to delete a photo must never look like a
 * failed approval.
 *
 * The order matters: delete the object first, then record it. A crash in between leaves a
 * row that still claims to have a photo (and a later run retries it). The reverse order
 * would leave an unreferenced object nobody will ever delete - spending quota forever.
 */
import "server-only";

import { callRpc, type AuthContext } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase-server";
import {
  PROOF_BUCKET,
  PROOF_RETENTION_DAYS,
  proofObjectPath,
} from "@/lib/proof-retention";

export async function purgeExpiredProofs(db: AuthContext["db"]): Promise<void> {
  try {
    const expired = await callRpc<{ instance_id: string; proof_image_url: string }[]>(
      db,
      "expired_proofs_for_my_family",
      { p_days: PROOF_RETENTION_DAYS }
    );

    if (!Array.isArray(expired) || expired.length === 0) return;

    const admin = createAdminClient();
    let removed = 0;

    for (const row of expired) {
      const path = proofObjectPath(row.proof_image_url);
      if (!path) continue;

      const { error } = await admin.storage.from(PROOF_BUCKET).remove([path]);
      // A missing object is not an error worth stopping for: the goal is "no photo is
      // left", and an object that is already gone satisfies it.
      if (error && !/not found/i.test(error.message)) {
        console.warn(`[proof-retention] could not remove ${path}: ${error.message}`);
        continue;
      }

      await callRpc(db, "mark_proof_deleted", { p_instance_id: row.instance_id });
      removed += 1;
    }

    if (removed > 0) {
      console.log(`[proof-retention] removed ${removed} expired proof photo(s)`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[proof-retention] cleanup skipped: ${message}`);
  }
}
