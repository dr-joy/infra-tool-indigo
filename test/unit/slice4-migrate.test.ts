// Test cho server/ops/slice4-migrate.ts (CR-20260913 Lát 4, di trú FR-20) — CHỈ dùng DB SQLite tạm
// trong thư mục test, KHÔNG BAO GIỜ chạm vào file DB thật của Dev13 (đúng yêu cầu bắt buộc của Lát 4).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import {
  applySlice4Schema, ensureDev13Identity, backfillDev13Scope, migrateLegacyPicLabels,
  createVerifiedBackup, buildServerDatabaseFromDesktopSnapshot, verifySlice4Migration,
  smokeBootMigratedServer, backfillReleasePersonalOwnership,
} from '../../server/ops/slice4-migrate.js';
import { runVersionedMigrations, type DbMigrationContext } from '../../server/db-migrations.js';

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
//
// ⚠️ CHỈ dùng cho test KHÔNG cần phân biệt DB nguồn/đích (schema/identity/backfill/legacy-pic bên
// dưới) — vì hàm này áp schema MỚI (Lát 4) NGAY TỪ ĐẦU, không phải DB Desktop THẬT (schema CŨ, xem
// buildLegacyDesktopDb() bên dưới). Dùng hàm này làm "DB nguồn" cho verifySlice4Migration từng là
// nguyên nhân che giấu 1 bug SQL thật ("no such column: user_id/legacy_pic_label" khi đọc DB nguồn
// thật — phát hiện ở Council review vòng 3, run a44549fb-c1aa-421f-8307-4483796c43fd) vì fixture cũ
// coi DB đã có sẵn schema MỚI là "nguồn". Mọi test verifySlice4Migration bên dưới đã đổi sang dùng
// buildLegacyDesktopDb()/buildMigratedTargetFromLegacySource().
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

// Dựng 1 DB "desktop cũ" ĐÚNG SCHEMA THẬT trước Lát 4 — dùng DDL thô lấy nguyên văn từ
// `git show master:server/schema/project.ts|pic.ts|weekly-report.ts|tasks.ts|mindmap.ts` (nhánh
// master, trước khi Lát 4 đổi schema), KHÔNG qua applySlice4Schema()/bootstrapDatabase() như
// buildFakeDesktopDb() ở trên — 2 hàm đó luôn tạo shape MỚI ngay từ đầu nên KHÔNG mô phỏng đúng DB
// Desktop thật. Khác biệt quan trọng nhất: project_task_assignments ở đây chỉ có cột `pic` TEXT NOT
// NULL (không có user_id/legacy_pic_label/team_id/row_version); các bảng khác cũng không có
// team_id/owner_user_id/legacy_pic_label/row_version/visibility/shared_team_id. KHÔNG có bảng
// users/teams/team_members (Desktop 1-user, chưa có khái niệm đăng nhập) — Leader chỉ được tạo ở
// bản ĐÍCH sau khi applySlice4Schema() đã chạy, xem buildMigratedTargetFromLegacySource().
//
// Seed dữ liệu GIỐNG HỆT buildFakeDesktopDb() (trừ users/leader) để các test verify* giữ được đúng
// nội dung đã kiểm trước đây (1 project 'Project desktop cũ' pic='Nam, Phú', 1 project_task 'Task
// desktop cũ' assignee='Nam', 1 task cá nhân, 1 mindmap rỗng) — CỘNG THÊM 2 dòng `pics` (khác
// buildFakeDesktopDb, vốn không cần vì source==target nên seed mặc định của bootstrapDatabase() có
// mặt ở CẢ HAI): server/db-seed.ts chỉ seed 5 PIC mặc định khi bảng `pics` CÒN TRỐNG lúc
// applySlice4Schema() chạy trên bản ĐÍCH — nếu để trống ở nguồn, đích sẽ tự có thêm 5 dòng PIC seed
// không hề tồn tại ở nguồn thật (false "thừa dòng"), không phản ánh đúng 1 DB Desktop THẬT đã dùng
// (luôn có sẵn PIC do người dùng tự thêm qua thời gian, không rơi vào nhánh seed mặc định).
// Gán `color` TRỰC TIẾP (không để NULL) — đúng NGUYÊN VĂN giá trị đầu bảng màu mặc định
// runLegacyMigrations() (server/db-migrations.ts) sẽ gán cho PIC chưa có màu. Nếu để NULL, đích (khi
// applySlice4Schema() chạy runLegacyMigrations() LẦN ĐẦU trên file vừa copy) sẽ tự gán màu — lệch với
// nguồn (không bao giờ chạy migration này) dù đây không phải lỗi di trú Lát 4. 1 DB Desktop THẬT đã
// chạy app liên tục nên PIC đã có màu từ lâu.
const LEGACY_PIC_DEFAULT_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#78716c'];

