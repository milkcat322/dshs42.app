-- ============================================================
-- dshs42.app — 할 일 함께하기 (여러 명에게 공유)
-- todotoday.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 할 일을 만든 사람이 친구(학번)를 넣으면, 승인된 뒤 그 친구 할 일 목록에도 같은 할 일이 생깁니다.
--  - 승인 없이 바로 공유되는 계정: todo_share_free() (지금은 반민지 2202 · 진주빈 2113)
--  - 다른 학생이 넣은 친구는 '대기'로 남고, 관리자가 관리자 사이트 '처리' 칸에서 승인하면 공유됩니다.
-- 학번으로 넣으므로 아직 가입하지 않은 친구도 가입하면 바로 보입니다.
-- 고치기 · 지우기 · 친구 넣고 빼기는 만든 사람만, 완료 체크 · '오늘' · 나가기는 각자 합니다.
-- todos 표의 권한(todos_own)은 그대로 둡니다: 공유받은 할 일은 my_shared_todos() 로만 읽어
-- 예전 화면(메인 · 43기 사이트)에 남의 할 일이 내 것처럼 섞이지 않습니다.
-- ============================================================

-- 할 일 마감 시각 (선택). 비어 있으면 그날 하루 종일(당일 마감). 정하면 그 시각 30분 전에 알림 (send-reminders)
alter table public.todos add column if not exists due_time time;

create table if not exists public.todo_members (
  todo_id     uuid    not null references public.todos(id) on delete cascade,
  student_id  integer not null references public.roster(student_id) on delete cascade,
  status      text    not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  done        boolean not null default false,   -- 그 친구의 완료 체크
  done_at     timestamptz,
  today_on    date,                             -- 그 친구의 '오늘 할 일'
  added_at    timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  primary key (todo_id, student_id)
);
create index if not exists todo_members_sid_idx on public.todo_members (student_id) where status = 'approved';
create index if not exists todo_members_pending_idx on public.todo_members (added_at) where status = 'pending';

-- ============================================================
-- 헬퍼
-- ============================================================
create or replace function public.is_todo_owner(p_todo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.todos where id = p_todo and user_id = auth.uid())
$$;

-- 승인 없이 바로 공유할 수 있는 계정 (학번). 학년이 바뀌어 학번이 바뀌면 여기를 고칩니다.
create or replace function public.todo_share_free()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_student_id() in (2202, 2113), false)
$$;

-- 넣을 때 상태는 서버가 정합니다 (화면이 보낸 status · done 은 믿지 않음)
create or replace function public.todo_members_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.status := case when public.todo_share_free() then 'approved' else 'pending' end;
  new.done := false; new.done_at := null; new.today_on := null;
  new.added_at := now();
  new.reviewed_at := case when new.status = 'approved' then now() end;
  new.reviewed_by := null;
  return new;
end
$$;
drop trigger if exists todo_members_fill on public.todo_members;
create trigger todo_members_fill before insert on public.todo_members
  for each row execute function public.todo_members_fill();

-- ============================================================
-- RLS
-- ============================================================
alter table public.todo_members enable row level security;

drop policy if exists todo_members_read   on public.todo_members;
drop policy if exists todo_members_insert on public.todo_members;
drop policy if exists todo_members_update on public.todo_members;
drop policy if exists todo_members_delete on public.todo_members;
-- 만든 사람은 자기 할 일의 친구 모두(대기 · 반려 포함), 친구는 승인된 자기 행만
create policy todo_members_read on public.todo_members
  for select using (public.is_todo_owner(todo_id) or (student_id = public.my_student_id() and status = 'approved'));
create policy todo_members_insert on public.todo_members
  for insert with check (public.is_todo_owner(todo_id) and student_id is distinct from public.my_student_id());
-- 친구는 승인된 자기 행의 완료 · 오늘만 바꿉니다 (아래 칸 권한)
create policy todo_members_update on public.todo_members
  for update using (student_id = public.my_student_id() and status = 'approved')
  with check (student_id = public.my_student_id() and status = 'approved');
