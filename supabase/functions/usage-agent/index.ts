// dshs42.app — 사용 분석 에이전트
// 매일 22시(한국 시간)에 최근 14일의 방문 · 로그인 · 기능 사용 수치를 모아 Claude 가
// 로그인 / 비로그인 현황, 전반적 사용 양상, 업데이트에 대한 반응을 분석하고 다음에 고칠 방향을 제안합니다.
// 보고서는 usage_reports 에 남아 관리 탭 '분석' 칸에서 보고, 관리자 기기에 짧게 푸시합니다.
// 무엇을 보낼지는 analyze.ts 가 정합니다. Claude 에는 수만 보냅니다 (이름 · 학번 · 내용 없음).
//
// 배포:   supabase functions deploy usage-agent
// 비밀값: ANTHROPIC_API_KEY (없으면 수치만 남깁니다) · VAPID_* 는 send-reminders 와 같은 값
// 실행:   usage.sql 맨 아래 "주기 실행" 주석 (매일 22시)
//         ?dry=1   저장 · 푸시 없이 분석만 돌려줍니다 (확인용)
//         ?nopush=1 저장만 하고 푸시는 보내지 않습니다
// service_role 키로만 부를 수 있습니다. 분석이 1~2분 걸려 저장 · 푸시는 응답 뒤에 이어서 합니다.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import Anthropic from "npm:@anthropic-ai/sdk@1.4.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.4.0/helpers/zod";
import { z } from "npm:zod@4.6.7";
import {
  AI_SYSTEM, CHANGES, aiPrompt, derive, parseUpdates, pushBody, titleOf,
  type AiUsage, type Snapshot, type UpdateNote,
} from "./analyze.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const DAY = 24 * 60 * 60 * 1000;
const KST = 9 * 60 * 60 * 1000;
const DAYS = 14;
const KEEP_DAYS = 90;
const UPDATE_URLS = ["https://dshs42-beta.netlify.app/updates.js", "https://dshs42.app/updates.js"];

const AiSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  login: z.string(),
  usage: z.string(),
  updates: z.array(z.object({
    title: z.string(),
    reaction: z.string(),
    verdict: z.enum(["good", "mixed", "none", "unknown"]),
  })),
  suggestions: z.array(z.object({
    title: z.string(),
    why: z.string(),
    goal: z.enum(["login", "convenience", "both"]),
    effort: z.enum(["low", "mid", "high"]),
  })),
  watch: z.array(z.string()),
  caveats: z.string(),
});

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return new Response("service_role 키로만 부를 수 있어요", { status: 403 });
  const q = new URL(req.url).searchParams;
  const dry = q.get("dry") === "1", noPush = q.get("nopush") === "1";
  const work = run(dry, noPush);
  if (dry) return json(await work);
  EdgeRuntime.waitUntil(work.catch((err) => console.error("사용 분석 실패", err)));
  return json({ started: true });
});

async function run(dry: boolean, noPush: boolean) {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  const now = Date.now();

  const [snap, prev, updates] = await Promise.all([
    db.rpc("usage_snapshot", { p_days: DAYS }),
    db.from("usage_reports").select("created_at, report").order("created_at", { ascending: false }).limit(1),
    loadUpdates(),
  ]);
  if (snap.error) throw new Error(`usage_snapshot 실패: ${snap.error.message}`);
  const snapshot = snap.data as Snapshot;
  const p = prev.data?.[0];
  const previous = p?.report ? {
    at: p.created_at, headline: p.report.headline,
    suggestions: (p.report.suggestions ?? []).map((s: { title: string }) => s.title),
  } : null;

  const { ai, aiError } = await analyze(aiPrompt({ snapshot, updates, changes: CHANGES, previous }));
  const title = titleOf(snapshot, ai);
  const stats = { ...snapshot, derived: derive(snapshot), updates, ai_error: aiError };
  if (dry) return { dry: true, title, report: ai, aiError, derived: stats.derived };

  const saved = await db.from("usage_reports").insert({ title, report: ai, stats });
  if (saved.error) console.error("보고서 저장 실패", saved.error.message);
  await db.from("usage_reports").delete().lt("created_at", new Date(now - KEEP_DAYS * DAY).toISOString());
  if (noPush) return { title, saved: !saved.error };

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
    title, body: pushBody(snapshot, ai, aiError),
    tag: `usage:${new Date(now + KST).toISOString().slice(0, 10)}`, url: "/?view=admin&pane=use",
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
  console.log("사용 분석 완료", { title, sent, failed });
  return { title, sent, failed };
}

async function loadUpdates(): Promise<UpdateNote[]> {
  for (const url of UPDATE_URLS) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return parseUpdates(await res.text());
    } catch { /* 다음 주소 */ }
  }
  return [];
}

async function analyze(prompt: string): Promise<{ ai: AiUsage | null; aiError: string | null }> {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return { ai: null, aiError: "ANTHROPIC_API_KEY 가 없어 수치만 남겼어요" };
  try {
    const client = new Anthropic();
    const res = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(AiSchema) },
      system: AI_SYSTEM,
      messages: [{ role: "user", content: `오늘의 사용 데이터:\n${prompt}` }],
    });
    if (res.stop_reason === "refusal") return { ai: null, aiError: "AI 가 이번 분석을 거절했어요" };
    if (!res.parsed_output) return { ai: null, aiError: `AI 응답을 읽지 못했어요 (${res.stop_reason})` };
    return { ai: res.parsed_output, aiError: null };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ai: null, aiError: "ANTHROPIC_API_KEY 가 올바르지 않아요" };
    if (err instanceof Anthropic.RateLimitError) return { ai: null, aiError: "AI 사용 한도에 걸렸어요" };
    if (err instanceof Anthropic.APIError) return { ai: null, aiError: `AI 오류 ${err.status}` };
    return { ai: null, aiError: `AI 호출 실패: ${String(err).slice(0, 80)}` };
  }
}

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

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}