function seedLegacyPics(db: DatabaseSync, now: string): void {
  const insertPic = db.prepare('INSERT INTO pics (name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
  insertPic.run('Nam', LEGACY_PIC_DEFAULT_PALETTE[0], 1, now, now);
  insertPic.run('Phú', LEGACY_PIC_DEFAULT_PALETTE[1], 2, now, now);
}

function migrationContextFor(db: DatabaseSync, dataDir: string): DbMigrationContext {
  return {
    dataDir,
    withTransaction: <T>(fn: () => T): T => {
      db.exec('BEGIN TRANSACTION');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function buildLegacyDesktopDb(dir: string): { dbPath: string } {
  const dbPath = path.join(dir, 'tasks.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ten_project TEXT NOT NULL,
      pic TEXT NOT NULL,
      ngay_bat_dau TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      closed_at TEXT,
      pending_at TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE project_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      parent_id INTEGER,
      level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
      tieu_de TEXT NOT NULL,
      ghi_chu TEXT NOT NULL DEFAULT '',
      ngay_bat_dau_du_kien TEXT NOT NULL,
      ngay_ket_thuc_du_kien TEXT NOT NULL,
      estimate_hours REAL,
      tien_do INTEGER NOT NULL CHECK (tien_do BETWEEN 0 AND 100),
      task_links TEXT NOT NULL DEFAULT '[]',
      assignee TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      execution_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE project_task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
      pic TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      estimate_hours REAL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      tien_do INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE pics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE weekly_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      project_id INTEGER,
      project_task_id INTEGER,
      assignee TEXT,
      goal_text TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      start_progress INTEGER,
      target_progress INTEGER,
      manual_done INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE weekly_task_evaluations (
      week_start TEXT NOT NULL,
      project_task_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('dat', 'vuot', 'khong_dat')),
      note TEXT NOT NULL DEFAULT '',
      unplanned INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (week_start, project_task_id)
    );
    CREATE TABLE weekly_project_summaries (
      week_start TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (week_start, project_id)
    );
    CREATE TABLE weekly_report_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      kind TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'by_project',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (week_start, kind, mode)
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ten_task TEXT NOT NULL,
      ghi_chu TEXT NOT NULL DEFAULT '',
      loai_task TEXT NOT NULL CHECK (loai_task IN ('don_le', 'dinh_ky')),
      do_uu_tien INTEGER,
      trang_thai TEXT NOT NULL CHECK (trang_thai IN ('chua_thuc_hien', 'dang_tien_hanh', 'da_hoan_thanh', 'canceled')),
      ngay_tao TEXT NOT NULL,
      ngay_hoan_thanh TEXT,
      gio_bat_dau TEXT,
      gio_ket_thuc TEXT,
      lap_lai_kieu TEXT,
      ngay_trong_thang INTEGER,
      thu_trong_tuan INTEGER,
      ngay_cu_the TEXT,
      release_month TEXT,
      release_date TEXT,
      task_links TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE mindmaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
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
  seedLegacyPics(db, now);

  // Chạy runVersionedMigrations() THẬT (server/db-migrations.ts, dùng lại đúng hàm production dùng,
  // không đoán) — bản DB Desktop THẬT đã chạy app liên tục nên đã đi qua migration này từ lâu
  // (execution_order đã được tính lại + đánh dấu qua PRAGMA user_version), khác bản DB "vừa tạo bằng
  // DDL thô, chưa boot app lần nào" của test. Không làm vậy, applySlice4Schema() trên bản ĐÍCH (gọi
  // bootstrapDatabase() -> runVersionedMigrations()) sẽ chạy migration này LẦN ĐẦU trên đích (vì đích
  // copy nguyên user_version = 0 từ nguồn) và đổi execution_order — lệch với nguồn dù đây không phải
  // lỗi di trú Lát 4. Cột execution_order đã tồn tại ở schema CŨ (không phải cột Lát 4 mới thêm) nên
  // gọi thẳng migration này trên nguồn là an toàn, không đụng gì tới rebuild/schema Lát 4.
  //
  // KHÔNG gọi runLegacyMigrations() đầy đủ ở đây (khác execution_order/pics.color, những phần khác
  // của hàm đó đụng tới release_task_definitions/emergency_release_task_definitions — bảng cấu hình
  // Release, KHÔNG thuộc CORE_TABLES của Lát 4, không có trong schema tối giản của fixture này) — thay
  // vào đó gán sẵn `pics.color` trực tiếp khi seed (xem seedLegacyPics ở trên) để tránh CHÍNH XÁC 1
  // phần liên quan (gán màu PIC mặc định) mà không cần kéo theo toàn bộ hàm.
  runVersionedMigrations(db, migrationContextFor(db, dir));

  db.close();
  return { dbPath };
}

// Từ 1 DB nguồn schema CŨ (buildLegacyDesktopDb), dựng bản ĐÍCH RIÊNG (copy file — KHÔNG đụng nguồn,
// đúng cách buildServerDatabaseFromDesktopSnapshot() vận hành thật: schema chỉ được nâng cấp trên
// BẢN SAO, không phải trên chính DB nguồn), rồi chạy đúng chuỗi pipeline thật: applySlice4Schema
// (nâng schema — trong đó có rebuildProjectTaskAssignmentsForSlice4, đổi pic -> user_id +
// legacy_pic_label) -> tạo Leader (bảng users chỉ tồn tại ở đích, xem comment buildLegacyDesktopDb)
// -> ensureDev13Identity -> backfillDev13Scope -> migrateLegacyPicLabels. Dùng cho mọi test
// verifySlice4Migration cần cả nguồn LẪN đích đã migrate xong hoàn chỉnh.
function buildMigratedTargetFromLegacySource(sourceDbPath: string, targetDir: string): { db: DatabaseSync; teamId: number; leaderUserId: number } {
  const targetDbPath = path.join(targetDir, 'tasks.sqlite');
  fs.copyFileSync(sourceDbPath, targetDbPath);
  const db = new DatabaseSync(targetDbPath);
  applySlice4Schema(db, targetDir);

  const now = new Date().toISOString();
  const userResult = db.prepare(`
    INSERT INTO users (issuer, subject, email, display_name, status, created_at)
    VALUES ('https://auth.drjoy.vn', 'sub-leader-fake', 'leader@drjoy.jp', 'Leader Desktop Cũ', 'active', ?)
  `).run(now);
  const leaderUserId = Number(userResult.lastInsertRowid);

  const { teamId } = ensureDev13Identity(db, leaderUserId);
  backfillDev13Scope(db, teamId, leaderUserId);
  migrateLegacyPicLabels(db);
  return { db, teamId, leaderUserId };
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

// 2026-09-26 (docs/exchanges/2026-09-26.md) — bổ sung backfillReleasePersonalOwnership(), phần CR
// §6.3 (Lát 6) đã ghi rõ ý định "gán owner_user_id = leaderUserId cho toàn bộ dữ liệu cũ" của 4 bảng
// release cá nhân nhưng CHƯA TỪNG được viết (backfillDev13Scope() không đụng 4 bảng này).
test('backfillReleasePersonalOwnership: gán owner_user_id cho 4 bảng release cũ, idempotent lần 2', () => {
  const dir = nextDir('backfill-release');
  const { dbPath, leaderUserId } = buildFakeDesktopDb(dir);
  const db = new DatabaseSync(dbPath);

  const nullBefore = (table: string) =>
    (db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE owner_user_id IS NULL`).get() as { c: number }).c;
  const expected = {
    releaseTemplates: nullBefore('release_templates'),
    releaseTaskDefinitions: nullBefore('release_task_definitions'),
    emergencyReleaseTemplates: nullBefore('emergency_release_templates'),
    emergencyReleaseTaskDefinitions: nullBefore('emergency_release_task_definitions'),
  };
  assert.ok(expected.releaseTemplates >= 1, 'db-seed.ts phải seed sẵn ít nhất 1 release_templates owner_user_id NULL');

  const first = backfillReleasePersonalOwnership(db, leaderUserId);
  assert.equal(first.releaseTemplates, expected.releaseTemplates);
  assert.equal(first.releaseTaskDefinitions, expected.releaseTaskDefinitions);
  assert.equal(first.emergencyReleaseTemplates, expected.emergencyReleaseTemplates);
  assert.equal(first.emergencyReleaseTaskDefinitions, expected.emergencyReleaseTaskDefinitions);

  const second = backfillReleasePersonalOwnership(db, leaderUserId);
  assert.equal(second.releaseTemplates, 0, 'lần 2 không còn dòng NULL nào để backfill');
  assert.equal(second.releaseTaskDefinitions, 0);
  assert.equal(second.emergencyReleaseTemplates, 0);
  assert.equal(second.emergencyReleaseTaskDefinitions, 0);

  const stillNull = (table: string) =>
    (db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE owner_user_id IS NULL`).get() as { c: number }).c;
  assert.equal(stillNull('release_templates'), 0);
  assert.equal(stillNull('release_task_definitions'), 0);
  assert.equal(stillNull('emergency_release_templates'), 0);
  assert.equal(stillNull('emergency_release_task_definitions'), 0);
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
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);

  // Thêm 1 mindmap có file đính kèm THẬT TỒN TẠI trên đĩa — chứng minh verifyMindmapAttachments()
  // không báo nhầm khi file thật sự có mặt (không chỉ test được nhánh lỗi). Chèn vào NGUỒN (trước khi
  // dựng đích) để nó cũng có mặt ở đích sau khi migrate, không phải dòng "thừa ở đích".
  const now0 = new Date().toISOString();
  const sourceDb0 = new DatabaseSync(sourceDbPath);
  sourceDb0.prepare(`
    INSERT INTO mindmaps (title, data, created_at, updated_at)
    VALUES ('Sơ đồ có file', ?, ?, ?)
  `).run(JSON.stringify({ note: 'xem /api/mindmaps/files/abc123__tailieu.txt' }), now0, now0);
  sourceDb0.close();

  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'mindmap-files'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'mindmap-files', 'abc123__tailieu.txt'), 'noi dung file dinh kem');

  const { db } = buildMigratedTargetFromLegacySource(sourceDbPath, targetDir);

  const result = verifySlice4Migration(sourceDbPath, db, targetDir);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(result.rolledBack, false);
  db.close();
});

test('verifySlice4Migration: DB nguồn schema Desktop CŨ có project_task_assignments (chỉ cột pic, KHÔNG có user_id/legacy_pic_label) -> verify KHÔNG ném lỗi SQL, ok=true, legacy_pic_label khớp đúng công thức rebuild (bug Council review vòng 3, run a44549fb-c1aa-421f-8307-4483796c43fd)', () => {
  const dir = nextDir('verify-legacy-assignments-ok');
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);

  const sourceDb = new DatabaseSync(sourceDbPath);
  const task = sourceDb.prepare("SELECT id FROM project_tasks WHERE tieu_de = 'Task desktop cũ'").get() as { id: number };
  const a1 = sourceDb.prepare(`
    INSERT INTO project_task_assignments (project_task_id, pic, start_date, end_date, sort_order, tien_do)
    VALUES (?, 'Nam, Phú', '2026-01-01', '2026-01-05', 0, 40)
  `).run(task.id);
  // pic toàn khoảng trắng -> đúng công thức rebuild (COALESCE(NULLIF(TRIM(pic), ''), '(khong ro)'))
  // phải cho ra nhãn mặc định '(khong ro)', không phải chuỗi rỗng hay giữ nguyên khoảng trắng.
  const a2 = sourceDb.prepare(`
    INSERT INTO project_task_assignments (project_task_id, pic, start_date, end_date, sort_order, tien_do)
    VALUES (?, '  ', '2026-01-06', '2026-01-10', 1, 0)
  `).run(task.id);
  sourceDb.close();

  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  const { db } = buildMigratedTargetFromLegacySource(sourceDbPath, targetDir);

  let result: ReturnType<typeof verifySlice4Migration> | undefined;
  assert.doesNotThrow(() => {
    result = verifySlice4Migration(sourceDbPath, db, targetDir);
  }, 'verify không được ném lỗi SQL "no such column" khi DB nguồn là schema Desktop cũ (chỉ có cột pic)');
  assert.ok(result);
  assert.deepEqual(result!.problems, []);
  assert.equal(result!.ok, true);

  const label1 = db.prepare('SELECT legacy_pic_label, user_id FROM project_task_assignments WHERE id = ?')
    .get(Number(a1.lastInsertRowid)) as { legacy_pic_label: string; user_id: number | null };
  assert.equal(label1.legacy_pic_label, 'Nam, Phú');
  assert.equal(label1.user_id, null);
  const label2 = db.prepare('SELECT legacy_pic_label FROM project_task_assignments WHERE id = ?')
    .get(Number(a2.lastInsertRowid)) as { legacy_pic_label: string };
  assert.equal(label2.legacy_pic_label, '(khong ro)', "pic toàn khoảng trắng phải rebuild thành '(khong ro)'");
  db.close();
});

