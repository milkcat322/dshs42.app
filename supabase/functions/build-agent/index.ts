// dshs42.app — Claude 제작 맡기기의 노트북 창구 (agenttasks.sql · scripts/build-agent)
// 관리자 노트북의 run.mjs 가 x-agent-token 헤더로 부릅니다. 열쇠는 sha256 으로 agent_keys 와 비교합니다.
//
//   { action: "peek" }                       할 일 수 (approved · revise · accepted)
//   { action: "claim", defer? }              가장 오래된 할 일 하나를 집어 building(제작) 또는 그대로(accepted) 돌려줌
//   { action: "usage_last" }                 가장 최근 사용 분석 저장 시각 (usage-agent 가 이미 했는지 확인)
//   { action: "report", id, status, release?, ... }    결과 저장 (release: 한도 초과로 대기로 되돌림). review · merged · failed · needs_human 이면 관리자에게 푸시
//   버린(rejected) 작업에 브랜치가 남아 있으면 claim 이 job: "cleanup" 으로 돌려주고, 노트북이 브랜치를 지운 뒤 branch: "" 로 report 합니다.
//
// 배포:   supabase functions deploy build-agent --no-verify-jwt   (열쇠로 직접 확인)
// 비밀값: VAPID_* 는 send-reminders 와 같은 값

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const MAX_ROUNDS = 3;
const NOTIFY: Record<string, string> = {
  review: "미리보기 준비됨", merged: "beta 에 반영됨", failed: "제작 실패", needs_human: "사람 손이 필요해요",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } });
const json = (x: unknown, status = 200) =>
  new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST" || !(await keyOk(req.headers.get("x-agent-token") ?? ""))) return json({ error: "forbidden" }, 403);
  const b = await req.json().catch(() => ({}));

  if (b.action === "peek") {
    const { data, error } = await db.from("agent_tasks").select("status").in("status", ["approved", "revise", "accepted", "building"]);
    if (error) return json({ error: error.message }, 500);
    const n = (s: string) => data.filter((x) => x.status === s).length;
    return json({ build: n("approved") + n("revise"), merge: n("accepted"), building: n("building") });
  }

  if (b.action === "usage_last") {
    // 사용 분석: 가장 최근에 저장된 분석 시각 (노트북 두 대가 같은 밤 분석을 두 번 하지 않게)
    const { data, error } = await db.from("usage_reports").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({ last: data?.created_at ?? null });
  }

  if (b.action === "claim") {
    // 최종 승인(합치기)을 먼저, 그다음 제작. 다른 실행과 겹치지 않게 상태가 그대로일 때만 바꿉니다.
    // defer(분): 보조 노트북은 그만큼 기다린 일만 가져갑니다 (우선 노트북이 켜져 있으면 먼저 가져가므로).
    // 합치기는 상태가 accepted 그대로라, 가져갈 때 updated_at 을 새로 찍어 2분 동안 다른 노트북이 다시 가져가지 않게 합니다.
    const defer = Math.min(Math.max(Number(b.defer) || 0, 0), 180);
    for (const status of ["accepted", "approved", "revise"]) {
      const wait = status === "accepted" ? Math.max(defer, 2) : defer;
      const { data: t } = await db.from("agent_tasks").select("*").eq("status", status)
        .lte("updated_at", new Date(Date.now() - wait * 60e3).toISOString())
        .order("updated_at", { ascending: true }).limit(1).maybeSingle();
      if (!t) continue;
      if (status === "accepted") {
        const { data: got } = await db.from("agent_tasks").update({ error: t.error })
          .eq("id", t.id).eq("status", "accepted").eq("updated_at", t.updated_at).select("*").maybeSingle();
        if (got) return json({ task: got, job: "merge" });
        continue;
      }
      if (t.rounds >= MAX_ROUNDS) {
        await db.from("agent_tasks").update({ status: "needs_human", error: `제작을 ${MAX_ROUNDS}번 해서 멈췄어요` }).eq("id", t.id);
        continue;
      }
      const { data: got } = await db.from("agent_tasks")
        .update({ status: "building", rounds: t.rounds + 1, error: null })
        .eq("id", t.id).eq("status", status).select("*").maybeSingle();
      if (got) return json({ task: got, job: status === "revise" ? "revise" : "build" });
    }
    const { data: old } = await db.from("agent_tasks").select("*").eq("status", "rejected").not("branch", "is", null).neq("branch", "")
      .limit(1).maybeSingle();
    if (old) return json({ task: old, job: "cleanup" });
    return json({ task: null });
  }

  if (b.action === "report") {
    const ok = ["building", "review", "merged", "failed", "needs_human", "approved", "revise", "accepted", "rejected"];
    if (typeof b.id !== "string" || !ok.includes(b.status)) return json({ error: "bad report" }, 400);
    const patch: Record<string, unknown> = { status: b.status };
    for (const k of ["branch", "preview_url", "summary", "error"]) if (typeof b[k] === "string") patch[k] = b[k].slice(0, 4000);
    // 제작 중에 관리자가 버렸으면(rejected) 결과로 덮어쓰지 않고, 브랜치만 남겨 다음 claim 에서 지우게 합니다
    // release: 노트북 계정의 한도 초과로 제작을 못 했을 때 대기(approved · revise)로 되돌림 → 제작 횟수(rounds)도 하나 되돌립니다
    if (b.release === true && (b.status === "approved" || b.status === "revise")) {
      const { data: cur } = await db.from("agent_tasks").select("rounds").eq("id", b.id).maybeSingle();
      if (cur) patch.rounds = Math.max((cur.rounds ?? 1) - 1, 0);
    }
    let q = db.from("agent_tasks").update(patch).eq("id", b.id);
    if (b.status !== "rejected") q = q.neq("status", "rejected");
    const { data: t, error } = await q.select("title, summary, error").maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!t) {
      if (typeof b.branch === "string" && b.branch) await db.from("agent_tasks").update({ branch: b.branch }).eq("id", b.id);
      return json({ ok: true, skipped: "rejected" });
    }
    if (NOTIFY[b.status]) await notify(`🛠 ${NOTIFY[b.status]}: ${t.title}`, (b.status === "review" ? t.summary : t.error) ?? "");
    return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
});

async function keyOk(token: string) {
  if (token.length < 32) return false;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))))
    .map((x) => x.toString(16).padStart(2, "0")).join("");
  const { data } = await db.from("agent_keys").select("hash").eq("hash", hash).maybeSingle();
  return !!data;
}

// 관리자 기기로 푸시하고 admin_push_log 에 남깁니다 (usage-agent 와 같은 방식)
async function notify(title: string, body: string) {
  body = body.slice(0, 300);
  const url = "/?view=admin&pane=dev";
  const { data: admins } = await db.from("profiles").select("id").eq("is_admin", true);
  const ids = (admins ?? []).map((a) => a.id);
  const { data: subs } = ids.length
    ? await db.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", ids) : { data: [] };
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@dshs.study",
    Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const payload = JSON.stringify({ title, body, tag: `build:${title}`, url });
  let sent = 0, failed = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 12 * 3600 });
      sent++;
    } catch (err) {
      failed++;
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }));
  const logged = await db.from("admin_push_log").insert({ source: "build", title, body, url, devices: sent + failed, delivered: sent });
  if (logged.error) console.error("관리자 알림 기록 실패", logged.error.message);
}
