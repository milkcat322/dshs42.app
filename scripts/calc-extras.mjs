// 문세현T 파트에 덧붙이는 '용어 표' · '예제 ↔ 개념' 서랍 (전경아T 파트와 같은 틀). 수식은 미리 그린 KaTeX 가 아니라 글자로 적는다.
// 링크: j = 노트 안의 자리(data-jump), v = 단원(data-view). 둘 다 원본 스크립트가 처리한다.
const lk = (to, text) => to[0] === 'v' ? `<a href="#" data-view="${to.slice(2)}">${text}</a>` : `<a href="#" data-jump="${to.slice(2)}">${text}</a>`;
const TERMS = [
  ['미분 (Part A)', [
    ['선형사상', 'linear map', '행렬 A 를 곱하는 함수. ‖Ax‖ ≤ C‖x‖ 인 상수 C 가 있고, 미분하면 자기 자신이 나온다.', `${lk('v:v-a1', 'A1')}. ${lk('v:v-a2', 'Chain rule 증명')}에서 M, N 으로 쓴다.`],
    ['미분행렬 Df', 'derivative matrix', 'f : ℝᵐ → ℝⁿ 의 n × m 행렬. i행 j열 성분이 ∂fᵢ/∂xⱼ 이고, f(x + h) ≈ f(x) + Df·h.', `${lk('v:v-a3', 'A3')}에서 정의. 합성의 미분, 방향별 변화율, ${lk('j:d-def', '팽창률')}이 모두 여기서 나온다.`],
    ['Chain rule', '연쇄법칙', '(f ∘ g)′ = Df·Dg. 미분행렬의 곱을 성분으로 풀어 쓴 것이 Case 1~3 과 tree diagram.', `${lk('v:v-a2', 'A2 증명')}, ${lk('v:v-a3', 'A3 적용')}. ${lk('v:v-a4', '음함수 미분')}과 ${lk('j:a6-tp', '접평면')} 유도에 쓴다.`],
    ['음함수', 'implicit function', 'F(x, y) = 0 이 y = f(x) 로 풀릴 때 dy/dx = −Fx / Fy. 조건: F(a, b) = 0, Fy(a, b) ≠ 0, Fx · Fy 연속.', `${lk('v:v-a4', 'A4')}.`],
    ['방향도함수 D<sub>u</sub>f', 'directional derivative', '단위벡터 u 방향으로 갈 때 f 의 변화율. f 가 미분가능하면 D<sub>u</sub>f = ∇f · u.', `${lk('j:a5-def', 'A5 정의')}, ${lk('j:a5-th', '정리')}. ${lk('j:a7-cp', '이계도함수 판정법')}의 증명(참고).`],
    ['gradient ∇f', '그레디언트', '∇f = ⟨fx, fy⟩. f 가 가장 빠르게 증가하는 방향이고 그 최대 변화율이 |∇f|. level curve(level surface)에 수직.', `${lk('j:a5-grad', 'A5')}. ${lk('j:a6-tp', '접평면의 법선')}, ${lk('j:a9-c1', '라그랑주 승수법')}.`],
    ['level curve · level surface', '등위선 · 등위면', 'F = k 인 점들의 모임. 그래프 z = f(x, y) 는 F = f(x, y) − z 의 zero level set 이다.', `${lk('j:a6-zl', 'A6 그래프를 zero level set으로')}.`],
    ['접평면', 'tangent plane', '곡면 F = k 위의 점 P 에서 ∇F(P) 가 법선벡터인 평면. Fx(P)(x − x₀) + Fy(P)(y − y₀) + Fz(P)(z − z₀) = 0.', `${lk('j:a6-tp', 'A6')}.`],
    ['critical point', '임계점', 'fx = 0, fy = 0 인 점 (또는 ∇f 가 존재하지 않는 점). 극대 · 극소의 후보.', `${lk('j:a7-cp', 'A7')}, ${lk('j:a8-how', 'A8 내부의 후보')}.`],
    ['극대 · 극소 · 안장점', 'local max · min · saddle', 'D = fxx·fyy − (fxy)². D > 0, fxx > 0 이면 극소. D > 0, fxx < 0 이면 극대. D < 0 이면 안장점.', `${lk('j:a7-cp', 'A7 이계도함수 판정법')}.`],
    ['닫힌 유계 영역', 'closed bounded region', '경계를 포함하고 유한한 범위 안에 있는 영역. 그 위의 연속함수는 내부의 critical point 와 경계를 따로 구해 비교한다.', `${lk('j:a8-how', 'A8')}.`],
    ['라그랑주 승수 λ, μ', 'Lagrange multiplier', '제약 g = k 위에서 극값이 되기 위한 필요조건 ∇f = λ∇g. 제약이 2개면 ∇f = λ∇g + μ∇h. 후보를 구한 뒤 f 값을 비교한다.', `${lk('j:a9-c1', 'A9 제약 1개')}, ${lk('j:a9-c2', '제약 2개')}.`],
  ]],
  ['적분 (Part B)', [
    ['분할 P · 리만 합', 'partition · Riemann sum', '영역 D 를 서로 겹치지 않는 유한 개의 작은 영역 Aᵢ 로 자르고 Σ f(xᵢ*) ΔAᵢ 를 만든다. 가장 큰 조각의 크기 ‖P‖ → 0 일 때의 극한이 적분.', `${lk('v:v-b1', 'B1')}.`],
    ['적분 가능 조건', 'integrability', '연속이면 적분 가능. 1변수는 불연속점이 유한 개, 2변수는 불연속인 선이 유한 개여도 적분 가능.', `${lk('v:v-b1', 'B1')}.`],
    ['변수변환 g : G → D', 'change of variables', '적분하기 쉬운 영역 G 를 원래 영역 D 로 보내는 함수. 전단사 · 미분가능 · g′ 연속 (C¹ 조건).', `${lk('v:v-b2', 'B2')}, ${lk('v:v-b6', 'B6')}.`],
    ['팽창률 q(c)', '넓이를 보정하는 배율', '점 c 를 품은 작은 영역 B 에 대해 넓이의 비 Δg(B) / ΔB 가 ΔB → 0 일 때 다가가는 값. 넓이의 비라서 0 이상.', `${lk('v:v-b2', 'B2 필요한 이유')}, ${lk('j:d-def', 'B3 정의')}.`],
    ['국소적으로 선형', 'locally linear', '미분가능하면 g(u) − g(c) = T(u − c) + R(u). T = Dg|<sub>c</sub> 이고 오차 R 은 더 빨리 사라진다.', `${lk('j:d-loc', 'B3')}. 휘어진 g(B) 대신 평행사변형 T(B) 의 넓이를 재도 되는 이유.`],
    ['야코비안 det Dg', 'Jacobian', 'det Dg = ∂(x, y)/∂(u, v) = xᵤyᵥ − xᵥyᵤ. 2 · 3변수에서는 팽창률을 이 값의 절댓값 |det Dg(c)| 로 구한다 (팽창률과 야코비안의 절댓값이 같은 말은 아니다).', `${lk('j:d-con', 'B3 결론')}, ${lk('v:v-b7', 'B7 푸는 순서')}.`],
    ['변수변환 공식', 'change of variables formula', '∫<sub>D</sub> f(x) dx = ∫<sub>G</sub> f(g(u)) |det Dg(u)| du. 함수 · 영역 · 넓이 요소 세 가지가 바뀐다.', `${lk('v:v-b6', 'B6')}, ${lk('v:v-b7', 'B7 예제')}.`],
  ]],
];
const CON = [
  ['c-dir', '방향도함수 Dᵤf = ∇f · u', 'j:a5-th'], ['c-grad', 'gradient 와 그 성질', 'j:a5-grad'], ['c-tp', '접평면 · level surface', 'j:a6-tp'],
  ['c-sdt', 'critical point · 이계도함수 판정법', 'j:a7-cp'], ['c-bd', '최대 · 최소: 내부 + 경계', 'j:a8-how'], ['c-lag', '라그랑주 승수법', 'j:a9-c1'],
  ['c-q', '팽창률', 'j:d-def'], ['c-jac', '야코비안 |det Dg|', 'j:d-con'], ['c-cov', '변수변환 공식', 'v:v-b6'],
];
const EX = [
  ['e-a51', '방향도함수 계산 · θ = π/6 방향', 'j:prob-a5-1', [
    ['c-dir', '미분가능하므로 극한 정의 대신 ∇f · u 로 계산한다. u = (cos θ, sin θ) 는 단위벡터.'],
    ['c-grad', 'fx, fy 를 구해 점을 대입한 ∇f(1, 2) = (−3, 13) 이 재료다.']]],
  ['e-a52', 'gradient와 방향도함수 · f = x sin yz', 'j:prob-a5-2', [
    ['c-grad', '3변수에서도 ∇f = (fx, fy, fz).'],
    ['c-dir', 'v 를 길이 √6 으로 나눠 단위벡터로 만든 뒤 내적한다.']]],
  ['e-a61', '접평면 구하기 · z = 2x² + y²', 'j:prob-a6-1', [
    ['c-tp', 'F = 2x² + y² − z 로 두면 곡면이 F = 0 인 level surface 가 되고, ∇F(1, 1, 3) 이 접평면의 법선이다.'],
    ['c-grad', '∇F 가 level surface 에 수직이라는 성질을 그대로 쓴다.']]],
  ['e-a71', '극대 · 극소 · 안장점 찾기', 'j:prob-a7-1', [
    ['c-sdt', 'fx = fy = 0 인 점을 모두 찾고 D = fxx·fyy − fxy² 의 부호로 가른다. (0, 0) 은 D < 0 이라 안장점.']]],
  ['e-a81', '직사각형 위의 최대 · 최소', 'j:prob-a8-1', [
    ['c-bd', '내부의 critical point (1, 1) 과 네 변 위의 값을 따로 구해 비교한다.'],
    ['c-sdt', '내부의 후보는 fx = fy = 0 으로 찾는다. 판정은 하지 않고 값만 비교한다.']]],
  ['e-a91', '원 위의 극값 (제약 1개)', 'j:prob-a9-1', [
    ['c-lag', '∇f = λ∇g 와 제약식을 연립해 후보 (0, ±1), (±1, 0) 을 구하고 f 값을 비교한다.']]],
  ['e-a92', '원판 위의 최대 · 최소 ★', 'j:prob-a9-2', [
    ['c-bd', '영역이 경계를 포함하므로 내부와 경계를 따로 구한다. 원 위에서는 최솟값이 1 이지만 원판 전체에서는 내부의 0.'],
    ['c-lag', '경계인 원 위의 극값은 라그랑주 승수법으로 구한다.']]],
  ['e-a93', '제약조건이 2개인 경우', 'j:prob-a9-3', [
    ['c-lag', '∇f = λ∇g + μ∇h. 미지수 x, y, z, λ, μ 5개에 식 5개.']]],
  ['e-b4', '선형사상의 팽창률 (B4 예시)', 'v:v-b4', [
    ['c-q', '선형이면 선형근사가 곧 실제 도형이라, 팽창률이 점에 따라 달라지지 않는다.'],
    ['c-jac', '선형사상 T 의 팽창률은 |det T|. T(x, y) = (2x + y, x + 2y) 는 넓이 3배.']]],
  ['e-b5', '팽창률 예제 (B5 예시 1~4)', 'v:v-b5', [
    ['c-q', '미분가능한 g 의 팽창률은 그 점에서의 미분행렬 Dg 의 팽창률과 같다.'],
    ['c-jac', 'ℝ² → ℝ² 인 g(x, y) = (2x, xy) 는 |det Dg| 로 구한다.']]],
  ['e-b71', '적분 예제 1 · u = x + y, v = y − 2x', 'v:v-b7', [
    ['c-jac', 'x, y 를 u, v 로 거꾸로 푼 g 의 |det Dg| = 1/3 을 곱한다.'],
    ['c-cov', '함수 · 영역 · 넓이 요소 세 가지를 모두 u, v 로 바꾼다.']]],
  ['e-b72', '적분 예제 2 · ∫₂³ x³ dx (1변수)', 'v:v-b7', [
    ['c-cov', '1변수 치환적분도 같은 공식이다. u = x² 으로 두면 팽창률 자리에 |g′(u)| 가 온다.']]],
  ['e-b73', '적분 예제 3 · 4', 'v:v-b7', [
    ['c-jac', '예시 3 은 x = u + v, y = 2v 로 풀려 det = 2.'],
    ['c-cov', '푸는 순서(새 변수 → 팽창률 → 영역 → 적분)를 그대로 따른다.']]],
];

