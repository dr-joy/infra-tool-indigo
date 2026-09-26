// 2026-09-26 (docs/exchanges/2026-09-26.md) — VÁ TẠM THỜI: GET /admin/legacy-data/backup +
// POST /admin/legacy-data/migrate (server/routes/admin-legacy-migration-temp.ts). Xoá test này cùng
// lúc xoá route khi Leader dùng xong trên production.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-legacy-migration-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'legacy-migration-itest-admin-sub');

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

test('GET /admin/legacy-data/backup: Admin tải về file SQLite hợp lệ, có sẵn magic header', async () => {
  const res = await fetch(`${base}/api/admin/legacy-data/backup`, { headers: flow.H(adminSession) });
  if (res.status !== 200) assert.fail(`status ${res.status}: ${await res.text()}`);
  assert.equal(res.headers.get('content-disposition')?.includes('attachment'), true);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 16).toString('utf8'), 'SQLite format 3\x00', 'phải là file SQLite thật, không phải rỗng/hỏng');
});

test('GET /admin/legacy-data/backup: user thường (không phải Admin) -> 403 ROLE_FORBIDDEN', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Legacy Migration Khong Admin');
  const notAdmin = await onboarding.joinAndApprove('legacy-migration-not-admin@drjoy.jp', 'Khong phai Admin', teamId, 'member', adminSession);
  const res = await fetch(`${base}/api/admin/legacy-data/backup`, { headers: flow.H(notAdmin.session) });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'ROLE_FORBIDDEN');
});

test('POST /admin/legacy-data/migrate: gán dữ liệu cũ về team Dev13 + về chính Admin, ghi audit', async () => {
  const res = await fetch(`${base}/api/admin/legacy-data/migrate`, { method: 'POST', headers: flow.H(adminSession) });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(typeof body.teamId === 'number');
  assert.ok(typeof body.releaseTemplates === 'number');

  const me = await (await fetch(`${base}/api/auth/me`, { headers: flow.H(adminSession) })).json() as { user: { id: number } };
  const seededTemplate = db.prepare('SELECT owner_user_id FROM release_templates WHERE owner_user_id = ? LIMIT 1').get(me.user.id);
  assert.ok(seededTemplate, 'ít nhất 1 release_templates seed cũ phải được gán về đúng Admin đang gọi');

  const audit = db.prepare("SELECT 1 FROM audit_log WHERE action = 'legacy_data.migrate' AND team_id = ?").get(body.teamId);
  assert.ok(audit, 'phải ghi audit_log cho hành động di trú');
});

test('POST /admin/legacy-data/migrate: user thường (không phải Admin) -> 403 ROLE_FORBIDDEN', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Legacy Migrate Khong Admin 2');
  const notAdmin = await onboarding.joinAndApprove('legacy-migrate-not-admin-2@drjoy.jp', 'Khong phai Admin 2', teamId, 'member', adminSession);
  const res = await fetch(`${base}/api/admin/legacy-data/migrate`, { method: 'POST', headers: flow.H(notAdmin.session) });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'ROLE_FORBIDDEN');
});
