// CR-20260913 Lát 6 (FR-28a nhánh "Định kỳ") — test tích hợp cho:
//   GET  /release/schedule/regular-cycles           (liệt kê đợt định kỳ đang mở để chọn)
//   POST /release/schedule/personal-regular-tasks   (sinh task cá nhân định kỳ CỦA MÌNH cho 1 cycle)
// Trọng tâm: khoá nhóm task dùng `regularPersonalReleaseMonthKey(cycleId, ownerUserId)` — 2 cycle
// định kỳ CÙNG tháng dương lịch cùng mở KHÔNG được lẫn task của nhau (CR §6.3 dòng ~1513, cảnh báo kỹ
// thuật Council 95a26ee6), và chọn sai/thiếu cycle phải bị chặn rõ ràng, không tự đoán 1 đợt duy nhất.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-release-personal-regular-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'rs-personal-regular-itest-admin-sub');

// Team điều phối (Leader team này ấn định ngày chính định kỳ, FR-23b) + team làm việc thật (actor tự
// sinh task cá nhân). Coordinator KHÔNG cần Bật "release" cho việc GET regular-cycles/sinh task cá
// nhân (chỉ cần cho chính route set_regular_date, đã kiểm ở release-schedule.test.ts) — vẫn bật cho
// cả 2 team ở đây để không phải phân biệt, đúng thực tế triển khai (mọi team Bật Release đều xem lịch).
const teamCoord = await onboarding.makeTeam(adminSession, '[itest] Team Dieu Phoi Regular');
const teamWork = await onboarding.makeTeam(adminSession, '[itest] Team Regular Personal');
// Team riêng cho actor "outsider" — CÓ Bật personal_task (qua gate chung policyKind 'personal_task')
// nhưng KHÔNG phải teamWork, để test đúng NHÁNH "actor không thuộc teamWork" (bước kiểm teamId cụ thể
// trong route) thay vì bị chặn sớm hơn bởi gate chung "chưa thuộc team nào Bật personal_task".
const teamOutsider = await onboarding.makeTeam(adminSession, '[itest] Team Regular Outsider');
await onboarding.setFeatureVisibility(adminSession, teamCoord, 'release', 'on');
await onboarding.setFeatureVisibility(adminSession, teamWork, 'release', 'on');
await onboarding.setFeatureVisibility(adminSession, teamWork, 'personal_task', 'on');
await onboarding.setFeatureVisibility(adminSession, teamOutsider, 'personal_task', 'on');
const coordLeader = await onboarding.joinAndApprove('rs-personal-regular-coord@drjoy.jp', 'Leader Dieu Phoi Regular', teamCoord, 'leader', adminSession);
const actor = await onboarding.joinAndApprove('rs-personal-regular-itest@drjoy.jp', 'Member Regular Personal', teamWork, 'member', adminSession);
const workLeader = await onboarding.joinAndApprove('rs-personal-regular-worklead@drjoy.jp', 'Leader Regular Personal', teamWork, 'leader', adminSession);
const outsider = await onboarding.joinAndApprove('rs-personal-regular-outsider@drjoy.jp', 'Outsider khong cung team', teamOutsider, 'member', adminSession);

const coordHeaders = flow.H(coordLeader.session);
const authHeaders = flow.H(actor.session);
const workLeaderHeaders = flow.H(workLeader.session);
const outsiderHeaders = flow.H(outsider.session);

async function setReleaseCoordinator(teamId: number): Promise<void> {
  const current = await (await fetch(`${base}/api/admin/release-coordinator`, { headers: flow.H(adminSession) })).json() as { row_version: number };
  const res = await fetch(`${base}/api/admin/release-coordinator`, {
    method: 'PUT', headers: flow.H(adminSession), body: JSON.stringify({ teamId, rowVersion: current.row_version })
  });
  if (!res.ok) throw new Error(`setReleaseCoordinator thất bại: ${res.status}`);
}
await setReleaseCoordinator(teamCoord);

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

