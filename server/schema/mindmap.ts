import type { DatabaseSync } from 'node:sqlite';

// Schema của tính năng Mind Map. Tách khỏi server/db.ts (kế hoạch Council run 022dd1e5, xem
// docs/exchanges/2026-09-12.md) — nội dung SQL giữ nguyên văn.
//
// Mỗi sơ đồ lưu toàn bộ cây node dưới dạng JSON trong cột data (gốc + children lồng nhau).
// Cách này đơn giản và phù hợp với thao tác chỉnh sửa hoàn toàn ở client rồi lưu cả cây.
// Lát 4 (CR-20260913 §6.3): thêm owner_user_id + visibility + shared_team_id. shared_team_id tách
// riêng khỏi owner_user_id/visibility vì chủ sở hữu có thể thuộc nhiều team — chỉ 2 cột đầu không
// đủ biết chia sẻ cho team nào. Không thêm row_version (chỉ creator ghi, đúng FR-32).
export function applyMindmapSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mindmaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER REFERENCES users(id),
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team')),
      shared_team_id INTEGER REFERENCES teams(id),
      title TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
