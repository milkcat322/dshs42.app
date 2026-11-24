-- 공부 페이지 사용 기록 (어느 과목 · 파트를 몇 명이, 얼마나 오래 보는지)
-- 공부 탭의 각 페이지(단어장 vocab.html · 일반생물학 bio.html · 미적분학Ⅱ calc.html · calc2.html)가 learn-track.js 로
-- 화면이 실제로 보이고 조작이 있는 동안의 시간만 세어, 기기 · 날짜 · 시(時) · 파트 · 안쪽 화면(section)마다 한 줄에 더합니다.
--   part     LEARN_SUBJECTS 의 파트 id (atc · crit · bio · calc · calc2 · phys · phys2 · algo · algograph · algonotion)
--   section  파트 안 어디: 단어장 = 탭(study · quiz · memo …), 미적분학Ⅱ = 단원(home · a1 … · vf …), 일반생물학 = 펼친 기작(home · elong …)
--   secs     본 시간(초). secs_win 은 그중 '새 창에서 크게 보기'로 본 시간
--   opens    연 횟수 (페이지를 열 때 · 5분 넘게 쉬었다 다시 볼 때 1)
-- 학생 화면에는 아무것도 보이지 않습니다. 관리자 사이트 '학생' 칸 '공부 페이지'(admin_learn_uses)는 파트별 합계 · 평균 · 시간대와
-- 본 학생 이름만 보여 주고, **학생별 본 시간은 화면에 내보내지 않습니다** (표에는 남음. 퀴즈 정답 · 서술 답안 같은 내용은 수집하지 않음).
-- visits.sql 뒤에 실행합니다 (is_admin_user 를 씁니다). 여러 번 실행해도 안전합니다. 2026-11-23 부터 기록합니다.

create table if not exists public.learn_uses (
  day      date not null,                       -- 한국 시간 기준 날짜
  hour     smallint not null check (hour between 0 and 23),   -- 한국 시간 기준 시
  device   text not null check (char_length(device) between 8 and 64),   -- visits 와 같은 기기 ID
  part     text not null check (part ~ '^[a-z][a-z0-9_]{0,23}$'),
  section  text not null default 'home' check (section ~ '^[a-z0-9][a-z0-9_-]{0,23}$'),
  user_id  uuid references public.profiles(id) on delete set null,      -- 로그인한 상태로 본 경우
  cohort   smallint,                            -- 42 · 43 (어느 사이트에서 열었는지)
  kind     text check (kind in ('phone', 'tablet', 'pc')),
  secs     int not null default 0,
  secs_win int not null default 0,
  opens    int not null default 0,
  last_at  timestamptz not null default now(),
  primary key (day, hour, device, part, section)
);
create index if not exists learn_uses_part_idx on public.learn_uses (part, day);

-- 표를 직접 읽고 쓰는 길은 막고, 아래 함수로만 씁니다.
alter table public.learn_uses enable row level security;
revoke all on public.learn_uses from anon, authenticated;

