import type { DatabaseSync } from 'node:sqlite';

// Schema Lát 2 (CR-20260913, FR-1→FR-4a, FR-34) — danh tính, phiên đăng nhập, onboarding, thông báo.
// Thiết kế chốt qua Council run f04dfc02 (xem docs/exchanges/2026-09-21.md).
//
// `teams`/`team_members` ở đây là bản KÉO SỚM tối thiểu (chỉ đủ để chọn/liệt kê team khi onboarding) —
// Lát 3 (Council 1aa7fe8b) sẽ MỞ RỘNG đúng 2 bảng này (thêm cột hiển thị/vai đặc biệt), không tạo lại.
// `team_feature_visibility`/`app_config` KHÔNG kéo sớm vì Lát 2 không cần đọc chúng.
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
  `);
}
