# dshs.study — 대전과학고 42기 종합 웹서비스

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
supabase/functions/send-reminders/index.ts  기한 알림 발송
DEVLOG.md                 개발 로그 (무엇을 왜 바꿨는지, 남은 일)
```

작업을 시작하기 전에 [DEVLOG.md](DEVLOG.md) 의 최근 기록과 **남은 일** 을 먼저 확인해 주세요.

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

supabase secrets set \
  VAPID_PUBLIC_KEY=<공개키> \
  VAPID_PRIVATE_KEY=<비밀키> \
  VAPID_SUBJECT=mailto:본인메일@example.com
```

알림을 주기적으로 보내려면 `send-reminders/index.ts` 맨 아래 주석의 `cron.schedule` SQL 을 한 번 실행하세요. 10분마다 돌면서 **D-3 / D-1 / 당일** 세 번 알려줍니다.

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

폴더를 통째로 드래그해서 올립니다 (`supabase/` 폴더는 올라가도 무해하지만 빼도 됩니다).

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

**수행평가 공지** — 자기가 듣는 과목에만 올릴 수 있고, 올리면 `승인 대기` 상태입니다. 관리자가 승인해야 **그 과목을 듣는 학생에게만** 보입니다. 이 범위 제한은 화면이 아니라 DB 권한(RLS)으로 걸려 있어서, 다른 과목 공지는 애초에 내려받아지지 않습니다.

**알림** — D-3 / D-1 / 당일에 웹 푸시가 갑니다. 같은 알림은 두 번 가지 않고, 만료된 구독은 자동으로 정리됩니다. 아이폰은 **홈 화면에 추가한 뒤에만** 알림을 받을 수 있습니다(iOS 제한). 안드로이드는 설치 없이도 됩니다.

## 내용을 고친 뒤에

`sw.js` 첫 줄의 캐시 버전을 올려주세요.

```js
const CACHE = 'dshs-study-v1';  →  'dshs-study-v2';
```
