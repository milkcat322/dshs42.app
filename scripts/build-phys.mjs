// 일반물리학Ⅱ 노트(공부 탭) 만들기: 원본 HTML 하나 → phys.html(권진영T) · phys2.html(윤석민T)
//   node scripts/build-phys.mjs <일반물리학II.html>
// 원본은 저장소 밖에 있다(두 선생님 내용이 한 파일에 든 필기 노트). 여기서 하는 일:
//   · 선생님별로 두 페이지로 나눔 (공부 탭의 과목 → 파트(선생님) 틀에 맞춤. 단원 · 첫 화면의 흐름 판 · 위쪽 줄을 그 선생님 것만 남김)
//   · 수식 글꼴(KaTeX)은 미적분학Ⅱ 와 같아 calc-fonts.css 를 함께 씀 (다르면 멈춤)
//   · 색 · 글꼴 · 모서리를 dshs42.app 에 맞춤 (PHYS_CSS), 사이트 테마는 페이지가 직접 읽음 (HEAD_JS). 원본의 '어둡게' 버튼은 뺌
//   · 공부 탭 안에서는 틀 없이 높이를 내용에 맞춤 (FIT_JS), 폰에서는 첫 화면의 흐름 판을 한 줄로 쌓음
// 노트 내용을 고칠 때는 원본을 고쳐 다시 돌리거나, 작은 수정이면 phys*.html 을 바로 고친다 (다시 돌리면 덮어쓰임).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [, , src] = process.argv;
if (!src) { console.error('쓰는 법: node scripts/build-phys.mjs <일반물리학II.html>'); process.exit(1); }

// key = 원본의 단원 id 머리글자 (v-k29 · v-y30 …)
const PARTS = [
  { n: 1, key: 'k', file: 'phys.html', who: '권진영T', title: '전자기파 · 빛과 전자의 이중성', views: 5 },
  { n: 2, key: 'y', file: 'phys2.html', who: '윤석민T', title: '기하광학 · 파동광학', views: 4 },
];

// 화면을 그리기 전에: 공부 탭 안(?embed=1)이면 사이트 색을 그대로 읽어 오고, 따로 열면 마지막에 읽어 둔 색을 씁니다.
const HEAD_JS = (n) => `<script>
// dshs42.app '공부' 탭의 일반물리학Ⅱ (phys.html = 권진영T · phys2.html = 윤석민T). scripts/build-phys.mjs 가 만듭니다.
// 공부 탭 안(?embed=1)에서는 사이트의 색 변수(--bg · --text …)를 그대로 읽어 테마를 따르고, 사이트가 테마를 바꾸면 vocabTheme() 을 부릅니다.
// 따로 열면 마지막으로 읽어 둔 색(dshs-calc-pal, 미적분학Ⅱ 와 함께 씀)을, 없으면 사이트 기본 밝은 · 어두운 색을 씁니다.
window.PHYS_PART = ${n};
window.PHYS_EMBED = new URLSearchParams(location.search).has('embed') && window.parent !== window;
(function () {
  var BASE = {
    light: { tone: 'light', bg: '#f5f5fa', surface: '#ffffff', card: '#eeeef5', border: '#d9d9e6', accent: '#6a5cd6', text: '#1b1b28', dim: '#5a5a76' },
    dark: { tone: 'dark', bg: '#0a0a0f', surface: '#12121a', card: '#1a1a26', border: '#2a2a3d', accent: '#7c6fe0', text: '#e8e8f0', dim: '#8888aa' }
  };
  var TONE = { dark: 'dark', light: 'light', ocean: 'dark', forest: 'dark', coco: 'light', sakura: 'light' };
  function siteTheme() {
    var t = null;
    try { t = localStorage.getItem('dshs-theme'); } catch (e) {}
    return TONE[t] ? t : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  // 움직이는 그림(캔버스)은 색을 #rrggbb 로만 읽으므로 어떤 색 표기든 그렇게 바꿉니다
  var cx = null;
  function hex(v) {
    try { cx = cx || document.createElement('canvas').getContext('2d'); cx.fillStyle = '#000'; cx.fillStyle = v; return /^#[0-9a-f]{6}$/i.test(cx.fillStyle) ? cx.fillStyle : v; } catch (e) { return v; }
  }
  window.vocabTheme = function () {
    var r = document.documentElement, pal = null;
    if (window.PHYS_EMBED) {
      try {
        var p = window.parent.document.documentElement, cs = window.parent.getComputedStyle(p);
        var v = function (k) { return cs.getPropertyValue(k).trim(); };
        pal = { theme: p.dataset.theme, tone: p.dataset.tone === 'light' ? 'light' : 'dark', bg: v('--bg'), surface: v('--surface'), card: v('--card'), border: v('--border'), accent: v('--accent1'), text: v('--text'), dim: v('--text-dim') };
        if (!pal.bg || !pal.text) pal = null;
        else { try { localStorage.setItem('dshs-calc-pal', JSON.stringify(pal)); } catch (e) {} }
      } catch (e) {}
    }
    if (!pal) {
      var th = siteTheme();
      try { var s = JSON.parse(localStorage.getItem('dshs-calc-pal')); if (s && s.theme === th && s.bg) pal = s; } catch (e) {}
      if (!pal) pal = BASE[TONE[th]];
    }
    r.dataset.theme = pal.tone; r.style.colorScheme = pal.tone;
    var set = { '--paper': pal.bg, '--surface': pal.surface, '--card': pal.card, '--line': pal.border, '--accent': pal.accent, '--ink': pal.text, '--muted': pal.dim };
    for (var k in set) if (set[k]) r.style.setProperty(k, hex(set[k]));
    // 문서와 iframe 의 색 모드가 다르면 브라우저가 iframe 뒤에 흰(검은) 바탕을 깔아 사이트 배경이 가려집니다
    try { if (window.PHYS_EMBED && window.frameElement) window.frameElement.style.colorScheme = pal.tone; } catch (e) {}
    if (window.__physColors) window.__physColors();   // 움직이는 그림의 색도 다시 읽음
  };
  if (window.PHYS_EMBED) document.documentElement.classList.add('embed');
  window.vocabTheme();
})();
</script>`;

