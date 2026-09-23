import type { DatabaseSync } from 'node:sqlite';
import { applyTasksSchema } from './schema/tasks.js';
import { applyReleaseSchema } from './schema/release.js';
import { applyProjectSchema } from './schema/project.js';
import { applyPicSchema } from './schema/pic.js';
import { applyWeeklyReportSchema } from './schema/weekly-report.js';
import { applyLuyenDeSchema } from './schema/luyen-de.js';
import { applyMindmapSchema } from './schema/mindmap.js';
import { applyAppSettingsSchema } from './schema/app-settings.js';
import { applyRedmineSchema } from './schema/redmine.js';
import { applyAuthSchema } from './schema/auth.js';
import { runLegacyMigrations, runVersionedMigrations, runSlice4Migrations, type DbMigrationContext } from './db-migrations.js';
import { runSeed } from './db-seed.js';

// Toàn bộ schema hiện hành + migration lịch sử + seed + migration theo user_version, tách RIÊNG
// khỏi server/db.ts (Lát 4, CR §6.3 di trú bước 3 "applySlice4Schema()") vì lý do AN TOÀN quan
// trọng: server/db.ts có side-effect Ở CẤP MODULE (tự mở singleton `db` trỏ vào `dataDir` mặc định
// và tự chạy bootstrap ngay lúc import). server/ops/slice4-migrate.ts (script vận hành, KHÔNG được
// lỡ tay chạm DB thật) chỉ cần HÀM này, không được kéo theo side-effect đó — file này thuần export
// hàm, không mở DB nào, không đọc `dataDir`/biến môi trường.
//
// Từ Lát 4 (CR-20260913 §6.3), Project/Pic/WeeklyReport/Tasks/Mindmap có khóa ngoại trỏ sang
// users/teams của Auth — applyAuthSchema PHẢI chạy TRƯỚC các file đó (SQLite không bắt buộc thứ tự
// này ở DDL vì FK được kiểm lười, nhưng giữ đúng thứ tự tạo bảng theo phụ thuộc thật cho rõ ràng,
// tránh nhầm khi đọc lại sau này). Thứ tự nội bộ trong từng file vẫn giữ đúng để không phá khóa
// ngoại nội bộ (vd project_task_assignments -> project_tasks).
export function bootstrapDatabase(targetDb: DatabaseSync, context: DbMigrationContext): void {
  applyAuthSchema(targetDb);
  applyTasksSchema(targetDb);
  applyReleaseSchema(targetDb);
  applyProjectSchema(targetDb);
  applyPicSchema(targetDb);
  applyWeeklyReportSchema(targetDb);
  applyLuyenDeSchema(targetDb);
  applyMindmapSchema(targetDb);
  applyAppSettingsSchema(targetDb);
  applyRedmineSchema(targetDb);

  // Thứ tự gọi giữ nguyên như code trước khi tách hàm này: schema hiện hành xong hết -> migration
  // lịch sử -> seed -> migration theo user_version.
  runLegacyMigrations(targetDb, context);
  runSlice4Migrations(targetDb, context);
  runSeed(targetDb);
  runVersionedMigrations(targetDb, context);
}
