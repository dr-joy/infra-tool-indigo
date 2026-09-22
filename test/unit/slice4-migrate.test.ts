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

test('verifySlice4Migration: sau backfill+migrate hợp lệ -> ok=true, không vi phạm FK/quick_check, file mindmap đính kèm còn nguyên', () => {
  const dir = nextDir('verify-ok');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);

  // Thêm 1 mindmap có file đính kèm THẬT TỒN TẠI trên đĩa — chứng minh verifyMindmapAttachments()
  // không báo nhầm khi file thật sự có mặt (không chỉ test được nhánh lỗi).
  const db0 = new DatabaseSync(dbPath);
  const now0 = new Date().toISOString();
  fs.mkdirSync(path.join(dir, 'mindmap-files'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'mindmap-files', 'abc123__tailieu.txt'), 'noi dung file dinh kem');
  db0.prepare(`
    INSERT INTO mindmaps (title, data, created_at, updated_at)
    VALUES ('Sơ đồ có file', ?, ?, ?)
  `).run(JSON.stringify({ note: 'xem /api/mindmaps/files/abc123__tailieu.txt' }), now0, now0);
  db0.close();

  // Chụp lại số dòng "nguồn" TRƯỚC backfill (backfill chỉ UPDATE, không đổi số dòng).
  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const db = new DatabaseSync(dbPath);
  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);

  const result = verifySlice4Migration(sourceSnapshotPath, db, dir);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(result.rolledBack, false);
  db.close();
});

test('verifySlice4Migration: còn project chưa gán team_id -> ok=false, TỰ rollback (đóng handle + xoá file DB đích)', () => {
  const dir = nextDir('verify-fail');
  const { dbPath } = buildFakeDesktopDb(dir);
  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const db = new DatabaseSync(dbPath);
  // KHÔNG chạy ensureDev13Identity/backfillDev13Scope -> project vẫn còn team_id NULL.
  const result = verifySlice4Migration(sourceSnapshotPath, db, dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('chưa gán team_id')));
  // Rollback THẬT (CR §6.3 bước 6: "lệch bất kỳ điều gì thì rollback DB đích và dừng") — mặc định
  // autoRollbackOnFailure=true: đóng handle + xoá hẳn file DB đích, KHÔNG cần db.close() thêm ở đây.
  assert.equal(result.rolledBack, true);
  assert.equal(fs.existsSync(dbPath), false, 'file DB đích phải bị xoá sau rollback');
});

test('verifySlice4Migration: autoRollbackOnFailure=false -> KHÔNG xoá file, handle vẫn dùng được', () => {
  const dir = nextDir('verify-fail-no-rollback');
  const { dbPath } = buildFakeDesktopDb(dir);
  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const db = new DatabaseSync(dbPath);
  const result = verifySlice4Migration(sourceSnapshotPath, db, dir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
  assert.equal(fs.existsSync(dbPath), true, 'không được xoá file khi autoRollbackOnFailure=false');
  // Handle vẫn mở được — chứng minh verify không lỡ tay đóng nó khi không được yêu cầu rollback.
  assert.doesNotThrow(() => db.prepare('SELECT 1').get());
  db.close();
});

test('verifySlice4Migration: tập ID lệch dù SỐ DÒNG khớp (bảng bị rebuild đổi id) -> ok=false, phân biệt rõ với lỗi đếm số dòng', () => {
  const dir = nextDir('verify-id-mismatch');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const db = new DatabaseSync(dbPath);
  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);

  // Giả lập lỗi rebuild làm đổi id: xoá mindmap gốc rồi chèn lại mindmap MỚI cùng nội dung -> TỔNG
  // SỐ DÒNG vẫn khớp nguồn (1 mindmap) nhưng TẬP ID đã đổi — đúng đúng tình huống CR §6.3 cảnh báo
  // ("2 dòng có thể bị đổi ID dù số lượng khớp").
  const now = new Date().toISOString();
  db.prepare('DELETE FROM mindmaps').run();
  db.prepare("INSERT INTO mindmaps (title, data, created_at, updated_at) VALUES ('Sơ đồ cũ', '{}', ?, ?)").run(now, now);

  const result = verifySlice4Migration(sourceSnapshotPath, db, dir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.every((p) => !p.includes('Số dòng bảng mindmaps lệch')), 'số lượng vẫn khớp -> không được báo lệch số dòng');
  assert.ok(result.problems.some((p) => p.includes('Bảng mindmaps') && p.includes('mất 1 dòng')));
  assert.ok(result.problems.some((p) => p.includes('Bảng mindmaps') && p.includes('thừa 1 dòng')));
  db.close();
});