// 사이트(dshs42.app) 모양에 맞추는 스타일. 원본 스타일 뒤에 붙어 덮어씁니다.
const PHYS_CSS = `<style>
/* ===== dshs42.app 에 맞춤 (scripts/build-phys.mjs 의 PHYS_CSS) =====
   바탕 · 글자 · 선 색(--paper --surface --ink --muted --line --accent --card)은 머리의 vocabTheme() 이 사이트 테마에서 읽어 넣습니다.
   필기 펜 색(파랑 정의 · 빨강 조건 · 주황 증명 · 보라 · 초록 · 노랑 예시)은 뜻이 있어 그대로 두고 밝기만 따릅니다. */
:root{--font:"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;--accent:#6a5cd6;--card:#eeeef5}
:root[data-theme="dark"]{--accent:#7c6fe0;--card:#1a1a26}
body{-webkit-text-size-adjust:100%}
:is(a,button,[tabindex],input):focus-visible{outline-color:var(--accent)}
#theme{display:none}   /* 밝기는 사이트 테마를 따릅니다 */

/* 파트 고르기 (권진영T · 윤석민T): 따로 열었을 때만 */
.parts{max-width:1280px;margin:0 auto;padding:16px 24px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:stretch}
.parts a{flex:1 1 230px;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:9px 14px;font-size:13.5px;font-weight:700;color:var(--muted);text-decoration:none;text-align:center;line-height:1.4;transition:border-color .2s,color .2s}
.parts a small{font-size:12px;font-weight:400}
.parts a:hover{border-color:var(--accent);color:var(--ink)}
.parts a.on{background:var(--accent);border-color:transparent;color:#fff}
.parts a.side{flex:0 0 auto;font-weight:600;font-size:12.5px}

/* 위에 붙는 단원 줄 */
.bar{background:color-mix(in srgb,var(--paper) 90%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.bar .home{font-weight:600;font-size:12.5px;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:5px 12px}
.bar .home:hover{border-color:var(--accent);color:var(--ink)}
.steps button{font-weight:500;font-size:13px}
.steps button.on{color:var(--accent);border-bottom-color:var(--accent);font-weight:700}
.steps em{border-radius:7px;margin-left:0}
.pill{border-radius:11px}

/* 첫 화면 */
#home{padding-top:34px}
#home h1{font-size:32px;font-weight:900;letter-spacing:-.01em}
.howto .arw{margin-left:0}
.home-h{font-weight:500}
/* 흐름 판: 원본은 5칸 고정이라 단원이 4개인 파트는 한 칸이 비어, 단원 수만큼 칸을 나눔 */
.board.hm{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}
.hn{border-radius:12px}
.hn:hover{box-shadow:0 8px 22px color-mix(in srgb,var(--accent) 20%,transparent);border-color:var(--accent)}
.hn.star:hover{box-shadow:0 8px 22px color-mix(in srgb,var(--cond) 20%,transparent);border-color:var(--cond)}

/* 노트 한 장: 뜻 없는 상자는 사이트의 옅은 선, 색 있는 상자(정의 · 조건 · 증명 …)는 그대로 */
.view>h2{font-weight:700}
.nb,.sim{border:1px solid var(--line);border-radius:12px}
.nb.def{border:1.4px solid var(--def)} .nb.cond{border:1.4px solid var(--cond)} .nb.pf{border:1.4px solid var(--proof)} .nb.ext{border:1.4px solid var(--ext)} .nb.grn{border:1.4px solid var(--grn)}
.nb.dash{border:1.3px dashed var(--muted)}
.nb.ylw,.nb.tn{border-color:transparent}
.nb.bare{border:0;border-radius:0}
.hn.star{border:1.4px solid var(--cond)}
.sub{border-radius:10px;border-color:var(--line)}
.sub.def{border-color:var(--def)} .sub.cond{border-color:var(--cond)}
.core{border-radius:6px}
.fold>.cap{border-radius:9px}
.why>.in>.w{border-radius:0 10px 10px 0}
.msg{border-radius:0 8px 8px 0}
.flowb .st{border-radius:9px}
.chain>span,.par .cell{border-radius:9px}
.sym{border-top-color:var(--line)} .sym>.sh,.sym>div:first-child{border-bottom-color:var(--line)}
.ctl input[type=range]{accent-color:var(--accent)}
svg.lks path{stroke:var(--muted);opacity:.55} svg.lks path.hd{fill:var(--muted)}
svg.lks g:hover path{opacity:1}
.pop{border:1px solid var(--line);border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.28)}
.pop .x{border-radius:9px;color:var(--muted)}
[stroke="#c23a2b"]{stroke:var(--cond)} [fill="#c23a2b"]{fill:var(--cond)}

/* 폰(좁은 화면) */
@media (max-width:640px){
  .parts{padding:12px 14px 0}
  .wrap{padding:0 14px 60px}
  #home h1{font-size:24px}
  .howto{font-size:12.5px;gap:6px 14px}
  /* 위쪽 줄: 처음으로 + 단원(옆으로 밀기) */
  .bar .in{flex-wrap:nowrap;padding:6px 10px;gap:8px}
  .bar .home{padding:4px 10px;font-size:12px;flex:0 0 auto}
  .steps{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;min-width:0}
  .steps::-webkit-scrollbar{display:none}
  .steps>*{flex:0 0 auto}
  /* 첫 화면의 흐름 판: 한 줄로 쌓음 (화살표는 상자 자리에 맞춰 다시 그려짐) */
  #home .sheetw{overflow:visible;padding:0}
  .board.hm{grid-template-columns:minmax(0,1fr);grid-auto-flow:row;grid-auto-columns:auto;min-width:0;gap:30px}
  /* 노트 한 장: 필기 배치(상자 자리 · 화살표)가 넓은 화면 기준이라 폰에서도 그대로 두고 옆으로 밀어 봄 */
  .view>h2{font-size:18px;margin:18px 0 4px}
  .sheetw{-webkit-overflow-scrolling:touch}
  .view:not(#home) .sheetw::before{content:"↔ 옆으로 밀어서 보기";display:block;position:sticky;left:0;font-size:11.5px;color:var(--muted);margin-bottom:6px}
}

/* dshs42.app 공부 탭 안 (html.embed): 사이트 배경이 비치게 */
html.embed,html.embed body{background:transparent}
/* 공부 탭 안에서는 파트 줄 · 새 창 버튼을 사이트(renderLearn)가 그립니다. 페이지 안의 것은 따로 열었을 때만 */
html.embed .parts{display:none}
html.embed #home{padding-top:22px}
html.embed #home h1{display:none}
/* 틀 없이(html.fit, 높이를 내용에 맞춤 · 스크롤은 사이트가 함): 화면 기준이던 것들을 보이는 부분(--vt · --vh)에 붙임 */
html.fit,html.fit body{overflow:hidden}
html.fit .wrap{padding:0 0 30px}
html.fit .bar{position:relative;top:auto;border-radius:12px;border:1px solid var(--line);will-change:transform}
html.fit .bar .in{padding:6px 12px}
html.fit #home{padding-top:14px}
html.fit .pop{max-height:min(520px,calc(var(--vh,100vh) - 24px))}
/* Netlify 무료 요금제 배지가 틀 안에도 하나 더 생기는 것을 숨김 (바깥 사이트의 배지는 그대로) */
html.embed #nl-badge-frame,html.embed #nl-hud-frame{display:none!important}
</style>`;

