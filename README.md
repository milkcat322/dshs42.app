# dshs42.app — 대전과학고 42기 종합 웹서비스

> 서비스 이름은 2026-11-01 에 `dshs.study` 에서 `dshs42.app` 으로 바뀌었습니다. 로그인 계정의 이메일 도메인(`아이디@dshs.study`)·저장소 이름·`dshs-study.js` 같은 내부 이름은 기존 계정과 호환을 위해 그대로입니다.

시간표·분반·교실·선생님 검색은 **로그인 없이** 그대로 쓸 수 있고, 로그인하면 수행평가 공지와 기한 알림이 더해집니다.

```
index.html                앱 본체 (시간표 데이터 포함)
config.js                 ★ Supabase 키를 넣는 곳
dshs-study.js             계정 · 수행평가 · 알림 로직
sw.js                     서비스 워커 (오프라인 + 푸시 수신)
manifest.webmanifest      앱 설치 정보
icon-*.png                아이콘 7종 + apple-touch-icon + favicon
schema.sql                ★ 테이블·권한(RLS)
seed.sql                  ★ 92명 명단 + 수강 과목 1081행
bans.sql                  ★ 수강 정보에 분반 채우기 + 분반별 공지 권한
admins.sql                ★ 관리자 계정 연결
supabase/functions/signup/index.ts          회원가입 (학번당 1계정 강제)
notify.sql                ★ 필수 학교 일정 표시 + 알림 발송 기록
submit.sql                ★ 수행평가 제출처
personal.sql              ★ 수행평가 개인 수정
supabase/functions/send-reminders/index.ts  알림 발송
supabase/functions/send-reminders/plan.ts   누구에게 어떤 알림을 보낼지 계산
dshsapp.sql               ★ dshs.app 계정 연결 (토큰은 서버 전용)
classes.sql               ★ 수업 옮기기
supabase/functions/dshs-oauth/index.ts      dshs.app 로그인 연결 · 신청 내역 조회
updates.js                업데이트 소식 (주요 업데이트는 접속 시 한 번 팝업 · 좌측 상단 📢 업데이트에서 전체 내역)
academic.json             학사일정 (NEIS 에서 매일 자동 갱신 · 직접 고치지 않음)
academic-extra.json       NEIS 에 없는 일정(카톡 공지 등)을 직접 적는 곳 → academic.json 에 합쳐짐
scripts/fetch-academic.mjs  학사일정 받기 (GitHub Actions 가 매일 실행)
DEVLOG.md                 개발 로그 (무엇을 왜 바꿨는지, 남은 일 · 최신이 맨 아래)
CLAUDE.md                 Claude Code 가 매 세션 자동으로 읽는 팀 공용 규칙
.claude/                  Claude Code 공용 설정 · 자동 git pull/push 훅
```

작업을 시작하기 전에 [DEVLOG.md](DEVLOG.md) 맨 아래의 최근 기록과 **남은 일** 을 먼저 확인해 주세요.

`config.js`를 비워 두면 로그인 버튼이 숨겨지고 **시간표 기능만** 동작합니다. 먼저 그대로 올려서 시간표만 쓰다가, 준비되면 백엔드를 붙여도 됩니다.

---

## 1. Supabase 준비 (15분쯤)

