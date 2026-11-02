-- ============================================================
-- dshs42.app — dshs.app 계정 연결 (신청 내역을 내 일정 달력에 표시)
-- notice.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
-- 토큰은 Edge Function(dshs-oauth)만 다룹니다. 브라우저에서는 이 테이블을 읽을 수 없습니다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 연결된 계정과 토큰
--    refresh token 은 쓸 때마다 새로 발급되므로 매번 덮어씁니다.
--    연결을 해제하면 행을 지웁니다 (가져온 신청 내역은 저장하지 않습니다).
-- ------------------------------------------------------------
create table if not exists public.dshs_links (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  dshs_sub       text not null unique,      -- dshs.app 사용자 id (id_token 의 sub)
  dshs_name      text,
  dshs_student_id text,                     -- dshs.app 의 학번 (나중에 'dshs.app으로 로그인'으로 바꿀 때 기존 계정과 맞춰 봄)
  refresh_token  text,
  access_token   text,
  access_expires timestamptz,
  linked_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. 로그인 진행 중인 요청 (state · PKCE). 10분 지나면 지웁니다.
--    user_id 가 있으면 로그인한 학생의 계정 연결, 없으면 'dshs.app으로 로그인'.
-- ------------------------------------------------------------
create table if not exists public.dshs_oauth_states (
  state      text primary key,
  user_id    uuid references public.profiles(id) on delete cascade,
  verifier   text not null,
  return_to  text not null,
  created_at timestamptz not null default now()
);
alter table public.dshs_oauth_states alter column user_id drop not null;
-- 설치한 앱에서 시작한 로그인: 앱만 아는 값의 해시. 결과를 로그인 창이 아니라 앱이 받아 갑니다.
alter table public.dshs_oauth_states add column if not exists handoff text;

-- ------------------------------------------------------------
-- 3. 앱이 받아 갈 로그인 결과. 앱이 한 번 받아 가면 지우고, 10분 지나면 지웁니다.
--    앱(홈 화면에 추가한 사이트)에서는 dshs.app 로그인이 다른 브라우저 창에서 열려,
--    로그인 결과를 그 창이 아니라 앱이 가져가야 앱에서 로그인됩니다.
-- ------------------------------------------------------------
create table if not exists public.dshs_handoffs (
  handoff    text primary key,             -- 앱만 아는 값의 SHA-256
  result     text not null,                -- login | joined | linked | error
  reason     text,
  token      text,                         -- 일회용 로그인 토큰 (로그인일 때)
  created_at timestamptz not null default now()
);

-- 서비스 롤 전용 (정책 없음 = 접근 불가)
alter table public.dshs_links enable row level security;
alter table public.dshs_oauth_states enable row level security;
alter table public.dshs_handoffs enable row level security;
