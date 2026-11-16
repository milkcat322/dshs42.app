// ============================================================
// dshsplus.app 배포: 42기 앱 + 43기 앱을 묶어(build-plus.mjs) dshsplus 저장소에 올립니다.
//   node scripts/deploy-plus.mjs            beta → milkcat322/dshsplus-beta (dshsplus-beta.netlify.app)
//   node scripts/deploy-plus.mjs --main     메인 → milkcat322/dshsplus       (dshsplus.app)
//   --43 <폴더>                             43기 저장소 위치 (기본 ../dshs43.app)
//
// 두 저장소에는 묶은 결과만 있습니다. 코드는 늘 dshs-study(42기) · dshs43(43기)에서 고치고 여기서 묶어 올립니다.
// 올리기 전에 두 저장소가 커밋 · push 돼 있어야 합니다 (올린 것과 git 기록이 어긋나지 않게).
// 메인(--main)은 사용자가 "dshsplus 메인에 올려줘" 라고 할 때만 씁니다.
// ============================================================
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const MAIN = argv.includes("--main");
const at = argv.indexOf("--43");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src43 = resolve(at >= 0 ? argv[at + 1] : join(root, "..", "dshs43.app"));
const REPO = MAIN ? "https://github.com/milkcat322/dshsplus.git" : "https://github.com/milkcat322/dshsplus-beta.git";
const work = join(root, MAIN ? ".plus-deploy-main" : ".plus-deploy");   // .gitignore
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// 1. 두 저장소가 커밋 · push 됐는지
for (const [dir, label, paths] of [[root, "42기(dshs-study)", ["."]], [src43, "43기(dshs43)", ["."]]]) {
  const dirty = git(["status", "--porcelain", "--untracked-files=no", "--", ...paths], dir);
  if (dirty) { console.error(`${label} 에 커밋하지 않은 변경이 있어요. 커밋한 뒤 다시 실행해 주세요.\n${dirty}`); process.exit(1); }
  git(["fetch", "origin"], dir);
  const ahead = git(["log", "--oneline", "@{u}..HEAD"], dir);
  if (ahead) { console.error(`${label} 에 push 하지 않은 커밋이 있어요. 먼저 올려 주세요.\n${ahead}`); process.exit(1); }
}
const sha42 = git(["rev-parse", "--short", "HEAD"]), sha43 = git(["rev-parse", "--short", "HEAD"], src43);

// 2. 묶기
execFileSync("node", [join(root, "scripts", "build-plus.mjs"), ...(MAIN ? ["--main"] : []), "--43", src43], { stdio: "inherit" });

// 3. 대상 저장소 받기
if (!existsSync(join(work, ".git"))) { rmSync(work, { recursive: true, force: true }); git(["clone", REPO, work]); }
git(["fetch", "origin"], work);
if (git(["ls-remote", "--heads", "origin", "main"], work)) { git(["checkout", "-B", "main", "origin/main"], work); git(["reset", "--hard", "origin/main"], work); }
else git(["checkout", "-B", "main"], work);   // 아직 비어 있는 저장소

// 4. 내용을 묶은 결과로 바꾸기
for (const f of readdirSync(work)) if (f !== ".git") rmSync(join(work, f), { recursive: true, force: true });
cpSync(join(root, "plus-dist"), work, { recursive: true });
writeFileSync(join(work, "README.md"), `# dshsplus${MAIN ? "" : " (beta)"}

대전과학고 42기 · 43기 종합 웹서비스. [dshs-study](https://github.com/milkcat322/dshs-study)(42기) 와 dshs43(43기) 를
\`node scripts/deploy-plus.mjs${MAIN ? " --main" : ""}\` 로 묶어 자동으로 올린 결과입니다. **여기를 직접 고치지 마세요.** 다음 배포 때 덮어써집니다.

- \`/\` 첫 화면 — 내 기수 앱으로 보냄 · \`/42/\` 42기 앱 · \`/43/\` 43기 앱
- 두 앱 공용: \`plus.js\`(내 기수 맞추기 · 두 기수 검색, dshs-study 의 plus/plus.js) · \`plus-roster.js\`(명단)

Netlify: 빌드 명령 없음 · 배포 폴더는 저장소 맨 위.
`);

// 5. 커밋 · push
git(["add", "-A"], work);
if (!git(["status", "--porcelain"], work)) { console.log("바뀐 것이 없어 올리지 않았어요."); process.exit(0); }
git(["commit", "-m", `dshsplus 배포: 42기 dshs-study ${sha42} · 43기 dshs43 ${sha43}`], work);
git(["push", "origin", "main"], work);
console.log(`${REPO} 에 올렸어요 (42기 ${sha42} · 43기 ${sha43}). Netlify 에 연결돼 있으면 곧 배포돼요.`);
