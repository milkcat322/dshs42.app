-- ============================================================
-- dshs42.app — 개인 일정 + 수행평가 완료 체크
-- schema.sql · seed.sql · bans.sql 다음에 SQL Editor 에서 실행합니다.
-- 두 테이블 모두 본인 행만 읽고 쓸 수 있습니다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 개인 일정 (본인만 보는 일정. 수행평가 공지와 함께 달력에 표시)
-- ------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  title       text        not null check (char_length(title) between 1 and 120),
  memo        text        not null default '' check (char_length(memo) <= 2000),
  starts_at   timestamptz not null,
  ends_at     timestamptz,                    -- 비어 있으면 시작 시각만 있는 일정
  all_day     boolean     not null default false,
  color       text        not null default 'mint' check (color in ('mint','violet','pink','orange','blue')),
  done        boolean     not null default false,
  created_at  timestamptz not null default now(),
  constraint events_range check (ends_at is null or ends_at >= starts_at)
);
create index if not exists events_user_idx on public.events (user_id, starts_at);

-- ------------------------------------------------------------
-- 2. 수행평가 완료 체크 (사람마다 따로)
-- ------------------------------------------------------------
create table if not exists public.assignment_done (
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  done_at       timestamptz not null default now(),
  primary key (user_id, assignment_id)
);
create index if not exists assignment_done_asg_idx on public.assignment_done (assignment_id);

-- ============================================================
-- RLS
-- ============================================================
alter table public.events          enable row level security;
alter table public.assignment_done enable row level security;

drop policy if exists events_own on public.events;
create policy events_own on public.events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists assignment_done_own on public.assignment_done;
create policy assignment_done_own on public.assignment_done
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 꿈지락처럼 학생이 자기 달력에서만 고치는 학교 일정.
-- source_key = 원본 학교 일정 (NEIS "시작일|이름|대상학년" 또는 "sch:<school_events.id>")
--              이 값이 있는 내 일정은 내 달력에서만 원본 대신 보입니다. 일반 일정은 null
-- hidden     = 내 달력에서 숨긴 원본. 알림이 가지 않도록 done 은 true
-- ------------------------------------------------------------
alter table public.events add column if not exists source_key text;
alter table public.events add column if not exists hidden boolean not null default false;
alter table public.events drop constraint if exists events_hidden_check;
alter table public.events add constraint events_hidden_check
  check (not hidden or (source_key is not null and done));
create unique index if not exists events_source_key_idx on public.events (user_id, source_key);
