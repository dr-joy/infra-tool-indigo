// CR-20260913 FR-11a — GET /api/audit: Admin đọc metadata toàn cục, Leader/Member đọc chi tiết đầy đủ
// đúng team mình (sửa 19/09 lần 14, thêm Member).
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

const keyPair = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
const jwksBody = { keys: [jwk] };
const usersMeByToken = new Map<string, { email: string; name: string; avatar: string }>();

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
    const info = usersMeByToken.get(token);
    if (!info) { res.statusCode = 401; res.end(JSON.stringify({ error: 'invalid_token' })); return; }
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

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-audit-itest-'));
process.env.APPDATA = tmpAppData;
process.env.AUTH_BASE_URL = authBaseUrl;
process.env.AUTH_CLIENT = 'indigo';
process.env.APP_CALLBACK_URL = 'http://127.0.0.1:0/api/auth/callback';
process.env.ADMIN_BOOTSTRAP_EMAIL = ADMIN_EMAIL;

const { app } = await import('../../server/app.js');

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

let subjectCounter = 0;
async function issueAuthCode(email: string, name: string, subOverride?: string): Promise<{ accessToken: string; refreshToken: string }> {
  subjectCounter += 1;
  const sub = subOverride || `sub-${subjectCounter}`;
  const accessToken = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuedAt().setIssuer(authBaseUrl).setAudience('indigo').setSubject(sub).setExpirationTime('1h')
    .sign(keyPair.privateKey);
  usersMeByToken.set(accessToken, { email, name, avatar: '' });
  return { accessToken, refreshToken: `refresh-${sub}` };
}
async function startLogin(): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, { redirect: 'manual' });
  const nonce = parseCookie(res.headers.get('set-cookie') || '')['login_nonce'];
  assert.ok(nonce);
  return nonce;
}
async function loginAs(email: string, name: string, subOverride?: string): Promise<string> {
  const nonce = await startLogin();
  const { accessToken, refreshToken } = await issueAuthCode(email, name, subOverride);
  const res = await fetch(`${base}/api/auth/callback?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`, { redirect: 'manual', headers: { Cookie: `login_nonce=${nonce}` } });
  const sessionCookie = parseCookie(res.headers.get('set-cookie') || '')['__Host-tm_session'];
  assert.ok(sessionCookie, `phải đăng nhập được cho ${email}`);
  // 2026-09-25: Admin bootstrap tạo ra ở trạng thái 'pending' — tự hoàn tất onboarding (tự động duyệt vì
  // là Admin) để mọi chỗ gọi loginAs(ADMIN_EMAIL) vẫn nhận lại phiên dùng NGAY được như trước.
  const meH = { Cookie: `__Host-tm_session=${sessionCookie}`, 'Content-Type': 'application/json' };
  const me = await (await fetch(`${base}/api/auth/me`, { headers: meH })).json() as { user: { status: string; systemRole: string } };
  if (me.user.status === 'pending' && me.user.systemRole === 'admin') {
    const jr = await fetch(`${base}/api/onboarding/join-request`, {
      method: 'POST', headers: meH, body: JSON.stringify({ newTeamName: `[bootstrap] ${email}`, role: 'leader' })
    });
    assert.ok(jr.ok, `tự hoàn tất onboarding cho Admin bootstrap ${email} thất bại (${jr.status})`);
  }
  return sessionCookie;
}
const loginAsAdmin = () => loginAs(ADMIN_EMAIL, 'Admin Thật', 'admin-fixed-sub');
const H = (session: string) => ({ Cookie: `__Host-tm_session=${session}`, 'Content-Type': 'application/json' });

async function makeTeam(adminSession: string, name: string): Promise<number> {
  const res = await fetch(`${base}/api/admin/teams`, { method: 'POST', headers: H(adminSession), body: JSON.stringify({ name }) });
  return (await res.json()).id;
}

async function joinAndApprove(email: string, name: string, teamId: number, role: 'leader' | 'member', adminSession: string): Promise<string> {
  const session = await loginAs(email, name);
  const me = await (await fetch(`${base}/api/auth/me`, { headers: H(session) })).json();
  await fetch(`${base}/api/onboarding/join-request`, { method: 'POST', headers: H(session), body: JSON.stringify({ teamId, role }) });
  const list = await (await fetch(`${base}/api/admin/join-requests`, { headers: H(adminSession) })).json();
  const jr = list.joinRequests.find((r: { user_id: number }) => r.user_id === me.user.id);
  await fetch(`${base}/api/admin/join-requests/${jr.id}/approve`, { method: 'POST', headers: H(adminSession), body: JSON.stringify({ rowVersion: jr.row_version }) });
  return session;
}

// ── Test ─────────────────────────────────────────────────────────────────────────────

