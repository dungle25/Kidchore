-- =============================================================================
-- KidChore — Migration 0007: reports and streaks
-- =============================================================================
-- The SRS asks for two things the app could not answer yet:
--   * a completion-rate report over time (weekly / monthly)
--   * a persistence score (streak) per child
--
-- STREAK SEMANTICS
--   A day counts toward a streak when the child had at least one chore due that day and
--   every chore due that day ended APPROVED. A day with nothing due is skipped rather
--   than breaking the run, so a child is not punished for a day the parent assigned no
--   work.
--
--   The current streak is forgiving about today: an unfinished today does not reset it,
--   because the day is not over. It is computed from yesterday backwards, then extended
--   by one if today is already complete. A missed yesterday does break it.
--
-- All functions are SECURITY DEFINER and resolve the caller through the session, so a
-- parent can only read their own family's data and a child only their own.
--
-- Everything is expressed as straight SQL. An earlier draft used a temporary table to
-- hold per-day completeness, which is wrong inside a STABLE function and would have
-- failed at runtime; the island detection below needs no intermediate state.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Per-day completion, which both the report and the streak are built from.
-- -----------------------------------------------------------------------------
create or replace function public.child_daily_completion(
  p_child_id uuid,
  p_from date,
  p_to date
)
returns table (day date, assigned int, approved int, complete boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    ti.due_date as day,
    count(*)::int as assigned,
    count(*) filter (where ti.status = 'APPROVED')::int as approved,
    -- A day is complete only when it had work and all of it was approved.
    (count(*) > 0 and count(*) filter (where ti.status = 'APPROVED') = count(*)) as complete
  from public.task_instances ti
  where ti.assigned_child_id = p_child_id
    and ti.due_date between p_from and p_to
  group by ti.due_date
  order by ti.due_date;
$fn$;

-- -----------------------------------------------------------------------------
-- Streaks.
--
-- Gaps-and-islands: days that are one apart keep a constant difference between the date
-- and its row number, so grouping on that difference isolates consecutive runs.
--
-- An earlier version selected the "island ending yesterday" with a scalar subquery, which
-- reported the wrong run; the current streak is now derived directly from the most recent
-- complete day instead. That is easier to reason about and easier to test.
-- -----------------------------------------------------------------------------
create or replace function public.child_streaks(p_child_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with days as (
    select d.day, d.complete
    from public.child_daily_completion(p_child_id, current_date - 400, current_date) d
    where d.assigned > 0
  ),
  islands as (
    select
      count(*) filter (where complete) as length,
      max(day) as last_day,
      count(*) filter (where not complete) as broken_days
    from (
      select day, complete,
             day - (row_number() over (order by day))::int as grp
      from days
    ) numbered
    group by grp
  ),
  complete_islands as (
    select length, last_day from islands where broken_days = 0
  ),
  -- The most recent day counted in the streak. Today is used when it is already
  -- finished; otherwise the streak is measured up to yesterday, so an unfinished today
  -- cannot reset it.
  anchor as (
    select case
      when exists (select 1 from days where day = current_date and complete) then current_date
      when exists (select 1 from days where day = current_date - 1 and complete) then current_date - 1
      else null
    end as day
  ),
  current_run as (
    select coalesce((
      select ci.length
      from complete_islands ci
      where ci.last_day = (select day from anchor)
    ), 0) as length
  )
  select jsonb_build_object(
    'current', (select length from current_run),
    'longest', greatest(
      coalesce((select max(length) from complete_islands), 0),
      (select length from current_run)
    ),
    'today_complete', coalesce((select complete from days where day = current_date), false)
  );
$fn$;

-- -----------------------------------------------------------------------------
-- The parent report: per-child totals, a streak, and a daily series for a chart.
-- -----------------------------------------------------------------------------
create or replace function public.parent_reports(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users;
  v_from date;
  v_days int;
begin
  select * into v_parent from public.current_app_user();
  if v_parent.id is null or v_parent.role <> 'PARENT' then
    raise exception 'PARENT_ROLE_REQUIRED' using errcode = '42501';
  end if;

  -- Clamp the window so a bad argument cannot ask for an unbounded scan.
  v_days := coalesce(p_days, 30);
  if v_days < 7 then
    v_days := 7;
  elsif v_days > 180 then
    v_days := 180;
  end if;
  v_from := current_date - (v_days - 1);

  return jsonb_build_object(
    'from', v_from,
    'to', current_date,
    'days', v_days,
    'children', coalesce((
      select jsonb_agg(child_report order by child_report ->> 'display_name')
      from (
        select jsonb_build_object(
          'id', c.id,
          'display_name', c.display_name,
          'points_balance', c.points_balance,
          'streak', public.child_streaks(c.id),
          'totals', jsonb_build_object(
            'assigned', coalesce((
              select count(*) from public.task_instances ti
              where ti.assigned_child_id = c.id and ti.due_date between v_from and current_date
            ), 0),
            'approved', coalesce((
              select count(*) from public.task_instances ti
              where ti.assigned_child_id = c.id and ti.due_date between v_from and current_date
                and ti.status = 'APPROVED'
            ), 0),
            'submitted', coalesce((
              select count(*) from public.task_instances ti
              where ti.assigned_child_id = c.id and ti.due_date between v_from and current_date
                and ti.status = 'SUBMITTED'
            ), 0),
            'rejected', coalesce((
              select count(*) from public.task_instances ti
              where ti.assigned_child_id = c.id and ti.due_date between v_from and current_date
                and ti.status = 'REJECTED'
            ), 0),
            'points_earned', coalesce((
              select sum(pt.amount) from public.point_transactions pt
              where pt.user_id = c.id and pt.type = 'TASK_COMPLETED'
                and pt.created_at::date >= v_from
            ), 0)
          ),
          'daily', coalesce((
            select jsonb_agg(jsonb_build_object(
              'day', d.day,
              'assigned', d.assigned,
              'approved', d.approved,
              'complete', d.complete
            ) order by d.day)
            from public.child_daily_completion(c.id, v_from, current_date) d
          ), '[]'::jsonb)
        ) as child_report
        from public.users c
        where c.family_id = v_parent.family_id and c.role = 'CHILD'
      ) s
    ), '[]'::jsonb),
    'family_totals', jsonb_build_object(
      'assigned', coalesce((
        select count(*) from public.task_instances ti
        join public.users c on c.id = ti.assigned_child_id
        where c.family_id = v_parent.family_id and ti.due_date between v_from and current_date
      ), 0),
      'approved', coalesce((
        select count(*) from public.task_instances ti
        join public.users c on c.id = ti.assigned_child_id
        where c.family_id = v_parent.family_id and ti.due_date between v_from and current_date
          and ti.status = 'APPROVED'
      ), 0)
    )
  );
end;
$fn$;

-- -----------------------------------------------------------------------------
-- The child's own view: streaks, earned badges, and recent point history.
-- -----------------------------------------------------------------------------
create or replace function public.kid_achievements()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_child public.users;
  v_streak jsonb;
  v_current int;
  v_longest int;
  v_approved int;
  v_tx_count int;
begin
  select * into v_child from public.current_app_user();
  if v_child.id is null or v_child.role <> 'CHILD' then
    raise exception 'CHILD_ROLE_REQUIRED' using errcode = '42501';
  end if;

  v_streak := public.child_streaks(v_child.id);
  v_current := coalesce((v_streak ->> 'current')::int, 0);
  v_longest := coalesce((v_streak ->> 'longest')::int, 0);

  select count(*)::int into v_approved
  from public.task_instances
  where assigned_child_id = v_child.id and status = 'APPROVED';

  select count(*)::int into v_tx_count
  from public.point_transactions where user_id = v_child.id;

  return jsonb_build_object(
    'child', jsonb_build_object(
      'id', v_child.id,
      'display_name', v_child.display_name,
      'points_balance', v_child.points_balance
    ),
    'streak', v_streak,
    'approved_total', v_approved,
    -- Badges are derived on every read, never stored, so they cannot drift out of step
    -- with the underlying data.
    'badges', jsonb_build_array(
      jsonb_build_object('code', 'FIRST_CHORE', 'title', 'Việc đầu tiên', 'icon', '🌱',
        'earned', v_approved >= 1, 'progress', least(v_approved, 1), 'target', 1),
      jsonb_build_object('code', 'TEN_CHORES', 'title', 'Mười việc', 'icon', '🔟',
        'earned', v_approved >= 10, 'progress', least(v_approved, 10), 'target', 10),
      jsonb_build_object('code', 'FIFTY_CHORES', 'title', 'Năm mươi việc', 'icon', '🏅',
        'earned', v_approved >= 50, 'progress', least(v_approved, 50), 'target', 50),
      jsonb_build_object('code', 'STREAK_3', 'title', 'Ba ngày liên tiếp', 'icon', '🔥',
        'earned', v_longest >= 3, 'progress', least(v_longest, 3), 'target', 3),
      jsonb_build_object('code', 'STREAK_7', 'title', 'Một tuần liên tiếp', 'icon', '⭐',
        'earned', v_longest >= 7, 'progress', least(v_longest, 7), 'target', 7),
      jsonb_build_object('code', 'STREAK_30', 'title', 'Một tháng liên tiếp', 'icon', '🏆',
        'earned', v_longest >= 30, 'progress', least(v_longest, 30), 'target', 30)
    ),
    'history', coalesce((
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
        limit 50
      ) pt
    ), '[]'::jsonb),
    'transaction_count', v_tx_count
  );
end;
$fn$;

revoke all on function public.child_daily_completion(uuid, date, date) from public, anon, authenticated;
revoke all on function public.child_streaks(uuid) from public, anon, authenticated;
revoke all on function public.parent_reports(int) from public, anon, authenticated;
revoke all on function public.kid_achievements() from public, anon, authenticated;

grant execute on function public.child_daily_completion(uuid, date, date) to authenticated;
grant execute on function public.child_streaks(uuid) to authenticated;
grant execute on function public.parent_reports(int) to authenticated;
grant execute on function public.kid_achievements() to authenticated;

notify pgrst, 'reload schema';
