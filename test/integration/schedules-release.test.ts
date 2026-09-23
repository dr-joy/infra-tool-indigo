// CR-20260814-hop-nhat-dong-bo-definition-xuong-task — test tích hợp cho luật ghi duy nhất
// definition -> task release (FR-1..FR-10). Chạy Express thật + DB cô lập.
//
// CR-20260913 Lát 4: helper của file này gọi /api/tasks (task cá nhân) để dựng dữ liệu — route đó giờ
// đòi phiên đăng nhập thật (FR-14/FR-31), dùng chung harness OIDC giả ở fixtures/auth-harness.ts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-schedules-release-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'schedules-release-itest-admin-sub');
const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Schedules Release');
await onboarding.setFeatureVisibility(adminSession, teamId, 'personal_task', 'on');
const actor = await onboarding.joinAndApprove('schedules-release-itest@drjoy.jp', 'Người test schedules-release', teamId, 'member', adminSession);
const authHeaders = flow.H(actor.session);

// CR-20260913 Lát 6 (§6.3) — retrofit auth: team KHÔNG bật "Task cá nhân" + 1 actor thứ 2 CÙNG team
// gốc nhưng CHƯA duyệt vào team nào (dùng để kiểm cách ly owner_user_id chéo actor).
const teamNoFeature = await onboarding.makeTeam(adminSession, '[itest] Team Schedules Release (personal_task OFF)');
const actorNoFeature = await onboarding.joinAndApprove('schedules-release-itest-nofeature@drjoy.jp', 'Người test không Bật Task cá nhân', teamNoFeature, 'member', adminSession);
const authHeadersNoFeature = flow.H(actorNoFeature.session);
const actorOther = await onboarding.joinAndApprove('schedules-release-itest-other@drjoy.jp', 'Người test khác (owner scoping)', teamId, 'member', adminSession);
const authHeadersOther = flow.H(actorOther.session);

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

let seq = 0;
function uniq(prefix: string) { seq += 1; return `${prefix}-${Date.now()}-${seq}`; }

async function makeDefinition(overrides: Record<string, unknown> = {}) {
  const id = uniq('def');
  const body = { id, title: uniq('[itest] Task'), startTime: '10:00', dateToken: 'release.date', ...overrides };
  const created = await req('POST', '/api/release/task-definitions', body);
  assert.equal(created.status, 201);
  return { id, ...body };
}

test('AC-1: lưu 1 definition lần đầu -> tạo task mới với origin_ref, KHÔNG lỗi', async () => {
  const releaseDate = '2099-02-14';
  const definition = await makeDefinition({ title: '[itest] AC1 first save' });
  const r = await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definition.id });
  assert.equal(r.status, 201);
  assert.equal(r.json.created, 1);
  const row = db.prepare('SELECT * FROM tasks WHERE origin_ref = ?').get(definition.id) as Record<string, unknown>;
  assert.equal(row.ten_task, '[itest] AC1 first save');
  assert.equal(row.release_date, releaseDate);
});

test('AC-1: sửa giờ bắt đầu của definition rồi lưu lại -> UPDATE tại chỗ, id task KHÔNG đổi, trang_thai giữ nguyên', async () => {
  const releaseDate = '2099-02-14';
  const definition = await makeDefinition({ title: '[itest] AC1 update', startTime: '09:00' });
  const first = await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definition.id });
  assert.equal(first.status, 201);
  const before = db.prepare('SELECT * FROM tasks WHERE origin_ref = ?').get(definition.id) as Record<string, unknown>;
  db.prepare("UPDATE tasks SET trang_thai = 'dang_tien_hanh' WHERE id = ?").run(before.id);

  await req('PATCH', `/api/release/task-definitions/${definition.id}`, { ...definition, startTime: '11:00' });
  const second = await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definition.id });
  assert.equal(second.status, 200);
  assert.equal(second.json.updated, 1);
  assert.ok(second.json.changedFields.includes('gioBatDau'));

  const after = db.prepare('SELECT * FROM tasks WHERE origin_ref = ?').get(definition.id) as Record<string, unknown>;
  assert.equal(after.id, before.id);
  assert.equal(after.trang_thai, 'dang_tien_hanh');
  assert.equal(after.gio_bat_dau, '11:00');
});

test('AC-2 (hồi quy BUG-20260814): đổi TÊN definition rồi lưu lại -> đúng MỘT task tồn tại, không sinh task mới, không xoá task cũ', async () => {
  const releaseDate = '2099-02-14';
  const definition = await makeDefinition({ title: '[itest] Tên A' });
  await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definition.id });
  const before = db.prepare('SELECT * FROM tasks WHERE origin_ref = ?').get(definition.id) as Record<string, unknown>;

  await req('PATCH', `/api/release/task-definitions/${definition.id}`, { ...definition, title: '[itest] Tên B (đã đổi)' });
  const r = await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definition.id });
  assert.equal(r.status, 200);

  const rows = db.prepare('SELECT * FROM tasks WHERE origin_ref = ?').all(definition.id) as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, before.id);
  assert.equal(rows[0].ten_task, '[itest] Tên B (đã đổi)');
});

