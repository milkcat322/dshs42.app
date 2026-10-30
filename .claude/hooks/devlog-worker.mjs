// 세션 기록을 요약해 DEVLOG.md 맨 아래에 추가하고(같은 세션이면 그 자리를 교체), 커밋한 뒤 push 한다.
// session-end.mjs 가 백그라운드로 실행한다.
// 직접 시험: node .claude/hooks/devlog-worker.mjs --transcript <기록.jsonl> --dry-run
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, log, repoRoot } from './lib.mjs';

// 아래에서 부르는 claude -p 세션이 다시 이 훅들을 실행하지 않게 막는 표시
process.env.DSHS_DEVLOG_CHILD = '1';

const DEVLOG = path.join(repoRoot, 'DEVLOG.md');
const MARKER = '<!-- 기록은 이 줄 아래에 시간순으로 쌓입니다 (최신이 맨 아래) -->';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const limit = (s, max) => (s.length <= max ? s : `${s.slice(0, max)} …(생략)`);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

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
      // IDE·시스템이 덧붙인 태그와 슬래시 명령 출력은 사용자 요청이 아니다
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        .replace(/<(system-reminder|ide_[a-z_]+|local-command-[a-z]+|command-[a-z]+)>[\s\S]*?<\/\1>/g, '').trim();
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
    ...git('status', '--porcelain').out.split('\n').map((l) => l.slice(3)),
  ].map((f) => f.trim()).filter((f) => f && f !== 'DEVLOG.md'));
  return `세션 중 커밋:\n${commits}\n\n바뀐 파일(커밋 + 커밋 안 된 것):\n${[...files].sort().join('\n')}`;
}

function summarize(digest, sid, gitInfo) {
  const range = `${ymd(digest.first)} ${hm(digest.first)}–${hm(digest.last)}`;
  const prompt = `아래는 dshs-study 저장소에서 진행한 Claude Code 개발 세션 기록과 git 정보다.
이 세션의 개발 로그 한 항목을 한국어 마크다운으로 써라. 읽는 사람은 이 프로젝트를 같이 개발하는 팀원이다.
설명이나 인사 없이 본문만 출력하고, 첫 줄은 반드시 \`## \` 로 시작한다.

형식:
## ${range} · (이 세션을 한 줄로 요약한 제목)

\`session ${sid}\` · 요청 ${digest.requests}회

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

규칙:
- 내용이 없는 소제목은 통째로 뺀다. 바뀐 파일은 아래 git 정보를 기준으로 쓴다.
- 기록에 있는 사실만 쓰고 추측하지 않는다.
- 사람을 가리킬 때 성별 대명사(그/그녀)를 쓰지 않는다.
- 비밀번호, 토큰, API 키 값은 절대 적지 않는다.
- 각 항목은 한 줄로 짧게 쓴다.
- 팀원에게 의미 없는 개인 환경 이야기(로컬 경로, 포트, 개인 PC 설정)는 쓰지 않는다.

===== git 정보 =====
${gitInfo}

===== 세션 기록 =====
${digest.text}
`;

  // 저장소 밖에서 실행해 프로젝트 훅이 다시 걸리지 않게 한다 (Windows 의 claude.cmd 는 shell 이 필요)
  const r = spawnSync('claude', ['-p', '--model', 'sonnet'], {
    input: prompt, cwd: os.tmpdir(), encoding: 'utf8', shell: process.platform === 'win32',
    maxBuffer: 20 * 1024 * 1024, timeout: 10 * 60 * 1000, windowsHide: true,
  });
  const out = r.stdout ?? '';
  const start = out.indexOf('## ');
  if (r.status === 0 && start >= 0) return out.slice(start).trim();

  log(`worker: 요약 실패 (exit ${r.status}): ${limit(`${out}${r.stderr ?? ''}${r.error ?? ''}`, 500)}`);
  return `## ${range} · (자동 요약 실패)\n\n\`session ${sid}\` · 요청 ${digest.requests}회\n\n${gitInfo}`;
}

function writeSection(section, sid) {
  let text = existsSync(DEVLOG)
    ? readFileSync(DEVLOG, 'utf8').replace(/\r\n/g, '\n')
    : `# dshs.study 개발 로그\n\n${MARKER}\n`;
  if (!text.includes(MARKER)) text = `${text.trimEnd()}\n\n${MARKER}\n`;

  const at = text.indexOf(MARKER) + MARKER.length;
  const entries = text.slice(at).split(/^(?=## )/m).map((s) => s.trim()).filter(Boolean);
  const i = entries.findIndex((e) => e.includes(`\`session ${sid}\``));
  if (i >= 0) entries[i] = section.trim();
  else entries.push(section.trim());
  writeFileSync(DEVLOG, `${text.slice(0, at)}\n\n${entries.join('\n\n')}\n`);
}

function publish(section) {
  git('add', '-A');
  if (git('diff', '--cached', '--quiet').code === 0) { log('worker: 커밋할 변경 없음'); return; }

  const title = section.split('\n')[0].replace(/^##\s*[^·]*·\s*/, '').trim();
  const msgFile = path.join(os.tmpdir(), `dshs-devlog-msg-${Date.now()}.txt`);
  writeFileSync(msgFile, `${title}\n\n세션 종료 시 자동 커밋 · DEVLOG.md\n`);
  const commit = git('commit', '-q', '-F', msgFile);
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
  const dryRun = args.includes('--dry-run');
  let transcriptPath, sessionId = '';
  if (args[0] === '--transcript') {
    transcriptPath = args[1];
  } else {
    const hook = JSON.parse(readFileSync(args[0], 'utf8').replace(/^﻿/, ''));
    unlinkSync(args[0]);
    transcriptPath = hook.transcript_path;
    sessionId = hook.session_id ?? '';
  }
  if (!transcriptPath || !existsSync(transcriptPath)) { log(`worker: 대화 기록 파일 없음 (${transcriptPath})`); return; }
  const sid = (sessionId || path.basename(transcriptPath, '.jsonl')).slice(0, 8);

  const digest = readDigest(transcriptPath);
  if (digest.requests === 0) { log('worker: 요청 없는 세션이라 건너뜀'); return; }

  const section = summarize(digest, sid, gitSummary(digest.first));
  if (dryRun) { process.stdout.write(`${section}\n`); return; }
  withLock(() => { writeSection(section, sid); publish(section); });
}

try { main(); } catch (err) { log(`worker 오류: ${err.stack ?? err}`); }