test('GET /api/audit: Admin đọc toàn cục, chỉ metadata (không có payload)', async () => {
  const adminSession = await loginAsAdmin();
  await makeTeam(adminSession, 'Team Audit Admin View'); // tự sinh 1 dòng audit team.create

  const res = await fetch(`${base}/api/audit`, { headers: H(adminSession) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.entries.length > 0);
  assert.ok(body.entries.every((e: Record<string, unknown>) => !('payload' in e)), 'Admin không được thấy payload chi tiết');
});

test('GET /api/audit: Leader/Member xem chi tiết đầy đủ (có payload) đúng team mình, KHÔNG xem được team khác', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Audit Leader View');
  const leaderSession = await joinAndApprove('audit-leader@drjoy.jp', 'Leader xem audit', teamId, 'leader', adminSession);
  const memberSession = await joinAndApprove('audit-member@drjoy.jp', 'Member xem audit', teamId, 'member', adminSession);

  // Bật 1 feature để sinh audit gắn với đúng team này.
  const visibility = await (await fetch(`${base}/api/admin/feature-visibility`, { headers: H(adminSession) })).json();
  const row = visibility.visibility.find((v: { team_id: number; feature: string }) => v.team_id === teamId && v.feature === 'project');
  await fetch(`${base}/api/admin/feature-visibility`, {
    method: 'PATCH', headers: H(adminSession), body: JSON.stringify({ teamId, feature: 'project', level: 'on', rowVersion: row.row_version })
  });

  const leaderRes = await (await fetch(`${base}/api/audit?teamId=${teamId}`, { headers: H(leaderSession) })).json();
  assert.ok(leaderRes.entries.some((e: Record<string, unknown>) => 'payload' in e), 'Leader phải thấy payload chi tiết');

  const memberRes = await (await fetch(`${base}/api/audit?teamId=${teamId}`, { headers: H(memberSession) })).json();
  assert.ok(memberRes.entries.some((e: Record<string, unknown>) => 'payload' in e), 'Member (sửa 19/09 lần 14) cũng phải thấy payload chi tiết');

  const otherTeamId = await makeTeam(adminSession, 'Team Audit Khác');
  const forbidden = await fetch(`${base}/api/audit?teamId=${otherTeamId}`, { headers: H(leaderSession) });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, 'NOT_TEAM_MEMBER');
});

test('GET /api/audit: Leader/Member không truyền teamId -> 403 (chỉ Admin xem được toàn cục)', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Audit No TeamId');
  const memberSession = await joinAndApprove('audit-no-teamid@drjoy.jp', 'Member không truyền teamId', teamId, 'member', adminSession);
  const res = await fetch(`${base}/api/audit`, { headers: H(memberSession) });
  assert.equal(res.status, 403);
});

test('GET /api/audit: cascade FR-7a (tắt project tự tắt weekly_report) ghi ĐỦ 2 dòng audit cùng team_id', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Audit Cascade');
  const leaderSession = await joinAndApprove('audit-cascade-leader@drjoy.jp', 'Leader cascade', teamId, 'leader', adminSession);

  for (const feature of ['project', 'weekly_report']) {
    const r = await (await fetch(`${base}/api/admin/feature-visibility`, { headers: H(adminSession) })).json();
    const row = r.visibility.find((v: { team_id: number; feature: string }) => v.team_id === teamId && v.feature === feature);
    await fetch(`${base}/api/admin/feature-visibility`, {
      method: 'PATCH', headers: H(adminSession), body: JSON.stringify({ teamId, feature, level: 'on', rowVersion: row.row_version })
    });
  }
  const r2 = await (await fetch(`${base}/api/admin/feature-visibility`, { headers: H(adminSession) })).json();
  const projectRow = r2.visibility.find((v: { team_id: number; feature: string }) => v.team_id === teamId && v.feature === 'project');
  await fetch(`${base}/api/admin/feature-visibility`, {
    method: 'PATCH', headers: H(adminSession), body: JSON.stringify({ teamId, feature: 'project', level: 'off', rowVersion: projectRow.row_version })
  });

  const audit = await (await fetch(`${base}/api/audit?teamId=${teamId}`, { headers: H(leaderSession) })).json();
  const actions = audit.entries.map((e: { action: string }) => e.action);
  assert.ok(actions.includes('feature_visibility.update'));
  assert.ok(actions.includes('feature_visibility.cascade_off'));
});

test('GET /api/audit: teamId không phải số hợp lệ -> 400 rõ ràng, không phải 500 (Council review run e8d20dc3)', async () => {
  const adminSession = await loginAsAdmin();
  const res = await fetch(`${base}/api/audit?teamId=khong-phai-so`, { headers: H(adminSession) });
  assert.equal(res.status, 400);
});
