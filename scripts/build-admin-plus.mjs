// ============================================================
// dshsplus 관리자 사이트 묶기 / 배포: 42기 관리(/42/) + 43기 관리(/43/) → admin-dist-plus/ → milkcat322/dshsplus-admin
//   node scripts/build-admin-plus.mjs            묶기만
//   node scripts/build-admin-plus.mjs --deploy   묶어서 dshsplus-admin 저장소에 올림 (admin/ 을 고친 뒤 커밋하고 실행)
//
// 각 기수는 build-admin.mjs 로 지금과 똑같이 묶고, 여기서는 아래만 바꿉니다:
//   - 학생 사이트 주소 → dshsplus.app/42 · /43
//   - sw.js: 같은 주소의 다른 기수 캐시를 지우지 않게, 알림을 누르면 그 기수 관리 화면에서 열리게
//   - index.html: 마지막으로 연 기수를 기억(첫 화면이 그 기수로 보냄) · 다른 기수 관리로 가는 작은 단추
// 기기 등록(로그인 저장 이름)은 기수마다 따로라, 두 기수 관리를 쓰려면 각각 한 번씩 등록합니다.
// ============================================================
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COHORTS } from "./admin-cohorts.mjs";

const DEPLOY = process.argv.includes("--deploy");
const STUDENT = "https://dshsplus.netlify.app";
const ADMIN = "https://dshsplus-admin.netlify.app";
const REPO = "https://github.com/milkcat322/dshsplus-admin.git";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "admin-dist-plus");
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const must = (s, a, b, what) => { if (!s.includes(a)) throw new Error(`${what}: '${a}' 를 찾지 못했어요`); return s.split(a).join(b); };

