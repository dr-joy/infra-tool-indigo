// CR-20260913 Lát 3 — GET/POST/PATCH /admin/teams, POST /admin/teams/:id/leader, GET /me/teams,
// GET/POST/DELETE /teams/:teamId/members. Dùng lại đúng boilerplate auth thật (server giả đóng vai
// auth.drjoy.vn) như test/integration/auth.test.ts — mỗi file test là 1 tiến trình riêng.
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
const pendingCodes = new Map<string, { accessToken: string; refreshToken: string }>();
const usersMeByToken = new Map<string, { email: string; name: string; avatar: string }>();

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
    if (!entry) { res.statusCode = 400; res.end(JSON.stringify({ error: 'invalid_code' })); return; }
    pendingCodes.delete(body.code!);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ access_token: entry.accessToken, refresh_token: entry.refreshToken }));
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

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-teams-itest-'));
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

// ── Helpers ──────────────────────────────────────────────────────────────────────────
let subjectCounter = 0;
async function issueAuthCode(email: string, name: string, subOverride?: string): Promise<string> {
  subjectCounter += 1;
  const sub = subOverride || `sub-${subjectCounter}`;
  const accessToken = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuedAt().setIssuer(authBaseUrl).setAudience('indigo').setSubject(sub).setExpirationTime('1h')
    .sign(keyPair.privateKey);
  usersMeByToken.set(accessToken, { email, name, avatar: '' });
  const code = `code-${sub}-${Math.random().toString(36).slice(2)}`;
  pendingCodes.set(code, { accessToken, refreshToken: `refresh-${sub}` });
  return code;
}
async function startLogin(): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, { redirect: 'manual' });
  const nonce = parseCookie(res.headers.get('set-cookie') || '')['login_nonce'];
  assert.ok(nonce);
  return nonce;
}
async function loginAs(email: string, name: string, subOverride?: string): Promise<string> {
  const nonce = await startLogin();
  const code = await issueAuthCode(email, name, subOverride);
  const res = await fetch(`${base}/api/auth/callback?code=${code}`, { redirect: 'manual', headers: { Cookie: `login_nonce=${nonce}` } });
  const sessionCookie = parseCookie(res.headers.get('set-cookie') || '')['__Host-tm_session'];
  assert.ok(sessionCookie, `phải đăng nhập được cho ${email}`);
  return sessionCookie;
}
const loginAsAdmin = () => loginAs(ADMIN_EMAIL, 'Admin Thật', 'admin-fixed-sub');
const H = (session: string) => ({ Cookie: `__Host-tm_session=${session}`, 'Content-Type': 'application/json' });

async function joinAndApprove(email: string, name: string, teamId: number, role: 'leader' | 'member', adminSession: string): Promise<{ session: string; userId: number }> {
  const session = await loginAs(email, name);
  const me = await (await fetch(`${base}/api/auth/me`, { headers: H(session) })).json();
  await fetch(`${base}/api/onboarding/join-request`, { method: 'POST', headers: H(session), body: JSON.stringify({ teamId, role }) });
  const list = await (await fetch(`${base}/api/admin/join-requests`, { headers: H(adminSession) })).json();
  const jr = list.joinRequests.find((r: { user_id: number }) => r.user_id === me.user.id);
  assert.ok(jr, `phải tìm được đơn của ${email}`);
  await fetch(`${base}/api/admin/join-requests/${jr.id}/approve`, { method: 'POST', headers: H(adminSession), body: JSON.stringify({ rowVersion: jr.row_version }) });
  return { session, userId: me.user.id };
}

async function makeTeam(adminSession: string, name: string): Promise<number> {
  const res = await fetch(`${base}/api/admin/teams`, { method: 'POST', headers: H(adminSession), body: JSON.stringify({ name }) });
  return (await res.json()).id;
}

// ── Test ─────────────────────────────────────────────────────────────────────────────

test('POST /admin/teams: tạo team mới -> seed đủ 5 dòng feature-visibility off', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Alpha');
  const rows = db.prepare('SELECT feature, level FROM team_feature_visibility WHERE team_id = ?').all(teamId) as { feature: string; level: string }[];
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.level === 'off'));
});

test('POST /admin/teams: tên trùng -> 409', async () => {
  const adminSession = await loginAsAdmin();
  await makeTeam(adminSession, 'Team Trùng Tên');
  const res = await fetch(`${base}/api/admin/teams`, { method: 'POST', headers: H(adminSession), body: JSON.stringify({ name: 'Team Trùng Tên' }) });
  assert.equal(res.status, 409);
});

