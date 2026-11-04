-- ============================================================
-- dshs42.app — 데이터베이스 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 실행하세요.
-- 실행 후 seed.sql 을 이어서 실행합니다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 명단 (학번 → 이름). 회원가입 검증에만 쓰입니다.
-- ------------------------------------------------------------
create table if not exists public.roster (
  student_id  integer primary key,
  name        text not null
);

-- ------------------------------------------------------------
-- 2. 수강 정보 (학번 → 과목). 공지를 누구에게 보일지 결정합니다.
-- ------------------------------------------------------------
create table if not exists public.enrollments (
  student_id  integer not null references public.roster(student_id) on delete cascade,
  subject     text    not null,
  ban         text,                       -- 분반 (A반, B반 …). bans.sql 이 채웁니다.
  primary key (student_id, subject)
);
create index if not exists enrollments_subject_idx on public.enrollments (subject);

-- ------------------------------------------------------------
-- 3. 계정 프로필 (auth.users 1:1)
--    student_id 가 unique → 한 학번당 계정 하나
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text    not null unique,
  student_id  integer unique references public.roster(student_id),   -- 관리자 전용 계정은 비어 있음
  name        text    not null,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint student_or_admin check (student_id is not null or is_admin)
);

-- ------------------------------------------------------------
-- 4. 수행평가 공지
--    status: pending(승인 대기) / approved(전체 공지) / rejected(반려)
-- ------------------------------------------------------------
create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  subject     text        not null,
  ban         text,                    -- 비어 있으면 그 과목 전체 분반 공지
  title      text        not null check (char_length(title) between 1 and 120),
  body        text        not null default '' check (char_length(body) <= 2000),
  due_at      timestamptz not null,
  status      text        not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by  uuid        not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  reviewed_by uuid        references public.profiles(id),
  reviewed_at timestamptz,
  reject_note text
);
create index if not exists assignments_subject_idx on public.assignments (subject, status, due_at);
create index if not exists assignments_due_idx     on public.assignments (due_at) where status = 'approved';

-- ------------------------------------------------------------
-- 5. 푸시 구독 (기기마다 1행)
-- ------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists push_user_idx on public.push_subscriptions (user_id);

-- ============================================================
-- 헬퍼 함수
-- ============================================================

-- 현재 로그인한 사용자의 학번
create or replace function public.my_student_id()
returns integer language sql stable security definer set search_path = public as $$
  select student_id from public.profiles where id = auth.uid()
$$;

-- 현재 사용자가 관리자인지
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- 학번이 이미 가입했는지 (회원가입 1단계에서 호출, 로그인 없이 사용 가능)
create or replace function public.student_id_status(p_student_id integer)
returns table (name text, taken boolean)
language sql stable security definer set search_path = public as $$
  select r.name,
         exists (select 1 from public.profiles p where p.student_id = r.student_id) as taken
  from public.roster r
  where r.student_id = p_student_id
$$;

grant execute on function public.student_id_status(integer) to anon, authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table public.roster             enable row level security;
alter table public.enrollments        enable row level security;
alter table public.profiles           enable row level security;
alter table public.assignments        enable row level security;
alter table public.push_subscriptions enable row level security;

-- roster / enrollments: 서버(서비스 롤)와 함수만 사용. 일반 조회는 막습니다.
drop policy if exists roster_none on public.roster;
create policy roster_none on public.roster for select using (false);

drop policy if exists enroll_self on public.enrollments;
create policy enroll_self on public.enrollments
  for select using (student_id = public.my_student_id() or public.is_admin());

-- profiles: 본인 것 + 관리자는 전체 조회
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid() and is_admin = (select is_admin from public.profiles where id = auth.uid()));

-- assignments
-- 읽기: 승인된 공지는 그 과목·분반을 듣는 사람만 (분반이 비어 있으면 과목 전체)
--       내가 쓴 건 상태 무관 / 관리자는 전체
drop policy if exists assignments_read on public.assignments;
create policy assignments_read on public.assignments
  for select using (
    public.is_admin()
    or created_by = auth.uid()
    or (
      status = 'approved'
      and exists (
        select 1 from public.enrollments e
        where e.student_id = public.my_student_id()
          and e.subject = assignments.subject
          and (assignments.ban is null or e.ban = assignments.ban)
      )
    )
  );

-- 쓰기: 본인이 듣는 분반에만, 무조건 pending 으로
drop policy if exists assignments_insert on public.assignments;
create policy assignments_insert on public.assignments
  for insert with check (
    created_by = auth.uid()
    and (
      public.is_admin()
      or (
        status = 'pending'
        and exists (
          select 1 from public.enrollments e
          where e.student_id = public.my_student_id()
            and e.subject = assignments.subject
            and e.ban = assignments.ban
        )
      )
    )
  );

-- 수정: 관리자(승인/반려) 또는 작성자가 아직 대기중인 글을 고칠 때
drop policy if exists assignments_update on public.assignments;
create policy assignments_update on public.assignments
  for update using (
    public.is_admin() or (created_by = auth.uid() and status = 'pending')
  );

-- 삭제: 관리자, 또는 작성자가 아직 분반 공지가 아닌(대기·반려) 자기 수행평가를 지울 때
drop policy if exists assignments_delete on public.assignments;
create policy assignments_delete on public.assignments
  for delete using (public.is_admin() or (created_by = auth.uid() and status in ('pending', 'rejected')));

-- push_subscriptions: 본인 것만
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 알림 켜기: 이 기기(endpoint)를 지금 로그인한 계정으로 등록합니다.
-- 같은 기기에서 다른 계정(예: 관리자 → 학생)으로 바꿔 로그인하면 예전 계정의 행이 남아 있어
-- 위 정책 때문에 upsert 가 막히므로, 기기 주인을 지금 계정으로 넘기는 이 함수로만 씁니다.
create or replace function public.save_push(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
revoke execute on function public.save_push(text, text, text) from public, anon;
grant  execute on function public.save_push(text, text, text) to authenticated;

-- ============================================================
-- 관리자 계정은 admins.sql 로 연결합니다 (README 6단계).
-- 학생 계정을 관리자로 올리고 싶다면:
--   update public.profiles set is_admin = true where student_id = 2113;
-- ============================================================
