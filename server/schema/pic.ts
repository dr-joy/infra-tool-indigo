import type { DatabaseSync } from 'node:sqlite';

// Schema của PIC (người phụ trách). Tách khỏi server/db.ts (kế hoạch Council run 022dd1e5, xem
// docs/exchanges/2026-09-12.md) — trước đây bảng `pics` bị tạo lẫn trong khối "Báo cáo tuần"
// dù PIC là khái niệm dùng chung (Project, Task, Weekly Report đều tham chiếu tên PIC), không
// phải phụ thuộc riêng của Weekly Report. Tách ra khớp với quyết định phía frontend (PIC có
// màn Quản lý riêng, không gộp vào một tính năng cụ thể nào).
export function applyPicSchema(db: DatabaseSync): void {
  db.exec(`
    -- Danh sách PIC (người phụ trách) quản lý động — thay cho danh sách hard-code trong UI.
    -- Lát 4 (CR-20260913 §6.3): chuyển hẳn thành CHỈ ĐỌC (dữ liệu tham khảo tên/màu cũ để Leader
    -- tự đối chiếu bằng mắt khi gán User thật + màu Gantt — không còn là nguồn chọn người). Thêm
    -- team_id để team mới không tự nhìn thấy nhãn/màu lịch sử của Dev13.
    CREATE TABLE IF NOT EXISTS pics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      team_id INTEGER REFERENCES teams(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
