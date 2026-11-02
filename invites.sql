-- ============================================================
-- dshs42.app — 아직 가입하지 않은 친구를 일정에 넣기 (학번으로)
-- share.sql 이 필요합니다. status.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 일정을 만든 사람이 가입 전 학생을 학번으로 넣으면 여기 남겨 두었다가,
-- 그 학생이 가입(또는 dshs.app 으로 처음 로그인)하는 순간 함께하는 친구(event_members)로 옮깁니다.
-- 이미 가입한 학번을 넣으면 바로 event_members 로 넣습니다.
-- ============================================================

create table if not exists public.event_invites (
  event_id   uuid    not null references public.events(id) on delete cascade,
  student_id integer not null references public.roster(student_id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (event_id, student_id)
);
create index if not exists event_invites_student_idx on public.event_invites (student_id);

-- 넣으려는 학번이 이미 가입했으면 초대 대신 바로 참여자로
create or replace function public.invite_or_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from public.profiles where student_id = new.student_id;
  if uid is null then return new; end if;
  insert into public.event_members (event_id, user_id)
  select new.event_id, uid
  where not exists (select 1 from public.events where id = new.event_id and user_id = uid)
  on conflict do nothing;
  return null;
end
$$;
revoke execute on function public.invite_or_member() from public, anon, authenticated;
drop trigger if exists event_invites_member on public.event_invites;
create trigger event_invites_member
  before insert on public.event_invites
  for each row execute function public.invite_or_member();

-- 가입하면 그 학번 앞으로 온 초대를 참여자로 옮깁니다
create or replace function public.claim_event_invites()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.student_id is null then return new; end if;
  insert into public.event_members (event_id, user_id)
  select i.event_id, new.id
  from public.event_invites i join public.events e on e.id = i.event_id
  where i.student_id = new.student_id and e.user_id <> new.id
  on conflict do nothing;
  delete from public.event_invites where student_id = new.student_id;
  return new;
end
$$;
revoke execute on function public.claim_event_invites() from public, anon, authenticated;
drop trigger if exists profiles_claim_invites on public.profiles;
create trigger profiles_claim_invites
  after insert on public.profiles
  for each row execute function public.claim_event_invites();

-- 초대는 일정을 만든 사람만 보고 · 넣고 · 뺍니다
alter table public.event_invites enable row level security;
drop policy if exists event_invites_read   on public.event_invites;
drop policy if exists event_invites_insert on public.event_invites;
drop policy if exists event_invites_delete on public.event_invites;
create policy event_invites_read on public.event_invites
  for select using (public.is_event_owner(event_id));
create policy event_invites_insert on public.event_invites
  for insert with check (public.is_event_owner(event_id) and student_id is distinct from public.my_student_id());
create policy event_invites_delete on public.event_invites
  for delete using (public.is_event_owner(event_id));

revoke all on public.event_invites from anon;
grant select, insert, delete on public.event_invites to authenticated;
