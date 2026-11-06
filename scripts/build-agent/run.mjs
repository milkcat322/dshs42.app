#!/usr/bin/env node
// dshs42.app — Claude 제작 맡기기: 관리자 노트북 쪽 (agenttasks.sql · supabase/functions/build-agent)
//
// launchd 가 10분마다 이 파일을 깨웁니다 (install.sh). 관리자 사이트 '제작' 칸에서 승인한 작업을 받아
//   build / revise : agent-<번호> 브랜치에서 claude -p 로 만들고 → 확인 → push → 미리보기 주소와 함께 report(review)
//   merge          : 최종 승인한 브랜치를 origin/main 에 합쳐 push (beta 배포). Claude 를 부르지 않습니다.
//   cleanup        : 버린 작업의 브랜치를 지웁니다.
// 할 일이 없으면 서버 함수만 한 번 부르고 끝나므로 토큰을 쓰지 않습니다.
// 작업은 사용자의 작업 폴더가 아니라 따로 둔 git worktree(~/.dshs42-build-agent/wt)에서 합니다.
//
//   node scripts/build-agent/run.mjs          할 일이 있으면 하나 처리
//   node scripts/build-agent/run.mjs --peek   할 일 수만 확인
//
// 열쇠: ~/.dshs42-build-agent.json 의 token (저장소에 올리지 않음. DB 에는 sha256 만 agent_keys 에 있음)
// 기록: ~/Library/Logs/dshs42-build-agent.log

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const FN = "https://jsanpwlleufzgglqkrkv.supabase.co/functions/v1/build-agent";
const PREVIEW = (branch) => `https://${branch}--dshs42-beta.netlify.app`;
const HOME = join(homedir(), ".dshs42-build-agent");
const WT = join(HOME, "wt");
const LOCK = join(HOME, "running");
const LOG = join(homedir(), "Library", "Logs", "dshs42-build-agent.log");
const TIMEOUT = 30 * 60 * 1000;
const TARGET = process.env.BUILD_MERGE_TARGET || "main";   // 시험할 때만 다른 브랜치로
const MODEL = process.env.BUILD_MODEL || "sonnet";   // 토큰을 아끼려고 기본은 sonnet. 큰 작업이면 BUILD_MODEL=opus
const TOOLS = ["Read", "Edit", "Write", "Grep", "Glob",
  "Bash(node --check:*)", "Bash(git diff:*)", "Bash(git status:*)", "Bash(git log:*)"];
// 학생 사이트로 배포되는 파일 (바뀌면 sw.js 의 CACHE 를 올려야 학생 기기에 갑니다)
const FRONT = /^(index\.html|[^/]+\.js|manifest\.webmanifest|_headers)$/;

const log = (...a) => {
  const line = `[${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })}] ${a.join(" ")}\n`;
  try { appendFileSync(LOG, line); } catch {}
  process.stdout.write(line);
};
const git = (args, cwd = WT) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (args, cwd = WT) => { try { return git(args, cwd); } catch { return null; } };

let token;
try { token = JSON.parse(readFileSync(join(homedir(), ".dshs42-build-agent.json"), "utf8")).token; }
catch { log("열쇠 파일(~/.dshs42-build-agent.json)이 없어요"); process.exit(1); }

