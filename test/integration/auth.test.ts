// CR-20260913 FR-1→FR-4a, Lát 2 — login/callback/logout/me, bootstrap Admin, thu hồi/disable tài
// khoản. Dựng 1 server giả đóng vai auth.drjoy.vn thật (token exchange, JWKS, /users/me) — không mock
// fetch toàn cục, để test đi qua đúng đường HTTP thật như code sản phẩm sẽ gọi.
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
const pendingCodes = new Map<string, { accessToken: string; refreshToken: string }>();
const usersMeByToken = new Map<string, FakeUsersMe>();

const authServer: Server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://internal');
  if (url.pathname === '/.well-known/jwks.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(jwksBody));
    return;
  }
  if (url.pathname === '/auth/token/exchange' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { code?: string };
    const entry = body.code ? pendingCodes.get(body.code) : undefined;
    if (!entry) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'invalid_code' }));
      return;
    }
    pendingCodes.delete(body.code!); // code dùng 1 lần, đúng thật (TTL 120s)
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ access_token: entry.accessToken, refresh_token: entry.refreshToken }));
    return;
  }
  if (url.pathname === '/users/me' && req.method === 'GET') {
    const authz = req.headers.authorization || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
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
async function issueAuthCode(email: string, name: string, avatar = '', subOverride?: string): Promise<string> {
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
  const refreshToken = `refresh-${sub}`;
  usersMeByToken.set(accessToken, { email, name, avatar });
  const code = `code-${sub}-${Math.random().toString(36).slice(2)}`;
  pendingCodes.set(code, { accessToken, refreshToken });
  return code;
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
  const code = await issueAuthCode(email, name, '', subOverride);
  const res = await fetch(`${base}/api/auth/callback?code=${code}`, {
    redirect: 'manual',
    headers: { Cookie: `login_nonce=${nonce}` }
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const sessionCookie = parseCookie(setCookie)['__Host-tm_session'];
  return { sessionCookie, status: res.status };
}

const ADMIN_SUB = 'admin-fixed-sub'; // đăng nhập LẠI đúng 1 danh tính Admin thật xuyên suốt file test.
const loginAsAdmin = () => loginAs(ADMIN_EMAIL, 'Admin Thật', ADMIN_SUB);

// ── Test ───────────────────────────────────────────────────────────────────────────

test('FR-1a: đăng nhập lần đầu bằng email khớp ADMIN_BOOTSTRAP_EMAIL -> active + system_role admin', async () => {
  const { sessionCookie, status } = await loginAsAdmin();
  assert.equal(status, 302);
  assert.ok(sessionCookie);
  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: `__Host-tm_session=${sessionCookie}` } });
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.user.status, 'active');
  assert.equal(body.user.systemRole, 'admin');
});

test('FR-2: đăng nhập lần đầu email KHÔNG khớp bootstrap -> pending + system_role user', async () => {
  const { sessionCookie } = await loginAs('member1@drjoy.jp', 'Thành viên 1');
  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: `__Host-tm_session=${sessionCookie}` } });
  const body = await me.json();
  assert.equal(body.user.status, 'pending');
  assert.equal(body.user.systemRole, 'user');
});

test('FR-1: callback thiếu cookie login_nonce -> 400 LOGIN_NONCE_INVALID, không tạo session', async () => {
  const code = await issueAuthCode('nonce-test@drjoy.jp', 'X');
  const res = await fetch(`${base}/api/auth/callback?code=${code}`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'LOGIN_NONCE_INVALID');
});

test('callback thiếu ?code= -> 400', async () => {
  const nonce = await startLogin();
  const res = await fetch(`${base}/api/auth/callback`, { headers: { Cookie: `login_nonce=${nonce}` } });
  assert.equal(res.status, 400);
});

test('code auth.drjoy.vn bị dùng lại (single-use) -> lần 2 thất bại rõ ràng, không sập', async () => {
  const nonce = await startLogin();
  const code = await issueAuthCode('reuse@drjoy.jp', 'Y');
  const first = await fetch(`${base}/api/auth/callback?code=${code}`, { redirect: 'manual', headers: { Cookie: `login_nonce=${nonce}` } });
  assert.equal(first.status, 302);
  const nonce2 = await startLogin();
  const second = await fetch(`${base}/api/auth/callback?code=${code}`, { redirect: 'manual', headers: { Cookie: `login_nonce=${nonce2}` } });
  assert.equal(second.status, 502);
});

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

test('FR-1a: bootstrap Admin fail-closed khi 2 danh tính khác nhau cùng khớp email bootstrap đăng nhập gần như đồng thời -> chỉ đúng 1 người thành admin', async () => {
  const nonceA = await startLogin();
  const codeA = await issueAuthCode(ADMIN_EMAIL, 'Admin A (danh tính khác)');
  const nonceB = await startLogin();
  const codeB = await issueAuthCode(ADMIN_EMAIL, 'Admin B (danh tính khác)');

  const [resA, resB] = await Promise.all([
    fetch(`${base}/api/auth/callback?code=${codeA}`, { redirect: 'manual', headers: { Cookie: `login_nonce=${nonceA}` } }),
    fetch(`${base}/api/auth/callback?code=${codeB}`, { redirect: 'manual', headers: { Cookie: `login_nonce=${nonceB}` } })
  ]);
  assert.equal(resA.status, 302);
  assert.equal(resB.status, 302);

  const admins = db.prepare(
    "SELECT COUNT(*) as n FROM users WHERE email = ? AND system_role = 'admin'"
  ).get(ADMIN_EMAIL) as { n: number };
  // Test trước đó ("đăng nhập lần đầu bằng email khớp bootstrap") đã tạo đúng 1 Admin — bằng chứng
  // fail-closed thật sự nằm ở việc con số này KHÔNG tăng thêm dù có 2 danh tính mới cùng cạnh tranh.
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

  const patch = await fetch(`${base}/api/admin/users/${userId}/status`, {
    method: 'PATCH',
    headers: { Cookie: adminHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'disabled', rowVersion: row.row_version })
  });
  assert.equal(patch.status, 200);

  const meAfter = await fetch(`${base}/api/auth/me`, { headers: { Cookie: userHeader } });
  assert.equal(meAfter.status, 403);
  const body = await meAfter.json();
  assert.equal(body.code, 'ACCOUNT_DISABLED');
});

test('requireAdmin: user thường gọi /admin/users -> 403 FORBIDDEN_ADMIN_ONLY', async () => {
  const { sessionCookie } = await loginAs('not-admin@drjoy.jp', 'Không phải Admin');
  const res = await fetch(`${base}/api/admin/users`, { headers: { Cookie: `__Host-tm_session=${sessionCookie}` } });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'FORBIDDEN_ADMIN_ONLY');
});
