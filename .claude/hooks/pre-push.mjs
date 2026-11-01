// PreToolUse 훅: Claude 가 git push 를 실행하기 직전에 원격을 확인한다.
// 다른 팀원이 그사이 올린 커밋이 있으면 push 를 막고, 먼저 받아서 합친 뒤 push 하도록 Claude 에게 알려 준다.
import { git, log, readHookInput } from './lib.mjs';

if (process.env.DSHS_DEVLOG_CHILD) process.exit(0);

const command = readHookInput().tool_input?.command ?? '';
if (!/\bgit\b[^;|&\n]*\bpush\b/.test(command)) process.exit(0);

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
process.stderr.write(`push 전에 ${remote} 에 다른 팀원의 새 커밋이 있어요. 먼저 합친 뒤 push 하세요.
새 커밋:
${incoming}

팀원이 바꾼 파일:
${files}

1. 사용자에게 팀원의 새 커밋을 짧게 알린다.
2. git pull --rebase --autostash 로 받는다. 충돌하면 CLAUDE.md 의 "동시 작업과 충돌" 절차대로 양쪽 기능을 모두 살려 합친다.
3. 합친 결과를 확인(node --check, 충돌 표시 검색)한 뒤 다시 push 한다.
`);
process.exit(2);
