-- ============================================================
-- dshs42.app — 오늘 할 일 · 끝낸 할 일 자동 삭제
-- todogroups.sql 다음에 SQL Editor 에서 실행합니다.
-- ============================================================

-- 오늘 할 일: 학생이 '오늘'로 고른 날짜. 그날만 할 일 탭 맨 위 '오늘 할 일'에 뜨고,
-- 날이 바뀌면 저절로 원래 자리(그룹 · 남은 할 일)로 돌아갑니다. 기한(due_on)과는 따로입니다.
alter table public.todos add column if not exists today_on date;

-- 끝낸 할 일은 끝낸 지 2일이 지나면 지웁니다 (한 시간마다).
-- 처음 실행할 때 이미 2일 넘게 지난 완료 할 일도 함께 지워집니다.
select cron.schedule('dshs-study-todo-cleanup', '17 * * * *',
  $$delete from public.todos where done and done_at < now() - interval '2 days'$$);
