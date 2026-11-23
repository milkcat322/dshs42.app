// 미적분학Ⅱ 노트(공부 탭) 만들기: 원본 HTML 두 개 → calc.html(문세현T) · calc2.html(전경아T) · calc-fonts.css
//   node scripts/build-calc.mjs <문세현T내용.html> <전경아T내용.html>
// 원본은 저장소 밖에 있다(혼자 열어 보는 필기 노트). 여기서 하는 일:
//   · 수식 글꼴(KaTeX, base64 37만 자)을 calc-fonts.css 한 파일로 빼 두 파트가 함께 씀
//   · 색 · 글꼴 · 모서리를 dshs42.app 에 맞춤 (CALC_CSS), 사이트 테마는 calc 페이지가 직접 읽음 (HEAD_JS)
//   · 문세현T 원본에 직접 박힌 색(#1a2233 등)을 색 변수로 바꿔 어두운 테마에서도 보이게 함
//   · 맨 위에 파트 고르기(.parts)를 넣음
// 노트 내용을 고칠 때는 원본을 고쳐 다시 돌리거나, 작은 수정이면 calc*.html 을 바로 고친다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA_TOOLS, EXTRA_PILLS, EXTRA_HTML } from './calc-extras.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [, , srcA, srcB] = process.argv;
if (!srcA || !srcB) { console.error('쓰는 법: node scripts/build-calc.mjs <문세현T내용.html> <전경아T내용.html>'); process.exit(1); }

const PARTS = [
  { n: 1, file: 'calc.html', src: srcA, who: '문세현T', title: '미분에서 야코비안까지' },
  { n: 2, file: 'calc2.html', src: srcB, who: '전경아T', title: '벡터장 미적분학' },
];

// 화면을 그리기 전에: 공부 탭 안(?embed=1)이면 사이트 색을 그대로 읽어 오고, 따로 열면 마지막에 읽어 둔 색을 씁니다.
const HEAD_JS = (n) => `<script>
// dshs42.app '공부' 탭의 미적분학Ⅱ (calc.html = 문세현T · calc2.html = 전경아T). scripts/build-calc.mjs 가 만듭니다.
// 공부 탭 안(?embed=1)에서는 사이트의 색 변수(--bg · --text …)를 그대로 읽어 테마를 따르고, 사이트가 테마를 바꾸면 vocabTheme() 을 부릅니다.
// 따로 열면 마지막으로 읽어 둔 색(dshs-calc-pal)을, 없으면 사이트 기본 밝은 · 어두운 색을 씁니다.
window.CALC_PART = ${n};
window.CALC_EMBED = new URLSearchParams(location.search).has('embed') && window.parent !== window;
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
  window.vocabTheme = function () {
    var r = document.documentElement, pal = null;
    if (window.CALC_EMBED) {
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
    for (var k in set) if (set[k]) r.style.setProperty(k, set[k]);
    // 문서와 iframe 의 색 모드가 다르면 브라우저가 iframe 뒤에 흰(검은) 바탕을 깔아 사이트 배경이 가려집니다
    try { if (window.CALC_EMBED && window.frameElement) window.frameElement.style.colorScheme = pal.tone; } catch (e) {}
  };
  if (window.CALC_EMBED) {
    document.documentElement.classList.add('embed');
  }
  window.vocabTheme();
})();
</script>`;

