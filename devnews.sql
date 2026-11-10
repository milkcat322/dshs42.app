-- ============================================================
-- dshs42.app — 개발 소식 (관리자끼리)
-- agenttasks.sql 다음에 SQL Editor 에서 실행합니다.
--
-- push 할 때 DEVLOG 요약기(.claude/hooks/devlog-worker.mjs)가 세션 기록 끝에 <!-- news: 줄 | 줄 --> 을 남기고,
-- dev-news 서버 함수가 10분마다 beta 의 DEVLOG.md 를 읽어 새 · 바뀐 소식을 여기에 남기고 관리자 기기에 알립니다.
-- 관리자 사이트 '제안' 칸 맨 위 '개발 소식'에서 봅니다.
-- ============================================================

create table if not exists public.dev_news (
  session    text primary key,               -- DEVLOG 의 session 번호
  dev        text not null default '',        -- 개발한 사람 (git 이름을 관리자 이름으로 바꾼 것)
  title      text not null default '',        -- 세션 제목
  news       text not null,                   -- 소식 줄 (' | ' 로 이음)
  day        date,                            -- 세션 날짜
  updated_at timestamptz not null default now()
);
create index if not exists dev_news_updated_idx on public.dev_news (updated_at desc);

-- 관리자만 읽고, 쓰기는 서비스 롤(dev-news 함수)만
alter table public.dev_news enable row level security;
drop policy if exists dev_news_admin_read on public.dev_news;
create policy dev_news_admin_read on public.dev_news for select to authenticated
  using (public.is_admin_user(auth.uid()));

-- 관리자 알림 기록에 'dev' 종류 추가
alter table public.admin_push_log drop constraint if exists admin_push_log_source_check;
alter table public.admin_push_log add constraint admin_push_log_source_check
  check (source in ('activity', 'ops', 'usage', 'build', 'dev'));

-- 10분마다 dev-news 실행 (키를 붙여 넣지 않도록 send-reminders cron 의 Authorization 헤더를 그대로 씁니다)
select cron.schedule('dshs-study-dev-news', '*/10 * * * *', format(
  $f$select net.http_post(
       url := 'https://jsanpwlleufzgglqkrkv.supabase.co/functions/v1/dev-news',
       headers := %L::jsonb,
       timeout_milliseconds := 30000)$f$,
  (select substring(command from 'headers\s*:=\s*''([^'']+)''')
     from cron.job where jobname = 'dshs-study-reminders')));
