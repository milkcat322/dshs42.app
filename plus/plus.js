// ============================================================
// dshsplus.app — 42기 앱(/42/) · 43기 앱(/43/) 안에서 함께 도는 스크립트
// scripts/build-plus.mjs 가 두 앱의 index.html <head> 맨 앞에 window.PLUS_APP(42 · 43)과 함께 넣습니다.
// 두 앱의 코드는 고치지 않고, 여기서만 dshsplus 에 필요한 일을 합니다.
//  1. 내 기수 맞추기: 설정에서 고른 기수(계정의 user_metadata.plus_cohort) · 없으면 로그인한 학생(me)의 학번 기수가
//     이 앱이 아니면 그 기수 앱으로 옮깁니다. 지난 화면(dshs-snap)으로도 미리 봅니다. 설정 창에 '사이트 화면 42기 · 43기' 줄을 넣습니다.
//  2. 두 기수 검색: 시간표 검색 칸(#nameInput)에 다른 기수 학생도 나오고, 누르면 그 기수 앱에서 시간표를 엽니다 (?plusfind=학번).
// 두 앱은 같은 주소(origin)라 로그인(dshs-study-auth)과 이 기기 저장(localStorage)을 함께 씁니다.
// ============================================================
(function () {
  const APP = window.PLUS_APP;
  if (APP !== 42 && APP !== 43) return;
  const OTHER = APP === 42 ? 43 : 42;
  const KEY = "dshsplus-cohort";   // 첫 화면(/)이 바로 열 기수 (로그인한 학생의 기수)
  const cohortOf = (sid) => (sid >= 1000 && sid <= 1999 ? 43 : 42);
  const save = (c) => { try { localStorage.setItem(KEY, String(c)); } catch {} };
  const params = new URLSearchParams(location.search);
  const find = params.get("plusfind");   // 다른 기수 앱에서 검색해 온 학생의 학번 (이때는 내 기수로 되돌리지 않음)
  const goCohort = (c) => { location.replace(`../${c}/${location.search}${location.hash}`); };

  // 다른 기수 앱에서 잠깐 보는 동안에는 지난 화면(dshs-snap)을 읽지도 남기지도 않습니다
  // (두 앱의 지난 화면 모양이 달라, 내 기수 앱이 남긴 것을 이 앱이 그리거나 그 반대가 되지 않게)
  if (find) {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (k) { return k === "dshs-snap" ? null : get.call(this, k); };
    Storage.prototype.setItem = function (k, v) { if (k !== "dshs-snap") set.call(this, k, v); };
  }

  // 어느 기수 화면으로 열지는 계정에 저장합니다: 설정에서 고른 값(로그인 계정의 user_metadata.plus_cohort) → 없으면 학번으로.
  // 로그인 정보(dshs-study-auth)는 이 기기에 그대로 남아 있어 서버를 기다리지 않고 읽습니다.
  const picked = () => {
    try {
      const c = +JSON.parse(localStorage.getItem("dshs-study-auth") || "null")?.user?.user_metadata?.plus_cohort;
      return c === 42 || c === 43 ? c : null;
    } catch { return null; }
  };
  const leave = (c) => {
    try { localStorage.removeItem("dshs-snap"); } catch {}   // 다른 기수 앱이 남긴 지난 화면은 쓰지 않음 (모양이 다름)
    save(c);
    goCohort(c);
  };

  // 1-1. 그리기 전에(앱 스크립트보다 먼저) 고른 기수 · 지난 화면의 학번이 이 앱이 아니면 그 기수로
  if (!find) {
    try {
      const snap = JSON.parse(localStorage.getItem("dshs-snap") || "null");
      const sid = snap?.me?.is_admin ? null : snap?.me?.student_id;
      const c = picked() || (sid ? cohortOf(sid) : null);
      if (c && c !== APP) { leave(c); return; }
    } catch {}
  }

  // 1-2. 로그인한 학생을 보고 기수를 맞춥니다.
  // 42기 앱(dshs-study.js)은 모듈이라 앱의 me · sb 를 밖에서 읽을 수 없어, 이 기기의 로그인 정보로 서버에 직접 묻습니다
  // (내 프로필은 본인이 읽을 수 있음 · 로그인 계정 정보 고치기는 /auth/v1/user).
  const CFG = () => window.DSHS_CONFIG || {};
  const session = () => { try { return JSON.parse(localStorage.getItem("dshs-study-auth") || "null"); } catch { return null; } };
  const api = (path, init = {}) => {
    const s = session(), c = CFG();
    if (!s?.access_token || !c.SUPABASE_URL) return Promise.resolve(null);
    return fetch(c.SUPABASE_URL + path, { ...init, headers: { apikey: c.SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json", ...(init.headers || {}) } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  };
  let prof = null;   // { id, student_id, is_admin } — 지금 로그인한 계정 것
  async function whoAmI() {
    const uid = session()?.user?.id;
    if (!uid) { prof = null; return null; }
    if (prof?.id === uid) return prof;
    const rows = await api(`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,student_id,is_admin`);
    if (Array.isArray(rows) && rows[0]) prof = rows[0];   // 실패(토큰 만료 등)하면 다음에 다시
    return prof?.id === uid ? prof : null;
  }
  let busy = false;
  const watch = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const m = await whoAmI();
      if (!m) return;
      const c = picked() || (m.student_id && !m.is_admin ? cohortOf(m.student_id) : null);
      if (!c) return;
      save(c);
      if (c !== APP && !find) { clearInterval(watch); leave(c); }
    } finally { busy = false; }
  }, 1000);

  // 1-3. 설정 창에 '사이트 화면 42기 · 43기' 줄 (두 앱 모두 설정 창 맨 아래에 로그아웃 단추 #doLogout 이 있음)
  const addSiteRow = () => {
    const out = document.getElementById("doLogout");
    if (!out || document.getElementById("plusSite")) return;
    const btn = (c) => `<button type="button" class="study-btn small${c === APP ? " primary" : ""}" data-plus-c="${c}">${c}기</button>`;
    out.insertAdjacentHTML("beforebegin", `<div class="set-row" id="plusSite">
      <span><b>사이트 화면</b><span class="ev-hint">42기 · 43기 중 어느 화면으로 열지 골라요. 계정에 저장돼 다른 기기에서도 같아요</span></span>
      <span style="display:flex;gap:6px;flex:none">${btn(42)}${btn(43)}</span></div>`);
    document.querySelectorAll("#plusSite [data-plus-c]").forEach((b) => b.onclick = async () => {
      const c = +b.dataset.plusC;
      if (c === APP) return;
      b.disabled = true;
      // 학번과 같은 기수면 따로 남기지 않고(null) 지웁니다 → 학번대로
      const m = await whoAmI();
      const value = m?.student_id && !m.is_admin && cohortOf(m.student_id) === c ? null : c;
      const user = await api("/auth/v1/user", { method: "PUT", body: JSON.stringify({ data: { plus_cohort: value } }) });
      if (!user?.id) { b.disabled = false; return; }
      // 이 기기의 로그인 정보에도 바로 반영 (다음에 열 때 서버를 기다리지 않고 그 기수로)
      try { const s = session(); s.user = user; localStorage.setItem("dshs-study-auth", JSON.stringify(s)); } catch {}
      leave(c);
    });
  };
  new MutationObserver(addSiteRow).observe(document.documentElement, { childList: true, subtree: true });

  // 2. 두 기수 검색 ------------------------------------------------
  const otherList = () => ((window.PLUS_ROSTER || {})[OTHER] || []);   // [[학번, 이름], ...] (plus-roster.js)
  const otherHits = (q) => {
    q = q.trim().replace(/\s+/g, " ");
    if (!q) return [];
    if (/^\d{4}$/.test(q)) return otherList().filter(([sid]) => String(sid) === q);
    if (/^\d+$/.test(q)) return [];
    return otherList().filter(([, name]) => name.includes(q)).slice(0, 4);
  };
  const exactOther = (q) => {
    q = q.trim().replace(/\s+/g, " ");
    const hits = otherList().filter(([sid, name]) => name === q || String(sid) === q);
    return hits.length === 1 ? hits[0] : null;
  };
  // 이 앱에서 찾을 수 있는 것(학생 · 선생님 · 과목 · 반)이면 다른 기수로 넘기지 않습니다
  const ownHas = (q) => {
    q = q.trim();
    try {
      if (APP === 42) {
        const key = q.replace(/\s*(선생님|샘|쌤|T)$/, "").trim();
        return !!(SCHOOL_DATA[q] || SCHOOL_DATA[key] || ID_TO_NAME[q.replace(/[^0-9]/g, "")]   // eslint-disable-line no-undef
          || (typeof TEACHER_SUBJECTS !== "undefined" && (TEACHER_SUBJECTS[q] || TEACHER_SUBJECTS[key])));   // eslint-disable-line no-undef
      }
      return ttFind(q).some((h) => h.type === "student" || h.type === "ban");   // eslint-disable-line no-undef
    } catch { return false; }
  };
  const openOther = (sid) => { location.href = `../${OTHER}/?plusfind=${encodeURIComponent(sid)}`; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 앱이 자기 목록을 그린 뒤(같은 input 이벤트의 요소 처리기 다음) 다른 기수 학생을 덧붙입니다
  document.addEventListener("input", (e) => {
    const q = e.target;
    if (q?.id !== "nameInput") return;
    const box = q.parentElement?.querySelector(".suggestions");
    if (!box) return;
    box.querySelectorAll(".plus-other").forEach((x) => x.remove());
    const hits = otherHits(q.value);
    if (!hits.length) return;
    box.querySelectorAll(".tt-sugg-none").forEach((x) => x.remove());   // 43기 앱의 '찾는 학생이 없어요'
    box.insertAdjacentHTML("beforeend", hits.map(([sid, name]) =>
      `<div class="suggestion-item plus-other" data-plus-sid="${sid}"><span>${esc(name)}</span><span class="suggestion-id">${sid} · ${OTHER}기</span></div>`).join(""));
    box.classList.add("show");
  });
  document.addEventListener("click", (e) => {
    const item = e.target.closest?.("[data-plus-sid]");
    if (item) { e.preventDefault(); e.stopPropagation(); openOther(item.dataset.plusSid); }
  }, true);
  // 엔터 · 검색 버튼: 이 앱에 없는 이름 · 학번이 다른 기수 학생 한 명과 꼭 맞으면 그 기수 앱으로
  const tryOther = (e) => {
    const q = document.getElementById("nameInput");
    if (!q || ownHas(q.value)) return;
    const hit = exactOther(q.value);
    if (!hit) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openOther(hit[0]);
  };
  document.addEventListener("keydown", (e) => {
    if (e.target?.id === "nameInput" && e.key === "Enter" && !e.isComposing) tryOther(e);
  }, true);
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("#searchBtn, #ttGo")) tryOther(e);
  }, true);

  // ?plusfind=학번 으로 왔으면, 로그인하고 내 화면이 뜬 뒤 그 학생 시간표를 엽니다
  if (find) {
    const sid = Number(find);
    const tries = setInterval(() => {
      if (!session()?.user) return;   // 로그인한 뒤에
      try {
        if (APP === 42) {
          const name = (window.ID_TO_NAME || {})[String(sid)];
          if (!name) return clearInterval(tries);
          // 로그인 뒤 첫 화면(내 시간표, 43기 학생이면 내 일정)이 뜬 뒤에 — 위쪽 메뉴가 보이면 다 뜬 것
          if (document.getElementById("studyNav")?.style.display !== "flex") return;
          document.getElementById("nameInput").value = name;
          searchStudent();   // eslint-disable-line no-undef
        } else {
          if (typeof openTtView !== "function" || !document.getElementById("nameInput")) return;   // eslint-disable-line no-undef
          openTtView({ type: "student", sid });   // eslint-disable-line no-undef
        }
      } catch { return; }
      clearInterval(tries);
      history.replaceState(null, "", location.pathname + location.hash);
    }, 400);
    setTimeout(() => clearInterval(tries), 60000);
    // 내 기수 앱으로 돌아가는 단추
    const back = () => {
      if (document.getElementById("plusBack")) return;
      document.body.insertAdjacentHTML("beforeend",
        `<a id="plusBack" href="../" style="position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;`
        + `padding:10px 16px;border-radius:999px;background:var(--accent1,#7c6fe0);color:#fff;font:600 13px/1 'Noto Sans KR',sans-serif;`
        + `text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.35)">← 내 기수로 돌아가기</a>`);
    };
    if (document.body) back(); else document.addEventListener("DOMContentLoaded", back);
  }
})();
