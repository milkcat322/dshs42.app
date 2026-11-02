// ============================================================
// dshs42.app — 계정 · 수행평가 공지 · 기한 알림
// 시간표 기능은 이 파일 없이도 그대로 동작합니다.
// ============================================================
const CFG = window.DSHS_CONFIG || {};
const ENABLED = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const EMAIL_DOMAIN = "dshs.study";

let sb = null;
let me = null;          // { id, username, student_id, name, is_admin }
let myClasses = [];     // 로컬 시간표 데이터에서 가져온 내 수강 분반 [{ subject, ban }]
let cache = { items: [], pending: [], mine: [], events: [], done: new Set(), people: new Map(), todos: null, school: [] };
let page = "cal";       // 열린 탭: cal(내 일정) | notice(수행평가) | todo(할 일)
let view = "feed";      // studyBody 에 떠 있는 화면: feed | notice | admin | form | todo
let fc = null;          // FullCalendar 인스턴스 (달력 탭일 때만)
let fcDate = null;      // 달력을 다시 그릴 때 돌아갈 날짜

const VIEWS = [["3day", "3일"], ["week", "주"], ["month", "월"], ["list", "목록"]];
let tab = (() => {      // feed 화면의 탭. 마지막에 고른 보기를 기억합니다
  try { const v = localStorage.getItem("dshs-cal-view"); if (VIEWS.some(([k]) => k === v)) return v; } catch {}
  return window.innerWidth < 640 ? "3day" : "week";
})();

// 종류마다 한 색: 수행평가 노랑 · 할 일 민트 · 학교 일정 회색 · 신청 파랑. 내 일정은 남은 세 색에서 고릅니다.
const COLORS = ["violet", "pink", "orange"];

// ---------- 유틸 ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, bad) {
  const el = $("studyToast");
  el.textContent = msg;
  el.className = "study-toast show" + (bad ? " bad" : "");
  undoFn = null;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = "study-toast"; }, 3200);
}

// 실행 취소가 붙은 알림. 몇 초 안에 [실행 취소] 또는 ⌘Z / Ctrl+Z 를 누르면 되돌립니다.
let undoFn = null;
// 테두리가 남은 시간만큼 줄어들다가 다 줄면 알림이 사라집니다. 마우스를 올리면 멈춥니다.
const UNDO_MS = 7000;
function undoToast(msg, fn) {
  const el = $("studyToast");
  clearTimeout(toast._t);
  el.innerHTML = `<span>${esc(msg)}</span><button class="toast-undo" type="button">실행 취소</button>
    <svg class="toast-timer" aria-hidden="true"><rect pathLength="100" /></svg>`;
  el.className = "study-toast show has-undo";
  undoFn = fn;
  el.querySelector(".toast-undo").onclick = runUndo;
  // 알림 크기에 맞춰 테두리 사각형을 그립니다. 나타날 때 크기가 잠깐 변하므로(transition) 크기가 바뀔 때마다 다시 맞춥니다.
  // 1px 테두리 한가운데(0.5px 안쪽)를 따라 그리고, 모서리 반지름도 테두리에 맞춥니다.
  const svg = el.querySelector(".toast-timer"), rect = svg.querySelector("rect");
  const fit = () => {
    const w = el.offsetWidth, h = el.offsetHeight;
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 13;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    Object.entries({ x: 0.5, y: 0.5, width: w - 1, height: h - 1, rx: r - 0.5 }).forEach(([k, v]) => rect.setAttribute(k, v));
  };
  fit();
  undoToast._ro?.disconnect();
  undoToast._ro = new ResizeObserver(fit);
  undoToast._ro.observe(el, { box: "border-box" });
  rect.style.animationDuration = `${UNDO_MS}ms`;
  rect.onanimationend = () => { if (undoFn === fn) { el.className = "study-toast"; undoFn = null; } };
}
async function runUndo() {
  const fn = undoFn;
  if (!fn) return;
  undoFn = null;
  clearTimeout(toast._t);
  $("studyToast").className = "study-toast";
  try { (await fn()) === false ? toast("되돌리지 못했어요", true) : toast("되돌렸어요"); }
  catch { toast("되돌리지 못했어요", true); }
}
document.addEventListener("keydown", (e) => {
  if (!undoFn || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
  if (e.target.closest?.("input, textarea, select")) return;   // 입력칸에서는 원래 되돌리기
  e.preventDefault();
  runUndo();
});

function dueInfo(iso) {
  const d = new Date(iso);
  const diff = d - new Date();
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);
  let label, tone;
  if (diff < 0) { label = "마감됨"; tone = "over"; }
  else if (hours < 24) { label = hours <= 0 ? "곧 마감" : `${hours}시간 남음`; tone = "soon"; }
  else if (days < 3) { label = `D-${days}`; tone = "soon"; }
  else { label = `D-${days}`; tone = "ok"; }
  const when = d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
  return { label, tone, when };
}

// 날짜는 모두 기기 시간대 기준으로 다룹니다
function pad(n) { return String(n).padStart(2, "0"); }
function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDay(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
function hm(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function md(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }
function dayTitle(key) {
  return parseDay(key).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

// ---------- 시작 ----------
async function init() {
  if (!ENABLED) { $("studyNav").style.display = "none"; return; }
  if (dshsPopupLanding()) closeDshsPopup();   // 앱이 연 로그인 창이면 화면을 그리기 전에 바로 닫습니다
  // ?bundle: 여러 파일을 차례로 받지 않고 한 파일로 받습니다 (index.html 의 modulepreload 와 같은 주소)
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4?bundle");
  sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "dshs-study-auth" },
  });

  await dshsSession();   // dshs.app 으로 로그인하고 돌아온 경우
  const { data: { session } } = await sb.auth.getSession();   // ← 자동 로그인
  if (session) await loadProfile();
  renderNav();
  if (me) loadAssignments();

  sb.auth.onAuthStateChange(async (evt) => {
    if (evt === "SIGNED_OUT") { me = null; myClasses = []; dshs = dshsEmpty(); renderNav(); }
  });
  // 검색으로 다른 시간표를 띄우거나 숨기면 "내 시간표" 탭 강조를 다시 맞춥니다
  new MutationObserver(() => { if (me) renderNav(); })
    .observe($("result"), { childList: true, attributes: true, attributeFilter: ["class"] });

  // 알림을 누르고 들어오면 그 탭으로, 아니면 내 시간표로 시작합니다
  const opened = new URLSearchParams(location.search).get("view");
  if (me && opened === "assignments") openStudy("notice");
  else if (me && opened === "cal") openStudy("cal");
  else if (me?.student_id) openMyTimetable();
  dshsReturned();
  watchDshs();
}

async function loadProfile() {
  // 관리자는 RLS 상 모든 프로필을 볼 수 있으므로 반드시 내 id 로 좁힙니다.
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { me = null; return; }
  const { data, error } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error || !data) { me = null; return; }
  me = data;
  if (me.student_id) {
    const nm = (window.ID_TO_NAME || {})[String(me.student_id)];
    const cls = nm && window.SCHOOL_DATA?.[nm] ? window.SCHOOL_DATA[nm].classes : {};
    myClasses = sortClasses(Object.entries(cls).map(([subject, ban]) => ({ subject, ban })));
  } else {
    myClasses = allClassList();   // 관리자 전용 계정 → 전 과목·전 분반
  }
}

// 수강 분반: { subject, ban }
function allClassList() {
  const seen = new Map();
  const sd = window.SCHOOL_DATA || {};
  for (const n in sd) {
    for (const [subject, ban] of Object.entries(sd[n].classes)) seen.set(`${subject}|${ban}`, { subject, ban });
  }
  return sortClasses([...seen.values()]);
}
function sortClasses(list) {
  return list.sort((a, b) => a.subject.localeCompare(b.subject, "ko") || a.ban.localeCompare(b.ban, "ko"));
}
const banLabel = (ban) => ban || "전체 분반";
const mySubjects = () => [...new Set(myClasses.map((c) => c.subject))];
// 수행평가를 보지 않는 과목은 수행평가 탭과 추가 화면에서 뺍니다. 시간표에는 그대로 있습니다.
const NO_ASG_SUBJECTS = new Set(["미술", "체육"]);
const asgClasses = () => myClasses.filter((c) => !NO_ASG_SUBJECTS.has(c.subject));
const asgSubjects = () => mySubjects().filter((s) => !NO_ASG_SUBJECTS.has(s));

// ---------- 헤더 ----------
function renderNav() {
  const nav = $("studyNav");
  nav.style.display = "flex";
  const open = $("studyView").style.display === "block";
  // 학생 계정은 맨 왼쪽에 "시간표" (내 시간표 · 검색. 관리자 계정은 학번이 없어 내 시간표가 없음)
  const tabs = me?.student_id ? [["mytt", "시간표"], ...PAGES] : PAGES;
  const on = (k) => (k === "mytt" ? !open && showingMyTimetable() : open && page === k);
  nav.innerHTML = me
    ? tabs.map(([k, label]) =>
        `<button class="study-btn${on(k) ? " primary" : ""}" data-page="${k}">${label}</button>`).join("")
    : `<button class="study-btn" id="btnLogin">로그인</button>`;
  // 설정(알림 · 학교 일정 · 계정)은 업데이트 옆에 늘 보입니다 (로그인 전에는 관리자 로그인을 여는 곳)
  const set = $("btnSettings");
  set.style.display = "";
  set.onclick = openSettings;
  const fb = $("btnFeedback");
  fb.style.display = me && FEEDBACK_ON ? "" : "none";
  fb.onclick = me ? (me.is_admin ? openFeedbackList : openFeedback) : null;
  if (me) {
    nav.querySelectorAll("[data-page]").forEach((b) => b.onclick = () =>
      (b.dataset.page === "mytt" ? openMyTimetable() : openStudy(b.dataset.page)));
    autoPush();
  } else {
    $("btnLogin").onclick = openAuth;
  }
}

// ---------- 내 시간표 ----------
// 시간표 화면(index.html 의 renderResult)에 내 시간표를 띄웁니다. 로그인하면 이 화면으로 시작합니다.
function openMyTimetable() {
  const nm = (window.ID_TO_NAME || {})[String(me?.student_id)];
  if (!nm || typeof window.renderResult !== "function") return openStudy();
  destroyCal();
  $("studyView").style.display = "none";
  document.body.classList.remove("study-open");
  $("errorMsg")?.classList.remove("show");
  $("welcomeState").style.display = "none";
  if ($("nameInput")) $("nameInput").value = "";   // 다른 사람을 검색했던 흔적 지우기
  window.renderResult(nm, window.SCHOOL_DATA[nm]);
  $("result").classList.add("show");
  renderNav();
}
// 지금 시간표 화면에 떠 있는 게 내 시간표인지 (다른 학생·선생님·과목을 검색했으면 아님)
function showingMyTimetable() {
  const r = $("result");
  return r.classList.contains("show") && !!r.querySelector(".student-profile")?.textContent.includes(`학번 ${me.student_id}`);
}
// 로그인 직후 첫 화면: 학생은 내 시간표, 관리자는 내 일정
const openHome = () => (me.student_id ? openMyTimetable() : openStudy());

async function logout() {
  await disablePush();   // 이 기기로 다음 사람의 알림이 오지 않도록, 로그아웃하기 전에 지웁니다
  await sb.auth.signOut();
  autoPush.done = false;   // 다음에 로그인하는 사람의 알림을 다시 맞춥니다
  paintPush.known = false;
  me = null; myClasses = []; dshs = dshsEmpty(); closeStudy(); renderNav();
  toast("로그아웃했어요");
}

// ---------- 로그인 ----------
// 회원가입은 없습니다. 새 학생은 dshs.app 으로 로그인하면 dshs-oauth 가 학번으로 계정을 만듭니다.
// 아이디 · 비밀번호 로그인은 이미 가입한 학생과 관리자를 위해 남겨 둡니다. 관리자 로그인 창은 설정 창 제목 "설정" 을 7번 누르면 열립니다.
function closeModal() { $("studyModal").className = "study-modal"; }

function openAuth() {
  openSheet("로그인", `
    <button class="study-submit dshs-login" id="doDshsLogin">dshs.app으로 로그인</button>
    <div class="auth-or">또는 아이디로 로그인</div>
    ${idLoginHtml("가입할 때 정한 아이디", "8자 이상")}
    <div class="study-foot">새로 가입하지 않아도 dshs.app 계정으로 바로 로그인할 수 있어요. 전에 아이디로 가입했다면 아이디로 로그인하거나, dshs.app으로 로그인해도 같은 학번 계정으로 들어가요.<br>
      대전과학고등학교 및 dshs.app에서 공식적으로 제공하거나 운영하는 사이트가 아닌 학생 비공식 사이트예요.</div>`);
  $("doDshsLogin").onclick = loginWithDshs;
  bindIdLogin();
}

// 아이디 · 비밀번호 로그인 (로그인 창과 관리자 로그인 창이 같이 씁니다)
function idLoginHtml(idHint = "", pwHint = "") {
  return `
    <label class="study-label">아이디</label>
    <input class="study-input" id="loginId" autocomplete="username" placeholder="${idHint}">
    <label class="study-label">비밀번호</label>
    <input class="study-input" id="loginPw" type="password" autocomplete="current-password" placeholder="${pwHint}">
    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="doLogin">로그인</button>`;
}
function bindIdLogin() {
  const go = async () => {
    const u = $("loginId").value.trim().toLowerCase();
    const p = $("loginPw").value;
    if (!u || !p) return showErr("아이디와 비밀번호를 입력해 주세요.");
    $("doLogin").disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: `${u}@${EMAIL_DOMAIN}`, password: p });
    $("doLogin").disabled = false;
    if (error) return showErr("아이디나 비밀번호가 맞지 않아요.");
    await loadProfile();
    if (!me) {
      await sb.auth.signOut();
      return showErr("계정 정보(프로필)를 찾지 못했어요. 관리자 계정이라면 admins.sql 을 실행했는지 확인해 주세요.");
    }
    closeModal(); renderNav(); openHome();
    toast(`${me.name}님, 반가워요`);
  };
  $("doLogin").onclick = go;
  $("loginPw").onkeydown = (e) => { if (e.key === "Enter") go(); };
}

// 설정 창 제목을 빠르게 7번 누르면 관리자 로그인
const ADMIN_TAPS = 7;
function bindAdminTap() {
  const t = $("studyModal").querySelector(".sheet-title");
  let n = 0, last = 0;
  t.style.userSelect = "none";
  t.onclick = () => {
    const now = Date.now();
    n = now - last < 1500 ? n + 1 : 1;
    last = now;
    if (n >= ADMIN_TAPS) openAdminLogin();
  };
}

function openAdminLogin() {
  openSheet("관리자 로그인", idLoginHtml());
  bindIdLogin();
  $("loginId").focus();
}

function showErr(msg) { const e = $("authErr"); e.textContent = msg; e.classList.add("show"); }

// ---------- 탭: 내 일정 · 수행평가 공지 · 할 일 ----------
const PAGES = [["cal", "내 일정"], ["notice", "수행평가"], ["todo", "할 일"]];
const PAGE_VIEW = { cal: "feed", notice: "notice", todo: "todo" };

// 내 일정: 수행평가(내 분반 공지 + 내가 올린 것)와 개인 일정을 한 달력에 모두 보여줍니다
function openStudy(p) {
  page = PAGE_VIEW[p] ? p : "cal";
  view = PAGE_VIEW[page];
  destroyCal();
  $("result").classList.remove("show");
  $("welcomeState").style.display = "none";
  $("studyView").style.display = "block";
  // 시간표 검색창은 내 시간표 탭에서만 보입니다 (내 시간표 탭이 없는 관리자 계정은 그대로 둠)
  document.body.classList.toggle("study-open", !!me?.student_id);
  renderStudy();
  renderNav();
  loadAssignments();
}
function closeStudy() {
  destroyCal();
  $("studyView").style.display = "none";
  document.body.classList.remove("study-open");
  if (!$("result").classList.contains("show")) $("welcomeState").style.display = "";
  if (me) renderNav();
}
// 지금 view 에 맞춰 studyBody 를 다시 그립니다
function rerender() {
  if (view === "notice") renderNotice();
  else if (view === "todo") renderTodo();
  else renderList(view);
}
window.closeStudyView = closeStudy;

function renderStudy() {
  const subjects = me.student_id ? `${asgClasses().length}과목` : `전체 ${asgSubjects().length}과목`;
  const [title, sub] = {
    cal: ["내 일정", `수행평가 ${subjects} + 개인 일정`],
    notice: ["수행평가", `내 분반 수행평가 ${subjects}`],
    todo: ["할 일", "체크하면서 하나씩 끝내요"],
  }[page];
  $("studyView").innerHTML = `
    <div class="study-head">
      <div>
        <h2>${title}</h2>
        <div class="study-sub">${sub}</div>
      </div>
      <button class="study-btn" onclick="closeStudyView()">✕ 닫기</button>
    </div>
    ${page === "cal" ? `<div class="study-row">
      <button class="study-btn primary" id="btnEv">+ 일정 추가</button>
      ${me.is_admin ? '<button class="study-btn" id="btnSchool">학교 일정 추가</button>' : ""}
    </div>
    <div id="dshsHint"></div>` : ""}
    ${page === "notice" ? `<div class="study-row">
      <button class="study-btn primary" id="btnNew">+ 수행평가 추가</button>
      ${me.is_admin ? '<button class="study-btn" id="btnAdmin">승인 대기 <span id="pendCount">0</span></button>' : ""}
    </div>` : ""}
    <div id="studyBody"><div class="study-empty">불러오는 중…</div></div>`;
  if ($("btnEv")) $("btnEv").onclick = () => openEventForm(null);
  if ($("btnSchool")) $("btnSchool").onclick = () => openSchoolForm(null);
  paintDshs();
  if ($("btnNew")) $("btnNew").onclick = () => openNewForm();   // 클릭 이벤트가 "고칠 공지" 로 넘어가지 않게
  if ($("btnAdmin")) $("btnAdmin").onclick = () => renderList("admin");
}

