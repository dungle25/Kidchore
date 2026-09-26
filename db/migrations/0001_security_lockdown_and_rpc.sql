-- =============================================================================
-- KidChore — Migration 0001: security lockdown + auth bridge + RPC layer
-- =============================================================================
-- This migration is IDEMPOTENT: it is safe to run repeatedly.
--
-- WHAT IT FIXES
--   1. CRITICAL: RLS was disabled on all 8 tables. The publishable key could
--      read, write and DELETE every row in the database. This migration enables
--      RLS with a default-deny posture (no permissive policies) so the
--      publishable key can no longer touch tables directly.
--   2. Adds users.auth_user_id to link a Supabase Auth (Google) identity to a
--      parent row.
--   3. Replaces the four broken functions in db/procedures.sql. Those used `$`
--      instead of `$$` for PL/pgSQL dollar-quoting and could never be created.
--   4. Adds the whole read/write RPC layer the app needs, with authorization,
--      idempotency and balance validation built in.
--
-- ARCHITECTURE
--   Direct table access is DENIED to anon + authenticated. Every read and write
--   goes through a SECURITY DEFINER function below, which:
--     - derives the caller from auth.uid() (verified JWT `sub` claim), and
--     - resolves that identity to a public.users row in the caller's family.
--   Authorization therefore lives in one auditable place and cannot be bypassed
--   by a client that merely sends a different child_id.
--
-- APPLY WITH: supabase SQL editor, or `psql "$DATABASE_URL" -f this_file.sql`
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Base schema (idempotent). Already present in this project; kept here so the
--    repository contains a complete, reproducible definition of the database.
-- -----------------------------------------------------------------------------
do $do$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('PARENT', 'CHILD');
  end if;
  if not exists (select 1 from pg_type where typname = 'recurrence_type') then
    create type public.recurrence_type as enum ('DAILY', 'WEEKLY', 'MONTHLY', 'ONE_TIME');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED');
  end if;
  if not exists (select 1 from pg_type where typname = 'redemption_status') then
    create type public.redemption_status as enum ('REQUESTED', 'APPROVED', 'REJECTED');
  end if;
  if not exists (select 1 from pg_type where typname = 'transaction_type') then
    create type public.transaction_type as enum ('TASK_COMPLETED', 'REWARD_REDEEMED', 'MANUAL_ADJUSTMENT');
  end if;
end
$do$;

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  family_name varchar(100) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  role public.user_role not null,
  display_name varchar(50) not null,
  username varchar(50) unique,
  email varchar(100) unique,
  password_hash varchar(255),
  pin_code varchar(255),
  avatar_url text,
  points_balance int not null default 0 check (points_balance >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name varchar(50) not null,
  icon varchar(50),
  color_code varchar(10)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  title varchar(150) not null,
  description text,
  points_reward int not null check (points_reward > 0),
  require_proof_image boolean not null default false,
  recurrence public.recurrence_type not null default 'DAILY',
  assigned_to_user_id uuid references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.task_instances (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  assigned_child_id uuid not null references public.users (id) on delete cascade,
  due_date date not null,
  status public.task_status not null default 'PENDING',
  proof_image_url text,
  rejection_reason text,
  completed_at timestamptz,
  approved_at timestamptz,
  approved_by_user_id uuid references public.users (id)
);

create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  title varchar(150) not null,
  description text,
  points_required int not null check (points_required > 0),
  icon varchar(50),
  stock int not null default -1,
  is_active boolean not null default true
);

create table if not exists public.redemption_requests (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.rewards (id) on delete cascade,
  child_id uuid not null references public.users (id) on delete cascade,
  points_spent int not null,
  status public.redemption_status not null default 'REQUESTED',
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by_user_id uuid references public.users (id)
);

create table if not exists public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount int not null,
  type public.transaction_type not null,
  reference_id uuid,
  description text,
  created_at timestamptz not null default now()
);

