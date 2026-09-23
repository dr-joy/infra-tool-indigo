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
  //
  // Council review 2026-09-23 (lỗ hổng #2): dòng Risk này đã tồn tại (tạo ở test PUT /risks phía
  // trên) nên giờ upsertProjectRisks() đòi đúng `rowVersion` hiện tại (optimistic concurrency) —
  // đọc lại trước khi ghi, giống hệt cách client thật phải làm.
  const before = await req('GET', `/api/weeks/2026-09-21/risks?teamId=${teamA}&reportKindId=${dmKindRowId}`);
  const dm = await req('POST', '/api/weeks/2026-09-21/dm-report', {
    teamId: teamA, reportKindId: dmKindRowId,
    risks: [{ projectId: String(riskProjectId), risk: 'Risk mới từ dm-report', mitigation: 'Biện pháp mới', rowVersion: before.json[0].rowVersion }]
  });
  assert.equal(dm.status, 200, JSON.stringify(dm.json));

  const getAfter = await req('GET', `/api/weeks/2026-09-21/risks?teamId=${teamA}&reportKindId=${dmKindRowId}`);
  assert.equal(getAfter.json[0].risk, 'Risk mới từ dm-report');
});

// ── Council review 2026-09-23 — 2 lỗ hổng thật trong FR-22 ─────────────────────────────────────────
// #1: POST /dm-report chỉ đòi quyền `render` (Leader+Member) nhưng khi có `reportKindId` lại gọi thẳng
// upsertProjectRisks() — hàm ghi Leader-only mà PUT /risks dùng -> Member bị chặn ở PUT /risks nhưng
// ghi được qua ngả này. Đã sửa: route tự kiểm thêm quyền `upsert` khi có `reportKindId`, chọn PHƯƠNG ÁN
// (a) — chặn 403 ngay, không âm thầm bỏ qua phần lưu.
test('SEC: Member gọi POST /dm-report kèm reportKindId + risks (cửa hậu ghi Risk) -> 403, không ghi đè được', async () => {
  const r = await req('POST', '/api/weeks/2026-09-21/dm-report', {
    teamId: teamA, reportKindId: dmKindRowId,
    risks: [{ projectId: String(riskProjectId), risk: 'Member co ghi de qua dm-report', mitigation: 'x' }]
  }, memberAHeaders);
  assert.equal(r.status, 403, JSON.stringify(r.json));

  const getAfter = await req('GET', `/api/weeks/2026-09-21/risks?teamId=${teamA}&reportKindId=${dmKindRowId}`);
  assert.notEqual(getAfter.json[0].risk, 'Member co ghi de qua dm-report', 'Risk trong DB không được đổi qua cửa hậu');
});

test('POST /weeks/:weekStart/dm-report: Member KHÔNG gửi reportKindId vẫn render (xem) bình thường', async () => {
  const r = await req('POST', '/api/weeks/2026-09-21/dm-report', {
    teamId: teamA,
    risks: [{ projectId: String(riskProjectId), risk: 'preview only', mitigation: 'preview only' }]
  }, memberAHeaders);
  assert.equal(r.status, 200, JSON.stringify(r.json));

  const getAfter = await req('GET', `/api/weeks/2026-09-21/risks?teamId=${teamA}&reportKindId=${dmKindRowId}`);
  assert.notEqual(getAfter.json[0].risk, 'preview only', 'render không kèm reportKindId thì không được ghi vào DB');
});

// #2: upsertProjectRisks() không thực thi optimistic concurrency dù bảng có row_version — 2 lượt ghi
// liên tiếp ghi đè âm thầm không 409. Đã sửa: upsert giờ kèm `WHERE row_version = ?` (client thiếu
// rowVersion coi như -1, không khớp bất kỳ dòng đã tồn tại nào — cùng quy ước `?? -1` của PATCH
// /weeks/report-kinds/:id), gói cả lô trong withTransaction().
test('PUT /weeks/:weekStart/risks: rowVersion cũ (đã lệch, người khác vừa sửa) -> 409, không ghi đè âm thầm', async () => {
  const before = await req('GET', `/api/weeks/2026-09-21/risks?teamId=${teamA}&reportKindId=${dmKindRowId}`);
  const staleVersion = before.json[0].rowVersion as number;

  const first = await req('PUT', '/api/weeks/2026-09-21/risks', {
    teamId: teamA, reportKindId: dmKindRowId,
    risks: [{ projectId: riskProjectId, risk: 'Sua lan 1 (dung rowVersion)', mitigation: 'bp1', rowVersion: staleVersion }]
  });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json[0].risk, 'Sua lan 1 (dung rowVersion)');
  assert.ok(first.json[0].rowVersion > staleVersion, 'row_version phải tăng sau khi ghi thành công');

  // Lượt 2 dùng lại đúng `staleVersion` cũ (đã lệch vì lượt 1 vừa tăng lên) -> phải 409, không được âm
  // thầm ghi đè nội dung của lượt 1.
  const second = await req('PUT', '/api/weeks/2026-09-21/risks', {
    teamId: teamA, reportKindId: dmKindRowId,
    risks: [{ projectId: riskProjectId, risk: 'Ghi de am tham (rowVersion cu)', mitigation: 'bp2', rowVersion: staleVersion }]
  });
  assert.equal(second.status, 409, JSON.stringify(second.json));
  assert.equal(second.json.code, 'VERSION_CONFLICT');
  assert.deepEqual(second.json.conflicts, [riskProjectId]);

  const after = await req('GET', `/api/weeks/2026-09-21/risks?teamId=${teamA}&reportKindId=${dmKindRowId}`);
  assert.equal(after.json[0].risk, 'Sua lan 1 (dung rowVersion)', 'nội dung của lượt 1 phải còn nguyên, không bị lượt 2 ghi đè');
});

test('PUT /weeks/:weekStart/risks: thiếu rowVersion cho dòng ĐÃ TỒN TẠI -> coi như -1, luôn 409 (buộc phải GET lại trước khi ghi)', async () => {
  const r = await req('PUT', '/api/weeks/2026-09-21/risks', {
    teamId: teamA, reportKindId: dmKindRowId,
    risks: [{ projectId: riskProjectId, risk: 'Khong gui rowVersion', mitigation: 'x' }]
  });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'VERSION_CONFLICT');
});

// ── Phụ: is_active (ngừng dùng) chặn TẠO MỚI báo cáo, không phá lịch sử cũ ─────────────────────────
// weekly_report_kinds.is_active ghi rõ ý định "ngừng dùng không phá lịch sử" — kind 'khac' của teamA
// đã bị tắt (isActive=false) ở test PATCH phía trên; dùng lại đúng dòng đó để kiểm điểm TẠO MỚI
// (POST /report-history) phải chặn, không cần tạo thêm kind mới.
test('POST /weeks/:weekStart/report-history: loại báo cáo đã is_active=false -> 400, không tạo được báo cáo mới', async () => {
  const r = await req('POST', '/api/weeks/2026-09-28/report-history', {
    teamId: teamA, kind: 'khac', content: '[itest] noi dung bao cao loai da tat'
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});
