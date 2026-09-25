// CR-20260913 FR-1→FR-4a, Lát 2 — login/callback/logout/me, bootstrap Admin, thu hồi/disable tài
// khoản. Dựng 1 server giả đóng vai auth.drjoy.vn thật (JWKS, /users/me) — không mock fetch toàn cục,
// để test đi qua đúng đường HTTP thật như code sản phẩm sẽ gọi.
//
// 2026-09-25: bỏ mô phỏng /auth/token/exchange (flow "code" — thiết kế gốc, chưa từng đúng thật) —
// xác nhận auth.drjoy.vn cấu hình client "indigo" ở flow "legacy": redirect thẳng
// ?access_token=&refresh_token=, không có code/exchange. Đổi mock theo đúng thực tế đang chạy, xem
// docs/exchanges/2026-09-25.md.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import type { Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { parse as parseCookie } from 'cookie';

const ADMIN_EMAIL = 'admin@drjoy.jp';

// ── Server giả đóng vai auth.drjoy.vn — PHẢI chạy và biết port TRƯỚC khi import server/app.js, vì
// AUTH_BASE_URL đọc 1 lần lúc module server/lib/auth-config.ts được load.
const keyPair = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
const jwksBody = { keys: [jwk] };

interface FakeUsersMe { email: string; name: string; avatar: string }
const usersMeByToken = new Map<string, FakeUsersMe>();
const slowMeTokens = new Set<string>(); // /users/me KHÔNG BAO GIỜ trả lời -> buộc client tự timeout

