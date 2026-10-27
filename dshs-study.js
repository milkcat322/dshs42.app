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
let current = null;     // 박스에서 고른 분반 (null 이면 전체 공지)
let cache = { items: [], pending: [] };

// ---------- 유틸 ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, bad) {
  const el = $("studyToast");
  el.textContent = msg;
  el.className = "study-toast show" + (bad ? " bad" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = "study-toast"; }, 3200);
}

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
    if (evt === "SIGNED_OUT") { me = null; myClasses = []; current = null; renderNav(); }
  });

  if (new URLSearchParams(location.search).get("view") === "assignments" && me) openStudy();
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
const sameClass = (a, b) => !!a && !!b && a.subject === b.subject && a.ban === b.ban;
// 공지가 이 분반에 해당하는지 (분반이 비어 있는 공지는 그 과목 전체)
const appliesTo = (asg, c) => asg.subject === c.subject && (!asg.ban || asg.ban === c.ban);
const banLabel = (ban) => ban || "전체 분반";
const mySubjects = () => [...new Set(myClasses.map((c) => c.subject))];

// ---------- 헤더 ----------
function renderNav() {
  const nav = $("studyNav");
  nav.style.display = "flex";
  nav.innerHTML = me
    ? `<button class="study-btn primary" id="btnStudy">📋 수행평가</button>
       <button class="study-btn" id="btnAcct">${esc(me.name)}${me.is_admin ? " ⭐" : ""}</button>`
    : `<button class="study-btn" id="btnLogin">🔑 로그인 / 회원가입</button>`;
  if (me) {
    $("btnStudy").onclick = () => openStudy(null);
    $("btnAcct").onclick = () => {
      if (confirm(`${me.name} (${me.username}) 계정에서 로그아웃할까요?`)) logout();
    };
  } else {
    $("btnLogin").onclick = () => openAuth("login");
  }
  renderBoard();
}

// ---------- 수강 분반 박스 (검색창 아래) ----------
function renderBoard() {
  const el = $("classBoard");
  if (!el) return;
  if (!me) { el.className = "class-board"; el.innerHTML = ""; return; }
  const now = new Date();
  el.className = "class-board show";
  el.innerHTML = `
    <div class="class-board-head">${me.student_id ? "내 수강 과목" : "전체 분반"}<span>${myClasses.length}개 · 눌러서 분반 공지 보기</span></div>
    <div class="class-grid">${myClasses.map((c, i) => {
      const upcoming = cache.items.filter((a) => appliesTo(a, c) && new Date(a.due_at) >= now);
      const next = upcoming[0] ? dueInfo(upcoming[0].due_at) : null;
      return `<button class="class-box${upcoming.length ? " has" : ""}${sameClass(c, current) ? " on" : ""}" data-i="${i}">
        <span class="cb-subj">${esc(c.subject)}</span>
        <span class="cb-ban">${esc(c.ban)}</span>
        <span class="cb-meta">${next
          ? `<span class="due-badge ${next.tone}">${next.label}</span>공지 ${upcoming.length}건`
          : "공지 없음"}</span>
      </button>`;
    }).join("")}</div>`;
  el.querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = () => openStudy(myClasses[+b.dataset.i]);
  });
}