async function loadAssignments() {
  loadDshs();   // dshs.app 신청 내역은 따로 받아서, 오면 달력에 더합니다
  const [asg, personal, evs, done, people, todos, school] = await Promise.all([
    sb.from("assignments").select("*").order("due_at", { ascending: true }),
    sb.from("assignment_personal").select("*"),
    sb.from("events").select("*").order("starts_at", { ascending: true }),   // 내 일정 + 친구가 공유한 일정
    sb.from("assignment_done").select("assignment_id"),
    sb.rpc("my_event_people"),
    sb.from("todos").select("*").order("created_at", { ascending: true }),
    sb.from("school_events").select("*, school_event_targets(student_id)").order("starts_at", { ascending: true }),
  ]);
  cache.school = school.data || [];
  cache.todos = todos.error ? null : todos.data;
  const { data, error } = asg;
  // 개인 일정·완료 체크를 못 불러와도 수행평가는 그대로 보여줍니다
  cache.events = evs.data || [];
  cache.done = new Set((done.data || []).map((r) => r.assignment_id));
  cache.people = new Map();   // 공유 일정 id → [{ user_id, name, is_owner, done }]
  for (const r of people.data || []) {
    if (!cache.people.has(r.event_id)) cache.people.set(r.event_id, []);
    cache.people.get(r.event_id).push(r);
  }
  if (error) {
    const body = $("studyBody");
    if (body) body.innerHTML = `<div class="study-empty">불러오지 못했어요.</div>`;
    return;
  }
  const mineOnly = new Map((personal.data || []).map((p) => [p.assignment_id, p]));
  const rows = (data || []).map((a) => withPersonal(a, mineOnly.get(a.id)));
  cache.items = rows.filter((a) => a.status === "approved");
  cache.mine = rows.filter((a) => a.created_by === me.id);
  cache.pending = rows.filter((a) => a.status === "pending");
  const pc = $("pendCount");
  if (pc) pc.textContent = cache.pending.length;
  // 작성 중인 공지 추가 폼은 덮어쓰지 않습니다
  if ($("studyView").style.display === "block" && view !== "form") rerender();
}

// 마감 일시는 선택입니다. 없으면 D-? 로 보이고, 달력·알림·급한 공지에서는 빠집니다.
// 내 계정에서만 고친 내용을 덮어씌웁니다. 안 고친 칸은 공지 값을 따라갑니다. shared 가 원래 공지입니다.
function withPersonal(a, p) {
  if (!p || a.status !== "approved") return a;
  return {
    ...a, personal: true, shared: a,
    title: p.title ?? a.title,
    due_at: p.no_due ? null : p.due_at ?? a.due_at,
    submit_to: p.no_submit ? null : p.submit_to ?? a.submit_to,
  };
}

const dueMs = (a) => (a.due_at ? Date.parse(a.due_at) : Infinity);
const byDue = (a, b) => (dueMs(a) > dueMs(b)) - (dueMs(a) < dueMs(b));   // 마감 없는 공지는 맨 뒤
const asgDue = (a) => (a.due_at ? dueInfo(a.due_at) : { label: "D-?", tone: "ok", when: null });
// 수정: 승인된 수행평가는 누구나 (학생은 내 계정에서만 바뀝니다), 아직 나만 보이는 것은 작성자, 관리자는 전체.
// 삭제: 관리자, 또는 작성자가 아직 분반 공지가 아닌(대기·반려) 자기 공지를
const editsOnlyForMe = (a) => !me.is_admin && a.status === "approved";
const canEditAsg = (a) => me.is_admin || a.status === "approved" || a.created_by === me.id;
const canDelAsg = (a) => me.is_admin || (a.created_by === me.id && a.status !== "approved");

// 승인 전 수행평가의 상태. D-day 옆에 함께 보여 줍니다
const stBadge = (status) => (status === "pending" ? '<span class="st-badge pending">대기</span>'
  : status === "rejected" ? '<span class="st-badge rejected">반려됨</span>' : "");

function card(a, opts = {}) {
  const d = asgDue(a);
  const badge = `<span class="asg-badges">${a.personal ? '<span class="own-tag">내가 수정함</span>' : ""}${stBadge(a.status)}<span class="due-badge ${d.tone}">${d.label}</span></span>`;
  const done = opts.check && cache.done.has(a.id);
  const editBtn = canEditAsg(a) ? `<button class="study-btn small" data-aedit="${a.id}">수정</button>` : "";
  const delBtn = canDelAsg(a) ? `<button class="study-btn small no" data-del="${a.id}">삭제</button>` : "";
  return `<div class="asg-card${done ? " done" : ""}">
    <div class="asg-top"><span class="asg-subject">${esc(a.subject)} · ${esc(banLabel(a.ban))}</span>${badge}</div>
    <div class="asg-title">${esc(a.title)}</div>
    ${a.body ? `<div class="asg-body">${esc(a.body)}</div>` : ""}
    <div class="asg-due"><span>${d.when ? `${d.when} 마감` : "마감 일시 미정"}</span>${a.author_name ? `<span class="asg-by">${esc(a.author_name)} 작성</span>` : ""}</div>
    ${a.submit_to ? `<div class="asg-due">제출: ${esc(a.submit_to)}</div>` : ""}
    ${opts.check ? `<div class="asg-actions">
      <button class="study-btn small${done ? " on" : ""}" data-adone="${a.id}">${done ? "완료함" : "완료 표시"}</button>
      ${editBtn}${delBtn}
    </div>` : ""}
    ${opts.admin ? `<div class="asg-actions">
      <button class="study-btn small ok" data-ok="${a.id}">승인</button>
      <button class="study-btn small no" data-no="${a.id}">반려</button>
      ${editBtn}${delBtn}
    </div>` : ""}
  </div>`;
}

function renderList(mode) {
  const body = $("studyBody");
  view = mode;
  loadAcademic();
  if (mode === "admin") {
    destroyCal();
    body.innerHTML = `<div class="study-section">승인 대기 ${cache.pending.length}건</div>` +
      (cache.pending.length
        ? cache.pending.map((a) => card(a, { admin: true })).join("")
        : `<div class="study-empty">승인 대기 중인 수행평가가 없어요.</div>`) +
      `<button class="study-btn wide" id="backFeed">← 목록으로</button>`;
    body.querySelectorAll("[data-ok]").forEach((b) => b.onclick = () => review(b.dataset.ok, "approved"));
    body.querySelectorAll("[data-no]").forEach((b) => b.onclick = () => review(b.dataset.no, "rejected"));
    bindRows(body);
    $("backFeed").onclick = renderNotice;
    return;
  }
  // 달력이 이미 떠 있으면 다시 그리지 않고 일정만 새로 받습니다 (보던 날짜·스크롤 유지)
  if (tab !== "list" && fc && body.contains(fc.el)) {
    fc.refetchEvents();
    return;
  }
  destroyCal();
  body.innerHTML = `
    <div class="cal-bar">
      ${tab === "list" ? "" : `<div class="cal-nav-group">
        <button class="study-btn small" data-nav="today">오늘</button>
        <button class="cal-nav" data-nav="prev" aria-label="이전">‹</button>
        <button class="cal-nav" data-nav="next" aria-label="다음">›</button>
        <span class="cal-title" id="calTitle"></span>
      </div>`}
      <div class="cal-right">
        <div class="seg">${VIEWS.map(([k, label]) =>
          `<button class="seg-btn${tab === k ? " on" : ""}" data-seg="${k}">${label}</button>`).join("")}</div>
      </div>
    </div>${legendHtml()}` +
    (tab === "list" ? listHtml([...agenda(), ...acadAgenda()].sort(byAgenda)) : `<div class="fc-host" id="calHost"><div class="study-empty">달력 불러오는 중…</div></div>`);
  body.querySelectorAll("[data-seg]").forEach((b) => b.onclick = () => switchTab(b.dataset.seg));
  body.querySelectorAll("[data-nav]").forEach((b) => b.onclick = () => fc && fc[b.dataset.nav]());
  bindRows(body);
  if (tab !== "list") mountCal();
}

// 목록의 완료 동그라미 · 항목 열기 · 공지 취소
function bindRows(root) {
  root.querySelectorAll("[data-chk]").forEach((b) => b.onclick = () => toggleDone(...b.dataset.chk.split(":")));
  root.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => openItem(...b.dataset.open.split(":")));
  root.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => removeItem(b.dataset.del));
  root.querySelectorAll("[data-aedit]").forEach((b) => b.onclick = () => openNewForm(findAsg(b.dataset.aedit)));
}
const findAsg = (id) => cache.items.find((a) => a.id === id) || cache.mine.find((a) => a.id === id) || cache.pending.find((a) => a.id === id);
function openItem(kind, id) {
  if (kind === "asg") openAsgDetail(findAsg(id));
  else if (kind === "sch") {
    const se = cache.school.find((x) => x.id === id);
    me.is_admin ? openSchoolForm(se) : openSchoolDetail(se);
  } else if (kind === "tt") return;
  else if (kind === "acad") {
    const a = acadList.find((e) => e.id === id);
    me.is_admin ? openSchoolForm(neisDraft(a)) : openAcadDetail(a);
  }
  else if (kind === "dshs") openDshsDetail(dshs.items.find((r) => r.uid === id));
  else if (kind === "todo") openTodoForm(cache.todos.find((t) => t.id === id));
  else {
    const ev = cache.events.find((e) => e.id === id);
    ownsEvent(ev) ? openEventForm(ev) : openSharedEvent(ev);
  }
}

function switchTab(next) {
  const wasList = tab === "list";
  tab = next;
  try { localStorage.setItem("dshs-cal-view", next); } catch {}
  if (next !== "list" && !wasList && fc) {
    // 보던 범위에 오늘이 있으면 오늘부터, 아니면 그 범위의 첫날부터
    const t = new Date(), v = fc.view;
    fc.changeView(FC_VIEW[next], t >= v.activeStart && t < v.activeEnd ? t : v.currentStart);
    $("studyBody").querySelectorAll("[data-seg]").forEach((b) => b.classList.toggle("on", b.dataset.seg === next));
    return;
  }
  renderList("feed");
}

// ---------- 달력 (FullCalendar) ----------
const FC_SRC = "https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js";
const FC_KO = "https://cdn.jsdelivr.net/npm/@fullcalendar/core@6.1.15/locales/ko.global.min.js";
const FC_VIEW = { "3day": "threeDays", week: "timeGridWeek", month: "dayGridMonth" };
const HOUR = 3600000;

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}
let fcReady = null;
function loadFC() {
  if (!fcReady) fcReady = loadScript(FC_SRC).then(() => loadScript(FC_KO));
  return fcReady;
}

function destroyCal() {
  if (fc) { fcDate = fc.getDate(); fc.destroy(); fc = null; }
}

async function mountCal() {
  try { await loadFC(); }
  catch { fcReady = null; $("calHost").innerHTML = `<div class="study-empty">달력을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</div>`; return; }
  const host = $("calHost");
  if (!host || tab === "list") return;   // 불러오는 사이 다른 화면으로 넘어감
  host.innerHTML = "";
  const narrow = window.innerWidth < 640;
  fc = new FullCalendar.Calendar(host, {
    initialView: FC_VIEW[tab],
    initialDate: fcDate || undefined,
    views: { threeDays: { type: "timeGrid", duration: { days: 3 } } },
    locale: "ko",
    headerToolbar: false,
    height: narrow ? Math.max(480, window.innerHeight * 0.72) : 720,
    nowIndicator: true,
    allDaySlot: true,
    allDayText: "종일",
    slotDuration: "01:00:00",
    snapDuration: "00:15:00",
    scrollTime: "08:00:00",
    lazyFetching: false,   // 보기를 바꿀 때마다 새로 그립니다. 월 보기에서 받은 일정에는 시간표가 없습니다
    expandRows: true,
    dayMaxEvents: 3,
    eventDisplay: "block",
    selectable: true,
    selectMirror: true,
    selectMinDistance: 5,
    longPressDelay: 400,
    eventResizableFromStart: true,
    slotLabelFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
    dayHeaderContent: (arg) => arg.view.type === "dayGridMonth"
      ? arg.text
      : { html: `<span class="fcx-wd">${arg.date.toLocaleDateString("ko-KR", { weekday: "short" })}</span><span class="fcx-daynum">${arg.date.getDate()}</span>` },
    // 월 보기 칸의 "29일" → "29". 주·3일 보기의 종일 칸에는 날짜를 다시 쓰지 않습니다
    dayCellContent: (arg) => arg.view.type === "dayGridMonth" ? String(arg.date.getDate()) : "",
    events: (info, ok) => ok([...ttEvents(info.start, info.end), ...acadEvents(info.start, info.end), ...fcEvents()]),
    eventContent: fcContent,
    datesSet: (arg) => { fcDate = arg.view.currentStart; const t = $("calTitle"); if (t) t.textContent = arg.view.title; },
    dateClick: (arg) => {
      let start = arg.date;
      if (arg.view.type === "dayGridMonth") {   // 월 보기에서 날짜를 누르면 다음 정각 1시간짜리
        start = new Date(arg.date);
        start.setHours(Math.min(new Date().getHours() + 1, 23));
        return openEventForm(null, { start, end: new Date(+start + HOUR), allDay: false });
      }
      openEventForm(null, { start, end: arg.allDay ? start : new Date(+start + HOUR), allDay: arg.allDay });
    },
    select: (arg) => {
      fc.unselect();
      openEventForm(null, { start: arg.start, end: arg.allDay ? new Date(+arg.end - 1) : arg.end, allDay: arg.allDay });
    },
    eventClick: (arg) => {
      const [kind, id] = arg.event.id.split(":");
      if (kind === "todo" && arg.jsEvent.target.closest(".fcx-tchk")) return toggleTodo(id);   // 동그라미 = 체크
      openItem(kind, id);
    },
    eventDrop: (arg) => moveEvent(arg),
    eventResize: (arg) => moveEvent(arg),
  });
  fc.render();
  loadAcademic();
}

// agenda() 항목 → FullCalendar 일정. 수행평가는 마감일의 종일 칸에 둡니다.
function fcEvents() {
  return agenda().map((it) => {
    const base = {
      id: `${it.kind}:${it.id}`, title: it.title,
      classNames: [`c-${it.color}`, it.kind === "asg" ? "fcx-asg" : "", it.status && it.status !== "approved" ? "fcx-pend" : "", it.done ? "is-done" : ""],
      extendedProps: { kind: it.kind, at: it.at, done: it.done, shared: it.shared },
    };
    if (it.shared) base.classNames.push("fcx-shared");
    if (it.kind === "todo") return { ...base, classNames: [...base.classNames, "fcx-todo"], start: dayKey(it.at), allDay: true, editable: true, durationEditable: false };
    if (it.kind === "asg") return { ...base, start: dayKey(it.at), allDay: true, editable: false };
    if (it.allDay) {
      const last = it.end || it.at;   // 종일 일정의 끝은 마지막 날 23:59 → FullCalendar 는 다음 날 0시(미포함)
      return { ...base, start: dayKey(it.at), end: dayKey(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)), allDay: true, editable: !!it.owner };
    }
    // 친구가 공유한 일정은 만든 사람만 옮길 수 있습니다
    return { ...base, start: it.at, end: it.end || new Date(+it.at + HOUR / 2), editable: !!it.owner };
  });
}

// 폰의 주·월 보기는 칸이 좁아 시간은 빼고, 제목은 칸에 들어가는 만큼만 보여 줍니다 (눌러서 자세히 봄).
// 폰의 3일 보기는 줄이지 않고 줄바꿈으로 모두 보여 줍니다 (index.html 의 .fc-threeDays-view 규칙).
const compactCal = (arg) => window.innerWidth < 640 && arg.view.type !== "threeDays";

function fcContent(arg) {
  const p = arg.event.extendedProps;
  const compact = compactCal(arg);
  const full = arg.event.title, title = full;
  if (p.kind === "tt") return { html: `<div class="fcx-tt-in"><b>${esc(title)}</b>${compact ? "" : `<span>${esc(p.label)}</span>`}</div>` };
  if (p.kind === "todo") return { html: `<div class="fcx" title="${esc(full)}"><div class="fcx-title"><span class="fcx-tchk" role="checkbox" aria-checked="${p.done}" aria-label="완료 표시">${p.done ? "✓" : ""}</span>${esc(title)}</div></div>` };
  const s = arg.event.start, e = arg.event.end;
  const time = compact ? ""
    : p.kind === "asg" ? `${hm(p.at)} 마감`
    : arg.event.allDay ? "" : `${hm(s)}${e ? ` – ${hm(e)}` : ""}`;
  return { html: `<div class="fcx" title="${esc(full)}">
    ${time ? `<div class="fcx-time">${time}</div>` : ""}
    <div class="fcx-title">${esc(title)}</div>
  </div>` };
}

