// CR-20260913 Lát 4 — test tích hợp cho các cửa bảo mật/toàn vẹn MỚI: FR-31 (task cá nhân tuyệt đối
// riêng tư, đặc biệt lỗ hổng UPDATE hàng loạt đã xác nhận), FR-13 (cách ly dữ liệu theo team), FR-18/
// FR-46 (row_version 409), FR-16 (Member chỉ sửa phân công của chính mình), FR-19 (audit_log 6 hành
// động mới của Lát 4). Dùng chung harness OIDC giả ở fixtures/auth-harness.ts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-lat4-security-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'lat4-sec-admin-sub');

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

async function req(headers: Record<string, string>, method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

// ── FR-31: task cá nhân — lỗ hổng UPDATE hàng loạt chéo người dùng ──────────────────────────────
test('FR-31: 2 User khác nhau cùng đặt task định kỳ TRÙNG TÊN + TRÙNG lịch lặp -> PATCH updateRelated của A KHÔNG đụng task của B', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team FR-31');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'personal_task', 'on');
  const userA = await onboarding.joinAndApprove('fr31-a@drjoy.jp', 'User A', teamId, 'member', adminSession);
  const userB = await onboarding.joinAndApprove('fr31-b@drjoy.jp', 'User B', teamId, 'member', adminSession);
  const HA = flow.H(userA.session);
  const HB = flow.H(userB.session);

  const taskBody = {
    tenTask: '[itest] Họp team hàng tuần', loaiTask: 'dinh_ky', gioBatDau: '09:00', gioKetThuc: '09:30',
    lapLaiKieu: 'hang_tuan', thuTrongTuan: [2]
  };
  const createdA = await req(HA, 'POST', '/api/tasks', taskBody);
  assert.equal(createdA.status, 201);
  const createdB = await req(HB, 'POST', '/api/tasks', taskBody);
  assert.equal(createdB.status, 201);
  assert.notEqual(createdA.json.id, createdB.json.id);

  // A đổi tên + bật updateRelated=true (khớp theo tên+hình dạng lịch lặp, KHÔNG kèm id trong query
  // xưa nay) -> CHỈ được đụng task của chính A, không được ghi đè task của B dù tên/lịch giống hệt.
  const patched = await req(HA, 'PATCH', `/api/tasks/${createdA.json.id}?updateRelated=true`, {
    tenTask: '[itest] Họp team hàng tuần (A đổi tên)', lapLaiKieu: 'hang_tuan', thuTrongTuan: [2]
  });
  assert.equal(patched.status, 200);

  const taskBRow = db.prepare('SELECT ten_task FROM tasks WHERE id = ?').get(createdB.json.id) as { ten_task: string };
  assert.equal(taskBRow.ten_task, '[itest] Họp team hàng tuần', 'task của B KHÔNG được đổi tên theo yêu cầu của A');
  const taskARow = db.prepare('SELECT ten_task FROM tasks WHERE id = ?').get(createdA.json.id) as { ten_task: string };
  assert.equal(taskARow.ten_task, '[itest] Họp team hàng tuần (A đổi tên)');
});

test('FR-31: User A không xem/sửa/xoá được task cá nhân của User B (404, không lộ có tồn tại)', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team FR-31b');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'personal_task', 'on');
  const userA = await onboarding.joinAndApprove('fr31b-a@drjoy.jp', 'User A2', teamId, 'member', adminSession);
  const userB = await onboarding.joinAndApprove('fr31b-b@drjoy.jp', 'User B2', teamId, 'member', adminSession);
  const HA = flow.H(userA.session);
  const HB = flow.H(userB.session);

  const createdB = await req(HB, 'POST', '/api/tasks', { tenTask: '[itest] task rieng cua B', loaiTask: 'don_le' });
  assert.equal(createdB.status, 201);

  const getList = await req(HA, 'GET', '/api/tasks');
  assert.ok(!getList.json.khoTask.some((t: { id: number }) => t.id === createdB.json.id), 'A không được thấy task của B trong danh sách');

  const patchAttempt = await req(HA, 'PATCH', `/api/tasks/${createdB.json.id}`, { tenTask: 'bị sửa bởi A' });
  assert.equal(patchAttempt.status, 404);
  const deleteAttempt = await req(HA, 'DELETE', `/api/tasks/${createdB.json.id}`);
  assert.equal(deleteAttempt.status, 404);

  const stillThere = db.prepare('SELECT ten_task FROM tasks WHERE id = ?').get(createdB.json.id) as { ten_task: string } | undefined;
  assert.ok(stillThere, 'task của B vẫn còn nguyên');
  assert.equal(stillThere?.ten_task, '[itest] task rieng cua B');
});

