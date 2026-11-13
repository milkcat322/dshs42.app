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
let cache = { items: [], pending: [], mine: [], events: [], done: new Set(), people: new Map(), todos: null, todoGroups: null, school: [] };
let page = "cal";       // 열린 탭: cal(내 일정) | notice(수행평가) | todo(할 일)
let view = "feed";      // studyBody 에 떠 있는 화면: feed | notice | form | todo
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
// 새 버전으로 다시 열기(index.html 의 서비스 워커 부분)는 로그인 확인이 끝난 뒤에 합니다.
// 로그인 토큰을 받거나(dshs.app 로그인에서 돌아온 직후) 새로 받는 중에 다시 열면, 받은 토큰을 저장하지 못해 로그아웃됩니다.
let authSettled;
window.dshsSettled = new Promise((r) => { authSettled = r; });
async function init() {
  try { await startApp(); } finally { authSettled(); }
}
async function startApp() {
  if (!ENABLED) { $("studyNav").style.display = "none"; return; }
  if (DEMO) return startDemo();
  if (dshsPopupLanding()) closeDshsPopup();   // 앱이 연 로그인 창이면 화면을 그리기 전에 바로 닫습니다
  silentReturned();   // 조용한 로그인에서 돌아왔으면 원래 주소로 (토큰은 # 뒤에 남겨 아래 dshsSession 이 씀)
  // 로그인 기록이 없으면 검색창이 잠깐 보였다 사라지지 않도록 처음부터 로그인 안내를 띄웁니다
  let saved = false;
  try { saved = !!localStorage.getItem("dshs-study-auth"); } catch {}
  applyAccess(!saved);
  // 지난번 화면을 서버 응답 없이 바로 그립니다. 아래에서 서버에 확인되면 새 내용으로 바꿉니다.
  const fromSnap = saved && loadSnap();
  if (fromSnap) { renderNav(); openStart(); }
  window.addEventListener("offline", () => applyAccess());
  window.addEventListener("online", backOnline);
  // 오프라인 화면인 채로 앱으로 돌아오면 기다리지 않고 바로 다시 확인합니다 (로그인 기능을 못 불러온 경우 포함)
  document.addEventListener("visibilitychange", () => { if (!document.hidden && netDown) watchNet(300); });
  // ?bundle: 여러 파일을 차례로 받지 않고 한 파일로 받습니다 (index.html 의 modulepreload 와 같은 주소)
  // esm.sh 가 잠깐 안 되면 같은 버전을 jsdelivr 에서 받습니다 (한 번 실패한 주소는 브라우저가 다시 받지 않으므로 다른 주소로)
  let createClient;
  for (const url of ["https://esm.sh/@supabase/supabase-js@2.45.4?bundle", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"]) {
    try { ({ createClient } = await import(url)); break; } catch {}
  }
  if (!createClient) {
    netDown = true;   // 인터넷 없이 처음 열어 로그인 기능을 못 불러왔으면 검색만 씁니다 (지난 화면의 내 시간표는 그대로)
    applyAccess();
    return watchNet();   // 와이파이가 붙어 있어 'online' 이벤트가 오지 않아도 다시 확인해 돌아옵니다
  }
  $("gateLogin").onclick = gateLogin;
  $("gateAdmin").onclick = openAdminLogin;
  sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "dshs-study-auth" },
    global: { fetch: authFetch },
  });

  sbReady();

  await dshsSession();   // dshs.app 으로 로그인하고 돌아온 경우
  const { data: { session }, error: sessErr } = await sb.auth.getSession();   // ← 자동 로그인
  const shownId = me?.id, shownSid = me?.student_id;
  if (session) await loadProfile();
  else if (me && !(sessErr && isNetErr(sessErr))) { me = null; myClasses = []; clearSnap(); }   // 로그인이 끝남
  else if (me) netTrouble();   // 서버에 닿지 못함 → 지난 화면 유지 (정말 끊겼을 때만 오프라인 화면)
  if (!session && !sessErr && await silentLogin()) return;   // dshs.app 에 로그인돼 있는지 보러 갑니다 (페이지를 떠남)
  // 로그인 기록은 남아 있는데 서버가 잠깐 답하지 못했으면 조금 뒤 다시 확인합니다
  if ((session ? loadProfile.failed : sessErr && isNetErr(sessErr)) && authUserId()) retryAuth();
  renderNav();
  if (me) loadAssignments();
  if (me) setTimeout(maybeInstallAsk, 4000);   // 브라우저로 열었으면 하루 한 번 앱 설치 안내
  checkFbReplies();

  logVisit();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    logVisit();
    checkFbReplies();
    if (retryAuth.t) retryAuth(300);   // 앱으로 돌아오면 기다리지 않고 바로 다시 확인
  });
  sb.auth.onAuthStateChange(async (evt) => {
    if (evt === "SIGNED_OUT") { me = null; myClasses = []; dshs = dshsEmpty(); seatShares = new Map(); seatAt = 0; seatNeed = null; clearSnap(); learnBm.known = {}; renderNav(); }
    if (evt === "SIGNED_IN") { learnBm.known = {}; setTimeout(logVisit, 1000); }   // 프로필을 읽은 뒤 (관리자면 세지 않도록) · 다른 계정일 수 있어 북마크는 새로 받음
  });
  // 검색으로 다른 시간표를 띄우거나 숨기면 "내 시간표" 탭 강조를 다시 맞춥니다
  // 학생 이름 옆 위치(data-st)도 새로 그려진 화면에 채웁니다
  new MutationObserver(() => { if (me) { renderNav(); paintStatus($("result")); } })
    .observe($("result"), { childList: true, attributes: true, attributeFilter: ["class"] });

  // 지난 화면을 이미 띄웠으면 다른 계정으로 바뀐 경우에만 다시 엽니다
  if (!fromSnap || (me && (me.id !== shownId || me.student_id !== shownSid))) openStart();
  dshsReturned();
  watchDshs();
  watchStatus();
}

// ---------- 데모 (?demo) ----------
// 선생님께 보여 드리는 화면. 주소에 ?demo 가 있으면 index.html 이 demo-data.js(scripts/make-demo.mjs 로 만든 한 학생의 자료)를
// 불러 window.DSHS_DEMO 가 생기고, 서버에 연결하지 않고 그 자료로 로그인한 학생 화면을 그대로 보여 줍니다.
// 눌러서 추가 · 수정 · 삭제해도 이 창 안에서만 바뀌고 실제 DB 에는 아무것도 보내지 않습니다 (새로고침하면 처음으로).
const DEMO = window.DSHS_DEMO || null;
function demoClient(d) {
  const T = structuredClone(d.tables);
  const uid = d.uid;
  let seq = 0;
  const newRow = (table, r) => ({ id: `demo-${++seq}`, created_at: new Date().toISOString(), user_id: uid, ...r });
  const query = (table) => {
    const q = { op: "select", filters: [], single: false, rows: null };
    const rowsOf = () => (T[table] ||= []);
    const match = (r) => q.filters.every(([k, op, v]) => op === "eq" ? String(r[k]) === String(v) : op === "in" ? v.map(String).includes(String(r[k])) : op === "is" ? (r[k] ?? null) === v : true);
    const run = () => {
      let data;
      if (q.op === "select") data = rowsOf().filter(match);
      else if (q.op === "insert" || q.op === "upsert") { const add = q.rows.map((r) => newRow(table, r)); rowsOf().push(...add); data = add; }
      else if (q.op === "update") { data = rowsOf().filter(match); data.forEach((r) => Object.assign(r, q.rows)); }
      else if (q.op === "delete") { data = rowsOf().filter(match); T[table] = rowsOf().filter((r) => !match(r)); }
      data = structuredClone(data);
      return { data: q.single ? data[0] ?? null : data, error: null };
    };
    const b = new Proxy({}, {
      get(_, k) {
        if (k === "then") return (ok, bad) => Promise.resolve().then(run).then(ok, bad);
        if (k === "insert" || k === "upsert") return (rows) => { q.op = k; q.rows = [].concat(rows); return b; };
        if (k === "update") return (patch) => { q.op = "update"; q.rows = patch; return b; };
        if (k === "delete") return () => { q.op = "delete"; return b; };
        if (k === "eq" || k === "in" || k === "is") return (col, v) => { q.filters.push([col, k, v]); return b; };
        if (k === "single" || k === "maybeSingle") return () => { q.single = true; return b; };
        return () => b;   // select · order · limit · neq 등은 그대로 (select 는 위에서 op 를 바꾸지 않음)
      },
    });
    return b;
  };
  const session = { access_token: "demo", user: { id: uid } };
  return {
    from: query,
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => ({ upload: async () => ({ data: null, error: null }), createSignedUrl: async () => ({ data: null, error: null }) }) },
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      refreshSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { location.href = location.pathname; return { error: null }; },
      signInWithPassword: async () => ({ error: { message: "demo" } }),
      verifyOtp: async () => ({ error: { message: "demo" } }),
    },
  };
}
async function startDemo() {
  sb = demoClient(DEMO);
  sbReady();
  $("gateLogin").onclick = () => toast("데모 화면이에요");
  $("gateAdmin").onclick = () => toast("데모 화면이에요");
  dshs.linked = true;   // dshs.app 연결 안내가 뜨지 않게 (신청 내역은 비움)
  await loadProfile();
  applyAccess(false);
  renderNav();
  await loadAssignments();
  openStart();
  document.body.insertAdjacentHTML("beforeend",
    `<div class="demo-badge">데모 화면 · 바꾼 내용은 저장되지 않아요</div>`);
}

// 알림을 누르고 들어오면 그 탭으로, 아니면 내 시간표로 시작합니다
function openStart() {
  const q = new URLSearchParams(location.search);
  const opened = q.get("view");
  if (me?.is_admin) openAdminMoved();
  else if (me && opened === "assignments") openAsgLink(q.get("asg"));
  else if (me && opened === "cal") openStudy("cal");
  else if (me && opened === "feedback") openFeedbackLink();
  else if (me?.student_id) openMyTimetable();
}

// 답장 알림으로 들어오면 피드백 창을 엽니다 (주소의 view 는 지워 새로고침해도 다시 뜨지 않게)
function openFeedbackLink() {
  if (me?.student_id && !$("result")?.innerHTML) openMyTimetable();
  try {
    const u = new URL(location.href);
    if (u.searchParams.get("view") === "feedback") {
      u.searchParams.delete("view");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  } catch {}
  openFeedback();
}

// 수행평가 알림으로 들어오면 수행평가 탭을 열고, asg 가 있으면 그 수행평가 자세히 보기까지 엽니다
// (목록이 아직 안 왔으면 받아진 뒤 한 번만. 못 찾으면 탭만 보여 줍니다)
async function openAsgLink(id) {
  openStudy("notice");
  if (!id) return;
  const clean = () => {
    try {
      const u = new URL(location.href);
      u.searchParams.delete("view"); u.searchParams.delete("asg");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch {}
  };
  try {
    let a = findAsg(id);
    if (!a) { await loadAssignments({ quiet: true }); a = findAsg(id); }
    if (a && me) openAsgDetail(a);
  } finally { clean(); }
}

// 이미 열려 있는 창에 서비스 워커가 알림 주소를 보내면 새로고침 없이 그 화면으로 갑니다
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type !== "open-url" || !me) return;
    try {
      const u = new URL(e.data.url, location.origin);
      if (u.origin !== location.origin) return;
      const v = u.searchParams.get("view");
      if (me.is_admin) return;
      if (v === "assignments") openAsgLink(u.searchParams.get("asg"));
      else if (v === "cal") openStudy("cal");
      else if (v === "feedback") openFeedbackLink();
    } catch {}
  });
}

// 관리 기능(관리 탭 · 학교 일정 관리)은 관리자 사이트(admin/ · CFG.ADMIN_URL)로 옮겼습니다.
// 관리자 계정으로 학생 사이트에 들어오면 관리자 사이트로 안내하고, 이 기기로 관리자 알림이 오지 않게 등록을 지웁니다.
const ADMIN_URL = CFG.ADMIN_URL || "https://dshs42-admin.netlify.app";
function openAdminMoved() {
  if (sb) forgetPush();
  openSheet("관리자 계정", `
    <div class="asg-body">관리 기능(수행평가 승인 · 피드백 · 학생 현황 · 학교 일정 관리)은 관리자 사이트로 옮겼어요. 관리자 알림도 관리자 사이트에서 켜요.</div>
    <a class="study-submit" href="${esc(ADMIN_URL)}" style="display:block;text-align:center;text-decoration:none">관리자 사이트 열기</a>
    <button class="study-submit ghost" id="amLogout">이 사이트에서 로그아웃</button>`);
  $("amLogout").onclick = () => { closeModal(); logout(); };
}

// ---------- 지난 화면 먼저 ----------
// 로그인한 학생이 열 때 서버를 기다리지 않도록, 마지막으로 받은 내 정보 · 수행평가 · 일정 · 위치를
// 이 기기에 남겨 두고(SNAP_KEY) 다음에 열면 그것으로 먼저 그립니다. 서버 응답이 오면 새 내용으로 바꿉니다.
// 로그아웃하거나 다른 계정이면 쓰지 않고 지웁니다. 로그인 기록(dshs-study-auth)과 같은 기기에만 남습니다.
const SNAP_KEY = "dshs-snap";
let sbReady;
const sbWait = new Promise((r) => { sbReady = r; });   // 지난 화면을 띄운 뒤 서버 연결이 준비되기 전 눌러도 기다렸다 받습니다
const isNetErr = (e) => /fetch|network|load failed|timeout/i.test(e?.message || "") || e?.status === 0;
function authUserId() {
  try { return JSON.parse(localStorage.getItem("dshs-study-auth"))?.user?.id || null; } catch { return null; }
}

// ---------- 로그인 유지 ----------
// supabase-js 는 로그인 토큰 새로 받기(refresh)가 502 · 503 · 504 말고 다른 서버 오류(요청 한도 429, 500 등)로
// 실패해도 토큰이 무효라고 보고 이 기기의 로그인 기록을 지웁니다. 학교 와이파이처럼 여러 학생이 같은 IP 로
// 한꺼번에 열면 요청 한도에 걸리기 쉬워 "자동 로그인이 풀렸다"가 됩니다.
// 그래서 이런 실패는 '서버에 닿지 못함'으로 바꿔 로그인 기록을 남기고 나중에 다시 받습니다.
// 토큰이 정말 무효일 때(400 등)만 로그아웃됩니다. 한도에 걸리면 잠시 요청을 보내지 않아 한도를 더 쓰지 않습니다.
let refreshPauseUntil = 0;
async function authFetch(input, init) {
  const url = typeof input === "string" ? input : input?.url || String(input);
  if (!/\/auth\/v1\/token\?grant_type=refresh_token/.test(url)) return fetch(input, init);
  if (Date.now() < refreshPauseUntil) throw new TypeError("Failed to fetch (auth busy)");
  const res = await fetch(input, init);
  if (res.status === 429 || res.status >= 500) {
    refreshPauseUntil = Date.now() + (res.status === 429 ? 60000 : 10000);
    throw new TypeError(`Failed to fetch (auth ${res.status})`);
  }
  return res;
}
// 로그인 기록은 있는데 서버가 잠깐 답하지 못한 경우: 점점 간격을 늘려(최대 2분) 다시 확인하고, 되면 내 화면으로 돌아갑니다
function retryAuth(delay = 15000) {
  clearTimeout(retryAuth.t);
  retryAuth.t = setTimeout(async () => {
    retryAuth.t = null;
    if (!authUserId()) return;   // 그사이 로그아웃했거나 토큰이 정말 무효였음
    const { data: { session }, error } = await sb.auth.getSession();
    if (session) {
      await backOnline();
      if (loadProfile.failed) retryAuth(Math.min(delay * 2, 120000));
    } else if (error && isNetErr(error)) retryAuth(Math.min(delay * 2, 120000));
  }, delay);
}
// 브라우저가 저장 공간이 모자랄 때 로그인 기록을 지우지 않도록 요청합니다 (Firefox 는 허락 창이 떠서 빼고, 거절돼도 그대로 씀)
function keepStorage() {
  if (keepStorage.done || /Firefox/.test(navigator.userAgent)) return;
  keepStorage.done = true;
  try { navigator.storage?.persist?.().catch(() => {}); } catch {}
}
function saveSnap() {
  if (DEMO) return;   // 데모 자료를 이 기기의 '지난 화면'으로 남기지 않음
  clearTimeout(saveSnap.t);
  saveSnap.t = setTimeout(() => {
    if (!me) return;
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({
        v: 1, at: Date.now(), me,
        cache: { ...cache, done: [...cache.done], people: [...cache.people], invites: [...(cache.invites || new Map())] },
        status: [...statusMap],
        seats: seatShares ? [...seatShares] : null,
      }));
    } catch {}   // 저장 공간이 모자라면 다음에도 서버를 기다립니다
  }, 400);
}
function loadSnap() {
  try {
    const s = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
    if (s?.v !== 1 || !s.me?.id || s.me.id !== authUserId()) { clearSnap(); return false; }
    setMe(s.me);
    const c = s.cache || {};
    cache = { ...cache, ...c, done: new Set(c.done || []), people: new Map(c.people || []), invites: new Map(c.invites || []) };
    statusMap = new Map(s.status || []);
    if (s.seats) seatShares = new Map(s.seats);
    haveData = !!s.cache;
    return true;
  } catch { return false; }
}
function clearSnap() { try { localStorage.removeItem(SNAP_KEY); } catch {} }

// 방문 기기 수 (visits.sql). 화면에는 아무것도 보이지 않고, 관리자만 관리 탭에서 수를 봅니다.
// 이 기기에 만든 무작위 ID 로 하루 한 번(로그인하면 한 번 더)만 보냅니다. 이름 · 학번은 보내지 않습니다.
// 관리자로 로그인한 적 있는 기기는 로그아웃 상태에서도 세지 않습니다.
const VISIT_KEY = "dshs-visit";
function visitKind() {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/.test(ua) && touch)) return "tablet";
  if (navigator.userAgentData?.mobile || /Mobi|iPhone|iPod|Android/i.test(ua)) return "phone";
  return "pc";
}
async function logVisit() {
  try {
    if (!sb) return;
    const { data: { session } } = await sb.auth.getSession();
    if (session && !me) return;   // 프로필을 아직 못 읽었으면 다음 기회에
    const st = JSON.parse(localStorage.getItem(VISIT_KEY) || "{}");
    if (me?.is_admin) st.skip = true;
    if (st.skip) return localStorage.setItem(VISIT_KEY, JSON.stringify(st));
    const today = dayKey(new Date());
    const login = !!session;
    if (st.day === today && (st.login || !login)) return;
    st.id = visitId();
    const { error } = await sb.rpc("log_visit", { p_device: st.id, p_kind: visitKind(), p_standalone: isStandalone() });
    if (error) return;
    const now = JSON.parse(localStorage.getItem(VISIT_KEY) || "{}");   // 그사이 logGate 가 남긴 값을 지우지 않게 다시 읽습니다
    now.login = (now.day === today && now.login) || login;
    now.day = today;
    localStorage.setItem(VISIT_KEY, JSON.stringify(now));
  } catch {}
}
// 기기 ID 는 바로 저장해 logVisit · logGate 가 동시에 불려도 같은 값을 씁니다
function visitId() {
  const st = JSON.parse(localStorage.getItem(VISIT_KEY) || "{}");
  if (!st.id) {
    st.id = crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(VISIT_KEY, JSON.stringify(st));
  }
  return st.id;
}

// 비로그인 시간표 막힘 화면을 본 날('seen') · 그 화면의 로그인 버튼을 누른 날('click')을 하루 한 번씩 남깁니다 (visits.sql 의 log_gate).
// 사용 분석 에이전트가 "본 기기 → 누른 기기 → 로그인한 기기"로 로그인 유도 효과를 판단합니다. 화면에는 아무것도 보이지 않습니다.
async function logGate(ev) {
  try {
    if (!sb || me) return;
    const key = ev === "click" ? "gateClick" : "gateSeen", today = dayKey(new Date());
    const st = JSON.parse(localStorage.getItem(VISIT_KEY) || "{}");
    if (st.skip || st[key] === today) return;
    const { error } = await sb.rpc("log_gate", { p_device: visitId(), p_kind: visitKind(), p_standalone: isStandalone(), p_event: ev });
    if (error) return;
    const now = JSON.parse(localStorage.getItem(VISIT_KEY) || "{}");
    now[key] = today;
    localStorage.setItem(VISIT_KEY, JSON.stringify(now));
  } catch {}
}