-- FK from public.users.auth_user_id -> auth.users.id.
-- Added separately because the table already existed without it.
alter table public.users
  add column if not exists auth_user_id uuid;

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_auth_user_id_fkey'
  ) then
    alter table public.users
      add constraint users_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users (id) on delete set null;
  end if;
end
$do$;

-- One Google identity maps to at most one app user.
create unique index if not exists users_auth_user_id_key
  on public.users (auth_user_id)
  where auth_user_id is not null;

-- A username is only meaningful for children, and must be unique per family.
create unique index if not exists users_family_username_key
  on public.users (family_id, lower(username))
  where username is not null;

-- Supports the daily task list and the approval queue.
create index if not exists task_instances_child_status_due_idx
  on public.task_instances (assigned_child_id, status, due_date);
create index if not exists task_instances_status_idx
  on public.task_instances (status);
create index if not exists redemption_requests_status_idx
  on public.redemption_requests (status);
create index if not exists point_transactions_user_idx
  on public.point_transactions (user_id, created_at desc);
create index if not exists tasks_family_idx on public.tasks (family_id);
create index if not exists rewards_family_idx on public.rewards (family_id);
create index if not exists users_family_idx on public.users (family_id);

-- -----------------------------------------------------------------------------
-- 1. CRITICAL: enable RLS and grant nothing.
--    With RLS enabled and zero policies, `anon` and `authenticated` get zero
--    rows and zero writes. All legitimate access flows through the
--    SECURITY DEFINER functions added below, which bypass RLS by design.
-- -----------------------------------------------------------------------------
alter table public.families            enable row level security;
alter table public.users               enable row level security;
alter table public.categories          enable row level security;
alter table public.tasks               enable row level security;
alter table public.task_instances      enable row level security;
alter table public.rewards             enable row level security;
alter table public.redemption_requests enable row level security;
alter table public.point_transactions  enable row level security;

-- Belt and braces: even if a future policy is added by mistake, these revokes
-- keep the raw tables unreachable from the client roles.
revoke all on all tables in schema public from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Identity resolution helper.
-- -----------------------------------------------------------------------------
create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select u.id
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1;
$fn$;

create or replace function public.current_app_user()
returns public.users
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select *
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1;
$fn$;

-- Raises unless the caller is a PARENT. Used to guard every write.
create or replace function public.require_parent()
returns public.users
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user public.users;
begin
  select * into v_user from public.current_app_user();
  if v_user.id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if v_user.role <> 'PARENT' then
    raise exception 'PARENT_ROLE_REQUIRED' using errcode = '42501';
  end if;
  return v_user;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 3. Onboarding: create the first family, and join an existing one.
-- -----------------------------------------------------------------------------
-- A signed-in Google user who has no app user yet becomes the PARENT of a brand
-- new family. Idempotent: calling it again returns the existing membership.
create or replace function public.bootstrap_parent(p_display_name text, p_family_name text)
returns public.users
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_auth_id uuid := auth.uid();
  v_user public.users;
  v_family_id uuid;
begin
  if v_auth_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select * into v_user from public.users where auth_user_id = v_auth_id;
  if v_user.id is not null then
    return v_user; -- already onboarded
  end if;

  -- Reuse an existing parent row with the same verified email before creating
  -- a new family, so re-signing-in never forks the household.
  select * into v_user
  from public.users
  where auth_user_id is null
    and role = 'PARENT'
    and email is not null
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;

  if v_user.id is not null then
    update public.users set auth_user_id = v_auth_id where id = v_user.id
    returning * into v_user;
    return v_user;
  end if;

  if coalesce(trim(p_family_name), '') = '' then
    raise exception 'FAMILY_NAME_REQUIRED' using errcode = '22023';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'DISPLAY_NAME_REQUIRED' using errcode = '22023';
  end if;

  insert into public.families (family_name) values (trim(p_family_name))
  returning id into v_family_id;

  insert into public.users (family_id, role, display_name, email, auth_user_id)
  values (
    v_family_id,
    'PARENT',
    trim(p_display_name),
    nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''),
    v_auth_id
  )
  returning * into v_user;

  return v_user;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 4. Parent: manage children.