-- 빼기: 만든 사람, 나가기: 본인
create policy todo_members_delete on public.todo_members
  for delete using (public.is_todo_owner(todo_id) or student_id = public.my_student_id());

revoke update on public.todo_members from anon, authenticated;
grant  update (done, done_at, today_on) on public.todo_members to authenticated;

-- ============================================================
-- 공유받은 할 일 (승인된 것만). 만든 사람 이름과 함께하는 친구 학번도 돌려줍니다.
-- ============================================================
-- 돌려주는 칸이 바뀌면 create or replace 가 안 되므로 지우고 다시 만듭니다
drop function if exists public.my_shared_todos();
create function public.my_shared_todos()
returns table (id uuid, title text, due_on date, due_time time, owner_name text, owner_sid integer,
               done boolean, done_at timestamptz, today_on date, added_at timestamptz, member_sids integer[])
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.due_on, t.due_time, p.name, p.student_id, m.done, m.done_at, m.today_on, m.added_at,
    array(select x.student_id from public.todo_members x
          where x.todo_id = t.id and x.status = 'approved' order by x.student_id)
  from public.todo_members m
  join public.todos t on t.id = m.todo_id
  join public.profiles p on p.id = t.user_id
  where m.student_id = public.my_student_id() and m.status = 'approved'
$$;

-- ============================================================
-- 관리자: 승인 대기 공유 목록 · 승인 / 반려
-- 승인하려면 무엇을 공유하는지 봐야 하므로 할 일 제목은 보여 줍니다.
-- ============================================================
create or replace function public.admin_todo_shares()
returns table (todo_id uuid, title text, due_on date, owner_name text, owner_sid integer,
               sids integer[], asked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select t.id, t.title, t.due_on, p.name, p.student_id,
      array_agg(m.student_id order by m.student_id), max(m.added_at)
    from public.todo_members m
    join public.todos t on t.id = m.todo_id
    join public.profiles p on p.id = t.user_id
    where m.status = 'pending'
    group by t.id, t.title, t.due_on, p.name, p.student_id
    order by max(m.added_at);
end
$$;

create or replace function public.review_todo_share(p_todo uuid, p_ok boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.todo_members
    set status = case when p_ok then 'approved' else 'rejected' end, reviewed_at = now(), reviewed_by = auth.uid()
    where todo_id = p_todo and status = 'pending';
  get diagnostics n = row_count;
  return n;
end
$$;

revoke execute on function public.is_todo_owner(uuid)            from public, anon;
revoke execute on function public.todo_share_free()              from public, anon;
revoke execute on function public.todo_members_fill()            from public, anon, authenticated;
revoke execute on function public.my_shared_todos()              from public, anon;
revoke execute on function public.admin_todo_shares()            from public, anon;
revoke execute on function public.review_todo_share(uuid, boolean) from public, anon;
grant  execute on function public.is_todo_owner(uuid)            to authenticated;
grant  execute on function public.todo_share_free()              to authenticated;
grant  execute on function public.my_shared_todos()              to authenticated;
grant  execute on function public.admin_todo_shares()            to authenticated;
grant  execute on function public.review_todo_share(uuid, boolean) to authenticated;

-- ============================================================
-- 끝낸 할 일 자동 삭제 (todotoday.sql 의 작업을 바꿈):
-- 만든 사람이 끝낸 지 2일이 지나도, 함께하는 친구 중 아직 안 끝낸(또는 끝낸 지 2일이 안 된) 사람이 있으면 남깁니다.
-- ============================================================
select cron.schedule('dshs-study-todo-cleanup', '17 * * * *',
  $$delete from public.todos t where t.done and t.done_at < now() - interval '2 days'
    and not exists (select 1 from public.todo_members m where m.todo_id = t.id and m.status = 'approved'
                    and not (m.done and m.done_at < now() - interval '2 days'))$$);
