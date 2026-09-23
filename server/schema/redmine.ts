import type { DatabaseSync } from 'node:sqlite';

// CR-20260913 Lát 5 (§6.3, FR-33) — công ty chỉ có MỘT Redmine, URL vẫn ở `app_settings.redmine_base_url`
// (key-value đã chạy thật, KHÔNG nằm ở app_config — bản CR cũ ghi nhầm, đã sửa 19/09, Council 74715c65).
// Mỗi người tự nhập API key riêng của mình — không còn khoá dùng chung. Không `team_id` (1 khoá dùng ở
// mọi team), không `row_version` (chỉ chính User ghi secret của mình, không có kịch bản 2 người cùng sửa).
export function applyRedmineSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_redmine_config (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      api_key_ciphertext TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
