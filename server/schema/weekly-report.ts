import type { DatabaseSync } from 'node:sqlite';

// Schema của tính năng Báo cáo tuần (Weekly Report). Tách khỏi server/db.ts (kế hoạch Council
// run 022dd1e5, xem docs/exchanges/2026-09-12.md) — bảng `pics` trước đây nằm lẫn trong khối này
// đã dời sang server/schema/pic.ts (PIC là khái niệm dùng chung, không riêng của Weekly Report).
export function applyWeeklyReportSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      project_id INTEGER,
      project_task_id INTEGER,
      assignee TEXT,
      goal_text TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      start_progress INTEGER,
      target_progress INTEGER,
      manual_done INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Đánh giá từng task của một tuần (điền ở wizard tạo báo cáo; week_start = tuần được đánh giá).
    -- status: dat | vuot | khong_dat. unplanned = 1 nếu task được làm nhưng không nằm trong mục tiêu tuần đó.
    CREATE TABLE IF NOT EXISTS weekly_task_evaluations (
      week_start TEXT NOT NULL,
      project_task_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('dat', 'vuot', 'khong_dat')),
      note TEXT NOT NULL DEFAULT '',
      unplanned INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (week_start, project_task_id)
    );

    -- Đánh giá chung theo project cho một tuần (nhập ở bước Summary của wizard).
    CREATE TABLE IF NOT EXISTS weekly_project_summaries (
      week_start TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (week_start, project_id)
    );

    -- Báo cáo đã phê duyệt (history). Mỗi tuần + loại + góc nhìn chỉ có 1 bản.
    CREATE TABLE IF NOT EXISTS weekly_report_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      kind TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'by_project',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (week_start, kind, mode)
    );

    CREATE INDEX IF NOT EXISTS idx_weekly_goals_week ON weekly_goals(week_start);
    CREATE INDEX IF NOT EXISTS idx_weekly_goals_task ON weekly_goals(project_task_id);
    CREATE INDEX IF NOT EXISTS idx_weekly_report_history_week ON weekly_report_history(week_start);
  `);
}
