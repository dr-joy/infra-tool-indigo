// QA-2026-09-12: review toàn diện tính năng PIC — chưa có test tích hợp nào trước đây.
//
// Council review run e6cd1c8c (22/09, xem docs/exchanges/2026-09-22.md) tìm ra lỗ hổng thật: cả 5 route
// /api/pics KHÔNG hề qua requireSession/authorize() — ai gọi tới server, kể cả chưa đăng nhập, đều
// đọc/tạo/sửa/xoá được PIC của MỌI team. Bản sửa này thêm requireSession + requireActiveAccount +
// authorize() (policyKind 'team_feature', resource 'pic') + team scoping thật, dùng chung harness OIDC
// giả ở fixtures/auth-harness.ts (đúng boilerplate test/integration/projects.test.ts/tasks.test.ts đã
// dùng cho Lát 4). Test dưới đây phủ: 401 khi chưa đăng nhập, cô lập đúng/khác team, Member không tạo/
// sửa/xoá/reorder được (Leader-only), và xác nhận đổi tên PIC KHÔNG còn ghi đè projects.pic/
// project_tasks.assignee (CR §6.3 — 2 cột đó đã có nguồn tính riêng, PIC route không còn ghi tay vào).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-pics-itest-'));
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

// 2 team tách biệt để kiểm cô lập dữ liệu: team A có Leader + Member, team B chỉ có Leader (dùng làm
// "actor khác team" khi kiểm actor không thấy/không sửa được PIC của team A).
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'pics-itest-admin-sub');
const teamA = await onboarding.makeTeam(adminSession, '[itest] Team Pics A');
const teamB = await onboarding.makeTeam(adminSession, '[itest] Team Pics B');
const leaderA = await onboarding.joinAndApprove('pics-itest-leaderA@drjoy.jp', 'Leader A', teamA, 'leader', adminSession);
const memberA = await onboarding.joinAndApprove('pics-itest-memberA@drjoy.jp', 'Member A', teamA, 'member', adminSession);
const leaderB = await onboarding.joinAndApprove('pics-itest-leaderB@drjoy.jp', 'Leader B', teamB, 'leader', adminSession);
const leaderAHeaders = flow.H(leaderA.session);
const memberAHeaders = flow.H(memberA.session);
const leaderBHeaders = flow.H(leaderB.session);

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

async function req(method: string, p: string, body?: unknown, headers: Record<string, string> = leaderAHeaders) {
  const res = await fetch(`${base}${p}`, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

// ── Xác thực + team scoping (lỗ hổng Council tìm ra) ────────────────────────────────────────────
test('SEC: GET /pics chưa đăng nhập -> 401', async () => {
  const r = await fetch(`${base}/api/pics?teamId=${teamA}`);
  assert.equal(r.status, 401);
});

test('SEC: POST /pics chưa đăng nhập -> 401, không tạo được PIC', async () => {
  const r = await req('POST', '/api/pics', { name: '[itest] Ai đó', teamId: teamA }, { 'Content-Type': 'application/json' });
  assert.equal(r.status, 401);
});

test('SEC: GET /pics đúng team -> Leader và Member cùng team đều thấy PIC vừa tạo', async () => {
  const created = await req('POST', '/api/pics', { name: '[itest] Team A PIC', color: '#111111', teamId: teamA });
  assert.equal(created.status, 201, JSON.stringify(created.json));

  const asLeader = await req('GET', `/api/pics?teamId=${teamA}`);
  assert.ok((asLeader.json as { name: string }[]).some((p) => p.name === '[itest] Team A PIC'));

  const asMember = await req('GET', `/api/pics?teamId=${teamA}`, undefined, memberAHeaders);
  assert.equal(asMember.status, 200);
  assert.ok((asMember.json as { name: string }[]).some((p) => p.name === '[itest] Team A PIC'));
});

test('SEC: actor không thuộc team -> GET /pics?teamId=<team khác> bị 403 NOT_TEAM_MEMBER', async () => {
  const r = await req('GET', `/api/pics?teamId=${teamA}`, undefined, leaderBHeaders);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NOT_TEAM_MEMBER');
});

test('SEC: team B không thấy PIC của team A (cô lập dữ liệu theo team_id)', async () => {
  const listB = await req('GET', `/api/pics?teamId=${teamB}`, undefined, leaderBHeaders);
  assert.equal(listB.status, 200);
  assert.ok(!(listB.json as { name: string }[]).some((p) => p.name === '[itest] Team A PIC'));
});

test('SEC: Member không tạo được PIC (Leader-only) -> 403 ROLE_FORBIDDEN', async () => {
  const r = await req('POST', '/api/pics', { name: '[itest] Member tao', teamId: teamA }, memberAHeaders);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'ROLE_FORBIDDEN');
});

test('SEC: Member không sửa được PIC (Leader-only) -> 403 ROLE_FORBIDDEN', async () => {
  const created = await req('POST', '/api/pics', { name: '[itest] De Member sua', teamId: teamA });
  const r = await req('PATCH', `/api/pics/${created.json.id}`, { color: '#00ff00' }, memberAHeaders);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'ROLE_FORBIDDEN');
});

