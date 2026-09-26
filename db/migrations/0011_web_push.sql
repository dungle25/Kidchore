-- =============================================================================
-- KidChore — Migration 0010: web push subscriptions and event recipients
-- =============================================================================
-- Why this shape
-- --------------
-- A push has to be sent from Node, because the payload is encrypted with the
-- subscription's public key and signed with the VAPID private key, and neither can be
-- done in SQL. But deciding *who* may be notified is an authorization question, and
-- authorization belongs in the database next to the data.
--
-- So the split is:
--   * this file answers "who should hear about this event, and what should it say"
--     purely from the caller's session and the row the event is about;
--   * lib/push.ts only encrypts and delivers what it is handed.
--
-- The alternative - reading subscriptions from the server with the service role key -
-- is rejected on purpose. That key bypasses Row Level Security, and lib/env.ts says it
-- must never serve a user request. Here it does not: every function below is
-- SECURITY DEFINER and authorizes from auth.uid() exactly like the rest of the schema.
--
-- What a leaked endpoint is worth
-- -------------------------------
-- A push endpoint plus its p256dh/auth keys is not enough to send anything: the
-- payload must also be signed with the VAPID private key, which never leaves the
-- server. A subscription row is therefore a capability to *receive*, not to send.
-- That is what makes it acceptable for push_recipients() to hand raw endpoints to the
-- caller's session, and why the checks below focus on *whose* endpoints rather than
-- trying to hide them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Subscriptions.
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- The push service URL for this device+browser profile. Unique because the same
  -- endpoint must never be delivered twice.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent varchar(200),
  created_at timestamptz not null default now(),
  -- Refreshed on every app open. A subscription nobody has refreshed in months is a
  -- device that no longer exists, and can be pruned with scripts/cleanup-fixtures.mjs.
  last_seen_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'Web push endpoints. Read and written only through the functions below.';

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

-- Same default-deny posture as every other table: RLS on, no policy, and the table
-- privilege revoked outright, so even a future accidental policy cannot expose it.
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Registering a device.
-- -----------------------------------------------------------------------------
-- Called by the browser after the person taps "Bật thông báo" and the push service
-- returns a subscription, and again on every app open to refresh last_seen_at.
--
-- ON CONFLICT (endpoint) is the important part. A family tablet is shared, so the same
-- browser profile produces the same endpoint for every child who signs in on it, and
-- the row must move to whoever is signed in now. Without the reassignment the tablet
-- would keep notifying the previous child.
--
-- The user_id is never a parameter: it comes from the session, so a caller cannot
-- register an endpoint against somebody else's account.
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_me public.users;
begin
  select * into v_me from public.current_app_user();
  if v_me.id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  -- A push service endpoint is always an https URL. Checking here keeps a malformed or
  -- hostile value out of the table, where it would otherwise be posted to later.
  if p_endpoint is null or p_endpoint !~ '^https://[^[:space:]]+$' or length(p_endpoint) > 1000 then
    raise exception 'INVALID_ENDPOINT' using errcode = '22023';
  end if;
  if p_p256dh is null or p_p256dh = '' or p_auth is null or p_auth = '' then
    raise exception 'INVALID_SUBSCRIPTION_KEYS' using errcode = '22023';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_me.id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();
end;
$fn$;

-- Turning notifications off on this device. Scoped to the caller's own rows, so the
-- endpoint has to belong to them for anything to be deleted.
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_me public.users;
begin
  select * into v_me from public.current_app_user();
  if v_me.id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = v_me.id;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 3. Resolving recipients for an event.
