// 세션 기록을 요약해 DEVLOG.md 맨 아래에 추가하고(같은 세션이면 그 자리를 교체), 커밋한 뒤 push 한다.
// 주요 개발이면 DEVLOG.md 앞부분의 "개발 흐름" 에도 한 줄을 추가한다.
//
// --mode idle    stop.mjs 가 매 답변 뒤 실행. IDLE_MS 동안 다음 답변이 없을 때만 기록하고 DEVLOG.md 만 커밋한다.
// --mode catchup session-start.mjs 가 놓친 세션에 대해 실행. 바로 기록하고 DEVLOG.md 만 커밋한다.
// --mode final   session-end.mjs 가 실행. 기록하고 바뀐 파일 전체를 커밋한다.
// --mode write   Check Push 직전에 Claude 가 실행. DEVLOG.md 에 기록만 하고 커밋·push 는 Check Push 에 맡긴다.
//                --session 을 빼면 CLAUDE_CODE_SESSION_ID, --transcript 를 빼면 세션 id 로 대화 기록을 찾는다.
// 직접 시험: node .claude/hooks/devlog-worker.mjs --transcript <기록.jsonl> --dry-run
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTranscript, git, IDLE_MS, log, readState, repoRoot, requestText, writeState } from './lib.mjs';

// 아래에서 부르는 claude -p 세션이 다시 이 훅들을 실행하지 않게 막는 표시
process.env.DSHS_DEVLOG_CHILD = '1';

const DEVLOG = path.join(repoRoot, 'DEVLOG.md');
const MARKER = '<!-- 기록은 이 줄 아래에 시간순으로 쌓입니다 (최신이 맨 아래) -->';
const FLOW_START = '<!-- 개발 흐름 시작: 세션이 기록될 때 주요 개발이면 자동으로 한 줄 추가됩니다 -->';
const FLOW_END = '<!-- 개발 흐름 끝 -->';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const limit = (s, max) => (s.length <= max ? s : `${s.slice(0, max)} …(생략)`);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readDevlog = () => (existsSync(DEVLOG) ? readFileSync(DEVLOG, 'utf8').replace(/\r\n/g, '\n') : '');

function readDigest(transcriptPath) {
  const lines = [];
  let requests = 0, first = null, last = null;
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain || e.isMeta) continue;
    if (e.timestamp) { last = new Date(e.timestamp); first ??= last; }

    const content = e.message?.content;
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: content ?? '' }];
    if (e.type === 'user') {
      const text = requestText(e);
      if (!text) continue;
      requests++;
      lines.push(`\n[사용자] ${limit(text, 3000)}`);
    } else {
      for (const b of blocks) {
        if (b.type === 'text' && b.text) lines.push(`[Claude] ${limit(b.text, 2000)}`);
        else if (b.type === 'tool_use') {
          const i = b.input ?? {};
          const detail = i.file_path ?? i.command ?? i.pattern ?? i.url ?? i.description ?? i.skill ?? '';
          lines.push(`  - 도구 ${b.name}: ${limit(String(detail).replace(/\s+/g, ' '), 200)}`);
        }
      }
    }
  }
  let text = lines.join('\n');
  if (text.length > 120000) text = `${text.slice(0, 40000)}\n…(중략)…\n${text.slice(-80000)}`;
  return { text, requests, first, last };
}

function gitSummary(since) {
  const sinceArg = `--since=${since.toISOString()}`;
  const commits = git('log', sinceArg, '--pretty=format:%h %s').out;
  const files = new Set([
    ...git('log', sinceArg, '--name-only', '--pretty=format:').out.split('\n'),
    // git() 이 출력 앞뒤 공백을 지워 첫 줄의 상태 칸 너비가 달라지므로, 상태 코드를 글자 수가 아니라 패턴으로 떼어 낸다
    ...git('status', '--porcelain').out.split('\n').map((l) => l.replace(/^\s*\S{1,2}\s+/, '').split(' -> ').pop()),
  ].map((f) => f.trim()).filter((f) => f && f !== 'DEVLOG.md'));
  return `세션 중 커밋:\n${commits}\n\n바뀐 파일(커밋 + 커밋 안 된 것):\n${[...files].sort().join('\n')}`;
}

function flowLines(text) {
  const s = text.indexOf(FLOW_START), e = text.indexOf(FLOW_END);
  if (s < 0 || e < s) return null;
  return text.slice(s + FLOW_START.length, e).split('\n').map((l) => l.trim()).filter(Boolean);
}