async function enableAutogen(teamId: number): Promise<void> {
  const list = await (await fetch(`${base}/api/admin/release-task-autogen`, { headers: flow.H(adminSession) })).json() as
    { settings: { team_id: number; row_version: number }[] };
  const current = list.settings.find((s) => s.team_id === teamId);
  const res = await fetch(`${base}/api/admin/release-task-autogen`, {
    method: 'PUT', headers: flow.H(adminSession),
    body: JSON.stringify({ teamId, enabled: true, rowVersion: current?.row_version })
  });
  if (!res.ok) throw new Error(`enableAutogen thất bại: ${res.status}`);
}

async function makeRegularCycle(date: string): Promise<number> {
  const r = await req('POST', '/api/release/schedule/regular-cycles', { regularReleaseDate: date }, coordHeaders);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id as number;
}

let seq = 0;
function uniq(prefix: string) { seq += 1; return `${prefix}-${Date.now()}-${seq}`; }

test('GET /release/schedule/regular-cycles: chưa đăng nhập -> 401', async () => {
  const r = await fetch(`${base}/api/release/schedule/regular-cycles`);
  assert.equal(r.status, 401);
});

test('POST personal-regular-tasks: Admin CHƯA bật Tab cá nhân cho team -> 403 FEATURE_DISABLED', async () => {
  const cycleId = await makeRegularCycle('2026-11-10');
  const r = await req('POST', '/api/release/schedule/personal-regular-tasks', { teamId: teamWork, cycleId });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'FEATURE_DISABLED');
});

test('POST personal-regular-tasks: actor không thuộc team -> 403 NOT_TEAM_MEMBER', async () => {
  await enableAutogen(teamWork);
  const cycleId = await makeRegularCycle('2026-11-11');
  const r = await req('POST', '/api/release/schedule/personal-regular-tasks', { teamId: teamWork, cycleId }, outsiderHeaders);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NOT_TEAM_MEMBER');
});

test('POST personal-regular-tasks: cycleId không tồn tại -> 404 REGULAR_CYCLE_NOT_FOUND', async () => {
  await enableAutogen(teamWork);
  const r = await req('POST', '/api/release/schedule/personal-regular-tasks', { teamId: teamWork, cycleId: 999999 });
  assert.equal(r.status, 404);
  assert.equal(r.json.code, 'REGULAR_CYCLE_NOT_FOUND');
});

