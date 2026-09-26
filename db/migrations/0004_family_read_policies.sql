-- =============================================================================
-- KidChore — Migration 0004: family-scoped read access for signed-in users
-- =============================================================================
-- Migration 0001 enabled RLS with zero policies. That is the correct default-deny
-- posture against the publishable key, but it also blocks legitimate signed-in
-- reads: a parent could not read their own children.
--
-- This migration adds SELECT policies scoped to the caller's family, so an
-- authenticated user can read exactly their own household and nothing else.
--
-- Writes are still NOT granted directly. Every mutation continues to go through
-- the SECURITY DEFINER functions, which validate roles and values (positive
-- points, sufficient balance, idempotent approvals). Allowing direct table writes
-- would bypass all of that.
--
-- `auth.uid()` is the Google/child auth identity; public.current_app_user_id()
-- maps it to the app user row, and the family is read from there.
-- =============================================================================

-- Helper: the caller's family, or NULL when not a linked app user.
create or replace function public.current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select u.family_id
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1;
$fn$;

revoke all on function public.current_family_id() from public, anon;
grant execute on function public.current_family_id() to authenticated;

-- Helper: true when the caller is a PARENT in the given family.
create or replace function public.is_parent_of(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.family_id = p_family_id
      and u.role = 'PARENT'
  );
$fn$;

revoke all on function public.is_parent_of(uuid) from public, anon;
grant execute on function public.is_parent_of(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Read policies. Each one is scoped to the caller's family.
-- -----------------------------------------------------------------------------
drop policy if exists families_read_own on public.families;
create policy families_read_own on public.families
  for select to authenticated
  using (id = public.current_family_id());

drop policy if exists users_read_family on public.users;
create policy users_read_family on public.users
  for select to authenticated
  using (family_id = public.current_family_id());

drop policy if exists categories_read_family on public.categories;
create policy categories_read_family on public.categories
  for select to authenticated
  using (family_id = public.current_family_id());

drop policy if exists tasks_read_family on public.tasks;
create policy tasks_read_family on public.tasks
  for select to authenticated
  using (family_id = public.current_family_id());

drop policy if exists rewards_read_family on public.rewards;
create policy rewards_read_family on public.rewards
  for select to authenticated
  using (family_id = public.current_family_id());

drop policy if exists task_instances_read_family on public.task_instances;
create policy task_instances_read_family on public.task_instances
  for select to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_instances.task_id
        and t.family_id = public.current_family_id()
    )
  );

drop policy if exists redemption_requests_read_family on public.redemption_requests;
create policy redemption_requests_read_family on public.redemption_requests
  for select to authenticated
  using (
    exists (
      select 1
      from public.users c
      where c.id = redemption_requests.child_id
        and c.family_id = public.current_family_id()
    )
  );

drop policy if exists point_transactions_read_family on public.point_transactions;
create policy point_transactions_read_family on public.point_transactions
  for select to authenticated
  using (
    exists (
      select 1
      from public.users u
      where u.id = point_transactions.user_id
        and u.family_id = public.current_family_id()
    )
  );

-- -----------------------------------------------------------------------------
-- The SELECT privilege was revoked in migration 0001, so it must be granted back
-- for these policies to have any effect. INSERT/UPDATE/DELETE stay revoked.
-- -----------------------------------------------------------------------------
grant select on public.families, public.users, public.categories, public.tasks,
  public.task_instances, public.rewards, public.redemption_requests,
  public.point_transactions to authenticated;

-- `anon` gets nothing: the publishable key still cannot read any table.
revoke all on public.families, public.users, public.categories, public.tasks,
  public.task_instances, public.rewards, public.redemption_requests,
  public.point_transactions from anon;

notify pgrst, 'reload schema';
