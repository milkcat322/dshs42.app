// PreToolUse 훅: Claude 가 git push 를 실행하기 직전에 확인한다.
// 1. 마지막 DEVLOG 기록 뒤에 새 요청이 있었으면 push 를 막고, DEVLOG 를 먼저 갱신해 함께 올리게 한다.
// 2. 다른 팀원이 그사이 올린 커밋이 있으면 push 를 막고, 먼저 받아서 합친 뒤 push 하게 한다.
import { existsSync } from 'node:fs';
import { countRequests, git, log, readHookInput, readState } from './lib.mjs';

if (process.env.DSHS_DEVLOG_CHILD) process.exit(0);

const hook = readHookInput();
const command = hook.tool_input?.command ?? '';
if (!/\bgit\b[^;|&\n]*\bpush\b/.test(command)) process.exit(0);

function block(msg) {
  process.stderr.write(msg);
  process.exit(2);
}

if (hook.session_id && hook.transcript_path && existsSync(hook.transcript_path)) {
  const requests = countRequests(hook.transcript_path);
  const logged = readState(hook.session_id).requests ?? 0;
  if (requests > logged) {
    log(`pre-push: DEVLOG 에 요청 ${requests - logged}개가 아직 기록되지 않아 push 를 막음`);
    block(`이번 세션의 개발 내용이 DEVLOG.md 에 아직 반영되지 않았어요 (기록 뒤 새 요청 ${requests - logged}개). 먼저 DEVLOG 를 갱신해 함께 올리세요.
1. node .claude/hooks/devlog-worker.mjs --mode write --session ${hook.session_id}
   (대화를 요약하느라 1~3분 걸리니 명령 시간 제한을 5분 이상으로)
2. git add DEVLOG.md && git commit -m "DEVLOG: <이번 작업 요약>"
3. 다시 Check Push (git fetch → 새 커밋 확인 → git push)
`);
  }
}

const fetch = git('fetch', '--quiet', 'origin');
if (fetch.code !== 0) process.exit(0); // 오프라인 등은 push 가 스스로 실패하게 둔다

const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out;
const upstream = git('rev-parse', '--abbrev-ref', '@{u}');
const remote = upstream.code === 0 ? upstream.out : `origin/${branch}`;
if (git('rev-parse', '--verify', '--quiet', remote).code !== 0) process.exit(0); // 원격에 없는 새 브랜치

const incoming = git('log', '--oneline', `HEAD..${remote}`).out;
if (!incoming) process.exit(0);

log(`pre-push: ${remote} 에 새 커밋이 있어 push 를 막음`);
const files = git('diff', '--name-only', `HEAD...${remote}`).out;
block(`push 전에 ${remote} 에 다른 팀원의 새 커밋이 있어요. 먼저 합친 뒤 push 하세요.
새 커밋:
${incoming}

팀원이 바꾼 파일:
${files}

1. 사용자에게 팀원의 새 커밋을 짧게 알린다.
2. git pull --rebase --autostash 로 받는다. 충돌하면 CLAUDE.md 의 "동시 작업과 충돌" 절차대로 양쪽 기능을 모두 살려 합친다.
3. 합친 결과를 확인(node --check, 충돌 표시 검색)한 뒤 다시 push 한다.
`);
