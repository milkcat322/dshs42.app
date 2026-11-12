// dshs42.app — 지금 누구에게 어떤 알림을 보낼지 계산합니다 (DB·푸시를 건드리지 않는 순수 함수)
//
//   수행평가      마감 1일 전 · 6시간 전 (완료 표시한 건 빼고)
//   내 일정       시작 30분 전 (친구가 공유한 일정 포함, 완료 표시한 건 빼고)
//   학교 일정     notify 를 켠 일정만 시작 30분 전
//   하루 종일     시작 시각이 없으므로 그날 1교시 30분 전(07:50)에 한 번
//   관리자        학생 가입 · 수행평가 승인 요청 · 피드백이 생기면 묶어서 한 번 (planAdminNote)

const MIN = 60000;
const KST = 9 * 60 * MIN;
const LEAD = 30;     // 시작 몇 분 전에 알릴지
const GRACE = 10;    // 크론이 한 번 밀려도 놓치지 않도록 이만큼은 늦게 보내도 됩니다
const DAY_START = "08:20";

export type User = { id: string; student_id: number | null };
export type Enrollment = { student_id: number; subject: string; ban: string };
export type Assignment = {
  id: string; subject: string; ban: string | null; title: string;
  due_at: string | null; status: string; created_by: string;
};
// 학생이 내 계정에서만 고친 제목·마감 (비어 있는 칸은 공지 값을 따라갑니다)
export type Personal = {
  user_id: string; assignment_id: string;
  title: string | null; due_at: string | null; no_due: boolean;
};
export type AsgDone = { user_id: string; assignment_id: string };
export type CalEvent = {
  id: string; user_id: string; title: string;
  starts_at: string; all_day: boolean; done: boolean;
};
export type Member = { event_id: string; user_id: string; done: boolean };
export type SchoolEvent = {
  id: string; title: string; starts_at: string; ends_at: string | null;
  all_day: boolean; notify: boolean; audience: string;
  school_event_targets: { student_id: number }[];
};
export type Input = {
  users: User[]; enrollments: Enrollment[];
  assignments: Assignment[]; asgDone: AsgDone[]; personal: Personal[];
  events: CalEvent[]; members: Member[]; school: SchoolEvent[];
};
export type Note = {
  userId: string; key: string; title: string; body: string; url: string; ttl: number;
  logKeys?: string[];   // 여러 건을 묶은 알림은 묶인 건마다 기록합니다
};
// 관리자가 확인할 활동. 본인만 보는 내용(할 일 · 일정 · 위치 등)은 넣지 않습니다.
export type AdminItem = { kind: "signup" | "assignment" | "feedback"; id: string; who: string };