// ── FR-13: cách ly dữ liệu theo team ─────────────────────────────────────────────────────────
test('FR-13: Member team A gọi GET /projects?teamId=<team B> -> 403 NOT_TEAM_MEMBER, không lộ dữ liệu team khác', async () => {
  const teamA = await onboarding.makeTeam(adminSession, '[itest] Team Isolation A');
  const teamB = await onboarding.makeTeam(adminSession, '[itest] Team Isolation B');
  await onboarding.setFeatureVisibility(adminSession, teamA, 'project', 'on');
  await onboarding.setFeatureVisibility(adminSession, teamB, 'project', 'on');
  const leaderB = await onboarding.joinAndApprove('iso-leader-b@drjoy.jp', 'Leader B', teamB, 'leader', adminSession);
  await req(flow.H(leaderB.session), 'POST', '/api/projects', { ten: '[itest] project rieng team B', teamId: teamB, responsibleUserId: leaderB.userId, ngayBatDau: '2026-09-01' });

  const memberA = await onboarding.joinAndApprove('iso-member-a@drjoy.jp', 'Member A', teamA, 'member', adminSession);
  const res = await req(flow.H(memberA.session), 'GET', `/api/projects?teamId=${teamB}`);
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'NOT_TEAM_MEMBER');
});

test('FR-15: POST /projects thiếu responsibleUserId -> 400 (không còn nhận body.pic)', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team FR-15');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
  const leader = await onboarding.joinAndApprove('fr15-leader@drjoy.jp', 'Leader FR15', teamId, 'leader', adminSession);
  const res = await req(flow.H(leader.session), 'POST', '/api/projects', { ten: '[itest] thieu responsible', teamId, pic: 'chuoi tu do khong con duoc nhan', ngayBatDau: '2026-09-01' });
  assert.equal(res.status, 400);
  assert.match(res.json.message, /Người phụ trách/);
});

// ── FR-18/FR-46: optimistic concurrency (row_version) ────────────────────────────────────────
test('FR-18: PATCH /projects/:id với rowVersion cũ -> 409 VERSION_CONFLICT, dữ liệu không bị ghi đè', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team RowVersion');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
  const leader = await onboarding.joinAndApprove('rowver-leader@drjoy.jp', 'Leader RowVer', teamId, 'leader', adminSession);
  const H = flow.H(leader.session);
  const created = await req(H, 'POST', '/api/projects', { ten: '[itest] rowver', teamId, responsibleUserId: leader.userId, ngayBatDau: '2026-09-01' });
  assert.equal(created.status, 201);

  const first = await req(H, 'PATCH', `/api/projects/${created.json.id}`, {
    ten: '[itest] rowver sua lan 1', responsibleUserId: leader.userId, ngayBatDau: '2026-09-01', rowVersion: created.json.rowVersion
  });
  assert.equal(first.status, 200);

  // Gửi lại CÙNG rowVersion cũ (đã bị bump ở lần sửa trước) -> phải bị từ chối, không ghi đè âm thầm.
  const stale = await req(H, 'PATCH', `/api/projects/${created.json.id}`, {
    ten: '[itest] rowver sua lan 2 - se bi tu choi', responsibleUserId: leader.userId, ngayBatDau: '2026-09-01', rowVersion: created.json.rowVersion
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'VERSION_CONFLICT');

  const row = db.prepare('SELECT ten_project FROM projects WHERE id = ?').get(created.json.id) as { ten_project: string };
  assert.equal(row.ten_project, '[itest] rowver sua lan 1', 'bản ghi phải giữ đúng kết quả của lần sửa THÀNH CÔNG gần nhất');
});

