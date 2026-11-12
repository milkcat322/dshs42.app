// 선생님께 보여 줄 데모 화면(?demo)용 자료를 만듭니다.
// 한 계정으로 로그인해 그 학생 화면에 쓰는 자료를 읽어 demo-data.js 로 저장합니다. 읽기만 하고 DB 는 바꾸지 않습니다.
//   DEMO_ID=아이디 DEMO_PW=비밀번호 node scripts/make-demo.mjs
// 비밀번호는 파일 · 커밋에 남기지 않도록 환경 변수로만 넘깁니다.
// demo-data.js 는 공개 저장소 · 사이트에 올라가므로 다른 학생 정보(작성자 이름 · 위치 · 자리 · 공유 일정)는 빼고 저장합니다.
import { readFileSync, writeFileSync } from "node:fs";

const cfgSrc = readFileSync(new URL("../config.js", import.meta.url), "utf8");
const URL_ = cfgSrc.match(/SUPABASE_URL\s*:\s*"([^"]+)"/)[1];
const KEY = cfgSrc.match(/SUPABASE_ANON_KEY\s*:\s*"([^"]+)"/)[1];
const { DEMO_ID: id, DEMO_PW: pw } = process.env;
if (!id || !pw) { console.error("DEMO_ID · DEMO_PW 환경 변수가 필요해요"); process.exit(1); }

const auth = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: `${id.toLowerCase()}@dshs.study`, password: pw }),
}).then((r) => r.json());
if (!auth.access_token) { console.error("로그인 실패:", auth.error_description || auth.msg || auth.error); process.exit(1); }
const uid = auth.user.id;
const H = { apikey: KEY, Authorization: `Bearer ${auth.access_token}` };
const get = async (path) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  return r.ok ? r.json() : [];
};

const [profile] = await get(`profiles?select=*&id=eq.${uid}`);
if (!profile) { console.error("프로필이 없어요"); process.exit(1); }
if (profile.is_admin) { console.error("관리자 계정은 학생 화면이 없어요. 학생 계정으로 만들어 주세요"); process.exit(1); }
const [assignments, personal, events, done, todos, school, groups, status] = await Promise.all([
  get("assignments?select=*&order=due_at.asc"),
  get("assignment_personal?select=*"),
  get("events?select=*&order=starts_at.asc"),
  get("assignment_done?select=assignment_id"),
  get("todos?select=*&order=created_at.asc"),
  get("school_events?select=*,school_event_targets(student_id)&order=starts_at.asc"),
  get("todo_groups?select=*&order=position.asc,created_at.asc"),
  get(`student_status?select=student_id,location,updated_at&student_id=eq.${profile.student_id}`),
]);

const tables = {
  profiles: [{ ...profile, username: "demo" }],   // 로그인 아이디는 공개하지 않음
  // 다른 학생 이름은 빼고, 내가 올린 것만 내 이름으로
  assignments: assignments.filter((a) => a.status === "approved" || a.created_by === uid)
    .map((a) => ({ ...a, author_name: a.created_by === uid ? a.author_name : null })),
  assignment_personal: personal,
  events: events.filter((e) => e.user_id === uid),   // 친구가 공유한 일정은 빼고 내 일정만
  assignment_done: done,
  todos, todo_groups: groups,
  school_events: school.map((e) => ({ ...e, school_event_targets: [] })),
  event_invites: [], student_status: status,
  // 자리 공개 동의 창이 뜨지 않게 '물어봄 · 공개 안 함'으로 (데모는 자리를 받지 않음)
  seat_shares: [{ student_id: profile.student_id, public: false, asked: true, seat: null, seat_day: null }], feedback_replies: [], feedback: [],
};
const out = `// 데모 화면(?demo)용 자료 — scripts/make-demo.mjs 가 ${new Date().toISOString().slice(0, 10)} 에 만듦. 손으로 고치지 않습니다.
window.DSHS_DEMO = ${JSON.stringify({ at: new Date().toISOString(), uid, tables })};
`;
writeFileSync(new URL("../demo-data.js", import.meta.url), out);
console.log(`demo-data.js: ${profile.name} · 수행평가 ${tables.assignments.length} · 일정 ${tables.events.length} · 할 일 ${todos.length} · 학교 일정 ${school.length}`);
