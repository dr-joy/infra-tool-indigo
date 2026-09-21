import type { DatabaseSync } from 'node:sqlite';

// Schema Lát 2+3 (CR-20260913) — danh tính, phiên đăng nhập, onboarding, thông báo (Lát 2, FR-1→FR-4a/
// FR-34), nền phân quyền (Lát 3, FR-6→14/40-42). `teams`/`team_members` được Lát 2 kéo sớm ĐỦ DÙNG
// cho cả Lát 3 (đã có `row_version`/partial unique index 1-Leader từ trước) — Lát 3 chỉ THÊM 3 bảng
// mới (`team_feature_visibility`, `app_config`, `audit_log`), không cần `ALTER TABLE` lên 2 bảng đó lần
// này (đối chiếu qua Council `f0a0e1bb`, review run `e8d20dc3` — sửa lại comment cho đúng thực tế, dự
// định ban đầu có tính thêm cột `joined_at` nhưng không route nào cần nên đã bỏ). Thiết kế chốt qua
// Council `f04dfc02` (Lát 2) và `1aa7fe8b` + `f0a0e1bb` (Lát 3) — xem docs/exchanges/2026-09-19.md và
// 2026-09-21.md.
export function applyAuthSchema(db: DatabaseSync): void {
  db.exec(`
    -- Danh tính: bind theo (issuer, subject) của JWT thật auth.drjoy.vn, KHÔNG bind theo email (email
    -- có thể đổi) — FR-1a.
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
      system_role TEXT NOT NULL DEFAULT 'user' CHECK (system_role IN ('user', 'admin')),
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      UNIQUE (issuer, subject)
    );

    -- refresh_token của auth.drjoy.vn (secret bên thứ ba) — mã hoá bằng maHoa()/giaiMa() (server/lib/secret.ts)
    -- trước khi lưu. Dùng để định kỳ đồng bộ lại display_name/avatar (chốt 21/09: đồng bộ mỗi lần đăng nhập
    -- lại, không cần cron nội bộ).
    CREATE TABLE IF NOT EXISTS user_identity_tokens (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_ciphertext TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Phiên riêng của app (KHÁC hẳn token của auth.drjoy.vn) — FR-4. Chỉ lưu hash của giá trị cookie,
    -- không lưu giá trị thật -> lộ DB không lộ được cookie đang hiệu lực.
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);

    -- Bản tối thiểu kéo sớm từ Lát 3, chỉ đủ cho màn "Chọn team" lúc onboarding (FR-2/FR-3a).
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    -- Bản tối thiểu kéo sớm từ Lát 3. Tối đa 1 Leader/team (FR-6) — CHECK không kiểm được số dòng khác
    -- trong bảng nên dùng partial unique index, không dùng CHECK.
    CREATE TABLE IF NOT EXISTS team_members (
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('leader', 'member')),
      PRIMARY KEY (team_id, user_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_one_leader
      ON team_members(team_id) WHERE role = 'leader';
    CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

    -- Yêu cầu tham gia team lúc onboarding (FR-2/FR-3/FR-3a). approved_team_id/approved_role tách khỏi
    -- yêu cầu gốc vì Admin có thể sửa lại lúc duyệt. Một user chỉ có đúng 1 đơn đang chờ.
    CREATE TABLE IF NOT EXISTS join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_team_id INTEGER NOT NULL REFERENCES teams(id),
      requested_role TEXT NOT NULL CHECK (requested_role IN ('leader', 'member')),
      approved_team_id INTEGER REFERENCES teams(id),
      approved_role TEXT CHECK (approved_role IN ('leader', 'member')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_one_pending
      ON join_requests(user_id) WHERE status = 'pending';

    -- Thông báo trong app (FR-34) — kênh duy nhất, không email/Telegram.
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id, created_at);

    -- Lát 3 (FR-7/FR-7a) — tầng 2 "hiển thị", đúng 2 mức off/on (bản 13/09 có 4 mức đã bị thay hoàn
    -- toàn, không tái tạo ngầm). Seed đủ 5 dòng off khi tạo team (fail-closed) — xem seedTeamFeatureVisibility.
    CREATE TABLE IF NOT EXISTS team_feature_visibility (
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      feature TEXT NOT NULL CHECK (feature IN ('personal_task', 'project', 'weekly_report', 'release', 'mind_map')),
      level TEXT NOT NULL DEFAULT 'off' CHECK (level IN ('off', 'on')),
      updated_at TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      row_version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (team_id, feature)
    );

    -- Lát 3 — singleton cấu hình hệ thống. CHỈ 1 cột nghiệp vụ (release_coordinator_team_id, cần FK
    -- thật tới teams.id) — KHÔNG đặt redmine_base_url (giữ ở app_settings key-value đang chạy thật) và
    -- KHÔNG đặt admin_bootstrap_email (biến môi trường, đúng FR-1a) để tránh 2 nguồn có thể lệch nhau.
    CREATE TABLE IF NOT EXISTS app_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      release_coordinator_team_id INTEGER REFERENCES teams(id),
      updated_at TEXT NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );

    -- Lát 3 (FR-11a/FR-19, kéo sớm từ Lát 4) — payload LUÔN đầy đủ, lọc field cho projection Admin/
    -- Leader làm ở tầng đọc (2 hàm projection), không tách 2 bảng. Hành động chạm 2 team ghi 2 dòng
    -- khác team_id, không thêm cột secondary_team_id.
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      team_id INTEGER REFERENCES teams(id),
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_team_created ON audit_log(team_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
  `);

  // Seed singleton app_config (id=1) — code không bao giờ phải xử lý "chưa có config".
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO app_config (id, release_coordinator_team_id, updated_at) VALUES (1, NULL, ?)').run(now);

  // Backfill team_feature_visibility cho team đã tồn tại trước khi bảng này có mặt (an toàn chạy lại
  // nhiều lần — INSERT OR IGNORE). Team tạo MỚI sau khi có bảng này được seed ngay trong route tạo team
  // (cùng transaction), không đi qua đường backfill này.
  const teamIds = db.prepare('SELECT id FROM teams').all() as { id: number }[];
  const insertVisibility = db.prepare(`
    INSERT OR IGNORE INTO team_feature_visibility (team_id, feature, level, updated_at) VALUES (?, ?, 'off', ?)
  `);
  for (const team of teamIds) {
    for (const feature of ['personal_task', 'project', 'weekly_report', 'release', 'mind_map']) {
      insertVisibility.run(team.id, feature, now);
    }
  }
}