async function call(body) {
  const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-token": token }, body: JSON.stringify(body) });
  const x = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${x.error ?? ""}`);
  return x;
}

if (process.argv.includes("--peek")) {
  const n = await call({ action: "peek" });
  log(`제작 대기 ${n.build} · 합치기 대기 ${n.merge} · 제작 중 ${n.building}`);
  process.exit(0);
}

// 한 번에 하나만 (앞 실행이 30분 넘게 끝나지 않았으면 죽은 것으로 봅니다)
mkdirSync(HOME, { recursive: true });
if (existsSync(LOCK) && Date.now() - Number(readFileSync(LOCK, "utf8")) < TIMEOUT + 60e3) process.exit(0);
writeFileSync(LOCK, String(Date.now()));

let task;
try {
  const got = await call({ action: "claim" });
  if (!got.task) process.exit(0);
  task = got.task;
  log(`${got.job} 시작: ${task.title} (${task.id})`);
  prepareWorktree();
  if (got.job === "merge") await merge(task);
  else if (got.job === "cleanup") await cleanup(task);
  else await build(task, got.job === "revise");
} catch (e) {
  log("실패:", e.message);
  if (task) await call({ action: "report", id: task.id, status: "failed", error: String(e.message).slice(0, 1500) }).catch(() => {});
} finally {
  rmSync(LOCK, { force: true });
}

function prepareWorktree() {
  git(["fetch", "--prune", "origin"], REPO);
  if (!existsSync(join(WT, ".git"))) {
    tryGit(["worktree", "prune"], REPO);
    git(["worktree", "add", "--detach", WT, "origin/main"], REPO);
  }
  tryGit(["merge", "--abort"]);
  git(["reset", "--hard"]);
  git(["clean", "-fd"]);
}

function branchOf(t) { return t.branch || `agent-${t.id.slice(0, 8)}`; }
function cacheNum(ref) { return Number(git(["show", `${ref}:sw.js`]).match(/dshs-study-v(\d+)/)?.[1]); }
function setCache(value) {
  const p = join(WT, "sw.js");
  writeFileSync(p, readFileSync(p, "utf8").replace(/const CACHE = '[^']*'/, `const CACHE = '${value}'`));
}

async function build(t, revise) {
  const branch = branchOf(t);
  const remote = tryGit(["rev-parse", "--verify", `origin/${branch}`]);
  git(["checkout", "-B", branch, revise && remote ? `origin/${branch}` : "origin/main"]);

  const prompt = readFileSync(join(HERE, "prompt.md"), "utf8")
    + `\n\n## 맡은 일\n제목: ${t.title}\n\n${t.spec}\n`
    + (revise ? `\n## 수정 요청 (${t.rounds}번째 제작)\n이미 이 브랜치에 앞서 만든 변경이 있다. 아래 요청대로 고친다.\n${t.note}\n\n지금까지 바뀐 파일:\n${git(["diff", "--stat", "origin/main"])}\n` : "");
  const out = await runClaude(prompt);
  const m = out.match(/RESULT\s+(\{[\s\S]*\})\s*$/);
  let result = {};
  try { result = m ? JSON.parse(m[1]) : {}; } catch {}

  git(["add", "-A"]);
  const files = git(["diff", "--cached", "--name-only", "origin/main"]).split("\n").filter(Boolean);
  if (!files.length) {
    return call({ action: "report", id: t.id, status: result.status === "needs_human" ? "needs_human" : "failed",
      error: (result.summary || "Claude 가 아무것도 바꾸지 않았어요").slice(0, 1500) });
  }
  // 확인: 문법 · init(); · 미리보기에서 새 코드가 보이도록 CACHE 를 이 제작만의 값으로
  const bad = [];
  for (const f of files.filter((f) => /\.m?js$/.test(f) && existsSync(join(WT, f)))) {
    try { execFileSync("node", ["--check", join(WT, f)], { stdio: "pipe" }); } catch { bad.push(`${f} 문법 오류`); }
  }
  if (files.includes("dshs-study.js") && !/\ninit\(\);\s*$/.test(readFileSync(join(WT, "dshs-study.js"), "utf8"))) bad.push("dshs-study.js 맨 끝 init(); 없음");
  if (files.some((f) => FRONT.test(f))) { setCache(`dshs-study-v${cacheNum("origin/main")}-${branch}-r${t.rounds}`); git(["add", "sw.js"]); }
  const sql = files.filter((f) => f.endsWith(".sql") || f.startsWith("supabase/"));

  git(["-c", "user.name=dshs42 build-agent", "-c", "user.email=build-agent@dshs.study",
    "commit", "-q", "-m", `제작: ${t.title} (${t.rounds}번째)\n\n작업 ${t.id}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`]);
  git(["push", "-q", "--force-with-lease", "origin", `HEAD:refs/heads/${branch}`]);

  const summary = [result.summary || "(요약 없음)", `바뀐 파일: ${files.join(", ")}`,
    files.some((f) => f.startsWith("admin/")) ? "관리자 사이트 변경은 미리보기가 없고, 최종 승인하면 관리자 사이트에도 배포돼요." : ""]
    .filter(Boolean).join("\n");
  const status = bad.length ? "failed" : sql.length || result.status === "needs_human" ? "needs_human" : "review";
  const error = bad.length ? bad.join(", ") : sql.length ? `DB · 서버 함수 변경(${sql.join(", ")})은 사람이 적용해야 해요` : status === "needs_human" ? result.summary : undefined;
  await call({ action: "report", id: t.id, status, branch, preview_url: PREVIEW(branch), summary: summary.slice(0, 3000), ...(error ? { error } : {}) });
  log(`제작 끝 (${status}): ${branch} · ${files.length}개 파일`);
}

