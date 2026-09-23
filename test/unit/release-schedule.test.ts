// CR-20260913 Lát 6 (FR-25/FR-26) — test thuần cho server/lib/release-schedule.ts: tìm-hoặc-tạo cycle
// khẩn cấp, phát hiện/tự đóng xung đột, ép giờ chung, render task cá nhân khẩn cấp theo mỏ neo. Dùng
// DB SQLite tạm (qua applySlice4Schema, cùng cách slice4-migrate.test.ts dựng fixture) — KHÔNG khởi
// Express, chạy nhanh hơn hẳn integration test qua HTTP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applySlice4Schema } from '../../server/ops/slice4-migrate.js';
import {
  parseWallClock, wallClockDateKey, computeDeployDemoAt, emergencyReleaseKeyOf,
  findOrCreateEmergencyCycle, reconcileConflictsForCycle, forceRegistrationTimes,
  renderEmergencyPersonalTask, emergencyPersonalReleaseMonthKey, emergencyPersonalReleaseMonthPrefix,
  parseEmergencyPersonalLocale, type EmergencyRegistrationAnchors, type EmergencyDefinitionForGenerate
} from '../../server/lib/release-schedule.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-release-schedule-unit-'));
let seq = 0;
function freshDb(): DatabaseSync {
  seq += 1;
  const dbPath = path.join(tmpDir, `db-${seq}.sqlite`);
  const db = new DatabaseSync(dbPath);
  applySlice4Schema(db, tmpDir);
  return db;
}

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

function makeUserAndTeam(db: DatabaseSync, teamName: string): { userId: number; teamId: number } {
  const now = new Date().toISOString();
  const userResult = db.prepare(`
    INSERT INTO users (issuer, subject, email, display_name, status, system_role, created_at)
    VALUES ('https://auth.test', ?, ?, ?, 'active', 'user', ?)
  `).run(`sub-${teamName}-${Math.random()}`, `${teamName}@test.local`, teamName, now);
  const userId = Number(userResult.lastInsertRowid);
  const teamResult = db.prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)').run(`Team ${teamName} ${Math.random()}`, now);
  const teamId = Number(teamResult.lastInsertRowid);
  db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'leader')").run(teamId, userId);
  return { userId, teamId };
}

