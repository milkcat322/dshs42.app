// 관리자 노트북 에이전트(usage-agent · build-agent)가 맥과 Windows 에서 함께 쓰는 것들
//   claudeBin() : 실행할 claude 경로. Windows 의 npm 설치는 claude.cmd 라 shell 없이 못 부르므로 그 안의 claude.exe 를 찾습니다.
//   logFile()   : 기록 파일. 맥은 ~/Library/Logs, Windows 는 ~/.dshs42-logs
//   notify()    : 실패 알림. 맥은 알림 센터, Windows 는 기록만 남깁니다.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const WIN = process.platform === "win32";

export function claudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (!WIN) return "claude";
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const found = [
    ...dirs.map((d) => join(d, "claude.exe")),
    ...dirs.map((d) => join(d, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")),
    join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    join(homedir(), ".local", "bin", "claude.exe"),
  ].find((p) => existsSync(p));
  return found || "claude.exe";
}

// claude -p 가 이 PC 계정의 사용 한도에 걸려 끝났는지 (그러면 다른 PC 에 넘깁니다)
export function isLimitHit(text) {
  return /usage limit|limit reached|hit your (usage )?limit|limit will reset|resets? at|rate[ _-]?limit|\b429\b/i.test(String(text || ""));
}

export function logFile(name) {
  const dir = process.platform === "darwin" ? join(homedir(), "Library", "Logs") : join(homedir(), ".dshs42-logs");
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return join(dir, name);
}

export function notify(title, msg) {
  if (process.platform !== "darwin") return;
  spawn("osascript", ["-e", `display notification "${msg.replace(/"/g, "'")}" with title "${title}"`]);
}