// ---------- 로그인 이탈 기록 (loginsteps.sql) ----------
// 'dshs.app 계정으로 시작하기'를 누른 뒤 어디서 멈췄는지 단계별로 남겨, 관리자 사이트 '학생' 칸의 '로그인 이탈'에서 분석합니다.
// 누를 때 만든 시도 ID 를 이 기기(LOGIN_TRY)에 두고, dshs.app 에서 돌아오면 같은 ID 로 결과를 남깁니다.
// 화면에는 아무것도 보이지 않고, 이름 · 학번은 보내지 않습니다. 실패해도(표가 없는 DB 등) 조용히 넘어갑니다.
const LOGIN_TRY = "dshs-login-try";
function loginEnv() {
  const ua = navigator.userAgent, app = isStandalone();
  if (/KAKAOTALK/i.test(ua)) return "kakao";
  if (/NAVER|Instagram|FBAN|FBAV|Line\//i.test(ua)) return "inapp";
  if (isAppleMobile()) return app ? "ios-app" : /CriOS/.test(ua) ? "ios-chrome" : "ios-safari";
  if (/Android/i.test(ua)) return app ? "android-app" : /SamsungBrowser/i.test(ua) ? "android-samsung" : "android-chrome";
  return app ? "pc-app" : "pc";
}
function loginTry(start) {
  try {
    if (start) {
      const t = { id: crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`, at: Date.now() };
      localStorage.setItem(LOGIN_TRY, JSON.stringify(t));
      return t.id;
    }
    const t = JSON.parse(localStorage.getItem(LOGIN_TRY) || "null");
    return t && Date.now() - t.at < 30 * 60000 ? t.id : null;
  } catch { return null; }
}
// step: click · start_fail · leave · done · fail. 결과(done · fail)를 남기면 시도를 끝냅니다.
// 누른 기록 없이 돌아온 경우(카카오톡에서 눌러 다른 브라우저로 돌아옴 등)는 새 시도로 남깁니다.
function logLogin(step, reason) {
  try {
    if (!sb) return Promise.resolve();
    const attempt = step === "click" ? loginTry(true) : loginTry() || loginTry(true);
    if (step === "done" || step === "fail") localStorage.removeItem(LOGIN_TRY);
    return sb.rpc("log_login_step", { p_device: visitId(), p_attempt: attempt, p_step: step, p_reason: reason || null, p_env: loginEnv() })
      .then(() => {}, () => {});
  } catch { return Promise.resolve(); }
}
// 로그인 주소를 받아 떠나기 직전: 기록을 보낼 틈을 잠깐(최대 0.6초) 줍니다
const logLeave = (how) => Promise.race([logLogin("leave", how), new Promise((ok) => setTimeout(ok, 600))]);

async function loadProfile() {
  // 관리자는 RLS 상 모든 프로필을 볼 수 있으므로 반드시 내 id 로 좁힙니다.
  loadProfile.failed = false;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { me = null; return; }
  const read = () => sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  let { data, error } = await read();
  if (error && !isNetErr(error)) {   // 로그인 토큰이 막 만료된 경우 등: 토큰을 새로 받아 한 번 더 읽습니다
    await sb.auth.refreshSession().catch(() => {});
    ({ data, error } = await read());
  }
  if (error) {   // 서버에 닿지 못했거나 잠깐 실패 → 로그아웃으로 보지 않고, 지난 화면의 내 정보가 이 계정 것이면 그대로 씁니다
    loadProfile.failed = true;
    if (isNetErr(error)) netTrouble();
    if (me?.id !== session.user.id) me = null;
    return;
  }
  if (!data) { me = null; clearSnap(); return; }
  netDown = false;
  setMe(data);
  saveSnap();
  keepStorage();
  if (silentState()?.off) silentState({ off: false });   // 다시 로그인했으니 다음에 로그인 기록이 없어지면 조용한 로그인을 다시 씁니다
}
function setMe(data) {
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

// 수행평가 탭 옆 숫자: 완료 표시를 안 했고 마감이 지금부터 3일(72시간) 안인, 승인된 수행평가 수. 데이터가 없으면 0
function asgSoonCount() {
  if (!haveData || !cache.items) return 0;
  const now = Date.now();
  return noticeItems().filter((a) => a.status === "approved" && !cache.done.has(a.id)
    && dueMs(a) >= now && dueMs(a) <= now + 72 * 3600 * 1000).length;
}

// ---------- 헤더 ----------
function renderNav() {
  const nav = $("studyNav");
  // 로그인 전에는 위쪽 메뉴를 숨깁니다. 시작하기는 시간표 막힘 화면의 버튼 하나뿐이고, 그 아래 작은 관리자 로그인이 있습니다.
  nav.style.display = me ? "flex" : "none";
  const open = $("studyView").style.display === "block";
  // 학생 계정은 맨 왼쪽에 "시간표" (내 시간표 · 검색). 관리자 계정은 관리자 사이트로 안내하는 버튼 하나만
  const tabs = me?.is_admin ? [["moved", "관리자 사이트로"]] : me?.student_id ? [["mytt", "시간표"], ...PAGES] : PAGES;
  const on = (k) => (k === "mytt" ? !open && showingMyTimetable() : open && page === k);
  nav.innerHTML = me
    ? tabs.map(([k, label]) => {
      const n = k === "notice" && !me.is_admin ? asgSoonCount() : 0;
      return `<button class="study-btn${on(k) ? " primary" : ""}" data-page="${k}">${label}${n ? `<span class="tab-count">${n}</span>` : ""}</button>`;
    }).join("")
    : "";
  // 설정(알림 · 학교 일정 · 계정)은 업데이트 옆에 늘 보입니다 (로그인 전에는 관리자 로그인을 여는 곳)
  const set = $("btnSettings");
  set.style.display = "";
  set.onclick = openSettings;
  if (me) {
    nav.querySelectorAll("[data-page]").forEach((b) => b.onclick = () =>
      (b.dataset.page === "mytt" ? openMyTimetable() : b.dataset.page === "moved" ? openAdminMoved() : openStudy(b.dataset.page)));
    if (sb && !me.is_admin) { autoPush(); loadStatus(); }
  }
  applyAccess();
}

// ---------- 인터넷 연결 · 로그인에 따라 보이는 것 ----------
// 인터넷이 없으면 로그인하지 않아도 시간표 검색만 보여 줍니다 (시간표는 index.html 에 들어 있어 오프라인에서도 됨).
// 인터넷이 있으면 시간표 검색은 로그인한 사람만 씁니다. 화면을 숨기는 규칙은 index.html 의 body.offline · body.need-login.
let netDown = false;   // 와이파이에 붙어 있어도(navigator.onLine) 서버에 닿지 못하면 오프라인으로 봅니다
function applyAccess(guest = !me) {
  const off = !navigator.onLine || netDown;
  document.body.classList.toggle("offline", off);
  document.body.classList.toggle("need-login", !off && guest);
  if (!off && guest && !me) logGate("seen");
}
// ---------- 서버에 정말 닿지 않는지 확인 ----------
// 요청 하나가 실패했다고 바로 오프라인 화면으로 바꾸지 않습니다. 와이파이가 멀쩡해도
//  - 아이폰은 앱을 내렸다 올리면 하던 요청이 'Load failed' 로 끝나고,
//  - 학교 와이파이에서 여럿이 한꺼번에 열면 요청 한도(429)에 걸려 '연결 실패'(authFetch)처럼 보이기 때문입니다.
// 서버에 직접 한 번 물어 응답이 오면(오류 응답이어도) 연결된 것으로 보고, 아무 응답이 없을 때만 오프라인으로 바꿉니다.
// 오프라인이 된 뒤에는 15초부터 최대 1분 간격으로, 그리고 화면으로 돌아올 때마다 다시 확인해 닿으면 바로 돌아옵니다.
// (브라우저의 'online' 이벤트는 와이파이가 붙은 채로 서버만 잠깐 안 닿았던 경우에는 오지 않습니다)
async function serverReachable() {
  if (!navigator.onLine) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 7000);
  try {
    await fetch(`${CFG.SUPABASE_URL}/auth/v1/health`, { headers: { apikey: CFG.SUPABASE_ANON_KEY }, cache: "no-store", signal: ctl.signal });
    return true;
  } catch { return false; } finally { clearTimeout(t); }
}
async function netTrouble() {
  if (netTrouble.busy) return;
  netTrouble.busy = true;
  try {
    if (await serverReachable()) {
      if (netDown) netBack();
      return;
    }
    netDown = true;
    applyAccess();
    watchNet();
  } finally { netTrouble.busy = false; }
}
function watchNet(delay = 15000) {
  clearTimeout(watchNet.t);
  watchNet.t = setTimeout(async () => {
    watchNet.t = null;
    if (!netDown) return;
    if (await serverReachable()) netBack();
    else watchNet(Math.min(Math.max(delay, 15000) * 2, 60000));
  }, delay);
}
function netBack() {
  clearTimeout(watchNet.t);
  watchNet.t = null;
  backOnline();
}
// 로그인 기능을 못 불러온 채 다시 연결되면 새로 엽니다. 라이브러리 서버만 안 되는 경우 계속 새로 열지 않게 한 세션에 3번까지
function reloadForNet() {
  let n = 0;
  try { n = +sessionStorage.getItem("dshs-net-reload") || 0; sessionStorage.setItem("dshs-net-reload", String(n + 1)); } catch {}
  if (n < 3) location.reload();
  else { netDown = true; applyAccess(); }
}

// 다시 연결되면: 로그인 기능을 못 불러왔으면 새로 열고, 로그인 기록이 있으면 다시 읽어 내 화면으로 돌아갑니다
async function backOnline() {
  netDown = false;
  if (!sb) return reloadForNet();
  const had = me;
  await loadProfile();   // 지난 화면으로 버티던 중이면 새 내용으로 바꿉니다
  if (me && !had) { renderNav(); loadAssignments(); return openHome(); }
  if (me) { renderNav(); loadAssignments(); loadStatus(true); }
  applyAccess();
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
  $("result").insertAdjacentHTML("afterbegin", '<div class="my-status" id="myStatus"></div>');
  paintStatus();
  $("result").classList.add("show");
  renderNav();
  maybePushCard();
}

// ---------- 마감 알림 받기 카드 ----------
// 알림을 아직 안 켠 기기에 한 번 알려 줍니다. 허락 창은 '알림 받기' 버튼을 누른 뒤에만 뜹니다.
// 기억: localStorage 'dshs-push-card' = {n: 닫은 횟수, at: 마지막으로 닫은 시각} 또는 {done: true}
const PUSH_CARD = "dshs-push-card";
const PUSH_CARD_WAIT = 3 * 86400000;   // '나중에' 뒤 다시 보여 주기까지
function pushCardState() {
  try { return JSON.parse(localStorage.getItem(PUSH_CARD)) || {}; } catch { return {}; }
}
function pushCardSave(s) { try { localStorage.setItem(PUSH_CARD, JSON.stringify(s)); } catch {} }

async function maybePushCard() {
  if (!me || !pushPossible() || !pushWanted()) return;
  if (!("Notification" in window) || Notification.permission !== "default") return;
  const st = pushCardState();
  if (st.done || st.n >= 2) return;
  if (st.n === 1 && Date.now() - (st.at || 0) < PUSH_CARD_WAIT) return;
  await refreshPush().catch(() => {});
  if (pushOn || Notification.permission !== "default") return;
  const anchor = $("myStatus");
  if (!anchor || $("pushCard")) return;   // 그 사이 화면이 바뀐 경우
  anchor.insertAdjacentHTML("afterend",
    '<div class="my-status" id="pushCard"><span id="pushCardMsg">🔔 수행평가 마감 1일 · 6시간 전에 알려 드릴까요?</span>' +
    '<span style="margin-left:auto;display:flex;gap:6px"><button class="study-btn" id="pushCardYes">알림 받기</button>' +
    '<button class="study-btn" id="pushCardLater">나중에</button></span></div>');
  $("pushCardLater").onclick = () => {
    pushCardSave({ n: (st.n || 0) + 1, at: Date.now() });
    $("pushCard")?.remove();
  };
  $("pushCardYes").onclick = async () => {
    const card = $("pushCard");
    const finish = (msg, ms) => {
      if (!card.isConnected) return;
      card.textContent = msg;
      setTimeout(() => card.remove(), ms);
    };
    $("pushCardYes").disabled = true;
    try { await enablePush(); } catch {}
    if (pushOn) {
      try { localStorage.setItem(PUSH_PREF, "on"); } catch {}
      pushCardSave({ done: true });
      finish("🔔 알림이 켜졌어요", 2500);
    } else if (Notification.permission === "denied") {
      pushCardSave({ done: true });
      finish("브라우저 설정에서 알림을 허용해야 해요", 6000);
    } else {
      $("pushCardYes").disabled = false;   // 허락 창을 그냥 닫은 경우 등: 카드는 그대로
    }
  };
}

// ---------- 로그인 직후 안내: 홈 화면에 추가 · 알림 켜기 ----------
// 로그인하고 돌아온 직후 한 번, 이 기기에서 아직 안 한 것만 보여 줍니다 (기억: localStorage ONBOARD_KEY).
// 아이폰은 홈 화면 앱과 Safari 의 저장소가 따로라, 홈 화면 앱에서 다시 로그인하면 그 앱에서 한 번 더 뜹니다 (그때는 알림 켜기만).
// 안드로이드는 브라우저의 설치 창(index.html 의 __deferredInstall)을 띄우고, 아이폰은 그림 안내(iosGuideHtml)를 보여 줍니다.
const ONBOARD_KEY = "dshs-onboard";
const isAndroid = () => /Android/i.test(navigator.userAgent);
async function maybeOnboard() {
  if (!me || me.is_admin || !me.student_id || !navigator.onLine) return;
  try { if (localStorage.getItem(ONBOARD_KEY)) return; } catch { return; }
  // 다른 창(자리 공개 동의 등)이 떠 있으면 닫힐 때까지 기다립니다 (최대 3분)
  if ($("studyModal").classList.contains("show")) {
    maybeOnboard.n = (maybeOnboard.n || 0) + 1;
    if (maybeOnboard.n < 120) setTimeout(maybeOnboard, 1500);
    return;
  }
  await refreshPush().catch(() => {});   // 켜져 있는지 확인 + 아이폰이 누르자마자 구독할 수 있게 등록 정보를 받아 둠
  const home = !isStandalone() && (isAppleMobile() || isAndroid()) && !/KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);
  const push = !pushOn && pushPossible() && "Notification" in window && Notification.permission !== "denied";
  const iosPushLater = isAppleMobile() && !isStandalone();   // 아이폰 · 아이패드는 홈 화면 앱에서만 알림
  if (!home && !push && !iosPushLater) return;
  if ($("studyModal").classList.contains("show")) return;
  try { localStorage.setItem(ONBOARD_KEY, String(Date.now())); } catch {}
  const steps = [];
  if (home) {
    const deferred = window.__deferredInstall;
    steps.push(`<b>홈 화면에 추가하기</b>
      <div class="ev-hint">앱처럼 바로 열리고, 인터넷이 없어도 시간표를 볼 수 있어요</div>
      ${isAppleMobile() ? iosGuideHtml()
        : deferred ? '<button class="study-btn ok" id="onbInstall">앱 설치</button>'
        : `<div class="onb-text">브라우저 메뉴(<b>⋮</b> 또는 <b>≡</b>)에서 <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요</div>`}`);
  }
  if (push) {
    steps.push(`<b>알림 켜기</b>
      <div class="ev-hint">수행평가 마감 1일 · 6시간 전, 일정 30분 전에 알려 줘요</div>
      <button class="study-btn ok" id="onbPush">🔔 알림 켜기</button>`);
  } else if (iosPushLater) {
    steps.push(`<b>알림 켜기</b>
      <div class="ev-hint">아이폰은 홈 화면에 추가한 앱에서만 알림을 켤 수 있어요</div>
      <div class="onb-text">홈 화면에 생긴 <b>dshs42</b> 아이콘으로 열고 <b>dshs.app 계정으로 시작하기</b>를 한 번 더 누르면, 여기서 알림을 켤 수 있어요</div>`);
  }
  openSheet("앱처럼 쓰기", `
    <div class="asg-body">로그인했어요! 두 가지만 해 두면 더 편하게 쓸 수 있어요.</div>
    ${steps.map((s, i) => `<div class="onb-step"><div class="ios-num">${i + 1}</div><div class="onb-body">${s}</div></div>`).join("")}
    <button class="study-submit ghost" id="onbLater">나중에 할게요</button>
    <div class="study-foot">설정(⚙️)에서 언제든 알림을 켜고 끌 수 있어요.</div>`);
  $("onbLater").onclick = closeModal;
  if ($("onbInstall")) $("onbInstall").onclick = async () => {
    const d = window.__deferredInstall;
    if (!d) return toast("브라우저 메뉴에서 '홈 화면에 추가'를 눌러 주세요");
    try {
      d.prompt();
      const res = await d.userChoice;
      window.__deferredInstall = null;
      if (res?.outcome === "accepted" && $("onbInstall")) $("onbInstall").outerHTML = '<div class="onb-text">✅ 설치했어요</div>';
    } catch { window.__deferredInstall = null; }
  };
  if ($("onbPush")) $("onbPush").onclick = async () => {
    const b = $("onbPush");
    b.disabled = true;
    try { await enablePush(); } catch {}
    if (pushOn) {
      try { localStorage.setItem(PUSH_PREF, "on"); } catch {}
      pushCardSave({ done: true });
      $("pushCard")?.remove();
      if (b.isConnected) b.outerHTML = '<div class="onb-text">🔔 알림이 켜졌어요</div>';
      paintPush();
    } else {
      b.disabled = false;
      if ("Notification" in window && Notification.permission === "denied") b.outerHTML = '<div class="onb-text">알림이 차단돼 있어요. 브라우저 설정에서 이 사이트 알림을 허용해 주세요</div>';
    }
  };
}

// ---------- 앱으로 설치 안내 ----------
// 휴대폰 · 태블릿 브라우저로 열었으면(홈 화면 앱이 아니면) 하루 한 번 팝업으로 설치(홈 화면에 추가)를 안내합니다.
// 기억: 기기마다 INSTALL_ASK_KEY(본 날짜). 로그인 직후 안내(maybeOnboard)를 오늘 이미 봤으면 띄우지 않습니다.
// 카카오톡 등 앱 안 브라우저에서는 설치가 안 되므로 띄우지 않습니다.
const INSTALL_ASK_KEY = "dshs-install-ask";
function maybeInstallAsk() {
  if (!me || me.is_admin || isStandalone() || !(isAppleMobile() || isAndroid())) return;
  if (/KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent)) return;
  const today = dayKey(new Date());
  try {
    if (localStorage.getItem(INSTALL_ASK_KEY) === today) return;
    const onb = +localStorage.getItem(ONBOARD_KEY);
    if (onb && dayKey(new Date(onb)) === today) return;
  } catch { return; }
  // 다른 창(업데이트 소식 · 자리 공개 동의 등)이 떠 있으면 닫힐 때까지 기다립니다 (최대 3분)
  if (["studyModal", "updModal"].some((id) => $(id)?.classList.contains("show")) || document.hidden) {
    maybeInstallAsk.n = (maybeInstallAsk.n || 0) + 1;
    if (maybeInstallAsk.n < 120) setTimeout(maybeInstallAsk, 1500);
    return;
  }
  try { localStorage.setItem(INSTALL_ASK_KEY, today); } catch {}
  const deferred = window.__deferredInstall;
  openSheet("앱으로 설치하기", `
    <div class="asg-body">아직 브라우저로 열고 있어요. 홈 화면에 추가하면 앱처럼 바로 열리고, 인터넷이 없어도 시간표를 볼 수 있어요.${isAppleMobile() ? " 아이폰은 홈 화면 앱에서만 알림을 받을 수 있어요." : ""}</div>
    ${isAppleMobile() ? iosGuideHtml()
      : deferred ? '<button class="study-submit" id="iaInstall">앱 설치</button>'
      : `<div class="onb-text">브라우저 메뉴(<b>⋮</b> 또는 <b>≡</b>)에서 <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요</div>`}
    <button class="study-submit ghost" id="iaLater">나중에 할게요</button>`);
  $("iaLater").onclick = closeModal;
  if ($("iaInstall")) $("iaInstall").onclick = async () => {
    const d = window.__deferredInstall;
    if (!d) return toast("브라우저 메뉴에서 '홈 화면에 추가'를 눌러 주세요");
    try {
      d.prompt();
      const res = await d.userChoice;
      window.__deferredInstall = null;
      if (res?.outcome === "accepted") { closeModal(); toast("설치했어요. 홈 화면의 아이콘으로 열어 주세요"); }
    } catch { window.__deferredInstall = null; }
  };
}

// 아이폰 · 아이패드: 홈 화면에 추가하는 방법을 그림으로 (로그인 직후 안내 · 설정 창)
function iosGuideHtml() {
  const fig = (svg, cap, n) => `<figure class="ig-fig"><svg viewBox="0 0 240 92" role="img" aria-label="${esc(cap.replace(/<[^>]+>/g, ""))}">${svg}</svg><figcaption><span class="ios-num">${n}</span><span>${cap}</span></figcaption></figure>`;
  const share = (x, y, cls = "ig-ic") => `<g class="${cls}" transform="translate(${x} ${y})"><path d="M-6 -2 v10 h12 v-10"/><path d="M0 -10 v12 M-4 -6 l4 -4 l4 4"/></g>`;
  const plusBox = (x, y) => `<g class="ig-ic" transform="translate(${x} ${y})"><rect x="-7" y="-7" width="14" height="14" rx="3"/><path d="M0 -4 v8 M-4 0 h8"/></g>`;
  // 1. Safari 아래 막대의 공유 버튼
  const s1 = `<rect class="ig-bg" x="8" y="10" width="224" height="34" rx="17"/><text class="ig-dim" x="120" y="31" text-anchor="middle">dshs42.app</text>
    <rect class="ig-bg" x="8" y="52" width="224" height="34" rx="10"/>
    <g class="ig-ic"><path d="M36 62 l-6 7 l6 7"/><path d="M76 62 l6 7 l-6 7"/></g>
    ${share(120, 71, "ig-ic ig-hi")}<circle class="ig-ring" cx="120" cy="69" r="15"/>
    <g class="ig-ic"><path d="M158 63 q6 -2 8 1 q2 -3 8 -1 v12 q-6 -2 -8 1 q-2 -3 -8 -1 z"/><rect x="196" y="62" width="12" height="12" rx="2"/><rect x="200" y="58" width="12" height="12" rx="2"/></g>`;
  // 2. 공유 목록의 '홈 화면에 추가'
  const row = (y, t, icon, hi) => `<rect class="${hi ? "ig-hirow" : "ig-bg"}" x="20" y="${y}" width="200" height="24" rx="6"/><text class="${hi ? "ig-t" : "ig-dim"}" x="32" y="${y + 16}">${t}</text>${icon(204, y + 12)}`;
  const s2 = row(6, "복사", (x, y) => `<g class="ig-ic" transform="translate(${x} ${y})"><rect x="-6" y="-4" width="9" height="10" rx="2"/><rect x="-3" y="-7" width="9" height="10" rx="2"/></g>`)
    + row(34, "홈 화면에 추가", plusBox, true)
    + row(62, "즐겨찾기 추가", (x, y) => `<g class="ig-ic" transform="translate(${x} ${y})"><path d="M0 -7 l2 5 h5 l-4 3 l2 6 l-5 -4 l-5 4 l2 -6 l-4 -3 h5 z"/></g>`);
  // 3. 오른쪽 위 '추가'
  const s3 = `<rect class="ig-bg" x="8" y="6" width="224" height="80" rx="12"/>
    <text class="ig-dim" x="22" y="27">취소</text><text class="ig-t" x="120" y="27" text-anchor="middle">홈 화면에 추가</text>
    <text class="ig-hit" x="216" y="27" text-anchor="end">추가</text><rect class="ig-ring" x="186" y="12" width="38" height="22" rx="11"/>
    <rect class="ig-icon" x="22" y="44" width="30" height="30" rx="8"/><text class="ig-icon-t" x="37" y="64" text-anchor="middle">42</text>
    <text class="ig-t" x="62" y="56">dshs42</text><text class="ig-dim" x="62" y="71">https://dshs42.app</text>`;
  return `<div class="ig">
    ${fig(s1, "Safari 아래쪽의 <b>공유</b> 버튼을 눌러요. 안 보이면 주소창 옆 <b>⋯</b> 를 먼저 눌러요", 1)}
    ${fig(s2, "목록을 아래로 내려 <b>홈 화면에 추가</b>를 눌러요", 2)}
    ${fig(s3, "오른쪽 위 <b>추가</b>를 누르면 끝! 홈 화면의 아이콘으로 열어요", 3)}
    <div class="study-foot">크롬이면 주소창 오른쪽의 공유 버튼에서 같은 순서로 할 수 있어요.</div>
  </div>`;
}
function openIosGuide() { openSheet("홈 화면에 추가하기", iosGuideHtml()); }
// 설정 창: 아이폰 · 아이패드 브라우저에서만 '홈 화면에 추가하는 방법' (안드로이드는 위쪽 설치 막대가 있음)
const homeGuideHtml = () => (isAppleMobile() && !isStandalone()
  ? '<button class="study-btn wide" id="setHomeGuide" type="button">📲 홈 화면에 추가하는 방법</button>' : "");
function bindHomeGuide() { if ($("setHomeGuide")) $("setHomeGuide").onclick = openIosGuide; }

// ---------- 내 위치 ----------
// 수업에 빠진 학생을 세기 쉽도록 각자 지금 있는 곳을 남깁니다 (status.sql). 로그인한 학생 모두가 봐요.
// index.html 은 학생 이름 옆에 <span class="st-loc" data-st="학번"></span> 자리만 두고, 여기서 채웁니다.
const PLACES = ["자습실 자리", "빈백", "하늘마루", "기숙사"];
const STATUS_OLD = 6 * 3600000;   // 이보다 오래된 위치는 흐리게
let statusMap = new Map();
let statusAt = 0;

async function loadStatus(force = false) {
  if (!me || (!force && Date.now() - statusAt < 55000)) return;
  statusAt = Date.now();
  const [st, sh] = await Promise.all([
    sb.from("student_status").select("student_id, location, updated_at"),
    sb.from("seat_shares").select("student_id, public, asked, seat, seat_day"),
  ]);
  if (st.error) return;   // status.sql 을 아직 실행하지 않았으면 위치 없이 보여 줍니다
  statusMap = new Map(st.data.map((r) => [r.student_id, r]));
  seatShares = sh.error ? null : new Map(sh.data.map((r) => [r.student_id, r]));   // null = seats.sql 전
  paintStatus();
  saveSnap();
  loadMySeat();
  if (!askSeatConsent.t) askSeatConsent.t = setTimeout(askSeatConsent, 2500);   // 첫 화면이 뜬 뒤 한 번
}

// ---------- 자습실 자리 (seats.sql) ----------
// dshs.app 은 다른 학생의 자리를 주지 않으므로(개인정보처리방침), 각자 자기 기기에서 내 자리(reservation.read.me)를 받아
// seat_shares 에 남깁니다 (dshs-oauth 의 myseat. 학생은 public 만 바꾸고 자리는 서버만 씀).
// 자리는 본인이 보여 주기로 한 학생 것만 보입니다: 위치가 '자습실 자리'이거나 '내 자습실 자리 공개'를 켬 (DB 권한으로 막음).
// 자리는 목요일 밤에 신청해 금요일 15시(한국 시간)부터 한 주 동안 이어지므로, 주에 한 번만 받습니다
// (seat_day = 가장 최근 '금요일 15시'의 금요일 날짜. dshs-oauth 의 seatWeek 와 같은 계산).
let seatShares = new Map();       // 학번 → { public, seat, seat_day } (읽을 수 있는 것만)
let seatNeed = null;              // "relink" · "link" · "error" · "off": 내 자리를 못 받은 이유
let seatAt = 0;
const kstDay = (back = 0) => new Date(Date.now() + 9 * 3600000 - back * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
function seatWeek() {
  const k = new Date(Date.now() + 9 * 3600000);
  let back = (k.getUTCDay() - 5 + 7) % 7;          // 5 = 금요일
  if (back === 0 && k.getUTCHours() < 15) back = 7; // 금요일 15시 전이면 지난주 금요일
  return kstDay(back);
}
const SEAT_PLACE = PLACES[0];     // "자습실 자리"
// 내 자리를 받아야 하는지: 위치가 '자습실 자리'이거나 공개를 켰을 때
const seatWanted = (sid) => statusMap.get(sid)?.location === SEAT_PLACE || !!seatShares?.get(sid)?.public;

async function loadMySeat(force = false) {
  const sid = me?.student_id;
  if (!sid || !seatShares || !seatWanted(sid) || dshs.linked === false) return;
  const sh = seatShares.get(sid);
  // 이번 주 자리를 받았으면 다시 받지 않고, 못 찾았으면(신청 없음) 열 때 한 번 · 그 뒤 10분마다 다시 찾습니다
  if (!force && sh?.seat_day === seatWeek() && (sh.seat || Date.now() - seatAt < 600000)) return;
  if (!force && Date.now() - seatAt < DSHS_GAP) return;
  seatAt = Date.now();
  try {
    const { body } = await dshsCall("myseat");
    if (body.off) { seatAt = Date.now() + 3600000; seatNeed = "off"; }   // 서버가 아직 자리를 받지 않음
    else if (body.linked === false) { dshs.linked = false; seatNeed = "link"; }
    else {
      seatNeed = body.need || (body.error ? "error" : null);
      if (body.error === "busy") seatAt = Date.now() + DSHS_REST - DSHS_GAP;
      if (body.day) seatShares.set(sid, { public: false, ...seatShares.get(sid), student_id: sid, seat: body.seat || null, seat_day: body.day });
    }
  } catch { seatAt = 0; seatNeed = "error"; }
  paintStatus();
  saveSnap();
}

// 그 학생의 보이는 자리 (본인이 보여 주기로 했을 때만. 다른 학생 것은 DB 가 이미 걸러 줌)
const seatInfo = (sid) => {
  const sh = seatShares?.get(sid);
  return sh?.seat && seatWanted(sid) ? sh : null;
};
// 누르면 자습실 배치도에 그 자리를 표시한 창을 띄웁니다. 배치도에 없는 자리(세미나실 s… 등)는 창 없이 dshs.app 좌석 배치도로 갑니다.
const seatUrl = (seat, day) => `https://dshs.app/reserve/${encodeURIComponent(day)}?goto=${encodeURIComponent(seat)}`;
const seatLink = (sh) => `<a class="st-seat" href="${seatUrl(sh.seat, sh.seat_day)}" target="_blank" rel="noopener"
  data-seat="${esc(sh.seat)}" data-day="${esc(sh.seat_day)}" onclick="return seatClick(event, this)">${esc(sh.seat)}</a>`;
// 위치 글자: '자습실 자리'면 '자습실 a101', 아니면 위치 그대로
const locHtml = (r) => {
  const sh = seatInfo(r.student_id);
  return r.location === SEAT_PLACE && sh ? `자습실 ${seatLink(sh)}` : esc(r.location);
};
// 위치가 '자습실 자리'가 아닌데 자리를 공개한 학생: 위치 뒤(또는 위치 없이) 💺 a101
const seatChip = (sid) => {
  const sh = seatInfo(sid);
  return sh && statusMap.get(sid)?.location !== SEAT_PLACE ? `<span class="st-chip">💺 ${seatLink(sh)}</span>` : "";
};
// ---------- 자습실 배치도 ----------
// seat-a.jpg · seat-b.jpg 는 자습실 평면도(가운데 세미나실 · 계단을 빼고 A · B 두 곳으로 자름) 이고,
// 아래 좌표는 그 그림의 픽셀 위치입니다. 자리 이름 a412 = A 자습실 4구역 412번 (백의 자리가 구역).
const SEAT_HALLS = (() => {
  const halls = { a: { img: "seat-a.jpg", w: 1150, h: 736, name: "A", seats: {} }, b: { img: "seat-b.jpg", w: 1005, h: 736, name: "B", seats: {} } };
  const put = (hall, area, list, dx = 0) => list.forEach(([x, y], i) => { halls[hall].seats[area * 100 + i + 1] = [x - dx, y]; });
  const row = (n, x0, step, y) => Array.from({ length: n }, (_, i) => [x0 + step * i, y]);
  const grid = (xs, ys) => xs.flatMap((x) => ys.map((y) => [x, y]));   // 열마다 위에서 아래로
  // A 자습실
  put("a", 1, row(15, 96, 46.9, 38));
  put("a", 2, [[195, 185], [212, 207], [247, 150], [265, 172], [312, 117], [317, 142], [380, 97], [382, 122], [442, 97],
    [510, 97], [577, 95], [575, 120], [640, 117], [635, 142], [702, 147], [690, 170], [757, 187], [740, 210]]);
  put("a", 3, [[320, 287], [357, 265], [390, 252], [430, 242], [525, 242], [562, 252], [595, 265], [627, 285]]);
  put("a", 4, grid([317, 390, 440, 510, 562, 632], [380, 412, 445]));
  put("a", 5, [297, 327, 385, 415, 452, 485, 542, 572, 615, 645].map((x) => [x, 497]));
  put("a", 6, [[242, 572], [242, 607], [307, 572], [307, 607], [362, 572], [422, 572], [362, 607], [422, 607],
    [480, 572], [540, 572], [480, 607], [540, 607], [597, 572], [597, 607], [657, 590]]);
  put("a", 7, grid([807, 837, 865, 907, 937, 978, 1008, 1037], [560, 630]));
  put("a", 8, row(23, 71, 47.1, 693));
  // B 자습실 (원래 평면도에서 x 1400 부터 잘랐으므로 1400 을 뺍니다)
  const B = 1400;
  put("b", 1, row(14, 1550, 46.9, 38), B);
  put("b", 2, [[1651, 129], [1680, 140], [1627, 188], [1655, 201], [1605, 238], [1632, 248], [1582, 294], [1607, 307]], B);
  put("b", 3, [[1887, 118], [1887, 140], [1957, 134], [1941, 159], [1992, 159], [2060, 193], [1982, 183], [2044, 218],
    [2104, 221], [2088, 244], [2163, 259], [2147, 282]], B);
  put("b", 4, [[1807, 191], [1860, 226], [1910, 251], [1963, 288]], B);
  put("b", 5, [[1717, 326], [1792, 323], [1854, 326], ...[1704, 1736, 1767, 1801, 1832, 1870, 1901, 1932].map((x) => [x, 386])], B);
  put("b", 6, [1673, 1742, 1817, 1886, 1967, 2036].map((x) => [x, 463]), B);
  put("b", 7, [1501, 1532, 1570, 1604, 1686, 1754, 1807, 1876, 1926, 1995, 2045, 2117]
    .flatMap((x, i) => (i < 4 ? [[x, 564], [x, 632]] : [[x, 583], [x, 614]])), B);   // 홀수 위 · 짝수 아래
  put("b", 8, row(19, 1478, 46.8, 693), B);
  put("b", 9, [160, 213, 267, 320].map((y) => [1497, y]), B);
  return halls;
})();

function seatSpot(seat) {
  const m = /^([ab])(\d{3})$/i.exec(String(seat || "").trim());
  if (!m) return null;
  const hall = SEAT_HALLS[m[1].toLowerCase()], p = hall.seats[+m[2]];
  return p ? { hall, num: m[2], x: p[0], y: p[1] } : null;
}

window.seatClick = (e, a) => {
  e.stopPropagation();
  if (!openSeatMap(a.dataset.seat, a.dataset.day)) return true;   // 배치도에 없는 자리는 링크대로
  e.preventDefault();
  return false;
};

// 수업 팝업(z-index 1000) 위에서도 보이도록 따로 된 창을 씁니다
function openSeatMap(seat, day) {
  const s = seatSpot(seat);
  if (!s) return false;
  const { hall } = s;
  const scale = 0.62;   // 휴대폰에서도 자리 번호 줄이 보이게 줄이고, 옆으로 밀어 봅니다
  const box = document.createElement("div");
  box.className = "study-modal show seat-modal";
  box.innerHTML = `<div class="study-sheet seat-sheet">
    <div class="study-sheet-head"><div class="sheet-title">자습실 ${hall.name} · ${esc(s.num)}번 자리</div><button class="study-x">✕</button></div>
    <div class="seat-scroll"><div class="seat-stage" style="width:${Math.round(hall.w * scale)}px">
      <img src="${hall.img}" width="${hall.w}" height="${hall.h}" alt="자습실 ${hall.name} 배치도">
      <span class="seat-pin" style="left:${(s.x / hall.w) * 100}%;top:${(s.y / hall.h) * 100}%"></span>
    </div></div>
    <a class="study-submit ghost seat-out" href="${seatUrl(seat, day)}" target="_blank" rel="noopener">dshs.app 좌석 배치도에서 보기</a>
  </div>`;
  const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  box.querySelector(".study-x").onclick = close;
  box.onclick = (e) => { e.stopPropagation(); if (e.target === box) close(); };
  document.addEventListener("keydown", onKey);
  document.body.appendChild(box);
  // 표시한 자리가 가운데 오도록 밀어 둡니다
  const sc = box.querySelector(".seat-scroll");
  requestAnimationFrame(() => { sc.scrollLeft = s.x * scale - sc.clientWidth / 2; });
  return true;
}
// 내 일정·시간표를 보는 동안 1분마다 새로 받습니다
function watchStatus() {
  const tick = () => { if (me && !document.hidden) loadStatus(); };
  setInterval(tick, 60000);
  document.addEventListener("visibilitychange", tick);
}

function whenLabel(iso) {
  const d = new Date(iso), now = new Date();
  const mins = Math.floor((now - d) / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  return dayKey(d) === dayKey(now) ? hm(d) : `${md(d)} ${hm(d)}`;
}

function paintStatus(root = document) {
  root.querySelectorAll("[data-st]").forEach((el) => {
    const sid = +el.dataset.st;
    const mine = sid === me?.student_id && $("myStatus");   // 내 위치 · 자리는 위의 내 위치 줄에
    const r = me && !mine ? statusMap.get(sid) : null;
    const chip = me && !mine ? seatChip(sid) : "";
    el.innerHTML = (r ? `📍 ${locHtml(r)} <small>${whenLabel(r.updated_at)}</small>` : "") + (r && chip ? " " : "") + chip;
    el.classList.toggle("old", !!r && !chip && Date.now() - new Date(r.updated_at) > STATUS_OLD);
  });
  paintMyStatus();
}
window.paintStatus = paintStatus;   // index.html 의 수업 팝업이 씁니다

function paintMyStatus() {
  const box = $("myStatus");
  if (!box) return;
  if (!me?.student_id) { box.remove(); return; }
  const sid = me.student_id, r = statusMap.get(sid);
  box.innerHTML = `<span class="ms-label">📍 내 위치</span>
    <b>${r ? locHtml(r) : "아직 안 정했어요"}</b>${r ? `<small>${whenLabel(r.updated_at)} 수정</small>` : ""}${seatChip(sid)}
    <button class="study-btn small" id="msEdit">${r ? "바꾸기" : "정하기"}</button>
    ${seatWanted(sid) && !seatInfo(sid) ? seatNote() : ""}`;
  $("msEdit").onclick = openStatusPicker;
  if ($("msRelink")) $("msRelink").onclick = startDshs;
}

// 자리를 보여 주기로 했는데 자리 번호가 없을 때, 왜 없는지 내 위치 줄에 알려 줍니다
function seatNote() {
  if (DEMO || !seatShares || seatNeed === "off") return "";   // 데모는 자리를 받지 않음   // seats.sql 전이거나 서버가 자리를 받지 않음
  if (seatNeed === "relink") return `<button class="ms-relink" id="msRelink">dshs.app 을 다시 연결하면 자습실 자리가 함께 보여요</button>`;
  if (seatNeed === "link" || dshs.linked === false) return `<button class="ms-relink" id="msRelink">dshs.app 을 연결하면 자습실 자리가 함께 보여요</button>`;
  if (seatNeed === "error") return `<span class="ms-note">자리를 아직 못 받았어요. 잠시 뒤 다시 받아요</span>`;
  if (seatShares.get(me.student_id)?.seat_day === seatWeek())
    return `<a class="ms-note" href="https://dshs.app/reserve/${seatWeek()}" target="_blank" rel="noopener">dshs.app 에 이번 주 신청한 자습실 자리를 찾지 못했어요</a>`;
  return `<span class="ms-note">자습실 자리를 받는 중이에요</span>`;
}

function openStatusPicker() {
  const cur = statusMap.get(me.student_id)?.location || "";
  const custom = cur && !PLACES.includes(cur) ? cur : "";
  openSheet("내 위치", `
    <div class="place-opts">${PLACES.map((p) =>
      `<button type="button" class="study-btn${p === cur ? " primary" : ""}" data-place="${esc(p)}">${p}</button>`).join("")}</div>
    <label class="study-label">직접 입력</label>
    <div class="place-custom">
      <input class="study-input" id="plIn" maxlength="30" placeholder="예: 도서관, 보건실, 물리실험실" value="${esc(custom)}">
      <button type="button" class="study-btn primary" id="plSave">저장</button>
    </div>
    <div class="study-err" id="authErr"></div>
    ${cur ? '<button class="study-submit ghost" id="plClear">위치 지우기</button>' : ""}
    <div class="study-foot">로그인한 42기 학생 모두에게 학번 옆에 보여요. 고친 시각도 함께 보여요.
      '자습실 자리'로 정하면 dshs.app 에서 신청한 이번 주 자리(예: a101)도 함께 보여요.
      위치와 상관없이 자리를 보여 주려면 설정에서 '자습실 자리 공개'를 켜세요.</div>`);
  $("studyModal").querySelectorAll("[data-place]").forEach((b) => b.onclick = () => saveStatus(b.dataset.place));
  $("plSave").onclick = () => {
    const v = $("plIn").value.trim();
    if (!v) return showErr("위치를 입력해 주세요.");
    saveStatus(v);
  };
  $("plIn").onkeydown = (e) => { if (e.key === "Enter") $("plSave").click(); };
  if ($("plClear")) $("plClear").onclick = () => saveStatus(null);
}

// '자습실 자리 공개' 켜고 끄기 (seat_shares.public. 자리 자체는 서버가 채움). 저장했으면 true.
// 동의 창에 답한 것도 함께 남깁니다(asked) → 계정마다 한 번만 묻습니다.
async function saveSeatPublic(on, quiet = false) {
  const sid = me.student_id;
  const { error } = await sb.from("seat_shares").upsert({ student_id: sid, public: on, asked: true });
  if (error) { toast("저장하지 못했어요. 잠시 뒤 다시 시도해 주세요", true); return false; }
  seatShares.set(sid, { seat: null, seat_day: null, ...seatShares.get(sid), student_id: sid, public: on, asked: true });
  if (!quiet) toast(on ? "내 자습실 자리를 공개했어요" : "내 자습실 자리 공개를 껐어요");
  paintStatus();
  saveSnap();
  if (on) loadMySeat(true);
  return true;
}

// 자리 공개가 꺼져 있으면 동의 창으로 켜 달라고 묻습니다. '공개하지 않기'를 골라도 꺼져 있는 동안은
// 이 기기에서 하루 한 번 다시 묻습니다(SEAT_ASK_KEY). 설정의 '자습실 자리 공개'에서도 켜고 끕니다.
const SEAT_ASK_KEY = "dshs-seat-ask";
function askSeatConsent() {
  const sid = me?.student_id, sh = seatShares?.get(sid);
  if (!sid || me.is_admin || !seatShares || sh?.public || askSeatConsent.shown) return;
  const today = dayKey(new Date());
  try { if (localStorage.getItem(SEAT_ASK_KEY) === today) return; } catch {}
  // 업데이트 소식 · 다른 창이 떠 있으면 닫힐 때까지 기다립니다
  const busy = () => ["studyModal", "updModal"].some((id) => $(id)?.classList.contains("show"));
  if (busy() || document.hidden) { clearTimeout(askSeatConsent.t); askSeatConsent.t = setTimeout(askSeatConsent, 3000); return; }
  askSeatConsent.shown = true;
  try { localStorage.setItem(SEAT_ASK_KEY, today); } catch {}
  openSheet("자습실 자리 공개", `<div class="seat-ask">
    <div class="asg-body">dshs.app 에서 신청한 내 자습실 자리(예: a101)를 친구들에게 보여 줄까요?</div>
    <ul>
      <li>로그인한 42기 학생이 내 이름 옆과 시간표 검색에서 내 자리를 볼 수 있어요</li>
      <li>자리는 매주 금요일 15시에 새로 신청한 자리로 바뀌어요</li>
      <li>dshs.app 계정이 연결돼 있어야 자리를 받아 올 수 있어요</li>
      <li>나중에 설정에서 언제든 끌 수 있어요</li>
    </ul>
    <button class="study-submit" id="saYes">동의하고 공개하기</button>
    <button class="study-submit ghost" id="saNo">공개하지 않기</button>
  </div>`);
  const answer = async (on, btn) => {
    btn.disabled = true;
    if (!(await saveSeatPublic(on, !on))) { btn.disabled = false; return; }
    closeModal();
    if (!on) toast("공개하지 않아요. 설정에서 언제든 켤 수 있어요");
  };
  $("saYes").onclick = (e) => answer(true, e.target);
  $("saNo").onclick = (e) => answer(false, e.target);
}

// 설정 창의 '자습실 자리 공개' 줄
function seatSettingHtml() {
  if (!seatShares || !me?.student_id) return "";
  return `<label class="set-row"><span><b>자습실 자리 공개</b><span class="ev-hint">켜면 친구들이 내 이름 옆 · 시간표 검색에서 dshs.app 에 신청한 내 자습실 자리를 볼 수 있어요</span></span>
    <input type="checkbox" id="setSeat"${seatShares.get(me.student_id)?.public ? " checked" : ""}></label>`;
}
function bindSeatSetting() {
  const box = $("setSeat");
  if (!box) return;
  box.onchange = async () => {
    box.disabled = true;
    if (!(await saveSeatPublic(box.checked))) box.checked = !box.checked;
    box.disabled = false;
  };
}

async function saveStatus(loc) {
  const { error } = loc
    ? await sb.from("student_status").upsert({ student_id: me.student_id, location: loc })
    : await sb.from("student_status").delete().eq("student_id", me.student_id);
  if (error) return showErr(/relation|does not exist|schema cache/i.test(error.message)
    ? "위치 기능은 아직 준비 중이에요." : "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  if (loc) statusMap.set(me.student_id, { student_id: me.student_id, location: loc, updated_at: new Date().toISOString() });
  else statusMap.delete(me.student_id);
  if (loc === SEAT_PLACE) loadMySeat(true);
  closeModal(); paintStatus();
  toast(loc ? `내 위치: ${loc}` : "위치를 지웠어요");
  loadStatus(true);
}
// 지금 시간표 화면에 떠 있는 게 내 시간표인지 (다른 학생·선생님·과목을 검색했으면 아님)
function showingMyTimetable() {
  const r = $("result");
  return r.classList.contains("show") && !!r.querySelector(".student-profile")?.textContent.includes(`학번 ${me.student_id}`);
}
// 로그인 직후 첫 화면: 학생은 내 시간표, 관리자 계정은 관리자 사이트 안내 (학번 없는 예전 계정은 내 일정)
const openHome = () => (me.is_admin ? openAdminMoved() : me.student_id ? openMyTimetable() : openStudy());

async function logout() {
  await forgetPush();   // 이 기기로 다음 사람의 알림이 오지 않도록, 로그아웃하기 전에 서버 등록만 지웁니다
  await sb.auth.signOut();
  silentState({ off: true });   // 직접 로그아웃했으면 조용한 로그인으로 다시 들어가지 않게
  autoPush.done = false;   // 다음에 로그인하는 사람의 알림을 다시 맞춥니다
  paintPush.known = false;
  statusMap = new Map(); statusAt = 0;
  seatShares = new Map(); seatAt = 0; seatNeed = null;
  me = null; myClasses = []; dshs = dshsEmpty(); closeStudy(); renderNav();
  $("myStatus")?.remove(); paintStatus();
  toast("로그아웃했어요");
}

// ---------- 로그인 ----------
// 회원가입은 없습니다. 새 학생은 dshs.app 으로 로그인하면 dshs-oauth 가 학번으로 계정을 만듭니다.
// 처음 오는 학생은 계정이 없으므로 '로그인' 대신 'dshs.app 계정으로 시작하기' 하나만 크게 보여 줍니다.
// 아이디 · 비밀번호 로그인(관리자 · 예전에 아이디로 가입한 학생)은 시작하기 창 아래 작은 '관리자 · 아이디로 로그인'
// 또는 설정 창 제목 "설정" 을 7번 누르면 열립니다.
function closeModal() { $("studyModal").className = "study-modal"; }

function openAuth() {
  openSheet("시작하기", `
    <div class="asg-body">따로 가입할 필요 없어요. dshs.app 계정으로 시작하면 바로 내 시간표 · 수행평가 · 일정을 쓸 수 있어요.</div>
    <button class="study-submit dshs-login" id="doDshsLogin">dshs.app 계정으로 시작하기</button>
    <div class="study-err" id="authErr"></div>
    <div class="study-foot">dshs.app 비밀번호는 이 사이트에 전달되지 않아요. 전에 아이디로 가입했어도 dshs.app으로 시작하면 같은 학번 계정으로 들어가요.<br>
      대전과학고등학교 및 dshs.app에서 공식적으로 제공하거나 운영하는 사이트가 아닌 학생 비공식 사이트예요.</div>
    ${adminLinkHtml()}`);
  $("doDshsLogin").onclick = loginWithDshs;
  bindAdminLink();
}
// 작게: 관리자 · 예전 아이디 계정용 아이디 · 비밀번호 로그인
const adminLinkHtml = () => '<button class="auth-admin" id="openIdLogin" type="button">관리자 · 아이디로 로그인</button>';
function bindAdminLink() { $("openIdLogin").onclick = openAdminLogin; }

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
    setTimeout(maybeOnboard, 800);
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
  openSheet("관리자 · 아이디로 로그인", idLoginHtml("아이디", "비밀번호"));
  bindIdLogin();
  $("loginId").focus();
}

function showErr(msg) { const e = $("authErr"); e.textContent = msg; e.classList.add("show"); }

// ---------- 탭: 내 일정 · 수행평가 공지 · 할 일 ----------
const PAGES = [["cal", "내 일정"], ["notice", "수행평가"], ["todo", "할 일"], ["meal", "급식"], ["learn", "공부"]];
const PAGE_VIEW = { cal: "feed", notice: "notice", todo: "todo", meal: "meal", learn: "learn" };

// 내 일정: 수행평가(내 분반 공지 + 내가 올린 것)와 개인 일정을 한 달력에 모두 보여줍니다
function openStudy(p) {
  if (me?.is_admin) return openAdminMoved();
  page = PAGE_VIEW[p] ? p : "cal";
  view = PAGE_VIEW[page];
  destroyCal();
  $("result").classList.remove("show");
  $("welcomeState").style.display = "none";
  $("studyView").style.display = "block";
  // 시간표 검색창은 내 시간표 탭에서만 보입니다 (내 시간표 탭이 없는 관리자 계정은 그대로 둠)
  document.body.classList.toggle("study-open", !!me?.student_id);
  if (page === "learn") { renderLearn(); renderNav(); return; }   // 공부 탭은 서버 자료를 쓰지 않습니다
  if (page === "meal") { mealDay = null; renderMeal(); renderNav(); return; }   // 급식은 NEIS 에서 바로 받습니다 (열 때마다 다음 끼니 날로)
  renderStudy();
  renderNav();
  // 받아 둔 내용(지난 화면 · 앞서 받은 것)이 있으면 '불러오는 중' 없이 바로 그리고, 서버에서 새로 받아 바뀐 것만 다시 그립니다
  if (haveData) rerender();
  loadAssignments({ quiet: true });
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
  if (view === "learn" || view === "meal") return;   // 공부 · 급식 탭은 서버 자료를 쓰지 않습니다 (단어장 진행이 날아가지 않게)
  if (view === "notice") renderNotice();
  else if (view === "todo") renderTodo();
  else renderList(view);
}
window.closeStudyView = closeStudy;

// ---------- 공부: 단어장 북마크를 계정에 (learn.sql) ----------
// 단어장(vocab.html, iframe)이 window.learnBookmarks 를 불러 이 사이트의 로그인 연결로 읽고 씁니다.
// sync 는 지금 북마크 전체를 받아, 마지막으로 안 계정 쪽 목록과 비교해 더하고 지운 것만 보냅니다 (순서대로 하나씩).
// 실패하면 false → 단어장이 '못 올림'으로 표시해 두었다가 다음에 열 때 올립니다.
const learnBm = { known: {}, chain: Promise.resolve() };
window.learnBookmarks = {
  async load(subject) {
    if (!sb) await sbWait;
    if (!me || me.is_admin) return null;
    const { data, error } = await sb.from("learn_bookmarks").select("word").eq("subject", subject);
    if (error) return null;
    learnBm.known[subject] = new Set(data.map((r) => r.word));
    return [...learnBm.known[subject]];
  },
  sync(subject, words) {
    learnBm.chain = learnBm.chain.then(async () => {
      if (!sb || !me) return false;
      if (!learnBm.known[subject] && (await window.learnBookmarks.load(subject)) === null) return false;
      const known = learnBm.known[subject], want = new Set(words);
      const add = [...want].filter((w) => !known.has(w)), del = [...known].filter((w) => !want.has(w));
      if (add.length) {
        const { error } = await sb.from("learn_bookmarks")
          .upsert(add.map((word) => ({ subject, word })), { onConflict: "user_id,subject,word", ignoreDuplicates: true });
        if (error) return false;
        add.forEach((w) => known.add(w));
      }
      if (del.length) {
        const { error } = await sb.from("learn_bookmarks").delete().eq("subject", subject).in("word", del);
        if (error) return false;
        del.forEach((w) => known.delete(w));
      }
      return true;
    }).catch(() => false);
    return learnBm.chain;
  },
};

// ---------- 공부 ----------
// 과목을 고르면 그 과목 단어장(vocab.html)을 아래에 띄웁니다. 단어장 안의 탭(학습 · 퀴즈 · 빈칸 · 배열 · 셀프 · 북마크)은
// vocab.html 이 그리고, 기록 · 북마크는 이 기기에만 남습니다(localStorage). 과목을 늘리려면 vocab.html 의 SUBJECTS 와 여기에 함께 넣습니다.
const LEARN_SUBJECTS = [
  { id: "atc", name: "학술영어 세미나", sub: "The Art of Thinking Clearly 어휘 · 문장 배열 · 문장 암기", emoji: "🧠" },
  { id: "crit", name: "비판적 영어 읽기와 토론", sub: "필수동사 150개 · 필수형용사 100개", emoji: "⚖️" },
];
const LEARN_KEY = "dshs-learn-subject";
function learnSubject() {
  let id = null;
  try { id = localStorage.getItem(LEARN_KEY); } catch {}
  return LEARN_SUBJECTS.some((s) => s.id === id) ? id : null;
}
function renderLearn(pick) {
  if (pick) { try { localStorage.setItem(LEARN_KEY, pick); } catch {} }
  const cur = learnSubject();
  const frame = $("learnFrame");
  // 이미 단어장이 떠 있으면 다시 만들지 않고 과목만 바꿉니다 (푸는 중이던 화면 유지)
  if (cur && frame) {
    $("studyView").querySelectorAll("[data-learn]").forEach((b) => b.classList.toggle("primary", b.dataset.learn === cur));
    try { frame.contentWindow.vocabSubject(cur); } catch { frame.src = `vocab.html?embed=1#${cur}`; }
    return;
  }
  $("studyView").innerHTML = `
    <div class="study-head">
      <div>
        <h2>공부</h2>
        <div class="study-sub">${cur ? "과목을 바꾸려면 위에서 골라요" : "공부할 과목을 골라요"}</div>
      </div>
      <button class="study-btn" onclick="closeStudyView()">✕ 닫기</button>
    </div>
    <div class="study-row learn-subjects">
      ${LEARN_SUBJECTS.map((s) => `<button class="study-btn${s.id === cur ? " primary" : ""}" data-learn="${s.id}">${s.emoji} ${esc(s.name)}</button>`).join("")}
    </div>
    ${cur
      ? `<iframe id="learnFrame" class="learn-frame" src="vocab.html?embed=1#${cur}" title="단어장" scrolling="no"></iframe>`
      : `<div class="learn-pick">${LEARN_SUBJECTS.map((s) => `
          <button class="asg-card learn-card" data-learn="${s.id}">
            <span class="learn-emoji">${s.emoji}</span>
            <span><span class="asg-title">${esc(s.name)}</span><span class="study-sub">${esc(s.sub)}</span></span>
          </button>`).join("")}</div>`}
    <div class="study-foot">북마크는 계정에 저장돼 다른 기기에서도 보여요. 퀴즈 기록은 이 기기에만 남아요</div>`;
  $("studyView").querySelectorAll("[data-learn]").forEach((b) => b.onclick = () => renderLearn(b.dataset.learn));
}

// ---------- 급식 ----------
// NEIS 급식 식단(학사일정과 같은 학교 코드). 브라우저에서 바로 받고(CORS 허용) 날짜별로 이 기기에 6시간 기억합니다.
// 인증키 없이 한 번에 5줄까지라 하루(조식 · 중식 · 석식 3줄)씩 받습니다.
const MEAL_API = "https://open.neis.go.kr/hub/mealServiceDietInfo";
const MEAL_KEY = "dshs-meal";
const MEAL_TTL = 6 * 3600 * 1000;
const ALLERGY = ["", "난류", "우유", "메밀", "땅콩", "대두", "밀", "고등어", "게", "새우", "돼지고기", "복숭아",
  "토마토", "아황산류", "호두", "닭고기", "쇠고기", "오징어", "조개류", "잣"];
let mealDay = null;   // 보고 있는 날 (YYYY-MM-DD)

function mealStore() { try { return JSON.parse(localStorage.getItem(MEAL_KEY) || "{}"); } catch { return {}; } }
async function fetchMeal(key) {
  const store = mealStore();
  const hit = store[key];
  if (hit && Date.now() - hit.at < MEAL_TTL) return hit.meals;
  const q = new URLSearchParams({ Type: "json", pSize: "5", ATPT_OFCDC_SC_CODE: "G10", SD_SCHUL_CODE: "7430032", MLSV_YMD: key.replaceAll("-", "") });
  try {
    const r = await fetch(`${MEAL_API}?${q}`, { cache: "no-store" });
    const j = await r.json();
    const rows = j.mealServiceDietInfo?.[1]?.row || [];
    if (!rows.length && j.RESULT?.CODE !== "INFO-200") throw new Error(j.RESULT?.MESSAGE || "neis");
    const meals = rows.sort((a, b) => a.MMEAL_SC_CODE - b.MMEAL_SC_CODE).map((m) => ({
      name: m.MMEAL_SC_NM,
      kcal: (m.CAL_INFO || "").replace(/\s*Kcal/i, ""),
      dishes: (m.DDISH_NM || "").split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean).map((s) => {
        // 끝의 (1.2.5) 가 알레르기 번호 (1~19). '스파클링(350)' 같은 용량은 이름에 그대로 둡니다
        let a = s.match(/\s*\(([\d.\s]+)\)\s*$/);
        const nums = a ? a[1].split(".").map(Number).filter(Boolean) : [];
        if (a && !(nums.length && nums.every((n) => n >= 1 && n < ALLERGY.length))) a = null;
        return { name: (a ? s.slice(0, a.index) : s).replace(/^\*/, "").trim(), allergy: a ? nums : [] };
      }),
    }));
    // 지난 날짜는 지우고 오늘 기준 앞뒤 2주만 남깁니다
    const keep = Date.now() - 14 * 86400000;
    for (const k of Object.keys(store)) if (parseDay(k) < keep) delete store[k];
    store[key] = { at: Date.now(), meals };
    try { localStorage.setItem(MEAL_KEY, JSON.stringify(store)); } catch {}
    return meals;
  } catch {
    return hit ? hit.meals : null;   // 못 받으면 예전에 받아 둔 것이라도
  }
}

// 지금 시각 기준 다음 끼니: 9시 전 조식 · 14시 전 중식 · 20시 전 석식, 그 뒤는 내일 조식
function nextMeal() {
  const n = new Date(), h = n.getHours() + n.getMinutes() / 60;
  if (h >= 20) return { key: dayKey(new Date(+n + 86400000)), name: "조식" };
  return { key: dayKey(n), name: h < 9 ? "조식" : h < 14 ? "중식" : "석식" };
}

async function renderMeal(key) {
  const next = nextMeal();
  mealDay = key || mealDay || next.key;
  const day = mealDay;
  const today = dayKey(new Date());
  const d = parseDay(day);
  const rel = day === today ? "오늘" : day === dayKey(new Date(Date.now() + 86400000)) ? "내일"
    : day === dayKey(new Date(Date.now() - 86400000)) ? "어제" : "";
  const shift = (n) => dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  $("studyView").innerHTML = `
    <div class="study-head">
      <div>
        <h2>급식</h2>
        <div class="study-sub">대전과학고 식단 · NEIS</div>
      </div>
      <button class="study-btn" onclick="closeStudyView()">✕ 닫기</button>
    </div>
    <div class="meal-nav">
      <button class="study-btn" id="mealPrev" aria-label="전날">◀</button>
      <button class="meal-day" id="mealToday" title="오늘로">${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})${rel ? ` <span class="meal-rel">${rel}</span>` : ""}</button>
      <button class="study-btn" id="mealNext" aria-label="다음 날">▶</button>
    </div>
    <div id="mealBody"><div class="study-empty">불러오는 중…</div></div>
    <div class="study-foot meal-legend">알레르기 번호 · ${ALLERGY.slice(1).map((a, i) => `${i + 1} ${a}`).join(" · ")}</div>`;
  $("mealPrev").onclick = () => renderMeal(shift(-1));
  $("mealNext").onclick = () => renderMeal(shift(1));
  $("mealToday").onclick = () => renderMeal(next.key);
  const meals = await fetchMeal(day);
  if (view !== "meal" || mealDay !== day) return;   // 그사이 다른 날 · 다른 탭으로 갔으면 그리지 않음
  const box = $("mealBody");
  if (meals === null) { box.innerHTML = `<div class="study-empty">급식 정보를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</div>`; return; }
  if (!meals.length) { box.innerHTML = `<div class="study-empty">이날은 급식 정보가 없어요.</div>`; return; }
  box.innerHTML = `<div class="meal-list">${meals.map((m) => `
    <div class="meal-card${day === next.key && m.name === next.name ? " now" : ""}">
      <div class="meal-head"><span class="meal-name">${esc(m.name)}</span>
        ${day === next.key && m.name === next.name ? `<span class="meal-tag">다음 끼니</span>` : ""}
        ${m.kcal ? `<span class="meal-kcal">${esc(m.kcal)} kcal</span>` : ""}</div>
      <ul class="meal-dishes">${m.dishes.map((x) => `<li>${esc(x.name)}${x.allergy.length
        ? ` <span class="meal-alg" title="${esc(x.allergy.map((n) => ALLERGY[n]).filter(Boolean).join(", "))}">${x.allergy.join(".")}</span>` : ""}</li>`).join("")}</ul>
    </div>`).join("")}</div>`;
  fetchMeal(shift(1));   // 다음 날도 미리 받아 둡니다
}

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
    </div>
    <div id="dshsHint"></div>` : ""}
    ${page === "notice" ? `<div class="study-row">
      <button class="study-btn primary" id="btnNew">+ 수행평가 추가</button>
    </div>` : ""}
    <div id="studyBody"><div class="study-empty">불러오는 중…</div></div>`;
  if ($("btnEv")) $("btnEv").onclick = () => openEventForm(null);
  paintDshs();
  if ($("btnNew")) $("btnNew").onclick = () => openNewForm();   // 클릭 이벤트가 "고칠 공지" 로 넘어가지 않게
}

// quiet: 탭을 눌러 화면을 이미 그린 경우. 30초 안에 받았으면 다시 받지 않고, 받은 내용이 같으면 다시 그리지 않습니다.
// 일정 추가 · 수정 뒤처럼 인자 없이 부르면 늘 새로 받아 다시 그립니다.
let haveData = false, dataAt = 0, dataSig = "";
async function loadAssignments({ quiet = false } = {}) {
  if (!sb) await sbWait;   // 지난 화면에서 탭을 먼저 누른 경우
  if (!me || me.is_admin) return;   // 관리자 계정은 관리자 사이트에서 씁니다
  if (quiet && haveData && Date.now() - dataAt < 30000) return;
  loadDshs();   // dshs.app 신청 내역은 따로 받아서, 오면 달력에 더합니다
  const [asg, personal, evs, done, people, todos, school, invites, tgroups, tmembers, tshared] = await Promise.all([
    sb.from("assignments").select("*").order("due_at", { ascending: true }),
    sb.from("assignment_personal").select("*"),
    sb.from("events").select("*").order("starts_at", { ascending: true }),   // 내 일정 + 친구가 공유한 일정
    sb.from("assignment_done").select("assignment_id"),
    sb.rpc("my_event_people"),
    sb.from("todos").select("*").order("created_at", { ascending: true }),
    sb.from("school_events").select("*, school_event_targets(student_id)").order("starts_at", { ascending: true }),
    sb.from("event_invites").select("event_id, student_id"),   // 내 일정에 학번으로 넣은 가입 전 친구 (invites.sql)
    sb.from("todo_groups").select("*").order("position").order("created_at"),   // 할 일 그룹 (todogroups.sql)
    sb.from("todo_members").select("*"),   // 내 할 일에 넣은 친구 (todoshare.sql)
    sb.rpc("my_shared_todos"),             // 친구가 나에게 공유한 할 일 (승인된 것만)
  ]);
  cache.school = school.data || [];
  cache.invites = new Map();   // 일정 id → [학번]
  for (const r of invites.data || []) {
    if (!cache.invites.has(r.event_id)) cache.invites.set(r.event_id, []);
    cache.invites.get(r.event_id).push(r.student_id);
  }
  cache.todos = todos.error ? null : todos.data;
  cache.todoGroups = tgroups.error ? null : tgroups.data;   // null 이면 그룹 기능을 숨깁니다 (표가 아직 없을 때)
  // 할 일 함께하기: 표가 없으면(null) 친구 넣기 칸을 숨깁니다. 내 것이 아닌 행(공유받은 내 행)은 빼고 둡니다
  const ownTodo = new Set((todos.data || []).map((t) => t.id));
  cache.todoMembers = tmembers.error ? null : tmembers.data.filter((m) => ownTodo.has(m.todo_id));
  cache.sharedTodos = tshared.error ? [] : (tshared.data || []).map((r) => ({ ...r, shared: true, created_at: r.added_at }));
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
  const sig = JSON.stringify([data, personal.data, evs.data, done.data, people.data, todos.data, school.data, invites.data, tgroups.data, tmembers.data, tshared.data]);
  const same = haveData && sig === dataSig;
  haveData = true; dataAt = Date.now(); dataSig = sig;
  const mineOnly = new Map((personal.data || []).map((p) => [p.assignment_id, p]));
  const rows = (data || []).map((a) => withPersonal(a, mineOnly.get(a.id)));
  cache.items = rows.filter((a) => a.status === "approved");
  cache.mine = rows.filter((a) => a.created_by === me.id);
  cache.pending = rows.filter((a) => a.status === "pending");
  saveSnap();
  renderNav();   // 수행평가 탭 옆 숫자 갱신
  if (quiet && same) return;
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
    body: p.no_body ? "" : p.body ?? a.body,
    due_at: p.no_due ? null : p.due_at ?? a.due_at,
    submit_to: p.no_submit ? null : p.submit_to ?? a.submit_to,
  };
}

const dueMs = (a) => (a.due_at ? Date.parse(a.due_at) : Infinity);
const byDue = (a, b) => (dueMs(a) > dueMs(b)) - (dueMs(a) < dueMs(b));   // 마감 없는 공지는 맨 뒤
const asgDue = (a) => (a.due_at ? dueInfo(a.due_at) : { label: "D-?", tone: "ok", when: null });
// 수정: 승인된 수행평가는 누구나 (내 계정에서만 바뀝니다), 아직 나만 보이는 것은 작성자.
// 삭제: 작성자가 아직 분반 공지가 아닌(대기·반려) 자기 공지를. 모두에게 고치고 지우는 건 관리자 사이트에서 합니다.
const editsOnlyForMe = (a) => a.status === "approved";
const canEditAsg = (a) => a.status === "approved" || a.created_by === me.id;
const canDelAsg = (a) => a.created_by === me.id && a.status !== "approved";

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
    ${a.body ? `<div class="asg-body${opts.check ? " clamp" : ""}">${esc(a.body)}</div>` : ""}
    <div class="asg-due"><span>${d.when ? `${d.when} 마감` : "마감 일시 미정"}</span>${a.author_name ? `<span class="asg-by">${esc(a.author_name)} 작성</span>` : ""}</div>
    ${a.submit_to ? `<div class="asg-due">제출: ${esc(a.submit_to)}</div>` : ""}
    ${opts.check ? `<div class="asg-actions">
      <button class="study-btn small${done ? " on" : ""}" data-adone="${a.id}">${done ? "완료함" : "완료 표시"}</button>
      ${editBtn}${delBtn}
    </div>` : ""}
  </div>`;
}

function renderList(mode) {
  const body = $("studyBody");
  view = mode;
  loadAcademic();
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
  else if (kind === "sch") openSchoolDetail(cache.school.find((x) => x.id === id));
  else if (kind === "tt") return;
  else if (kind === "acad") openAcadDetail(acadList.find((e) => e.id === id));
  else if (kind === "dshs") openDshsDetail(dshs.items.find((r) => r.uid === id));
  else if (kind === "todo") { const t = findTodo(id); if (t) t.shared ? openSharedTodo(t) : openTodoForm(t); }
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
    if (it.kind === "todo") return { ...base, classNames: [...base.classNames, "fcx-todo"], start: dayKey(it.at), allDay: true, editable: !!it.owner, durationEditable: false };
    // 수행평가: 끌어서 다른 날(종일 칸 · 월 보기는 시각 그대로, 시간 칸은 놓은 시각)로 마감을 옮깁니다
    if (it.kind === "asg") return { ...base, start: dayKey(it.at), allDay: true, editable: !!it.owner, durationEditable: false };
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
  if (kind === "asg") return moveAsg(arg, id);
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
  // 학교 일정 · 학사일정은 학생이 옮길 수 없습니다 (관리자 사이트에서 고침)
  if (kind === "acad" || kind === "sch") { arg.revert(); return; }
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

// 끌어서 옮긴 수행평가 마감 저장. 승인된 공지는 내 계정에서만(assignment_personal), 승인 전 내 공지는 공지 자체를 고칩니다.
async function moveAsg(arg, id) {
  const a = findAsg(id);
  if (!a?.due_at || !canEditAsg(a)) { arg.revert(); return; }
  const old = new Date(a.due_at), s = arg.event.start;
  const due = arg.event.allDay
    ? new Date(s.getFullYear(), s.getMonth(), s.getDate(), old.getHours(), old.getMinutes())
    : s;
  if (+due === +old) { fc.refetchEvents(); return; }
  const save = async (iso) => {
    const cur = findAsg(id);   // 저장 · 되돌리기 때마다 지금 모습(내 수정 포함)을 기준으로
    if (!cur) return { error: { message: "없음" } };
    if (editsOnlyForMe(cur)) {
      return savePersonal(cur, { title: cur.title, body: cur.body || "", submit_to: cur.submit_to || null, due_at: iso });
    }
    const r = await sb.from("assignments").update({ due_at: iso }).eq("id", id).select("id");
    return { error: r.error || (!r.data?.length && { message: "수정 권한이 없어요" }) };
  };
  const { error } = await save(due.toISOString());
  if (error) { arg.revert(); return toast("옮기지 못했어요", true); }
  const onlyMe = editsOnlyForMe(a);
  await loadAssignments();
  undoToast(`마감을 ${md(due)} ${hm(due)}(으)로 옮겼어요${onlyMe ? " · 내 계정에서만" : ""}`, async () => {
    const { error } = await save(old.toISOString());
    if (error) return false;
    await loadAssignments();
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
const eventInvites = (e) => cache.invites?.get(e.id) || [];   // 학번 목록 (가입 전이라 아직 달력에 없음)
const rosterName = (sid) => (window.ID_TO_NAME || {})[String(sid)] || String(sid);
// 완료 체크는 사람마다 따로: 만든 사람은 events.done, 참여자는 event_members.done
const eventDone = (e) => ownsEvent(e) ? e.done : !!eventPeople(e).find((p) => p.user_id === me.id)?.done;
function shareLabel(e) {
  const ppl = eventPeople(e);
  if (!ppl.length && !eventInvites(e).length) return "";
  if (!ownsEvent(e)) return `${ppl.find((p) => p.is_owner)?.name || "친구"}님이 공유`;
  const names = [...ppl.filter((p) => !p.is_owner).map((p) => p.name), ...eventInvites(e).map(rosterName)];
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
    tag: `${a.subject} · ${banLabel(a.ban)}`, owner: canEditAsg(a),   // 끌어서 마감 옮기기 (승인된 공지는 내 계정에서만)
  }));
  const evs = cache.events.map((e) => ({
    kind: "ev", id: e.id, title: e.title, at: new Date(e.starts_at), end: e.ends_at ? new Date(e.ends_at) : null,
    allDay: e.all_day, color: e.color, done: eventDone(e) || isPastEvent(e), auto: !eventDone(e) && isPastEvent(e),
    owner: ownsEvent(e), shared: eventPeople(e).length > 0,
    tag: [shareLabel(e), e.memo.split("\n")[0]].filter(Boolean).join(" · "),
  }));
  // 학교 일정 (관리자가 관리자 사이트에서 만들고 고침. 숨긴 일정은 빠짐)
  const sch = liveSchool().filter((e) => acadShown(e.category)).map((e) => ({
    kind: "sch", id: e.id, title: e.title, at: new Date(e.starts_at), end: e.ends_at ? new Date(e.ends_at) : null,
    allDay: e.all_day, color: "school", done: false, owner: false,
    tag: [e.no_class && "수업 없음", e.memo.split("\n")[0]].filter(Boolean).join(" · "),
  }));
  // 기한을 정한 할 일은 그날 종일 칸에 체크박스로 둡니다
  const todos = allTodos().filter((t) => t.due_on).map((t) => ({
    kind: "todo", id: t.id, title: t.title, at: parseDay(t.due_on), end: null, allDay: true,
    color: "mint", done: t.done, owner: !t.shared, shared: !!t.shared || todoMembersOf(t.id).length > 0,
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
  renderNav();   // 수행평가 탭 옆 숫자 갱신
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
    ${canDelAsg(a) ? '<button class="study-submit ghost danger" id="aDel">삭제</button>' : ""}
    <div class="cm-box">
      <div class="study-label">댓글 <small id="cmCount"></small></div>
      <div class="cm-list" id="cmList" data-aid="${a.id}"><div class="cm-empty">불러오는 중…</div></div>
      <div class="cm-new">
        <textarea class="study-input" id="cmText" rows="1" maxlength="500" placeholder="${a.status === "approved"
          ? "댓글 달기 (이 공지를 보는 친구들이 함께 봐요)" : "댓글 달기 (승인 전이라 관리자와 나만 봐요)"}"></textarea>
        <button class="study-btn small" id="cmSend">등록</button>
      </div>
    </div>`);
  $("aDone").onclick = async () => { closeModal(); await toggleDone("asg", a.id); };
  if ($("aEdit")) $("aEdit").onclick = () => { closeModal(); openStudy("notice"); openNewForm(a); };
  if ($("aDel")) $("aDel").onclick = async () => { if (await removeItem(a.id)) closeModal(); };
  $("cmSend").onclick = () => sendComment(a.id);
  $("cmText").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendComment(a.id); }
  };
  loadComments(a.id);
}

