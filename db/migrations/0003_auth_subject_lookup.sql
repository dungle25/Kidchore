-- =============================================================================
-- KidChore — Migration 0003: identity lookup for session minting
-- =============================================================================
-- The sign-in actions must mint a session token whose `sub` is the user's
-- *auth* identity (public.users.auth_user_id), because that is what PostgREST
-- resolves auth.uid() to.
--
-- The first version of the app read that column straight from the users table
-- with the service-role client. With RLS enabled and privileges revoked, that read
-- is denied, and relying on the service-role key to read a table would have
-- bypassed every policy for the most security-sensitive lookup in the app.
--
-- These functions expose exactly one value - the auth subject - and nothing else.
-- =============================================================================

-- Returns the auth subject (auth_user_id) for a public user id, or NULL when the
-- account is not linked. Deliberately returns a bare uuid rather than a row, so it
-- cannot be used to enumerate anything else about the user.
create or replace function public.auth_subject_for_user(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select u.auth_user_id
  from public.users u
  where u.id = p_user_id
  limit 1;
$fn$;

-- Resolves everything the sign-in action needs in a single round trip: the auth
-- subject to put in the token, plus the display name for the greeting. Returns
-- NULL unless the username and PIN are both correct, because it re-verifies them
-- through child_login_verify.
create or replace function public.child_login_subject(p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_identity jsonb;
  v_row record;
begin
  v_identity := public.child_login_verify(p_username, p_pin);
  if v_identity is null then
    return null;
  end if;

  select u.auth_user_id, u.display_name, u.id
  into v_row
  from public.users u
  where u.id = (v_identity ->> 'id')::uuid;

  if v_row.auth_user_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'subject', v_row.auth_user_id,
    'user_id', v_row.id,
    'display_name', v_row.display_name
  );
end;
$fn$;

-- auth_subject_for_user is granted only to authenticated, since onboarding calls it
-- with the Google session token.
--
-- child_login_subject is intentionally granted to NO client role. It is reachable
-- only by the service-role key from the server-side sign-in action, because it
-- returns an auth identity and must never be callable straight from a browser.
revoke all on function public.auth_subject_for_user(uuid) from public, anon;
revoke all on function public.child_login_subject(text, text) from public, anon, authenticated;
grant execute on function public.auth_subject_for_user(uuid) to authenticated;

notify pgrst, 'reload schema';
