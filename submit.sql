-- ============================================================
-- dshs42.app — 수행평가 제출처 (선택)
-- 클래스룸, dshs앱, 패들렛, 메일 중 하나이거나 "그 외" 로 직접 적은 값입니다.
-- 고르지 않으면 비어 있습니다. 여러 번 실행해도 안전합니다.
-- ============================================================
alter table public.assignments add column if not exists submit_to text;

alter table public.assignments drop constraint if exists assignments_submit_to_len;
alter table public.assignments add constraint assignments_submit_to_len
  check (submit_to is null or char_length(submit_to) between 1 and 30);