async function merge(t) {
  const branch = branchOf(t);
  git(["checkout", "-B", "agent-merge", tryGit(["rev-parse", "--verify", `origin/${TARGET}`]) ? `origin/${TARGET}` : "origin/main"]);
  const conflict = tryGit(["merge", "--squash", `origin/${branch}`]) === null;
  const unmerged = git(["diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
  if (conflict && unmerged.some((f) => f !== "sw.js")) {
    tryGit(["reset", "--hard"]);
    return call({ action: "report", id: t.id, status: "needs_human", error: `main 과 합치다 충돌했어요: ${unmerged.join(", ")}` });
  }
  if (unmerged.includes("sw.js")) git(["checkout", "--ours", "sw.js"]);
  const files = git(["diff", "--cached", "--name-only", "HEAD"]).split("\n").filter(Boolean);
  // CACHE: 브랜치의 미리보기용 값 대신 지금 main 의 번호 + 1
  if (files.some((f) => FRONT.test(f) && f !== "sw.js") || files.includes("sw.js")) setCache(`dshs-study-v${cacheNum("origin/main") + 1}`);
  git(["add", "-A"]);
  git(["-c", "user.name=dshs42 build-agent", "-c", "user.email=build-agent@dshs.study",
    "commit", "-q", "-m", `${t.title} (관리자 최종 승인 · Claude 제작)\n\n작업 ${t.id} · 브랜치 ${branch}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`]);
  // 그사이 팀원이 main 에 올렸으면 거절됩니다 → 최종 승인 상태로 되돌려 다음 실행(10분 뒤)에 새 main 위에서 다시 합칩니다
  if (tryGit(["push", "-q", "origin", `HEAD:refs/heads/${TARGET}`]) === null) {
    await call({ action: "report", id: t.id, status: "accepted", error: "main 이 그사이 바뀌어 다음 실행에 다시 합쳐요" });
    return log(`합치기 미룸 (main 이 바뀜): ${branch}`);
  }
  tryGit(["push", "-q", "origin", "--delete", branch]);
  let note = "";
  if (TARGET === "main" && files.some((f) => f.startsWith("admin/"))) {
    try { execFileSync("node", [join(WT, "scripts", "deploy-admin.mjs")], { cwd: WT, stdio: "pipe" }); note = " · 관리자 사이트도 배포함"; }
    catch (e) { note = ` · 관리자 사이트 배포 실패: ${String(e.message).slice(0, 200)}`; }
  }
  await call({ action: "report", id: t.id, status: "merged", branch: "", error: note ? note.slice(3) : "" });
  log(`합침: ${branch} → ${TARGET}${note}`);
}

async function cleanup(t) {
  tryGit(["push", "-q", "origin", "--delete", t.branch]);
  await call({ action: "report", id: t.id, status: "rejected", branch: "" });
  log(`브랜치 지움: ${t.branch}`);
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", prompt, "--setting-sources", "user", "--allowedTools", ...TOOLS,
      "--model", MODEL, "--no-session-persistence", "--output-format", "text"],
      { cwd: WT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("30분이 지나 멈췄어요")); }, TIMEOUT);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude 종료 코드 ${code}: ${out.slice(-500)}`));
      resolve(out.trim());
    });
  });
}
