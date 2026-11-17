// ============================================================
// dshsplus — 42기 앱(/42/) · 43기 앱(/43/) 안에서 함께 도는 스크립트
// scripts/build-plus.mjs 가 두 앱의 index.html <head> 맨 앞에 window.PLUS_APP(42 · 43)과 함께 넣습니다.
// 두 앱의 코드는 고치지 않고, 여기서만 dshsplus 에 필요한 일을 합니다.
//  1. 내 기수 맞추기: 설정에서 고른 기수(계정의 user_metadata.plus_cohort) · 없으면 로그인한 계정의 학번 기수가
//     이 앱이 아니면 그 기수 앱으로 옮깁니다. 지난 화면(dshs-snap)으로도 미리 봅니다. 설정 창에 '사이트 화면 42기 · 43기' 줄을 넣습니다.
//  2. 두 기수 검색: 시간표 검색 칸(#nameInput)에 다른 기수 학생도 나오고, 누르면 지금 앱의 시간표 자리에
//     그 학생 시간표를 그 학생 기수의 모양(42기 · 43기 시간표 칸)으로 그립니다 (자료는 묶을 때 만든 ../plus-tt.json, 다른 기수 앱으로 넘어가지 않음).
//  3. 로그인 전 · 오프라인은 42기 앱만 씁니다: 로그인 전이면 42기의 '흐린 시간표 + 시작하기' 화면, 오프라인이면 42기의 시간표 검색만
//     (43기 앱은 로그인 · 온라인일 때만 — 로그아웃되거나 오프라인이 되면 42기 앱으로 옮김).
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
  const OFF = "dshsplus-offline";   // 43기 앱이 오프라인이라 42기로 옮겼음 (이 탭에서만) — 서버에 다시 닿을 때까지 43기로 돌려보내지 않음
  const offMark = () => { try { return !!sessionStorage.getItem(OFF); } catch { return false; } };
  const loggingIn = () => /dshs_login=|[?&]code=/.test(location.hash + location.search);
  if (APP === 43 && !session()?.access_token && !loggingIn()) { leave(42); return; }   // 로그인 전 → 42기 시작하기 화면
  try {
    if (offMark()) throw 0;
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
      if (APP === 43) {
        // 로그아웃했거나 오프라인이면 42기 앱으로 (42기 앱이 시작하기 화면 · 오프라인 시간표 검색을 보여 줌)
        const off = document.body?.classList.contains("offline");
        if (off || (!session()?.access_token && !loggingIn())) {
          clearInterval(watch);
          if (off) { try { sessionStorage.setItem(OFF, "1"); } catch {} }
          leave(42);
          return;
        }
      }
      const m = await whoAmI();
      if (!m) return;
      try { sessionStorage.removeItem(OFF); } catch {}   // 서버에 닿음 → 다시 내 기수로
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

  // 1-3b. 43기 앱에서 42기 앱의 서비스 워커도 미리 설치해 둡니다 — 오프라인이 되어 42기로 옮겨도 열리게
  if (APP === 43 && navigator.serviceWorker && navigator.onLine) {
    addEventListener("load", () => setTimeout(() => navigator.serviceWorker.register("../42/sw.js", { scope: "../42/" }).catch(() => {}), 3000));
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
  const loadTT = () => ttData || (ttData = fetch("../plus-tt.json").then((r) => (r.ok ? r.json() : Promise.reject())).catch(() => (ttData = null)));
  // 인터넷이 있을 때 미리 한 번 받아 둡니다 — 서비스 워커가 저장해 두어 오프라인 검색에서도 다른 기수 시간표가 나옴
  addEventListener("load", () => setTimeout(() => { if (navigator.onLine) loadTT(); }, 4000));
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
  // 그 학생 기수의 시간표 모양으로 그립니다 — 42기: 칸 안 둥근 상자(div)에 색 · 43기: 칸(td) 전체에 색, 이어지는 교시는 한 칸으로.
  // 다른 기수 앱 안에서 그릴 때는 그 기수의 칸 모양을 .plus-ui-42 · .plus-ui-43 안에서만 다시 정합니다 (두 앱 CSS 의 값을 옮겨 온 것 —
  // 두 앱의 시간표 색 · 칸 모양을 바꾸면 여기도 함께 고칩니다)
  const C42 = [["124,111,224", "#a78bfa"], ["224,111,158", "#f472b6"], ["111,224,196", "#34d399"], ["96,165,250", "#60a5fa"], ["251,146,60", "#fb923c"],
    ["250,204,21", "#facc15"], ["52,211,153", "#6ee7b7"], ["167,139,250", "#c4b5fd"], ["248,113,113", "#fca5a5"], ["129,140,248", "#a5b4fc"],
    ["45,212,191", "#5eead4"], ["251,191,36", "#fbbf24"], ["52,211,153", "#a7f3d0"]];
  const C43 = ["#9f86e4", "#f08fb0", "#78cb87", "#7aa5e9", "#fbaa68", "#ebc26a", "#a6c96f", "#d094ec", "#eb8471", "#6cc4e6", "#97d9db", "#c8a78c", "#8a9be8"];
  const UI_CSS = {
    42: `.plus-ui-42 .timetable-wrap{border-radius:16px}
.plus-ui-42 .timetable td{padding:6px;vertical-align:middle;background:none;box-shadow:none}
.plus-ui-42 .class-cell{border-radius:8px;padding:5px 6px;font-weight:700;line-height:1.3;height:42px;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.plus-ui-42 .class-cell .subj-name{font-size:10.5px;font-weight:700}
.plus-ui-42 .class-cell .ban-name{font-size:9px;opacity:.8;margin-top:1px}
.plus-ui-42 .class-cell.common-cell{background:rgba(136,136,170,.12);color:var(--text-dim);border:1px dashed var(--border)}
${C42.map(([rgb, c], i) => `.plus-ui-42 .class-cell.color-${i}{background:rgba(${rgb},${i === 12 ? 0.2 : 0.25});color:${c};border:1px solid rgba(${rgb},${i === 12 ? 0.2 : 0.3})}`).join("\n")}
@media (max-width:600px){.plus-ui-42 .timetable td{padding:2px;height:46px}.plus-ui-42 .class-cell{padding:2px 1px;border-radius:6px;overflow:hidden;word-break:keep-all}.plus-ui-42 .class-cell .subj-name{font-size:10px;line-height:1.2;letter-spacing:-.03em}}`,
    43: `.plus-ui-43 .timetable-wrap{border-radius:0}
.plus-ui-43 .timetable td{padding:0 0 0 1px}
.plus-ui-43 .timetable td.plus-c{vertical-align:top;box-shadow:inset 1px 0 0 var(--card)}
.plus-ui-43 .class-cell{border-radius:0;border:0;background:none;padding:5px 6px;font-weight:600;line-height:1.3;height:auto;min-height:50px;color:#fff;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;text-align:left}
.plus-ui-43 .class-cell .subj-name{font-size:14px;font-weight:600}
.plus-ui-43 .class-cell .ban-name{font-size:12px;opacity:.8;margin-top:1px}
.plus-ui-43 .timetable td.plus-common{background:color-mix(in srgb,#aab2bd 70%,transparent)}
${C43.map((c, i) => `.plus-ui-43 .timetable td.plus-color-${i}{background:color-mix(in srgb,${c} 70%,transparent)}`).join("\n")}
@media (max-width:600px){.plus-ui-43 .class-cell{padding:3px;min-height:0;overflow:hidden;word-break:keep-all}.plus-ui-43 .class-cell .subj-name{font-size:11px;line-height:1.2;letter-spacing:-.03em}.plus-ui-43 .class-cell .ban-name{font-size:9px}}`,
  };
  const addCss = (c) => {
    if (c === APP || $(`plusUi${c}`)) return;   // 지금 앱의 기수면 앱 CSS 그대로
    document.head.insertAdjacentHTML("beforeend", `<style id="plusUi${c}">${UI_CSS[c]}</style>`);
  };
  function gridHtml(cells, c) {
    addCss(c);
    const last = Math.max(7, ...Object.keys(cells).map((k) => +k.split("-")[1]));
    const skip = new Set();   // 43기: 위 칸에 묶인 교시
    let rows = "";
    for (let p = 1; p <= last; p++) {
      rows += `<tr><td class="period-col">${p}</td>` + DAYS.map((d) => {
        const k = `${d}-${p}`;
        if (skip.has(k)) return "";
        const x = cells[k];
        if (!x) return `<td><div class="empty-cell"></div></td>`;
        const inner = `<div class="subj-name">${esc(x.name)}</div><div class="ban-name">${esc(x.sub)}</div>`;
        if (c === 42) return `<td><div class="class-cell ${x.color === null ? "common-cell" : `color-${x.color}`}">${inner}</div></td>`;
        let span = 1;
        for (let n; (n = cells[`${d}-${p + span}`]) && n.name === x.name && n.sub === x.sub; span++) skip.add(`${d}-${p + span}`);
        // 43기 앱 안이면 앱 CSS(td.color-n · td.common-cell)를 그대로, 42기 앱 안이면 위 .plus-ui-43 규칙으로
        const cls = x.color === null ? `plus-c plus-common${APP === 43 ? " common-cell" : ""}` : `plus-c plus-color-${x.color}${APP === 43 ? ` color-${x.color}` : ""}`;
        return `<td class="${cls}"${span > 1 ? ` rowspan="${span}"` : ""}><div class="class-cell">${inner}</div></td>`;
      }).join("") + "</tr>";
    }
    return `<div class="plus-ui-${c}"><div class="timetable-wrap"><table class="timetable">
      <thead><tr><th></th>${DAYS.map((d, i) => `<th class="day-header ${DAY_CLASS[i]}">${d}요일</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
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
      ${g && Object.keys(g.cells).length ? gridHtml(g.cells, OTHER) : `<div class="study-empty">시간표를 불러오지 못했어요.</div>`}`;
    // 오프라인 · 로그인 전(내 시간표 탭이 없음)에는 '← 내 시간표' 없이
    const hasMine = APP === 43 || (!document.body.classList.contains("offline") && document.querySelector('#studyNav [data-page="mytt"]'));
    const back = hasMine ? `<button class="study-btn tt-back" id="plusBack" type="button">← 내 시간표</button>` : "";
    if (APP === 42) {
      const res = $("result");
      if (!res) return;
      $("errorMsg")?.classList.remove("show");
      if ($("welcomeState")) $("welcomeState").style.display = "none";
      if ($("studyView")) $("studyView").style.display = "none";
      res.innerHTML = back + body;
      res.classList.add("show");
      if ($("plusBack")) $("plusBack").onclick = () => document.querySelector('#studyNav [data-page="mytt"]')?.click();
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
