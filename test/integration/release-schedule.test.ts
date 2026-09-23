// CR-20260913 Lát 6 — test tích hợp cho server/routes/release-schedule.ts: FR-23a (đăng ký/sửa lịch
// khẩn cấp), FR-24 (lịch chung lọc field), FR-25 (xung đột + ép giờ chung), FR-26 (khoá/mở/tự khoá
// lại), FR-27 (huỷ), FR-23b (1 ngày chính định kỳ). Dùng chung harness OIDC giả ở fixtures/auth-harness.ts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-release-schedule-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'release-schedule-itest-admin-sub');

async function setReleaseCoordinator(teamId: number): Promise<void> {
  const current = await (await fetch(`${base}/api/admin/release-coordinator`, { headers: flow.H(adminSession) })).json() as { row_version: number };
  const res = await fetch(`${base}/api/admin/release-coordinator`, {
    method: 'PUT', headers: flow.H(adminSession), body: JSON.stringify({ teamId, rowVersion: current.row_version })
  });
  if (!res.ok) throw new Error(`setReleaseCoordinator thất bại: ${res.status}`);
}

const teamCoord = await onboarding.makeTeam(adminSession, '[itest] Team Dieu Phoi');
const teamA = await onboarding.makeTeam(adminSession, '[itest] Team RS A');
const teamB = await onboarding.makeTeam(adminSession, '[itest] Team RS B');
const teamC = await onboarding.makeTeam(adminSession, '[itest] Team RS C');
await onboarding.setFeatureVisibility(adminSession, teamCoord, 'release', 'on');
await onboarding.setFeatureVisibility(adminSession, teamA, 'release', 'on');
await onboarding.setFeatureVisibility(adminSession, teamB, 'release', 'on');
await onboarding.setFeatureVisibility(adminSession, teamC, 'release', 'on');
const coordLeader = await onboarding.joinAndApprove('rs-itest-coord@drjoy.jp', 'Leader Dieu Phoi', teamCoord, 'leader', adminSession);
const leaderA = await onboarding.joinAndApprove('rs-itest-leaderA@drjoy.jp', 'Leader A', teamA, 'leader', adminSession);
const memberA = await onboarding.joinAndApprove('rs-itest-memberA@drjoy.jp', 'Member A', teamA, 'member', adminSession);
const leaderB = await onboarding.joinAndApprove('rs-itest-leaderB@drjoy.jp', 'Leader B', teamB, 'leader', adminSession);
const leaderC = await onboarding.joinAndApprove('rs-itest-leaderC@drjoy.jp', 'Leader C', teamC, 'leader', adminSession);
await setReleaseCoordinator(teamCoord);

const coordHeaders = flow.H(coordLeader.session);
const leaderAHeaders = flow.H(leaderA.session);
const memberAHeaders = flow.H(memberA.session);
const leaderBHeaders = flow.H(leaderB.session);
const leaderCHeaders = flow.H(leaderC.session);

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

function registrationBody(overrides: Record<string, unknown> = {}) {
  return {
    teamId: teamA,
    deployStagingAt: { date: '2026-10-05', time: '13:00' },
    releaseAt: { date: '2026-10-05', time: '15:00' },
    affectedSystems: ['Dr.JOY'],
    platforms: ['Web'],
    ticketNumbers: [123, 456],
    japanCoordinationLink: 'https://example.com/thread/1',
    notes: '',
    ...overrides
  };
}