test('verifySlice4Migration: còn project chưa gán team_id -> ok=false, TỰ rollback (đóng handle + xoá file DB đích)', () => {
  const dir = nextDir('verify-fail');
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);
  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  const targetDbPath = path.join(targetDir, 'tasks.sqlite');
  fs.copyFileSync(sourceDbPath, targetDbPath);
  const db = new DatabaseSync(targetDbPath);
  applySlice4Schema(db, targetDir);
  // KHÔNG chạy ensureDev13Identity/backfillDev13Scope -> project vẫn còn team_id NULL.
  const result = verifySlice4Migration(sourceDbPath, db, targetDir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('chưa gán team_id')));
  // Rollback THẬT (CR §6.3 bước 6: "lệch bất kỳ điều gì thì rollback DB đích và dừng") — mặc định
  // autoRollbackOnFailure=true: đóng handle + xoá hẳn file DB đích, KHÔNG cần db.close() thêm ở đây.
  assert.equal(result.rolledBack, true);
  assert.equal(fs.existsSync(targetDbPath), false, 'file DB đích phải bị xoá sau rollback');
});

test('verifySlice4Migration: autoRollbackOnFailure=false -> KHÔNG xoá file, handle vẫn dùng được', () => {
  const dir = nextDir('verify-fail-no-rollback');
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);
  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  const targetDbPath = path.join(targetDir, 'tasks.sqlite');
  fs.copyFileSync(sourceDbPath, targetDbPath);
  const db = new DatabaseSync(targetDbPath);
  applySlice4Schema(db, targetDir);

  const result = verifySlice4Migration(sourceDbPath, db, targetDir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
  assert.equal(fs.existsSync(targetDbPath), true, 'không được xoá file khi autoRollbackOnFailure=false');
  // Handle vẫn mở được — chứng minh verify không lỡ tay đóng nó khi không được yêu cầu rollback.
  assert.doesNotThrow(() => db.prepare('SELECT 1').get());
  db.close();
});

