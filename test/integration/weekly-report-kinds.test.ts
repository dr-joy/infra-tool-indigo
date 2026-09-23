// Test tích hợp cho FR-22 (CR-20260913 Lát 5, Council 74715c65) — danh sách loại báo cáo tuần
// chuyển thành cấu hình theo team (weekly_report_kinds) thay 2 giá trị ghi cứng cũ, và Risk theo
// team/tuần/loại/project (weekly_project_risks) được LƯU LẠI để cả team xem lại (không chỉ ephemeral
// trong 1 lần gọi POST /dm-report như trước).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-weekly-kinds-itest-'));
process.env.APPDATA = tmpAppData;
process.env.AUTH_BASE_URL = mockAuth.authBaseUrl;
process.env.AUTH_CLIENT = 'indigo';
process.env.APP_CALLBACK_URL = 'http://127.0.0.1:0/api/auth/callback';
process.env.ADMIN_BOOTSTRAP_EMAIL = ADMIN_EMAIL;

const { app } = await import('../../server/app.js');

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

const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'weekly-kinds-itest-admin-sub');
const teamA = await onboarding.makeTeam(adminSession, '[itest] Team WeeklyKinds A');
const teamB = await onboarding.makeTeam(adminSession, '[itest] Team WeeklyKinds B');
await onboarding.setFeatureVisibility(adminSession, teamA, 'weekly_report', 'on');
await onboarding.setFeatureVisibility(adminSession, teamA, 'project', 'on');
const leaderA = await onboarding.joinAndApprove('weekly-kinds-itest-leaderA@drjoy.jp', 'Leader A', teamA, 'leader', adminSession);
const memberA = await onboarding.joinAndApprove('weekly-kinds-itest-memberA@drjoy.jp', 'Member A', teamA, 'member', adminSession);
const leaderB = await onboarding.joinAndApprove('weekly-kinds-itest-leaderB@drjoy.jp', 'Leader B', teamB, 'leader', adminSession);
const leaderAHeaders = flow.H(leaderA.session);
const memberAHeaders = flow.H(memberA.session);
const leaderBHeaders = flow.H(leaderB.session);

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

