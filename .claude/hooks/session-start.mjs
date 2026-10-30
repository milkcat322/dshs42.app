// SessionStart 훅: 세션을 열 때 원격 저장소의 변경을 먼저 받아온다.
import { git, log } from './lib.mjs';

if (process.env.DSHS_DEVLOG_CHILD) process.exit(0);

const before = git('rev-parse', 'HEAD').out;
const pull = git('pull', '--rebase', '--autostash');
const after = git('rev-parse', 'HEAD').out;

let msg;
if (pull.code !== 0) msg = `git pull 실패:\n${pull.out}`;
else if (before === after) msg = 'git pull: 이미 최신 상태';
else msg = `git pull: 새 커밋을 받았어요\n${git('log', '--oneline', `${before}..${after}`).out}`;
log(`start: ${msg}`);

process.stdout.write(JSON.stringify({
  systemMessage: msg,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: `세션 시작 시 자동 git pull 결과:\n${msg}\n작업 전에 DEVLOG.md 의 최근 기록과 남은 일을 확인할 것.`,
  },
}));
