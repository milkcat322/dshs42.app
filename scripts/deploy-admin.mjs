// ============================================================
// 관리자 사이트 배포: admin/ 을 묶어(build-admin.mjs) 관리자 저장소에 올립니다.
//   node scripts/deploy-admin.mjs               42기 → milkcat322/dshs42-admin
//   node scripts/deploy-admin.mjs --cohort 43   43기 → milkcat322/dshs43-admin
//
// 관리자 저장소는 Netlify 에 연결돼 있어, 올리면 관리자 사이트가 바로 바뀝니다.
// 그 저장소에는 묶은 결과만 있습니다. 코드는 늘 이 저장소의 admin/ 에서 고치고, 그 저장소를 직접 고치지 않습니다.
// 올리기 전에 admin/ · 묶는 데 쓰는 파일이 커밋돼 있어야 합니다 (올린 것과 git 기록이 어긋나지 않게).
// 기수별 저장소 · 폴더는 scripts/admin-cohorts.mjs 에 있습니다.
// ============================================================
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickCohort } from "./admin-cohorts.mjs";

const C = pickCohort();
const ADMIN_REPO = C.repo;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, C.work);   // 관리자 저장소를 받아 두는 곳 (.gitignore)
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// 1. 묶는 데 쓰는 파일이 모두 커밋됐는지
const inputs = ["admin", "scripts/build-admin.mjs", "scripts/admin-cohorts.mjs", "index.html", "config.js", "academic.json"];
const dirty = git(["status", "--porcelain", "--", ...inputs]);
if (dirty) {
  console.error(`커밋하지 않은 변경이 있어요. 먼저 커밋하고 다시 실행해 주세요.\n${dirty}`);
  process.exit(1);
}
const sha = git(["rev-parse", "--short", "HEAD"]);

// 2. 묶기
execFileSync("node", [join(root, "scripts", "build-admin.mjs"), "--cohort", String(C.id)], { stdio: "inherit" });

// 3. 관리자 저장소 받기 (처음이면 clone, 아니면 원격과 똑같이 맞춤)
if (!existsSync(join(work, ".git"))) {
  rmSync(work, { recursive: true, force: true });
  git(["clone", ADMIN_REPO, work]);
}
git(["fetch", "origin"], work);
const hasMain = git(["ls-remote", "--heads", "origin", "main"], work);
if (hasMain) { git(["checkout", "-B", "main", "origin/main"], work); git(["reset", "--hard", "origin/main"], work); }
else git(["checkout", "-B", "main"], work);   // 아직 아무것도 없는 저장소

// 4. 내용을 묶은 결과로 바꾸기
for (const f of readdirSync(work)) if (f !== ".git") rmSync(join(work, f), { recursive: true, force: true });
cpSync(join(root, C.out), work, { recursive: true });
const cohortArg = C.id === 42 ? "" : ` --cohort ${C.id}`;
writeFileSync(join(work, "README.md"), `# ${C.cohort.title} (관리자 사이트 · ${C.cohort.label})

이 저장소는 [dshs-study](https://github.com/milkcat322/dshs-study) 의 \`admin/\` 을 \`node scripts/deploy-admin.mjs${cohortArg}\` 로 묶어 자동으로 올린 결과입니다.
**여기를 직접 고치지 마세요.** 다음 배포 때 덮어써집니다. 코드는 dshs-study 의 \`admin/admin.js\` 에서 고칩니다 (기수별 값은 \`scripts/admin-cohorts.mjs\`).

${C.cohort.label} 학생 사이트(${C.site})의 학생 · 수행평가 · 피드백만 보여 줍니다. 42기 · 43기는 같은 DB 를 씁니다.

Netlify: 빌드 명령 없음 · 배포 폴더는 저장소 맨 위.
`);

// 5. 커밋 · push
git(["add", "-A"], work);
if (!git(["status", "--porcelain"], work)) {
  console.log("바뀐 것이 없어 올리지 않았어요.");
  process.exit(0);
}
git(["commit", "-m", `관리자 사이트 배포 (${C.cohort.label}): dshs-study ${sha}`], work);
git(["push", "origin", "main"], work);
console.log(`관리자 저장소(${ADMIN_REPO})에 올렸어요 (dshs-study ${sha}). Netlify 가 곧 배포해요.`);