test('POST personal-regular-tasks: cycleId trỏ đúng 1 cycle KHẨN CẤP (khác kind) -> 404, không lẫn sang định kỳ', async () => {
  await enableAutogen(teamWork);
  // Tạo 1 cycle khẩn cấp thật qua đúng luồng FR-23a (tự tìm-hoặc-tạo) để có id cycle kind='emergency'.
  // Đăng ký lịch khẩn cấp chỉ Leader team đó làm được (policy team_release_registration.create — dùng
  // workLeaderHeaders, khác actor 'member' của các test khác trong file này).
  const emergencyDay = '2026-11-12';
  const created = await req('POST', '/api/release/schedule/registrations', {
    teamId: teamWork, deployStagingAt: { date: emergencyDay, time: '13:00' }, releaseAt: { date: emergencyDay, time: '15:00' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co'
  }, workLeaderHeaders);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const r = await req('POST', '/api/release/schedule/personal-regular-tasks', { teamId: teamWork, cycleId: created.json.cycleId });
  assert.equal(r.status, 404);
  assert.equal(r.json.code, 'REGULAR_CYCLE_NOT_FOUND');
});

test('FR-28a Định kỳ: sinh task cá nhân đúng ngày tính từ regular_release_date của cycle đã chọn, không cho tự nhập ngày', async () => {
  await enableAutogen(teamWork);
  const regularDate = '2026-11-13'; // 1 thứ Sáu — dùng để tinhNgayRelease() tính ra staging.friday = chính ngày này
  const cycleId = await makeRegularCycle(regularDate);

  const definition = await req('POST', '/api/release/task-definitions', {
    title: uniq('[itest] regular personal task'), startTime: '10:00', dateToken: 'release.date'
  });
  assert.equal(definition.status, 201, JSON.stringify(definition.json));

  const generated = await req('POST', '/api/release/schedule/personal-regular-tasks', { teamId: teamWork, cycleId });
  assert.equal(generated.status, 201, JSON.stringify(generated.json));
  assert.equal(generated.json.created, 1);
  assert.equal(generated.json.skippedExisting, 0);

  const task = db.prepare('SELECT * FROM tasks WHERE origin_ref = ?').get(definition.json.id) as Record<string, unknown>;
  assert.ok(task, 'task cá nhân định kỳ phải được sinh ra');
  assert.equal(task.ngay_cu_the, regularDate, 'dateToken release.date phải khớp đúng regular_release_date của cycle đã chọn');
  assert.equal(task.owner_user_id, actor.userId);
  assert.equal(task.release_month, `regular:cycle${cycleId}:user${actor.userId}`, 'khoá nhóm phải gắn trực tiếp theo cycle_id + owner, không phải tháng dương lịch');

  // Sinh lại lần 2 -> idempotent, không tạo trùng.
  const again = await req('POST', '/api/release/schedule/personal-regular-tasks', { teamId: teamWork, cycleId });
  assert.equal(again.json.created, 0);
  assert.equal(again.json.skippedExisting, 1);
});

test('CR §6.3 cảnh báo kỹ thuật: 2 cycle định kỳ CÙNG tháng dương lịch cùng mở -> task cá nhân KHÔNG lẫn nhau, phải CHỌN ĐÚNG đợt', async () => {
  await enableAutogen(teamWork);
  const dateA = '2026-12-05';
  const dateB = '2026-12-19'; // cùng tháng 2026-12 với dateA — trước đây (khoá release_month=YYYY-MM) sẽ lẫn nhóm
  const cycleA = await makeRegularCycle(dateA);
  const cycleB = await makeRegularCycle(dateB);

  // GET regular-cycles phải liệt kê ĐỦ cả 2, sắp theo regular_release_date GẦN NHẤT TRƯỚC.
  const list = await req('GET', '/api/release/schedule/regular-cycles');
  assert.equal(list.status, 200);
  const ids = (list.json as { id: number; regularReleaseDate: string }[]).map((c) => c.id);
  assert.ok(ids.includes(cycleA) && ids.includes(cycleB), 'phải thấy cả 2 cycle đang mở');
  const idxA = ids.indexOf(cycleA);
  const idxB = ids.indexOf(cycleB);
  assert.ok(idxA < idxB, 'cycle ngày gần hơn (dateA) phải đứng trước cycle ngày xa hơn (dateB)');

  const definition = await req('POST', '/api/release/task-definitions', {
    title: uniq('[itest] cung thang khac dot'), startTime: '09:00', dateToken: 'release.date'
  });
  assert.equal(definition.status, 201);

  // Không so `created` tuyệt đối — actor này (dùng chung xuyên suốt file) có thể đã tích luỹ definition
  // từ các test trước, nên mỗi lần generate áp dụng cho MỌI definition của actor, không riêng definition
  // vừa tạo ở test này. Trọng tâm thật của test là: đúng ĐỊNH NGHĨA vừa tạo ở đây có task riêng cho
  // TỪNG cycle, không bị 1 trong 2 lần gọi báo "đã tồn tại" (skippedExisting) vì lẫn khoá nhóm.
  const genA = await req('POST', '/api/release/schedule/personal-regular-tasks', { teamId: teamWork, cycleId: cycleA });
  assert.ok(genA.json.created >= 1, JSON.stringify(genA.json));
  const genB = await req('POST', '/api/release/schedule/personal-regular-tasks', { teamId: teamWork, cycleId: cycleB });
  assert.ok(genB.json.created >= 1, JSON.stringify(genB.json), 'cycle B PHẢI tạo được task riêng, không bị coi là "đã tồn tại" do lẫn nhóm với cycle A');

  const rows = db.prepare('SELECT release_month, ngay_cu_the FROM tasks WHERE origin_ref = ? ORDER BY release_month')
    .all(definition.json.id) as { release_month: string; ngay_cu_the: string }[];
  assert.equal(rows.length, 2, 'phải có ĐÚNG 2 task riêng biệt, 1 cho mỗi cycle — không bị đè/lẫn nhau');
  const byCycleA = rows.find((r) => r.release_month === `regular:cycle${cycleA}:user${actor.userId}`);
  const byCycleB = rows.find((r) => r.release_month === `regular:cycle${cycleB}:user${actor.userId}`);
  assert.ok(byCycleA, 'phải có task riêng khoá theo cycle A');
  assert.ok(byCycleB, 'phải có task riêng khoá theo cycle B');
  assert.equal(byCycleA!.ngay_cu_the, dateA);
  assert.equal(byCycleB!.ngay_cu_the, dateB);
});

// ── Council review vòng 2 (2026-09-23) — lỗ hổng thật: authorize() policyKind 'personal_task' chỉ
// kiểm actor thuộc ÍT NHẤT 1 team đang Bật personal_task (BẤT KỲ team nào), không lọc riêng đúng
// `teamId` route đang thao tác. actor ở đây đã thuộc teamWork (personal_task đã Bật ở setup phía
// trên) — thêm teamC với personal_task TẮT (mặc định) nhưng Admin lỡ Bật autogen riêng cho C (2 bảng
// độc lập, không có ràng buộc/cascade) để mô phỏng đúng kịch bản CR mô tả. Khác test "actor không
// thuộc team -> NOT_TEAM_MEMBER" ở trên (dùng teamOutsider actor KHÔNG thuộc) — ở đây actor CÓ thuộc
// teamC thật, nên phải bị chặn bởi đúng lớp kiểm feature riêng-team, không phải lớp kiểm thành viên.
test('Bảo mật: personal_task Bật cho teamWork (khác) nhưng TẮT cho teamC -> sinh task định kỳ cho teamC phải bị chặn dù autogen đang Bật cho C', async () => {
  const teamC = await onboarding.makeTeam(adminSession, '[itest] Team C rieng - personal_task tat');
  // KHÔNG bật personal_task cho teamC — giữ nguyên mặc định 'off' (schema backfill).
  const teamCLeader = await onboarding.joinAndApprove('rs-personal-regular-teamc-leader@drjoy.jp', 'Leader Team C rieng', teamC, 'leader', adminSession);

  // actor (đã active, member teamWork) tham gia thêm teamC — dùng đúng route thật team_member.create.
  const addMember = await fetch(`${base}/api/teams/${teamC}/members`, {
    method: 'POST', headers: flow.H(teamCLeader.session), body: JSON.stringify({ userId: actor.userId })
  });
  if (!addMember.ok) throw new Error(`thêm actor vào teamC thất bại: ${addMember.status}`);

  // Admin lỡ bật autogen riêng cho teamC dù personal_task đang tắt cho C.
  const listAutogen = await (await fetch(`${base}/api/admin/release-task-autogen`, { headers: flow.H(adminSession) })).json() as
    { settings: { team_id: number; row_version: number }[] };
  const currentC = listAutogen.settings.find((s) => s.team_id === teamC);
  const enableC = await fetch(`${base}/api/admin/release-task-autogen`, {
    method: 'PUT', headers: flow.H(adminSession),
    body: JSON.stringify({ teamId: teamC, enabled: true, rowVersion: currentC?.row_version })
  });
  if (!enableC.ok) throw new Error(`bật autogen cho teamC thất bại: ${enableC.status}`);

  const cycleId = await makeRegularCycle('2026-12-26');

  // actor gọi sinh task cá nhân định kỳ cho TEAM C — gate chung policyKind 'personal_task' sẽ cho qua
  // (actor đã thuộc teamWork đang Bật personal_task), nên cái CHẶN THẬT phải là kiểm riêng đúng teamC.
  const r = await req('POST', '/api/release/schedule/personal-regular-tasks', { teamId: teamC, cycleId });
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.equal(r.json.code, 'FEATURE_DISABLED');

  const count = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE release_month = ?")
    .get(`regular:cycle${cycleId}:user${actor.userId}`) as { c: number };
  assert.equal(count.c, 0, 'không được sinh bất kỳ task cá nhân nào cho teamC khi personal_task đang TẮT cho ĐÚNG team đó');
});
