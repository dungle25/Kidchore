-- =============================================================================
-- KidChore — Migration 0002: fix PIN storage width and delete behaviour
-- =============================================================================
-- Two real defects found by the end-to-end test suite.
--
-- 1. users.pin_code was varchar(10) in the original SRS schema, which was sized
--    for a plaintext "1234". PINs are now stored as bcrypt hashes, which are 60
--    characters, so every attempt to create or set a child PIN failed with
--    "value too long for type character varying(10)" (SQLSTATE 22001).
--    The column is widened, and existing short values are hashed in place.
--
-- 2. Deleting a family failed. task_instances.approved_by_user_id referenced
--    users(id) with the default NO ACTION, so the cascade from families -> users
--    was blocked as soon as any task had been approved.
--    The reference is now ON DELETE SET NULL: the approval timestamp and the
--    audit row in point_transactions are what matter for history, and they are
--    preserved.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Widen pin_code to hold a bcrypt hash.
-- -----------------------------------------------------------------------------
alter table public.users
  alter column pin_code type varchar(255);

-- Plaintext PINs written before this migration (if any) are hashed in place, so
-- they stop being readable and start verifying correctly.
do $do$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name = 'pin_code' and character_maximum_length = 255
  ) then
    update public.users
    set pin_code = extensions.crypt(pin_code, extensions.gen_salt('bf', 10))
    where pin_code is not null
      and pin_code !~ '^\$2[aby]\$';   -- not already a bcrypt hash
  end if;
end
$do$;

-- -----------------------------------------------------------------------------
-- 2. Let a family actually be deleted.
-- -----------------------------------------------------------------------------
alter table public.task_instances
  drop constraint if exists task_instances_approved_by_user_id_fkey;

alter table public.task_instances
  add constraint task_instances_approved_by_user_id_fkey
  foreign key (approved_by_user_id) references public.users (id)
  on delete set null;

-- Removing a child should not erase the family's task history either, so keep the
-- instance and only drop the assignee.
alter table public.task_instances
  drop constraint if exists task_instances_assigned_child_id_fkey;

alter table public.task_instances
  add constraint task_instances_assigned_child_id_fkey
  foreign key (assigned_child_id) references public.users (id)
  on delete cascade;

-- Historical point transactions must survive a member being removed.
alter table public.point_transactions
  drop constraint if exists point_transactions_user_id_fkey;

alter table public.point_transactions
  add constraint point_transactions_user_id_fkey
  foreign key (user_id) references public.users (id)
  on delete cascade;

-- Redemption history likewise.
alter table public.redemption_requests
  drop constraint if exists redemption_requests_processed_by_user_id_fkey;

alter table public.redemption_requests
  add constraint redemption_requests_processed_by_user_id_fkey
  foreign key (processed_by_user_id) references public.users (id)
  on delete set null;

-- tasks.assigned_to_user_id: when a child is removed, their tasks become
-- "everyone" rather than disappearing silently.
alter table public.tasks
  drop constraint if exists tasks_assigned_to_user_id_fkey;

alter table public.tasks
  add constraint tasks_assigned_to_user_id_fkey
  foreign key (assigned_to_user_id) references public.users (id)
  on delete set null;

-- Keep the migration ledger unreachable from the client roles as well, so the
-- only table in the schema without RLS is not readable through the API.
alter table public._migrations enable row level security;
revoke all on public._migrations from anon, authenticated;

notify pgrst, 'reload schema';
