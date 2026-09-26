-- =============================================================================
-- KidChore — Migration 0009: fix the current-streak calculation
-- =============================================================================
-- Migration 0007 shipped a `child_streaks` whose current streak was derived by finding
-- the island whose last day equalled "the most recent complete day on or before
-- yesterday". That produced the wrong run as soon as an incomplete day sat between two
-- complete runs: the newest run ended today, so nothing matched, and the streak fell back
-- to a single day.
--
-- The test suite caught it (current=1 where 2 was expected), which is exactly why the
-- streak logic is covered by fixtures with a deliberate gap rather than only happy paths.
--
-- The fix derives the current streak from the most recent complete day directly:
--   * if today is complete, the streak is the island ending today;
--   * otherwise, if yesterday is complete, it is the island ending yesterday;
--   * otherwise there is no current streak.
-- An unfinished today therefore does not reset the streak, and a missed yesterday does.
-- =============================================================================

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

revoke all on function public.child_streaks(uuid) from public, anon, authenticated;
grant execute on function public.child_streaks(uuid) to authenticated;

notify pgrst, 'reload schema';
