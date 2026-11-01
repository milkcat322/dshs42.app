// 대전과학고 학사일정을 NEIS 교육정보 개방 포털에서 받아 academic.json 으로 저장합니다.
// 학교 홈페이지의 학사일정도 NEIS 에서 가져온 것이라 내용이 같습니다.
// GitHub Actions(.github/workflows/academic.yml)가 매일 실행하고, 바뀐 게 있을 때만 커밋합니다.
//
// 실행:   node scripts/fetch-academic.mjs
// 인증키: NEIS_KEY 환경 변수 (선택). 없으면 한 번에 5건밖에 못 받아서 기간을 잘게 나눠 여러 번 받습니다.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'academic.json');
const API = 'https://open.neis.go.kr/hub/SchoolSchedule';
const SCHOOL = { ATPT_OFCDC_SC_CODE: 'G10', SD_SCHUL_CODE: '7430032' };   // 대전광역시교육청 · 대전과학고등학교
const KEY = process.env.NEIS_KEY || '';
const NO_KEY_LIMIT = 5;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

async function query(from, to, pIndex = 1) {
  const params = new URLSearchParams({
    Type: 'json', pIndex, pSize: KEY ? 1000 : NO_KEY_LIMIT, ...SCHOOL,
    AA_FROM_YMD: ymd(from), AA_TO_YMD: ymd(to), ...(KEY && { KEY }),
  });
  for (let tries = 0; ; tries++) {
    try {
      const res = await fetch(`${API}?${params}`);
      const body = await res.json();
      if (!body.SchoolSchedule) {
        if (body.RESULT?.CODE === 'INFO-200') return { total: 0, rows: [] };   // 해당 기간 일정 없음
        throw new Error(body.RESULT?.MESSAGE || `HTTP ${res.status}`);
      }
      const [head, data] = body.SchoolSchedule;
      return { total: head.head[0].list_total_count, rows: data.row };
    } catch (err) {
      if (tries >= 3) throw err;
      await new Promise((ok) => setTimeout(ok, 1000 * (tries + 1)));
    }
  }
}

async function fetchRange(from, to) {
  if (KEY) {
    const rows = [];
    for (let p = 1; ; p++) {
      const r = await query(from, to, p);
      rows.push(...r.rows);
      if (rows.length >= r.total || !r.rows.length) return rows;
    }
  }
  // 인증키가 없으면 3일씩, 그 안에 5건이 넘으면 하루씩 받습니다
  const rows = [];
  for (let d = from; d <= to; d = addDays(d, 3)) {
    const end = addDays(d, 2) < to ? addDays(d, 2) : to;
    const r = await query(d, end);
    if (r.total <= NO_KEY_LIMIT) { rows.push(...r.rows); continue; }
    for (let day = d; day <= end; day = addDays(day, 1)) {
      const one = await query(day, day);
      if (one.total > NO_KEY_LIMIT) console.warn(`${ymd(day)}: 일정 ${one.total}건 중 ${NO_KEY_LIMIT}건만 받음 (NEIS_KEY 필요)`);
      rows.push(...one.rows);
    }
  }
  return rows;
}

// 같은 이름·같은 대상 학년의 일정이 날짜가 이어지면 하나로 합칩니다 (예: 겨울방학 59일 → 한 줄)
function merge(rows) {
  const groups = new Map();
  for (const r of rows) {
    const grades = [r.ONE_GRADE_EVENT_YN, r.TW_GRADE_EVENT_YN, r.THREE_GRADE_EVENT_YN]
      .flatMap((yn, i) => (yn === 'Y' ? [i + 1] : []));
    const ev = { name: r.EVENT_NM.trim(), type: r.SBTR_DD_SC_NM, grades, memo: (r.EVENT_CNTNT || '').trim() };
    const key = JSON.stringify(ev);
    if (!groups.has(key)) groups.set(key, { ev, days: new Set() });
    groups.get(key).days.add(iso(r.AA_YMD));
  }
  const out = [];
  for (const { ev, days } of groups.values()) {
    const sorted = [...days].sort();
    let start = sorted[0], prev = sorted[0];
    for (const day of [...sorted.slice(1), null]) {
      const next = new Date(`${prev}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      if (day && day === next.toISOString().slice(0, 10)) { prev = day; continue; }
      out.push({ ...ev, start, end: prev });
      start = prev = day;
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

// 이번 학년도(3월~다음 해 2월)와 다음 학년도를 받습니다
const now = new Date();
const ay = now.getMonth() + 1 >= 3 ? now.getFullYear() : now.getFullYear() - 1;
const from = new Date(ay, 2, 1), to = new Date(ay + 2, 1, 28);
const events = merge(await fetchRange(from, to));
if (!events.length) throw new Error('받은 학사일정이 없어요. 학교 코드나 NEIS 응답을 확인해 주세요.');

// 내용이 같으면 파일을 건드리지 않습니다 (날짜만 바뀐 커밋이 매일 생기지 않게)
let prev = null;
try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch {}
if (prev && JSON.stringify(prev.events) === JSON.stringify(events)) {
  console.log(`변경 없음 (${events.length}건)`);
} else {
  const body = { source: 'NEIS 교육정보 개방 포털 · 대전과학고등학교 학사일정', updated: new Date().toISOString(), events };
  writeFileSync(OUT, `${JSON.stringify(body, null, 1)}\n`);
  console.log(`academic.json 저장 (${events.length}건)`);
}
