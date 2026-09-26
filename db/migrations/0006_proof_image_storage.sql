-- =============================================================================
-- KidChore — Migration 0006: storage bucket for proof-of-work photos
-- =============================================================================
-- The SRS requires children to attach a photo as proof for some chores, and
-- task_instances.proof_image_url already exists to hold it. What was missing is
-- somewhere to put the file.
--
-- DESIGN
--   Uploads go through a Server Action using the service-role client, then this
--   bucket stores the result. That is why NO storage policy is created here:
--   `storage.objects` has RLS enabled and zero policies, so the publishable key
--   cannot read or write a single object. All access is mediated by the server,
--   which validates the caller's identity, the file's type and its size first.
--
--   The bucket is public so the parent's approval screen can render the image with a
--   plain <img src>. For a family app that is the right trade-off: the object path
--   contains a random UUID, so a URL is not guessable, but it is not secret either.
--   If that ever needs to change, switch to a private bucket and serve short-lived
--   signed URLs from a Server Action.
-- =============================================================================

-- Bounded size at the bucket level as a second line of defence. The Server Action
-- rejects anything larger before it gets here, and client-side compression normally
-- brings a phone photo well under this.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proof-images',
  'proof-images',
  true,
  2097152, -- 2 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage policy is created, and none is required: with RLS enabled and zero
-- policies, `anon` and `authenticated` are denied by default. Deliberately no
-- `revoke` is issued either, because Storage's own API runs as one of those roles
-- and revoking table privileges would break it for the service-role path too.

notify pgrst, 'reload schema';
