#!/usr/bin/env node
// dshs42.app — Claude 제작 맡기기: 관리자 노트북 쪽 (agenttasks.sql · supabase/functions/build-agent)
//
// 관리자가 관리자 사이트 '제작' 칸에서 승인한 작업을 이 노트북이 받아 갑니다.
// 할 일이 있는지는 Claude 없이 build-agent 서버 함수로만 확인하므로, 할 일이 없을 때는 토큰을 쓰지 않습니다.
//
//   node scripts/build-agent/run.mjs        할 일 수만 확인해 기록 (1단계: 아직 제작하지 않음)
//
// 열쇠: ~/.dshs42-build-agent.json 의 token (저장소에 올리지 않음. DB 에는 sha256 만 agent_keys 에 있음)
// 기록: ~/Library/Logs/dshs42-build-agent.log
// 2단계에서 claim → 브랜치(agent-<번호>) 에서 claude -p 제작 → push → report(review) 와 최종 승인 뒤 main 합치기를 붙입니다.

import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FN = "https://jsanpwlleufzgglqkrkv.supabase.co/functions/v1/build-agent";
const LOG = join(homedir(), "Library", "Logs", "dshs42-build-agent.log");
const log = (...a) => {
  const line = `[${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })}] ${a.join(" ")}\n`;
  try { appendFileSync(LOG, line); } catch {}
  process.stdout.write(line);
};

let token;
try { token = JSON.parse(readFileSync(join(homedir(), ".dshs42-build-agent.json"), "utf8")).token; }
catch { log("열쇠 파일(~/.dshs42-build-agent.json)이 없어요"); process.exit(1); }

export async function call(body) {
  const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-token": token }, body: JSON.stringify(body) });
  const x = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${x.error ?? ""}`);
  return x;
}

try {
  const n = await call({ action: "peek" });
  if (n.build || n.merge || n.building) log(`제작 대기 ${n.build} · 합치기 대기 ${n.merge} · 제작 중 ${n.building}`);
  else log("할 일 없음");
} catch (e) {
  log("확인 실패:", e.message);
  process.exit(1);
}