-- 기록: 30초쯤마다 그사이 본 시간을 더합니다. 로그인 여부는 서버의 auth.uid() 로 정합니다. 관리자 계정은 세지 않습니다.
-- 한 번에 150초, 한 줄(한 시간)에 3600초까지만 받아 엉뚱한 값이 쌓이지 않게 합니다.
create or replace function public.log_learn(p_device text, p_part text, p_section text, p_secs int, p_opens int,
                                            p_win boolean, p_kind text, p_cohort int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  t    timestamp := now() at time zone 'Asia/Seoul';
  s    int := least(greatest(coalesce(p_secs, 0), 0), 150);
  o    int := least(greatest(coalesce(p_opens, 0), 0), 3);
  sec  text := coalesce(nullif(p_section, ''), 'home');
begin
  if uid is not null and public.is_admin_user(uid) then return; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then return; end if;
  if p_part is null or p_part !~ '^[a-z][a-z0-9_]{0,23}$' then return; end if;
  if sec !~ '^[a-z0-9][a-z0-9_-]{0,23}$' then sec := 'home'; end if;
  if s = 0 and o = 0 then return; end if;
  insert into public.learn_uses (day, hour, device, part, section, user_id, cohort, kind, secs, secs_win, opens)
  values (t::date, extract(hour from t)::smallint, p_device, p_part, sec, uid,
          case when p_cohort in (42, 43) then p_cohort end,
          case when p_kind in ('phone', 'tablet', 'pc') then p_kind end,
          s, case when p_win then s else 0 end, o)
  on conflict (day, hour, device, part, section) do update
    set secs     = least(3600, learn_uses.secs + excluded.secs),
        secs_win = least(3600, learn_uses.secs_win + excluded.secs_win),
        opens    = least(1000, learn_uses.opens + excluded.opens),
        user_id  = coalesce(learn_uses.user_id, excluded.user_id),
        cohort   = coalesce(excluded.cohort, learn_uses.cohort),
        kind     = coalesce(excluded.kind, learn_uses.kind),
        last_at  = now();
end $$;
revoke execute on function public.log_learn(text, text, text, int, int, boolean, text, int) from public;
grant  execute on function public.log_learn(text, text, text, int, int, boolean, text, int) to anon, authenticated;

-- 파트별 합계 (이름 · 학번 없음). 사람 = 로그인 계정, 없으면 기기.
--   people 본 사람 수 · users 그중 로그인 계정 수 · secs 합계 · secs_win 새 창 · opens · avg_secs / median_secs 한 사람이 본 시간
--   back 이틀 넘게 본 사람 수 · sections 안쪽 화면별 {secs, people} · hours 시(0~23)별 초 · kinds 기기 종류별 초 · days 날짜별 {day, secs, people}
-- 사용 분석 에이전트도 이 함수를 읽습니다 (scripts/usage-agent/prompt.md).
create or replace function public.learn_use_stats(p_cohort int default null, p_days int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with u as (
    select *, coalesce(user_id::text, device) as who
      from learn_uses
     where day > (now() at time zone 'Asia/Seoul')::date - greatest(1, least(coalesce(p_days, 30), 365))
       and (p_cohort is null or coalesce(cohort, 42) = p_cohort)
  ),
  per as (select part, who, sum(secs) as secs, count(distinct day) as days from u group by part, who),
  tot as (
    select part,
           count(*) as people,
           round(avg(secs)) as avg_secs,
           round(percentile_cont(0.5) within group (order by secs)) as median_secs,
           count(*) filter (where days >= 2) as back
      from per group by part
  ),
  base as (
    select part, count(distinct user_id) as users, sum(secs) as secs, sum(secs_win) as secs_win, sum(opens) as opens, max(last_at) as last_at
      from u group by part
  )
  select jsonb_build_object(
    'since', (select min(day) from learn_uses),
    'days', greatest(1, least(coalesce(p_days, 30), 365)),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'part', b.part, 'people', t.people, 'users', b.users,
               'secs', b.secs, 'secs_win', b.secs_win, 'opens', b.opens, 'last_at', b.last_at,
               'avg_secs', t.avg_secs, 'median_secs', t.median_secs, 'back', t.back,
               'sections', (select jsonb_object_agg(section, jsonb_build_object('secs', secs, 'people', people))
                              from (select section, sum(secs) as secs, count(distinct who) as people from u where u.part = b.part group by section) x),
               'hours', (select jsonb_object_agg(hour, secs) from (select hour, sum(secs) as secs from u where u.part = b.part group by hour) x),
               'kinds', (select jsonb_object_agg(kind, secs) from (select coalesce(kind, 'pc') as kind, sum(secs) as secs from u where u.part = b.part group by 1) x),
               'by_day', (select jsonb_agg(jsonb_build_object('day', day, 'secs', secs, 'people', people) order by day)
                            from (select day, sum(secs) as secs, count(distinct who) as people from u where u.part = b.part group by day) x)
             ) order by b.secs desc)
        from base b join tot t using (part)), '[]'::jsonb));
$$;
revoke execute on function public.learn_use_stats(int, int) from public, anon, authenticated;

-- 관리자용: 위 합계 + 파트별로 본 학생(로그인 계정의 학번 · 이름) 목록. 학생별 본 시간은 내보내지 않습니다.
create or replace function public.admin_learn_uses(p_cohort int default null, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  since date := (now() at time zone 'Asia/Seoul')::date - greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'not admin'; end if;
  return public.learn_use_stats(p_cohort, p_days) || jsonb_build_object(
    'users', coalesce((
      select jsonb_object_agg(part, list)
        from (select g.part, jsonb_agg(jsonb_build_object('student_id', p.student_id, 'name', p.name) order by p.student_id) as list
                from (select distinct part, user_id from learn_uses
                       where user_id is not null and day > since
                         and (p_cohort is null or coalesce(cohort, 42) = p_cohort)) g
                join profiles p on p.id = g.user_id
               group by g.part) x), '{}'::jsonb));
end $$;
revoke execute on function public.admin_learn_uses(int, int) from public, anon;
grant  execute on function public.admin_learn_uses(int, int) to authenticated;
