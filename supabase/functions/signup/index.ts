// dshs42.app — 회원가입 Edge Function
// 한 학번당 계정 하나를 서버에서 강제합니다.
// 배포:  supabase functions deploy signup --no-verify-jwt

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// 아이디 → 내부 이메일. 실제로 메일을 보내지 않습니다.
const EMAIL_DOMAIN = "dshs.study";

// 관리자 전용 아이디 — 학생이 가입할 때 쓸 수 없습니다.
const RESERVED = new Set(["milkcat322", "qksalornt", "admin", "administrator", "root"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: { student_id?: number; username?: string; password?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "잘못된 요청이에요." }, 400);
  }

  const studentId = Number(payload.student_id);
  const username = String(payload.username ?? "").trim().toLowerCase();
  const password = String(payload.password ?? "");

  if (!Number.isInteger(studentId) || studentId < 1000 || studentId > 9999) {
    return json({ error: "학번이 올바르지 않아요." }, 400);
  }
  if (!/^[a-z0-9_]{4,20}$/.test(username)) {
    return json({ error: "아이디는 영문 소문자·숫자·밑줄 4~20자로 정해주세요." }, 400);
  }
  if (RESERVED.has(username)) {
    return json({ error: "쓸 수 없는 아이디예요. 다른 아이디를 정해주세요." }, 400);
  }
  if (password.length < 8) {
    return json({ error: "비밀번호는 8자 이상이어야 해요." }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // 1. 명단에 있는 학번인지
  const { data: roster, error: rosterErr } = await admin
    .from("roster").select("name").eq("student_id", studentId).maybeSingle();
  if (rosterErr) return json({ error: "서버 오류가 났어요. 잠시 뒤 다시 시도해 주세요." }, 500);
  if (!roster) return json({ error: "명단에 없는 학번이에요." }, 400);

  // 2. 이미 가입한 학번인지
  const { data: taken } = await admin
    .from("profiles").select("username").eq("student_id", studentId).maybeSingle();
  if (taken) {
    return json({ error: `이 학번은 이미 가입되어 있어요. 로그인해 주세요.`, taken: true }, 409);
  }

  // 3. 아이디 중복
  const { data: dupName } = await admin
    .from("profiles").select("id").eq("username", username).maybeSingle();
  if (dupName) return json({ error: "이미 쓰고 있는 아이디예요." }, 409);

  // 4. 계정 생성
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { student_id: studentId, name: roster.name },
  });
  if (createErr || !created.user) {
    return json({ error: createErr?.message ?? "계정을 만들지 못했어요." }, 400);
  }

  // 5. 프로필 생성 (실패하면 방금 만든 계정을 되돌립니다)
  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id,
    username,
    student_id: studentId,
    name: roster.name,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    const msg = profErr.code === "23505"
      ? "방금 다른 기기에서 먼저 가입됐어요. 로그인해 주세요."
      : "프로필을 만들지 못했어요.";
    return json({ error: msg }, 409);
  }

  return json({ ok: true, name: roster.name, username });
});
