-- 로그인 이탈 분석: 'dshs.app 계정으로 시작하기'를 누른 뒤 어디서 멈췄는지 단계별로 남깁니다.
-- 시도(attempt)는 버튼을 누를 때 브라우저가 만든 무작위 ID 로 묶습니다. 이름 · 학번은 남기지 않고(성공한 시도만 계정 id),
-- 학생 화면에는 아무것도 보이지 않습니다. 관리자 사이트 '학생' 칸의 '로그인 이탈'이 admin_login_funnel() 로 분석해 보여 줍니다.
-- visits.sql 뒤에 실행합니다 (막힘 화면을 본 기기 수를 visits 에서 읽습니다).
--
-- 단계(step)
--   click       시작 버튼을 누름 (reason = 누른 곳: gate 시간표 막힘 화면 · sheet 시작하기 창이나 설정 창)
--   start_fail  로그인 주소를 받지 못함 (reason = 'net' 서버에 닿지 못함 · 'server' 서버가 거절)
--   leave       dshs.app 로그인 화면으로 떠남 (reason = page · popup · kakao)
--   done        로그인을 마치고 돌아와 이 사이트에 로그인됨
--   fail        돌아왔지만 실패 (reason = denied 취소 · notstudent 명단에 없음 · expired 시간 초과 · failed dshs.app 오류 · verify 토큰 처리 실패 · profile 프로필 없음 · mismatch)
-- env: 브라우저 종류 (ios-safari · ios-chrome · ios-app · android-chrome · android-samsung · android-app · kakao · inapp · pc · pc-app)

create table if not exists public.login_steps (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  day      date not null default (now() at time zone 'Asia/Seoul')::date,
  device   text not null check (char_length(device) between 8 and 64),
  attempt  text not null check (char_length(attempt) between 8 and 64),
  step     text not null check (step in ('click', 'start_fail', 'leave', 'done', 'fail')),
  reason   text check (char_length(reason) <= 40),
  env      text not null check (env in ('ios-safari', 'ios-chrome', 'ios-app', 'android-chrome', 'android-samsung', 'android-app', 'kakao', 'inapp', 'pc', 'pc-app')),
  user_id  uuid references public.profiles(id) on delete set null
);
create index if not exists login_steps_day_idx on public.login_steps (day);
create index if not exists login_steps_attempt_idx on public.login_steps (attempt);
-- 어느 기수 사이트에서 시작한 로그인인지 (42 · 43). 비어 있는 예전 줄은 42기로 보고,
-- 43기 학생이 로그인한 적 있는 기기(visits.cohort = 43)의 줄은 43 으로 채웁니다. visits.sql 을 먼저 실행합니다.
alter table public.login_steps add column if not exists cohort smallint;
update public.login_steps s set cohort = 43
 where s.cohort is null
   and exists (select 1 from public.visits v where v.device = s.device and v.cohort = 43);

-- 표를 직접 읽고 쓰는 길은 막고, 아래 두 함수로만 씁니다.
alter table public.login_steps enable row level security;
revoke all on public.login_steps from anon, authenticated;

