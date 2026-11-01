// ============================================================
// dshs.study — 계정 · 수행평가 공지 · 기한 알림
// 시간표 기능은 이 파일 없이도 그대로 동작합니다.
// ============================================================
const CFG = window.DSHS_CONFIG || {};
const ENABLED = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const EMAIL_DOMAIN = "dshs.study";

let sb = null;
let me = null;          // { id, username, student_id, name, is_admin }
let myClasses = [];     // 로컬 시간표 데이터에서 가져온 내 수강 분반 [{ subject, ban }]
let cache = { items: [], pending: [], mine: [], events: [], done: new Set(), people: new Map(), todos: null, school: [] };
let page = "cal";       // 열린 탭: cal(내 일정) | notice(수행평가 공지) | todo(할 일)
let view = "feed";      // studyBody 에 떠 있는 화면: feed | notice | admin | form | todo
let fc = null;          // FullCalendar 인스턴스 (달력 탭일 때만)
let fcDate = null;      // 달력을 다시 그릴 때 돌아갈 날짜

const VIEWS = [["3day", "3일"], ["week", "주"], ["month", "월"], ["list", "목록"]];
let tab = (() => {      // feed 화면의 탭. 마지막에 고른 보기를 기억합니다
  try { const v = localStorage.getItem("dshs-cal-view"); if (VIEWS.some(([k]) => k === v)) return v; } catch {}
  return window.innerWidth < 640 ? "3day" : "week";
})();

const COLORS = ["mint", "violet", "pink", "orange", "blue"];

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
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "dshs-study-auth" },
  });

  const { data: { session } } = await sb.auth.getSession();   // ← 자동 로그인
  if (session) await loadProfile();
  renderNav();
  if (me) loadAssignments();

  sb.auth.onAuthStateChange(async (evt) => {
    if (evt === "SIGNED_OUT") { me = null; myClasses = []; renderNav(); }
  });

  // 알림을 누르고 들어오면 그 탭으로
  const opened = new URLSearchParams(location.search).get("view");
  if (me && opened === "assignments") openStudy("notice");
  if (me && opened === "cal") openStudy("cal");
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

// ---------- 헤더 ----------
function renderNav() {
  const nav = $("studyNav");
  nav.style.display = "flex";
  const open = $("studyView").style.display === "block";
  nav.innerHTML = me
    ? PAGES.map(([k, label]) =>
        `<button class="study-btn${open && page === k ? " primary" : ""}" data-page="${k}">${label}</button>`).join("") +
      `<button class="study-btn" id="btnAcct" title="${esc(me.name)} (${esc(me.username)})">로그아웃</button>`
    : `<button class="study-btn" id="btnLogin">🔑 로그인 / 회원가입</button>`;
  if (me) {
    nav.querySelectorAll("[data-page]").forEach((b) => b.onclick = () => openStudy(b.dataset.page));
    $("btnAcct").onclick = () => {
      if (confirm(`로그아웃할까요? (${me.name} · ${me.username})`)) logout();
    };
  } else {
    $("btnLogin").onclick = () => openAuth("login");
  }
}

async function logout() {
  await disablePush();   // 이 기기로 다음 사람의 알림이 오지 않도록, 로그아웃하기 전에 지웁니다
  await sb.auth.signOut();
  me = null; myClasses = []; closeStudy(); renderNav();
  toast("로그아웃했어요");
}

// ---------- 로그인 / 회원가입 ----------
function closeModal() { $("studyModal").className = "study-modal"; }

function openAuth(mode) {
  const m = $("studyModal");
  m.className = "study-modal show";
  m.innerHTML = `<div class="study-sheet">
    <div class="study-sheet-head">
      <div class="study-tabs">
        <button class="study-tab${mode === "login" ? " on" : ""}" data-m="login">로그인</button>
        <button class="study-tab${mode === "signup" ? " on" : ""}" data-m="signup">회원가입</button>
      </div>
      <button class="study-x">✕</button>
    </div>
    <div id="authBody"></div>
  </div>`;
  m.querySelector(".study-x").onclick = closeModal;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  m.querySelectorAll(".study-tab").forEach((b) => { b.onclick = () => openAuth(b.dataset.m); });
  (mode === "login" ? loginForm : signupStep1)();
}

function loginForm() {
  $("authBody").innerHTML = `
    <label class="study-label">아이디</label>
    <input class="study-input" id="loginId" autocomplete="username" placeholder="가입할 때 정한 아이디">
    <label class="study-label">비밀번호</label>
    <input class="study-input" id="loginPw" type="password" autocomplete="current-password" placeholder="8자 이상">
    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="doLogin">로그인</button>
    <div class="study-foot">이 브라우저에서는 다음부터 자동으로 로그인돼요.</div>`;
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
    closeModal(); renderNav(); openStudy();
    toast(`${me.name}님, 반가워요`);
  };
  $("doLogin").onclick = go;
  $("loginPw").onkeydown = (e) => { if (e.key === "Enter") go(); };
}

function showErr(msg) { const e = $("authErr"); e.textContent = msg; e.classList.add("show"); }

