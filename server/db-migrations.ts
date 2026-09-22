import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

// Migration lịch sử, tách khỏi server/db.ts (kế hoạch Council run 022dd1e5, xem
// docs/exchanges/2026-09-12.md) — giữ NGUYÊN VĂN nội dung và thứ tự thực thi. Tách theo TRỤC
// LOẠI (migration một-lần), không theo tính năng: nhiều đoạn có ràng buộc thứ tự tường minh
// (vd dòng "phải chạy TRƯỚC khi tạo index", "đặt sau các block rebuild bảng tasks" trong comment
// gốc) — tách theo tính năng có nguy cơ đảo thứ tự thực thi mà không ai chủ động nhận ra.
//
// `context` cung cấp phụ thuộc ngoài DB (dataDir, withTransaction) — KHÔNG import ngược singleton
// `db` từ server/db.ts để tránh vòng import lúc bootstrap; db.ts truyền `db` và `context` vào khi gọi.
export interface DbMigrationContext {
  dataDir: string;
  withTransaction: <T>(fn: () => T) => T;
}

export function runLegacyMigrations(db: DatabaseSync, context: DbMigrationContext): void {
  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
  if (!taskColumns.some((c) => c.name === 'gio_ket_thuc')) db.exec('ALTER TABLE tasks ADD COLUMN gio_ket_thuc TEXT');
  if (!taskColumns.some((c) => c.name === 'ngay_cu_the')) db.exec('ALTER TABLE tasks ADD COLUMN ngay_cu_the TEXT');
  if (!taskColumns.some((c) => c.name === 'release_month')) db.exec('ALTER TABLE tasks ADD COLUMN release_month TEXT');
  if (!taskColumns.some((c) => c.name === 'release_date')) db.exec('ALTER TABLE tasks ADD COLUMN release_date TEXT');
  if (!taskColumns.some((c) => c.name === 'task_links')) db.exec("ALTER TABLE tasks ADD COLUMN task_links TEXT NOT NULL DEFAULT '[]'");

  const releaseTaskDefColumns = db.prepare('PRAGMA table_info(release_task_definitions)').all() as { name: string }[];
  if (!releaseTaskDefColumns.some((c) => c.name === 'task_links')) {
    db.exec("ALTER TABLE release_task_definitions ADD COLUMN task_links TEXT NOT NULL DEFAULT '[]'");
  }

  const emergencyDefColumns = db.prepare('PRAGMA table_info(emergency_release_task_definitions)').all() as { name: string }[];
  if (!emergencyDefColumns.some((c) => c.name === 'task_links')) db.exec("ALTER TABLE emergency_release_task_definitions ADD COLUMN task_links TEXT NOT NULL DEFAULT '[]'");
  if (!emergencyDefColumns.some((c) => c.name === 'immediate_priority')) db.exec('ALTER TABLE emergency_release_task_definitions ADD COLUMN immediate_priority INTEGER');
  if (!emergencyDefColumns.some((c) => c.name === 'relative_offset_minutes')) db.exec('ALTER TABLE emergency_release_task_definitions ADD COLUMN relative_offset_minutes INTEGER');
  if (!emergencyDefColumns.some((c) => c.name === 'schedule_mode')) db.exec('ALTER TABLE emergency_release_task_definitions ADD COLUMN schedule_mode TEXT');

  const projectColumns = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[];
  if (!projectColumns.some((c) => c.name === 'sort_order')) {
    db.exec('ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    const existingProjects = db.prepare('SELECT id FROM projects ORDER BY id DESC').all() as { id: number }[];
    const updateProjectOrder = db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?');
    existingProjects.forEach((project, index) => updateProjectOrder.run(index + 1, project.id));
  }
  if (!projectColumns.some((c) => c.name === 'closed_at')) db.exec('ALTER TABLE projects ADD COLUMN closed_at TEXT');
  if (!projectColumns.some((c) => c.name === 'pending_at')) db.exec('ALTER TABLE projects ADD COLUMN pending_at TEXT');
  if (!projectColumns.some((c) => c.name === 'is_system')) db.exec('ALTER TABLE projects ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0');

  // PIC: thêm cột màu hiển thị trên Gantt + gán màu mặc định cho PIC chưa có
  const picColumns = db.prepare('PRAGMA table_info(pics)').all() as { name: string }[];
  if (picColumns.length > 0 && !picColumns.some((c) => c.name === 'color')) {
    db.exec('ALTER TABLE pics ADD COLUMN color TEXT');
  }
  const defaultPicPalette = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#78716c'];
  const picsNoColor = db.prepare('SELECT id FROM pics WHERE color IS NULL OR color = \'\' ORDER BY sort_order ASC, id ASC').all() as { id: number }[];
  if (picsNoColor.length > 0) {
    const usedCount = (db.prepare("SELECT COUNT(*) c FROM pics WHERE color IS NOT NULL AND color <> ''").get() as { c: number }).c;
    const updColor = db.prepare('UPDATE pics SET color = ? WHERE id = ?');
    picsNoColor.forEach((p, i) => updColor.run(defaultPicPalette[(usedCount + i) % defaultPicPalette.length], p.id));
  }

  const weeklyGoalColumns = db.prepare('PRAGMA table_info(weekly_goals)').all() as { name: string }[];
  if (weeklyGoalColumns.length > 0 && !weeklyGoalColumns.some((c) => c.name === 'target_progress')) {
    db.exec('ALTER TABLE weekly_goals ADD COLUMN target_progress INTEGER');
  }
  if (weeklyGoalColumns.length > 0 && !weeklyGoalColumns.some((c) => c.name === 'start_progress')) {
    db.exec('ALTER TABLE weekly_goals ADD COLUMN start_progress INTEGER');
  }
  if (weeklyGoalColumns.length > 0 && !weeklyGoalColumns.some((c) => c.name === 'manual_done')) {
    db.exec('ALTER TABLE weekly_goals ADD COLUMN manual_done INTEGER');
  }

  const projectTaskColumns = db.prepare('PRAGMA table_info(project_tasks)').all() as { name: string }[];
  if (!projectTaskColumns.some((c) => c.name === 'assignee')) db.exec('ALTER TABLE project_tasks ADD COLUMN assignee TEXT');
  if (!projectTaskColumns.some((c) => c.name === 'ghi_chu')) db.exec("ALTER TABLE project_tasks ADD COLUMN ghi_chu TEXT NOT NULL DEFAULT ''");
  if (!projectTaskColumns.some((c) => c.name === 'task_links')) db.exec("ALTER TABLE project_tasks ADD COLUMN task_links TEXT NOT NULL DEFAULT '[]'");
  if (!projectTaskColumns.some((c) => c.name === 'sort_order')) {
    db.exec('ALTER TABLE project_tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE project_tasks SET sort_order = id WHERE sort_order = 0');
  }
  if (!projectTaskColumns.some((c) => c.name === 'execution_order')) {
    db.exec('ALTER TABLE project_tasks ADD COLUMN execution_order INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE project_tasks SET execution_order = COALESCE(NULLIF(sort_order, 0), id) WHERE execution_order = 0');
  }

  const projectTaskTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'project_tasks'").get() as { sql: string } | undefined;
  if (projectTaskTableInfo?.sql.includes('tien_do IN (25, 50, 75, 100)')) {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE project_tasks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        parent_id INTEGER,
        level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
        tieu_de TEXT NOT NULL,
        ghi_chu TEXT NOT NULL DEFAULT '',
        ngay_bat_dau_du_kien TEXT NOT NULL,
        ngay_ket_thuc_du_kien TEXT NOT NULL,
        ngay_bat_dau_thuc_te TEXT,
        ngay_ket_thuc_thuc_te TEXT,
        estimate_hours REAL,
        tien_do INTEGER NOT NULL CHECK (tien_do BETWEEN 0 AND 100),
        task_links TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO project_tasks_new (
        id, project_id, parent_id, level, tieu_de, ghi_chu, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien,
        ngay_bat_dau_thuc_te, ngay_ket_thuc_thuc_te, estimate_hours, tien_do, task_links, sort_order, created_at, updated_at
      )
      SELECT
        id, project_id, parent_id, level, tieu_de, COALESCE(ghi_chu, ''), ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien,
        ngay_bat_dau_thuc_te, ngay_ket_thuc_thuc_te, NULLIF(estimate_hours, 0), tien_do, COALESCE(task_links, '[]'), COALESCE(sort_order, id), created_at, updated_at
      FROM project_tasks;
      DROP TABLE project_tasks;
      ALTER TABLE project_tasks_new RENAME TO project_tasks;
      COMMIT;
    `);
  }

  const projectTaskNullableEstimateInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'project_tasks'").get() as { sql: string } | undefined;
  if (projectTaskNullableEstimateInfo?.sql.includes('estimate_hours REAL NOT NULL')) {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE project_tasks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        parent_id INTEGER,
        level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
        tieu_de TEXT NOT NULL,
        ghi_chu TEXT NOT NULL DEFAULT '',
        ngay_bat_dau_du_kien TEXT NOT NULL,
        ngay_ket_thuc_du_kien TEXT NOT NULL,
        ngay_bat_dau_thuc_te TEXT,
        ngay_ket_thuc_thuc_te TEXT,
        estimate_hours REAL,
        tien_do INTEGER NOT NULL CHECK (tien_do BETWEEN 0 AND 100),
        task_links TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO project_tasks_new (
        id, project_id, parent_id, level, tieu_de, ghi_chu, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien,
        ngay_bat_dau_thuc_te, ngay_ket_thuc_thuc_te, estimate_hours, tien_do, task_links, sort_order, created_at, updated_at
      )
      SELECT
        id, project_id, parent_id, level, tieu_de, COALESCE(ghi_chu, ''), ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien,
        ngay_bat_dau_thuc_te, ngay_ket_thuc_thuc_te, NULLIF(estimate_hours, 0), tien_do, COALESCE(task_links, '[]'), COALESCE(sort_order, id), created_at, updated_at
      FROM project_tasks;
      DROP TABLE project_tasks;
      ALTER TABLE project_tasks_new RENAME TO project_tasks;
      COMMIT;
    `);
  }

  // Bỏ lý do chung theo project: đã thay bằng đánh giá/lý do theo từng task (weekly_task_evaluations).
  db.exec('DROP TABLE IF EXISTS weekly_project_reasons');

  // Bỏ trường ngày thực tế: không còn dùng trên toàn hệ thống (PIC hiển thị thay vị trí này).
  const projectTaskColumnsAfterRebuild = db.prepare('PRAGMA table_info(project_tasks)').all() as { name: string }[];
  if (projectTaskColumnsAfterRebuild.some((c) => c.name === 'ngay_bat_dau_thuc_te')) {
    db.exec('ALTER TABLE project_tasks DROP COLUMN ngay_bat_dau_thuc_te');
  }
  if (projectTaskColumnsAfterRebuild.some((c) => c.name === 'ngay_ket_thuc_thuc_te')) {
    db.exec('ALTER TABLE project_tasks DROP COLUMN ngay_ket_thuc_thuc_te');
  }
  const projectTaskColumnsAfterDrop = db.prepare('PRAGMA table_info(project_tasks)').all() as { name: string }[];
  if (!projectTaskColumnsAfterDrop.some((c) => c.name === 'execution_order')) {
    db.exec('ALTER TABLE project_tasks ADD COLUMN execution_order INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE project_tasks SET execution_order = COALESCE(NULLIF(sort_order, 0), id) WHERE execution_order = 0');
  }

  // ── Data migrations ───────────────────────────────────────────────────────────

  db.exec("UPDATE emergency_release_task_definitions SET task_date = 'hotfix' WHERE task_date = 'today'");
  db.exec(`UPDATE emergency_release_task_definitions SET title = REPLACE(title, 'kênh RD', 'kênh 研究開発部') WHERE title LIKE '%kênh RD%'`);
  db.exec(`UPDATE tasks SET ten_task = REPLACE(ten_task, 'kênh RD', 'kênh 研究開発部') WHERE ten_task LIKE '%kênh RD%'`);

  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as { sql: string };
  if (!tableInfo.sql.includes("'canceled'")) {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE tasks_new (
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
      INSERT INTO tasks_new (
        id, ten_task, ghi_chu, loai_task, do_uu_tien, trang_thai, ngay_tao, ngay_hoan_thanh,
        gio_bat_dau, gio_ket_thuc, lap_lai_kieu, ngay_trong_thang, thu_trong_tuan, ngay_cu_the, release_month, release_date, task_links
      )
      SELECT
        id, ten_task, ghi_chu, loai_task, do_uu_tien, trang_thai, ngay_tao, ngay_hoan_thanh,
        gio_bat_dau, gio_ket_thuc, lap_lai_kieu, ngay_trong_thang, thu_trong_tuan, ngay_cu_the, release_month, release_date, task_links
      FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      COMMIT;
    `);
  }

  function themCotReplyToDefinitionId(bang: string) {
    const cols = db.prepare(`PRAGMA table_info(${bang})`).all() as { name: string }[];
    if (cols.length === 0) return;
    if (!cols.some((c) => c.name === 'reply_to_definition_id')) {
      db.exec(`ALTER TABLE ${bang} ADD COLUMN reply_to_definition_id TEXT`);
    }
  }
  themCotReplyToDefinitionId('release_task_definitions');
  themCotReplyToDefinitionId('emergency_release_task_definitions');

  function backfillReplyToDefinitionId(bang: string) {
    const cols = (db.prepare(`PRAGMA table_info(${bang})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('related_ids') || !cols.includes('reply_to_definition_id')) return;
    const rows = db.prepare(`SELECT id, related_ids, reply_to_definition_id FROM ${bang}`).all() as
      { id: string; related_ids: string | null; reply_to_definition_id: string | null }[];
    const idSet = new Set(rows.map((r) => r.id));
    const update = db.prepare(`UPDATE ${bang} SET reply_to_definition_id = ? WHERE id = ?`);
    let soKhongMapDuoc = 0;
    for (const row of rows) {
      if (row.reply_to_definition_id) continue; // đã có giá trị -> không ghi đè
      let candidate: string | null = null;
      try {
        const parsed = JSON.parse(row.related_ids || '[]');
        if (Array.isArray(parsed)) {
          for (const v of parsed) {
            const s = String(v ?? '').trim();
            if (s) { candidate = s; break; }
          }
        }
      } catch { /* JSON hỏng -> candidate giữ null, coi như không map được */ }
      if (candidate === row.id) candidate = null; // tự tham chiếu
      if (candidate && !idSet.has(candidate)) candidate = null; // không tồn tại trong cùng bảng (khác loại/đã xoá)
      if (candidate) {
        update.run(candidate, row.id);
      } else if (row.related_ids && row.related_ids !== '[]' && row.related_ids !== 'null') {
        soKhongMapDuoc++;
      }
    }
    if (soKhongMapDuoc > 0) {
      console.log(`[db] Backfill reply_to_definition_id cho ${bang}: ${soKhongMapDuoc} dòng có related_ids nhưng không map được (JSON hỏng/rỗng/tự tham chiếu/definition không tồn tại) -> để NULL. Dữ liệu gốc vẫn được archive nguyên trạng.`);
    }
  }
  backfillReplyToDefinitionId('release_task_definitions');
  backfillReplyToDefinitionId('emergency_release_task_definitions');

  const CAC_COT_TAN_DU_AI_CU = ['action_type', 'ai_note', 'related_ids'];
  function danhSachCotConLaiTanDuAi(table: string): string[] {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    return CAC_COT_TAN_DU_AI_CU.filter((c) => cols.has(c));
  }
  function archiveAndDropTanDuAiCu() {
    const cotTasks = danhSachCotConLaiTanDuAi('tasks');
    const cotReleaseDef = danhSachCotConLaiTanDuAi('release_task_definitions');
    const cotEmergencyDef = danhSachCotConLaiTanDuAi('emergency_release_task_definitions');
    if (cotTasks.length === 0 && cotReleaseDef.length === 0 && cotEmergencyDef.length === 0) return; // đã dọn sạch hoặc DB mới

    const archiveDir = join(context.dataDir, 'archive');
    mkdirSync(archiveDir, { recursive: true });
    const archivedAt = new Date().toISOString();
    const snapshot = {
      archived_at: archivedAt,
      reason: 'Xoa tan du AI automation con sot (actionType/aiNote/relatedIds) - Council run 7fd3e4d1',
      tasks: cotTasks.length === 0 ? [] : db.prepare(`
        SELECT id, ${cotTasks.join(', ')} FROM tasks
        WHERE ${cotTasks.map((c) => `${c} IS NOT NULL`).join(' OR ')}
      `).all(),
      release_task_definitions: cotReleaseDef.length === 0 ? [] : db.prepare(`
        SELECT id, ${cotReleaseDef.join(', ')} FROM release_task_definitions
        WHERE ${cotReleaseDef.map((c) => `${c} IS NOT NULL`).join(' OR ')}
      `).all(),
      emergency_release_task_definitions: cotEmergencyDef.length === 0 ? [] : db.prepare(`
        SELECT id, ${cotEmergencyDef.join(', ')} FROM emergency_release_task_definitions
        WHERE ${cotEmergencyDef.map((c) => `${c} IS NOT NULL`).join(' OR ')}
      `).all()
    };
    const json = JSON.stringify(snapshot, null, 2);
    const checksum = createHash('sha256').update(json).digest('hex');
    const fileBase = `ai-legacy-fields-removed-${archivedAt.replace(/[:.]/g, '-')}`;
    writeFileSync(join(archiveDir, `${fileBase}.json`), json, 'utf8');
    writeFileSync(join(archiveDir, `${fileBase}.sha256`), `${checksum}  ${fileBase}.json\n`, 'utf8');

    context.withTransaction(() => {
      for (const col of cotTasks) db.exec(`ALTER TABLE tasks DROP COLUMN ${col}`);
      for (const col of cotReleaseDef) db.exec(`ALTER TABLE release_task_definitions DROP COLUMN ${col}`);
      for (const col of cotEmergencyDef) db.exec(`ALTER TABLE emergency_release_task_definitions DROP COLUMN ${col}`);
    });
    console.log(`[db] Đã archive + xoá 3 cột tàn dư AI (action_type/ai_note/related_ids) -> ${fileBase}.json (checksum kèm theo)`);
  }
  archiveAndDropTanDuAiCu();

  function themCotOriginRef() {
    const cols = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
    if (cols.length === 0) return;
    const add = (name: string, ddl: string) => { if (!cols.some((c) => c.name === name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${ddl}`); };
    add('origin_ref', 'origin_ref TEXT');
    add('reply_to_ref', 'reply_to_ref TEXT');
  }
  themCotOriginRef();

  const AUTOMATION_TASK_COLUMNS = [
    'automation_status', 'automation_preview', 'automation_reasons', 'automation_result',
    'automation_error', 'automation_updated_at', 'automation_question', 'automation_qa_history',
    'automation_occurrence_key', 'origin_kind', 'automation_contract', 'announcement_locale',
    'automation_result_data', 'automation_idempotency_key', 'origin_snapshot_hash', 'automation_recheck_token'
  ];
  const AUTOMATION_DEFINITION_COLUMNS = ['automation_contract', 'announcement_locale'];

  function tableExists(name: string): boolean {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));
  }

  function danhSachCotDangCo(table: string, ungVien: string[]): string[] {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    return ungVien.filter((c) => cols.has(c));
  }

  function archiveAndDropAutomationSchema() {
    const cotTasksDangCo = danhSachCotDangCo('tasks', AUTOMATION_TASK_COLUMNS);
    const cotReleaseDefDangCo = danhSachCotDangCo('release_task_definitions', AUTOMATION_DEFINITION_COLUMNS);
    const cotEmergencyDefDangCo = danhSachCotDangCo('emergency_release_task_definitions', AUTOMATION_DEFINITION_COLUMNS);
    const conBangAutomation = tableExists('automation_events') || tableExists('drjoy_posted_articles');
    const conArtifactNaoKhong =
      cotTasksDangCo.length > 0 || cotReleaseDefDangCo.length > 0 || cotEmergencyDefDangCo.length > 0 || conBangAutomation;
    if (!conArtifactNaoKhong) return; // đã dọn sạch hết hoặc DB mới toanh — không còn gì để archive/drop

    const archiveDir = join(context.dataDir, 'archive');
    mkdirSync(archiveDir, { recursive: true });
    const archivedAt = new Date().toISOString();

    const snapshot = {
      archived_at: archivedAt,
      reason: 'CR-20260912-xoa-ai-automation-tai-cau-truc — xoa hoan toan AI automation',
      tasks: cotTasksDangCo.length === 0 ? [] : db.prepare(`
        SELECT id, ${cotTasksDangCo.join(', ')} FROM tasks
        WHERE ${cotTasksDangCo.map((c) => `${c} IS NOT NULL`).join(' OR ')}
      `).all(),
      release_task_definitions: cotReleaseDefDangCo.length === 0 ? [] : db.prepare(`
        SELECT id, ${cotReleaseDefDangCo.join(', ')} FROM release_task_definitions
        WHERE ${cotReleaseDefDangCo.map((c) => `${c} IS NOT NULL`).join(' OR ')}
      `).all(),
      emergency_release_task_definitions: cotEmergencyDefDangCo.length === 0 ? [] : db.prepare(`
        SELECT id, ${cotEmergencyDefDangCo.join(', ')} FROM emergency_release_task_definitions
        WHERE ${cotEmergencyDefDangCo.map((c) => `${c} IS NOT NULL`).join(' OR ')}
      `).all(),
      automation_events: tableExists('automation_events') ? db.prepare('SELECT * FROM automation_events').all() : [],
      drjoy_posted_articles: tableExists('drjoy_posted_articles') ? db.prepare('SELECT * FROM drjoy_posted_articles').all() : []
    };
    const json = JSON.stringify(snapshot, null, 2);
    const checksum = createHash('sha256').update(json).digest('hex');
    const fileBase = `automation-removed-${archivedAt.replace(/[:.]/g, '-')}`;
    writeFileSync(join(archiveDir, `${fileBase}.json`), json, 'utf8');
    writeFileSync(join(archiveDir, `${fileBase}.sha256`), `${checksum}  ${fileBase}.json\n`, 'utf8');

    context.withTransaction(() => {
      for (const col of cotTasksDangCo) db.exec(`ALTER TABLE tasks DROP COLUMN ${col}`);
      for (const [table, cotDangCo] of [
        ['release_task_definitions', cotReleaseDefDangCo],
        ['emergency_release_task_definitions', cotEmergencyDefDangCo]
      ] as const) {
        for (const col of cotDangCo) db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
      }
      db.exec('DROP TABLE IF EXISTS automation_events');
      db.exec('DROP TABLE IF EXISTS drjoy_posted_articles');
    });
    console.log(`[db] Đã archive + xoá schema AI automation cũ -> ${fileBase}.json (checksum kèm theo)`);
  }
  archiveAndDropAutomationSchema();

  // CR-20260914-xoa-danh-sach-emergency-batch: cột "đã đăng bài" thủ công không còn UI nào dùng sau khi
  // xoá màn "Các đợt release khẩn cấp" — bảng/cột teams/systems VẪN GIỮ (guard mismatch của POST tạo
  // task khẩn cấp còn dùng), chỉ drop riêng `da_dang`.
  function archiveAndDropEmergencyBatchDaDang() {
    if (!tableExists('emergency_release_batches')) return;
    const cols = (db.prepare('PRAGMA table_info(emergency_release_batches)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('da_dang')) return; // đã dọn rồi hoặc DB mới toanh (chưa từng có cột)

    const archiveDir = join(context.dataDir, 'archive');
    mkdirSync(archiveDir, { recursive: true });
    const archivedAt = new Date().toISOString();
    const snapshot = {
      archived_at: archivedAt,
      reason: 'CR-20260914-xoa-danh-sach-emergency-batch — xoa man danh sach + cot da_dang khong con UI dung',
      emergency_release_batches: db.prepare('SELECT release_month, da_dang FROM emergency_release_batches').all()
    };
    const json = JSON.stringify(snapshot, null, 2);
    const checksum = createHash('sha256').update(json).digest('hex');
    const fileBase = `emergency-batch-da-dang-removed-${archivedAt.replace(/[:.]/g, '-')}`;
    writeFileSync(join(archiveDir, `${fileBase}.json`), json, 'utf8');
    writeFileSync(join(archiveDir, `${fileBase}.sha256`), `${checksum}  ${fileBase}.json\n`, 'utf8');

    context.withTransaction(() => {
      db.exec('ALTER TABLE emergency_release_batches DROP COLUMN da_dang');
    });
    console.log(`[db] Đã archive + xoá cột emergency_release_batches.da_dang -> ${fileBase}.json (checksum kèm theo)`);
  }
  archiveAndDropEmergencyBatchDaDang();
}

// ── Lát 4 (CR-20260913 §6.3, Council `76e03307`) — nâng cấp DB thật lên shape nhiều người dùng ──
// Idempotent, bọc transaction theo rules/08. Chạy SAU applyXSchema (bảng đã tồn tại với shape MỚI
// cho DB rỗng) và SAU runLegacyMigrations. Chỉ phần schema/cơ học ở đây — 4 hàm còn lại của hợp
// đồng di trú 7 bước thật (backup, build DB server từ snapshot, gán Dev13/Leader, verify, smoke
// boot) là một script vận hành riêng chạy TAY một lần khi migrate dữ liệu Dev13 thật, không phải
// migration tự động mỗi lần boot — 2 lý do: (1) cần tham số thật (leaderUserId cụ thể) không suy
// được tự động; (2) không được lặp lại ngoài ý muốn trên DB đang có nhiều team thật.

// Helper ADD COLUMN idempotent dùng chung (bắt đầu áp dụng từ Lát 4 — BL-20260818-007, chưa
// retrofit toàn bộ 18 khối cũ trong file này, xem backlog).
function themCotNeuThieu(db: DatabaseSync, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.length === 0) return; // bảng chưa tồn tại (DB rất mới, applyXSchema đã tạo đúng shape)
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// Rebuild vì `pic` đang NOT NULL — không sửa được chỉ bằng ADD COLUMN. Bản thân việc rebuild copy
// nguyên văn `pic` cũ sang `legacy_pic_label` (user_id = NULL) — đúng luôn phần cơ học của bước 5
// migrateLegacyPicLabels cho bảng này, không cần làm lại ở script vận hành riêng.
function rebuildProjectTaskAssignmentsForSlice4(db: DatabaseSync, context: DbMigrationContext): void {
  const cols = (db.prepare('PRAGMA table_info(project_task_assignments)').all() as { name: string }[]).map((c) => c.name);
  if (cols.length === 0) return;
  if (cols.includes('user_id')) return; // đã rebuild rồi (idempotent)

  context.withTransaction(() => {
    db.exec(`
      CREATE TABLE project_task_assignments_new (
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
      INSERT INTO project_task_assignments_new (
        id, project_task_id, user_id, legacy_pic_label, start_date, end_date, estimate_hours, sort_order, tien_do, row_version
      )
      SELECT
        id, project_task_id, NULL, COALESCE(NULLIF(TRIM(pic), ''), '(khong ro)'),
        start_date, end_date, estimate_hours, sort_order, COALESCE(tien_do, 0), 1
      FROM project_task_assignments;
      DROP TABLE project_task_assignments;
      ALTER TABLE project_task_assignments_new RENAME TO project_task_assignments;
      CREATE INDEX IF NOT EXISTS idx_pta_task ON project_task_assignments(project_task_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pta_task_user_unique
        ON project_task_assignments(project_task_id, user_id) WHERE user_id IS NOT NULL;
    `);
  });
  console.log('[db] Lat 4: da rebuild project_task_assignments (pic NOT NULL -> user_id nullable + legacy_pic_label)');
}

// Rebuild vì UNIQUE cũ (week_start,kind,mode) chặn cứng 2 team cùng có báo cáo cùng loại cùng tuần.
function rebuildWeeklyReportHistoryForSlice4(db: DatabaseSync, context: DbMigrationContext): void {
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'weekly_report_history'").get() as { sql: string } | undefined;
  if (!tableInfo) return;
  if (tableInfo.sql.includes('team_id')) return; // đã rebuild rồi (idempotent)

  context.withTransaction(() => {
    db.exec(`
      CREATE TABLE weekly_report_history_new (
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
      INSERT INTO weekly_report_history_new (
        id, week_start, team_id, kind, mode, content, row_version, created_at, updated_at
      )
      SELECT id, week_start, NULL, kind, mode, content, 1, created_at, updated_at
      FROM weekly_report_history;
      DROP TABLE weekly_report_history;
      ALTER TABLE weekly_report_history_new RENAME TO weekly_report_history;
      CREATE INDEX IF NOT EXISTS idx_weekly_report_history_week ON weekly_report_history(week_start);
    `);
  });
  console.log('[db] Lat 4: da rebuild weekly_report_history (UNIQUE them team_id)');
}

export function runSlice4Migrations(db: DatabaseSync, context: DbMigrationContext): void {
  themCotNeuThieu(db, 'projects', 'team_id', 'team_id INTEGER REFERENCES teams(id)');
  themCotNeuThieu(db, 'projects', 'responsible_user_id', 'responsible_user_id INTEGER REFERENCES users(id)');
  themCotNeuThieu(db, 'projects', 'legacy_pic_label', 'legacy_pic_label TEXT');
  themCotNeuThieu(db, 'projects', 'row_version', 'row_version INTEGER NOT NULL DEFAULT 1');

  themCotNeuThieu(db, 'project_tasks', 'team_id', 'team_id INTEGER REFERENCES teams(id)');
  themCotNeuThieu(db, 'project_tasks', 'legacy_pic_label', 'legacy_pic_label TEXT');
  themCotNeuThieu(db, 'project_tasks', 'row_version', 'row_version INTEGER NOT NULL DEFAULT 1');

  themCotNeuThieu(db, 'pics', 'team_id', 'team_id INTEGER REFERENCES teams(id)');

  themCotNeuThieu(db, 'weekly_goals', 'team_id', 'team_id INTEGER REFERENCES teams(id)');
  themCotNeuThieu(db, 'weekly_goals', 'legacy_pic_label', 'legacy_pic_label TEXT');
  themCotNeuThieu(db, 'weekly_goals', 'row_version', 'row_version INTEGER NOT NULL DEFAULT 1');

  themCotNeuThieu(db, 'weekly_task_evaluations', 'team_id', 'team_id INTEGER REFERENCES teams(id)');
  themCotNeuThieu(db, 'weekly_task_evaluations', 'row_version', 'row_version INTEGER NOT NULL DEFAULT 1');

  themCotNeuThieu(db, 'weekly_project_summaries', 'team_id', 'team_id INTEGER REFERENCES teams(id)');
  themCotNeuThieu(db, 'weekly_project_summaries', 'row_version', 'row_version INTEGER NOT NULL DEFAULT 1');

  themCotNeuThieu(db, 'tasks', 'owner_user_id', 'owner_user_id INTEGER REFERENCES users(id)');

  themCotNeuThieu(db, 'mindmaps', 'owner_user_id', 'owner_user_id INTEGER REFERENCES users(id)');
  themCotNeuThieu(db, 'mindmaps', 'visibility', "visibility TEXT NOT NULL DEFAULT 'private'");
  themCotNeuThieu(db, 'mindmaps', 'shared_team_id', 'shared_team_id INTEGER REFERENCES teams(id)');

  // Sao chép NGUYÊN VĂN nhãn PIC/assignee cũ sang legacy_pic_label — không tách chuỗi nhiều tên,
  // không so khớp hoa/thường, không tra pics/users.display_name, không đoán tài khoản (CR §6.3
  // bước 5 migrateLegacyPicLabels — phần cơ học không cần leaderUserId/dev13TeamId nên gộp vào
  // đây, chạy tự động mỗi boot; idempotent vì chỉ điền chỗ còn NULL, không đè giá trị đã có).
  db.exec("UPDATE projects SET legacy_pic_label = pic WHERE legacy_pic_label IS NULL AND pic IS NOT NULL AND TRIM(pic) <> ''");
  db.exec("UPDATE project_tasks SET legacy_pic_label = assignee WHERE legacy_pic_label IS NULL AND assignee IS NOT NULL AND TRIM(assignee) <> ''");
  db.exec("UPDATE weekly_goals SET legacy_pic_label = assignee WHERE legacy_pic_label IS NULL AND assignee IS NOT NULL AND TRIM(assignee) <> ''");

  rebuildProjectTaskAssignmentsForSlice4(db, context);
  rebuildWeeklyReportHistoryForSlice4(db, context);

  // ── Index/trigger tham chiếu cột MỚI — đặt Ở ĐÂY, không phải schema/project.ts ────────────────
  // Lý do (tự bắt được trước khi chạm DB Dev13 thật): applyProjectSchema() chạy TRƯỚC các ALTER
  // COLUMN phía trên. Trên DB thật đã tồn tại (bảng cũ, CREATE TABLE IF NOT EXISTS chỉ no-op),
  // bất kỳ INDEX/TRIGGER nào tạo cùng lúc mà tham chiếu team_id/user_id sẽ CRASH ngay lúc CREATE —
  // SQLite validate cột tồn tại lúc tạo, không đợi lúc dùng. Đặt ở đây (sau khi mọi ADD COLUMN +
  // rebuild phía trên đã chạy) đảm bảo cột luôn tồn tại trước khi các CREATE ... IF NOT EXISTS này
  // chạy, đúng cho cả DB mới tinh lẫn DB thật đang nâng cấp.
  db.exec(`
    -- Đúng 1 project hệ thống "Khác" mỗi team (trước Lát 4 là 1 bản ghi toàn app).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_system_per_team ON projects(team_id) WHERE is_system = 1;

    -- Mỗi User đúng 1 khoảng trên 1 task (không cấm nhiều User chồng lấn nhau trên cùng task) —
    -- chỉ áp cho dòng đã có User thật, dòng nhãn cũ (user_id NULL) không giới hạn số lượng.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pta_task_user_unique
      ON project_task_assignments(project_task_id, user_id) WHERE user_id IS NOT NULL;
  `);

  // Trigger 2 chiều (CR §6.3 Lát 4): authorize() của Lát 3 đọc team_id THẲNG trên resource — lệch
  // team_id giữa project_tasks và projects cha là rò dữ liệu chéo team, không phải lỗi hiển thị
  // thường, nên khoá cứng ở tầng DB, không chỉ trông chờ kỷ luật route.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_project_tasks_team_match_insert
    BEFORE INSERT ON project_tasks
    FOR EACH ROW WHEN NEW.team_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'project_tasks.team_id phai khop projects.team_id cua project cha')
      WHERE NOT EXISTS (
        SELECT 1 FROM projects WHERE id = NEW.project_id AND team_id IS NEW.team_id
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_project_tasks_team_match_update
    BEFORE UPDATE OF project_id, team_id ON project_tasks
    FOR EACH ROW WHEN NEW.team_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'project_tasks.team_id phai khop projects.team_id cua project cha')
      WHERE NOT EXISTS (
        SELECT 1 FROM projects WHERE id = NEW.project_id AND team_id IS NEW.team_id
      );
    END;

    -- CHỈ chặn khi đã có task mang team_id THẬT SỰ KHÁC giá trị mới — task còn team_id NULL (chưa
    -- backfill) không tính. Nếu chặn cả trường hợp NULL, chính bước di trú Lát 4 (set
    -- projects.team_id = Dev13 LẦN ĐẦU cho project vốn đã có sẵn task ở DB thật) sẽ tự khoá chính
    -- nó — dữ liệu Dev13 thật luôn có task trước khi có khái niệm team_id.
    CREATE TRIGGER IF NOT EXISTS trg_projects_team_locked_once_has_tasks
    BEFORE UPDATE OF team_id ON projects
    FOR EACH ROW WHEN NEW.team_id IS NOT OLD.team_id
    BEGIN
      SELECT RAISE(ABORT, 'khong doi team_id: da co task voi team_id khac')
      WHERE EXISTS (
        SELECT 1 FROM project_tasks
        WHERE project_id = OLD.id AND team_id IS NOT NULL AND team_id IS NOT NEW.team_id
      );
    END;
  `);
}

// ── Sửa execution_order bị backfill sai ─────────────────────────────────────────
// Bản cũ backfill execution_order = sort_order (theo từng nhóm anh em) nên giá trị
// trùng lặp toàn cục: "con đầu" của mọi task cha đều = 1, "con thứ 2" đều = 2...
// Gantt chỉ hiển thị task LÁ và sắp xếp toàn cục theo execution_order -> các task
// thuộc các phase khác nhau bị trộn lẫn (lộn xộn so với thứ tự cây trước đây).
// Tính lại execution_order theo thứ tự duyệt cây (DFS, theo sort_order rồi id) cho
// từng project -> mặc định khớp đúng thứ tự hiển thị cũ. Chạy một lần (user_version).
export function runVersionedMigrations(db: DatabaseSync, context: DbMigrationContext): void {
  const EXECUTION_ORDER_FIX_VERSION = 1;
  const dbUserVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (dbUserVersion < EXECUTION_ORDER_FIX_VERSION) {
    type ExecOrderRow = { id: number; project_id: number; parent_id: number | null; sort_order: number };
    const execRows = db
      .prepare('SELECT id, project_id, parent_id, sort_order FROM project_tasks')
      .all() as ExecOrderRow[];

    const rowsByProject = new Map<number, ExecOrderRow[]>();
    for (const row of execRows) {
      const list = rowsByProject.get(row.project_id);
      if (list) list.push(row);
      else rowsByProject.set(row.project_id, [row]);
    }

    const updateExecOrder = db.prepare('UPDATE project_tasks SET execution_order = ? WHERE id = ?');
    context.withTransaction(() => {
      for (const rows of rowsByProject.values()) {
        const childrenOf = new Map<number | null, ExecOrderRow[]>();
        for (const row of rows) {
          const key = row.parent_id ?? null;
          const arr = childrenOf.get(key);
          if (arr) arr.push(row);
          else childrenOf.set(key, [row]);
        }
        for (const arr of childrenOf.values()) {
          arr.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
        }
        const assigned = new Set<number>();
        let seq = 0;
        const walk = (parentKey: number | null) => {
          for (const node of childrenOf.get(parentKey) ?? []) {
            if (assigned.has(node.id)) continue; // chống vòng lặp
            assigned.add(node.id);
            updateExecOrder.run(++seq, node.id);
            walk(node.id);
          }
        };
        walk(null);
        // Task mồ côi (parent không thuộc project / không tới được từ gốc): xếp cuối theo sort_order.
        for (const row of [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)) {
          if (!assigned.has(row.id)) {
            assigned.add(row.id);
            updateExecOrder.run(++seq, row.id);
          }
        }
      }
    });
    db.exec(`PRAGMA user_version = ${EXECUTION_ORDER_FIX_VERSION}`);
  }
}
