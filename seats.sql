-- 자습실 자리 (dshs.app 자습 좌석 API). dshs-oauth 의 action "seats" 가 씁니다.
-- 자리 신청은 전날 끝나므로, 0시(한국 시간)가 지나 처음 부른 학생의 토큰으로 오늘 좌석 배치도를 하루 한 번 받아
-- 42기 학생(roster)의 자리만 남겨 그날 하루 모두가 같이 씁니다 (dshs.app 요청 한도가 사이트 전체 60초 120회).
-- 표는 서버 함수(service_role)만 읽고 씁니다. 학생은 함수를 거쳐서만 받습니다.

-- 연결 토큰에 자습 좌석 권한(reservation.read)이 있는지. null = 아직 모름 (예전에 연결해 처음 한 번 확인)
alter table public.dshs_links add column if not exists seat_ok boolean;

create table if not exists public.dshs_seat_cache (
  day text primary key,                 -- 자습 날짜 YYYYMMDD (한국 시간)
  available boolean not null,           -- 그날 자습 신청을 받는 날인지 (아니면 자리를 보여 주지 않음)
  seats jsonb not null default '{}',    -- { "학번": "a101", … }
  fetched_at timestamptz not null default now()
);
alter table public.dshs_seat_cache enable row level security;
-- 정책 없음: anon · authenticated 는 읽을 수 없습니다