test('verifySlice4Migration: hash nội dung canonical lệch (cột cũ bị đổi giá trị dù id/số dòng khớp) -> ok=false', () => {
  const dir = nextDir('verify-hash-mismatch');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const db = new DatabaseSync(dbPath);
  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);

  // Sửa TRỰC TIẾP 1 cột "cũ" (canonical) chỉ trên đích, giữ nguyên id — mô phỏng lỗi bước di trú vô
  // tình sửa dữ liệu cũ khi rebuild bảng.
  db.prepare("UPDATE projects SET ten_project = 'Tên đã bị đổi lúc di trú (lỗi giả lập)' WHERE ten_project = 'Project desktop cũ'").run();

  const result = verifySlice4Migration(sourceSnapshotPath, db, dir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('Bảng projects') && p.includes('bị đổi nội dung cột cũ')));
  db.close();
});

test('verifySlice4Migration: kiểm assignment — ngày không hợp lệ, user khác team, nhãn legacy lệch nguồn -> ok=false, nêu đủ 3', () => {
  const dir = nextDir('verify-assignments');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const db = new DatabaseSync(dbPath);
  const now = new Date().toISOString();

  const validTask = db.prepare("SELECT id FROM project_tasks WHERE tieu_de = 'Task desktop cũ'").get() as { id: number };

  // Team + user KHÁC (không thuộc Dev13) — dùng cho nhánh "User mới nếu có thuộc đúng team".
  const teamB = db.prepare("INSERT INTO teams (name, created_at) VALUES ('TeamB-khac', ?)").run(now);
  const teamBId = Number(teamB.lastInsertRowid);
  const userB = db.prepare(`
    INSERT INTO users (issuer, subject, email, display_name, status, created_at)
    VALUES ('https://auth.drjoy.vn', 'sub-userb-fake', 'userb@drjoy.jp', 'User B', 'active', ?)
  `).run(now);
  const userBId = Number(userB.lastInsertRowid);
  db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").run(teamBId, userBId);

  function insertAssignment(userId: number | null, legacyLabel: string | null, startDate: string, endDate: string): number {
    const r = db.prepare(`
      INSERT INTO project_task_assignments (project_task_id, user_id, legacy_pic_label, start_date, end_date, sort_order)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(validTask.id, userId, legacyLabel, startDate, endDate);
    return Number(r.lastInsertRowid);
  }
  insertAssignment(leaderUserId, null, '2026-01-10', '2026-01-01'); // end < start -> ngày không hợp lệ
  insertAssignment(userBId, null, '2026-01-01', '2026-01-02'); // userB không thuộc team của task -> sai team
  const labelRowId = insertAssignment(null, 'Nam', '2026-01-01', '2026-01-02'); // sẽ bị đổi label sau khi chụp nguồn

  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);

  db.prepare('UPDATE project_task_assignments SET legacy_pic_label = ? WHERE id = ?').run('Nam (đã bị đổi ở đích)', labelRowId);

  const result = verifySlice4Migration(sourceSnapshotPath, db, dir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('project_task_assignments') && p.includes('ngày không hợp lệ')));
  assert.ok(result.problems.some((p) => p.includes('project_task_assignments') && p.includes('KHÔNG thuộc team')));
  assert.ok(result.problems.some((p) => p.includes('project_task_assignments') && p.includes('legacy_pic_label KHÔNG khớp')));
  db.close();
});

test('verifySlice4Migration: rollup trước/sau lệch (con bị đổi estimate/tiến độ) -> ok=false, tái dùng đúng thuật toán rollup thật', () => {
  const dir = nextDir('verify-rollup');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const db = new DatabaseSync(dbPath);
  const now = new Date().toISOString();

  const parentTask = db.prepare("SELECT id, project_id FROM project_tasks WHERE tieu_de = 'Task desktop cũ'").get() as { id: number; project_id: number };
  const child = db.prepare(`
    INSERT INTO project_tasks (project_id, parent_id, level, tieu_de, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien, estimate_hours, tien_do, created_at, updated_at)
    VALUES (?, ?, 2, 'Task con', '2026-01-01', '2026-01-05', 10, 50, ?, ?)
  `).run(parentTask.project_id, parentTask.id, now, now);
  const childId = Number(child.lastInsertRowid);

  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);

  // Đổi estimate/tiến độ của task con CHỈ ở đích -> rollup tổng estimate + % task cha lệch so với
  // chạy lại đúng thuật toán trên nguồn.
  db.prepare('UPDATE project_tasks SET estimate_hours = 999, tien_do = 0 WHERE id = ?').run(childId);

  const result = verifySlice4Migration(sourceSnapshotPath, db, dir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('rollup tổng estimate lệch')));
  assert.ok(result.problems.some((p) => p.includes('rollup % hoàn thành lệch')));
  db.close();
});

test('verifySlice4Migration: weekly_goals trỏ project KHÁC team_id của chính nó -> ok=false', () => {
  const dir = nextDir('verify-weekly-scope');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const db = new DatabaseSync(dbPath);
  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);

  const now = new Date().toISOString();
  const teamB = db.prepare("INSERT INTO teams (name, created_at) VALUES ('TeamB-weekly', ?)").run(now);
  const teamBId = Number(teamB.lastInsertRowid);
  const project = db.prepare("SELECT id FROM projects WHERE ten_project = 'Project desktop cũ'").get() as { id: number };
  // team_id của dòng weekly_goals KHÁC team_id thật của project nó trỏ tới.
  db.prepare(`
    INSERT INTO weekly_goals (week_start, project_id, team_id, goal_text, created_at, updated_at)
    VALUES ('2026-01-05', ?, ?, 'Mục tiêu sai team', ?, ?)
  `).run(project.id, teamBId, now, now);

  const result = verifySlice4Migration(sourceSnapshotPath, db, dir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('weekly_goals') && p.includes('KHÔNG cùng team')));
  db.close();
});

test('verifySlice4Migration: Mind Map data không phải JSON hợp lệ + file đính kèm bị thiếu trên đĩa -> ok=false, nêu cả 2', () => {
  const dir = nextDir('verify-mindmap');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const sourceSnapshotPath = path.join(dir, 'source-snapshot.sqlite');
  fs.copyFileSync(dbPath, sourceSnapshotPath);

  const db = new DatabaseSync(dbPath);
  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);

  const now = new Date().toISOString();
  db.prepare("INSERT INTO mindmaps (title, data, created_at, updated_at) VALUES ('Sơ đồ hỏng', 'không phải JSON', ?, ?)").run(now, now);
  // JSON hợp lệ nhưng file được nhắc tới KHÔNG tồn tại trong mindmap-files/ của targetDataDir.
  db.prepare("INSERT INTO mindmaps (title, data, created_at, updated_at) VALUES ('Sơ đồ thiếu file', ?, ?, ?)")
    .run(JSON.stringify({ note: 'xem /api/mindmaps/files/khong-ton-tai__file.txt' }), now, now);

  const result = verifySlice4Migration(sourceSnapshotPath, db, dir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('mindmaps') && p.includes('parse được JSON')));
  assert.ok(result.problems.some((p) => p.includes('mindmaps') && p.includes('file đính kèm bị thiếu')));
  db.close();
});

test('smokeBootMigratedServer: boot server con thật, đăng nhập Leader, chọn Dev13, đọc đủ project/tree/weekly/tasks/mindmaps, xác nhận idempotent qua "restart lần hai"', { timeout: 60000 }, async () => {
  const dir = nextDir('smoke-boot');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const db = new DatabaseSync(dbPath);
  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);
  db.close();

  const result = await smokeBootMigratedServer(dir, leaderUserId);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);

  // Phiên smoke-test phải được dọn sạch, không để lại trong DB đã di trú (CR: không "đăng nhập" bằng
  // OIDC thật, nhưng cũng không được để rác phiên/feature-visibility tạm sau khi xong).
  const cleanupCheckDb = new DatabaseSync(dbPath);
  const sessionCount = (cleanupCheckDb.prepare('SELECT COUNT(*) c FROM user_sessions WHERE user_id = ?').get(leaderUserId) as { c: number }).c;
  assert.equal(sessionCount, 0, 'phiên smoke-test phải bị xoá sau khi xong');
  const featureLevel = cleanupCheckDb.prepare("SELECT level FROM team_feature_visibility WHERE team_id = ? AND feature = 'project'").get(teamId) as { level: string };
  assert.equal(featureLevel.level, 'off', 'team mới mặc định Tắt — không được để BẬT vĩnh viễn sau smoke test');
  cleanupCheckDb.close();
});

test('smokeBootMigratedServer: không có tasks.sqlite trong thư mục -> báo lỗi rõ, không throw', async () => {
  const dir = nextDir('smoke-boot-missing');
  const result = await smokeBootMigratedServer(dir, 1);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /Không tìm thấy/);
});

test('smokeBootMigratedServer: leaderUserId không tồn tại trong DB đã di trú -> báo lỗi rõ, không throw, không boot server', async () => {
  const dir = nextDir('smoke-boot-no-leader');
  const { dbPath } = buildFakeDesktopDb(dir);
  const result = await smokeBootMigratedServer(dir, 999999);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /Không tìm thấy Leader/);
  // DB không bị đụng gì (không có kết nối nào bị bỏ mở/khoá) — mở lại được ngay.
  const db = new DatabaseSync(dbPath);
  assert.doesNotThrow(() => db.prepare('SELECT 1').get());
  db.close();
});
