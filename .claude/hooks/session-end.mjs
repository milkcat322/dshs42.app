// SessionEnd 훅: 개발 로그 요약과 push 는 오래 걸리므로 백그라운드 작업으로 넘기고 바로 끝낸다.
// (VS Code 에서는 실행되지 않을 때가 많다. 그때는 stop.mjs 의 대기 작업이 기록을 맡는다)
import { launchWorker, log, readHookInput } from './lib.mjs';

if (process.env.DSHS_DEVLOG_CHILD) process.exit(0);

const hook = readHookInput();
if (!hook.session_id || !hook.transcript_path) process.exit(0);

launchWorker(['--mode', 'final', '--session', hook.session_id, '--transcript', hook.transcript_path]);
log(`end: 개발 로그 작업 시작 (session ${hook.session_id.slice(0, 8)})`);
