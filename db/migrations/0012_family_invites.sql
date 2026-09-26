-- =============================================================================
-- KidChore — Migration 0012: inviting a second parent into a family
-- =============================================================================
-- Until now every Google account that signed in got its own brand new family, and
-- there was no way to join one. A spouse signing in saw an empty app - no children, no
-- chores, no points - because the children's PIN accounts belong to the other parent's
-- family. Two households in parallel, with nothing on screen to say so.
--
-- The data model already allowed several parents under one family: `users` has no
-- uniqueness on family_id, `require_parent()` checks the role rather than an identity,
-- `parent_overview()` filters by the caller's family, and push notifications already go
-- to every parent. What was missing was a way in.
--
-- WHAT AN INVITE IS WORTH
--   Accepting one makes the caller a full PARENT: approve chores, award and deduct
--   points, edit and delete chores, manage rewards, read everything about the children.
--   So the code is a credential, not a convenience, and it is treated like one:
--   hashed at rest, single use, expiring, revocable, and capped.
--
-- WHY IT IS HASHED, AND WHAT THAT COSTS
--   Storing the hash means the database cannot hand the code back later - not to the
--   parent who created it either. The screen shows it once and offers "tạo mã khác"
--   instead of "xem lại mã". That is the price, and it is worth paying: a database dump
--   or a support screenshot otherwise contains working invitations to a family.
--
-- WHY THERE IS NO ATTEMPT LIMIT
--   The PIN needed an 8-try lockout because it is four digits: 10,000 possibilities.
--   This code is 12 characters from a 32-symbol alphabet, so 32^12 = 2^60. Guessing it
--   is not a thing that happens, and adding a lockout table would be protecting nothing.
--   The `% 32` below is deliberately 32 and not, say, 26, because 256 is an exact
--   multiple of 32: every symbol is equally likely, with no modulo bias.
-- =============================================================================

create table if not exists public.family_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- sha256 of the normalised code. The code itself is never stored.
  code_hash text not null unique,
  created_by_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references public.users (id) on delete set null,
  revoked_at timestamptz
);

comment on table public.family_invites is
  'Single-use codes that let a second parent join a family. Read and written only through the functions below.';

create index if not exists family_invites_family_id_idx
  on public.family_invites (family_id);

