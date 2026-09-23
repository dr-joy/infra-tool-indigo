// CR-20260822-announcement-release-khan-cap-nhieu-team FR-3 — bảng emergency_release_batches:
// nguồn canonical team/hệ thống của 1 đợt khẩn cấp. Test tích hợp Express thật + DB cô lập.
//
// CR-20260913 Lát 6 (§6.3): retrofit auth cho server/routes/schedules.ts — các route dưới đây giờ đòi
// phiên đăng nhập thật + actor thuộc ≥1 team đang Bật "Task cá nhân" (policyKind 'personal_task', y hệt
// server/routes/tasks.ts) — dùng chung harness OIDC giả ở fixtures/auth-harness.ts (đúng boilerplate
// test/integration/tasks.test.ts đã dùng).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-emg-batches-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'emg-batches-itest-admin-sub');
const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Emergency Batches');
await onboarding.setFeatureVisibility(adminSession, teamId, 'personal_task', 'on');
const actor = await onboarding.joinAndApprove('emg-batches-itest@drjoy.jp', 'Người test emergency batches', teamId, 'member', adminSession);
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

function taskGiaiDoan1(releaseKey: string, tenTask = 'Confirm thông tin') {
  return {
    releaseDate: '2099-09-14',
    releaseKey,
    tasks: [{ tenTask, gioBatDau: '10:00', ngayCuThe: '2099-09-14' }]
  };
}

test('POST giai đoạn 1 CÓ teams/systems -> 201, ghi được batch row', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-1`;
  const r = await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey), teams: ['Dev5', 'Dev12'], systems: ['Dr.JOY']
  });
  assert.equal(r.status, 201);
  const batch = db.prepare('SELECT * FROM emergency_release_batches WHERE release_month = ?').get(releaseKey) as
    { teams: string; systems: string } | undefined;
  assert.ok(batch, 'phải ghi batch row');
  assert.deepEqual(JSON.parse(batch!.teams), ['Dev12', 'Dev5']); // sort ổn định
  assert.deepEqual(JSON.parse(batch!.systems), ['Dr.JOY']);
});

test('POST giai đoạn 1 THIẾU teams -> 400, không tạo task lẫn batch', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-2`;
  const r = await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey), systems: ['Dr.JOY']
  });
  assert.equal(r.status, 400);
  const total = (db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE release_month = ?').get(releaseKey) as { c: number }).c;
  assert.equal(total, 0);
});

test('POST giai đoạn 1 THIẾU systems -> 400', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-3`;
  const r = await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey), teams: ['Dev5']
  });
  assert.equal(r.status, 400);
});

// Lưu ý: POST 2 lần vào CÙNG release_month không có `force`/`replaceMatching` đã bị chặn 409
// `EMERGENCY_RELEASE_EXISTS` bởi cổng CŨ (không liên quan gì tới CR này) TRƯỚC KHI chạm tới cổng
// kiểm teams/systems mới — nên 2 test dưới đây dùng `replaceMatching:true` để thật sự chạm cổng mới.
test('POST giai đoạn 1 lần 2 (replaceMatching) với ĐÚNG teams/systems cũ -> 201, no-op trên batch (idempotent)', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-4`;
  await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey, 'Task A'), teams: ['Dev5'], systems: ['Dr.JOY']
  });
  const r2 = await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey, 'Task B'), teams: ['Dev5'], systems: ['Dr.JOY'], replaceMatching: true
  });
  assert.equal(r2.status, 201);
  const total = (db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE release_month = ?').get(releaseKey) as { c: number }).c;
  assert.equal(total, 2, 'cả 2 task (tên khác nhau) đều được tạo, không bị coi là trùng đợt');
});

test('POST giai đoạn 1 lần 2 (replaceMatching) với teams KHÁC -> 409 EMERGENCY_BATCH_TEAMS_MISMATCH', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-5`;
  await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey, 'Task A'), teams: ['Dev5'], systems: ['Dr.JOY']
  });
  const r2 = await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey, 'Task B'), teams: ['Dev12'], systems: ['Dr.JOY'], replaceMatching: true
  });
  assert.equal(r2.status, 409);
  assert.equal(r2.json.code, 'EMERGENCY_BATCH_TEAMS_MISMATCH');
});

// Codex review §4.49 High #1: `force=true` KHÔNG được phép lách cổng mismatch — trước đây route chỉ
// kiểm mismatch khi `!body.force`, nên `force=true` với teams khác có thể xoá cả task lẫn batch row rồi
// ghi đè bằng dữ liệu mới, hoàn toàn bỏ qua guard bất biến mà PATCH đang giữ (AC-29/AC-31/AC-31b).
test('POST giai đoạn 1 với force=true + teams KHÁC dữ liệu đã lưu -> VẪN 409, KHÔNG xoá/ghi đè batch', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-force1`;
  await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey, 'Task A'), teams: ['Dev5'], systems: ['Dr.JOY']
  });
  const r2 = await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey, 'Task B'), teams: ['Dev12'], systems: ['Dr.JOY'], force: true
  });
  assert.equal(r2.status, 409);
  assert.equal(r2.json.code, 'EMERGENCY_BATCH_TEAMS_MISMATCH');
  const batch = db.prepare('SELECT * FROM emergency_release_batches WHERE release_month = ?').get(releaseKey) as { teams: string } | undefined;
  assert.ok(batch, 'batch row KHÔNG bị xoá bởi force');
  assert.deepEqual(JSON.parse(batch!.teams), ['Dev5'], 'dữ liệu batch cũ vẫn còn nguyên, không bị ghi đè');
  const total = (db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE release_month = ?').get(releaseKey) as { c: number }).c;
  assert.equal(total, 1, 'task cũ (Task A) không bị xoá vì request bị từ chối trước khi vào transaction');
});

