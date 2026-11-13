-- 관리 탭의 방문 기기 수 (로그인하지 않은 접속자 포함)
-- 기기마다 브라우저에 저장한 무작위 ID 로 하루 한 줄만 남깁니다.
-- 비로그인 방문은 익명입니다. 로그인한 상태로 열면 그 계정(user_id)과 처음 로그인한 시각(login_at)을 함께 남겨
-- 관리자가 '오늘 로그인한 학생'과 '비로그인으로 쓰다가 로그인한 기기'를 볼 수 있게 합니다.
-- 학생 화면에는 아무것도 보이지 않고, 관리자만 admin_visits() 로 보며 운영 점검(ops-agent)이 ops_visit_logins() 로 씁니다.
-- groups.sql 뒤에 실행합니다 (is_admin_user 를 씁니다).

create table if not exists public.visits (
  day         date not null,                       -- 한국 시간 기준 날짜
  device      text not null check (char_length(device) between 8 and 64),
  kind        text not null check (kind in ('phone', 'tablet', 'pc')),
  logged_in   boolean not null default false,      -- 그날 한 번이라도 로그인한 상태로 열었는지
  standalone  boolean not null default false,      -- 홈 화면에 설치한 앱으로 열었는지
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  primary key (day, device)
);
alter table public.visits add column if not exists user_id  uuid references public.profiles(id) on delete set null;
alter table public.visits add column if not exists login_at timestamptz;   -- 그날 처음 로그인한 상태로 연 시각
-- 비로그인 시간표 막힘 화면(로그인하면 검색할 수 있어요)을 그날 처음 본 시각 · 그 화면의 로그인 버튼을 처음 누른 시각
alter table public.visits add column if not exists gate_seen_at  timestamptz;
alter table public.visits add column if not exists gate_click_at timestamptz;
create index if not exists visits_device_idx on public.visits (device, day);
-- 어느 기수 사이트에서 연 방문인지 (42 dshs42.app · 43 dshs43.app). 관리자 사이트가 자기 기수 것만 봅니다.
-- 기수를 보내기 전(2026-11-13 전)에 남은 줄은 비어 있고 42기로 봅니다 (43기 학생이 로그인한 적 있는 기기는 아래에서 43 으로 채움).
alter table public.visits add column if not exists cohort smallint;
update public.visits v set cohort = 43
 where v.cohort is null
   and exists (select 1 from public.visits w join public.profiles p on p.id = w.user_id
                where w.device = v.device and p.student_id between 1000 and 1999);

-- 표를 직접 읽고 쓰는 길은 막고, 아래 두 함수로만 씁니다.
alter table public.visits enable row level security;
revoke all on public.visits from anon, authenticated;

