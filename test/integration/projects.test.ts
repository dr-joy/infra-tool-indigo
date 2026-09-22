// Test tích hợp cho server/routes/projects.ts, tập trung vào PATCH /projects/:projectId/tasks/execution-order
// (BL-20260818-003: 5 message lỗi bị hỏng encoding/mojibake, nay đã sửa đúng UTF-8 — test khoá lại đúng chữ).
//
// CR-20260913 Lát 4: /api/projects[...] giờ đòi phiên đăng nhập thật + team + responsibleUserId
// (không còn `pic` chuỗi tự do) — dùng chung harness OIDC giả ở fixtures/auth-harness.ts. Route
// execution-order là Leader-only (AC-8 "kéo đổi thứ tự thực thi Gantt") -> actor dùng ở đây là Leader.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-projects-itest-'));
process.env.APPDATA = tmpAppData;
process.env.AUTH_BASE_URL = mockAuth.authBaseUrl;
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

const flow = loginFlow(() => base, mockAuth.issueAuthCode);
const onboarding = makeOnboardingHelpers(() => base, flow);
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'projects-itest-admin-sub');
const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Projects');
await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
const leader = await onboarding.joinAndApprove('projects-itest-leader@drjoy.jp', 'Leader projects', teamId, 'leader', adminSession);
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

async function createProject(ten: string) {
  const r = await req('POST', '/api/projects', { ten, teamId, responsibleUserId: leader.userId, ngayBatDau: '2099-01-01' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id as number;
}

async function createLeafTask(projectId: number, tieuDe: string) {
  const r = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe, ngayBatDauDuKien: '2099-01-01', ngayKetThucDuKien: '2099-01-02', tienDo: 0
  });
  assert.equal(r.status, 201);
  return r.json.id as number;
}

test('PATCH /projects/:projectId/tasks/execution-order: projectId không hợp lệ -> 400 "Project không hợp lệ"', async () => {
  const r = await req('PATCH', '/api/projects/abc/tasks/execution-order', { taskIds: [1] });
  assert.equal(r.status, 400);
  assert.equal(r.json.message, 'Project không hợp lệ');
});

test('PATCH /projects/:projectId/tasks/execution-order: project không tồn tại -> 404 "Không tìm thấy project"', async () => {
  const r = await req('PATCH', '/api/projects/999999/tasks/execution-order', { taskIds: [1] });
  assert.equal(r.status, 404);
  assert.equal(r.json.message, 'Không tìm thấy project');
});

test('PATCH /projects/:projectId/tasks/execution-order: taskIds rỗng -> 400 "Thứ tự task không hợp lệ"', async () => {
  const projectId = await createProject('[itest] execution-order taskIds rỗng');
  const r = await req('PATCH', `/api/projects/${projectId}/tasks/execution-order`, { taskIds: [] });
  assert.equal(r.status, 400);
  assert.equal(r.json.message, 'Thứ tự task không hợp lệ');
});

test('PATCH /projects/:projectId/tasks/execution-order: taskIds không khớp đúng tập leaf task của project -> 400 "Chỉ có thể sắp xếp các task thực thi trong cùng project"', async () => {
  const projectId = await createProject('[itest] execution-order khac project');
  await createLeafTask(projectId, '[itest] task A');
  const r = await req('PATCH', `/api/projects/${projectId}/tasks/execution-order`, { taskIds: [999999] });
  assert.equal(r.status, 400);
  assert.equal(r.json.message, 'Chỉ có thể sắp xếp các task thực thi trong cùng project');
});

test('PATCH /projects/:projectId/tasks/execution-order: đúng leaf task -> 200, thứ tự execution_order được cập nhật', async () => {
  const projectId = await createProject('[itest] execution-order thanh cong');
  const taskA = await createLeafTask(projectId, '[itest] task A');
  const taskB = await createLeafTask(projectId, '[itest] task B');
  const r = await req('PATCH', `/api/projects/${projectId}/tasks/execution-order`, { taskIds: [taskB, taskA] });
  assert.equal(r.status, 200);
  const ids = r.json.map((t: { id: number }) => t.id);
  assert.deepEqual(ids, [taskB, taskA]);
});

test('PATCH /projects/:projectId/tasks/execution-order: lỗi DB giữa chừng -> 500 "Không thể sắp xếp task trên Gantt"', async () => {
  const projectId = await createProject('[itest] execution-order loi DB');
  const taskA = await createLeafTask(projectId, '[itest] task A');

  db.exec(`
    CREATE TRIGGER itest_block_execution_order
    BEFORE UPDATE OF execution_order ON project_tasks
    BEGIN
      SELECT RAISE(ABORT, 'itest: chan update execution_order de gia lap loi DB');
    END;
  `);
  try {
    const r = await req('PATCH', `/api/projects/${projectId}/tasks/execution-order`, { taskIds: [taskA] });
    assert.equal(r.status, 500);
    assert.equal(r.json.message, 'Không thể sắp xếp task trên Gantt');
  } finally {
    db.exec('DROP TRIGGER itest_block_execution_order');
  }
});
