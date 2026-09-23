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

    -- Council review vòng 2 Lát 5 — snapshot BẤT BIẾN "file di sản <-> mindmap sở hữu thật", thay hẳn
    -- việc route /mindmaps/files/:name quét SỐNG cột mindmaps.data mỗi lần tải (lỗ hổng thật: actor tự
    -- nhét URL file di sản vào data của 1 mindmap RIÊNG do actor tạo là tự cấp quyền cho chính mình).
    -- Ghi ĐÚNG 1 LẦN bởi captureLegacyMindmapFileOwnersSnapshot() (server/lib/legacy-mindmap-file-
    -- owners.ts), gọi từ server/db-migrations.ts (runVersionedMigrations, gate PRAGMA user_version) —
    -- tham chiếu actor tự thêm vào mindmaps.data SAU thời điểm chụp KHÔNG bao giờ xuất hiện ở đây, nên
    -- không còn tác dụng chiếm quyền. PRIMARY KEY (file_name, mindmap_id) + INSERT OR IGNORE khi ghi ->
    -- không có đường "sửa lại"/ghi đè dòng đã có. ON DELETE CASCADE: xoá mindmap thì dọn theo, không để
    -- lại tham chiếu treo tới mindmap không còn tồn tại.
    CREATE TABLE IF NOT EXISTS legacy_mindmap_file_owners (
      file_name TEXT NOT NULL,
      mindmap_id INTEGER NOT NULL REFERENCES mindmaps(id) ON DELETE CASCADE,
      captured_at TEXT NOT NULL,
      PRIMARY KEY (file_name, mindmap_id)
    );
    CREATE INDEX IF NOT EXISTS idx_legacy_mindmap_file_owners_file ON legacy_mindmap_file_owners(file_name);
  `);
}
