-- ============================================================
-- dshs42.app — 수업 옮기기
-- events.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 시간표 자체는 index.html 의 SCHOOL_DATA 이고, 달라진 수업만 여기에 적습니다.
-- user_id 있음 = 그 학생의 달력에서만 바뀝니다 (본인만 보고 고칩니다).
-- user_id null = 관리자가 분반 전체에 적용한 변경입니다 (로그인한 모두가 읽습니다).
-- moved_start = 옮긴 시간. (공강 처리 기능을 빼서 지금은 항상 값이 있습니다.)
-- batch = (지금은 쓰지 않음) 매주 반복 기능을 빼면서 남은 칸입니다.
-- ============================================================
create table if not exists public.class_changes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade,
  subject     text not null,
  ban         text not null,
  on_date     date not null,             -- 원래 수업 날짜
  period_from integer not null,
  period_to   integer not null,
  moved_start timestamptz,
  moved_end   timestamptz,
  batch       uuid,
  created_at  timestamptz not null default now(),
  check ((moved_start is null) = (moved_end is null)),
  check (moved_end is null or moved_end > moved_start),
  check (period_to >= period_from)
);
create unique index if not exists class_changes_personal_idx
  on public.class_changes (user_id, subject, ban, on_date, period_from) where user_id is not null;
create unique index if not exists class_changes_all_idx
  on public.class_changes (subject, ban, on_date, period_from) where user_id is null;

alter table public.class_changes enable row level security;
drop policy if exists class_changes_read   on public.class_changes;
drop policy if exists class_changes_insert on public.class_changes;
drop policy if exists class_changes_delete on public.class_changes;
create policy class_changes_read on public.class_changes
  for select using (auth.uid() is not null and (user_id is null or user_id = auth.uid()));
create policy class_changes_insert on public.class_changes
  for insert with check (user_id = auth.uid() or (user_id is null and public.is_admin()));
create policy class_changes_delete on public.class_changes
  for delete using (user_id = auth.uid() or (user_id is null and public.is_admin()));

-- ------------------------------------------------------------
-- 학생이 옮긴 수업을 관리자가 승인하면 분반 전체에 적용합니다.
-- status (user_id 있는 줄에서만 뜻이 있습니다)
--   pending  = 승인 대기. 그 학생 달력에는 이미 바뀌어 있습니다.
--   rejected = 반려. 그 학생 달력에만 남습니다.
--   personal = 승인 기능 전에 옮긴 수업. 요청이 아니라 그 학생 달력에만 적용합니다.
--   approved = 분반 전체 변경 (user_id null).
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'class_changes' and column_name = 'status') then
    alter table public.class_changes add column status text not null default 'pending'
      check (status in ('pending', 'approved', 'rejected', 'personal'));
    update public.class_changes set status = case when user_id is null then 'approved' else 'personal' end;
  end if;
end $$;

-- 학생은 승인 대기로만 올릴 수 있고, 처리는 아래 함수로만 합니다. 관리자는 요청을 보려고 모든 줄을 읽습니다.
drop policy if exists class_changes_read   on public.class_changes;
drop policy if exists class_changes_insert on public.class_changes;
create policy class_changes_read on public.class_changes
  for select using (auth.uid() is not null and (user_id is null or user_id = auth.uid() or public.is_admin()));
create policy class_changes_insert on public.class_changes
  for insert with check ((user_id = auth.uid() and status = 'pending') or (user_id is null and public.is_admin()));

-- 승인: 분반 전체 변경을 만들고 그 수업의 개인 변경을 모두 지웁니다 (분반 모두가 같은 시간을 보게).
-- 반려: 같은 시간으로 옮긴 대기 요청을 함께 반려합니다.
create or replace function public.review_class_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.class_changes;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  select * into r from public.class_changes
    where id = p_id and user_id is not null and status = 'pending'
    for update;
  if not found then
    raise exception 'not_pending';
  end if;
  if not p_approve then
    update public.class_changes set status = 'rejected'
      where user_id is not null and status = 'pending'
        and subject = r.subject and ban = r.ban and on_date = r.on_date and period_from = r.period_from
        and moved_start is not distinct from r.moved_start and moved_end is not distinct from r.moved_end;
    return;
  end if;
  if exists (select 1 from public.class_changes
             where user_id is null and subject = r.subject and ban = r.ban
               and on_date = r.on_date and period_from = r.period_from) then
    raise exception 'already_applied';
  end if;
  insert into public.class_changes (user_id, subject, ban, on_date, period_from, period_to, moved_start, moved_end, status)
    values (null, r.subject, r.ban, r.on_date, r.period_from, r.period_to, r.moved_start, r.moved_end, 'approved');
  delete from public.class_changes
    where user_id is not null
      and subject = r.subject and ban = r.ban and on_date = r.on_date and period_from = r.period_from;
end $$;
revoke execute on function public.review_class_change(uuid, boolean) from public, anon;
grant execute on function public.review_class_change(uuid, boolean) to authenticated;