const authServer: Server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://internal');
  if (url.pathname === '/.well-known/jwks.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(jwksBody));
    return;
  }
  if (url.pathname === '/users/me' && req.method === 'GET') {
    const authz = req.headers.authorization || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (slowMeTokens.has(token)) return; // không res.end() -> client tự abort khi hết timeout
    const info = usersMeByToken.get(token);
    if (!info) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'invalid_token' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ user_id: '1', email: info.email, name: info.name, avatar: info.avatar, provider: 'google' }));
    return;
  }
  res.statusCode = 404;
  res.end();
});
const authBaseUrl = await new Promise<string>((resolve) => {
  authServer.listen(0, '127.0.0.1', () => {
    const addr = authServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-auth-itest-'));
process.env.APPDATA = tmpAppData;
process.env.AUTH_BASE_URL = authBaseUrl;
process.env.AUTH_CLIENT = 'indigo';
process.env.APP_CALLBACK_URL = 'http://127.0.0.1:0/api/auth/callback';
process.env.ADMIN_BOOTSTRAP_EMAIL = ADMIN_EMAIL;

const { app } = await import('../../server/app.js');
const { db } = await import('../../server/db.js');

let server: Server;
let base = '';
await new Promise<void>((resolve) => {
  server = app.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    resolve();
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => authServer.close(() => resolve()));
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

// ── Helpers ────────────────────────────────────────────────────────────────────────
let subjectCounter = 0;
// subOverride: dùng khi test cần ĐĂNG NHẬP LẠI ĐÚNG 1 danh tính đã có (vd Admin thật, để gọi tiếp
// /api/admin/*) — không dùng subjectCounter (mỗi lần gọi mặc định tạo 1 danh tính (issuer,subject) MỚI
// hoàn toàn, đúng nghĩa "user khác nhau dùng chung 1 email", không phải "cùng 1 người đăng nhập lại").
async function issueAuthCode(email: string, name: string, avatar = '', subOverride?: string): Promise<{ accessToken: string; refreshToken: string }> {
  subjectCounter += 1;
  const sub = subOverride || `sub-${subjectCounter}`;
  const accessToken = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuedAt()
    .setIssuer(authBaseUrl)
    .setAudience('indigo')
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(keyPair.privateKey);
  usersMeByToken.set(accessToken, { email, name, avatar });
  return { accessToken, refreshToken: `refresh-${sub}` };
}

function callbackUrl(accessToken: string, refreshToken: string): string {
  return `${base}/api/auth/callback?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`;
}

async function startLogin(): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const setCookie = res.headers.get('set-cookie') || '';
  const nonceCookie = parseCookie(setCookie)['login_nonce'];
  assert.ok(nonceCookie, 'phải có cookie login_nonce sau /auth/login');
  return nonceCookie;
}

async function loginAs(email: string, name: string, subOverride?: string): Promise<{ sessionCookie: string; status: number }> {
  const nonce = await startLogin();
  const { accessToken, refreshToken } = await issueAuthCode(email, name, '', subOverride);
  const res = await fetch(callbackUrl(accessToken, refreshToken), {
    redirect: 'manual',
    headers: { Cookie: `login_nonce=${nonce}` }
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const sessionCookie = parseCookie(setCookie)['__Host-tm_session'];
  return { sessionCookie, status: res.status };
}

// Danh tính (issuer, subject) của Admin thật trong DB — được xác định ở test đầu tiên (race lúc DB
// còn sạch), rồi TÁI DÙNG cho mọi test sau cần đăng nhập lại đúng người này (không dùng 1 sub cứng cố
// định như trước — sub cứng giả định luôn thắng race, nhưng bản chất chỉ có 1 trong N người thắng, và
// race PHẢI được kiểm khi DB thật sự chưa có Admin nào, không phải sau khi đã có 1 Admin từ test khác).
let adminSub = '';
// 2026-09-25 (docs/exchanges/2026-09-25.md): Admin bootstrap giờ tạo ra ở trạng thái 'pending', phải tự
// nộp đơn xin tham gia (tự động duyệt vì là Admin) trước khi dùng được /api/admin/*. Tự hoàn tất bước
// này ở đây (idempotent — bỏ qua nếu đã active từ lần gọi trước) để mọi test SAU race test đầu tiên vẫn
// nhận lại phiên dùng NGAY được, không phải tự lo việc onboard ở từng test.
async function loginAsAdmin(): Promise<{ sessionCookie: string; status: number }> {
  const result = await loginAs(ADMIN_EMAIL, 'Admin Thật', adminSub);
  const meH = { Cookie: `__Host-tm_session=${result.sessionCookie}` };
  const me = await (await fetch(`${base}/api/auth/me`, { headers: meH })).json() as { user: { status: string } };
  if (me.user.status === 'pending') {
    const jr = await fetch(`${base}/api/onboarding/join-request`, {
      method: 'POST', headers: { ...meH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newTeamName: '[bootstrap] Admin Thật', role: 'leader' })
    });
    assert.ok(jr.ok, `tự hoàn tất onboarding cho Admin bootstrap thất bại (${jr.status})`);
  }
  return result;
}

// ── Test ───────────────────────────────────────────────────────────────────────────

test('FR-1a: DB CHƯA có Admin nào, 2 danh tính MỚI khác nhau cùng khớp email bootstrap đăng nhập gần như đồng thời -> đúng 1 thành Admin', async () => {
  const subA = 'race-first-admin-A';
  const subB = 'race-first-admin-B';
  const nonceA = await startLogin();
  const tokensA = await issueAuthCode(ADMIN_EMAIL, 'Ứng viên Admin A', '', subA);
  const nonceB = await startLogin();
  const tokensB = await issueAuthCode(ADMIN_EMAIL, 'Ứng viên Admin B', '', subB);

  const [resA, resB] = await Promise.all([
    fetch(callbackUrl(tokensA.accessToken, tokensA.refreshToken), { redirect: 'manual', headers: { Cookie: `login_nonce=${nonceA}` } }),
    fetch(callbackUrl(tokensB.accessToken, tokensB.refreshToken), { redirect: 'manual', headers: { Cookie: `login_nonce=${nonceB}` } })
  ]);
  assert.equal(resA.status, 302);
  assert.equal(resB.status, 302);

  const cookieA = parseCookie(resA.headers.get('set-cookie') || '')['__Host-tm_session'];
  const cookieB = parseCookie(resB.headers.get('set-cookie') || '')['__Host-tm_session'];
  const meA = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: `__Host-tm_session=${cookieA}` } })).json();
  const meB = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: `__Host-tm_session=${cookieB}` } })).json();

  const winners = [meA, meB].filter((m) => m.user.systemRole === 'admin');
  assert.equal(winners.length, 1, 'đúng 1 trong 2 danh tính cạnh tranh phải thành Admin, không phải 0 hay 2');
  // 2026-09-25: Admin bootstrap KHÔNG còn 'active' ngay — phải đi qua đúng màn "Chọn team và vai trò"
  // như user thường trước (docs/exchanges/2026-09-25.md). `system_role='admin'` có ngay, `status` vẫn
  // 'pending' cho tới khi họ tự nộp đơn (xem test riêng "Admin bootstrap tự hoàn tất onboarding" bên dưới).
  assert.equal(winners[0].user.status, 'pending');
  adminSub = meA.user.systemRole === 'admin' ? subA : subB;

  const totalAdmins = db.prepare("SELECT COUNT(*) as n FROM users WHERE system_role = 'admin'").get() as { n: number };
  assert.equal(totalAdmins.n, 1);
});

