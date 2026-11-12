// ============================================================
// 관리자 사이트 묶기: admin/ + 학생 사이트에서 함께 쓰는 것 → admin-dist/ (42기) · admin-dist-43/ (43기)
//   node scripts/build-admin.mjs               42기 (dshs42 관리, Netlify 프로젝트 dshs42-admin)
//   node scripts/build-admin.mjs --cohort 43   43기 (dshs43 관리, Netlify 프로젝트 dshs43-admin)
//
// 관리자 사이트 코드(admin/)는 하나이고, 기수별 값(scripts/admin-cohorts.mjs)을 cohort.js 로 넣어 묶습니다.
// 같은 코드를 두 곳에 두지 않도록, 학생 사이트의 화면 스타일 · 테마 · 학생 명단(SCHOOL_DATA) ·
// 서버 주소(config.js) · 학사일정(academic.json) · 아이콘은 여기서 그대로 가져옵니다.
// 학생 사이트의 스타일을 고치면 관리자 사이트도 다음 배포 때 같이 바뀝니다.
// 43기도 스타일 · 테마는 이 저장소의 index.html 에서 가져옵니다 (같은 디자인이고, 관리 화면 스타일 .adm-* 이 여기 있음).
// 43기는 시간표(SCHOOL_DATA)가 없어 빈 명단을 넣고, 관리자 사이트가 DB 명단을 씁니다.
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickCohort } from "./admin-cohorts.mjs";

const C = pickCohort();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, C.out);
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
const data = C.schoolData ? pick(/^const SCHOOL_DATA = (\{.*\});\s*$/m, "SCHOOL_DATA") : "{}";

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

// 기수 설정 (admin.js 가 window.DSHS_COHORT 로 읽음)
writeFileSync(join(out, "cohort.js"), `// ${C.cohort.title} — scripts/build-admin.mjs 가 scripts/admin-cohorts.mjs 로 만든 파일입니다. 직접 고치지 않습니다.
window.DSHS_COHORT = ${JSON.stringify(C.cohort, null, 2)};
`);

// config.js: 42기는 그대로, 다른 기수는 학생 사이트 · 학사일정 주소만 바꿉니다 (Supabase 값은 같음)
if (C.config) {
  const path = join(out, "config.js");
  let cfg = readFileSync(path, "utf8");
  for (const [k, v] of Object.entries(C.config)) {
    const re = new RegExp(`^(\\s*)${k}:\\s*"[^"]*",?`, "m");
    cfg = re.test(cfg) ? cfg.replace(re, `$1${k}: ${JSON.stringify(v)},`)
      : cfg.replace(/\n};\s*$/, `\n  ${k}: ${JSON.stringify(v)},\n};\n`);
    if (!cfg.includes(`${k}: ${JSON.stringify(v)}`)) throw new Error(`config.js 에 ${k} 를 넣지 못했어요`);
  }
  writeFileSync(path, cfg.replace(/^\/\/ dshs42\.app — 설정/m, `// ${C.site} 관리자 사이트 — 설정 (build-admin.mjs 가 만든 것)`)
    .replaceAll("milkcat322/dshs42-admin", `milkcat322/dshs${C.id}-admin`));
}

// 이름 바꾸기 (42기는 바뀌는 것이 없음): 제목 · 앱 이름 · 서비스 워커 캐시 이름 · 알림 묶음 이름
const rename = (s) => s.replaceAll("dshs42 관리", C.cohort.title).replaceAll("dshs42-admin", `dshs${C.id}-admin`);
for (const f of ["index.html", "sw.js"]) writeFileSync(join(out, f), rename(readFileSync(join(out, f), "utf8")));
if (C.id !== 42) {
  const man = JSON.parse(readFileSync(join(out, "manifest.webmanifest"), "utf8"));
  man.id = C.manifestId || undefined;
  man.name = man.short_name = C.cohort.title;
  man.description = man.description.replace("dshs42.app", C.site);
  writeFileSync(join(out, "manifest.webmanifest"), JSON.stringify(man, null, 2) + "\n");
}

// 서비스 워커 버전: 묶을 때마다 바뀌게 해서 새 배포가 기기에 바로 가게 합니다
const sw = join(out, "sw.js");
writeFileSync(sw, readFileSync(sw, "utf8").replace("__BUILD__", new Date().toISOString()));

console.log(`${C.out}/ 를 만들었어요 (${C.cohort.title}, ${readdirSync(out).length}개 파일)`);
