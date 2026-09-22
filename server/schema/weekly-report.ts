import type { DatabaseSync } from 'node:sqlite';

// Schema của tính năng Báo cáo tuần (Weekly Report). Tách khỏi server/db.ts (kế hoạch Council
// run 022dd1e5, xem docs/exchanges/2026-09-12.md) — bảng `pics` trước đây nằm lẫn trong khối này
// đã dời sang server/schema/pic.ts (PIC là khái niệm dùng chung, không riêng của Weekly Report).
//
// Lát 4 (CR-20260913 §6.3): thêm team_id (+ legacy_pic_label cho weekly_goals, + row_version) cho
// mọi bảng dưới đây — Weekly Report giờ là dữ liệu theo team, không còn toàn app 1 danh sách.
// weekly_report_history phải REBUILD vì UNIQUE đổi từ (week_start,kind,mode) sang
// (team_id,week_start,kind,mode) — ADD COLUMN không sửa được UNIQUE cũ.
export function applyWeeklyReportSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      project_id INTEGER,
      project_task_id INTEGER,
      team_id INTEGER REFERENCES teams(id),
      legacy_pic_label TEXT,
      row_version INTEGER NOT NULL DEFAULT 1,
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
      team_id INTEGER REFERENCES teams(id),
      row_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK (status IN ('dat', 'vuot', 'khong_dat')),
      note TEXT NOT NULL DEFAULT '',
      unplanned INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (week_start, project_task_id)
    );

    -- Đánh giá chung theo project cho một tuần (nhập ở bước Summary của wizard).
    CREATE TABLE IF NOT EXISTS weekly_project_summaries (
      week_start TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      team_id INTEGER REFERENCES teams(id),
      row_version INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (week_start, project_id)
    );

    -- Báo cáo đã phê duyệt (history). Mỗi team + tuần + loại + góc nhìn chỉ có 1 bản.
    CREATE TABLE IF NOT EXISTS weekly_report_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      team_id INTEGER REFERENCES teams(id),
      kind TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'by_project',
      content TEXT NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (team_id, week_start, kind, mode)
    );

    CREATE INDEX IF NOT EXISTS idx_weekly_goals_week ON weekly_goals(week_start);
    CREATE INDEX IF NOT EXISTS idx_weekly_goals_task ON weekly_goals(project_task_id);
    CREATE INDEX IF NOT EXISTS idx_weekly_report_history_week ON weekly_report_history(week_start);

    -- CR §6.3 "Bảng mới" (thiết kế chi tiết Council 74715c65, thuộc phạm vi Lát 5/FR-22 — chỉ tạo
    -- SCHEMA ở đây theo đúng yêu cầu khai báo cột của Lát 4; KHÔNG có route/seed nào đi kèm trong Lát
    -- 4, đó là việc của Lát 5). render_mode là allowlist ĐÓNG trong code (server), không CHECK ở DB vì
    -- danh sách giá trị hợp lệ có thể mở rộng khi thêm loại hiển thị mới mà không cần migration.
    CREATE TABLE IF NOT EXISTS weekly_report_kinds (
      id TEXT PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      render_mode TEXT NOT NULL,
      requires_project_risk INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id)
    );
    -- (team_id, code) không phân biệt hoa/thường, giống quy ước đã dùng cho pics.name.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_report_kinds_team_code
      ON weekly_report_kinds(team_id, code COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS weekly_project_risks (
      id TEXT PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      week_start TEXT NOT NULL,
      report_kind_id TEXT NOT NULL REFERENCES weekly_report_kinds(id),
      project_id INTEGER NOT NULL REFERENCES projects(id),
      risk TEXT NOT NULL DEFAULT '',
      mitigation TEXT NOT NULL DEFAULT '',
      row_version INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (team_id, week_start, report_kind_id, project_id)
    );

    -- report_kind_id và project_id phải thật sự thuộc đúng team_id của dòng risk (CR §6.3) — khoá
    -- cứng ở DB, không chỉ trông chờ route kiểm đúng.
    CREATE TRIGGER IF NOT EXISTS trg_weekly_project_risks_scope_insert
    BEFORE INSERT ON weekly_project_risks
    BEGIN
      SELECT RAISE(ABORT, 'weekly_project_risks.report_kind_id phai thuoc cung team_id')
      WHERE NOT EXISTS (SELECT 1 FROM weekly_report_kinds WHERE id = NEW.report_kind_id AND team_id = NEW.team_id);
      SELECT RAISE(ABORT, 'weekly_project_risks.project_id phai thuoc cung team_id')
      WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND team_id IS NEW.team_id);
    END;
    CREATE TRIGGER IF NOT EXISTS trg_weekly_project_risks_scope_update
    BEFORE UPDATE OF team_id, report_kind_id, project_id ON weekly_project_risks
    BEGIN
      SELECT RAISE(ABORT, 'weekly_project_risks.report_kind_id phai thuoc cung team_id')
      WHERE NOT EXISTS (SELECT 1 FROM weekly_report_kinds WHERE id = NEW.report_kind_id AND team_id = NEW.team_id);
      SELECT RAISE(ABORT, 'weekly_project_risks.project_id phai thuoc cung team_id')
      WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND team_id IS NEW.team_id);
    END;
  `);
}