test('2026-09-25: Admin bootstrap tự hoàn tất onboarding — tự lập team mới, đơn tự động duyệt, KHÔNG cần ai duyệt hộ', async () => {
  const { sessionCookie } = await loginAs(ADMIN_EMAIL, 'Admin Thật', adminSub);
  const H = { Cookie: `__Host-tm_session=${sessionCookie}`, 'Content-Type': 'application/json' };

  const meBefore = await (await fetch(`${base}/api/auth/me`, { headers: H })).json();
  assert.equal(meBefore.user.status, 'pending', 'vẫn pending cho tới khi tự nộp đơn — đăng nhập lại không tự nâng cấp');

  const jr = await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: H, body: JSON.stringify({ newTeamName: `[itest] Team cua Admin ${Date.now()}`, role: 'leader' })
  });
  assert.equal(jr.status, 201);
  const jrBody = await jr.json();
  assert.equal(jrBody.autoApproved, true, 'đơn của Admin bootstrap phải tự động duyệt ngay, không chờ ai');

  const meAfter = await (await fetch(`${base}/api/auth/me`, { headers: H })).json();
  assert.equal(meAfter.user.status, 'active', 'active ngay sau khi tự nộp đơn, không cần ai duyệt hộ');

  const myTeams = await (await fetch(`${base}/api/me/teams`, { headers: H })).json();
  assert.equal(myTeams.teams.length, 1);
  assert.equal(myTeams.teams[0].role, 'leader');
});

