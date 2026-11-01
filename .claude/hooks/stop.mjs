// Stop 훅: Claude 가 답을 마칠 때마다 실행된다.
// 1. VS Code 에서는 세션 종료 훅이 실행되지 않는 경우가 많아서, 세션 끝을 기다리지 않고
//    마지막 답변 뒤 IDLE_MS 동안 다음 요청이 없으면 그때까지의 세션을 DEVLOG 에 기록한다.
// 2. 올리지 않은 코드 변경이 있으면 Claude 를 한 번 더 깨워, 기능이 완성됐으면 Check Push 하게 한다.
import { git, launchWorker, readHookInput, writeState } from './lib.mjs';

if (process.env.DSHS_DEVLOG_CHILD) process.exit(0);

const hook = readHookInput();
if (!hook.session_id || !hook.transcript_path) process.exit(0);

// 다음 답변이 오면 nonce 가 바뀌어, 먼저 띄운 대기 작업은 기록하지 않고 끝난다
const nonce = `${Date.now()}-${process.pid}`;
writeState(hook.session_id, { transcript: hook.transcript_path, nonce, touched: Date.now() });
launchWorker(['--mode', 'idle', '--session', hook.session_id, '--transcript', hook.transcript_path, '--nonce', nonce]);

// 이미 한 번 깨운 뒤의 답변이면 그대로 끝낸다 (무한 반복 방지)
if (hook.stop_hook_active) process.exit(0);

// DEVLOG.md 는 자동 기록이 따로 올리므로 뺀다
const changed = git('status', '--porcelain').out.split('\n')
  .map((l) => l.replace(/^\s*\S{1,2}\s+/, '').split(' -> ').pop().trim())
  .filter((f) => f && f !== 'DEVLOG.md');
const unpushed = git('log', '--oneline', '@{u}..HEAD');
const ahead = unpushed.code === 0 ? unpushed.out : '';
if (!changed.length && !ahead) process.exit(0);

process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: `[자동 Check Push 확인] 아직 팀에 올리지 않은 변경이 있어요.
${changed.length ? `커밋 안 된 파일: ${changed.join(', ')}\n` : ''}${ahead ? `push 안 된 커밋:\n${ahead}\n` : ''}
- 방금 기능 하나(또는 수정 하나)가 완성되어 동작 확인까지 끝났으면: 사용자에게 묻지 말고 지금 /check-push 절차로 Check Push 한 뒤 결과를 한두 줄로 알린다.
- 아직 개발 중이거나, 사용자에게 질문했거나, 답을 기다리는 중이면: 아무것도 하지 말고 추가 설명 없이 바로 끝낸다.`,
}));
