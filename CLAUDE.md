# dshs-study — Claude Code 작업 안내

대전과학고 42기 종합 웹서비스 **dshs42.app** (옛 이름 dshs.study). 정적 PWA(`index.html` + `dshs-study.js`) + Supabase(DB·RLS·Edge Function). 설치·배포 절차와 파일 구성은 [README.md](README.md) 에 있다.

이 파일은 저장소에 커밋되어 **모든 팀원의 Claude Code 세션이 시작할 때 자동으로 읽는다.** 답변은 한국어로 한다.

## 세션 이어가기 (팀 공용 기억)

Claude Code 는 이전 대화를 기억하지 못한다. 이 프로젝트는 아래 두 파일로 세션과 팀원 사이의 맥락을 잇는다.

- **[DEVLOG.md](DEVLOG.md)** — 세션별 진행 기록 (최신이 맨 아래). 작업을 시작하기 전에 맨 아래 2~3개 기록과 `남은 일` 을 먼저 읽는다. 사용자가 "지난번에 하던 거", "이어서" 라고 하면 여기서 찾는다.
- **CLAUDE.md (이 파일)** — 바뀌지 않는 규칙과 주의할 점.

DEVLOG 의 각 기록 둘째 줄에는 `session … · 개발 <git 사용자 이름> · 요청 N회` 로 **누가 개발했는지**가 들어간다 (`devlog-worker.mjs` 가 그 PC 의 `git config user.name` 으로 넣음). 팀원마다 `git config user.name` 을 알아볼 수 있는 이름으로 설정해 둔다.

DEVLOG 맨 앞의 `개발 흐름` 은 주요 개발만 한 줄씩 모은 요약이라, 프로젝트 전체 맥락은 여기서 먼저 파악한다.

세션 시작 시 훅이 `git pull` 을 하고, 답변 뒤 10분 동안 다음 요청이 없으면 대화를 요약해 DEVLOG 에 추가 → DEVLOG.md 커밋 → `git push` 를 자동으로 한다 (`.claude/hooks/`). 그래서 모든 세션이 기록되고, 다른 팀원이 한 작업도 DEVLOG 로 이어받을 수 있다. 자동 기록은 코드 변경을 커밋하지 않으므로, 작업이 끝나면 코드 커밋 · push 를 제안한다.

사용자가 "기억해줘", "앞으로는 ~" 라고 하면:
- 팀 모두에게 해당하는 규칙·주의점 → 이 파일의 `주의할 점` 에 한 줄로 추가 (커밋되어 팀에 공유됨)
- 진행 상황·할 일 → DEVLOG 의 `남은 일` 에 반영되도록 대화에 분명히 남긴다
- 그 사람 개인 취향 → 개인 메모리 또는 `CLAUDE.local.md` (git 에 올라가지 않음)

## 모든 세션에서 할 일

1. **시작**: DEVLOG 의 개발 흐름과 최근 기록의 남은 일을 확인한다 (`git pull` 은 훅이 자동으로 한다).
2. **DEVLOG**: Check Push 할 때마다 `node .claude/hooks/devlog-worker.mjs --mode write` 로 이 세션의 기록을 갱신해 코드와 함께 올린다 (빠뜨리면 pre-push 훅이 막는다). push 없이 끝난 세션은 답변 뒤 10분 동안 요청이 없을 때 훅이 자동으로 기록한다. DEVLOG 를 손으로 쓰지 않는다.
3. **CLAUDE.md**: 팀 모두가 알아야 할 규칙·주의점이 새로 생겼으면 이 파일에 추가한다.
   **업데이트 소식**: 학생에게 보이는 기능을 바꿨으면 `updates.js` 맨 위에 항목을 추가한다 (학생이 읽을 말로, 개발 용어 없이). 새 기능·눈에 띄는 변화는 `major: true` → 사이트에 들어올 때 한 번 팝업으로 뜬다. 작은 수정은 `major: false`. 같은 날 같은 주제면 새 항목 대신 기존 항목에 한 줄 더한다.
