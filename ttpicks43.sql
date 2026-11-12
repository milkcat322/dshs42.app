-- ============================================================
-- dshs43.app — 시간표 칸의 선생님 고르기 (반마다 함께)
-- 선생님이 여러 명인 과목은 반 학생이 그 요일 · 교시 수업의 선생님을 고르고, 같은 반 친구들 시간표에도 보입니다.
--  - 보통 과목: 매주 같은 선생님 → on_date = '2000-01-01' (매주)
--  - 격주로 바뀌는 과목(화학 · 기하와 벡터 · 적분과 통계 · 물리): 기말고사 전까지 그 요일 · 교시의 날짜마다 → on_date = 그 날짜
-- cohort43.sql 다음에 SQL Editor 에서 한 번 실행합니다. (예전 cohort43_tt_picks 는 쓰지 않아 지웁니다)
-- ============================================================

drop function if exists public.set_tt_pick(integer, text, text, date);
drop table if exists public.cohort43_tt_picks;

create table if not exists public.cohort43_tt_teachers (
  ban        integer     not null check (ban between 1 and 6),
  day        text        not null check (day in ('월', '화', '수', '목', '금')),
  period     integer     not null check (period between 1 and 9),
  on_date    date        not null default '2000-01-01',   -- '2000-01-01' = 매주, 아니면 그 날짜 수업만
  teacher    text        not null,
  updated_by uuid        default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (ban, day, period, on_date)
);
alter table public.cohort43_tt_teachers enable row level security;

-- 읽기: 로그인한 누구나 (같은 반 친구 · 다른 반 시간표 검색에서도 보임). 쓰기는 아래 함수로만.
drop policy if exists cohort43_tt_teachers_read on public.cohort43_tt_teachers;
create policy cohort43_tt_teachers_read on public.cohort43_tt_teachers for select to authenticated using (true);
revoke insert, update, delete on public.cohort43_tt_teachers from anon, authenticated;

-- 고르기 · 지우기(p_teacher 가 null): 자기 반(학번 둘째 자리)만, 알려진 선생님만. 관리자는 모든 반.
-- 테스트 계정(학번 1999)은 4반으로 봅니다 (사이트의 BAN_OVERRIDE 와 같게).
create or replace function public.set_tt_teacher(p_ban integer, p_day text, p_period integer, p_on_date date, p_teacher text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  sid integer := public.my_student_id();
  my_ban integer := case when sid = 1999 then 4 when sid between 1000 and 1999 then (sid / 100) % 10 end;
  known text[] := array['김도현','정선혜','한신실','Nthabiseng','최원문','김진욱','김우겸','이충섭','김정은',
                        '이민주','손희창','임재화','신대호','이주희','조영민','전혜진','김수정','남정훈',
                        '이병수','안소희','신요셉','백경덕','최형미','최정호'];
begin
  if not (public.is_admin() or my_ban = p_ban) then raise exception 'not your class'; end if;
  if p_teacher is null then
    delete from public.cohort43_tt_teachers where ban = p_ban and day = p_day and period = p_period and on_date = coalesce(p_on_date, '2000-01-01');
    return true;
  end if;
  if not (p_teacher = any(known)) then raise exception 'unknown teacher'; end if;
  insert into public.cohort43_tt_teachers (ban, day, period, on_date, teacher, updated_by, updated_at)
    values (p_ban, p_day, p_period, coalesce(p_on_date, '2000-01-01'), p_teacher, auth.uid(), now())
  on conflict (ban, day, period, on_date) do update
    set teacher = excluded.teacher, updated_by = excluded.updated_by, updated_at = now();
  return true;
end $$;
revoke execute on function public.set_tt_teacher(integer, text, integer, date, text) from public, anon;
grant  execute on function public.set_tt_teacher(integer, text, integer, date, text) to authenticated;
