// CR-20260913 Lát 3 — GET/PATCH /admin/feature-visibility (FR-7/FR-7a), GET/PUT /admin/release-coordinator (FR-9).
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

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-admin-config-itest-'));
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
  return sessionCookie;
}
const loginAsAdmin = () => loginAs(ADMIN_EMAIL, 'Admin Thật', 'admin-fixed-sub');
const H = (session: string) => ({ Cookie: `__Host-tm_session=${session}`, 'Content-Type': 'application/json' });

async function makeTeam(adminSession: string, name: string): Promise<number> {
  const res = await fetch(`${base}/api/admin/teams`, { method: 'POST', headers: H(adminSession), body: JSON.stringify({ name }) });
  return (await res.json()).id;
}

function visibilityRow(teamId: number, feature: string): { level: string; row_version: number } {
  return db.prepare('SELECT level, row_version FROM team_feature_visibility WHERE team_id = ? AND feature = ?').get(teamId, feature) as { level: string; row_version: number };
}

// ── Test ─────────────────────────────────────────────────────────────────────────────

test('PATCH /admin/feature-visibility: bật 1 feature thành công, ghi audit', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Visibility A');
  const row = visibilityRow(teamId, 'project');
  const res = await fetch(`${base}/api/admin/feature-visibility`, {
    method: 'PATCH', headers: H(adminSession),
    body: JSON.stringify({ teamId, feature: 'project', level: 'on', rowVersion: row.row_version })
  });
  assert.equal(res.status, 200);
  assert.equal(visibilityRow(teamId, 'project').level, 'on');

  const audit = db.prepare("SELECT action FROM audit_log WHERE team_id = ? AND action = 'feature_visibility.update'").get(teamId);
  assert.ok(audit);
});

test('PATCH /admin/feature-visibility: FR-7a — tắt project TỰ tắt weekly_report cùng transaction, kèm audit cascade riêng', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Visibility B');
  // Bật cả 2 trước.
  for (const feature of ['project', 'weekly_report']) {
    const row = visibilityRow(teamId, feature);
    await fetch(`${base}/api/admin/feature-visibility`, {
      method: 'PATCH', headers: H(adminSession),
      body: JSON.stringify({ teamId, feature, level: 'on', rowVersion: row.row_version })
    });
  }
  assert.equal(visibilityRow(teamId, 'weekly_report').level, 'on');

  // Tắt project -> weekly_report phải tự tắt theo.
  const projectRow = visibilityRow(teamId, 'project');
  const res = await fetch(`${base}/api/admin/feature-visibility`, {
    method: 'PATCH', headers: H(adminSession),
    body: JSON.stringify({ teamId, feature: 'project', level: 'off', rowVersion: projectRow.row_version })
  });
  assert.equal(res.status, 200);
  assert.equal(visibilityRow(teamId, 'weekly_report').level, 'off');
  const cascadeAudit = db.prepare("SELECT 1 FROM audit_log WHERE team_id = ? AND action = 'feature_visibility.cascade_off'").get(teamId);
  assert.ok(cascadeAudit);

  // Bật lại project -> weekly_report KHÔNG tự bật lại theo (bất biến 1 chiều).
  const projectRow2 = visibilityRow(teamId, 'project');
  await fetch(`${base}/api/admin/feature-visibility`, {
    method: 'PATCH', headers: H(adminSession),
    body: JSON.stringify({ teamId, feature: 'project', level: 'on', rowVersion: projectRow2.row_version })
  });
  assert.equal(visibilityRow(teamId, 'weekly_report').level, 'off');
});

test('PATCH /admin/feature-visibility: 2 Admin đổi cùng ô đồng thời -> đúng 1 thành công, 1 bị 409', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Visibility Race');
  const row = visibilityRow(teamId, 'mind_map');

  const [r1, r2] = await Promise.all([
    fetch(`${base}/api/admin/feature-visibility`, { method: 'PATCH', headers: H(adminSession), body: JSON.stringify({ teamId, feature: 'mind_map', level: 'on', rowVersion: row.row_version }) }),
    fetch(`${base}/api/admin/feature-visibility`, { method: 'PATCH', headers: H(adminSession), body: JSON.stringify({ teamId, feature: 'mind_map', level: 'on', rowVersion: row.row_version }) })
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
});

test('GET/PATCH /admin/feature-visibility: user thường bị 403 ROLE_FORBIDDEN', async () => {
  const adminSession = await loginAsAdmin();
  const teamId = await makeTeam(adminSession, 'Team Visibility Deny');
  const plainSession = await loginAs('plain-config@drjoy.jp', 'User thường');
  const res = await fetch(`${base}/api/admin/feature-visibility`, { headers: H(plainSession) });
  assert.equal(res.status, 403);
  void teamId;
});

test('GET/PUT /admin/release-coordinator: đổi team điều phối thành công, ghi audit; race 2 Admin -> 1 thành công 1 conflict', async () => {
  const adminSession = await loginAsAdmin();
  const teamA = await makeTeam(adminSession, 'Team Coordinator A');
  const teamB = await makeTeam(adminSession, 'Team Coordinator B');

  const before = await (await fetch(`${base}/api/admin/release-coordinator`, { headers: H(adminSession) })).json();
  const set1 = await fetch(`${base}/api/admin/release-coordinator`, {
    method: 'PUT', headers: H(adminSession), body: JSON.stringify({ teamId: teamA, rowVersion: before.row_version })
  });
  assert.equal(set1.status, 200);
  const audit = db.prepare("SELECT 1 FROM audit_log WHERE action = 'release_coordinator.change' AND team_id = ?").get(teamA);
  assert.ok(audit);

  const after1 = await (await fetch(`${base}/api/admin/release-coordinator`, { headers: H(adminSession) })).json();
  const [r1, r2] = await Promise.all([
    fetch(`${base}/api/admin/release-coordinator`, { method: 'PUT', headers: H(adminSession), body: JSON.stringify({ teamId: teamB, rowVersion: after1.row_version }) }),
    fetch(`${base}/api/admin/release-coordinator`, { method: 'PUT', headers: H(adminSession), body: JSON.stringify({ teamId: teamA, rowVersion: after1.row_version }) })
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
});

test('PUT /admin/release-coordinator: teamId không tồn tại -> 404', async () => {
  const adminSession = await loginAsAdmin();
  const res = await fetch(`${base}/api/admin/release-coordinator`, { method: 'PUT', headers: H(adminSession), body: JSON.stringify({ teamId: 999999, rowVersion: 1 }) });
  assert.equal(res.status, 404);
});