function signupStep1() {
  $("authBody").innerHTML = `
    <label class="study-label">학번</label>
    <input class="study-input" id="suSid" inputmode="numeric" maxlength="4" placeholder="예: 2113">
    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="doCheck">다음</button>
    <div class="study-foot">학번으로 본인 이름을 확인한 뒤 아이디를 만들어요.</div>`;
  const go = async () => {
    const sid = parseInt($("suSid").value.trim(), 10);
    if (!sid) return showErr("학번을 숫자로 입력해 주세요.");
    $("doCheck").disabled = true;
    const { data, error } = await sb.rpc("student_id_status", { p_student_id: sid });
    $("doCheck").disabled = false;
    if (error) return showErr("확인에 실패했어요. 잠시 뒤 다시 시도해 주세요.");
    const row = data?.[0];
    if (!row) return showErr("명단에 없는 학번이에요.");
    if (row.taken) return showErr("이 학번은 이미 가입되어 있어요. 로그인해 주세요.");
    signupStep2(sid, row.name);
  };
  $("doCheck").onclick = go;
  $("suSid").onkeydown = (e) => { if (e.key === "Enter") go(); };
}

function signupStep2(sid, name) {
  $("authBody").innerHTML = `
    <div class="study-confirm">
      <div class="study-confirm-name">${esc(name)}</div>
      <div class="study-confirm-sid">학번 ${sid}</div>
    </div>
    <div class="study-foot" style="margin:0 0 14px">본인이 맞나요? 아니라면 학번을 다시 확인해 주세요.</div>
    <button class="study-submit ghost" id="back">← 학번 다시 입력</button>
    <button class="study-submit" id="yes">네, 맞아요</button>`;
  $("back").onclick = signupStep1;
  $("yes").onclick = () => signupStep3(sid, name);
}