// 끌어서 옮기거나 늘린 개인 일정 저장
async function moveEvent(arg) {
  const [kind, id] = arg.event.id.split(":");
  const s = arg.event.start, e = arg.event.end;
  let row;
  if (arg.event.allDay) {
    const lastDay = e ? new Date(+e - 1) : s;   // 미포함 끝 → 마지막 날
    row = {
      all_day: true, starts_at: s.toISOString(),
      ends_at: dayKey(lastDay) !== dayKey(s)
        ? new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59).toISOString() : null,
    };
  } else {
    row = { all_day: false, starts_at: s.toISOString(), ends_at: (e || new Date(+s + HOUR)).toISOString() };
  }
  if (kind === "todo") {   // 할 일: 놓은 날짜로 기한만 옮깁니다 (시간 칸에 놓아도 그날 종일로)
    const t = cache.todos.find((x) => x.id === id);
    const prev = t.due_on, due_on = dayKey(s);
    if (due_on === prev) { fc.refetchEvents(); return; }
    const { error } = await sb.from("todos").update({ due_on }).eq("id", id);
    if (error) { arg.revert(); return toast("옮기지 못했어요", true); }
    t.due_on = due_on;
    fc.refetchEvents();
    return undoToast(`할 일 기한을 옮겼어요 · ${todoDue(due_on).short}`, async () => {
      const { error } = await sb.from("todos").update({ due_on: prev }).eq("id", id);
      if (error) return false;
      t.due_on = prev;
      fc?.refetchEvents();
    });
  }
  if (kind === "acad") {   // NEIS 일정 (관리자만 끌 수 있음): 처음 옮기면 모두에게 보이는 수정본이 생깁니다
    const a = acadList.find((x) => x.id === id);
    const { id: _id, school_event_targets: _t, ...draft } = neisDraft(a);
    const { error } = await sb.from("school_events").insert({ ...draft, ...row });
    if (error) { arg.revert(); return toast("옮기지 못했어요", true); }
    toast("학교 일정을 옮겼어요");
    return loadAssignments();
  }
  if (kind === "sch") {   // 학교 일정 (관리자만 끌 수 있음)
    const se = cache.school.find((x) => x.id === id);
    const prev = { starts_at: se.starts_at, ends_at: se.ends_at, all_day: se.all_day };
    const { error } = await sb.from("school_events").update(row).eq("id", id);
    if (error) { arg.revert(); return toast("옮기지 못했어요", true); }
    Object.assign(se, row);
    fc.refetchEvents();
    return undoToast("학교 일정을 옮겼어요", async () => {
      const { error } = await sb.from("school_events").update(prev).eq("id", id);
      if (error) return false;
      Object.assign(se, prev);
      fc?.refetchEvents();
    });
  }
  // 지난 일정을 미래로 옮기면 완료를 취소합니다 (함께하는 친구 체크는 DB 트리거가 풉니다).
  // 미래 일정끼리 옮기는 건 완료 여부를 건드리지 않습니다.
  const ev = cache.events.find((x) => x.id === id);
  const prev = { starts_at: ev.starts_at, ends_at: ev.ends_at, all_day: ev.all_day, done: ev.done };
  const reopened = isPastEvent(ev) && eventEnd(row) > new Date();
  if (reopened) row.done = false;
  const { error } = await sb.from("events").update(row).eq("id", id);
  if (error) { arg.revert(); return toast("옮기지 못했어요", true); }
  Object.assign(ev, row);
  fc.refetchEvents();
  undoToast((arg.event.allDay ? "날짜를 옮겼어요"
    : `${md(s)} ${hm(s)} – ${hm(new Date(row.ends_at))}(으)로 옮겼어요`) + (reopened ? " · 완료 취소" : ""), async () => {
    const { error } = await sb.from("events").update(prev).eq("id", id);
    if (error) return false;
    Object.assign(ev, prev);
    fc?.refetchEvents();
  });
}

// ---------- 지난 일정 자동 완료 ----------
// 끝나는 시각이 지나면 완료로 보여줍니다 (DB 에 쓰지 않고 그릴 때 계산).
// 끝이 없으면: 종일 일정은 그날 밤 23:59:59, 시간 일정은 시작 시각.
// e 는 events 행 모양 { starts_at, ends_at, all_day } 이면 됩니다.
function eventEnd(e) {
  if (e.ends_at) return new Date(e.ends_at);
  const s = new Date(e.starts_at);
  return e.all_day ? new Date(s.getFullYear(), s.getMonth(), s.getDate(), 23, 59, 59) : s;
}
const isPastEvent = (e) => eventEnd(e) < new Date();

