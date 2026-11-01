-- ============================================================
-- dshs42.app — 수행평가 개인 수정
-- 학생이 승인된 수행평가를 고치면 공지 자체는 그대로 두고 여기에 바꾼 칸만 저장합니다.
-- 비어 있는 칸은 공지 값을 따라가므로, 공지가 바뀌면 안 고친 칸은 함께 바뀝니다.
-- 본인 행만 읽고 쓸 수 있습니다. 여러 번 실행해도 안전합니다.
-- ============================================================
create table if not exists public.assignment_personal (
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  title         text check (title is null or char_length(title) between 1 and 120),
  due_at        timestamptz,
  no_due        boolean not null default false,   -- 나만 "마감 일시 없음"
  submit_to     text check (submit_to is null or char_length(submit_to) between 1 and 30),
  no_submit     boolean not null default false,   -- 나만 제출처 비움
  updated_at    timestamptz not null default now(),
  primary key (user_id, assignment_id)
);
create index if not exists assignment_personal_asg_idx on public.assignment_personal (assignment_id);

alter table public.assignment_personal enable row level security;

drop policy if exists assignment_personal_own on public.assignment_personal;
create policy assignment_personal_own on public.assignment_personal
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
