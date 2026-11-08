-- ============================================================
-- dshs42.app — 할 일 그룹 (할 일 탭에서 할 일을 그룹으로 나누기)
-- todos.sql 다음에 SQL Editor 에서 실행합니다. 본인 것만 읽고 씁니다.
-- 접기 · 펼치기는 기기마다 따로라 DB 가 아니라 브라우저(localStorage)에 둡니다.
-- ============================================================

create table if not exists public.todo_groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  name        text        not null check (char_length(name) between 1 and 40),
  position    integer     not null default 0,          -- 보여 주는 순서 (작은 것부터)
  created_at  timestamptz not null default now()
);
create index if not exists todo_groups_user_idx on public.todo_groups (user_id, position);

alter table public.todo_groups enable row level security;

drop policy if exists todo_groups_own on public.todo_groups;
create policy todo_groups_own on public.todo_groups
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 할 일이 들어 있는 그룹. 그룹을 지우면 할 일은 남고 '그룹 없음'으로 돌아갑니다.
alter table public.todos
  add column if not exists group_id uuid references public.todo_groups(id) on delete set null;

-- 남의 그룹에 넣지 못하게 (외래 키는 RLS 를 거치지 않으므로 따로 막습니다)
create or replace function public.todos_group_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is not null and not exists (
    select 1 from public.todo_groups g where g.id = new.group_id and g.user_id = new.user_id
  ) then
    raise exception 'todo group belongs to another user';
  end if;
  return new;
end $$;

drop trigger if exists todos_group_check on public.todos;
create trigger todos_group_check before insert or update of group_id on public.todos
  for each row execute function public.todos_group_check();