// ---------- 공유 일정 ----------
const ownsEvent = (e) => e.user_id === me.id;
const eventPeople = (e) => cache.people.get(e.id) || [];
// 완료 체크는 사람마다 따로: 만든 사람은 events.done, 참여자는 event_members.done
const eventDone = (e) => ownsEvent(e) ? e.done : !!eventPeople(e).find((p) => p.user_id === me.id)?.done;
function shareLabel(e) {
  const ppl = eventPeople(e);
  if (!ppl.length) return "";
  if (!ownsEvent(e)) return `${ppl.find((p) => p.is_owner)?.name || "친구"}님이 공유`;
  const names = ppl.filter((p) => !p.is_owner).map((p) => p.name);
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}명과` : `${names.join(", ")}와 함께`;
}

// ---------- 목록 ----------
// 수행평가와 개인 일정을 한 형태로 합칩니다
function agenda() {
  // 내가 올린 수행평가는 승인 전(또는 반려 후)에도 내 일정에는 바로 들어갑니다.
  // 승인은 "분반 전체에 공지할지"만 정합니다.
  const own = (cache.mine || []).filter((a) => a.status !== "approved");
  const now = new Date();
  // 마감 일시가 없는 공지는 날짜가 없어 달력·목록에 놓을 수 없으므로 수행평가 공지 탭에서만 보여 줍니다
  const asgs = [...cache.items, ...own].filter((a) => a.due_at).map((a) => ({
    kind: "asg", id: a.id, title: a.title, at: new Date(a.due_at), end: null, allDay: false,
    color: "asg", done: cache.done.has(a.id) || new Date(a.due_at) < now, status: a.status,
    auto: !cache.done.has(a.id) && new Date(a.due_at) < now,
    tag: `${a.subject} · ${banLabel(a.ban)}`,
  }));
  const evs = cache.events.map((e) => ({
    kind: "ev", id: e.id, title: e.title, at: new Date(e.starts_at), end: e.ends_at ? new Date(e.ends_at) : null,
    allDay: e.all_day, color: e.color, done: eventDone(e) || isPastEvent(e), auto: !eventDone(e) && isPastEvent(e),
    owner: ownsEvent(e), shared: eventPeople(e).length > 0,
    tag: [shareLabel(e), e.memo.split("\n")[0]].filter(Boolean).join(" · "),
  }));
  // 관리자가 숨긴 학사일정은 관리자에게만 흐리게 보여 줍니다 (눌러서 되돌릴 수 있게)
  const sch = [...liveSchool(), ...(me.is_admin ? cache.school.filter((e) => e.hidden) : [])]
    .filter((e) => acadShown(e.category)).map((e) => ({
    kind: "sch", id: e.id, title: e.hidden ? `숨김 · ${e.title}` : e.title, at: new Date(e.starts_at), end: e.ends_at ? new Date(e.ends_at) : null,
    allDay: e.all_day, color: "school", done: !!e.hidden, owner: me.is_admin,
    tag: [e.no_class && "수업 없음", me.is_admin && e.audience === "some" && `${schoolTargets(e).length}명 대상`,
      e.memo.split("\n")[0]].filter(Boolean).join(" · "),
  }));
  // 기한을 정한 할 일은 그날 종일 칸에 체크박스로 둡니다
  const todos = (cache.todos || []).filter((t) => t.due_on).map((t) => ({
    kind: "todo", id: t.id, title: t.title, at: parseDay(t.due_on), end: null, allDay: true,
    color: "mint", done: t.done, owner: true,
  }));
  return [...sch, ...asgs, ...todos, ...evs, ...dshsAgenda()].sort(byAgenda);
}
const byAgenda = (x, y) => (y.allDay - x.allDay) || (x.at - y.at);

function timeLabel(it) {
  const multi = it.end && dayKey(it.end) !== dayKey(it.at);
  if (it.kind === "asg") return `${hm(it.at)} 마감`;
  if (it.allDay) return multi ? `${md(it.at)} – ${md(it.end)} · 하루 종일` : "하루 종일";
  if (!it.end) return hm(it.at);
  return multi ? `${md(it.at)} ${hm(it.at)} – ${md(it.end)} ${hm(it.end)}` : `${hm(it.at)} – ${hm(it.end)}`;
}

// 일정 종류 이름. 모든 일정은 같은 모양이고 색으로만 구분합니다 (범례 · 목록의 회색 글씨)
const KIND_LABEL = { asg: "수행평가", todo: "할 일", ev: "내 일정", sch: "학교 일정", acad: "학교 일정", dshs: "dshs.app 신청" };
function legendHtml() {
  const kinds = [["asg", "c-asg"], ["todo", "c-mint"], ["ev", "c-violet"], ["sch", "c-school"], ["dshs", "c-dshs"]];
  return `<div class="kind-legend">${kinds.map(([k, c]) => `<span class="kl ${c}"><i></i>${KIND_LABEL[k]}</span>`).join("")}</div>`;
}

function row(it) {
  const d = it.kind === "asg" && !it.done ? dueInfo(it.at) : null;
  return `<div class="ev-row c-${it.color}${it.done ? " done" : ""}">
    ${it.kind === "sch" || it.kind === "acad" || it.kind === "dshs" ? `<span class="ev-dot" aria-hidden="true"></span>`
      : `<button class="ev-check" data-chk="${it.kind}:${it.id}" aria-label="완료 표시"${it.auto
      ? ' disabled title="지난 일정은 자동으로 완료돼요"' : ""}>${it.done ? "✓" : ""}</button>`}
    <button class="ev-main" data-open="${it.kind}:${it.id}">
      <span class="ev-title">${esc(it.title)}</span>
      <span class="ev-meta">${KIND_LABEL[it.kind]} · ${esc(timeLabel(it))}${it.tag ? ` · ${esc(it.tag)}` : ""}</span>
    </button>
    ${it.kind === "asg" ? `<span class="asg-badges">${stBadge(it.status)}${d ? `<span class="due-badge ${d.tone}">${d.label}</span>` : ""}</span>` : ""}
  </div>`;
}

function listHtml(list) {
  const today = dayKey(new Date());
  // 이미 시작한 여러 날 일정은 오늘 칸에 묶습니다
  const groups = new Map();
  for (const it of list.filter((it) => dayKey(it.end || it.at) >= today)) {
    const key = dayKey(it.at) < today ? today : dayKey(it.at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const keys = [...groups.keys()].sort();
  const left = list.filter((it) => !it.done && dayKey(it.end || it.at) >= today).length;
  return `<div class="study-section">남은 일정 ${left}건</div>` +
    (keys.length
      ? keys.map((k) => `<div class="day-head">${k === today ? "오늘 · " : ""}${dayTitle(k)}</div>` +
          groups.get(k).map(row).join("")).join("")
      : `<div class="study-empty">다가오는 일정이 없어요.</div>`);
}

// ---------- 완료 체크 ----------
async function toggleDone(kind, id) {
  if (kind === "todo") return toggleTodo(id);
  let error;
  if (kind === "asg") {
    const on = !cache.done.has(id);
    ({ error } = on
      ? await sb.from("assignment_done").insert({ assignment_id: id })
      : await sb.from("assignment_done").delete().eq("assignment_id", id));
    if (!error) on ? cache.done.add(id) : cache.done.delete(id);
  } else {
    const ev = cache.events.find((e) => e.id === id);
    const on = !eventDone(ev);
    if (ownsEvent(ev)) {
      ({ error } = await sb.from("events").update({ done: on }).eq("id", id));
      if (!error) ev.done = on;
    } else {
      ({ error } = await sb.from("event_members").update({ done: on }).eq("event_id", id).eq("user_id", me.id));
      if (!error) eventPeople(ev).find((p) => p.user_id === me.id).done = on;
    }
  }
  if (error) return toast("저장하지 못했어요", true);
  rerender();
}

// ---------- 수행평가 상세 / 개인 일정 추가·수정 ----------
function openSheet(title, inner) {
  const m = $("studyModal");
  m.className = "study-modal show";
  m.innerHTML = `<div class="study-sheet">
    <div class="study-sheet-head"><div class="sheet-title">${title}</div><button class="study-x">✕</button></div>
    ${inner}
  </div>`;
  m.querySelector(".study-x").onclick = closeModal;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
}

function openAsgDetail(a) {
  const done = cache.done.has(a.id);
  const ownOnly = a.created_by === me.id && a.status !== "approved";
  openSheet("수행평가", `${card(a)}
    ${ownOnly ? `<div class="study-foot">${a.status === "pending"
      ? "아직 나만 보여요. 관리자가 승인하면 같은 분반 친구들에게도 보여요."
      : "승인되지 않아 분반 친구들에게는 보이지 않아요. 내 일정에는 그대로 남아 있어요."}</div>` : ""}
    <button class="study-submit${done ? " ghost" : ""}" id="aDone">${done ? "완료 취소" : "완료로 표시"}</button>
    ${canEditAsg(a) ? '<button class="study-submit ghost" id="aEdit">수정</button>' : ""}
    ${canDelAsg(a) ? '<button class="study-submit ghost danger" id="aDel">삭제</button>' : ""}`);
  $("aDone").onclick = async () => { closeModal(); await toggleDone("asg", a.id); };
  if ($("aEdit")) $("aEdit").onclick = () => { closeModal(); openStudy("notice"); openNewForm(a); };
  if ($("aDel")) $("aDel").onclick = async () => { if (await removeItem(a.id)) closeModal(); };
}

// 길이 버튼: 누르면 끝 = 시작 + 길이
const DURATIONS = [[30, "30분"], [60, "1시간"], [90, "1시간 30분"], [120, "2시간"], [180, "3시간"]];

// ev: 고칠 일정 (없으면 새 일정) · seed: 새 일정의 { start, end, allDay }
function openEventForm(ev, seed) {
  let start, end, allDay;
  if (ev) {
    start = new Date(ev.starts_at);
    allDay = ev.all_day;
    end = ev.ends_at ? new Date(ev.ends_at) : allDay ? start : new Date(+start + HOUR);
  } else if (seed) {
    ({ start, end, allDay } = seed);
  } else {
    start = new Date();
    start.setHours(Math.min(start.getHours() + 1, 23), 0, 0, 0);
    end = new Date(+start + HOUR);
    allDay = false;
  }
  // 시작을 바꾸면 끝이 이 길이만큼 따라옵니다 (처음엔 1시간)
  let dur = allDay || end <= start ? HOUR : end - start;
  const color = ev?.color || "violet";
  openSheet(ev ? "일정 수정" : "새 일정", `
    <label class="study-label">제목</label>
    <input class="study-input" id="eTitle" maxlength="120" value="${esc(ev?.title || "")}" placeholder="예: 동아리 회의, 학원, 생일">
    <label class="ev-allday"><input type="checkbox" id="eAll"${allDay ? " checked" : ""}> 하루 종일</label>
    <label class="study-label">시작</label>
    <div class="ev-when"><input class="study-input" type="date" id="eSd" value="${dayKey(start)}"><input class="study-input" type="time" id="eSt" step="300" value="${allDay ? "09:00" : hm(start)}"></div>
    <label class="study-label">끝</label>
    <div class="ev-when"><input class="study-input" type="date" id="eEd" value="${dayKey(end)}"><input class="study-input" type="time" id="eEt" step="300" value="${allDay ? "10:00" : hm(end)}"></div>
    <div class="ev-durs">${DURATIONS.map(([m, label]) =>
      `<button type="button" class="ev-dur" data-dur="${m}">${label}</button>`).join("")}</div>
    <label class="study-label">색</label>
    <div class="ev-colors">${COLORS.map((c) =>
      `<button type="button" class="ev-swatch c-${c}${c === color ? " on" : ""}" data-color="${c}" aria-label="${c}"></button>`).join("")}</div>
    <label class="study-label">메모 (선택)</label>
    <textarea class="study-input" id="eMemo" rows="3" maxlength="2000" placeholder="장소, 준비물 등">${esc(ev?.memo || "")}</textarea>
    <label class="study-label">함께하는 친구 (선택)</label>
    <div class="fr-chips" id="frChips"></div>
    <input class="study-input" id="frQ" autocomplete="off" placeholder="이름·학번으로 찾기">
    <div class="fr-results" id="frRes"></div>
    <div class="study-foot fr-note">넣은 친구 달력에도 이 일정이 생겨요. 고치거나 지우면 친구 달력에도 반영돼요.</div>
    ${ev ? `<label class="ev-allday"><input type="checkbox" id="eDone"${ev.done || isPastEvent(ev) ? " checked" : ""}${isPastEvent(ev) ? " disabled" : ""}> 완료한 일정${
      isPastEvent(ev) ? ' <span class="ev-hint">(지난 일정이라 자동 완료 · 미래로 옮기면 풀려요)</span>' : ""}</label>` : ""}
    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="eSave">${ev ? "저장" : "추가"}</button>
    ${ev ? '<button class="study-submit ghost danger" id="eDel">일정 삭제</button>' : ""}`);
  const sheet = $("studyModal").querySelector(".study-sheet");
  const at = (d, t) => (d ? new Date(`${d}T${t || "00:00"}`) : null);
  const readStart = () => at($("eSd").value, $("eSt").value);
  const readEnd = () => at($("eEd").value, $("eEt").value);
  const writeEnd = (d) => { $("eEd").value = dayKey(d); $("eEt").value = hm(d); };
  const markDur = () => sheet.querySelectorAll("[data-dur]").forEach((b) =>
    b.classList.toggle("on", +b.dataset.dur * 60000 === dur));
  const syncAll = () => sheet.classList.toggle("allday", $("eAll").checked);

  const onStart = () => {
    const s = readStart();
    if (!s || isNaN(s)) return;
    if ($("eAll").checked) { if (!$("eEd").value || $("eEd").value < $("eSd").value) $("eEd").value = $("eSd").value; }
    else writeEnd(new Date(+s + dur));
  };
  const onEnd = () => {
    const s = readStart(), e = readEnd();
    if (s && e && e > s) dur = e - s;
    markDur();
  };
  $("eSd").onchange = onStart; $("eSt").onchange = onStart;
  $("eEd").onchange = onEnd; $("eEt").onchange = onEnd;
  sheet.querySelectorAll("[data-dur]").forEach((b) => b.onclick = () => {
    dur = +b.dataset.dur * 60000;
    const s = readStart();
    if (s) writeEnd(new Date(+s + dur));
    markDur();
  });
  $("eAll").onchange = () => {
    syncAll();
    if ($("eAll").checked) $("eEd").value = $("eSd").value;
    else onStart();
  };
  syncAll();
  markDur();

  // 함께하는 친구: 가입한 사람만 검색됩니다 (search_people)
  const before = ev ? eventPeople(ev).filter((p) => !p.is_owner).map((p) => ({ id: p.user_id, name: p.name })) : [];
  let friends = [...before];
  const drawChips = () => {
    $("frChips").innerHTML = friends.map((f, i) =>
      `<span class="fr-chip">${esc(f.name)}<button type="button" data-rm="${i}" aria-label="${esc(f.name)} 빼기">✕</button></span>`).join("");
    $("frChips").querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { friends.splice(+b.dataset.rm, 1); drawChips(); });
  };
  drawChips();
  let qTimer, qSeq = 0;
  $("frQ").oninput = () => {
    clearTimeout(qTimer);
    const q = $("frQ").value.trim();
    if (!q) { $("frRes").innerHTML = ""; return; }
    qTimer = setTimeout(async () => {
      const seq = ++qSeq;
      const { data, error } = await sb.rpc("search_people", { p_query: q });
      if (seq !== qSeq) return;   // 더 늦게 친 검색어의 결과만 보여줍니다
      const list = (data || []).filter((p) => !friends.some((f) => f.id === p.id));
      $("frRes").innerHTML = error ? `<div class="fr-empty">찾지 못했어요.</div>`
        : list.length ? list.map((p, i) =>
          `<button type="button" class="fr-item" data-add="${i}"><b>${esc(p.name)}</b>${p.student_id ? `<span>${p.student_id}</span>` : ""}</button>`).join("")
        : `<div class="fr-empty">가입한 사람 중에 없어요.</div>`;
      $("frRes").querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
        const p = list[+b.dataset.add];
        friends.push({ id: p.id, name: p.name });
        drawChips();
        $("frQ").value = ""; $("frRes").innerHTML = ""; $("frQ").focus();
      });
    }, 250);
  };

  let pick = color;
  sheet.querySelectorAll("[data-color]").forEach((b) => b.onclick = () => {
    pick = b.dataset.color;
    sheet.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("eSave").onclick = async () => {
    const title = $("eTitle").value.trim();
    const sd = $("eSd").value, ed = $("eEd").value || sd;
    const all = $("eAll").checked;
    if (!title) return showErr("제목을 입력해 주세요.");
    if (!sd) return showErr("시작 날짜를 정해 주세요.");
    let starts, ends;
    if (all) {
      starts = at(sd);
      ends = ed > sd ? at(ed, "23:59") : null;
      if (ed < sd) return showErr("끝나는 날이 시작보다 빨라요.");
    } else {
      starts = readStart();
      ends = readEnd();
      if (!ends) return showErr("끝나는 시간을 정해 주세요.");
      if (ends <= starts) return showErr("끝나는 시간이 시작보다 빨라요.");
    }
    const row = {
      title, memo: $("eMemo").value.trim(), all_day: all, color: pick,
      starts_at: starts.toISOString(), ends_at: ends ? ends.toISOString() : null,
    };
    let reopened = false;
    if (ev) {
      // 지난 일정을 미래로 옮기면 완료를 취소합니다. 지난 일정(체크 잠김)은 원래 값을 유지
      reopened = isPastEvent(ev) && eventEnd(row) > new Date();
      row.done = reopened ? false : $("eDone").disabled ? ev.done : $("eDone").checked;
    }
    $("eSave").disabled = true;
    const { data: saved, error } = ev
      ? await sb.from("events").update(row).eq("id", ev.id).select("id").single()
      : await sb.from("events").insert(row).select("id").single();
    if (error) { $("eSave").disabled = false; return showErr("저장하지 못했어요: " + error.message); }
    // 친구 목록 맞추기: 새로 넣은 친구는 추가, 뺀 친구는 삭제
    const add = friends.filter((f) => !before.some((b) => b.id === f.id));
    const drop = before.filter((b) => !friends.some((f) => f.id === b.id));
    const results = await Promise.all([
      add.length && sb.from("event_members").insert(add.map((f) => ({ event_id: saved.id, user_id: f.id }))),
      drop.length && sb.from("event_members").delete().eq("event_id", saved.id).in("user_id", drop.map((f) => f.id)),
    ]);
    closeModal();
    if (results.some((r) => r && r.error)) toast("일정은 저장했지만 친구 목록을 바꾸지 못했어요", true);
    else toast((add.length ? `일정을 ${friends.length}명과 공유했어요` : ev ? "일정을 고쳤어요" : "일정을 추가했어요") +
      (reopened ? " · 완료 취소" : ""));
    await loadAssignments();
    if (fc) fc.gotoDate(starts);
  };
  if (ev) $("eDel").onclick = async () => {
    // 지우기 전 모습을 기억해 두었다가 [실행 취소] 하면 같은 id 로 되살립니다 (함께하는 친구 포함)
    const snap = { id: ev.id, title: ev.title, memo: ev.memo, starts_at: ev.starts_at, ends_at: ev.ends_at,
      all_day: ev.all_day, color: ev.color, done: ev.done };
    const members = eventPeople(ev).filter((p) => !p.is_owner).map((p) => ({ event_id: ev.id, user_id: p.user_id, done: p.done }));
    const { error } = await sb.from("events").delete().eq("id", ev.id);
    if (error) return showErr("삭제하지 못했어요.");
    closeModal();
    undoToast(members.length ? `일정을 삭제했어요 · 친구 ${members.length}명 달력에서도` : "일정을 삭제했어요", async () => {
      const { error } = await sb.from("events").insert(snap);
      if (error) return false;
      if (members.length) await sb.from("event_members").insert(members);
      await loadAssignments();
    });
    await loadAssignments();
  };
}

// 친구가 공유한 일정: 보기 + 내 완료 체크 + 내 달력에서 빼기
function openSharedEvent(ev) {
  const it = agenda().find((x) => x.kind === "ev" && x.id === ev.id);
  const ppl = eventPeople(ev);
  const owner = ppl.find((p) => p.is_owner);
  const others = ppl.filter((p) => !p.is_owner).map((p) => p.user_id === me.id ? "나" : p.name);
  const done = eventDone(ev);
  openSheet("공유받은 일정", `
    <div class="asg-card c-${ev.color} shared-card">
      <div class="asg-top"><span class="asg-subject">${esc(owner?.name || "친구")}님이 공유</span></div>
      <div class="asg-title">${esc(ev.title)}</div>
      ${ev.memo ? `<div class="asg-body">${esc(ev.memo)}</div>` : ""}
      <div class="asg-due">${dayTitle(dayKey(it.at))} · ${esc(timeLabel(it))}</div>
      <div class="asg-due">함께: ${esc([owner?.name, ...others].filter(Boolean).join(", "))}</div>
    </div>
    <div class="study-foot">시간·내용은 만든 사람만 바꿀 수 있어요.</div>
    ${it.auto ? `<button class="study-submit ghost" disabled>지난 일정 · 자동 완료</button>`
      : `<button class="study-submit${done ? " ghost" : ""}" id="sDone">${done ? "완료 취소" : "완료로 표시"}</button>`}
    <button class="study-submit ghost danger" id="sLeave">내 달력에서 빼기</button>`);
  if ($("sDone")) $("sDone").onclick = async () => { closeModal(); await toggleDone("ev", ev.id); };
  $("sLeave").onclick = async () => {
    if (!confirm("이 일정을 내 달력에서 뺄까요? 다른 사람 달력에는 그대로 남아요.")) return;
    const { error } = await sb.from("event_members").delete().eq("event_id", ev.id).eq("user_id", me.id);
    if (error) return toast("빼지 못했어요", true);
    closeModal();
    toast("내 달력에서 뺐어요");
    await loadAssignments();
  };
}

// 수행평가 제출처 (고르지 않아도 됩니다. 그 밖의 곳은 폼의 "그 외" 에 직접 적습니다)
const SUBMIT_PLACES = ["클래스룸", "dshs앱", "패들렛", "메일"];

// a: 고칠 수행평가 (없으면 새로 추가). 고칠 때는 과목·분반은 바꿀 수 없고 제목·마감·제출처만 고칩니다.
function openNewForm(a) {
  const body = $("studyBody");
  // 기본 마감: 일주일 뒤 그날 자정 (23:59 — 00:00 으로 두면 달력에서 다음 날로 넘어가 보입니다)
  const dueDay = new Date();
  dueDay.setDate(dueDay.getDate() + 7);
  const dueVal = a ? (a.due_at ? `${dayKey(new Date(a.due_at))}T${hm(new Date(a.due_at))}` : "") : `${dayKey(dueDay)}T23:59`;
  const noDue = !!a && !a.due_at;
  // 고칠 때 제출처: 목록에 있으면 그걸 고르고, 없으면 "그 외" 에 적어 둡니다
  const place = a?.submit_to ? (SUBMIT_PLACES.includes(a.submit_to) ? a.submit_to : "etc") : "";
  // 학생은 자기 분반만, 관리자는 과목마다 "전체 분반" + 각 분반
  const opts = a ? [{ subject: a.subject, ban: a.ban }]
    : me.is_admin
    ? asgSubjects().flatMap((s) => [{ subject: s, ban: null },
        ...myClasses.filter((c) => c.subject === s)])
    : asgClasses();
  view = "form";
  if (!opts.length) {
    body.innerHTML = `<div class="study-empty">수강 과목 정보를 찾지 못해 수행평가를 추가할 수 없어요.</div>
      <button class="study-btn wide" id="backFeed">← 목록으로</button>`;
    $("backFeed").onclick = renderNotice;
    return;
  }
  body.innerHTML = `
    <div class="study-section">${a ? "수행평가 수정" : "수행평가 추가"}</div>
    <div class="asg-card">
      <label class="study-label">과목 · 분반</label>
      <select class="study-input" id="nClass"${a ? " disabled" : ""}>
        ${opts.map((o, i) => `<option value="${i}">${esc(o.subject)} · ${esc(banLabel(o.ban))}</option>`).join("")}
      </select>
      <label class="study-label">제목</label>
      <input class="study-input" id="nTitle" maxlength="120" placeholder="예: 3단원 실험 보고서 제출" value="${esc(a?.title ?? "")}">
      <label class="study-label">마감 일시</label>
      <input class="study-input" id="nDue" type="datetime-local" value="${dueVal}"${noDue ? " disabled" : ""}>
      <label class="ev-allday"><input type="checkbox" id="nNoDue"${noDue ? " checked" : ""}> 마감 일시 없음 <span class="ev-hint">(아직 안 정해졌으면 · D-? 로 보여요)</span></label>
      <label class="study-label">제출 (선택)</label>
      <select class="study-input" id="nSubmit">
        <option value="">선택 안 함</option>
        ${SUBMIT_PLACES.map((p) => `<option value="${p}"${place === p ? " selected" : ""}>${p}</option>`).join("")}
        <option value="etc"${place === "etc" ? " selected" : ""}>그 외 (입력)</option>
      </select>
      <input class="study-input" id="nSubmitEtc" maxlength="30" placeholder="제출처를 적어 주세요" value="${place === "etc" ? esc(a.submit_to) : ""}" style="display:${place === "etc" ? "block" : "none"};margin-top:8px">
      <div class="study-err" id="nErr"></div>
      <button class="study-submit" id="nSave">${a ? "저장하기" : "추가하기"}</button>
      <div class="study-foot">${a
        ? editsOnlyForMe(a) ? "고친 내용은 내 계정에만 보여요. 분반 친구들에게는 그대로예요."
        : a.status === "approved" ? "고치면 분반 친구들에게도 바로 바뀐 내용으로 보여요." : "과목·분반은 바꿀 수 없어요. 바꾸려면 지우고 다시 추가해 주세요."
        : me.is_admin
        ? "관리자가 추가하면 승인 없이 바로 그 분반 수강생에게 보여요."
        : "처음에는 나만 보이고, 관리자가 승인하면 같은 분반 친구들에게도 보여요."}</div>
    </div>
    ${a?.personal ? '<button class="study-btn wide" id="nReset">↩ 원래 내용으로 되돌리기</button>' : ""}
    <button class="study-btn wide" id="backFeed">← 목록으로</button>`;
  $("backFeed").onclick = renderNotice;
  if ($("nReset")) $("nReset").onclick = async () => {
    const { error } = await clearPersonal(a.id);
    if (error) return toast("되돌리지 못했어요", true);
    toast("원래 내용으로 되돌렸어요");
    view = "notice";
    await loadAssignments();
  };
  $("nSubmit").onchange = () => {
    $("nSubmitEtc").style.display = $("nSubmit").value === "etc" ? "block" : "none";
  };
  $("nNoDue").onchange = () => {
    $("nDue").disabled = $("nNoDue").checked;
    if (!$("nNoDue").checked && !$("nDue").value) $("nDue").value = `${dayKey(dueDay)}T23:59`;
  };
  $("nSave").onclick = async () => {
    const { subject, ban } = opts[+$("nClass").value];
    const title = $("nTitle").value.trim();
    const noDueNow = $("nNoDue").checked;
    const due = $("nDue").value;
    const placeNow = $("nSubmit").value;
    const submitTo = placeNow === "etc" ? $("nSubmitEtc").value.trim() : placeNow;
    const err = $("nErr");
    if (!title) { err.textContent = "제목을 입력해 주세요."; err.classList.add("show"); return; }
    if (!noDueNow && !due) { err.textContent = "마감 일시를 정하거나 \"마감 일시 없음\" 을 골라 주세요."; err.classList.add("show"); return; }
    if (placeNow === "etc" && !submitTo) { err.textContent = "제출처를 적어 주세요."; err.classList.add("show"); return; }
    $("nSave").disabled = true;
    // 내용(body) 칸은 폼에서 뺐지만, 예전에 적힌 내용은 고쳐도 그대로 둡니다
    const fields = { title, submit_to: submitTo || null, due_at: noDueNow ? null : new Date(due).toISOString() };
    let error;
    if (a && editsOnlyForMe(a)) {
      ({ error } = await savePersonal(a, fields));
    } else if (a) {
      // RLS 로 막히면 에러 없이 0행이 바뀌므로 바뀐 행을 돌려받아 확인합니다
      const res = await sb.from("assignments").update(fields).eq("id", a.id).select("id");
      error = res.error || (!res.data?.length && { message: "수정 권한이 없어요" });
    } else {
      const row = { subject, ban, ...fields, created_by: me.id, status: "pending" };
      if (me.is_admin) {           // 관리자가 올린 수행평가는 바로 분반 전체에 보입니다
        row.status = "approved";
        row.reviewed_by = me.id;
        row.reviewed_at = new Date().toISOString();
      }
      ({ error } = await sb.from("assignments").insert(row));
    }
    $("nSave").disabled = false;
    if (error) {
      // notice.sql 을 아직 실행하지 않은 DB: 마감 없는 수행평가·승인된 수행평가 수정이 막힙니다
      const needSql = /due_at|null value/.test(error.message || "");
      err.textContent = `${a ? "저장하지" : "추가하지"} 못했어요: ${needSql ? "마감 일시 없이 추가하는 기능은 아직 준비 중이에요. 마감 일시를 정해 주세요." : error.message}`;
      err.classList.add("show");
      return;
    }
    toast(a ? editsOnlyForMe(a) ? "내 계정에서만 고쳤어요" : "고쳤어요" : me.is_admin ? "바로 추가했어요" : "나만 보이게 추가했어요. 승인되면 분반 친구들에게도 보여요");
    view = "notice";
    await loadAssignments();
  };
}

const clearPersonal = (id) => sb.from("assignment_personal").delete().eq("user_id", me.id).eq("assignment_id", id);

// 원래 공지와 달라진 칸만 저장합니다. 달라진 게 없으면 저장해 둔 것을 지웁니다.
function savePersonal(a, f) {
  const b = a.shared || a;
  const minute = (t) => (t ? Math.floor(Date.parse(t) / 60000) : null);   // 입력칸에는 초가 없습니다
  const p = {
    title: f.title !== b.title ? f.title : null,
    due_at: f.due_at && minute(f.due_at) !== minute(b.due_at) ? f.due_at : null,
    no_due: !f.due_at && !!b.due_at,
    submit_to: f.submit_to && f.submit_to !== b.submit_to ? f.submit_to : null,
    no_submit: !f.submit_to && !!b.submit_to,
  };
  if (!Object.values(p).some(Boolean)) return clearPersonal(a.id);
  return sb.from("assignment_personal").upsert({
    ...p, user_id: me.id, assignment_id: a.id, updated_at: new Date().toISOString(),
  });
}

async function review(id, status) {
  const { error } = await sb.from("assignments")
    .update({ status, reviewed_by: me.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return toast("처리하지 못했어요", true);
  toast(status === "approved" ? "승인했어요" : "반려했어요");
  view = "admin";
  await loadAssignments();
}

async function removeItem(id) {
  const a = findAsg(id);
  if (!confirm(a?.status === "approved"
    ? "이 수행평가를 삭제할까요? 이 분반 친구들 모두에게서 사라져요."
    : "이 수행평가를 삭제할까요? 내 일정에서도 사라져요.")) return false;
  // RLS 로 막히면 에러 없이 0행이 지워지므로 지운 행을 돌려받아 확인합니다
  const { data, error } = await sb.from("assignments").delete().eq("id", id).select("id");
  if (error || !data?.length) { toast("삭제하지 못했어요", true); return false; }
  toast("삭제했어요");
  await loadAssignments();
  return true;
}

// ---------- 시간표 · 학교 일정 ----------
// 교시 시각: 1교시 08:20 시작, 50분 수업 + 10분 쉬는 시간, 점심 12:10–13:10
const PERIOD_TIME = {
  1: ["08:20", "09:10"], 2: ["09:20", "10:10"], 3: ["10:20", "11:10"], 4: ["11:20", "12:10"],
  5: ["13:10", "14:00"], 6: ["14:10", "15:00"], 7: ["15:20", "16:10"], 8: ["16:20", "17:10"], 9: ["17:20", "18:10"],
  10: ["19:00", "19:50"], 11: ["20:00", "20:50"], 12: ["21:00", "21:50"],
};
const DOW = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
let showTT = (() => { try { return localStorage.getItem("dshs-cal-tt") !== "off"; } catch { return true; } })();

// 내 시간표 → 요일별 수업 블록. 같은 과목이 이어지는 교시는 한 블록으로 합칩니다 (예: 3·4교시).
let ttMemo = null;
function myBlocks() {
  if (ttMemo?.sid === me.student_id) return ttMemo.blocks;
  const nm = (window.ID_TO_NAME || {})[String(me.student_id)];
  const blocks = blocksOf((nm && window.SCHOOL_DATA?.[nm]?.schedule) || []);
  ttMemo = { sid: me.student_id, blocks };
  return blocks;
}
function blocksOf(sched) {
  const blocks = {};
  for (const [day, dow] of Object.entries(DOW)) {
    const list = sched.filter((x) => x.day === day && PERIOD_TIME[x.period]).sort((a, b) => a.period - b.period);
    blocks[dow] = [];
    for (const x of list) {
      const last = blocks[dow][blocks[dow].length - 1];
      if (last && last.subject === x.subject && last.to === x.period - 1) last.to = x.period;
      else blocks[dow].push({ subject: x.subject, ban: x.ban, from: x.period, to: x.period });
    }
  }
  return blocks;
}

// 학교 일정 중 "수업 없음" 으로 표시된 날짜들 + 학사일정의 공휴일·휴업일(방학 포함)·지필평가
// 학사일정은 달력에서 꺼 두어도 그날 시간표는 깔지 않습니다.
function noClassDays() {
  const days = new Set();
  for (const e of liveSchool().filter((x) => x.no_class)) {
    const d = new Date(e.starts_at); d.setHours(0, 0, 0, 0);
    const last = new Date(e.ends_at || e.starts_at);
    for (; d <= last; d.setDate(d.getDate() + 1)) days.add(dayKey(d));
  }
  for (const e of myAcad().filter((x) => x.type === "공휴일" || x.type === "휴업일" || x.name.includes("지필평가"))) {
    for (const d = parseDay(e.start); dayKey(d) <= e.end; d.setDate(d.getDate() + 1)) days.add(dayKey(d));
  }
  return days;
}

// 귀가일 날짜들 (학사일정 + 관리자가 추가한 학교 일정)
function homeDays() {
  const days = new Set(myAcad().filter((e) => e.name.includes("귀가")).map((e) => e.start));
  for (const e of liveSchool()) if (e.title.includes("귀가")) days.add(dayKey(new Date(e.starts_at)));
  return days;
}

// 보이는 범위의 평일마다 수업을 흐린 배경 블록으로 깝니다. 월 보기에는 깔지 않습니다.
// R&E 는 목요일 수업이라, 귀가일이 목요일이면 그날은 깔지 않습니다.
function ttEvents(from, to) {
  if (!me.student_id || !showTT || to - from > 8 * 86400000) return [];
  const blocks = myBlocks(), off = noClassDays(), homes = homeDays(), out = [];
  for (const d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d);
    if (off.has(key)) continue;
    (blocks[d.getDay()] || []).filter((b) => !(b.subject === "R&E" && homes.has(key))).forEach((b, i) => {
      out.push(ttBlock(`tt:${key}:${i}`, b, periodTime(key, b.from, 0), periodTime(key, b.to, 1)));
    });
  }
  return out;
}

function periodTime(key, period, end) {
  const [h, m] = PERIOD_TIME[period][end].split(":");
  const d = parseDay(key); d.setHours(+h, +m);
  return d;
}
const periodLabel = (b) => (b.from === b.to ? `${b.from}교시` : `${b.from}–${b.to}교시`);

function ttBlock(id, block, start, end) {
  return {
    id, title: block.subject, display: "background", classNames: ["fcx-tt"], start, end,
    extendedProps: { kind: "tt", label: `${block.ban} · ${periodLabel(block)}` },
  };
}

// ---------- 피드백 ----------
// 로그인한 사용자가 보내고 관리자가 읽습니다. 스크린샷은 비공개 버킷 feedback 에 저장합니다.
const FEEDBACK_ON = false;   // 첫 배포 다음 날 true 로 바꾸고 updates.js 에 안내를 추가합니다
const FEEDBACK_KINDS = { bug: "오류 제보", notice: "전체 분반 공지 오류", idea: "기능 제안", etc: "기타" };
const FEEDBACK_HINT = {
  bug: "어떤 화면에서 무엇을 했을 때 문제가 생겼는지 적어 주세요",
  notice: "어떤 과목의 전체 분반 공지가 잘못됐는지 적어 주세요",
  idea: "있으면 좋겠는 기능을 적어 주세요",
  etc: "하고 싶은 말을 적어 주세요",
};

// 사진은 긴 변 1600px JPEG 로 줄여서 올립니다 (용량 제한 5MB)
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const r = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("empty"))), "image/jpeg", 0.85));
}

function openFeedback() {
  openSheet("피드백", `
    <label class="study-label">유형</label>
    <select class="study-input" id="fbKind">${Object.entries(FEEDBACK_KINDS).map(([k, label]) =>
      `<option value="${k}">${label}</option>`).join("")}</select>
    <label class="study-label">내용</label>
    <textarea class="study-input" id="fbBody" rows="6" maxlength="2000" placeholder="${FEEDBACK_HINT.bug}"></textarea>
    <label class="study-label">스크린샷 (선택)</label>
    <input class="study-input" type="file" id="fbFile" accept="image/*">
    <div class="study-foot">보낸 내용은 관리자만 볼 수 있어요.</div>
    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="fbSend">보내기</button>`);
  $("fbKind").onchange = () => { $("fbBody").placeholder = FEEDBACK_HINT[$("fbKind").value]; };
  $("fbSend").onclick = async () => {
    const body = $("fbBody").value.trim(), file = $("fbFile").files[0];
    if (!body) return showErr("내용을 입력해 주세요.");
    $("fbSend").disabled = true;
    const fail = (msg) => { $("fbSend").disabled = false; showErr(msg); };
    let image_path = null;
    if (file) {
      let blob;
      try { blob = await shrinkImage(file); }
      catch { return fail("이 사진은 읽지 못했어요. 다른 사진을 골라 주세요."); }
      image_path = `${me.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from("feedback").upload(image_path, blob, { contentType: "image/jpeg" });
      if (error) return fail("사진을 올리지 못했어요. 사진을 빼고 보내 보세요.");
    }
    const { error } = await sb.from("feedback").insert({ kind: $("fbKind").value, body, image_path });
    if (error) return fail("보내지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    closeModal();
    toast("피드백을 보냈어요. 고마워요!");
  };
}