test('SEC: PIC thuộc team A -> Leader team B PATCH/DELETE bị 403 NOT_TEAM_MEMBER', async () => {
  const created = await req('POST', '/api/pics', { name: '[itest] De Leader B dung', teamId: teamA });
  const patch = await req('PATCH', `/api/pics/${created.json.id}`, { color: '#00ff00' }, leaderBHeaders);
  assert.equal(patch.status, 403);
  assert.equal(patch.json.code, 'NOT_TEAM_MEMBER');
  const del = await req('DELETE', `/api/pics/${created.json.id}`, undefined, leaderBHeaders);
  assert.equal(del.status, 403);
  assert.equal(del.json.code, 'NOT_TEAM_MEMBER');
});

test('SEC: reorder gửi lẫn id PIC của team khác -> 400 "Danh sách PIC không khớp"', async () => {
  const a = await req('POST', '/api/pics', { name: '[itest] Reorder A', teamId: teamA });
  const bOtherTeam = await req('POST', '/api/pics', { name: '[itest] Reorder B khac team', teamId: teamB }, leaderBHeaders);
  const r = await req('PATCH', '/api/pics/reorder', { teamId: teamA, picIds: [a.json.id, bOtherTeam.json.id] });
  assert.equal(r.status, 400);
  assert.equal(r.json.message, 'Danh sách PIC không khớp');
});

// ── Hành vi nghiệp vụ hiện có (giữ nguyên, chuyển sang gọi qua actor đã đăng nhập) ──────────────
test('QA: PATCH /pics/:id gửi tên TRÙNG + màu mới cùng lúc -> 400, màu KHÔNG được lưu (atomic)', async () => {
  const a = await req('POST', '/api/pics', { name: '[itest] PIC A', color: '#111111', teamId: teamA });
  assert.equal(a.status, 201);
  const b = await req('POST', '/api/pics', { name: '[itest] PIC B', color: '#222222', teamId: teamA });
  assert.equal(b.status, 201);

  const patch = await req('PATCH', `/api/pics/${a.json.id}`, { name: '[itest] PIC B', color: '#ff0000' });
  assert.equal(patch.status, 400);

  const list = await req('GET', `/api/pics?teamId=${teamA}`);
  const found = (list.json as { id: string; color: string | null }[]).find((p) => p.id === a.json.id);
  assert.equal(found?.color, '#111111', 'màu phải giữ nguyên như trước request bị từ chối');
});

test('QA: PATCH /pics/:id gửi tên RỖNG + màu mới cùng lúc -> 400, màu KHÔNG được lưu', async () => {
  const a = await req('POST', '/api/pics', { name: '[itest] PIC C', color: '#333333', teamId: teamA });
  assert.equal(a.status, 201);

  const patch = await req('PATCH', `/api/pics/${a.json.id}`, { name: '   ', color: '#ff0000' });
  assert.equal(patch.status, 400);

  const list = await req('GET', `/api/pics?teamId=${teamA}`);
  const found = (list.json as { id: string; color: string | null }[]).find((p) => p.id === a.json.id);
  assert.equal(found?.color, '#333333');
});

test('QA: PATCH /pics/:id chỉ đổi màu (không đổi tên) -> vẫn hoạt động bình thường', async () => {
  const a = await req('POST', '/api/pics', { name: '[itest] PIC D', color: '#444444', teamId: teamA });
  const patch = await req('PATCH', `/api/pics/${a.json.id}`, { color: '#555555' });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.color, '#555555');
});

test('QA: PATCH /pics/:id đổi tên hợp lệ + màu cùng lúc -> cả 2 đều lưu', async () => {
  const a = await req('POST', '/api/pics', { name: '[itest] PIC E', color: '#666666', teamId: teamA });
  const patch = await req('PATCH', `/api/pics/${a.json.id}`, { name: '[itest] PIC E đã đổi', color: '#777777' });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.name, '[itest] PIC E đã đổi');
  assert.equal(patch.json.color, '#777777');
});

