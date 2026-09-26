// 2026-09-26 (docs/exchanges/2026-09-26.md) — Admin bật/tắt riêng cho TỪNG USER quyền dùng "vùng cá
// nhân" trong Release (server/lib/authorize.ts:assertPersonalReleaseAreaEnabled()). Test tích hợp cho
// GET/PUT /admin/release-personal-area-users + /admin/release-personal-area-pref, và việc route thật
// (GET /release/templates — đại diện cho cả nhóm route thuộc vùng cá nhân) tự kiểm lại đầy đủ.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-personal-area-admin-itest-'));
process.env.APPDATA = tmpAppData;
process.env.AUTH_BASE_URL = mockAuth.authBaseUrl;
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

const flow = loginFlow(() => base, mockAuth.issueAuthCode);
const onboarding = makeOnboardingHelpers(() => base, flow);
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'personal-area-admin-itest-admin-sub');

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

async function req(method: string, p: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

test('GET /admin/release-personal-area-users: user thuộc team CHƯA đủ 3 điều kiện -> không xuất hiện trong danh sách', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team PA chua du dieu kien');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'personal_task', 'on');
  // Cố ý KHÔNG bật 'release' + KHÔNG bật autogen team — chưa đủ 3 điều kiện.
  const actor = await onboarding.joinAndApprove('pa-not-eligible@drjoy.jp', 'Chua du dieu kien', teamId, 'member', adminSession);

  const list = await req('GET', '/api/admin/release-personal-area-users', undefined, flow.H(adminSession));
  assert.equal(list.status, 200);
  assert.ok(!list.json.users.some((u: { id: number }) => u.id === actor.userId), 'user chưa đủ điều kiện không được liệt kê');

  // Route ghi (PUT) phải từ chối user không đủ điều kiện — không cho Admin bật nhầm.
  const put = await req('PUT', '/api/admin/release-personal-area-pref', { userId: actor.userId, enabled: true, rowVersion: 0 }, flow.H(adminSession));
  assert.equal(put.status, 404, JSON.stringify(put.json));
});

test('Đủ 3 điều kiện + Admin CHƯA bật riêng -> route vùng cá nhân vẫn 403; Admin bật xong -> 200', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team PA du dieu kien');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'release', 'on');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'personal_task', 'on');
  await onboarding.enableAutogen(adminSession, teamId);
  const actor = await onboarding.joinAndApprove('pa-eligible-not-granted@drjoy.jp', 'Du dieu kien chua duoc cap', teamId, 'member', adminSession);
  const authHeaders = flow.H(actor.session);

  const statusBefore = await req('GET', '/api/release/schedule/personal-area-status', undefined, authHeaders);
  assert.equal(statusBefore.status, 200);
  assert.equal(statusBefore.json.enabled, false, 'đủ điều kiện team nhưng Admin chưa bật riêng -> vẫn false');

  const blocked = await req('GET', '/api/release/templates', undefined, authHeaders);
  assert.equal(blocked.status, 403, JSON.stringify(blocked.json));
  assert.equal(blocked.json.code, 'FEATURE_DISABLED');

  // Đúng user này giờ phải xuất hiện trong danh sách Admin thấy được.
  const list = await req('GET', '/api/admin/release-personal-area-users', undefined, flow.H(adminSession));
  const row = list.json.users.find((u: { id: number; enabled: number }) => u.id === actor.userId);
  assert.ok(row, 'user đủ điều kiện phải xuất hiện trong danh sách Admin');
  assert.equal(row.enabled, 0);

  await onboarding.enablePersonalAreaPref(adminSession, actor.userId);

  const statusAfter = await req('GET', '/api/release/schedule/personal-area-status', undefined, authHeaders);
  assert.equal(statusAfter.json.enabled, true);

  const allowed = await req('GET', '/api/release/templates', undefined, authHeaders);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
});

test('PUT /admin/release-personal-area-pref: rowVersion cũ -> 409 VERSION_CONFLICT', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team PA version conflict');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'release', 'on');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'personal_task', 'on');
  await onboarding.enableAutogen(adminSession, teamId);
  const actor = await onboarding.joinAndApprove('pa-version-conflict@drjoy.jp', 'Version conflict', teamId, 'member', adminSession);
  await onboarding.enablePersonalAreaPref(adminSession, actor.userId);

  const stale = await req('PUT', '/api/admin/release-personal-area-pref', { userId: actor.userId, enabled: false, rowVersion: 0 }, flow.H(adminSession));
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'VERSION_CONFLICT');
});

test('Không phải Admin gọi GET/PUT /admin/release-personal-area-* -> 403 ROLE_FORBIDDEN', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team PA khong phai admin');
  const actor = await onboarding.joinAndApprove('pa-not-admin@drjoy.jp', 'Khong phai Admin', teamId, 'member', adminSession);
  const authHeaders = flow.H(actor.session);

  const list = await req('GET', '/api/admin/release-personal-area-users', undefined, authHeaders);
  assert.equal(list.status, 403);
  assert.equal(list.json.code, 'ROLE_FORBIDDEN');

  const put = await req('PUT', '/api/admin/release-personal-area-pref', { userId: actor.userId, enabled: true, rowVersion: 0 }, authHeaders);
  assert.equal(put.status, 403);
  assert.equal(put.json.code, 'ROLE_FORBIDDEN');
});
