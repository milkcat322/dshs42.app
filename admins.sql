-- ============================================================
-- dshs.study — 관리자 계정 연결
--
-- 먼저 대시보드에서 두 계정을 만들어 주세요 (README 6단계):
--   Authentication → Users → Add user → Create new user
--     milkcat322@dshs.study   (비밀번호 직접 입력, Auto Confirm User 체크)
--     qksalornt@dshs.study    (비밀번호 직접 입력, Auto Confirm User 체크)
--
-- 그다음 이 파일을 SQL Editor 에서 실행하면 두 계정이 관리자가 됩니다.
-- 비밀번호는 이 파일에 들어 있지 않습니다.
-- ============================================================

-- (schema.sql 을 이 업데이트 전에 이미 실행했다면 필요한 변경)
alter table public.profiles alter column student_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'student_or_admin') then
    alter table public.profiles
      add constraint student_or_admin check (student_id is not null or is_admin);
  end if;
end $$;

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
            and e.ban = assignments.ban
        )
      )
    )
  );

-- 관리자 프로필 연결
insert into public.profiles (id, username, student_id, name, is_admin)
select u.id, split_part(u.email, '@', 1), null, '관리자', true
from auth.users u
where u.email in ('milkcat322@dshs.study', 'qksalornt@dshs.study')
on conflict (id) do update set is_admin = true;

-- 확인: 두 줄이 나오면 성공
select username, name, is_admin from public.profiles where is_admin order by username;
