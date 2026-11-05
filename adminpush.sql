-- ============================================================
-- dshs42.app — 관리자에게 보낸 알림 기록 (관리자 사이트 관리 탭 '알림' 칸)
-- ops.sql · usage.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 관리자 기기로 간 푸시(새 활동 · 운영 점검 · 사용 분석)의 제목 · 내용 · 시각을 남깁니다.
-- 남기는 곳: send-reminders(새 활동) · ops-agent(점검) · usage-agent(분석) Edge Function (서비스 롤).
-- 같은 알림을 여러 관리자 기기에 보내도 한 줄이고, devices 는 보낸 기기 수 · delivered 는 받은 기기 수입니다.
-- 60일이 지나면 ops-agent 가 지웁니다.
-- ============================================================
create table if not exists public.admin_push_log (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source     text not null check (source in ('activity', 'ops', 'usage')),
  title      text not null,
  body       text not null default '',
  url        text,
  devices    int not null default 0,
  delivered  int not null default 0
);
create index if not exists admin_push_log_created_idx on public.admin_push_log (created_at desc);

-- 관리자만 읽고, 쓰기는 서비스 롤(Edge Function)만
alter table public.admin_push_log enable row level security;
drop policy if exists admin_push_log_read on public.admin_push_log;
create policy admin_push_log_read on public.admin_push_log
  for select to authenticated using (public.is_admin_user(auth.uid()));
revoke all on public.admin_push_log from anon;
grant select on public.admin_push_log to authenticated;
