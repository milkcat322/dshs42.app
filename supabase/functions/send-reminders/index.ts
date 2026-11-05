// dshs42.app — 알림 발송 Edge Function
// 수행평가 기한 · 내 일정 · 필수 학교 일정 알림과 관리자용 새 활동 알림을 웹 푸시로 보냅니다.
// 누구에게 무엇을 보낼지는 plan.ts 가 정하고, 여기서는 불러오고 보내고 기록만 합니다.
// 같은 (사람, 알림) 조합은 notify_log 때문에 두 번 가지 않습니다.
//
// 배포:   supabase functions deploy send-reminders
// 비밀값: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
// 실행:   아래 "주기 실행" 주석 참고 (1분마다)

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { adminKey, planAdminNote, planNotes, type AdminItem } from "./plan.ts";

const DAY = 24 * 60 * 60 * 1000;
const LOG_KEEP_DAYS = 3;
const ADMIN_LOOKBACK = 10 * 60 * 1000;   // 크론이 밀려도 놓치지 않게 넉넉히 봅니다 (이미 보낸 건 notify_log 로 거릅니다)

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

  const asgColumns = "id, subject, ban, title, due_at, status, created_by";
  const [users, assignments, personal, asgDone, events, members, school] = await Promise.all([
    admin.from("profiles").select("id, student_id, is_admin").in("id", userIds),
    admin.from("assignments").select(asgColumns)
      .in("status", ["approved", "pending"]).gt("due_at", iso(now)).lte("due_at", iso(now + DAY)),
    admin.from("assignment_personal").select("user_id, assignment_id, title, due_at, no_due").in("user_id", userIds),
    admin.from("assignment_done").select("user_id, assignment_id").in("user_id", userIds),
    admin.from("events").select("id, user_id, title, starts_at, all_day, done")
      .gte("starts_at", iso(now - DAY)).lte("starts_at", iso(now + DAY)),
    admin.from("event_members").select("event_id, user_id, done").in("user_id", userIds),
    admin.from("school_events")
      .select("id, title, starts_at, ends_at, all_day, notify, audience, school_event_targets(student_id)"),
  ]);
  const failedQuery = [users, assignments, personal, asgDone, events, members, school].find((r) => r.error);
  if (failedQuery) return new Response(failedQuery.error!.message, { status: 500 });

  // 공지 마감은 멀어도 내 계정에서 고친 마감이 가까운 수행평가를 더합니다
  const near = new Set(assignments.data!.map((a) => a.id));
  const movedIds = [...new Set(personal.data!
    .filter((p) => p.due_at && Date.parse(p.due_at) > now && Date.parse(p.due_at) <= now + DAY && !near.has(p.assignment_id))
    .map((p) => p.assignment_id))];
  const moved = movedIds.length
    ? await admin.from("assignments").select(asgColumns).eq("status", "approved").in("id", movedIds)
    : { data: [], error: null };
  if (moved.error) return new Response(moved.error.message, { status: 500 });

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
    assignments: [...assignments.data!, ...moved.data!], asgDone: asgDone.data!, personal: personal.data!,
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

  // 관리자 새 활동 알림. 실패해도 학생 알림은 그대로 보냅니다.
  const admins = users.data!.filter((u) => u.is_admin).map((u) => u.id);
  if (admins.length) {
    const since = iso(now - ADMIN_LOOKBACK);
    const [joined, asked, feedback] = await Promise.all([
      admin.from("profiles").select("id, name, student_id").eq("is_admin", false).gte("created_at", since),
      admin.from("assignments").select("id, author_name").eq("status", "pending").gte("created_at", since),
      admin.from("feedback").select("id, user_id, profiles(name)").gte("created_at", since),
    ]);
    const failed = [joined, asked, feedback].find((r) => r.error);
    if (failed) console.error("관리자 알림 조회 실패", failed.error!.message);
    else {
      const items: AdminItem[] = [
        ...joined.data!.map((p) => ({ kind: "signup" as const, id: p.id, who: p.name })),
        ...asked.data!.map((a) => ({ kind: "assignment" as const, id: a.id, who: a.author_name ?? "학생" })),
        ...feedback.data!.filter((f) => !admins.includes(f.user_id))
          .map((f) => ({ kind: "feedback" as const, id: f.id, who: (f.profiles as unknown as { name: string } | null)?.name ?? "학생" })),
      ];
      const { data: logged, error } = items.length
        ? await admin.from("notify_log").select("user_id, key").in("key", items.map(adminKey)).in("user_id", admins)
        : { data: [], error: null };
      if (error) console.error("관리자 알림 기록 조회 실패", error.message);
      else {
        const seen = new Set(logged!.map((r) => `${r.user_id}|${r.key}`));
        for (const id of admins) {
          const note = planAdminNote(id, items.filter((i) => !seen.has(`${id}|${adminKey(i)}`)));
          if (note) notes.push(note);
        }
      }
    }
  }

  const gone = new Set<string>();
  const adminSent: { title: string; body: string; url: string; devices: number; delivered: number }[] = [];
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
      await admin.from("notify_log").upsert(
        (n.logKeys ?? [n.key]).map((key) => ({ user_id: n.userId, key })), { ignoreDuplicates: true });
    }
    if (admins.includes(n.userId)) {
      adminSent.push({ title: n.title, body: n.body, url: n.url, devices: devices.length, delivered: results.filter(Boolean).length });
    }
  }));

  // 관리자에게 간 새 활동 알림을 관리자 사이트 '알림' 칸에 남깁니다 (adminpush.sql). 같은 내용은 한 줄로 묶습니다.
  if (adminSent.length) {
    const rows = new Map<string, { source: string; title: string; body: string; url: string; devices: number; delivered: number }>();
    for (const a of adminSent) {
      const k = `${a.title}\n${a.body}`;
      const r = rows.get(k) ?? { source: "activity", title: a.title, body: a.body, url: a.url, devices: 0, delivered: 0 };
      r.devices += a.devices; r.delivered += a.delivered;
      rows.set(k, r);
    }
    const { error } = await admin.from("admin_push_log").insert([...rows.values()]);
    if (error) console.error("관리자 알림 기록 실패", error.message);
  }

  await admin.from("notify_log").delete().lt("sent_at", iso(now - LOG_KEEP_DAYS * DAY));

  return json({ sent, failed, pruned });
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

/* ------------------------------------------------------------
   주기 실행 — SQL Editor 에서 한 번만 실행해 두면 1분마다 돌아갑니다.

   create extension if not exists pg_cron;
   create extension if not exists pg_net;

   select cron.schedule(
     'dshs-study-reminders', '* * * * *',
     $$
     select net.http_post(
       url     := 'https://<프로젝트>.supabase.co/functions/v1/send-reminders',
       headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb
     );
     $$
   );
------------------------------------------------------------ */
