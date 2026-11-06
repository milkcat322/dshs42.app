// dshs42.app — 운영 점검 에이전트
// 매일 오전 8시 · 정오 · 오후 4시 · 오후 8시 · 자정에 서비스 상태(사이트 · cron · 서버 함수 호출 · 승인 대기)와 비로그인 → 로그인 전환을 점검하고,
// 지난 보고서 이후 들어온 피드백을 Claude 로 분류 · 요약합니다. 보고서는 ops_reports 에 남기고(관리자 사이트에는 화면 없음),
// 문제(issues)나 급한 피드백이 있을 때만 관리자에게 푸시합니다. 무엇을 쓸지는 report.ts 가 정합니다.
//
// 배포:   supabase functions deploy ops-agent
// 비밀값: ANTHROPIC_API_KEY (없으면 피드백은 개수만 알립니다) · VAPID_* 는 send-reminders 와 같은 값
// 실행:   ops.sql 맨 아래 "주기 실행" 주석 (매일 0 · 8 · 12 · 16 · 20시)
//         ?dry=1   저장 · 푸시 없이 보고서만 돌려줍니다 (확인용)
//         ?force=1 3시간 안에 보낸 보고서가 있어도 다시 보냅니다
// service_role 키로만 부를 수 있습니다.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import Anthropic from "npm:@anthropic-ai/sdk@1.4.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.4.0/helpers/zod";
import { z } from "npm:zod@4.6.7";
import {
  AI_SYSTEM, aiPrompt, buildReport, swVersion,
  type AiFeedback, type Feedback, type GuestLogin, type OpsSnapshot, type Site,
} from "./report.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const KST = 9 * HOUR;
const SITES = [
  { name: "dshs42.app", url: "https://dshs42.app/sw.js" },
  { name: "beta", url: "https://dshs42-beta.netlify.app/sw.js" },
];
const MAX_FEEDBACK = 30;      // 한 번에 분석하는 피드백 수
const KEEP_DAYS = 60;