// ---------- 수행평가 댓글 (comments.sql: 공지를 볼 수 있는 사람만 읽고 씀) ----------
const cmOpen = (aid) => $("cmList")?.dataset.aid === aid;   // 받는 사이 창을 닫거나 다른 공지를 열었으면 그리지 않음

async function loadComments(aid) {
  if (!sb) await sbWait;
  const { data, error } = await sb.from("assignment_comments")
    .select("id, user_id, author_name, body, created_at")
    .eq("assignment_id", aid).order("created_at");
  if (!cmOpen(aid)) return;
  if (error) { $("cmList").innerHTML = `<div class="cm-empty">댓글을 불러오지 못했어요.</div>`; return; }
  $("cmCount").textContent = data.length || "";
  $("cmList").innerHTML = data.length
    ? data.map((c) => {
        const t = new Date(c.created_at);
        const mine = c.user_id === me?.id;
        return `<div class="cm-item">
          <div class="cm-head"><b>${esc(c.author_name || "알 수 없음")}${mine ? " (나)" : ""}</b><span>${md(t)} ${hm(t)}</span>
            ${mine ? `<button class="cm-del" data-cmdel="${c.id}">삭제</button>` : ""}</div>
          <div class="cm-body">${esc(c.body)}</div>
        </div>`;
      }).join("")
    : `<div class="cm-empty">아직 댓글이 없어요. 궁금한 점이나 알게 된 내용을 남겨 보세요.</div>`;
  $("cmList").querySelectorAll("[data-cmdel]").forEach((b) => b.onclick = async () => {
    if (!confirm("이 댓글을 지울까요?")) return;
    const { error } = await sb.from("assignment_comments").delete().eq("id", b.dataset.cmdel);
    if (error) return toast("지우지 못했어요", true);
    loadComments(aid);
  });
}