1. [supabase.com](https://supabase.com) 가입 → **New project** (무료, 서울 리전 권장)
2. 왼쪽 **SQL Editor** → `schema.sql` 전체 붙여넣고 **Run**
3. 이어서 `seed.sql` 붙여넣고 **Run** (명단 92명 + 수강 1081행)
   그다음 `bans.sql` 을 **Run** (수강 정보에 분반을 채우고 분반별 공지 권한을 겁니다)
   마지막으로 `events.sql` 을 **Run** (개인 일정 + 수행평가 완료 체크)
   이어서 `share.sql` 을 **Run** (친구와 일정 공유)
   이어서 `todos.sql` 을 **Run** (할 일)
   이어서 `school.sql` 을 **Run** (학교 일정 · 관리자 전용)
   이어서 `notify.sql` 을 **Run** (알림)
   이어서 `submit.sql` 을 **Run** (수행평가 제출처)
   이어서 `personal.sql` 을 **Run** (수행평가 개인 수정)
   이어서 `notice.sql` 을 **Run** (수행평가 공지: 마감 일시 없이 올리기 · 작성자 표시 · 작성자/관리자 수정)
   이어서 `dshsapp.sql` 을 **Run** (dshs.app 계정 연결 · 신청 내역을 달력에 표시)
   이어서 `classes.sql` 을 **Run** (수업 옮기기)
4. **Authentication → Providers → Email** 에서 *Confirm email* 을 **끕니다**
   (학번 기반 가상 이메일이라 실제 메일이 가지 않습니다)

## 2. 알림 키 만들기

```bash
npx web-push generate-vapid-keys
```
공개키·비밀키가 한 쌍 나옵니다. 공개키는 `config.js` 에, 비밀키는 3단계에서 씁니다.

## 3. Edge Function 배포

```bash
npm i -g supabase
supabase login
supabase link --project-ref <프로젝트 ref>

supabase functions deploy signup --no-verify-jwt
supabase functions deploy send-reminders
supabase functions deploy dshs-oauth --no-verify-jwt

supabase secrets set \
  VAPID_PUBLIC_KEY=<공개키> \
  VAPID_PRIVATE_KEY=<비밀키> \
  VAPID_SUBJECT=mailto:본인메일@example.com \
  DSHS_CLIENT_ID=<dshs.app client_id> \
  DSHS_CLIENT_SECRET=<dshs.app client_secret>
```

`dshs-oauth` 는 dshs.app 계정 연결(OIDC)과 신청 내역 조회를 맡습니다. client_id·secret 은 dshs.app 관리자에게 받은 값이고, **저장소 어디에도 적지 않습니다.** dshs.app 에 등록한 redirect URI 는 `https://<프로젝트 ref>.supabase.co/functions/v1/dshs-oauth` (운영)와 `http://localhost:54321/functions/v1/dshs-oauth` (로컬 — `supabase functions serve` 할 때 `DSHS_REDIRECT_URI` 를 이 값으로) 입니다. redirect URI · scope 를 바꾸려면 dshs.app 관리자에게 메일로 요청합니다.

알림을 주기적으로 보내려면 `send-reminders/index.ts` 맨 아래 주석의 `cron.schedule` SQL 을 한 번 실행하세요. 1분마다 돌면서 **동작 방식**의 알림을 보냅니다.

## 4. config.js 채우기

```js
window.DSHS_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",   // Settings → API → Project URL
  SUPABASE_ANON_KEY: "eyJ...",                 // anon public key (공개돼도 안전)
  VAPID_PUBLIC_KEY: "BK...",                   // 2단계 공개키
};
```

`anon key` 는 공개용 키라 소스에 들어가도 됩니다. **service_role 키는 절대 넣지 마세요** — 그건 Edge Function 쪽에만 있어야 합니다.

## 5. Netlify 배포

GitHub 저장소(`milkcat322/dshs-study`)에 연결되어 있어서, `main` 에 푸시하면 자동으로 배포됩니다.

## 6. 관리자 계정 만들기

관리자 아이디는 **milkcat322**, **qksalornt** 두 개입니다. 학생 가입에서는 이 아이디를 쓸 수 없게 막아 두었어요. **학생들에게 링크를 공유하기 전에** 아래를 먼저 해주세요.

1. 대시보드 **Authentication → Users → Add user → Create new user**
2. 첫 번째 계정
   - Email: `milkcat322@dshs.study`
   - Password: 정해둔 비밀번호 입력
   - **Auto Confirm User** 체크 → Create user
3. 두 번째 계정도 똑같이: `qksalornt@dshs.study`
4. **SQL Editor** 에서 `admins.sql` 실행 → 마지막에 두 줄이 나오면 성공

로그인할 때는 이메일이 아니라 **아이디(milkcat322)** 만 입력하면 됩니다.

관리자 계정은 학번에 묶여 있지 않아서 전 과목 공지를 볼 수 있고, 관리자가 올린 공지는 승인 없이 바로 그 과목 수강생에게 공지됩니다. 기한 알림은 수강생에게만 가므로 관리자 계정으로는 오지 않아요.

학생 본인 계정도 관리자로 쓰고 싶다면 가입 후 SQL Editor 에서:

```sql
update public.profiles set is_admin = true where student_id = 2113;
```

---

## 동작 방식

**회원가입** — 학번 입력 → 명단에서 이름을 찾아 보여줌 → 본인 확인 → 아이디·비밀번호 설정. 학번 중복 여부는 브라우저가 아니라 **서버에서** 막습니다(DB 의 unique 제약 + Edge Function). 이미 가입된 학번이면 1단계에서 바로 안내하고 로그인으로 유도합니다.

**자동 로그인** — 세션이 브라우저에 저장돼 다음부터 바로 들어갑니다. 이름 버튼을 누르면 로그아웃할 수 있어요.

**수행평가** — 자기가 듣는 과목에만 추가할 수 있고, 추가하면 `승인 대기` 상태로 본인에게만 보입니다. 제출처는 선택으로 고릅니다. 마감 일시는 비워 둘 수 있고(그때는 `D-?` 로 보이고 달력·알림에서 빠짐), 수행평가마다 작성자가 작게 표시됩니다. 작성자와 관리자는 제목·마감·제출처를 고칠 수 있고(작성자가 고쳐도 승인 상태·과목·분반은 그대로), 관리자는 모든 수행평가를, 작성자는 승인 전 자기 수행평가를 지울 수 있습니다. 관리자가 승인해야 **그 과목을 듣는 학생에게만** 보입니다. 이 범위 제한은 화면이 아니라 DB 권한(RLS)으로 걸려 있어서, 다른 과목 공지는 애초에 내려받아지지 않습니다.

**알림** — `내 일정` 탭의 버튼으로 기기마다 켜고 끕니다. 수행평가는 마감 **1일 전·6시간 전**, 내 일정·공유 일정·`필수 일정`으로 표시한 학교 일정은 시작 **30분 전**에 웹 푸시가 갑니다. 시간표 수업은 알리지 않고, 완료 표시한 일은 빠집니다. 하루 종일 일정은 시작 시각이 없어서 그날 07:50 에 알립니다. 로그아웃하면 그 기기의 알림도 꺼집니다. 같은 알림은 두 번 가지 않고, 만료된 구독은 자동으로 정리됩니다. 아이폰은 **홈 화면에 추가한 뒤에만** 알림을 받을 수 있습니다(iOS 제한). 안드로이드는 설치 없이도 됩니다.

**학사일정** — 학교 홈페이지의 학사일정(원본은 NEIS)을 달력에 깔고, `🎓 학사일정` 버튼으로 귀가일 · 시험 · 방학·개학 · 공휴일·휴업일 · 동아리·꿈지락 · 학교 행사를 종류별로 켜고 끕니다(기기마다 기억). 내 학년 일정만 보이고, 공휴일·휴업일·방학에는 시간표를 깔지 않습니다. `.github/workflows/academic.yml` 이 매일 03:00 에 `node scripts/fetch-academic.mjs` 로 `academic.json` 을 갱신하고, 바뀐 게 있을 때만 커밋합니다. NEIS 인증키 없이도 되지만, [open.neis.go.kr](https://open.neis.go.kr) 에서 무료 인증키를 받아 GitHub 저장소 Settings → Secrets → Actions 에 `NEIS_KEY` 로 넣으면 요청 수가 줄고 하루에 일정이 많은 날도 빠짐없이 받습니다.

## 내용을 고친 뒤에

`sw.js` 첫 줄의 캐시 버전을 올려주세요.

```js
const CACHE = 'dshs-study-v1';  →  'dshs-study-v2';
```

---

## 개발 흐름 (자동 git pull / push · 개발 로그)

이 저장소를 [Claude Code](https://claude.com/claude-code) 로 열면 아래가 **모든 팀원에게 자동으로** 적용됩니다. 설정은 저장소에 들어 있는 `.claude/settings.json` 과 `.claude/hooks/` 스크립트가 합니다.

| 언제 | 자동으로 하는 일 |
|---|---|
| 세션을 열 때 (새 세션 · 이어하기 · `/clear`) | `git pull --rebase --autostash` 로 다른 팀원의 변경을 받아옴. 지난 세션 중 기록을 놓친 것이 있으면 지금 기록 |
| Claude 가 `git push` 하기 직전 (**Check Push**) | DEVLOG 에 이번 작업이 아직 없으면 먼저 기록해 함께 올리게 하고, 원격에 다른 팀원의 새 커밋이 있으면 먼저 받아서 합친 뒤 push 하게 함 |
| Claude 의 답변 뒤 10분 동안 다음 요청이 없을 때 | 대화 내용을 요약해 [DEVLOG.md](DEVLOG.md) 맨 아래에 기록 추가(주요 개발이면 맨 앞 "개발 흐름" 에도 한 줄) → **DEVLOG.md 만** 커밋 → `git push` |
| 세션을 닫을 때 (터미널 CLI 에서 종료할 때. VS Code 에서는 대개 실행되지 않음) | 위와 같이 기록 → **변경 전체** 커밋 → `git push` |

### Check Push

**push 직전에 원격을 확인하고, 다른 팀원의 새 커밋이 있으면 먼저 받아 합친 뒤 push 하는** 이 팀의 push 방식입니다. **기능 하나가 완성되면 Claude 가 묻지 않고 자동으로 Check Push 합니다** (답변마다 훅이 올리지 않은 변경이 있는지 확인해, 완성된 기능이면 올리고 개발 중이면 그대로 둡니다). 직접 시키려면 Claude Code 에 `/check-push` 를 입력하거나 "Check Push 해줘" 라고 하면 됩니다. 충돌이 나면 Claude 가 양쪽 기능을 모두 살려 합치고, 판단이 어려우면 물어봅니다.

Claude 없이 push 할 때도 같은 순서로 해 주세요: `git pull --rebase --autostash` → 충돌 정리 → `git push`.

### 처음 한 번 준비

1. **Node.js 18 이상** 설치 (`node -v` 로 확인). 훅 스크립트가 Node 로 돌아갑니다.
2. **git 로그인 정보 저장** — 터미널에서 직접 `git push` 를 한 번 해서 로그인해 두세요. 자동 push 는 비밀번호 창을 띄우지 않으므로, 저장된 정보가 없으면 실패합니다.
3. 저장소 폴더에서 Claude Code 를 열고, 폴더 신뢰(trust) 확인이 나오면 허용합니다.

### 알아 둘 점

- 작업 중간의 자동 기록은 DEVLOG.md 만 올립니다. 코드 변경은 Claude 가 작업을 마칠 때 Check Push 로 올립니다. (CLI 에서 세션을 종료하면 수정한 파일 전체가 지금 브랜치로 push 됩니다.) `main` 에 올리면 바로 배포되니, 큰 작업은 `git switch -c feature/이름` 으로 브랜치를 만들어 하고 PR 로 합쳐 주세요. 원격에 없는 브랜치는 첫 push 때 자동으로 만들어집니다.
- 개발 로그 요약은 **백그라운드에서 1~2분** 걸립니다. 에디터를 닫아도 계속 진행돼요. 요약에는 `claude` 명령이 필요합니다 (`npm i -g @anthropic-ai/claude-code`, 터미널에서 `claude` 로 한 번 로그인). 없으면 요약 대신 git 정보만 기록됩니다.
- PC 가 꺼지는 등으로 기록을 놓치면 다음 세션을 열 때 기록됩니다.
- push 직전에 pull 이 충돌하면 push 를 멈추고 커밋은 내 PC 에만 남깁니다. 직접 충돌을 정리한 뒤 push 해 주세요.
- 실행 기록과 실패 이유는 `.git/devlog-hook.log` 에 남습니다 (커밋되지 않음).
- 같은 세션을 이어서 작업하면 DEVLOG 에 새 기록을 추가하지 않고 그 세션의 기록을 갱신합니다.
- 내 PC 에서만 자동화를 끄려면 `.claude/settings.local.json` 에 `{ "disableAllHooks": true }` 를 넣으세요 (git 에 올라가지 않는 개인 설정).

### Claude Code 없이 작업할 때

1. 시작 전에 `git pull`
2. 작업 후 [DEVLOG.md](DEVLOG.md) 맨 아래에 같은 형식으로 기록 추가
3. 커밋하고 `git push`

`git pull` 이 매번 깔끔하게 되도록 한 번 설정해 두면 편합니다.

```bash
git config pull.rebase true
git config rebase.autoStash true
```
