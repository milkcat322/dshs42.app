-- 화면 기능 사용 기록 (DB 에 자료가 남지 않는 기능을 몇 명이 쓰는지 세기)
-- 기말고사 · 급식 · 공부 탭, 시간표의 학점 계산 · 분반 목록 · 겹치는 수업 · 비교 · 배경화면 처럼 눌러 보기만 하는 기능은
-- 그동안 쓴 흔적이 없어, 처음 연 날 기기마다 기능별로 하루 한 줄만 남깁니다 (dshs-study.js 의 logFeature).
-- 학생 화면에는 아무것도 보이지 않고, 관리자 사이트 '학생' 칸 '화면 기능 사용'(admin_feature_uses)과
-- 사용 분석 에이전트(usage_snapshot 의 features)가 씁니다. 잘 안 쓰는 기능을 없앨지 판단하는 근거입니다.
-- visits.sql 뒤에 실행합니다 (is_admin_user 를 씁니다). 여러 번 실행해도 안전합니다. 2026-11-16 부터 기록합니다.

create table if not exists public.feature_uses (
  day      date not null,                       -- 한국 시간 기준 날짜
  device   text not null check (char_length(device) between 8 and 64),   -- visits 와 같은 기기 ID
  feature  text not null check (feature ~ '^[a-z][a-z0-9_]{1,23}$'),
  user_id  uuid references public.profiles(id) on delete set null,      -- 로그인한 상태로 연 경우
  cohort   smallint,                            -- 42 · 43 (어느 사이트에서 열었는지)
  first_at timestamptz not null default now(),
  primary key (day, device, feature)
);
create index if not exists feature_uses_feature_idx on public.feature_uses (feature, day);

-- 표를 직접 읽고 쓰는 길은 막고, 아래 함수로만 씁니다.
alter table public.feature_uses enable row level security;
revoke all on public.feature_uses from anon, authenticated;

-- 기능 사용 기록: 로그인 여부는 서버의 auth.uid() 로 정합니다. 관리자 계정은 세지 않습니다.
create or replace function public.log_feature(p_device text, p_feature text, p_cohort int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is not null and public.is_admin_user(uid) then return; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then return; end if;
  if p_feature is null or p_feature !~ '^[a-z][a-z0-9_]{1,23}$' then return; end if;
  insert into public.feature_uses (day, device, feature, user_id, cohort)
  values ((now() at time zone 'Asia/Seoul')::date, p_device, p_feature, uid,
          case when p_cohort in (42, 43) then p_cohort end)
  on conflict (day, device, feature) do update
    set user_id = coalesce(feature_uses.user_id, excluded.user_id),
        cohort  = coalesce(excluded.cohort, feature_uses.cohort);
end $$;
revoke execute on function public.log_feature(text, text, int) from public;
grant  execute on function public.log_feature(text, text, int) to anon, authenticated;

-- 관리자용: 기능별로 쓴 학생(로그인 계정의 학번 · 이름) 목록 · 기기 수 · 최근 7일 기기 수 · 마지막으로 연 시각.
-- p_cohort(42 · 43)를 주면 그 기수 사이트 기록만 (기수 없는 줄은 42기).
create or replace function public.admin_feature_uses(p_cohort int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'not admin'; end if;
  return jsonb_build_object(
    'since', (select min(day) from feature_uses),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
               'feature', feature,
               'users', users,
               'devices', devices,
               'devices_7d', devices_7d,
               'last_at', last_at) order by feature)
        from (select feature,
                     coalesce((select jsonb_agg(jsonb_build_object('student_id', p.student_id, 'name', p.name) order by p.student_id)
                                 from profiles p where p.id in (select g.user_id from feature_uses g
                                                                 where g.feature = u.feature
                                                                   and (p_cohort is null or coalesce(g.cohort, 42) = p_cohort))), '[]'::jsonb) as users,
                     count(distinct device) as devices,
                     count(distinct device) filter (where day > today - 7) as devices_7d,
                     max(first_at) as last_at
                from feature_uses u
               where p_cohort is null or coalesce(cohort, 42) = p_cohort
               group by feature) f), '[]'::jsonb));
end $$;
revoke execute on function public.admin_feature_uses(int) from public, anon;
grant  execute on function public.admin_feature_uses(int) to authenticated;

-- 사용 분석 에이전트용 (usage.sql 의 usage_snapshot 이 부름): 기능별 쓴 학생 수 · 기기 수 · 최근 7일 기기 수 · 기록 시작일
create or replace function public.feature_use_totals()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'since', (select min(day) from feature_uses),
    'by_feature', coalesce((select jsonb_object_agg(feature, jsonb_build_object(
                     'users', users, 'devices', devices, 'devices_7d', devices_7d))
                     from (select feature, count(distinct user_id) as users, count(distinct device) as devices,
                                  count(distinct device) filter (where day > (now() at time zone 'Asia/Seoul')::date - 7) as devices_7d
                             from feature_uses group by feature) f), '{}'::jsonb));
$$;
revoke execute on function public.feature_use_totals() from public, anon, authenticated;
grant  execute on function public.feature_use_totals() to service_role;