function insertRegistration(db: DatabaseSync, cycleId: number, teamId: number, deployStagingAt: string, releaseAt: string, userId: number): number {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO team_release_registrations (
      cycle_id, team_id, deploy_staging_at, release_at, deploy_demo_at, affected_systems, platforms,
      ticket_numbers, japan_coordination_link, no_japan_coordination_reason, notes, status,
      row_version, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '["Dr.JOY"]', '["Web"]', '[]', NULL, 'khong co', '', 'submitted', 1, ?, ?, ?, ?)
  `).run(cycleId, teamId, deployStagingAt, releaseAt, computeDeployDemoAt(releaseAt), userId, userId, now, now);
  return Number(result.lastInsertRowid);
}

// ── Wall-clock / cycle key thuần ────────────────────────────────────────────────────────────────
test('parseWallClock: hợp lệ -> ghép "YYYY-MM-DD HH:mm"; sai định dạng ngày/giờ -> null', () => {
  assert.equal(parseWallClock('2026-09-20', '15:00'), '2026-09-20 15:00');
  // Định dạng sai (không phải yyyy-mm-dd/HH:mm) bị chặn bởi regex TRƯỚC KHI chạm vietnamInstant().
  assert.equal(parseWallClock('20-09-2026', '15:00'), null);
  assert.equal(parseWallClock('2026-09-20', '25:00'), null);
  assert.equal(parseWallClock('2026-09-20', 'abcd'), null);
});

test('computeDeployDemoAt: luôn = 16:00 CÙNG NGÀY release_at (FR-23a, không cho nhập tay)', () => {
  assert.equal(computeDeployDemoAt('2026-09-20 15:00'), '2026-09-20 16:00');
  assert.equal(computeDeployDemoAt('2026-01-31 23:59'), '2026-01-31 16:00');
});

test('wallClockDateKey: tách đúng phần ngày', () => {
  assert.equal(wallClockDateKey('2026-09-20 15:00'), '2026-09-20');
});

test('emergencyReleaseKeyOf: tiền tố emergency: cố định', () => {
  assert.equal(emergencyReleaseKeyOf('2026-09-20'), 'emergency:2026-09-20');
});

test('emergencyPersonalReleaseMonthKey/prefix/parseLocale: mã hoá + suy ngược locale đúng vòng tròn', () => {
  const key = emergencyPersonalReleaseMonthKey('emergency:2026-09-20', 5, 12, 'ja');
  assert.equal(key, 'emergency:2026-09-20:team5:user12:ja');
  assert.ok(key.startsWith(emergencyPersonalReleaseMonthPrefix('emergency:2026-09-20', 5)));
  assert.equal(parseEmergencyPersonalLocale(key), 'ja');
  assert.equal(parseEmergencyPersonalLocale('emergency:2026-09-20:team5:user12:vi'), 'vi');
  assert.equal(parseEmergencyPersonalLocale('du-lieu-cu-khong-co-locale'), 'vi', 'mặc định vi nếu không parse được');
});

// ── findOrCreateEmergencyCycle (FR-25) ──────────────────────────────────────────────────────────
test('findOrCreateEmergencyCycle: cùng ngày release -> CÙNG 1 cycle (tự tìm-hoặc-tạo, không ai mở đợt)', () => {
  const db = freshDb();
  const { userId } = makeUserAndTeam(db, 'A');
  const now = new Date().toISOString();
  const first = findOrCreateEmergencyCycle(db, '2026-09-20', userId, now);
  const second = findOrCreateEmergencyCycle(db, '2026-09-20', userId, now);
  assert.equal(first.id, second.id);
  assert.equal(first.releaseKey, 'emergency:2026-09-20');
  const other = findOrCreateEmergencyCycle(db, '2026-09-21', userId, now);
  assert.notEqual(other.id, first.id, 'ngày release khác -> cycle khác (1 tháng có nhiều đợt)');
});

// ── reconcileConflictsForCycle (FR-25) ──────────────────────────────────────────────────────────
test('reconcile: 2 team khác giờ release CÙNG cycle -> mở xung đột "open"', () => {
  const db = freshDb();
  const teamA = makeUserAndTeam(db, 'ConflictA');
  const teamB = makeUserAndTeam(db, 'ConflictB');
  const now = new Date().toISOString();
  const cycle = findOrCreateEmergencyCycle(db, '2026-09-20', teamA.userId, now);
  insertRegistration(db, cycle.id, teamA.teamId, '2026-09-20 13:00', '2026-09-20 15:00', teamA.userId);
  insertRegistration(db, cycle.id, teamB.teamId, '2026-09-20 13:00', '2026-09-20 16:00', teamB.userId);

  reconcileConflictsForCycle(db, cycle.id, now);
  const conflicts = db.prepare('SELECT status FROM release_schedule_conflicts WHERE cycle_id = ?').all(cycle.id) as { status: string }[];
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].status, 'open');
});

test('reconcile: hệ thống/nền tảng/ticket khác nhau nhưng GIỜ khớp -> KHÔNG tính xung đột', () => {
  const db = freshDb();
  const teamA = makeUserAndTeam(db, 'SameTimeA');
  const teamB = makeUserAndTeam(db, 'SameTimeB');
  const now = new Date().toISOString();
  const cycle = findOrCreateEmergencyCycle(db, '2026-09-20', teamA.userId, now);
  insertRegistration(db, cycle.id, teamA.teamId, '2026-09-20 13:00', '2026-09-20 15:00', teamA.userId);
  insertRegistration(db, cycle.id, teamB.teamId, '2026-09-20 13:00', '2026-09-20 15:00', teamB.userId);

  reconcileConflictsForCycle(db, cycle.id, now);
  const conflicts = db.prepare('SELECT status FROM release_schedule_conflicts WHERE cycle_id = ?').all(cycle.id);
  assert.equal(conflicts.length, 0, 'trùng ngày nhưng khớp giờ, chỉ khác hệ thống/ticket -> không phải xung đột (FR-25)');
});

test('reconcile: xung đột "open" tự chuyển "resolved" khi rà lại thấy giờ đã khớp', () => {
  const db = freshDb();
  const teamA = makeUserAndTeam(db, 'ResolveA');
  const teamB = makeUserAndTeam(db, 'ResolveB');
  const now = new Date().toISOString();
  const cycle = findOrCreateEmergencyCycle(db, '2026-09-20', teamA.userId, now);
  const regA = insertRegistration(db, cycle.id, teamA.teamId, '2026-09-20 13:00', '2026-09-20 15:00', teamA.userId);
  insertRegistration(db, cycle.id, teamB.teamId, '2026-09-20 13:00', '2026-09-20 16:00', teamB.userId);
  reconcileConflictsForCycle(db, cycle.id, now);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM release_schedule_conflicts WHERE status='open'").get() as { c: number }).c, 1);

  db.prepare('UPDATE team_release_registrations SET release_at = ? WHERE id = ?').run('2026-09-20 16:00', regA);
  reconcileConflictsForCycle(db, cycle.id, new Date().toISOString());
  const conflicts = db.prepare('SELECT status FROM release_schedule_conflicts WHERE cycle_id = ?').all(cycle.id) as { status: string }[];
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].status, 'resolved');
});

test('reconcile: huỷ 1 bên đang xung đột -> xung đột tự "resolved" ngay (chốt 19/09 lần 11)', () => {
  const db = freshDb();
  const teamA = makeUserAndTeam(db, 'CancelA');
  const teamB = makeUserAndTeam(db, 'CancelB');
  const now = new Date().toISOString();
  const cycle = findOrCreateEmergencyCycle(db, '2026-09-20', teamA.userId, now);
  const regA = insertRegistration(db, cycle.id, teamA.teamId, '2026-09-20 13:00', '2026-09-20 15:00', teamA.userId);
  insertRegistration(db, cycle.id, teamB.teamId, '2026-09-20 13:00', '2026-09-20 16:00', teamB.userId);
  reconcileConflictsForCycle(db, cycle.id, now);

  db.prepare("UPDATE team_release_registrations SET status = 'cancelled' WHERE id = ?").run(regA);
  reconcileConflictsForCycle(db, cycle.id, new Date().toISOString());
  const conflicts = db.prepare('SELECT status FROM release_schedule_conflicts WHERE cycle_id = ?').all(cycle.id) as { status: string }[];
  assert.equal(conflicts[0].status, 'resolved');
});

// ── forceRegistrationTimes (FR-25 "ép giờ chung") ────────────────────────────────────────────────
test('forceRegistrationTimes: ghi đè CẢ HAI registration về cùng giờ, trả đủ giá trị cũ/mới cho audit', () => {
  const db = freshDb();
  const teamA = makeUserAndTeam(db, 'ForceA');
  const teamB = makeUserAndTeam(db, 'ForceB');
  const coordinator = makeUserAndTeam(db, 'Coordinator');
  const now = new Date().toISOString();
  const cycle = findOrCreateEmergencyCycle(db, '2026-09-20', teamA.userId, now);
  const regA = insertRegistration(db, cycle.id, teamA.teamId, '2026-09-20 13:00', '2026-09-20 15:00', teamA.userId);
  const regB = insertRegistration(db, cycle.id, teamB.teamId, '2026-09-20 13:00', '2026-09-20 16:00', teamB.userId);

  const results = forceRegistrationTimes(db, [regA, regB], '2026-09-20 14:00', '2026-09-20 15:30', coordinator.userId, now);
  assert.equal(results.length, 2);
  const rowA = db.prepare('SELECT deploy_staging_at, release_at, deploy_demo_at FROM team_release_registrations WHERE id = ?').get(regA) as
    { deploy_staging_at: string; release_at: string; deploy_demo_at: string };
  const rowB = db.prepare('SELECT deploy_staging_at, release_at FROM team_release_registrations WHERE id = ?').get(regB) as
    { deploy_staging_at: string; release_at: string };
  assert.equal(rowA.deploy_staging_at, '2026-09-20 14:00');
  assert.equal(rowA.release_at, '2026-09-20 15:30');
  assert.equal(rowA.deploy_demo_at, '2026-09-20 16:00', 'deploy_demo_at phải tự tính lại theo release_at MỚI');
  assert.equal(rowB.release_at, '2026-09-20 15:30');
  const byTeam = new Map(results.map((r) => [r.teamId, r]));
  assert.equal(byTeam.get(teamA.teamId)?.oldReleaseAt, '2026-09-20 15:00');
  assert.equal(byTeam.get(teamB.teamId)?.oldReleaseAt, '2026-09-20 16:00');
});

test('forceRegistrationTimes: ép giờ chung tác dụng được ngay cả khi registration đang "locked" (chốt 19/09 lần 13)', () => {
  const db = freshDb();
  const teamA = makeUserAndTeam(db, 'ForceLockedA');
  const teamB = makeUserAndTeam(db, 'ForceLockedB');
  const now = new Date().toISOString();
  const cycle = findOrCreateEmergencyCycle(db, '2026-09-20', teamA.userId, now);
  const regA = insertRegistration(db, cycle.id, teamA.teamId, '2026-09-20 13:00', '2026-09-20 15:00', teamA.userId);
  const regB = insertRegistration(db, cycle.id, teamB.teamId, '2026-09-20 13:00', '2026-09-20 16:00', teamB.userId);
  db.prepare("UPDATE team_release_registrations SET status = 'locked' WHERE id IN (?, ?)").run(regA, regB);

  const results = forceRegistrationTimes(db, [regA, regB], '2026-09-20 14:00', '2026-09-20 15:30', teamA.userId, now);
  assert.equal(results.length, 2);
  const status = db.prepare('SELECT status FROM team_release_registrations WHERE id = ?').get(regA) as { status: string };
  assert.equal(status.status, 'locked', 'ép giờ không tự MỞ khoá — chỉ đổi giờ, giữ nguyên trạng thái khoá');
});

// ── renderEmergencyPersonalTask (FR-28a nhánh khẩn cấp) ─────────────────────────────────────────
function makeAnchors(overrides: Partial<EmergencyRegistrationAnchors> = {}): EmergencyRegistrationAnchors {
  return {
    teamId: 1, cycleId: 1, cycleReleaseKey: 'emergency:2026-09-20',
    deployStagingAt: '2026-09-20 13:00', releaseAt: '2026-09-20 15:00', deployDemoAt: '2026-09-20 16:00',
    ...overrides
  };
}

function makeDefinition(overrides: Partial<EmergencyDefinitionForGenerate> = {}): EmergencyDefinitionForGenerate {
  return {
    id: 'def-1', title: 'Thông báo release', note: '', taskDate: 'release_deploy', startTime: 'relative',
    relativeOffsetMinutes: 0, templateContent: null, taskLinksJson: '[]', replyToDefinitionId: null,
    ...overrides
  };
}

test('renderEmergencyPersonalTask: token có mỏ neo (release_deploy) -> giờ = mỏ neo + offset', () => {
  const rendered = renderEmergencyPersonalTask(makeDefinition({ taskDate: 'release_deploy', relativeOffsetMinutes: 15 }), makeAnchors(), 'vi');
  assert.ok(rendered);
  assert.equal(rendered!.ngayCuThe, '2026-09-20');
  assert.equal(rendered!.gioBatDau, '15:15');
});

test('renderEmergencyPersonalTask: offset ÂM lùi trước mỏ neo (vd confirm trước staging 60 phút)', () => {
  const rendered = renderEmergencyPersonalTask(makeDefinition({ taskDate: 'staging_deploy', relativeOffsetMinutes: -60 }), makeAnchors(), 'vi');
  assert.equal(rendered!.gioBatDau, '12:00'); // staging 13:00 - 60 phút
});

test('renderEmergencyPersonalTask: token KHÔNG có mỏ neo (hotfix-family) -> trả null, ngoài phạm vi tự tính giờ', () => {
  const rendered = renderEmergencyPersonalTask(makeDefinition({ taskDate: 'hotfix', relativeOffsetMinutes: null }), makeAnchors(), 'vi');
  assert.equal(rendered, null);
});

test('renderEmergencyPersonalTask: có template -> ghi chú render đúng locale từ 3 mốc thật', () => {
  const rendered = renderEmergencyPersonalTask(
    makeDefinition({ taskDate: 'release_deploy', templateContent: 'Release lúc {{release.deployAt}}' }),
    makeAnchors(), 'ja'
  );
  assert.match(rendered!.ghiChu, /17:00/, 'release 15:00 VN -> 17:00 JST');
});

test('renderEmergencyPersonalTask: KHÔNG có template -> ghi chú = note thô của definition', () => {
  const rendered = renderEmergencyPersonalTask(makeDefinition({ note: 'Ghi chú thô' }), makeAnchors(), 'vi');
  assert.equal(rendered!.ghiChu, 'Ghi chú thô');
});
