// CR-20260913 FR-17: GET/PUT /teams/:teamId/gantt-colors — bảng màu Gantt cố định 15 màu theo User
// thật, thay cho tra màu theo PIC chữ tự do cũ. Đọc: Leader+Member. Gán: Leader-only, unique theo
// (team, color_key) — 2 người trong cùng team không được trùng màu.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-gantt-colors-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'gantt-colors-admin-sub');
const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Gantt Colors');
await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
const leader = await onboarding.joinAndApprove('gantt-colors-leader@drjoy.jp', 'Leader màu', teamId, 'leader', adminSession);
const member = await onboarding.joinAndApprove('gantt-colors-member@drjoy.jp', 'Member màu', teamId, 'member', adminSession);
const leaderHeaders = flow.H(leader.session);
const memberHeaders = flow.H(member.session);

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

async function req(headers: Record<string, string>, method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

test('GET gantt-colors: chưa gán màu ai -> mảng rỗng', async () => {
  const r = await req(leaderHeaders, 'GET', `/api/teams/${teamId}/gantt-colors`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.colors, []);
});

test('PUT gantt-colors: Leader gán màu hợp lệ cho Member -> 200, đọc lại đúng màu', async () => {
  const r = await req(leaderHeaders, 'PUT', `/api/teams/${teamId}/gantt-colors/${member.userId}`, { colorKey: 'teal' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.colorKey, 'teal');

  const list = await req(memberHeaders, 'GET', `/api/teams/${teamId}/gantt-colors`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.colors, [{ userId: member.userId, colorKey: 'teal', rowVersion: 1 }]);
});

test('PUT gantt-colors: màu không nằm trong 15 màu cố định -> 400', async () => {
  const r = await req(leaderHeaders, 'PUT', `/api/teams/${teamId}/gantt-colors/${member.userId}`, { colorKey: '#123456' });
  assert.equal(r.status, 400);
});

test('PUT gantt-colors: Member (không phải Leader) gán màu -> 403', async () => {
  const r = await req(memberHeaders, 'PUT', `/api/teams/${teamId}/gantt-colors/${leader.userId}`, { colorKey: 'blue' });
  assert.equal(r.status, 403);
});

test('PUT gantt-colors: 2 người trong cùng team trùng màu -> 409 COLOR_TAKEN', async () => {
  const first = await req(leaderHeaders, 'PUT', `/api/teams/${teamId}/gantt-colors/${leader.userId}`, { colorKey: 'red' });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const clash = await req(leaderHeaders, 'PUT', `/api/teams/${teamId}/gantt-colors/${member.userId}`, { colorKey: 'red', rowVersion: 1 });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.code, 'COLOR_TAKEN');
});

test('PUT gantt-colors: đổi màu đã gán (rowVersion đúng) -> 200; rowVersion sai -> 409', async () => {
  const wrong = await req(leaderHeaders, 'PUT', `/api/teams/${teamId}/gantt-colors/${member.userId}`, { colorKey: 'sky', rowVersion: 999 });
  assert.equal(wrong.status, 409);

  const ok = await req(leaderHeaders, 'PUT', `/api/teams/${teamId}/gantt-colors/${member.userId}`, { colorKey: 'sky', rowVersion: 1 });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.colorKey, 'sky');
  assert.equal(ok.json.rowVersion, 2);
});

test('PUT gantt-colors: colorKey=null xoá màu đã gán', async () => {
  const clear = await req(leaderHeaders, 'PUT', `/api/teams/${teamId}/gantt-colors/${member.userId}`, { colorKey: null, rowVersion: 2 });
  assert.equal(clear.status, 200, JSON.stringify(clear.json));
  assert.equal(clear.json.colorKey, null);
});