test('verifySlice4Migration: tập ID lệch dù SỐ DÒNG khớp (bảng bị rebuild đổi id) -> ok=false, phân biệt rõ với lỗi đếm số dòng', () => {
  const dir = nextDir('verify-id-mismatch');
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);
  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  const { db } = buildMigratedTargetFromLegacySource(sourceDbPath, targetDir);

  // Giả lập lỗi rebuild làm đổi id: xoá mindmap gốc rồi chèn lại mindmap MỚI cùng nội dung -> TỔNG
  // SỐ DÒNG vẫn khớp nguồn (1 mindmap) nhưng TẬP ID đã đổi — đúng đúng tình huống CR §6.3 cảnh báo
  // ("2 dòng có thể bị đổi ID dù số lượng khớp").
  const now = new Date().toISOString();
  db.prepare('DELETE FROM mindmaps').run();
  db.prepare("INSERT INTO mindmaps (title, data, created_at, updated_at) VALUES ('Sơ đồ cũ', '{}', ?, ?)").run(now, now);

  const result = verifySlice4Migration(sourceDbPath, db, targetDir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.every((p) => !p.includes('Số dòng bảng mindmaps lệch')), 'số lượng vẫn khớp -> không được báo lệch số dòng');
  assert.ok(result.problems.some((p) => p.includes('Bảng mindmaps') && p.includes('mất 1 dòng')));
  assert.ok(result.problems.some((p) => p.includes('Bảng mindmaps') && p.includes('thừa 1 dòng')));
  db.close();
});

