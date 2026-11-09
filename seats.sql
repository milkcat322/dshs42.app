-- ============================================================
-- dshs42.app — 자습실 자리 (status.sql · dshsapp.sql 다음에 실행. 여러 번 실행해도 안전합니다)
--
-- dshs.app 은 다른 학생의 자리를 주지 않으므로(개인정보처리방침), 각 학생의 토큰으로 '내 자리'(reservation.read.me)만 받아
-- dshs-oauth 의 myseat 가 seat_shares 에 씁니다. 자리는 본인이 보여 주기로 한 학생만 다른 학생에게 보입니다:
--   · 위치를 '자습실 자리'로 정했거나 (그동안만)
--   · '내 자습실 자리 공개'를 켰을 때 (public)
-- 이 조건은 화면이 아니라 아래 읽기 권한(RLS)으로 막습니다. 학생은 public 만 바꿀 수 있고 seat 는 서버만 씁니다.
-- ============================================================

-- 연결 토큰에 내 자리 읽기 권한(reservation.read.me)이 있는지. null = 아직 모름 (예전 연결은 처음 한 번 확인)
alter table public.dshs_links add column if not exists seat_ok boolean;

create table if not exists public.seat_shares (
  student_id integer primary key references public.roster(student_id) on delete cascade,
  public     boolean not null default false,   -- '내 자습실 자리 공개'
  seat       text check (seat is null or char_length(seat) <= 20),   -- 예: a101
  seat_day   text,                              -- 어느 주 자리인지: 그 주 금요일 YYYYMMDD (금요일 15시에 바뀜)
  updated_at timestamptz not null default now()
);

-- 학생은 public 만 바꿉니다 (seat · seat_day 는 서버(service_role)만)
create or replace function public.guard_seat_shares()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.seat := null; new.seat_day := null;
    else
      new.seat := old.seat; new.seat_day := old.seat_day;
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists seat_shares_guard on public.seat_shares;
create trigger seat_shares_guard
  before insert or update on public.seat_shares
  for each row execute function public.guard_seat_shares();

alter table public.seat_shares enable row level security;
drop policy if exists seat_shares_read   on public.seat_shares;
drop policy if exists seat_shares_insert on public.seat_shares;
drop policy if exists seat_shares_update on public.seat_shares;
drop policy if exists seat_shares_delete on public.seat_shares;
-- 본인 것, 또는 보여 주기로 한 학생 것만 읽힙니다
create policy seat_shares_read on public.seat_shares
  for select using (
    auth.uid() is not null and (
      student_id = public.my_student_id()
      or public
      or exists (select 1 from public.student_status s where s.student_id = seat_shares.student_id and s.location = '자습실 자리')
    ));
create policy seat_shares_insert on public.seat_shares
  for insert with check (student_id = public.my_student_id());
create policy seat_shares_update on public.seat_shares
  for update using (student_id = public.my_student_id()) with check (student_id = public.my_student_id());
create policy seat_shares_delete on public.seat_shares
  for delete using (student_id = public.my_student_id());
revoke all on public.seat_shares from anon;
grant select, insert, update, delete on public.seat_shares to authenticated;

-- 예전 방식 정리: 자리를 student_status 에 두던 칸과 트리거 (status.sql 의 원래 트리거로 되돌림)
create or replace function public.touch_student_status()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end
$$;
alter table public.student_status drop column if exists seat;
alter table public.student_status drop column if exists seat_day;
drop table if exists public.dshs_seat_cache;
