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
-- ------------------------------------------------------------
create table if not exists public.dshs_oauth_states (
  state      text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  verifier   text not null,
  return_to  text not null,
  created_at timestamptz not null default now()
);

-- 서비스 롤 전용 (정책 없음 = 접근 불가)
alter table public.dshs_links enable row level security;
alter table public.dshs_oauth_states enable row level security;
