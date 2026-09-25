import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dataDir } from './paths.js';
import { bootstrapDatabase } from './db-bootstrap.js';
import type { DbMigrationContext } from './db-migrations.js';

export { bootstrapDatabase } from './db-bootstrap.js';

mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'tasks.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// BL-20260924-006: thiếu busy_timeout khiến 1 kết nối khác đụng đúng lúc (backup/migrate chạy song
// song, hoặc — xác nhận thật trong CI 25/09 — nhiều file test chạy đồng thời trên máy ít CPU làm
// khoảng hở giữa "mở kết nối" và "đóng kết nối trước" giãn ra) bị chặn NGAY bằng lỗi "database is
// locked" thay vì tự chờ. 5s đủ cho các thao tác ngắn hạn (transaction 1 request), không che được
// deadlock thật (deadlock sẽ vẫn timeout rồi báo lỗi, không treo vô hạn).
db.exec('PRAGMA busy_timeout = 5000');

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

// bootstrapDatabase() (server/db-bootstrap.ts) tái dùng bởi server/ops/slice4-migrate.ts (Lát 4, CR
// §6.3 di trú bước 3 "applySlice4Schema()") — hàm đó KHÔNG mở DB/đọc dataDir nào, tránh side-effect
// của chính file này (mở singleton `db` mặc định) lỡ chạy khi script vận hành chỉ muốn import hàm.
const migrationContext: DbMigrationContext = { dataDir, withTransaction };
bootstrapDatabase(db, migrationContext);
