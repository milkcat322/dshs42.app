-- ============================================================
-- dshs.study — 친구와 일정 공유
-- events.sql 다음에 SQL Editor 에서 실행합니다.
--
-- 일정을 만든 사람(events.user_id)이 친구를 넣으면 그 친구 달력에도 같은 일정이 뜹니다.
-- 고치기·지우기·친구 넣고 빼기는 만든 사람만, 완료 체크와 "나가기"는 각자 합니다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 일정 참여자 (만든 사람은 넣지 않습니다)
-- ------------------------------------------------------------
create table if not exists public.event_members (
  event_id  uuid not null references public.events(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  done      boolean not null default false,   -- 참여자 각자의 완료 체크
  added_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_members_user_idx on public.event_members (user_id);

-- ============================================================
-- 헬퍼 함수 (RLS 가 events ↔ event_members 를 서로 참조하며 무한 반복하지 않도록)
-- ============================================================
create or replace function public.is_event_owner(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.events where id = p_event and user_id = auth.uid())
$$;

create or replace function public.is_event_member(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.event_members where event_id = p_event and user_id = auth.uid())
$$;

-- 친구 찾기: 가입한 사람을 이름·학번·아이디로 검색 (나는 빼고, 최대 10명)
create or replace function public.search_people(p_query text)
returns table (id uuid, name text, student_id integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.student_id
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and char_length(trim(p_query)) >= 1
    and (p.name ilike '%' || trim(p_query) || '%'
         or p.student_id::text like trim(p_query) || '%'
         or p.username ilike trim(p_query) || '%')
  order by p.student_id nulls last, p.name
  limit 10
$$;

-- 내가 볼 수 있는 일정의 사람들 (만든 사람 + 참여자) 과 각자의 완료 여부
create or replace function public.my_event_people()
returns table (event_id uuid, user_id uuid, name text, is_owner boolean, done boolean)
language sql stable security definer set search_path = public as $$
  with mine as (
    select e.id from public.events e where e.user_id = auth.uid()
    union
    select m.event_id from public.event_members m where m.user_id = auth.uid()
  )
  select e.id, e.user_id, p.name, true, e.done
  from public.events e join mine on mine.id = e.id join public.profiles p on p.id = e.user_id
  where exists (select 1 from public.event_members m where m.event_id = e.id)
  union all
  select m.event_id, m.user_id, p.name, false, m.done
  from public.event_members m join mine on mine.id = m.event_id join public.profiles p on p.id = m.user_id
$$;

revoke execute on function public.is_event_owner(uuid)   from public, anon;
revoke execute on function public.is_event_member(uuid)  from public, anon;
revoke execute on function public.search_people(text)    from public, anon;
revoke execute on function public.my_event_people()      from public, anon;
grant  execute on function public.is_event_owner(uuid)   to authenticated;
grant  execute on function public.is_event_member(uuid)  to authenticated;
grant  execute on function public.search_people(text)    to authenticated;
grant  execute on function public.my_event_people()      to authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table public.event_members enable row level security;

-- events: 읽기는 만든 사람 + 참여자, 쓰기는 만든 사람만 (events.sql 의 events_own 을 나눕니다)
drop policy if exists events_own    on public.events;
drop policy if exists events_read   on public.events;
drop policy if exists events_insert on public.events;
drop policy if exists events_update on public.events;
drop policy if exists events_delete on public.events;
create policy events_read on public.events
  for select using (user_id = auth.uid() or public.is_event_member(id));
create policy events_insert on public.events
  for insert with check (user_id = auth.uid());
create policy events_update on public.events
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy events_delete on public.events
  for delete using (user_id = auth.uid());

-- event_members
drop policy if exists event_members_read   on public.event_members;
drop policy if exists event_members_insert on public.event_members;
drop policy if exists event_members_update on public.event_members;
drop policy if exists event_members_delete on public.event_members;
create policy event_members_read on public.event_members
  for select using (user_id = auth.uid() or public.is_event_owner(event_id) or public.is_event_member(event_id));
create policy event_members_insert on public.event_members          -- 친구 넣기: 만든 사람만
  for insert with check (public.is_event_owner(event_id) and user_id <> auth.uid());
create policy event_members_update on public.event_members          -- 완료 체크: 본인 행만
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy event_members_delete on public.event_members          -- 빼기: 만든 사람, 나가기: 본인
  for delete using (public.is_event_owner(event_id) or user_id = auth.uid());

-- 참여자는 자기 행의 done 만 바꿀 수 있습니다 (다른 일정으로 옮겨 붙지 못하게)
revoke update on public.event_members from anon, authenticated;
grant  update (done) on public.event_members to authenticated;

-- ============================================================
-- 지난 일정을 미래로 옮기면 완료 취소 (만든 사람 + 함께하는 친구 모두)
-- 화면은 "끝나는 시각이 지난 일정 = 완료" 로 보여주므로, 그런 일정을 다시 미래로 옮기면
-- 모두의 완료 체크를 풉니다. 미래 → 미래로 옮기는 건 건드리지 않습니다.
-- 끝이 없는 종일 일정은 그날(한국 시간) 23:59:59 에 끝난 것으로 봅니다.
-- ============================================================
create or replace function public.event_end(p_starts timestamptz, p_ends timestamptz, p_all_day boolean)
returns timestamptz language sql stable set search_path = public as $$
  select coalesce(
    p_ends,
    case when p_all_day
      then ((p_starts at time zone 'Asia/Seoul')::date + time '23:59:59') at time zone 'Asia/Seoul'
      else p_starts end)
$$;

create or replace function public.reopen_moved_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.event_end(old.starts_at, old.ends_at, old.all_day) < now()
     and public.event_end(new.starts_at, new.ends_at, new.all_day) > now() then
    new.done := false;
    update public.event_members set done = false where event_id = new.id and done;
  end if;
  return new;
end
$$;
revoke execute on function public.reopen_moved_event() from public, anon, authenticated;

drop trigger if exists events_reopen_moved on public.events;
create trigger events_reopen_moved
  before update of starts_at, ends_at, all_day on public.events
  for each row execute function public.reopen_moved_event();