const kstDay = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10);
const kstHm = (ms: number) => new Date(ms + KST).toISOString().slice(11, 16);
const kstAt = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+09:00`);

const startOf = (e: { starts_at: string; all_day: boolean }) =>
  e.all_day ? kstAt(kstDay(Date.parse(e.starts_at)), DAY_START) : Date.parse(e.starts_at);

// 수행평가 단계: 남은 시간이 들어간 구간 하나만. 늦게 승인된 공지도 남은 시간 그대로 알립니다.
function asgStage(minsLeft: number) {
  if (minsLeft <= 0 || minsLeft > 24 * 60) return null;
  return minsLeft > 6 * 60 ? "d1" : "h6";
}

function leftLabel(minsLeft: number) {
  const hours = Math.round(minsLeft / 60);
  if (hours >= 24) return "1일 남았어요";
  return hours >= 1 ? `${hours}시간 남았어요` : `${Math.ceil(minsLeft)}분 남았어요`;
}

export function planNotes(now: number, d: Input): Note[] {
  const notes: Note[] = [];
  const banOf = new Map(d.enrollments.map((e) => [`${e.student_id}|${e.subject}`, e.ban]));
  const asgDone = new Set(d.asgDone.map((r) => `${r.user_id}|${r.assignment_id}`));
  const personal = new Map(d.personal.map((p) => [`${p.user_id}|${p.assignment_id}`, p]));
  const leftAt = (at: number) => (at - now) / MIN;
  const startsSoon = (at: number) => leftAt(at) > LEAD - GRACE && leftAt(at) <= LEAD;
  const push = (userId: string, n: Omit<Note, "userId">) => notes.push({ userId, ...n });
  const sees = (e: SchoolEvent, u: User) =>
    e.audience === "all" || e.school_event_targets.some((t) => t.student_id === u.student_id);

  // 일정 공통 문구
  const eventNote = (e: { id: string; title: string; all_day: boolean }, at: number, prefix: string, kind: string) => ({
    key: `${kind}:${e.id}:${at}`,
    title: e.all_day ? `오늘 일정: ${e.title}` : `${Math.ceil(leftAt(at))}분 뒤 ${e.title}`,
    body: `${prefix}${e.all_day ? "하루 종일" : `${kstHm(at)} 시작`}`,
    url: "/?view=cal",
    ttl: Math.ceil(leftAt(at) * 60),
  });

  // 수행평가
  for (const a of d.assignments) {
    for (const u of d.users) {
      // 승인 전 공지는 올린 사람에게만 보입니다
      const mine = a.status === "approved"
        ? u.student_id !== null && banOf.has(`${u.student_id}|${a.subject}`) &&
          (!a.ban || banOf.get(`${u.student_id}|${a.subject}`) === a.ban)
        : a.status === "pending" && a.created_by === u.id;
      if (!mine || asgDone.has(`${u.id}|${a.id}`)) continue;
      const p = a.status === "approved" ? personal.get(`${u.id}|${a.id}`) : undefined;
      const dueAt = p?.no_due ? null : p?.due_at ?? a.due_at;
      if (!dueAt) continue;
      const due = Date.parse(dueAt);
      const left = leftAt(due);
      const stage = asgStage(left);
      if (!stage) continue;
      const when = `${Number(kstDay(due).slice(5, 7))}/${Number(kstDay(due).slice(8))} ${kstHm(due)}`;
      push(u.id, {
        key: `asg:${a.id}:${stage}:${due}`,
        title: `${a.subject}${a.ban ? ` ${a.ban}` : ""} 수행평가 ${leftLabel(left)}`,
        body: `${p?.title ?? a.title}\n마감 ${when}`,
        url: `/?view=assignments&asg=${a.id}`,
        ttl: Math.ceil(left * 60),
      });
    }
  }

  // 내 일정 + 친구가 공유한 일정
  const known = new Set(d.users.map((u) => u.id));
  for (const e of d.events) {
    const at = startOf(e);
    if (!startsSoon(at)) continue;
    const note = eventNote(e, at, "", "ev");
    if (!e.done && known.has(e.user_id)) push(e.user_id, note);
    for (const m of d.members) {
      if (m.event_id === e.id && !m.done && known.has(m.user_id)) push(m.user_id, note);
    }
  }

  // 학교 일정 (필수로 표시한 것만)
  for (const e of d.school.filter((x) => x.notify)) {
    const at = startOf(e);
    if (!startsSoon(at)) continue;
    const note = eventNote(e, at, "학교 일정 · ", "sch");
    for (const u of d.users) if (sees(e, u)) push(u.id, note);
  }

  return notes;
}

// 피드백 답장 (feedbackreply.sql): 관리자가 답장을 남기면 그 피드백을 보낸 학생에게 한 번 알립니다.
// 이미 읽은 답장(seen)과 알림을 켠 기기가 없는 학생은 뺍니다.
export type FbReply = { id: string; user_id: string; body: string; seen: boolean };
export function planReplyNotes(replies: FbReply[], known: Set<string>): Note[] {
  return replies.filter((r) => !r.seen && known.has(r.user_id)).map((r) => {
    const text = r.body.replace(/\s+/g, " ").trim();
    return {
      userId: r.user_id, key: `fbreply:${r.id}`,
      title: "피드백에 답장이 왔어요",
      body: text.length > 80 ? `${text.slice(0, 80)}…` : text,
      url: "/?view=feedback",
      ttl: 24 * 60 * 60,
    };
  });
}

export const adminKey = (i: AdminItem) => `adm:${i.kind}:${i.id}`;

const ADMIN_LABEL = { signup: ["가입", "명"], assignment: ["승인 요청", "건"], feedback: ["피드백", "건"] } as const;
const ADMIN_ONE = { signup: "가입했어요", assignment: "수행평가 승인을 요청했어요", feedback: "피드백을 보냈어요" } as const;

// 아직 안 보낸 활동을 관리자 한 명에게 보낼 알림 하나로 묶습니다
export function planAdminNote(userId: string, items: AdminItem[]): Note | null {
  if (!items.length) return null;
  const logKeys = items.map(adminKey);
  const count = (k: AdminItem["kind"]) => items.filter((i) => i.kind === k).length;
  const bits = (["signup", "assignment", "feedback"] as const).filter(count)
    .map((k) => `${ADMIN_LABEL[k][0]} ${count(k)}${ADMIN_LABEL[k][1]}`);
  const one = items.length === 1;
  return {
    userId, key: logKeys[0], logKeys,
    title: one ? "새 활동" : `새 활동 ${items.length}건`,
    body: one ? `${items[0].who}: ${ADMIN_ONE[items[0].kind]}` : bits.join(" · "),
    url: "/?view=admin",
    ttl: 24 * 60 * 60,
  };
}
