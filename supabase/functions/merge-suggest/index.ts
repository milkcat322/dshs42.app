// dshs42.app — 분반별로 따로 올라온 같은 수행평가 찾기 (매일 0 · 8 · 12 · 16 · 20시)
// 같은 과목 · 다른 분반 · 비슷한 이름의 수행평가를 묶어 merge_suggestions 에 남깁니다 (merge.sql).
// 관리자는 관리 탭 '승인' 칸에서 마감이 같은 묶음은 전체 분반 공지로 합치고, 마감이 다른 묶음은 확인만 합니다.
// 무엇을 묶을지는 suggest.ts 가 정합니다. 이 함수는 제안만 하고 공지를 고치지 않습니다.
//
// 배포:  supabase functions deploy merge-suggest
// 실행:  merge.sql 맨 아래 "주기 실행" 주석 (매일 0 · 8 · 12 · 16 · 20시)
//        ?dry=1  저장 없이 찾은 묶음만 돌려줍니다 (확인용)
// service_role 키로만 부를 수 있습니다.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { findGroups, type Asg } from "./suggest.ts";

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return new Response("service_role 키로만 부를 수 있어요", { status: 403 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  const now = Date.now();

  const asg = await db.from("assignments").select("id, subject, ban, title, body, due_at, status, author_name")
    .not("ban", "is", null).in("status", ["approved", "pending"]);
  if (asg.error) return new Response(asg.error.message, { status: 500 });

  // 마감이 모두 지난 묶음은 합쳐도 소용없으므로 뺍니다 (마감 없는 공지는 남김)
  const groups = findGroups(asg.data as Asg[])
    .filter((g) => g.items.some((a) => !a.due_at || Date.parse(a.due_at) >= now));
  if (dry) return json({ dry: true, groups: groups.map((g) => ({ ...g, items: g.items.map(slim) })) });

  const known = await db.from("merge_suggestions").select("id, sig, status");
  if (known.error) return new Response(known.error.message, { status: 500 });
  const seen = new Set(known.data.map((k) => k.sig));
  const fresh = groups.filter((g) => !seen.has(g.sig));
  if (fresh.length) {
    const ins = await db.from("merge_suggestions").upsert(fresh.map((g) => ({
      kind: g.kind, subject: g.subject, sig: g.sig, title: g.title,
      ids: g.items.map((a) => a.id), items: g.items.map(slim),
    })), { onConflict: "sig", ignoreDuplicates: true });
    if (ins.error) return new Response(ins.error.message, { status: 500 });
  }

  // 아직 처리하지 않은 제안 중 지금은 더 이상 묶이지 않는 것(공지가 지워짐 · 고쳐짐 · 마감 지남)은 지웁니다
  const current = new Set(groups.map((g) => g.sig));
  const stale = known.data.filter((k) => k.status === "open" && !current.has(k.sig)).map((k) => k.id);
  if (stale.length) await db.from("merge_suggestions").delete().in("id", stale);

  return json({ groups: groups.length, added: fresh.length, removed: stale.length });
});

const slim = ({ id, ban, title, due_at, status, author_name }: Asg) => ({ id, ban, title, due_at, status, author_name });

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
