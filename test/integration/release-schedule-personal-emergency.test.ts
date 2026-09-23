// CR-20260913 Lát 6 (FR-28a nhánh Khẩn cấp + FR-26 bước 5) — test tích hợp cho
// POST /release/schedule/personal-emergency-tasks (sinh task cá nhân khớp đúng lịch chính thức của
// team) và việc đồng bộ lại giờ khi registration đổi giờ (route MỚI hoàn toàn, không tái dùng
// planReleaseWrite() của nhánh định kỳ).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-release-personal-emg-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'rs-personal-emg-itest-admin-sub');
const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Personal Emergency');
await onboarding.setFeatureVisibility(adminSession, teamId, 'release', 'on');
await onboarding.setFeatureVisibility(adminSession, teamId, 'personal_task', 'on');
const actor = await onboarding.joinAndApprove('rs-personal-emg-itest@drjoy.jp', 'Member Personal Emergency', teamId, 'leader', adminSession);
const authHeaders = flow.H(actor.session);

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

async function req(method: string, p: string, body?: unknown, headers: Record<string, string> = authHeaders) {
  const res = await fetch(`${base}${p}`, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function enableAutogen(): Promise<void> {
  // Idempotent: đọc lại row_version hiện tại (nếu đã có dòng) trước khi PUT, đúng khuôn
  // setFeatureVisibility() ở auth-harness.ts — route dùng optimistic concurrency, gọi lại lần 2 với
  // rowVersion cũ (mặc định -1) sẽ 409 VERSION_CONFLICT.
  const list = await (await fetch(`${base}/api/admin/release-task-autogen`, { headers: flow.H(adminSession) })).json() as
    { settings: { team_id: number; row_version: number }[] };
  const current = list.settings.find((s) => s.team_id === teamId);
  const res = await fetch(`${base}/api/admin/release-task-autogen`, {
    method: 'PUT', headers: flow.H(adminSession),
    body: JSON.stringify({ teamId, enabled: true, rowVersion: current?.row_version })
  });
  if (!res.ok) throw new Error(`enableAutogen thất bại: ${res.status}`);
}

test('FR-28a: Admin CHƯA bật Tab cá nhân cho team -> sinh task bị 403 FEATURE_DISABLED', async () => {
  const day = '2026-10-25';
  await req('POST', '/api/release/schedule/registrations', {
    teamId, deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co'
  });
  const r = await req('POST', '/api/release/schedule/personal-emergency-tasks', { teamId, cycleId: 1 });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'FEATURE_DISABLED');
});

test('FR-28a: sinh task cá nhân khẩn cấp khớp đúng 3 mốc giờ đăng ký thật, ghi_chu render đúng locale', async () => {
  await enableAutogen();
  const day = '2026-10-26';
  const created = await req('POST', '/api/release/schedule/registrations', {
    teamId, deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co'
  });
  assert.equal(created.status, 201);
  const cycleId = created.json.cycleId;

  const template = await req('POST', '/api/release/emergency/templates', { name: 'Tpl JP', content: 'Release lúc {{release.deployAt}}' });
  assert.equal(template.status, 201);
  const definition = await req('POST', '/api/release/emergency/task-definitions', {
    title: '[itest] Thông báo release', timingToken: 'release_deploy', startTime: 'relative',
    relativeOffsetMinutes: 15, scheduleMode: 'custom', templateId: template.json.id
  });
  assert.equal(definition.status, 201);

  const generated = await req('POST', '/api/release/schedule/personal-emergency-tasks', { teamId, cycleId, locale: 'ja' });
  assert.equal(generated.status, 201, JSON.stringify(generated.json));
  assert.equal(generated.json.created, 1);

  const task = db.prepare("SELECT * FROM tasks WHERE origin_ref = ?").get(definition.json.id) as Record<string, unknown>;
  assert.ok(task, 'task cá nhân phải được sinh ra');
  assert.equal(task.ngay_cu_the, day);
  assert.equal(task.gio_bat_dau, '15:15', 'mỏ neo release_deploy (15:00) + offset 15 phút');
  assert.equal(task.owner_user_id, actor.userId);
  assert.match(String(task.release_month), /^emergency:.*:ja$/);
  // {{release.deployAt}} luôn phản ánh giờ RELEASE CHÍNH THỨC đã đăng ký (15:00 VN -> 17:00 JST) — KHÁC
  // với gio_bat_dau riêng của task này (15:15, đã cộng thêm relativeOffsetMinutes). FR-30 chốt: giờ
  // trong nội dung phải điền động từ dữ liệu đăng ký thật, không phải giờ bắt đầu riêng của từng task.
  assert.match(String(task.ghi_chu), /17:00/, 'ghi_chu phải render đúng JST theo giờ release CHÍNH THỨC (15:00 VN -> 17:00 JST)');

  // Sinh lại lần 2 -> không tạo trùng (skippedExisting).
  const again = await req('POST', '/api/release/schedule/personal-emergency-tasks', { teamId, cycleId, locale: 'ja' });
  assert.equal(again.json.created, 0);
  assert.equal(again.json.skippedExisting, 1);
});

test('FR-26 bước 5: registration đổi giờ -> task cá nhân đã sinh TỰ CẬP NHẬT lại giờ + nội dung', async () => {
  await enableAutogen();
  const day = '2026-10-27';
  const created = await req('POST', '/api/release/schedule/registrations', {
    teamId, deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co'
  });
  const cycleId = created.json.cycleId;
  const definition = await req('POST', '/api/release/emergency/task-definitions', {
    title: '[itest] Sync test', timingToken: 'release_deploy', startTime: 'relative', relativeOffsetMinutes: 0, scheduleMode: 'custom'
  });
  await req('POST', '/api/release/schedule/personal-emergency-tasks', { teamId, cycleId, locale: 'vi' });
  const before = db.prepare('SELECT gio_bat_dau, ngay_cu_the FROM tasks WHERE origin_ref = ?').get(definition.json.id) as { gio_bat_dau: string; ngay_cu_the: string };
  assert.equal(before.gio_bat_dau, '15:00');

  const patch = await req('PATCH', `/api/release/schedule/registrations/${created.json.id}`, {
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '16:30' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co', rowVersion: created.json.rowVersion
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.json));

  const after1 = db.prepare('SELECT gio_bat_dau FROM tasks WHERE origin_ref = ?').get(definition.json.id) as { gio_bat_dau: string };
  assert.equal(after1.gio_bat_dau, '16:30', 'task cá nhân phải tự cập nhật đúng giờ MỚI, không cần ai bấm gì thêm');
});

test('FR-26 bước 6: huỷ registration -> task cá nhân CHƯA hoàn thành tự huỷ, task ĐÃ hoàn thành giữ nguyên lịch sử', async () => {
  await enableAutogen();
  const day = '2026-10-28';
  const created = await req('POST', '/api/release/schedule/registrations', {
    teamId, deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co'
  });
  const cycleId = created.json.cycleId;
  const defPending = await req('POST', '/api/release/emergency/task-definitions', {
    title: '[itest] Huy - chua xong', timingToken: 'release_deploy', startTime: 'relative', relativeOffsetMinutes: 0, scheduleMode: 'custom'
  });
  const defDone = await req('POST', '/api/release/emergency/task-definitions', {
    title: '[itest] Huy - da xong', timingToken: 'release_deploy', startTime: 'relative', relativeOffsetMinutes: 5, scheduleMode: 'custom'
  });
  await req('POST', '/api/release/schedule/personal-emergency-tasks', { teamId, cycleId, locale: 'vi' });
  db.prepare("UPDATE tasks SET trang_thai = 'da_hoan_thanh' WHERE origin_ref = ?").run(defDone.json.id);

  const cancel = await req('POST', `/api/release/schedule/registrations/${created.json.id}/cancel`, { rowVersion: created.json.rowVersion });
  assert.equal(cancel.status, 200);

  const pendingTask = db.prepare('SELECT trang_thai FROM tasks WHERE origin_ref = ?').get(defPending.json.id) as { trang_thai: string };
  assert.equal(pendingTask.trang_thai, 'canceled');
  const doneTask = db.prepare('SELECT trang_thai FROM tasks WHERE origin_ref = ?').get(defDone.json.id) as { trang_thai: string };
  assert.equal(doneTask.trang_thai, 'da_hoan_thanh', 'task đã hoàn thành phải giữ nguyên làm lịch sử, không bị huỷ theo');
});
