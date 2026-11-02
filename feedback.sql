-- ============================================================
-- dshs42.app — 피드백 (오류 제보 · 전체 분반 공지 오류 · 기능 제안 · 기타)
-- schema.sql 다음에 SQL Editor 에서 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 로그인한 사용자만 보낼 수 있고, 내용은 보낸 사람과 관리자만 읽습니다.
-- 스크린샷은 비공개 버킷 feedback 의 <user_id>/ 폴더에 저장하고 관리자만 엽니다.
-- ============================================================
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('bug', 'notice', 'idea', 'etc')),
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  image_path text,
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;
drop policy if exists feedback_read   on public.feedback;
drop policy if exists feedback_insert on public.feedback;
drop policy if exists feedback_delete on public.feedback;
create policy feedback_read on public.feedback
  for select using (user_id = auth.uid() or public.is_admin());
create policy feedback_insert on public.feedback
  for insert with check (user_id = auth.uid());
create policy feedback_delete on public.feedback
  for delete using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists feedback_image_insert on storage.objects;
drop policy if exists feedback_image_read   on storage.objects;
drop policy if exists feedback_image_delete on storage.objects;
create policy feedback_image_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback' and (storage.foldername(name))[1] = auth.uid()::text);
create policy feedback_image_read on storage.objects
  for select to authenticated using (bucket_id = 'feedback' and public.is_admin());
create policy feedback_image_delete on storage.objects
  for delete to authenticated using (bucket_id = 'feedback' and public.is_admin());
