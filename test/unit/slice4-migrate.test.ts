// Test cho server/ops/slice4-migrate.ts (CR-20260913 Lát 4, di trú FR-20) — CHỈ dùng DB SQLite tạm
// trong thư mục test, KHÔNG BAO GIỜ chạm vào file DB thật của Dev13 (đúng yêu cầu bắt buộc của Lát 4).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  applySlice4Schema, ensureDev13Identity, backfillDev13Scope, migrateLegacyPicLabels,
  createVerifiedBackup, buildServerDatabaseFromDesktopSnapshot, verifySlice4Migration,
  smokeBootMigratedServer,
} from '../../server/ops/slice4-migrate.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-slice4-migrate-unit-'));
after(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* bỏ qua */ } });

let seq = 0;
function nextDir(label: string): string {
  seq += 1;
  const dir = path.join(tmpRoot, `${label}-${seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Dựng 1 DB "desktop cũ" giả lập: schema MỚI (Lát 4) đã áp dụng (applySlice4Schema tái dùng đúng
// bootstrapDatabase() thật), nhưng dữ liệu projects/tasks/mindmaps vẫn ở dạng CŨ — team_id/
// owner_user_id còn NULL, pic/assignee vẫn là chuỗi tự do — đúng hình dạng một DB desktop thật đã
// từng chạy qua registSlice4Migrations() (ADD COLUMN tự động) nhưng CHƯA qua bước backfill vận hành.
function buildFakeDesktopDb(dir: string): { dbPath: string; leaderUserId: number } {
  const dbPath = path.join(dir, 'tasks.sqlite');
  const db = new DatabaseSync(dbPath);
  applySlice4Schema(db, dir);

  const now = new Date().toISOString();
  const userResult = db.prepare(`
    INSERT INTO users (issuer, subject, email, display_name, status, created_at)
    VALUES ('https://auth.drjoy.vn', 'sub-leader-fake', 'leader@drjoy.jp', 'Leader Desktop Cũ', 'active', ?)
  `).run(now);
  const leaderUserId = Number(userResult.lastInsertRowid);

  const projectResult = db.prepare(`
    INSERT INTO projects (ten_project, pic, ngay_bat_dau, sort_order, created_at, updated_at)
    VALUES ('Project desktop cũ', 'Nam, Phú', '2026-01-01', 1, ?, ?)
  `).run(now, now);
  const projectId = Number(projectResult.lastInsertRowid);
  db.prepare(`
    INSERT INTO project_tasks (project_id, level, tieu_de, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien, tien_do, assignee, created_at, updated_at)
    VALUES (?, 1, 'Task desktop cũ', '2026-01-01', '2026-01-02', 0, 'Nam', ?, ?)
  `).run(projectId, now, now);
  db.prepare(`
    INSERT INTO tasks (ten_task, ghi_chu, loai_task, trang_thai, ngay_tao, task_links)
    VALUES ('Task cá nhân cũ', '', 'don_le', 'chua_thuc_hien', ?, '[]')
  `).run(now);
  db.prepare(`
    INSERT INTO mindmaps (title, data, created_at, updated_at) VALUES ('Sơ đồ cũ', '{}', ?, ?)
  `).run(now, now);
  db.close();
  return { dbPath, leaderUserId };
}

test('applySlice4Schema: idempotent, tạo đủ bảng Lát 4 (teams/users/team_member_gantt_colors...)', () => {
  const dir = nextDir('schema');
  const dbPath = path.join(dir, 'tasks.sqlite');
  const db = new DatabaseSync(dbPath);
  applySlice4Schema(db, dir);
  applySlice4Schema(db, dir); // chạy lại lần 2 -> không lỗi (idempotent)
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name)
  );
  for (const t of ['users', 'teams', 'team_members', 'team_feature_visibility', 'team_member_gantt_colors', 'weekly_report_kinds', 'weekly_project_risks']) {
    assert.ok(tables.has(t), `thiếu bảng ${t}`);
  }
  db.close();
});

test('ensureDev13Identity: tạo team "Dev13" mới, gán Leader; gọi lại lần 2 idempotent', () => {
  const dir = nextDir('identity');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const db = new DatabaseSync(dbPath);

  const first = ensureDev13Identity(db, leaderUserId);
  assert.ok(Number.isInteger(first.teamId));
  const second = ensureDev13Identity(db, leaderUserId);
  assert.equal(second.teamId, first.teamId, 'gọi lại phải trả về đúng team đã có, không tạo thêm');

  const leaderRow = db.prepare("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?").get(first.teamId, leaderUserId) as { role: string };
  assert.equal(leaderRow.role, 'leader');
  const teamCount = (db.prepare("SELECT COUNT(*) c FROM teams WHERE name = 'Dev13'").get() as { c: number }).c;
  assert.equal(teamCount, 1, 'không được tạo trùng team Dev13');
  db.close();
});

test('ensureDev13Identity: user chưa active -> từ chối rõ ràng', () => {
  const dir = nextDir('identity-pending');
  const { dbPath } = buildFakeDesktopDb(dir);
  const db = new DatabaseSync(dbPath);
  const now = new Date().toISOString();
  const pendingUser = db.prepare(`
    INSERT INTO users (issuer, subject, email, display_name, status, created_at)
    VALUES ('https://auth.drjoy.vn', 'sub-pending', 'pending@drjoy.jp', 'Chưa duyệt', 'pending', ?)
  `).run(now);
  assert.throws(() => ensureDev13Identity(db, Number(pendingUser.lastInsertRowid)), /chưa active/);
  db.close();
});

test('ensureDev13Identity: team Dev13 đã có Leader KHÁC -> từ chối, không tự ghi đè', () => {
  const dir = nextDir('identity-conflict');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const db = new DatabaseSync(dbPath);
  ensureDev13Identity(db, leaderUserId);

  const now = new Date().toISOString();
  const otherUser = db.prepare(`
    INSERT INTO users (issuer, subject, email, display_name, status, created_at)
    VALUES ('https://auth.drjoy.vn', 'sub-other', 'other@drjoy.jp', 'Người khác', 'active', ?)
  `).run(now);
  assert.throws(() => ensureDev13Identity(db, Number(otherUser.lastInsertRowid)), /đã có Leader khác/);
  db.close();
});

test('backfillDev13Scope: gán team_id/owner_user_id cho dữ liệu NULL, idempotent lần 2', () => {
  const dir = nextDir('backfill');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const db = new DatabaseSync(dbPath);
  const { teamId } = ensureDev13Identity(db, leaderUserId);

  // db-seed.ts seed sẵn vài dòng mặc định (release templates/PIC/task mẫu...) độc lập với dữ liệu
  // "desktop cũ" của riêng test này — đếm baseline NULL trước khi backfill thay vì đoán số cố định,
  // để test không vỡ nếu db-seed.ts thêm/bớt dữ liệu mẫu sau này.
  const nullBefore = (table: string, column: string) =>
    (db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${column} IS NULL`).get() as { c: number }).c;
  const expected = {
    projects: nullBefore('projects', 'team_id'),
    projectTasks: nullBefore('project_tasks', 'team_id'),
    tasks: nullBefore('tasks', 'owner_user_id'),
    mindmaps: nullBefore('mindmaps', 'owner_user_id'),
  };
  assert.ok(expected.projects >= 1 && expected.tasks >= 1, 'phải có ít nhất dữ liệu "desktop cũ" vừa chèn để backfill');

  const first = backfillDev13Scope(db, teamId, leaderUserId);
  assert.equal(first.projects, expected.projects);
  assert.equal(first.projectTasks, expected.projectTasks);
  assert.equal(first.tasks, expected.tasks);
  assert.equal(first.mindmaps, expected.mindmaps);

  const second = backfillDev13Scope(db, teamId, leaderUserId);
  assert.equal(second.projects, 0, 'lần 2 không còn dòng NULL nào để backfill');
  assert.equal(second.tasks, 0);

  const project = db.prepare("SELECT team_id FROM projects WHERE ten_project = 'Project desktop cũ'").get() as { team_id: number };
  assert.equal(project.team_id, teamId);
  const projectTask = db.prepare("SELECT team_id FROM project_tasks WHERE tieu_de = 'Task desktop cũ'").get() as { team_id: number };
  assert.equal(projectTask.team_id, teamId, 'project_tasks.team_id phải lấy từ project cha, không phải hằng số');
  const personalTask = db.prepare("SELECT owner_user_id FROM tasks WHERE ten_task = 'Task cá nhân cũ'").get() as { owner_user_id: number };
  assert.equal(personalTask.owner_user_id, leaderUserId);
  const mindmap = db.prepare("SELECT owner_user_id, visibility FROM mindmaps WHERE title = 'Sơ đồ cũ'").get() as { owner_user_id: number; visibility: string };
  assert.equal(mindmap.owner_user_id, leaderUserId);
  assert.equal(mindmap.visibility, 'private', 'Mind Map cũ không được tự chia sẻ');
  db.close();
});

