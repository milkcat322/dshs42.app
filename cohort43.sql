-- ============================================================
-- dshs43.app (43기) — 같은 DB 를 함께 씁니다
-- 43기는 아직 시간표(분반)가 없어 12과목 모두 '전체 분반'(ban 이 비어 있음)으로 듣습니다.
-- 43기 학생은 dshs43.app 에서 'dshs.app으로 로그인'할 때 dshs-oauth 가 register_cohort43() 으로
-- 명단(roster)과 수강(enrollments)에 자동으로 넣습니다 (1학년 학번 1000~1999 만).
-- 42기 · 43기는 수강 과목 이름이 달라 수행평가 공지가 섞이지 않습니다 (assignments_read 는 수강 과목으로 거름).
-- SQL Editor 에서 한 번 실행합니다.
-- ============================================================

-- 43기 과목 (이수학점). 과목 이름은 사이트(dshs43.app)의 과목 목록과 같아야 합니다.
create table if not exists public.cohort43_subjects (
  subject text primary key,
  credits integer not null
);
alter table public.cohort43_subjects enable row level security;
drop policy if exists cohort43_subjects_read on public.cohort43_subjects;
create policy cohort43_subjects_read on public.cohort43_subjects for select using (true);

insert into public.cohort43_subjects (subject, credits) values
  ('국어II', 3), ('영어II', 3), ('지구과학II', 3), ('진로와직업', 1), ('체육II', 1), ('화학II', 3),
  ('적분과통계', 3), ('기하와벡터', 3), ('물리학II', 3), ('한국사II', 2), ('컴퓨팅사고력과 문제해결', 3), ('생명과학II', 3)
on conflict (subject) do update set credits = excluded.credits;

-- 43기 학생 등록: 명단 + 12과목 수강(분반 없음). 서버(dshs-oauth, service role)만 부릅니다.
-- 이미 명단에 있는 학번(42기 등)은 건드리지 않습니다.
create or replace function public.register_cohort43(p_student_id integer, p_name text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_student_id is null or p_student_id < 1000 or p_student_id > 1999 then return false; end if;
  if exists (select 1 from public.roster where student_id = p_student_id) then return false; end if;
  insert into public.roster (student_id, name) values (p_student_id, left(coalesce(nullif(trim(p_name), ''), '학생'), 40));
  insert into public.enrollments (student_id, subject, ban)
    select p_student_id, s.subject, null from public.cohort43_subjects s
    on conflict do nothing;
  return true;
end $$;
revoke execute on function public.register_cohort43(integer, text) from public, anon, authenticated;
grant  execute on function public.register_cohort43(integer, text) to service_role;

-- 수행평가 올리기: 분반이 없는 과목(43기)은 '전체 분반'(ban 비어 있음)으로 올립니다.
-- 예전 규칙은 e.ban = assignments.ban 이라 둘 다 비어 있으면 막혔습니다 → is not distinct from 으로 같게 봅니다.
-- 42기(분반 있음)는 그대로입니다.
drop policy if exists assignments_insert on public.assignments;
create policy assignments_insert on public.assignments
  for insert with check (
    created_by = auth.uid()
    and (
      public.is_admin()
      or (
        status = 'pending'
        and exists (
          select 1 from public.enrollments e
          where e.student_id = public.my_student_id()
            and e.subject = assignments.subject
            and e.ban is not distinct from assignments.ban
        )
      )
    )
  );
