/**
 * The parts of proof-photo retention that are pure logic.
 *
 * The *rule* for what has expired is in SQL, in one place
 * (`public.expired_proof_instances`, migration 0014), because two copies of it - one in
 * SQL for the cleanup script, one in JavaScript for the app - is exactly how a photo ends
 * up deleted while a parent is still looking at it. What lives here is only what SQL
 * cannot express: turning a stored public URL back into the object path the Storage API
 * needs in order to delete it.
 *
 * No React and no `next/*` imports, so `scripts/test-proof-retention.mjs` can exercise it
 * directly.
 */

/** The bucket proof photos live in. */
export const PROOF_BUCKET = "proof-images";

/**
 * How long a decided chore keeps its photo.
 *
 * The quota is the reason: Storage on the free plan is 1 GB and cannot be raised, so a
 * photo that nobody will look at again is spending the family's whole budget. 30 days
 * covers "did my child really do this last week" and the monthly review a parent does,
 * without keeping years of images nobody opens.
 */
export const PROOF_RETENTION_DAYS = 30;

/**
 * The object path inside the bucket, from a public URL the app stored.
 *
 * `uploadProofImage` saves the public URL on the row, so the path has to be recovered from
 * it before the object can be removed. Returns `null` for anything that is not a public URL
 * of this bucket - a malformed value, another bucket, an external URL - because deleting
 * the wrong object or failing the whole purge over one bad row are both worse than leaving
 * that row alone.
 *
 * The path is percent-decoded: the URL is built with `encodeURIComponent`, and an object
 * path containing a slash-separated uuid is unaffected, but a family id or file name that
 * ever needed escaping must not be looked up in its encoded form.
 */
export function proofObjectPath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;

  // Match the shape the bucket serves, and nothing looser: this string decides which
  // object gets deleted.
  const marker = `/storage/v1/object/public/${PROOF_BUCKET}/`;
  const index = String(publicUrl).indexOf(marker);
  if (index === -1) return null;

  const encoded = String(publicUrl).slice(index + marker.length).split("?")[0].split("#")[0];
  if (!encoded) return null;

  try {
    return decodeURIComponent(encoded);
  } catch {
    // A malformed percent-escape: treat it as "not a path I understand".
    return null;
  }
}

/**
 * Whether a chore still has a photo the child can look at.
 *
 * Used by the UI and by the resubmit guard. A row keeps its `proof_image_url` after the
 * object is deleted, on purpose, so "has a URL" is no longer the same question as "has a
 * photo".
 */
export function hasLiveProof(instance: {
  proof_image_url?: string | null;
  proof_deleted_at?: string | null;
}): boolean {
  return Boolean(instance.proof_image_url) && !instance.proof_deleted_at;
}