test('migrateLegacyPicLabels: copy nguyên văn pic/assignee sang legacy_pic_label, không tách chuỗi, idempotent', () => {
  const dir = nextDir('legacy-pic');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const db = new DatabaseSync(dbPath);
  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);

  // Dòng "desktop cũ" của test này được CHÈN SAU khi applySlice4Schema() đã chạy xong (schema bootstrap
  // chỉ chạy đúng 1 LẦN tại thời điểm gọi, không phải mỗi khi có dòng mới) — nên bước copy tự động
  // trong runSlice4Migrations() KHÔNG chạm tới nó; gọi migrateLegacyPicLabels() ở đây mới thực sự làm
  // việc thật (result > 0), đúng tình huống thật khi vận hành: schema đã có sẵn, dữ liệu cũ nằm chờ.
  const result = migrateLegacyPicLabels(db);
  assert.equal(result.projects, 1);
  assert.equal(result.projectTasks, 1);

  // Gọi lại lần 2 phải idempotent — không còn gì để copy nữa.
  const second = migrateLegacyPicLabels(db);
  assert.equal(second.projects, 0);
  assert.equal(second.projectTasks, 0);

  const project = db.prepare("SELECT legacy_pic_label FROM projects WHERE ten_project = 'Project desktop cũ'").get() as { legacy_pic_label: string };
  assert.equal(project.legacy_pic_label, 'Nam, Phú', 'giữ NGUYÊN VĂN chuỗi nhiều tên, không tách');
  const task = db.prepare("SELECT legacy_pic_label FROM project_tasks WHERE tieu_de = 'Task desktop cũ'").get() as { legacy_pic_label: string };
  assert.equal(task.legacy_pic_label, 'Nam');
  db.close();
});