-- -----------------------------------------------------------------------------
-- The plaintext PIN is hashed with bcrypt inside the database and only the hash
-- is stored, so PIN material never appears in application logs or responses.
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

  return v_child;
exception
  when unique_violation then
    raise exception 'USERNAME_TAKEN' using errcode = '23505';
end;
$fn$;

create or replace function public.set_child_pin(p_child_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
begin
  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN_MUST_BE_4_TO_8_DIGITS' using errcode = '22023';
  end if;

  update public.users
  set pin_code = public.hash_pin(p_pin)
  where id = p_child_id
    and family_id = v_parent.family_id
    and role = 'CHILD';

  if not found then
    raise exception 'CHILD_NOT_FOUND' using errcode = '42501';
  end if;

  delete from public.pin_attempts where username = (
    select username from public.users where id = p_child_id
  );
end;
$fn$;

create or replace function public.rename_child(p_child_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
begin
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'DISPLAY_NAME_REQUIRED' using errcode = '22023';
  end if;
  update public.users
  set display_name = trim(p_display_name)
  where id = p_child_id and family_id = v_parent.family_id and role = 'CHILD';
  if not found then
    raise exception 'CHILD_NOT_FOUND' using errcode = '42501';
  end if;
end;
$fn$;

-- Manual point adjustment, always recorded in the audit log.
create or replace function public.adjust_points(
  p_child_id uuid,
  p_amount int,
  p_description text
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_balance int;
begin
  if p_amount = 0 then
    raise exception 'AMOUNT_REQUIRED' using errcode = '22023';
  end if;

  update public.users
  set points_balance = points_balance + p_amount
  where id = p_child_id and family_id = v_parent.family_id and role = 'CHILD'
  returning points_balance into v_balance;

  if v_balance is null then
    raise exception 'CHILD_NOT_FOUND' using errcode = '42501';
  end if;

  insert into public.point_transactions (user_id, amount, type, description)
  values (p_child_id, p_amount, 'MANUAL_ADJUSTMENT', p_description);

  return v_balance;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 5. Parent: task CRUD + scheduling.
-- -----------------------------------------------------------------------------
create or replace function public.create_task(
  p_title text,
  p_description text,
  p_points_reward int,
  p_recurrence public.recurrence_type,
  p_require_proof_image boolean,
  p_assigned_to_user_id uuid default null,
  p_category_id uuid default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_task public.tasks;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'TITLE_REQUIRED' using errcode = '22023';
  end if;
  if p_points_reward is null or p_points_reward <= 0 then
    raise exception 'POINTS_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if p_assigned_to_user_id is not null and not exists (
    select 1 from public.users
    where id = p_assigned_to_user_id and family_id = v_parent.family_id and role = 'CHILD'
  ) then
    raise exception 'CHILD_NOT_FOUND' using errcode = '42501';
  end if;

  insert into public.tasks (
    family_id, category_id, title, description, points_reward,
    require_proof_image, recurrence, assigned_to_user_id
  )
  values (
    v_parent.family_id, p_category_id, trim(p_title), p_description, p_points_reward,
    coalesce(p_require_proof_image, false), coalesce(p_recurrence, 'DAILY'), p_assigned_to_user_id
  )
  returning * into v_task;

  return v_task;
end;
$fn$;

create or replace function public.update_task(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_points_reward int,
  p_recurrence public.recurrence_type,
  p_require_proof_image boolean,
  p_assigned_to_user_id uuid default null,
  p_category_id uuid default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_task public.tasks;
begin
  if p_points_reward is null or p_points_reward <= 0 then
    raise exception 'POINTS_MUST_BE_POSITIVE' using errcode = '22023';
  end if;

  update public.tasks
  set title = trim(p_title),
      description = p_description,
      points_reward = p_points_reward,
      recurrence = coalesce(p_recurrence, recurrence),
      require_proof_image = coalesce(p_require_proof_image, require_proof_image),
      assigned_to_user_id = p_assigned_to_user_id,
      category_id = p_category_id
  where id = p_task_id and family_id = v_parent.family_id
  returning * into v_task;

  if v_task.id is null then
    raise exception 'TASK_NOT_FOUND' using errcode = '42501';
  end if;
  return v_task;
end;
$fn$;

create or replace function public.delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
begin
  delete from public.tasks where id = p_task_id and family_id = v_parent.family_id;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = '42501';
  end if;
end;
$fn$;

-- Generates today's PENDING task_instances for every due task.
-- Idempotent thanks to the unique index on (task_id, assigned_child_id, due_date),
-- so it is safe to call on every page load.
create or replace function public.generate_task_instances(p_date date default current_date)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_count int := 0;
  v_task record;
  v_child_id uuid;
begin
  for v_task in
    select t.*
    from public.tasks t
    where t.family_id = v_parent.family_id
      and (
        t.recurrence = 'DAILY'
        or (t.recurrence = 'WEEKLY' and extract(dow from p_date) = extract(dow from t.created_at))
        or (t.recurrence = 'MONTHLY' and extract(day from p_date) = extract(day from t.created_at))
        or (t.recurrence = 'ONE_TIME' and p_date = t.created_at::date)
      )
  loop
    if v_task.assigned_to_user_id is not null then
      insert into public.task_instances (task_id, assigned_child_id, due_date)
      values (v_task.id, v_task.assigned_to_user_id, p_date)
      on conflict (task_id, assigned_child_id, due_date) do nothing;
      v_count := v_count + (case when found then 1 else 0 end);
    else
      -- NULL assignee means "every child in the family".
      for v_child_id in
        select u.id from public.users u
        where u.family_id = v_parent.family_id and u.role = 'CHILD'
      loop
        insert into public.task_instances (task_id, assigned_child_id, due_date)
        values (v_task.id, v_child_id, p_date)
        on conflict (task_id, assigned_child_id, due_date) do nothing;
        v_count := v_count + (case when found then 1 else 0 end);
      end loop;
    end if;
  end loop;

  return v_count;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 6. Child: submit a task.
-- -----------------------------------------------------------------------------
-- Authorization is by identity, never by a client-supplied child id: the child is
-- derived from the JWT, so a child cannot submit someone else's instance.
create or replace function public.submit_task_instance(
  p_instance_id uuid,
  p_proof_image_url text default null
)
returns public.task_instances
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_child public.users;
  v_instance public.task_instances;
begin
  select * into v_child from public.current_app_user();
  if v_child.id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if v_child.role <> 'CHILD' then
    raise exception 'CHILD_ROLE_REQUIRED' using errcode = '42501';
  end if;

  update public.task_instances
  set status = 'SUBMITTED',
      proof_image_url = coalesce(p_proof_image_url, proof_image_url),
      completed_at = now(),
      rejection_reason = null
  where id = p_instance_id
    and assigned_child_id = v_child.id
    and status in ('PENDING', 'REJECTED')   -- re-submission after a rejection is allowed
  returning * into v_instance;

  if v_instance.id is null then
    raise exception 'INSTANCE_NOT_SUBMITTABLE' using errcode = '42501';
  end if;

  return v_instance;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 7. Parent: approve / reject a submission.
-- -----------------------------------------------------------------------------
-- Idempotency is enforced by the `and status = 'SUBMITTED'` guard: a second call
-- (double click, retry, refresh) finds no row and raises instead of paying twice.
-- The point value is read from the database, never taken from the client.
create or replace function public.approve_task_instance(p_instance_id uuid)
returns public.task_instances
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_instance public.task_instances;
  v_points int;
begin
  -- Guarded by `status = 'SUBMITTED'`, which is what makes approval idempotent: a
  -- double click or retried request finds no row the second time and raises
  -- instead of paying the child twice.
  update public.task_instances ti
  set status = 'APPROVED',
      approved_at = now(),
      approved_by_user_id = v_parent.id,
      rejection_reason = null
  from public.tasks t
  where ti.id = p_instance_id
    and ti.task_id = t.id
    and t.family_id = v_parent.family_id
    and ti.status = 'SUBMITTED'
  returning ti.* into v_instance;

  if v_instance.id is null then
    raise exception 'INSTANCE_NOT_AWAITING_APPROVAL' using errcode = '42501';
  end if;

  -- The point value is read from the database, never taken from the client, so a
  -- tampered request cannot award itself points.
  select points_reward into v_points
  from public.tasks
  where id = v_instance.task_id;
  update public.users
  set points_balance = points_balance + v_points
  where id = v_instance.assigned_child_id;

  insert into public.point_transactions (user_id, amount, type, reference_id, description)
  values (
    v_instance.assigned_child_id,
    v_points,
    'TASK_COMPLETED',
    v_instance.id,
    'Task approved'
  );

  return v_instance;
end;
$fn$;

create or replace function public.reject_task_instance(p_instance_id uuid, p_reason text)
returns public.task_instances
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_instance public.task_instances;
begin
  update public.task_instances ti
  set status = 'REJECTED',
      rejection_reason = coalesce(nullif(trim(p_reason), ''), 'No reason given'),
      approved_at = null,
      approved_by_user_id = null
  from public.tasks t
  where ti.id = p_instance_id
    and ti.task_id = t.id
    and t.family_id = v_parent.family_id
    and ti.status = 'SUBMITTED'
  returning ti.* into v_instance;

  if v_instance.id is null then
    raise exception 'INSTANCE_NOT_AWAITING_REVIEW' using errcode = '42501';
  end if;

  return v_instance;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 8. Rewards: CRUD, request, approve / reject.
-- -----------------------------------------------------------------------------
create or replace function public.upsert_reward(
  p_reward_id uuid,
  p_title text,
  p_description text,
  p_points_required int,
  p_stock int,
  p_icon text default null,
  p_is_active boolean default true
)
returns public.rewards
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_reward public.rewards;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'TITLE_REQUIRED' using errcode = '22023';
  end if;
  if p_points_required is null or p_points_required <= 0 then
    raise exception 'POINTS_MUST_BE_POSITIVE' using errcode = '22023';
  end if;

  if p_reward_id is null then
    insert into public.rewards (family_id, title, description, points_required, stock, icon, is_active)
    values (v_parent.family_id, trim(p_title), p_description, p_points_required,
            coalesce(p_stock, -1), p_icon, coalesce(p_is_active, true))
    returning * into v_reward;
  else
    update public.rewards
    set title = trim(p_title),
        description = p_description,
        points_required = p_points_required,
        stock = coalesce(p_stock, stock),
        icon = p_icon,
        is_active = coalesce(p_is_active, is_active)
    where id = p_reward_id and family_id = v_parent.family_id
    returning * into v_reward;

    if v_reward.id is null then
      raise exception 'REWARD_NOT_FOUND' using errcode = '42501';
    end if;
  end if;

  return v_reward;
end;
$fn$;

create or replace function public.delete_reward(p_reward_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
begin
  delete from public.rewards where id = p_reward_id and family_id = v_parent.family_id;
  if not found then
    raise exception 'REWARD_NOT_FOUND' using errcode = '42501';
  end if;
end;
$fn$;

-- The child is derived from the JWT. Balances are validated before a request is
-- recorded, and points_spent is written (the original function omitted it, which
-- violated its NOT NULL constraint).
create or replace function public.request_reward(p_reward_id uuid)
returns public.redemption_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_child public.users;
  v_reward public.rewards;
  v_request public.redemption_requests;
  v_pending int;
begin
  select * into v_child from public.current_app_user();
  if v_child.id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if v_child.role <> 'CHILD' then
    raise exception 'CHILD_ROLE_REQUIRED' using errcode = '42501';
  end if;

  select * into v_reward
  from public.rewards
  where id = p_reward_id and family_id = v_child.family_id and is_active;

  if v_reward.id is null then
    raise exception 'REWARD_NOT_FOUND' using errcode = '42501';
  end if;
  if v_reward.stock = 0 then
    raise exception 'REWARD_OUT_OF_STOCK' using errcode = '22023';
  end if;
  if v_child.points_balance < v_reward.points_required then
    raise exception 'INSUFFICIENT_POINTS' using errcode = '22023';
  end if;

  -- Do not let a child stack duplicate open requests for the same reward.
  select count(*) into v_pending
  from public.redemption_requests
  where child_id = v_child.id and reward_id = p_reward_id and status = 'REQUESTED';

  if v_pending > 0 then
    raise exception 'ALREADY_REQUESTED' using errcode = '23505';
  end if;

  insert into public.redemption_requests (reward_id, child_id, points_spent, status)
  values (p_reward_id, v_child.id, v_reward.points_required, 'REQUESTED')
  returning * into v_request;

  return v_request;
end;
$fn$;

-- Validates the balance at approval time too, because the balance may have
-- changed since the request was made. Points are deducted exactly once.
create or replace function public.approve_redemption(p_request_id uuid)
returns public.redemption_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_request public.redemption_requests;
  v_reward public.rewards;
  v_balance int;
begin
  select rr.* into v_request
  from public.redemption_requests rr
  join public.users c on c.id = rr.child_id
  where rr.id = p_request_id
    and c.family_id = v_parent.family_id
    and rr.status = 'REQUESTED';

  if v_request.id is null then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '42501';
  end if;

  select * into v_reward from public.rewards where id = v_request.reward_id;
  if v_reward.id is null then
    raise exception 'REWARD_NOT_FOUND' using errcode = '42501';
  end if;
  if v_reward.stock = 0 then
    raise exception 'REWARD_OUT_OF_STOCK' using errcode = '22023';
  end if;

  select points_balance into v_balance from public.users where id = v_request.child_id;
  if v_balance < v_request.points_spent then
    raise exception 'INSUFFICIENT_POINTS' using errcode = '22023';
  end if;

  update public.users
  set points_balance = points_balance - v_request.points_spent
  where id = v_request.child_id;

  update public.redemption_requests
  set status = 'APPROVED',
      processed_at = now(),
      processed_by_user_id = v_parent.id
  where id = p_request_id
  returning * into v_request;

  insert into public.point_transactions (user_id, amount, type, reference_id, description)
  values (v_request.child_id, -v_request.points_spent, 'REWARD_REDEEMED',
          v_request.id, 'Reward redeemed');

  if v_reward.stock > 0 then
    update public.rewards set stock = stock - 1 where id = v_reward.id;
  end if;

  return v_request;
end;
$fn$;

create or replace function public.reject_redemption(p_request_id uuid, p_reason text default null)
returns public.redemption_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  v_request public.redemption_requests;
begin
  update public.redemption_requests rr
  set status = 'REJECTED',
      processed_at = now(),
      processed_by_user_id = v_parent.id
  from public.users c
  where rr.id = p_request_id
    and rr.child_id = c.id
    and c.family_id = v_parent.family_id
    and rr.status = 'REQUESTED'
  returning rr.* into v_request;

  if v_request.id is null then
    raise exception 'REQUEST_NOT_PENDING' using errcode = '42501';
  end if;

  return v_request;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 9. Read models.
--    Each function returns exactly what one screen needs, already authorized and
--    already filtered by family, so the client never builds a cross-family query.
-- -----------------------------------------------------------------------------
create or replace function public.kid_dashboard()
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

  return jsonb_build_object(
    'child', jsonb_build_object(
      'id', v_child.id,
      'display_name', v_child.display_name,
      'avatar_url', v_child.avatar_url,
      'points_balance', v_child.points_balance
    ),
    'tasks_today', coalesce((
      select jsonb_agg(x order by x ->> 'status', x ->> 'title')
      from (
        select jsonb_build_object(
          'id', ti.id,
          'title', t.title,
          'description', t.description,
          'points_reward', t.points_reward,
          'require_proof_image', t.require_proof_image,
          'status', ti.status,
          'due_date', ti.due_date,
          'proof_image_url', ti.proof_image_url,
          'rejection_reason', ti.rejection_reason
        ) as x
        from public.task_instances ti
        join public.tasks t on t.id = ti.task_id
        where ti.assigned_child_id = v_child.id
          and ti.due_date <= current_date
          and ti.status <> 'APPROVED'
      ) s
    ), '[]'::jsonb),
    'approved_total', (
      select count(*) from public.task_instances
      where assigned_child_id = v_child.id and status = 'APPROVED'
    ),
    'pending_review', (
      select count(*) from public.task_instances
      where assigned_child_id = v_child.id and status = 'SUBMITTED'
    )
  );
end;
$fn$;

create or replace function public.kid_rewards()
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

  return jsonb_build_object(
    'points_balance', v_child.points_balance,
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'description', r.description,
        'points_required', r.points_required,
        'icon', r.icon,
        'stock', r.stock,
        'affordable', v_child.points_balance >= r.points_required,
        'already_requested', exists (
          select 1 from public.redemption_requests rr
          where rr.child_id = v_child.id and rr.reward_id = r.id and rr.status = 'REQUESTED'
        )
      ) order by r.points_required)
      from public.rewards r
      where r.family_id = v_child.family_id
        and r.is_active
        and (r.stock <> 0)          -- -1 means unlimited, so it must remain visible
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.kid_history()
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

  return jsonb_build_object(
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pt.id,
        'amount', pt.amount,
        'type', pt.type,
        'description', pt.description,
        'created_at', pt.created_at
      ) order by pt.created_at desc)
      from (
        select * from public.point_transactions
        where user_id = v_child.id
        order by created_at desc
        limit 100
      ) pt
    ), '[]'::jsonb)
  );
