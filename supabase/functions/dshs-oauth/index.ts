// dshs42.app — dshs.app 계정 연결 Edge Function
// dshs.app 로그인(OIDC)으로 받은 토큰을 서버에만 저장하고, 내 신청 내역을 대신 받아 줍니다.
// 브라우저는 토큰을 보지 못합니다.
//
//   POST { action: "start", return_to }  → dshs.app 로그인 주소 (로그인한 학생만)
//   GET  ?code=…&state=…                 → dshs.app 이 돌려보내는 곳 (redirect URI). 토큰을 저장하고 사이트로 돌아갑니다.
//   POST { action: "requests" }          → 내 신청 내역 { linked, items }
//   POST { action: "unlink" }            → 연결 해제 (refresh token 무효화 + 저장한 토큰 삭제)
//
// 배포:  supabase functions deploy dshs-oauth --no-verify-jwt   (콜백은 로그인 토큰 없이 들어오므로)
// 비밀값: supabase secrets set DSHS_CLIENT_ID=… DSHS_CLIENT_SECRET=…
// 문서:  https://id.dshs.app/docs · https://api.dshs.app/docs

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const ISSUER = "https://id.dshs.app";
const API = "https://api.dshs.app";
const SCOPE = "openid profile offline_access me.read request.read";
const CLIENT_ID = Deno.env.get("DSHS_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("DSHS_CLIENT_SECRET")!;
// dshs.app 에 등록한 redirect URI 와 정확히 같아야 합니다. 로컬(supabase functions serve)에서는 env 로 바꿉니다.
const REDIRECT_URI = Deno.env.get("DSHS_REDIRECT_URI") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/dshs-oauth`;

// 로그인 뒤 돌아갈 수 있는 사이트 (다른 곳으로 보내는 데 쓰이지 않게)
const RETURN_OK = /^(https:\/\/(www\.)?(dshs42\.app|dshs\.study)|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const DEFAULT_RETURN = "https://dshs42.app/";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// ---------- 유틸 ----------
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
async function pkceChallenge(verifier: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(hash));
}
// id_token 은 token 엔드포인트에서 TLS 로 직접 받은 것이라 서명 검증 없이 내용만 읽습니다 (OIDC Core 3.1.3.7)
function jwtPayload(token: string) {
  const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(part + "=".repeat((4 - part.length % 4) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

function backTo(returnTo: string, params: Record<string, string>) {
  const url = new URL(returnTo);
  url.searchParams.set("view", "cal");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url.toString(), 303);
}

type Tokens = { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };

// /token 요청. 서버 앱이라 client_secret 을 HTTP Basic 으로 보냅니다.
async function tokenRequest(form: Record<string, string>): Promise<{ ok: true; t: Tokens } | { ok: false; error: string }> {
  const res = await fetch(`${ISSUER}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ ...form, resource: API }),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, t: body } : { ok: false, error: body.error ?? `http_${res.status}` };
}

const expiresAt = (t: Tokens) => new Date(Date.now() + (t.expires_in - 30) * 1000).toISOString();

// 로그인한 학생 (Authorization: Bearer <Supabase 세션 토큰>)
async function currentUser(req: Request) {
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  return data.user ?? null;
}

// ---------- 학교 API 호출 ----------
type Link = { user_id: string; refresh_token: string | null; access_token: string | null; access_expires: string | null };

// refresh token 으로 새 access token. 갱신에 실패하면(30일 미사용·동의 철회) 연결을 지우고 null.
async function refresh(link: Link) {
  if (!link.refresh_token) return null;
  const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: link.refresh_token });
  if (!r.ok) {
    if (r.error === "invalid_grant") await admin.from("dshs_links").delete().eq("user_id", link.user_id);
    return null;
  }
  const row = {
    access_token: r.t.access_token,
    access_expires: expiresAt(r.t),
    refresh_token: r.t.refresh_token ?? link.refresh_token,   // 매번 새로 발급되므로 새 값으로 바꿉니다
  };
  await admin.from("dshs_links").update(row).eq("user_id", link.user_id);
  Object.assign(link, row);
  return link.access_token;
}

// 401 이면 토큰을 갱신해 한 번 더 보냅니다. 갱신도 안 되면 null (다시 연결해야 함).
async function api(link: Link, path: string) {
  let token = link.access_token && link.access_expires && Date.parse(link.access_expires) > Date.now()
    ? link.access_token : await refresh(link);
  if (!token) return null;
  let res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = await refresh(link);
    if (!token) return null;
    res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  }
  return res;
}

// ---------- 동작 ----------
async function start(userId: string, returnTo: unknown) {
  let back = DEFAULT_RETURN;
  try {
    const u = new URL(String(returnTo));
    if (RETURN_OK.test(u.origin)) back = u.origin + u.pathname;
  } catch { /* 기본 주소로 */ }

  await admin.from("dshs_oauth_states").delete().lt("created_at", new Date(Date.now() - 10 * 60000).toISOString());
  const state = randomToken(), verifier = randomToken();
  const { error } = await admin.from("dshs_oauth_states").insert({ state, user_id: userId, verifier, return_to: back });
  if (error) return json({ error: "서버 오류가 났어요. 잠시 뒤 다시 시도해 주세요." }, 500);

  const url = new URL(`${ISSUER}/auth`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "consent",   // refresh token(offline_access)은 동의 화면을 거쳐야 발급됩니다
  }).toString();
  return json({ url: url.toString() });
}

