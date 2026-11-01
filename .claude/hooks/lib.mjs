// dshs-study Claude Code 훅 공용 함수
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 마지막 답변 뒤 이만큼 다음 요청이 없으면 그때까지의 세션을 DEVLOG 에 기록한다
export const IDLE_MS = 10 * 60 * 1000;

// 비밀번호 창이 떠서 멈추지 않도록 git 인증은 저장된 정보로만 시도한다
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

export function git(...args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: repoRoot, encoding: 'utf8', env: gitEnv, windowsHide: true,
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

// 실행 기록은 커밋되지 않도록 .git 폴더 안에 남긴다
export function log(msg) {
  const stamp = new Date().toLocaleString('sv-SE');
  try { appendFileSync(path.join(repoRoot, '.git', 'devlog-hook.log'), `[${stamp}] ${msg}\n`); } catch {}
}

export function readHookInput() {
  try { return JSON.parse(readFileSync(0, 'utf8').replace(/^﻿/, '')); } catch { return {}; }
}

// devlog-worker.mjs 를 백그라운드로 띄운다
export function launchWorker(args) {
  const worker = path.join(repoRoot, '.claude', 'hooks', 'devlog-worker.mjs');
  if (process.platform === 'win32') {
    // Windows 에서는 WMI 로 띄워야 Claude Code·VS Code 가 꺼져도 작업이 같이 죽지 않는다
    const q = (s) => s.replace(/'/g, "''");
    const cmdLine = [process.execPath, worker, ...args].map((a) => `"${a}"`).join(' ');
    const ps = `$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${q(cmdLine)}'; CurrentDirectory = '${q(repoRoot)}'; ProcessStartupInformation = $s }
exit $r.ReturnValue`;
    const r = spawnSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
      { windowsHide: true });
    if (r.status === 0) return;
  }
  spawn(process.execPath, [worker, ...args], {
    cwd: repoRoot, detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}

// 세션별 기록 상태 (.git/devlog/<세션 id>.json): 대화 기록 경로, 마지막 답변 시각, DEVLOG 에 반영한 크기
const stateDir = path.join(repoRoot, '.git', 'devlog');
const stateFile = (id) => path.join(stateDir, `${id}.json`);

export function readState(id) {
  try { return JSON.parse(readFileSync(stateFile(id), 'utf8')); } catch { return {}; }
}

export function writeState(id, patch) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile(id), JSON.stringify({ ...readState(id), ...patch }));
}

export function listStates() {
  if (!existsSync(stateDir)) return [];
  return readdirSync(stateDir).filter((f) => f.endsWith('.json'))
    .map((f) => ({ id: f.slice(0, -5), ...readState(f.slice(0, -5)) }));
}

export function removeState(id) {
  try { unlinkSync(stateFile(id)); } catch {}
}
