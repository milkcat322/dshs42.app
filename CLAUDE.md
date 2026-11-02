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
- `main` 에 push 하면 Netlify 가 바로 배포한다. 세션 종료 시 변경 전체가 지금 브랜치로 자동 push 되므로, 큰 작업은 브랜치(`feature/이름`)에서 한다.
- 프론트 파일(`.js`, `index.html` 등)을 고치면 `sw.js` 의 `CACHE` 버전을 올린다. Supabase·Edge Function 응답은 서비스 워커가 캐시하면 안 된다.
- `dshs-study.js` 는 전역 스코프 파일이다. 고친 뒤 맨 끝의 `init();` 이 남아 있는지 확인한다 (빠지면 로그인이 통째로 사라짐).
- 교시 시각은 `dshs-study.js` 의 `PERIOD_TIME` 한 곳에서만 관리한다.
- 공지·일정의 접근 범위는 화면이 아니라 DB 권한(RLS)으로 막는다. 권한 관련 변경은 SQL 파일에 반영한다.
- DB 를 바꾸면 해당 `.sql` 파일에도 반영하고, 새 파일이면 README 1단계 실행 순서에 추가한다.
- 로그인 이메일 도메인 `EMAIL_DOMAIN = "dshs.study"` (dshs-study.js · signup Edge Function)는 서비스 이름이 바뀌어도 바꾸지 않는다. 계정이 `아이디@dshs.study` 로 저장돼 있어 바꾸면 모두 로그인이 안 된다. 로그인 유지 키(`dshs-study-auth`)·캐시 이름도 그대로 둔다.
- `config.js` 에는 anon 키만. service_role 키·VAPID 비밀키는 Edge Function secrets 에만 둔다.
- 외부 서비스(dshs.app 등) 호출은 브라우저가 아니라 Edge Function 을 거친다 (CORS). 크롤링·대리 로그인은 하지 않고 공식 OAuth/API 만 쓴다.
- dshs.app 연동(`dshs-oauth`): client_secret 은 Supabase secrets(`DSHS_CLIENT_SECRET`)에만 둔다. 대화·DEVLOG·커밋에 적지 않는다 (DEVLOG 자동 요약이 그대로 올릴 수 있음). 허용 scope 는 `openid profile me.read request.read offline_access` 뿐이고, 늘리려면 dshs.app 관리자에게 메일로 요청한다. 요청 제한(60초 120회)이 사이트 전체 합산이라 브라우저는 연결한 학생이 내 일정을 보는 동안에만 1분에 한 번 받고, 한도 초과(busy) 응답이 오면 5분 쉰다. dshs.app 에 이미 있는 기능을 똑같이 만들지 않는다 (이용 규칙).
- 'dshs.app으로 로그인'은 dshs.app 의 학번으로 계정을 찾는다 (연결된 계정 → 같은 학번 계정 → 명단에 있으면 새 계정 `d<학번>@dshs.study`, 임의 비밀번호). 세션은 Edge Function 이 만든 일회용 magiclink 토큰을 `#dshs_login=` 으로 넘겨 브라우저가 `verifyOtp` 로 만든다.
- 사이트 하단과 로그인 창의 "학생 비공식 사이트" 문구는 dshs.app 측 요청이라 지우지 않는다.
- 알림 계산은 `supabase/functions/send-reminders/plan.ts` 순수 함수에 둔다 (DB·푸시 없이 테스트 가능하게).
- 학사일정은 NEIS(학교 코드 `G10` / `7430032`)가 원본이다. `academic.json` 은 GitHub Actions 가 매일 덮어쓰므로 직접 고치지 않는다. NEIS 에 없는 일정(카톡 공지 등)은 `academic-extra.json` 에 적고 `node scripts/fetch-academic.mjs` 를 실행한다 (먼저 academic.json 과 비교해 이미 있는 건 넣지 않는다). 종류 분류는 `dshs-study.js` 의 `acadCat()`. 관리자가 사이트에서 고치거나 숨긴 NEIS 일정은 `school_events` 에 `neis_key`("시작일|이름|대상학년")로 저장해 원본 대신 보여 준다 (NEIS 가 날짜·이름을 바꾸면 원본이 다시 함께 보일 수 있음). 꿈지락도 학생은 고칠 수 없고 관리자가 모두에게 고친다.
