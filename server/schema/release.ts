import type { DatabaseSync } from 'node:sqlite';

export function applyReleaseSchema(db: DatabaseSync): void {
  // CR-20260913 Lát 6 (§6.3, "Sửa 4 bảng release đã có"): 4 bảng dưới đây thêm owner_user_id (mỗi
  // template/định nghĩa thuộc đúng 1 User, không chia sẻ) + row_version + created_at/updated_at +
  // created_by/updated_by.
  //
  // `owner_user_id` để NULLABLE ở tầng DB (khác chữ "NOT NULL sau di trú" viết trong CR) — quyết định
  // KỸ THUẬT có chủ đích, đồng dạng với MỌI cột owner_user_id khác đã có trong repo
  // (tasks.owner_user_id, mindmaps.owner_user_id, projects.responsible_user_id — server/db-migrations.ts
  // runSlice4Migrations): sở hữu được ép ở tầng route/authorize() (policyKind 'personal_task'), không ép
  // bằng NOT NULL ở DB. Lý do bắt buộc phải nullable: applyReleaseSchema() chạy TRƯỚC KHI có bất kỳ User
  // nào tồn tại trên một DB rỗng mới tinh (bootstrapDatabase() gọi applyAuthSchema RỒI mới applyReleaseSchema,
  // nhưng chưa có dòng users nào ở bước tạo bảng) — và runSeed() (server/db-seed.ts) chèn ngay bộ
  // template/definition MẶC ĐỊNH (dùng chung toàn app từ thời desktop 1 user) vào các bảng này lúc bootstrap,
  // không gắn với User cụ thể nào. Ép NOT NULL ở DDL sẽ làm vỡ seed này trên MỌI DB mới (kể cả toàn bộ test
  // suite). Dữ liệu owner_user_id=NULL đơn giản không hiện cho ai qua policyKind 'personal_task'
  // (route luôn so `owner_user_id = actor.userId`) — đúng nguyên tắc "mỗi User mới tự tạo bộ của mình
  // từ đầu, không tự chia sẻ dữ liệu cũ" đã chốt trong CR.
  db.exec(`
    CREATE TABLE IF NOT EXISTS release_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      owner_user_id INTEGER REFERENCES users(id),
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS release_task_definitions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL,
      date_token TEXT NOT NULL,
      template_id TEXT,
      task_links TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      reply_to_definition_id TEXT,
      owner_user_id INTEGER REFERENCES users(id),
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS emergency_release_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      owner_user_id INTEGER REFERENCES users(id),
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS emergency_release_task_definitions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      task_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      immediate_priority INTEGER,
      relative_offset_minutes INTEGER,
      schedule_mode TEXT,
      template_id TEXT,
      task_links TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      reply_to_definition_id TEXT,
      owner_user_id INTEGER REFERENCES users(id),
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id)
    );
  `);

  // Nguồn canonical team/hệ thống của 1 đợt khẩn cấp — batch = 1 release_month. Dữ liệu nghiệp vụ
  // thuần (Team/hệ thống ảnh hưởng), không liên quan AI — giữ nguyên. Bảng này CHỈ ĐỌC làm lịch sử kể
  // từ Lát 6 (CR §6.3): thay bằng release_cycles/team_release_registrations bên dưới, không map nhãn
  // team cũ (chuỗi tự do) sang team_id nào — đúng tiền lệ di trú "giữ nguyên, báo cáo cho Leader" của
  // Lát 4.
  db.exec(`
    CREATE TABLE IF NOT EXISTS emergency_release_batches (
      release_month TEXT PRIMARY KEY,
      teams TEXT NOT NULL DEFAULT '[]',
      systems TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // ── Lát 6 (CR §6.3 "Bảng mới") — Release nhiều team ──────────────────────────────────────────
  db.exec(`
    -- Đợt release — khẩn cấp (release_key = 'emergency:YYYY-MM-DD', tự tìm-hoặc-tạo, không ai chủ
    -- động "mở đợt") hoặc định kỳ (1 dòng "đang mở" do Leader team điều phối ấn định regular_release_date,
    -- CHO PHÉP nhiều dòng kind='regular' status='open' song song — FR-23b/§6.3 vòng làm rõ thứ 4).
    CREATE TABLE IF NOT EXISTS release_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      release_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('emergency', 'regular')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      locked_at TEXT,
      locked_by INTEGER REFERENCES users(id),
      regular_release_date TEXT,
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id)
    );

    -- Đăng ký lịch release KHẨN CẤP của 1 team trong 1 đợt (FR-23a) — CHỈ áp dụng cycle kind='emergency'
    -- (ép bằng trigger bên dưới, SQLite CHECK không so được với bảng khác). deploy_demo_at LUÔN tự tính
    -- = 16:00 cùng ngày release_at (chốt 19/09 lần 3) — lưu thành cột thật, không suy diễn lúc đọc.
    CREATE TABLE IF NOT EXISTS team_release_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle_id INTEGER NOT NULL REFERENCES release_cycles(id),
      team_id INTEGER NOT NULL REFERENCES teams(id),
      deploy_staging_at TEXT NOT NULL,
      release_at TEXT NOT NULL,
      deploy_demo_at TEXT NOT NULL,
      affected_systems TEXT NOT NULL DEFAULT '[]',
      platforms TEXT NOT NULL DEFAULT '[]',
      ticket_numbers TEXT NOT NULL DEFAULT '[]',
      japan_coordination_link TEXT,
      no_japan_coordination_reason TEXT,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'locked', 'cancelled')),
      row_version INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (cycle_id, team_id),
      CHECK ((japan_coordination_link IS NOT NULL) + (no_japan_coordination_reason IS NOT NULL) = 1)
    );
    CREATE INDEX IF NOT EXISTS idx_team_release_registrations_cycle ON team_release_registrations(cycle_id);
    CREATE INDEX IF NOT EXISTS idx_team_release_registrations_team ON team_release_registrations(team_id);

    CREATE TRIGGER IF NOT EXISTS trg_team_release_registrations_only_emergency
    BEFORE INSERT ON team_release_registrations
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'team_release_registrations chi ap dung cho release_cycles kind=emergency')
      WHERE NOT EXISTS (SELECT 1 FROM release_cycles WHERE id = NEW.cycle_id AND kind = 'emergency');
    END;

    -- Xung đột giữa 2 đăng ký CÙNG cycle (FR-25) — chỉ so release_at/deploy_staging_at, không so
    -- hệ thống/nền tảng/ticket/ghi chú/link Nhật. Partial unique index chặn tạo 2 dòng 'open' trùng cặp.
    CREATE TABLE IF NOT EXISTS release_schedule_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle_id INTEGER NOT NULL REFERENCES release_cycles(id),
      registration_a_id INTEGER NOT NULL REFERENCES team_release_registrations(id),
      registration_b_id INTEGER NOT NULL REFERENCES team_release_registrations(id),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'forced')),
      detected_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by INTEGER REFERENCES users(id),
      CHECK (registration_a_id < registration_b_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_release_conflicts_open_pair
      ON release_schedule_conflicts(registration_a_id, registration_b_id) WHERE status = 'open';
    CREATE INDEX IF NOT EXISTS idx_release_conflicts_cycle ON release_schedule_conflicts(cycle_id);

    -- Yêu cầu mở khoá/huỷ (FR-26/FR-27) — "Khoá lịch" cấp cả cycle KHÔNG qua bảng này (route riêng, set
    -- status='locked' hàng loạt trên team_release_registrations).
    CREATE TABLE IF NOT EXISTS release_unlock_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL REFERENCES team_release_registrations(id),
      kind TEXT NOT NULL CHECK (kind IN ('edit', 'cancel')),
      reason TEXT NOT NULL,
      registration_version_requested INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_release_unlock_requests_registration ON release_unlock_requests(registration_id);

    -- FR-28a — Admin bật/tắt riêng cho từng team "Tab cá nhân" (chỉ có tác dụng khi Task cá nhân đang
    -- Bật cho đúng team đó, FR-7 — route tự kiểm điều kiện này, không lưu ở bảng này). Mặc định Tắt.
    CREATE TABLE IF NOT EXISTS team_release_task_autogen_settings (
      team_id INTEGER PRIMARY KEY REFERENCES teams(id),
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      row_version INTEGER NOT NULL DEFAULT 1
    );
  `);
}
