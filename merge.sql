-- 분반별로 따로 올라온 같은 수행평가 → 전체 분반 공지로 합치기 제안 (merge-suggest Edge Function)
-- 매일 0 · 8 · 12 · 16 · 20시(한국 시간)에 서버가 같은 과목 · 다른 분반 · 비슷한 이름의 수행평가를 찾아 여기에 남기고,
-- 관리 탭 '승인' 칸에서 관리자가 이름을 고쳐 합치거나(마감이 같을 때) 확인만 합니다(마감이 다를 때).
-- 합치면 전체 분반 공지 하나를 새로 만들고 원래 공지는 지웁니다. 완료 체크는 새 공지로 옮깁니다.
-- 원래 공지 내용은 새 공지의 merged_from 에 남습니다 (관리 탭 '처리 기록'에서 보임).
-- schema.sql · notice.sql · personal.sql · ops.sql 뒤에 실행합니다. 여러 번 실행해도 안전합니다.

alter table public.assignments add column if not exists merged_from jsonb;   -- 합쳐진 원래 공지들 [{ban, title, due_at, author_name}]

create table if not exists public.merge_suggestions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  kind         text not null check (kind in ('same', 'diff_due')),   -- same: 마감 같음(합치기 제안) · diff_due: 마감 다름(보고)
  subject      text not null,
  sig          text not null unique,          -- 묶인 공지 id 를 정렬해 이은 것 (같은 묶음을 다시 제안하지 않게)
  ids          uuid[] not null,
  items        jsonb not null,                -- 찾았을 때의 공지들 [{id, ban, title, due_at, status, author_name}]
  title        text not null,                 -- 제안하는 이름
  status       text not null default 'open' check (status in ('open', 'merged', 'dismissed')),
  resolved_by  uuid references public.profiles(id) on delete set null,
  resolved_at  timestamptz,
  merged_id    uuid                           -- 합쳐서 새로 만든 공지
);
create index if not exists merge_suggestions_open_idx on public.merge_suggestions (status, created_at desc);

alter table public.merge_suggestions enable row level security;
drop policy if exists merge_suggestions_admin on public.merge_suggestions;
create policy merge_suggestions_admin on public.merge_suggestions
  for select to authenticated using (public.is_admin_user(auth.uid()));
revoke all on public.merge_suggestions from anon;
grant select on public.merge_suggestions to authenticated;

-- 확인(넘기기): 관리자만
create or replace function public.dismiss_merge(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'admin only'; end if;
  update public.merge_suggestions set status = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
   where id = p_id and status = 'open';
end $$;

-- 합치기: 관리자만. 마감이 같은 묶음(same)을 전체 분반 공지 하나로 만들고 원래 공지를 지웁니다.
-- 제안 뒤에 공지가 지워졌거나 마감 · 과목이 바뀌었으면 합치지 않습니다.
create or replace function public.merge_assignments(p_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s public.merge_suggestions;
  n int; dues int; subj text; due timestamptz; new_id uuid;
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'admin only'; end if;
  select * into s from public.merge_suggestions where id = p_id for update;
  if s.id is null or s.status <> 'open' then raise exception '이미 처리한 제안이에요'; end if;
  if s.kind <> 'same' then raise exception '마감이 달라 합칠 수 없어요'; end if;
  p_title := btrim(coalesce(p_title, ''));
  if char_length(p_title) not between 1 and 120 then raise exception '이름은 1~120자로 적어 주세요'; end if;

  select count(*), count(distinct coalesce(due_at::text, '-')), min(subject), min(due_at)
    into n, dues, subj, due
    from public.assignments where id = any(s.ids);
  if n <> cardinality(s.ids) then raise exception '그사이 지워진 공지가 있어요'; end if;
  if dues <> 1 or subj <> s.subject then raise exception '그사이 마감이나 과목이 바뀌었어요'; end if;

  insert into public.assignments (subject, ban, title, body, due_at, submit_to, status, created_by, reviewed_by, reviewed_at, merged_from)
  select s.subject, null, p_title,
         coalesce((select body from public.assignments where id = any(s.ids) order by char_length(body) desc limit 1), ''),
         due,
         (select submit_to from public.assignments where id = any(s.ids) and submit_to is not null limit 1),
         'approved', auth.uid(), auth.uid(), now(),
         (select jsonb_agg(jsonb_build_object('ban', ban, 'title', title, 'due_at', due_at, 'author_name', author_name) order by ban)
            from public.assignments where id = any(s.ids))
  returning id into new_id;

  -- 완료 체크는 새 공지로 옮깁니다 (개인 수정은 원래 공지와 함께 지워집니다)
  insert into public.assignment_done (user_id, assignment_id, done_at)
  select distinct on (user_id) user_id, new_id, done_at from public.assignment_done where assignment_id = any(s.ids)
  on conflict do nothing;

  -- 댓글도 새 공지로 옮깁니다 (comments.sql)
  update public.assignment_comments set assignment_id = new_id where assignment_id = any(s.ids);

  delete from public.assignments where id = any(s.ids);
  update public.merge_suggestions set status = 'merged', title = p_title, resolved_by = auth.uid(), resolved_at = now(), merged_id = new_id
   where id = p_id;
  return new_id;
end $$;

revoke execute on function public.dismiss_merge(uuid) from public, anon;
revoke execute on function public.merge_assignments(uuid, text) from public, anon;
grant  execute on function public.dismiss_merge(uuid) to authenticated;
grant  execute on function public.merge_assignments(uuid, text) to authenticated;

/* ------------------------------------------------------------
   주기 실행 — 매일 0 · 8 · 12 · 16 · 20시 (한국 시간, 운영 점검과 같은 시각). SQL Editor 에서 한 번만 실행합니다.
   키를 붙여 넣지 않도록 send-reminders cron 에 이미 들어 있는 Authorization 헤더를 그대로 씁니다.

   select cron.schedule('dshs-study-merge-suggest', '0 3,7,11,15,23 * * *', format(
     $f$select net.http_post(
          url := 'https://jsanpwlleufzgglqkrkv.supabase.co/functions/v1/merge-suggest',
          headers := %L::jsonb,
          timeout_milliseconds := 30000)$f$,
     (select substring(command from 'headers\s*:=\s*''([^'']+)''')
        from cron.job where jobname = 'dshs-study-reminders')));
------------------------------------------------------------ */