async function sendComment(aid) {
  const box = $("cmText"), btn = $("cmSend");
  const body = box.value.trim();
  if (!body || btn.disabled) return;
  if (!sb) await sbWait;
  btn.disabled = true;
  const { error } = await sb.from("assignment_comments").insert({ assignment_id: aid, body });
  if (!cmOpen(aid)) return;
  btn.disabled = false;
  if (error) return toast(isNetErr(error) ? "인터넷 연결을 확인해 주세요" : "댓글을 올리지 못했어요", true);
  box.value = "";
  loadComments(aid);
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
    <div class="aud-quick" id="frGroups"><span class="aud-label">그룹</span><span class="aud-hint">불러오는 중…</span></div>
    <input class="study-input" id="frQ" autocomplete="off" placeholder="이름·학번으로 찾기 · 여러 명은 띄어 쓰고 Enter">
    <div class="fr-results" id="frRes"></div>
    <div class="study-foot fr-note">넣은 친구 달력에도 이 일정이 생겨요. 고치거나 지우면 친구 달력에도 반영돼요. 가입 전인 친구는 가입하면 바로 생겨요.</div>
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

  // 함께하는 친구: 가입한 사람은 이름·학번으로 찾고(search_people),
  // 가입 전인 학생은 학번 4자리를 입력하면 넣을 수 있어요 (invites.sql: 가입하는 순간 그 학생 달력에 생김)
  const sidOf = (name) => window.SCHOOL_DATA?.[name]?.id;   // 그룹으로 저장할 때 쓰는 학번 (이름 → 학번)
  const before = ev ? [
    ...eventPeople(ev).filter((p) => !p.is_owner).map((p) => ({ id: p.user_id, name: p.name, sid: sidOf(p.name) })),
    ...eventInvites(ev).map((sid) => ({ sid, name: rosterName(sid), invite: true })),
  ] : [];
  let friends = [...before];
  const sameFriend = (a, b) => (a.invite ? b.invite && a.sid === b.sid : !b.invite && a.id === b.id);
  const drawChips = () => {
    $("frChips").innerHTML = friends.map((f, i) =>
      `<span class="fr-chip">${esc(f.name)}${f.invite && !f.fromGroup ? "<small>가입 전</small>" : ""}<button type="button" data-rm="${i}" aria-label="${esc(f.name)} 빼기">✕</button></span>`).join("");
    $("frChips").querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { friends.splice(+b.dataset.rm, 1); drawChips(); });
  };
  drawChips();
  // 그룹: 학번으로 넣습니다. 가입한 학생은 저장할 때 DB(invites.sql 트리거)가 바로 함께하는 친구로 바꿔요
  mountGroups("frGroups", () => friends.map((f) => f.sid), (sids) => {
    for (const sid of sids) {
      if (sid === me.student_id || friends.some((f) => f.sid === sid)) continue;
      friends.push({ sid, name: rosterName(sid), invite: true, fromGroup: true });
    }
    drawChips();
  }, true);
  let qTimer, qSeq = 0;
  // 검색해서 결과 목록을 그립니다. 엔터를 누르면 기다리지 않고 바로 검색해 첫 번째 결과를 넣어요
  let shownQ = "";
  const search = async (q) => {
    const seq = ++qSeq;
    const { data, error } = await sb.rpc("search_people", { p_query: q });
    if (seq !== qSeq) return;   // 더 늦게 친 검색어의 결과만 보여줍니다
    const list = (data || []).filter((p) => !friends.some((f) => !f.invite && f.id === p.id));
    // 가입한 사람 중에 없는 명단 학생 → 가입 전 학생으로 넣기 (학번 4자리 또는 이름으로 찾음)
    const joined = new Set((data || []).map((p) => p.student_id));
    const unjoined = roster().filter((p) => (/^\d{4}$/.test(q) ? p.sid === +q : !/^\d+$/.test(q) && p.name.includes(q))
      && !joined.has(p.sid) && p.sid !== me.student_id && !friends.some((f) => f.sid === p.sid)).slice(0, 5);
    const rows = [
      ...list.map((p, i) => `<button type="button" class="fr-item" data-add="${i}"><b>${esc(p.name)}</b>${p.student_id ? `<span>${p.student_id}</span>` : ""}</button>`),
      ...unjoined.map((p) => `<button type="button" class="fr-item" data-invite="${p.sid}"><b>${esc(p.name)}</b><span>${p.sid} · 가입 전</span></button>`),
    ];
    $("frRes").innerHTML = error ? `<div class="fr-empty">찾지 못했어요.</div>`
      : rows.length ? rows.join("")
      : `<div class="fr-empty">명단에 없어요. 이름이나 학번 4자리를 확인해 주세요.</div>`;
    const added = () => { drawChips(); $("frQ").value = ""; $("frRes").innerHTML = ""; $("frQ").focus(); };
    $("frRes").querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
      const p = list[+b.dataset.add];
      friends.push({ id: p.id, name: p.name, sid: p.student_id });
      added();
    });
    $("frRes").querySelectorAll("[data-invite]").forEach((b) => b.onclick = () => {
      const s = +b.dataset.invite;
      friends.push({ sid: s, name: rosterName(s), invite: true });
      added();
    });
    shownQ = q;
  };
  const addSidsAsInvite = (sids) => {
    for (const sid of sids) {
      if (sid === me.student_id || friends.some((f) => f.sid === sid)) continue;
      friends.push({ sid, name: rosterName(sid), invite: true, fromGroup: true });
    }
    drawChips();
  };
  $("frQ").oninput = () => {
    clearTimeout(qTimer);
    const q = $("frQ").value.trim();
    shownQ = "";
    if (!q) { $("frRes").innerHTML = ""; return; }
    if (isMulti(q)) { qSeq++; $("frRes").innerHTML = multiHint(parseStudents(q)); return; }
    qTimer = setTimeout(() => search(q), 250);
  };
  $("frQ").onkeydown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // 한글 입력 중 엔터는 글자를 마무리한 뒤에 처리합니다
    setTimeout(async () => {
      const q = $("frQ").value.trim();
      if (!q) return;
      clearTimeout(qTimer);
      if (isMulti(q)) {   // 여러 명: 한 번에 넣고 못 찾은 말만 남깁니다
        qSeq++;
        const r = parseStudents(q);
        addSidsAsInvite(r.sids);
        $("frQ").value = r.miss.join(" ");
        $("frRes").innerHTML = r.miss.length ? multiHint({ sids: [], miss: r.miss }) : "";
        return $("frQ").focus();
      }
      if (shownQ !== q) await search(q);
      if ($("frQ").value.trim() === q) $("frRes").querySelector(".fr-item")?.click();
    }, 0);
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
    const add = friends.filter((f) => !before.some((b) => sameFriend(b, f)));
    const drop = before.filter((b) => !friends.some((f) => sameFriend(b, f)));
    const addM = add.filter((f) => !f.invite), dropM = drop.filter((f) => !f.invite);
    const addI = add.filter((f) => f.invite), dropI = drop.filter((f) => f.invite);
    const results = await Promise.all([
      addM.length && sb.from("event_members").insert(addM.map((f) => ({ event_id: saved.id, user_id: f.id }))),
      dropM.length && sb.from("event_members").delete().eq("event_id", saved.id).in("user_id", dropM.map((f) => f.id)),
      addI.length && sb.from("event_invites").insert(addI.map((f) => ({ event_id: saved.id, student_id: f.sid }))),
      dropI.length && sb.from("event_invites").delete().eq("event_id", saved.id).in("student_id", dropI.map((f) => f.sid)),
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
    const invited = eventInvites(ev).map((sid) => ({ event_id: ev.id, student_id: sid }));
    const { error } = await sb.from("events").delete().eq("id", ev.id);
    if (error) return showErr("삭제하지 못했어요.");
    closeModal();
    undoToast(members.length ? `일정을 삭제했어요 · 친구 ${members.length}명 달력에서도` : "일정을 삭제했어요", async () => {
      const { error } = await sb.from("events").insert(snap);
      if (error) return false;
      if (members.length) await sb.from("event_members").insert(members);
      if (invited.length) await sb.from("event_invites").insert(invited);
      await loadAssignments();
    });
    await loadAssignments();
  };
}