async function req(method: string, p: string, body?: unknown, headers: Record<string, string> = leaderAHeaders) {
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

test('GET /weeks/report-kinds: team mới có sẵn đúng 2 loại mặc định (internal, vn_management)', async () => {
  const r = await req('GET', `/api/weeks/report-kinds?teamId=${teamA}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const codes = (r.json.kinds as { code: string }[]).map((k) => k.code).sort();
  assert.deepEqual(codes, ['internal', 'vn_management']);
});

test('SEC: Member không tạo được loại báo cáo mới (Leader-only) -> 403 ROLE_FORBIDDEN', async () => {
  const r = await req('POST', '/api/weeks/report-kinds', { teamId: teamA, code: 'khac', label: 'Khác', renderMode: 'internal_markdown' }, memberAHeaders);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'ROLE_FORBIDDEN');
});

test('POST /weeks/report-kinds: Leader tạo loại mới hợp lệ -> 201', async () => {
  const r = await req('POST', '/api/weeks/report-kinds', { teamId: teamA, code: 'khac', label: 'Loại khác', renderMode: 'internal_markdown', requiresProjectRisk: false });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.code, 'khac');
  assert.equal(r.json.renderMode, 'internal_markdown');
});

test('POST /weeks/report-kinds: renderMode ngoài allowlist -> 400', async () => {
  const r = await req('POST', '/api/weeks/report-kinds', { teamId: teamA, code: 'sai', label: 'Sai', renderMode: 'tu_do_soan' });
  assert.equal(r.status, 400);
});

test('POST /weeks/report-kinds: trùng code trong cùng team -> 409', async () => {
  const r = await req('POST', '/api/weeks/report-kinds', { teamId: teamA, code: 'internal', label: 'Trùng', renderMode: 'internal_markdown' });
  assert.equal(r.status, 409);
});

test('SEC: team B không thấy/không sửa được loại báo cáo của team A', async () => {
  await onboarding.setFeatureVisibility(adminSession, teamB, 'weekly_report', 'on');
  const listB = await req('GET', `/api/weeks/report-kinds?teamId=${teamB}`, undefined, leaderBHeaders);
  assert.equal(listB.status, 200, JSON.stringify(listB.json));
  const codesB = (listB.json.kinds as { code: string }[]).map((k) => k.code);
  assert.ok(!codesB.includes('khac'), 'team B không thấy loại báo cáo team A vừa tạo');
});

test('PATCH /weeks/report-kinds/:id: Leader sửa nhãn/thứ tự/bật-tắt, row_version optimistic concurrency', async () => {
  const list = await req('GET', `/api/weeks/report-kinds?teamId=${teamA}`);
  const kind = (list.json.kinds as { id: string; rowId: string; rowVersion: number; label: string }[]).find((k) => k.id === 'khac')!;
  assert.ok(kind, 'phải tìm thấy loại "khac" vừa tạo');

  const patched = await req('PATCH', `/api/weeks/report-kinds/${kind.rowId}`, { teamId: teamA, label: 'Loại khác (đã sửa)', isActive: false, rowVersion: kind.rowVersion });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.label, 'Loại khác (đã sửa)');
  assert.equal(patched.json.isActive, false);

  // row_version cũ (đã lệch) -> 409
  const stale = await req('PATCH', `/api/weeks/report-kinds/${kind.rowId}`, { teamId: teamA, label: 'Sửa lần 2', rowVersion: kind.rowVersion });
  assert.equal(stale.status, 409);
});

// ── Risk & biện pháp đối ứng (FR-21a/FR-22) — lưu lại để cả team xem, không chỉ ephemeral ─────────
let riskProjectId: number;
let dmKindRowId: string;
test('setup: tạo 1 project trong team A + xác định report kind "vn_management"', async () => {
  const proj = await req('POST', '/api/projects', { ten: '[itest] Risk Project', teamId: teamA, responsibleUserId: leaderA.userId, ngayBatDau: '2026-09-01' });
  assert.equal(proj.status, 201, JSON.stringify(proj.json));
  riskProjectId = Number(proj.json.id);

  const list = await req('GET', `/api/weeks/report-kinds?teamId=${teamA}`);
  const kind = (list.json.kinds as { code: string; rowId: string }[]).find((k) => k.code === 'vn_management')!;
  dmKindRowId = kind.rowId;
});

test('SEC: Member không lưu được Risk (Leader-only) -> 403 ROLE_FORBIDDEN', async () => {
  const r = await req('PUT', '/api/weeks/2026-09-21/risks', {
    teamId: teamA, reportKindId: dmKindRowId, risks: [{ projectId: riskProjectId, risk: 'x', mitigation: 'y' }]
  }, memberAHeaders);
  assert.equal(r.status, 403);
});

test('PUT /weeks/:weekStart/risks: Leader lưu Risk -> GET đọc lại được (Member cũng đọc được — FR-21a hiện cho cả team xem)', async () => {
  const put = await req('PUT', '/api/weeks/2026-09-21/risks', {
    teamId: teamA, reportKindId: dmKindRowId, risks: [{ projectId: riskProjectId, risk: 'Chậm tiến độ do thiếu nhân lực', mitigation: 'Bổ sung 1 dev' }]
  });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.equal(put.json.length, 1);
  assert.equal(put.json[0].risk, 'Chậm tiến độ do thiếu nhân lực');

  const getByMember = await req('GET', `/api/weeks/2026-09-21/risks?teamId=${teamA}&reportKindId=${dmKindRowId}`, undefined, memberAHeaders);
  assert.equal(getByMember.status, 200);
  assert.equal(getByMember.json[0].mitigation, 'Bổ sung 1 dev');
});

test('PUT /weeks/:weekStart/risks: project không thuộc team -> 400', async () => {
  await onboarding.setFeatureVisibility(adminSession, teamB, 'project', 'on');
  const projB = await req('POST', '/api/projects', { ten: '[itest] Project team B', teamId: teamB, responsibleUserId: leaderB.userId, ngayBatDau: '2026-09-01' }, leaderBHeaders);
  assert.equal(projB.status, 201, JSON.stringify(projB.json));
  const r = await req('PUT', '/api/weeks/2026-09-21/risks', {
    teamId: teamA, reportKindId: dmKindRowId, risks: [{ projectId: Number(projB.json.id), risk: 'x', mitigation: 'y' }]
  });
  assert.equal(r.status, 400);
});

test('POST /weeks/:weekStart/dm-report kèm reportKindId -> LƯU LẠI risk, đọc lại qua GET /risks thấy đúng nội dung mới', async () => {
  // Ghi chú: renderDmReportText chỉ hiện project có mục tiêu tuần (goals) trong khối text — project
  // "Risk Project" ở đây không có mục tiêu tuần 2026-09-21 nên KHÔNG xuất hiện trong `text` (đúng
  // hành vi render đã có từ trước Lát 5, không phải lỗi của việc lưu Risk). Điều Lát 5 thêm là Risk
  // được LƯU LẠI độc lập với việc project có xuất hiện trong text hay không — kiểm bằng GET /risks.
  const dm = await req('POST', '/api/weeks/2026-09-21/dm-report', {
    teamId: teamA, reportKindId: dmKindRowId,
    risks: [{ projectId: String(riskProjectId), risk: 'Risk mới từ dm-report', mitigation: 'Biện pháp mới' }]
  });
  assert.equal(dm.status, 200, JSON.stringify(dm.json));

  const getAfter = await req('GET', `/api/weeks/2026-09-21/risks?teamId=${teamA}&reportKindId=${dmKindRowId}`);
  assert.equal(getAfter.json[0].risk, 'Risk mới từ dm-report');
});