async function logout() {
  await sb.auth.signOut();
  me = null; myClasses = []; current = null; closeStudy(); renderNav();
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

// ---------- 수행평가 화면 ----------
// cls 를 주면 그 분반 공지만, 없으면 내 전체 공지
function openStudy(cls) {
  current = cls && cls.subject ? cls : null;
  $("result").classList.remove("show");
  $("welcomeState").style.display = "none";
  $("studyView").style.display = "block";
  renderStudy();
  renderBoard();
  if (current) $("studyView").scrollIntoView({ behavior: "smooth", block: "start" });
  loadAssignments();
}
function closeStudy() {
  current = null;
  $("studyView").style.display = "none";
  if (!$("result").classList.contains("show")) $("welcomeState").style.display = "";
  renderBoard();
}
window.closeStudyView = closeStudy;

function renderStudy() {
  const pushState = Notification.permission === "granted" ? "on" : "off";
  $("studyView").innerHTML = `
    <div class="study-head">
      <div>
        <h2>${current ? esc(current.subject) : "수행평가"}</h2>
        <div class="study-sub">${current
          ? `${esc(current.ban)} 공지`
          : me.student_id
            ? `${esc(me.name)} · 내가 듣는 ${myClasses.length}과목`
            : `관리자 (${esc(me.username)}) · 전체 ${mySubjects().length}과목`}</div>
      </div>
      <button class="study-btn" onclick="closeStudyView()">✕ 닫기</button>
    </div>
    <div class="study-row">
      <button class="study-btn ${pushState === "on" ? "on" : "primary"}" id="btnPush">
        ${pushState === "on" ? "🔔 알림 켜짐" : "🔔 기한 알림 받기"}
      </button>
      <button class="study-btn" id="btnNew">+ 공지 추가</button>
      ${current ? '<button class="study-btn" id="btnAll">전체 공지 보기</button>' : ""}
      ${me.is_admin ? '<button class="study-btn admin" id="btnAdmin">⭐ 승인 대기 <span id="pendCount">0</span></button>' : ""}
    </div>
    <div id="studyBody"><div class="study-empty">불러오는 중…</div></div>`;
  $("btnPush").onclick = enablePush;
  $("btnNew").onclick = openNewForm;
  if (current) $("btnAll").onclick = () => openStudy(null);
  if (me.is_admin) $("btnAdmin").onclick = () => renderList("admin");
}

async function loadAssignments() {
  const { data, error } = await sb.from("assignments")
    .select("*").order("due_at", { ascending: true });
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
  renderBoard();
  if ($("studyView").style.display === "block") renderList("feed");
}

function card(a, opts = {}) {
  const d = dueInfo(a.due_at);
  const badge = a.status === "approved"
    ? `<span class="due-badge ${d.tone}">${d.label}</span>`
    : `<span class="st-badge ${a.status}">${a.status === "pending" ? "승인 대기" : "반려됨"}</span>`;
  return `<div class="asg-card">
    <div class="asg-top"><span class="asg-subject">${esc(a.subject)} · ${esc(banLabel(a.ban))}</span>${badge}</div>
    <div class="asg-title">${esc(a.title)}</div>
    ${a.body ? `<div class="asg-body">${esc(a.body)}</div>` : ""}
    <div class="asg-due">🗓 ${d.when} 마감</div>
    ${opts.admin ? `<div class="asg-actions">
      <button class="study-btn small ok" data-ok="${a.id}">승인</button>
      <button class="study-btn small no" data-no="${a.id}">반려</button>
    </div>` : ""}
    ${opts.mine && a.status === "pending" ? `<div class="asg-actions">
      <button class="study-btn small no" data-del="${a.id}">취소</button>
    </div>` : ""}
  </div>`;
}

function renderList(mode) {
  const body = $("studyBody");
  if (mode === "admin") {
    body.innerHTML = `<div class="study-section">승인 대기 ${cache.pending.length}건</div>` +
      (cache.pending.length
        ? cache.pending.map((a) => card(a, { admin: true })).join("")
        : `<div class="study-empty">대기 중인 공지가 없어요.</div>`) +
      `<button class="study-btn wide" id="backFeed">← 목록으로</button>`;
    body.querySelectorAll("[data-ok]").forEach((b) => b.onclick = () => review(b.dataset.ok, "approved"));
    body.querySelectorAll("[data-no]").forEach((b) => b.onclick = () => review(b.dataset.no, "rejected"));
    $("backFeed").onclick = () => renderList("feed");
    return;
  }
  const now = new Date();
  const inScope = (a) => !current || appliesTo(a, current);
  const upcoming = cache.items.filter((a) => inScope(a) && new Date(a.due_at) >= now);
  // 분반 화면에서는 지난 공지도 최근 것부터 보여줍니다
  const past = current
    ? cache.items.filter((a) => inScope(a) && new Date(a.due_at) < now).reverse().slice(0, 10)
    : [];
  const mineOpen = (cache.mine || []).filter((a) => a.status !== "approved" && inScope(a));
  body.innerHTML =
    `<div class="study-section">${current ? `${esc(current.subject)} ${esc(current.ban)} · ` : ""}다가오는 수행평가 ${upcoming.length}건</div>` +
    (upcoming.length ? upcoming.map((a) => card(a)).join("")
      : `<div class="study-empty">등록된 공지가 없어요.<br>먼저 올려서 친구들에게 알려주세요.</div>`) +
    (mineOpen.length ? `<div class="study-section">내가 올린 공지</div>` +
      mineOpen.map((a) => card(a, { mine: true })).join("") : "") +
    (past.length ? `<div class="study-section">지난 공지</div>` +
      past.map((a) => card(a)).join("") : "");
  body.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => removeItem(b.dataset.del));
}

