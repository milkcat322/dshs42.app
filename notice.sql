-- ============================================================
-- dshs42.app — 수행평가 공지: 마감 일시 없이 올리기 · 작성자 표시 · 작성자/관리자 수정
-- notify.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 마감 일시는 선택. 비어 있으면 화면에 D-? 로 보이고, 달력·알림에서는 빠집니다.
-- ------------------------------------------------------------
alter table public.assignments alter column due_at drop not null;

-- ------------------------------------------------------------
-- 2. 작성자 이름. 학생은 다른 사람의 프로필을 읽을 수 없으므로(profiles RLS)
--    올릴 때 이름을 공지에 같이 저장해 둡니다.
-- ------------------------------------------------------------
alter table public.assignments add column if not exists author_name text;
update public.assignments a set author_name = p.name
  from public.profiles p
  where p.id = a.created_by and a.author_name is null;

-- ------------------------------------------------------------
-- 3. 올릴 때 작성자 이름을 채우고, 고칠 때 작성자가 바꾸면 안 되는 칸을 지킵니다.
--    작성자는 제목·내용·마감만 고칠 수 있어요. 승인 상태·과목·분반은 그대로라
--    스스로 승인하거나 다른 분반으로 옮길 수 없습니다.
-- ------------------------------------------------------------
create or replace function public.assignments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_name := (select name from public.profiles where id = new.created_by);
    return new;
  end if;
  new.created_by  := old.created_by;
  new.author_name := old.author_name;
  if not public.is_admin() then
    new.status      := old.status;
    new.subject     := old.subject;
    new.ban         := old.ban;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.reject_note := old.reject_note;
  end if;
  return new;
end $$;

drop trigger if exists assignments_guard on public.assignments;
create trigger assignments_guard before insert or update on public.assignments
  for each row execute function public.assignments_guard();

-- ------------------------------------------------------------
-- 4. 수정: 관리자, 또는 작성자 (승인된 공지도 고칠 수 있음)
--    삭제는 그대로: 관리자는 모든 공지, 작성자는 아직 분반 공지가 아닌(대기·반려) 것만.
-- ------------------------------------------------------------
drop policy if exists assignments_update on public.assignments;
create policy assignments_update on public.assignments
  for update using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());
