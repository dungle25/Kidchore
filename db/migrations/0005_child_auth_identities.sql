-- =============================================================================
-- KidChore — Migration 0005: make child accounts able to sign in
-- =============================================================================
-- `create_child` only inserts a profile row. Children sign in with a PIN, and the
-- signed session token's `sub` must be an auth identity, so the profile also needs
-- `auth_user_id` populated against `auth.users`.
--
-- This creates that auth identity inside Postgres using Supabase's own auth helper
-- functions, then links it. Doing it here rather than through the GoTrue admin API
-- keeps the whole operation in one transaction: either the auth account, the
-- profile and the PIN hash all exist, or none of them do.
--
-- A synthetic, non-routable email is used because GoTrue requires one. It is never
-- emailed and never shown; the child signs in with username + PIN.
-- =============================================================================

-- Records whether a child can actually sign in, so the UI never claims an account
-- works when it cannot.
create or replace function public.parent_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users;
begin
  select * into v_parent from public.current_app_user();
  if v_parent.id is null or v_parent.role <> 'PARENT' then
    raise exception 'PARENT_ROLE_REQUIRED' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'family', jsonb_build_object(
      'id', v_parent.family_id,
      'family_name', (select family_name from public.families where id = v_parent.family_id)
    ),
    'parent', jsonb_build_object(
      'id', v_parent.id,
      'display_name', v_parent.display_name,
      'email', v_parent.email
    ),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'display_name', u.display_name,
        'username', u.username,
        'avatar_url', u.avatar_url,
        'points_balance', u.points_balance,
        'pin_set', (u.pin_code is not null),
        'can_sign_in', (u.pin_code is not null and u.auth_user_id is not null),
        'pending_review', (
          select count(*) from public.task_instances ti
          where ti.assigned_child_id = u.id and ti.status = 'SUBMITTED'
        ),
        'approved_total', (
          select count(*) from public.task_instances ti
          where ti.assigned_child_id = u.id and ti.status = 'APPROVED'
        )
      ) order by u.display_name)
      from public.users u
      where u.family_id = v_parent.family_id and u.role = 'CHILD'
    ), '[]'::jsonb),
    'pending_approvals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ti.id,
        'status', ti.status,
        'due_date', ti.due_date,
        'completed_at', ti.completed_at,
        'proof_image_url', ti.proof_image_url,
        'task_title', t.title,
        'task_description', t.description,
        'points_reward', t.points_reward,
        'require_proof_image', t.require_proof_image,
        'child_id', c.id,
        'child_name', c.display_name
      ) order by ti.completed_at nulls last)
      from public.task_instances ti
      join public.tasks t on t.id = ti.task_id
      join public.users c on c.id = ti.assigned_child_id
      where t.family_id = v_parent.family_id and ti.status = 'SUBMITTED'
    ), '[]'::jsonb),
    'pending_redemptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rr.id,
        'status', rr.status,
        'points_spent', rr.points_spent,
        'requested_at', rr.requested_at,
        'reward_title', r.title,
        'reward_description', r.description,
        'reward_icon', r.icon,
        'child_id', c.id,
        'child_name', c.display_name,
        'child_balance', c.points_balance
      ) order by rr.requested_at)
      from public.redemption_requests rr
      join public.rewards r on r.id = rr.reward_id
      join public.users c on c.id = rr.child_id
      where c.family_id = v_parent.family_id and rr.status = 'REQUESTED'
    ), '[]'::jsonb),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'description', r.description,
        'points_required', r.points_required,
        'icon', r.icon,
        'stock', r.stock,
        'is_active', r.is_active
      ) order by r.points_required)
      from public.rewards r
      where r.family_id = v_parent.family_id
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'description', t.description,
        'points_reward', t.points_reward,
        'recurrence', t.recurrence,
        'require_proof_image', t.require_proof_image,
        'assigned_to_user_id', t.assigned_to_user_id,
        'assigned_to_name', (select display_name from public.users where id = t.assigned_to_user_id),
        'category_id', t.category_id,
        'created_at', t.created_at
      ) order by t.created_at desc)
      from public.tasks t
      where t.family_id = v_parent.family_id
    ), '[]'::jsonb),
    'recent_activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pt.id,
        'amount', pt.amount,
        'type', pt.type,
        'description', pt.description,
        'created_at', pt.created_at,
        'child_name', (select display_name from public.users where id = pt.user_id)
      ) order by pt.created_at desc)
      from (
        select pt.* from public.point_transactions pt
        join public.users u on u.id = pt.user_id
        where u.family_id = v_parent.family_id
        order by pt.created_at desc
        limit 20
      ) pt
    ), '[]'::jsonb),
    'points_awarded_30d', coalesce((
      select sum(pt.amount) from public.point_transactions pt
      join public.users u on u.id = pt.user_id
      where u.family_id = v_parent.family_id
        and pt.amount > 0
        and pt.created_at > now() - interval '30 days'
    ), 0)
  );
end;
$fn$;

revoke all on function public.parent_overview() from public, anon, authenticated;
grant execute on function public.parent_overview() to authenticated;

-- Creates the auth identity for a child that does not have one yet, and links it.
-- Safe to call repeatedly: a child that is already linked is returned untouched.
create or replace function public.ensure_child_auth_identity(p_child_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_child public.users;
  v_new_id uuid;
  v_email text;
begin
  select * into v_child
  from public.users
  where id = p_child_id and family_id = v_parent.family_id and role = 'CHILD';

  if v_child.id is null then
    raise exception 'CHILD_NOT_FOUND' using errcode = '42501';
  end if;

  if v_child.auth_user_id is not null then
    return v_child.auth_user_id;
  end if;

  -- Deterministic and non-routable, so it can never collide with a real address.
  v_email := v_child.id::text || '@kidchore.local';
  v_new_id := gen_random_uuid();

  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    v_new_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 10)),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('kidchore_child', true),
    now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  values (
    gen_random_uuid(),
    v_new_id,
    v_new_id::text,
    jsonb_build_object('sub', v_new_id::text, 'email', v_email, 'email_verified', true),
    'email',
    now(), now(), now()
  );

  update public.users
  set auth_user_id = v_new_id
  where id = v_child.id;

  return v_new_id;
end;
$fn$;

revoke all on function public.ensure_child_auth_identity(uuid) from public, anon, authenticated;
grant execute on function public.ensure_child_auth_identity(uuid) to authenticated;

-- create_child now also provisions the auth identity, so a newly created child can
-- sign in immediately without a second step.
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

  insert into public.users (family_id, role, display_name, username, pin_code, avatar_url)
  values (
    v_parent.family_id,
    'CHILD',
    trim(p_display_name),
    lower(trim(p_username)),
    public.hash_pin(p_pin),
    p_avatar_url
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

-- Repairs any child that already existed before this migration, and any whose PIN
-- is set but who has no identity. Returns how many were fixed.
create or replace function public.repair_child_identities()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_child record;
  v_fixed int := 0;
begin
  for v_child in
    select id from public.users
    where family_id = v_parent.family_id
      and role = 'CHILD'
      and auth_user_id is null
  loop
    perform public.ensure_child_auth_identity(v_child.id);
    v_fixed := v_fixed + 1;
  end loop;

  return v_fixed;
end;
$fn$;

revoke all on function public.repair_child_identities() from public, anon, authenticated;
grant execute on function public.repair_child_identities() to authenticated;

notify pgrst, 'reload schema';
