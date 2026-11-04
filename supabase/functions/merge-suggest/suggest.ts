// dshs42.app — 분반별로 따로 올라온 같은 수행평가 찾기 (DB 를 건드리지 않는 순수 함수)
//
// 같은 과목 · 서로 다른 분반 · 비슷한 이름의 수행평가를 한 묶음으로 봅니다.
//   same      마감이 모두 같음 → 관리자에게 '전체 분반 공지로 합칠까요?' 제안
//   diff_due  이름은 같은데 마감이 분반마다 다름 → 보고만 (분반마다 수업 날이 달라 마감이 다른 경우가 많음)
//
// 분반마다 매주 같은 이름으로 올라오는 과제(예: 실험 보고서 제출)가 한 덩어리로 뭉치지 않도록,
// 마감이 가장 이른 것부터 WINDOW_DAYS 안의 것만, 분반마다 하나씩만 묶습니다.

export type Asg = {
  id: string; subject: string; ban: string | null; title: string; body: string;
  due_at: string | null; status: string; author_name: string | null;
};
export type Group = { kind: "same" | "diff_due"; subject: string; sig: string; title: string; items: Asg[] };

const DAY = 24 * 60 * 60 * 1000;
export const WINDOW_DAYS = 6;

// 비교용 이름: 분반 표시(A반 · (가반)) · 띄어쓰기 · 문장부호 · 대소문자를 뺍니다
export function norm(title: string): string {
  return title.toLowerCase()
    .replace(/[([]?\s*[a-z가-힣]\s*반\s*[)\]]?/gi, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function bigrams(s: string) {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
  return out;
}
// 같은 이름으로 볼지: 같거나, 한쪽이 다른 쪽을 품거나(4자 이상), 두 글자 묶음이 80% 이상 겹침
export function similar(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) return true;
  const bx = bigrams(x), by = bigrams(y);
  let common = 0;
  for (const [k, n] of bx) common += Math.min(n, by.get(k) ?? 0);
  const total = Math.max(1, x.length - 1) + Math.max(1, y.length - 1);
  return (2 * common) / total >= 0.8;
}

const dueMs = (a: Asg) => (a.due_at ? Date.parse(a.due_at) : null);

// 제안할 이름: 가장 많이 쓴 이름(같으면 긴 것)에서 분반 표시를 뺀 것
export function pickTitle(items: Asg[]): string {
  const count = new Map<string, number>();
  for (const a of items) count.set(a.title.trim(), (count.get(a.title.trim()) ?? 0) + 1);
  const best = [...count].sort((p, q) => q[1] - p[1] || q[0].length - p[0].length)[0][0];
  return best.replace(/\s*[([]\s*[A-Za-z가-힣]\s*반\s*[)\]]\s*/g, " ").replace(/(^|\s)[A-Za-z가-힣]반(\s|$)/g, " ")
    .replace(/\s+/g, " ").trim() || best;
}

export function findGroups(list: Asg[]): Group[] {
  // 분반 공지(ban 있음) · 승인됨 또는 대기 중만
  const pool = list.filter((a) => a.ban && (a.status === "approved" || a.status === "pending"))
    .sort((a, b) => (dueMs(a) ?? Infinity) - (dueMs(b) ?? Infinity) || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const groups: Group[] = [];
  for (const seed of pool) {
    if (used.has(seed.id)) continue;
    const start = dueMs(seed);
    const items = [seed];
    const bans = new Set([seed.ban]);
    for (const a of pool) {
      if (used.has(a.id) || a === seed || a.subject !== seed.subject || bans.has(a.ban)) continue;
      const d = dueMs(a);
      // 마감 없음은 마감 없음끼리만, 마감 있으면 첫 마감에서 WINDOW_DAYS 안
      if ((start === null) !== (d === null)) continue;
      if (start !== null && d !== null && d - start > WINDOW_DAYS * DAY) continue;
      if (!items.some((x) => similar(x.title, a.title))) continue;
      items.push(a);
      bans.add(a.ban);
    }
    if (items.length < 2) continue;
    for (const a of items) used.add(a.id);
    const dues = new Set(items.map((a) => a.due_at ? Date.parse(a.due_at) : "none"));
    groups.push({
      kind: dues.size === 1 ? "same" : "diff_due",
      subject: seed.subject,
      sig: items.map((a) => a.id).sort().join(","),
      title: pickTitle(items),
      items: items.sort((a, b) => (a.ban ?? "").localeCompare(b.ban ?? "", "ko")),
    });
  }
  return groups;
}
