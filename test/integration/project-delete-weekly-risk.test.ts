// BL-20260924-004: xoá 1 project đã có Risk trong báo cáo tuần (weekly_project_risks) trả lỗi 500 —
// weekly_project_risks.project_id là FK cứng NOT NULL REFERENCES projects(id), KHÔNG có ON DELETE.
// Route DELETE /api/projects/:id trước đây chỉ xoá project_tasks rồi xoá thẳng projects, không dọn
// weekly_project_risks, nên SQLite (foreign_keys=ON) chặn bằng lỗi FOREIGN KEY constraint failed.
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
await onboarding.setFeatureVisibility(adminSession, teamId, 'weekly_report', 'on');
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

async function taoReportKind(code: string): Promise<string> {
  const r = await req('POST', '/api/weeks/report-kinds', {
    teamId, code, label: code, renderMode: 'internal_markdown', requiresProjectRisk: true
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.rowId;
}

test('BUG BL-20260924-004: xoá project đã có Risk báo cáo tuần không được lỗi 500', async () => {
  const projectId = await taoProject('[itest] Project có Risk');
  const reportKindId = await taoReportKind('risk_delete_test');
  const weekStart = '2026-09-14';

  const putRisk = await req('PUT', `/api/weeks/${weekStart}/risks`, {
    teamId, reportKindId,
    risks: [{ projectId, risk: 'Rủi ro test', mitigation: 'Giảm thiểu test' }]
  });
  assert.equal(putRisk.status, 200, JSON.stringify(putRisk.json));

  const before = db.prepare('SELECT COUNT(*) AS c FROM weekly_project_risks WHERE project_id = ?').get(projectId) as { c: number };
  assert.equal(before.c, 1, 'setup phải tạo được đúng 1 dòng risk cho project này');

  const del = await req('DELETE', `/api/projects/${projectId}`);
  assert.equal(del.status, 200, `Xoá project phải trả 200, không phải lỗi FK: ${JSON.stringify(del.json)}`);

  const project = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId);
  assert.equal(project, undefined, 'project phải bị xoá thật');

  const after_ = db.prepare('SELECT COUNT(*) AS c FROM weekly_project_risks WHERE project_id = ?').get(projectId) as { c: number };
  assert.equal(after_.c, 0, 'weekly_project_risks của project đã xoá phải được dọn theo (FK cứng, không thể để sót)');
});
