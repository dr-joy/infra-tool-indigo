import type { DatabaseSync } from 'node:sqlite';

// Schema của tính năng Project. Tách khỏi server/db.ts (kế hoạch Council run 022dd1e5, xem
// docs/exchanges/2026-09-12.md) — nội dung SQL và thứ tự tạo bảng (projects → project_tasks →
// project_task_assignments, đúng thứ tự khóa ngoại) giữ nguyên văn.
export function applyProjectSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ten_project TEXT NOT NULL,
      pic TEXT NOT NULL,
      ngay_bat_dau TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      closed_at TEXT,
      pending_at TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      parent_id INTEGER,
      level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
      tieu_de TEXT NOT NULL,
      ghi_chu TEXT NOT NULL DEFAULT '',
      ngay_bat_dau_du_kien TEXT NOT NULL,
      ngay_ket_thuc_du_kien TEXT NOT NULL,
      estimate_hours REAL,
      tien_do INTEGER NOT NULL CHECK (tien_do BETWEEN 0 AND 100),
      task_links TEXT NOT NULL DEFAULT '[]',
      assignee TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      execution_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON project_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_tasks_parent_id ON project_tasks(parent_id);
  `);

  // Phân công theo giai đoạn cho task lá: mỗi dòng = 1 PIC làm từ start_date → end_date,
  // estimate_hours là giờ dự kiến của giai đoạn đó. Một PIC có thể có nhiều giai đoạn.
  // Ngày/estimate của task lá được suy ra (min start, max end, tổng giờ) từ các giai đoạn này.
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
      pic TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      estimate_hours REAL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pta_task ON project_task_assignments(project_task_id);
  `);

  // Mỗi giai đoạn phân công có % tiến độ riêng. % của task lá được suy ra theo công thức
  // số giờ hoàn thành / tổng giờ estimate của các giai đoạn (giống cách tính rollup task cha-con).
  const ptaColumns = db.prepare('PRAGMA table_info(project_task_assignments)').all() as { name: string }[];
  if (!ptaColumns.some((c) => c.name === 'tien_do')) {
    db.exec('ALTER TABLE project_task_assignments ADD COLUMN tien_do INTEGER NOT NULL DEFAULT 0');
  }
}