end;
$fn$;

-- The family overview the parent dashboard and the approval screens render from.
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

-- -----------------------------------------------------------------------------
-- 10. Child PIN sign-in.
--
--     PIN hashes NEVER leave the database. Verification uses pgcrypto's bcrypt
--     (`crypt`/`gen_salt('bf', 10)`) inside a SECURITY DEFINER function, so even
--     a fully compromised client cannot read a single PIN hash. An earlier design
--     returned the hash for the Node layer to compare; that would have handed an
--     attacker the whole family's PIN material through the publishable key.
--
--     Brute force is throttled per username (8 failures -> 15 minute lock).
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.pin_attempts (
  username text primary key,
  failed_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from anon, authenticated;

-- Hashes a plaintext PIN for storage. Called by the parent-facing create/set
-- functions below, never exposed to the client.
create or replace function public.hash_pin(p_pin text)
returns text
language sql
security definer
set search_path = public, extensions, pg_temp
as $fn$
  select extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
$fn$;

-- Lists the child profiles available for PIN sign-in, so the login screen can show
-- tappable avatars. Returns display data only - no hashes, no balances.
create or replace function public.list_child_profiles()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
    'username', u.username,
    'display_name', u.display_name,
    'avatar_url', u.avatar_url
  ) order by u.display_name), '[]'::jsonb)
  from public.users u
  where u.role = 'CHILD' and u.username is not null and u.pin_code is not null;
