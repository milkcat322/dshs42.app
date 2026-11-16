// ============================================================
// dshsplus.app 묶기: 42기 앱(이 저장소) + 43기 앱(dshs43 저장소) → plus-dist/
//   node scripts/build-plus.mjs              beta 용 (주소 https://dshsplus-beta.netlify.app)
//   node scripts/build-plus.mjs --main       메인 용 (주소 https://dshsplus.netlify.app)
//   --43 <폴더>                              43기 저장소 위치 (기본: 이 저장소 옆 ../dshs43.app)
//
// 결과:  plus-dist/index.html      첫 화면 — 내 기수 앱으로 보냄 (plus/index.html)
//        plus-dist/42/ · 43/       두 앱을 그대로 (코드는 고치지 않음)
//        plus-dist/plus.js         두 앱 안에서 함께 도는 스크립트 (내 기수 맞추기 · 두 기수 검색, plus/plus.js)
//        plus-dist/plus-roster.js  두 기수 명단 [학번, 이름] (42기 SCHOOL_DATA · 43기 ROSTER_43 에서 뽑음)
// 두 앱의 코드는 늘 원래 저장소에서 고치고, 여기서는 아래만 바꿉니다:
//   - index.html <head> 맨 앞에 window.PLUS_APP · plus-roster.js · plus.js
//   - config.js 의 STUDENT_URL · ADMIN_URL, manifest 이름
//   - sw.js: 캐시 이름 뒤에 묶은 시각을 붙이고(묶을 때마다 새로 받게), 다른 앱 캐시를 지우지 않게
// ============================================================
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const argv = process.argv.slice(2);
const MAIN = argv.includes("--main");
const at = argv.indexOf("--43");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src43 = resolve(at >= 0 ? argv[at + 1] : join(root, "..", "dshs43.app"));
const out = join(root, "plus-dist");
export const PLUS = {
  site: MAIN ? "https://dshsplus.netlify.app" : "https://dshsplus-beta.netlify.app",
  admin: "https://dshsplus-admin.netlify.app",
};
if (!existsSync(join(src43, "js", "main.js"))) throw new Error(`43기 저장소를 찾지 못했어요: ${src43} (--43 <폴더>)`);

// 사이트 파일만 (git 에 있는 것 중 화면에 쓰는 것). 개발 · 서버 · 관리자 파일은 넣지 않습니다
const SKIP_DIR = /^(admin|scripts|supabase|plus|\.claude|\.github|node_modules)\//;
const KEEP = /\.(html|js|css|json|png|jpg|jpeg|svg|ico|webmanifest|woff2?|txt)$/i;
const SKIP_FILE = /^(academic-extra\.json|package(-lock)?\.json|\.gitattributes)$/;
const siteFiles = (dir) => execFileSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" }).split("\n")
  .filter((f) => f && !SKIP_DIR.test(f) && KEEP.test(f) && !SKIP_FILE.test(f.split("/").pop()));

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
const must = (s, a, b, what) => { if (!s.includes(a)) throw new Error(`${what}: '${a}' 를 찾지 못했어요`); return s.replace(a, b); };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

function copyApp(dir, id, cachePrefix) {
  const dst = join(out, String(id));
  for (const f of siteFiles(dir)) {
    mkdirSync(dirname(join(dst, f)), { recursive: true });
    copyFileSync(join(dir, f), join(dst, f));
  }
  const p = (f) => join(dst, f);
  // index.html: 앱 스크립트보다 먼저 plus.js (지난 화면이 다른 기수면 그리기 전에 옮김)
  let html = readFileSync(p("index.html"), "utf8");
  html = html.replace(/<head>/i, `<head>\n<script>window.PLUS_APP = ${id};</script><script src="../plus-roster.js?v=${stamp}"></script><script src="../plus.js?v=${stamp}"></script>`);
  if (!html.includes("window.PLUS_APP")) throw new Error(`${id}/index.html 에 <head> 가 없어요`);
  writeFileSync(p("index.html"), html);
  // config.js: 이 앱 주소 · 관리자 사이트 주소
  let cfg = readFileSync(p("config.js"), "utf8");
  cfg = cfg.replace(/STUDENT_URL:\s*"[^"]*"/, `STUDENT_URL: "${PLUS.site}/${id}"`).replace(/ADMIN_URL:\s*"[^"]*"/, `ADMIN_URL: "${PLUS.admin}/${id}/"`);
  if (!cfg.includes(`${PLUS.site}/${id}`)) throw new Error(`${id}/config.js 의 STUDENT_URL 을 바꾸지 못했어요`);
  writeFileSync(p("config.js"), cfg);
  // manifest: 홈 화면 이름
  const man = JSON.parse(readFileSync(p("manifest.webmanifest"), "utf8"));
  man.id = `dshsplus-${id}`;
  man.name = `dshsplus · ${id}기`;
  man.short_name = "dshsplus";
  writeFileSync(p("manifest.webmanifest"), JSON.stringify(man, null, 2) + "\n");
  // sw.js: 묶을 때마다 새 캐시 이름(그래서 plus.js 가 바뀌어도 기기에 감) · 같은 주소의 다른 앱 캐시는 지우지 않음
  let sw = readFileSync(p("sw.js"), "utf8");
  sw = sw.replace(/const CACHE = '([^']+)';/, (_, v) => `const CACHE = '${v}-p${stamp}';`);
  sw = must(sw, "keys.filter(k => k !== CACHE)", `keys.filter(k => k !== CACHE && k.startsWith('${cachePrefix}'))`, `${id}/sw.js`);
  writeFileSync(p("sw.js"), sw);
  return dst;
}
copyApp(root, 42, "dshs-study-");
copyApp(src43, 43, "dshs43-");

// 두 기수 명단 [학번, 이름]
const html42 = readFileSync(join(root, "index.html"), "utf8");
const data42 = vm.runInNewContext("(" + html42.match(/^const SCHOOL_DATA = (\{.*\});\s*$/m)[1] + ")");
const r42 = Object.entries(data42).map(([name, v]) => [v.id, name]).sort((a, b) => a[0] - b[0]);
const login43 = readFileSync(join(src43, "js", "dshs-login.js"), "utf8");
const raw43 = login43.match(/const ROSTER_43 = `([\s\S]*?)`/);
if (!raw43) throw new Error("43기 js/dshs-login.js 에서 ROSTER_43 을 찾지 못했어요");
const r43 = raw43[1].split(/[,\n]/).map((s) => s.trim().match(/^(\d{4})\s+(\S+)$/)).filter(Boolean).map((m) => [+m[1], m[2]]);
if (r42.length < 50 || r43.length < 50) throw new Error(`명단이 너무 적어요 (42기 ${r42.length} · 43기 ${r43.length})`);
writeFileSync(join(out, "plus-roster.js"), `// scripts/build-plus.mjs 가 만든 파일 — 두 기수 명단 [학번, 이름]
window.PLUS_ROSTER = ${JSON.stringify({ 42: r42, 43: r43 })};
`);

// 첫 화면 · 공용 스크립트 · 아이콘
copyFileSync(join(root, "plus", "index.html"), join(out, "index.html"));
copyFileSync(join(root, "plus", "plus.js"), join(out, "plus.js"));
for (const f of ["favicon-32.png", "apple-touch-icon.png"]) copyFileSync(join(root, f), join(out, f));

const rev = (dir) => execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
console.log(`plus-dist/ 를 만들었어요 (${MAIN ? "메인" : "beta"} · ${PLUS.site}) — 42기 ${rev(root)} · 43기 ${rev(src43)} · 명단 ${r42.length} + ${r43.length}명`);
