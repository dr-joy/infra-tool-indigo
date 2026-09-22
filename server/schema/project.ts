import type { DatabaseSync } from 'node:sqlite';

// Schema của tính năng Project. Tách khỏi server/db.ts (kế hoạch Council run 022dd1e5, xem
// docs/exchanges/2026-09-12.md) — nội dung SQL và thứ tự tạo bảng (projects → project_tasks →
// project_task_assignments, đúng thứ tự khóa ngoại) giữ nguyên văn.
//
// Lát 4 (CR-20260913 §6.3, chốt qua Council `76e03307`, xem docs/exchanges/2026-09-19.md): thêm
// team_id/responsible_user_id/legacy_pic_label/row_version cho projects + project_tasks, rebuild
// project_task_assignments (pic NOT NULL -> user_id nullable), thêm bảng team_member_gantt_colors.
//
// QUAN TRỌNG — bài học rút ra khi code (đã tự bắt lỗi thật trước khi chạm DB Dev13): các
// CREATE TABLE dưới đây dùng IF NOT EXISTS nên là NO-OP vô hại trên DB thật đã tồn tại (bảng cũ
// chưa có cột mới) — nhưng bất kỳ INDEX/TRIGGER nào tạo ra ngay sau đó mà tham chiếu cột MỚI sẽ
// CRASH ngay lúc CREATE (SQLite validate cột tồn tại lúc tạo index/trigger, không đợi lúc dùng).
// Vì applyProjectSchema() chạy TRƯỚC mọi ALTER COLUMN nâng cấp DB cũ (server/db-migrations.ts,
// runSlice4Migrations), 3 trigger 2 chiều + index "1 project hệ thống mỗi team" + unique index
// user_id KHÔNG được đặt ở đây — chúng chỉ an toàn sau khi cột team_id/user_id chắc chắn đã tồn
// tại, nên sống hẳn trong runSlice4Migrations (chạy sau ALTER, dùng CREATE ... IF NOT EXISTS nên
// vẫn đúng luôn cho DB mới tinh). File này CHỈ còn CREATE TABLE + index/constraint không đụng cột
// mới trên bảng cũ.
export function applyProjectSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ten_project TEXT NOT NULL,
      pic TEXT NOT NULL,
      team_id INTEGER REFERENCES teams(id),
      responsible_user_id INTEGER REFERENCES users(id),
      legacy_pic_label TEXT,
      row_version INTEGER NOT NULL DEFAULT 1,
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
      team_id INTEGER REFERENCES teams(id),
      legacy_pic_label TEXT,
      row_version INTEGER NOT NULL DEFAULT 1,
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

  // Phân công theo giai đoạn cho task lá: mỗi dòng = 1 User (hoặc nhãn cũ chỉ-đọc sau di trú) làm
  // từ start_date → end_date, estimate_hours là giờ dự kiến của giai đoạn đó. Một User có thể có
  // nhiều giai đoạn (khoảng thời gian được phép chồng lấn, mỗi User đúng 1 khoảng trên 1 task —
  // FR-16/FR-17, unique index đặt ở runSlice4Migrations vì lý do nêu trên). Ngày/estimate của task
  // lá được suy ra (min start, max end, tổng giờ) từ các giai đoạn này.
  //
  // Lát 4: rebuild bảng vì cột `pic` đang NOT NULL, cần đổi sang `user_id` nullable + nhãn cũ.
  // DB thật đã tồn tại được nâng cấp qua rebuild idempotent trong server/db-migrations.ts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      legacy_pic_label TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      estimate_hours REAL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      tien_do INTEGER NOT NULL DEFAULT 0,
      row_version INTEGER NOT NULL DEFAULT 1,
      CHECK (user_id IS NOT NULL OR (legacy_pic_label IS NOT NULL AND legacy_pic_label <> ''))
    );
    CREATE INDEX IF NOT EXISTS idx_pta_task ON project_task_assignments(project_task_id);
  `);

  // Màu Gantt theo người, tách khỏi pics/team_members vì lifecycle riêng (CR §6.3 Lát 4). Bảng
  // MỚI hoàn toàn (không tồn tại trước Lát 4) nên an toàn tạo index cùng lúc — không có "bảng cũ
  // thiếu cột mới" như các bảng phía trên. color_key là token cố định trong 15 giá trị (ánh xạ
  // sang hex ở tầng code) — không lưu chỉ số mảng vì sắp xếp lại bảng màu sẽ đổi màu dữ liệu đã
  // lưu. Không chặn phân công task khi User chưa có màu — Gantt vẽ xám trung tính kèm tên cho tới
  // khi Leader gán màu.
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_member_gantt_colors (
      team_id INTEGER NOT NULL REFERENCES teams(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      color_key TEXT NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      PRIMARY KEY (team_id, user_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gantt_colors_team_color ON team_member_gantt_colors(team_id, color_key);
  `);

  // Phân công theo giai đoạn có % tiến độ riêng (đã tồn tại từ trước — cột cũ được giữ nguyên qua
  // rebuild ở trên, ADD COLUMN này chỉ còn tác dụng khi CREATE TABLE IF NOT EXISTS không chạy vì
  // bảng cũ dạng pre-Lát-4 vẫn còn — trường hợp thật do db-migrations.ts xử lý trước khi tới đây).
  const ptaColumns = db.prepare('PRAGMA table_info(project_task_assignments)').all() as { name: string }[];
  if (!ptaColumns.some((c) => c.name === 'tien_do')) {
    db.exec('ALTER TABLE project_task_assignments ADD COLUMN tien_do INTEGER NOT NULL DEFAULT 0');
  }
}