$fn$;

-- Verifies a child's PIN and returns the identity needed to mint a session.
-- Returns NULL for both "no such user" and "wrong PIN" so the caller cannot
-- enumerate usernames. Raises TOO_MANY_ATTEMPTS while locked out.
create or replace function public.child_login_verify(p_username text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_username text := lower(trim(p_username));
  v_row record;
  v_lock timestamptz;
  v_ok boolean;
begin
  if coalesce(v_username, '') = '' or coalesce(p_pin, '') = '' then
    return null;
  end if;

  select pa.locked_until into v_lock
  from public.pin_attempts pa
  where pa.username = v_username;

  if v_lock is not null and v_lock > now() then
    raise exception 'TOO_MANY_ATTEMPTS' using errcode = '42901';
  end if;

  select u.id, u.family_id, u.display_name, u.username, u.avatar_url,
         u.pin_code, u.points_balance, f.family_name
  into v_row
  from public.users u
  join public.families f on f.id = u.family_id
  where lower(u.username) = v_username
    and u.role = 'CHILD'
    and u.pin_code is not null
  limit 1;

  if v_row.id is null then
    return null;
  end if;

  v_ok := (extensions.crypt(p_pin, v_row.pin_code) = v_row.pin_code);

  if not v_ok then
    insert into public.pin_attempts (username, failed_count, updated_at)
    values (v_username, 1, now())
    on conflict (username) do update
      set failed_count = public.pin_attempts.failed_count + 1,
          locked_until = case
            when public.pin_attempts.failed_count + 1 >= 8
            then now() + interval '15 minutes'
            else public.pin_attempts.locked_until
          end,
          updated_at = now();
    return null;
  end if;

  delete from public.pin_attempts where username = v_username;

  return jsonb_build_object(
    'id', v_row.id,
    'family_id', v_row.family_id,
    'family_name', v_row.family_name,
    'display_name', v_row.display_name,
    'username', v_row.username,
    'avatar_url', v_row.avatar_url,
    'points_balance', v_row.points_balance
  );
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 11. The unique index that makes generate_task_instances idempotent.
--     Created last so the function body can reference it.
-- -----------------------------------------------------------------------------
create unique index if not exists task_instances_unique_per_day
  on public.task_instances (task_id, assigned_child_id, due_date);

-- -----------------------------------------------------------------------------
-- 12. Function grants.
--     `anon` needs the sign-in helpers. Everything else is callable by
--     `authenticated` only, and each function re-checks the caller's role.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema public from public, anon, authenticated;

-- Sign-in surface reachable without a session.
grant execute on function public.list_child_profiles()                            to anon, authenticated;
grant execute on function public.child_login_verify(text, text)                   to anon, authenticated;
grant execute on function public.bootstrap_parent(text, text)                     to authenticated;
grant execute on function public.current_app_user_id()                           to authenticated;
grant execute on function public.current_app_user()                              to authenticated;
grant execute on function public.require_parent()                                to authenticated;
grant execute on function public.create_child(text, text, text, text)            to authenticated;
grant execute on function public.set_child_pin(uuid, text)                       to authenticated;
grant execute on function public.rename_child(uuid, text)                        to authenticated;
grant execute on function public.adjust_points(uuid, int, text)                  to authenticated;
grant execute on function public.create_task(text, text, int, public.recurrence_type, boolean, uuid, uuid) to authenticated;
grant execute on function public.update_task(uuid, text, text, int, public.recurrence_type, boolean, uuid, uuid) to authenticated;
grant execute on function public.delete_task(uuid)                               to authenticated;
grant execute on function public.generate_task_instances(date)                   to authenticated;
grant execute on function public.submit_task_instance(uuid, text)                to authenticated;
grant execute on function public.approve_task_instance(uuid)                     to authenticated;
grant execute on function public.reject_task_instance(uuid, text)                to authenticated;
grant execute on function public.upsert_reward(uuid, text, text, int, int, text, boolean) to authenticated;
grant execute on function public.delete_reward(uuid)                             to authenticated;
grant execute on function public.request_reward(uuid)                            to authenticated;
grant execute on function public.approve_redemption(uuid)                        to authenticated;
grant execute on function public.reject_redemption(uuid, text)                   to authenticated;
grant execute on function public.kid_dashboard()                                 to authenticated;
grant execute on function public.kid_rewards()                                   to authenticated;
grant execute on function public.kid_history()                                   to authenticated;
grant execute on function public.parent_overview()                               to authenticated;

-- PostgREST caches the schema; ask it to reload now that functions changed.
notify pgrst, 'reload schema';
