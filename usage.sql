-- 사용 분석 에이전트 (관리자 노트북의 Claude Code · scripts/usage-agent)
-- 매일 밤 22시(한국 시간)에 관리자 노트북의 Claude Code 가 Supabase MCP 로 usage_snapshot() 과 집계 쿼리를 읽어
-- 로그인 / 비로그인 현황 · 사용 양상 · 업데이트 반응을 분석하고 "무엇을 고칠지" 제안을 save_usage_report() 로 남깁니다.
-- 저장하면 usage-agent Edge Function 이 관리자 기기에 푸시합니다. 관리 탭 '분석' 칸에서 봅니다.
-- API 키는 쓰지 않습니다 (노트북의 Claude Code 로그인을 씁니다). 노트북이 꺼져 있었으면 다음에 켰을 때 밀린 분석을 합니다.
-- visits.sql · ops.sql 뒤에 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 보고서에는 이름 · 학번 · 할 일 · 일정 제목 같은 개인 내용을 넣지 않습니다 (수와 비율만).

create table if not exists public.usage_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  title       text not null,
  report      jsonb not null,     -- 분석 { headline, summary, login, usage, updates[], suggestions[], watch[], caveats }
  stats       jsonb not null      -- 저장할 때의 usage_snapshot(14)
);
create index if not exists usage_reports_created_idx on public.usage_reports (created_at desc);

alter table public.usage_reports enable row level security;
drop policy if exists usage_reports_admin_read on public.usage_reports;
create policy usage_reports_admin_read on public.usage_reports
  for select to authenticated using (public.is_admin_user(auth.uid()));
revoke all on public.usage_reports from anon;
grant select on public.usage_reports to authenticated;

-- 최근 p_days 일의 사용 통계 (관리자 계정 활동은 뺍니다). 학생 · 관리자 화면에서는 부를 수 없습니다 (MCP · service_role 만).
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
        -- 비로그인 시간표 막힘 화면: 본 기기 · 로그인 버튼 누른 기기 · 본 그날 로그인까지 한 기기
        'gate_seen',   (select count(*) from visits v where v.day = d::date and v.gate_seen_at is not null),
        'gate_click',  (select count(*) from visits v where v.day = d::date and v.gate_click_at is not null),
        'gate_login',  (select count(*) from visits v where v.day = d::date and v.gate_seen_at is not null and v.logged_in),
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
      'visits_since',  (select min(day) from visits),
      'gate_since',    (select min(day) from visits where gate_seen_at is not null),
      -- 기간 동안 막힘 화면을 본 기기 / 그중 그날이나 나중에 로그인한 기기
      'gate_devices',  (select count(distinct device) from visits where day >= since and gate_seen_at is not null),
      'gate_devices_login', (select count(distinct g.device) from visits g where g.day >= since and g.gate_seen_at is not null
                          and exists (select 1 from visits l where l.device = g.device and l.day >= g.day and l.logged_in))
    )
  );
end $$;
revoke execute on function public.usage_snapshot(int) from public, anon, authenticated;
grant  execute on function public.usage_snapshot(int) to service_role;

-- 분석 저장: Claude Code 가 MCP 로 부릅니다. 필요한 칸이 없으면 오류를 내서 다시 쓰게 합니다.
-- 수치(stats)는 이 함수가 직접 usage_snapshot(14) 로 채웁니다. 90일 지난 보고서는 지웁니다.
-- 저장 뒤 usage-agent Edge Function 을 불러 관리자에게 푸시합니다 (키는 send-reminders cron 에 이미 있는 헤더를 씁니다).
create or replace function public.save_usage_report(p_report jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  k text;
  new_id uuid;
  hdr text;
begin
  foreach k in array array['headline', 'summary', 'login', 'usage', 'updates', 'suggestions', 'watch', 'caveats'] loop
    if p_report -> k is null then raise exception '보고서에 % 칸이 없어요', k; end if;
  end loop;
  if jsonb_typeof(p_report -> 'suggestions') <> 'array' or jsonb_array_length(p_report -> 'suggestions') = 0 then
    raise exception 'suggestions 는 하나 이상인 배열이어야 해요';
  end if;
  insert into public.usage_reports (title, report, stats)
  values ('사용 분석 · ' || left(p_report ->> 'headline', 60), p_report, public.usage_snapshot(14))
  returning id into new_id;
  delete from public.usage_reports where created_at < now() - interval '90 days';

  -- 제안을 관리자 사이트 '제안' 칸의 초안으로 (agenttasks.sql). 같은 제목이 이미 있으면(버린 것 포함) 다시 넣지 않습니다.
  insert into public.agent_tasks (title, spec, source)
  select left(btrim(x ->> 'title'), 200),
         left(coalesce(nullif(btrim(x ->> 'spec'), ''), (x ->> 'title') || E'\n\n이유: ' || coalesce(x ->> 'why', '')), 4000),
         jsonb_build_object('report', new_id, 'why', x ->> 'why', 'goal', x ->> 'goal', 'effort', x ->> 'effort')
    from jsonb_array_elements(p_report -> 'suggestions') x
   where coalesce(btrim(x ->> 'title'), '') <> ''
     and not exists (select 1 from public.agent_tasks t where t.title = left(btrim(x ->> 'title'), 200));

  select substring(command from 'headers\s*:=\s*''([^'']+)''') into hdr
    from cron.job where jobname = 'dshs-study-reminders';
  if hdr is not null then
    perform net.http_post(
      url := 'https://jsanpwlleufzgglqkrkv.supabase.co/functions/v1/usage-agent',
      headers := hdr::jsonb,
      body := jsonb_build_object('id', new_id),
      timeout_milliseconds := 30000);
  end if;
  return new_id;
end $$;
revoke execute on function public.save_usage_report(jsonb) from public, anon, authenticated;
grant  execute on function public.save_usage_report(jsonb) to service_role;

-- 처음 만든 방식(서버에서 매일 22시)의 예약이 남아 있으면 지웁니다. 이제 노트북의 scripts/usage-agent 가 실행합니다.
select cron.unschedule(jobid) from cron.job where jobname = 'dshs-study-usage-agent';
