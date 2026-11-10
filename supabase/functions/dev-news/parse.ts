// DEVLOG.md 에서 세션마다 개발 소식을 꺼냅니다 (순수 함수 — 네트워크 · DB 없이 테스트할 수 있게).
// 세션 기록:  ## 2026-11-10 13:21–14:00 · 제목
//             `session abcd1234` · 개발 sxcrxta · 요청 3회
//             ...
//             <!-- news: 줄 | 줄 -->

// git 사용자 이름 → 관리자 이름 (모르는 이름은 그대로)
export const DEV_NAMES: Record<string, string> = { sxcrxta: "반민지", milkcat322: "진주빈" };

export type News = { session: string; dev: string; title: string; news: string; day: string | null };

export function parseNews(text: string): News[] {
  const out = new Map<string, News>();   // 같은 세션이 두 번 있으면 뒤의 것
  for (const e of text.split(/^(?=## )/m)) {
    const sid = e.match(/`session (\w+)`/)?.[1];
    const news = e.match(/<!-- news: (.*?) -->/)?.[1]?.trim();
    if (!sid || !news) continue;
    const head = e.match(/^## (.*)$/m)?.[1] ?? "";
    const git = e.match(/`session \w+` · 개발 (\S+)/)?.[1] ?? "";
    out.delete(sid);
    out.set(sid, {
      session: sid,
      dev: DEV_NAMES[git] ?? git,
      title: head.split(" · ").slice(1).join(" · ").trim(),
      news,
      day: head.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
    });
  }
  return [...out.values()];
}

// 이전 소식에 없던 줄만 (같은 세션을 이어서 push 하면 새로 생긴 줄만 알림)
export function newLines(prev: string | undefined, next: string): string[] {
  const old = new Set((prev ?? "").split(" | ").map((l) => l.trim()));
  return next.split(" | ").map((l) => l.trim()).filter((l) => l && !old.has(l));
}
