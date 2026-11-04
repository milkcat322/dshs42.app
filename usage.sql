-- 사용 분석 에이전트 (usage-agent Edge Function)
-- 매일 밤 22시(한국 시간)에 방문 · 로그인 · 기능 사용 통계를 모아 Claude 가 분석하고,
-- "로그인 사용자를 늘리려면 / 학생이 더 편하려면 무엇을 고칠지" 제안을 여기에 남깁니다.
-- 관리 탭 '분석' 칸에서 봅니다. 쓰기는 서버(service_role)만 합니다.
-- visits.sql · ops.sql 뒤에 실행합니다. 여러 번 실행해도 안전합니다.
--
-- Claude 에 보내는 것은 날짜 · 시간대별 '수'뿐입니다. 이름 · 학번 · 할 일 · 일정 제목 등 내용은 보내지 않습니다.

create table if not exists public.usage_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  title       text not null,
  report      jsonb,              -- AI 분석 { headline, summary, login, usage, updates[], suggestions[], watch[] } (없으면 null)
  stats       jsonb not null      -- 분석에 쓴 수치 (usage_snapshot 결과 + 계산값)
);
create index if not exists usage_reports_created_idx on public.usage_reports (created_at desc);

alter table public.usage_reports enable row level security;
drop policy if exists usage_reports_admin_read on public.usage_reports;
create policy usage_reports_admin_read on public.usage_reports
  for select to authenticated using (public.is_admin_user(auth.uid()));
revoke all on public.usage_reports from anon;
grant select on public.usage_reports to authenticated;

-- 최근 p_days 일의 사용 통계 (관리자 계정 활동은 뺍니다). service_role 만 부를 수 있습니다.
create or replace function public.usage_snapshot(p_days int default 14)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  n int := least(greatest(coalesce(p_days, 14), 1), 60);
  since date := today - (n - 1);
