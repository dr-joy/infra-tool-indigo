// QA-2026-09-12: review toàn diện tính năng Release — POST tạo mới template/definition (cả 4 route:
// release templates, emergency templates, regular definitions, emergency definitions) nhận `id` tự đặt
// tay (hoặc tự sinh theo Date.now() nếu không truyền), nhưng trước đây KHÔNG kiểm trùng trước khi INSERT
// -> gửi lại đúng id đã tồn tại vỡ ràng buộc PRIMARY KEY của SQLite, lộ ra 500 "Lỗi server nội bộ" thay
// vì báo lỗi rõ ràng. Test tái hiện + xác nhận đã sửa cho cả 4 route.
//
// CR-20260913 Lát 6 (FR-28a): 4 route này giờ đòi phiên đăng nhập thật + actor phải thuộc ≥1 team đang
// Bật "Task cá nhân" (policyKind 'personal_task', cùng khuôn task cá nhân/Mind Map) — dùng chung harness
// OIDC giả ở fixtures/auth-harness.ts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-release-defs-crud-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'release-defs-crud-itest-admin-sub');
const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Release Defs CRUD');
await onboarding.setFeatureVisibility(adminSession, teamId, 'personal_task', 'on');
const actor = await onboarding.joinAndApprove('release-defs-crud-itest@drjoy.jp', 'Người test Release Defs CRUD', teamId, 'member', adminSession);
const authHeaders = flow.H(actor.session);

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

async function req(method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method, headers: authHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

test('QA: POST /release/templates với id trùng -> 409 (không phải 500)', async () => {
  const first = await req('POST', '/api/release/templates', { id: 'qa-dup-tpl', name: 'A', content: '' });
  assert.equal(first.status, 201);
  const second = await req('POST', '/api/release/templates', { id: 'qa-dup-tpl', name: 'B', content: '' });
  assert.equal(second.status, 409);
  assert.match(String(second.json.message), /tồn tại/);
});

test('QA: POST /release/emergency/templates với id trùng -> 409', async () => {
  const first = await req('POST', '/api/release/emergency/templates', { id: 'qa-dup-emg-tpl', name: 'A', content: '' });
  assert.equal(first.status, 201);
  const second = await req('POST', '/api/release/emergency/templates', { id: 'qa-dup-emg-tpl', name: 'B', content: '' });
  assert.equal(second.status, 409);
});

test('QA: POST /release/task-definitions với id trùng -> 409, không làm hỏng dòng đã có', async () => {
  const first = await req('POST', '/api/release/task-definitions', { id: 'qa-dup-def', title: 'A', startTime: '10:00', dateToken: 'release.date' });
  assert.equal(first.status, 201);
  const second = await req('POST', '/api/release/task-definitions', { id: 'qa-dup-def', title: 'B (không được ghi đè)', startTime: '11:00', dateToken: 'release.date' });
  assert.equal(second.status, 409);

  const list = await req('GET', '/api/release/task-definitions');
  const row = (list.json as { id: string; title: string }[]).find((d) => d.id === 'qa-dup-def');
  assert.equal(row?.title, 'A', 'dòng gốc phải giữ nguyên, không bị request thứ 2 đụng vào');
});

test('QA: POST /release/emergency/task-definitions với id trùng -> 409', async () => {
  const first = await req('POST', '/api/release/emergency/task-definitions', { id: 'qa-dup-emg-def', title: 'A', timingToken: 'hotfix', startTime: 'immediate' });
  assert.equal(first.status, 201);
  const second = await req('POST', '/api/release/emergency/task-definitions', { id: 'qa-dup-emg-def', title: 'B', timingToken: 'hotfix', startTime: 'immediate' });
  assert.equal(second.status, 409);
});

// ── SEC (CR-20260913 Lát 6, FR-28a) — chưa đăng nhập / khác chủ sở hữu ─────────────────────────────
test('SEC: GET /release/task-definitions chưa đăng nhập -> 401', async () => {
  const r = await fetch(`${base}/api/release/task-definitions`);
  assert.equal(r.status, 401);
});

test('SEC: mỗi User chỉ thấy template/definition CỦA MÌNH, không thấy của người khác', async () => {
  const otherActor = await onboarding.joinAndApprove('release-defs-crud-itest-other@drjoy.jp', 'Người khác', teamId, 'member', adminSession);
  const otherHeaders = flow.H(otherActor.session);

  const mine = await req('POST', '/api/release/task-definitions', { id: 'qa-owner-mine', title: '[itest] của tôi', startTime: '10:00', dateToken: 'release.date' });
  assert.equal(mine.status, 201);

  const listOther = await (await fetch(`${base}/api/release/task-definitions`, { headers: otherHeaders })).json() as { id: string }[];
  assert.ok(!listOther.some((d) => d.id === 'qa-owner-mine'), 'người khác không được thấy definition của tôi');

  const patchByOther = await fetch(`${base}/api/release/task-definitions/qa-owner-mine`, {
    method: 'PATCH', headers: otherHeaders, body: JSON.stringify({ title: 'Sửa trộm', startTime: '10:00', dateToken: 'release.date' })
  });
  assert.equal(patchByOther.status, 403, 'người khác không sửa được definition không phải của mình');
});