-- -----------------------------------------------------------------------------
-- One function rather than one per event, because the rules are the same every time:
-- check that the caller is allowed to announce this event at all, then return the
-- endpoints of the people who should hear about it - always inside the caller's own
-- family.
--
-- The event kinds and what each one is about:
--
--   kind                  subject                    caller   told
--   --------------------  -------------------------  -------  ----------------------
--   TASK_SUBMITTED        task_instances.id          CHILD    the family's parents
--   REWARD_REQUESTED      redemption_requests.id     CHILD    the family's parents
--   TASK_APPROVED         task_instances.id          PARENT   the child who did it
--   TASK_REJECTED         task_instances.id          PARENT   the child who did it
--   REDEMPTION_APPROVED   redemption_requests.id     PARENT   the requesting child
--   REDEMPTION_REJECTED   redemption_requests.id     PARENT   the requesting child
--   TASK_ASSIGNED         users.id (a child)         PARENT   that child
--   POINTS_CHANGED        users.id (a child)         PARENT   that child
--
-- TASK_ASSIGNED is about the child rather than about one instance, because a day's
-- chores are generated in a single call that can create a dozen rows across several
-- children. One notification per child saying how many chores are waiting is both less
-- noisy and more useful than twelve notifications naming one chore each.
--
-- A child can therefore only ever cause a notification to their own parents, never to
-- a sibling - kid_siblings() deliberately does not expose a sibling's balance, and a
-- notification saying "Kun lost 10 points" would leak it just as effectively.
--
-- p_amount exists only for POINTS_CHANGED, and only the number is used. Nothing the
-- caller passes becomes notification text, so a parent cannot use this to push
-- arbitrary content, and a child cannot use it to send anything at all.
create or replace function public.push_recipients(
  p_kind text,
  p_subject_id uuid,
  p_amount int default null
)
returns table (
  recipient_user_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  title text,
  body text,
  url text,
  tag text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_me public.users;
  v_child public.users;   -- the child the notification is about
  v_audience public.user_role;
  v_title text;
  v_body text;
  v_url text;
  v_tag text;
  v_pending int;
  v_task public.tasks;
  v_instance public.task_instances;
  v_request public.redemption_requests;
  v_reward public.rewards;
  v_reason text;
begin
  select * into v_me from public.current_app_user();
  if v_me.id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_subject_id is null then
    raise exception 'SUBJECT_REQUIRED' using errcode = '22023';
  end if;
  if p_amount is not null and p_kind <> 'POINTS_CHANGED' then
    raise exception 'AMOUNT_NOT_ALLOWED' using errcode = '22023';
  end if;
  -- One guard up front rather than a fall-through at the bottom: every branch below
  -- assumes it recognises the kind, and a typo in a call site should fail loudly here
  -- instead of quietly resolving to an empty audience.
  if p_kind not in (
    'TASK_SUBMITTED', 'REWARD_REQUESTED',
    'TASK_APPROVED', 'TASK_REJECTED', 'TASK_ASSIGNED',
    'REDEMPTION_APPROVED', 'REDEMPTION_REJECTED',
    'POINTS_CHANGED'
  ) then
    raise exception 'UNKNOWN_NOTIFICATION_KIND' using errcode = '22023';
  end if;

  -- ---- events raised by a child, telling the parents ----
  if p_kind in ('TASK_SUBMITTED', 'REWARD_REQUESTED') then
    if v_me.role <> 'CHILD' then
      raise exception 'CHILD_ROLE_REQUIRED' using errcode = '42501';
    end if;
    v_audience := 'PARENT';
    v_child := v_me;
  end if;

  if p_kind = 'TASK_SUBMITTED' then
    select * into v_instance from public.task_instances where id = p_subject_id;
    if v_instance.id is null or v_instance.assigned_child_id <> v_me.id then
      raise exception 'NOT_YOUR_TASK_INSTANCE' using errcode = '42501';
    end if;
    select * into v_task from public.tasks where id = v_instance.task_id;
    v_title := 'Việc chờ duyệt';
    v_body := v_me.display_name || ' vừa xong: ' || coalesce(v_task.title, 'một việc');
    v_url := '/parent/chores';
    v_tag := 'task-' || v_instance.id::text;

  elsif p_kind = 'REWARD_REQUESTED' then
    select * into v_request from public.redemption_requests where id = p_subject_id;
    if v_request.id is null or v_request.child_id <> v_me.id then
      raise exception 'NOT_YOUR_REWARD_REQUEST' using errcode = '42501';
    end if;
    select * into v_reward from public.rewards where id = v_request.reward_id;
    v_title := 'Đổi quà chờ duyệt';
    v_body := v_me.display_name || ' muốn đổi: ' || coalesce(v_reward.title, 'một phần quà');
    v_url := '/parent/rewards';
    v_tag := 'reward-' || v_request.id::text;
  end if;

  -- ---- events raised by a parent, telling the child ----
  if p_kind in (
    'TASK_APPROVED', 'TASK_REJECTED', 'TASK_ASSIGNED',
    'REDEMPTION_APPROVED', 'REDEMPTION_REJECTED', 'POINTS_CHANGED'
  ) then
    if v_me.role <> 'PARENT' then
      raise exception 'PARENT_ROLE_REQUIRED' using errcode = '42501';
    end if;
    v_audience := 'CHILD';
  end if;

  if p_kind in ('TASK_APPROVED', 'TASK_REJECTED') then
    select * into v_instance from public.task_instances where id = p_subject_id;
    if v_instance.id is null then
      raise exception 'TASK_INSTANCE_NOT_FOUND' using errcode = '42501';
    end if;

    select * into v_child from public.users
    where id = v_instance.assigned_child_id and family_id = v_me.family_id;
    if v_child.id is null then
      raise exception 'CHILD_NOT_IN_FAMILY' using errcode = '42501';
    end if;

    select * into v_task from public.tasks where id = v_instance.task_id;
    v_tag := 'task-' || v_instance.id::text;

    if p_kind = 'TASK_APPROVED' then
      v_title := 'Được duyệt rồi! 🎉';
      v_body := coalesce(v_task.title, 'Việc') || ' · +' || coalesce(v_task.points_reward, 0) || ' điểm';
      v_url := '/kid/dashboard';
    else
      v_reason := nullif(trim(coalesce(v_instance.rejection_reason, '')), '');
      v_title := 'Việc cần làm lại';
      v_body := coalesce(v_task.title, 'Việc') ||
                case when v_reason is null then '' else ' · ' || v_reason end;
      v_url := '/kid/tasks';
    end if;

  elsif p_kind = 'TASK_ASSIGNED' then
    select * into v_child from public.users
    where id = p_subject_id and family_id = v_me.family_id and role = 'CHILD';
    if v_child.id is null then
      raise exception 'CHILD_NOT_IN_FAMILY' using errcode = '42501';
    end if;

    -- Counted here rather than passed in, so the number in the notification is the
    -- number of rows that actually exist. A caller cannot make the message say
    -- something the data does not support.
    select count(*) into v_pending
    from public.task_instances ti
    where ti.assigned_child_id = v_child.id
      and ti.due_date = current_date
      and ti.status = 'PENDING';

    -- Nothing waiting today: an empty result, so no notification is sent at all.
    -- Without this the parent's "create today's chores" button would announce "0 việc".
    if v_pending = 0 then
      return;
    end if;

    v_title := 'Việc mới hôm nay';
    v_body := 'Con có ' || v_pending || ' việc cần làm. Mở KidChore để xem nhé!';
    v_url := '/kid/tasks';
    v_tag := 'assigned-' || v_child.id::text;

  elsif p_kind in ('REDEMPTION_APPROVED', 'REDEMPTION_REJECTED') then
    select * into v_request from public.redemption_requests where id = p_subject_id;
    if v_request.id is null then
      raise exception 'REDEMPTION_NOT_FOUND' using errcode = '42501';
    end if;

    select * into v_child from public.users
    where id = v_request.child_id and family_id = v_me.family_id;
    if v_child.id is null then
      raise exception 'CHILD_NOT_IN_FAMILY' using errcode = '42501';
    end if;

    select * into v_reward from public.rewards where id = v_request.reward_id;
    v_tag := 'reward-' || v_request.id::text;

    if p_kind = 'REDEMPTION_APPROVED' then
      v_title := 'Đổi quà thành công 🎁';
      v_body := coalesce(v_reward.title, 'Phần quà') || ' đã được duyệt';
      v_url := '/kid/rewards';
    else
      v_title := 'Yêu cầu đổi quà bị từ chối';
      -- Deliberately does NOT claim the points were refunded. `request_reward` only
      -- checks the balance; nothing is deducted until a parent approves, and
      -- `reject_redemption` never touches the balance. Saying "đã hoàn lại" would tell
      -- the child they lost points and got them back, which never happened.
      v_body := coalesce(v_reward.title, 'Phần quà') || ' · chưa đổi được, điểm vẫn còn nguyên';
      v_url := '/kid/rewards';
    end if;

  elsif p_kind = 'POINTS_CHANGED' then
    select * into v_child from public.users
    where id = p_subject_id and family_id = v_me.family_id and role = 'CHILD';
    if v_child.id is null then
      raise exception 'CHILD_NOT_IN_FAMILY' using errcode = '42501';
    end if;

    if p_amount is null or p_amount = 0 then
      raise exception 'AMOUNT_REQUIRED' using errcode = '22023';
    end if;

    if p_amount > 0 then
      v_title := 'Được thưởng ' || p_amount || ' điểm ⭐';
    else
      -- U+2212 minus, the same glyph the parent's buttons use, so the sign is
      -- unambiguous at a glance rather than a hyphen that reads as a dash.
      v_title := 'Bị trừ ' || replace(p_amount::text, '-', '−') || ' điểm';
    end if;
    v_body := 'Số dư hiện tại: ' || v_child.points_balance || ' điểm';
    v_url := '/kid/dashboard';
    v_tag := 'points-' || v_child.id::text;
  end if;

  -- ---- who hears about it ----
  -- Always inside the caller's own family. Which of the two audiences applies was
  -- decided by the branch above, together with the role check that made raising this
  -- event legal for the caller in the first place.
  if v_audience = 'PARENT' then
    return query
      select s.user_id, s.endpoint, s.p256dh, s.auth, v_title, v_body, v_url, v_tag
      from public.push_subscriptions s
      join public.users u on u.id = s.user_id
      where u.family_id = v_me.family_id
        and u.role = 'PARENT';
  else
    return query
      select s.user_id, s.endpoint, s.p256dh, s.auth, v_title, v_body, v_url, v_tag
      from public.push_subscriptions s
      where s.user_id = v_child.id;
  end if;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 4. Privileges.
-- -----------------------------------------------------------------------------
-- Explicit revoke-then-grant, because a bare `grant` would leave EXECUTE in place for
-- PUBLIC: PostgreSQL grants it by default on every new function.
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon, authenticated;
revoke all on function public.delete_push_subscription(text) from public, anon, authenticated;
revoke all on function public.push_recipients(text, uuid, int) from public, anon, authenticated;

grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.push_recipients(text, uuid, int) to authenticated;

notify pgrst, 'reload schema';
