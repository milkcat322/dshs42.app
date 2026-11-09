-- ============================================================
-- dshs42.app — 자습실 자리 (status.sql · dshsapp.sql 다음에 실행. 여러 번 실행해도 안전합니다)
--
-- 위치를 '자습실 자리'로 정한 학생은 dshs.app 에서 신청한 오늘 자리(예: a101)를 위치와 함께 보여 줍니다.
-- dshs.app 은 다른 학생의 자리를 주지 않으므로(개인 정보), 각 학생의 토큰으로 '내 자리'(reservation.read.me)만 받아
-- dshs-oauth 의 myseat 가 student_status.seat · seat_day 에 씁니다. 학생은 seat 를 직접 쓸 수 없습니다(아래 트리거).
-- 자리는 위치를 다른 곳으로 바꾸거나 지우면 함께 사라집니다.
-- ============================================================

-- 연결 토큰에 내 자리 읽기 권한(reservation.read.me)이 있는지. null = 아직 모름 (예전 연결은 처음 한 번 확인)
alter table public.dshs_links add column if not exists seat_ok boolean;

alter table public.student_status add column if not exists seat text check (seat is null or char_length(seat) <= 20);
alter table public.student_status add column if not exists seat_day text;   -- 그 자리가 몇 일 자리인지 YYYYMMDD (한국 시간)

-- 고칠 때마다 수정 시각을 지금으로 (status.sql 의 함수를 바꿉니다)
-- · 서버(service_role)만 seat · seat_day 를 바꿉니다. 학생이 고치면 '자습실 자리'를 유지할 때만 이전 자리를 남기고 아니면 지웁니다.
-- · 서버가 자리만 채울 때는 '고친 시각'을 바꾸지 않습니다 (학생이 위치를 고친 시각이 그대로 보이게).
create or replace function public.touch_student_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'UPDATE' and new.location = '자습실 자리' and old.location = '자습실 자리' then
      new.seat := old.seat; new.seat_day := old.seat_day;
    else
      new.seat := null; new.seat_day := null;
    end if;
    new.updated_at := now();
  elsif tg_op = 'INSERT' or new.location is distinct from old.location then
    new.updated_at := now();
  end if;
  return new;
end
$$;

-- 처음에 만들었던 좌석 배치도 저장 표 (다른 학생 자리를 받는 방식은 dshs.app 이 허락하지 않아 쓰지 않음)
drop table if exists public.dshs_seat_cache;