async function callback(params: URLSearchParams) {
  const state = params.get("state") ?? "";
  const { data: st } = await admin.from("dshs_oauth_states").select("*").eq("state", state).maybeSingle();
  if (!st) return backTo(DEFAULT_RETURN, { dshs: "error", reason: "expired" });
  await admin.from("dshs_oauth_states").delete().eq("state", state);   // 한 번만 씁니다
  if (Date.parse(st.created_at) < Date.now() - 10 * 60000) return backTo(st.return_to, { dshs: "error", reason: "expired" });

  const err = params.get("error");
  if (err) return backTo(st.return_to, { dshs: "error", reason: err === "access_denied" ? "denied" : "failed" });
  if (params.get("iss") && params.get("iss") !== ISSUER) return backTo(st.return_to, { dshs: "error", reason: "failed" });

  const r = await tokenRequest({
    grant_type: "authorization_code",
    code: params.get("code") ?? "",
    redirect_uri: REDIRECT_URI,
    code_verifier: st.verifier,
  });
  if (!r.ok || !r.t.id_token) return backTo(st.return_to, { dshs: "error", reason: "failed" });
  const claims = jwtPayload(r.t.id_token);

  // dshs.app 의 학번이 이 사이트 계정의 학번과 같은지 확인합니다 (다른 사람 계정을 연결하지 않게)
  const meRes = await fetch(`${API}/v2/users/me`, { headers: { Authorization: `Bearer ${r.t.access_token}` } });
  const dme = meRes.ok ? await meRes.json() : null;
  const { data: prof } = await admin.from("profiles").select("student_id").eq("id", st.user_id).maybeSingle();
  if (prof?.student_id && dme?.studentId && String(dme.studentId) !== String(prof.student_id)) {
    await revoke(r.t.refresh_token);
    return backTo(st.return_to, { dshs: "error", reason: "mismatch" });
  }

  // 같은 dshs.app 계정이 다른 계정에 연결돼 있었다면 그 연결은 풉니다 (한 사람 = 한 연결)
  await admin.from("dshs_links").delete().eq("dshs_sub", claims.sub).neq("user_id", st.user_id);
  const { error } = await admin.from("dshs_links").upsert({
    user_id: st.user_id,
    dshs_sub: claims.sub,
    dshs_name: dme?.name ?? claims.name ?? null,
    dshs_student_id: dme?.studentId ?? null,
    refresh_token: r.t.refresh_token ?? null,
    access_token: r.t.access_token,
    access_expires: expiresAt(r.t),
    linked_at: new Date().toISOString(),
  });
  if (error) return backTo(st.return_to, { dshs: "error", reason: "failed" });
  return backTo(st.return_to, { dshs: "linked" });
}

async function revoke(token?: string | null) {
  if (!token) return;
  await fetch(`${ISSUER}/token/revocation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ token, token_type_hint: "refresh_token" }),
  }).catch(() => {});
}

// 내 신청 (내가 제출하거나 참여한 진행 중인 신청). 달력에 필요한 값만 돌려줍니다.
async function requests(userId: string) {
  const { data: link } = await admin.from("dshs_links").select("*").eq("user_id", userId).maybeSingle();
  if (!link) return json({ linked: false });
  const items = [];
  for (let page = 1; page <= 3; page++) {
    const res = await api(link, `/v2/requests?type=mine&perPage=100&page=${page}`);
    if (!res) return json({ linked: false, expired: true });
    if (res.status === 429) return json({ linked: true, error: "busy" }, 503);
    if (!res.ok) return json({ linked: true, error: "failed" }, 502);
    const body = await res.json();
    for (const it of body.items) {
      items.push({
        uid: it.uid, title: it.title || it.formTitle, form: it.formTitle, category: it.categoryLabel,
        from: it.dateFrom, to: it.dateTo, room: it.roomName, status: it.status, count: it.requesterCount,
      });
    }
    if (page >= body.totalPages) break;
  }
  return json({ linked: true, name: link.dshs_name, items });
}

async function unlink(userId: string) {
  const { data: link } = await admin.from("dshs_links").select("refresh_token").eq("user_id", userId).maybeSingle();
  if (link) await revoke(link.refresh_token);
  await admin.from("dshs_links").delete().eq("user_id", userId);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return callback(new URL(req.url).searchParams);
  if (req.method !== "POST") return json({ error: "GET/POST only" }, 405);

  const user = await currentUser(req);
  if (!user) return json({ error: "로그인이 필요해요." }, 401);
  let body: { action?: string; return_to?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "잘못된 요청이에요." }, 400);
  }
  if (body.action === "start") return start(user.id, body.return_to);
  if (body.action === "requests") return requests(user.id);
  if (body.action === "unlink") return unlink(user.id);
  return json({ error: "잘못된 요청이에요." }, 400);
});
