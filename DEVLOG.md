# dshs42.app 개발 로그 (옛 이름 dshs.study)

무엇을 왜 바꿨는지, 무엇이 남았는지를 세션 단위로 기록합니다. **시간순으로 쌓이고 최신 기록이 맨 아래**에 있습니다.

## 개발 흐름

주요 개발만 한 줄씩 모았습니다. 자세한 내용은 아래 날짜별 기록을 보세요.

<!-- 개발 흐름 시작: 세션이 기록될 때 주요 개발이면 자동으로 한 줄 추가됩니다 -->
- **2026-10-27** 첫 버전: 시간표·분반·교실 검색(로그인 없이), 학번 가입, 분반별 수행평가 공지(RLS로 범위 제한), 기한 푸시 알림, PWA
- **2026-10-28** 달력 기반 일정관리로 확장: 내 일정·수행평가 공지·할 일 탭, 일정 공유, 시간표 배경 연동, 관리자 학교 일정
- **2026-10-30** dshs.app 연동 방향 결정(크롤링 대신 공식 OAuth, 급식은 NEIS API), DEVLOG와 팀 공용 자동 git pull/push 훅 도입
- **2026-10-31** 알림 개편: 기기별 켜기/끄기, 수행평가 마감 1일·6시간 전, 일정·필수 학교 일정 30분 전
- **2026-11-01** Check Push 체계(push 전 원격 확인·병합, DEVLOG 함께 갱신)와 팀 공용 CLAUDE.md, 학사일정(NEIS) 달력 연동, 업데이트 소식 팝업, 로그인 시 내 시간표, 서비스 이름 dshs42.app, 수행평가 마감 미정(D-?)·작성자 표시·작성자/관리자 수정 <!-- session a12519e2 -->
- **2026-11-01** 학생 수강 과목·분반별 수행평가 일괄 등록, 지필평가 기간·목요일 귀가일 R&E 시간표 제외, 수행평가 탭 문구 완화와 제출처 선택 도입, 수행평가 탭 알림 버튼 제거 <!-- session cfda7dec -->
<!-- 개발 흐름 끝 -->

## 쓰는 법