test('verifySlice4Migration: hash nội dung canonical lệch (cột cũ bị đổi giá trị dù id/số dòng khớp) -> ok=false', () => {
  const dir = nextDir('verify-hash-mismatch');
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);
  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  const { db } = buildMigratedTargetFromLegacySource(sourceDbPath, targetDir);

  // Sửa TRỰC TIẾP 1 cột "cũ" (canonical) chỉ trên đích, giữ nguyên id — mô phỏng lỗi bước di trú vô
  // tình sửa dữ liệu cũ khi rebuild bảng.
  db.prepare("UPDATE projects SET ten_project = 'Tên đã bị đổi lúc di trú (lỗi giả lập)' WHERE ten_project = 'Project desktop cũ'").run();

  const result = verifySlice4Migration(sourceDbPath, db, targetDir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('Bảng projects') && p.includes('bị đổi nội dung cột cũ')));
  db.close();
});

test('verifySlice4Migration: kiểm assignment — ngày không hợp lệ, user khác team, nhãn legacy lệch nguồn -> ok=false, nêu đủ 3', () => {
  const dir = nextDir('verify-assignments');
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);

  // Dữ liệu Desktop CŨ chỉ có cột `pic` (chưa hề có khái niệm gán User thật) — chèn 3 dòng assignment
  // dạng pic tự do vào NGUỒN, việc "gán User" (đúng hoặc sai team) chỉ xảy ra SAU khi đã migrate,
  // mô phỏng đúng: rebuild xong (user_id NULL, legacy_pic_label theo pic) rồi mới có thao tác gán
  // User thật (hoặc lỗi migrate làm sai nhãn) trên đích.
  const sourceDb = new DatabaseSync(sourceDbPath);
  const validTask = sourceDb.prepare("SELECT id FROM project_tasks WHERE tieu_de = 'Task desktop cũ'").get() as { id: number };
  function insertLegacyAssignment(pic: string, startDate: string, endDate: string): number {
    const r = sourceDb.prepare(`
      INSERT INTO project_task_assignments (project_task_id, pic, start_date, end_date, sort_order)
      VALUES (?, ?, ?, ?, 0)
    `).run(validTask.id, pic, startDate, endDate);
    return Number(r.lastInsertRowid);
  }
  insertLegacyAssignment('Nam', '2026-01-10', '2026-01-01'); // end < start -> ngày không hợp lệ
  const wrongTeamRowId = insertLegacyAssignment('Phú', '2026-01-01', '2026-01-02'); // sẽ bị gán User sai team sau khi migrate
  const labelRowId = insertLegacyAssignment('Nam', '2026-01-01', '2026-01-02'); // sẽ bị đổi label sau khi migrate
  sourceDb.close();

  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  const { db } = buildMigratedTargetFromLegacySource(sourceDbPath, targetDir);

  // Team + user KHÁC (không thuộc Dev13) — dùng cho nhánh "User mới nếu có thuộc đúng team".
  const now = new Date().toISOString();
  const teamB = db.prepare("INSERT INTO teams (name, created_at) VALUES ('TeamB-khac', ?)").run(now);
  const teamBId = Number(teamB.lastInsertRowid);
  const userB = db.prepare(`
    INSERT INTO users (issuer, subject, email, display_name, status, created_at)
    VALUES ('https://auth.drjoy.vn', 'sub-userb-fake', 'userb@drjoy.jp', 'User B', 'active', ?)
  `).run(now);
  const userBId = Number(userB.lastInsertRowid);
  db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").run(teamBId, userBId);

  // Mô phỏng: SAU khi migrate, người vận hành gán thật User B vào dòng này — nhưng User B lại KHÔNG
  // thuộc team của project_task -> sai team (id giữ nguyên qua rebuild vì rebuild dùng lại đúng id cũ).
  db.prepare('UPDATE project_task_assignments SET user_id = ? WHERE id = ?').run(userBId, wrongTeamRowId);
  // Mô phỏng lỗi migrate làm sai nhãn legacy (đúng phải là 'Nam' theo pic nguồn).
  db.prepare('UPDATE project_task_assignments SET legacy_pic_label = ? WHERE id = ?').run('Nam (đã bị đổi ở đích)', labelRowId);

  const result = verifySlice4Migration(sourceDbPath, db, targetDir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('project_task_assignments') && p.includes('ngày không hợp lệ')));
  assert.ok(result.problems.some((p) => p.includes('project_task_assignments') && p.includes('KHÔNG thuộc team')));
  assert.ok(result.problems.some((p) => p.includes('project_task_assignments') && p.includes('legacy_pic_label KHÔNG khớp')));
  db.close();
});