test('2026-09-25: user thường (không phải Admin) gửi newTeamName -> 400, không tự tạo team được (giữ đúng FR-2)', async () => {
  const { sessionCookie } = await loginAs('regular-newteam-attempt@drjoy.jp', 'User thường');
  const res = await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST',
    headers: { Cookie: `__Host-tm_session=${sessionCookie}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ newTeamName: 'Team tự chế', role: 'member' })
  });
  assert.equal(res.status, 400);
});

test('FR-2: đăng nhập lần đầu email KHÔNG khớp bootstrap -> pending + system_role user', async () => {
  const { sessionCookie } = await loginAs('member1@drjoy.jp', 'Thành viên 1');
  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: `__Host-tm_session=${sessionCookie}` } });
  const body = await me.json();
  assert.equal(body.user.status, 'pending');
  assert.equal(body.user.systemRole, 'user');
});

test('FR-1: callback thiếu cookie login_nonce -> 400 LOGIN_NONCE_INVALID, không tạo session', async () => {
  const { accessToken, refreshToken } = await issueAuthCode('nonce-test@drjoy.jp', 'X');
  const res = await fetch(callbackUrl(accessToken, refreshToken), { redirect: 'manual' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'LOGIN_NONCE_INVALID');
});

// 2026-09-25: thay "callback thiếu ?code=" (flow "code", không còn tồn tại) bằng đúng validate hiện
// hành cho flow "legacy" — callback đòi cả access_token LẪN refresh_token trên query.
test('callback thiếu ?access_token=/?refresh_token= -> 400 AUTH_CALLBACK_INVALID, không tạo user', async () => {
  const nonce = await startLogin();
  const res = await fetch(`${base}/api/auth/callback`, { headers: { Cookie: `login_nonce=${nonce}` } });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'AUTH_CALLBACK_INVALID');
});

// 2026-09-25: bỏ test "code dùng lại 1 lần" — flow "code" (single-use, TTL 120s) không còn tồn tại.
// Flow "legacy" giao thẳng access_token/refresh_token thật (JWT sống theo `exp`, không có khái niệm
// single-use ở tầng này) — rủi ro token bị replay nếu lộ URL là đánh đổi đã biết của phương án B, xem
// docs/exchanges/2026-09-25.md, không phải điều app cố tình chặn.

test('GET /auth/me không có cookie phiên -> 401 SESSION_REQUIRED', async () => {
  const res = await fetch(`${base}/api/auth/me`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.code, 'SESSION_REQUIRED');
});

test('POST /auth/logout huỷ đúng phiên -> session cũ không dùng lại được', async () => {
  const { sessionCookie } = await loginAs('logout-test@drjoy.jp', 'Z');
  const cookieHeader = `__Host-tm_session=${sessionCookie}`;
  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookieHeader } });
  assert.equal(logout.status, 200);
  const meAfter = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieHeader } });
  assert.equal(meAfter.status, 401);
});

test('FR-1a: đã có Admin từ trước -> 2 danh tính MỚI khác nhau cùng khớp email bootstrap đăng nhập đồng thời -> KHÔNG ai thành Admin thêm', async () => {
  const nonceA = await startLogin();
  const tokensA = await issueAuthCode(ADMIN_EMAIL, 'Admin C (danh tính khác, tới sau)', '', 'race-second-admin-A');
  const nonceB = await startLogin();
  const tokensB = await issueAuthCode(ADMIN_EMAIL, 'Admin D (danh tính khác, tới sau)', '', 'race-second-admin-B');

  const [resA, resB] = await Promise.all([
    fetch(callbackUrl(tokensA.accessToken, tokensA.refreshToken), { redirect: 'manual', headers: { Cookie: `login_nonce=${nonceA}` } }),
    fetch(callbackUrl(tokensB.accessToken, tokensB.refreshToken), { redirect: 'manual', headers: { Cookie: `login_nonce=${nonceB}` } })
  ]);
  assert.equal(resA.status, 302);
  assert.equal(resB.status, 302);

  const admins = db.prepare(
    "SELECT COUNT(*) as n FROM users WHERE email = ? AND system_role = 'admin'"
  ).get(ADMIN_EMAIL) as { n: number };
  // Test trước đó (race lúc DB sạch) đã tạo đúng 1 Admin — bằng chứng fail-closed thật sự nằm ở việc
  // con số này KHÔNG tăng thêm dù có 2 danh tính MỚI khác nhau cùng cạnh tranh sau đó.
  assert.equal(admins.n, 1);
});

test('FR-4a: Admin disable tài khoản -> request kế tiếp của user đó bị 403 ACCOUNT_DISABLED ngay, không cache', async () => {
  const { sessionCookie: adminCookie } = await loginAsAdmin();
  const { sessionCookie: userCookie } = await loginAs('to-be-disabled@drjoy.jp', 'Bị vô hiệu');
  const adminHeader = `__Host-tm_session=${adminCookie}`;
  const userHeader = `__Host-tm_session=${userCookie}`;

  const meBefore = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: userHeader } })).json();
  const userId = meBefore.user.id;
  const usersList = await (await fetch(`${base}/api/admin/users`, { headers: { Cookie: adminHeader } })).json();
  const row = usersList.users.find((u: { id: number }) => u.id === userId);

  const patch = await fetch(`${base}/api/admin/users/${userId}/disable`, {
    method: 'POST',
    headers: { Cookie: adminHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowVersion: row.row_version })
  });
  assert.equal(patch.status, 200);

  const meAfter = await fetch(`${base}/api/auth/me`, { headers: { Cookie: userHeader } });
  assert.equal(meAfter.status, 403);
  const body = await meAfter.json();
  assert.equal(body.code, 'ACCOUNT_DISABLED');
});

test('authorize() ROLE_FORBIDDEN: user active nhưng KHÔNG phải Admin gọi /admin/users -> 403', async () => {
  const adminSession = (await loginAsAdmin()).sessionCookie;
  const userSession = (await loginAs('not-admin@drjoy.jp', 'Không phải Admin')).sessionCookie;
  const adminHeader = `__Host-tm_session=${adminSession}`;
  const userHeader = `__Host-tm_session=${userSession}`;

  // Phải active (không pending) để thật sự đi tới bước kiểm role trong authorize(), không bị chặn
  // sớm hơn bởi requireActiveAccount (ACCOUNT_PENDING) — 2 lớp gác khác nhau, không lẫn.
  const teamRes = await fetch(`${base}/api/admin/teams`, {
    method: 'POST', headers: { Cookie: adminHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Team cho not-admin ${Date.now()}` })
  });
  const teamId = (await teamRes.json()).id;
  const meBefore = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: userHeader } })).json();
  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { Cookie: userHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  const list = await (await fetch(`${base}/api/admin/join-requests`, { headers: { Cookie: adminHeader } })).json();
  const jr = list.joinRequests.find((r: { user_id: number }) => r.user_id === meBefore.user.id);
  await fetch(`${base}/api/admin/join-requests/${jr.id}/approve`, {
    method: 'POST', headers: { Cookie: adminHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowVersion: jr.row_version })
  });

  const res = await fetch(`${base}/api/admin/users`, { headers: { Cookie: userHeader } });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'ROLE_FORBIDDEN');
});

