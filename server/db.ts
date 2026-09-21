import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dataDir } from './paths.js';
import { applyTasksSchema } from './schema/tasks.js';
import { applyReleaseSchema } from './schema/release.js';
import { applyProjectSchema } from './schema/project.js';
import { applyPicSchema } from './schema/pic.js';
import { applyWeeklyReportSchema } from './schema/weekly-report.js';
import { applyLuyenDeSchema } from './schema/luyen-de.js';
import { applyMindmapSchema } from './schema/mindmap.js';
import { applyAppSettingsSchema } from './schema/app-settings.js';
import { applyAuthSchema } from './schema/auth.js';
import { runLegacyMigrations, runVersionedMigrations } from './db-migrations.js';
import { runSeed } from './db-seed.js';

mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'tasks.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Bọc 1 khối thao tác trong transaction: BEGIN luôn nằm trong try, lỗi -> ROLLBACK
// rồi ném lại để route xử lý (sendRouteError). Thay cho pattern BEGIN/COMMIT/ROLLBACK lặp lại.
export function withTransaction<T>(fn: () => T): T {
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

// ── Schema hiện hành, tách theo tính năng (kế hoạch Council run 022dd1e5, xem
// docs/exchanges/2026-09-12.md) — không có khóa ngoại xuyên tính năng nào ngoài nội bộ Project
// (project_task_assignments -> project_tasks) và nội bộ Luyện đề, nên thứ tự gọi giữa các file
// KHÁC tính năng không bị ràng buộc kỹ thuật; thứ tự nội bộ trong từng file vẫn giữ đúng để
// không phá khóa ngoại nội bộ. Không đổi thứ tự này khi thêm tính năng mới mà chưa xác nhận lại
// bằng cách đọc schema thật.
applyTasksSchema(db);
applyReleaseSchema(db);
applyProjectSchema(db);
applyPicSchema(db);
applyWeeklyReportSchema(db);
applyLuyenDeSchema(db);
applyMindmapSchema(db);
applyAppSettingsSchema(db);
applyAuthSchema(db);

// ── Migration lịch sử + seed + migration theo PRAGMA user_version, tách theo TRỤC LOẠI (không
// theo tính năng) vì có ràng buộc thứ tự thực thi xuyên nhiều bảng — xem comment trong
// db-migrations.ts. Thứ tự gọi giữ nguyên như code trước khi tách: schema hiện hành xong hết ->
// migration lịch sử -> seed -> migration theo user_version.
const migrationContext = { dataDir, withTransaction };
runLegacyMigrations(db, migrationContext);
runSeed(db);
runVersionedMigrations(db, migrationContext);
