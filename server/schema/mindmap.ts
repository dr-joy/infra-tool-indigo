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

    -- Lát 5 (CR §6.3, FR-32a/FR-43) — bản ghi riêng cho từng file đính kèm (thay hẳn cơ chế cũ chỉ
    -- lưu URL tự do trong JSON). Quyền tải LUÔN join trạng thái SỐNG của mindmaps (owner_user_id/
    -- visibility/shared_team_id) tại thời điểm tải, KHÔNG lưu cứng quyền ở đây — đổi sơ đồ từ chia sẻ
    -- sang riêng tư phải thu hồi quyền tải ngay (khớp FR-32). team_id ở dưới CHỈ là metadata lúc
    -- upload (phục vụ audit/thống kê), KHÔNG phải nguồn quyền.
    CREATE TABLE IF NOT EXISTS mindmap_attachments (
      id TEXT PRIMARY KEY,
      mindmap_id INTEGER NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
      owner_user_id INTEGER REFERENCES users(id),
      team_id INTEGER REFERENCES teams(id),
      original_name TEXT NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      extension TEXT NOT NULL,
      declared_mime TEXT NOT NULL,
      detected_mime TEXT,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'quarantined', 'deleted')),
      created_at TEXT NOT NULL,
      ready_at TEXT,
      deleted_at TEXT,
      created_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mindmap_attachments_mindmap ON mindmap_attachments(mindmap_id);
    CREATE INDEX IF NOT EXISTS idx_mindmap_attachments_status_created ON mindmap_attachments(status, created_at);
  `);
}