const termsHtml = TERMS.map(([h, rows]) => `<h3>${h}</h3>
    <div class="tw"><table>
      <thead><tr><th>용어</th><th>뜻</th><th>어디서 쓰는가</th></tr></thead>
      <tbody>
${rows.map(([t, en, mean, use]) => `        <tr><td class="term"><b>${t}</b><span>${en}</span></td><td>${mean}</td><td class="use">${use}</td></tr>`).join('\n')}
      </tbody></table></div>`).join('\n    ');

export const EXTRA_TOOLS = '<div class="tools"><button type="button" data-open="terms">용어 표</button><button type="button" data-open="exmap">예제 ↔ 개념</button></div>';
export const EXTRA_PILLS = ' &nbsp;<button type="button" class="pill" data-open="terms">용어 표</button> <button type="button" class="pill" data-open="exmap">예제 ↔ 개념</button>';
export const EXTRA_HTML = `
<!-- 용어 표 · 예제 ↔ 개념 서랍 (scripts/build-calc.mjs 가 덧붙임. 내용은 scripts/calc-extras.mjs) -->
<div class="back" id="back" hidden></div>
<aside class="drawer" id="drawer" hidden aria-label="용어 표 · 예제와 개념">
  <div class="dbar"><b id="dtitle"></b><button type="button" id="dclose">닫기 ✕</button></div>
  <section id="terms" data-title="용어 표" hidden>
    <p class="lead">노트에 나오는 용어를 한곳에 모았다. 마지막 열을 누르면 그 내용이 있는 자리로 간다.</p>
    ${termsHtml}
  </section>
  <section id="exmap" data-title="예제 ↔ 개념" hidden>
    <p class="lead">예제나 개념을 누르면 서로 이어진 것이 표시되고, 아래에 그 예제에서 개념을 어떻게 쓰는지가 나온다.</p>
    <div class="map" id="map"><svg aria-hidden="true"></svg><div class="col col-ex"><div class="hd">예제</div></div><div class="col col-con"><div class="hd">개념</div></div></div>
    <div class="mdet" id="map-detail" aria-live="polite"></div>
  </section>
</aside>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var CON = ${JSON.stringify(CON)}, EX = ${JSON.stringify(EX)};
  var drawer = $('drawer'), back = $('back'), secs = [].slice.call(drawer.querySelectorAll('section'));
  function lk(to, text) { return '<a href="#" data-' + (to.charAt(0) === 'v' ? 'view' : 'jump') + '="' + to.slice(2) + '">' + text + '</a>'; }
  /* 예제 ↔ 개념 지도 */
  var map = $('map'), colE = map.querySelector('.col-ex'), colC = map.querySelector('.col-con'), svg = map.querySelector('svg'), det = $('map-detail');
  var sel = { t: 'e', id: 'e-a92' }, cname = {}, cto = {};
  function node(x, cls, t) { var b = document.createElement('button'); b.type = 'button'; b.className = cls; b.id = x[0]; b.textContent = x[1]; b.onclick = function () { sel = { t: t, id: x[0] }; upd(); }; return b; }
  EX.forEach(function (e) { colE.appendChild(node(e, 'mnode', 'e')); });
  CON.forEach(function (c) { colC.appendChild(node(c, 'mnode con', 'c')); cname[c[0]] = c[1]; cto[c[0]] = c[2]; });
  function lines() {
    var R = map.getBoundingClientRect(), s = ''; if (!R.width) return;
    svg.setAttribute('viewBox', '0 0 ' + R.width + ' ' + R.height); svg.setAttribute('width', R.width); svg.setAttribute('height', R.height);
    EX.forEach(function (e) {
      var a = $(e[0]).getBoundingClientRect();
      e[3].forEach(function (l) {
        var b = $(l[0]).getBoundingClientRect();
        var x1 = a.right - R.left, y1 = a.top + a.height / 2 - R.top, x2 = b.left - R.left, y2 = b.top + b.height / 2 - R.top, m = (x1 + x2) / 2;
        var on = (sel.t === 'e' && sel.id === e[0]) || (sel.t === 'c' && sel.id === l[0]);
        s += '<path class="' + (on ? 'on' : '') + '" d="M' + x1 + ',' + y1 + 'C' + m + ',' + y1 + ' ' + m + ',' + y2 + ' ' + x2 + ',' + y2 + '"/>';
      });
    });
    svg.innerHTML = s;
  }
  function upd() {
    var hot = {}, h = ''; hot[sel.id] = 2;
    if (sel.t === 'e') {
      var e = EX.filter(function (x) { return x[0] === sel.id; })[0];
      h = '<h4>예제 · ' + e[1] + ' ' + lk(e[2], '노트에서 보기') + '</h4><ul>';
      e[3].forEach(function (l) { hot[l[0]] = 1; h += '<li>' + lk(cto[l[0]], cname[l[0]]) + '<span>' + l[1] + '</span></li>'; });
    } else {
      h = '<h4>개념 · ' + cname[sel.id] + ' ' + lk(cto[sel.id], '노트에서 보기') + '</h4><ul>';
      EX.forEach(function (e) { e[3].forEach(function (l) { if (l[0] === sel.id) { hot[e[0]] = 1; h += '<li>' + lk(e[2], e[1]) + '<span>' + l[1] + '</span></li>'; } }); });
    }
    det.innerHTML = h + '</ul>';
    [].forEach.call(map.querySelectorAll('.mnode'), function (b) { b.classList.toggle('sel', hot[b.id] === 2); b.classList.toggle('hot', hot[b.id] === 1); b.setAttribute('aria-pressed', hot[b.id] === 2 ? 'true' : 'false'); });
    lines();
  }
  upd();
  if (window.ResizeObserver) new ResizeObserver(lines).observe(map); else window.addEventListener('resize', lines);
  /* 서랍 */
  function openDrawer(id) {
    secs.forEach(function (s) { s.hidden = s.id !== id; });
    $('dtitle').textContent = $(id).getAttribute('data-title') || '';
    drawer.hidden = false; back.hidden = false; document.body.style.overflow = 'hidden'; drawer.scrollTop = 0;
    lines(); $('dclose').focus({ preventScroll: true });
  }
  function closeDrawer() { drawer.hidden = true; back.hidden = true; document.body.style.overflow = ''; }
  // 원본 스크립트보다 먼저(capture) 받아, 서랍 안의 링크를 누르면 서랍을 닫고 이동은 원본에 맡깁니다
  document.addEventListener('click', function (ev) {
    var x = ev.target, e; if (!x.closest) return;
    if ((e = x.closest('[data-open]'))) { openDrawer(e.getAttribute('data-open')); return; }
    if (x === back || x.closest('#dclose')) { closeDrawer(); return; }
    if (!drawer.hidden && drawer.contains(x) && x.closest('[data-jump],[data-view]')) closeDrawer();
  }, true);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !drawer.hidden) closeDrawer(); });
})();
</script>`;