- 각 기록은 `## 날짜 시간 · 제목` 으로 시작하고, 목표 · 한 일 · 결정과 이유 · 해결한 문제 · 남은 일 · 배운 점 · 바뀐 파일 순서로 씁니다 (해당 없는 항목은 생략).
- **Claude Code 로 작업하면 모든 세션이 자동으로 기록됩니다.** 세션을 열면 `git pull`, **Check Push 할 때마다** 그때까지의 대화를 요약해 이 파일 맨 아래에 기록하고 코드와 함께 올립니다. push 없이 끝난 세션은 Claude 의 마지막 답변 뒤 10분 동안 다음 요청이 없으면 기록해 커밋 · `git push` 합니다. 주요 개발이면 위 "개발 흐름" 에도 한 줄이 추가됩니다. 설정 방법은 [README 의 "개발 흐름"](README.md#개발-흐름-자동-git-pull--push--개발-로그) 을 보세요.
- 같은 세션을 이어서 작업하면 (`session xxxxxxxx` 가 같으면) 새로 추가하지 않고 그 기록을 갱신합니다.
- Claude Code 없이 작업할 때는 시작 전에 `git pull`, 끝나면 이 파일 맨 아래에 같은 형식으로 기록을 추가한 뒤 커밋 · `git push` 해 주세요. 주요 개발이면 "개발 흐름" 에도 한 줄 추가해 주세요.

<!-- 기록은 이 줄 아래에 시간순으로 쌓입니다 (최신이 맨 아래) -->

## 2026-10-27 · 첫 버전: 시간표 + 계정·분반별 수행평가 공지

커밋 `5afa046` · `4d47122` · `db5c409`

### 한 일
- 시간표·분반·교실·선생님 검색 (로그인 없이 사용 가능)
- 학번 기반 회원가입 (`signup` Edge Function, 학번당 1계정을 서버에서 강제)
- 분반별 수행평가 공지: 수강 과목에만 올릴 수 있고, 관리자 승인 후 그 과목 수강생에게만 표시 (RLS)
- 기한 알림: D-3 / D-1 / 당일 웹 푸시 (`send-reminders` + cron)
- 명단 92명 + 수강 1081행 (`seed.sql`), 분반 정보 (`bans.sql`), 관리자 계정 (`admins.sql`)
- PWA: `manifest.webmanifest`, 아이콘, `sw.js` (오프라인 + 푸시 수신)

### 결정과 이유
- `config.js` 를 비워 두면 로그인 없이 시간표만 동작 → 백엔드 없이 먼저 배포 가능
- 공지 범위 제한은 화면이 아니라 DB 권한(RLS)으로 → 다른 과목 공지는 애초에 내려받아지지 않음

### 바뀐 파일
- 저장소 전체 (22개 파일)

## 2026-10-28 · 공지 추가 버그 수정

커밋 `7e7c247`

### 해결한 문제
- iOS 에서 `Notification` 관련 오류로 공지 추가가 실패하던 문제 수정
- 공지 추가 폼이 덮어써지던 문제 수정

### 바뀐 파일
- `dshs-study.js`, `sw.js`

## 2026-10-28 13:36–20:06 · 달력 기반 일정관리 앱으로 확장

`session 6a257d64` · 요청 44회 · 커밋 `747061e`

### 목표
- 수행평가 UI 를 달력 중심 일정관리 앱으로 확장

### 한 일
- Supabase 프로젝트(`jsanpwlleufzgglqkrkv`) 연결 확인: 테이블 6개 · RLS · Edge Function(`signup`, `send-reminders`) · cron 정상
- 탭 3개 구성: 🗓 내 일정 / 📢 수행평가 공지 / ☑️ 할 일, 이름 버튼은 로그아웃 버튼으로 교체
- 내 일정: FullCalendar(3일/주/월/목록), 개인 일정 추가·수정·삭제, 종료 시간 자동(+1시간)과 길이 버튼, 드래그 이동·리사이즈(15분 단위), 완료 체크
- 일정이 지나면 자동 완료, 지난 일정을 미래로 옮기면 완료 해제(공유받은 사람의 체크 포함)
- 일정 공유(`event_members`, `search_people`), 공유받은 일정은 만든 사람만 수정·삭제
- 수행평가 공지 탭: 3일 내 급한 공지 + 과목 블록 클릭 시 해당 과목 공지, 내가 올린 수행평가는 승인 전에도 본인에게 표시
- 수행평가는 달력에서 노란 실선 테두리로 통일, 마감 기본값은 일주일 뒤 23:59
- 할 일: 날짜 없이 추가가 기본, 📅 메뉴로 기한 설정, 기한 있는 할 일은 달력 종일 칸에 표시(체크·드래그로 기한 이동)
- 시간표를 달력에 흐린 배경 블록으로 연동("학교 시간표 보이기"), 학교 일정(관리자 전용, 전체/반/수강/개인 대상, 수업 없는 날)
- 삭제·이동 시 실행 취소 알림(7초, 줄어드는 테두리 타이머, 마우스 올리면 일시정지, ⌘Z)
- DB 적용: `events.sql`, `share.sql`(트리거 포함), `todos.sql`, `school.sql`, 반려 수행평가 삭제 권한 변경

### 결정과 이유
- 승인은 "분반 전체 공지"인 수행평가만, 개인 일정은 승인 없이 본인에게 바로 보임
- 마감 기본값 23:59 — 00:00 이면 달력·D-day 에서 다음 날로 보임
- 자동 완료는 DB 저장 없이 렌더링 때 계산, 완료 해제는 "지난 일정 → 미래" 일 때만 (미래→미래는 유지)
- 공유받은 사람의 체크 해제는 본인만 수정 가능한 구조라 DB 트리거로 처리
- 학교 일정 대상은 학번으로 저장 → 미가입 학생도 나중에 가입하면 보임
- 수행평가는 분반 전체 공지라 드래그 이동 불가
- 개인 일정 삭제는 확인 창 대신 실행 취소, 학교 일정 삭제는 모두에게 영향이라 확인 창 유지
- 오후 교시 시각(점심 12:10–13:10, 5교시 13:10 시작) 확인 완료

### 해결한 문제
- 일정 수정 후 강력 새로고침해야 반영 → `sw.js` 가 Supabase 응답과 `.js` 를 cache-first 로 저장 → 외부는 정적 파일만 캐시, `.js` 는 network-first, 캐시 버전 v24
- 실행 취소 타이머 선이 테두리와 어긋남 → padding 애니메이션 중 크기를 미리 재고 1px 오프셋 → 크기 변경 시 다시 그리고 padding 애니메이션 제거
- 승인 대기 수행평가만 점선 테두리 → 별도 점선 CSS 규칙 → 삭제해 실선 통일
- 3일 보기가 주 시작일부터 표시 → 오늘이 범위 안이면 오늘부터 시작
- FullCalendar 스타일 미적용 → `.fc` 가 컨테이너 자체에 붙어 `.fc-host .fc` 셀렉터가 안 맞음 → 셀렉터 수정
- DB 적용 시 `Invalid or expired requestState` 연결 오류 → 재시도로 해결

### 남은 일
- [ ] 배포 방식 확인: Netlify 드래그 업로드면 폴더를 다시 올려야 함
- [ ] 개인 일정·공유받은 일정 알림 (`send-reminders` 수정·재배포)
- [ ] 알림 시간 조정 (23:59 마감 때문에 D-3/D-1 알림이 밤 11시 반쯤 옴)
- [ ] 시간표 검색 시 윗줄 탭 강조가 남는 문제
- [ ] 할 일 수행평가 쪼개기, 오늘 화면, 반복 일정 등 검토
- [ ] 푸시 알림이 실제 폰에 뜨는지 미확인 (sent: 0)
- [ ] Supabase Leaked password protection 켜기
- [ ] 이후 변경은 PR 로 올리기

### 배운 점
- 로컬에서 실행해도 실제 서비스 DB 에 연결되므로 테스트 데이터 주의
- Supabase MCP 는 연결 시 선택한 조직에만 접근 가능 → 초대 후 재연결 필요
- 코드 수정 시 `sw.js` 캐시 버전을 올려야 하고, Supabase 응답은 캐시 금지
- 교시 시각은 `PERIOD_TIME` 한 곳에서 관리

### 바뀐 파일
- `events.sql`, `share.sql`, `todos.sql`, `school.sql`
- `dshs-study.js`, `index.html`, `README.md`

## 2026-10-30 18:37–20:40 · dshs.app 연동 조사, 개발 로그와 자동 git pull/push 도입

`session 4977a58f` · 요청 5회

### 목표
- dshs.app 의 자습실 자리, 급식, 벌점, 특별실·취식 신청을 dshs.study 에 넣을 방법 찾기
- 개발 기록을 git 으로 팀과 공유하고, 모든 팀원의 세션마다 git pull / 개발 로그 / git push 가 자동으로 되게 하기

### 한 일
- dshs.app 구조 조사: SvelteKit 앱, 로그인은 `id.dshs.app` OIDC 서버 (운영: 레디스쿨, 개발자 콘솔 `dshs.app/dev`)
- `id.dshs.app/.well-known/openid-configuration` 에서 외부 앱용 scope 확인: `reservations_read`, `penalties_read`, `requests_read`, `outrequests_read` 등
- 급식은 로그인 없이 `dshs.app/meal/YYYYMMDD/__data.json` 으로 받아짐 확인 (CORS 허용 헤더 없음)
- `/reserve`, `/penalty` 는 로그인 필요, `/api-doc` (API 문서) 링크는 현재 404
- 이용약관 확인: 계정 양도·대여 금지, 다른 이용자 개인정보 무단 수집·공개 금지, 봇 방지 조치 운영
- `DEVLOG.md` 도입, 이전 기록 정리 (시간순, 최신이 맨 아래)
- 팀 공용 Claude Code 훅 추가 (`.claude/settings.json`, `.claude/hooks/*.mjs`): 세션 시작 시 `git pull`, 종료 시 개발 로그 요약 → 커밋 → `git push`
- README 에 "개발 흐름" 절 추가

### 결정과 이유
- 크롤링 대신 **공식 OAuth 연동** — 학생 아이디·비밀번호로 대신 로그인하는 건 약관상 계정 대여에 해당하고 봇 차단에도 걸림
- 급식은 **NEIS 교육정보 개방 포털 API** 우선, dshs.app `__data.json` 은 비공식이라 대안으로만
- dshs.app 호출은 전부 **Supabase Edge Function 경유** — CORS 가 없어 브라우저에서 직접 못 부름
- 벌점은 OAuth 로 받은 본인 토큰으로만 조회 → 다른 사람이 볼 경로 자체가 없음
- dshs.app 에서 가져온 신청 일정은 달력에서 **읽기 전용** (원본이 dshs.app 이라 여기서 옮겨도 실제 신청은 안 바뀜)
- 자습실 자리 검색은 전교생 데이터가 필요해 약관 문제 → "동의한 학생만 공개" 또는 운영자에게 좌석 API 공식 요청 중 선택 필요
- 훅은 Node 스크립트로 작성 — Windows·Mac 모두에서 돌고, Node 는 이미 프로젝트에 필요한 도구(`npx web-push`, Supabase CLI)
- 개발 로그 요약은 세션 종료 후 백그라운드에서 실행 — 종료 훅은 시간 제한이 짧고, 에디터를 닫아도 끝까지 돌아야 함
- 훅 실행 기록은 `.git/devlog-hook.log` 에 남김 — 커밋되지 않는 위치

### 남은 일
- [ ] dshs.app 운영자에게 문의: OAuth client_id 발급(redirect URI = Edge Function), API 문서, 취식 신청 scope, 좌석 배치도 API 여부
- [ ] NEIS 급식 Edge Function + 급식 탭 (운영자 답 없이 바로 가능)
- [ ] client_id 받은 뒤: `dshs-oauth`(토큰 교환·저장), `dshs-sync`(예약·신청·벌점 동기화) Edge Function
- [ ] 자습실 자리 검색 방식 결정
- [ ] 다른 팀원 PC(Mac)에서 자동 pull/push 훅 동작 확인

### 배운 점
- dshs.app 은 외부 연동용 OAuth 권한을 이미 공개하고 있어서, 운영자 승인만 받으면 공식 경로로 붙일 수 있음
- 새 Edge Function 응답도 `sw.js` 캐시 대상에서 빠져 있어야 하고, 배포 시 캐시 버전을 올려야 함

### 바뀐 파일
- `DEVLOG.md`, `README.md`, `.gitignore`
- `.claude/settings.json`, `.claude/hooks/lib.mjs`, `.claude/hooks/session-start.mjs`, `.claude/hooks/session-end.mjs`, `.claude/hooks/devlog-worker.mjs`

## 2026-10-31 · 알림 켜기/끄기와 필수 학교 일정 알림

### 한 일
- 기기별 알림 켜기/끄기 버튼 (`내 일정`·`수행평가 공지` 탭), 로그아웃하면 그 기기 알림도 해제
- `send-reminders` 재작성: 수행평가 마감 1일·6시간 전, 내 일정·공유 일정·필수 학교 일정 시작 30분 전, 1분마다 실행
- 학교 일정 폼에 `필수 일정` 체크박스 추가 (`school_events.notify`)
- 라이브 적용: `notify_log` 테이블, Edge Function, 크론, 귀가일 2건 필수 표시

### 결정과 이유
- 시간표 수업은 알리지 않음 — 매일 여러 번 오면 정작 필요한 알림이 묻힘
- 하루 종일 일정은 시작 시각이 없어 그날 07:50 에 알림
- 알림 키에 시작·마감 시각을 넣음 — 일정을 옮기면 다시 알리고, 같은 알림은 두 번 가지 않음
- 알림 계산은 `plan.ts` 순수 함수로 분리 — DB·푸시 없이 테스트 가능

### 남은 일
- [ ] 실제 폰에서 알림 켜기 → 일정 알림 수신 확인 (아이폰은 홈 화면 추가 후)
- [ ] 라이브에 남은 미사용 테이블 정리: `notify.sql` 마지막 두 줄 (`reminder_log`, `class_slots`)

### 배운 점
- 사이트는 Netlify 가 GitHub `main` 에서 자동 배포함 — 드래그 업로드 아님
- 전역 스코프 파일을 고칠 때 맨 끝 `init();` 이 빠지지 않았는지 확인할 것. 빠지면 로그인이 통째로 사라짐

### 바뀐 파일
- `dshs-study.js`, `sw.js`, `schema.sql`, `notify.sql`, `README.md`, `DEVLOG.md`
- `supabase/functions/send-reminders/index.ts`, `supabase/functions/send-reminders/plan.ts`

## 2026-10-30 23:19 · 알림 기능 배포·디버깅과 일정 정리

### 목표
- 수행평가·일정 푸시 알림 기능을 라이브에 올리고, 켜기/끄기 버튼과 `필수 일정` 체크박스를 beta 사이트에 반영
- 알림이 실제로 기기에 오도록 원인 파악

### 한 일
- 시간표 수업 알림 제거 (민지 요청): 관련 코드, `class_slots.sql`, `gen_class_slots.py` 삭제, README·안내 문구 수정, 함수 v5 배포
- `🔔 알림 켜짐 / 🔕 알림 꺼짐` 버튼(`내 일정`, `수행평가 공지` 탭)과 `필수 일정` 체크박스(관리자 `학교 일정 추가` 창) 완성, 브라우저 테스트 8개 통과 (가짜 Supabase 사용)
- 팀원 커밋 2개 병합(README 충돌 해결), DEVLOG 기록 후 `main`에 푸시(`88b2281`) → beta 사이트 자동 배포
- 크론을 5분 → 1분 간격으로 변경, README·`index.ts` 주석 수정 후 푸시(`bfe2e70`)
- `qksalornt` 계정에 `알림 테스트`, `알림 테스트 2` 일정을 만들어 발송 확인 (23:36, 23:39 각각 2기기로 실패 0)
- 모든 사용자의 개인 일정 17건 삭제 (귀가일 학교 일정 2건은 유지), 백업 테이블 `events_backup_20261031`, `event_members_backup_20261031`
- `DEVLOG.md:150`의 "5분마다 실행"을 "1분마다 실행"으로 수정, 푸시(`89f0bd1`)

### 결정과 이유
- 사이트는 폴더 드래그가 아니라 GitHub `main` 푸시로 자동 배포됨 (Netlify가 `milkcat322/dshs-study`에 연결)
- 크론 1분 간격: 30분 전 시점을 놓치지 않고 정확히 보내기 위해
- 알림 화면 고정은 코드가 아니라 맥 설정(알림 스타일 `알림`)으로 조절: 코드로 고정하면 모든 학생 화면에 쌓임
- 일정 삭제 전 백업 테이블을 만들고 일반 사용자 접근을 막음. 영구 삭제(`drop table`)는 민지가 직접 실행하도록 남김

### 해결한 문제
- 로그인 버튼 사라질 뻔함 → 이전 작업에서 `dshs-study.js` 끝의 `init();` 한 줄을 실수로 삭제 → 복구 후 배포
- 알림이 30분 전이 아니라 26분 전에 도착 → 크론이 5분마다만 돌아 다음 실행 때 발송 → 크론 1분 간격으로 변경
- 맥에서 알림이 안 뜸 → 알림은 크롬까지 도착했으나 macOS 설정이 표시를 막음 (스타일 `배너`, 집중 모드 가능성) → 설정 변경 후 `알림 테스트 2`가 정상 표시됨
- 드래그 배포 안내가 틀림 → GitHub 연동 사이트였음 → 푸시로 배포하고 README의 배포 안내 수정
- "새 시간표가 올라왔어요" 문구 → `sw.js` 캐시 버전이 v29에서 v30으로 바뀌며 뜬 정상 동작

### 남은 일
- [ ] 업데이트 때마다 뜨는 "새 시간표가 올라왔어요 / 새로고침" 대신, 업데이트된 항목을 간단히 표시하고 닫으면 다시 안 보여주는 안내로 변경 (민지가 원하는 방향으로 말했으나 아직 작업 안 함)
- [ ] 달력에 남은 `알림 테스트`, `알림 테스트 2` 일정 삭제
- [ ] 백업 테이블 복구가 필요 없으면 SQL Editor에서 `drop table public.events_backup_20261031, public.event_members_backup_20261031;` 실행
- [ ] 라이브의 빈 `class_slots`, `reminder_log` 테이블 정리 (`notify.sql` 마지막 두 줄 실행)
- [ ] 실제 폰(아이폰 포함)에서 알림이 켜지고 도착하는지 확인

### 배운 점
- 서버가 "전송 성공"으로 기록해도 기기 표시는 별개이므로, 크롬 도착 여부와 OS 표시 설정을 따로 확인해야 함
- 팀 훅(milkcat322 계정이 `01d5c67`에서 추가): 세션을 열 때 `git pull`, 닫을 때 DEVLOG 기록 후 전체 커밋·푸시. `main`에서 작업하면 바로 배포되므로 큰 작업은 브랜치에서 하는 게 안전. 푸시 실패 로그는 `.git/devlog-hook.log`, 내 PC에서만 끄려면 `.claude/settings.local.json`에 `{ "disableAllHooks": true }`
- 시작까지 20분도 안 남은 일정은 알림 시간대를 지나 알림이 가지 않음. 관리자 계정은 수행평가 알림을 받지 않으므로 테스트는 개인 일정으로

### 바뀐 파일
- `dshs-study.js`
- `DEVLOG.md`

## 2026-11-01 14:11–17:07 · CLAUDE.md·Check Push 체계 구축, 학사일정(NEIS) 연동, 서비스 이름 변경, 수행평가 공지 개선

`session a12519e2` · 요청 17회

### 목표
- 세션이 바뀌어도 개발 맥락과 팀 규칙이 유지되게 하고, 두 개발자가 동시에 작업해도 git push가 충돌 없이 합쳐지게 한다
- 학교 공식 학사일정을 달력에 반영하고, 서비스 이름 변경·탭 정리·수행평가 공지 기능을 개선한다

### 한 일
- CLAUDE.md 신설: 세션 이어가기 규칙, 개인 취향은 CLAUDE.local.md에 저장하도록 분리
- DEVLOG 자동 기록을 모든 세션(특히 VS Code에서 SessionEnd가 안 불리는 경우)으로 확장, 맨 앞에 "개발 흐름" 요약 추가
- `.gitattributes`(DEVLOG union 병합), `pre-push.mjs`(push 전 원격 확인·자동 병합), `/check-push` 스킬로 "Check Push" 체계 구축
- 기능 완성 시 Stop 훅이 올리지 않은 변경을 감지해 자동으로 Check Push하도록 보강
- NEIS 학사일정 API 연동(`scripts/fetch-academic.mjs`, `academic.json`, GitHub Actions 일일 갱신), 달력에 종류별 on/off 버튼 추가
- 카톡 공지 기반 동아리·행사 일정(`academic-extra.json`)을 NEIS 데이터와 병합해 추가, "문예예술동아리" → "문화예술동아리" 오타 수정
- 업데이트 소식 팝업(`updates.js`) 추가: 접속 시 한 번 노출, 좌측 상단에서 전체 내역 열람
- 로그인 시 "내 시간표" 탭을 맨 왼쪽에 추가하고 기본 진입 화면으로 설정
- 서비스 표시 이름을 dshs.study → dshs42.app으로 변경(로그인 이메일 도메인 등 내부 값은 유지)
- 중간고사 탭 삭제, "평균 학점" 탭을 "학점 계산"으로 이름 변경
- 수행평가 공지에 마감 미정(D-?), 작성자 표시, 작성자/관리자 수정, 관리자 삭제 기능 추가(`notice.sql` 신설)

### 결정과 이유
- Check Push를 완전 자동화하지 않고 Claude 판단에 맡김: `main` push 시 바로 배포되므로, 쉬었다는 이유만으로 미완성 코드가 배포되는 것을 막기 위함
- DEVLOG는 Check Push할 때마다 함께 갱신하도록 변경: 짧은 간격으로 요청이 이어지면 10분 대기 조건으로는 기록이 계속 밀리는 문제가 있었음
- NEIS에 없는 자체 공지 일정은 `academic.json`을 직접 고치지 않고 `academic-extra.json`에 별도 저장: 매일 자동 갱신 시 NEIS 데이터로 덮어써져 사라지는 것을 방지
- 서비스 이름은 화면 표시만 변경하고 로그인 이메일 도메인(`@dshs.study`)과 내부 파일/저장소 이름은 유지: 바꾸면 기존 계정 로그인이 깨지거나 배포 연결이 끊김

### 해결한 문제
- DEVLOG 자동 기록이 안 됨 → VS Code에서 세션을 닫아도 SessionEnd 훅이 호출되지 않음 → Stop 훅 기반으로 10분 무응답 시 기록, Check Push 시에도 함께 갱신하도록 변경
- 두 개발자가 동시에 DEVLOG 끝부분에 기록을 추가해 push 충돌 발생 → git이 같은 위치의 동시 추가를 병합하지 못함 → `.gitattributes`에 union 병합 지정, `pre-push.mjs`로 push 전 원격 확인·자동 병합 도입
- 학사일정 자동 갱신 커밋이 매번 순서만 바뀐 채 생성됨 → Windows와 GitHub Actions 서버의 한글 정렬 순서가 다름 → 정렬을 글자 코드 순으로 고정

### 남은 일
- [ ] `notice.sql`을 실제 서비스 DB에 실행
- [ ] 귀사일 일정 추가(NEIS·학교 홈페이지 어디에도 없어 자동 수집 불가, 규칙 또는 수동 등록 필요)
- [ ] 관리자가 수동 등록한 귀가일과 학사일정 귀가일이 중복 표시되는 문제 정리
- [ ] NEIS 인증키(`NEIS_KEY`)를 GitHub Secrets에 등록해 일정 누락 가능성 제거
- [ ] 실제 배포 사이트에서 모바일 화면·실 로그인으로 전체 기능 재확인

### 배운 점
- VS Code 확장에서는 세션 종료 시 SessionEnd 훅이 대개 실행되지 않는다
- Windows와 GitHub Actions(Linux) 환경은 한글이 섞인 문자열 정렬 순서가 다를 수 있어, 자동 생성 파일은 정렬 기준을 명시적으로 고정해야 한다

### 바뀐 파일
- `CLAUDE.md`
- `README.md`
- `DEVLOG.md`
- `.gitattributes`
- `.gitignore`
- `.claude/settings.json`
- `.claude/hooks/lib.mjs`
- `.claude/hooks/session-start.mjs`
- `.claude/hooks/session-end.mjs`
- `.claude/hooks/stop.mjs`
- `.claude/hooks/pre-push.mjs`
- `.claude/hooks/devlog-worker.mjs`
- `.claude/skills/check-push/SKILL.md`
- `scripts/fetch-academic.mjs`
- `academic.json`
- `academic-extra.json`
- `.github/workflows/academic.yml`
- `updates.js`
- `notice.sql`
- `schema.sql`
- `dshs-study.js`
- `index.html`
- `sw.js`
- `manifest.webmanifest`
- `config.js`
- `admins.sql`, `bans.sql`, `events.sql`, `notify.sql`, `school.sql`, `seed.sql`, `share.sql`, `submit.sql`, `todos.sql`
- `supabase/functions/send-reminders/index.ts`
- `supabase/functions/send-reminders/plan.ts`
- `supabase/functions/signup/index.ts`

<!-- flow: - **2026-11-01** Check Push 체계(push 전 원격 확인·병합, DEVLOG 함께 갱신)와 팀 공용 CLAUDE.md, 학사일정(NEIS) 달력 연동, 업데이트 소식 팝업, 로그인 시 내 시간표, 서비스 이름 dshs42.app, 수행평가 마감 미정(D-?)·작성자 표시·작성자/관리자 수정 -->

## 2026-10-30 20:13–14:27 · 알림 켜기/끄기와 필수 학교 일정 알림 구현·배포, 크론 1분 간격으로 조정

`session 2f23b3e7` · 요청 28회

### 목표
- 알림 켜기/끄기 토글 추가
- 수행평가는 마감 1일·6시간 전, 내 일정·필수 학교 일정(진로특강, 귀가일 등)은 시작 30분 전에 자동 알림
- 시간표 수업은 알림에서 제외 (중간에 요청 변경)

### 한 일
- `send-reminders` Edge Function을 재작성하고 계산 로직을 순수 함수 `planNotes`(`plan.ts`)로 분리, 로컬 테스트로 검증
- 기기별 `🔔 알림 켜짐 / 🔕 알림 꺼짐` 버튼 추가 (`내 일정`·`수행평가 공지` 탭), 로그아웃 시 그 기기 알림도 해제
- 학교 일정 폼에 `필수 일정` 체크박스 추가, `school_events.notify` 컬럼과 `notify_log` 중복 방지 테이블 도입
- 라이브 Supabase에 마이그레이션·함수 배포·크론 변경 적용
- 가짜 Supabase 기반 브라우저 테스트(Playwright) 8개 작성·통과
- 충돌난 README를 양쪽 내용 살려 병합하고 배포 안내를 "`main` 푸시 시 자동 배포"로 수정
- 맥 크롬·서버 발송 경로를 직접 점검하고 테스트 일정으로 실제 수신 확인
- 개인 일정 17건을 백업 테이블로 옮긴 뒤 삭제 (귀가일 등 학교 일정은 유지)
- DEVLOG에 알림 작업 기록 추가 후 "5분마다"를 "1분마다"로 정정

### 결정과 이유
- 시간표 수업 알림 제거: 사용자 요청. 서버용 시간표 코드와 `class_slots.sql`, `gen_class_slots.py`도 함께 삭제
- 알림 on/off는 기기별로 저장: 같은 기기에서 다른 사람이 로그인해도 이전 사람의 알림이 가지 않게 하려는 목적
- 하루 종일 일정은 그날 07:50에 알림
- 마감까지 24시간 미만으로 늦게 올라온 수행평가는 바로 알림, 승인 대기 중 공지는 올린 본인에게만 발송
- 일정 삭제 전 비공개 백업 테이블(`events_backup_20261031`, `event_members_backup_20261031`)로 이동해 복구 가능하게 함
- 프런트 반영은 `main` 푸시로 진행 (Netlify가 GitHub 자동 배포)

### 해결한 문제
- 로그인 버튼과 기능 전체가 멈출 수 있음 → 이전 작업 중 `dshs-study.js` 끝의 `init();`이 지워짐 → 브라우저 테스트로 발견해 복구 (라이브에는 올라간 적 없음)
- 폰에서 `필수 일정`이 "필수 일 / 정"으로 줄바꿈 → 설명 문구가 길었음 → 문구를 줄이고 `nowrap` 적용, 320px까지 한 줄 확인
- 알림이 30분 전이 아니라 26분 전에 도착 → 크론이 5분 간격이라 30분 시점을 지난 뒤 다음 실행에서 발송 → 크론을 1분 간격으로 변경 (수행평가 1일·6시간 알림 지연도 함께 해결)
- 맥 크롬에서 알림이 화면에 안 뜸 → 알림은 크롬까지 도착했으나 macOS의 Chrome 알림 허용이 꺼져 있었음 → 시스템 설정에서 허용 후 정상 확인
- README 병합 충돌 → 팀원 커밋과 파일 목록 수정이 겹침 → 양쪽 내용을 모두 살려 해결

### 남은 일
- [ ] 라이브에 남은 미사용 테이블 `class_slots`, `reminder_log` 정리 (`notify.sql` 마지막 두 줄)
- [ ] 백업 테이블 2개를 복구가 필요 없다고 판단되면 삭제
- [ ] 폰(특히 아이폰은 홈 화면 추가 후)에서 실제 알림 수신 확인
- [ ] 수행평가 1일·6시간 알림은 실제 발송으로 검증하지 못함 (로컬 테스트로만 확인)

### 배운 점
- 서버가 "전송 성공"을 기록해도 기기에서 안 뜰 수 있음. 크롬의 `getNotifications`와 macOS 알림 설정까지 봐야 원인을 알 수 있음
- 푸시 알림 정시성은 크론 간격이 결정함. 30분 전처럼 정확한 시점은 1분 간격이 필요함
- `sw.js` 캐시 버전을 올리면 기능만 추가돼도 "새 시간표가 올라왔어요" 안내가 뜸. 문구가 시간표 변경 기준이라 실제 시간표 변화와 다를 수 있음
- 팀 훅(`.claude/hooks`)이 세션 종료 시 변경 전체를 현재 브랜치에 커밋·푸시하므로, `main`에서 작업하면 바로 배포됨
- VS Code에서 세션을 닫아도 SessionEnd 훅이 실행되지 않는 경우가 있어, Check Push 시점에 기록을 보강해야 누락을 막을 수 있음
- 이 PC에는 Supabase CLI가 없어 Edge Function·DB 변경은 직접 배포할 수 없음

### 바뀐 파일
- `.claude/hooks/devlog-worker.mjs`
- `.claude/hooks/lib.mjs`
- `.claude/hooks/pre-push.mjs`
- `.claude/hooks/session-end.mjs`
- `.claude/hooks/session-start.mjs`
- `.claude/hooks/stop.mjs`
- `.claude/settings.json`
- `.claude/skills/check-push/SKILL.md`
- `.gitattributes`
- `.github/workflows/academic.yml`
- `.gitignore`
- `CLAUDE.md`
- `README.md`
- `academic-extra.json`
- `academic.json`
- `index.html`
- `manifest.webmanifest`
- `scripts/fetch-academic.mjs`
- `sw.js`
- `dshs-study.js`
- `updates.js`
- `.claude/hooks/session-end.mjs`
- `.claude/hooks/session-start.mjs`
- `.claude/settings.json`
- `.gitignore`
- `README.md`
- `dshs-study.js`
- `notify.sql`
- `schema.sql`
- `supabase/functions/send-reminders/index.ts`
- `supabase/functions/send-reminders/plan.ts`
- `sw.js`

## 2026-11-01 15:07–17:12 · 학생 과목·분반별 수행평가 일괄 등록과 수행평가 탭 개편

`session cfda7dec` · 요청 11회

### 목표
- 붙여넣은 과목별 수행평가 목록을 학생이 속한 과목·분반별 일정으로 등록한다.
- 지필평가·방학 기간과 목요일 귀가일의 시간표 표시를 바로잡는다.
- 수행평가 탭의 문구, 입력 항목, 알림 버튼을 정리한다.

### 한 일
- 라이브 DB에 수행평가 15건을 승인 상태로 등록했고, 수강 과목·분반이 맞는 학생에게만 보이게 했다.
- 일반물리실험2·컴퓨터물리해석은 수업일마다 23:59 마감 공지를 분반별로 12/4까지 총 65건 넣었다.
- 마감이 지난 미적분학2·자료구조 공지 2건을 지웠고, 한건희T 보고서·인공지능정보는 넣지 않았다.
- 달력에서 지필평가 기간에는 시간표를 깔지 않게 했다.
- 목요일이 귀가일이면 달력에서 R&E 칸을 뺐다.
- 입력 폼의 내용(선택)을 없애고 제출(선택)을 넣었다. 선택지는 클래스룸·dshs앱·패들렛·메일·그 외(입력)이다.
- "수행평가 공지"를 "수행평가", "공지 올리기"를 "수행평가 추가"로 바꿨고, 승인 전에는 나만 보인다는 안내를 폼에 넣었다.
- 기존 공지에 남은 안내 내용 71건을 지웠다.
- 일반생물학 수행평가를 3건으로 나눴다: 진화의 흔적 11/27, 슬라이드 정리·개체 선정 및 진화 질문 12/31.
- 수행평가 탭의 알림 켜기/끄기 버튼을 제거했다.
- 업데이트 소식에 변경 내용을 추가했다.

### 결정과 이유
- 이미 날짜가 지난 수행평가는 등록하지 않는다. 지난 건은 모두 뺐다.
- 등록 계정은 관리자 계정으로 했다. 학생 계정으로 올리면 듣지 않는 과목 공지가 그 학생에게 보이기 때문이다.
- "자정"은 해당일 23:59로, "12/7 24시"는 12/7 23:59로 넣었다.
- 2차 지필평가(12/14~12/18)의 2주 전 수업은 11/30~12/4 주 전체로 잡았다. 귀가일 금요일도 수업이 있는 것으로 봤다.
- 컴퓨터물리해석은 수업일마다 공지를 넣은 현재 상태를 유지한다.
- 중간고사는 1차 지필평가, 기말고사는 2차 지필평가라고 부른다. 이 용어는 메모로 남겼다.
- 알림 버튼은 일정 알림으로 대체되므로 제거했다.
- `feature/submit-place` 브랜치는 이번 구현과 겹쳐 머지하지 않는다. 머지하면 제출이 다시 필수가 되고 기존 내용이 가려진다.
- 매체언어 D반과 일반물리2 E반의 공지 2건이 사라졌는데, 직접 지운 것으로 확인돼 복구하지 않았다.

### 해결한 문제
- 지필평가 기간에도 수업이 달력에 표시됨 → 방학은 학사일정에서 휴업일로 분류돼 빠지지만 지필평가는 분류가 `해당없음`이었음 → 이름에 "지필평가"가 들어간 일정도 수업 없는 날로 처리했다.
- 로컬 `main`과 `origin/main`이 갈라져 `git pull`이 실패함 → Check Push 과정에서 원격 커밋을 먼저 병합한 뒤 push했다.

### 남은 일
- [ ] 일반생물학 과제 마감일 수정본 받아 반영하기 (사용자가 나중에 알려주기로 함)
- [ ] 정보과학프로젝트 제출물·평가 기준 안내는 삭제됐다. 필요하면 복구
- [ ] 정보과학프로젝트 제출 안내와 평가 기준 같은 내용이 필요하면 다시 넣기
- [ ] `feature/submit-place` 브랜치 정리(삭제는 하지 않은 상태)
- [ ] 이번 DEVLOG 기록의 정리 안 된 부분 손보기(해결된 할 일, 바뀐 파일 목록)

### 배운 점
- 학사일정에서 방학은 `휴업일`로 분류되지만 지필평가는 `해당없음`이라, 시간표를 뺄 때 이름으로 따로 걸러야 한다.
- 수행평가 공지는 마감 일시가 꼭 있어야 해서 "수업 당일 제출" 같은 항목은 날짜별 공지로 풀어서 넣어야 한다.

### 바뀐 파일
- `dshs-study.js`
- `sw.js`
- `updates.js`
- `submit.sql`
- `README.md`
- `CLAUDE.md`
- `.claude/hooks/devlog-worker.mjs`
- `.claude/hooks/lib.mjs`
- `.claude/hooks/pre-push.mjs`
- `.claude/skills/check-push/SKILL.md`
- `scripts/fetch-academic.mjs`
- `academic.json`
- `academic-extra.json`

<!-- flow: - **2026-11-01** 학생 수강 과목·분반별 수행평가 일괄 등록, 지필평가 기간·목요일 귀가일 R&E 시간표 제외, 수행평가 탭 문구 완화와 제출처 선택 도입, 수행평가 탭 알림 버튼 제거 -->
