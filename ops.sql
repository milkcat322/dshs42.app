-- 운영 점검 에이전트 (ops-agent Edge Function)
-- 매일 08:00 · 18:00 에 서비스 상태와 피드백을 점검해 관리자에게 푸시로 알리고, 보고서를 여기에 남깁니다.
-- 관리 탭 '점검' 칸에서 최근 보고서를 봅니다. 쓰기는 서버(service_role)만 합니다.
-- visits.sql 뒤에 실행합니다 (is_admin_user 를 씁니다). 여러 번 실행해도 안전합니다.

create table if not exists public.ops_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  issues      int  not null default 0,                -- 확인할 것 개수 (0 이면 이상 없음)
  title       text not null,
  report      jsonb not null                          -- { issues: [...], infos: [...], feedback: {...} }
);
create index if not exists ops_reports_created_idx on public.ops_reports (created_at desc);

alter table public.ops_reports enable row level security;
drop policy if exists ops_reports_admin_read on public.ops_reports;
create policy ops_reports_admin_read on public.ops_reports
  for select to authenticated using (public.is_admin_user(auth.uid()));
revoke all on public.ops_reports from anon;
grant select on public.ops_reports to authenticated;

-- 점검에 쓰는 서버 상태 (cron 실행 결과 · 서버 함수 호출 응답)
-- net._http_response 는 Supabase 가 약 6시간만 보관하므로 그 범위의 수치입니다.
-- service_role 만 부를 수 있습니다.
create or replace function public.ops_snapshot()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'cron', coalesce((
      select jsonb_agg(jsonb_build_object('job', j.jobname, 'ok', r.ok, 'failed', r.failed, 'last_error', r.last_error))
      from cron.job j
      cross join lateral (
        select count(*) filter (where d.status = 'succeeded') as ok,
               count(*) filter (where d.status = 'failed')    as failed,
               (array_agg(left(d.return_message, 200) order by d.start_time desc) filter (where d.status = 'failed'))[1] as last_error
          from cron.job_run_details d
         where d.jobid = j.jobid and d.start_time > now() - interval '24 hours'
      ) r
      where j.active
    ), '[]'::jsonb),
    'http', jsonb_build_object(
      'total',  (select count(*) from net._http_response),
      'failed', (select count(*) from net._http_response
                  where status_code is null or status_code >= 400 or error_msg is not null),
      'codes',  (select coalesce(jsonb_object_agg(code, n), '{}'::jsonb) from (
                  select coalesce(status_code::text, 'error') as code, count(*) as n
                    from net._http_response group by 1) c),
      'since',  (select min(created) from net._http_response)
    )
  );
end $$;
revoke execute on function public.ops_snapshot() from public, anon, authenticated;
grant  execute on function public.ops_snapshot() to service_role;

-- 보고서는 60일만 보관합니다 (ops-agent 가 실행할 때 지웁니다)

/* ------------------------------------------------------------
   주기 실행 — 매일 08:00 · 18:00 (한국 시간). UTC 로 23시 · 9시입니다. SQL Editor 에서 한 번만 실행합니다.
   키를 붙여 넣지 않도록 send-reminders cron 에 이미 들어 있는 Authorization 헤더를 그대로 씁니다.

   select cron.schedule('dshs-study-ops-agent', '0 9,23 * * *', format(
     $f$select net.http_post(
          url := 'https://jsanpwlleufzgglqkrkv.supabase.co/functions/v1/ops-agent',
          headers := %L::jsonb,
          timeout_milliseconds := 60000)$f$,
     (select substring(command from 'headers\s*:=\s*''([^'']+)''')
        from cron.job where jobname = 'dshs-study-reminders')));
------------------------------------------------------------ */
