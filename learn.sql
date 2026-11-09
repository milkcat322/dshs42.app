-- ============================================================
-- dshs42.app — 공부 탭 단어장 북마크 (계정별)
-- 공부 탭 단어장(vocab.html)에서 ☆ 를 누른 단어를 계정에 저장해, 다른 기기 · 앱 · 브라우저에서도 같게 보이게 합니다.
-- subject: 과목 id (vocab.html 의 SUBJECTS 키, 예: atc · crit), word: 단어(영어 표기 그대로)
-- 본인 행만 읽고 쓸 수 있습니다. 여러 번 실행해도 안전합니다.
-- ============================================================
create table if not exists public.learn_bookmarks (
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  subject    text not null check (char_length(subject) between 1 and 20),
  word       text not null check (char_length(word) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, subject, word)
);

alter table public.learn_bookmarks enable row level security;

drop policy if exists learn_bookmarks_own on public.learn_bookmarks;
create policy learn_bookmarks_own on public.learn_bookmarks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
