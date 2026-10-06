// QA-2026-09-12: review toàn diện tính năng Project — 2 bug thật tìm thấy khi đọc code + tái hiện
// qua HTTP trên dữ liệu thật.
//
// 1. Rollup task cha (mapProjectTasksWithCalculatedRollups, server/lib/mappers.ts) loại bỏ task con
//    có estimateHours=1 khỏi tổng estimate + % tiến độ của task cha (ngưỡng `estimate > 1` thay vì
//    `estimate > 0`) — trong khi input estimateHours=1 đã được xác nhận là giá trị HỢP LỆ ở chỗ khác
//    (xem test/integration/project-tasks-estimate.test.ts, bugfix cũ). Hậu quả: 1 project toàn task
//    1 giờ luôn hiện estimate=null, tiến độ=0% dù đã làm xong hết.
// 2. Xoá task cha phải xoá cả cây con.
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
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ptask-rollup-delete-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'ptask-rollup-admin-sub');
const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Rollup Delete');
await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
// Leader (không phải Member) vì DELETE task project là hành động Leader-only (AC-8).
const leader = await onboarding.joinAndApprove('ptask-rollup-leader@drjoy.jp', 'Leader rollup', teamId, 'leader', adminSession);
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
  const r = await req('POST', '/api/projects', { ten: '[itest] rollup+delete', teamId, responsibleUserId: leader.userId, ngayBatDau: '2026-09-01' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id;
}

test('QA: rollup task cha KHÔNG được bỏ qua task con có estimateHours=1', async () => {
  const projectId = await taoProject();
  const parent = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Cha', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-20', tienDo: 0
  });
  const parentId = parent.json.id;
  await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Con 1 giờ, xong 100%', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-13',
    tienDo: 100, estimateHours: 1, parentId
  });

  const list = await req('GET', `/api/projects/${projectId}/tasks`);
  const parentRow = (list.json as { id: string; estimateHours: number | null; tienDo: number }[]).find((t) => t.id === parentId);
  assert.equal(parentRow?.estimateHours, 1, 'estimate 1 giờ của con phải được cộng vào tổng của cha');
  assert.equal(parentRow?.tienDo, 100, 'con xong 100% với estimate hợp lệ -> cha cũng phải 100%');
});

test('QA: rollup vẫn cộng đúng khi trộn task con estimate=1 và estimate lớn hơn', async () => {
  const projectId = await taoProject();
  const parent = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Cha 2', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-20', tienDo: 0
  });
  const parentId = parent.json.id;
  await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Con A 1 giờ xong 100%', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-13',
    tienDo: 100, estimateHours: 1, parentId
  });
  await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Con B 3 giờ chưa làm', ngayBatDauDuKien: '2026-09-13', ngayKetThucDuKien: '2026-09-14',
    tienDo: 0, estimateHours: 3, parentId
  });

  const list = await req('GET', `/api/projects/${projectId}/tasks`);
  const parentRow = (list.json as { id: string; estimateHours: number | null; tienDo: number }[]).find((t) => t.id === parentId);
  assert.equal(parentRow?.estimateHours, 4, 'tổng estimate phải là 1 + 3 = 4');
  assert.equal(parentRow?.tienDo, 25, '(1*100% + 3*0%) / 4 = 25%');
});

test('QA: xoá task cha (có con) xoá CẢ CÂY, không chỉ chính task đó', async () => {
  const projectId = await taoProject();
  const parent = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Cha sẽ bị xoá cả cây', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-20', tienDo: 0
  });
  const parentId = Number(parent.json.id);
  const child = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Con trong cây bị xoá', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-13',
    tienDo: 0, parentId
  });
  const childId = Number(child.json.id);

  const del = await req('DELETE', `/api/projects/${projectId}/tasks/${parentId}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.deleted, 2, 'phải xoá cả cha lẫn con (2 dòng)');

  const left = db.prepare('SELECT COUNT(*) AS c FROM project_tasks WHERE id IN (?, ?)').get(parentId, childId) as { c: number };
  assert.equal(left.c, 0, 'task con trong cây bị xoá cũng phải biến mất');
});
