// dshs42.app — 사용 분석 (DB · 푸시 · Claude 를 건드리지 않는 순수 함수)
//
//   usage_snapshot() 의 수치 + 업데이트 소식(updates.js) + 알리지 않은 변화(CHANGES)를 묶어
//   Claude 에게 보낼 요청을 만들고, 답이 없을 때 쓸 제목 · 푸시 본문을 정합니다.
//   보내는 것은 날짜 · 시간대별 '수'뿐입니다 (이름 · 학번 · 내용 없음).

export type Day = {
  day: string; devices: number; logged_in: number; users: number;
  phone: number; pc: number; tablet: number; guest_phone: number; standalone: number;
  new_devices: number; guest_returning: number; guest_to_login: number;
  signups: number; dshs_linked: number; todos_added: number; todos_done: number; events_added: number;
  asg_posted: number; asg_checked: number; asg_personal: number; status_set: number; feedback: number; push_on: number;
};
export type Snapshot = {
  today: string;
  days: Day[];
  hours: { hour: number; logged_in: number; guest: number }[];
  device_days: { days: number; login_devices: number; guest_devices: number }[];
  totals: Record<string, number | string | null>;
};
export type UpdateNote = { date: string; major: boolean; title: string };
export type Change = { date: string; what: string };
export type Suggestion = { title: string; why: string; goal: "login" | "convenience" | "both"; effort: "low" | "mid" | "high" };
export type AiUsage = {
  headline: string;
  summary: string;
  login: string;
  usage: string;
  updates: { title: string; reaction: string; verdict: "good" | "mixed" | "none" | "unknown" }[];
  suggestions: Suggestion[];
  watch: string[];
  caveats: string;
};

// 업데이트 소식에 올리지 않았지만 사용에 영향을 줬을 변화 (새로 생기면 여기에 한 줄 더합니다)
export const CHANGES: Change[] = [
  { date: "2026-11-02", what: "회원가입 화면을 없애고 새 학생은 dshs.app 으로 로그인해서 계정을 만들게 함" },
  { date: "2026-11-04", what: "비로그인 상태에서 인터넷이 연결돼 있으면 시간표 검색을 막고 로그인을 요구함 (오프라인일 때만 로그인 없이 검색). 로그인 사용자를 늘리려는 조치. beta 는 08:47, dshs42.app 은 14:34(v106)에 반영" },
  { date: "2026-11-04", what: "로그인한 상태로 열면 지난 화면을 먼저 보여 줘 시작이 빨라짐, 로그아웃 후 다시 로그인해도 알림 유지" },
];

// updates.js 에서 날짜 · 주요 여부 · 제목만 꺼냅니다 (코드를 실행하지 않고 글자로 읽습니다)
export function parseUpdates(text: string): UpdateNote[] {
  const out: UpdateNote[] = [];
  const re = /date:\s*"(\d{4}-\d{2}-\d{2})",\s*major:\s*(true|false),\s*title:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of text.matchAll(re)) out.push({ date: m[1], major: m[2] === "true", title: m[3] });
  return out;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const sum = (xs: Day[], k: keyof Day) => xs.reduce((s, d) => s + (Number(d[k]) || 0), 0);

// 숫자를 읽기 쉽게 미리 계산해 둡니다 (Claude 가 계산을 틀리지 않게)
export function derive(s: Snapshot) {
  const days = s.days.filter((d) => d.devices || d.signups || d.todos_added || d.events_added);
  const today = s.days.find((d) => d.day === s.today) ?? null;
  const done = s.days.filter((d) => d.day < s.today);    // 오늘은 아직 끝나지 않은 날
  const last = done[done.length - 1] ?? null;
  const t = s.totals as Record<string, number>;
  return {
    data_days: days.length,
    first_day: s.totals.visits_since,
    today_so_far: today && { devices: today.devices, logged_in: today.logged_in, login_rate: pct(today.logged_in, today.devices) },
    last_full_day: last && { day: last.day, devices: last.devices, logged_in: last.logged_in, login_rate: pct(last.logged_in, last.devices) },
    period: {
      devices: sum(s.days, "devices"), logged_in: sum(s.days, "logged_in"),
      login_rate: pct(sum(s.days, "logged_in"), sum(s.days, "devices")),
      guest_to_login: sum(s.days, "guest_to_login"), signups: sum(s.days, "signups"),
      guest_phone_share: pct(sum(s.days, "guest_phone"), sum(s.days, "devices") - sum(s.days, "logged_in")),
      standalone_share: pct(sum(s.days, "standalone"), sum(s.days, "devices")),
    },
    reach: {
      roster: t.roster, students: t.students, signed_up_rate: pct(t.students, t.roster),
      active_7d: t.active_users_7d, active_rate_of_students: pct(t.active_users_7d, t.students),
      push_rate: pct(t.push_users, t.students), dshs_linked: t.dshs_linked,
    },
    features: {
      todo_users: t.todo_users, event_users: t.event_users, check_users: t.check_users, status_users: t.status_users,
    },
    guest_only_devices_7d: t.guest_only_devices_7d, devices_7d: t.devices_7d,
  };
}