function summarize(digest, sid, gitInfo) {
  const range = `${ymd(digest.first)} ${hm(digest.first)}–${hm(digest.last)}`;
  const flow = (flowLines(readDevlog()) ?? []).map((l) => l.replace(/\s*<!--.*?-->/g, '')).join('\n');
  // 누가 개발했는지: 이 PC 의 git 사용자 이름 (요약 모델이 추측하지 않게 직접 넣는다)
  const meta = `\`session ${sid}\` · 개발 ${git('config', 'user.name').out || '알 수 없음'} · 요청 ${digest.requests}회`;
  const prompt = `아래는 dshs-study 저장소에서 진행한 Claude Code 개발 세션 기록과 git 정보다.
이 세션의 개발 로그 한 항목을 한국어 마크다운으로 써라. 읽는 사람은 이 프로젝트를 같이 개발하는 팀원이다.
설명이나 인사 없이 본문만 출력하고, 첫 줄은 반드시 \`## \` 로 시작한다.

형식:
## ${range} · (이 세션을 한 줄로 요약한 제목)

${meta}

### 목표
- ...
### 한 일
- ...
### 결정과 이유
- ...
### 해결한 문제
- 증상 → 원인 → 해결
### 남은 일
- [ ] ...
### 배운 점
- ...
### 바뀐 파일
- \`파일 경로\`

===흐름===
(개발 흐름 한 줄 또는 없음)

===소식===
(같이 개발하는 친구에게 보낼 개발 소식 1~3줄 또는 없음)

규칙:
- 둘째 줄(session · 개발 · 요청)은 위 형식 그대로 옮겨 쓴다.
- 내용이 없는 소제목은 통째로 뺀다. 바뀐 파일은 아래 git 정보를 기준으로 쓴다.
- 기록에 있는 사실만 쓰고 추측하지 않는다.
- 사람을 가리킬 때 성별 대명사(그/그녀)를 쓰지 않는다.
- 비밀번호, 토큰, API 키 값은 절대 적지 않는다.
- 각 항목은 한 줄로 짧게 쓴다.
- 팀원에게 의미 없는 개인 환경 이야기(로컬 경로, 포트, 개인 PC 설정)는 쓰지 않는다.
- 마지막 \`===흐름===\` 아래에는, 이 세션이 프로젝트의 큰 흐름에서 눈여겨볼 개발(새 기능, 큰 구조 변경, 방향을 정한 결정)이면
  \`- **${ymd(digest.first)}** 무엇이 생겼거나 바뀌었는지 한 줄\` 형식으로 한 줄을 쓰고, 작은 수정·조사·잡일뿐이면 \`없음\` 이라고만 쓴다.
  한 세션에 주요 개발이 여러 개면 마지막 것만 쓰지 말고 세션 전체를 쉼표로 이어 한 줄에 담는다.
  아래 "지금까지의 개발 흐름" 에서 다른 세션의 내용은 되풀이하지 않는다.
- 마지막 \`===소식===\` 아래에는, 이 세션에서 실제로 만들거나 고친 것을 같이 개발하는 친구가 알림 한 번으로 알아보게
  \`- \` 로 시작하는 1~3줄로 쓴다. 한 줄은 40자 안팎, 개발 용어 대신 "학생 사이트 · 관리자 사이트에서 무엇이 달라졌는지" 로 쓴다.
  코드 · DB 를 바꾸지 않은 세션(조사, 질문, 문서 · 공지문 작성)이면 \`없음\` 이라고만 쓴다.

===== 지금까지의 개발 흐름 =====
${flow}

===== git 정보 =====
${gitInfo}

===== 세션 기록 =====
${digest.text}
`;

  // 저장소 밖에서 실행해 프로젝트 훅이 다시 걸리지 않게 한다 (Windows 의 claude.cmd 는 shell 이 필요)
  // Claude Code 안에서 띄운 경우 그 세션의 환경 변수를 넘기지 않는다
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([k]) => !/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_|CLAUDE_PID$)/.test(k)));
  const r = spawnSync('claude', ['-p', '--model', 'sonnet'], {
    input: prompt, cwd: os.tmpdir(), encoding: 'utf8', shell: process.platform === 'win32', env,
    maxBuffer: 20 * 1024 * 1024, timeout: 10 * 60 * 1000, windowsHide: true,
  });
  const out = r.stdout ?? '';
  const start = out.indexOf('## ');
  if (r.status === 0 && start >= 0) {
    const [body, newsPart = ''] = out.slice(start).split('===소식===');
    const [section, flowPart = ''] = body.split('===흐름===');
    const flowLine = flowPart.split('\n').map((l) => l.trim()).find((l) => l.startsWith('- '));
    // 소식은 한 줄 주석으로 넣으므로 줄마다 ' | ' 로 잇는다 (dev-news 서버 함수가 읽어 관리자에게 알림)
    const news = newsPart.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).replace(/-->|\|/g, ' ').trim()).filter(Boolean).slice(0, 3).join(' | ') || null;
    return { section: section.trim(), flowLine, news };
  }

  log(`worker: 요약 실패 (exit ${r.status}): ${limit(`${out}${r.stderr ?? ''}${r.error ?? ''}`, 500)}`);
  return { failed: true, section: `## ${range} · (자동 요약 실패)\n\n${meta}\n\n${gitInfo}` };
}

