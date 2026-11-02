-- ============================================================
-- dshs42.app — 수업 변경 (옮김 · 공강)
-- events.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 시간표 자체는 index.html 의 SCHOOL_DATA 이고, 달라진 수업만 여기에 적습니다.
-- user_id 있음 = 그 학생의 달력에서만 바뀝니다 (본인만 보고 고칩니다).
-- user_id null = 관리자가 분반 전체에 적용한 변경입니다 (로그인한 모두가 읽습니다).
-- moved_start 없음 = 공강, 있음 = 그 시간으로 옮김.
-- batch = 매주 반복으로 한 번에 만든 행 묶음.
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
