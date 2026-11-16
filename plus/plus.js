// ============================================================
// dshsplus — 42기 앱(/42/) · 43기 앱(/43/) 안에서 함께 도는 스크립트
// scripts/build-plus.mjs 가 두 앱의 index.html <head> 맨 앞에 window.PLUS_APP(42 · 43)과 함께 넣습니다.
// 두 앱의 코드는 고치지 않고, 여기서만 dshsplus 에 필요한 일을 합니다.
//  1. 내 기수 맞추기: 설정에서 고른 기수(계정의 user_metadata.plus_cohort) · 없으면 로그인한 계정의 학번 기수가
//     이 앱이 아니면 그 기수 앱으로 옮깁니다. 지난 화면(dshs-snap)으로도 미리 봅니다. 설정 창에 '사이트 화면 42기 · 43기' 줄을 넣습니다.
//  2. 두 기수 검색: 시간표 검색 칸(#nameInput)에 다른 기수 학생도 나오고, 누르면 지금 앱의 시간표 자리에
//     그 학생 시간표를 이 앱의 모양으로 그립니다 (자료는 묶을 때 만든 ../plus-tt.json, 다른 기수 앱으로 넘어가지 않음).
// 두 앱은 같은 주소(origin)라 로그인(dshs-study-auth)과 이 기기 저장(localStorage)을 함께 씁니다.
// 42기 앱(dshs-study.js)은 모듈이라 앱의 me · sb 를 밖에서 읽을 수 없어, 로그인 정보로 서버에 직접 묻습니다.
// ============================================================
(function () {
  const APP = window.PLUS_APP;
  if (APP !== 42 && APP !== 43) return;
  const OTHER = APP === 42 ? 43 : 42;
  const KEY = "dshsplus-cohort";   // 첫 화면(/)이 바로 열 기수 (계정에 맞춘 마지막 값)
  const cohortOf = (sid) => (sid >= 1000 && sid <= 1999 ? 43 : 42);
  const save = (c) => { try { localStorage.setItem(KEY, String(c)); } catch {} };
  const goCohort = (c) => { location.replace(`../${c}/${location.search}${location.hash}`); };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);

  // 1. 내 기수 맞추기 ------------------------------------------------
  const session = () => { try { return JSON.parse(localStorage.getItem("dshs-study-auth") || "null"); } catch { return null; } };
  // 어느 기수 화면으로 열지: 설정에서 고른 값(계정의 user_metadata.plus_cohort) → 없으면 학번으로
  const picked = () => { const c = +session()?.user?.user_metadata?.plus_cohort; return c === 42 || c === 43 ? c : null; };
  const leave = (c) => {
    try { localStorage.removeItem("dshs-snap"); } catch {}   // 다른 기수 앱이 남긴 지난 화면은 쓰지 않음 (모양이 다름)
    save(c);
    goCohort(c);
  };

  // 1-1. 그리기 전에(앱 스크립트보다 먼저) 고른 기수 · 지난 화면의 학번이 이 앱이 아니면 그 기수로
  try {
    const snap = JSON.parse(localStorage.getItem("dshs-snap") || "null");
    const sid = snap?.me?.is_admin ? null : snap?.me?.student_id;
    const c = picked() || (sid ? cohortOf(sid) : null);
    if (c && c !== APP) { leave(c); return; }
  } catch {}

  // 1-2. 로그인한 계정을 서버에 물어 기수를 맞춥니다 (내 프로필은 본인이 읽을 수 있음)
  const CFG = () => window.DSHS_CONFIG || {};
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
      if (c !== APP) { clearInterval(watch); leave(c); }
    } finally { busy = false; }
  }, 1000);

  // 1-3. 43기 앱은 42기 계정이면 "43기 사이트예요 · dshs42.app 열기" 창(openOtherCohort, js/start.js)을 띄우고
  //      이 기기 알림 등록까지 지웁니다. dshsplus 에서는 그 대신 42기 화면(../42/)으로 옮깁니다.
  //      설정에서 43기를 골라 둔 42기 계정이면 그 선택을 지워 둘 사이를 오가지 않게 합니다.
  if (APP === 43) {
    const swap = () => {
      try {
        window.openOtherCohort = async () => {
          if (picked() === 43) {
            const user = await api("/auth/v1/user", { method: "PUT", body: JSON.stringify({ data: { plus_cohort: null } }) });
            // 서버에 못 지웠어도 이 기기에서는 지웁니다 (두 앱 사이를 계속 오가지 않게)
            try {
              const s = session();
              s.user = user?.id ? user : { ...s.user, user_metadata: { ...(s.user?.user_metadata || {}), plus_cohort: null } };
              localStorage.setItem("dshs-study-auth", JSON.stringify(s));
            } catch {}
          }
          leave(42);
        };
      } catch {}
    };
    swap();
    document.addEventListener("DOMContentLoaded", swap);   // 앱 스크립트(defer)가 함수를 만든 뒤 다시 바꿔 끼움
  }

  // 1-4. 설정 창에 '사이트 화면 42기 · 43기' 줄 (두 앱 모두 설정 창 맨 아래에 로그아웃 단추 #doLogout 이 있음)
  const addSiteRow = () => {
    const out = $("doLogout");
    if (!out || $("plusSite")) return;
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
  const nameOf = (sid) => otherList().find(([s]) => s === sid)?.[1] || String(sid);
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

  // 다른 기수 시간표 자료 (묶을 때 만든 ../plus-tt.json, 처음 쓸 때 한 번 받음)
  let ttData = null;
  const loadTT = () => ttData || (ttData = fetch("../plus-tt.json").then((r) => (r.ok ? r.json() : null)).catch(() => (ttData = null)));
  const DAYS = ["월", "화", "수", "목", "금"], DAY_CLASS = ["mon", "tue", "wed", "thu", "fri"];

  // 다른 기수 학생의 시간표 → { meta, cells: { "월-1": { name, sub, color | null(공통 활동) } } }
  function otherGrid(sid, data) {
    if (OTHER === 43) {
      const d = data[43];
      const ban = d.override[sid] ?? Math.floor(sid / 100) % 10;
      const cells = {};
      for (const [k, s] of Object.entries(d.bans[ban] || {})) {
        const i = d.subjects.indexOf(s);
        cells[k] = { name: d.label[s] || s, sub: i >= 0 ? `${ban}반` : "전체", color: i >= 0 ? i % 13 : null };
      }
      return { meta: `학번 ${sid} · 43기 1학년 ${ban}반`, cells };
    }
    const d = data[42];
    const cells = {};
    for (const [day, p, s, ban] of d.students[sid] || []) {
      const k = `${day}-${p}`;
      if (cells[k]) continue;
      const common = d.common.includes(s);
      cells[k] = { name: d.short[s] || s, sub: common ? "전체" : ban, color: common ? null : Math.max(0, d.order.indexOf(s)) % 13 };
    }
    return { meta: `학번 ${sid} · 42기 2학년`, cells };
  }
  // 지금 앱의 시간표 표 모양으로 그립니다 (42기: 칸 안 div 에 색 · 43기: 칸(td)에 색)
  function gridHtml(cells) {
    const last = Math.max(7, ...Object.keys(cells).map((k) => +k.split("-")[1]));
    let rows = "";
    for (let p = 1; p <= last; p++) {
      rows += `<tr><td class="period-col">${p}</td>` + DAYS.map((d) => {
        const c = cells[`${d}-${p}`];
        if (!c) return `<td><div class="empty-cell"></div></td>`;
        const inner = `<div class="subj-name">${esc(c.name)}</div><div class="ban-name">${esc(c.sub)}</div>`;
        if (APP === 42) return `<td><div class="class-cell ${c.color === null ? "common-cell" : `color-${c.color}`}">${inner}</div></td>`;
        return c.color === null ? `<td class="common-cell"><div class="class-cell">${inner}</div></td>`
          : `<td class="color-${c.color}"><div class="class-cell">${inner}</div></td>`;
      }).join("") + "</tr>";
    }
    return `<div class="timetable-wrap"><table class="timetable">
      <thead><tr><th></th>${DAYS.map((d, i) => `<th class="day-header ${DAY_CLASS[i]}">${d}요일</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  // 지금 앱의 시간표 자리에 다른 기수 학생 시간표를 그립니다
  async function showOther(sid) {
    sid = +sid;
    const name = nameOf(sid);
    document.querySelectorAll(".suggestions").forEach((b) => b.classList.remove("show"));
    const q = $("nameInput");
    if (q) { q.value = name; q.blur(); }
    const data = await loadTT();
    const g = data ? otherGrid(sid, data) : null;
    const body = `<div class="student-profile">
        <div class="student-avatar">${esc(name[0] || "?")}</div>
        <div class="student-info"><h2>${esc(name)}</h2><div class="student-meta">${esc(g?.meta || `학번 ${sid} · ${OTHER}기`)}</div></div>
      </div>
      ${g && Object.keys(g.cells).length ? gridHtml(g.cells) : `<div class="study-empty">시간표를 불러오지 못했어요.</div>`}`;
    const back = `<button class="study-btn tt-back" id="plusBack" type="button">← 내 시간표</button>`;
    if (APP === 42) {
      const res = $("result");
      if (!res) return;
      $("errorMsg")?.classList.remove("show");
      if ($("welcomeState")) $("welcomeState").style.display = "none";
      if ($("studyView")) $("studyView").style.display = "none";
      res.innerHTML = back + body;
      res.classList.add("show");
      $("plusBack").onclick = () => document.querySelector('#studyNav [data-page="mytt"]')?.click();
    } else {
      try {
        $("studyView").innerHTML = ttSearchHtml() + back + body;   // eslint-disable-line no-undef
        bindTtSearch();   // eslint-disable-line no-undef
        $("nameInput").value = name;
        $("plusBack").onclick = () => openTtView(null);   // eslint-disable-line no-undef
      } catch { return; }
    }
    scrollTo({ top: 0 });
  }

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
    loadTT();   // 고르기 전에 미리 받아 둠
  });
  document.addEventListener("click", (e) => {
    const item = e.target.closest?.("[data-plus-sid]");
    if (item) { e.preventDefault(); e.stopPropagation(); showOther(item.dataset.plusSid); }
  }, true);
  // 엔터 · 검색 버튼: 이 앱에 없는 이름 · 학번이 다른 기수 학생 한 명과 꼭 맞으면 그 학생 시간표를
  const tryOther = (e) => {
    const q = $("nameInput");
    if (!q || ownHas(q.value)) return;
    const hit = exactOther(q.value);
    if (!hit) return;
    e.preventDefault(); e.stopImmediatePropagation();
    showOther(hit[0]);
  };
  document.addEventListener("keydown", (e) => {
    if (e.target?.id === "nameInput" && e.key === "Enter" && !e.isComposing) tryOther(e);
  }, true);
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("#searchBtn, #ttGo")) tryOther(e);
  }, true);
})();
