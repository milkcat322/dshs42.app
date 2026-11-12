-- ============================================================
-- dshs42.app — 피드백 답장
-- feedback.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 관리자가 관리자 사이트에서 피드백에 답장을 남기면, 그 피드백을 보낸 학생이
-- 📢 업데이트 창의 '피드백' 탭에서 읽습니다. 답장은 보낸 학생과 관리자만 봅니다.
-- 학생이 읽으면 seen_at 이 채워져 관리자 사이트에 '읽음'으로 보입니다.
-- 피드백을 지우면 답장도 함께 지워집니다.
-- ============================================================
create table if not exists public.feedback_replies (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz
);
create index if not exists feedback_replies_feedback_idx on public.feedback_replies (feedback_id, created_at);
create index if not exists feedback_replies_created_idx  on public.feedback_replies (created_at desc);

alter table public.feedback_replies enable row level security;
drop policy if exists feedback_replies_read   on public.feedback_replies;
drop policy if exists feedback_replies_insert on public.feedback_replies;
drop policy if exists feedback_replies_delete on public.feedback_replies;
-- 읽기: 관리자, 또는 그 피드백을 보낸 본인
create policy feedback_replies_read on public.feedback_replies
  for select using (
    public.is_admin()
    or exists (select 1 from public.feedback f where f.id = feedback_id and f.user_id = auth.uid())
  );
-- 쓰기 · 지우기: 관리자만. 고치기는 없습니다 (읽음 표시는 아래 함수로만).
create policy feedback_replies_insert on public.feedback_replies
  for insert with check (public.is_admin() and created_by = auth.uid());
create policy feedback_replies_delete on public.feedback_replies
  for delete using (public.is_admin());

grant select, insert, delete on public.feedback_replies to authenticated;

-- 학생이 피드백 탭을 열면 내 피드백에 달린 답장을 모두 읽음으로 바꿉니다
create or replace function public.mark_feedback_replies_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.feedback_replies r
     set seen_at = now()
   where r.seen_at is null
     and exists (select 1 from public.feedback f where f.id = r.feedback_id and f.user_id = auth.uid());
$$;
revoke all on function public.mark_feedback_replies_seen() from public, anon;
grant execute on function public.mark_feedback_replies_seen() to authenticated;
