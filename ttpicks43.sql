-- ============================================================
-- dshs43.app — 격주로 선생님이 바뀌는 수업의 '이번 주 선생님' (반마다 함께)
-- 화학 · 기하와 벡터 · 적분과 통계 · 물리는 반마다 두 교시 연속 수업 1번 + 한 교시 수업 1번이 있고,
-- 두 선생님이 격주로 서로 바꿔 맡습니다. 한 학생이 어느 칸이든 '이번 주 선생님'을 고르면
-- 그 반의 나머지 칸과 다음 주들(격주로 번갈아)이 정해지고, 같은 반 친구들 시간표에도 보입니다.
-- 사이트(dshs43.app)는 2차 지필평가(기말고사) 주간부터는 이 값을 쓰지 않습니다.
-- cohort43.sql 다음에 SQL Editor 에서 한 번 실행합니다.
-- ============================================================

create table if not exists public.cohort43_tt_picks (
  ban            integer     not null check (ban between 1 and 6),
  subject        text        not null,
  double_teacher text        not null,     -- week 주에 두 교시 연속 수업을 맡는 선생님
  week           date        not null,     -- 그 주의 월요일
  updated_by     uuid        default auth.uid(),
  updated_at     timestamptz not null default now(),
  primary key (ban, subject)
);
alter table public.cohort43_tt_picks enable row level security;

-- 읽기: 로그인한 누구나 (같은 반 친구 · 다른 반 시간표 검색에서도 보임). 쓰기는 아래 함수로만.
drop policy if exists cohort43_tt_picks_read on public.cohort43_tt_picks;
create policy cohort43_tt_picks_read on public.cohort43_tt_picks for select to authenticated using (true);
revoke insert, update, delete on public.cohort43_tt_picks from anon, authenticated;

-- 고르기: 자기 반(학번 둘째 자리)만, 정해진 과목 · 선생님만. 관리자는 모든 반.
-- 테스트 계정(학번 1999)은 4반으로 봅니다 (사이트의 BAN_OVERRIDE 와 같게).
create or replace function public.set_tt_pick(p_ban integer, p_subject text, p_double_teacher text, p_week date)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  sid integer := public.my_student_id();
  my_ban integer := case when sid = 1999 then 4 when sid between 1000 and 1999 then (sid / 100) % 10 end;
  pairs jsonb := '{"화학":["이충섭","김정은"],"기하와 벡터":["김수정","남정훈"],"적분과 통계":["조영민","전혜진"],"물리":["신대호","이주희"]}';
begin
  if not (public.is_admin() or my_ban = p_ban) then raise exception 'not your class'; end if;
  if not (pairs ? p_subject) or not ((pairs -> p_subject) ? p_double_teacher) then raise exception 'bad subject or teacher'; end if;
  if extract(isodow from p_week) <> 1 then raise exception 'week must be a monday'; end if;
  insert into public.cohort43_tt_picks (ban, subject, double_teacher, week, updated_by, updated_at)
    values (p_ban, p_subject, p_double_teacher, p_week, auth.uid(), now())
  on conflict (ban, subject) do update
    set double_teacher = excluded.double_teacher, week = excluded.week, updated_by = excluded.updated_by, updated_at = now();
  return true;
end $$;
revoke execute on function public.set_tt_pick(integer, text, text, date) from public, anon;
grant  execute on function public.set_tt_pick(integer, text, text, date) to authenticated;
