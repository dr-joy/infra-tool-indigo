// CR-20260913 Lát 4 (§6.3 "Di trú (FR-20)") — hợp đồng 7 hàm di trú dữ liệu Dev13 (PIC/assignee chuỗi
// tự do -> User thật + team_id) từ bản desktop 1-user lên server nhiều team.
//
// ⚠️ ĐÂY LÀ SCRIPT VẬN HÀNH CHẠY TAY MỘT LẦN bởi con người khi di trú dữ liệu Dev13 THẬT — KHÔNG phải
// migration tự động lúc boot (đó là `runSlice4Migrations()` trong server/db-migrations.ts, đã chạy tự
// động mỗi lần server khởi động). Hai lý do tách riêng (đã ghi trong db-migrations.ts):
//   1. Cần tham số thật (`leaderUserId` cụ thể của Dev13) không suy được tự động.
//   2. Không được lặp lại ngoài ý muốn trên DB đang có nhiều team thật (bước 4 gán scope Dev13 chỉ
//      chạy đúng 1 lần cho đúng dữ liệu di trú ban đầu).
//
// Các hàm ở đây KHÔNG được tự ý gọi nhắm vào file DB thật của Dev13 trong bất kỳ agent nào — chỉ viết
// và test bằng DB SQLite tạm. Người vận hành thật sẽ gọi CLI này (server/ops/run-slice4-migrate.mjs,
// nếu được viết) hoặc import trực tiếp bằng script khác, tự cung cấp đường dẫn + leaderUserId thật.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
// Import từ db-bootstrap.js (KHÔNG phải db.js) rất quan trọng: db.js có side-effect cấp module (tự
// mở singleton `db` trỏ vào `dataDir` mặc định của máy đang chạy ngay lúc import) — script vận hành
// này chỉ được đụng tới DB do CHÍNH NGƯỜI GỌI chỉ định qua tham số, không được lỡ tay mở thêm kết nối
// nào khác. Xem comment trong server/db-bootstrap.ts.
import { bootstrapDatabase } from '../db-bootstrap.js';
import type { DbMigrationContext } from '../db-migrations.js';

// Bảng cốt lõi dùng để đối chiếu số dòng trước/sau ở bước 1 (backup) và bước 6 (verify) — đúng danh
// sách bảng nghiệp vụ Lát 4 chạm tới (không liệt kê bảng cấu hình/lịch sử de_thi_* vì Luyện đề không
// đổi gì ở Lát 4).
const CORE_TABLES = [
  'projects', 'project_tasks', 'project_task_assignments', 'pics',
  'weekly_goals', 'weekly_task_evaluations', 'weekly_project_summaries', 'weekly_report_history',
  'tasks', 'mindmaps'
] as const;

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function countRowsByTable(db: DatabaseSync, tables: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    counts[table] = tableExists(db, table)
      ? (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
      : 0;
  }
  return counts;
}

export interface BackupManifest {
  sourcePath: string;
  backupPath: string;
  sha256: string;
  createdAt: string;
  userVersion: number;
  rowCounts: Record<string, number>;
}

