// CR-20260913 Lát 6 — test tích hợp cho FR-26 bước 7 (đổi ngày release sang ngày khác sau khi mở khoá
// -> registration tự chuyển sang cycle_id của ngày mới) trong server/routes/release-schedule.ts, PATCH
// /release/schedule/registrations/:id. Phát hiện qua Council review Lát 6 (Claude + 2 lượt Codex, cả 3
// đồng thanh): route cũ CỐ Ý trả 400 khi đổi releaseAt sang ngày khác, trái FR-26 bước 7 đã chốt trong
// CR (dòng ~766-770 và nhắc lại ~1549-1551).
//
// Cũng chứa test cho AC-21a (mã lỗi 409 REGISTRATION_LOCKED — quyết định giữ 409 thay vì 403 như câu
// chữ AC viết, xem báo cáo bàn giao): "đợt đã khoá, team chưa từng đăng ký gọi POST tạo mới -> bị chặn".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-release-cycle-transfer-itest-'));
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
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'rs-cycle-transfer-itest-admin-sub');

async function setReleaseCoordinator(teamId: number): Promise<void> {
  const current = await (await fetch(`${base}/api/admin/release-coordinator`, { headers: flow.H(adminSession) })).json() as { row_version: number };
  const res = await fetch(`${base}/api/admin/release-coordinator`, {
    method: 'PUT', headers: flow.H(adminSession), body: JSON.stringify({ teamId, rowVersion: current.row_version })
  });
  if (!res.ok) throw new Error(`setReleaseCoordinator thất bại: ${res.status}`);
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

const teamCoord = await onboarding.makeTeam(adminSession, '[itest] Team Dieu Phoi CT');
const teamA = await onboarding.makeTeam(adminSession, '[itest] Team CT A');
const teamB = await onboarding.makeTeam(adminSession, '[itest] Team CT B');
const teamC = await onboarding.makeTeam(adminSession, '[itest] Team CT C');
await onboarding.setFeatureVisibility(adminSession, teamCoord, 'release', 'on');
await onboarding.setFeatureVisibility(adminSession, teamA, 'release', 'on');
await onboarding.setFeatureVisibility(adminSession, teamB, 'release', 'on');
await onboarding.setFeatureVisibility(adminSession, teamC, 'release', 'on');
await onboarding.setFeatureVisibility(adminSession, teamA, 'personal_task', 'on');
const coordLeader = await onboarding.joinAndApprove('rs-ct-coord@drjoy.jp', 'Leader Dieu Phoi CT', teamCoord, 'leader', adminSession);
const leaderA = await onboarding.joinAndApprove('rs-ct-leaderA@drjoy.jp', 'Leader CT A', teamA, 'leader', adminSession);
const leaderB = await onboarding.joinAndApprove('rs-ct-leaderB@drjoy.jp', 'Leader CT B', teamB, 'leader', adminSession);
const leaderC = await onboarding.joinAndApprove('rs-ct-leaderC@drjoy.jp', 'Leader CT C', teamC, 'leader', adminSession);
await setReleaseCoordinator(teamCoord);
await enableAutogen(teamA);

const coordHeaders = flow.H(coordLeader.session);
const leaderAHeaders = flow.H(leaderA.session);
const leaderBHeaders = flow.H(leaderB.session);
const leaderCHeaders = flow.H(leaderC.session);

// 2026-09-25 (docs/exchanges/2026-09-25.md) — Admin bật autogen team chỉ mở khả năng, leaderA còn phải
// tự bật riêng cho mình mới thật sự sinh task được.
await (async () => {
  const res = await fetch(`${base}/api/release/schedule/personal-task-pref`, {
    method: 'PUT', headers: leaderAHeaders, body: JSON.stringify({ teamId: teamA, enabled: true })
  });
  if (!res.ok) throw new Error(`setOwnPref(teamA) thất bại: ${res.status}`);
})();

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

// ── AC-21a: mã lỗi giữ 409 (không đổi sang 403 như câu chữ AC) — đợt đã khoá, team CHƯA từng đăng ký
// gọi POST tạo mới -> bị chặn, phải đi đúng luồng xin mở khoá như các team đã có mặt (FR-26 bước 8).
test('AC-21a: đợt đã khoá, team chưa từng đăng ký gọi POST tạo mới -> 409 REGISTRATION_LOCKED (không phải 403)', async () => {
  const day = '2026-12-01';
  const first = await req('POST', '/api/release/schedule/registrations', {
    teamId: teamA, deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '15:00' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co'
  }, leaderAHeaders);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const cycleId = first.json.cycleId;

  const lock = await req('POST', `/api/release/schedule/cycles/${cycleId}/lock`, {}, coordHeaders);
  assert.equal(lock.status, 200);

  const blocked = await req('POST', '/api/release/schedule/registrations', {
    teamId: teamC, deployStagingAt: { date: day, time: '13:00' }, releaseAt: { date: day, time: '18:00' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co'
  }, leaderCHeaders);
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
  assert.equal(blocked.json.code, 'REGISTRATION_LOCKED');
});

// ── FR-26 bước 7: đổi ngày release (sau khi mở khoá) -> registration tự chuyển cycle ────────────────
test('FR-26 bước 7: đổi releaseAt sang ngày khác -> registration tự chuyển cycle, xung đột cũ tự đóng, xung đột mới phát sinh, task cá nhân đi theo, cycle cũ vẫn còn lịch sử, có audit chuyển cycle', async () => {
  const dayX = '2026-12-05';
  const dayY = '2026-12-06';

  // Team A + Team B cùng đăng ký ngày X, khác giờ release -> xung đột "open".
  const regA = await req('POST', '/api/release/schedule/registrations', {
    teamId: teamA, deployStagingAt: { date: dayX, time: '13:00' }, releaseAt: { date: dayX, time: '15:00' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co'
  }, leaderAHeaders);
  assert.equal(regA.status, 201, JSON.stringify(regA.json));
  const cycleXId = regA.json.cycleId;

  const regB = await req('POST', '/api/release/schedule/registrations', {
    teamId: teamB, deployStagingAt: { date: dayX, time: '13:00' }, releaseAt: { date: dayX, time: '16:00' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co'
  }, leaderBHeaders);
  assert.equal(regB.status, 201, JSON.stringify(regB.json));

  const boardBeforeX = await req('GET', '/api/release/schedule-board', undefined, leaderAHeaders);
  const cycleXBefore = (boardBeforeX.json.cycles as any[]).find((c) => c.id === cycleXId);
  const conflictAB = cycleXBefore.conflicts.find((c: any) => c.status === 'open');
  assert.ok(conflictAB, 'phải có xung đột open giữa team A và B ở cycle X (khác giờ release)');

  // Sinh task cá nhân khẩn cấp cho team A ở cycle X.
  const template = await req('POST', '/api/release/emergency/templates', { name: '[itest CT] Tpl', content: 'Release {{release.deployAt}}' }, leaderAHeaders);
  assert.equal(template.status, 201, JSON.stringify(template.json));
  const definition = await req('POST', '/api/release/emergency/task-definitions', {
    title: '[itest CT] Thong bao release', timingToken: 'release_deploy', startTime: 'relative',
    relativeOffsetMinutes: 0, scheduleMode: 'custom', templateId: template.json.id
  }, leaderAHeaders);
  assert.equal(definition.status, 201, JSON.stringify(definition.json));
  const generated = await req('POST', '/api/release/schedule/personal-emergency-tasks', { teamId: teamA, cycleId: cycleXId, locale: 'vi' }, leaderAHeaders);
  assert.equal(generated.status, 201, JSON.stringify(generated.json));
  assert.equal(generated.json.created, 1);

  const taskBefore = db.prepare('SELECT gio_bat_dau, ngay_cu_the, release_month FROM tasks WHERE origin_ref = ?').get(definition.json.id) as
    { gio_bat_dau: string; ngay_cu_the: string; release_month: string };
  assert.equal(taskBefore.gio_bat_dau, '15:00');
  assert.equal(taskBefore.ngay_cu_the, dayX);
  assert.match(taskBefore.release_month, new RegExp(`^emergency:${dayX}:team${teamA}:user`));

  // Khoá cả đợt X, team A xin mở khoá, điều phối duyệt -> mở lại toàn bộ cycle X ("sau khi mở khoá",
  // đúng tiền đề của AC-21a phần 2).
  const lockX = await req('POST', `/api/release/schedule/cycles/${cycleXId}/lock`, {}, coordHeaders);
  assert.equal(lockX.status, 200);
  const unlockReq = await req('POST', `/api/release/schedule/registrations/${regA.json.id}/unlock-requests`, { kind: 'edit', reason: 'doi ngay release' }, leaderAHeaders);
  assert.equal(unlockReq.status, 201, JSON.stringify(unlockReq.json));
  const approve = await req('POST', `/api/release/schedule/unlock-requests/${unlockReq.json.id}/approve`, {}, coordHeaders);
  assert.equal(approve.status, 200, JSON.stringify(approve.json));

  // Team C đăng ký sẵn ngày Y, giờ release KHÁC giờ team A sắp chuyển sang -> sau khi A chuyển tới phải
  // phát sinh xung đột MỚI giữa A và C.
  const regC = await req('POST', '/api/release/schedule/registrations', {
    teamId: teamC, deployStagingAt: { date: dayY, time: '13:00' }, releaseAt: { date: dayY, time: '17:00' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co'
  }, leaderCHeaders);
  assert.equal(regC.status, 201, JSON.stringify(regC.json));
  const cycleYId = regC.json.cycleId;
  assert.notEqual(cycleYId, cycleXId, 'cycle Y phải là 1 cycle khác cycle X');

  // Team A đổi releaseAt sang ngày Y (khác ngày cycle X hiện tại) -> phải tự chuyển cycle, KHÔNG còn bị
  // chặn 400 như trước khi sửa.
  const patchTransfer = await req('PATCH', `/api/release/schedule/registrations/${regA.json.id}`, {
    deployStagingAt: { date: dayY, time: '13:00' }, releaseAt: { date: dayY, time: '15:30' },
    affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'khong co', rowVersion: regA.json.rowVersion
  }, leaderAHeaders);
  assert.equal(patchTransfer.status, 200, JSON.stringify(patchTransfer.json));
  assert.equal(patchTransfer.json.cycleId, cycleYId, 'registration phải tự chuyển sang cycle_id của ngày mới');
  assert.equal(patchTransfer.json.releaseAt, `${dayY} 15:30`);

  // Xung đột CŨ (A-B ở cycle X) phải tự đóng vì A không còn ở cycle X nữa.
  const boardAfterX = await req('GET', '/api/release/schedule-board', undefined, leaderBHeaders);
  const cycleXAfter = (boardAfterX.json.cycles as any[]).find((c) => c.id === cycleXId);
  assert.ok(cycleXAfter, 'cycle X vẫn phải còn hiện trên lịch chung (team B vẫn ở đó)');
  assert.ok(!cycleXAfter.conflicts.some((c: any) => c.status === 'open'), 'xung đột cũ A-B ở cycle X phải tự đóng, không còn open');
  assert.ok(cycleXAfter.conflicts.some((c: any) => c.status === 'resolved'), 'xung đột cũ A-B phải chuyển resolved');

  // Xung đột MỚI (A-C ở cycle Y) phải phát sinh vì giờ release khác nhau (15:30 vs 17:00).
  const boardAfterY = await req('GET', '/api/release/schedule-board', undefined, leaderCHeaders);
  const cycleYAfter = (boardAfterY.json.cycles as any[]).find((c) => c.id === cycleYId);
  assert.ok(cycleYAfter, 'cycle Y phải hiện trên lịch chung');
  const newConflict = cycleYAfter.conflicts.find((c: any) => c.status === 'open');
  assert.ok(newConflict, 'phải phát sinh xung đột MỚI giữa team A (vừa chuyển tới) và team C ở cycle Y');

  // Cycle X (nếu rỗng sau khi A rời đi) vẫn phải còn trong DB làm lịch sử, không bị xoá — ở đây cycle X
  // không thực sự rỗng (team B vẫn còn) nhưng khẳng định thêm: code không hề có đường xoá release_cycles
  // nào, kiểm trực tiếp DB cho chắc.
  const cycleXRow = db.prepare('SELECT id FROM release_cycles WHERE id = ?').get(cycleXId);
  assert.ok(cycleXRow, 'cycle X phải vẫn còn trong DB, không bị xoá');

  // Task cá nhân đã sinh từ team A cho cycle X phải "đi theo" sang cycle Y — không mồ côi: release_month
  // đổi tiền tố sang cycle Y, giờ/ngày re-render theo đúng anchor MỚI.
  const taskAfter = db.prepare('SELECT gio_bat_dau, ngay_cu_the, release_month FROM tasks WHERE origin_ref = ?').get(definition.json.id) as
    { gio_bat_dau: string; ngay_cu_the: string; release_month: string };
  assert.equal(taskAfter.ngay_cu_the, dayY, 'task cá nhân phải chuyển ngày sang đúng ngày release MỚI');
  assert.equal(taskAfter.gio_bat_dau, '15:30', 'task cá nhân phải tự tính lại giờ theo mỏ neo MỚI (release_deploy = 15:30, offset 0)');
  assert.match(taskAfter.release_month, new RegExp(`^emergency:${dayY}:team${teamA}:user`), 'release_month phải đổi tiền tố sang cycle MỚI, không còn mang ngày cũ (không mồ côi)');

  // audit_log phải ghi nhận riêng việc CHUYỂN CYCLE, khác action với release_registration.update thường.
  const auditRow = db.prepare(`
    SELECT payload FROM audit_log WHERE action = 'release_registration.cycle_transfer' AND target = ? ORDER BY id DESC LIMIT 1
  `).get(`team_release_registration:${regA.json.id}`) as { payload: string } | undefined;
  assert.ok(auditRow, 'phải có 1 dòng audit_log riêng cho việc chuyển cycle');
  const payload = JSON.parse(auditRow!.payload);
  assert.equal(payload.oldCycleId, cycleXId);
  assert.equal(payload.newCycleId, cycleYId);
  assert.equal(payload.oldReleaseDateKey, dayX);
  assert.equal(payload.newReleaseDateKey, dayY);
});
