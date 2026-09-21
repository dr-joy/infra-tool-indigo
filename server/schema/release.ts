import type { DatabaseSync } from 'node:sqlite';

export function applyReleaseSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS release_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      reply_to_definition_id TEXT
    );

    CREATE TABLE IF NOT EXISTS emergency_release_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      reply_to_definition_id TEXT
    );
  `);

  // Nguồn canonical team/hệ thống của 1 đợt khẩn cấp — batch = 1 release_month. Dữ liệu nghiệp vụ
  // thuần (Team/hệ thống ảnh hưởng), không liên quan AI — giữ nguyên.
  db.exec(`
    CREATE TABLE IF NOT EXISTS emergency_release_batches (
      release_month TEXT PRIMARY KEY,
      teams TEXT NOT NULL DEFAULT '[]',
      systems TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