// ---------- 즐겨찾기 그룹 (groups.sql) ----------
// 일정의 '함께하는 친구'와 관리자 학교 일정 대상에서 함께 씁니다. 학생 그룹은 나만, 관리자 그룹은 관리자끼리 봐요.
// boxId: 그룹 줄을 그릴 칸 · getSids(): 지금 고른 학번들 · addSids(sids): 그룹을 눌렀을 때 학번들을 더하기
// withBan: "분반으로 고르기" 버튼도 둡니다 (과목 · 분반을 고르면 그 분반 학생 모두. 관리자 학교 일정은 따로 분반 줄이 있어 뺌)
function mountGroups(boxId, getSids, addSids, withBan = false) {
  let groups = [];
  const draw = () => {
    const box = $(boxId);
    if (!box) return;
    box.innerHTML = `<span class="aud-label">그룹</span>` +
      groups.map((g, i) => `<span class="aud-group"><button type="button" class="study-btn small" data-group="${i}">${esc(g.name)} <small>${g.student_ids.length}</small></button><button type="button" class="aud-group-x" data-gdel="${i}" aria-label="${esc(g.name)} 그룹 지우기">✕</button></span>`).join("") +
      (withBan ? `<button type="button" class="study-btn small" data-gban>분반으로 고르기</button>` : "") +
      `<button type="button" class="study-btn small" data-gsave>+ 고른 사람을 그룹으로</button>` +
      (withBan ? `<div class="aud-quick ban-pick" hidden>
        <select class="study-input" data-bsubj><option value="">과목 고르기</option>${banSubjects().map((x) => `<option>${esc(x)}</option>`).join("")}</select>
        <select class="study-input" data-bban disabled><option value="">분반</option></select>
        <button type="button" class="study-btn small" data-badd disabled>모두 넣기</button>
      </div>` : "");
    if (withBan) {
      const pick = box.querySelector(".ban-pick"), subj = pick.querySelector("[data-bsubj]"), ban = pick.querySelector("[data-bban]"), go = pick.querySelector("[data-badd]");
      box.querySelector("[data-gban]").onclick = () => { pick.hidden = !pick.hidden; };
      subj.onchange = () => {
        const bans = [...new Set(roster().map((p) => p.classes[subj.value]).filter(Boolean))].sort();
        ban.innerHTML = `<option value="*">전체 분반</option>` + bans.map((x) => `<option>${esc(x)}</option>`).join("");
        ban.disabled = go.disabled = !subj.value;
      };
      go.onclick = () => {
        const s = subj.value, b = ban.value;
        const sids = roster().filter((p) => p.classes[s] && (b === "*" || p.classes[s] === b)).map((p) => p.sid);
        addSids(sids);
        toast(`${s} ${b === "*" ? "전체" : b} ${sids.length}명을 넣었어요`);
      };
    }
    box.querySelectorAll("[data-group]").forEach((b) => b.onclick = () => addSids(groups[+b.dataset.group].student_ids));
    box.querySelectorAll("[data-gdel]").forEach((b) => b.onclick = async () => {
      const g = groups[+b.dataset.gdel];
      if (!confirm(`'${g.name}' 그룹을 지울까요? (이미 넣은 사람은 그대로예요)`)) return;
      const { error } = await sb.from("audience_groups").delete().eq("id", g.id);
      if (error) return toast("그룹을 지우지 못했어요", true);
      groups = groups.filter((x) => x !== g);
      draw();
    });
    box.querySelector("[data-gsave]").onclick = async () => {
      const sids = [...new Set(getSids())].filter(Boolean).sort((a, b) => a - b);
      if (!sids.length) return toast("먼저 그룹에 넣을 사람을 골라 주세요", true);
      const name = prompt(`지금 고른 ${sids.length}명을 어떤 이름의 그룹으로 저장할까요?`, "")?.trim();
      if (!name) return;
      const { data, error } = await sb.from("audience_groups").insert({ name: name.slice(0, 40), student_ids: sids }).select().single();
      if (error) return toast("그룹을 저장하지 못했어요", true);
      groups = [...groups, data].sort((a, b) => a.name.localeCompare(b.name, "ko"));
      draw();
      toast(`'${data.name}' 그룹을 저장했어요`);
    };
  };
  sb.from("audience_groups").select("*").order("name").then(({ data, error }) => {
    groups = error ? [] : data;   // 그룹을 못 불러와도 분반으로 고르기는 쓸 수 있게
    if (error && !withBan) { $(boxId)?.remove(); return; }
    draw();
  });
}
// 분반이 있는 과목 (명단의 수강 정보에서)
const banSubjects = () => [...new Set(roster().flatMap((p) => Object.keys(p.classes)))].sort((a, b) => a.localeCompare(b, "ko"));

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

