-- 내 정보 API (읽기 전용) — 학생이 자기 열쇠로 자기 계정 정보를 밖(내 프로젝트)에서 읽습니다.
--
--   열쇠 만들기  로그인한 학생이 create_api_key() → 열쇠 원문은 그때 한 번만 돌려주고, 여기에는 sha256 만 남깁니다
--   읽기        POST /rest/v1/rpc/api_me   헤더 apikey: <anon 키> · x-api-key: <내 열쇠>
--   없애기      로그인한 학생이 revoke_api_keys() (내 열쇠 모두)
--
-- 권한을 새로 짜지 않습니다: api_me() 가 열쇠 주인을 찾아 그 학생으로 로그인한 것처럼(auth.uid()) 맞춘 뒤,
-- authenticated 역할로 도는 api_me_read() 가 표를 읽으므로 학생 화면과 똑같은 RLS 를 그대로 탑니다.
-- (열쇠로는 그 학생이 사이트에서 볼 수 있는 것만, 읽기만 됩니다. 쓰는 함수는 없습니다.)

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  key_hash     text not null unique,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists api_keys_user_idx on public.api_keys (user_id);
alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;   -- 정책 없음: 아래 함수로만 다룹니다

-- 열쇠 만들기 (계정마다 5개까지). 원문은 다시 볼 수 없습니다.
create or replace function public.create_api_key(p_label text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  k   text;
begin
  if uid is null then raise exception '로그인이 필요해요'; end if;
  if (select count(*) from api_keys where user_id = uid) >= 5 then
    raise exception '열쇠는 5개까지 만들 수 있어요. revoke_api_keys() 로 지운 뒤 다시 만드세요';
  end if;
  k := 'dshs_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into api_keys (user_id, key_hash, label)
  values (uid, encode(sha256(convert_to(k, 'utf8')), 'hex'), left(p_label, 40));
  return k;
end $$;
revoke all on function public.create_api_key(text) from public, anon;
grant execute on function public.create_api_key(text) to authenticated;

-- 내 열쇠 모두 없애기 (지운 개수)
create or replace function public.revoke_api_keys()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  delete from api_keys where user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.revoke_api_keys() from public, anon;
grant execute on function public.revoke_api_keys() to authenticated;

-- 읽는 부분: authenticated 역할로 돌아 RLS 가 그대로 걸립니다 (auth.uid() = api_me() 가 맞춰 둔 학생).
create or replace function public.api_me_read()
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select id, username, student_id, name, created_at from profiles where id = auth.uid())
  select jsonb_build_object(
    'at', now(),
    'me', (select jsonb_build_object('student_id', student_id, 'name', name, 'username', username, 'created_at', created_at) from me),
    -- 수강 과목 · 분반
    'enrollments', (select coalesce(jsonb_agg(jsonb_build_object('subject', e.subject, 'ban', e.ban) order by e.subject), '[]'::jsonb)
                    from enrollments e where e.student_id = (select student_id from me)),
    -- 수행평가: 내 계정에서만 고친 값(assignment_personal)을 덮어쓴 것 — 화면의 withPersonal 과 같은 규칙
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', a.id, 'subject', a.subject, 'ban', a.ban, 'status', a.status,
                      'title',     case when ap then coalesce(p.title, a.title) else a.title end,
                      'body',      case when ap and p.no_body then '' when ap then coalesce(p.body, a.body) else a.body end,
                      'due_at',    case when ap and p.no_due then null when ap then coalesce(p.due_at, a.due_at) else a.due_at end,
                      'submit_to', case when ap and p.no_submit then null when ap then coalesce(p.submit_to, a.submit_to) else a.submit_to end,
                      'author_name', a.author_name,
                      'mine', a.created_by = auth.uid(),
                      'edited', ap,
                      'done', exists (select 1 from assignment_done d where d.assignment_id = a.id and d.user_id = auth.uid()),
                      'created_at', a.created_at) order by a.due_at nulls last, a.created_at), '[]'::jsonb)
                    from assignments a
                    left join assignment_personal p on p.assignment_id = a.id and p.user_id = auth.uid()
                    cross join lateral (select (p.assignment_id is not null and a.status = 'approved') as ap) x),
    -- 일정: 내 일정 + 친구가 공유한 일정 (내 달력에서 숨긴 학교 일정 표시는 hidden_sources 로 따로)
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', e.id, 'title', e.title, 'memo', e.memo, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
                 'all_day', e.all_day, 'color', e.color, 'source_key', e.source_key,
                 'mine', e.user_id = auth.uid(),
                 'done', case when e.user_id = auth.uid() then e.done
                              else coalesce((select m.done from event_members m where m.event_id = e.id and m.user_id = auth.uid()), false) end
               ) order by e.starts_at), '[]'::jsonb)
               from events e where not e.hidden),
    'hidden_sources', (select coalesce(jsonb_agg(e.source_key), '[]'::jsonb) from events e where e.hidden and e.user_id = auth.uid()),
    -- 학교 일정: 숨기지 않았고 내 학년 것 (화면의 liveSchool 과 같은 규칙). NEIS 학사일정 원본은 academic.json
    'school_events', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', s.id, 'title', s.title, 'memo', s.memo, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                        'all_day', s.all_day, 'no_class', s.no_class, 'category', s.category, 'neis_key', s.neis_key
                      ) order by s.starts_at), '[]'::jsonb)
                      from school_events s
                      where not s.hidden
                        and (s.neis_key is null or (select student_id from me) is null
                             or position(((select student_id from me) / 1000)::text in split_part(s.neis_key, '|', 3)) > 0)),
    -- 할 일
    'todo_groups', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'position', g.position)
                      order by g.position, g.created_at), '[]'::jsonb)
                    from todo_groups g where g.user_id = auth.uid()),
    'todos', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'title', t.title, 'due_on', t.due_on, 'due_time', t.due_time, 'done', t.done, 'done_at', t.done_at,
                'today_on', t.today_on, 'group_id', t.group_id, 'created_at', t.created_at) order by t.created_at), '[]'::jsonb)
              from todos t where t.user_id = auth.uid()),
    -- 친구가 나에게 공유한 할 일 (승인된 것만)
    'shared_todos', (select coalesce(jsonb_agg(to_jsonb(s) order by s.added_at), '[]'::jsonb) from my_shared_todos() s),
    -- 내 할 일에 넣은 친구 (학번 · 승인 상태 · 그 친구의 완료)
    'todo_members', (select coalesce(jsonb_agg(jsonb_build_object(
                       'todo_id', m.todo_id, 'student_id', m.student_id, 'status', m.status, 'done', m.done, 'done_at', m.done_at
                     ) order by m.added_at), '[]'::jsonb)
                     from todo_members m where exists (select 1 from todos t where t.id = m.todo_id and t.user_id = auth.uid())),
    -- 공유 일정에 함께 있는 사람 · 내 일정에 학번으로 넣은 가입 전 친구
    'event_people', (select coalesce(jsonb_agg(jsonb_build_object(
                       'event_id', ep.event_id, 'name', ep.name, 'is_owner', ep.is_owner, 'done', ep.done, 'me', ep.user_id = auth.uid())), '[]'::jsonb)
                     from my_event_people() ep),
    'event_invites', (select coalesce(jsonb_agg(jsonb_build_object('event_id', i.event_id, 'student_id', i.student_id)), '[]'::jsonb)
                      from event_invites i),
    -- 내 위치 · 자습실 자리
    'status', (select jsonb_build_object('location', s.location, 'updated_at', s.updated_at)
               from student_status s where s.student_id = (select student_id from me)),
    'seat', (select jsonb_build_object('public', s.public, 'seat', s.seat, 'seat_day', s.seat_day, 'updated_at', s.updated_at)
             from seat_shares s where s.student_id = (select student_id from me)),
    -- 공부 탭 단어 북마크
    'bookmarks', (select coalesce(jsonb_agg(jsonb_build_object('subject', b.subject, 'word', b.word, 'created_at', b.created_at)
                    order by b.subject, b.created_at), '[]'::jsonb)
                  from learn_bookmarks b where b.user_id = auth.uid()),
    -- 내가 쓴 수행평가 댓글
    'comments', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'assignment_id', c.assignment_id, 'body', c.body, 'created_at', c.created_at)
                   order by c.created_at), '[]'::jsonb)
                 from assignment_comments c where c.user_id = auth.uid()),
    -- 내가 보낸 피드백과 그 대화 (스크린샷은 비공개 버킷이라 파일 이름만)
    'feedback', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', f.id, 'kind', f.kind, 'body', f.body, 'image_path', f.image_path, 'created_at', f.created_at,
                   'replies', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'body', r.body, 'from_admin', r.from_admin, 'created_at', r.created_at, 'seen_at', r.seen_at) order by r.created_at), '[]'::jsonb)
                               from feedback_replies r where r.feedback_id = f.id)
                 ) order by f.created_at), '[]'::jsonb)
                 from feedback f where f.user_id = auth.uid())
  );