// 사이트(dshs42.app) 모양에 맞추는 스타일. 원본 스타일 뒤에 붙어 덮어씁니다.
const CALC_CSS = `<style>
/* ===== dshs42.app 에 맞춤 (scripts/build-calc.mjs 의 CALC_CSS) =====
   바탕 · 글자 · 선 색(--paper --surface --ink --muted --line --accent --card)은 머리의 vocabTheme() 이 사이트 테마에서 읽어 넣습니다.
   필기 펜 색(파랑 정의 · 빨강 조건 · 주황 증명 · 보라 확장 · 노랑 예시)은 뜻이 있어 그대로 두고 밝기만 따릅니다. */
:root{--font:"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;--accent:#6a5cd6;--card:#eeeef5;
  --t-cond:color-mix(in srgb,var(--cond) 9%,var(--surface));--t-def:color-mix(in srgb,var(--def) 9%,var(--surface));
  --t-proof:color-mix(in srgb,var(--proof) 11%,var(--surface));--t-ext:color-mix(in srgb,var(--ext) 11%,var(--surface));
  --t-ink:color-mix(in srgb,var(--ink) 4%,var(--surface))}
:root[data-theme="dark"]{--accent:#7c6fe0;--card:#1a1a26}
body{-webkit-text-size-adjust:100%}
:is(a,button,[tabindex]):focus-visible{outline-color:var(--accent)}

/* 파트 고르기 (문세현T · 전경아T) */
.parts{max-width:1260px;margin:0 auto;padding:16px 24px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:stretch}
.parts a{flex:1 1 230px;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:9px 14px;font-size:13.5px;font-weight:700;color:var(--muted);text-decoration:none;text-align:center;line-height:1.4;transition:border-color .2s,color .2s}
.parts a small{font-size:12px;font-weight:400}
.parts a:hover{border-color:var(--accent);color:var(--ink)}
.parts a.on{background:var(--accent);border-color:transparent;color:#fff}
.parts a.side{flex:0 0 auto;font-weight:600;font-size:12.5px}
.parts a[hidden]{display:none}

/* 위에 붙는 흐름 줄 */
.bar{background:color-mix(in srgb,var(--paper) 90%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.bar .home{font-weight:600;font-size:12.5px;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:5px 12px}
.bar .home:hover{border-color:var(--accent);color:var(--ink)}
.steps button{font-weight:500}
.steps button.on{color:var(--accent);border-bottom-color:var(--accent)}
.tools button,.pill{border-radius:11px;padding:5px 12px;font-size:12.5px;font-weight:600;color:var(--muted)}
.tools button:hover,.pill:hover{border-color:var(--accent);color:var(--ink)}
.tools button.on{border-color:var(--accent);color:var(--accent)}

/* 첫 화면: 두 파트가 같은 틀 (제목 · 한 줄 소개 · '개념의 흐름' 판) */
#home{padding-top:34px}
#home h1{font-size:32px;line-height:1.3;margin:0 0 6px;font-weight:900;letter-spacing:-.01em}
#home .lead{font-size:15px;margin:0 0 6px}
#home .lead .ftcx{background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:3px 11px;font-size:13px;font-weight:600;color:var(--accent);cursor:pointer}
#home .lead .ftcx:hover{border-color:var(--accent)}
.home-h{font-weight:500;margin:34px 0 14px!important}
.board{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;overflow-x:auto}
/* 위쪽 줄: 두 파트 모두 번호만 (이름은 title) */
.steps .sep{margin:0 8px;color:var(--muted)}
.steps button{font-family:var(--mono);font-size:13px;padding:5px 5px}
.steps button.star::after{content:"★";color:var(--cond);font-size:11px;margin-left:2px;vertical-align:top}
.board>.why{margin-top:14px}
.dghint{text-align:center;font-size:12.5px;color:var(--muted);margin:10px 0 0}
.flowmap{display:block;width:100%;min-width:860px;height:auto}
.flowmap .nd{cursor:pointer}
.flowmap .nd rect{fill:var(--surface);stroke:var(--ink);stroke-width:1.6;rx:8px}
.flowmap .nd text{font-size:13.5px;fill:var(--ink);font-weight:600;font-family:var(--font)}
.flowmap .nn{font-family:var(--mono);font-size:12px;font-weight:500;fill:var(--muted)}
.flowmap .nd:hover rect{stroke:var(--accent);stroke-width:2.4}
.flowmap .ar path{fill:none;stroke:var(--ink);stroke-width:1.4}
.flowmap .fmh{fill:var(--ink)} .flowmap .fmw{fill:var(--proof)}
.flowmap .xl{font-size:11.5px;fill:var(--muted);font-family:var(--font)} .flowmap .pl{font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;fill:var(--muted)}
.flowmap .stv{fill:var(--cond)}
/* 눌러서 '왜 넘어가는지'를 보는 화살표 (전경아T) */
.flowmap .a{cursor:pointer}
.flowmap .a .fat{fill:none;stroke:transparent;stroke-width:18}
.flowmap .a .v{fill:none;stroke:var(--proof);stroke-width:1.6}
.flowmap .a circle{fill:var(--surface);stroke:var(--proof);stroke-width:1.4}
.flowmap .a text{font-family:var(--mono);font-size:11.5px;font-weight:500;fill:var(--proof)}
.flowmap .a:hover .v,.flowmap .a.on .v{stroke-width:2.8}
.flowmap .a.on circle{fill:var(--proof)} .flowmap .a.on text{fill:var(--surface)}
.chain .n{border:1px solid var(--line);border-radius:12px}
.chain .n:hover{transform:translateY(-2px);border-color:var(--accent);box-shadow:0 8px 22px color-mix(in srgb,var(--accent) 20%,transparent)}
.why{border-radius:0 10px 10px 0}

/* 노트 한 장 */
.view>h2{font-weight:700}
.nb{border:1px solid var(--line);border-radius:12px}
.nb.sm{border-width:1px}
.nb.pf{border-width:1.2px}
.slot.hide>.cap{border-radius:10px;border-width:1px}
.inbox{border-radius:8px}
.core{border-radius:6px}
.plot{border-radius:8px}
.hx{border-radius:7px}
.player button{border-radius:10px;font-weight:600}
.player button.main{background:var(--accent);border-color:transparent;color:#fff}
.player .prog i{background:var(--accent)}
.tw,.mdet,.board,.exv,.keybox{border-radius:12px}
.mnode{border-radius:10px}
.mnode.sel{outline-color:var(--accent)}
details.prob{border:1px solid var(--line);border-radius:12px}
details.prob[open]{border-color:var(--accent)}
details.sub>summary{border-radius:9px}
.sbody{border-radius:0 10px 10px 0}
.pop{border:1px solid var(--line);border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.28)}
.pop.note{border-color:var(--line)}
.pop .x,.dbar button{border-radius:9px;color:var(--muted)}
.drawer{background:var(--paper)}
.backbtn{background:var(--accent);color:#fff;font-weight:600}
footer{font-size:12px}

/* 원본에 직접 박힌 색(속성)을 색 변수로: 어두운 테마에서도 보이게 */
[fill="#1a2233"],[fill="#1d2129"]{fill:var(--ink)}
[stroke="#1a2233"],[stroke="#1d2129"]{stroke:var(--ink)}
[fill="#5b6370"]{fill:var(--muted)} [stroke="#8a909c"]{stroke:var(--muted)}
[fill="#c23a2b"]{fill:var(--cond)} [stroke="#c23a2b"]{stroke:var(--cond)}
[fill="#1d5fc2"],[fill="#2f5d9a"]{fill:var(--def)} [stroke="#1d5fc2"],[stroke="#2f5d9a"]{stroke:var(--def)}
[fill="#7440c0"]{fill:var(--ext)} [stroke="#7440c0"]{stroke:var(--ext)}
[fill="#b06200"]{fill:var(--proof)} [stroke="#b06200"]{stroke:var(--proof)}
[fill="#fdf1f0"]{fill:var(--t-cond)} [fill="#eef3fb"]{fill:var(--t-def)} [fill="#fdf4e8"]{fill:var(--t-proof)} [fill="#f6f8fc"]{fill:var(--t-ink)}

/* 좁은 화면 */
@media (max-width:640px){
  .parts{padding:12px 14px 0}
  .wrap{padding:0 14px 60px}
  .bar .in{padding:6px 14px}
  #home h1{font-size:25px}
  .pbody{padding:0 14px 16px 18px}
}

/* dshs42.app 공부 탭 안 (html.embed): 사이트 배경이 비치게. 스크롤은 이 틀 안에서 합니다 (위에 붙는 줄 · 팝업 · 서랍이 화면 기준이라) */
html.embed,html.embed body{background:transparent}
/* 공부 탭 안에서는 파트 줄 · 새 창 버튼을 사이트(renderLearn)가 그립니다. 페이지 안의 것은 따로 열었을 때만 */
html.embed .parts{display:none}
html.embed #home{padding-top:22px}
/* Netlify 무료 요금제 배지가 틀 안에도 하나 더 생기는 것을 숨김 (바깥 사이트의 배지는 그대로) */
html.embed #nl-badge-frame,html.embed #nl-hud-frame{display:none!important}
</style>`;

