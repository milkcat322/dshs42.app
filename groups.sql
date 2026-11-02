-- ============================================================
-- dshs42.app — 즐겨찾기 그룹 (사람들을 한 번에 고르기)
-- invites.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 학생: 내 일정의 '함께하는 친구'에 쓰는 내 그룹 (나만 봄)
-- 관리자: 학교 일정 대상에 쓰는 그룹. 관리자가 만든 그룹은 관리자끼리 함께 씁니다.
-- ============================================================

create table if not exists public.audience_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 40),
  student_ids integer[] not null default '{}',
  created_by  uuid references public.profiles(id) on delete cascade default auth.uid(),
  created_at  timestamptz not null default now()
);

-- 그 사람이 관리자인지 (RLS 에서 profiles 를 직접 읽지 않도록)
create or replace function public.is_admin_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = p_user), false)
$$;
revoke execute on function public.is_admin_user(uuid) from public, anon;
grant  execute on function public.is_admin_user(uuid) to authenticated;

alter table public.audience_groups enable row level security;
drop policy if exists audience_groups_admin  on public.audience_groups;
drop policy if exists audience_groups_read   on public.audience_groups;
drop policy if exists audience_groups_insert on public.audience_groups;
drop policy if exists audience_groups_update on public.audience_groups;
drop policy if exists audience_groups_delete on public.audience_groups;
create policy audience_groups_read on public.audience_groups
  for select using (created_by = auth.uid() or (public.is_admin() and public.is_admin_user(created_by)));
create policy audience_groups_insert on public.audience_groups
  for insert with check (created_by = auth.uid());
create policy audience_groups_update on public.audience_groups
  for update using (created_by = auth.uid() or (public.is_admin() and public.is_admin_user(created_by)))
  with check (created_by = auth.uid() or (public.is_admin() and public.is_admin_user(created_by)));
create policy audience_groups_delete on public.audience_groups
  for delete using (created_by = auth.uid() or (public.is_admin() and public.is_admin_user(created_by)));

revoke all on public.audience_groups from anon;
grant select, insert, update, delete on public.audience_groups to authenticated;