$$;
-- 주인을 authenticated 로 바꿔야 RLS 가 걸립니다. 바꾸는 동안만 스키마 만들기 권한을 주고 바로 거둡니다.
grant create on schema public to authenticated;
alter function public.api_me_read() owner to authenticated;
revoke create on schema public from authenticated;
revoke all on function public.api_me_read() from public, anon;

-- 밖에서 부르는 함수. 열쇠는 x-api-key 헤더(또는 p_key)로 받습니다. 틀리면 401.
create or replace function public.api_me(p_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k   text := coalesce(nullif(p_key, ''), nullif(current_setting('request.headers', true), '')::json ->> 'x-api-key');
  rec api_keys%rowtype;
begin
  if k is not null then
    select * into rec from api_keys where key_hash = encode(sha256(convert_to(k, 'utf8')), 'hex');
  end if;
  if rec.id is null then
    raise sqlstate 'PT401' using message = 'invalid api key';
  end if;
  if rec.last_used_at is null or rec.last_used_at < now() - interval '1 minute' then
    update api_keys set last_used_at = now() where id = rec.id;
  end if;
  -- 이 요청 동안만 열쇠 주인으로 (auth.uid() 가 읽는 값)
  perform set_config('request.jwt.claim.sub', rec.user_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', rec.user_id, 'role', 'authenticated')::text, true);
  return api_me_read();
end $$;
revoke all on function public.api_me(text) from public;
grant execute on function public.api_me(text) to anon, authenticated;