// CR-20260913 Lát 4 (§6.3, Council review 22/09): PATCH /pics/:id KHÔNG còn ghi đè
// projects.pic/project_tasks.assignee khi đổi tên — 2 cột đó chỉ do server tự tính (deriveLeafFromAssignments
// ở mappers.ts, weekly-report.ts viết lại), PIC route ghi tay vào đó trước đây là xung đột với cơ chế cache.
// Chèn thẳng vào DB (mô phỏng dữ liệu lịch sử trước di trú) để kiểm 2 cột này giữ NGUYÊN VĂN sau khi đổi tên.
test('QA: đổi tên PIC KHÔNG còn lan sang project.pic / project_tasks.assignee (đã bỏ cơ chế ghi đè)', async () => {
  const pic = await req('POST', '/api/pics', { name: '[itest] Renamer', teamId: teamA });
  const now = new Date().toISOString();
  const proj = db.prepare(`
    INSERT INTO projects (ten_project, pic, team_id, ngay_bat_dau, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run('[itest] proj for rename', '[itest] Renamer', teamA, '2026-09-01', now, now);
  const projectId = Number(proj.lastInsertRowid);
  const task = db.prepare(`
    INSERT INTO project_tasks (project_id, team_id, level, tieu_de, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien, tien_do, assignee, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, 0, ?, ?, ?)
  `).run(projectId, teamA, 'task', '2026-09-01', '2026-09-02', 'Ai đó, [itest] Renamer', now, now);
  const taskId = Number(task.lastInsertRowid);

  const rename = await req('PATCH', `/api/pics/${pic.json.id}`, { name: '[itest] Renamer đã đổi' });
  assert.equal(rename.status, 200);

  const projRow = db.prepare('SELECT pic FROM projects WHERE id = ?').get(projectId) as { pic: string };
  assert.equal(projRow.pic, '[itest] Renamer', 'projects.pic không còn bị PIC route ghi đè, phải giữ nguyên như trước khi đổi tên');

  const taskRow = db.prepare('SELECT assignee FROM project_tasks WHERE id = ?').get(taskId) as { assignee: string };
  assert.equal(taskRow.assignee, 'Ai đó, [itest] Renamer', 'project_tasks.assignee không còn bị PIC route ghi đè');
});

test('QA: xoá PIC còn task chưa hoàn thành (đúng team) -> 400, không cho xoá', async () => {
  const pic = await req('POST', '/api/pics', { name: '[itest] Busy PIC', teamId: teamA });
  const now = new Date().toISOString();
  const proj = db.prepare(`
    INSERT INTO projects (ten_project, pic, team_id, ngay_bat_dau, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run('[itest] proj busy', 'ai', teamA, '2026-09-01', now, now);
  db.prepare(`
    INSERT INTO project_tasks (project_id, team_id, level, tieu_de, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien, tien_do, assignee, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, 50, ?, ?, ?)
  `).run(Number(proj.lastInsertRowid), teamA, 'task chưa xong', '2026-09-01', '2026-09-02', '[itest] Busy PIC', now, now);

  const del = await req('DELETE', `/api/pics/${pic.json.id}`);
  assert.equal(del.status, 400);
});

test('QA: xoá PIC còn task chưa hoàn thành Ở TEAM KHÁC -> vẫn xoá được (không bị chặn nhầm chéo team)', async () => {
  const pic = await req('POST', '/api/pics', { name: '[itest] Busy PIC Team B', teamId: teamB }, leaderBHeaders);
  const now = new Date().toISOString();
  // Task "chưa xong" gắn tên trùng nhưng thuộc TEAM A -> không được tính là "đang dùng" của PIC team B.
  const proj = db.prepare(`
    INSERT INTO projects (ten_project, pic, team_id, ngay_bat_dau, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run('[itest] proj busy team A', 'ai', teamA, '2026-09-01', now, now);
  db.prepare(`
    INSERT INTO project_tasks (project_id, team_id, level, tieu_de, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien, tien_do, assignee, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, 50, ?, ?, ?)
  `).run(Number(proj.lastInsertRowid), teamA, 'task chưa xong team A', '2026-09-01', '2026-09-02', '[itest] Busy PIC Team B', now, now);

  const del = await req('DELETE', `/api/pics/${pic.json.id}`, undefined, leaderBHeaders);
  assert.equal(del.status, 200);
});

test('QA: tạo PIC trùng tên chính xác -> 400', async () => {
  await req('POST', '/api/pics', { name: '[itest] Dup Exact', teamId: teamA });
  const second = await req('POST', '/api/pics', { name: '[itest] Dup Exact', teamId: teamA });
  assert.equal(second.status, 400);
});

// QA-2026-09-12 (xác nhận với người dùng): "Nam" và "nam" phải coi là trùng — tránh gõ nhầm case
// tạo ra 2 PIC khác nhau trong dropdown.
test('QA: tạo PIC trùng tên nhưng KHÁC HOA/THƯỜNG -> vẫn bị coi là trùng, 400', async () => {
  await req('POST', '/api/pics', { name: '[itest] CaseTest', teamId: teamA });
  const second = await req('POST', '/api/pics', { name: '[itest] casetest', teamId: teamA });
  assert.equal(second.status, 400);
});

test('QA: đổi tên PIC khác sang tên đã tồn tại nhưng KHÁC HOA/THƯỜNG -> vẫn 400', async () => {
  await req('POST', '/api/pics', { name: '[itest] Original', teamId: teamA });
  const other = await req('POST', '/api/pics', { name: '[itest] To Rename', teamId: teamA });
  const rename = await req('PATCH', `/api/pics/${other.json.id}`, { name: '[itest] original' });
  assert.equal(rename.status, 400);
});