// 2026-09-26 (Leader dùng thật) — trước đây route PATCH /projects/:id có nhánh riêng CHO PHÉP đổi tên
// project hệ thống "Khác" (chỉ chặn PIC/ngày bắt đầu); Leader không muốn tên "Khác" bị đổi nữa -> chặn
// TOÀN BỘ PATCH cho project hệ thống, đồng bộ với close/pending/restore/xóa đã chặn sẵn ở trên.
test('PATCH /projects/:id: project hệ thống "Khác" -> 400, không đổi tên (Leader 2026-09-26)', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Khac Immutable');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
  const leader = await onboarding.joinAndApprove('khac-immutable-leader@drjoy.jp', 'Leader Khac', teamId, 'leader', adminSession);
  const H = flow.H(leader.session);

  const list = await req(H, 'GET', `/api/projects?teamId=${teamId}`);
  assert.equal(list.status, 200);
  const khac = list.json.find((p: { isSystem: boolean }) => p.isSystem);
  assert.ok(khac, 'team mới phải tự có sẵn project hệ thống "Khác"');

  const res = await req(H, 'PATCH', `/api/projects/${khac.id}`, {
    ten: '[itest] co gang doi ten Khac', responsibleUserId: leader.userId, ngayBatDau: '2026-09-01', rowVersion: khac.rowVersion
  });
  assert.equal(res.status, 400);

  const row = db.prepare('SELECT ten_project FROM projects WHERE id = ?').get(khac.id) as { ten_project: string };
  assert.equal(row.ten_project, 'Khác', 'tên project hệ thống không được đổi');
});

test('FR-18: PATCH task project với rowVersion cũ -> 409, PUT assignments với rowVersion cũ -> 409', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team RowVersion Task');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
  const leader = await onboarding.joinAndApprove('rowver-task-leader@drjoy.jp', 'Leader RowVer Task', teamId, 'leader', adminSession);
  const H = flow.H(leader.session);
  const project = await req(H, 'POST', '/api/projects', { ten: '[itest] rowver task', teamId, responsibleUserId: leader.userId, ngayBatDau: '2026-09-01' });
  const task = await req(H, 'POST', `/api/projects/${project.json.id}/tasks`, {
    tieuDe: '[itest] task rowver', ngayBatDauDuKien: '2026-09-01', ngayKetThucDuKien: '2026-09-02', tienDo: 0
  });
  assert.equal(task.status, 201);
  const staleRowVersion = task.json.rowVersion;

  const patched = await req(H, 'PATCH', `/api/projects/${project.json.id}/tasks/${task.json.id}`, {
    tieuDe: '[itest] task rowver sua', ngayBatDauDuKien: '2026-09-01', ngayKetThucDuKien: '2026-09-02', tienDo: 10, rowVersion: staleRowVersion
  });
  assert.equal(patched.status, 200);

  const conflictPatch = await req(H, 'PATCH', `/api/projects/${project.json.id}/tasks/${task.json.id}`, {
    tieuDe: '[itest] se bi tu choi', ngayBatDauDuKien: '2026-09-01', ngayKetThucDuKien: '2026-09-02', tienDo: 20, rowVersion: staleRowVersion
  });
  assert.equal(conflictPatch.status, 409);

  const conflictAssignments = await req(H, 'PUT', `/api/projects/${project.json.id}/tasks/${task.json.id}/assignments`, {
    assignments: [{ userId: leader.userId, startDate: '2026-09-01', endDate: '2026-09-02' }], rowVersion: staleRowVersion
  });
  assert.equal(conflictAssignments.status, 409);
});