test('POST /admin/users/:id/revoke-sessions: phiên cũ của user đó bị từ chối ngay sau khi Admin thu hồi', async () => {
  const { sessionCookie: adminCookie } = await loginAsAdmin();
  const { sessionCookie: userCookie } = await loginAs('revoke-target@drjoy.jp', 'Bị thu hồi phiên');
  const me = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: `__Host-tm_session=${userCookie}` } })).json();

  const revoke = await fetch(`${base}/api/admin/users/${me.user.id}/revoke-sessions`, {
    method: 'POST',
    headers: { Cookie: `__Host-tm_session=${adminCookie}` }
  });
  assert.equal(revoke.status, 200);

  const meAfter = await fetch(`${base}/api/auth/me`, { headers: { Cookie: `__Host-tm_session=${userCookie}` } });
  assert.equal(meAfter.status, 401);
});

// 2026-09-25: thay "response /auth/token/exchange thiếu access_token/refresh_token" (endpoint không
// còn tồn tại) bằng đúng ca lỗi tương đương của flow "legacy" — callback nhận refresh_token RỖNG
// (auth.drjoy.vn gửi thiếu 1 trong 2 tham số) vẫn phải chặn 400, không tạo user rác.
test('FR-1: callback nhận refresh_token rỗng -> 400 AUTH_CALLBACK_INVALID, không tạo user', async () => {
  const nonce = await startLogin();
  const { accessToken } = await issueAuthCode('malformed-callback@drjoy.jp', 'Thiếu refresh_token');
  const res = await fetch(`${base}/api/auth/callback?access_token=${encodeURIComponent(accessToken)}&refresh_token=`, {
    redirect: 'manual',
    headers: { Cookie: `login_nonce=${nonce}` }
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'AUTH_CALLBACK_INVALID');
  const row = db.prepare('SELECT 1 FROM users WHERE email = ?').get('malformed-callback@drjoy.jp');
  assert.equal(row, undefined, 'không được tạo user khi thiếu refresh_token');
});

test('FR-1: /users/me timeout -> vẫn đăng nhập được, dùng tạm email/tên từ JWT (không chặn đăng nhập)', async () => {
  const nonce = await startLogin();
  const email = 'slow-users-me@drjoy.jp';
  const { accessToken, refreshToken } = await issueAuthCode(email, 'Tên thật (không lấy được vì timeout)');
  slowMeTokens.add(accessToken);

  const res = await fetch(callbackUrl(accessToken, refreshToken), {
    redirect: 'manual',
    headers: { Cookie: `login_nonce=${nonce}` }
  });
  assert.equal(res.status, 302, 'timeout /users/me không được chặn đăng nhập (FR-1)');
  const sessionCookie = parseCookie(res.headers.get('set-cookie') || '')['__Host-tm_session'];
  const me = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: `__Host-tm_session=${sessionCookie}` } })).json();
  assert.equal(me.user.email, email, 'email fallback lấy từ claim JWT khi /users/me không trả lời được');
});
