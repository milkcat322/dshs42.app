-- ============================================================
-- dshs42.app — 수행평가 공지 댓글
-- notice.sql 다음, merge.sql 전에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 누가 보나: 그 공지를 볼 수 있는 사람 (공지 RLS 를 그대로 따름)
--   승인된 공지 → 같은 과목 · 분반 학생 / 승인 대기 · 반려 → 작성자와 관리자
-- 누가 쓰나: 그 공지를 볼 수 있는 로그인 사용자
-- 누가 지우나: 댓글 쓴 사람, 관리자. 공지가 지워지면 댓글도 함께 지워집니다.
-- ============================================================

create table if not exists public.assignment_comments (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name   text,
  body          text not null check (char_length(btrim(body)) between 1 and 500),
  created_at    timestamptz not null default now()
);
create index if not exists assignment_comments_asg_idx on public.assignment_comments (assignment_id, created_at);

-- 이름은 학생이 다른 사람 프로필을 읽을 수 없어서(profiles RLS) 쓸 때 같이 저장합니다.
-- 쓴 사람 · 시각은 직접 넣지 못하게 서버가 채웁니다.
create or replace function public.assignment_comments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id     := auth.uid();
  new.author_name := (select name from public.profiles where id = auth.uid());
  new.body        := btrim(new.body);
  new.created_at  := now();
  return new;
end $$;

drop trigger if exists assignment_comments_guard on public.assignment_comments;
create trigger assignment_comments_guard before insert on public.assignment_comments
  for each row execute function public.assignment_comments_guard();

alter table public.assignment_comments enable row level security;

-- 공지를 볼 수 있으면 댓글도 봅니다. 하위 질의에도 assignments 의 RLS 가 걸리므로 공지 권한을 그대로 따릅니다.
drop policy if exists assignment_comments_read on public.assignment_comments;
create policy assignment_comments_read on public.assignment_comments
  for select using (exists (select 1 from public.assignments a where a.id = assignment_id));

drop policy if exists assignment_comments_insert on public.assignment_comments;
create policy assignment_comments_insert on public.assignment_comments
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.assignments a where a.id = assignment_id)
  );

-- 고치기는 없습니다 (지우고 다시 쓰기)
drop policy if exists assignment_comments_delete on public.assignment_comments;
create policy assignment_comments_delete on public.assignment_comments
  for delete using (user_id = auth.uid() or public.is_admin());

grant select, insert, delete on public.assignment_comments to authenticated;
