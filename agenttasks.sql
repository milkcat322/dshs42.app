-- ============================================================
-- dshs42.app — Claude 제작 맡기기 (관리자 사이트 관리 탭 '제작' 칸 · scripts/build-agent)
-- adminpush.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 흐름: draft(제안, 고칠 수 있음) → approved(제작 승인) → building(노트북 Claude 가 제작 중)
--       → review(미리보기 준비, 관리자 확인) → revise(수정 요청) → building … → accepted(최종 승인)
--       → merged(main 에 합쳐 beta 배포).  rejected(버림) · failed(실패) · needs_human(사람이 해야 함)
-- 관리자는 표를 직접 읽고 씁니다. 노트북은 build-agent Edge Function(AGENT_TOKEN)을 거쳐 서비스 롤로 바꿉니다.
-- ============================================================
create table if not exists public.agent_tasks (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  spec        text not null default '' check (char_length(spec) <= 4000),   -- Claude 에게 줄 작업 설명 (관리자가 고침)
  source      jsonb,                                                        -- { report: usage_reports.id, why } 등 출처
  status      text not null default 'draft' check (status in
                ('draft','approved','building','review','revise','accepted','merged','rejected','failed','needs_human')),
  note        text not null default '' check (char_length(note) <= 2000), -- 마지막 수정 요청 메모
  rounds      int not null default 0,                                       -- 제작한 횟수 (최대 3)
  branch      text,
  preview_url text,
  summary     text,                                                         -- Claude 가 남긴 변경 요약
  error       text
);
create index if not exists agent_tasks_status_idx on public.agent_tasks (status, updated_at);

create or replace function public.agent_tasks_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists agent_tasks_touch on public.agent_tasks;
create trigger agent_tasks_touch before update on public.agent_tasks
  for each row execute function public.agent_tasks_touch();

alter table public.agent_tasks enable row level security;
drop policy if exists agent_tasks_admin on public.agent_tasks;
create policy agent_tasks_admin on public.agent_tasks
  for all to authenticated
  using (public.is_admin_user(auth.uid()))
  with check (public.is_admin_user(auth.uid()));
revoke all on public.agent_tasks from anon;
grant select, insert, update, delete on public.agent_tasks to authenticated;

-- 관리자 알림 기록에 '제작' 출처를 더합니다
alter table public.admin_push_log drop constraint if exists admin_push_log_source_check;
alter table public.admin_push_log add constraint admin_push_log_source_check
  check (source in ('activity', 'ops', 'usage', 'build'));

-- 노트북(scripts/build-agent)의 열쇠: 열쇠 원문은 노트북의 ~/.dshs42-build-agent.json 에만 있고, 여기에는 sha256 만 둡니다.
-- 아무 권한(RLS 정책)도 없어 서비스 롤(build-agent Edge Function)만 읽습니다. 열쇠 등록은 install.sh 가 알려 줍니다.
create table if not exists public.agent_keys (
  hash       text primary key,
  created_at timestamptz not null default now()
);
alter table public.agent_keys enable row level security;
revoke all on public.agent_keys from anon, authenticated;