const partsNav = (n) => `<nav class="parts" id="parts" aria-label="미적분학Ⅱ 파트">
${PARTS.map((p) => `  <a data-file="${p.file}" data-part="${p.n}"${p.n === n ? ' class="on" aria-current="page"' : ''}>${p.who} <small>${p.title}</small></a>`).join('\n')}
  <a class="side" id="partOut" target="_blank" rel="noopener" hidden>↗ 새 창에서 크게 보기</a>
  <a class="side" id="partHome" href="./" hidden>← dshs42.app</a>
</nav>
<script>
(function () {
  // 공부 탭 안에서는 파트를 바꿔도 ?embed=1 을 지키고, 고른 파트를 기억합니다
  var q = window.CALC_EMBED ? '?embed=1' : '';
  document.querySelectorAll('#parts a[data-part]').forEach(function (a) {
    a.href = a.dataset.file + q;   // href 를 HTML 에 직접 쓰면 Netlify 가 'calc2.html' → '/calc2' 로 바꿔 서비스 워커가 못 알아봄
    a.addEventListener('click', function () { try { localStorage.setItem('dshs-calc-part', a.dataset.part); } catch (e) {} });
  });
  try { localStorage.setItem('dshs-calc-part', String(window.CALC_PART)); } catch (e) {}
  var out = document.getElementById('partOut'), home = document.getElementById('partHome');
  if (window.CALC_EMBED) { out.href = location.pathname.split('/').pop(); out.hidden = false; } else home.hidden = false;
})();
</script>`;