function openNewForm() {
  const body = $("studyBody");
  const now = new Date(Date.now() + 7 * 86400000 - new Date().getTimezoneOffset() * 60000);
  // 학생은 자기 분반만, 관리자는 과목마다 "전체 분반" + 각 분반
  const opts = me.is_admin
    ? mySubjects().flatMap((s) => [{ subject: s, ban: null },
        ...myClasses.filter((c) => c.subject === s)])
    : myClasses;
  const sel = Math.max(0, opts.findIndex((o) => sameClass(o, current)));
  body.innerHTML = `
    <div class="study-section">공지 추가</div>
    <div class="asg-card">
      <label class="study-label">과목 · 분반</label>
      <select class="study-input" id="nClass">
        ${opts.map((o, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${esc(o.subject)} · ${esc(banLabel(o.ban))}</option>`).join("")}
      </select>
      <label class="study-label">제목</label>
      <input class="study-input" id="nTitle" maxlength="120" placeholder="예: 3단원 실험 보고서 제출">
      <label class="study-label">내용 (선택)</label>
      <textarea class="study-input" id="nBody" rows="3" maxlength="2000" placeholder="범위, 제출 방법 등"></textarea>
      <label class="study-label">마감 일시</label>
      <input class="study-input" id="nDue" type="datetime-local" value="${now.toISOString().slice(0, 16)}">
      <div class="study-err" id="nErr"></div>
      <button class="study-submit" id="nSave">제출하기</button>
      <div class="study-foot">${me.is_admin
        ? "관리자 공지는 승인 없이 바로 그 분반 수강생에게 공지돼요."
        : "관리자가 확인하면 같은 분반 친구들에게 공지돼요."}</div>
    </div>
    <button class="study-btn wide" id="backFeed">← 목록으로</button>`;
  $("backFeed").onclick = () => renderList("feed");
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
    toast(me.is_admin ? "바로 공지했어요" : "제출했어요. 승인되면 분반에 공지돼요");
    await loadAssignments();
  };
}

async function review(id, status) {
  const { error } = await sb.from("assignments")
    .update({ status, reviewed_by: me.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return toast("처리하지 못했어요", true);
  toast(status === "approved" ? "승인했어요" : "반려했어요");
  await loadAssignments();
  renderList("admin");
}

async function removeItem(id) {
  if (!confirm("이 공지를 취소할까요?")) return;
  const { error } = await sb.from("assignments").delete().eq("id", id);
  if (error) return toast("취소하지 못했어요", true);
  await loadAssignments();
}

// ---------- 웹 푸시 ----------
function urlB64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const b64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
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
  toast("기한이 가까워지면 알려드릴게요");
  renderStudy(); loadAssignments();
}

init();