// ── FR-16: Member chỉ sửa/xoá đúng phân công của chính mình ──────────────────────────────────
test('FR-16: Member tự thêm chính mình vào assignments -> OK; Member xoá/sửa dòng của người khác -> 403 toàn bộ yêu cầu', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team FR-16');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
  const leader = await onboarding.joinAndApprove('fr16-leader@drjoy.jp', 'Leader FR16', teamId, 'leader', adminSession);
  const memberX = await onboarding.joinAndApprove('fr16-x@drjoy.jp', 'Member X', teamId, 'member', adminSession);
  const memberY = await onboarding.joinAndApprove('fr16-y@drjoy.jp', 'Member Y', teamId, 'member', adminSession);
  const HLeader = flow.H(leader.session);
  const HX = flow.H(memberX.session);

  const project = await req(HLeader, 'POST', '/api/projects', { ten: '[itest] fr16', teamId, responsibleUserId: leader.userId, ngayBatDau: '2026-09-01' });
  const task = await req(HLeader, 'POST', `/api/projects/${project.json.id}/tasks`, {
    tieuDe: '[itest] task fr16', ngayBatDauDuKien: '2026-09-01', ngayKetThucDuKien: '2026-09-10', tienDo: 0
  });
  // Leader gán trước Member Y vào task (X chưa có mặt).
  const withY = await req(HLeader, 'PUT', `/api/projects/${project.json.id}/tasks/${task.json.id}/assignments`, {
    assignments: [{ userId: memberY.userId, startDate: '2026-09-01', endDate: '2026-09-05' }], rowVersion: task.json.rowVersion
  });
  assert.equal(withY.status, 200);
  const rowVersionAfterY = withY.json.rowVersion;

  // Member X tự thêm mình, GIỮ NGUYÊN dòng của Y -> phải thành công (FR-16: Member tự nhận việc).
  const xAddsSelf = await req(HX, 'PUT', `/api/projects/${project.json.id}/tasks/${task.json.id}/assignments`, {
    assignments: [
      { userId: memberY.userId, startDate: '2026-09-01', endDate: '2026-09-05' },
      { userId: memberX.userId, startDate: '2026-09-06', endDate: '2026-09-10' }
    ],
    rowVersion: rowVersionAfterY
  });
  assert.equal(xAddsSelf.status, 200, JSON.stringify(xAddsSelf.json));
  const rowVersionAfterX = xAddsSelf.json.rowVersion;

  // Member X thử XOÁ dòng của Y (không gửi lại) -> từ chối TOÀN BỘ yêu cầu (403), không âm thầm lọc.
  const xRemovesY = await req(HX, 'PUT', `/api/projects/${project.json.id}/tasks/${task.json.id}/assignments`, {
    assignments: [{ userId: memberX.userId, startDate: '2026-09-06', endDate: '2026-09-10' }],
    rowVersion: rowVersionAfterX
  });
  assert.equal(xRemovesY.status, 403);
  assert.equal(xRemovesY.json.code, 'ROLE_FORBIDDEN');

  // Xác nhận dòng của Y KHÔNG bị xoá dù request trên bị từ chối.
  const stillHasBoth = db.prepare('SELECT COUNT(*) c FROM project_task_assignments WHERE project_task_id = ?').get(task.json.id) as { c: number };
  assert.equal(stillHasBoth.c, 2, 'yêu cầu bị 403 không được để lại bất kỳ thay đổi nào');
});

// ── FR-19: audit_log cho 6 hành động mới của Lát 4 ────────────────────────────────────────────
test('FR-19: 6 hành động mới của Lát 4 đều ghi audit_log đúng action', async () => {
  const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Audit');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'project', 'on');
  await onboarding.setFeatureVisibility(adminSession, teamId, 'weekly_report', 'on');
  const leader = await onboarding.joinAndApprove('audit-leader@drjoy.jp', 'Leader Audit', teamId, 'leader', adminSession);
  const H = flow.H(leader.session);

  const project = await req(H, 'POST', '/api/projects', { ten: '[itest] audit', teamId, responsibleUserId: leader.userId, ngayBatDau: '2026-09-01' });
  const task = await req(H, 'POST', `/api/projects/${project.json.id}/tasks`, {
    tieuDe: '[itest] audit task', ngayBatDauDuKien: '2026-09-01', ngayKetThucDuKien: '2026-09-10', tienDo: 0
  });

  // project_task.assignment.add / .remove
  const assignRes1 = await req(H, 'PUT', `/api/projects/${project.json.id}/tasks/${task.json.id}/assignments`, {
    assignments: [{ userId: leader.userId, startDate: '2026-09-01', endDate: '2026-09-05' }], rowVersion: task.json.rowVersion
  });
  await req(H, 'PUT', `/api/projects/${project.json.id}/tasks/${task.json.id}/assignments`, {
    assignments: [], rowVersion: assignRes1.json.rowVersion
  });

  // weekly_report.finalize
  await req(H, 'POST', '/api/weeks/2026-09-07/report-history', { teamId, kind: 'internal', content: '[itest] noi dung bao cao' });

  // weekly_goals.delete_all
  await req(H, 'DELETE', `/api/weeks/2026-09-07/goals?teamId=${teamId}`);

  // project_task.delete rồi project.delete (project.delete cascade xoá luôn task còn lại nếu có,
  // nhưng ta đã xoá task trước để có riêng 1 dòng project_task.delete).
  await req(H, 'DELETE', `/api/projects/${project.json.id}/tasks/${task.json.id}`);
  await req(H, 'DELETE', `/api/projects/${project.json.id}`);

  const actions = (db.prepare('SELECT DISTINCT action FROM audit_log WHERE team_id = ?').all(teamId) as { action: string }[]).map((r) => r.action);
  for (const expected of [
    'project.delete', 'project_task.delete', 'weekly_report.finalize', 'weekly_goals.delete_all',
    'project_task.assignment.add', 'project_task.assignment.remove'
  ]) {
    assert.ok(actions.includes(expected), `thiếu audit_log cho hành động ${expected} (đã ghi: ${actions.join(', ')})`);
  }
});