// 관리자: 받은 피드백 (최근 100건)
async function openFeedbackList() {
  openSheet("받은 피드백", `<div class="study-empty">불러오는 중…</div>`);
  const { data, error } = await sb.from("feedback").select("*").order("created_at", { ascending: false }).limit(100);
  const box = $("studyModal").querySelector(".study-sheet");
  if (error) { box.querySelector(".study-empty").textContent = "불러오지 못했어요."; return; }
  const paths = data.map((f) => f.image_path).filter(Boolean);
  const signed = paths.length ? (await sb.storage.from("feedback").createSignedUrls(paths, 3600)).data || [] : [];
  const urlOf = new Map(signed.map((x) => [x.path, x.signedUrl]));
  const { data: who } = await sb.from("profiles").select("id, name, student_id").in("id", [...new Set(data.map((f) => f.user_id))]);
  const nameOf = new Map((who || []).map((p) => [p.id, p.student_id ? `${p.student_id} ${p.name}` : p.name]));
  box.querySelector(".study-empty").outerHTML = data.length ? data.map((f) => `<div class="fb-item">
      <div class="ev-meta">${FEEDBACK_KINDS[f.kind]} · ${esc(nameOf.get(f.user_id) || "알 수 없음")} · ${esc(dayTitle(dayKey(new Date(f.created_at))))} ${hm(new Date(f.created_at))}</div>
      <div class="fb-body">${esc(f.body)}</div>
      ${urlOf.get(f.image_path) ? `<a href="${esc(urlOf.get(f.image_path))}" target="_blank" rel="noopener"><img class="fb-img" src="${esc(urlOf.get(f.image_path))}" alt="첨부한 스크린샷"></a>` : ""}
      <button class="study-btn small no" data-fbdel="${f.id}">삭제</button>
    </div>`).join("") : `<div class="study-empty">아직 받은 피드백이 없어요.</div>`;
  box.querySelectorAll("[data-fbdel]").forEach((x) => x.onclick = async () => {
    const f = data.find((r) => r.id === x.dataset.fbdel);
    if (!confirm("이 피드백을 삭제할까요?")) return;
    const { error } = await sb.from("feedback").delete().eq("id", f.id);
    if (error) return toast("삭제하지 못했어요", true);
    if (f.image_path) await sb.storage.from("feedback").remove([f.image_path]);
    toast("삭제했어요");
    openFeedbackList();
  });
}

// ---------- 학사일정 (NEIS) ----------
// 학교 홈페이지의 학사일정을 scripts/fetch-academic.mjs 가 매일 academic.json 으로 받아 둡니다.
// 종류별로 켜고 끄고, 고른 값은 이 기기에 기억합니다.
// 관리자가 만든 학교 일정(school_events)도 같은 종류·같은 모양으로 보여 줍니다.
// academic.json 은 매일 덮어써지므로, 관리자가 고친 NEIS 일정은 school_events 에 neis_key 로 저장해 원본 대신 보여 줍니다.
const ACAD_CATS = [
  ["home", "귀가일", "귀가일"],
  ["exam", "시험", "1·2차 지필평가"],
  ["break", "방학·개학", "방학식 · 개학식 · 방학 기간"],
  ["holiday", "공휴일·휴업일", "공휴일 · 재량휴업일"],
  ["club", "동아리·꿈지락", "학술동아리 · 문화예술동아리 · 꿈지락"],
  ["event", "학교 행사", "입학식 · 졸업식 · 체육대회 · 여명제 등"],
];
let acadList = null;   // academic.json 의 일정 (처음 달력을 열 때 한 번 받습니다)
let acadLoading = false;
let acadOn = (() => {
  try { const v = JSON.parse(localStorage.getItem("dshs-cal-acad")); if (Array.isArray(v)) return new Set(v); } catch {}
  return new Set(ACAD_CATS.map(([k]) => k));
})();

// 설정의 '학교 일정 보이기' (기본 켜짐). 끄면 종류별 선택과 상관없이 학교 일정을 모두 숨깁니다.
let showSchool = (() => { try { return localStorage.getItem("dshs-cal-school") !== "off"; } catch { return true; } })();
const acadShown = (cat) => showSchool && acadOn.has(cat);

const catLabel = (k) => ACAD_CATS.find(([c]) => c === k)?.[1] || "";

function acadCat(e) {
  if (/귀가|귀사/.test(e.name)) return "home";
  if (/지필|고사|시험/.test(e.name)) return "exam";
  if (/방학|개학|종업/.test(e.name)) return "break";
  if (e.type === "공휴일" || e.type === "휴업일") return "holiday";
  if (/동아리|꿈지락/.test(e.name)) return "club";
  return "event";
}

async function loadAcademic() {
  if (acadList || acadLoading) return;
  acadLoading = true;
  try {
    const res = await fetch("academic.json");
    acadList = (await res.json()).events.map((e, i) => ({
      ...e, id: String(i), cat: acadCat(e),
      key: `${e.start}|${e.name}|${e.grades.join("")}`,   // 고친 내용을 잇는 값. 줄 번호는 매일 바뀔 수 있어서 내용으로 만듭니다
    }));
  } catch { return; } finally { acadLoading = false; }   // 못 받으면 학사일정 없이 달력만 보여 줍니다
  refreshAcad();
}
// 달력은 일정만 새로 받고, 목록은 다시 그립니다
function refreshAcad() {
  if (tab === "list") { if (calOpen()) rerender(); } else fc?.refetchEvents();
}

// 내 학년 일정만 (학번 2113 → 2학년, 관리자는 전부). 토요휴업일은 매주라 뺍니다.
const myGrade = () => (me.student_id ? Math.floor(me.student_id / 1000) : 0);
function myAcad() {
  const g = myGrade();
  const replaced = new Set(cache.school.map((x) => x.neis_key).filter(Boolean));   // 관리자가 고치거나 숨긴 일정은 뺍니다
  return (acadList || []).filter((e) => e.name !== "토요휴업일" && (!g || e.grades.includes(g)) && !replaced.has(e.key));
}
// 학교 일정 중 숨기지 않았고 내 학년에 해당하는 것 (NEIS 를 고친 일정은 원본의 대상 학년을 따릅니다)
function liveSchool() {
  const g = String(myGrade());
  return cache.school.filter((e) => !e.hidden && (!e.neis_key || g === "0" || e.neis_key.split("|").pop().includes(g)));
}

function acadEvents(from, to) {
  const lo = dayKey(from), hi = dayKey(to);
  return myAcad().filter((e) => acadShown(e.cat) && e.end >= lo && e.start < hi).map((e) => {
    const after = parseDay(e.end); after.setDate(after.getDate() + 1);   // FullCalendar 종일 일정의 끝은 다음 날(미포함)
    return {
      id: `acad:${e.id}`, title: e.name, start: e.start, end: dayKey(after), allDay: true, editable: !!me.is_admin,
      classNames: ["c-school"], extendedProps: { kind: "acad" },
    };
  });
}

// 목록 보기: 앞으로 두 달 안의 학사일정 (2년 치가 있어서 전부 넣으면 내 일정이 묻힙니다)
function acadAgenda() {
  const today = dayKey(new Date()), until = new Date(); until.setDate(until.getDate() + 60);
  return myAcad().filter((e) => acadShown(e.cat) && e.end >= today && e.start <= dayKey(until)).map((e) => ({
    kind: "acad", id: e.id, title: e.name, at: parseDay(e.start), allDay: true, done: false, color: "school",
    end: e.end > e.start ? new Date(`${e.end}T23:59`) : null,
  }));
}

// 관리자가 NEIS 일정을 처음 고칠 때 쓰는 초안 (학교 일정 폼이 그대로 받습니다). 저장하기 전에는 DB 에 없습니다.
function neisDraft(a) {
  return {
    id: null, title: a.name, memo: a.memo || "", all_day: true, notify: false, audience: "all", hidden: false,
    starts_at: parseDay(a.start).toISOString(), ends_at: a.end > a.start ? new Date(`${a.end}T23:59`).toISOString() : null,
    no_class: a.type === "공휴일" || a.type === "휴업일" || a.name.includes("지필평가"),
    category: a.cat, neis_key: a.key, school_event_targets: [],
  };
}