test('verifySlice4Migration: rollup trước/sau lệch (con bị đổi estimate/tiến độ) -> ok=false, tái dùng đúng thuật toán rollup thật', () => {
  const dir = nextDir('verify-rollup');
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);
  const now = new Date().toISOString();

  const sourceDb = new DatabaseSync(sourceDbPath);
  const parentTask = sourceDb.prepare("SELECT id, project_id FROM project_tasks WHERE tieu_de = 'Task desktop cũ'").get() as { id: number; project_id: number };
  const child = sourceDb.prepare(`
    INSERT INTO project_tasks (project_id, parent_id, level, tieu_de, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien, estimate_hours, tien_do, created_at, updated_at)
    VALUES (?, ?, 2, 'Task con', '2026-01-01', '2026-01-05', 10, 50, ?, ?)
  `).run(parentTask.project_id, parentTask.id, now, now);
  const childId = Number(child.lastInsertRowid);
  sourceDb.close();

  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  const { db } = buildMigratedTargetFromLegacySource(sourceDbPath, targetDir);

  // Đổi estimate/tiến độ của task con CHỈ ở đích -> rollup tổng estimate + % task cha lệch so với
  // chạy lại đúng thuật toán trên nguồn.
  db.prepare('UPDATE project_tasks SET estimate_hours = 999, tien_do = 0 WHERE id = ?').run(childId);

  const result = verifySlice4Migration(sourceDbPath, db, targetDir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('rollup tổng estimate lệch')));
  assert.ok(result.problems.some((p) => p.includes('rollup % hoàn thành lệch')));
  db.close();
});