function signupStep3(sid, name) {
  $("authBody").innerHTML = `
    <div class="study-who">${esc(name)} · ${sid}</div>
    <label class="study-label">아이디</label>
    <input class="study-input" id="suId" autocomplete="username" placeholder="영문 소문자·숫자 4~20자">
    <label class="study-label">비밀번호</label>
    <input class="study-input" id="suPw" type="password" autocomplete="new-password" placeholder="8자 이상">
    <label class="study-label">비밀번호 확인</label>
    <input class="study-input" id="suPw2" type="password" autocomplete="new-password">
    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="doSignup">가입하기</button>
    <div class="study-foot">학번당 계정은 하나만 만들 수 있어요.</div>`;
  $("doSignup").onclick = async () => {
    const u = $("suId").value.trim().toLowerCase();
    const p = $("suPw").value, p2 = $("suPw2").value;
    if (!/^[a-z0-9_]{4,20}$/.test(u)) return showErr("아이디는 영문 소문자·숫자·밑줄 4~20자예요.");
    if (p.length < 8) return showErr("비밀번호는 8자 이상이어야 해요.");
    if (p !== p2) return showErr("비밀번호가 서로 달라요.");
    $("doSignup").disabled = true;
    try {
      const res = await fetch(`${CFG.SUPABASE_URL}/functions/v1/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY },
        body: JSON.stringify({ student_id: sid, username: u, password: p }),
      });
      const out = await res.json();
      if (!res.ok) { $("doSignup").disabled = false; return showErr(out.error || "가입하지 못했어요."); }
      await sb.auth.signInWithPassword({ email: `${u}@${EMAIL_DOMAIN}`, password: p });
      await loadProfile();
      closeModal(); renderNav(); openStudy();
      toast(`${name}님, 가입을 환영해요`);
    } catch {
      $("doSignup").disabled = false;
      showErr("네트워크 오류가 났어요.");
    }
  };
}

// ---------- 탭: 내 일정 · 수행평가 공지 · 할 일 ----------
const PAGES = [["cal", "🗓 내 일정"], ["notice", "📢 수행평가 공지"], ["todo", "☑️ 할 일"]];
const PAGE_VIEW = { cal: "feed", notice: "notice", todo: "todo" };

// 내 일정: 수행평가(내 분반 공지 + 내가 올린 것)와 개인 일정을 한 달력에 모두 보여줍니다
function openStudy(p) {
  page = PAGE_VIEW[p] ? p : "cal";
  view = PAGE_VIEW[page];
  destroyCal();
  $("result").classList.remove("show");
  $("welcomeState").style.display = "none";
  $("studyView").style.display = "block";
  renderStudy();
  renderNav();
  loadAssignments();
}
function closeStudy() {
  destroyCal();
  $("studyView").style.display = "none";
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
  const who = me.student_id ? esc(me.name) : `관리자 (${esc(me.username)})`;
  const subjects = me.student_id ? `${myClasses.length}과목` : `전체 ${mySubjects().length}과목`;
  const [title, sub] = {
    cal: ["내 일정", `${who} · 수행평가 ${subjects} + 개인 일정`],
    notice: ["수행평가 공지", `${who} · 내 분반 공지 ${subjects}`],
    todo: ["할 일", `${who} · 체크하면서 하나씩 끝내요`],
  }[page];
  const pushBtn = `<button class="study-btn" id="btnPush"></button>`;
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
      ${me.is_admin ? '<button class="study-btn admin" id="btnSchool">🏫 학교 일정 추가</button>' : ""}${pushBtn}
    </div>` : ""}
    ${page === "notice" ? `<div class="study-row">
      <button class="study-btn primary" id="btnNew">+ 공지 올리기</button>${pushBtn}
      ${me.is_admin ? '<button class="study-btn admin" id="btnAdmin">⭐ 승인 대기 <span id="pendCount">0</span></button>' : ""}
    </div>` : ""}
    <div id="studyBody"><div class="study-empty">불러오는 중…</div></div>`;
  if ($("btnEv")) $("btnEv").onclick = () => openEventForm(null);
  if ($("btnSchool")) $("btnSchool").onclick = () => openSchoolForm(null);
  if ($("btnPush")) { $("btnPush").onclick = togglePush; paintPush(); refreshPush(); }
  if ($("btnNew")) $("btnNew").onclick = openNewForm;
  if ($("btnAdmin")) $("btnAdmin").onclick = () => renderList("admin");
}

async function loadAssignments() {
  const [asg, evs, done, people, todos, school] = await Promise.all([
    sb.from("assignments").select("*").order("due_at", { ascending: true }),
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
  cache.items = (data || []).filter((a) => a.status === "approved");
  cache.mine = (data || []).filter((a) => a.created_by === me.id);
  cache.pending = (data || []).filter((a) => a.status === "pending");
  const pc = $("pendCount");
  if (pc) pc.textContent = cache.pending.length;
  // 작성 중인 공지 추가 폼은 덮어쓰지 않습니다
  if ($("studyView").style.display === "block" && view !== "form") rerender();
}

function card(a, opts = {}) {
  const d = dueInfo(a.due_at);
  const stBadge = `<span class="st-badge ${a.status}">${a.status === "pending" ? "승인 대기" : "반려됨"}</span>`;
  const dueBadge = `<span class="due-badge ${d.tone}">${d.label}</span>`;
  // 공지 탭(check)에서는 내 미승인 공지도 D-day 와 함께 "나만 보여요" 를 붙여 보여줍니다
  const badge = a.status === "approved" ? dueBadge
    : opts.check ? `<span class="own-tag">나만 보여요 · ${a.status === "pending" ? "승인 대기" : "반려됨"}</span>${dueBadge}`
    : stBadge;
  const done = opts.check && cache.done.has(a.id);
  const ownOnly = a.created_by === me.id && a.status !== "approved";
  return `<div class="asg-card${done ? " done" : ""}${opts.check && ownOnly ? " own" : ""}">
    <div class="asg-top"><span class="asg-subject">${esc(a.subject)} · ${esc(banLabel(a.ban))}</span>${badge}</div>
    <div class="asg-title">${esc(a.title)}</div>
    ${a.body ? `<div class="asg-body">${esc(a.body)}</div>` : ""}
    <div class="asg-due">🗓 ${d.when} 마감</div>
    ${opts.check ? `<div class="asg-actions">
      <button class="study-btn small${done ? " on" : ""}" data-adone="${a.id}">${done ? "✓ 완료함" : "완료 표시"}</button>
      ${ownOnly ? `<button class="study-btn small no" data-del="${a.id}">삭제</button>` : ""}
    </div>` : ""}
    ${opts.admin ? `<div class="asg-actions">
      <button class="study-btn small ok" data-ok="${a.id}">승인</button>
      <button class="study-btn small no" data-no="${a.id}">반려</button>
    </div>` : ""}
    ${opts.mine && a.status !== "approved" ? `<div class="asg-actions">
      <button class="study-btn small no" data-del="${a.id}">삭제</button>
    </div>` : ""}
  </div>`;
}

function renderList(mode) {
  const body = $("studyBody");
  view = mode;
  if (mode === "admin") {
    destroyCal();
    body.innerHTML = `<div class="study-section">승인 대기 ${cache.pending.length}건</div>` +
      (cache.pending.length
        ? cache.pending.map((a) => card(a, { admin: true })).join("")
        : `<div class="study-empty">대기 중인 공지가 없어요.</div>`) +
      `<button class="study-btn wide" id="backFeed">← 공지 목록으로</button>`;
    body.querySelectorAll("[data-ok]").forEach((b) => b.onclick = () => review(b.dataset.ok, "approved"));
    body.querySelectorAll("[data-no]").forEach((b) => b.onclick = () => review(b.dataset.no, "rejected"));
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
        ${me.student_id && tab !== "list" ? `<label class="tt-check"><input type="checkbox" id="ttToggle"${showTT ? " checked" : ""}> 학교 시간표 보이기</label>` : ""}
        ${tab !== "list" ? `<button class="study-btn small" id="acadBtn">${acadBtnLabel()}</button>` : ""}
        <div class="seg">${VIEWS.map(([k, label]) =>
          `<button class="seg-btn${tab === k ? " on" : ""}" data-seg="${k}">${label}</button>`).join("")}</div>
      </div>
    </div>` +
    (tab === "list" ? listHtml(agenda()) : `<div class="fc-host" id="calHost"><div class="study-empty">달력 불러오는 중…</div></div>`);
  body.querySelectorAll("[data-seg]").forEach((b) => b.onclick = () => switchTab(b.dataset.seg));
  body.querySelectorAll("[data-nav]").forEach((b) => b.onclick = () => fc && fc[b.dataset.nav]());
  if ($("ttToggle")) $("ttToggle").onchange = () => {
    showTT = $("ttToggle").checked;
    try { localStorage.setItem("dshs-cal-tt", showTT ? "on" : "off"); } catch {}
    fc?.refetchEvents();
  };
  if ($("acadBtn")) $("acadBtn").onclick = openAcadFilter;
  bindRows(body);
  if (tab !== "list") mountCal();
}

function mineHtml() {
  const mineOpen = (cache.mine || []).filter((a) => a.status !== "approved");
  return mineOpen.length ? `<div class="study-section">분반 공지 신청 현황</div>` +
    mineOpen.map((a) => card(a, { mine: true })).join("") : "";
}

// 목록의 완료 동그라미 · 항목 열기 · 공지 취소
function bindRows(root) {
  root.querySelectorAll("[data-chk]").forEach((b) => b.onclick = () => toggleDone(...b.dataset.chk.split(":")));
  root.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => openItem(...b.dataset.open.split(":")));
  root.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => removeItem(b.dataset.del));
}
function openItem(kind, id) {
  if (kind === "asg") openAsgDetail(cache.items.find((a) => a.id === id) || cache.mine.find((a) => a.id === id));
  else if (kind === "sch") {
    const se = cache.school.find((x) => x.id === id);
    me.is_admin ? openSchoolForm(se) : openSchoolDetail(se);
  } else if (kind === "tt") return;
  else if (kind === "acad") openAcadDetail(acadList.find((e) => e.id === id));
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
    if (it.kind === "sch") base.classNames.push("fcx-school");
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

function fcContent(arg) {
  const p = arg.event.extendedProps;
  if (p.kind === "tt") return { html: `<div class="fcx-tt-in"><b>${esc(arg.event.title)}</b><span>${esc(p.ban)}</span></div>` };
  if (p.kind === "todo") return { html: `<div class="fcx"><div class="fcx-title"><span class="fcx-tchk" role="checkbox" aria-checked="${p.done}" aria-label="완료 표시">${p.done ? "✓" : ""}</span>${esc(arg.event.title)}</div></div>` };
  const s = arg.event.start, e = arg.event.end;
  const time = p.kind === "asg" ? `${hm(p.at)} 마감`
    : arg.event.allDay ? "" : `${hm(s)}${e ? ` – ${hm(e)}` : ""}`;
  return { html: `<div class="fcx">
    ${time ? `<div class="fcx-time">${time}</div>` : ""}
    <div class="fcx-title">${p.kind === "asg" ? "📋 " : p.kind === "sch" ? "🏫 " : p.kind === "acad" ? "🎓 " : p.shared ? "👥 " : ""}${esc(arg.event.title)}</div>
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
  const asgs = [...cache.items, ...own].map((a) => ({
    kind: "asg", id: a.id, title: a.title, at: new Date(a.due_at), end: null, allDay: false,
    color: "asg", done: cache.done.has(a.id) || new Date(a.due_at) < now, status: a.status,
    auto: !cache.done.has(a.id) && new Date(a.due_at) < now,
    tag: `${a.subject} · ${banLabel(a.ban)}${a.status === "pending" ? " · 승인 대기 (나만 보여요)" : a.status === "rejected" ? " · 나만 보여요" : ""}`,
  }));
  const evs = cache.events.map((e) => ({
    kind: "ev", id: e.id, title: e.title, at: new Date(e.starts_at), end: e.ends_at ? new Date(e.ends_at) : null,
    allDay: e.all_day, color: e.color, done: eventDone(e) || isPastEvent(e), auto: !eventDone(e) && isPastEvent(e),
    owner: ownsEvent(e), shared: eventPeople(e).length > 0,
    tag: [shareLabel(e) && `👥 ${shareLabel(e)}`, e.memo.split("\n")[0]].filter(Boolean).join(" · "),
  }));
  const sch = cache.school.map((e) => ({
    kind: "sch", id: e.id, title: e.title, at: new Date(e.starts_at), end: e.ends_at ? new Date(e.ends_at) : null,
    allDay: e.all_day, color: "school", done: false, owner: me.is_admin,
    tag: ["학교 일정", e.no_class && "수업 없음", me.is_admin && e.audience === "some" && `🎯 ${schoolTargets(e).length}명`,
      e.memo.split("\n")[0]].filter(Boolean).join(" · "),
  }));
  // 기한을 정한 할 일은 그날 종일 칸에 체크박스로 둡니다
  const todos = (cache.todos || []).filter((t) => t.due_on).map((t) => ({
    kind: "todo", id: t.id, title: t.title, at: parseDay(t.due_on), end: null, allDay: true,
    color: "mint", done: t.done, owner: true, tag: "할 일",
  }));
  return [...sch, ...asgs, ...todos, ...evs].sort((x, y) => (y.allDay - x.allDay) || (x.at - y.at));
}

function timeLabel(it) {
  const multi = it.end && dayKey(it.end) !== dayKey(it.at);
  if (it.kind === "asg") return `${hm(it.at)} 마감`;
  if (it.allDay) return multi ? `${md(it.at)} – ${md(it.end)} · 하루 종일` : "하루 종일";
  if (!it.end) return hm(it.at);
  return multi ? `${md(it.at)} ${hm(it.at)} – ${md(it.end)} ${hm(it.end)}` : `${hm(it.at)} – ${hm(it.end)}`;
}

function row(it) {
  const d = it.kind === "asg" && !it.done ? dueInfo(it.at) : null;
  return `<div class="ev-row c-${it.color}${it.done ? " done" : ""}">
    ${it.kind === "sch" ? `<span class="ev-check sch-ic" aria-hidden="true">🏫</span>`
      : `<button class="ev-check" data-chk="${it.kind}:${it.id}" aria-label="완료 표시"${it.auto
      ? ' disabled title="지난 일정은 자동으로 완료돼요"' : ""}>${it.done ? "✓" : ""}</button>`}
    <button class="ev-main" data-open="${it.kind}:${it.id}">
      <span class="ev-title">${it.kind === "asg" ? "📋 " : ""}${esc(it.title)}</span>
      <span class="ev-meta">${esc(timeLabel(it))}${it.tag ? ` · ${esc(it.tag)}` : ""}</span>
    </button>
    ${d ? `<span class="due-badge ${d.tone}">${d.label}</span>` : ""}
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
      ? "내 일정에만 들어가 있어요. 관리자가 승인하면 분반 친구들에게도 공지돼요."
      : "분반 공지로는 반려됐지만 내 일정에는 그대로 남아 있어요."}</div>` : ""}
    <button class="study-submit${done ? " ghost" : ""}" id="aDone">${done ? "완료 취소" : "✓ 완료로 표시"}</button>
    ${ownOnly ? '<button class="study-submit ghost danger" id="aDel">삭제</button>' : ""}`);
  $("aDone").onclick = async () => { closeModal(); await toggleDone("asg", a.id); };
  if (ownOnly) $("aDel").onclick = async () => { if (await removeItem(a.id)) closeModal(); };
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
  const color = ev?.color || "mint";
  openSheet(ev ? "일정 수정" : "새 일정", `
    <label class="study-label">제목</label>
    <input class="study-input" id="eTitle" maxlength="120" value="${esc(ev?.title || "")}" placeholder="예: 동아리 회의, 학원, 생일">
    <label class="ev-allday"><input type="checkbox" id="eAll"${allDay ? " checked" : ""}> 하루 종일</label>
    <label class="study-label">시작</label>
    <div class="ev-when"><input class="study-input" type="date" id="eSd" value="${dayKey(start)}"><input class="study-input" type="time" id="eSt" step="300" value="${hm(start)}"></div>
    <label class="study-label">끝</label>
    <div class="ev-when"><input class="study-input" type="date" id="eEd" value="${dayKey(end)}"><input class="study-input" type="time" id="eEt" step="300" value="${hm(end)}"></div>
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
      <div class="asg-top"><span class="asg-subject">👥 ${esc(owner?.name || "친구")}님이 공유</span></div>
      <div class="asg-title">${esc(ev.title)}</div>
      ${ev.memo ? `<div class="asg-body">${esc(ev.memo)}</div>` : ""}
      <div class="asg-due">🗓 ${dayTitle(dayKey(it.at))} · ${esc(timeLabel(it))}</div>
      <div class="asg-due">함께: ${esc([owner?.name, ...others].filter(Boolean).join(", "))}</div>
    </div>
    <div class="study-foot">시간·내용은 만든 사람만 바꿀 수 있어요.</div>
    ${it.auto ? `<button class="study-submit ghost" disabled>✓ 지난 일정 · 자동 완료</button>`
      : `<button class="study-submit${done ? " ghost" : ""}" id="sDone">${done ? "완료 취소" : "✓ 완료로 표시"}</button>`}
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

function openNewForm() {
  const body = $("studyBody");
  // 기본 마감: 일주일 뒤 그날 자정 (23:59 — 00:00 으로 두면 달력에서 다음 날로 넘어가 보입니다)
  const dueDay = new Date();
  dueDay.setDate(dueDay.getDate() + 7);
  // 학생은 자기 분반만, 관리자는 과목마다 "전체 분반" + 각 분반
  const opts = me.is_admin
    ? mySubjects().flatMap((s) => [{ subject: s, ban: null },
        ...myClasses.filter((c) => c.subject === s)])
    : myClasses;
  view = "form";
  if (!opts.length) {
    body.innerHTML = `<div class="study-empty">수강 과목 정보를 찾지 못해 공지를 올릴 수 없어요.</div>
      <button class="study-btn wide" id="backFeed">← 목록으로</button>`;
    $("backFeed").onclick = renderNotice;
    return;
  }
  body.innerHTML = `
    <div class="study-section">공지 추가</div>
    <div class="asg-card">
      <label class="study-label">과목 · 분반</label>
      <select class="study-input" id="nClass">
        ${opts.map((o, i) => `<option value="${i}">${esc(o.subject)} · ${esc(banLabel(o.ban))}</option>`).join("")}
      </select>
      <label class="study-label">제목</label>
      <input class="study-input" id="nTitle" maxlength="120" placeholder="예: 3단원 실험 보고서 제출">
      <label class="study-label">내용 (선택)</label>
      <textarea class="study-input" id="nBody" rows="3" maxlength="2000" placeholder="범위, 제출 방법 등"></textarea>
      <label class="study-label">마감 일시</label>
      <input class="study-input" id="nDue" type="datetime-local" value="${dayKey(dueDay)}T23:59">
      <div class="study-err" id="nErr"></div>
      <button class="study-submit" id="nSave">제출하기</button>
      <div class="study-foot">${me.is_admin
        ? "관리자 공지는 승인 없이 바로 그 분반 수강생에게 공지돼요."
        : "내 일정에는 바로 들어가요. 관리자가 승인하면 같은 분반 친구들에게도 공지돼요."}</div>
    </div>
    <button class="study-btn wide" id="backFeed">← 목록으로</button>`;
  $("backFeed").onclick = renderNotice;
  $("nSave").onclick = async () => {
    const { subject, ban } = opts[+$("nClass").value];
    const title = $("nTitle").value.trim();
    const due = $("nDue").value;
    const err = $("nErr");
    if (!title) { err.textContent = "제목을 입력해 주세요."; err.classList.add("show"); return; }
    if (!due) { err.textContent = "마감 일시를 정해 주세요."; err.classList.add("show"); return; }
    $("nSave").disabled = true;
    const row = {
      subject, ban, title, body: $("nBody").value.trim(),
      due_at: new Date(due).toISOString(), created_by: me.id, status: "pending",
    };
    if (me.is_admin) {           // 관리자가 올린 공지는 바로 전체 공지
      row.status = "approved";
      row.reviewed_by = me.id;
      row.reviewed_at = new Date().toISOString();
    }
    const { error } = await sb.from("assignments").insert(row);
    $("nSave").disabled = false;
    if (error) { err.textContent = "올리지 못했어요: " + error.message; err.classList.add("show"); return; }
    toast(me.is_admin ? "바로 공지했어요" : "내 일정에 추가했어요. 승인되면 분반에도 공지돼요");
    view = "notice";
    await loadAssignments();
  };
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
  if (!confirm("이 수행평가를 삭제할까요? 내 일정에서도 사라져요.")) return false;
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
  5: ["13:10", "14:00"], 6: ["14:10", "15:00"], 7: ["15:10", "16:00"], 8: ["16:10", "17:00"], 9: ["17:10", "18:00"],
};
const DOW = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
let showTT = (() => { try { return localStorage.getItem("dshs-cal-tt") !== "off"; } catch { return true; } })();

// 내 시간표 → 요일별 수업 블록. 같은 과목이 이어지는 교시는 한 블록으로 합칩니다 (예: 3·4교시).
let ttMemo = null;
function myBlocks() {
  if (ttMemo?.sid === me.student_id) return ttMemo.blocks;
  const nm = (window.ID_TO_NAME || {})[String(me.student_id)];
  const sched = (nm && window.SCHOOL_DATA?.[nm]?.schedule) || [];
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
  ttMemo = { sid: me.student_id, blocks };
  return blocks;
}

// 학교 일정 중 "수업 없음" 으로 표시된 날짜들 + 학사일정의 공휴일·휴업일(방학 포함)
// 학사일정은 달력에서 꺼 두어도 그날 시간표는 깔지 않습니다.
function noClassDays() {
  const days = new Set();
  for (const e of cache.school.filter((x) => x.no_class)) {
    const d = new Date(e.starts_at); d.setHours(0, 0, 0, 0);
    const last = new Date(e.ends_at || e.starts_at);
    for (; d <= last; d.setDate(d.getDate() + 1)) days.add(dayKey(d));
  }
  for (const e of myAcad().filter((x) => x.type === "공휴일" || x.type === "휴업일")) {
    for (const d = parseDay(e.start); dayKey(d) <= e.end; d.setDate(d.getDate() + 1)) days.add(dayKey(d));
  }
  return days;
}

// 보이는 범위의 평일마다 수업을 흐린 배경 블록으로 깝니다. 월 보기에는 깔지 않습니다.
function ttEvents(from, to) {
  if (!me.student_id || !showTT || to - from > 8 * 86400000) return [];
  const blocks = myBlocks(), off = noClassDays(), out = [];
  for (const d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d);
    if (off.has(key)) continue;
    (blocks[d.getDay()] || []).forEach((b, i) => {
      const [y, m, dd] = [d.getFullYear(), d.getMonth(), d.getDate()];
      const [sh, sm] = PERIOD_TIME[b.from][0].split(":"), [eh, em] = PERIOD_TIME[b.to][1].split(":");
      out.push({
        id: `tt:${key}:${i}`, title: b.subject, display: "background", classNames: ["fcx-tt"],
        start: new Date(y, m, dd, +sh, +sm), end: new Date(y, m, dd, +eh, +em),
        extendedProps: { kind: "tt", ban: b.from === b.to ? `${b.ban} · ${b.from}교시` : `${b.ban} · ${b.from}–${b.to}교시` },
      });
    });
  }
  return out;
}

// ---------- 학사일정 (NEIS) ----------
// 학교 홈페이지의 학사일정을 scripts/fetch-academic.mjs 가 매일 academic.json 으로 받아 둡니다.
// 종류별로 켜고 끄고, 고른 값은 이 기기에 기억합니다.
const ACAD_CATS = [
  ["home", "귀가일", "귀가일"],
  ["exam", "시험", "1·2차 지필평가"],
  ["break", "방학·개학", "방학식 · 개학식 · 방학 기간"],
  ["holiday", "공휴일·휴업일", "공휴일 · 재량휴업일"],
  ["club", "동아리·꿈지락", "학술동아리 · 문예예술동아리 · 꿈지락"],
  ["event", "학교 행사", "입학식 · 졸업식 · 체육대회 · 여명제 등"],
];
let acadList = null;   // academic.json 의 일정 (처음 달력을 열 때 한 번 받습니다)
let acadOn = (() => {
  try { const v = JSON.parse(localStorage.getItem("dshs-cal-acad")); if (Array.isArray(v)) return new Set(v); } catch {}
  return new Set(ACAD_CATS.map(([k]) => k));
})();

function acadCat(e) {
  if (/귀가|귀사/.test(e.name)) return "home";
  if (/지필|고사|시험/.test(e.name)) return "exam";
  if (/방학|개학|종업/.test(e.name)) return "break";
  if (e.type === "공휴일" || e.type === "휴업일") return "holiday";
  if (/동아리|꿈지락/.test(e.name)) return "club";
  return "event";
}

async function loadAcademic() {
  if (acadList) return;
  try {
    const res = await fetch("academic.json");
    acadList = (await res.json()).events.map((e, i) => ({ ...e, id: String(i), cat: acadCat(e) }));
  } catch { return; }   // 못 받으면 학사일정 없이 달력만 보여 줍니다
  fc?.refetchEvents();
}

// 내 학년 일정만 (학번 2113 → 2학년, 관리자는 전부). 토요휴업일은 매주라 뺍니다.
const myGrade = () => (me.student_id ? Math.floor(me.student_id / 1000) : 0);
function myAcad() {
  const g = myGrade();
  return (acadList || []).filter((e) => e.name !== "토요휴업일" && (!g || e.grades.includes(g)));
}

function acadEvents(from, to) {
  const lo = dayKey(from), hi = dayKey(to);
  return myAcad().filter((e) => acadOn.has(e.cat) && e.end >= lo && e.start < hi).map((e) => {
    const after = parseDay(e.end); after.setDate(after.getDate() + 1);   // FullCalendar 종일 일정의 끝은 다음 날(미포함)
    return {
      id: `acad:${e.id}`, title: e.name, start: e.start, end: dayKey(after), allDay: true, editable: false,
      classNames: ["fcx-acad", `c-acad-${e.cat}`], extendedProps: { kind: "acad" },
    };
  });
}

function openAcadDetail(e) {
  const when = e.start === e.end ? `${dayTitle(e.start)} · 하루 종일` : `${dayTitle(e.start)} – ${dayTitle(e.end)}`;
  const label = ACAD_CATS.find(([k]) => k === e.cat)[1];
  openSheet("🎓 학사일정", `
    <div class="shared-card c-acad-${e.cat}">
      <div class="ev-title">${esc(e.name)}</div>
      <div class="ev-meta">${esc(when)} · ${label}${e.grades.length < 3 ? ` · ${e.grades.join("·")}학년` : ""}</div>
      ${e.memo ? `<div class="asg-body">${esc(e.memo)}</div>` : ""}
    </div>
    <div class="study-foot">${e.from ? `${esc(e.from)}로 추가한 일정이에요.` : "학교 홈페이지 학사일정(NEIS)에서 가져온 일정이에요."}</div>`);
}

const acadBtnLabel = () => `🎓 학사일정 ${acadOn.size}/${ACAD_CATS.length}`;
function openAcadFilter() {
  const g = myGrade();
  openSheet("🎓 학사일정 보기", ACAD_CATS.map(([k, label, hint]) =>
    `<label class="ev-allday acad-opt c-acad-${k}"><input type="checkbox" data-acad="${k}"${acadOn.has(k) ? " checked" : ""}>
      <span class="acad-dot"></span><span><b>${label}</b> <span class="ev-hint">${hint}</span></span></label>`).join("") +
    `<div class="study-foot">학교 홈페이지 학사일정(NEIS)을 하루 한 번 받아 와요.${g ? ` ${g}학년 일정만 보여요.` : ""}</div>`);
  $("studyModal").querySelectorAll("[data-acad]").forEach((c) => c.onchange = () => {
    c.checked ? acadOn.add(c.dataset.acad) : acadOn.delete(c.dataset.acad);
    try { localStorage.setItem("dshs-cal-acad", JSON.stringify([...acadOn])); } catch {}
    if ($("acadBtn")) $("acadBtn").textContent = acadBtnLabel();
    fc?.refetchEvents();
  });
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
  openSheet("🏫 학교 일정", `
    <div class="shared-card c-school">
      <div class="ev-title">${esc(e.title)}</div>
      <div class="ev-meta">${esc(schoolWhen(e))}${e.no_class ? " · 수업 없음" : ""}</div>
      ${e.memo ? `<div class="asg-body">${esc(e.memo)}</div>` : ""}
    </div>
    <div class="study-foot">학교에서 올린 일정이에요.</div>`);
}

// 관리자: 학교 일정 추가·수정 (대상: 전체 / 특정 인원)
function openSchoolForm(e, seed) {
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

  openSheet(e ? "학교 일정 수정" : "🏫 학교 일정 추가", `
    <label class="study-label">제목</label>
    <input class="study-input" id="sTitle" maxlength="120" value="${esc(e?.title || "")}" placeholder="예: 체육대회, 2학기 기말고사, 개교기념일">
    <label class="ev-allday"><input type="checkbox" id="sAll"${allDay ? " checked" : ""}> 하루 종일</label>
    <label class="study-label">시작</label>
    <div class="ev-when"><input class="study-input" type="date" id="sSd" value="${dayKey(start)}"><input class="study-input" type="time" id="sSt" step="300" value="${hm(start)}"></div>
    <label class="study-label">끝</label>
    <div class="ev-when"><input class="study-input" type="date" id="sEd" value="${dayKey(end)}"><input class="study-input" type="time" id="sEt" step="300" value="${hm(end)}"></div>
    <label class="ev-allday sch-noclass"><input type="checkbox" id="sNo"${e?.no_class ? " checked" : ""}> 수업 없는 날 <span class="ev-hint">(이 기간엔 달력에 시간표를 깔지 않아요)</span></label>
    <label class="ev-allday"><input type="checkbox" id="sNotify"${e?.notify ? " checked" : ""}> <span style="white-space:nowrap">필수 일정</span> <span class="ev-hint">(30분 전 알림 · 하루 종일은 07:50)</span></label>
    <label class="study-label">메모 (선택)</label>
    <textarea class="study-input" id="sMemo" rows="2" maxlength="2000" placeholder="장소, 준비물 등">${esc(e?.memo || "")}</textarea>

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

    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="sSave">${e ? "저장" : "추가"}</button>
    ${e ? '<button class="study-submit ghost danger" id="sDel">학교 일정 삭제</button>' : ""}`);
  const sheet = $("studyModal").querySelector(".study-sheet");
  const at = (d, t) => (d ? new Date(`${d}T${t || "00:00"}`) : null);

  const syncAll = () => {
    sheet.classList.toggle("allday", $("sAll").checked);
    sheet.querySelector(".sch-noclass").style.display = $("sAll").checked ? "" : "none";
  };
  $("sAll").onchange = () => { syncAll(); if ($("sAll").checked) $("sEd").value = $("sSd").value; };
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
    };
    $("sSave").disabled = true;
    const { data: saved, error } = e
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
  if (e) $("sDel").onclick = async () => {
    if (!confirm("이 학교 일정을 모두의 달력에서 지울까요?")) return;
    const snap = { id: e.id, title: e.title, memo: e.memo, starts_at: e.starts_at, ends_at: e.ends_at,
      all_day: e.all_day, no_class: e.no_class, notify: e.notify, audience: e.audience };
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
const noticeItems = () => [...cache.items, ...(cache.mine || []).filter((a) => a.status !== "approved")]
  .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
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
    const d = new Date(a.due_at);
    return d >= now && d <= soon && !cache.done.has(a.id);
  });
  const subjects = noticeSubjects(now);
  const picked = subjects.find((sj) => sj.name === openSubj);
  body.innerHTML =
    `<div class="study-section">🔥 급한 공지 · ${URGENT_DAYS}일 안에 마감 ${urgent.length}건</div>` +
    (urgent.length ? urgent.map((a) => card(a, { check: true })).join("")
      : `<div class="study-empty">${URGENT_DAYS}일 안에 마감되는 공지가 없어요.</div>`) +
    `<div class="study-section">과목별 공지</div>` +
    `<div class="subj-grid">${subjects.map(subjBlock).join("")}</div>` +
    `<div id="subjDetail">${picked ? subjDetail(picked) : `<div class="subj-hint">과목을 누르면 그 과목 수행평가가 여기에 보여요</div>`}</div>` +
    mineHtml();
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
  return mySubjects().map((name) => {
    const items = noticeItems().filter((a) => a.subject === name);
    const up = items.filter((a) => new Date(a.due_at) >= now);
    const left = up.filter((a) => !cache.done.has(a.id));
    const bans = [...new Set(myClasses.filter((c) => c.subject === name).map((c) => c.ban))];
    return {
      name, up, left,
      past: items.filter((a) => new Date(a.due_at) < now).reverse().slice(0, 5),
      ban: me.student_id ? bans.join(", ") : `${bans.length}개 분반`,
    };
  }).sort((x, y) =>
    (!x.left.length - !y.left.length) ||
    (x.left.length ? new Date(x.left[0].due_at) - new Date(y.left[0].due_at) : 0) ||
    x.name.localeCompare(y.name, "ko"));
}

function subjBlock(sj) {
  const next = sj.left[0] ? dueInfo(sj.left[0].due_at) : null;
  return `<button class="subj-box${sj.left.length ? " has" : ""}${openSubj === sj.name ? " on" : ""}" data-subj="${esc(sj.name)}" aria-pressed="${openSubj === sj.name}">
    <span class="subj-name">${esc(sj.name)}</span>
    <span class="subj-ban">${esc(sj.ban)}</span>
    <span class="subj-meta">${next
      ? `<span class="due-badge ${next.tone}">${next.label}</span>${sj.left.length}건`
      : sj.up.length ? "모두 완료" : "공지 없음"}</span>
  </button>`;
}

function subjDetail(sj) {
  return `<div class="subj-detail">
    <div class="study-section">${esc(sj.name)} · ${esc(sj.ban)} 수행평가</div>
    ${sj.up.length ? sj.up.map((a) => card(a, { check: true })).join("")
      : `<div class="study-empty">다가오는 공지가 없어요.</div>`}
    ${sj.past.length ? `<div class="study-section">지난 공지</div>` + sj.past.map((a) => card(a, { check: true })).join("") : ""}
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
      ? `<button class="td-due ${t.done ? "" : due.tone}" data-tdue="${t.id}" title="${esc(due.text)}까지 · 눌러서 바꾸기">📅 ${due.short}${t.done ? "" : ` · ${due.label}`}</button>`
      : t.done ? "" : `<button class="td-due empty" data-tdue="${t.id}" title="기한 정하기" aria-label="기한 정하기">📅</button>`}
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
    ${open.length ? open.map(todoRow).join("") : `<div class="study-empty">남은 할 일이 없어요 🎉</div>`}
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
    <label class="due-pick due-cal"><span>📅 날짜 고르기</span><input type="date" value="${t.due_on || ""}"></label>
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

function paintPush() {
  const b = $("btnPush");
  if (!b) return;
  b.classList.toggle("on", pushOn);
  b.textContent = pushOn ? "🔔 알림 켜짐" : "🔕 알림 꺼짐";
  b.setAttribute("aria-pressed", pushOn);
}

async function refreshPush() {
  const sub = await deviceSub().catch(() => null);
  if (!sub) { pushOn = false; return paintPush(); }
  const { data, error } = await sb.from("push_subscriptions").select("endpoint").eq("endpoint", sub.endpoint).maybeSingle();
  if (error) return;
  pushOn = !!data;
  paintPush();
}

async function togglePush() {
  const b = $("btnPush");
  b.disabled = true;
  try {
    if (pushOn) {
      if (await disablePush()) toast("알림을 껐어요");
      else toast("알림을 끄지 못했어요", true);
    } else {
      await enablePush();
    }
  } catch {
    toast("알림 설정을 바꾸지 못했어요", true);
  }
  if ($("btnPush")) $("btnPush").disabled = false;
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

async function enablePush() {
  if (!CFG.VAPID_PUBLIC_KEY) return toast("알림 키가 아직 설정되지 않았어요", true);
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return toast("이 브라우저는 알림을 지원하지 않아요", true);
  }
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS && !standalone) return toast("아이폰은 홈 화면에 추가한 뒤에 알림을 켤 수 있어요", true);

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return toast("알림이 차단되어 있어요", true);

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
  if (error) return toast("알림 등록에 실패했어요", true);
  pushOn = true;
  toast("수행평가는 1일·6시간 전, 일정은 30분 전에 알려드릴게요");
}

init();