-- Same default-deny posture as every other table.
alter table public.family_invites enable row level security;
revoke all on public.family_invites from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Helpers.
-- -----------------------------------------------------------------------------
-- Strips the dashes the UI adds for readability and uppercases the rest.
create or replace function public.normalise_invite_code(p_code text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$fn$;

-- How many parents one family may have. Four covers two parents and two grandparents.
create or replace function public.max_parents_per_family()
returns int
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select 4;
$fn$;

-- -----------------------------------------------------------------------------
-- 2. Creating an invite.
-- -----------------------------------------------------------------------------
-- Returns the plaintext code, and only ever on this one call. There is no function that
-- hands it back afterwards, which is what makes storing the hash meaningful.
create or replace function public.create_family_invite()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
  -- No I, O, 0 or 1: they are the characters people mistype when copying a code out of
  -- a chat message. 32 symbols, so the modulo below stays unbiased.
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  -- pgcrypto lives in the `extensions` schema in this project (see migration 0001), and
  -- these functions are SECURITY DEFINER with a bare `search_path`, so it must be
  -- spelled out. `hash_pin` does the same with `extensions.crypt`.
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_code text := '';
  v_active int;
begin
  -- An invite that is never used is still a live credential. Keeping the number of them
  -- small means "revoke everything" stays a one-glance job for the parent.
  select count(*) into v_active
  from public.family_invites
  where family_id = v_parent.family_id
    and accepted_at is null
    and revoked_at is null
    and expires_at > now();

  if v_active >= 5 then
    raise exception 'TOO_MANY_ACTIVE_INVITES' using errcode = '22023';
  end if;

  for i in 0..11 loop
    v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
  end loop;

  insert into public.family_invites (family_id, code_hash, created_by_user_id, expires_at)
  values (
    v_parent.family_id,
    encode(extensions.digest(v_code, 'sha256'), 'hex'),
    v_parent.id,
    now() + interval '7 days'
  );

  return v_code;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 3. Listing and revoking.
-- -----------------------------------------------------------------------------
-- Never returns a code, because it cannot: only the hash exists. It returns enough for
-- the parent to recognise "the one I made on Tuesday" and revoke it.
create or replace function public.list_family_invites()
returns table (
  id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by_name text,
  accepted_by_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
begin
  return query
    select
      i.id, i.created_at, i.expires_at, i.accepted_at, i.revoked_at,
      creator.display_name::text, accepter.display_name::text
    from public.family_invites i
    left join public.users creator on creator.id = i.created_by_user_id
    left join public.users accepter on accepter.id = i.accepted_by_user_id
    where i.family_id = v_parent.family_id
    order by i.created_at desc;
end;
$fn$;

create or replace function public.revoke_family_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
begin
  -- The family_id filter is the whole authorization: without it a parent could revoke a
  -- stranger's invitation by guessing a uuid.
  update public.family_invites
  set revoked_at = now()
  where id = p_invite_id
    and family_id = v_parent.family_id
    and accepted_at is null
    and revoked_at is null;

  if not found then
    raise exception 'INVITE_NOT_REVOCABLE' using errcode = '42501';
  end if;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 4. Accepting an invite.
-- -----------------------------------------------------------------------------
-- Called during onboarding, while the caller still holds the Google access token rather
-- than an app session - the same position `bootstrap_parent` is in, and for the same
-- reason: there is no app user yet, which is the whole point.
--
-- The display name comes from the caller rather than from Google, so a parent can be
-- "Mẹ" rather than whatever their Google profile says.
create or replace function public.accept_family_invite(p_code text, p_display_name text)
returns public.users
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_auth_id uuid := auth.uid();
  v_user public.users;
  v_invite public.family_invites;
  v_parents int;
begin
  if v_auth_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  -- Somebody who already belongs to a family stays where they are. Joining a second one
  -- would silently move their children, points and history out of view, and the only
  -- sane reading of "accept" for them is "you are already set up".
  select * into v_user from public.users where auth_user_id = v_auth_id;
  if v_user.id is not null then
    return v_user;
  end if;

  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'DISPLAY_NAME_REQUIRED' using errcode = '22023';
  end if;

  select * into v_invite
  from public.family_invites
  where code_hash = encode(extensions.digest(public.normalise_invite_code(p_code), 'sha256'), 'hex')
    and accepted_at is null
    and revoked_at is null
    and expires_at > now();

  -- One message for every bad case - wrong, expired, already used, revoked. Saying which
  -- one it was tells a stranger whether a code ever existed.
  if v_invite.id is null then
    raise exception 'INVITE_INVALID_OR_EXPIRED' using errcode = '42501';
  end if;

  select count(*) into v_parents
  from public.users
  where family_id = v_invite.family_id and role = 'PARENT';

  if v_parents >= public.max_parents_per_family() then
    raise exception 'FAMILY_FULL' using errcode = '22023';
  end if;

  insert into public.users (family_id, role, display_name, email, auth_user_id)
  values (
    v_invite.family_id,
    'PARENT',
    trim(p_display_name),
    nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''),
    v_auth_id
  )
  returning * into v_user;

  -- Single use. Marking it here, inside the same transaction as the insert, is what
  -- makes a double submit from a flaky connection a no-op rather than two parents.
  update public.family_invites
  set accepted_at = now(), accepted_by_user_id = v_user.id
  where id = v_invite.id;

  return v_user;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 5. Privileges.
-- -----------------------------------------------------------------------------
revoke all on function public.normalise_invite_code(text) from public, anon, authenticated;
revoke all on function public.max_parents_per_family() from public, anon, authenticated;
revoke all on function public.create_family_invite() from public, anon, authenticated;
revoke all on function public.list_family_invites() from public, anon, authenticated;
revoke all on function public.revoke_family_invite(uuid) from public, anon, authenticated;
revoke all on function public.accept_family_invite(text, text) from public, anon, authenticated;

grant execute on function public.create_family_invite() to authenticated;
grant execute on function public.list_family_invites() to authenticated;
grant execute on function public.revoke_family_invite(uuid) to authenticated;
grant execute on function public.accept_family_invite(text, text) to authenticated;

notify pgrst, 'reload schema';