// ── FR-23a: đăng ký lịch khẩn cấp ────────────────────────────────────────────────────────────────
test('SEC: POST registrations chưa đăng nhập -> 401', async () => {
  const r = await fetch(`${base}/api/release/schedule/registrations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registrationBody())
  });
  assert.equal(r.status, 401);
});

test('FR-23a: Leader team A tạo đăng ký -> 201, deploy_demo_at tự tính 16:00 cùng ngày release', async () => {
  const r = await req('POST', '/api/release/schedule/registrations', registrationBody());
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.deployDemoAt, '2026-10-05 16:00');
  assert.equal(r.json.status, 'submitted');
});

test('FR-23a: Member không tạo được đăng ký (Leader-only) -> 403 ROLE_FORBIDDEN', async () => {
  const r = await req('POST', '/api/release/schedule/registrations', registrationBody({ deployStagingAt: { date: '2026-10-06', time: '13:00' }, releaseAt: { date: '2026-10-06', time: '15:00' } }), memberAHeaders);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'ROLE_FORBIDDEN');
});

test('FR-23a: thiếu CẢ HAI link Nhật lẫn lý do -> 400', async () => {
  const r = await req('POST', '/api/release/schedule/registrations', registrationBody({
    deployStagingAt: { date: '2026-10-07', time: '13:00' }, releaseAt: { date: '2026-10-07', time: '15:00' },
    japanCoordinationLink: undefined, noJapanCoordinationReason: undefined
  }));
  assert.equal(r.status, 400);
});

test('FR-23a: team đã có đăng ký cho đúng ngày đó -> 409 RELEASE_REGISTRATION_EXISTS', async () => {
  const day = { date: '2026-10-08', time: '13:00' };
  const first = await req('POST', '/api/release/schedule/registrations', registrationBody({ deployStagingAt: day, releaseAt: { date: '2026-10-08', time: '15:00' } }));
  assert.equal(first.status, 201);
  const second = await req('POST', '/api/release/schedule/registrations', registrationBody({ deployStagingAt: day, releaseAt: { date: '2026-10-08', time: '16:00' } }));
  assert.equal(second.status, 409);
  assert.equal(second.json.code, 'RELEASE_REGISTRATION_EXISTS');
});

// ── FR-25: xung đột tự phát hiện + ép giờ chung ─────────────────────────────────────────────────
test('FR-25: 2 team cùng ngày khác giờ release -> xung đột "open" hiện trên lịch chung; ép giờ chung xong -> "forced", KHÔNG còn "open"', async () => {
  const day = '2026-10-10';
  const a = await req('POST', '/api/release/schedule/registrations', registrationBody({
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' }
  }), leaderAHeaders);
  assert.equal(a.status, 201);
  const b = await req('POST', '/api/release/schedule/registrations', registrationBody({
    teamId: teamB, deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '17:00' }
  }), leaderBHeaders);
  assert.equal(b.status, 201);

  const board = await req('GET', '/api/release/schedule-board', undefined, leaderAHeaders);
  assert.equal(board.status, 200);
  const cycle = (board.json.cycles as any[]).find((c) => c.releaseKey === `emergency:${day}`);
  assert.ok(cycle, 'phải thấy cycle của ngày vừa đăng ký');
  const openConflict = cycle.conflicts.find((c: any) => c.status === 'open');
  assert.ok(openConflict, 'phải có xung đột open giữa team A và B (khác giờ release)');

  // Leader team A KHÔNG ép giờ chung được (không phải Leader điều phối) — actor không thuộc team điều
  // phối nên bị chặn ngay ở bước 2 (thành viên team) của authorize(), mã NOT_TEAM_MEMBER; bước 4
  // (NOT_RELEASE_COORDINATOR) chỉ chạm tới khi actor ĐÃ là thành viên team điều phối nhưng sai vai trò.
  const forbidden = await req('POST', `/api/release/schedule/conflicts/${openConflict.id}/force-time`, {
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '16:00' }
  }, leaderAHeaders);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.code, 'NOT_TEAM_MEMBER');

  const forced = await req('POST', `/api/release/schedule/conflicts/${openConflict.id}/force-time`, {
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '16:00' }
  }, coordHeaders);
  assert.equal(forced.status, 200, JSON.stringify(forced.json));

  const boardAfter = await req('GET', '/api/release/schedule-board', undefined, leaderAHeaders);
  const cycleAfter = (boardAfter.json.cycles as any[]).find((c) => c.releaseKey === `emergency:${day}`);
  assert.ok(!cycleAfter.conflicts.some((c: any) => c.status === 'open'), 'không còn xung đột open sau khi ép giờ chung');
  assert.ok(cycleAfter.conflicts.some((c: any) => c.status === 'forced'));
  const regA = cycleAfter.registrations.find((r: any) => r.teamId === teamA);
  assert.equal(regA.releaseAt, '2026-10-10 16:00');
});

// ── FR-25 (Council review vòng 2, 2026-09-23) — hội tụ 3 team + không mất dấu xung đột ────────────
// 3 team cùng ngày khác giờ release -> 3 cặp xung đột "open" (A-B, A-C, B-C). Ép dần từng cặp cho tới
// khi hội tụ (không còn cặp nào "open", cả 3 registration cùng giờ). Trọng tâm: reconcileConflictsForCycle()
// đọc code cho thấy nó chỉ so registration hiện tại với các dòng CONFLICT có status='open' (không quan
// tâm dòng cũ đã 'forced'/'resolved') — nên nếu 1 registration vừa bị ép ở 1 pha (vd A-B) rồi sau đó bị
// ép LẠI ở 1 pha khác không cùng đối tác (vd A-C, làm A trôi khỏi giá trị đã khớp với B) thì cặp A-B
// phải tự phát sinh lại 1 dòng "open" MỚI — xác nhận đúng bằng thực nghiệm dưới đây, không chỉ đọc code
// suy luận (R-CODE của dự án: không đoán hành vi chưa kiểm chứng thật).
test('FR-25: 3 team cùng ngày khác giờ release -> ép dần từng cặp tới khi hội tụ, KHÔNG mất dấu xung đột', async () => {
  const day = '2026-10-20';
  const a = await req('POST', '/api/release/schedule/registrations', registrationBody({
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' }
  }), leaderAHeaders);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const b = await req('POST', '/api/release/schedule/registrations', registrationBody({
    teamId: teamB, deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '16:00' }
  }), leaderBHeaders);
  assert.equal(b.status, 201, JSON.stringify(b.json));
  const c = await req('POST', '/api/release/schedule/registrations', registrationBody({
    teamId: teamC, deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '17:00' }
  }), leaderCHeaders);
  assert.equal(c.status, 201, JSON.stringify(c.json));

  async function loadCycle() {
    const board = await req('GET', '/api/release/schedule-board', undefined, leaderAHeaders);
    assert.equal(board.status, 200);
    const cycle = (board.json.cycles as any[]).find((cy) => cy.releaseKey === `emergency:${day}`);
    assert.ok(cycle, 'phải thấy cycle của ngày vừa đăng ký');
    return cycle as { registrations: { id: number; teamId: number; releaseAt: string }[]; conflicts: { id: number; registration_a_id: number; registration_b_id: number; status: string }[] };
  }
  // 1 cặp registration có thể có NHIỀU dòng conflict theo thời gian (dòng cũ đã forced/resolved vẫn
  // giữ lại làm lịch sử, dòng "open" mới phát sinh lại là 1 bản ghi RIÊNG — xem comment ở
  // reconcileConflictsForCycle()/server/lib/release-schedule.ts) — trả về TOÀN BỘ để test tự chọn
  // đúng dòng cần soi, không chỉ lấy dòng đầu tiên khớp.
  function findConflicts(cycle: Awaited<ReturnType<typeof loadCycle>>, teamX: number, teamY: number) {
    const regX = cycle.registrations.find((r) => r.teamId === teamX)!.id;
    const regY = cycle.registrations.find((r) => r.teamId === teamY)!.id;
    return cycle.conflicts.filter((cf) =>
      (cf.registration_a_id === regX && cf.registration_b_id === regY) ||
      (cf.registration_a_id === regY && cf.registration_b_id === regX)
    );
  }
  function findOpenConflict(cycle: Awaited<ReturnType<typeof loadCycle>>, teamX: number, teamY: number) {
    return findConflicts(cycle, teamX, teamY).find((cf) => cf.status === 'open');
  }

  let cycle = await loadCycle();
  assert.equal(cycle.conflicts.filter((cf) => cf.status === 'open').length, 3, 'phải có đủ 3 cặp xung đột open ban đầu (A-B, A-C, B-C)');
  const abInitial = findOpenConflict(cycle, teamA, teamB);
  assert.ok(abInitial && findOpenConflict(cycle, teamA, teamC) && findOpenConflict(cycle, teamB, teamC), 'đủ 3 cặp đang open');

  // Bước 1 — ép A-B về giờ trung gian 18:00 (khác cả C=17:00) -> A-B chuyển "forced" ngay; A-C, B-C vẫn
  // "open" vì C chưa đổi giờ.
  const force1 = await req('POST', `/api/release/schedule/conflicts/${abInitial!.id}/force-time`, {
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '18:00' }
  }, coordHeaders);
  assert.equal(force1.status, 200, JSON.stringify(force1.json));

  cycle = await loadCycle();
  assert.deepEqual(findConflicts(cycle, teamA, teamB).map((cf) => cf.status), ['forced'], 'A-B chuyển forced ngay sau khi ép, đúng 1 dòng');
  assert.ok(findOpenConflict(cycle, teamA, teamC), 'A-C vẫn open — C chưa đổi giờ');
  assert.ok(findOpenConflict(cycle, teamB, teamC), 'B-C vẫn open — C chưa đổi giờ');

  // Bước 2 — ép A-C về 19:00 -> A và C cùng 19:00, nhưng B vẫn đứng ở 18:00 (từ bước 1) -> cặp A-B (đang
  // "forced") LỆCH GIỜ TRỞ LẠI (A=19, B=18). reconcileConflictsForCycle() PHẢI tự tạo lại 1 dòng "open"
  // MỚI cho đúng cặp A-B (dòng "forced" cũ vẫn giữ nguyên, không bị ghi đè/xoá) — đây là hành vi cốt lõi
  // cần xác nhận bằng thực nghiệm, không chỉ đọc code suy luận.
  const acId = findOpenConflict(cycle, teamA, teamC)!.id;
  const force2 = await req('POST', `/api/release/schedule/conflicts/${acId}/force-time`, {
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '19:00' }
  }, coordHeaders);
  assert.equal(force2.status, 200, JSON.stringify(force2.json));

  cycle = await loadCycle();
  const abConflictsAfterStep2 = findConflicts(cycle, teamA, teamB);
  assert.equal(abConflictsAfterStep2.length, 2, 'A-B phải có 2 dòng: dòng "forced" cũ (lịch sử) + 1 dòng "open" MỚI tự phát sinh do lệch giờ trở lại');
  assert.deepEqual(abConflictsAfterStep2.map((cf) => cf.status).sort(), ['forced', 'open'], 'không được mất dấu — phải thấy cả dòng lịch sử lẫn dòng open mới');
  const abAfterStep2 = abConflictsAfterStep2.find((cf) => cf.status === 'open')!;
  assert.notEqual(abAfterStep2.id, abInitial!.id, 'dòng open mới phải là 1 bản ghi MỚI, khác id dòng đã forced trước đó');
  assert.deepEqual(findConflicts(cycle, teamA, teamC).map((cf) => cf.status), ['forced'], 'A-C chuyển forced, đúng 1 dòng');
  assert.ok(findOpenConflict(cycle, teamB, teamC), 'B-C vẫn open — B(18:00) vs C(19:00) vẫn lệch giờ');
  assert.equal(findConflicts(cycle, teamB, teamC).length, 1, 'B-C chưa từng bị ép — vẫn đúng 1 dòng duy nhất từ đầu');

  // Bước 3 — ép cặp A-B (dòng MỚI vừa được tạo lại) về đúng giờ đã khớp giữa A/C (19:00) -> hội tụ: cả 3
  // registration cùng giờ, KHÔNG còn cặp nào open.
  const force3 = await req('POST', `/api/release/schedule/conflicts/${abAfterStep2.id}/force-time`, {
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '19:00' }
  }, coordHeaders);
  assert.equal(force3.status, 200, JSON.stringify(force3.json));

  cycle = await loadCycle();
  assert.equal(cycle.conflicts.filter((cf) => cf.status === 'open').length, 0, 'phải hội tụ — không còn cặp nào open');
  const times = new Set(cycle.registrations.map((r) => r.releaseAt));
  assert.equal(times.size, 1, 'cả 3 registration phải cùng giờ release sau khi hội tụ');
  assert.equal([...times][0], `${day} 19:00`);
});

// ── FR-24: lịch chung lọc field theo team sở hữu ────────────────────────────────────────────────
test('FR-24: team KHÁC chỉ thấy ngày/giờ/hệ thống/nền tảng, KHÔNG thấy ticket/link Nhật/ghi chú', async () => {
  const day = '2026-10-12';
  const created = await req('POST', '/api/release/schedule/registrations', registrationBody({
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' }, notes: 'ghi chú nội bộ bí mật'
  }));
  assert.equal(created.status, 201);

  const boardFromB = await req('GET', '/api/release/schedule-board', undefined, leaderBHeaders);
  const cycle = (boardFromB.json.cycles as any[]).find((c) => c.releaseKey === `emergency:${day}`);
  const regFromOtherTeam = cycle.registrations.find((r: any) => r.teamId === teamA);
  assert.ok(regFromOtherTeam);
  assert.equal(regFromOtherTeam.notes, undefined, 'team khác không được thấy notes');
  assert.equal(regFromOtherTeam.ticketNumbers, undefined, 'team khác không được thấy ticketNumbers');
  assert.equal(regFromOtherTeam.japanCoordinationLink, undefined, 'team khác không được thấy japanCoordinationLink');
  assert.ok(Array.isArray(regFromOtherTeam.affectedSystems), 'team khác vẫn thấy hệ thống bị ảnh hưởng');

  const boardFromOwnTeam = await req('GET', '/api/release/schedule-board', undefined, leaderAHeaders);
  const cycleOwn = (boardFromOwnTeam.json.cycles as any[]).find((c) => c.releaseKey === `emergency:${day}`);
  const ownReg = cycleOwn.registrations.find((r: any) => r.teamId === teamA);
  assert.equal(ownReg.notes, 'ghi chú nội bộ bí mật', 'chính team sở hữu vẫn thấy đầy đủ');
});

// ── FR-26: khoá/mở khoá cả cycle, tự khoá lại khi lưu ───────────────────────────────────────────
test('FR-26: Khoá lịch cấp cả cycle -> mọi registration của cycle đó chuyển "locked", sửa trực tiếp bị 409', async () => {
  const day = '2026-10-15';
  const created = await req('POST', '/api/release/schedule/registrations', registrationBody({
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' }
  }));
  const cycleId = created.json.cycleId;

  const lockForbidden = await req('POST', `/api/release/schedule/cycles/${cycleId}/lock`, {}, leaderAHeaders);
  assert.equal(lockForbidden.status, 403, 'chỉ Leader điều phối mới khoá được');

  const lock = await req('POST', `/api/release/schedule/cycles/${cycleId}/lock`, {}, coordHeaders);
  assert.equal(lock.status, 200);

  const patchAttempt = await req('PATCH', `/api/release/schedule/registrations/${created.json.id}`, registrationBody({
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:30' }, rowVersion: created.json.rowVersion
  }));
  assert.equal(patchAttempt.status, 409);
  assert.equal(patchAttempt.json.code, 'REGISTRATION_LOCKED');
});

test('FR-26: gửi yêu cầu mở khoá -> Leader điều phối duyệt -> mở TOÀN BỘ cycle -> team sửa xong tự khoá lại đúng dòng của mình', async () => {
  const day = '2026-10-16';
  const regA = await req('POST', '/api/release/schedule/registrations', registrationBody({
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' }
  }), leaderAHeaders);
  const regB = await req('POST', '/api/release/schedule/registrations', registrationBody({
    teamId: teamB, deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' }
  }), leaderBHeaders);
  const cycleId = regA.json.cycleId;
  await req('POST', `/api/release/schedule/cycles/${cycleId}/lock`, {}, coordHeaders);

  const unlockReq = await req('POST', `/api/release/schedule/registrations/${regA.json.id}/unlock-requests`, { kind: 'edit', reason: 'cần đổi giờ' }, leaderAHeaders);
  assert.equal(unlockReq.status, 201, JSON.stringify(unlockReq.json));

  const pending = await req('GET', '/api/release/schedule/unlock-requests', undefined, coordHeaders);
  assert.equal(pending.status, 200);
  const found = pending.json.find((r: any) => r.id === unlockReq.json.id);
  assert.ok(found, 'yêu cầu vừa gửi phải xuất hiện trong danh sách chờ duyệt của Leader điều phối');
  assert.equal(found.kind, 'edit');
  assert.equal(found.reason, 'cần đổi giờ');
  assert.equal(found.teamId, teamA);

  const pendingAsNonCoordinator = await req('GET', '/api/release/schedule/unlock-requests', undefined, leaderAHeaders);
  assert.equal(pendingAsNonCoordinator.status, 403, 'chỉ Leader team điều phối mới xem được danh sách này');

  const approve = await req('POST', `/api/release/schedule/unlock-requests/${unlockReq.json.id}/approve`, {}, coordHeaders);
  assert.equal(approve.status, 200);

  const pendingAfterApprove = await req('GET', '/api/release/schedule/unlock-requests', undefined, coordHeaders);
  assert.ok(!pendingAfterApprove.json.some((r: any) => r.id === unlockReq.json.id), 'yêu cầu đã duyệt không còn hiện trong danh sách chờ');

  const regBAfterOpen = await req('GET', '/api/release/schedule-board', undefined, leaderBHeaders);
  const cycleAfterOpen = (regBAfterOpen.json.cycles as any[]).find((c) => c.id === cycleId);
  const regBRow = cycleAfterOpen.registrations.find((r: any) => r.teamId === teamB);
  assert.equal(regBRow.status, 'submitted', 'mở TOÀN BỘ cycle, không chỉ riêng team đã gửi yêu cầu');

  const patchA = await req('PATCH', `/api/release/schedule/registrations/${regA.json.id}`, registrationBody({
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:45' }, rowVersion: regA.json.rowVersion
  }), leaderAHeaders);
  assert.equal(patchA.status, 200, JSON.stringify(patchA.json));
  assert.equal(patchA.json.status, 'locked', 'lưu xong tự khoá lại ĐÚNG dòng của team A');

  const boardFinal = await req('GET', '/api/release/schedule-board', undefined, leaderBHeaders);
  const cycleFinal = (boardFinal.json.cycles as any[]).find((c) => c.id === cycleId);
  const regBFinal = cycleFinal.registrations.find((r: any) => r.teamId === teamB);
  assert.equal(regBFinal.status, 'submitted', 'team B chưa tự lưu -> vẫn đang mở, chưa bị khoá lại');
});

// ── FR-27: huỷ đợt ───────────────────────────────────────────────────────────────────────────────
test('FR-27: chưa khoá -> Leader team tự huỷ trực tiếp qua status=cancelled', async () => {
  const day = '2026-10-18';
  const created = await req('POST', '/api/release/schedule/registrations', registrationBody({
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' }
  }));
  const cancel = await req('POST', `/api/release/schedule/registrations/${created.json.id}/cancel`, { rowVersion: created.json.rowVersion });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.status, 'cancelled');
});

test('FR-27: đã khoá -> huỷ trực tiếp bị chặn, phải gửi yêu cầu kind=cancel, duyệt xong chuyển thẳng cancelled', async () => {
  const day = '2026-10-19';
  const created = await req('POST', '/api/release/schedule/registrations', registrationBody({
    deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' }
  }));
  await req('POST', `/api/release/schedule/cycles/${created.json.cycleId}/lock`, {}, coordHeaders);

  const directCancel = await req('POST', `/api/release/schedule/registrations/${created.json.id}/cancel`, {});
  assert.equal(directCancel.status, 409);
  assert.equal(directCancel.json.code, 'REGISTRATION_LOCKED');

  const cancelReq = await req('POST', `/api/release/schedule/registrations/${created.json.id}/unlock-requests`, { kind: 'cancel', reason: 'không release nữa' });
  assert.equal(cancelReq.status, 201);
  const approve = await req('POST', `/api/release/schedule/unlock-requests/${cancelReq.json.id}/approve`, {}, coordHeaders);
  assert.equal(approve.status, 200);

  const board = await req('GET', '/api/release/schedule-board', undefined, leaderAHeaders);
  const cycle = (board.json.cycles as any[]).find((c) => c.id === created.json.cycleId);
  assert.equal(cycle, undefined, 'registration đã cancelled -> không còn hiện trên lịch chung (cycle rỗng bị lọc)');
});

// ── FR-23b: 1 ngày chính cho định kỳ, chỉ Leader điều phối ─────────────────────────────────────
test('FR-23b: chỉ Leader team điều phối ấn định được ngày chính định kỳ; team khác bị chặn', async () => {
  const forbidden = await req('POST', '/api/release/schedule/regular-cycles', { regularReleaseDate: '2026-11-06' }, leaderAHeaders);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.json.code, 'NOT_TEAM_MEMBER');

  const ok = await req('POST', '/api/release/schedule/regular-cycles', { regularReleaseDate: '2026-11-06' }, coordHeaders);
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.releaseKey, 'regular:2026-11-06');

  const dup = await req('POST', '/api/release/schedule/regular-cycles', { regularReleaseDate: '2026-11-06' }, coordHeaders);
  assert.equal(dup.status, 409);
});