// 수업에서 선생님이 짚은 내용에 맞춰 원본 문장을 고치는 목록 (문세현T). 다시 변환해도 남도록 여기에 둔다: [원본, 바꿀 말]
// 팽창률 = 야코비안의 절댓값이 아니다: 야코비안은 2×2 · 3×3 에서만 쓰고, 그 조건에서 팽창률을 그 절댓값으로 구할 뿐이다(포함 관계).
export const TNOTE_B3 = `<div class="tnote"><p><b>팽창률 ≠ 야코비안의 절댓값.</b> 팽창률은 넓이(부피)의 비의 극한으로 정의한 더 넓은 개념이고, 야코비안은 2×2 · 3×3 행렬일 때만 쓴다. 그 조건에서 팽창률을 야코비안의 절댓값으로 구할 수 있는 것이지(포함 관계), 둘이 같은 것은 아니다.</p><p><b>팽창률은 이해를 위한 개념.</b> 변수변환이 왜 그렇게 되는지 이해하려고 배운 것이다. 실제 문제는 교재 속 문제를 열심히 풀어 볼 것.</p></div>`;
export const FIXES = [
  ['<span class="c-cond">팽창률 (야코비안의 절댓값)</span>', '<span class="c-cond">팽창률</span>'],
  ['<p style="text-align:center" class="c-cond"><b>팽창률 = 야코비안의 절댓값</b></p>', '<p style="text-align:center" class="c-cond"><b>2 · 3변수에서는 팽창률을 야코비안의 절댓값으로 구한다</b></p>\n  ' + TNOTE_B3],
  ['<li><b>팽창률</b> = 야코비안의 절댓값', '<li><b>팽창률</b>을 야코비안의 절댓값으로 구한다'],
];
// '선생님 강조' 메모 상자 (일반물리학Ⅱ 의 .nb.tn 과 같은 모양)
export const FIX_CSS = `<style>
.tnote{margin:14px 0 6px;padding:11px 16px 9px;border-radius:4px;background:color-mix(in srgb,#84cc16 24%,var(--surface));font-size:14.5px;line-height:1.72;text-align:left}
.tnote::before{content:"선생님 강조";display:block;font-family:var(--mono,ui-monospace,monospace);font-size:11px;letter-spacing:.05em;color:var(--muted)}
.tnote p{margin:4px 0}
</style>`;
