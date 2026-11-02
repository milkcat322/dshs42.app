-- ============================================================
-- dshs42.app — 관리자 즐겨찾기 그룹 (학교 일정 대상을 한 번에 고르기)
-- invites.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
-- 관리자끼리 함께 씁니다. 학생은 읽을 수 없습니다.
-- ============================================================

create table if not exists public.audience_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 40),
  student_ids integer[] not null default '{}',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.audience_groups enable row level security;
drop policy if exists audience_groups_admin on public.audience_groups;
create policy audience_groups_admin on public.audience_groups
  for all using (public.is_admin()) with check (public.is_admin());

revoke all on public.audience_groups from anon;
grant select, insert, update, delete on public.audience_groups to authenticated;
