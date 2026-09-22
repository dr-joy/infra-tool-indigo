// Bugfix: task lá trong Project cho phép estimate = 1 giờ.
// Trước đây route chặn `estimateHours <= 1` (loại luôn giá trị 1), trong khi cùng khái niệm ở tầng
// "giai đoạn phân công" (`saveTaskAssignments`) lại cho phép `estimate > 0` — hai luật khác nhau cho cùng
// một field, và 1 giờ là giá trị thật rất hay gặp khi ước lượng WBS nhỏ. Test tái hiện lỗi trước khi sửa.
//
// CR-20260913 Lát 4: /api/projects[...] giờ đòi phiên đăng nhập thật + team + responsibleUserId
// (không còn `pic` chuỗi tự do) — dùng chung harness OIDC giả ở fixtures/auth-harness.ts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ptask-est-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'ptask-est-admin-sub');
const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Estimate');
await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
const leader = await onboarding.joinAndApprove('ptask-est-leader@drjoy.jp', 'Leader estimate', teamId, 'leader', adminSession);
const authHeaders = flow.H(leader.session);

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

async function taoProject(): Promise<number> {
  const r = await req('POST', '/api/projects', { ten: '[itest] estimate', teamId, responsibleUserId: leader.userId, ngayBatDau: '2026-08-25' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id;
}

test('POST task lá: estimateHours=1 phải được chấp nhận (khớp luật assignment estimate > 0)', async () => {
  const projectId = await taoProject();
  const r = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Task 1 giờ', ngayBatDauDuKien: '2026-08-25', ngayKetThucDuKien: '2026-08-25', estimateHours: 1
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.estimateHours, 1);
});

test('PATCH task lá: estimateHours=1 phải được chấp nhận', async () => {
  const projectId = await taoProject();
  const created = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Task ban đầu', ngayBatDauDuKien: '2026-08-25', ngayKetThucDuKien: '2026-08-25', estimateHours: 5
  });
  const r = await req('PATCH', `/api/projects/${projectId}/tasks/${created.json.id}`, {
    tieuDe: 'Task ban đầu', ngayBatDauDuKien: '2026-08-25', ngayKetThucDuKien: '2026-08-25', estimateHours: 1,
    rowVersion: created.json.rowVersion
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.estimateHours, 1);
});

test('estimateHours=0 hoặc âm vẫn bị từ chối (chỉ nới cho >=1, không bỏ hẳn validate)', async () => {
  const projectId = await taoProject();
  for (const gio of [0, -1]) {
    const r = await req('POST', `/api/projects/${projectId}/tasks`, {
      tieuDe: 'Task xấu', ngayBatDauDuKien: '2026-08-25', ngayKetThucDuKien: '2026-08-25', estimateHours: gio
    });
    assert.equal(r.status, 400, `estimateHours=${gio} phải bị từ chối`);
  }
});