4. **Check Push**: 기능(또는 수정) 하나가 완성되어 동작 확인까지 끝나면, 사용자에게 묻지 않고 바로 커밋하고 Check Push 한다. 아직 개발 중이거나(동작하지 않는 상태 등) 사용자 답을 기다리는 중이면 올리지 않는다. `stop.mjs` 훅이 답변마다 올리지 않은 변경이 있는지 확인해 이 판단을 한 번 더 하게 한다.

### Check Push

**push 직전에 원격(git)을 확인하고, 다른 팀원의 새 커밋이 있으면 먼저 받아 합친 뒤 push 하는 이 팀의 push 방식.** 절차는 `/check-push` 스킬(`.claude/skills/check-push/SKILL.md`)에 있다. 사용자가 "Check Push" 라고 하면 이 절차를 따른다. 짧게는: 커밋 → `git fetch` → `git log HEAD..@{u}` 로 팀원의 새 커밋 확인 → 있으면 `git pull --rebase --autostash` 로 합치고 확인 → `git push`.

`.claude/hooks/pre-push.mjs` 가 Claude 의 모든 `git push` 앞에서 원격을 확인해, 새 커밋이 있으면 push 를 막는다. DEVLOG 자동 기록도 같은 방식으로 push 한다.

## 동시 작업과 충돌

여러 명이 같은 시간에 `main` 에서 작업한다. 충돌을 줄이려면:
- 모든 push 는 Check Push 로 한다.
- 작게 자주 커밋한다. 오래 쌓아 둘수록 충돌이 커진다.
- 이틀 넘게 걸리거나 여러 파일을 크게 바꾸는 작업은 `feature/이름` 브랜치에서 하고 PR 로 합친다.

`git pull` 이 충돌하면 (세션 시작 훅이 알려 주거나 직접 pull 하다가):
1. 사용자에게 어느 파일이 충돌했는지와 팀원 커밋의 내용(`git log`)을 먼저 보여 준다.
2. `git pull --rebase --autostash` 로 다시 받고, 충돌한 부분은 **양쪽 기능을 모두 살리는 방향으로** 합친다. 한쪽을 통째로 버리는 `--ours`/`--theirs` 는 사용자가 동의할 때만 쓴다.
3. 파일별 규칙
   - `sw.js` 의 `CACHE` 버전: 두 번호 중 큰 쪽 + 1
   - `DEVLOG.md`: `.gitattributes` 의 union 병합으로 보통 자동으로 합쳐진다. 합쳐진 뒤 기록이 시간순인지, 같은 기록이 두 번 들어가지 않았는지 확인한다.
   - `dshs-study.js`: 합친 뒤 맨 끝 `init();` 이 한 번만 있는지, 같은 함수가 두 번 정의되지 않았는지 확인한다.
4. 충돌 표시(`<<<<<<<`, `=======`, `>>>>>>>`)가 남지 않았는지 검색하고, `node --check dshs-study.js` 로 문법을 확인한 뒤 `git rebase --continue`.
5. 판단이 어려운 충돌(같은 기능을 서로 다르게 고친 경우)은 임의로 고르지 말고 사용자에게 묻는다.

## 주의할 점