test('POST giai đoạn 1 với force=true + teams TRÙNG dữ liệu đã lưu -> vẫn 201, xoá-tạo-lại task như thiết kế, batch row giữ nguyên', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-force2`;
  await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey, 'Task A'), teams: ['Dev5'], systems: ['Dr.JOY']
  });
  const r2 = await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey, 'Task B'), teams: ['Dev5'], systems: ['Dr.JOY'], force: true
  });
  assert.equal(r2.status, 201);
  const rows = db.prepare('SELECT ten_task FROM tasks WHERE release_month = ?').all(releaseKey) as { ten_task: string }[];
  assert.deepEqual(rows.map((r) => r.ten_task), ['Task B'], 'force xoá task cũ (Task A) và chỉ còn task mới (Task B)');
  const batch = db.prepare('SELECT * FROM emergency_release_batches WHERE release_month = ?').get(releaseKey) as { teams: string };
  assert.deepEqual(JSON.parse(batch.teams), ['Dev5']);
});

test('POST giai đoạn 2 (releaseKey có hậu tố :schedule) -> KHÔNG cần teams/systems, KHÔNG đụng batch', async () => {
  const baseKey = `emergency:itest-${Date.now()}-6`;
  await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(baseKey, 'Task giai đoạn 1'), teams: ['Dev5'], systems: ['Dr.JOY']
  });
  const r2 = await req('POST', '/api/schedules/emergency-release/tasks', taskGiaiDoan1(`${baseKey}:schedule`, 'Announcement E6'));
  assert.equal(r2.status, 201);
  const batch = db.prepare('SELECT * FROM emergency_release_batches WHERE release_month = ?').get(baseKey);
  assert.ok(batch, 'batch của giai đoạn 1 vẫn còn nguyên, không bị đụng bởi call giai đoạn 2');
  const batchSchedule = db.prepare('SELECT * FROM emergency_release_batches WHERE release_month = ?').get(`${baseKey}:schedule`);
  assert.equal(batchSchedule, undefined, 'không tạo batch row riêng cho key giai đoạn 2');
});

// Codex review §4.49 Medium #4: UI checkbox chỉ cho chọn Dr.JOY/Pr.JOY nhưng đó không bảo vệ được API
// gọi trực tiếp — backend phải tự đóng enum/kích thước.
test('POST giai đoạn 1: systems chứa giá trị ngoài enum Dr.JOY/Pr.JOY -> 400', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-enum1`;
  const r = await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey), teams: ['Dev5'], systems: ['Hệ thống lạ']
  });
  assert.equal(r.status, 400);
});

test('POST giai đoạn 1: quá 20 team -> 400', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-enum2`;
  const teams = Array.from({ length: 21 }, (_, i) => `Dev${i}`);
  const r = await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey), teams, systems: ['Dr.JOY']
  });
  assert.equal(r.status, 400);
});

test('PATCH batch: systems chứa giá trị ngoài enum -> 400', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-enum3`;
  await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey), teams: ['Dev5'], systems: ['Dr.JOY']
  });
  const r = await req('PATCH', `/api/schedules/emergency-release/batches/${encodeURIComponent(releaseKey)}`, {
    teams: ['Dev5'], systems: ['Hệ thống lạ']
  });
  assert.equal(r.status, 400);
});

// ── PATCH /schedules/emergency-release/batches/:releaseMonth ──────────────────

test('PATCH batch chưa tồn tại -> 404', async () => {
  const r = await req('PATCH', '/api/schedules/emergency-release/batches/khong-ton-tai', { teams: ['Dev5'], systems: ['Dr.JOY'] });
  assert.equal(r.status, 404);
});

test('PATCH batch tồn tại, KHÔNG có task Announcement nào không-idle -> 200, ghi đè teams/systems', async () => {
  const releaseKey = `emergency:itest-${Date.now()}-7`;
  await req('POST', '/api/schedules/emergency-release/tasks', {
    ...taskGiaiDoan1(releaseKey), teams: ['Dev5'], systems: ['Dr.JOY']
  });
  const r = await req('PATCH', `/api/schedules/emergency-release/batches/${encodeURIComponent(releaseKey)}`, {
    teams: ['Dev5', 'Dev12'], systems: ['Dr.JOY', 'Pr.JOY']
  });
  assert.equal(r.status, 200);
  const batch = db.prepare('SELECT * FROM emergency_release_batches WHERE release_month = ?').get(releaseKey) as { teams: string; systems: string };
  assert.deepEqual(JSON.parse(batch.teams), ['Dev12', 'Dev5']);
  assert.deepEqual(JSON.parse(batch.systems), ['Dr.JOY', 'Pr.JOY']);
});