// 세션의 개발 흐름 한 줄은 그 세션 기록 끝에 <!-- flow: … --> 로 넣어 둔다.
// 위의 "개발 흐름" 목록은 여기서 매번 다시 만든다 (writeFlow). 공용 목록을 직접 고치면 두 사람이 동시에 고칠 때
// union 병합이 옛 줄과 새 줄을 모두 남겨 겹치지만, 세션 기록은 그 세션만 고치므로 겹치지 않는다.
const FLOW_RE = /<!-- flow: (.*?) -->/;
const NEWS_RE = /<!-- news: (.*?) -->/;

function writeSection(section, sid, flowLine, news) {
  let text = readDevlog() || `# dshs42.app 개발 로그\n\n${MARKER}\n`;
  if (!text.includes(MARKER)) text = `${text.trimEnd()}\n\n${MARKER}\n`;

  const at = text.indexOf(MARKER) + MARKER.length;
  const entries = text.slice(at).split(/^(?=## )/m).map((s) => s.trim()).filter(Boolean);
  const i = entries.findIndex((e) => e.includes(`\`session ${sid}\``));
  // 이번에 "없음" 이어도 이 세션의 이전 흐름 줄은 그대로 둔다
  const flow = flowLine ?? (i >= 0 ? entries[i].match(FLOW_RE)?.[1] : undefined);
  // 소식도 이번에 "없음" 이면 이전 소식을 그대로 둔다 (바뀐 것이 없으니 다시 알리지 않음)
  const prevNews = i >= 0 ? entries[i].match(NEWS_RE)?.[1] : undefined;
  const newsText = news ?? prevNews;
  const entry = section.trim() + (flow ? `\n\n<!-- flow: ${flow} -->` : '') + (newsText ? `\n<!-- news: ${newsText} -->` : '');
  if (i >= 0) entries[i] = entry;
  else entries.push(entry);
  writeFileSync(DEVLOG, `${text.slice(0, at)}\n\n${entries.join('\n\n')}\n`);
}

// 개발 흐름 목록 = 세션 태그가 없는 줄(손으로 쓴 초기 기록) + 기록 순서대로 각 세션의 flow 줄.
// flow 를 아직 기록에 넣지 않은 옛 세션은 목록에 있던 그 세션의 마지막 줄을 쓴다.
function writeFlow() {
  const text = readDevlog();
  const lines = flowLines(text);
  if (!lines) return;
  const tagOf = (l) => l.match(/<!-- session (\w+) -->/)?.[1];
  const manual = lines.filter((l) => !tagOf(l));
  const legacy = new Map(lines.filter(tagOf).map((l) => [tagOf(l), l]));
  const at = text.indexOf(MARKER) + MARKER.length;
  const sessions = [];
  for (const e of text.slice(at).split(/^(?=## )/m)) {
    const sid = e.match(/`session (\w+)`/)?.[1];
    if (!sid || sessions.some((x) => x.sid === sid)) continue;
    const flow = e.match(FLOW_RE)?.[1];
    const line = flow ? `${flow} <!-- session ${sid} -->` : legacy.get(sid);
    if (line) sessions.push({ sid, line });
  }
  const out = [...manual, ...sessions.map((x) => x.line)];
  const s = text.indexOf(FLOW_START) + FLOW_START.length, e = text.indexOf(FLOW_END);
  writeFileSync(DEVLOG, `${text.slice(0, s)}\n${out.join('\n')}\n${text.slice(e)}`);
}

function publish(title, all) {
  if (all) git('add', '-A');
  const changed = all
    ? git('diff', '--cached', '--quiet').code !== 0
    : git('diff', '--quiet', 'HEAD', '--', 'DEVLOG.md').code !== 0;
  if (!changed) { log('worker: 커밋할 변경 없음'); return; }

  const msgFile = path.join(os.tmpdir(), `dshs-devlog-msg-${Date.now()}.txt`);
  writeFileSync(msgFile, `${title}\n\n${all ? '세션 종료 시 자동 커밋' : '개발 로그 자동 기록'} · DEVLOG.md\n`);
  // 세션 중간 기록은 작업 중인 코드를 건드리지 않도록 DEVLOG.md 만 커밋한다
  const commit = git('commit', '-q', '-F', msgFile, ...(all ? [] : ['--', 'DEVLOG.md']));
  unlinkSync(msgFile);
  if (commit.code !== 0) { log(`worker: 커밋 실패: ${commit.out}`); return; }

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out;
  if (branch === 'HEAD') { log('worker: detached HEAD 라 push 생략'); return; }
  if (git('rev-parse', '--abbrev-ref', '@{u}').code === 0) {
    const pull = git('pull', '--rebase', '--autostash', '-q');
    if (pull.code !== 0) {
      git('rebase', '--abort');
      log(`worker: pull 충돌로 push 중단, 커밋은 로컬에 남음: ${pull.out}`);
      return;
    }
  }
  const push = git('push', '-u', 'origin', 'HEAD');
  log(push.code === 0 ? `worker: push 완료 (${branch}) · ${title}` : `worker: push 실패: ${push.out}`);
}

// 세션 여러 개가 동시에 끝나도 DEVLOG.md 와 git 을 한 번에 하나씩만 건드리게 한다
function withLock(fn) {
  const lock = path.join(repoRoot, '.git', 'devlog.lock');
  for (let waited = 0; ; waited += 5000) {
    try { closeSync(openSync(lock, 'wx')); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 20 * 60 * 1000) unlinkSync(lock); } catch {}
      if (waited > 15 * 60 * 1000) { log('worker: 잠금 대기 시간 초과'); return; }
      sleep(5000);
    }
  }
  try { fn(); } finally { try { unlinkSync(lock); } catch {} }
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const dryRun = args.includes('--dry-run');
  const mode = opt('mode') ?? 'final';
  const sessionId = opt('session') ?? process.env.CLAUDE_CODE_SESSION_ID ?? '';
  const transcriptPath = opt('transcript') ?? (sessionId ? findTranscript(sessionId) : undefined);
  if (!transcriptPath || !existsSync(transcriptPath)) { log(`worker: 대화 기록 파일 없음 (${transcriptPath})`); return; }
  const sid = (sessionId || path.basename(transcriptPath, '.jsonl')).slice(0, 8);

  if (mode === 'idle') {
    sleep(IDLE_MS);
    if (readState(sessionId).nonce !== opt('nonce')) return; // 그사이 다음 답변이 있었음
  }

  const size = statSync(transcriptPath).size;
  const fresh = dryRun || !sessionId || size > (readState(sessionId).done ?? 0);
  const all = mode === 'final';
  if (!fresh) {
    // 이미 기록한 세션: 종료 때는 남은 코드 변경만 커밋한다
    if (all && !dryRun) withLock(() => publish('세션 종료 자동 커밋', true));
    if (mode === 'write') process.stdout.write('DEVLOG.md 가 이미 최신이에요\n');
    return;
  }

  const digest = readDigest(transcriptPath);
  if (digest.requests === 0) { log('worker: 요청 없는 세션이라 건너뜀'); return; }

  const { section, flowLine, news, failed } = summarize(digest, sid, gitSummary(digest.first));
  if (dryRun) { process.stdout.write(`${section}\n\n===흐름===\n${flowLine ?? '없음'}\n\n===소식===\n${news ?? '없음'}\n`); return; }
  // 요약에 실패했는데 이 세션 기록이 이미 있으면 잘 쓴 기록을 git 정보로 덮어쓰지 않고 다음에 다시 시도한다
  if (failed && readDevlog().includes(`\`session ${sid}\``)) {
    log('worker: 요약 실패 — 기존 기록을 그대로 둠');
    if (mode === 'write') process.stdout.write('요약에 실패해 DEVLOG.md 는 그대로 뒀어요 (.git/devlog-hook.log 참고)\n');
    else if (all) withLock(() => publish('세션 종료 자동 커밋', true));
    return;
  }
  withLock(() => {
    writeSection(section, sid, flowLine, news);
    writeFlow();
    const title = section.split('\n')[0].replace(/^##\s*[^·]*·\s*/, '').trim();
    // requests: pre-push.mjs 가 "마지막 기록 뒤에 새 요청이 있었는지" 비교하는 데 쓴다
    if (sessionId) writeState(sessionId, { done: size, requests: digest.requests, transcript: transcriptPath });
    if (mode === 'write') { log(`worker: DEVLOG 기록 (Check Push 용) · ${title}`); process.stdout.write(`DEVLOG.md 에 기록했어요: ${title}\n`); return; }
    publish(title, all);
  });
}

try { main(); } catch (err) { log(`worker 오류: ${err.stack ?? err}`); }
