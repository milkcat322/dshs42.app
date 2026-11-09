// dshs42.app — dshs.app 계정 연결 Edge Function
// dshs.app 로그인(OIDC)으로 받은 토큰을 서버에만 저장하고, 내 신청 내역을 대신 받아 줍니다.
// 브라우저는 토큰을 보지 못합니다.
//
//   POST { action: "start", return_to }  → dshs.app 로그인 주소 (로그인한 학생의 계정 연결)
//   POST { action: "login", return_to }  → dshs.app 로그인 주소 ('dshs.app으로 로그인', 로그인 전)
//        { …, silent: true }            → 조용한 로그인: prompt=none 이라 dshs.app 에 이미 로그인돼 있으면 화면 없이 돌아옵니다.
//                                          이미 계정이 있는 학생만 로그인시키고, 안 되면 ?dshs=silent 로 조용히 돌아갑니다.
//                                          (아이폰은 홈 화면 앱과 Safari 의 저장소가 따로라, Safari 에서 다시 로그인하지 않게)
//   GET  ?code=…&state=…                 → dshs.app 이 돌려보내는 곳 (redirect URI). 토큰을 저장하고 사이트로 돌아갑니다.
//                                          'dshs.app으로 로그인' 이면 학번으로 계정을 찾거나 만들고,
//                                          일회용 로그인 토큰을 주소의 # 뒤에 붙여 돌려보냅니다 (브라우저가 세션으로 바꿈).
//   POST { action: "poll", handoff }     → 설치한 앱에서 시작한 로그인의 결과. start/login 에 handoff 를 같이 보냈으면
//                                          로그인 창에는 "앱으로 돌아가세요"만 보여 주고, 결과(일회용 토큰)는 앱이 여기서 받아 갑니다.
//   POST { action: "requests" }          → 내 신청 내역 { linked, items }
//   POST { action: "myseat" }            → 위치가 '자습실 자리'면 내 오늘 자리를 받아 student_status 에 남김 { linked, day, seat } (need: "relink" 면 다시 연결)
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
// 자습실 자리: 내 자리 읽기(reservation.read.me)만 받습니다. 다른 학생의 자리 · 학번(reservation.read · user.read)은
// dshs.app 이 개인 정보라 허락하지 않았습니다 (2026-11). 허락받지 않은 scope 를 요청하면 로그인 전체가 invalid_scope 로 실패합니다.
const SEAT_SCOPE = " reservation.read.me";
const SCOPE = "openid profile offline_access me.read request.read" + SEAT_SCOPE;
// 토큰 응답의 scope 에 있으면 true, 아니면 모름(null): 처음 자리를 받을 때 확인합니다 (scope 를 빠뜨리고 주는 서버도 있어서 false 로 막지 않음)
const hasSeatScope = (scope?: string) => scope?.split(" ").includes("reservation.read.me") ? true : null;
// 조용한 로그인: 학번만 알면 되고, offline_access 는 동의 화면이 필요해 뺍니다 (저장해 둔 연결 토큰은 건드리지 않음)
const SILENT_SCOPE = "openid profile me.read";
const SILENT = "s_";   // 조용한 로그인의 state 앞에 붙입니다
const CLIENT_ID = Deno.env.get("DSHS_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("DSHS_CLIENT_SECRET")!;
// dshs.app 에 등록한 redirect URI 와 정확히 같아야 합니다. 로컬(supabase functions serve)에서는 env 로 바꿉니다.
const REDIRECT_URI = Deno.env.get("DSHS_REDIRECT_URI") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/dshs-oauth`;

// 로그인 뒤 돌아갈 수 있는 사이트 (다른 곳으로 보내는 데 쓰이지 않게)
// beta(dshs42-beta.netlify.app)와 그 브랜치 미리보기(<브랜치>--dshs42-beta.netlify.app)도 그 주소로 돌아갑니다
const RETURN_OK = /^(https:\/\/(www\.)?(dshs42\.app|dshs\.study)|https:\/\/([a-z0-9-]+--)?dshs42-beta\.netlify\.app|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const DEFAULT_RETURN = "https://dshs42.app/";
// 계정 이메일 도메인 (signup 과 같음). 서비스 이름이 바뀌어도 바꾸지 않습니다.
const EMAIL_DOMAIN = "dshs.study";

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

async function sha256(s: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 계정 연결은 내 일정 탭으로, 로그인은 첫 화면으로 돌아갑니다
function backTo(returnTo: string, params: Record<string, string>, login = false, hash = "") {
  const url = new URL(returnTo);
  if (!login) url.searchParams.set("view", "cal");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (hash) url.hash = hash;
  return Response.redirect(url.toString(), 303);
}

type Tokens = { access_token: string; refresh_token?: string; id_token?: string; expires_in: number; scope?: string };

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
// userId 가 null 이면 'dshs.app으로 로그인'
// handoff: 설치한 앱에서 시작했을 때 앱만 아는 임의 값. 결과는 로그인 창이 아니라 앱이 poll 로 받아 갑니다.
async function start(userId: string | null, returnTo: unknown, handoff: unknown, silent = false) {
  let back = DEFAULT_RETURN;
  try {
    const u = new URL(String(returnTo));
    if (RETURN_OK.test(u.origin)) back = u.origin + u.pathname;
  } catch { /* 기본 주소로 */ }

  const old = new Date(Date.now() - 10 * 60000).toISOString();
  await admin.from("dshs_oauth_states").delete().lt("created_at", old);
  await admin.from("dshs_handoffs").delete().lt("created_at", old);
  const state = (silent ? SILENT : "") + randomToken(), verifier = randomToken();
  const hand = !silent && typeof handoff === "string" && handoff.length >= 32 ? await sha256(handoff) : null;
  const { error } = await admin.from("dshs_oauth_states").insert({ state, user_id: userId, verifier, return_to: back, handoff: hand });
  if (error) return json({ error: "서버 오류가 났어요. 잠시 뒤 다시 시도해 주세요." }, 500);

  const url = new URL(`${ISSUER}/auth`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: silent ? SILENT_SCOPE : SCOPE,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    // refresh token(offline_access)은 동의 화면을 거쳐야 발급됩니다. 조용한 로그인은 화면을 띄우지 않습니다(none).
    prompt: silent ? "none" : "consent",
  }).toString();
  // silent 를 돌려줘야 브라우저가 넘어갑니다 (예전 함수가 동의 화면 주소를 주면 넘어가지 않게)
  return json({ url: url.toString(), silent });
}

// 'dshs.app으로 로그인': 연결된 계정 → 같은 학번으로 가입한 계정 → (명단에 있으면) 새 계정 순으로 찾습니다.
// 새 계정은 아이디 d<학번>, 비밀번호는 아무도 모르는 임의 값이라 dshs.app 으로만 로그인합니다.
// allowCreate 가 false 면(조용한 로그인) 계정을 새로 만들지 않습니다.
async function loginUser(sub: string, dme: { studentId?: string } | null, allowCreate = true):
  Promise<{ userId: string; created?: boolean } | { error: string }> {
  const { data: link } = await admin.from("dshs_links").select("user_id").eq("dshs_sub", sub).maybeSingle();
  if (link) return { userId: link.user_id };

  const sid = Number(dme?.studentId);
  if (!Number.isInteger(sid) || sid < 1000 || sid > 9999) return { error: "notstudent" };
  const { data: prof } = await admin.from("profiles").select("id").eq("student_id", sid).maybeSingle();
  if (prof) return { userId: prof.id };
  if (!allowCreate) return { error: "noaccount" };

  const { data: roster } = await admin.from("roster").select("name").eq("student_id", sid).maybeSingle();
  if (!roster) return { error: "notstudent" };
  let username = `d${sid}`;
  const { data: dup } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (dup) username = `d${sid}_${crypto.getRandomValues(new Uint32Array(1))[0] % 10000}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`,
    password: randomToken(),
    email_confirm: true,
    user_metadata: { student_id: sid, name: roster.name },
  });
  if (error || !created.user) return { error: "failed" };
  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id, username, student_id: sid, name: roster.name,
  });
  if (profErr) {   // 실패하면 방금 만든 계정을 되돌립니다 (signup 과 같음)
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "failed" };
  }
  return { userId: created.user.id, created: true };
}

// 그 계정의 일회용 로그인 토큰 (메일은 보내지 않음). 브라우저가 verifyOtp 로 세션을 만듭니다.
async function loginToken(userId: string) {
  const { data: u } = await admin.auth.admin.getUserById(userId);
  if (!u.user?.email) return null;
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  return error ? null : data.properties.hashed_token;
}

async function callback(params: URLSearchParams) {
  const state = params.get("state") ?? "";
  const { data: st } = await admin.from("dshs_oauth_states").select("*").eq("state", state).maybeSingle();
  if (!st) return backTo(DEFAULT_RETURN, { dshs: "error", reason: "expired" }, true);
  await admin.from("dshs_oauth_states").delete().eq("state", state);   // 한 번만 씁니다
  const login = !st.user_id;
  const silent = login && state.startsWith(SILENT);
  // 앱에서 시작했으면 결과를 앱이 받아 가도록 맡겨 두고, 로그인 창에는 "앱으로 돌아가세요"만 보여 줍니다
  // 조용한 로그인은 결과와 상관없이 ?dshs=silent 로 돌아갑니다 (실패해도 안내하지 않음. 성공이면 # 뒤에 토큰)
  const done = async (result: string, reason?: string, token?: string) => {
    if (silent) return backTo(st.return_to, { dshs: "silent" }, true, token ? `dshs_login=${token}` : "");
    if (!st.handoff) {
      const params: Record<string, string> = { dshs: result };
      if (reason) params.reason = reason;
      return backTo(st.return_to, params, login, token ? `dshs_login=${token}` : "");
    }
    await admin.from("dshs_handoffs").upsert({ handoff: st.handoff, result, reason: reason ?? null, token: token ?? null });
    return backTo(st.return_to, { dshs: "app" }, true);
  };
  const fail = (reason: string) => done("error", reason);
  if (Date.parse(st.created_at) < Date.now() - 10 * 60000) return fail("expired");

  const err = params.get("error");
  if (err) return fail(err === "access_denied" ? "denied" : "failed");
  if (params.get("iss") && params.get("iss") !== ISSUER) return fail("failed");

  const r = await tokenRequest({
    grant_type: "authorization_code",
    code: params.get("code") ?? "",
    redirect_uri: REDIRECT_URI,
    code_verifier: st.verifier,
  });
  if (!r.ok || !r.t.id_token) return fail("failed");
  const claims = jwtPayload(r.t.id_token);
  const meRes = await fetch(`${API}/v2/users/me`, { headers: { Authorization: `Bearer ${r.t.access_token}` } });
  const dme = meRes.ok ? await meRes.json() : null;

  let userId: string = st.user_id, created = false;
  if (silent) {
    // 이미 있는 계정만. 연결 정보(dshs_links)는 바꾸지 않습니다 (refresh token 이 없어 덮어쓰면 연결이 끊김)
    const found = await loginUser(claims.sub, dme, false);
    if ("error" in found) return fail(found.error);
    const token = await loginToken(found.userId);
    return token ? done("login", undefined, token) : fail("failed");
  }
  if (login) {
    const found = await loginUser(claims.sub, dme);
    if ("error" in found) {
      await revoke(r.t.refresh_token);
      return fail(found.error);
    }
    ({ userId } = found);
    created = !!found.created;
  } else {
    // dshs.app 의 학번이 이 사이트 계정의 학번과 같은지 확인합니다 (다른 사람 계정을 연결하지 않게)
    const { data: prof } = await admin.from("profiles").select("student_id").eq("id", userId).maybeSingle();
    if (prof?.student_id && dme?.studentId && String(dme.studentId) !== String(prof.student_id)) {
      await revoke(r.t.refresh_token);
      return fail("mismatch");
    }
  }

  // 같은 dshs.app 계정이 다른 계정에 연결돼 있었다면 그 연결은 풉니다 (한 사람 = 한 연결)
  await admin.from("dshs_links").delete().eq("dshs_sub", claims.sub).neq("user_id", userId);
  const { error } = await admin.from("dshs_links").upsert({
    user_id: userId,
    dshs_sub: claims.sub,
    dshs_name: dme?.name ?? claims.name ?? null,
    dshs_student_id: dme?.studentId ?? null,
    refresh_token: r.t.refresh_token ?? null,
    access_token: r.t.access_token,
    access_expires: expiresAt(r.t),
    linked_at: new Date().toISOString(),
    seat_ok: hasSeatScope(r.t.scope),
  });
  if (error) return fail("failed");
  if (!login) return done("linked");

  const token = await loginToken(userId);
  if (!token) return fail("failed");
  return done(created ? "joined" : "login", undefined, token);
}

// 앱이 로그인 결과를 받아 갑니다. 아직이면 { pending: true }. 한 번 받아 가면 지웁니다.
async function poll(handoff: unknown) {
  if (typeof handoff !== "string" || handoff.length < 32) return json({ error: "잘못된 요청이에요." }, 400);
  const key = await sha256(handoff);
  const { data } = await admin.from("dshs_handoffs").delete().eq("handoff", key).select().maybeSingle();
  if (!data) return json({ pending: true });
  if (Date.parse(data.created_at) < Date.now() - 10 * 60000) return json({ result: "error", reason: "expired" });
  return json({ result: data.result, reason: data.reason, token: data.token });
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

// ---------- 자습실 자리 (seats.sql) ----------
// 위치를 '자습실 자리'로 정한 학생의 오늘 자리를 그 학생 자신의 토큰(reservation.read.me)으로 받아
// student_status 의 seat · seat_day 에 남깁니다. 로그인한 42기 학생이 위치와 함께 봅니다.
// 다른 학생의 자리는 받지 않습니다 (dshs.app 이 개인 정보라 허락하지 않음). 자리 신청은 전날 끝나므로 하루 한 번만 받습니다.
const SEAT_PLACE = "자습실 자리";
const kstDay = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, "");

async function mySeat(userId: string) {
  if (!SEAT_SCOPE) return json({ off: true });
  const { data: link } = await admin.from("dshs_links").select("*").eq("user_id", userId).maybeSingle();
  if (!link) return json({ linked: false });
  if (link.seat_ok === false) return json({ linked: true, need: "relink" });   // 예전 연결: 권한을 받으려면 다시 연결

  const { data: prof } = await admin.from("profiles").select("student_id").eq("id", userId).maybeSingle();
  if (!prof?.student_id) return json({ linked: true });
  const { data: st } = await admin.from("student_status").select("location, seat, seat_day").eq("student_id", prof.student_id).maybeSingle();
  if (st?.location !== SEAT_PLACE) return json({ linked: true });   // 본인이 '자습실 자리'로 정했을 때만
  const day = kstDay();
  if (st.seat_day === day) return json({ linked: true, day, seat: st.seat });

  const res = await api(link, `/v2/reservations/${day}/me`);
  if (!res) return json({ linked: false, expired: true });
  if (res.status === 403) {
    await admin.from("dshs_links").update({ seat_ok: false }).eq("user_id", userId);
    return json({ linked: true, need: "relink" });
  }
  if (!res.ok) return json({ linked: true, error: res.status === 429 ? "busy" : "failed" }, res.status === 429 ? 503 : 502);
  if (link.seat_ok !== true) await admin.from("dshs_links").update({ seat_ok: true }).eq("user_id", userId);
  const body = await res.json();
  const seat = body.available === false ? null : (body.userInfo?.seat ?? null);   // 자습 없는 날 · 신청 안 함 → 없음
  const { error } = await admin.from("student_status").update({ seat, seat_day: day })
    .eq("student_id", prof.student_id).eq("location", SEAT_PLACE);
  if (error) return json({ linked: true, error: "failed" }, 500);
  return json({ linked: true, day, seat });
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

  let body: { action?: string; return_to?: string; handoff?: string; silent?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "잘못된 요청이에요." }, 400);
  }
  if (body.action === "login") return start(null, body.return_to, body.handoff, body.silent === true);
  if (body.action === "poll") return poll(body.handoff);

  const user = await currentUser(req);
  if (!user) return json({ error: "로그인이 필요해요." }, 401);
  if (body.action === "start") return start(user.id, body.return_to, body.handoff);
  if (body.action === "requests") return requests(user.id);
  if (body.action === "myseat") return mySeat(user.id);
  if (body.action === "unlink") return unlink(user.id);
  return json({ error: "잘못된 요청이에요." }, 400);
});
