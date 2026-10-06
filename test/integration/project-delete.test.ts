// Xoá project: route DELETE /api/projects/:id phải xoá project_tasks rồi xoá projects mà không lỗi FK.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-project-delete-risk-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'project-delete-risk-admin-sub');
const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Delete Risk');
await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
const leader = await onboarding.joinAndApprove('project-delete-risk-leader@drjoy.jp', 'Leader risk', teamId, 'leader', adminSession);
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

async function taoProject(ten: string): Promise<number> {
  const r = await req('POST', '/api/projects', { ten, teamId, responsibleUserId: leader.userId, ngayBatDau: '2026-09-01' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id;
}

test('xoá project (có task con) trả 200 và dọn sạch project + project_tasks', async () => {
  const projectId = await taoProject('[itest] Project xoá');
  const t = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Task trong project', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-20', tienDo: 0
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));

  const del = await req('DELETE', `/api/projects/${projectId}`);
  assert.equal(del.status, 200, `Xoá project phải trả 200: ${JSON.stringify(del.json)}`);

  const project = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId);
  assert.equal(project, undefined, 'project phải bị xoá thật');
  const tasks = db.prepare('SELECT COUNT(*) AS c FROM project_tasks WHERE project_id = ?').get(projectId) as { c: number };
  assert.equal(tasks.c, 0, 'project_tasks của project đã xoá phải được dọn theo');
});
