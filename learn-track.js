// 공부 페이지 사용 기록 (learnuse.sql 의 log_learn). 공부 탭의 페이지들(vocab · bio · calc · phys · algo …)이 함께 씁니다.
// 화면이 실제로 보이고(탭이 가려지거나 공부 탭을 떠나면 멈춤) 최근 2분 안에 조작이 있던 동안만 시간을 세어,
// 30초쯤마다 · 화면을 떠날 때 파트 · 안쪽 화면(section)별로 서버에 더합니다. 학생 화면에는 아무것도 보이지 않습니다.
// 퀴즈 정답 · 쓴 답 같은 내용은 보내지 않습니다. 사이트(dshs-study.js)와 같은 주소라 로그인 기록 · 기기 ID 를 localStorage 에서 읽습니다.
// 새 페이지를 만들면: 이 파일을 불러오고(<script src="learn-track.js" defer>), 아래 PART · section() 에 한 줄 더합니다.
(function () {
  'use strict';
  var file = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  var EMBED = new URLSearchParams(location.search).has('embed') && window.parent !== window;
  var PART = { bio: 'bio', bio2: 'bio2', calc: 'calc', calc2: 'calc2', phys: 'phys', phys2: 'phys2', algo: 'algo', algograph: 'algograph' };   // 파일 → LEARN_SUBJECTS 의 파트 id (단어장은 주소의 #과목)
  var NAME = /^[a-z][a-z0-9_]{0,23}$/;
  var IDLE = 120000, TICK = 5000, SEND = 30000, REOPEN = 300000;
  var top = window;
  try { if (EMBED && window.parent.document) top = window.parent; } catch (e) {}

  function part() {
    if (file === 'vocab') { var h = location.hash.slice(1).split(/[/?&]/)[0]; return NAME.test(h) ? h : null; }
    return PART[file] || null;
  }
  // 파트 안에서 지금 보는 곳
  var bioLeaf = null;
  function section() {
    var s = 'home', e;
    try {
      if (file === 'vocab') { e = document.querySelector('.nav-tab.active'); if (e) s = e.dataset.tab; }
      else if (file === 'bio') { if (bioLeaf && bioLeaf.open) s = bioLeaf.dataset.m; }
      else if (file === 'bio2') { s = document.documentElement.dataset.ch || 'home'; }   // 단원 ch21 · ch22 · ch23
      else if (file === 'algo') { s = document.documentElement.dataset.p || 'home'; }   // 코드 빈칸: 푸는 문제 id
      else { e = document.querySelector('section.view:not([hidden])'); if (e) s = e.id.replace(/^v-/, ''); }
    } catch (x) {}
    s = String(s || 'home').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
    return /^[a-z0-9]/.test(s) ? s : 'home';
  }
  if (file === 'bio') document.addEventListener('toggle', function (ev) {
    var d = ev.target;
    if (d && d.classList && d.classList.contains('leaf') && d.open) bioLeaf = d;
  }, true);

  // 조작이 있었는지: 공부 탭 안에서는 스크롤을 사이트가 하므로 사이트 창의 조작도 함께 봅니다
  var lastAct = Date.now();
  function act() { lastAct = Date.now(); }
  var EVS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];
  EVS.forEach(function (n) { window.addEventListener(n, act, { passive: true, capture: true }); });
  if (top !== window) EVS.forEach(function (n) { try { top.addEventListener(n, act, { passive: true, capture: true }); } catch (e) {} });

  function shown() {
    if (document.visibilityState !== 'visible') return false;
    try { if (EMBED && window.frameElement && !window.frameElement.getClientRects().length) return false; } catch (e) {}
    return true;
  }

  // ----- 서버로 보내기 -----
  var cfg = null;
  function config() {
    if (cfg) return cfg;
    try { cfg = top.DSHS_CONFIG || window.DSHS_CONFIG || null; } catch (e) {}
    return cfg;
  }
  if (!config() && !EMBED) {   // 따로 연 창에는 설정이 없어 받아 옵니다
    var sc = document.createElement('script'); sc.src = 'config.js'; document.head.appendChild(sc);
  }
  function demo() { try { return !!top.DSHS_DEMO; } catch (e) { return false; } }
  function device() {
    try {
      var st = JSON.parse(localStorage.getItem('dshs-visit') || '{}');
      if (st.skip) return null;   // 관리자 기기는 세지 않습니다
      if (!st.id) {
        st.id = (crypto.randomUUID && crypto.randomUUID()) || (Date.now().toString(36) + Math.random().toString(36).slice(2));
        localStorage.setItem('dshs-visit', JSON.stringify(st));
      }
      return st.id;
    } catch (e) { return null; }
  }
  function token() {
    try {
      var s = JSON.parse(localStorage.getItem('dshs-study-auth'));
      if (s && s.access_token && s.expires_at * 1000 > Date.now() + 5000) return s.access_token;
    } catch (e) {}
    return null;
  }
  function kind() {
    var ua = navigator.userAgent;
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
    return /iPhone|iPod|Android|Mobile/.test(ua) ? 'phone' : 'pc';
  }
  function post(body, tok) {
    var c = config();
    return fetch(c.SUPABASE_URL + '/rest/v1/rpc/log_learn', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: c.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (tok || c.SUPABASE_ANON_KEY) },
      body: JSON.stringify(body),
    });
  }

  var acc = {};        // "파트|section" → { secs, opens }
  function add(p, s, secs, opens) {
    var k = p + '|' + s, a = acc[k] || (acc[k] = { secs: 0, opens: 0 });
    a.secs += secs; a.opens += opens;
  }
  function flush() {
    if (demo()) return;
    var c = config(), dev = device();
    if (!c || !c.SUPABASE_URL || !dev) { acc = {}; return; }
    var keys = Object.keys(acc).filter(function (k) { return acc[k].secs >= 1 || acc[k].opens; });
    if (!keys.length) return;
    var batch = acc; acc = {};
    keys.forEach(function (k) {
      var a = batch[k], i = k.indexOf('|');
      var body = { p_device: dev, p_part: k.slice(0, i), p_section: k.slice(i + 1), p_secs: Math.round(a.secs), p_opens: a.opens,
        p_win: !EMBED, p_kind: kind(), p_cohort: 42 };
      var tok = token();
      post(body, tok)
        .then(function (r) { return r.status === 401 && tok ? post(body, null) : r; })   // 로그인 기록이 막 끝났으면 기기로만 남깁니다
        .then(function (r) { if (!r.ok && r.status >= 500) throw 0; })
        .catch(function () { if (a.secs < 600) add(k.slice(0, i), k.slice(i + 1), a.secs, a.opens); });   // 못 보낸 것은 다음에 다시
    });
  }

  // ----- 시간 세기 -----
  var prev = Date.now(), lastOn = 0, lastSend = Date.now(), opened = {};
  function tick() {
    var now = Date.now(), gap = now - prev;
    prev = now;
    var p = part();
    if (!p || !shown() || now - lastAct > IDLE) return;
    var s = section();
    // 처음 볼 때 · 5분 넘게 쉬었다 다시 볼 때 한 번 열었다고 셉니다
    var open = (!opened[p] || now - lastOn > REOPEN) ? 1 : 0;
    opened[p] = true; lastOn = now;
    add(p, s, Math.min(gap, TICK + 1000) / 1000, open);   // 잠들었다 깬 긴 간격은 한 번 치만
    if (now - lastSend >= SEND) { lastSend = now; flush(); }
  }
  setInterval(tick, TICK);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { tick(); flush(); } else { prev = Date.now(); act(); }
  });
  window.addEventListener('pagehide', function () {
    tick(); flush();
    if (top !== window) EVS.forEach(function (n) { try { top.removeEventListener(n, act, { capture: true }); } catch (e) {} });
  });
})();