// 문세현T 원본에 직접 박힌 색 → 색 변수 (style 안에서만. 속성 fill="#…" 은 CALC_CSS 의 속성 선택자가 맡음)
const HEX = {
  '1a2233': 'var(--ink)', '1d2129': 'var(--ink)', '5b6370': 'var(--muted)',
  'c23a2b': 'var(--cond)', '1d5fc2': 'var(--def)', '2f5d9a': 'var(--def)', '7440c0': 'var(--ext)', 'b06200': 'var(--proof)',
  'fdf1f0': 'var(--t-cond)', 'fbe3df': 'var(--t-cond)', 'eef3fb': 'var(--t-def)', 'e3ecfa': 'var(--t-def)',
  'fdf4e8': 'var(--t-proof)', 'fbead3': 'var(--t-proof)', 'efe6fb': 'var(--t-ext)', 'f6f8fc': 'var(--t-ink)',
};
function recolor(html) {
  // 앞 글자가 따옴표(속성 값 · 스크립트 문자열)면 그대로 둡니다: var() 는 속성에서 듣지 않음
  return html.replace(/(.)#([0-9a-f]{6})\b/g, (m, pre, hex) => (pre === '"' || pre === "'" || !HEX[hex]) ? m : pre + HEX[hex])
    .replace(/color:#fff\b/g, 'color:var(--surface)');
}

// 전경아T 파트의 전체 구조를 문세현T 파트와 같게: 첫 화면 = 제목 + 한 줄 소개 + '개념의 흐름' 판(.board) + 색 안내, 단원마다 번호(1~6)
function unify(body) {
  const must = (re, to) => { if (!re.test(body)) throw new Error('전경아T 구조 맞추기: 못 찾음 ' + re); body = body.replace(re, to); };
  // 로드맵(제목 · 1~4 목록 · 중괄호 · FTC 버튼) → 제목 + 한 줄
  must(/<div class="road">[\s\S]*?<h1>([\s\S]*?)<\/h1>\s*<ol>([\s\S]*?)<\/ol>[\s\S]*?(<button type="button" class="ftcx"[\s\S]*?<\/button>)\s*<\/div>/, (m, h1, ol, btn) => {
    const items = [...ol.matchAll(/<li><b>\d+<\/b>([\s\S]*?)<\/li>/g)].map((x) => x[1].trim());
    return `<h1>${h1}</h1>\n  <p class="lead">${items.join(' → ')} &nbsp;${btn}</p>`;
  });
  // 한 줄짜리 흐름 상자 → 문세현T 와 같은 '개념의 흐름' 도식(FLOW2). 상자는 그 내용이 있는 자리로, 주황 화살표는 '왜 넘어가는지'(why-0~4)
  must(/<div class="chain" id="chain">[\s\S]*?<\/div>\s*(<p class="why"[^>]*><\/p>)/, (m, why) => `<div class="board">${FLOW2}\n  <p class="dghint">주황 화살표(?)를 누르면 왜 다음 개념으로 넘어가는지가 나타난다.</p>\n  ${why}</div>`);
  must(/<p class="homenote">[\s\S]*?<\/p>/, HOMENOTE('공간 확장'));
  // 맨 아래 글: 첫 문장은 두 파트가 같고, 이 노트에만 해당하는 말(그림 · 해설)은 뒤에 둠
  must(/<footer>[\s\S]*?(그림은 필기의[\s\S]*?)<\/footer>/, (m, rest) => `<footer>${FOOT} ${rest}</footer>`);
  let k = 0;
  // 위쪽 줄 · 단원 제목에 번호 (도식의 1.1 · 2.1 … 의 앞 숫자)
  // 위쪽 줄도 문세현T 와 같은 틀: 번호만 보이고(이름은 올려 두면 나옴) PART A | PART B 로 나눔, 핵심 단원에 ★
  must(/<nav class="steps"[^>]*>[\s\S]*?<\/nav>/, (m) => {
    const bs = [...m.matchAll(/<button type="button" data-view="([^"]+)">([\s\S]*?)<\/button>/g)];
    if (bs.length !== 6) throw new Error('전경아T 위쪽 줄 단원이 6개가 아님: ' + bs.length);
    return '<nav class="steps" aria-label="개념의 흐름">' + bs.map((b, i) =>
      (i === 3 ? '<i class="sep">|</i>' : i ? '<i>→</i>' : '') + `<button type="button" data-view="${b[1]}" title="${b[2].trim()}"${b[1] === 'v-test' ? ' class="star"' : ''}>${++k}</button>`).join('') + '</nav>';
  });
  k = 0;
  body = body.replace(/(<section class="view" id="v-[^"]+"[^>]*>\s*<h2>)/g, (x, a) => `${a}${++k} · `);
  if (k !== 6) throw new Error('전경아T 단원이 6개가 아님: ' + k);
  return body;
}

// 전경아T 첫 화면의 '개념의 흐름' 도식. 번호 = 단원(1~6).소단원, 상자의 href 는 노트 안의 그 자리(id).
// 왼쪽 PART A = 벡터장 · 선적분(단원 1~3), 오른쪽 PART B = 판정 · 정리(단원 4~6). 좌표는 viewBox 1080 × 500 기준.
const FLOW2 = (() => {
  const H = 40;
  const N = [ // [번호, 이름, 갈 곳, x, y, w, h?, ★?]
    ['1.1', '벡터장 정의', '#vf', 150, 20, 220],
    ['2.1', '그레디언트 벡터장', '#grad', 20, 110, 200],
    ['2.2', '보존 벡터장', '#cons', 20, 200, 200],
    ['3.1', '선적분 정의', '#li-ds', 270, 110, 230],
    ['3.2', 'C.M 구하기', '#li-cm', 310, 180, 190],
    ['3.3', 'x, y에 대한 선적분', '#li-xy', 310, 240, 190],
    ['3.4', '공간에서 선적분', '#li-space', 310, 300, 190],
    ['3.5', '일 · 벡터장의 선적분', '#li-work', 310, 360, 190],
    ['4.1', '선적분의 FTC', '#ftc', 700, 20, 240],
    ['4.2', '보존장 판정 도식', 'v-test', 680, 110, 280, 52, true],
    ['5.1', 'curl', '#curl', 580, 230, 150],
    ['5.2', 'div', '#div', 580, 310, 150],
    ['6.1', '그린 정리', '#green', 800, 230, 240],
    ['6.2', '넓이 구하기', '#green-area', 840, 300, 200],
    ['6.3', '영역의 확장', '#green-ext', 840, 360, 200],
    ['6.4', '그린 정리의 벡터형', '#green-vec', 840, 420, 200],
  ];
  const AR = [ // 그냥 흐름
    'M120 150V198',                                   // 2.1 → 2.2
    'M290 150V200H308', 'M290 200V260H308', 'M290 260V320H308', 'M290 320V380H308',   // 3.1 → 3.2 · 3.3 · 3.4 · 3.5
    'M120 240V440C120 468 140 480 180 480H505C535 480 548 466 548 436V78C548 50 562 34 600 34H698',   // 2.2 → 4.1
    'M820 60V108',                                    // 4.1 → 4.2
    'M655 270V308',                                   // 5.1 → 5.2
    'M820 270V320H838', 'M820 320V380H838', 'M820 380V440H838',   // 6.1 → 6.2 · 6.3 · 6.4
    'M655 350C655 492 900 500 940 462',               // curl · div → 벡터형
  ];
  const WHY = [ // 눌러서 '왜'를 보는 화살표: [why 번호, 길, 물음표 자리]
    [0, 'M200 60C160 72 120 84 120 108', 150, 78],            // 1.1 → 2.1
    [1, 'M320 60C360 72 385 84 385 108', 362, 78],            // 1.1 → 3.1
    [2, 'M500 380C520 380 528 372 528 352V84C528 62 544 48 584 48H698', 528, 215],   // 3.5 → 4.1
    [3, 'M740 162C700 184 655 200 655 228', 690, 192],        // 4.2 → 5.1
    [4, 'M880 162C900 184 920 200 920 228', 912, 192],        // 4.2 → 6.1
  ];
  const mk = (id, cls) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" class="${cls}"/></marker>`;
  return `<svg class="flowmap" id="chain" viewBox="0 0 1080 500" role="img" aria-label="개념의 흐름 도식">
<defs>${mk('fm2', 'fmh')}${mk('fm2w', 'fmw')}</defs>
<g class="ar">${AR.map((d) => `<path d="${d}" marker-end="url(#fm2)"/>`).join('')}</g>
${WHY.map(([n, d, x, y]) => `<g class="a" data-why="${n}" role="button" tabindex="0" aria-label="왜 다음 개념으로 가는가"><path class="fat" d="${d}"/><path class="v" d="${d}" marker-end="url(#fm2w)"/><circle cx="${x}" cy="${y}" r="9"/><text x="${x}" y="${y + 4}" text-anchor="middle">?</text></g>`).join('\n')}
<text class="xl" x="700" y="486" text-anchor="middle">curl형 · div형</text><text class="pl" x="20" y="34">PART A</text><text class="pl" x="20" y="52">벡터장 · 선적분</text><text class="pl" x="1060" y="34" text-anchor="end">PART B</text><text class="pl" x="1060" y="52" text-anchor="end">판정 · 정리</text>
${N.map(([no, name, to, x, y, w, h = H, star]) => `<a ${to[0] === '#' ? `href="${to}"` : `href="#${to}" data-view="${to}"`} class="nd"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><text x="${x + 14}" y="${y + h / 2 + 5}"><tspan class="nn">${no}</tspan><tspan dx="9">${name}</tspan>${star ? '<tspan dx="8" class="stv">★</tspan>' : ''}</text></a>`).join('\n')}
</svg>`;
})();

// 문세현T 파트에 전경아T 파트와 같은 '용어 표' · '예제 ↔ 개념' 서랍을 덧붙임 (내용은 calc-extras.mjs)
function extras(body) {
  const must = (re, to) => { if (!re.test(body)) throw new Error('문세현T 서랍 붙이기: 못 찾음 ' + re); body = body.replace(re, to); };
  must(/(<header class="bar" id="bar"[\s\S]*?<\/nav>)\s*(<\/div><\/header>)/, (m, a, b) => `${a}\n  ${EXTRA_TOOLS}\n${b}`);
  must(/<p class="homenote">[\s\S]*?<\/p>/, HOMENOTE('선형근사'));
  must(/<footer>[\s\S]*?<\/footer>/, `<footer>${FOOT}</footer>`);
  const i = body.lastIndexOf('</body>');
  if (i < 0) throw new Error('문세현T: </body> 없음');
  return body.slice(0, i) + EXTRA_HTML + '\n' + body.slice(i);
}

// 첫 화면 안내 글 · 맨 아래 글: 두 파트가 같은 문장을 씁니다 (보라색 뜻만 노트마다 다름)
const HOMENOTE = (ext) => `<p class="homenote">박스를 누르면 그 내용이 있는 노트가 열린다. 노트 안의 점선 버튼(▸)은 눌러서 펼친다.${EXTRA_PILLS}<br>색: <span class="c-def">파랑 정의</span>, <span class="c-cond">빨강 조건</span>, <span class="c-proof">주황 증명</span>, <span class="c-ext">보라 ${ext}</span>, <span style="background:var(--ex-bg);padding:0 6px">노랑 예시</span>.</p>`;
const FOOT = '수업 내용을 바탕으로 정리.';

let fonts = null;
for (const p of PARTS) {
  let html = readFileSync(p.src, 'utf8');
  // 1) 수식 글꼴 블록(<style> 한 덩어리)을 빼서 calc-fonts.css 로
  const m = html.match(/<style>\s*(@font-face\{[^\n]*)\s*<\/style>\s*/);
  if (!m) throw new Error(p.src + ': 글꼴 블록을 못 찾음');
  // 글꼴(@font-face 들)은 두 파일이 같고, 그 뒤의 KaTeX 배치 스타일은 버전이 달라(0.19 · 0.16) 파일마다 그대로 둡니다
  const all = m[1].replace(/font-display:block;/g, '').trim();
  const end = all.indexOf('}', all.lastIndexOf('@font-face')) + 1;
  const css = all.slice(0, end), katex = all.slice(end);
  if (fonts === null) fonts = css; else if (fonts !== css) throw new Error('두 파일의 수식 글꼴이 다름: 따로 두어야 함');
  html = html.replace(m[0], '');

  // 2) 머리: 제목 · 테마 스크립트 · 사이트 글꼴 · 글꼴 파일
  const head = html.slice(0, html.indexOf('</head>'));
  const style = head.slice(head.indexOf('<style>'));
  let body = html.slice(html.indexOf('</head>') + 7);
  // 원본의 :root 색 정의 줄(밝은 · 어두운 펜 색)은 그대로 두고 그 밖의 박힌 색만 바꿉니다
  const cut = style.indexOf('*{box-sizing');
  const styleOut = style.slice(0, cut) + recolor(style.slice(cut));
  if (p.n === 2) body = unify(body);
  if (p.n === 1) body = extras(body);
  // 위쪽 줄 맨 앞 버튼: 노트 제목만 있으면 누르면 어디로 가는지 알 수 없어 '← 개념의 흐름'(첫 화면의 도식)으로 적음
  if (!/<button type="button" class="home" data-view="home">[^<]*<\/button>/.test(body)) throw new Error(p.src + ': 위쪽 줄의 처음으로 버튼을 못 찾음');
  body = body.replace(/(<button type="button" class="home" data-view="home")>([^<]*)<\/button>/, '$1 title="$2 · 첫 화면">← 개념의 흐름</button>');
  body = recolor(body).replace(/<body[^>]*>/, (b) => b + '\n' + partsNav(p.n));

  const out = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>미적분학Ⅱ · ${p.who} ${p.title}</title>
<link rel="icon" href="favicon-32.png" sizes="32x32">
${HEAD_JS(p.n)}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="calc-fonts.css">
<style>${katex}</style>
${styleOut.trimEnd()}
${CALC_CSS}
</head>${body}`;
  writeFileSync(join(ROOT, p.file), out);
  console.log(p.file, (out.length / 1024).toFixed(0) + ' KB');
}
writeFileSync(join(ROOT, 'calc-fonts.css'), '/* 미적분학Ⅱ 노트(calc.html · calc2.html)의 수식 글꼴 (KaTeX). scripts/build-calc.mjs 가 원본에서 빼 둠 */\n' + fonts + '\n');
console.log('calc-fonts.css', (fonts.length / 1024).toFixed(0) + ' KB');
