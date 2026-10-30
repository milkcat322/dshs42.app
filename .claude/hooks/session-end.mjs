// SessionEnd 훅: 개발 로그 요약과 push 는 오래 걸리므로 백그라운드 작업으로 넘기고 바로 끝낸다.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, repoRoot } from './lib.mjs';

if (process.env.DSHS_DEVLOG_CHILD) process.exit(0);

const inputFile = path.join(os.tmpdir(), `dshs-devlog-${Date.now()}-${process.pid}.json`);
writeFileSync(inputFile, readFileSync(0, 'utf8').replace(/^﻿/, ''));
const worker = path.join(repoRoot, '.claude', 'hooks', 'devlog-worker.mjs');

function launchViaWmi() {
  // Windows 에서는 WMI 로 띄워야 Claude Code·VS Code 가 꺼져도 작업이 같이 죽지 않는다
  const q = (s) => s.replace(/'/g, "''");
  const cmdLine = `"${process.execPath}" "${worker}" "${inputFile}"`;
  const ps = `$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${q(cmdLine)}'; CurrentDirectory = '${q(repoRoot)}'; ProcessStartupInformation = $s }
exit $r.ReturnValue`;
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
    { windowsHide: true });
  return r.status === 0;
}

if (process.platform !== 'win32' || !launchViaWmi()) {
  spawn(process.execPath, [worker, inputFile], {
    cwd: repoRoot, detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}
log(`end: 개발 로그 작업 시작 (${inputFile})`);
