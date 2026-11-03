-- 관리 탭의 향후 계획 (반민지 · 진주빈 칸)
-- 관리자만 읽고 쓸 수 있습니다. 두 관리자가 서로의 칸도 고칠 수 있습니다.
-- groups.sql 뒤에 실행합니다 (is_admin_user 를 씁니다).

create table if not exists public.admin_plans (
  id          uuid primary key default gen_random_uuid(),
  owner       text not null check (owner in ('반민지', '진주빈')),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.admin_plans enable row level security;
drop policy if exists admin_plans_admin on public.admin_plans;
create policy admin_plans_admin on public.admin_plans
  for all to authenticated
  using (public.is_admin_user(auth.uid()))
  with check (public.is_admin_user(auth.uid()));

-- 첫 계획 (표가 비어 있을 때만 넣습니다)
insert into public.admin_plans (owner, title)
select '반민지', '학생이 더 들어오면 알림 기능 설정하기'
where not exists (select 1 from public.admin_plans);