export const AI_SYSTEM = `너는 대전과학고 42기 학생(약 90명)용 비공식 웹서비스 dshs42.app 의 사용 분석가다.
관리자는 학생 개발자 2명이고, 이 분석을 매일 밤 폰 알림과 관리 화면에서 읽는다.

서비스 화면: 시간표(내 시간표·분반·교실·선생님 검색), 수행평가(분반별 공지 · 완료 체크 · 개인 수정, 관리자 승인),
내 일정(달력·친구와 공유·학교 일정·NEIS 학사일정), 할 일, 내 위치(자습실 자리 등), 설정(알림·테마·계정),
dshs.app 계정으로 로그인, 업데이트 소식 · 피드백. 웹앱이라 폰 홈 화면에 설치(standalone)할 수 있다.
알림(푸시)은 로그인 후 켤 수 있고, 아이폰은 홈 화면에 설치해야 알림을 받는다.

관리자의 목표: 로그인해서 쓰는 학생을 늘리는 것. 그 방법으로 비로그인 상태의 온라인 시간표 검색을 막았다.
동시에 학생이 편하게 쓰는 것도 중요하다 (불편해서 떠나면 안 된다).

받는 데이터:
- days: 날짜별 수. devices=방문 기기(관리자 제외), logged_in=로그인한 상태로 연 기기, users=로그인한 서로 다른 학생,
  new_devices=처음 본 기기, guest_returning=전에도 왔던 비로그인 기기, guest_to_login=비로그인으로만 쓰다 이날 로그인한 기기,
  signups=새 계정, todos_added/events_added/asg_checked(수행평가 완료 체크)/asg_personal(개인 수정)/status_set(위치)/feedback/push_on(알림 켬) 등 기능 사용 수.
- hours: 첫 방문 시각(한국 시간) 분포, device_days: 기간 동안 며칠 왔는지, totals/derived: 누적 · 비율(이미 계산됨, 그대로 써라).
- updates: 학생에게 알린 업데이트 소식, changes: 알리지 않은 변화, previous: 지난 분석의 요약과 제안 (이어지는 흐름을 봐라).

분석할 것:
1. login: 로그인 / 비로그인 현황과 추세, 비로그인 → 로그인 전환, 시간표 차단 전후 변화. 숫자를 근거로.
2. usage: 전반적 사용 양상 — 언제(시간대·요일) 누가(폰/PC, 설치 앱) 무엇을(기능별) 얼마나 쓰는지, 다시 오는지.
3. updates: 업데이트·변화마다 학생 반응 (그날 이후 방문 · 기능 사용 · 피드백 변화). 데이터가 부족하면 verdict="unknown" 이라고 솔직히.
4. suggestions: 로그인 사용자를 늘리거나 학생 편의를 높일 구체적 수정 3~5개. 이 서비스 화면에 맞게, 바로 만들 수 있는 것부터.
   goal 은 login / convenience / both, effort 는 low(하루 안) / mid / high. why 에는 근거가 된 숫자를 넣어라.
   이미 한 일(updates · changes)을 다시 제안하지 말고, 지난 제안이 반영됐는지도 고려해라. dshs.app 에 이미 있는 기능을 똑같이 만들자는 제안은 하지 마라.
5. watch: 다음 분석에서 지켜볼 지표 2~3개.
6. caveats: 데이터 한계 (기록이 며칠뿐, 기기 수 ≠ 학생 수, 오늘은 아직 진행 중 등) 한두 문장.

headline 은 40자 안쪽 한 줄(폰 알림 제목), summary 는 3~4문장. 모두 한국어, 관리자에게 말하듯 간결하게.
숫자가 적어 결론이 불확실하면 단정하지 말고 "아직 판단하기 이르다"고 써라.`;

export function aiPrompt(d: {
  snapshot: Snapshot; updates: UpdateNote[]; changes: Change[];
  previous: { at: string; headline: string; suggestions: string[] } | null;
}) {
  const since = d.snapshot.days[0]?.day ?? "";
  return JSON.stringify({
    today: d.snapshot.today,
    derived: derive(d.snapshot),
    days: d.snapshot.days,
    hours: d.snapshot.hours,
    device_days: d.snapshot.device_days,
    totals: d.snapshot.totals,
    updates: d.updates.filter((u) => u.date >= addDays(since, -7)),
    changes: d.changes,
    previous: d.previous,
  });
}

function addDays(day: string, n: number) {
  if (!day) return "";
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// AI 답이 없을 때도 남길 제목 · 푸시 본문
export function titleOf(s: Snapshot, ai: AiUsage | null) {
  if (ai?.headline) return `사용 분석 · ${ai.headline}`;
  const x = derive(s).today_so_far;
  return x ? `사용 분석 · 오늘 로그인 ${x.logged_in}/${x.devices}대` : "사용 분석";
}
export function pushBody(s: Snapshot, ai: AiUsage | null, aiError: string | null) {
  const x = derive(s);
  const lines = [`최근 7일 로그인 학생 ${x.reach.active_7d}명 · 가입 ${x.reach.students}/${x.reach.roster}명`];
  if (ai) {
    lines.push(ai.summary.split(/(?<=[.다요])\s/)[0]);
    if (ai.suggestions[0]) lines.push(`제안: ${ai.suggestions[0].title}`);
  } else if (aiError) lines.push(aiError);
  return lines.join("\n");
}
