-- =============================================================================
-- KidChore — Migration 0008: sibling list for quick profile switching
-- =============================================================================
-- A family tablet is shared, so a child needs to move between profiles quickly. The
-- switch still requires the PIN: this function only lists who is available, it does not
-- authenticate anyone.
--
-- Only the caller's siblings are returned, never another household's children, and only
-- display data - never a PIN hash or a points balance. A child learning that their
-- sibling exists is harmless; a child reading their sibling's balance or hash is not.
-- =============================================================================

create or replace function public.kid_siblings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_child public.users;
begin
  select * into v_child from public.current_app_user();
  if v_child.id is null or v_child.role <> 'CHILD' then
    raise exception 'CHILD_ROLE_REQUIRED' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'username', u.username,
      'display_name', u.display_name,
      'avatar_url', u.avatar_url,
      'is_me', (u.id = v_child.id)
    ) order by u.display_name)
    from public.users u
    where u.family_id = v_child.family_id
      and u.role = 'CHILD'
      and u.username is not null
      and u.pin_code is not null
  ), '[]'::jsonb);
end;
$fn$;

revoke all on function public.kid_siblings() from public, anon, authenticated;
grant execute on function public.kid_siblings() to authenticated;

notify pgrst, 'reload schema';
