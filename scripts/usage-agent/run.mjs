#!/usr/bin/env node
// dshs42.app — 사용 분석 에이전트 (관리자 노트북에서 실행)
//
// launchd 가 한 시간마다 이 파일을 깨웁니다 (install.sh). 가장 최근의 "밤 10시"에 해당하는 분석이 아직 없으면
// 이 노트북의 Claude Code 를 `claude -p` 로 실행해 prompt.md 대로 분석하고 save_usage_report() 로 저장하게 합니다.
// 노트북이 밤 10시에 꺼져 있거나 잠자고 있었으면, 다음에 깨어났을 때 밀린 분석을 합니다.
// API 키는 쓰지 않고 이 노트북의 Claude Code 로그인과 Supabase MCP 연결을 씁니다.
//
//   node scripts/usage-agent/run.mjs          때가 됐으면 실행
//   node scripts/usage-agent/run.mjs --force  지금 바로 실행 (저장 · 푸시까지 합니다)
//
// 기록: ~/Library/Logs/dshs42-usage-agent.log (Windows 는 ~/.dshs42-logs) · 상태: ~/.dshs42-usage-agent.json
// Windows 에서는 install.ps1 이 작업 스케줄러에 같은 일정으로 넣습니다.

import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeBin, logFile, notify } from "../agent-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const LOG = logFile("dshs42-usage-agent.log");
const STATE = join(homedir(), ".dshs42-usage-agent.json");
const RUN_HOUR = 22;              // 한국 시간 밤 10시
const MAX_TRIES = 3;              // 한 번의 '밤 10시' 분석을 실패해도 다시 해 보는 횟수
const TIMEOUT = 20 * 60 * 1000;
const TOOLS = [
  "mcp__supabase__execute_sql",
  "Read", "Grep", "Glob",
  "Bash(git fetch:*)", "Bash(git show:*)", "Bash(git log:*)", "Bash(head:*)",
];

const log = (...a) => {
  const line = `[${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })}] ${a.join(" ")}\n`;
  try { appendFileSync(LOG, line); } catch {}
  process.stdout.write(line);
};
const readState = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return {}; } };
const writeState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));

// 가장 최근에 지나간 한국 시간 밤 10시 (예: 지금이 11/5 09:00 이면 11/4 22:00)
function lastSlot(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600e3);
  const slot = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), RUN_HOUR) - 9 * 3600e3);
  if (slot > now) slot.setUTCDate(slot.getUTCDate() - 1);
  return slot.toISOString();
}

// 노트북 두 대(우선 · 보조)가 함께 돌 때: 제작 맡기기 열쇠(~/.dshs42-build-agent.json)로 서버에 이 밤 분석이 이미 저장됐는지 묻습니다.
// 열쇠에 "backup": true 가 있는 보조 노트북은 밤 10시 + 90분이 지나도 저장된 분석이 없을 때만 합니다 (우선 노트북은 한 시간 안에 시작함).
const FN = "https://jsanpwlleufzgglqkrkv.supabase.co/functions/v1/build-agent";
const BACKUP_WAIT = 90 * 60e3;
let key = {};
try { key = JSON.parse(readFileSync(join(homedir(), ".dshs42-build-agent.json"), "utf8")); } catch {}

async function lastSaved() {
  if (!key.token) return null;
  try {
    const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-token": key.token },
      body: JSON.stringify({ action: "usage_last" }) });
    return r.ok ? (await r.json()).last : null;
  } catch { return null; }
}

const force = process.argv.includes("--force");
const slot = lastSlot();
const state = readState();
if (!force) {
  if (state.done === slot) process.exit(0);                               // 이미 했음
  if (state.slot === slot && (state.tries ?? 0) >= MAX_TRIES) process.exit(0);   // 오늘은 그만
  if (state.running && Date.now() - Date.parse(state.running) < TIMEOUT) process.exit(0);   // 실행 중
  if (key.backup && Date.now() < Date.parse(slot) + BACKUP_WAIT) process.exit(0);   // 보조: 우선 노트북 차례
  const last = await lastSaved();
  if (last && Date.parse(last) >= Date.parse(slot)) {                     // 다른 노트북이 이미 했음
    writeState({ ...state, done: slot });
    log(`다른 노트북이 이미 분석함 (${last})`);
    process.exit(0);
  }
}
writeState({ ...state, slot, tries: state.slot === slot ? (state.tries ?? 0) + 1 : 1, running: new Date().toISOString() });
log(`분석 시작 (${force ? "--force" : `밤 10시 분석 ${slot}`})`);

const prompt = readFileSync(join(HERE, "prompt.md"), "utf8")
  + `\n\n지금은 한국 시간 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 이다.`;
const args = [
  "-p", prompt,
  "--setting-sources", "user",          // 팀 저장소의 훅(git pull · DEVLOG 자동 기록)은 돌리지 않습니다
  "--allowedTools", ...TOOLS,
  "--model", "opus",
  "--no-session-persistence",
  "--output-format", "text",
];
const child = spawn(claudeBin(), args, { cwd: REPO, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (d) => { out += d; });
child.stderr.on("data", (d) => { out += d; });
const timer = setTimeout(() => { log("20분이 지나 멈춥니다"); child.kill("SIGTERM"); }, TIMEOUT);

child.on("close", (code) => {
  clearTimeout(timer);
  const saved = out.match(/SAVED\s+([0-9a-f-]{36})/i);
  const s = readState();
  delete s.running;
  if (saved) {
    s.done = slot;
    s.lastId = saved[1];
    log(`저장함 ${saved[1]}`);
  } else {
    log(`저장하지 못함 (종료 코드 ${code}, ${s.tries}/${MAX_TRIES}번째)\n${out.trim().split("\n").slice(-15).join("\n")}`);
    if (s.tries >= MAX_TRIES) notify("dshs42 사용 분석", `사용 분석을 3번 실패했어요. ${LOG} 를 확인하세요.`);
  }
  writeState(s);
  process.exit(saved ? 0 : 1);
});
child.on("error", (err) => { log(`claude 를 실행하지 못함: ${err.message}`); });