-- 방문 기록: 로그인 여부는 브라우저가 보낸 값이 아니라 서버의 auth.uid() 로 정합니다.
-- 관리자 계정의 방문은 세지 않습니다.
-- p_cohort: 학생 사이트가 보내는 기수(42 · 43). 예전 화면은 3개 인자 함수(기수 없음)를 부릅니다.
create or replace function public.log_visit(p_device text, p_kind text, p_standalone boolean, p_cohort int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c smallint := case when p_cohort in (42, 43) then p_cohort end;
begin
  if uid is not null and public.is_admin_user(uid) then return; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then return; end if;
  if p_kind not in ('phone', 'tablet', 'pc') then return; end if;
  insert into public.visits (day, device, kind, logged_in, standalone, user_id, login_at, cohort)
  values ((now() at time zone 'Asia/Seoul')::date, p_device, p_kind, uid is not null, coalesce(p_standalone, false),
          uid, case when uid is not null then now() end, c)
  on conflict (day, device) do update
    set logged_in  = visits.logged_in or excluded.logged_in,
        user_id    = coalesce(visits.user_id, excluded.user_id),
        login_at   = coalesce(visits.login_at, excluded.login_at),
        standalone = visits.standalone or excluded.standalone,
        kind       = excluded.kind,
        cohort     = coalesce(excluded.cohort, visits.cohort),
        last_at    = now();
end $$;
revoke execute on function public.log_visit(text, text, boolean, int) from public;
grant  execute on function public.log_visit(text, text, boolean, int) to anon, authenticated;

create or replace function public.log_visit(p_device text, p_kind text, p_standalone boolean)
returns void language sql volatile security definer set search_path = public as $$
  select public.log_visit(p_device, p_kind, p_standalone, null::int);
$$;
revoke execute on function public.log_visit(text, text, boolean) from public;
grant  execute on function public.log_visit(text, text, boolean) to anon, authenticated;

-- 막힘 화면 기록: 'seen'(화면을 봄) · 'click'(그 화면의 로그인 버튼을 누름). 비로그인일 때만 남깁니다.
-- 사용 분석 에이전트가 "본 기기 → 누른 기기 → 로그인한 기기"로 로그인 유도 효과를 봅니다 (usage_snapshot).
create or replace function public.log_gate(p_device text, p_kind text, p_standalone boolean, p_event text, p_cohort int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  c smallint := case when p_cohort in (42, 43) then p_cohort end;
begin
  if auth.uid() is not null then return; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then return; end if;
  if p_kind not in ('phone', 'tablet', 'pc') or p_event not in ('seen', 'click') then return; end if;
  insert into public.visits (day, device, kind, standalone, gate_seen_at, gate_click_at, cohort)
  values ((now() at time zone 'Asia/Seoul')::date, p_device, p_kind, coalesce(p_standalone, false),
          now(), case when p_event = 'click' then now() end, c)
  on conflict (day, device) do update
    set gate_seen_at  = coalesce(visits.gate_seen_at, now()),
        gate_click_at = case when p_event = 'click' then coalesce(visits.gate_click_at, now()) else visits.gate_click_at end,
        cohort        = coalesce(excluded.cohort, visits.cohort),
        last_at       = now();
end $$;
revoke execute on function public.log_gate(text, text, boolean, text, int) from public;
grant  execute on function public.log_gate(text, text, boolean, text, int) to anon, authenticated;

create or replace function public.log_gate(p_device text, p_kind text, p_standalone boolean, p_event text)
returns void language sql volatile security definer set search_path = public as $$
  select public.log_gate(p_device, p_kind, p_standalone, p_event, null::int);
$$;
revoke execute on function public.log_gate(text, text, boolean, text) from public;
grant  execute on function public.log_gate(text, text, boolean, text) to anon, authenticated;

-- 이 기기가 p_day 전에는 비로그인으로만 썼는지 (로그인한 날 없이 비로그인으로 연 날이 하루 이상)
create or replace function public.visit_was_guest(p_device text, p_day date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.visits where device = p_device and day < p_day and not logged_in)
     and not exists (select 1 from public.visits where device = p_device and day < p_day and logged_in);
$$;
revoke execute on function public.visit_was_guest(text, date) from public, anon, authenticated;

-- 운영 점검용: p_since 이후 처음 로그인한, 그전엔 비로그인으로만 쓰던 기기와 그 학생 (service_role 전용)
create or replace function public.ops_visit_logins(p_since timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.name, 'student_id', p.student_id, 'kind', v.kind, 'at', v.login_at,
           'guest_days', (select count(*) from public.visits g where g.device = v.device and g.day < v.day and not g.logged_in))
           order by v.login_at), '[]'::jsonb)
    from public.visits v join public.profiles p on p.id = v.user_id
   where v.login_at > p_since and public.visit_was_guest(v.device, v.day);
$$;
revoke execute on function public.ops_visit_logins(timestamptz) from public, anon, authenticated;
grant  execute on function public.ops_visit_logins(timestamptz) to service_role;

-- 관리자용 요약: 최근 p_days 일의 날짜별 기기 수. p_cohort(42 · 43)를 주면 그 기수 사이트 방문만 (기수 없는 예전 줄은 42기)
drop function if exists public.admin_visits(int);
create or replace function public.admin_visits(p_days int default 7, p_cohort int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  n int := least(greatest(coalesce(p_days, 7), 1), 60);
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception '관리자만 볼 수 있어요' using errcode = '42501';
  end if;
  return (
    with vv as (
      select * from public.visits v
       where v.day > today - 60 and (p_cohort is null or coalesce(v.cohort, 42) = p_cohort)
    )
    select jsonb_build_object(
      'days', coalesce((
        select jsonb_agg(jsonb_build_object(
          'day', d::date,
          'total',      (select count(*) from vv v where v.day = d::date),
          'logged_in',  (select count(*) from vv v where v.day = d::date and v.logged_in),
          'phone',      (select count(*) from vv v where v.day = d::date and v.kind = 'phone'),
          'tablet',     (select count(*) from vv v where v.day = d::date and v.kind = 'tablet'),
          'pc',         (select count(*) from vv v where v.day = d::date and v.kind = 'pc'),
          'guest_phone',(select count(*) from vv v where v.day = d::date and v.kind = 'phone' and not v.logged_in),
          'standalone', (select count(*) from vv v where v.day = d::date and v.standalone)
        ) order by d)
        from generate_series(today - (n - 1), today, interval '1 day') d), '[]'::jsonb),
      'week_devices', (select count(distinct device) from vv where day > today - 7),
      -- 오늘 로그인한 학생 (계정 기록을 남기기 전에 들어온 기기는 이름 없이 셉니다)
      'today_users', coalesce((
        select jsonb_agg(jsonb_build_object('name', p.name, 'student_id', p.student_id, 'kind', v.kind,
                                            'at', coalesce(v.login_at, v.first_at), 'was_guest', public.visit_was_guest(v.device, v.day))
                         order by coalesce(v.login_at, v.first_at) desc)
          from vv v join public.profiles p on p.id = v.user_id
         where v.day = today), '[]'::jsonb),
      'today_unknown', (select count(*) from vv v where v.day = today and v.logged_in and v.user_id is null)
    )
  );
end $$;
revoke execute on function public.admin_visits(int, int) from public, anon;
grant  execute on function public.admin_visits(int, int) to authenticated;