-- 기록: 누구나(로그인 전 포함). 관리자 계정은 세지 않고, 한 기기에서 하루 80줄까지만 받습니다.
-- p_cohort: 학생 사이트가 보내는 기수(42 · 43). 예전 화면은 5개 인자 함수(기수 없음)를 부릅니다.
create or replace function public.log_login_step(p_device text, p_attempt text, p_step text, p_reason text, p_env text, p_cohort int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Seoul')::date;
  c smallint := case when p_cohort in (42, 43) then p_cohort end;
begin
  if uid is not null and public.is_admin_user(uid) then return; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then return; end if;
  if p_attempt is null or char_length(p_attempt) not between 8 and 64 then return; end if;
  if p_step not in ('click', 'start_fail', 'leave', 'done', 'fail') then return; end if;
  if p_env not in ('ios-safari', 'ios-chrome', 'ios-app', 'android-chrome', 'android-samsung', 'android-app', 'kakao', 'inapp', 'pc', 'pc-app') then return; end if;
  if (select count(*) from public.login_steps where day = today and device = p_device) >= 80 then return; end if;
  insert into public.login_steps (day, device, attempt, step, reason, env, user_id, cohort)
  values (today, p_device, p_attempt, p_step, left(nullif(p_reason, ''), 40), p_env, case when p_step = 'done' then uid end, c);
end $$;
revoke execute on function public.log_login_step(text, text, text, text, text, int) from public;
grant  execute on function public.log_login_step(text, text, text, text, text, int) to anon, authenticated;

create or replace function public.log_login_step(p_device text, p_attempt text, p_step text, p_reason text, p_env text)
returns void language sql volatile security definer set search_path = public as $$
  select public.log_login_step(p_device, p_attempt, p_step, p_reason, p_env, null::int);
$$;
revoke execute on function public.log_login_step(text, text, text, text, text) from public;
grant  execute on function public.log_login_step(text, text, text, text, text) to anon, authenticated;

-- 관리자용 분석: 최근 p_days 일의 시도마다 결과(outcome)를 정하고 묶어서 돌려줍니다.
--   outcome: done · fail:<reason> · start_fail · abandon(dshs.app 로그인 화면에서 15분 넘게 돌아오지 않음) · pending(아직 15분 안) · click_only(누르고 떠나지도 못함)
-- p_cohort(42 · 43)를 주면 그 기수 사이트의 시도만 (기수 없는 예전 줄은 42기)
drop function if exists public.admin_login_funnel(int);
create or replace function public.admin_login_funnel(p_days int default 14, p_cohort int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  n int := least(greatest(coalesce(p_days, 14), 1), 60);
  since date := today - (n - 1);
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception '관리자만 볼 수 있어요' using errcode = '42501';
  end if;
  return (
    with ls as (
      select * from public.login_steps
       where day >= since and (p_cohort is null or coalesce(cohort, 42) = p_cohort)
    ), vv as (
      select * from public.visits
       where day >= since and (p_cohort is null or coalesce(cohort, 42) = p_cohort)
    ), a as (
      select attempt,
             min(at) as at,
             min(day) as day,
             (array_agg(env order by at))[1] as env,
             (array_agg(reason order by at) filter (where step = 'click'))[1] as src,
             bool_or(step = 'click') as clicked,
             bool_or(step = 'leave') as left_,
             bool_or(step = 'start_fail') as start_fail,
             bool_or(step = 'done') as ok,
             (array_agg(reason order by at desc) filter (where step = 'fail'))[1] as fail_reason,
             (array_agg(reason order by at desc) filter (where step = 'start_fail'))[1] as sf_reason,
             max(at) filter (where step in ('done', 'fail')) - min(at) as took
        from ls
       group by attempt
    ), o as (
      select a.*,
             case when ok then 'done'
                  when fail_reason is not null then 'fail:' || fail_reason
                  when start_fail then 'start_fail'
                  when left_ and at > now() - interval '15 minutes' then 'pending'
                  when left_ then 'abandon'
                  else 'click_only' end as outcome
        from a
    )
    select jsonb_build_object(
      'days', n,
      'since', since,
      -- 막힘 화면을 본 기기 · 그 화면의 시작 버튼을 누른 기기 (visits.sql, 기기 × 날짜)
      'gate_seen',  (select count(*) from vv where gate_seen_at is not null),
      'gate_click', (select count(*) from vv where gate_click_at is not null),
      'attempts',   (select count(*) from o),
      'done',       (select count(*) from o where outcome = 'done'),
      'devices',    (select count(distinct device) from ls),
      'devices_done', (select count(distinct device) from ls where step = 'done'),
      'median_sec', (select round(extract(epoch from percentile_cont(0.5) within group (order by took))) from o where outcome = 'done' and took is not null),
      'outcomes',   coalesce((select jsonb_object_agg(outcome, c) from (select outcome, count(*) c from o group by outcome) x), '{}'::jsonb),
      'envs',       coalesce((select jsonb_agg(jsonb_build_object('env', env, 'attempts', c, 'done', d, 'abandon', ab) order by c desc)
                               from (select env, count(*) c, count(*) filter (where outcome = 'done') d,
                                            count(*) filter (where outcome = 'abandon') ab
                                       from o group by env) x), '[]'::jsonb),
      'sources',    coalesce((select jsonb_object_agg(coalesce(src, 'none'), c) from (select src, count(*) c from o group by src) x), '{}'::jsonb),
      'daily',      coalesce((select jsonb_agg(jsonb_build_object('day', d::date,
                                 'attempts', (select count(*) from o where o.day = d::date),
                                 'done', (select count(*) from o where o.day = d::date and outcome = 'done')) order by d)
                               from generate_series(since, today, interval '1 day') d), '[]'::jsonb),
      'recent',     coalesce((select jsonb_agg(jsonb_build_object('at', at, 'env', env, 'outcome', outcome, 'src', src, 'detail', sf_reason) order by at desc)
                               from (select * from o where outcome not in ('done', 'pending') order by at desc limit 30) x), '[]'::jsonb)
    ) from (select 1) one
  );
end $$;
revoke execute on function public.admin_login_funnel(int, int) from public, anon;
grant  execute on function public.admin_login_funnel(int, int) to authenticated;
