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

-- 과목 이름은 학생들이 부르는 이름으로 통일했습니다 (2026-11-12). 예전 이름(국어II 등)으로 이미 들어간
-- 43기 수강 · 수행평가 · 과목 목록은 아래에서 새 이름으로 바꿉니다 (다시 실행해도 됨).
-- '체육'은 42기 과목 이름과 같지만 두 기수 모두 수행평가를 받지 않는 과목입니다.
do $$
declare r record;
begin
  for r in select * from (values
    ('국어II', '국어'), ('영어II', '영어회화'), ('지구과학II', '지구과학'), ('진로와직업', '진로'), ('체육II', '체육'),
    ('화학II', '화학'), ('적분과통계', '적분과 통계'), ('기하와벡터', '기하와 벡터'), ('물리학II', '물리'),
    ('한국사II', '한국사'), ('컴퓨팅사고력과 문제해결', '프로그래밍'), ('생명과학II', '생명과학')) as v(old, new)
  loop
    update public.enrollments set subject = r.new where subject = r.old and student_id between 1000 and 1999;
    update public.assignments set subject = r.new where subject = r.old;
    delete from public.cohort43_subjects where subject = r.old;
  end loop;
end $$;

insert into public.cohort43_subjects (subject, credits) values
  ('국어', 3), ('영어회화', 3), ('지구과학', 3), ('진로', 1), ('체육', 1), ('화학', 3),
  ('적분과 통계', 3), ('기하와 벡터', 3), ('물리', 3), ('한국사', 2), ('프로그래밍', 3), ('생명과학', 3)
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