function openAcadDetail(e) {
  const when = e.start === e.end ? `${dayTitle(e.start)} · 하루 종일` : `${dayTitle(e.start)} – ${dayTitle(e.end)}`;
  const label = catLabel(e.cat);
  openSheet("학교 일정", `
    <div class="shared-card c-school">
      <div class="ev-title">${esc(e.name)}</div>
      <div class="ev-meta">${esc(when)} · ${label}${e.grades.length < 3 ? ` · ${e.grades.join("·")}학년` : ""}</div>
      ${e.memo ? `<div class="asg-body">${esc(e.memo)}</div>` : ""}
    </div>
    <div class="study-foot">${e.from ? `${esc(e.from)}로 추가한 일정이에요.` : "학교 홈페이지 학사일정(NEIS)에서 가져온 일정이에요."}</div>`);
}

// 설정의 달력 항목: 학교 일정(전체 · 종류 6가지)과 학교 시간표
function calSettingsHtml() {
  const g = myGrade();
  return `
    <label class="set-row"><span><b>학교 일정 보이기</b><span class="ev-hint">학교 홈페이지 학사일정(NEIS)을 하루 한 번 받아 와요.${g ? ` ${g}학년 일정만 보여요.` : ""}</span></span>
      <input type="checkbox" id="setSchool"${showSchool ? " checked" : ""}></label>
    <div class="set-sub" id="acadOpts">${ACAD_CATS.map(([k, label, hint]) =>
      `<label class="set-row"><span><b>${label}</b><span class="ev-hint">${hint}</span></span>
        <input type="checkbox" data-acad="${k}"${acadOn.has(k) ? " checked" : ""}${showSchool ? "" : " disabled"}></label>`).join("")}</div>
    ${me.student_id ? `<label class="set-row"><span><b>학교 시간표 보이기</b><span class="ev-hint">내 일정 달력의 3일 · 주 보기에 내 수업을 깔아 줘요</span></span>
      <input type="checkbox" id="setTT"${showTT ? " checked" : ""}></label>` : ""}`;
}
function bindCalSettings() {
  $("setSchool").onchange = () => {
    showSchool = $("setSchool").checked;
    try { localStorage.setItem("dshs-cal-school", showSchool ? "on" : "off"); } catch {}
    $("acadOpts").querySelectorAll("input").forEach((c) => c.disabled = !showSchool);
    refreshAcad();
  };
  $("acadOpts").querySelectorAll("[data-acad]").forEach((c) => c.onchange = () => {
    c.checked ? acadOn.add(c.dataset.acad) : acadOn.delete(c.dataset.acad);
    try { localStorage.setItem("dshs-cal-acad", JSON.stringify([...acadOn])); } catch {}
    refreshAcad();
  });
  if ($("setTT")) $("setTT").onchange = () => {
    showTT = $("setTT").checked;
    try { localStorage.setItem("dshs-cal-tt", showTT ? "on" : "off"); } catch {}
    fc?.refetchEvents();
  };
}

// ---------- dshs.app 신청 내역 ----------
// dshs.app 계정을 연결하면 내 신청(외출 · 특별실 등)을 달력에 읽기 전용으로 보여 줍니다.
// 토큰은 Edge Function(dshs-oauth)만 갖고, 여기서는 신청 목록만 받습니다. 신청 · 변경은 dshs.app 에서 합니다.
const DSHS_FN = `${CFG.SUPABASE_URL}/functions/v1/dshs-oauth`;
const DSHS_STATUS = { pending: "승인 대기", approved: "승인", rejected: "반려" };
const DSHS_RETURNED = {
  linked: "dshs.app 계정을 연결했어요. 신청 내역이 달력에 보여요",
  login: "dshs.app 계정으로 로그인했어요",
  joined: "dshs.app 계정으로 가입했어요. 반가워요",
  denied: "dshs.app 로그인을 취소했어요",
  mismatch: "dshs.app 계정의 학번이 이 계정과 달라서 연결하지 않았어요",
  notstudent: "42기 학생 명단에 있는 dshs.app 계정만 로그인할 수 있어요",
  expired: "시간이 지났어요. 다시 시도해 주세요",
};
const dshsEmpty = () => ({ linked: null, name: null, items: [], at: 0 });   // linked: null = 아직 모름
let dshs = dshsEmpty();

async function dshsCall(action, extra) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(DSHS_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || CFG.SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ action, ...extra }),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

// 내 일정이 화면에 보이는 동안 1분에 한 번 새로 받습니다.
// 요청 제한(60초 120회)이 사이트 전체 합산이라, 한도를 넘었다는 응답이 오면 5분 쉽니다.
const DSHS_GAP = 55000;   // 1분 타이머가 조금 일찍 울려도 건너뛰지 않도록 1분보다 살짝 짧게
const DSHS_REST = 5 * 60000;
const calOpen = () => $("studyView").style.display === "block" && view === "feed";

async function loadDshs() {
  if (Date.now() - dshs.at < DSHS_GAP) return;
  dshs.at = Date.now();
  const before = JSON.stringify([dshs.linked, dshs.items]);
  try {
    const { body } = await dshsCall("requests");
    if (typeof body.linked !== "boolean") throw new Error();
    if (body.expired && dshs.linked) toast("dshs.app 연결이 만료됐어요. 다시 연결해 주세요", true);
    dshs.linked = body.linked;
    dshs.name = body.name || null;
    if (!body.linked) dshs.items = [];
    else if (body.items) dshs.items = body.items;   // 잠깐 못 받으면 지난번 목록을 그대로 둡니다
    if (body.error === "busy") dshs.at = Date.now() + DSHS_REST - DSHS_GAP;
  } catch { dshs.at = 0; return; }   // 못 받으면 신청 내역 없이 달력만 보여 줍니다
  if (JSON.stringify([dshs.linked, dshs.items]) === before) return;   // 바뀐 게 없으면 보던 화면을 건드리지 않습니다
  paintDshs();
  if (calOpen()) rerender();
}

// 연결한 학생만 받습니다. 앱으로 돌아오면 바로, 켜 둔 동안에는 1분마다.
function watchDshs() {
  const tick = () => { if (me && dshs.linked && !document.hidden && calOpen()) loadDshs(); };
  setInterval(tick, 60000);
  document.addEventListener("visibilitychange", tick);
}

const dshsItems = () => (dshs.linked ? dshs.items.filter((r) => r.status !== "rejected") : []);

