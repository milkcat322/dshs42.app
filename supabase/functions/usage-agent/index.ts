// dshs42.app — 사용 분석 알림
// 분석 자체는 관리자 노트북의 Claude Code 가 합니다 (scripts/usage-agent). API 키는 쓰지 않습니다.
// save_usage_report() (usage.sql) 가 보고서를 저장한 뒤 { id } 로 이 함수를 불러, 관리자 기기에 짧게 푸시합니다.
//
// 배포:   supabase functions deploy usage-agent
// 비밀값: VAPID_* 는 send-reminders 와 같은 값
// service_role 키로만 부를 수 있습니다.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const KST = 9 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return new Response("service_role 키로만 부를 수 있어요", { status: 403 });
  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== "string") return new Response("id 가 필요해요", { status: 400 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  const { data: r, error } = await db.from("usage_reports").select("title, report, stats").eq("id", id).maybeSingle();
  if (error || !r) return new Response(error?.message ?? "보고서가 없어요", { status: 404 });

  const t = r.stats?.totals ?? {};
  const first = String(r.report?.summary ?? "").split(/(?<=[.다요])\s/)[0];
  const top = r.report?.suggestions?.[0]?.title;
  const body = [`최근 7일 로그인 학생 ${t.active_users_7d ?? "-"}명 · 가입 ${t.students ?? "-"}/${t.roster ?? "-"}명`, first,
    top ? `제안: ${top}` : ""].filter(Boolean).join("\n");

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
  const payload = JSON.stringify({
    title: r.title, body, tag: `usage:${new Date(Date.now() + KST).toISOString().slice(0, 10)}`, url: "/?view=admin&pane=use",
  });
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
  // 관리자 사이트 '알림' 칸에 남깁니다 (adminpush.sql)
  const logged = await db.from("admin_push_log").insert({
    source: "usage", title: r.title, body, url: "/?view=admin&pane=use", devices: sent + failed, delivered: sent,
  });
  if (logged.error) console.error("관리자 알림 기록 실패", logged.error.message);
  return new Response(JSON.stringify({ sent, failed }), { headers: { "Content-Type": "application/json" } });
});

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