// ── Bước 1: createVerifiedBackup ─────────────────────────────────────────────────────────────
// Sao lưu DB nguồn bằng VACUUM INTO (đúng cơ chế đã dùng ở scripts/backup-db.mjs — an toàn ngay cả
// khi WAL đang mở), rồi ĐỌC LẠI bản backup và đối chiếu số dòng từng bảng với DB nguồn trước khi coi
// là xong — "không sang bước 2 nếu chưa đọc thử và khớp checksum" (CR §6.3): checksum ở đây là
// PRAGMA integrity_check + đối chiếu số dòng từng bảng (VACUUM INTO tạo file nén lại, không thể so
// sánh byte-for-byte với nguồn — sha256 trả về là của CHÍNH bản backup, dùng để phát hiện file bị
// sửa/hỏng về sau, không phải để so với nguồn).
export async function createVerifiedBackup(sourceDbPath: string, backupDir: string): Promise<BackupManifest> {
  if (!existsSync(sourceDbPath)) {
    throw new Error(`createVerifiedBackup: không tìm thấy DB nguồn tại ${sourceDbPath}`);
  }
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `slice4-backup-${timestamp}.sqlite`);
  if (existsSync(backupPath)) throw new Error(`createVerifiedBackup: file backup đã tồn tại ${backupPath}`);

  const sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true });
  let sourceCounts: Record<string, number>;
  let userVersion: number;
  try {
    sourceCounts = countRowsByTable(sourceDb, CORE_TABLES);
    userVersion = (sourceDb.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    // VACUUM INTO ghi ra file MỚI, không đụng nguồn — chạy được cả khi nguồn read-only.
    sourceDb.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''").replace(/\\/g, '/')}'`);
  } finally {
    sourceDb.close();
  }

  const backupDb = new DatabaseSync(backupPath, { readOnly: true });
  let integrity: string;
  let backupCounts: Record<string, number>;
  try {
    integrity = (backupDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    backupCounts = countRowsByTable(backupDb, CORE_TABLES);
  } finally {
    backupDb.close();
  }

  if (integrity !== 'ok') {
    unlinkSync(backupPath);
    throw new Error(`createVerifiedBackup: bản backup KHÔNG toàn vẹn (integrity_check = ${integrity}) — đã xoá, dừng lại`);
  }
  const mismatched = CORE_TABLES.filter((t) => sourceCounts[t] !== backupCounts[t]);
  if (mismatched.length > 0) {
    unlinkSync(backupPath);
    throw new Error(`createVerifiedBackup: số dòng LỆCH giữa nguồn và backup ở bảng: ${mismatched.join(', ')} — đã xoá backup, dừng lại`);
  }

  const sha256 = await sha256File(backupPath);
  return { sourcePath: sourceDbPath, backupPath, sha256, createdAt: new Date().toISOString(), userVersion, rowCounts: backupCounts };
}

// ── Bước 2: buildServerDatabaseFromDesktopSnapshot ───────────────────────────────────────────
// Từ bản backup (bước 1), tạo ra 1 file DB server RIÊNG (không đụng bản backup gốc lẫn DB desktop
// gốc — cả hai đều KHÔNG bị xoá bảng de_thi_*, giữ nguyên cho Luyện đề chạy tiếp trên desktop).
// "Build server không mount de-thi.ts" là việc của server/app.ts (biến môi trường ENABLE_LUYEN_DE,
// xem comment ở đó) — hàm này chỉ lo phần dữ liệu, không khởi động server.
export async function buildServerDatabaseFromDesktopSnapshot(backupPath: string, outputPath: string): Promise<{ outputPath: string; sha256: string }> {
  if (!existsSync(backupPath)) throw new Error(`buildServerDatabaseFromDesktopSnapshot: không tìm thấy backup tại ${backupPath}`);
  if (existsSync(outputPath)) throw new Error(`buildServerDatabaseFromDesktopSnapshot: file đích đã tồn tại ${outputPath}`);
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const backupDb = new DatabaseSync(backupPath, { readOnly: true });
  try {
    backupDb.exec(`VACUUM INTO '${outputPath.replace(/'/g, "''").replace(/\\/g, '/')}'`);
  } finally {
    backupDb.close();
  }

  const outputDb = new DatabaseSync(outputPath, { readOnly: true });
  let integrity: string;
  try {
    integrity = (outputDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  } finally {
    outputDb.close();
  }
  if (integrity !== 'ok') {
    unlinkSync(outputPath);
    throw new Error(`buildServerDatabaseFromDesktopSnapshot: DB đích KHÔNG toàn vẹn (${integrity}) — đã xoá, dừng lại`);
  }
  const sha256 = await sha256File(outputPath);
  return { outputPath, sha256 };
}

// ── Bước 3: applySlice4Schema + ensureDev13Identity ──────────────────────────────────────────
// applySlice4Schema TÁI DÙNG đúng chuỗi bootstrap thật của server (bootstrapDatabase(), tách ra từ
// server/db.ts) — không chép lại danh sách applyXSchema()/migration ở đây, tránh 2 nơi có thể lệch
// nhau theo thời gian.
export function applySlice4Schema(targetDb: DatabaseSync, dataDirForContext: string): void {
  targetDb.exec('PRAGMA foreign_keys = ON');
  const context: DbMigrationContext = {
    dataDir: dataDirForContext,
    withTransaction: <T>(fn: () => T): T => {
      targetDb.exec('BEGIN TRANSACTION');
      try {
        const result = fn();
        targetDb.exec('COMMIT');
        return result;
      } catch (error) {
        if (targetDb.isTransaction) targetDb.exec('ROLLBACK');
        throw error;
      }
    }
  };
  bootstrapDatabase(targetDb, context);
}

export interface Dev13Identity {
  teamId: number;
}

// KHÔNG map bằng email/display_name (CR §6.3) — `leaderUserId` phải do người vận hành tự tra và
// truyền vào (đã xác nhận qua kênh khác, ngoài phạm vi hàm này) là đúng User đã đăng nhập OIDC thật.
export function ensureDev13Identity(targetDb: DatabaseSync, leaderUserId: number, teamName = 'Dev13'): Dev13Identity {
  const leader = targetDb.prepare('SELECT id, status FROM users WHERE id = ?').get(leaderUserId) as { id: number; status: string } | undefined;
  if (!leader) throw new Error(`ensureDev13Identity: không tìm thấy user id=${leaderUserId}`);
  if (leader.status !== 'active') throw new Error(`ensureDev13Identity: user id=${leaderUserId} chưa active (status=${leader.status}) — phải đăng nhập + được duyệt trước`);

  let team = targetDb.prepare('SELECT id FROM teams WHERE name = ?').get(teamName) as { id: number } | undefined;
  const now = new Date().toISOString();
  if (!team) {
    targetDb.exec('BEGIN TRANSACTION');
    try {
      const result = targetDb.prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)').run(teamName, now);
      const teamId = Number(result.lastInsertRowid);
      const insertVisibility = targetDb.prepare(
        "INSERT INTO team_feature_visibility (team_id, feature, level, updated_at) VALUES (?, ?, 'off', ?)"
      );
      for (const feature of ['personal_task', 'project', 'weekly_report', 'release', 'mind_map']) {
        insertVisibility.run(teamId, feature, now);
      }
      targetDb.exec('COMMIT');
      team = { id: teamId };
    } catch (error) {
      if (targetDb.isTransaction) targetDb.exec('ROLLBACK');
      throw error;
    }
  }

  const existingLeader = targetDb.prepare("SELECT user_id FROM team_members WHERE team_id = ? AND role = 'leader'").get(team.id) as { user_id: number } | undefined;
  if (existingLeader && existingLeader.user_id !== leaderUserId) {
    throw new Error(`ensureDev13Identity: team "${teamName}" đã có Leader khác (user_id=${existingLeader.user_id}) — cần người vận hành tự xử lý, không tự ghi đè`);
  }
  if (!existingLeader) {
    const membership = targetDb.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(team.id, leaderUserId) as { role: string } | undefined;
    if (membership) {
      targetDb.prepare("UPDATE team_members SET role = 'leader' WHERE team_id = ? AND user_id = ?").run(team.id, leaderUserId);
    } else {
      targetDb.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'leader')").run(team.id, leaderUserId);
    }
  }
  return { teamId: team.id };
}

