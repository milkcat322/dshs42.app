-- ============================================================
-- dshs.study — 할 일 (체크리스트)
-- events.sql 다음에 SQL Editor 에서 실행합니다. 본인 것만 읽고 씁니다.
-- ============================================================

create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  title       text        not null check (char_length(title) between 1 and 200),
  due_on      date,                          -- 기한 (선택)
  done        boolean     not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists todos_user_idx on public.todos (user_id, done, due_on);

alter table public.todos enable row level security;

drop policy if exists todos_own on public.todos;
create policy todos_own on public.todos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
