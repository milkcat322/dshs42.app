-- ============================================================
-- dshs42.app — 학교 일정
-- share.sql 다음에 SQL Editor 에서 실행합니다.
--
-- 관리자만 올리고 고칠 수 있습니다.
-- audience = 'all'  → 로그인한 모두에게 보입니다.
-- audience = 'some' → school_event_targets 에 넣은 학번에게만 보입니다
--                     (아직 가입 안 한 학생도 가입하면 바로 보입니다).
-- no_class = true   → 그날은 달력에 시간표를 깔지 않습니다 (시험·방학·공휴일 등).
-- ============================================================

create table if not exists public.school_events (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null check (char_length(title) between 1 and 120),
  memo        text        not null default '' check (char_length(memo) <= 2000),
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean     not null default true,
  no_class    boolean     not null default false,
  audience    text        not null default 'all' check (audience in ('all', 'some')),
  created_by  uuid        default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists school_events_starts_idx on public.school_events (starts_at);

create table if not exists public.school_event_targets (
  event_id    uuid    not null references public.school_events(id) on delete cascade,
  student_id  integer not null,
  primary key (event_id, student_id)
);
create index if not exists school_event_targets_sid_idx on public.school_event_targets (student_id);

-- 이 일정이 나에게 보이는 대상인지 (RLS 가 두 테이블을 오가며 무한 반복하지 않도록 definer 로)
create or replace function public.is_school_target(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.school_event_targets t
    where t.event_id = p_event and t.student_id = public.my_student_id()
  )
$$;
revoke execute on function public.is_school_target(uuid) from public, anon;
grant  execute on function public.is_school_target(uuid) to authenticated;

alter table public.school_events        enable row level security;
alter table public.school_event_targets enable row level security;

drop policy if exists school_events_read  on public.school_events;
drop policy if exists school_events_admin on public.school_events;
create policy school_events_read on public.school_events
  for select using (
    auth.uid() is not null
    and (audience = 'all' or public.is_admin() or public.is_school_target(id))
  );
create policy school_events_admin on public.school_events
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists school_event_targets_read  on public.school_event_targets;
drop policy if exists school_event_targets_admin on public.school_event_targets;
create policy school_event_targets_read on public.school_event_targets
  for select using (public.is_admin() or student_id = public.my_student_id());
create policy school_event_targets_admin on public.school_event_targets
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- NEIS 학사일정과 같은 종류로 보여 주고, 관리자가 NEIS 일정을 고칠 수 있게 합니다.
-- academic.json 은 매일 덮어써지므로 고친 내용은 여기에 저장해 원본 대신 보여 줍니다.
-- category = 학사일정 종류 (dshs-study.js 의 ACAD_CATS)
-- neis_key = 고친 NEIS 일정 ("시작일|이름|대상학년"). 관리자가 새로 만든 일정은 null
-- hidden   = 관리자가 달력에서 숨긴 NEIS 일정 (알림이 가지 않도록 notify 는 false)
-- ------------------------------------------------------------
alter table public.school_events add column if not exists category text not null default 'event';
alter table public.school_events add column if not exists neis_key text;
alter table public.school_events add column if not exists hidden boolean not null default false;
alter table public.school_events drop constraint if exists school_events_category_check;
alter table public.school_events add constraint school_events_category_check
  check (category in ('home', 'exam', 'break', 'holiday', 'club', 'event'));
alter table public.school_events drop constraint if exists school_events_neis_check;
alter table public.school_events add constraint school_events_neis_check
  check ((neis_key is null or audience = 'all') and (not hidden or (neis_key is not null and not notify)));
create unique index if not exists school_events_neis_key_idx on public.school_events (neis_key);