test('verifySlice4Migration: weekly_goals trỏ project KHÁC team_id của chính nó -> ok=false', () => {
  const dir = nextDir('verify-weekly-scope');
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);
  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  const { db } = buildMigratedTargetFromLegacySource(sourceDbPath, targetDir);

  const now = new Date().toISOString();
  const teamB = db.prepare("INSERT INTO teams (name, created_at) VALUES ('TeamB-weekly', ?)").run(now);
  const teamBId = Number(teamB.lastInsertRowid);
  const project = db.prepare("SELECT id FROM projects WHERE ten_project = 'Project desktop cũ'").get() as { id: number };
  // team_id của dòng weekly_goals KHÁC team_id thật của project nó trỏ tới.
  db.prepare(`
    INSERT INTO weekly_goals (week_start, project_id, team_id, goal_text, created_at, updated_at)
    VALUES ('2026-01-05', ?, ?, 'Mục tiêu sai team', ?, ?)
  `).run(project.id, teamBId, now, now);

  const result = verifySlice4Migration(sourceDbPath, db, targetDir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('weekly_goals') && p.includes('KHÔNG cùng team')));
  db.close();
});

test('verifySlice4Migration: Mind Map data không phải JSON hợp lệ + file đính kèm bị thiếu trên đĩa -> ok=false, nêu cả 2', () => {
  const dir = nextDir('verify-mindmap');
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);
  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  const { db } = buildMigratedTargetFromLegacySource(sourceDbPath, targetDir);

  const now = new Date().toISOString();
  db.prepare("INSERT INTO mindmaps (title, data, created_at, updated_at) VALUES ('Sơ đồ hỏng', 'không phải JSON', ?, ?)").run(now, now);
  // JSON hợp lệ nhưng file được nhắc tới KHÔNG tồn tại trong mindmap-files/ của targetDataDir.
  db.prepare("INSERT INTO mindmaps (title, data, created_at, updated_at) VALUES ('Sơ đồ thiếu file', ?, ?, ?)")
    .run(JSON.stringify({ note: 'xem /api/mindmaps/files/khong-ton-tai__file.txt' }), now, now);

  const result = verifySlice4Migration(sourceDbPath, db, targetDir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('mindmaps') && p.includes('parse được JSON')));
  assert.ok(result.problems.some((p) => p.includes('mindmaps') && p.includes('file đính kèm bị thiếu')));
  db.close();
});

