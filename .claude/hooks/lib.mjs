// dshs-study Claude Code 훅 공용 함수
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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
