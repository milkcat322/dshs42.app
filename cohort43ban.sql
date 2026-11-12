-- ============================================================
-- dshs43.app — 43기 수행평가를 '전체' 또는 '우리 반'으로 올리기
-- 43기 수강(enrollments)의 분반 칸에 반(학번 둘째 자리, 예: 1305 → '3반')을 넣습니다.
--  - 수행평가 ban 이 비어 있으면(전체) 43기 모두에게, '3반' 이면 3반 학생에게만 보입니다 (assignments_read 그대로).
--  - 올리기(assignments_insert): 43기 과목은 '전체'(ban 비어 있음) 또는 자기 반으로 올릴 수 있습니다. 42기는 예전 그대로입니다.
-- cohort43.sql · roster43.sql 다음에 SQL Editor 에서 실행합니다 (다시 실행해도 됨).
-- 테스트 계정(학번 1999)은 4반으로 봅니다 (사이트의 BAN_OVERRIDE 와 같게).
-- ============================================================

update public.enrollments
   set ban = case when student_id = 1999 then '4반' else ((student_id / 100) % 10)::text || '반' end
 where student_id between 1000 and 1999;

-- 앞으로 자동 등록(dshs.app 로그인)되는 43기 학생도 반을 넣어 등록합니다
create or replace function public.register_cohort43(p_student_id integer, p_name text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_student_id is null or p_student_id < 1000 or p_student_id > 1999 then return false; end if;
  if exists (select 1 from public.roster where student_id = p_student_id) then return false; end if;
  insert into public.roster (student_id, name) values (p_student_id, left(coalesce(nullif(trim(p_name), ''), '학생'), 40));
  insert into public.enrollments (student_id, subject, ban)
    select p_student_id, s.subject, ((p_student_id / 100) % 10)::text || '반' from public.cohort43_subjects s
    on conflict do nothing;
  return true;
end $$;
revoke execute on function public.register_cohort43(integer, text) from public, anon, authenticated;
grant  execute on function public.register_cohort43(integer, text) to service_role;

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
            and (
              e.ban is not distinct from assignments.ban
              -- 43기 학생은 자기 과목을 '전체'(ban 비어 있음)로도 올릴 수 있음
              or (assignments.ban is null and e.student_id between 1000 and 1999)
            )
        )
      )
    )
  );