test('AC-12 (cổng máy, regression route): task tên trùng NHƯNG khác origin_ref không bị xoá khi lưu definition khác', async () => {
  const releaseDate = '2099-02-14';
  const sameTitle = '[itest] Tên trùng nhau';
  const defA = await makeDefinition({ title: sameTitle });
  const defB = await makeDefinition({ title: sameTitle });
  await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: defA.id });
  await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: defB.id });

  await req('PATCH', `/api/release/task-definitions/${defA.id}`, { ...defA, title: '[itest] Tên A đã đổi khác hẳn' });
  await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: defA.id });

  const stillThere = db.prepare('SELECT * FROM tasks WHERE origin_ref = ?').get(defB.id) as Record<string, unknown> | undefined;
  assert.ok(stillThere, 'task của definition B (cùng tên cũ với A) không được bị xoá');
  assert.equal(stillThere!.ten_task, sameTitle);
});

test('AC-3: task đã hoàn thành -> lưu definition/đồng bộ KHÔNG đụng, báo bỏ qua lý do done', async () => {
  const releaseMonth = '2099-03';
  const releaseDate = '2099-03-14';
  const definition = await makeDefinition({ title: '[itest] AC3 done' });
  await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definition.id });
  const row = db.prepare('SELECT * FROM tasks WHERE origin_ref = ?').get(definition.id) as Record<string, unknown>;
  db.prepare("UPDATE tasks SET trang_thai = 'da_hoan_thanh' WHERE id = ?").run(row.id);

  await req('PATCH', `/api/release/task-definitions/${definition.id}`, { ...definition, title: '[itest] AC3 đổi tên sau khi done' });
  const preview = await req('POST', '/api/schedules/release/sync-preview', { releaseMonth });
  const skip = preview.json.skipped.find((s: { originRef: string }) => s.originRef === definition.id);
  assert.equal(skip?.reason, 'done');

  const stillOldTitle = db.prepare('SELECT ten_task FROM tasks WHERE id = ?').get(row.id) as { ten_task: string };
  assert.equal(stillOldTitle.ten_task, '[itest] AC3 done');
});

test('AC-4/AC-4b: definition KHÔNG template -> Note giữ nguyên; định nghĩa CÓ template -> Note ghi theo template', async () => {
  const releaseMonth = '2099-04';
  const releaseDate = '2099-04-14';
  const definition = await makeDefinition({ title: '[itest] AC4 no template', note: 'placeholder' });
  await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definition.id });
  const row = db.prepare('SELECT * FROM tasks WHERE origin_ref = ?').get(definition.id) as Record<string, unknown>;
  db.prepare('UPDATE tasks SET ghi_chu = ? WHERE id = ?').run('Note tự tay, không liên quan template', row.id);

  await req('PATCH', `/api/release/task-definitions/${definition.id}`, { ...definition, title: '[itest] AC4 renamed' });
  const applied = await req('POST', '/api/schedules/release/sync', { releaseMonth });
  assert.equal(applied.status, 200);

  const after = db.prepare('SELECT ghi_chu, ten_task FROM tasks WHERE id = ?').get(row.id) as Record<string, unknown>;
  assert.equal(after.ghi_chu, 'Note tự tay, không liên quan template');
  assert.equal(after.ten_task, '[itest] AC4 renamed');
});

test('AC-8: đồng bộ 2 lần liên tiếp -> lần 2 báo không có gì cần cập nhật (idempotent)', async () => {
  const releaseMonth = '2099-05';
  const releaseDate = '2099-05-14';
  const definition = await makeDefinition({ title: '[itest] AC8 idempotent' });
  await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definition.id });
  await req('PATCH', `/api/release/task-definitions/${definition.id}`, { ...definition, title: '[itest] AC8 changed once' });

  const first = await req('POST', '/api/schedules/release/sync', { releaseMonth });
  assert.equal(first.json.updated, 1);
  const second = await req('POST', '/api/schedules/release/sync', { releaseMonth });
  assert.equal(second.json.updated, 0);
});

test('AC-13: FE không còn gửi ghiChu/aiNote tự dựng — request thiếu definitionId bị từ chối 400 (không âm thầm dùng payload cũ)', async () => {
  const r = await req('POST', '/api/schedules/regular-release/task', { releaseDate: '2099-06-14' });
  assert.equal(r.status, 400);
  assert.match(String(r.json.message), /definitionId/);
});

test('FR-5 (drift): definition sửa xong nhưng CHƯA đồng bộ -> endpoint drift thấy lệch mà không cần bấm gì', async () => {
  const releaseMonth = '2099-07';
  const releaseDate = '2099-07-14';
  const definition = await makeDefinition({ title: '[itest] drift before' });
  await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definition.id });
  await req('PATCH', `/api/release/task-definitions/${definition.id}`, { ...definition, title: '[itest] drift AFTER' });

  const drift = await req('GET', `/api/schedules/release/drift?releaseMonth=${releaseMonth}`);
  assert.equal(drift.status, 200);
  const hit = drift.json.lech.find((item: { originRef: string }) => item.originRef === definition.id);
  assert.ok(hit, 'phải thấy definition vừa sửa nằm trong danh sách lệch');
  assert.ok(hit.fields.includes('tenTask'));

  await req('POST', '/api/schedules/release/sync', { releaseMonth });
  const afterSync = await req('GET', `/api/schedules/release/drift?releaseMonth=${releaseMonth}`);
  assert.ok(!afterSync.json.lech.some((item: { originRef: string }) => item.originRef === definition.id));
});

