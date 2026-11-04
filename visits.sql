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
create index if not exists visits_device_idx on public.visits (device, day);

-- 표를 직접 읽고 쓰는 길은 막고, 아래 두 함수로만 씁니다.
alter table public.visits enable row level security;
revoke all on public.visits from anon, authenticated;

-- 방문 기록: 로그인 여부는 브라우저가 보낸 값이 아니라 서버의 auth.uid() 로 정합니다.
-- 관리자 계정의 방문은 세지 않습니다.
create or replace function public.log_visit(p_device text, p_kind text, p_standalone boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is not null and public.is_admin_user(uid) then return; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then return; end if;
  if p_kind not in ('phone', 'tablet', 'pc') then return; end if;
  insert into public.visits (day, device, kind, logged_in, standalone, user_id, login_at)
  values ((now() at time zone 'Asia/Seoul')::date, p_device, p_kind, uid is not null, coalesce(p_standalone, false),
          uid, case when uid is not null then now() end)
  on conflict (day, device) do update
    set logged_in  = visits.logged_in or excluded.logged_in,
        user_id    = coalesce(visits.user_id, excluded.user_id),
        login_at   = coalesce(visits.login_at, excluded.login_at),
        standalone = visits.standalone or excluded.standalone,
        kind       = excluded.kind,
        last_at    = now();
end $$;
revoke execute on function public.log_visit(text, text, boolean) from public;
grant  execute on function public.log_visit(text, text, boolean) to anon, authenticated;

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

-- 관리자용 요약: 최근 p_days 일의 날짜별 기기 수
create or replace function public.admin_visits(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  n int := least(greatest(coalesce(p_days, 7), 1), 60);
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception '관리자만 볼 수 있어요' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d::date,
        'total',      (select count(*) from public.visits v where v.day = d::date),
        'logged_in',  (select count(*) from public.visits v where v.day = d::date and v.logged_in),
        'phone',      (select count(*) from public.visits v where v.day = d::date and v.kind = 'phone'),
        'tablet',     (select count(*) from public.visits v where v.day = d::date and v.kind = 'tablet'),
        'pc',         (select count(*) from public.visits v where v.day = d::date and v.kind = 'pc'),
        'guest_phone',(select count(*) from public.visits v where v.day = d::date and v.kind = 'phone' and not v.logged_in),
        'standalone', (select count(*) from public.visits v where v.day = d::date and v.standalone)
      ) order by d)
      from generate_series(today - (n - 1), today, interval '1 day') d), '[]'::jsonb),
    'week_devices', (select count(distinct device) from public.visits where day > today - 7),
    -- 오늘 로그인한 학생 (계정 기록을 남기기 전에 들어온 기기는 이름 없이 셉니다)
    'today_users', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.name, 'student_id', p.student_id, 'kind', v.kind,
                                          'at', coalesce(v.login_at, v.first_at), 'was_guest', public.visit_was_guest(v.device, v.day))
                       order by coalesce(v.login_at, v.first_at) desc)
        from public.visits v join public.profiles p on p.id = v.user_id
       where v.day = today), '[]'::jsonb),
    'today_unknown', (select count(*) from public.visits v where v.day = today and v.logged_in and v.user_id is null)
  );
end $$;
revoke execute on function public.admin_visits(int) from public, anon;
grant  execute on function public.admin_visits(int) to authenticated;
