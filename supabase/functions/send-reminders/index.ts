// dshs.study — 수행평가 기한 알림 발송 Edge Function
// 승인된 공지 중 마감이 가까운 것을, 그 과목을 듣는 학생에게만 웹 푸시로 보냅니다.
// 같은 (공지, 사람, 단계) 조합은 reminder_log 때문에 두 번 가지 않습니다.
//
// 배포:   supabase functions deploy send-reminders
// 비밀값: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
// 실행:   아래 "주기 실행" 주석 참고 (10분마다)

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// D-3, D-1, 당일 — 마감까지 남은 시간(분) 기준 구간
const STAGES = [
  { kind: "d3", from: 3 * 24 * 60 - 30, to: 3 * 24 * 60 + 30, label: "3일 남았어요" },
  { kind: "d1", from: 24 * 60 - 30, to: 24 * 60 + 30, label: "내일까지예요" },
  { kind: "d0", from: 0, to: 6 * 60, label: "오늘 마감이에요" },
];

Deno.serve(async () => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@dshs.study",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  const now = Date.now();
  const horizon = new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString();

  // 앞으로 4일 안에 마감되는 승인된 공지
  const { data: items, error } = await admin
    .from("assignments")
    .select("id, subject, ban, title, due_at")
    .eq("status", "approved")
    .gte("due_at", new Date(now).toISOString())
    .lte("due_at", horizon);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, failed = 0, pruned = 0;

  for (const a of items ?? []) {
    const minsLeft = (new Date(a.due_at).getTime() - now) / 60000;
    const stage = STAGES.find((s) => minsLeft >= s.from && minsLeft <= s.to);
    if (!stage) continue;

    // 그 과목(분반이 정해져 있으면 그 분반)을 듣는 학생들
    let q = admin.from("enrollments").select("student_id").eq("subject", a.subject);
    if (a.ban) q = q.eq("ban", a.ban);
    const { data: enrolled } = await q;
    const studentIds = (enrolled ?? []).map((e) => e.student_id);
    if (!studentIds.length) continue;

    const { data: people } = await admin
      .from("profiles").select("id").in("student_id", studentIds);
    const userIds = (people ?? []).map((p) => p.id);
    if (!userIds.length) continue;

    // 이미 보낸 사람 제외
    const { data: already } = await admin
      .from("reminder_log").select("user_id")
      .eq("assignment_id", a.id).eq("kind", stage.kind);
    const done = new Set((already ?? []).map((r) => r.user_id));
    const targets = userIds.filter((id) => !done.has(id));
    if (!targets.length) continue;

    const { data: subs } = await admin
      .from("push_subscriptions").select("endpoint, p256dh, auth, user_id")
      .in("user_id", targets);

    const due = new Date(a.due_at).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul", month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

    const payload = JSON.stringify({
      title: `${a.subject}${a.ban ? ` ${a.ban}` : ""} 수행평가 ${stage.label}`,
      body: `${a.title}\n마감 ${due}`,
      tag: `${a.id}-${stage.kind}`,
      url: "/?view=assignments",
    });

    const reached = new Set<string>();
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        reached.add(s.user_id);
        sent++;
      } catch (err) {
        failed++;
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          pruned++;
        }
      }
    }

    if (reached.size) {
      await admin.from("reminder_log").insert(
        [...reached].map((user_id) => ({ assignment_id: a.id, user_id, kind: stage.kind })),
      );
    }
  }

  return new Response(JSON.stringify({ sent, failed, pruned }), {
    headers: { "Content-Type": "application/json" },
  });
});

/* ------------------------------------------------------------
   주기 실행 — SQL Editor 에서 한 번만 실행해 두면 10분마다 돌아갑니다.

   create extension if not exists pg_cron;
   create extension if not exists pg_net;

   select cron.schedule(
     'dshs-study-reminders', '0,10,20,30,40,50 * * * *',
     $$
     select net.http_post(
       url     := 'https://<프로젝트>.supabase.co/functions/v1/send-reminders',
       headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb
     );
     $$
   );
------------------------------------------------------------ */