// BL-20260913-001 (việc dọn nợ #3, Lát 5): bảng mindmap_attachments (thiết kế Lát 5) giờ CÓ hash —
// verifySlice4Migration() quay lại kiểm được "hash khớp manifest" mà Lát 4 xác nhận là khoảng trống
// thật (chưa có bảng lưu hash lúc đó). Test này độc lập với test Mind Map JSON/URL phía trên (khác
// bảng, khác thư mục — mindmap-attachments/ chứ không phải mindmap-files/).
test('verifySlice4Migration: mindmap_attachments — sha256 khớp manifest thì ok, lệch hash hoặc thiếu file thì ok=false nêu rõ cả 2', () => {
  const dir = nextDir('verify-mindmap-attachment-hash');
  const { dbPath: sourceDbPath } = buildLegacyDesktopDb(dir);
  const targetDir = path.join(dir, 'target');
  fs.mkdirSync(targetDir, { recursive: true });
  const { db } = buildMigratedTargetFromLegacySource(sourceDbPath, targetDir);

  const now = new Date().toISOString();
  const mindmapId = Number(
    db.prepare("INSERT INTO mindmaps (title, data, created_at, updated_at) VALUES ('Sơ đồ có attachment', '{}', ?, ?)").run(now, now).lastInsertRowid
  );

  const attachmentsDir = path.join(targetDir, 'mindmap-attachments');
  fs.mkdirSync(attachmentsDir, { recursive: true });

  // (1) File đúng nội dung, hash khớp -> không được liệt vào problems.
  const okContent = 'nội dung file đính kèm hợp lệ';
  const okHash = crypto.createHash('sha256').update(okContent).digest('hex');
  fs.writeFileSync(path.join(attachmentsDir, 'ok-storage-key'), okContent);
  db.prepare(`
    INSERT INTO mindmap_attachments (id, mindmap_id, original_name, storage_key, extension, declared_mime, byte_size, sha256, status, created_at)
    VALUES ('att-ok', ?, 'ok.txt', 'ok-storage-key', '.txt', 'text/plain', ?, ?, 'ready', ?)
  `).run(mindmapId, Buffer.byteLength(okContent), okHash, now);

  // (2) File TỒN TẠI nhưng nội dung bị đổi sau khi copy -> hash lệch.
  fs.writeFileSync(path.join(attachmentsDir, 'tampered-storage-key'), 'nội dung ĐÃ BỊ ĐỔI sau khi copy');
  db.prepare(`
    INSERT INTO mindmap_attachments (id, mindmap_id, original_name, storage_key, extension, declared_mime, byte_size, sha256, status, created_at)
    VALUES ('att-tampered', ?, 'tampered.txt', 'tampered-storage-key', '.txt', 'text/plain', 10, 'hash-goc-khong-khop', 'ready', ?)
  `).run(mindmapId, now);

  // (3) File KHÔNG được copy sang đích (storage_key không tồn tại trên đĩa).
  db.prepare(`
    INSERT INTO mindmap_attachments (id, mindmap_id, original_name, storage_key, extension, declared_mime, byte_size, sha256, status, created_at)
    VALUES ('att-missing', ?, 'missing.txt', 'missing-storage-key', '.txt', 'text/plain', 10, 'khong-quan-trong', 'ready', ?)
  `).run(mindmapId, now);

  // (4) status = 'pending' (chưa publish) -> KHÔNG kiểm, không được liệt vào problems dù không có file.
  db.prepare(`
    INSERT INTO mindmap_attachments (id, mindmap_id, original_name, storage_key, extension, declared_mime, byte_size, sha256, status, created_at)
    VALUES ('att-pending', ?, 'pending.txt', 'pending-storage-key', '.txt', 'text/plain', 10, 'bat-ky', 'pending', ?)
  `).run(mindmapId, now);

  const result = verifySlice4Migration(sourceDbPath, db, targetDir, { autoRollbackOnFailure: false });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('mindmap_attachments') && p.includes('att-tampered') && p.includes('sha256')), JSON.stringify(result.problems));
  assert.ok(result.problems.some((p) => p.includes('mindmap_attachments') && p.includes('att-missing') && p.includes('thiếu')), JSON.stringify(result.problems));
  assert.ok(!result.problems.some((p) => p.includes('att-ok')), 'file hash khớp không được liệt vào problems');
  assert.ok(!result.problems.some((p) => p.includes('att-pending')), "attachment 'pending' chưa publish không được kiểm");
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