// 아직 연결하지 않은 학생에게만 내 일정 위에 안내를 띄웁니다. 닫으면 이 기기에서는 다시 뜨지 않고, 계정에서 연결할 수 있어요.
const DSHS_HINT_KEY = "dshs-link-hint-off";
function dshsHintOff() {
  try { return localStorage.getItem(DSHS_HINT_KEY) === "1"; } catch { return false; }
}
function paintDshs() {
  const box = $("dshsHint");
  if (!box) return;
  if (dshs.linked !== false || !me?.student_id || dshsHintOff()) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="dshs-hint">
    <span>dshs.app을 연결하면 내 신청이 달력에 자동으로 보여요</span>
    <button class="study-btn small ok" id="dshsHintGo">연결</button>
    <button class="study-x" id="dshsHintX" aria-label="닫기">✕</button>
  </div>`;
  $("dshsHintGo").onclick = openSettings;
  $("dshsHintX").onclick = () => {
    try { localStorage.setItem(DSHS_HINT_KEY, "1"); } catch {}
    box.innerHTML = "";
  };
}

// 날짜만 정한 신청은 시작 = 끝 → 그날 종일 일정
const dshsAllDay = (r) => r.from === r.to;
function dshsAgenda() {
  const now = new Date();
  return dshsItems().map((r) => {
    const at = new Date(r.from), allDay = dshsAllDay(r), end = allDay ? null : new Date(r.to);
    return {
      kind: "dshs", id: r.uid, title: r.title, at, end, allDay, color: "dshs", status: r.status,
      done: eventEnd({ starts_at: r.from, ends_at: end && r.to, all_day: allDay }) < now,
      tag: [DSHS_STATUS[r.status], r.room].filter(Boolean).join(" · "),
    };
  });
}

function openDshsDetail(r) {
  if (!r) return;
  const when = schoolWhen({ starts_at: r.from, ends_at: dshsAllDay(r) ? null : r.to, all_day: dshsAllDay(r) });
  const info = [r.form !== r.title && r.form, r.category, r.room, r.count > 1 && `${r.count}명 참여`].filter(Boolean);
  openSheet("dshs.app 신청", `
    <div class="shared-card c-dshs">
      <div class="ev-title">${esc(r.title)}</div>
      <div class="ev-meta">${esc(when)} · ${DSHS_STATUS[r.status] || ""}</div>
      ${info.length ? `<div class="asg-body">${info.map(esc).join("<br>")}</div>` : ""}
    </div>
    <div class="study-foot">dshs.app 에서 가져온 신청이에요. 바꾸거나 취소하려면 dshs.app 에서 해 주세요.</div>
    <a class="study-btn wide" href="https://dshs.app" target="_blank" rel="noopener">dshs.app 열기</a>`);
}

// 화면 테마 (index.html 의 applyTheme 이 실제로 바꿉니다)
const THEMES = [["system", "시스템"], ["dark", "다크"], ["light", "라이트"]];
const THEME_KEY = "dshs-theme";
const curTheme = () => { try { return localStorage.getItem(THEME_KEY) || "dark"; } catch { return "dark"; } };
function themeHtml() {
  return `<div class="set-row"><span><b>화면 테마</b><span class="ev-hint">시스템: 기기 설정(다크 · 라이트)을 따라가요</span></span>
    <div class="theme-seg">${THEMES.map(([k, label]) =>
      `<button type="button" data-theme-pick="${k}"${curTheme() === k ? ' class="on"' : ""}>${label}</button>`).join("")}</div></div>`;
}
function bindTheme() {
  $("studyModal").querySelectorAll("[data-theme-pick]").forEach((b) => b.onclick = () => {
    try { localStorage.setItem(THEME_KEY, b.dataset.themePick); } catch {}
    window.applyTheme?.();
    $("studyModal").querySelectorAll("[data-theme-pick]").forEach((x) => x.classList.toggle("on", x === b));
  });
}

// 설정: 알림 · 학교 일정 보이기 · 화면 테마 · 계정(로그아웃과 dshs.app 연결 관리)
function openSettings() {
  if (!me) {   // 로그인 전: 화면 테마와 로그인 안내 (제목 7번 → 관리자 로그인)
    openSheet("설정", `
      ${themeHtml()}
      <div class="asg-body" style="margin-top:14px">로그인하면 알림 · 내 일정 달력 설정과 계정을 여기서 관리할 수 있어요.</div>
      <button class="study-submit dshs-login" id="doDshsLogin">dshs.app으로 로그인</button>
      <div class="study-err" id="authErr"></div>`);
    $("doDshsLogin").onclick = loginWithDshs;
    bindTheme();
    return bindAdminTap();
  }
  const link = dshs.linked
    ? `<div class="asg-body">dshs.app ${dshs.name ? `${esc(dshs.name)} 계정과 ` : ""}연결돼 있어요. 진행 중인 내 신청 ${dshsItems().length}건이 달력에 보여요.</div>
       <div class="study-foot">내 일정을 보는 동안 1분마다 새로 받아 와요. 연결을 해제하면 이 사이트에 저장된 dshs.app 로그인 정보가 지워져요.</div>
       <button class="study-btn wide" id="dshsUnlink">dshs.app 연결 해제</button>`
    : `<div class="asg-body">dshs.app 계정을 연결하면 내가 낸 신청이 내 일정 달력에 자동으로 보여요.</div>
       <div class="study-foot">dshs.app 로그인 화면에서 로그인하고 동의하면 돼요. 비밀번호는 이 사이트에 전달되지 않아요.<br>
         신청 내역은 보기만 할 수 있고, 신청 · 변경은 dshs.app 에서 해요.</div>
       <button class="study-submit" id="doDshs">dshs.app으로 로그인해서 연결</button>`;
  openSheet("설정", `
    <label class="set-row"><span><b>알림</b><span class="ev-hint" id="pushHint">${PUSH_HINT}</span></span>
      <input type="checkbox" id="setPush"></label>
    ${themeHtml()}
    <div class="set-sec">내 일정 달력</div>
    ${calSettingsHtml()}
    <div class="set-sec">계정</div>
    <div class="ev-title">${esc(me.name)}</div>
    <div class="ev-meta">${esc(me.username)}</div>
    ${link}
    <button class="study-btn wide" id="doLogout">로그아웃</button>`);
  $("setPush").onchange = togglePush;
  paintPush(); refreshPush();
  bindCalSettings();
  if ($("doDshs")) $("doDshs").onclick = startDshs;
  if ($("dshsUnlink")) $("dshsUnlink").onclick = unlinkDshs;
  $("doLogout").onclick = () => { closeModal(); logout(); };
  bindTheme();
  bindAdminTap();
}

async function startDshs() {
  $("doDshs").disabled = true;
  try {
    const handoff = newHandoff();
    const { body } = await dshsCall("start", { return_to: location.origin + location.pathname, handoff });
    if (body.url) { openDshsLogin(body.url, handoff); return; }
    toast(body.error || "dshs.app 연결을 시작하지 못했어요", true);
  } catch { toast("dshs.app 연결을 시작하지 못했어요", true); }
  if ($("doDshs")) $("doDshs").disabled = false;
}

async function unlinkDshs() {
  if (!confirm("dshs.app 연결을 해제할까요? 달력에서 신청 내역이 사라져요.")) return;
  try {
    const { ok } = await dshsCall("unlink");
    if (!ok) throw new Error();
  } catch { return toast("연결을 해제하지 못했어요", true); }
  dshs = { ...dshsEmpty(), linked: false, at: Date.now() };
  closeModal(); paintDshs();
  if (calOpen()) rerender();
  toast("dshs.app 연결을 해제했어요");
}

// 'dshs.app으로 로그인' (로그인 전 화면). 돌아오면 init 이 주소의 일회용 토큰으로 세션을 만듭니다.
async function loginWithDshs() {
  $("doDshsLogin").disabled = true;
  try {
    const handoff = newHandoff();
    const { body } = await dshsCall("login", { return_to: location.origin + location.pathname, handoff });
    if (body.url) {
      openDshsLogin(body.url, handoff);
      if (handoff) $("doDshsLogin").disabled = false;   // 로그인 창을 그냥 닫았으면 다시 누를 수 있게 둡니다
      return;
    }
  } catch {}
  showErr("dshs.app 로그인을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  $("doDshsLogin").disabled = false;
}

// ---------- 앱(홈 화면에 추가)에서 dshs.app 로그인 ----------
// 앱에서는 dshs.app 로그인 화면이 다른 브라우저 창(팝업)에서 열려, 그 창으로 돌아온 로그인은 앱에 남지 않습니다.
// 그래서 앱만 아는 임의 값(handoff)을 함께 보내고, 로그인 창에는 "앱으로 돌아가세요"만 띄운 뒤
// 앱이 Edge Function 에서 결과(일회용 로그인 토큰)를 받아 앱에서 로그인하고, 로그인 창은 닫습니다.
// 이 값은 앱 창의 메모리에만 두어 팝업은 모릅니다. 새 창을 못 열어 이 창에서 로그인 화면으로 갈 때만
// sessionStorage 에 남겨, 돌아온 뒤 이어서 받습니다 (새 창은 열 때 sessionStorage 를 복사해 가므로 그 전에는 쓰지 않음).
const DSHS_HAND_KEY = "dshs-handoff";
const DSHS_HAND_TTL = 10 * 60000;   // 서버의 로그인 요청 유효 시간과 같음
const isInstalledApp = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function newHandoff() {
  if (!isInstalledApp()) return undefined;
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/[+/=]/g, "");
  waitHandoff.h = { key, at: Date.now() };
  try { sessionStorage.removeItem(DSHS_HAND_KEY); } catch {}
  return key;
}

// 앱: 로그인 화면을 새 창으로 열어 두었다가, 로그인이 끝나면 앱이 그 창을 닫습니다.
function openDshsLogin(url, handoff) {
  if (!handoff) { location.href = url; return; }
  const w = window.open(url, "_blank");
  if (w) waitHandoff.win = w;
  else {
    try { sessionStorage.setItem(DSHS_HAND_KEY, JSON.stringify(waitHandoff.h)); } catch {}
    location.href = url;
  }
  waitHandoff();
}

// 앱이 연 로그인 창으로 돌아온 경우 (?dshs=app 이고 이 창은 handoff 를 모름) → 창을 닫습니다.
// 닫을 수 없는 브라우저면 "앱으로 돌아가세요" 안내가 남습니다.
const dshsPopupLanding = () => new URLSearchParams(location.search).get("dshs") === "app" && !pendingHandoff();
function closeDshsPopup() {
  try { window.opener?.postMessage("dshs-handoff", location.origin); } catch {}   // 앱이 기다리지 않고 바로 받아 가게
  try { window.close(); } catch {}
}
function pendingHandoff() {
  let h = waitHandoff.h;
  try { h = JSON.parse(sessionStorage.getItem(DSHS_HAND_KEY)) || h; } catch {}
  return h && Date.now() - h.at < DSHS_HAND_TTL ? h.key : null;
}
function clearHandoff() {
  try { sessionStorage.removeItem(DSHS_HAND_KEY); } catch {}
  waitHandoff.h = null;
}

// 로그인 창에서 돌아오면 바로, 앱이 보이는 동안에는 3초마다 결과를 확인합니다.
function waitHandoff() {
  if (waitHandoff.on) return;
  waitHandoff.on = true;
  // 로그인 창이 앞에 있어 앱이 가려져 있어도, 로그인 창이 끝났다고 알려 오면(now) 바로 받아 갑니다
  const tick = async (now) => {
    const key = pendingHandoff();
    if (!key) return stop();
    if ((document.hidden && now !== true) || tick.busy) return;
    tick.busy = true;
    try {
      const { ok, body } = await dshsCall("poll", { handoff: key });
      if (ok && !body.pending && key === pendingHandoff()) { stop(); await handoffArrived(body); }
    } catch {}
    tick.busy = false;
  };
  const t = setInterval(tick, 3000);
  const onMsg = (e) => { if (e.origin === location.origin && e.data === "dshs-handoff") tick(true); };
  function stop() {
    clearInterval(t);
    document.removeEventListener("visibilitychange", tick);
    window.removeEventListener("message", onMsg);
    waitHandoff.on = false;
  }
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("message", onMsg);
  tick();
}

async function handoffArrived(r) {
  clearHandoff();
  try { waitHandoff.win?.close(); } catch {}
  waitHandoff.win = null;
  let ok = ["linked", "login", "joined"].includes(r.result);
  if (ok && r.token) {
    const { error } = await sb.auth.verifyOtp({ token_hash: r.token, type: "magiclink" });
    if (!error) await loadProfile();
    ok = !error && !!me;
  }
  if (!ok) return toast(DSHS_RETURNED[r.reason] || "dshs.app 로그인에 실패했어요", true);
  closeModal();
  if (r.result === "linked") {
    dshs.at = 0;
    loadDshs();
  } else {
    renderNav(); openHome();
  }
  toast(DSHS_RETURNED[r.result]);
}

// dshs.app 로그인에서 돌아오며 받은 일회용 토큰(#dshs_login=…) → 이 사이트 세션. 토큰은 주소에서 바로 지웁니다.
async function dshsSession() {
  const token = new URLSearchParams(location.hash.slice(1)).get("dshs_login");
  if (!token) return;
  history.replaceState(null, "", location.pathname + location.search);
  const { error } = await sb.auth.verifyOtp({ token_hash: token, type: "magiclink" });
  if (error) dshsSession.failed = true;
}

// dshs.app 로그인에서 돌아왔을 때 (?dshs=linked | login | joined | error&reason=…) 결과를 알리고 주소를 정리합니다
function dshsReturned() {
  const q = new URLSearchParams(location.search), r = q.get("dshs");
  if (pendingHandoff()) waitHandoff();   // 앱 창 안에서 로그인 화면으로 갔다 온 경우 (컴퓨터에 설치한 앱 등)
  if (!r) return;
  if (r === "app") {
    // 앱에서 연 로그인 창(팝업)으로 돌아온 경우. 로그인은 앱이 이어서 합니다.
    if (!pendingHandoff()) {   // init 에서 창을 닫지 못한 경우의 안내
      openSheet("dshs.app 로그인", `
        <div class="ev-title">dshs.app 로그인을 마쳤어요</div>
        <div class="asg-body">이 창을 닫고 앱으로 돌아가 주세요. 앱에서 자동으로 이어져요.</div>`);
    }
  } else {
    const ok = ["linked", "login", "joined"].includes(r) && !dshsSession.failed && !!me;
    toast(ok ? DSHS_RETURNED[r] : DSHS_RETURNED[q.get("reason")] || "dshs.app 로그인에 실패했어요", !ok);
  }
  q.delete("dshs"); q.delete("reason");
  const rest = q.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : ""));
}

// 학교 일정 대상 (학번 목록)
const schoolTargets = (e) => (e.school_event_targets || []).map((t) => t.student_id);

// 전체 학생 명단 (시간표 데이터에서)
function roster() {
  return Object.entries(window.SCHOOL_DATA || {})
    .map(([name, v]) => ({ sid: v.id, name, classes: v.classes || {} }))
    .sort((a, b) => a.sid - b.sid);
}
const homeroom = (sid) => Math.floor(sid / 100) % 10;   // 2113 → 1반

function schoolWhen(e) {
  const s = new Date(e.starts_at), en = e.ends_at ? new Date(e.ends_at) : null;
  if (e.all_day) return en && dayKey(en) !== dayKey(s) ? `${dayTitle(dayKey(s))} – ${dayTitle(dayKey(en))}` : `${dayTitle(dayKey(s))} · 하루 종일`;
  return `${dayTitle(dayKey(s))} ${hm(s)}${en ? ` – ${dayKey(en) !== dayKey(s) ? md(en) + " " : ""}${hm(en)}` : ""}`;
}

function openSchoolDetail(e) {
  openSheet("학교 일정", `
    <div class="shared-card c-school">
      <div class="ev-title">${esc(e.title)}</div>
      <div class="ev-meta">${esc(schoolWhen(e))} · ${catLabel(e.category)}${e.no_class ? " · 수업 없음" : ""}</div>
      ${e.memo ? `<div class="asg-body">${esc(e.memo)}</div>` : ""}
    </div>
    <div class="study-foot">${e.neis_key ? "학교 홈페이지 학사일정을 관리자가 고친 일정이에요." : "관리자가 올린 일정이에요."}</div>`);
}

// 관리자: 학교 일정 추가·수정 (대상: 전체 / 특정 인원)
// e.neis_key 가 있으면 NEIS 일정을 고치는 중입니다. e.id 가 없으면 아직 고친 적이 없는 원본입니다 (neisDraft).
function openSchoolForm(e, seed) {
  const neis = !!e?.neis_key;
  const now = new Date();
  const start = e ? new Date(e.starts_at) : seed?.start || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9);
  const allDay = e ? e.all_day : seed ? seed.allDay : true;
  const end = e?.ends_at ? new Date(e.ends_at) : allDay ? start : new Date(+start + HOUR);
  const people = roster();
  const nameOf = new Map(people.map((p) => [p.sid, p.name]));
  const before = e ? schoolTargets(e) : [];
  let picked = new Set(before);
  let audience = e?.audience || "all";
  const subjects = [...new Set(people.flatMap((p) => Object.keys(p.classes)))].sort((a, b) => a.localeCompare(b, "ko"));
  const rooms = [...new Set(people.map((p) => homeroom(p.sid)))].sort();

  openSheet(e ? "학교 일정 수정" : "학교 일정 추가", `
    ${neis ? `<div class="study-foot">학교 홈페이지(NEIS)에서 온 일정이에요. 여기서 고치면 이 사이트에서만 바뀌고, 원본은 그대로예요.</div>` : ""}
    <label class="study-label">제목</label>
    <input class="study-input" id="sTitle" maxlength="120" value="${esc(e?.title || "")}" placeholder="예: 체육대회, 2학기 기말고사, 개교기념일">
    <label class="study-label">종류</label>
    <select class="study-input" id="sCat">${ACAD_CATS.map(([k, label]) =>
      `<option value="${k}"${k === (e?.category || "event") ? " selected" : ""}>${label}</option>`).join("")}</select>
    <label class="ev-allday"><input type="checkbox" id="sAll"${allDay ? " checked" : ""}> 하루 종일 <span class="ev-hint">(끄면 시간을 정할 수 있어요)</span></label>
    <label class="study-label">시작</label>
    <div class="ev-when"><input class="study-input" type="date" id="sSd" value="${dayKey(start)}"><input class="study-input" type="time" id="sSt" step="300" value="${allDay ? "09:00" : hm(start)}"></div>
    <label class="study-label">끝</label>
    <div class="ev-when"><input class="study-input" type="date" id="sEd" value="${dayKey(end)}"><input class="study-input" type="time" id="sEt" step="300" value="${allDay ? "10:00" : hm(end)}"></div>
    <label class="ev-allday sch-noclass"><input type="checkbox" id="sNo"${e?.no_class ? " checked" : ""}> 수업 없는 날 <span class="ev-hint">(이 기간엔 달력에 시간표를 깔지 않아요)</span></label>
    <label class="ev-allday"><input type="checkbox" id="sNotify"${e?.notify ? " checked" : ""}> <span style="white-space:nowrap">필수 일정</span> <span class="ev-hint">(30분 전 알림 · 하루 종일은 07:50)</span></label>
    <label class="study-label">메모 (선택)</label>
    <textarea class="study-input" id="sMemo" rows="2" maxlength="2000" placeholder="장소, 준비물 등">${esc(e?.memo || "")}</textarea>

    <div${neis ? ' style="display:none"' : ""}>
    <label class="study-label">누구에게 보일까요</label>
    <div class="seg aud-seg">
      <button type="button" class="seg-btn" data-aud="all">전체</button>
      <button type="button" class="seg-btn" data-aud="some">특정 인원</button>
    </div>
    <div id="audSome">
      <div class="aud-count" id="audCount"></div>
      <div class="fr-chips" id="audChips"></div>
      <div class="aud-quick">
        <span class="aud-label">반</span>
        ${rooms.map((r) => `<button type="button" class="study-btn small" data-room="${r}">${r}반</button>`).join("")}
      </div>
      <div class="aud-quick">
        <span class="aud-label">수강</span>
        <select class="study-input" id="audSubj"><option value="">과목 고르기</option>${subjects.map((x) => `<option>${esc(x)}</option>`).join("")}</select>
        <select class="study-input" id="audBan" disabled><option value="">분반</option></select>
        <button type="button" class="study-btn small" id="audSubjAdd" disabled>추가</button>
      </div>
      <input class="study-input" id="audQ" autocomplete="off" placeholder="이름·학번으로 한 명씩 추가">
      <div class="fr-results" id="audRes"></div>
    </div>
    </div>

    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="sSave">${e ? "저장" : "추가"}</button>
    ${neis && e.id ? '<button class="study-submit ghost" id="sRevert">원래 일정으로 되돌리기</button>' : ""}
    ${e && !e.hidden ? `<button class="study-submit ghost danger" id="sDel">${neis ? "달력에서 숨기기" : "학교 일정 삭제"}</button>` : ""}`);
  const sheet = $("studyModal").querySelector(".study-sheet");
  const at = (d, t) => (d ? new Date(`${d}T${t || "00:00"}`) : null);

  const syncAll = () => {
    sheet.classList.toggle("allday", $("sAll").checked);
    sheet.querySelector(".sch-noclass").style.display = $("sAll").checked ? "" : "none";
  };
  $("sAll").onchange = () => { syncAll(); $("sAll").checked ? $("sEd").value = $("sSd").value : $("sSd").onchange(); };
  $("sSd").onchange = () => {
    if ($("sAll").checked) { if ($("sEd").value < $("sSd").value) $("sEd").value = $("sSd").value; }
    else { const s = at($("sSd").value, $("sSt").value); const en = new Date(+s + HOUR); $("sEd").value = dayKey(en); $("sEt").value = hm(en); }
  };
  $("sSt").onchange = $("sSd").onchange;
  syncAll();

  const drawAud = () => {
    sheet.querySelectorAll("[data-aud]").forEach((b) => b.classList.toggle("on", b.dataset.aud === audience));
    $("audSome").style.display = audience === "some" ? "" : "none";
    const ids = [...picked].sort((a, b) => a - b);
    $("audCount").textContent = ids.length ? `${ids.length}명에게 보여요` : "아직 아무도 고르지 않았어요";
    $("audChips").innerHTML = ids.map((sid) =>
      `<span class="fr-chip">${esc(nameOf.get(sid) || sid)}<small>${sid}</small><button type="button" data-unpick="${sid}" aria-label="빼기">✕</button></span>`).join("") +
      (ids.length > 1 ? `<button type="button" class="aud-clear" id="audClear">모두 빼기</button>` : "");
    $("audChips").querySelectorAll("[data-unpick]").forEach((b) => b.onclick = () => { picked.delete(+b.dataset.unpick); drawAud(); });
    if ($("audClear")) $("audClear").onclick = () => { picked.clear(); drawAud(); };
  };
  sheet.querySelectorAll("[data-aud]").forEach((b) => b.onclick = () => { audience = b.dataset.aud; drawAud(); });
  sheet.querySelectorAll("[data-room]").forEach((b) => b.onclick = () => {
    people.filter((p) => homeroom(p.sid) === +b.dataset.room).forEach((p) => picked.add(p.sid));
    drawAud();
  });
  $("audSubj").onchange = () => {
    const subj = $("audSubj").value;
    const bans = [...new Set(people.map((p) => p.classes[subj]).filter(Boolean))].sort();
    $("audBan").innerHTML = `<option value="*">전체 분반</option>` + bans.map((x) => `<option>${esc(x)}</option>`).join("");
    $("audBan").disabled = $("audSubjAdd").disabled = !subj;
  };
  $("audSubjAdd").onclick = () => {
    const subj = $("audSubj").value, ban = $("audBan").value;
    people.filter((p) => p.classes[subj] && (ban === "*" || p.classes[subj] === ban)).forEach((p) => picked.add(p.sid));
    drawAud();
  };
  $("audQ").oninput = () => {
    const q = $("audQ").value.trim();
    const list = q ? people.filter((p) => !picked.has(p.sid) && (p.name.includes(q) || String(p.sid).startsWith(q))).slice(0, 8) : [];
    $("audRes").innerHTML = !q ? "" : list.length
      ? list.map((p) => `<button type="button" class="fr-item" data-pick="${p.sid}"><b>${esc(p.name)}</b><span>${p.sid}</span></button>`).join("")
      : `<div class="fr-empty">명단에 없어요.</div>`;
    $("audRes").querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => {
      picked.add(+b.dataset.pick); drawAud();
      $("audQ").value = ""; $("audRes").innerHTML = ""; $("audQ").focus();
    });
  };
  drawAud();

  $("sSave").onclick = async () => {
    const title = $("sTitle").value.trim();
    const sd = $("sSd").value, ed = $("sEd").value || sd, all = $("sAll").checked;
    if (!title) return showErr("제목을 입력해 주세요.");
    if (!sd) return showErr("시작 날짜를 정해 주세요.");
    let starts, ends;
    if (all) {
      if (ed < sd) return showErr("끝나는 날이 시작보다 빨라요.");
      starts = at(sd); ends = ed > sd ? at(ed, "23:59") : null;
    } else {
      starts = at(sd, $("sSt").value); ends = at(ed, $("sEt").value);
      if (!ends || ends <= starts) return showErr("끝나는 시간이 시작보다 빨라요.");
    }
    if (audience === "some" && !picked.size) return showErr("보여줄 사람을 한 명 이상 골라 주세요.");
    const row = {
      title, memo: $("sMemo").value.trim(), all_day: all, no_class: all && $("sNo").checked, notify: $("sNotify").checked, audience,
      starts_at: starts.toISOString(), ends_at: ends ? ends.toISOString() : null,
      category: $("sCat").value, neis_key: e?.neis_key || null, hidden: false,
    };
    $("sSave").disabled = true;
    const { data: saved, error } = e?.id
      ? await sb.from("school_events").update(row).eq("id", e.id).select("id").single()
      : await sb.from("school_events").insert(row).select("id").single();
    if (error) { $("sSave").disabled = false; return showErr("저장하지 못했어요: " + error.message); }
    // 대상 맞추기: 전체 공개로 바꾸면 대상 목록은 비웁니다
    const want = audience === "some" ? [...picked] : [];
    const add = want.filter((sid) => !before.includes(sid));
    const drop = before.filter((sid) => !want.includes(sid));
    const results = await Promise.all([
      add.length && sb.from("school_event_targets").insert(add.map((sid) => ({ event_id: saved.id, student_id: sid }))),
      drop.length && sb.from("school_event_targets").delete().eq("event_id", saved.id).in("student_id", drop),
    ]);
    closeModal();
    if (results.some((r) => r && r.error)) toast("일정은 저장했지만 대상 일부를 맞추지 못했어요", true);
    else toast(audience === "all" ? "모두에게 보이는 학교 일정이에요" : `${want.length}명에게 보이는 학교 일정이에요`);
    await loadAssignments();
  };
  // 원본 NEIS 일정은 지울 수 없으니, 숨겼다는 표시를 남겨 달력에서 뺍니다 (관리자 달력에는 흐리게 남아 되돌릴 수 있어요)
  if ($("sRevert")) $("sRevert").onclick = async () => {
    const { error } = await sb.from("school_events").delete().eq("id", e.id);
    if (error) return showErr("되돌리지 못했어요.");
    closeModal();
    toast("학교 홈페이지 일정으로 되돌렸어요");
    await loadAssignments();
  };
  if ($("sDel") && neis) $("sDel").onclick = async () => {
    if (!confirm("이 일정을 모두의 달력에서 숨길까요?")) return;
    const hide = { hidden: true, notify: false, no_class: false };
    const { error } = e.id
      ? await sb.from("school_events").update(hide).eq("id", e.id)
      : await sb.from("school_events").insert({ title: e.title, memo: e.memo, starts_at: e.starts_at, ends_at: e.ends_at,
          all_day: true, audience: "all", category: e.category, neis_key: e.neis_key, ...hide });
    if (error) return showErr("숨기지 못했어요.");
    closeModal();
    toast("숨겼어요. 흐리게 보이는 일정을 눌러 되돌릴 수 있어요");
    await loadAssignments();
  };
  if ($("sDel") && !neis) $("sDel").onclick = async () => {
    if (!confirm("이 학교 일정을 모두의 달력에서 지울까요?")) return;
    const snap = { id: e.id, title: e.title, memo: e.memo, starts_at: e.starts_at, ends_at: e.ends_at,
      all_day: e.all_day, no_class: e.no_class, notify: e.notify, audience: e.audience, category: e.category };
    const targets = before.map((sid) => ({ event_id: e.id, student_id: sid }));
    const { error } = await sb.from("school_events").delete().eq("id", e.id);
    if (error) return showErr("삭제하지 못했어요.");
    closeModal();
    undoToast("학교 일정을 지웠어요", async () => {
      const { error } = await sb.from("school_events").insert(snap);
      if (error) return false;
      if (targets.length) await sb.from("school_event_targets").insert(targets);
      await loadAssignments();
    });
    await loadAssignments();
  };
}

// ---------- 수행평가 공지 탭 ----------
// 분반에 공지된 것 + 내가 올렸지만 아직 승인 안 된(또는 반려된) 것. 내 것은 승인과 상관없이 나에게 보입니다.
const noticeItems = () => [...cache.items, ...(cache.mine || []).filter((a) => a.status !== "approved")].sort(byDue);
// 위: 곧 마감인(3일 안) 아직 안 끝낸 공지. 아래: 과목 블록을 누르면 그 아래에 그 과목 공지.
const URGENT_DAYS = 3;
let openSubj = null;    // 고른 과목 이름

function renderNotice() {
  destroyCal();
  view = "notice";
  const body = $("studyBody");
  const now = new Date();
  const soon = new Date(+now + URGENT_DAYS * 86400000);
  const urgent = noticeItems().filter((a) => {
    const d = dueMs(a);   // 마감 일시가 없으면 Infinity → 급한 공지에 들지 않음
    return d >= +now && d <= +soon && !cache.done.has(a.id);
  });
  const subjects = noticeSubjects(now);
  const picked = subjects.find((sj) => sj.name === openSubj);
  body.innerHTML =
    `<div class="study-section">곧 마감 · ${URGENT_DAYS}일 안에 ${urgent.length}건</div>` +
    (urgent.length ? urgent.map((a) => card(a, { check: true })).join("")
      : `<div class="study-empty">${URGENT_DAYS}일 안에 마감되는 수행평가가 없어요.</div>`) +
    `<div class="study-section">과목별 수행평가</div>` +
    `<div class="subj-grid">${subjects.map(subjBlock).join("")}</div>` +
    `<div id="subjDetail">${picked ? subjDetail(picked) : `<div class="subj-hint">과목을 누르면 그 과목 수행평가가 여기에 보여요</div>`}</div>`;
  body.querySelectorAll("[data-subj]").forEach((b) => b.onclick = () => {
    openSubj = openSubj === b.dataset.subj ? null : b.dataset.subj;
    renderNotice();
    if (openSubj) $("subjDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  body.querySelectorAll("[data-adone]").forEach((b) => b.onclick = () => toggleDone("asg", b.dataset.adone));
  bindRows(body);
}

// 내 과목(관리자는 전체 과목)마다 공지를 묶습니다. 남은 공지가 있는 과목을 마감 가까운 순으로 위에.
function noticeSubjects(now) {
  return asgSubjects().map((name) => {
    const items = noticeItems().filter((a) => a.subject === name);
    const up = items.filter((a) => dueMs(a) >= +now);   // 마감 일시 없는 공지는 끝나지 않은 것으로
    const left = up.filter((a) => !cache.done.has(a.id));
    const bans = [...new Set(myClasses.filter((c) => c.subject === name).map((c) => c.ban))];
    return {
      name, up, left,
      past: items.filter((a) => dueMs(a) < +now).reverse().slice(0, 5),
      ban: me.student_id ? bans.join(", ") : `${bans.length}개 분반`,
    };
  }).sort((x, y) =>
    (!x.left.length - !y.left.length) ||
    (x.left.length ? byDue(x.left[0], y.left[0]) : 0) ||
    x.name.localeCompare(y.name, "ko"));
}

function subjBlock(sj) {
  const next = sj.left[0] ? asgDue(sj.left[0]) : null;
  return `<button class="subj-box${sj.left.length ? " has" : ""}${openSubj === sj.name ? " on" : ""}" data-subj="${esc(sj.name)}" aria-pressed="${openSubj === sj.name}">
    <span class="subj-name">${esc(sj.name)}</span>
    <span class="subj-ban">${esc(sj.ban)}</span>
    <span class="subj-meta">${next
      ? `<span class="due-badge ${next.tone}">${next.label}</span>${sj.left.length}건`
      : sj.up.length ? "모두 완료" : "없음"}</span>
  </button>`;
}

function subjDetail(sj) {
  return `<div class="subj-detail">
    <div class="study-section">${esc(sj.name)} · ${esc(sj.ban)} 수행평가</div>
    ${sj.up.length ? sj.up.map((a) => card(a, { check: true })).join("")
      : `<div class="study-empty">다가오는 수행평가가 없어요.</div>`}
    ${sj.past.length ? `<div class="study-section">지난 수행평가</div>` + sj.past.map((a) => card(a, { check: true })).join("") : ""}
  </div>`;
}

// ---------- 할 일 탭 ----------
// 기한 표시: 날짜만 있으므로 오늘 0시 기준으로 셉니다
function todoDue(key) {
  const t = new Date();
  const days = Math.round((parseDay(key) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
  const label = days < 0 ? "지남" : days === 0 ? "오늘" : days === 1 ? "내일" : `D-${days}`;
  const d = parseDay(key);
  const short = `${d.getMonth() + 1}/${d.getDate()} (${"일월화수목금토"[d.getDay()]})`;
  return { label, tone: days < 0 ? "over" : days < 3 ? "soon" : "ok", text: dayTitle(key), short };
}

function todoRow(t) {
  const due = t.due_on ? todoDue(t.due_on) : null;
  return `<div class="ev-row c-mint todo-row${t.done ? " done" : ""}">
    <button class="ev-check" data-tchk="${t.id}" aria-label="완료 표시">${t.done ? "✓" : ""}</button>
    <button class="ev-main" data-tedit="${t.id}">
      <span class="ev-title">${esc(t.title)}</span>
    </button>
    ${due
      ? `<button class="td-due ${t.done ? "" : due.tone}" data-tdue="${t.id}" title="${esc(due.text)}까지 · 눌러서 바꾸기">${due.short}${t.done ? "" : ` · ${due.label}`}</button>`
      : t.done ? "" : `<button class="td-due empty" data-tdue="${t.id}" title="기한 정하기" aria-label="기한 정하기">기한</button>`}
    <button class="td-del" data-tdel="${t.id}" aria-label="삭제">✕</button>
  </div>`;
}

function renderTodo() {
  destroyCal();
  closeDuePop();
  view = "todo";
  const body = $("studyBody");
  if (!cache.todos) {
    body.innerHTML = `<div class="study-empty">할 일을 불러오지 못했어요.</div>`;
    return;
  }
  // 기한 있는 것 먼저(가까운 순), 기한 없는 건 추가한 순
  const open = cache.todos.filter((t) => !t.done)
    .sort((a, b) => (!a.due_on - !b.due_on) || (a.due_on || "").localeCompare(b.due_on || "") || a.created_at.localeCompare(b.created_at));
  const done = cache.todos.filter((t) => t.done)
    .sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 30);
  body.innerHTML = `
    <div class="todo-add">
      <input class="study-input" id="tdTitle" maxlength="200" placeholder="할 일을 적고 Enter">
      <button class="study-btn primary" id="tdAdd">추가</button>
    </div>
    <div class="study-section">남은 할 일 ${open.length}개</div>
    ${open.length ? open.map(todoRow).join("") : `<div class="study-empty">남은 할 일이 없어요</div>`}
    ${done.length ? `<div class="study-section">완료 ${done.length}개</div>` + done.map(todoRow).join("") : ""}`;
  const add = async () => {
    const title = $("tdTitle").value.trim();
    if (!title) return $("tdTitle").focus();
    $("tdAdd").disabled = true;
    const { data, error } = await sb.from("todos").insert({ title }).select().single();
    $("tdAdd").disabled = false;
    if (error) return toast("추가하지 못했어요", true);
    cache.todos.push(data);
    renderTodo();
    $("tdTitle").focus();
  };
  $("tdAdd").onclick = add;
  $("tdTitle").onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) add(); };
  body.querySelectorAll("[data-tchk]").forEach((b) => b.onclick = () => toggleTodo(b.dataset.tchk));
  body.querySelectorAll("[data-tedit]").forEach((b) => b.onclick = () => openTodoForm(cache.todos.find((t) => t.id === b.dataset.tedit)));
  body.querySelectorAll("[data-tdel]").forEach((b) => b.onclick = () => removeTodo(b.dataset.tdel));
  body.querySelectorAll("[data-tdue]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    openDuePop(b, cache.todos.find((t) => t.id === b.dataset.tdue));
  });
}

// 기한 고르기: 버튼 아래에 뜨는 작은 메뉴 (오늘 · 내일 · 이번 주말 · 다음 주 · 날짜 고르기)
function closeDuePop() {
  document.querySelector(".due-pop")?.remove();
  document.removeEventListener("pointerdown", duePopOutside, true);
  document.removeEventListener("keydown", duePopKey);
}
function duePopOutside(e) { if (!e.target.closest(".due-pop")) closeDuePop(); }
function duePopKey(e) { if (e.key === "Escape") closeDuePop(); }

function openDuePop(btn, t) {
  const wasOpen = document.querySelector(".due-pop")?.dataset.id === t.id;
  closeDuePop();
  if (wasOpen) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const plus = (n) => dayKey(new Date(+today + n * 86400000));
  const wd = today.getDay();
  const picks = [
    ["오늘", plus(0)],
    ["내일", plus(1)],
    ["이번 주말", plus(wd === 6 ? 0 : 6 - wd)],
    ["다음 주 월요일", plus(((8 - wd) % 7) || 7)],
  ];
  const pop = document.createElement("div");
  pop.className = "due-pop";
  pop.dataset.id = t.id;
  pop.innerHTML = picks.map(([label, key]) => {
    const d = todoDue(key);
    return `<button class="due-pick${t.due_on === key ? " on" : ""}" data-key="${key}"><span>${label}</span><span class="due-pick-day">${d.short}</span></button>`;
  }).join("") + `
    <label class="due-pick due-cal"><span>날짜 고르기</span><input type="date" value="${t.due_on || ""}"></label>
    ${t.due_on ? `<button class="due-pick due-clear" data-key="">기한 없애기</button>` : ""}`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8);
  const top = r.bottom + 6 + h > innerHeight && r.top - 6 - h > 0 ? r.top - 6 - h : r.bottom + 6;
  pop.style.left = `${left + scrollX}px`;
  pop.style.top = `${top + scrollY}px`;

  const set = async (key) => {
    closeDuePop();
    const due_on = key || null;
    if (due_on === t.due_on) return;
    const { error } = await sb.from("todos").update({ due_on }).eq("id", t.id);
    if (error) return toast("저장하지 못했어요", true);
    t.due_on = due_on;
    renderTodo();
    toast(due_on ? `${todoDue(due_on).short}까지로 정했어요` : "기한을 없앴어요");
  };
  pop.querySelectorAll("[data-key]").forEach((b) => b.onclick = () => set(b.dataset.key));
  const cal = pop.querySelector("input[type=date]");
  cal.onchange = () => cal.value && set(cal.value);
  pop.querySelector(".due-cal").onclick = () => { try { cal.showPicker(); } catch {} };
  setTimeout(() => {
    document.addEventListener("pointerdown", duePopOutside, true);
    document.addEventListener("keydown", duePopKey);
  });
}

async function toggleTodo(id) {
  const t = cache.todos.find((x) => x.id === id);
  const patch = { done: !t.done, done_at: t.done ? null : new Date().toISOString() };
  const { error } = await sb.from("todos").update(patch).eq("id", id);
  if (error) return toast("저장하지 못했어요", true);
  Object.assign(t, patch);
  rerender();
}

async function removeTodo(id) {
  if (!confirm("이 할 일을 삭제할까요?")) return false;
  const { error } = await sb.from("todos").delete().eq("id", id);
  if (error) { toast("삭제하지 못했어요", true); return false; }
  cache.todos = cache.todos.filter((t) => t.id !== id);
  rerender();
  return true;
}

function openTodoForm(t) {
  openSheet("할 일 수정", `
    <label class="study-label">할 일</label>
    <input class="study-input" id="tfTitle" maxlength="200" value="${esc(t.title)}">
    <label class="study-label">기한 (없어도 돼요 · 정하면 달력에도 떠요)</label>
    <input class="study-input" type="date" id="tfDue" value="${t.due_on || ""}">
    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="tfSave">저장</button>
    <button class="study-submit ghost danger" id="tfDel">삭제</button>`);
  $("tfSave").onclick = async () => {
    const patch = { title: $("tfTitle").value.trim(), due_on: $("tfDue").value || null };
    if (!patch.title) return showErr("할 일을 입력해 주세요.");
    const { error } = await sb.from("todos").update(patch).eq("id", t.id);
    if (error) return showErr("저장하지 못했어요.");
    Object.assign(t, patch);
    closeModal();
    rerender();
  };
  $("tfDel").onclick = async () => { if (await removeTodo(t.id)) closeModal(); };
}

// ---------- 웹 푸시 ----------
function urlB64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const b64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// 켜짐/꺼짐은 기기마다 따로입니다. 이 기기의 구독이 서버에 등록되어 있으면 켜진 것으로 봅니다.
let pushOn = false;

async function deviceSub() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// 설정의 알림 체크박스
const PUSH_HINT = "수행평가는 1일 · 6시간 전, 일정은 30분 전에 알려 줘요 (이 기기)";
// 설정의 알림 체크박스와, 알림이 꺼져 있으면 설정 아이콘의 빨간 점 · 설정 창 알림 줄 빨간 강조
function paintPush() {
  const b = $("setPush");
  const warn = !!me && paintPush.known && !pushOn && pushPossible();
  if (b) {
    b.checked = pushOn;
    b.closest(".set-row").classList.toggle("warn", warn);   // 설정 창의 알림 줄도 빨갛게
    $("pushHint").textContent = warn ? "알림이 꺼져 있어요. 눌러서 켜 주세요" : PUSH_HINT;
  }
  $("btnSettings").classList.toggle("warn", warn);
}
// 이 기기에서 알림을 켤 수 있는지 (못 켜는 기기에는 빨간 점을 띄우지 않습니다)
function pushPossible() {
  if (!CFG.VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return !(/iPad|iPhone|iPod/.test(navigator.userAgent) && !standalone);
}

// 알림은 기본으로 켜 둡니다: 이 기기에서 끈 적이 없고 브라우저 알림을 이미 허락했으면, 로그인할 때 조용히 등록합니다.
// 아직 허락하지 않았으면 브라우저가 직접 물어야 해서 자동으로 켤 수 없고, 설정에서 알림을 눌러 켭니다.
const PUSH_PREF = "dshs-push";
const pushWanted = () => { try { return localStorage.getItem(PUSH_PREF) !== "off"; } catch { return true; } };
async function autoPush() {
  if (autoPush.done || !me) return;
  autoPush.done = true;
  if (pushWanted() && "Notification" in window && Notification.permission === "granted") {
    try { await enablePush(true); } catch {}
  }
  refreshPush();   // 켜졌는지 확인해서 설정 아이콘의 빨간 점을 맞춥니다
}

async function refreshPush() {
  const sub = await deviceSub().catch(() => null);
  if (!sub) { pushOn = false; paintPush.known = true; return paintPush(); }
  const { data, error } = await sb.from("push_subscriptions").select("endpoint").eq("endpoint", sub.endpoint).maybeSingle();
  if (error) return;
  pushOn = !!data;
  paintPush.known = true;
  paintPush();
}

async function togglePush() {
  const b = $("setPush");
  b.disabled = true;
  try {
    if (pushOn) {
      if (await disablePush()) {
        try { localStorage.setItem(PUSH_PREF, "off"); } catch {}
        toast("알림을 껐어요");
      } else toast("알림을 끄지 못했어요", true);
    } else {
      await enablePush();
      if (pushOn) try { localStorage.setItem(PUSH_PREF, "on"); } catch {}
    }
  } catch {
    toast("알림 설정을 바꾸지 못했어요", true);
  }
  if ($("setPush")) $("setPush").disabled = false;
  paintPush();
}

async function disablePush() {
  const sub = await deviceSub().catch(() => null);
  if (!sub) { pushOn = false; return true; }
  const { error } = await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  if (error) return false;
  await sub.unsubscribe().catch(() => {});
  pushOn = false;
  return true;
}

// quiet: 로그인할 때 자동으로 켜는 경우 (안내를 띄우지 않음)
async function enablePush(quiet = false) {
  const say = quiet ? () => {} : toast;
  if (!CFG.VAPID_PUBLIC_KEY) return say("알림 키가 아직 설정되지 않았어요", true);
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return say("이 브라우저는 알림을 지원하지 않아요", true);
  }
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS && !standalone) return say("아이폰은 홈 화면에 추가한 뒤에 알림을 켤 수 있어요", true);

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return say("알림이 차단되어 있어요", true);

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(CFG.VAPID_PUBLIC_KEY),
    });
  }
  const j = sub.toJSON();
  const { error } = await sb.from("push_subscriptions").upsert({
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: me.id,
  });
  if (error) return say("알림 등록에 실패했어요", true);
  pushOn = true;
  paintPush();
  say("수행평가는 1일·6시간 전, 일정은 30분 전에 알려드릴게요");
}

init();
