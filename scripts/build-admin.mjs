// ============================================================
// 관리자 사이트 묶기: admin/ + 학생 사이트에서 함께 쓰는 것 → admin-dist/
//   node scripts/build-admin.mjs
//
// 관리자 사이트(Netlify 프로젝트 dshs42-admin)는 이 명령으로 만든 admin-dist/ 를 배포합니다.
// 같은 코드를 두 곳에 두지 않도록, 학생 사이트의 화면 스타일 · 테마 · 학생 명단(SCHOOL_DATA) ·
// 서버 주소(config.js) · 학사일정(academic.json) · 아이콘은 여기서 그대로 가져옵니다.
// 학생 사이트의 스타일을 고치면 관리자 사이트도 다음 배포 때 같이 바뀝니다.
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "admin-dist");
const src = (...p) => join(root, ...p);

const html = readFileSync(src("index.html"), "utf8");
const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`index.html 에서 ${what} 을(를) 찾지 못했어요`);
  return m[1];
};
// 화면 테마(깜빡임 없이 먼저 정하는 스크립트) · 스타일 · 학생 명단
const theme = pick(/<script>\s*(\/\/ 화면 테마[\s\S]*?)<\/script>/, "테마 스크립트");
const style = pick(/<style>([\s\S]*?)<\/style>/, "스타일");
const data = pick(/^const SCHOOL_DATA = (\{.*\});\s*$/m, "SCHOOL_DATA");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 관리자 사이트 파일
for (const f of readdirSync(src("admin"))) copyFileSync(src("admin", f), join(out, f));
// 학생 사이트에서 가져오는 것
writeFileSync(join(out, "theme.js"), theme.trim() + "\n");
writeFileSync(join(out, "student.css"), style.trim() + "\n");
writeFileSync(join(out, "school-data.js"), `window.SCHOOL_DATA = ${data};\n`);
for (const f of ["config.js", "academic.json", ...readdirSync(root).filter((f) => /\.png$/.test(f))]) {
  copyFileSync(src(f), join(out, f));
}

// 서비스 워커 버전: 묶을 때마다 바뀌게 해서 새 배포가 기기에 바로 가게 합니다
const sw = join(out, "sw.js");
writeFileSync(sw, readFileSync(sw, "utf8").replace("__BUILD__", new Date().toISOString()));

console.log(`admin-dist/ 를 만들었어요 (${readdirSync(out).length}개 파일)`);