begin
  return jsonb_build_object(
    'today', today,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d::date,
        'devices',     (select count(*) from visits v where v.day = d::date),
        'logged_in',   (select count(*) from visits v where v.day = d::date and v.logged_in),
        'users',       (select count(distinct v.user_id) from visits v where v.day = d::date),
        'phone',       (select count(*) from visits v where v.day = d::date and v.kind = 'phone'),
        'pc',          (select count(*) from visits v where v.day = d::date and v.kind = 'pc'),
        'tablet',      (select count(*) from visits v where v.day = d::date and v.kind = 'tablet'),
        'guest_phone', (select count(*) from visits v where v.day = d::date and v.kind = 'phone' and not v.logged_in),
        'standalone',  (select count(*) from visits v where v.day = d::date and v.standalone),
        -- 이날 처음 본 기기 / 전에도 왔던 기기
        'new_devices', (select count(*) from visits v where v.day = d::date
                          and not exists (select 1 from visits o where o.device = v.device and o.day < v.day)),
        'guest_returning', (select count(*) from visits v where v.day = d::date and not v.logged_in
                          and exists (select 1 from visits o where o.device = v.device and o.day < v.day)),
        -- 그전엔 이 기기에서 비로그인으로만 쓰다가 이날 로그인
        'guest_to_login', (select count(*) from visits v where v.day = d::date and v.logged_in
                          and public.visit_was_guest(v.device, v.day)),
        'signups',     (select count(*) from profiles p where not p.is_admin
                          and (p.created_at at time zone 'Asia/Seoul')::date = d::date),
        'dshs_linked', (select count(*) from dshs_links l join profiles p on p.id = l.user_id
                          where not p.is_admin and (l.linked_at at time zone 'Asia/Seoul')::date = d::date),
        'todos_added', (select count(*) from todos t join profiles p on p.id = t.user_id
                          where not p.is_admin and (t.created_at at time zone 'Asia/Seoul')::date = d::date),
        'todos_done',  (select count(*) from todos t join profiles p on p.id = t.user_id
                          where not p.is_admin and (t.done_at at time zone 'Asia/Seoul')::date = d::date),
        'events_added',(select count(*) from events e join profiles p on p.id = e.user_id
                          where not p.is_admin and e.source_key is null and (e.created_at at time zone 'Asia/Seoul')::date = d::date),
        'asg_posted',  (select count(*) from assignments a left join profiles p on p.id = a.created_by
                          where not coalesce(p.is_admin, false) and (a.created_at at time zone 'Asia/Seoul')::date = d::date),
        'asg_checked', (select count(*) from assignment_done x join profiles p on p.id = x.user_id
                          where not p.is_admin and (x.done_at at time zone 'Asia/Seoul')::date = d::date),
        'asg_personal',(select count(*) from assignment_personal x join profiles p on p.id = x.user_id
                          where not p.is_admin and (x.updated_at at time zone 'Asia/Seoul')::date = d::date),
        'status_set',  (select count(*) from student_status s
                          where (s.updated_at at time zone 'Asia/Seoul')::date = d::date),
        'feedback',    (select count(*) from feedback f join profiles p on p.id = f.user_id
                          where not p.is_admin and (f.created_at at time zone 'Asia/Seoul')::date = d::date),
        'push_on',     (select count(*) from push_subscriptions s join profiles p on p.id = s.user_id
                          where not p.is_admin and (s.created_at at time zone 'Asia/Seoul')::date = d::date)
      ) order by d)
      from generate_series(since, today, interval '1 day') d), '[]'::jsonb),
    -- 시간대별 첫 방문 (한국 시간 0~23시) · 로그인 / 비로그인
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h, 'logged_in', li, 'guest', g) order by h) from (
        select extract(hour from v.first_at at time zone 'Asia/Seoul')::int as h,
               count(*) filter (where v.logged_in) as li, count(*) filter (where not v.logged_in) as g
          from visits v where v.day >= since group by 1) x), '[]'::jsonb),
    -- 기간 동안 며칠 왔는지 (기기 기준, 로그인 해 본 기기 / 비로그인으로만 쓴 기기)
    'device_days', coalesce((
      select jsonb_agg(jsonb_build_object('days', dd, 'login_devices', li, 'guest_devices', g) order by dd) from (
        select dd, count(*) filter (where ever) as li, count(*) filter (where not ever) as g from (
          select device, count(*) as dd, bool_or(logged_in) as ever from visits where day >= since group by device) a
        group by dd) b), '[]'::jsonb),
    'totals', jsonb_build_object(
      'roster',        (select count(*) from roster),
      'students',      (select count(*) from profiles where not is_admin),
      'dshs_linked',   (select count(*) from dshs_links l join profiles p on p.id = l.user_id where not p.is_admin),
      'push_users',    (select count(distinct s.user_id) from push_subscriptions s join profiles p on p.id = s.user_id where not p.is_admin),
      'todo_users',    (select count(distinct t.user_id) from todos t join profiles p on p.id = t.user_id where not p.is_admin),
      'event_users',   (select count(distinct e.user_id) from events e join profiles p on p.id = e.user_id where not p.is_admin and e.source_key is null),
      'check_users',   (select count(distinct x.user_id) from assignment_done x join profiles p on p.id = x.user_id where not p.is_admin),
      'status_users',  (select count(*) from student_status),
      'active_users_7d', (select count(distinct user_id) from visits where day > today - 7),
      'devices_7d',    (select count(distinct device) from visits where day > today - 7),
      'guest_only_devices_7d', (select count(*) from (select device from visits where day > today - 7
                                  group by device having not bool_or(logged_in)) g),
      'visits_since',  (select min(day) from visits)
    )
  );
end $$;
revoke execute on function public.usage_snapshot(int) from public, anon, authenticated;
grant  execute on function public.usage_snapshot(int) to service_role;

-- 보고서는 90일만 보관합니다 (usage-agent 가 실행할 때 지웁니다)

/* ------------------------------------------------------------
   주기 실행 — 매일 22시 (한국 시간). UTC 로 13시입니다. SQL Editor 에서 한 번만 실행합니다.
   키를 붙여 넣지 않도록 send-reminders cron 에 이미 들어 있는 Authorization 헤더를 그대로 씁니다.

   select cron.schedule('dshs-study-usage-agent', '0 13 * * *', format(
     $f$select net.http_post(
          url := 'https://jsanpwlleufzgglqkrkv.supabase.co/functions/v1/usage-agent',
          headers := %L::jsonb,
          timeout_milliseconds := 30000)$f$,
     (select substring(command from 'headers\s*:=\s*''([^'']+)''')
        from cron.job where jobname = 'dshs-study-reminders')));
------------------------------------------------------------ */