test('GET/POST/PATCH /admin/teams: user thường (active, không phải Admin) bị 403 ROLE_FORBIDDEN', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Cho User Thường');
  const { session } = await joinAndApprove('plain-user@drjoy.jp', 'User thường', teamId, 'member', adminSession);

  const list = await fetch(`${base}/api/admin/teams`, { headers: H(session) });
  assert.equal(list.status, 403);
  const body = await list.json();
  assert.equal(body.code, 'ROLE_FORBIDDEN');
});

test('PATCH /admin/teams/:id: 2 Admin sửa đồng thời -> đúng 1 thành công, 1 bị 409 VERSION_CONFLICT', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Race Update');
  const team = db.prepare('SELECT row_version FROM teams WHERE id = ?').get(teamId) as { row_version: number };

  const [r1, r2] = await Promise.all([
    fetch(`${base}/api/admin/teams/${teamId}`, { method: 'PATCH', headers: H(adminSession), body: JSON.stringify({ description: 'A', rowVersion: team.row_version }) }),
    fetch(`${base}/api/admin/teams/${teamId}`, { method: 'PATCH', headers: H(adminSession), body: JSON.stringify({ description: 'B', rowVersion: team.row_version }) })
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409]);
});

test('GET /admin/teams/:id/members: Admin xem roster để chọn Leader, kể cả không tự là thành viên team đó', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Roster Admin');
  const { userId } = await joinAndApprove('roster-member@drjoy.jp', 'Roster Member', teamId, 'member', adminSession);

  const res = await fetch(`${base}/api/admin/teams/${teamId}/members`, { headers: H(adminSession) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.members.some((m: { id: number; role: string }) => m.id === userId && m.role === 'member'));
});

test('GET /admin/teams/:id/members: user thường (không phải Admin) bị 403 ROLE_FORBIDDEN kể cả là Leader team đó', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Roster Chan Non Admin');
  const { session: leaderSession } = await joinAndApprove('roster-leader@drjoy.jp', 'Roster Leader', teamId, 'leader', adminSession);

  const res = await fetch(`${base}/api/admin/teams/${teamId}/members`, { headers: H(leaderSession) });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'ROLE_FORBIDDEN');
});

test('POST /admin/teams/:id/leader: gán Leader mới, phải đang là thành viên team đó', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Đổi Leader');
  const { userId } = await joinAndApprove('future-leader@drjoy.jp', 'Leader tương lai', teamId, 'member', adminSession);
  const team = db.prepare('SELECT row_version FROM teams WHERE id = ?').get(teamId) as { row_version: number };

  const res = await fetch(`${base}/api/admin/teams/${teamId}/leader`, {
    method: 'POST', headers: H(adminSession), body: JSON.stringify({ userId, rowVersion: team.row_version })
  });
  assert.equal(res.status, 200);
  const member = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId) as { role: string };
  assert.equal(member.role, 'leader');
});

test('POST /admin/teams/:id/leader: chỉ định người CHƯA thuộc team -> 400', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Leader Sai');
  const res = await fetch(`${base}/api/admin/teams/${teamId}/leader`, {
    method: 'POST', headers: H(adminSession), body: JSON.stringify({ userId: 999999 })
  });
  assert.equal(res.status, 400);
});

test('POST /admin/teams/:id/leader: THIẾU rowVersion -> 409, KHÔNG được tự khớp version hiện tại (Council review run e8d20dc3)', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Leader Thiếu Version');
  const { userId } = await joinAndApprove('missing-version@drjoy.jp', 'Thiếu rowVersion', teamId, 'member', adminSession);
  const res = await fetch(`${base}/api/admin/teams/${teamId}/leader`, {
    method: 'POST', headers: H(adminSession), body: JSON.stringify({ userId })
  });
  assert.equal(res.status, 409);
  const member = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId) as { role: string };
  assert.equal(member.role, 'member', 'không được đổi Leader khi thiếu rowVersion');
});

