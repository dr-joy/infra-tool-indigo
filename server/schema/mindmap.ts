import type { DatabaseSync } from 'node:sqlite';

// Schema của tính năng Mind Map. Tách khỏi server/db.ts (kế hoạch Council run 022dd1e5, xem
// docs/exchanges/2026-09-12.md) — nội dung SQL giữ nguyên văn.
//
// Mỗi sơ đồ lưu toàn bộ cây node dưới dạng JSON trong cột data (gốc + children lồng nhau).
// Cách này đơn giản và phù hợp với thao tác chỉnh sửa hoàn toàn ở client rồi lưu cả cây.
export function applyMindmapSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mindmaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