// ── Bước 4: backfillDev13Scope ────────────────────────────────────────────────────────────────
// Gán team_id/owner_user_id cho TOÀN BỘ dữ liệu hiện có đang NULL (dữ liệu desktop cũ, tạo trước khi
// khái niệm team/user tồn tại). CHỈ chạm dòng đang NULL — idempotent, chạy lại không đổi gì thêm.
export interface BackfillCounts {
  projects: number;
  projectTasks: number;
  pics: number;
  weeklyGoals: number;
  weeklyTaskEvaluations: number;
  weeklyProjectSummaries: number;
  weeklyReportHistory: number;
  tasks: number;
  mindmaps: number;
}

export function backfillDev13Scope(targetDb: DatabaseSync, dev13TeamId: number, leaderUserId: number): BackfillCounts {
  targetDb.exec('BEGIN TRANSACTION');
  try {
    // Project hệ thống "Khác": trước Lát 4 là ĐÚNG 1 dòng toàn app. Nếu có nhiều hơn 1 (không nên
    // xảy ra, nhưng không tự đoán/xoá) thì dừng lại để người vận hành tự xử lý — tránh vi phạm
    // unique partial index idx_projects_system_per_team ngay khi gán team_id.
    const systemProjectCount = (targetDb.prepare('SELECT COUNT(*) AS c FROM projects WHERE is_system = 1 AND team_id IS NULL').get() as { c: number }).c;
    if (systemProjectCount > 1) {
      throw new Error(`backfillDev13Scope: có ${systemProjectCount} project hệ thống "Khác" chưa gán team (chỉ nên có 1) — cần người vận hành tự gộp/xử lý trước khi chạy tiếp`);
    }

    const projects = targetDb.prepare('UPDATE projects SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    // project_tasks.team_id LẤY TỪ projects.team_id qua join (CR §6.3) — không gán hằng số theo
    // từng dòng, để đúng theo project cha thật (an toàn kể cả khi sau này còn project khác team).
    const projectTasks = targetDb.prepare(`
      UPDATE project_tasks SET team_id = (SELECT p.team_id FROM projects p WHERE p.id = project_tasks.project_id)
      WHERE team_id IS NULL
    `).run();
    const pics = targetDb.prepare('UPDATE pics SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    const weeklyGoals = targetDb.prepare('UPDATE weekly_goals SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    const weeklyTaskEvaluations = targetDb.prepare('UPDATE weekly_task_evaluations SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    const weeklyProjectSummaries = targetDb.prepare('UPDATE weekly_project_summaries SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    const weeklyReportHistory = targetDb.prepare('UPDATE weekly_report_history SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    // Task cá nhân + Mind Map: owner_user_id = Leader hiện tại (dữ liệu desktop cũ vốn chỉ 1 người
    // dùng). Mind Map cũ mặc định private, KHÔNG tự chia sẻ (CR §6.3).
    const tasks = targetDb.prepare('UPDATE tasks SET owner_user_id = ? WHERE owner_user_id IS NULL').run(leaderUserId);
    const mindmaps = targetDb.prepare(
      "UPDATE mindmaps SET owner_user_id = ?, visibility = COALESCE(visibility, 'private') WHERE owner_user_id IS NULL"
    ).run(leaderUserId);

    targetDb.exec('COMMIT');
    return {
      projects: Number(projects.changes), projectTasks: Number(projectTasks.changes), pics: Number(pics.changes),
      weeklyGoals: Number(weeklyGoals.changes), weeklyTaskEvaluations: Number(weeklyTaskEvaluations.changes),
      weeklyProjectSummaries: Number(weeklyProjectSummaries.changes), weeklyReportHistory: Number(weeklyReportHistory.changes),
      tasks: Number(tasks.changes), mindmaps: Number(mindmaps.changes)
    };
  } catch (error) {
    if (targetDb.isTransaction) targetDb.exec('ROLLBACK');
    throw error;
  }
}

// ── Bước 5: migrateLegacyPicLabels ───────────────────────────────────────────────────────────
// Copy NGUYÊN VĂN (không tách chuỗi nhiều tên, không so khớp hoa/thường, không tra pics/
// users.display_name, không đoán tài khoản — CR §6.3). CHÚ Ý: 3 UPDATE đầu (projects/project_tasks/
// weekly_goals) và rebuild project_task_assignments ĐÃ chạy tự động mỗi boot qua
// runSlice4Migrations() (gọi trong applySlice4Schema() ở bước 3, qua bootstrapDatabase()) — hàm này
// lặp lại CHÍNH XÁC cùng câu lệnh (idempotent, WHERE legacy_pic_label IS NULL) để là một bước tường
// minh, độc lập kiểm chứng được trong hợp đồng 7 bước, không phải vì bước 3 chưa làm.
export interface LegacyPicLabelCounts {
  projects: number;
  projectTasks: number;
  weeklyGoals: number;
}

export function migrateLegacyPicLabels(targetDb: DatabaseSync): LegacyPicLabelCounts {
  targetDb.exec('BEGIN TRANSACTION');
  try {
    const projects = targetDb.prepare(
      "UPDATE projects SET legacy_pic_label = pic WHERE legacy_pic_label IS NULL AND pic IS NOT NULL AND TRIM(pic) <> ''"
    ).run();
    const projectTasks = targetDb.prepare(
      "UPDATE project_tasks SET legacy_pic_label = assignee WHERE legacy_pic_label IS NULL AND assignee IS NOT NULL AND TRIM(assignee) <> ''"
    ).run();
    const weeklyGoals = targetDb.prepare(
      "UPDATE weekly_goals SET legacy_pic_label = assignee WHERE legacy_pic_label IS NULL AND assignee IS NOT NULL AND TRIM(assignee) <> ''"
    ).run();
    targetDb.exec('COMMIT');
    return { projects: Number(projects.changes), projectTasks: Number(projectTasks.changes), weeklyGoals: Number(weeklyGoals.changes) };
  } catch (error) {
    if (targetDb.isTransaction) targetDb.exec('ROLLBACK');
    throw error;
  }
}

// ── Bước 6: verifySlice4Migration ────────────────────────────────────────────────────────────
// Kiểm một TẬP CON đã xác nhận được rõ ràng bằng SQL của danh sách kiểm kê đầy đủ ở CR §6.3 bước 6
// (số dòng, FK, tính hợp lệ cây project, scope không còn NULL). CHƯA hiện thực: so hash nội dung
// "cột cũ không đổi giá trị", kiểm ngày/estimate/% rollup trước-sau bằng cách chạy lại thuật toán
// rollup rồi so sánh, parse JSON Mind Map + kiểm file đính kèm còn tồn tại + hash khớp manifest (cần
// biết đường dẫn thư mục mindmap-files thật, ngoài phạm vi 1 hàm chỉ nhận DB). Ghi rõ ở đây để không
// ai tưởng nhầm hàm này đã phủ hết — người vận hành thật phải tự bổ sung soát thủ công phần này
// trước khi coi di trú là an toàn 100%.
export interface VerifyResult {
  ok: boolean;
  problems: string[];
  rowCounts: Record<string, number>;
}

export function verifySlice4Migration(sourceDbPath: string, targetDb: DatabaseSync): VerifyResult {
  const problems: string[] = [];

  const sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true });
  let sourceCounts: Record<string, number>;
  try {
    sourceCounts = countRowsByTable(sourceDb, CORE_TABLES);
  } finally {
    sourceDb.close();
  }
  const targetCounts = countRowsByTable(targetDb, CORE_TABLES);
  for (const table of CORE_TABLES) {
    if (sourceCounts[table] !== targetCounts[table]) {
      problems.push(`Số dòng bảng ${table} lệch: nguồn=${sourceCounts[table]}, đích=${targetCounts[table]}`);
    }
  }

  const fkViolations = targetDb.prepare('PRAGMA foreign_key_check').all();
  if (fkViolations.length > 0) problems.push(`PRAGMA foreign_key_check phát hiện ${fkViolations.length} vi phạm khoá ngoại`);

  const quickCheck = (targetDb.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
  if (quickCheck !== 'ok') problems.push(`PRAGMA quick_check = ${quickCheck} (không phải "ok")`);

  // Scope không còn NULL sau backfill — trừ project hệ thống "Khác" đã gán ở bước 4 (không nên còn
  // NULL nếu bước 4 chạy thành công); không kiểm project_task_assignments.user_id vì dòng legacy
  // (user_id NULL, legacy_pic_label có giá trị) là thiết kế hợp lệ, không phải lỗi.
  const nullTeamProjects = (targetDb.prepare('SELECT COUNT(*) AS c FROM projects WHERE team_id IS NULL').get() as { c: number }).c;
  if (nullTeamProjects > 0) problems.push(`Còn ${nullTeamProjects} project chưa gán team_id`);
  const nullTeamTasks = (targetDb.prepare('SELECT COUNT(*) AS c FROM project_tasks WHERE team_id IS NULL').get() as { c: number }).c;
  if (nullTeamTasks > 0) problems.push(`Còn ${nullTeamTasks} project_task chưa gán team_id`);
  const nullOwnerTasks = (targetDb.prepare('SELECT COUNT(*) AS c FROM tasks WHERE owner_user_id IS NULL').get() as { c: number }).c;
  if (nullOwnerTasks > 0) problems.push(`Còn ${nullOwnerTasks} task cá nhân chưa gán owner_user_id`);

  // Cây project: parent phải tồn tại, cùng project, level 1-3 (CHECK đã có ở schema — kiểm lại đây
  // là kiểm KHÔNG VÒNG LẶP, thứ CHECK constraint không phát hiện được).
  const taskRows = targetDb.prepare('SELECT id, project_id, parent_id FROM project_tasks').all() as { id: number; project_id: number; parent_id: number | null }[];
  const byId = new Map(taskRows.map((t) => [t.id, t]));
  for (const t of taskRows) {
    if (t.parent_id == null) continue;
    const parent = byId.get(t.parent_id);
    if (!parent) { problems.push(`project_task ${t.id} trỏ tới parent_id ${t.parent_id} không tồn tại`); continue; }
    if (parent.project_id !== t.project_id) problems.push(`project_task ${t.id} và parent ${t.parent_id} khác project_id`);
    let cursor: typeof parent | undefined = parent;
    const seen = new Set<number>([t.id]);
    while (cursor) {
      if (seen.has(cursor.id)) { problems.push(`project_task ${t.id} nằm trong VÒNG LẶP cha-con`); break; }
      seen.add(cursor.id);
      cursor = cursor.parent_id == null ? undefined : byId.get(cursor.parent_id);
    }
  }

  return { ok: problems.length === 0, problems, rowCounts: targetCounts };
}

// ── Bước 7: smokeBootMigratedServer ──────────────────────────────────────────────────────────
// Khởi động server THẬT (import server/app.ts) trỏ vào DB vừa di trú, gọi vài API smoke, rồi dừng.
// Vì server/db.ts đọc DATA_DIR/APPDATA lúc import (side effect module-level), hàm này bắt buộc
// nhận `dataDir` chứa SẴN file `tasks.sqlite` đã di trú xong — không tự copy/di chuyển file.
export interface SmokeBootResult {
  ok: boolean;
  problems: string[];
}

export async function smokeBootMigratedServer(dataDirWithMigratedDb: string): Promise<SmokeBootResult> {
  const problems: string[] = [];
  const dbFile = path.join(dataDirWithMigratedDb, 'tasks.sqlite');
  if (!existsSync(dbFile)) {
    return { ok: false, problems: [`Không tìm thấy ${dbFile} — phải đặt DB đã di trú đúng tên tasks.sqlite trong thư mục này trước`] };
  }

  const previousDataDir = process.env.DATA_DIR;
  const previousAppData = process.env.APPDATA;
  const previousEnableLuyenDe = process.env.ENABLE_LUYEN_DE;
  process.env.DATA_DIR = dataDirWithMigratedDb;
  process.env.APPDATA = dataDirWithMigratedDb;
  process.env.ENABLE_LUYEN_DE = 'false';

  try {
    // Import động sau khi set env — server/paths.ts + server/db.ts đọc process.env lúc module nạp
    // (giống cách test/integration/*.test.ts cô lập DATA_DIR, xem test/unit/weekly-report-excel.test.ts).
    const cacheBust = `?slice4-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { app } = await import(`../app.js${cacheBust}`) as typeof import('../app.js');

    const server = app.listen(0, '127.0.0.1');
    const base = await new Promise<string>((resolve) => {
      server.on('listening', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`http://127.0.0.1:${port}`);
      });
    });

    try {
      const ready = await fetch(`${base}/health/ready`);
      if (ready.status !== 200) problems.push(`GET /health/ready trả ${ready.status}, kỳ vọng 200`);

      // Luyện đề không có route trên server (ENABLE_LUYEN_DE=false) -> 404, không phải SQL 500.
      const luyenDe = await fetch(`${base}/api/de-thi/ky-thi`);
      if (luyenDe.status !== 404) problems.push(`GET /api/de-thi/ky-thi trả ${luyenDe.status}, kỳ vọng 404 (Luyện đề không mount trên server)`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
    if (previousAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = previousAppData;
    if (previousEnableLuyenDe === undefined) delete process.env.ENABLE_LUYEN_DE; else process.env.ENABLE_LUYEN_DE = previousEnableLuyenDe;
  }

  return { ok: problems.length === 0, problems };
}

// Chỉ để test đọc mtime/size khi cần dựng fixture — không dùng trong luồng chính.
export function fileSize(filePath: string): number {
  return statSync(filePath).size;
}