test('FR-5 (drift): task release thiếu origin_ref -> liệt kê ở nhóm khongXacDinhNguon, không báo lệch', async () => {
  const releaseMonth = '2099-08';
  const created = await req('POST', '/api/tasks', {
    tenTask: '[itest] legacy no origin_ref', loaiTask: 'dinh_ky', gioBatDau: '10:00',
    gioKetThuc: '10:15', lapLaiKieu: 'hang_ngay'
  });
  db.prepare('UPDATE tasks SET release_month=?, ngay_cu_the=?, release_date=? WHERE id=?')
    .run(releaseMonth, '2099-08-15', '2099-08-15', created.json.id);

  const drift = await req('GET', `/api/schedules/release/drift?releaseMonth=${releaseMonth}`);
  assert.ok(drift.json.khongXacDinhNguon.some((item: { taskId: number }) => item.taskId === created.json.id));
  assert.ok(!drift.json.lech.some((item: { taskId: number }) => item.taskId === created.json.id));
});

// ── CR-20260913 Lát 6 (§6.3) — retrofit auth cho schedules.ts: chặn đúng vai trò + cách ly owner ──

test('auth: chưa đăng nhập (không cookie phiên) -> mọi route đều 401, không lộ dữ liệu', async () => {
  const noAuthHeaders = { 'Content-Type': 'application/json' };
  const r1 = await req('POST', '/api/schedules/regular-release/tasks', { releaseDate: '2099-09-01', tasks: [] }, noAuthHeaders);
  assert.equal(r1.status, 401);
  const r2 = await req('POST', '/api/schedules/release/sync-preview', { releaseMonth: '2099-09' }, noAuthHeaders);
  assert.equal(r2.status, 401);
  const r3 = await req('GET', '/api/schedules/release/drift?releaseMonth=2099-09', undefined, noAuthHeaders);
  assert.equal(r3.status, 401);
  const r4 = await req('POST', '/api/schedules/emergency-release/tasks', { releaseDate: '2099-09-01', tasks: [] }, noAuthHeaders);
  assert.equal(r4.status, 401);
});

test('auth: actor thuộc team CHƯA Bật "Task cá nhân" -> 403 FEATURE_DISABLED, không tạo task nào', async () => {
  const r = await req('POST', '/api/schedules/regular-release/tasks', {
    releaseDate: '2099-09-02',
    tasks: [{ tenTask: '[itest] khong duoc tao', gioBatDau: '10:00', ngayCuThe: '2099-09-02' }]
  }, authHeadersNoFeature);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'FEATURE_DISABLED');
  const total = (db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE ten_task = '[itest] khong duoc tao'").get() as { c: number }).c;
  assert.equal(total, 0);
});

test('owner scoping: actor B KHÔNG sync/thấy được definition hay task release định kỳ của actor A dù cùng team', async () => {
  const releaseDate = '2099-09-03';
  const releaseMonth = releaseDate.slice(0, 7);
  const definitionA = await req('POST', '/api/release/task-definitions', {
    title: '[itest] cua actor A', startTime: '10:00', dateToken: 'release.date'
  });
  assert.equal(definitionA.status, 201);
  const createdA = await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definitionA.json.id });
  assert.equal(createdA.status, 201);

  // Actor B (cùng team, cũng Bật Task cá nhân) gọi drift/sync cho ĐÚNG releaseMonth đó — không được
  // thấy definition/task của actor A (owner_user_id khác), và KHÔNG được lợi dụng originRef của A.
  const driftB = await req('GET', `/api/schedules/release/drift?releaseMonth=${releaseMonth}`, undefined, authHeadersOther);
  assert.equal(driftB.status, 200);
  assert.ok(!driftB.json.lech.some((item: { originRef: string }) => item.originRef === definitionA.json.id));
  assert.ok(!driftB.json.boQua.some((item: { originRef: string }) => item.originRef === definitionA.json.id));

  const reuseB = await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: definitionA.json.id }, authHeadersOther);
  assert.equal(reuseB.status, 409, 'definitionId của actor khác phải bị coi là không resolve được, không âm thầm dùng ké');

  const bulkB = await req('POST', '/api/schedules/regular-release/tasks', {
    releaseDate,
    tasks: [{ tenTask: '[itest] B muon dung ref cua A', gioBatDau: '10:15', ngayCuThe: releaseDate, originRef: definitionA.json.id }]
  }, authHeadersOther);
  assert.equal(bulkB.status, 409, 'lô tạo hàng loạt cũng phải từ chối originRef của actor khác');
});