- **로컬에서 실행해도 실제 서비스 DB 에 연결된다.** 테스트 데이터를 만들면 지운다.
- `main` 에 push 하면 Netlify 의 beta 사이트(`dshs42-beta.netlify.app`)에 바로 배포된다. 개발은 beta 에서 확인하고, `dshs42.app` 에는 나중에 반영한다. beta 도 실제 서비스 DB 를 쓴다. 세션 종료 시 변경 전체가 지금 브랜치로 자동 push 되므로, 큰 작업은 브랜치(`feature/이름`)에서 한다.
- 저장소가 둘이다: beta = `origin`(milkcat322/dshs-study, 평소 개발·Check Push), 메인 웹 = `prod`(milkcat322/dshs42.app → `dshs42.app`). 메인에는 사용자가 "메인 웹에 업로드" 라고 할 때만 `/deploy-main` 스킬로 beta 의 `origin/main` 을 그대로 올린다. 메인 저장소를 직접 고치지 않는다.
- 메인 저장소를 Netlify 프로젝트 `dshs42` 에 연결하기 전까지는 `dshs42.app` 이 GitHub 에 연결되지 않은 Netlify Drop 사이트라, 사이트 파일만 zip 으로 묶어(`index.html` · `config.js` · `dshs-study.js` · `sw.js` · `updates.js` · `manifest.webmanifest` · `academic.json` · `*.png`. `.sql` · DEVLOG · 메모 파일은 넣지 않는다) Deploys 화면에 올려 배포한다. 이때는 `academic.json` 매일 갱신도 dshs42.app 에는 올릴 때만 반영된다.
- 프론트 파일(`.js`, `index.html` 등)을 고치면 `sw.js` 의 `CACHE` 버전을 **반드시** 올린다. 페이지 · 스크립트는 서비스 워커가 받아 둔 것을 서버를 기다리지 않고 바로 쓰므로(캐시 우선), 버전을 안 올리면 학생 기기에 새 코드가 가지 않는다. 버전이 바뀌면 뒤에서 새로 받고 `index.html` 이 알아서 다시 연다(연 지 15초 안이면 바로, 아니면 화면을 떠날 때). `.json` 만 네트워크 우선. Supabase·Edge Function 응답은 서비스 워커가 캐시하면 안 된다.
- `dshs-study.js` 는 전역 스코프 파일이다. 고친 뒤 맨 끝의 `init();` 이 남아 있는지 확인한다 (빠지면 로그인이 통째로 사라짐).
- 교시 시각은 `dshs-study.js` 의 `PERIOD_TIME` 한 곳에서만 관리한다.
- 로그인 학생은 '지난 화면 먼저'로 시작한다: 마지막으로 받은 내 정보 · `cache` · 위치를 `dshs-snap`(localStorage)에 남겨 다음에 열 때 서버를 기다리지 않고 그리고(`loadSnap` → `openStart`), 서버 응답이 오면 바꾼다. 서버에 닿지 못하면 지난 화면을 유지하고, 서버가 로그인이 끝났다고 할 때만 로그아웃한다. `cache` 에 새 칸을 넣으면 `saveSnap` / `loadSnap` 에서 Set · Map 변환도 맞춘다. 탭을 누르면 받아 둔 `cache` 로 바로 그리고(`haveData`) 뒤에서 받아 바뀐 것만 다시 그린다 (`loadAssignments({ quiet: true })`, 30초 안이면 안 받음 · 관리 탭은 `ovLast`). 추가 · 수정 뒤에는 인자 없이 `loadAssignments()` 를 불러 늘 새로 받는다. 서버 연결(`sb`) 전에 탭을 누를 수 있으므로 `sb` 를 쓰는 진입 함수는 `if (!sb) await sbWait;` 로 기다린다.
- 피드백은 `feedback` 표와 비공개 버킷 `feedback` 에 저장한다. 내용과 스크린샷은 관리자만 본다. 버킷을 공개로 바꾸지 않는다. 보내기는 📢 업데이트 창의 '피드백' 탭(`openFeedback`), 받은 피드백은 관리자 사이트의 '관리' 탭에서 본다.
- **관리자 기능은 관리자 사이트에만 있다** (`admin/`, 학생 사이트와 같은 DB). 관리 탭(승인 · 피드백 · 학생 · 계획 · 점검 · 분석) · 수행평가 공지 올리기(바로 승인)와 고치기 · 학교 일정 관리(추가 · 수정 · 숨기기 · NEIS 고치기)는 `admin/admin.js` 에서 고친다. 학생 사이트(`dshs-study.js`)에 관리자 코드를 다시 넣지 않는다. 관리자 계정이 학생 사이트에 로그인하면 관리자 사이트로 안내하고(`openAdminMoved`) 그 기기의 알림 등록을 지운다. 관리자 사이트는 `scripts/build-admin.mjs` 가 학생 `index.html` 의 `<style>` · 테마 스크립트 · `SCHOOL_DATA` 와 `config.js` · `academic.json` · 아이콘을 가져와 `admin-dist/` 로 묶는다 → 학생 `index.html` 의 `.adm-*` 등 관리 화면 스타일은 관리자 사이트가 쓰므로 지우지 않는다. 배포는 사용자가 "관리자 사이트에 올려줘" 라고 하거나 `admin/` 을 고친 뒤 `node scripts/deploy-admin.mjs` (커밋한 뒤 실행 → 관리자 저장소 `milkcat322/dshs42-admin` 에 묶은 결과만 push → Netlify 배포). 관리자 저장소를 직접 고치지 않는다. 관리자 사이트 주소는 `config.js` 의 `ADMIN_URL`. 관리자 사이트는 학사일정을 beta 의 `academic.json` 에서 바로 받는다(`_headers` 로 다른 주소 읽기 허락). 관리자 사이트는 '기기 등록' 방식: 처음 한 번 관리자 비밀번호 한 칸만 넣으면(관리자 계정들에 차례로 로그인 시도) 그 기기는 계속 로그인된 채로 열리고, 로그아웃 대신 설정 아래 작은 '이 기기 등록 해제'만 있다. 로그인 자체를 없애지 않는다 (피드백 · 학생 정보가 관리자 권한(RLS)으로만 보이므로). **관리자 비밀번호는 코드 · 커밋 · DEVLOG · CLAUDE.md 에 적지 않는다** (Supabase 대시보드에서만 바꿈). DEVLOG 를 올리기 전에 비밀번호가 요약에 들어가지 않았는지 확인한다.
- 관리자에게 보낸 푸시(새 활동 · 운영 점검 · 사용 분석)는 `admin_push_log`(`adminpush.sql`)에 제목 · 내용 · 받은 기기 수로 남고, 관리자 사이트 관리 탭 '알림' 칸에서 본다. 관리자에게 가는 새 푸시를 만들면 이 표에도 한 줄 남긴다.
- 관리자 사이트 관리 화면(`renderOverview`)은 맨 위 카드 한 줄(`NAV`: 처리 · 학생 · 제안 · 학교 일정, 숫자는 `navStat`)로 옮겨 다닌다. 처리 = 수행평가 승인 · 합치기 · 새 피드백 · 처리 기록 · 지난 피드백, 학생 = 방문 기기 · 오늘 로그인 · 학생 현황(`admin_overview()`, `overview.sql`. RLS 를 넘어 읽으므로 본인만 보는 내용은 제목 없이 수와 시각만), 제안 = Claude 개발 제안 · 제작 진행 · 관리자별 계획(`admin_plans`, `plans.sql`. 칸 이름은 `PLAN_OWNERS`, 🛠 로 계획을 제작 초안으로). 운영 점검 · 사용 분석 보고서 · 알림 기록 화면은 없앴다(표는 남아 있음). 예전 알림 주소 `?pane=ops|use|push|plan|fb` 는 `PANE_ALIAS` 로 가까운 칸을 연다. 학생 현황의 제안은 `overviewTips()`. 수정 이력 표가 없어 지운 항목과 고치기 전 값은 나오지 않는다.
- 같은 수행평가 합치기(`merge.sql`, `supabase/functions/merge-suggest`): 운영 점검과 같은 시각(0 · 8 · 12 · 16 · 20시)에 같은 과목 · 다른 분반 · 비슷한 이름의 수행평가를 묶어 `merge_suggestions` 에 남기고, 관리 탭 '승인' 칸에서 마감이 같으면 이름을 고쳐 전체 분반 공지로 합치고(`merge_assignments`: 새 공지 만들고 완료 체크 옮기고 원래 공지 삭제, 원래 내용은 `merged_from`) 마감이 다르면 확인만 한다(`dismiss_merge`). 묶는 규칙은 `suggest.ts` 순수 함수 — 분반마다 매주 같은 이름으로 오는 과제(물리실험 보고서 등)가 뭉치지 않게 첫 마감에서 6일 안 · 분반마다 하나씩만 묶는다. '승인' 칸 아래 '처리 기록'에 승인 · 반려 · 합치기 · 확인 기록이 모두 남는다.
- 운영 점검 에이전트(`supabase/functions/ops-agent`, `ops.sql`)가 매일 0 · 8 · 12 · 16 · 20시(한국 시간)에 사이트 버전 · cron · 서버 함수 호출 실패율 · 승인 대기를 점검하고, 지난 보고서 이후 새 피드백을 Claude(`ANTHROPIC_API_KEY` secret, 없으면 개수만)로 분류 · 요약해 관리자 기기에 푸시하고 `ops_reports` 에 남긴다. 관리자 사이트에는 점검 화면이 없고, **문제(issues)나 급한 피드백이 있을 때만** 관리자에게 푸시한다(이상 없으면 기록만). 판단 규칙은 `report.ts` 순수 함수에 둔다. Claude 에는 피드백 본문만 보내고 이름 · 학번 · 스크린샷은 보내지 않는다. 점검은 읽기만 하고 코드 · DB 를 고치지 않는다. 확인용으로 `?dry=1`(저장 · 푸시 없음).
- 사용 분석 에이전트(`scripts/usage-agent`, `usage.sql`)는 서버가 아니라 **관리자 노트북의 Claude Code** 가 돌린다 (API 키 없음). `install.sh` 로 깔린 launchd 가 한 시간마다 `run.mjs` 를 깨우고, 가장 최근 밤 10시 분석이 없으면 `claude -p`(`prompt.md`, 팀 훅은 끄고 `--setting-sources user`)를 실행한다. Claude 는 git 기록 · `updates.js` · DEVLOG 개발 흐름으로 우리가 한 일을 보고, Supabase MCP 로 `usage_snapshot(14)` · 집계 쿼리(select 만, 이름 · 학번 조회 금지)를 읽어 로그인 현황 · 사용 양상 · 업데이트 반응 · 고칠 방향을 `save_usage_report()` 로 저장한다. 저장하면 `usage-agent` Edge Function 이 관리자에게 푸시한다. 목표는 '로그인해서 쓰는 학생 늘리기 · 수행평가 · 일정 기능을 쓰는 학생 늘리기'이고, 핵심 결과물은 개발 제안(suggestions, Claude 가 그대로 만들 수 있는 `spec` 포함)이다. `save_usage_report()` 가 제안을 `agent_tasks` 초안으로 넣고(같은 제목은 다시 넣지 않음) 관리자에게 '개발 제안 n개' 푸시 → 관리자 사이트 '제안' 칸에서 고치거나 '승인하고 만들기'. Claude 는 지난 제안 · 버린 제안 · 수정 메모를 읽고 반복하지 않는다. 분석 방향을 바꾸려면 `prompt.md` 를 고친다. 기록은 `~/Library/Logs/dshs42-usage-agent.log`.
- Claude 제작 맡기기(`agenttasks.sql`, `supabase/functions/build-agent`, `scripts/build-agent`): 관리자 사이트 '제안' 칸에서 초안(밤 10시 사용 분석이 만든 제안, 또는 '직접 맡기기')을 고쳐 '승인하고 만들기' → 관리자 노트북이 `build-agent` 함수(열쇠 `~/.dshs42-build-agent.json`, DB 에는 sha256 만 `agent_keys`)로 할 일을 받아 `agent-<번호>` 브랜치에서 만들고 미리보기와 함께 알림 → '수정 요청'(최대 3번) 또는 '최종 승인'(그때만 main 에 합침 → beta). 할 일 확인은 Claude 없이 해서 할 일이 없으면 토큰을 쓰지 않는다. Claude 는 DB(SQL) 를 바꾸지 않고 '사람 손 필요'로 멈춘다. `.sql` · `supabase/` 파일이 바뀐 제작도 '사람 손 필요'가 되지만, 미리보기가 있으면 관리자 사이트에서 '최종 승인'할 수 있고 합친 뒤 SQL 실행 · 함수 배포는 사람이 한다 (merged 카드에 '사람이 적용할 것'으로 남음). 노트북 쪽은 `run.mjs`(launchd 10분마다, `install.sh`), Claude 지시는 `prompt.md`, 기본 모델 sonnet(`BUILD_MODEL`), 작업 폴더는 사용자 폴더가 아닌 `~/.dshs42-build-agent/wt`. 미리보기는 Netlify branch deploy `https://agent-<번호>--dshs42-beta.netlify.app` (이 제작만의 `CACHE` 값을 쓰고, 합칠 때 main 번호 + 1 로 맞춘다). 합칠 때 main 이 그사이 바뀌었으면 다음 실행에 다시 합치고, `sw.js` 밖의 충돌은 '사람 손 필요'로 멈춘다. 기록은 `~/Library/Logs/dshs42-build-agent.log`.
- 방문 기기 수(`visits.sql`, `logVisit`)는 학생 화면에 아무것도 보이지 않게 기기별 무작위 ID 로 하루 한 줄만 남긴다. 비로그인 방문은 익명이고, 로그인한 상태로 연 날만 그 계정(`user_id`)과 첫 로그인 시각(`login_at`)을 남겨 관리 탭에 '오늘 로그인한 학생'을, 운영 점검 푸시에 '비로그인 → 로그인' 전환(그전엔 그 기기에서 비로그인으로만 쓴 학생, `ops_visit_logins`)을 보여 준다. 이름·학번은 관리자에게만 보이고, 표는 직접 읽고 쓸 수 없으며 `log_visit()`(누구나) · `admin_visits()`(관리자)로만 다룬다. 관리자 기기는 세지 않는다. 관리 탭 '학생' 칸 맨 위에 보인다.
- 수행평가 공지 댓글(`comments.sql`, `assignment_comments`)은 공지 RLS 를 그대로 따른다: 공지를 볼 수 있는 사람만 읽고 쓰고(승인 전 공지는 작성자 · 관리자만), 지우기는 본인 · 관리자(DB 권한. 관리자 사이트에는 아직 댓글 화면이 없다), 고치기는 없다. 작성자 이름은 트리거가 채운다. 공지를 지우면 댓글도 지워지고, 합치기(`merge_assignments`)는 댓글을 새 공지로 옮긴다. 화면은 `openAsgDetail` 아래 `loadComments` / `sendComment`.
- 수업 옮기기 기능은 삭제했다. 시간표 원본 `SCHOOL_DATA` 를 그대로 보여 준다. `class_changes` 표와 `classes.sql` 은 남아 있지만 코드에서 쓰지 않는다.
- 공지·일정의 접근 범위는 화면이 아니라 DB 권한(RLS)으로 막는다. 권한 관련 변경은 SQL 파일에 반영한다.
- DB 를 바꾸면 해당 `.sql` 파일에도 반영하고, 새 파일이면 README 1단계 실행 순서에 추가한다.
- 로그인 이메일 도메인 `EMAIL_DOMAIN = "dshs.study"` (dshs-study.js · signup Edge Function)는 서비스 이름이 바뀌어도 바꾸지 않는다. 계정이 `아이디@dshs.study` 로 저장돼 있어 바꾸면 모두 로그인이 안 된다. 로그인 유지 키(`dshs-study-auth`)·캐시 이름도 그대로 둔다.
- `config.js` 에는 anon 키만. service_role 키·VAPID 비밀키는 Edge Function secrets 에만 둔다.
- 외부 서비스(dshs.app 등) 호출은 브라우저가 아니라 Edge Function 을 거친다 (CORS). 크롤링·대리 로그인은 하지 않고 공식 OAuth/API 만 쓴다.
- dshs.app 연동(`dshs-oauth`): client_secret 은 Supabase secrets(`DSHS_CLIENT_SECRET`)에만 둔다. 대화·DEVLOG·커밋에 적지 않는다 (DEVLOG 자동 요약이 그대로 올릴 수 있음). 허용 scope 는 `openid profile me.read request.read offline_access` 뿐이고, 늘리려면 dshs.app 관리자에게 메일로 요청한다. 요청 제한(60초 120회)이 사이트 전체 합산이라 브라우저는 연결한 학생이 내 일정을 보는 동안에만 1분에 한 번 받고, 한도 초과(busy) 응답이 오면 5분 쉰다. dshs.app 에 이미 있는 기능을 똑같이 만들지 않는다 (이용 규칙).
- 회원가입 화면은 없다. 새 학생은 'dshs.app으로 로그인'으로 계정이 생긴다. 처음 온 학생은 계정이 없으므로 '로그인' 대신 'dshs.app 계정으로 시작하기' 버튼 하나만 쓴다: 로그인 전에는 위쪽 메뉴를 숨기고 시간표 막힘 화면의 버튼(`gateLogin`, 바로 dshs.app 로그인)만 둔다. 아이디·비밀번호 로그인은 관리자·예전 아이디 가입 학생용으로, 그 버튼 아래 작은 '관리자 · 아이디로 로그인'(`gateAdmin`) · 시작하기 창 · 설정 창 아래 같은 링크, 또는 설정 창 제목 "설정" 7번으로 연다 (`openAdminLogin`). 이 화면 변경은 업데이트 소식에 올리지 않았다.
- 로그인 · 연결 뒤 돌아갈 주소는 `dshs-oauth` 의 `RETURN_OK` 에 있는 사이트만 된다 (없으면 dshs42.app 으로 감). 새 주소(도메인)에서 서비스하면 여기에 추가하고 함수를 다시 배포한다. beta 와 그 브랜치 미리보기(`<브랜치>--dshs42-beta.netlify.app`)는 들어 있다.
- 할 일 그룹(`todogroups.sql`, `todo_groups` · `todos.group_id`): 그룹은 DB, 접기 · 펼치기는 기기마다 `dshs-todo-fold`(localStorage, 기본 모두 펼침). 표를 못 읽으면(`cache.todoGroups === null`) 그룹 UI 를 숨긴다. 끌어서 옮기기는 손잡이(⠿) 포인터 이벤트(`startTodoDrag`)라 터치에서도 된다.
- 'dshs.app으로 로그인'은 dshs.app 의 학번으로 계정을 찾는다 (연결된 계정 → 같은 학번 계정 → 명단에 있으면 새 계정 `d<학번>@dshs.study`, 임의 비밀번호). 세션은 Edge Function 이 만든 일회용 magiclink 토큰을 `#dshs_login=` 으로 넘겨 브라우저가 `verifyOtp` 로 만든다.
- 사이트 하단과 로그인 창의 "학생 비공식 사이트" 문구는 dshs.app 측 요청이라 지우지 않는다.
- 알림 구독 저장은 `save_push()`(`schema.sql`)로만 한다. 같은 기기(endpoint)가 다른 계정으로 남아 있으면 RLS 때문에 upsert 가 막혀 "알림이 안 켜짐"이 되므로, 이 함수가 기기를 지금 로그인한 계정으로 넘긴다. 같은 코드인데 사이트(주소)마다 알림이 다르게 동작하면 기기 · 주소별로 남은 구독 행부터 의심한다.
- 알림 계산은 `supabase/functions/send-reminders/plan.ts` 순수 함수에 둔다 (DB·푸시 없이 테스트 가능하게). 관리자 새 활동 알림(`planAdminNote`)은 학생 가입 · 수행평가 승인 요청 · 피드백만 묶어 보낸다. 할 일 · 일정 · 위치처럼 본인 활동은 넣지 않는다.
- 학사일정은 NEIS(학교 코드 `G10` / `7430032`)가 원본이다. `academic.json` 은 GitHub Actions 가 매일 덮어쓰므로 직접 고치지 않는다. NEIS 에 없는 일정(카톡 공지 등)은 `academic-extra.json` 에 적고 `node scripts/fetch-academic.mjs` 를 실행한다 (먼저 academic.json 과 비교해 이미 있는 건 넣지 않는다). 종류 분류는 `dshs-study.js` 의 `acadCat()` (관리자 사이트 `admin/admin.js` 에도 같은 함수가 있어 함께 고친다). 관리자가 관리자 사이트 '학교 일정' 탭에서 고치거나 숨긴 NEIS 일정은 `school_events` 에 `neis_key`("시작일|이름|대상학년")로 저장해 원본 대신 보여 준다 (NEIS 가 날짜·이름을 바꾸면 원본이 다시 함께 보일 수 있음). 꿈지락도 학생은 고칠 수 없고 관리자가 모두에게 고친다. 관리자 사이트 '학교 일정'은 목록 · 달력(`renderSchoolCal`)으로 보고, 달력에서 학생을 고르면(또는 '학생' 칸에서 학생을 누르면) 그 학생 달력에 보이는 공용 일정(대상 학교 일정 · 학년 NEIS · 듣는 분반 수행평가)과 완료 표시(`admin_student_done`, `overview.sql`)만 보여 준다. 개인 일정 · 할 일은 보여 주지 않는다. 날짜를 누르면 학교 일정 · 수행평가를 그날로 추가하고, 관리자는 수행평가 과목 · 분반 · 내용까지 고친다.
