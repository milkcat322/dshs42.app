// dshs42.app — 개발 소식 알림 (관리자끼리)
// push 할 때 DEVLOG 요약기가 세션 기록 끝에 <!-- news: 줄 | 줄 --> 을 남깁니다 (.claude/hooks/devlog-worker.mjs).
// 이 함수는 10분마다(devnews.sql 의 cron) beta 에 올라간 DEVLOG.md 를 읽어, 새로 생기거나 바뀐 소식을
// dev_news 에 남기고 관리자 기기에 푸시합니다 (누르면 관리자 사이트 '제안' 칸). 바뀐 소식은 새 줄만 알립니다.
// 예전 기록에는 news 줄이 없어서, 처음 실행해도 지난 소식이 한꺼번에 오지 않습니다.
//
// 배포:   supabase functions deploy dev-news
// 비밀값: VAPID_* 는 send-reminders 와 같은 값
// service_role 키로만 부를 수 있습니다. 확인용 ?dry=1 (저장 · 푸시 없음)

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { parseNews, newLines } from "./parse.ts";

const DEVLOG_URL = "https://dshs42-beta.netlify.app/DEVLOG.md";
const URL_PANE = "/?view=admin&pane=dev";

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return new Response("service_role 키로만 부를 수 있어요", { status: 403 });
  const dry = new URL(req.url).searchParams.has("dry");

  const res = await fetch(`${DEVLOG_URL}?t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } });
  if (!res.ok) return new Response(`DEVLOG 를 읽지 못했어요 (${res.status})`, { status: 502 });
  const entries = parseNews(await res.text());

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  const { data: rows, error } = await db.from("dev_news").select("session, news");
  if (error) return new Response(error.message, { status: 500 });
  const prev = new Map((rows ?? []).map((r) => [r.session, r.news as string]));

  const changed = entries.filter((e) => prev.get(e.session) !== e.news);
  const fresh = changed
    .map((e) => ({ e, lines: newLines(prev.get(e.session), e.news) }))
    .filter((x) => x.lines.length);
  if (dry) return json({ entries: entries.length, changed: changed.length, notify: fresh });

  if (changed.length) {
    const { error: upErr } = await db.from("dev_news").upsert(changed.map((e) => ({
      session: e.session, dev: e.dev, title: e.title, news: e.news, day: e.day, updated_at: new Date().toISOString(),
    })));
    if (upErr) return new Response(upErr.message, { status: 500 });
  }
  if (!fresh.length) return json({ entries: entries.length, changed: changed.length, sent: 0 });

  const devs = [...new Set(fresh.map((x) => x.e.dev).filter(Boolean))];
  const title = `🛠 ${devs.length === 1 ? `${devs[0]} ` : ""}개발 소식`;
  const body = fresh.flatMap((x) => x.lines.map((l) => `• ${devs.length > 1 ? `${x.e.dev}: ` : ""}${l}`)).slice(0, 6).join("\n");

  const { data: admins } = await db.from("profiles").select("id").eq("is_admin", true);
  const ids = (admins ?? []).map((a) => a.id);
  const { data: subs } = ids.length
    ? await db.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", ids)
    : { data: [] };
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@dshs.study",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  const payload = JSON.stringify({ title, body, tag: `dev:${fresh[0].e.session}`, url: URL_PANE });
  let sent = 0, failed = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload, { TTL: 12 * 60 * 60, urgency: "low" });
      sent++;
    } catch (err) {
      failed++;
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }));
  // 관리자 알림 기록 (adminpush.sql)
  const logged = await db.from("admin_push_log").insert({
    source: "dev", title, body, url: URL_PANE, devices: sent + failed, delivered: sent,
  });
  if (logged.error) console.error("관리자 알림 기록 실패", logged.error.message);
  return json({ entries: entries.length, changed: changed.length, sent, failed });
});

const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { "Content-Type": "application/json" } });

// verify_jwt 를 통과한 토큰 중 service_role 만 받습니다
function isServiceRole(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part)).role === "service_role";
  } catch {
    return false;
  }
}
