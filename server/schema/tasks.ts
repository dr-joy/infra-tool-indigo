import type { DatabaseSync } from 'node:sqlite';

// Schema của tính năng Task cá nhân. Tách khỏi server/db.ts (kế hoạch Council
// run 022dd1e5, xem docs/exchanges/2026-09-12.md) — nội dung SQL giữ nguyên văn.
export function applyTasksSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ten_task TEXT NOT NULL,
      ghi_chu TEXT NOT NULL DEFAULT '',
      loai_task TEXT NOT NULL CHECK (loai_task IN ('don_le', 'dinh_ky')),
      do_uu_tien INTEGER,
      trang_thai TEXT NOT NULL CHECK (trang_thai IN ('chua_thuc_hien', 'dang_tien_hanh', 'da_hoan_thanh', 'canceled')),
      ngay_tao TEXT NOT NULL,
      ngay_hoan_thanh TEXT,
      gio_bat_dau TEXT,
      gio_ket_thuc TEXT,
      lap_lai_kieu TEXT,
      ngay_trong_thang INTEGER,
      thu_trong_tuan INTEGER,
      ngay_cu_the TEXT,
      release_month TEXT,
      release_date TEXT,
      task_links TEXT NOT NULL DEFAULT '[]'
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_loai_trang_thai ON tasks(loai_task, trang_thai);
    CREATE INDEX IF NOT EXISTS idx_tasks_release_month ON tasks(release_month);
    CREATE INDEX IF NOT EXISTS idx_tasks_ngay_cu_the ON tasks(ngay_cu_the);
  `);
}
