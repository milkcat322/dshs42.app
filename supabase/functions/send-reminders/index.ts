// dshs.study — 알림 발송 Edge Function
// 수행평가 기한 · 내 일정 · 필수 학교 일정 알림을 웹 푸시로 보냅니다.
// 누구에게 무엇을 보낼지는 plan.ts 가 정하고, 여기서는 불러오고 보내고 기록만 합니다.
// 같은 (사람, 알림) 조합은 notify_log 때문에 두 번 가지 않습니다.
//
// 배포:   supabase functions deploy send-reminders
// 비밀값: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
// 실행:   아래 "주기 실행" 주석 참고 (5분마다)

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { planNotes } from "./plan.ts";

const DAY = 24 * 60 * 60 * 1000;
const LOG_KEEP_DAYS = 3;

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
  const iso = (ms: number) => new Date(ms).toISOString();

  // 알림을 켠 기기가 없으면 할 일이 없습니다
  const { data: subs, error: subsErr } = await admin
    .from("push_subscriptions").select("endpoint, p256dh, auth, user_id");
  if (subsErr) return new Response(subsErr.message, { status: 500 });
  if (!subs?.length) return json({ sent: 0, failed: 0, pruned: 0 });
  const userIds = [...new Set(subs.map((s) => s.user_id))];

  const [users, assignments, asgDone, events, members, school] = await Promise.all([
    admin.from("profiles").select("id, student_id").in("id", userIds),
    admin.from("assignments").select("id, subject, ban, title, due_at, status, created_by")
      .in("status", ["approved", "pending"]).gt("due_at", iso(now)).lte("due_at", iso(now + DAY)),
    admin.from("assignment_done").select("user_id, assignment_id").in("user_id", userIds),
    admin.from("events").select("id, user_id, title, starts_at, all_day, done")
      .gte("starts_at", iso(now - DAY)).lte("starts_at", iso(now + DAY)),
    admin.from("event_members").select("event_id, user_id, done").in("user_id", userIds),
    admin.from("school_events")
      .select("id, title, starts_at, ends_at, all_day, notify, audience, school_event_targets(student_id)"),
  ]);
  const failedQuery = [users, assignments, asgDone, events, members, school].find((r) => r.error);
  if (failedQuery) return new Response(failedQuery.error!.message, { status: 500 });

  // 수강 정보는 1000행을 넘을 수 있어서 나눠서 받습니다
  const studentIds = users.data!.map((u) => u.student_id).filter((id) => id !== null);
  const enrollments = [];
  for (let from = 0; studentIds.length; from += 1000) {
    const { data, error } = await admin.from("enrollments").select("student_id, subject, ban")
      .in("student_id", studentIds).order("student_id").order("subject").range(from, from + 999);
    if (error) return new Response(error.message, { status: 500 });
    enrollments.push(...data);
    if (data.length < 1000) break;
  }

  const planned = planNotes(now, {
    users: users.data!, enrollments,
    assignments: assignments.data!, asgDone: asgDone.data!,
    events: events.data!, members: members.data!, school: school.data!,
  });

  let sent = 0, failed = 0, pruned = 0;

  // 이미 보낸 알림 제외
  const keys = [...new Set(planned.map((n) => n.key))];
  const already = new Set<string>();
  if (keys.length) {
    const { data, error } = await admin.from("notify_log").select("user_id, key").in("key", keys);
    if (error) return new Response(error.message, { status: 500 });
    for (const r of data) already.add(`${r.user_id}|${r.key}`);
  }
  const notes = planned.filter((n) => !already.has(`${n.userId}|${n.key}`));

  const gone = new Set<string>();
  await Promise.all(notes.map(async (n) => {
    const payload = JSON.stringify({ title: n.title, body: n.body, tag: n.key, url: n.url });
    const devices = subs.filter((s) => s.user_id === n.userId && !gone.has(s.endpoint));
    const results = await Promise.all(devices.map(async (s) => {
      try {
        // 시작이 지나면 받아도 소용없으므로 그때까지만 재시도하게 합니다
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: n.ttl, urgency: "high" },
        );
        sent++;
        return true;
      } catch (err) {
        failed++;
        const code = (err as { statusCode?: number }).statusCode;
        if ((code === 404 || code === 410) && !gone.has(s.endpoint)) {
          gone.add(s.endpoint);
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          pruned++;
        }
        return false;
      }
    }));
    if (results.some(Boolean)) {
      await admin.from("notify_log").upsert({ user_id: n.userId, key: n.key }, { ignoreDuplicates: true });
    }
  }));

  await admin.from("notify_log").delete().lt("sent_at", iso(now - LOG_KEEP_DAYS * DAY));

  return json({ sent, failed, pruned });
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

/* ------------------------------------------------------------
   주기 실행 — SQL Editor 에서 한 번만 실행해 두면 5분마다 돌아갑니다.

   create extension if not exists pg_cron;
   create extension if not exists pg_net;

   select cron.schedule(
     'dshs-study-reminders', '*/5 * * * *',
     $$
     select net.http_post(
       url     := 'https://<프로젝트>.supabase.co/functions/v1/send-reminders',
       headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb
     );
     $$
   );
------------------------------------------------------------ */
