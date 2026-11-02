-- ============================================================
-- dshs42.app — 내 위치 (자습실 자리 · 빈백 · 하늘마루 · 기숙사 · 직접 입력)
-- feedback.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 수업에 빠진 학생을 세기 쉽도록 각자 지금 있는 곳을 남깁니다.
-- 로그인한 학생 모두가 볼 수 있고, 고치기 · 지우기는 본인만 합니다.
-- 언제 고쳤는지(updated_at)는 DB 가 정합니다.
-- ============================================================

create table if not exists public.student_status (
  student_id integer primary key references public.roster(student_id) on delete cascade,
  location   text not null check (char_length(trim(location)) between 1 and 30),
  updated_at timestamptz not null default now()
);

-- 고칠 때마다 수정 시각을 지금으로
create or replace function public.touch_student_status()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists student_status_touch on public.student_status;
create trigger student_status_touch
  before insert or update on public.student_status
  for each row execute function public.touch_student_status();

alter table public.student_status enable row level security;

drop policy if exists student_status_read   on public.student_status;
drop policy if exists student_status_insert on public.student_status;
drop policy if exists student_status_update on public.student_status;
drop policy if exists student_status_delete on public.student_status;
create policy student_status_read on public.student_status
  for select using (auth.uid() is not null);
create policy student_status_insert on public.student_status
  for insert with check (student_id = public.my_student_id());
create policy student_status_update on public.student_status
  for update using (student_id = public.my_student_id()) with check (student_id = public.my_student_id());
create policy student_status_delete on public.student_status
  for delete using (student_id = public.my_student_id());

revoke all on public.student_status from anon;
grant select, insert, update, delete on public.student_status to authenticated;
