-- 관리자 현황 탭
-- 가입 학생, 학생별 활동 수, 최근 활동을 한 번에 돌려줍니다. 관리자만 부를 수 있습니다.
--
-- 본인만 볼 수 있는 내용(할 일 · 개인 일정 · 개인 수정 · 학생 그룹)은
-- security definer 로도 제목을 꺼내지 않고 "몇 개, 언제" 만 돌려줍니다.
-- 토큰 · 푸시 키 칸은 읽지 않습니다.
-- 새 활동 종류를 넣을 때도 이 원칙을 지킵니다.
--
-- 지금 표에 남아 있는 행만 보이므로, 지운 항목과 고치기 전 값은 나오지 않습니다.
--
-- groups.sql 뒤에 실행합니다 (is_admin_user 를 씁니다).

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception '관리자만 볼 수 있어요' using errcode = '42501';
  end if;

  with students as (
    select * from public.profiles where not is_admin
  ),
  activity as (
    select 'signup' as kind, created_at as at, id as user_id, '가입했어요' as text from students
    union all
    select 'assignment', a.created_at, a.created_by,
           '수행평가를 올렸어요: ' || a.subject || coalesce(' ' || a.ban, '') || ' · ' || a.title
             || case a.status when 'pending' then ' (승인 대기)' when 'rejected' then ' (거절됨)' else '' end
      from public.assignments a
    union all
    select 'done', d.done_at, d.user_id, '수행평가를 완료 표시했어요' from public.assignment_done d
    union all
    select 'personal', x.updated_at, x.user_id, '수행평가를 내 계정에서 고쳤어요' from public.assignment_personal x
    union all
    select 'event', e.created_at, e.user_id, '일정을 추가했어요' from public.events e where e.source_key is null
    union all
    select 'todo', t.created_at, t.user_id, '할 일을 추가했어요' from public.todos t
    union all
    select 'group', g.created_at, g.created_by, '그룹을 만들었어요' from public.audience_groups g
    union all
    select 'feedback', f.created_at, f.user_id, '피드백을 보냈어요' from public.feedback f
    union all
    select 'status', s.updated_at, p.id, '위치를 남겼어요: ' || s.location
      from public.student_status s join students p on p.student_id = s.student_id
  )
  select jsonb_build_object(
    'roster', (select count(*) from public.roster),
    'not_joined', coalesce((
      select jsonb_agg(jsonb_build_object('student_id', r.student_id, 'name', r.name) order by r.student_id)
        from public.roster r
       where not exists (select 1 from students p where p.student_id = r.student_id)), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', p.student_id,
        'name', p.name,
        'joined_at', p.created_at,
        'last_login', u.last_sign_in_at,
        'location', st.location,
        'location_at', st.updated_at,
        'push', (select count(*) from public.push_subscriptions x where x.user_id = p.id),
        'assignments', (select count(*) from public.assignments x where x.created_by = p.id),
        'personal', (select count(*) from public.assignment_personal x where x.user_id = p.id),
        'done', (select count(*) from public.assignment_done x where x.user_id = p.id),
        'events', (select count(*) from public.events x where x.user_id = p.id and x.source_key is null),
        'todos', (select count(*) from public.todos x where x.user_id = p.id),
        'groups', (select count(*) from public.audience_groups x where x.created_by = p.id),
        'feedback', (select count(*) from public.feedback x where x.user_id = p.id)
      ) order by p.created_at desc)
        from students p
        left join auth.users u on u.id = p.id
        left join public.student_status st on st.student_id = p.student_id), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb order by r.at desc)
        from (select a.kind, a.at, a.text, p.student_id, p.name
                from activity a join students p on p.id = a.user_id
               order by a.at desc limit 100) r), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.admin_overview() from public, anon;
grant  execute on function public.admin_overview() to authenticated;