test('createVerifiedBackup: sao lưu bằng VACUUM INTO, đối chiếu số dòng khớp nguồn', async () => {
  const dir = nextDir('backup');
  const { dbPath } = buildFakeDesktopDb(dir);
  const backupDir = path.join(dir, 'backups');
  const manifest = await createVerifiedBackup(dbPath, backupDir);
  assert.ok(fs.existsSync(manifest.backupPath));
  assert.equal(manifest.rowCounts.projects, 1);
  // db-seed.ts seed sẵn vài task mẫu mặc định (owner_user_id NULL, độc lập với test này) — chỉ kiểm
  // có ÍT NHẤT dòng "Task cá nhân cũ" vừa chèn, không đoán tổng số cố định.
  assert.ok(manifest.rowCounts.tasks >= 1);
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
});

test('createVerifiedBackup: DB nguồn không tồn tại -> từ chối rõ ràng', async () => {
  const dir = nextDir('backup-missing');
  await assert.rejects(
    createVerifiedBackup(path.join(dir, 'khong-ton-tai.sqlite'), path.join(dir, 'backups')),
    /không tìm thấy DB nguồn/
  );
});

test('buildServerDatabaseFromDesktopSnapshot: tạo DB đích từ backup, toàn vẹn', async () => {
  const dir = nextDir('build-server-db');
  const { dbPath } = buildFakeDesktopDb(dir);
  const backupDir = path.join(dir, 'backups');
  const manifest = await createVerifiedBackup(dbPath, backupDir);
  const output = await buildServerDatabaseFromDesktopSnapshot(manifest.backupPath, path.join(dir, 'server', 'tasks.sqlite'));
  assert.ok(fs.existsSync(output.outputPath));
  const db = new DatabaseSync(output.outputPath, { readOnly: true });
  const projectCount = (db.prepare('SELECT COUNT(*) c FROM projects').get() as { c: number }).c;
  assert.equal(projectCount, 1);
  db.close();
});

test('verifySlice4Migration: sau backfill+migrate hợp lệ -> ok=true, không vi phạm FK/quick_check', () => {
  const dir = nextDir('verify-ok');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  // Chụp lại số dòng "nguồn" TRƯỚC backfill (backfill chỉ UPDATE, không đổi số dòng).
  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const db = new DatabaseSync(dbPath);
  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);

  const result = verifySlice4Migration(sourceSnapshotPath, db);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  db.close();
});

test('verifySlice4Migration: còn project chưa gán team_id -> ok=false, nêu rõ vấn đề', () => {
  const dir = nextDir('verify-fail');
  const { dbPath } = buildFakeDesktopDb(dir);
  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const db = new DatabaseSync(dbPath);
  // KHÔNG chạy ensureDev13Identity/backfillDev13Scope -> project vẫn còn team_id NULL.
  const result = verifySlice4Migration(sourceSnapshotPath, db);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('chưa gán team_id')));
  db.close();
});

test('smokeBootMigratedServer: boot server thật trên DB đã di trú -> /health/ready 200, Luyện đề 404', async () => {
  const dir = nextDir('smoke-boot');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const db = new DatabaseSync(dbPath);
  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);
  db.close();

  const result = await smokeBootMigratedServer(dir);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('smokeBootMigratedServer: không có tasks.sqlite trong thư mục -> báo lỗi rõ, không throw', async () => {
  const dir = nextDir('smoke-boot-missing');
  const result = await smokeBootMigratedServer(dir);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /Không tìm thấy/);
});