const AiSchema = z.object({
  headline: z.string(),
  items: z.array(z.object({
    id: z.string(),
    category: z.enum(["bug", "notice", "idea", "etc"]),
    urgency: z.enum(["high", "normal", "low"]),
    area: z.string(),
    summary: z.string(),
    action: z.string(),
  })),
});

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return new Response("service_role 키로만 부를 수 있어요", { status: 403 });
  const q = new URL(req.url).searchParams;
  const dry = q.get("dry") === "1", force = q.get("force") === "1";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  const last = await db.from("ops_reports").select("created_at").order("created_at", { ascending: false }).limit(1);
  if (last.error) return new Response(last.error.message, { status: 500 });
  const lastAt = last.data[0] ? Date.parse(last.data[0].created_at) : null;
  if (!dry && !force && lastAt && now - lastAt < 3 * HOUR) return json({ skipped: "3시간 안에 보낸 보고서가 있어요" });
  const since = iso(lastAt ?? now - DAY);
  const yesterday = new Date(now + KST - DAY).toISOString().slice(0, 10);

  const [sites, ops, pending, feedback, visits, signups, admins, logins] = await Promise.all([
    Promise.all(SITES.map(checkSite)),
    db.rpc("ops_snapshot"),
    db.from("assignments").select("created_at").eq("status", "pending"),
    db.from("feedback").select("id, kind, body, created_at, user_id").gt("created_at", since)
      .order("created_at", { ascending: true }).limit(MAX_FEEDBACK),
    db.from("visits").select("logged_in").eq("day", yesterday),
    db.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", false).gt("created_at", since),
    db.from("profiles").select("id, name").eq("is_admin", true),
    db.rpc("ops_visit_logins", { p_since: since }),
  ]);
  for (const [name, r] of [["ops_snapshot", ops], ["assignments", pending], ["feedback", feedback],
    ["visits", visits], ["profiles", signups], ["admins", admins], ["ops_visit_logins", logins]] as const) {
    if (r.error) console.error(`${name} 조회 실패`, r.error.message);
  }
  const adminIds = (admins.data ?? []).map((a) => a.id);
  const subs = adminIds.length
    ? await db.from("push_subscriptions").select("endpoint, p256dh, auth, user_id").in("user_id", adminIds)
    : { data: [], error: null };
  if (subs.error) console.error("push_subscriptions 조회 실패", subs.error.message);

  // 관리자가 시험 삼아 보낸 피드백은 뺍니다
  const newFeedback: Feedback[] = (feedback.data ?? []).filter((f) => !adminIds.includes(f.user_id))
    .map(({ id, kind, body, created_at }) => ({ id, kind, body, created_at }));
  const { ai, aiError } = await analyze(newFeedback);

  const report = buildReport({
    now, sites,
    ops: ops.error ? null : ops.data as OpsSnapshot,
    pending: pending.data ?? [],
    newFeedback, ai, aiError,
    yesterday: visits.error ? null
      : { total: visits.data.length, logged_in: visits.data.filter((v) => v.logged_in).length },
    signups: signups.count ?? 0,
    adminsWithoutDevice: subs.error ? []
      : (admins.data ?? []).filter((a) => !subs.data!.some((s) => s.user_id === a.id)).map((a) => a.name),
    guestLogins: logins.error ? [] : (logins.data ?? []) as GuestLogin[],
  });
  if (dry) return json({ dry: true, report });

  const saved = await db.from("ops_reports").insert({
    issues: report.issues.length, title: report.title,
    report: { issues: report.issues, infos: report.infos, feedback: report.feedback, guestLogins: report.guestLogins },
  });
  if (saved.error) console.error("보고서 저장 실패", saved.error.message);
  await db.from("ops_reports").delete().lt("created_at", iso(now - KEEP_DAYS * DAY));

  // 푸시: 문제가 있거나 급한 피드백이 있을 때만 보냅니다 (이상 없으면 조용히 기록만. 관리자 사이트에는 점검 화면이 없습니다)
  const urgentFb = (report.feedback.items ?? []).filter((i) => i.urgency === "high").length;
  if (!report.issues.length && !urgentFb) {
    return json({ title: report.title, issues: 0, feedback: report.feedback.count, quiet: true });
  }
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@dshs.study",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  const payload = JSON.stringify({
    title: report.title, body: report.body, tag: `ops:${new Date(now + KST).toISOString().slice(0, 13)}`, url: "/?view=admin",
  });
  let sent = 0, failed = 0;
  await Promise.all((subs.data ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload, { TTL: 12 * 60 * 60, urgency: "normal" });
      sent++;
    } catch (err) {
      failed++;
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }));

  // 관리자 사이트 '알림' 칸에 남깁니다 (adminpush.sql). 60일 지난 기록은 지웁니다.
  const logged = await db.from("admin_push_log").insert({
    source: "ops", title: report.title, body: report.body, url: "/?view=admin", devices: sent + failed, delivered: sent,
  });
  if (logged.error) console.error("관리자 알림 기록 실패", logged.error.message);
  await db.from("admin_push_log").delete().lt("created_at", iso(now - 60 * DAY));

  return json({ title: report.title, issues: report.issues.length, feedback: report.feedback.count, sent, failed });
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

async function checkSite(s: { name: string; url: string }): Promise<Site> {
  try {
    const res = await fetch(`${s.url}?t=${Date.now()}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { name: s.name, version: null, error: `HTTP ${res.status}` };
    return { name: s.name, version: swVersion(await res.text()) ?? "버전 모름", error: null };
  } catch (err) {
    return { name: s.name, version: null, error: (err as Error).name === "TimeoutError" ? "10초 안에 응답 없음" : String(err).slice(0, 80) };
  }
}

// 새 피드백을 Claude 로 분류 · 요약합니다. 키가 없거나 실패하면 report.ts 가 개수만 씁니다.
async function analyze(list: Feedback[]): Promise<{ ai: AiFeedback | null; aiError: string | null }> {
  if (!list.length) return { ai: null, aiError: null };
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return { ai: null, aiError: "ANTHROPIC_API_KEY 가 없어 AI 요약을 건너뛰었어요" };
  try {
    const client = new Anthropic();
    const res = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(AiSchema) },
      system: AI_SYSTEM,
      messages: [{ role: "user", content: `지난 보고서 이후 들어온 피드백 ${list.length}건:\n${aiPrompt(list)}` }],
    });
    if (res.stop_reason === "refusal") return { ai: null, aiError: "AI 가 이번 피드백 분석을 거절했어요" };
    if (!res.parsed_output) return { ai: null, aiError: `AI 응답을 읽지 못했어요 (${res.stop_reason})` };
    return { ai: res.parsed_output, aiError: null };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ai: null, aiError: "ANTHROPIC_API_KEY 가 올바르지 않아요" };
    if (err instanceof Anthropic.RateLimitError) return { ai: null, aiError: "AI 사용 한도에 걸렸어요" };
    if (err instanceof Anthropic.APIError) return { ai: null, aiError: `AI 오류 ${err.status}` };
    return { ai: null, aiError: `AI 호출 실패: ${String(err).slice(0, 80)}` };
  }
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}
