-- ============================================================
-- dshs.study — 알림
-- school.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 학교 일정 중 필수 일정 (시작 30분 전에 대상 학생에게 알림)
-- ------------------------------------------------------------
alter table public.school_events add column if not exists notify boolean not null default false;

-- ------------------------------------------------------------
-- 2. 알림 발송 기록 (같은 알림 중복 발송 방지, 사흘 지나면 지웁니다)
--    key 에 마감·시작 시각이 들어가서, 일정을 옮기면 새 시각에 맞춰 다시 알립니다.
-- ------------------------------------------------------------
create table if not exists public.notify_log (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  key      text not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, key)
);
create index if not exists notify_log_key_idx on public.notify_log (key);

-- 서비스 롤 전용 (정책 없음 = 접근 불가)
alter table public.notify_log enable row level security;

-- 더 이상 쓰지 않는 테이블
drop table if exists public.reminder_log;
drop table if exists public.class_slots;
