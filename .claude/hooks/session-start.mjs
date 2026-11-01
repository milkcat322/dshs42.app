// SessionStart 훅: 세션을 열 때 원격 저장소의 변경을 먼저 받아오고,
// 지난 세션 중 DEVLOG 에 아직 기록되지 않은 것(PC 가 꺼지는 등으로 놓친 것)이 있으면 지금 기록한다.
import { existsSync, statSync } from 'node:fs';
import { git, IDLE_MS, launchWorker, listStates, log, readHookInput, removeState } from './lib.mjs';

if (process.env.DSHS_DEVLOG_CHILD) process.exit(0);

const hook = readHookInput();

const before = git('rev-parse', 'HEAD').out;
const pull = git('pull', '--rebase', '--autostash');
const after = git('rev-parse', 'HEAD').out;

let msg, conflict = false;
if (pull.code !== 0) {
  // 충돌로 rebase 가 멈춘 채 남지 않도록 pull 전 상태로 되돌린다
  conflict = git('rebase', '--abort').code === 0;
  msg = conflict
    ? `git pull 충돌: 다른 팀원이 같은 부분을 고쳐서 자동으로 합치지 못했어요 (pull 전 상태로 되돌림)\n${pull.out}`
    : `git pull 실패:\n${pull.out}`;
} else if (before === after) msg = 'git pull: 이미 최신 상태';
else msg = `git pull: 새 커밋을 받았어요\n${git('log', '--oneline', `${before}..${after}`).out}`;
log(`start: ${msg}`);

for (const s of listStates()) {
  if (s.id === hook.session_id) continue;
  if (!s.transcript || !existsSync(s.transcript)) { removeState(s.id); continue; }
  const pending = statSync(s.transcript).size > (s.done ?? 0);
  // 대기 작업이 아직 돌고 있을 수 있는 세션은 그쪽에 맡긴다
  if (pending && Date.now() - (s.touched ?? 0) > IDLE_MS + 5 * 60 * 1000) {
    log(`start: 놓친 세션 기록 (session ${s.id.slice(0, 8)})`);
    launchWorker(['--mode', 'catchup', '--session', s.id, '--transcript', s.transcript]);
  } else if (!pending && Date.now() - (s.touched ?? 0) > 7 * 24 * 60 * 60 * 1000) {
    removeState(s.id);
  }
}

process.stdout.write(JSON.stringify({
  systemMessage: msg,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: `세션 시작 시 자동 git pull 결과:\n${msg}\n${conflict
      ? '다른 작업보다 먼저 사용자에게 충돌을 알리고, CLAUDE.md 의 "동시 작업과 충돌" 절차대로 함께 해결할 것.'
      : '작업 전에 DEVLOG.md 의 개발 흐름과 최근 기록의 남은 일을 확인할 것.'}`,
  },
}));
