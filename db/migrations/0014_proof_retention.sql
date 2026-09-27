-- =============================================================================
--  0014 — Ảnh bằng chứng hết hạn thì được xoá
--
--  Supabase Free cho 1 GB Storage và không bán thêm dung lượng, còn ảnh bằng chứng
--  thì trước migration này **không bao giờ** bị xoá: không job định kỳ, không cột nào
--  ghi thời điểm hết hạn. Với ảnh đã nén (~150-250 KB), 1 GB chứa được khoảng
--  4.000-6.000 ảnh; một gia đình hai bé chụp ảnh mỗi ngày sẽ chạm trần sau vài năm,
--  và lúc đó upload mới thất bại.
--
--  Chính sách: ảnh của một bài **đã được quyết định** (APPROVED hoặc REJECTED) được
--  giữ 30 ngày rồi xoá. Bài đang chờ duyệt không bao giờ bị xoá, kể cả cũ 40 ngày —
--  bố/mẹ chưa nhìn thấy ảnh thì xoá nó là mất bằng chứng của chính việc họ phải làm.
--
--  Ba phần:
--    * `proof_deleted_at` — dấu vết "bài này từng có ảnh, ảnh đã hết hạn lưu trữ".
--      URL được giữ lại chứ không đặt null: lịch sử phải nói được là có ảnh, nếu không
--      một bài yêu cầu ảnh sẽ trông như bé chưa bao giờ gửi.
--    * `expired_proof_instances()` — **một chỗ duy nhất** định nghĩa "hết hạn", để
--      script dọn dẹp và ứng dụng không thể lệch luật nhau. Không grant cho ai: hàm
--      này nhận `p_family_id` tuỳ ý, nên nếu `authenticated` gọi được thì một bố/mẹ
--      đọc được URL ảnh của gia đình khác.
--    * `expired_proofs_for_my_family()` và `mark_proof_deleted()` — hai cửa cho ứng
--      dụng, cả hai đều kiểm danh tính bằng `require_parent()` và lọc theo gia đình
--      của người gọi.
--
--  Việc xoá object phải đi qua Storage API (xoá hàng trong `storage.objects` để lại
--  file mồ côi trong S3), nên không thể làm trọn trong SQL: hàm chọn ra danh sách,
--  Node xoá object rồi đánh dấu. Xem `lib/proof-retention.ts` và
--  `scripts/purge-proof-images.mjs`.
-- =============================================================================

alter table public.task_instances
  add column if not exists proof_deleted_at timestamptz;

comment on column public.task_instances.proof_deleted_at is
  'Khi ảnh bằng chứng bị xoá khỏi Storage vì hết hạn lưu trữ. proof_image_url được giữ lại để lịch sử vẫn biết bài này từng có ảnh.';

-- The one definition of "expired". See the header: deliberately not granted.
create or replace function public.expired_proof_instances(
  p_family_id uuid,
  p_days int
)
returns table (instance_id uuid, proof_image_url text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select ti.id, ti.proof_image_url
  from public.task_instances ti
  join public.tasks t on t.id = ti.task_id
  where ti.proof_image_url is not null
    and ti.proof_deleted_at is null
    and ti.status in ('APPROVED', 'REJECTED')
    -- `null` means every family, which only the maintenance script uses.
    and (p_family_id is null or t.family_id = p_family_id)
    -- Anchored on when the parent decided, falling back to when the child submitted:
    -- an approved instance has approved_at, a rejected one does not.
    and coalesce(ti.approved_at, ti.completed_at, ti.due_date::timestamptz)
        < now() - make_interval(days => greatest(p_days, 1));
$fn$;

-- The app's door: always scoped to the caller's own family.
create or replace function public.expired_proofs_for_my_family(p_days int default 30)
returns table (instance_id uuid, proof_image_url text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
begin
  return query
    select e.instance_id, e.proof_image_url
    from public.expired_proof_instances(v_parent.family_id, p_days) e;
end;
$fn$;

-- Called after the object is gone, so the row records that the photo is no longer
-- retrievable. Keeps proof_image_url: see the column comment.
create or replace function public.mark_proof_deleted(p_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_parent public.users := public.require_parent();
begin
  update public.task_instances ti
  set proof_deleted_at = now()
  from public.tasks t
  where ti.id = p_instance_id
    and ti.task_id = t.id
    and t.family_id = v_parent.family_id
    and ti.status in ('APPROVED', 'REJECTED')
    and ti.proof_deleted_at is null;
end;
$fn$;

-- `kid_dashboard` is 0001's definition with one field added. This is the screen that can
-- actually show a purged photo: it lists everything except APPROVED chores, so a REJECTED
-- chore whose photo expired is here. Without the flag the card would render a broken
-- image and, worse, the child could resubmit a dead URL - `kid-task-list.tsx` now asks for
-- a new photo when the old one is gone.
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
          'proof_deleted_at', ti.proof_deleted_at,
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

-- -----------------------------------------------------------------------------
-- Grants. New functions are executable by PUBLIC by default, which would hand the
-- unfiltered one to anybody holding the publishable key.
-- -----------------------------------------------------------------------------
revoke all on function public.expired_proof_instances(uuid, int) from public, anon, authenticated;
revoke all on function public.expired_proofs_for_my_family(int) from public, anon, authenticated;
revoke all on function public.mark_proof_deleted(uuid) from public, anon, authenticated;

-- Only the two the app needs, and both check the caller's identity themselves.
grant execute on function public.expired_proofs_for_my_family(int) to authenticated;
grant execute on function public.mark_proof_deleted(uuid) to authenticated;

notify pgrst, 'reload schema';
