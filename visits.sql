-- 관리 탭의 방문 기기 수 (로그인하지 않은 접속자 포함)
-- 기기마다 브라우저에 저장한 무작위 ID 로 하루 한 줄만 남깁니다. 이름 · 학번 · 계정은 저장하지 않습니다.
-- 학생 화면에는 아무것도 보이지 않고, 숫자는 관리자만 admin_visits() 로 봅니다.
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
  insert into public.visits (day, device, kind, logged_in, standalone)
  values ((now() at time zone 'Asia/Seoul')::date, p_device, p_kind, uid is not null, coalesce(p_standalone, false))
  on conflict (day, device) do update
    set logged_in  = visits.logged_in or excluded.logged_in,
        standalone = visits.standalone or excluded.standalone,
        kind       = excluded.kind,
        last_at    = now();
end $$;
revoke execute on function public.log_visit(text, text, boolean) from public;
grant  execute on function public.log_visit(text, text, boolean) to anon, authenticated;

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
    'week_devices', (select count(distinct device) from public.visits where day > today - 7)
  );
end $$;
revoke execute on function public.admin_visits(int) from public, anon;
grant  execute on function public.admin_visits(int) to authenticated;