if (DEPLOY) {
  const dirty = git(["status", "--porcelain", "--", "admin", "scripts", "index.html", "config.js", "academic.json"]);
  if (dirty) { console.error(`커밋하지 않은 변경이 있어요. 먼저 커밋하고 다시 실행해 주세요.\n${dirty}`); process.exit(1); }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const id of [42, 43]) {
  const C = COHORTS[id];
  execFileSync("node", [join(root, "scripts", "build-admin.mjs"), "--cohort", String(id)], { stdio: "inherit" });
  const dst = join(out, String(id));
  cpSync(join(root, C.out), dst, { recursive: true });
  const p = (f) => join(dst, f);
  // 학생 사이트 주소
  let co = readFileSync(p("cohort.js"), "utf8");
  co = co.replace(/"studentUrl":\s*"[^"]*"/, `"studentUrl": "${STUDENT}/${id}"`);
  writeFileSync(p("cohort.js"), co);
  let cfg = readFileSync(p("config.js"), "utf8");
  cfg = cfg.replace(/STUDENT_URL:\s*"[^"]*"/, `STUDENT_URL: "${STUDENT}/${id}"`).replace(/ADMIN_URL:\s*"[^"]*"/, `ADMIN_URL: "${ADMIN}/${id}/"`);
  writeFileSync(p("config.js"), cfg);
  // 서비스 워커
  let sw = readFileSync(p("sw.js"), "utf8");
  sw = must(sw, "keys.filter(k => k !== CACHE)", `keys.filter(k => k !== CACHE && k.startsWith('dshs${id}-admin'))`, `${id}/sw.js`);
  sw = must(sw, "new URL(e.notification.data?.url || './', self.location.origin)",
    "new URL(String(e.notification.data?.url || './').replace(/^\\//, './'), self.registration.scope)", `${id}/sw.js`);
  sw = must(sw, "c.url.startsWith(self.location.origin)", "c.url.startsWith(self.registration.scope)", `${id}/sw.js`);
  writeFileSync(p("sw.js"), sw);
  // 홈 화면 이름
  const man = JSON.parse(readFileSync(p("manifest.webmanifest"), "utf8"));
  man.id = `dshsplus-admin-${id}`;
  man.name = `dshsplus 관리 · ${id}기`;
  man.short_name = `plus 관리 ${id}`;
  writeFileSync(p("manifest.webmanifest"), JSON.stringify(man, null, 2) + "\n");
  // 마지막으로 연 기수 기억 + 다른 기수 관리로 가는 단추
  const other = id === 42 ? 43 : 42;
  let html = readFileSync(p("index.html"), "utf8");
  html = html.replace(/<head>/i, `<head>\n<script>try { localStorage.setItem("dshsplus-admin-cohort", "${id}"); } catch {}</script>`);
  html = html.replace(/<\/body>/i, `<a href="../${other}/" title="${other}기 관리로" style="position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:9999;padding:8px 13px;border-radius:999px;background:var(--surface,#16161f);border:1px solid var(--border,#2a2a3d);color:var(--text-dim,#9a9ab0);font:600 12px/1 'Noto Sans KR',sans-serif;text-decoration:none">${other}기 관리 →</a>\n</body>`);
  if (!html.includes("dshsplus-admin-cohort") || !html.includes(`../${other}/`)) throw new Error(`${id}/index.html 을 바꾸지 못했어요`);
  writeFileSync(p("index.html"), html);
}
// 첫 화면: 마지막으로 연 기수 관리로 (처음이면 고르기)
writeFileSync(join(out, "index.html"), `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>dshsplus 관리</title><link rel="icon" type="image/png" href="42/favicon-32.png">
<script>
// scripts/build-admin-plus.mjs 가 만든 첫 화면. 알림(/?view=admin…)으로 와도 주소 뒤를 그대로 넘깁니다.
let c = null; try { c = localStorage.getItem("dshsplus-admin-cohort"); } catch {}
if (c === "42" || c === "43") location.replace(c + "/" + location.search + location.hash);
</script>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;gap:12px;background:#0a0a0f;font-family:'Noto Sans KR',system-ui,sans-serif}
a{padding:18px 26px;border-radius:14px;border:1px solid #2a2a3d;background:#13131c;color:#e8e8f0;text-decoration:none;font-weight:700;font-size:17px}</style>
</head><body><a href="42/">42기 관리</a><a href="43/">43기 관리</a></body></html>
`);
console.log(`admin-dist-plus/ 를 만들었어요 (42 · 43, ${readdirSync(out).length}개)`);

if (DEPLOY) {
  const work = join(root, ".admin-deploy-plus");
  if (!existsSync(join(work, ".git"))) { rmSync(work, { recursive: true, force: true }); git(["clone", REPO, work]); }
  git(["fetch", "origin"], work);
  if (git(["ls-remote", "--heads", "origin", "main"], work)) { git(["checkout", "-B", "main", "origin/main"], work); git(["reset", "--hard", "origin/main"], work); }
  else git(["checkout", "-B", "main"], work);
  for (const f of readdirSync(work)) if (f !== ".git") rmSync(join(work, f), { recursive: true, force: true });
  cpSync(out, work, { recursive: true });
  writeFileSync(join(work, "README.md"), `# dshsplus 관리

[dshs-study](https://github.com/milkcat322/dshs-study) 의 \`admin/\` 을 \`node scripts/build-admin-plus.mjs --deploy\` 로 묶어 올린 결과입니다 (\`/42/\` 42기 관리 · \`/43/\` 43기 관리).
**여기를 직접 고치지 마세요.** Netlify: 빌드 명령 없음 · 배포 폴더는 저장소 맨 위.
`);
  git(["add", "-A"], work);
  if (!git(["status", "--porcelain"], work)) { console.log("바뀐 것이 없어 올리지 않았어요."); process.exit(0); }
  const sha = git(["rev-parse", "--short", "HEAD"]);
  git(["commit", "-m", `dshsplus 관리 배포: dshs-study ${sha}`], work);
  git(["push", "origin", "main"], work);
  console.log(`${REPO} 에 올렸어요 (dshs-study ${sha}).`);
}
