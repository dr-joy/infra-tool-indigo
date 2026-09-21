import type { DatabaseSync } from 'node:sqlite';

// Schema hạ tầng dùng chung: cấu hình ứng dụng dạng key-value. Tách khỏi server/db.ts (kế hoạch
// Council run 022dd1e5, xem docs/exchanges/2026-09-12.md) — nội dung SQL giữ nguyên văn. Hiện
// chỉ Redmine đang dùng bảng này, nhưng đây là hạ tầng dùng chung thật sự (bất kỳ cấu hình
// lặt vặt nào khác cũng có thể dùng chung key-value store này), không gán riêng cho Redmine.
export function applyAppSettingsSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
