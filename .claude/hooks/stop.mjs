// Stop 훅: Claude 가 답을 마칠 때마다 실행된다.
// VS Code 에서는 세션 종료 훅이 실행되지 않는 경우가 많아서, 세션 끝을 기다리지 않고
// 마지막 답변 뒤 IDLE_MS 동안 다음 요청이 없으면 그때까지의 세션을 DEVLOG 에 기록한다.
import { launchWorker, readHookInput, writeState } from './lib.mjs';

if (process.env.DSHS_DEVLOG_CHILD) process.exit(0);

const hook = readHookInput();
if (!hook.session_id || !hook.transcript_path) process.exit(0);

// 다음 답변이 오면 nonce 가 바뀌어, 먼저 띄운 대기 작업은 기록하지 않고 끝난다
const nonce = `${Date.now()}-${process.pid}`;
writeState(hook.session_id, { transcript: hook.transcript_path, nonce, touched: Date.now() });
launchWorker(['--mode', 'idle', '--session', hook.session_id, '--transcript', hook.transcript_path, '--nonce', nonce]);
