// 공부 탭 자료구조와 알고리즘 '코드 빈칸'(algo.html)의 문제 넣기.
//   node scripts/build-algo.mjs          기대 출력이 없는 테스트만 Compiler Explorer 로 돌려 algo.html 에 넣음
//   node scripts/build-algo.mjs --fresh  모든 테스트를 다시 돌림
// 문제 원본은 scripts/algo-problems.mjs, 돌린 결과는 scripts/algo-outputs.json 에 기억한다 (같은 코드 · 입력이면 다시 안 돌림).
// algo.html 은 중간고사 웹(dshs-algorithm.netlify.app)을 옮겨 온 페이지라, 이 스크립트는 그 안의 `const BUILTIN = [...]` 한 줄만 바꾼다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PROBLEMS } from "./algo-problems.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "algo.html");
const CACHE = path.join(ROOT, "scripts", "algo-outputs.json");
const fresh = process.argv.includes("--fresh");

// 빈칸을 모두 정답으로 채운 코드 (algo.html 의 fillCode 와 같은 규칙)
const BLOCK_RE = /^[ \t]*@@@(?:begin|fn!?)(?:[ \t]+\S+)?[ \t]*\n[\s\S]*?\n[ \t]*@@@code\n([\s\S]*?)\n[ \t]*@@@end[ \t]*(?:\n|$)/gm;
const refCode = (code) => code.replace(BLOCK_RE, (_, ref) => ref + "\n").replace(/@@([^\n]+?)@@/g, "$1");

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const key = (src, input) => crypto.createHash("sha1").update(src + "\0" + input).digest("hex").slice(0, 16);

async function run(source, stdin) {
  const comp = "g132";
  const res = await fetch(`https://godbolt.org/api/compiler/${comp}/compile`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      source, compiler: comp, lang: "c++", allowStoreCodeDebug: false,
      options: { userArguments: "-std=c++17 -O2", executeParameters: { args: [], stdin },
        compilerOptions: { executorRequest: true, skipAsm: true }, filters: { execute: true }, tools: [], libraries: [] },
    }),
  });
  if (!res.ok) throw new Error(`godbolt ${res.status}`);
  const j = await res.json();
  const build = j.buildResult || {};
  if (build.code !== 0 && !(build.code === undefined && j.didExecute)) throw new Error("컴파일 실패\n" + (build.stderr || []).map((l) => l.text).join("\n"));
  if (j.timedOut) throw new Error("시간 초과");
  if (j.code !== 0) throw new Error(`실행 오류 (exit ${j.code})\n` + (j.stderr || []).map((l) => l.text).join("\n"));
  const lines = (j.stdout || []).map((l) => l.text);
  return lines.join("\n") + (lines.length ? "\n" : "");
}

const out = [], used = new Set();
for (const p of PROBLEMS) {
  const src = refCode(p.code);
  const tests = [];
  for (const t of p.tests) {
    const k = key(src, t.in);
    used.add(k);
    if (fresh || cache[k] === undefined) {
      process.stdout.write(`${p.id} 테스트 ${tests.length + 1} 실행 … `);
      cache[k] = await run(src, t.in);
      console.log("ok");
    }
    tests.push({ in: t.in, out: cache[k] });
  }
  const { tests: _, ...rest } = p;
  out.push({ ...rest, tests });
}
for (const k of Object.keys(cache)) if (!used.has(k)) delete cache[k];   // 지금 문제에 없는 결과는 지움
fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1) + "\n");

let html = fs.readFileSync(HTML, "utf8");
const line = "const BUILTIN = " + JSON.stringify(out).replace(/<\/script/gi, "<\\/script") + ";";
if (!/^const BUILTIN = .*;$/m.test(html)) throw new Error("algo.html 에 const BUILTIN 줄이 없어요");
html = html.replace(/^const BUILTIN = .*;$/m, () => line);
fs.writeFileSync(HTML, html);
console.log(`algo.html: 문제 ${out.length}개`);
for (const p of out) console.log(`- ${p.id}: ${p.tests.map((t) => JSON.stringify(t.out.slice(0, 60))).join(" | ")}`);