// a: 고칠 수행평가 (없으면 새로 추가). 고칠 때는 과목·분반은 바꿀 수 없고 제목·설명·마감·제출처만 고칩니다.
function openNewForm(a) {
  const body = $("studyBody");
  // 기본 마감: 일주일 뒤 그날 자정 (23:59 — 00:00 으로 두면 달력에서 다음 날로 넘어가 보입니다)
  const dueDay = new Date();
  dueDay.setDate(dueDay.getDate() + 7);
  const dueVal = a ? (a.due_at ? `${dayKey(new Date(a.due_at))}T${hm(new Date(a.due_at))}` : "") : `${dayKey(dueDay)}T23:59`;
  const noDue = !!a && !a.due_at;
  // 고칠 때 제출처: 목록에 있으면 그걸 고르고, 없으면 "그 외" 에 적어 둡니다
  const place = a?.submit_to ? (SUBMIT_PLACES.includes(a.submit_to) ? a.submit_to : "etc") : "";
  // 자기 분반만 (전체 분반 공지는 관리자 사이트에서 올림)
  const opts = a ? [{ subject: a.subject, ban: a.ban }] : asgClasses();
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
      <label class="study-label">설명 (선택)</label>
      <textarea class="study-input" id="nBody" rows="3" maxlength="2000" placeholder="범위, 분량, 준비물 등">${esc(a?.body ?? "")}</textarea>
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
        : "과목·분반은 바꿀 수 없어요. 바꾸려면 지우고 다시 추가해 주세요."
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
    const fields = { title, body: $("nBody").value.trim(), submit_to: submitTo || null, due_at: noDueNow ? null : new Date(due).toISOString() };
    let error;
    if (a && editsOnlyForMe(a)) {
      ({ error } = await savePersonal(a, fields));
    } else if (a) {
      // RLS 로 막히면 에러 없이 0행이 바뀌므로 바뀐 행을 돌려받아 확인합니다
      const res = await sb.from("assignments").update(fields).eq("id", a.id).select("id");
      error = res.error || (!res.data?.length && { message: "수정 권한이 없어요" });
    } else {
      ({ error } = await sb.from("assignments").insert({ subject, ban, ...fields, created_by: me.id, status: "pending" }));
    }
    $("nSave").disabled = false;
    if (error) {
      // notice.sql 을 아직 실행하지 않은 DB: 마감 없는 수행평가·승인된 수행평가 수정이 막힙니다
      const needSql = /due_at|null value/.test(error.message || "");
      err.textContent = `${a ? "저장하지" : "추가하지"} 못했어요: ${needSql ? "마감 일시 없이 추가하는 기능은 아직 준비 중이에요. 마감 일시를 정해 주세요." : error.message}`;
      err.classList.add("show");
      return;
    }
    toast(a ? editsOnlyForMe(a) ? "내 계정에서만 고쳤어요" : "고쳤어요" : "나만 보이게 추가했어요. 승인되면 분반 친구들에게도 보여요");
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
  // 설명은 바꿨을 때만 보냅니다 (안 바꾼 칸이 공지 설명을 따라가도록 · 설명 칸 없는 예전 DB 에서도 다른 칸은 저장되게)
  const changed = (f.body || "") !== (b.body || ""), hadMine = (a.body || "") !== (b.body || "");
  if (changed || hadMine) Object.assign(p, { body: changed ? f.body || null : null, no_body: changed && !f.body });
  if (!Object.values(p).some(Boolean)) return clearPersonal(a.id);
  return sb.from("assignment_personal").upsert({
    ...p, user_id: me.id, assignment_id: a.id, updated_at: new Date().toISOString(),
  });
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
// 보내기는 📢 업데이트 창의 '피드백' 탭에서, 받은 피드백은 관리자 사이트(admin/)의 관리 탭에서 봅니다.
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

// 📢 업데이트 창의 '피드백' 탭 (index.html 이 부릅니다). 머리의 '업데이트 내역' 을 누르면 업데이트 창으로 돌아갑니다.
function openFeedback() {
  const head = window.updTabs ? window.updTabs("fb") : "피드백";
  const back = () => $("studyModal").querySelector('[data-utab="upd"]')?.addEventListener("click", () => { closeModal(); window.openUpdates?.(); });
  if (!me) {
    openSheet(head, `
      <div class="asg-body">로그인하면 피드백을 보낼 수 있어요.</div>
      <button class="study-submit" id="fbLogin">로그인</button>`);
    $("fbLogin").onclick = openAuth;
    return back();
  }
  const mine = '<div id="fbMine"></div>';
  openSheet(head, `${fbUnread ? mine : ""}
    <label class="study-label">유형</label>
    <select class="study-input" id="fbKind">${Object.entries(FEEDBACK_KINDS).map(([k, label]) =>
      `<option value="${k}">${label}</option>`).join("")}</select>
    <label class="study-label">내용</label>
    <textarea class="study-input" id="fbBody" rows="6" maxlength="2000" placeholder="${FEEDBACK_HINT.bug}"></textarea>
    <label class="study-label">스크린샷 (선택)</label>
    <input class="study-input" type="file" id="fbFile" accept="image/*">
    <div class="study-foot">보낸 내용은 관리자만 볼 수 있어요.</div>
    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="fbSend">보내기</button>${fbUnread ? "" : mine}`);
  back();
  loadMyFeedback();
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
window.openFeedback = openFeedback;

// ---------- 피드백 답장 (feedbackreply.sql) ----------
// 관리자가 관리자 사이트에서 남긴 답장을 피드백 창의 '내가 보낸 피드백'에서 읽고, 그 아래에서 다시 답합니다.
// 안 읽은 답장이 있으면 📢 버튼과 '피드백' 탭에 점을 찍고, 창을 열면 읽음으로 바꿉니다.
let fbUnread = 0, fbCheckedAt = 0;
const fbFromAdmin = (r) => r.from_admin !== false;   // 관리자가 쓴 답장 (false 면 내가 다시 쓴 답글)
function paintFbDot() {
  $("updBtn")?.classList.toggle("has-reply", fbUnread > 0);
}
// 안 읽은 관리자 답장 수 (1분 안에 다시 묻지 않습니다. 표가 아직 없으면 0)
async function checkFbReplies() {
  if (!sb || !me || me.is_admin || Date.now() - fbCheckedAt < 60000) return;
  fbCheckedAt = Date.now();
  const { data, error } = await sb.from("feedback_replies").select("*").is("seen_at", null).order("created_at", { ascending: false }).limit(200);
  if (error) return;
  fbUnread = data.filter(fbFromAdmin).length;
  paintFbDot();
}
// 내가 보낸 피드백마다 관리자 답장과 내 답글을 대화처럼 보여 주고, 관리자 답장이 있으면 다시 답할 수 있습니다
async function loadMyFeedback() {
  if (!sb) await sbWait;
  const uid = me?.id;
  if (!uid) return;
  const [fb, re] = await Promise.all([
    sb.from("feedback").select("id, kind, body, created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
    sb.from("feedback_replies").select("*").order("created_at"),
  ]);
  const box = $("fbMine");
  if (!box || fb.error || !fb.data.length) return;
  const replies = re.error ? [] : re.data;
  const at = (s) => { const t = new Date(s); return `${md(t)} ${hm(t)}`; };
  const isNew = (r) => fbFromAdmin(r) && !r.seen_at;
  // 답장이 오간 피드백을 먼저, 그다음 최근에 보낸 순
  const last = (f) => Math.max(0, ...replies.filter((r) => r.feedback_id === f.id).map((r) => Date.parse(r.created_at)));
  const rows = [...fb.data].sort((a, b) => last(b) - last(a));
  box.innerHTML = `<div class="fbm-title">내가 보낸 피드백</div>${rows.map((f) => {
    const thread = replies.filter((r) => r.feedback_id === f.id);
    return `<div class="fbm-item">
      <div class="fbm-head"><span class="adm-chip">${FEEDBACK_KINDS[f.kind] || "기타"}</span><span>${at(f.created_at)}</span></div>
      <div class="fbm-body">${esc(f.body)}</div>
      ${thread.map((r) => `<div class="fbm-reply${fbFromAdmin(r) ? "" : " me"}${isNew(r) ? " new" : ""}">
        <div class="fbm-head"><b>${fbFromAdmin(r) ? "관리자 답장" : "나"}</b>${isNew(r) ? '<span class="fb-new">새 답장</span>' : ""}<span>${at(r.created_at)}</span></div>
        <div class="fbm-body">${esc(r.body)}</div>
      </div>`).join("") || '<div class="fbm-wait">아직 답장이 없어요</div>'}
      ${thread.some(fbFromAdmin) ? `<div class="fbm-write">
        <textarea class="study-input" rows="1" maxlength="2000" placeholder="관리자에게 답장하기" data-fbre="${f.id}"></textarea>
        <button class="study-btn primary small" type="button" data-fbresend="${f.id}">보내기</button>
      </div>` : ""}
    </div>`;
  }).join("")}`;
  box.querySelectorAll("[data-fbresend]").forEach((b) => b.onclick = async () => {
    const ta = box.querySelector(`[data-fbre="${b.dataset.fbresend}"]`), text = ta.value.trim();
    if (!text) return ta.focus();
    b.disabled = true;
    const { error } = await sb.from("feedback_replies").insert({ feedback_id: b.dataset.fbresend, body: text, created_by: uid });
    if (error) { b.disabled = false; return toast("보내지 못했어요. 잠시 뒤 다시 시도해 주세요.", true); }
    toast("답장을 보냈어요");
    loadMyFeedback();
  });
  if (replies.some(isNew)) {
    const { error } = await sb.rpc("mark_feedback_replies_seen");
    if (!error) { fbUnread = 0; fbCheckedAt = Date.now(); paintFbDot(); }
  }
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
      id: `acad:${e.id}`, title: e.name, start: e.start, end: dayKey(after), allDay: true, editable: false,
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

// ---------- 조용한 로그인 ----------
// 아이폰 · 아이패드는 홈 화면 앱과 Safari(또는 다른 브라우저)의 저장소가 따로라, 앱에서 로그인해 두어도 Safari 로 열면
// 로그아웃된 것처럼 보입니다. 로그인 기록이 없는 브라우저에서 열면 dshs.app 에 prompt=none 으로 한 번 다녀와서,
// 그 브라우저에 dshs.app 로그인이 살아 있으면 화면 없이 바로 로그인합니다 (이미 계정이 있는 학생만. dshs-oauth 의 silent).
// - 홈 화면 앱에서는 하지 않습니다 (다른 사이트로 가면 앱 안에 브라우저 창이 떠서 '조용히'가 안 됨)
// - 그 브라우저에서 하루 한 번만 (로그인 안 하는 방문자가 매번 다녀오지 않게 · dshs.app 요청 한도)
// - 이 브라우저에서 로그아웃했으면 다시 로그인할 때까지 하지 않습니다
const SILENT_KEY = "dshs-silent";       // localStorage { day, off }
const SILENT_BACK = "dshs-silent-back"; // sessionStorage: 다녀오기 전 주소의 ?… (알림 링크 등)
function silentState(patch) {
  try {
    const st = JSON.parse(localStorage.getItem(SILENT_KEY) || "{}");
    if (!patch) return st;
    localStorage.setItem(SILENT_KEY, JSON.stringify({ ...st, ...patch }));
    return JSON.parse(localStorage.getItem(SILENT_KEY));
  } catch { return null; }
}
async function silentLogin() {
  if (isInstalledApp() || inKakao() || !navigator.onLine || silentReturned.back) return false;
  if (new URLSearchParams(location.search).get("dshs") || /dshs_login=/.test(location.hash)) return false;
  const today = dayKey(new Date()), st = silentState();
  if (!st || st.off || st.day === today) return false;
  if (silentState({ day: today })?.day !== today) return false;   // 저장이 안 되는 브라우저(사생활 보호 등)는 열 때마다 다녀오게 되므로 하지 않음
  try {
    sessionStorage.setItem(SILENT_BACK, location.search);
    const { body } = await dshsCall("login", { return_to: location.origin + location.pathname, silent: true });
    if (body.silent === true && body.url) { location.replace(body.url); return true; }
  } catch {}
  return false;
}
// 돌아오면(?dshs=silent) 다녀오기 전 주소로 바꿉니다. 성공했으면 # 뒤의 일회용 토큰은 그대로 둡니다.
function silentReturned() {
  if (new URLSearchParams(location.search).get("dshs") !== "silent") return;
  silentReturned.back = true;
  let q = "";
  try { q = sessionStorage.getItem(SILENT_BACK) || ""; sessionStorage.removeItem(SILENT_BACK); } catch {}
  history.replaceState(null, "", location.pathname + q + location.hash);
}

async function dshsCall(action, extra) {
  if (DEMO) return { ok: true, body: { linked: true, items: [] } };   // 데모는 서버에 묻지 않음
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
// [이름, 표시 이름, 미리보기 배경, 미리보기 강조색]. 고른 적이 없으면 기기 설정(다크 · 라이트)을 따릅니다.
const THEMES = [
  ["dark", "다크", "#0a0a0f", "#7c6fe0"],
  ["light", "라이트", "#f5f5fa", "#6a5cd6"],
  ["ocean", "바다", "#07111b", "#3fa7e0"],
  ["forest", "숲", "#0a120d", "#5fbf7a"],
  ["coco", "코코", "#f2f7f3", "#2f9a52"],
  ["sakura", "벚꽃", "#fbf3f6", "#d0577f"],
];
const THEME_KEY = "dshs-theme";
const curTheme = () => document.documentElement.dataset.theme || "dark";   // applyTheme 이 정한 지금 테마
function themeHtml() {
  return `<div class="set-row" style="display:block"><b>화면 테마</b>
    <span class="ev-hint">고르지 않으면 기기 설정(다크 · 라이트)을 따라가요</span>
    <div class="theme-grid">${THEMES.map(([k, label, bg, ac]) =>
      `<button type="button" data-theme-pick="${k}"${curTheme() === k ? ' class="on"' : ""}><i style="background:linear-gradient(135deg, ${bg} 50%, ${ac} 50%)"></i>${label}</button>`).join("")}</div></div>`;
}
function bindTheme() {
  $("studyModal").querySelectorAll("[data-theme-pick]").forEach((b) => b.onclick = () => {
    try { localStorage.setItem(THEME_KEY, b.dataset.themePick); } catch {}
    window.applyTheme?.();
    try { $("learnFrame")?.contentWindow.vocabTheme?.(); } catch {}   // 공부 탭 단어장도 같은 테마로
    $("studyModal").querySelectorAll("[data-theme-pick]").forEach((x) => x.classList.toggle("on", x === b));
  });
}

// 설정: 알림 · 학교 일정 보이기 · 화면 테마 · 계정(로그아웃과 dshs.app 연결 관리)
function openSettings() {
  if (!me) {   // 로그인 전: 화면 테마와 로그인 안내 (제목 7번 → 관리자 로그인)
    openSheet("설정", `
      ${themeHtml()}
      ${homeGuideHtml()}
      <div class="asg-body" style="margin-top:14px">dshs.app 계정으로 시작하면 알림 · 내 일정 달력 설정과 계정을 여기서 관리할 수 있어요. 따로 가입할 필요 없어요.</div>
      <button class="study-submit dshs-login" id="doDshsLogin">dshs.app 계정으로 시작하기</button>
      <div class="study-err" id="authErr"></div>
      ${adminLinkHtml()}`);
    $("doDshsLogin").onclick = loginWithDshs;
    bindAdminLink();
    bindTheme();
    bindHomeGuide();
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
    ${homeGuideHtml()}
    ${seatSettingHtml()}
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
  bindSeatSetting();
  bindCalSettings();
  if ($("doDshs")) $("doDshs").onclick = startDshs;
  if ($("dshsUnlink")) $("dshsUnlink").onclick = unlinkDshs;
  $("doLogout").onclick = () => { closeModal(); logout(); };
  bindTheme();
  bindHomeGuide();
  bindAdminTap();
}

// 설정 창의 연결 버튼, 또는 내 위치 줄의 '다시 연결' 버튼
async function startDshs(e) {
  const btn = e?.currentTarget || $("doDshs");
  btn.disabled = true;
  try {
    const handoff = newHandoff();
    const { body } = await dshsCall("start", { return_to: location.origin + location.pathname, handoff });
    if (body.url) { openDshsLogin(body.url, handoff); return; }
    toast(body.error || "dshs.app 연결을 시작하지 못했어요", true);
  } catch { toast("dshs.app 연결을 시작하지 못했어요", true); }
  btn.disabled = false;
}

async function unlinkDshs() {
  if (!confirm("dshs.app 연결을 해제할까요? 달력에서 신청 내역이 사라져요.")) return;
  try {
    const { ok } = await dshsCall("unlink");
    if (!ok) throw new Error();
  } catch { return toast("연결을 해제하지 못했어요", true); }
  dshs = { ...dshsEmpty(), linked: false, at: Date.now() };
  seatNeed = null;
  closeModal(); paintDshs(); paintStatus();
  if (calOpen()) rerender();
  toast("dshs.app 연결을 해제했어요");
}

// 'dshs.app으로 로그인' (로그인 전 화면). 돌아오면 init 이 주소의 일회용 토큰으로 세션을 만듭니다.
async function loginWithDshs() {
  $("doDshsLogin").disabled = true;
  logLogin("click", "sheet");
  let why = "net";
  try {
    const handoff = newHandoff();
    const { ok, body } = await dshsCall("login", { return_to: location.origin + location.pathname, handoff });
    if (body.url) {
      await logLeave(leaveHow(handoff));
      openDshsLogin(body.url, handoff);
      if (handoff && $("doDshsLogin")) $("doDshsLogin").disabled = false;   // 로그인 창을 그냥 닫았으면 다시 누를 수 있게 둡니다
      return;
    }
    why = ok ? "nourl" : "server";
  } catch {}
  logLogin("start_fail", why);
  showErr("dshs.app 로그인을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  $("doDshsLogin").disabled = false;
}

// 시간표 막힘 화면의 '로그인': 로그인 창을 거치지 않고 바로 dshs.app 로그인을 시작합니다 (화면 모양은 그대로).
// 시작하지 못하면 로그인 창을 열어 아이디 로그인 · 다시 시도를 할 수 있게 합니다.
async function gateLogin() {
  const b = $("gateLogin");
  b.disabled = true;
  const logged = logGate("click");
  logLogin("click", "gate");
  let why = "net";
  try {
    const handoff = newHandoff();
    const { ok, body } = await dshsCall("login", { return_to: location.origin + location.pathname, handoff });
    if (body.url) {
      await Promise.race([logged, new Promise((ok) => setTimeout(ok, 600))]);   // 이 창을 떠나기 전에 기록을 보냅니다
      await logLeave(leaveHow(handoff));
      openDshsLogin(body.url, handoff);
      b.disabled = false;
      return;
    }
    why = ok ? "nourl" : "server";
  } catch {}
  logLogin("start_fail", why);
  b.disabled = false;
  openAuth();
  showErr("dshs.app 로그인을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
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

// 카카오톡 안 브라우저: dshs.app 로그인(Google 로그인)을 Google 이 앱 안 브라우저에서 막으므로 기본 브라우저로 엽니다.
// (index.html 이 열 때도 한 번 기본 브라우저로 보냄. 그게 안 됐을 때 로그인 버튼에서 다시)
const inKakao = () => /KAKAOTALK/i.test(navigator.userAgent);
const leaveHow = (handoff) => (inKakao() ? "kakao" : handoff ? "popup" : "page");   // 로그인 이탈 기록용
const kakaoOutside = (url) => `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;

// 앱: 로그인 화면을 새 창으로 열어 두었다가, 로그인이 끝나면 앱이 그 창을 닫습니다.
function openDshsLogin(url, handoff) {
  if (inKakao()) {   // 로그인 주소를 기본 브라우저에서 열면, 로그인한 뒤 그 브라우저에서 이 사이트로 돌아옵니다
    toast("카카오톡에서는 로그인이 안 돼서 기본 브라우저로 열어요");
    location.href = kakaoOutside(url);
    return;
  }
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
  let ok = ["linked", "login", "joined"].includes(r.result), why = r.reason || "failed";
  if (ok && r.token) {
    const { error } = await sb.auth.verifyOtp({ token_hash: r.token, type: "magiclink" });
    if (!error) await loadProfile();
    ok = !error && !!me;
    why = error ? "verify" : "profile";
  }
  if (r.result !== "linked" && (ok || loginTry())) logLogin(ok ? "done" : "fail", ok ? null : why);   // 연결(설정의 dshs.app 연결)은 세지 않음
  if (!ok) return toast(DSHS_RETURNED[r.reason] || "dshs.app 로그인에 실패했어요", true);
  closeModal();
  if (r.result === "linked") {
    dshs.at = 0;
    loadDshs();
  } else {
    renderNav(); openHome();
    setTimeout(maybeOnboard, 800);
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
    // 로그인 이탈 기록: 로그인 · 가입 결과만 (설정의 dshs.app 연결은 세지 않음). 실패는 로그인 시도 중일 때만
    if (r === "login" || r === "joined") logLogin(ok ? "done" : "fail", ok ? null : dshsSession.failed ? "verify" : "profile");
    else if (r === "error" && loginTry()) logLogin("fail", q.get("reason") || "failed");
    if (ok && r !== "linked") setTimeout(maybeOnboard, 800);
  }
  q.delete("dshs"); q.delete("reason");
  const rest = q.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : ""));
}

// 전체 학생 명단 (시간표 데이터에서)
// "2101 반민지 2113 2505" 처럼 띄어쓰기(쉼표)로 여러 명을 적으면 명단에서 학번 4자리 · 이름이 딱 맞는 학생을 찾습니다.
// 친구 넣기 칸(일정 · 할 일)에서 Enter 로 한 번에 넣을 때 씁니다. 못 찾은 말은 miss 로 돌려줍니다.
const isMulti = (q) => /[\s,]/.test(q.trim());
function parseStudents(text) {
  const list = roster(), sids = [], miss = [];
  for (const w of text.split(/[\s,]+/).filter(Boolean)) {
    const p = /^\d{4}$/.test(w) ? list.find((x) => x.sid === +w) : list.find((x) => x.name === w);
    if (!p) miss.push(w);
    else if (!sids.includes(p.sid)) sids.push(p.sid);
  }
  return { sids, miss };
}
const multiHint = ({ sids, miss }) => `<div class="fr-empty">${sids.length
  ? `Enter 를 누르면 ${sids.length}명을 넣어요: ${esc(sids.map(rosterName).join(", "))}` : "넣을 학생을 찾지 못했어요."}${
  miss.length ? `<br>못 찾음: ${esc(miss.join(", "))} (학번 4자리나 이름 전체를 적어 주세요)` : ""}</div>`;

function roster() {
  return Object.entries(window.SCHOOL_DATA || {})
    .map(([name, v]) => ({ sid: v.id, name, classes: v.classes || {} }))
    .sort((a, b) => a.sid - b.sid);
}

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

// ---------- 수행평가 공지 탭 ----------
// 분반에 공지된 것 + 내가 올렸지만 아직 승인 안 된(또는 반려된) 것. 내 것은 승인과 상관없이 나에게 보입니다.
const noticeItems = () => [...cache.items, ...(cache.mine || []).filter((a) => a.status !== "approved")].sort(byDue);
// 위: 다가오는 수행평가 전체를 한 줄씩 (많아도 한눈에). 아래: 과목 블록을 누르면 그 아래에 그 과목 공지.
let openSubj = null;    // 고른 과목 이름
const ASG_SORT_KEY = "dshs-asg-sort";
let asgSort = (() => { try { return localStorage.getItem(ASG_SORT_KEY) === "subject" ? "subject" : "due"; } catch { return "due"; } })();

// 수행평가 한 줄: 완료 체크 · D-day · 과목 · 제목 · 마감 일시. 누르면 자세히
function asgRow(a, showSubj = true) {
  const d = asgDue(a), done = cache.done.has(a.id);
  return `<div class="asg-row${done ? " done" : ""}">
    <button class="asg-chk${done ? " on" : ""}" data-chk="asg:${a.id}" aria-label="${done ? "완료 취소" : "완료 표시"}">${done ? "✓" : ""}</button>
    <button class="asg-row-main" data-open="asg:${a.id}">
      <span class="due-badge ${d.tone}">${d.label}</span>
      ${showSubj ? `<span class="ar-subj">${esc(a.subject)}</span>` : ""}
      <span class="ar-title">${esc(a.title)}</span>${stBadge(a.status)}
      <span class="ar-when">${a.due_at ? `${md(new Date(a.due_at))} ${hm(new Date(a.due_at))}` : "미정"}</span>
    </button>
  </div>`;
}

function allAsgHtml(now) {
  const up = noticeItems().filter((a) => dueMs(a) >= +now);   // 마감 일시 없는 것은 맨 뒤
  const left = up.filter((a) => !cache.done.has(a.id)).length;
  const sortBtns = [["due", "마감 기한순"], ["subject", "과목별"]].map(([k, label]) =>
    `<button class="seg-btn${asgSort === k ? " on" : ""}" data-asort="${k}">${label}</button>`).join("");
  let list;
  if (!up.length) list = `<div class="study-empty">다가오는 수행평가가 없어요.</div>`;
  else if (asgSort === "due") list = up.map((a) => asgRow(a)).join("");
  else list = [...new Set(up.map((a) => a.subject))].sort((x, y) => x.localeCompare(y, "ko")).map((s) => {
    const rows = up.filter((a) => a.subject === s);
    return `<div class="ar-group">${esc(s)} <small>${rows.length}</small></div>` + rows.map((a) => asgRow(a, false)).join("");
  }).join("");
  return `<div class="asg-all-head"><div class="study-section">전체 수행평가 · 남은 ${left}건</div><div class="seg">${sortBtns}</div></div>
    <div class="asg-rows">${list}</div>`;
}

function renderNotice() {
  destroyCal();
  view = "notice";
  const body = $("studyBody");
  const now = new Date();
  const subjects = noticeSubjects(now);
  const picked = subjects.find((sj) => sj.name === openSubj);
  body.innerHTML =
    allAsgHtml(now) +
    `<div class="study-section">과목별 수행평가</div>` +
    `<div class="subj-grid">${subjects.map(subjBlock).join("")}</div>` +
    `<div id="subjDetail">${picked ? subjDetail(picked) : `<div class="subj-hint">과목을 누르면 그 과목 수행평가가 여기에 보여요</div>`}</div>`;
  body.querySelectorAll("[data-subj]").forEach((b) => b.onclick = () => {
    openSubj = openSubj === b.dataset.subj ? null : b.dataset.subj;
    renderNotice();
    if (openSubj) $("subjDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  body.querySelectorAll("[data-adone]").forEach((b) => b.onclick = () => toggleDone("asg", b.dataset.adone));
  body.querySelectorAll("[data-asort]").forEach((b) => b.onclick = () => {
    asgSort = b.dataset.asort;
    try { localStorage.setItem(ASG_SORT_KEY, asgSort); } catch {}
    renderNotice();
  });
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

// 오늘 할 일: '오늘'로 고른 날(today_on)이 오늘인 남은 할 일. 날이 바뀌면 원래 자리로 돌아갑니다.
const isTodayTodo = (t) => !t.done && !!t.today_on && t.today_on === dayKey(new Date());
// 끝낸 할 일은 2일 뒤 서버에서 지워집니다 (todotoday.sql). 그 전이라도 화면에는 2일 안에 끝낸 것만.
const TODO_KEEP_MS = 2 * 86400000;

function todoRow(t, grip = false) {
  const due = t.due_on ? todoDue(t.due_on) : null;
  const today = isTodayTodo(t);
  const meta = todoShareLabel(t);
  const dueText = due ? `${due.short}${t.done ? "" : ` · ${due.label}`}` : "";
  return `<div class="ev-row c-mint todo-row${t.done ? " done" : ""}${t.shared ? " td-shared" : ""}" data-tid="${t.id}">
    ${grip && !t.shared ? `<span class="td-grip" data-tgrip="${t.id}" title="끌어서 그룹에 넣기" aria-hidden="true">⠿</span>` : ""}
    <button class="ev-check" data-tchk="${t.id}" aria-label="완료 표시">${t.done ? "✓" : ""}</button>
    <button class="ev-main" data-tedit="${t.id}">
      <span class="ev-title">${esc(t.title)}</span>
      ${meta ? `<span class="ev-meta">${esc(meta)}</span>` : ""}
    </button>
    ${!due ? "" : t.shared ? `<span class="td-due ${t.done ? "" : due.tone}" title="${esc(due.text)}까지">${dueText}</span>`
      : `<button class="td-due ${t.done ? "" : due.tone}" data-tdue="${t.id}" title="${esc(due.text)}까지 · 눌러서 바꾸기">${dueText}</button>`}
    ${t.done ? "" : `<button class="td-today${today ? " on" : ""}" data-ttoday="${t.id}" aria-pressed="${today}"
      title="${today ? "오늘 할 일에서 빼기" : "오늘 할 일로 정하기"}">${today ? "✓ 오늘" : "오늘"}</button>`}
    <button class="td-del" data-tdel="${t.id}" aria-label="${t.shared ? "이 할 일에서 나가기" : "삭제"}">✕</button>
  </div>`;
}

async function toggleTodayTodo(id) {
  const t = findTodo(id);
  if (!t) return;
  const prev = t.today_on || null;
  const today_on = isTodayTodo(t) ? null : dayKey(new Date());
  const { error } = await todoUpdate(t, { today_on });
  if (error) return toast("저장하지 못했어요", true);
  t.today_on = today_on;
  rerender();
  saveSnap();
  if (today_on) toast("오늘 할 일에 넣었어요");
  else undoToast("오늘 할 일에서 뺐어요", async () => {
    const { error } = await todoUpdate(t, { today_on: prev });
    if (error) return toast("되돌리지 못했어요", true);
    t.today_on = prev;
    rerender();
  });
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
  const sorted = allTodos().filter((t) => !t.done)
    .sort((a, b) => (!a.due_on - !b.due_on) || (a.due_on || "").localeCompare(b.due_on || "") || a.created_at.localeCompare(b.created_at));
  // 오늘 할 일은 맨 위 칸에 모아 보여 주고, 원래 자리(그룹 · 남은 할 일)에도 그대로 둡니다.
  // 완료하면 두 곳 모두에서 빠져 '완료'로 갑니다.
  const todayList = sorted.filter(isTodayTodo);
  const open = sorted;
  const keepFrom = Date.now() - TODO_KEEP_MS;
  const done = allTodos().filter((t) => t.done && (!t.done_at || Date.parse(t.done_at) > keepFrom))
    .sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 30);
  // 그룹: 그룹 없는 할 일이 먼저, 그 아래 그룹마다 접고 펼치는 칸. 끝낸 할 일은 맨 아래 '완료'에 모읍니다.
  const groups = cache.todoGroups;
  const gids = new Set((groups || []).map((g) => g.id));
  const gidOf = (t) => (t.group_id && gids.has(t.group_id) ? t.group_id : "");
  const grip = !!groups?.length;
  const folded = todoFolds();
  const loose = open.filter((t) => !gidOf(t));
  const groupHtml = (groups || []).map((g) => {
    const list = open.filter((t) => gidOf(t) === g.id);
    const shut = folded.has(g.id);
    return `<div class="td-group td-zone${shut ? " shut" : ""}" data-tzone="${g.id}">
      <div class="td-ghead">
        <button class="td-gfold" data-tfold="${g.id}" aria-expanded="${!shut}">
          <span class="td-gchev" aria-hidden="true">▾</span><span class="td-gname">${esc(g.name)}</span><span class="td-gcount">${list.length}</span>
        </button>
        <button class="td-gedit" data-tgedit="${g.id}" aria-label="그룹 수정">⋯</button>
      </div>
      <div class="td-gbody">
        ${list.length ? list.map((t) => todoRow(t, true)).join("") : `<div class="td-gempty">할 일을 끌어다 놓으면 이 그룹에 들어가요</div>`}
      </div>
    </div>`;
  }).join("");
  body.innerHTML = `
    <div class="todo-add">
      <input class="study-input" id="tdTitle" maxlength="200" placeholder="할 일을 적고 Enter">
      <button class="study-btn primary" id="tdAdd">추가</button>
    </div>
    ${todayList.length || open.length ? `<div class="td-todaybox">
      <div class="study-section td-head">오늘 할 일 ${todayList.length}개</div>
      ${todayList.length ? todayList.map((t) => todoRow(t)).join("")
        : `<div class="td-today-empty">할 일 옆 '오늘'을 누르면 여기에 모여요</div>`}
    </div>` : ""}
    <div class="study-section td-head">남은 할 일 ${open.length}개
      ${groups ? `<button class="study-btn small" id="tdGroupAdd">＋ 그룹</button>` : ""}</div>
    <div class="td-zone td-loose" data-tzone="">
      ${loose.length ? loose.map((t) => todoRow(t, grip)).join("")
        : `<div class="study-empty td-loose-empty">${open.length ? "그룹 밖으로 꺼내려면 여기에 놓으세요" : "남은 할 일이 없어요"}</div>`}
    </div>
    ${groupHtml}
    ${done.length ? `<div class="study-section td-head">완료 ${done.length}개<span class="td-done-note">끝낸 지 2일 뒤 사라져요</span></div>` + done.map((t) => todoRow(t)).join("") : ""}`;
  if (groups) $("tdGroupAdd").onclick = () => openGroupForm();
  body.querySelectorAll("[data-tfold]").forEach((b) => b.onclick = () => {
    const f = todoFolds();
    f.has(b.dataset.tfold) ? f.delete(b.dataset.tfold) : f.add(b.dataset.tfold);
    saveTodoFolds(f);
    const box = b.closest(".td-group");
    box.classList.toggle("shut");
    b.setAttribute("aria-expanded", !box.classList.contains("shut"));
  });
  body.querySelectorAll("[data-tgedit]").forEach((b) => b.onclick = () => openGroupForm(groups.find((g) => g.id === b.dataset.tgedit)));
  body.querySelectorAll("[data-tgrip]").forEach((h) => h.onpointerdown = (e) => startTodoDrag(e, h));
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
  body.querySelectorAll("[data-tedit]").forEach((b) => b.onclick = () => {
    const t = findTodo(b.dataset.tedit);
    if (t) t.shared ? openSharedTodo(t) : openTodoForm(t);
  });
  body.querySelectorAll("[data-tdel]").forEach((b) => b.onclick = () => removeTodo(b.dataset.tdel));
  body.querySelectorAll("[data-ttoday]").forEach((b) => b.onclick = () => toggleTodayTodo(b.dataset.ttoday));
  body.querySelectorAll("[data-tdue]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    openDuePop(b, cache.todos.find((t) => t.id === b.dataset.tdue));
  });
}

// ---------- 할 일 그룹 ----------
// 접은 그룹은 기기마다 따로 기억합니다 (기본은 모두 펼침)
const TODO_FOLD_KEY = "dshs-todo-fold";
function todoFolds() {
  try { return new Set(JSON.parse(localStorage.getItem(TODO_FOLD_KEY) || "[]")); } catch { return new Set(); }
}
function saveTodoFolds(s) { try { localStorage.setItem(TODO_FOLD_KEY, JSON.stringify([...s])); } catch {} }

// 손잡이(⠿)를 끌어 그룹 칸(또는 그룹 밖 칸)에 놓으면 그 그룹으로 옮깁니다. 마우스 · 터치 모두 포인터 이벤트로.
function startTodoDrag(e, handle) {
  if (e.button !== 0) return;
  e.preventDefault();
  closeDuePop();
  const body = $("studyBody");
  const row = handle.closest(".todo-row");
  const id = handle.dataset.tgrip;
  const from = row.closest("[data-tzone]")?.dataset.tzone ?? "";
  const r = row.getBoundingClientRect();
  const ghost = row.cloneNode(true);
  ghost.classList.add("td-ghost");
  Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
  document.body.appendChild(ghost);
  row.classList.add("td-dragging");
  body.classList.add("td-drag-on");
  const dy = e.clientY - r.top;
  let x = e.clientX, y = e.clientY, zone = null, raf = 0;
  const pick = () => {
    const z = document.elementFromPoint(x, y)?.closest("#studyBody [data-tzone]") || null;
    if (z !== zone) { zone?.classList.remove("over"); zone = z; zone?.classList.add("over"); }
  };
  const tick = () => {   // 화면 위 · 아래 끝에 가까우면 그쪽으로 스크롤
    const edge = 70;
    const v = y < edge ? -(edge - y) / 4 : y > innerHeight - edge ? (y - innerHeight + edge) / 4 : 0;
    if (v) { scrollBy(0, v); pick(); }
    raf = requestAnimationFrame(tick);
  };
  const move = (ev) => { x = ev.clientX; y = ev.clientY; ghost.style.top = `${y - dy}px`; pick(); };
  const end = (ev) => {
    cancelAnimationFrame(raf);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    ghost.remove();
    row.classList.remove("td-dragging");
    body.classList.remove("td-drag-on");
    zone?.classList.remove("over");
    if (ev.type === "pointerup" && zone && zone.dataset.tzone !== from) moveTodoToGroup(id, zone.dataset.tzone || null);
  };
  try { handle.setPointerCapture(e.pointerId); } catch {}
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  raf = requestAnimationFrame(tick);
  pick();
}

async function moveTodoToGroup(id, gid) {
  const t = cache.todos.find((x) => x.id === id);
  if (!t) return;
  const prev = t.group_id || null;
  t.group_id = gid;
  rerender();
  const { error } = await sb.from("todos").update({ group_id: gid }).eq("id", id);
  if (error) {
    t.group_id = prev;
    rerender();
    return toast("옮기지 못했어요", true);
  }
  saveSnap();
  const name = gid ? cache.todoGroups.find((g) => g.id === gid)?.name : "";
  undoToast(gid ? `'${name}' 그룹에 넣었어요` : "그룹에서 뺐어요", async () => {
    const { error } = await sb.from("todos").update({ group_id: prev }).eq("id", id);
    if (error) return toast("되돌리지 못했어요", true);
    t.group_id = prev;
    rerender();
  });
}

// 그룹 만들기 · 수정: 이름과, 지금 남은 할 일 중 넣을 것을 고릅니다
function openGroupForm(g) {
  const open = cache.todos.filter((t) => !t.done);
  const gname = new Map(cache.todoGroups.map((x) => [x.id, x.name]));
  openSheet(g ? "그룹 수정" : "그룹 만들기", `
    <label class="study-label">그룹 이름</label>
    <input class="study-input" id="tgName" maxlength="40" value="${g ? esc(g.name) : ""}" placeholder="예: 물리 실험, 동아리">
    ${open.length ? `<label class="study-label">넣을 할 일 (남은 할 일에서 골라요)</label>
    <div class="tg-picks">${open.map((t) => {
      const other = t.group_id && t.group_id !== g?.id ? gname.get(t.group_id) : "";
      return `<label class="tg-pick"><input type="checkbox" value="${t.id}"${g && t.group_id === g.id ? " checked" : ""}>
        <span class="tg-pick-title">${esc(t.title)}</span>${other ? `<span class="tg-pick-from">${esc(other)}</span>` : ""}</label>`;
    }).join("")}</div>` : ""}
    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="tgSave">${g ? "저장" : "만들기"}</button>
    ${g ? `<button class="study-submit ghost danger" id="tgDel">그룹 삭제 (할 일은 남아요)</button>` : ""}`);
  if (!g) $("tgName").focus();
  $("tgSave").onclick = async () => {
    const name = $("tgName").value.trim();
    if (!name) return showErr("그룹 이름을 적어 주세요.");
    const picked = [...document.querySelectorAll(".tg-pick input:checked")].map((c) => c.value);
    $("tgSave").disabled = true;
    let gid = g?.id;
    if (!g) {
      const position = Math.max(-1, ...cache.todoGroups.map((x) => x.position || 0)) + 1;
      const { data, error } = await sb.from("todo_groups").insert({ name, position }).select().single();
      if (error) { $("tgSave").disabled = false; return showErr("그룹을 만들지 못했어요."); }
      cache.todoGroups.push(data);
      gid = data.id;
    } else if (name !== g.name) {
      const { error } = await sb.from("todo_groups").update({ name }).eq("id", gid);
      if (error) { $("tgSave").disabled = false; return showErr("저장하지 못했어요."); }
      g.name = name;
    }
    const add = open.filter((t) => picked.includes(t.id) && t.group_id !== gid).map((t) => t.id);
    const out = g ? open.filter((t) => t.group_id === gid && !picked.includes(t.id)).map((t) => t.id) : [];
    const res = await Promise.all([
      add.length ? sb.from("todos").update({ group_id: gid }).in("id", add) : {},
      out.length ? sb.from("todos").update({ group_id: null }).in("id", out) : {},
    ]);
    if (!res[0].error) for (const t of open) if (add.includes(t.id)) t.group_id = gid;
    if (!res[1].error) for (const t of open) if (out.includes(t.id)) t.group_id = null;
    closeModal();
    rerender();
    saveSnap();
    if (res[0].error || res[1].error) toast("할 일 일부를 옮기지 못했어요", true);
    else toast(g ? "그룹을 저장했어요" : `'${name}' 그룹을 만들었어요`);
  };
  if (g) $("tgDel").onclick = async () => {
    if (!confirm(`'${g.name}' 그룹을 삭제할까요? 안에 있던 할 일은 그룹 밖으로 나와요.`)) return;
    const { error } = await sb.from("todo_groups").delete().eq("id", g.id);
    if (error) return showErr("삭제하지 못했어요.");
    cache.todoGroups = cache.todoGroups.filter((x) => x.id !== g.id);
    for (const t of cache.todos) if (t.group_id === g.id) t.group_id = null;
    const f = todoFolds(); if (f.delete(g.id)) saveTodoFolds(f);
    closeModal();
    rerender();
    saveSnap();
  };
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
  const t = findTodo(id);
  if (!t) return;
  const patch = { done: !t.done, done_at: t.done ? null : new Date().toISOString() };
  const { error } = await todoUpdate(t, patch);
  if (error) return toast("저장하지 못했어요", true);
  Object.assign(t, patch);
  rerender();
}

async function removeTodo(id) {
  const t = findTodo(id);
  if (t?.shared) return leaveTodo(t);
  const n = todoMembersOf(id).filter((m) => m.status === "approved").length;
  if (!confirm(n ? `이 할 일을 삭제할까요? 함께하는 친구 ${n}명의 목록에서도 사라져요.` : "이 할 일을 삭제할까요?")) return false;
  const { error } = await sb.from("todos").delete().eq("id", id);
  if (error) { toast("삭제하지 못했어요", true); return false; }
  cache.todos = cache.todos.filter((t) => t.id !== id);
  if (cache.todoMembers) cache.todoMembers = cache.todoMembers.filter((m) => m.todo_id !== id);
  rerender();
  return true;
}

// ---------- 할 일 함께하기 (todoshare.sql) ----------
// 내 할 일에 친구(학번)를 넣으면 그 친구 할 일 목록에도 생깁니다. 반민지 · 진주빈 계정은 바로,
// 다른 학생은 관리자가 관리자 사이트에서 승인한 뒤에 생깁니다 (서버가 todo_share_free() 로 정함 — 화면 값은 안내용).
// 공유받은 할 일(cache.sharedTodos, t.shared)은 제목 · 기한을 못 고치고, 완료 · 오늘 · 나가기만 각자 합니다.
const TODO_SHARE_FREE = [2202, 2113];
const allTodos = () => [...(cache.todos || []), ...(cache.sharedTodos || [])];
const findTodo = (id) => cache.todos?.find((t) => t.id === id) || cache.sharedTodos?.find((t) => t.id === id);
const todoMembersOf = (id) => (cache.todoMembers || []).filter((m) => m.todo_id === id);
// 내 것은 todos 행, 공유받은 것은 todo_members 의 내 행(완료 · 오늘)을 고칩니다
const todoUpdate = (t, patch) => t.shared
  ? sb.from("todo_members").update(patch).eq("todo_id", t.id).eq("student_id", me.student_id)
  : sb.from("todos").update(patch).eq("id", t.id);
function todoShareLabel(t) {
  if (t.shared) {
    const others = (t.member_sids || []).filter((sid) => sid !== me.student_id).length;
    return `${t.owner_name || "친구"}님이 공유${others ? ` · 함께 ${others + 1}명` : ""}`;
  }
  const ms = todoMembersOf(t.id);
  const ok = ms.filter((m) => m.status === "approved").length, wait = ms.filter((m) => m.status === "pending").length;
  return [ok && `함께 ${ok}명`, wait && `승인 대기 ${wait}명`].filter(Boolean).join(" · ");
}

async function leaveTodo(t) {
  if (!confirm("이 할 일에서 나갈까요? 내 목록에서만 사라지고, 다시 들어오려면 만든 친구가 넣어 줘야 해요.")) return false;
  const { error } = await sb.from("todo_members").delete().eq("todo_id", t.id).eq("student_id", me.student_id);
  if (error) { toast("나가지 못했어요", true); return false; }
  cache.sharedTodos = cache.sharedTodos.filter((x) => x.id !== t.id);
  toast("할 일에서 나갔어요");
  rerender();
  return true;
}

// 공유받은 할 일: 누가 만들었고 누구와 함께하는지 보여 주고, 완료 · 나가기만 합니다
function openSharedTodo(t) {
  const due = t.due_on ? todoDue(t.due_on) : null;
  const people = (t.member_sids || []).filter((sid) => sid !== me.student_id).map(rosterName);
  openSheet("함께하는 할 일", `
    <div class="asg-title">${esc(t.title)}</div>
    <div class="study-foot">${due ? `${esc(due.text)}까지 · ` : ""}${esc(t.owner_name || "친구")}님이 공유했어요</div>
    <label class="study-label">함께하는 사람</label>
    <div class="fr-chips"><span class="fr-chip">${esc(t.owner_name || "친구")}<small>만든 사람</small></span>${
      people.map((n) => `<span class="fr-chip">${esc(n)}</span>`).join("")}<span class="fr-chip">나</span></div>
    <div class="study-foot fr-note">제목 · 기한은 만든 친구만 고칠 수 있어요. 완료 체크와 '오늘'은 나에게만 적용돼요.</div>
    <button class="study-submit" id="tsDone">${t.done ? "완료 취소" : "완료"}</button>
    <button class="study-submit ghost danger" id="tsLeave">이 할 일에서 나가기</button>`);
  $("tsDone").onclick = async () => { closeModal(); await toggleTodo(t.id); };
  $("tsLeave").onclick = async () => { if (await leaveTodo(t)) closeModal(); };
}

// 할 일 수정 창의 '함께하는 친구' 칸. 학번으로 넣고 빼며, 저장할 때 바뀐 것만 보냅니다 (saveTodoFriends)
function mountTodoFriends(t) {
  const before = todoMembersOf(t.id).map((m) => ({ sid: m.student_id, status: m.status }));
  const friends = before.map((f) => ({ ...f }));
  const STATUS = { pending: "승인 대기", rejected: "반려됨" };
  const draw = () => {
    $("tfChips").innerHTML = friends.map((f, i) =>
      `<span class="fr-chip">${esc(rosterName(f.sid))}${STATUS[f.status] ? `<small>${STATUS[f.status]}</small>` : ""}<button type="button" data-rm="${i}" aria-label="${esc(rosterName(f.sid))} 빼기">✕</button></span>`).join("");
    $("tfChips").querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { friends.splice(+b.dataset.rm, 1); draw(); });
  };
  const add = (sid) => {
    if (sid === me.student_id || friends.some((f) => f.sid === sid)) return;
    friends.push({ sid });
  };
  draw();
  mountGroups("tfGroups", () => friends.map((f) => f.sid), (sids) => { sids.forEach(add); draw(); }, true);
  const find = (q) => roster().filter((p) => p.sid !== me.student_id && !friends.some((f) => f.sid === p.sid)
    && (/^\d+$/.test(q) ? String(p.sid).startsWith(q) : p.name.includes(q))).slice(0, 6);
  const show = () => {
    const q = $("tfQ").value.trim();
    if (isMulti(q)) { $("tfRes").innerHTML = multiHint(parseStudents(q)); return; }
    const list = q ? find(q) : [];
    $("tfRes").innerHTML = !q ? "" : list.length
      ? list.map((p) => `<button type="button" class="fr-item" data-sid="${p.sid}"><b>${esc(p.name)}</b><span>${p.sid}</span></button>`).join("")
      : `<div class="fr-empty">명단에 없어요. 이름이나 학번을 확인해 주세요.</div>`;
    $("tfRes").querySelectorAll("[data-sid]").forEach((b) => b.onclick = () => {
      add(+b.dataset.sid); draw();
      $("tfQ").value = ""; $("tfRes").innerHTML = ""; $("tfQ").focus();
    });
  };
  $("tfQ").oninput = show;
  $("tfQ").onkeydown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    setTimeout(() => {   // 한글 입력을 마무리한 뒤
      const q = $("tfQ").value.trim();
      if (!isMulti(q)) { show(); return $("tfRes").querySelector(".fr-item")?.click(); }
      const r = parseStudents(q);
      r.sids.forEach(add); draw();
      // 못 찾은 말만 칸에 남겨 고칠 수 있게 합니다
      $("tfQ").value = r.miss.join(" ");
      $("tfRes").innerHTML = r.miss.length ? multiHint({ sids: [], miss: r.miss }) : "";
      $("tfQ").focus();
    }, 0);
  };
  return {
    add: () => friends.filter((f) => !before.some((b) => b.sid === f.sid)).map((f) => f.sid),
    drop: () => before.filter((b) => !friends.some((f) => f.sid === b.sid)).map((b) => b.sid),
  };
}

async function saveTodoFriends(t, picker) {
  const add = picker.add(), drop = picker.drop();
  if (!add.length && !drop.length) return { added: 0 };
  const res = await Promise.all([
    add.length && sb.from("todo_members").insert(add.map((sid) => ({ todo_id: t.id, student_id: sid }))).select(),
    drop.length && sb.from("todo_members").delete().eq("todo_id", t.id).in("student_id", drop),
  ]);
  if (res.some((r) => r && r.error)) return { error: true };
  cache.todoMembers = [...cache.todoMembers.filter((m) => !(m.todo_id === t.id && drop.includes(m.student_id))), ...(res[0]?.data || [])];
  const rows = res[0]?.data || [];
  return { added: rows.length, waiting: rows.filter((m) => m.status === "pending").length };
}

function openTodoForm(t) {
  openSheet("할 일 수정", `
    <label class="study-label">할 일</label>
    <input class="study-input" id="tfTitle" maxlength="200" value="${esc(t.title)}">
    <label class="study-label">기한 (없어도 돼요 · 정하면 달력에도 떠요)</label>
    <input class="study-input" type="date" id="tfDue" value="${t.due_on || ""}">
    ${cache.todoGroups?.length ? `<label class="study-label">그룹</label>
    <select class="study-input" id="tfGroup">
      <option value="">그룹 없음</option>
      ${cache.todoGroups.map((g) => `<option value="${g.id}"${t.group_id === g.id ? " selected" : ""}>${esc(g.name)}</option>`).join("")}
    </select>` : ""}
    ${cache.todoMembers ? `<label class="study-label">함께하는 친구 (선택)</label>
    <div class="fr-chips" id="tfChips"></div>
    <div class="aud-quick" id="tfGroups"><span class="aud-label">그룹</span><span class="aud-hint">불러오는 중…</span></div>
    <input class="study-input" id="tfQ" autocomplete="off" placeholder="이름·학번으로 찾기 · 여러 명은 띄어 쓰고 Enter">
    <div class="fr-results" id="tfRes"></div>
    <div class="study-foot fr-note">${TODO_SHARE_FREE.includes(me.student_id)
      ? "넣은 친구 할 일 목록에도 바로 생겨요."
      : "관리자가 확인하고 승인하면 넣은 친구 할 일 목록에도 생겨요."} 제목 · 기한을 고치면 친구 목록에도 반영되고, 완료 체크는 각자 해요.</div>` : ""}
    <div class="study-err" id="authErr"></div>
    <button class="study-submit" id="tfSave">저장</button>
    <button class="study-submit ghost danger" id="tfDel">삭제</button>`);
  const picker = cache.todoMembers ? mountTodoFriends(t) : null;
  $("tfSave").onclick = async () => {
    const patch = { title: $("tfTitle").value.trim(), due_on: $("tfDue").value || null };
    if ($("tfGroup")) patch.group_id = $("tfGroup").value || null;
    if (!patch.title) return showErr("할 일을 입력해 주세요.");
    $("tfSave").disabled = true;
    const { error } = await sb.from("todos").update(patch).eq("id", t.id);
    if (error) { $("tfSave").disabled = false; return showErr("저장하지 못했어요."); }
    Object.assign(t, patch);
    const fr = picker ? await saveTodoFriends(t, picker) : { added: 0 };
    closeModal();
    rerender();
    if (fr.error) toast("할 일은 저장했지만 친구 목록을 바꾸지 못했어요", true);
    else if (fr.waiting) toast(`친구 ${fr.waiting}명은 관리자가 승인하면 공유돼요`);
    else if (fr.added) toast(`친구 ${fr.added}명과 함께하는 할 일이 됐어요`);
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
  pushReg = reg || pushReg;
  return reg ? reg.pushManager.getSubscription() : null;
}
// 설정 창을 열 때 받아 둡니다. 아이폰 · 아이패드는 알림 켜기를 누른 그 순간에 바로 구독해야 해서, 누른 뒤에 기다릴 틈이 없습니다.
let pushReg = null;
// 아이패드(iPadOS 13 이상)의 사파리는 자신을 Mac 으로 알려서, 터치가 되는 Mac 은 아이패드로 봅니다
const isAppleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// 예전에 다른 키로 만든 구독이면 서버가 보내도 도착하지 않으므로 새로 만듭니다
function sameKey(sub) {
  const k = sub.options?.applicationServerKey;
  if (!k) return true;   // 키를 알려 주지 않는 브라우저는 그대로 씁니다
  const want = urlB64ToUint8Array(CFG.VAPID_PUBLIC_KEY), got = new Uint8Array(k);
  return got.length === want.length && got.every((b, i) => b === want[i]);
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
  return !(isAppleMobile() && !isStandalone());
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

// 로그아웃: 서버 등록만 지우고 기기의 구독은 남겨 둡니다.
// 구독까지 지우면 다시 로그인할 때 새로 구독해야 하는데, 폰(특히 아이폰)은 버튼을 누르지 않으면 구독을 막아서 알림이 꺼진 채로 남습니다.
async function forgetPush() {
  const sub = await deviceSub().catch(() => null);
  if (sub) await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  pushOn = false;
}

// quiet: 로그인할 때 자동으로 켜는 경우 (안내를 띄우지 않음)
async function enablePush(quiet = false) {
  const say = quiet ? () => {} : toast;
  if (!CFG.VAPID_PUBLIC_KEY) return say("알림 키가 아직 설정되지 않았어요", true);
  const apple = isAppleMobile();
  const pad = /iPad|Macintosh/.test(navigator.userAgent);
  if (apple && !isStandalone()) return say(`${pad ? "아이패드는" : "아이폰은"} 홈 화면에 추가한 앱에서 알림을 켤 수 있어요`, true);
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return say(apple ? "iOS 16.4 이상으로 업데이트하면 알림을 쓸 수 있어요" : "이 브라우저는 알림을 지원하지 않아요", true);
  }
  const subscribe = (reg) => reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(CFG.VAPID_PUBLIC_KEY),
  });

  let sub = null;
  if (!quiet && apple && Notification.permission === "default" && pushReg) {
    // 아이폰 · 아이패드: 누른 순간 바로 구독하면 허락 창이 함께 뜹니다 (먼저 다른 걸 기다리면 막힘)
    sub = await subscribe(pushReg).catch(() => null);
    if (!sub) return say(Notification.permission === "denied" ? "알림이 차단되어 있어요" : "알림을 켜지 못했어요. 한 번 더 눌러 주세요", true);
  } else {
    // 자동으로 켤 때는 이미 허락된 상태라 다시 묻지 않습니다 (폰은 버튼 없이 물으면 거절로 처리하기도 함)
    const perm = quiet ? Notification.permission : await Notification.requestPermission();
    if (perm !== "granted") return say("알림이 차단되어 있어요", true);
    const reg = pushReg || await navigator.serviceWorker.ready;
    sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub)) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await subscribe(reg);
  }
  const j = sub.toJSON();
  // 같은 기기가 예전에 다른 계정으로 등록돼 있어도 지금 계정으로 넘겨받습니다 (schema.sql 의 save_push)
  let { error } = await sb.rpc("save_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error?.code === "PGRST202") {   // 함수를 아직 만들지 않은 DB
    ({ error } = await sb.from("push_subscriptions").upsert({
      endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: me.id,
    }));
  }
  if (error) return say("알림 등록에 실패했어요", true);
  pushOn = true;
  paintPush();
  say("수행평가는 1일·6시간 전, 일정은 30분 전에 알려드릴게요");
}

init();