// 공부 페이지 사용 기록 (learnuse.sql · learn-track.js): 본 시간 · 단원을 남김
const TRACK_TAG = '<!-- 공부 페이지 사용 기록 (learnuse.sql) -->\n<script src="learn-track.js" defer></script>';
const partsNav = (n) => `<nav class="parts" id="parts" aria-label="일반물리학Ⅱ 파트">
${PARTS.map((p) => `  <a data-file="${p.file}"${p.n === n ? ' class="on" aria-current="page"' : ''}>${p.who} <small>${p.title}</small></a>`).join('\n')}
  <a class="side" href="./">← dshs42.app</a>
</nav>
<script>
// href 를 HTML 에 직접 쓰면 Netlify 가 'phys2.html' → '/phys2' 로 바꿔 서비스 워커가 못 알아봄
document.querySelectorAll('#parts a[data-file]').forEach(function (a) { a.href = a.dataset.file; });
</script>`;

// 공부 탭 안에서 '틀 없이' 보일 때(높이를 내용에 맞추고 스크롤은 사이트가 함):
// 위에 붙는 단원 줄 · 화살표 설명 창은 화면 기준이라, 사이트 스크롤에 맞춰 '지금 보이는 부분'(--vt 위쪽 · --vh 높이)에 붙여 줍니다.
const FIT_JS = `<script>
(function () {
  if (!window.PHYS_EMBED) return;
  var fe = null; try { fe = window.frameElement; } catch (e) {}
  if (!fe || fe.classList.contains('fill')) return;
  var P = window.parent, root = document.documentElement, bar = document.getElementById('bar'), pop = document.getElementById('pop');
  root.classList.add('fit');
  // 사이트의 위에 붙는 탭 줄(폰)이 가리는 높이
  function sticky() {
    try { var nb = P.document.querySelector('.nav-bar'); if (nb && P.getComputedStyle(nb).position === 'sticky') { var r = nb.getBoundingClientRect(); if (r.top <= 1) return Math.max(0, r.bottom); } } catch (e) {}
    return 0;
  }
  var vt = 0, vh = 0;
  function pin() {
    var r = fe.getBoundingClientRect(), H = fe.offsetHeight, st = sticky();
    vt = Math.min(Math.max(0, st - r.top), H); var vb = Math.max(vt, Math.min(H, P.innerHeight - r.top)); vh = vb - vt;
    root.style.setProperty('--vt', vt + 'px'); root.style.setProperty('--vh', vh + 'px');
    if (bar) bar.style.transform = 'translateY(' + Math.max(0, Math.min(vt - bar.offsetTop, H - bar.offsetTop - bar.offsetHeight)) + 'px)';
  }
  // 높이는 내용만큼. 설명 창이 설 자리가 있게 화면의 80% 는 넘깁니다
  function size() { fe.style.height = Math.max(document.body.offsetHeight, Math.round(P.innerHeight * 0.8)) + 'px'; pin(); }
  // 단원을 바꾸면 원본이 맨 위로 올리는데(window.scrollTo(0,0)), 틀이 화면 위로 넘어가 있을 때만 사이트를 틀의 처음으로 올립니다
  window.scrollTo = function () { var r = fe.getBoundingClientRect(), st = sticky(); if (r.top < st) P.scrollBy(0, r.top - st - 8); };
  // 화살표 설명 창: 원본은 이 틀 전체를 화면으로 보고 자리를 잡으므로, 지금 보이는 부분 밖으로 나가면 안으로 들입니다
  if (pop && window.MutationObserver) new MutationObserver(function () {
    if (pop.hidden) return;
    var top = parseFloat(pop.style.top) || 0, lo = vt + (bar ? bar.offsetHeight + 8 : 8), hi = vt + vh - pop.offsetHeight - 10;
    var t = Math.max(lo, Math.min(top, hi));
    if (Math.abs(t - top) > 1) pop.style.top = t + 'px';
  }).observe(pop, { attributes: true, attributeFilter: ['hidden', 'style'] });
  P.addEventListener('scroll', pin, { passive: true }); P.addEventListener('resize', size);
  window.addEventListener('pagehide', function () { P.removeEventListener('scroll', pin); P.removeEventListener('resize', size); });
  if (window.ResizeObserver) new ResizeObserver(size).observe(document.body);
  window.addEventListener('load', size);
  size();
})();
</script>`;

