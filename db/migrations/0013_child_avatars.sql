-- =============================================================================
-- KidChore — Migration 0013: a child's avatar
-- =============================================================================
-- `users.avatar_url` has existed since the first migration, `create_child` already takes
-- `p_avatar_url`, and two screens already render it. What was missing is any way to SET
-- it after the fact, so no child in this family has ever had one.
--
-- WHY THE VALUE IS A KEY, NOT A URL
--   The avatars are emoji, picked from a list in lib/avatars.ts. Storing the emoji itself
--   would work, but storing the key means the artwork can change without touching rows,
--   and it gives the database something it can actually validate.
--
--   That validation is the point of this function. `users.avatar_url` is `text` with no
--   constraint, so without a check here a parent could write anything into a column that
--   ends up in an `<img src>`. The allowed shape is a short lower-case key; an https URL,
--   a `javascript:` string and a data URI all fail it. When a later migration adds real
--   photo uploads, that is the moment to widen this deliberately - lib/avatars.ts already
--   understands an https URL in the same column, so the UI would keep working.
-- =============================================================================

create or replace function public.set_child_avatar(
  p_child_id uuid,
  p_avatar text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_avatar text := nullif(trim(coalesce(p_avatar, '')), '');
  v_updated uuid;
begin
  if v_avatar is not null and v_avatar !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'INVALID_AVATAR' using errcode = '22023';
  end if;

  -- The family filter is the whole authorization: without it a parent could set the
  -- avatar of a child in somebody else's household by guessing a uuid.
  update public.users
  set avatar_url = v_avatar
  where id = p_child_id
    and family_id = v_parent.family_id
    and role = 'CHILD'
  returning id into v_updated;

  if v_updated is null then
    raise exception 'CHILD_NOT_FOUND' using errcode = '42501';
  end if;

  -- Deliberately NOT writing to point_transactions. An avatar is not a points change, and
  -- a child's ledger is for points; cosmetics in it would make the one record a parent
  -- trusts harder to read.
end;
$fn$;

-- The path that already existed gets the same rule. This is migration 0005's definition
-- with the avatar check added and nothing else touched: it re-reads the row after
-- provisioning the identity (because that call sets auth_user_id) and maps a duplicate
-- username through `unique_violation`, and both of those are load-bearing.
create or replace function public.create_child(
  p_display_name text,
  p_username text,
  p_pin text,
  p_avatar_url text default null
)
returns public.users
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_child public.users;
  v_avatar text := nullif(trim(coalesce(p_avatar_url, '')), '');
begin
  if coalesce(trim(p_username), '') = '' then
    raise exception 'USERNAME_REQUIRED' using errcode = '22023';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'DISPLAY_NAME_REQUIRED' using errcode = '22023';
  end if;
  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN_MUST_BE_4_TO_8_DIGITS' using errcode = '22023';
  end if;
  if v_avatar is not null and v_avatar !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'INVALID_AVATAR' using errcode = '22023';
  end if;

  insert into public.users (family_id, role, display_name, username, pin_code, avatar_url)
  values (
    v_parent.family_id,
    'CHILD',
    trim(p_display_name),
    lower(trim(p_username)),
    public.hash_pin(p_pin),
    v_avatar
  )
  returning * into v_child;

  -- Provision the sign-in identity in the same transaction.
  perform public.ensure_child_auth_identity(v_child.id);

  select * into v_child from public.users where id = v_child.id;
  return v_child;
exception
  when unique_violation then
    raise exception 'USERNAME_TAKEN' using errcode = '23505';
end;
$fn$;

revoke all on function public.set_child_avatar(uuid, text) from public, anon, authenticated;
revoke all on function public.create_child(text, text, text, text) from public, anon, authenticated;

grant execute on function public.set_child_avatar(uuid, text) to authenticated;
grant execute on function public.create_child(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