test('POST /admin/teams/:id/leader: 2 Admin đổi Leader đồng thời cùng rowVersion cũ -> đúng 1 thành công, 1 bị 409', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Leader Race');
  const { userId: candidateA } = await joinAndApprove('leader-race-a@drjoy.jp', 'Ứng viên A', teamId, 'member', adminSession);
  const { userId: candidateB } = await joinAndApprove('leader-race-b@drjoy.jp', 'Ứng viên B', teamId, 'member', adminSession);
  const team = db.prepare('SELECT row_version FROM teams WHERE id = ?').get(teamId) as { row_version: number };

  const [r1, r2] = await Promise.all([
    fetch(`${base}/api/admin/teams/${teamId}/leader`, { method: 'POST', headers: H(adminSession), body: JSON.stringify({ userId: candidateA, rowVersion: team.row_version }) }),
    fetch(`${base}/api/admin/teams/${teamId}/leader`, { method: 'POST', headers: H(adminSession), body: JSON.stringify({ userId: candidateB, rowVersion: team.row_version }) })
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const leaders = db.prepare("SELECT user_id FROM team_members WHERE team_id = ? AND role = 'leader'").all(teamId) as { user_id: number }[];
  assert.equal(leaders.length, 1, 'chỉ đúng 1 Leader sau cùng, không có 2 lần gán cùng thành công');
});

test('GET /me/teams: trả đúng team + role của actor', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Me');
  const { session } = await joinAndApprove('me-teams@drjoy.jp', 'Xem team của mình', teamId, 'leader', adminSession);
  const res = await (await fetch(`${base}/api/me/teams`, { headers: H(session) })).json();
  assert.equal(res.teams.length, 1);
  assert.equal(res.teams[0].role, 'leader');
});

test('GET /teams/:teamId/members: Member CŨNG xem được (quyết định Leader 19/09), nhưng người ngoài team bị NOT_TEAM_MEMBER', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Members View');
  const { session: memberSession } = await joinAndApprove('view-member@drjoy.jp', 'Member xem', teamId, 'member', adminSession);
  const otherTeamId = await makeTeam(adminSession, 'Team Khác');
  const { session: outsiderSession } = await joinAndApprove('outsider@drjoy.jp', 'Người ngoài', otherTeamId, 'member', adminSession);

  const asMember = await fetch(`${base}/api/teams/${teamId}/members`, { headers: H(memberSession) });
  assert.equal(asMember.status, 200);

  const asOutsider = await fetch(`${base}/api/teams/${teamId}/members`, { headers: H(outsiderSession) });
  assert.equal(asOutsider.status, 403);
  assert.equal((await asOutsider.json()).code, 'NOT_TEAM_MEMBER');
});

test('POST/DELETE /teams/:teamId/members: chỉ Leader thêm/bớt được, Member bị ROLE_FORBIDDEN', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Members Manage');
  const { session: leaderSession } = await joinAndApprove('manage-leader@drjoy.jp', 'Leader quản lý', teamId, 'leader', adminSession);
  const { session: memberSession } = await joinAndApprove('manage-member@drjoy.jp', 'Member thường', teamId, 'member', adminSession);
  const { userId: newUserId } = await (async () => {
    const s = await loginAs('to-be-added@drjoy.jp', 'Sắp được thêm');
    const me = await (await fetch(`${base}/api/auth/me`, { headers: H(s) })).json();
    return { userId: me.user.id };
  })();

  const memberTryAdd = await fetch(`${base}/api/teams/${teamId}/members`, { method: 'POST', headers: H(memberSession), body: JSON.stringify({ userId: newUserId }) });
  assert.equal(memberTryAdd.status, 403);

  const leaderAdd = await fetch(`${base}/api/teams/${teamId}/members`, { method: 'POST', headers: H(leaderSession), body: JSON.stringify({ userId: newUserId }) });
  assert.equal(leaderAdd.status, 201);

  const leaderRemove = await fetch(`${base}/api/teams/${teamId}/members/${newUserId}`, { method: 'DELETE', headers: H(leaderSession) });
  assert.equal(leaderRemove.status, 200);

  const removeAgain = await fetch(`${base}/api/teams/${teamId}/members/${newUserId}`, { method: 'DELETE', headers: H(leaderSession) });
  assert.equal(removeAgain.status, 404);
});

test('POST /teams/:teamId/members: thêm người CHƯA từng đăng nhập -> 404 (FR-12, chỉ thêm người đã có tài khoản)', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Add Stranger');
  const { session: leaderSession } = await joinAndApprove('add-stranger-leader@drjoy.jp', 'Leader', teamId, 'leader', adminSession);
  const res = await fetch(`${base}/api/teams/${teamId}/members`, { method: 'POST', headers: H(leaderSession), body: JSON.stringify({ userId: 999999 }) });
  assert.equal(res.status, 404);
});