let html = readFileSync(src, 'utf8');

// 1) 수식 글꼴 블록: 미적분학Ⅱ 의 calc-fonts.css 와 같은지 확인하고 뺌 (그 뒤의 KaTeX 배치 스타일은 남김)
const fm = html.match(/<style>\s*(@font-face\{[^\n]*)\s*<\/style>\s*/);
if (!fm) throw new Error('글꼴 블록을 못 찾음');
const all = fm[1].replace(/font-display:block;/g, '').trim();
const end = all.indexOf('}', all.lastIndexOf('@font-face')) + 1;
if (!readFileSync(join(ROOT, 'calc-fonts.css'), 'utf8').includes(all.slice(0, end))) throw new Error('수식 글꼴이 calc-fonts.css 와 다름: 따로 두어야 함');
const katex = all.slice(end);
html = html.replace(fm[0], '');

const headEnd = html.indexOf('</head>');
const style = html.slice(html.indexOf('<style>'), headEnd);
const body0 = html.slice(headEnd + 7);

for (const p of PARTS) {
  const other = PARTS.find((x) => x !== p);
  let body = body0;
  const must = (re, to, n = 1) => {
    const hit = body.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [];
    if (hit.length !== n) throw new Error(`${p.who}: ${re} 가 ${hit.length}번 (기대 ${n}번)`);
    body = body.replace(re, to);
  };
  // 다른 선생님의 단원 · 위쪽 줄 · 첫 화면 흐름 판을 뺌
  must(new RegExp(`<section class="view" id="v-${other.key}[^"]*"[\\s\\S]*?</section>\\s*`, 'g'), '', other.views);
  must(new RegExp(`\\s*<em>${other.who}</em>(\\s*<button data-go="v-${other.key}[^"]*">[^<]*</button>)+`), '');
  must(new RegExp(`\\s*<div class="home-h">${other.who}[^<]*</div>\\s*<div class="sheetw"><div class="board hm">[\\s\\S]*?</div></div>`), '');
  if ((body.match(/<section class="view" id="v-/g) || []).length !== p.views) throw new Error(`${p.who}: 단원 수가 ${p.views} 가 아님`);
  // 첫 화면 한 줄 소개: 이 선생님 것만
  must(/<p class="hsub">([\s\S]*?)<\/p>/, (m, t) => {
    const mine = t.split(' · ').find((x) => x.startsWith(p.who + ' — '));
    if (!mine) throw new Error(`${p.who}: 한 줄 소개를 못 찾음`);
    return `<p class="hsub">${mine}</p>`;
  });
  must(/<h1>일반물리학 II<\/h1>/, `<h1>일반물리학Ⅱ <small style="font-size:.5em;font-weight:500;color:var(--muted)">${p.who}</small></h1>`);
  // 위쪽 줄: 맨 앞 버튼은 어디로 가는지 알 수 있게, FIT_JS 가 찾을 id
  must(/<header class="bar">/, '<header class="bar" id="bar">');
  must(/(<button class="home" data-go="home")>[^<]*<\/button>/, '$1 title="첫 화면">← 단원 흐름</button>');
  // 사이트 테마가 바뀌면 움직이는 그림의 색도 다시 읽게
  must(/\nreadC\(\);\n/, '\nreadC();\nwindow.__physColors = readC;\n');
  body = body.replace(/<body[^>]*>/, (b) => b + '\n' + partsNav(p.n));
  const i = body.lastIndexOf('</body>');
  if (i < 0) throw new Error('</body> 없음');
  body = body.slice(0, i) + FIT_JS + '\n' + TRACK_TAG + '\n' + body.slice(i);

  const out = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>일반물리학Ⅱ · ${p.who} ${p.title}</title>
<link rel="icon" href="favicon-32.png" sizes="32x32">
${HEAD_JS(p.n)}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="calc-fonts.css">
<style>${katex}</style>
${style.trimEnd()}
${PHYS_CSS}
</head>${body}`;
  writeFileSync(join(ROOT, p.file), out);
  console.log(p.file, (out.length / 1024).toFixed(0) + ' KB');
}
