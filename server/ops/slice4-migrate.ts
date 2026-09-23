// CR-20260913 Lát 4 (§6.3 "Di trú (FR-20)") — hợp đồng 7 hàm di trú dữ liệu Dev13 (PIC/assignee chuỗi
// tự do -> User thật + team_id) từ bản desktop 1-user lên server nhiều team.
//
// ⚠️ ĐÂY LÀ SCRIPT VẬN HÀNH CHẠY TAY MỘT LẦN bởi con người khi di trú dữ liệu Dev13 THẬT — KHÔNG phải
// migration tự động lúc boot (đó là `runSlice4Migrations()` trong server/db-migrations.ts, đã chạy tự
// động mỗi lần server khởi động). Hai lý do tách riêng (đã ghi trong db-migrations.ts):
//   1. Cần tham số thật (`leaderUserId` cụ thể của Dev13) không suy được tự động.
//   2. Không được lặp lại ngoài ý muốn trên DB đang có nhiều team thật (bước 4 gán scope Dev13 chỉ
//      chạy đúng 1 lần cho đúng dữ liệu di trú ban đầu).
//
// Các hàm ở đây KHÔNG được tự ý gọi nhắm vào file DB thật của Dev13 trong bất kỳ agent nào — chỉ viết
// và test bằng DB SQLite tạm. Người vận hành thật sẽ gọi CLI này (server/ops/run-slice4-migrate.mjs,
// nếu được viết) hoặc import trực tiếp bằng script khác, tự cung cấp đường dẫn + leaderUserId thật.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
// Import từ db-bootstrap.js (KHÔNG phải db.js) rất quan trọng: db.js có side-effect cấp module (tự
// mở singleton `db` trỏ vào `dataDir` mặc định của máy đang chạy ngay lúc import) — script vận hành
// này chỉ được đụng tới DB do CHÍNH NGƯỜI GỌI chỉ định qua tham số, không được lỡ tay mở thêm kết nối
// nào khác. Xem comment trong server/db-bootstrap.ts.
import { bootstrapDatabase } from '../db-bootstrap.js';
import type { DbMigrationContext } from '../db-migrations.js';
// Hàm THUẦN (không đụng DB singleton) — dùng lại đúng thuật toán rollup thật server/lib/mappers.ts
// đang dùng lúc runtime (chạy lại rollup trước/sau, so ngày min/max + tổng estimate + % task cha,
// CR §6.3 bước 6), không viết lại thuật toán riêng ở đây (đề bài yêu cầu tái dùng).
import { mapProjectTasksWithCalculatedRollups } from '../lib/mappers.js';

// Bảng cốt lõi dùng để đối chiếu số dòng trước/sau ở bước 1 (backup) và bước 6 (verify) — đúng danh
// sách bảng nghiệp vụ Lát 4 chạm tới (không liệt kê bảng cấu hình/lịch sử de_thi_* vì Luyện đề không
// đổi gì ở Lát 4).
const CORE_TABLES = [
  'projects', 'project_tasks', 'project_task_assignments', 'pics',
  'weekly_goals', 'weekly_task_evaluations', 'weekly_project_summaries', 'weekly_report_history',
  'tasks', 'mindmaps'
] as const;

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function countRowsByTable(db: DatabaseSync, tables: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    counts[table] = tableExists(db, table)
      ? (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
      : 0;
  }
  return counts;
}

// ── Cấu hình "cột canonical" cho bước 6 verifySlice4Migration ───────────────────────────────────
// Với mỗi bảng trong CORE_TABLES: idColumns = khoá định danh 1 dòng (đa số là `id`, riêng
// weekly_task_evaluations/weekly_project_summaries dùng PRIMARY KEY ghép — 2 bảng này KHÔNG có cột
// `id`, xem server/schema/weekly-report.ts); canonicalColumns = các cột ĐÃ TỒN TẠI TRƯỚC Lát 4, phải
// giữ nguyên giá trị qua di trú (CR §6.3 bước 6: "hash nội dung canonical, cột cũ không đổi giá trị").
// CHỦ Ý LOẠI TRỪ khỏi canonicalColumns: mọi cột Lát 4 mới thêm/backfill (team_id, owner_user_id,
// responsible_user_id, legacy_pic_label, visibility/shared_team_id của mindmaps — visibility bị
// COALESCE NULL->'private' nên KHÔNG canonical) và mọi cột row_version (bộ đếm optimistic-lock,
// không phải "nội dung").
//
// ⚠️ project_task_assignments LÀ NGOẠI LỆ, không dùng chung cơ chế generic canonicalRowHashes()/
// idKeySet() theo TÊN CỘT giống hệt như các bảng khác ở trên: đây là bảng DUY NHẤT trong
// CANONICAL_TABLE_CONFIG bị rebuild ĐỔI TÊN CỘT (rebuildProjectTaskAssignmentsForSlice4() trong
// server/db-migrations.ts: cột `pic` NOT NULL của schema Desktop CŨ bị thay bằng CẢ HAI cột
// `user_id` + `legacy_pic_label` ở schema MỚI, copy nguyên công thức
// COALESCE(NULLIF(TRIM(pic), ''), '(khong ro)')). Ý đồ đúng (giá trị phải giữ nguyên giữa nguồn/đích
// vì việc đổi tên chỉ xảy ra 1 LẦN lúc rebuild) không đổi, nhưng KHÔNG được liệt `user_id`/
// `legacy_pic_label` vào canonicalColumns bên dưới rồi để diffCanonicalContent() generic SELECT
// thẳng 2 cột đó từ sourceDb — DB nguồn thật (bản backup Desktop trước di trú) chỉ có cột `pic`,
// KHÔNG có `user_id`/`legacy_pic_label`, SELECT thẳng sẽ ném lỗi SQL "no such column" (bug thật, tìm
// ra ở Council review vòng 3 — run a44549fb-c1aa-421f-8307-4483796c43fd). Cách đúng: entry
// `project_task_assignments` dưới đây VẪN giữ `user_id`/`legacy_pic_label` trong canonicalColumns —
// vì entry này còn được snapshotForIdempotencyCheck() dùng, hàm đó CHỈ chạy trên targetDb (đã có 2
// cột này) nên không sao. Chỉ RIÊNG diffCanonicalContent() (hàm ngay dưới đây, thao tác cả
// sourceDb LẪN targetDb) mới bỏ qua bảng này trong vòng lặp generic — bảng này được so sánh riêng ở
// hàm diffProjectTaskAssignments() (đọc `pic` từ nguồn, tính lại đúng công thức rebuild, so với
// `legacy_pic_label` đích — chỉ ở những dòng đích có user_id IS NULL; các cột không đổi tên vẫn so
// hash bình thường qua canonicalRowHashes() với 1 config riêng, không gồm user_id/legacy_pic_label).
interface CanonicalTableConfig {
  idColumns: readonly string[];
  canonicalColumns: readonly string[];
}

const CANONICAL_TABLE_CONFIG: Record<string, CanonicalTableConfig> = {
  projects: {
    idColumns: ['id'],
    canonicalColumns: ['id', 'ten_project', 'pic', 'ngay_bat_dau', 'sort_order', 'closed_at', 'pending_at', 'is_system', 'created_at', 'updated_at']
  },
  project_tasks: {
    idColumns: ['id'],
    canonicalColumns: ['id', 'project_id', 'parent_id', 'level', 'tieu_de', 'ghi_chu', 'ngay_bat_dau_du_kien', 'ngay_ket_thuc_du_kien', 'estimate_hours', 'tien_do', 'task_links', 'assignee', 'sort_order', 'execution_order', 'created_at', 'updated_at']
  },
  project_task_assignments: {
    idColumns: ['id'],
    canonicalColumns: ['id', 'project_task_id', 'user_id', 'legacy_pic_label', 'start_date', 'end_date', 'estimate_hours', 'sort_order', 'tien_do']
  },
  pics: {
    idColumns: ['id'],
    canonicalColumns: ['id', 'name', 'color', 'sort_order', 'created_at', 'updated_at']
  },
  weekly_goals: {
    idColumns: ['id'],
    canonicalColumns: ['id', 'week_start', 'project_id', 'project_task_id', 'assignee', 'goal_text', 'reason', 'start_progress', 'target_progress', 'manual_done', 'sort_order', 'created_at', 'updated_at']
  },
  weekly_task_evaluations: {
    idColumns: ['week_start', 'project_task_id'],
    canonicalColumns: ['week_start', 'project_task_id', 'status', 'note', 'unplanned']
  },
  weekly_project_summaries: {
    idColumns: ['week_start', 'project_id'],
    canonicalColumns: ['week_start', 'project_id', 'content']
  },
  weekly_report_history: {
    idColumns: ['id'],
    canonicalColumns: ['id', 'week_start', 'kind', 'mode', 'content', 'created_at', 'updated_at']
  },
  tasks: {
    idColumns: ['id'],
    canonicalColumns: ['id', 'ten_task', 'ghi_chu', 'loai_task', 'do_uu_tien', 'trang_thai', 'ngay_tao', 'ngay_hoan_thanh', 'gio_bat_dau', 'gio_ket_thuc', 'lap_lai_kieu', 'ngay_trong_thang', 'thu_trong_tuan', 'ngay_cu_the', 'release_month', 'release_date', 'task_links']
  },
  mindmaps: {
    idColumns: ['id'],
    canonicalColumns: ['id', 'title', 'data', 'created_at', 'updated_at']
  }
};

function rowKey(row: Record<string, unknown>, idColumns: readonly string[]): string {
  return idColumns.map((c) => String(row[c])).join('\u0000');
}

// Tập khoá (id đơn hoặc ghép) hiện có trong bảng — dùng để so TẬP ID trước/sau (CR §6.3 bước 6: "so
// ... tập ID trước/sau từng bảng", khác với so SỐ LƯỢNG — 2 dòng có thể đổi id dù số lượng khớp).
function idKeySet(db: DatabaseSync, table: string, idColumns: readonly string[]): Set<string> {
  if (!tableExists(db, table)) return new Set();
  const rows = db.prepare(`SELECT ${idColumns.join(', ')} FROM ${table}`).all() as Record<string, unknown>[];
  return new Set(rows.map((r) => rowKey(r, idColumns)));
}

// Hash sha256 nội dung các cột canonical, theo từng khoá — phát hiện dòng bị SỬA NỘI DUNG dù id/số
// dòng vẫn khớp (CR §6.3 bước 6: "hash nội dung canonical, cột cũ không đổi giá trị").
function canonicalRowHashes(db: DatabaseSync, table: string, config: CanonicalTableConfig): Map<string, string> {
  const result = new Map<string, string>();
  if (!tableExists(db, table)) return result;
  const columns = [...new Set([...config.idColumns, ...config.canonicalColumns])];
  const rows = db.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all() as Record<string, unknown>[];
  for (const row of rows) {
    const key = rowKey(row, config.idColumns);
    const canonicalValues = config.canonicalColumns.map((c) => row[c]);
    const hash = createHash('sha256').update(JSON.stringify(canonicalValues)).digest('hex');
    result.set(key, hash);
  }
  return result;
}

// So sánh tập ID + hash canonical của TOÀN BỘ CORE_TABLES giữa nguồn/đích, đẩy vấn đề vào `problems`.
// Chỉ báo tối đa 5 ví dụ mỗi loại lỗi mỗi bảng — tránh problems dài hàng nghìn dòng khi lệch lớn (đủ
// để người vận hành biết bảng nào có vấn đề và tự đào sâu, không cần liệt kê hết).
function diffCanonicalContent(sourceDb: DatabaseSync, targetDb: DatabaseSync, problems: string[]): void {
  const MAX_EXAMPLES = 5;
  for (const [table, config] of Object.entries(CANONICAL_TABLE_CONFIG)) {
    // project_task_assignments bị rebuild đổi TÊN CỘT (pic -> user_id + legacy_pic_label) — SELECT
    // thẳng canonicalColumns (có user_id/legacy_pic_label) từ sourceDb sẽ ném lỗi SQL "no such
    // column" vì DB nguồn thật chỉ có cột `pic`. Bỏ qua ở đây, xử lý riêng ở diffProjectTaskAssignments()
    // (xem comment ở CANONICAL_TABLE_CONFIG phía trên) — được gọi thêm trong verifySlice4Migration().
    if (table === 'project_task_assignments') continue;
    const sourceIds = idKeySet(sourceDb, table, config.idColumns);
    const targetIds = idKeySet(targetDb, table, config.idColumns);

    const missingInTarget = [...sourceIds].filter((k) => !targetIds.has(k));
    if (missingInTarget.length > 0) {
      problems.push(`Bảng ${table}: mất ${missingInTarget.length} dòng (có ở nguồn, không còn ở đích) — ví dụ: ${missingInTarget.slice(0, MAX_EXAMPLES).join(', ')}`);
    }
    const addedInTarget = [...targetIds].filter((k) => !sourceIds.has(k));
    if (addedInTarget.length > 0) {
      problems.push(`Bảng ${table}: thừa ${addedInTarget.length} dòng (không có ở nguồn, xuất hiện ở đích) — ví dụ: ${addedInTarget.slice(0, MAX_EXAMPLES).join(', ')}`);
    }

    const sourceHashes = canonicalRowHashes(sourceDb, table, config);
    const targetHashes = canonicalRowHashes(targetDb, table, config);
    const changed: string[] = [];
    for (const [key, sourceHash] of sourceHashes) {
      const targetHash = targetHashes.get(key);
      if (targetHash !== undefined && targetHash !== sourceHash) changed.push(key);
    }
    if (changed.length > 0) {
      problems.push(`Bảng ${table}: ${changed.length} dòng bị đổi nội dung cột cũ (hash canonical lệch) — ví dụ khoá: ${changed.slice(0, MAX_EXAMPLES).join(', ')}`);
    }
  }
}

// Đúng NGUYÊN VĂN công thức SQL rebuildProjectTaskAssignmentsForSlice4() dùng lúc rebuild tự động
// (server/db-migrations.ts): COALESCE(NULLIF(TRIM(pic), ''), '(khong ro)') — TRIM(pic) rỗng (kể cả
// pic toàn khoảng trắng) thì thành nhãn mặc định, khác thì giữ NGUYÊN VĂN bản đã TRIM (không phải
// pic gốc chưa trim).
function expectedLegacyPicLabel(pic: string | null): string {
  const trimmed = (pic ?? '').trim();
  return trimmed === '' ? '(khong ro)' : trimmed;
}

// So sánh RIÊNG cho project_task_assignments — bảng DUY NHẤT trong CANONICAL_TABLE_CONFIG bị rebuild
// đổi TÊN CỘT, không dùng chung được cơ chế generic diffCanonicalContent() (xem 2 comment ở trên).
// Cột id/project_task_id/start_date/end_date/estimate_hours/sort_order/tien_do không đổi tên nên so
// tập ID + hash nội dung như bình thường; riêng pic (nguồn) <-> legacy_pic_label (đích) so bằng công
// thức rebuild thật, CHỈ ở những dòng đích có user_id IS NULL (dòng đã gán User thật thì
// legacy_pic_label là nhãn lịch sử, không bắt buộc còn khớp pic gốc — CR §6.3).
const PTA_TABLE = 'project_task_assignments';
const PTA_SHARED_CONFIG: CanonicalTableConfig = {
  idColumns: ['id'],
  canonicalColumns: ['id', 'project_task_id', 'start_date', 'end_date', 'estimate_hours', 'sort_order', 'tien_do']
};

function diffProjectTaskAssignments(sourceDb: DatabaseSync, targetDb: DatabaseSync, problems: string[]): void {
  const MAX_EXAMPLES = 5;

  const sourceIds = idKeySet(sourceDb, PTA_TABLE, PTA_SHARED_CONFIG.idColumns);
  const targetIds = idKeySet(targetDb, PTA_TABLE, PTA_SHARED_CONFIG.idColumns);
  const missingInTarget = [...sourceIds].filter((k) => !targetIds.has(k));
  if (missingInTarget.length > 0) {
    problems.push(`Bảng ${PTA_TABLE}: mất ${missingInTarget.length} dòng (có ở nguồn, không còn ở đích) — ví dụ: ${missingInTarget.slice(0, MAX_EXAMPLES).join(', ')}`);
  }
  const addedInTarget = [...targetIds].filter((k) => !sourceIds.has(k));
  if (addedInTarget.length > 0) {
    problems.push(`Bảng ${PTA_TABLE}: thừa ${addedInTarget.length} dòng (không có ở nguồn, xuất hiện ở đích) — ví dụ: ${addedInTarget.slice(0, MAX_EXAMPLES).join(', ')}`);
  }

  const sourceHashes = canonicalRowHashes(sourceDb, PTA_TABLE, PTA_SHARED_CONFIG);
  const targetHashes = canonicalRowHashes(targetDb, PTA_TABLE, PTA_SHARED_CONFIG);
  const changed: string[] = [];
  for (const [key, sourceHash] of sourceHashes) {
    const targetHash = targetHashes.get(key);
    if (targetHash !== undefined && targetHash !== sourceHash) changed.push(key);
  }
  if (changed.length > 0) {
    problems.push(`Bảng ${PTA_TABLE}: ${changed.length} dòng bị đổi nội dung cột cũ (hash canonical lệch) — ví dụ khoá: ${changed.slice(0, MAX_EXAMPLES).join(', ')}`);
  }

  const sourcePicById = new Map<number, string | null>();
  if (tableExists(sourceDb, PTA_TABLE)) {
    for (const row of sourceDb.prepare(`SELECT id, pic FROM ${PTA_TABLE}`).all() as { id: number; pic: string | null }[]) {
      sourcePicById.set(row.id, row.pic);
    }
  }
  const targetLabelRows = tableExists(targetDb, PTA_TABLE)
    ? (targetDb.prepare(`SELECT id, user_id, legacy_pic_label FROM ${PTA_TABLE}`).all() as { id: number; user_id: number | null; legacy_pic_label: string | null }[])
    : [];
  const labelMismatch: number[] = [];
  for (const row of targetLabelRows) {
    if (row.user_id != null) continue; // đã gán User thật — không bắt buộc còn khớp pic gốc.
    const sourcePic = sourcePicById.get(row.id);
    if (sourcePic === undefined) continue; // dòng thừa ở đích đã báo ở trên, không lặp lại lỗi.
    const expected = expectedLegacyPicLabel(sourcePic);
    if (row.legacy_pic_label !== expected) labelMismatch.push(row.id);
  }
  if (labelMismatch.length > 0) {
    problems.push(`Bảng ${PTA_TABLE}: ${labelMismatch.length} dòng có legacy_pic_label KHÔNG khớp công thức rebuild từ pic nguồn (COALESCE(NULLIF(TRIM(pic), ''), '(khong ro)')) — id: ${labelMismatch.slice(0, MAX_EXAMPLES).join(', ')}`);
  }
}

export interface BackupManifest {
  sourcePath: string;
  backupPath: string;
  sha256: string;
  createdAt: string;
  userVersion: number;
  rowCounts: Record<string, number>;
}

// ── Bước 1: createVerifiedBackup ─────────────────────────────────────────────────────────────
// Sao lưu DB nguồn bằng VACUUM INTO (đúng cơ chế đã dùng ở scripts/backup-db.mjs — an toàn ngay cả
// khi WAL đang mở), rồi ĐỌC LẠI bản backup và đối chiếu số dòng từng bảng với DB nguồn trước khi coi
// là xong — "không sang bước 2 nếu chưa đọc thử và khớp checksum" (CR §6.3): checksum ở đây là
// PRAGMA integrity_check + đối chiếu số dòng từng bảng (VACUUM INTO tạo file nén lại, không thể so
// sánh byte-for-byte với nguồn — sha256 trả về là của CHÍNH bản backup, dùng để phát hiện file bị
// sửa/hỏng về sau, không phải để so với nguồn).
export async function createVerifiedBackup(sourceDbPath: string, backupDir: string): Promise<BackupManifest> {
  if (!existsSync(sourceDbPath)) {
    throw new Error(`createVerifiedBackup: không tìm thấy DB nguồn tại ${sourceDbPath}`);
  }
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `slice4-backup-${timestamp}.sqlite`);
  if (existsSync(backupPath)) throw new Error(`createVerifiedBackup: file backup đã tồn tại ${backupPath}`);

  const sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true });
  let sourceCounts: Record<string, number>;
  let userVersion: number;
  try {
    sourceCounts = countRowsByTable(sourceDb, CORE_TABLES);
    userVersion = (sourceDb.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    // VACUUM INTO ghi ra file MỚI, không đụng nguồn — chạy được cả khi nguồn read-only.
    sourceDb.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''").replace(/\\/g, '/')}'`);
  } finally {
    sourceDb.close();
  }

  const backupDb = new DatabaseSync(backupPath, { readOnly: true });
  let integrity: string;
  let backupCounts: Record<string, number>;
  try {
    integrity = (backupDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    backupCounts = countRowsByTable(backupDb, CORE_TABLES);
  } finally {
    backupDb.close();
  }

  if (integrity !== 'ok') {
    unlinkSync(backupPath);
    throw new Error(`createVerifiedBackup: bản backup KHÔNG toàn vẹn (integrity_check = ${integrity}) — đã xoá, dừng lại`);
  }
  const mismatched = CORE_TABLES.filter((t) => sourceCounts[t] !== backupCounts[t]);
  if (mismatched.length > 0) {
    unlinkSync(backupPath);
    throw new Error(`createVerifiedBackup: số dòng LỆCH giữa nguồn và backup ở bảng: ${mismatched.join(', ')} — đã xoá backup, dừng lại`);
  }

  const sha256 = await sha256File(backupPath);
  return { sourcePath: sourceDbPath, backupPath, sha256, createdAt: new Date().toISOString(), userVersion, rowCounts: backupCounts };
}

// ── Bước 2: buildServerDatabaseFromDesktopSnapshot ───────────────────────────────────────────
// Từ bản backup (bước 1), tạo ra 1 file DB server RIÊNG (không đụng bản backup gốc lẫn DB desktop
// gốc — cả hai đều KHÔNG bị xoá bảng de_thi_*, giữ nguyên cho Luyện đề chạy tiếp trên desktop).
// "Build server không mount de-thi.ts" là việc của server/app.ts (biến môi trường ENABLE_LUYEN_DE,
// xem comment ở đó) — hàm này chỉ lo phần dữ liệu, không khởi động server.
export async function buildServerDatabaseFromDesktopSnapshot(backupPath: string, outputPath: string): Promise<{ outputPath: string; sha256: string }> {
  if (!existsSync(backupPath)) throw new Error(`buildServerDatabaseFromDesktopSnapshot: không tìm thấy backup tại ${backupPath}`);
  if (existsSync(outputPath)) throw new Error(`buildServerDatabaseFromDesktopSnapshot: file đích đã tồn tại ${outputPath}`);
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const backupDb = new DatabaseSync(backupPath, { readOnly: true });
  try {
    backupDb.exec(`VACUUM INTO '${outputPath.replace(/'/g, "''").replace(/\\/g, '/')}'`);
  } finally {
    backupDb.close();
  }

  const outputDb = new DatabaseSync(outputPath, { readOnly: true });
  let integrity: string;
  try {
    integrity = (outputDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  } finally {
    outputDb.close();
  }
  if (integrity !== 'ok') {
    unlinkSync(outputPath);
    throw new Error(`buildServerDatabaseFromDesktopSnapshot: DB đích KHÔNG toàn vẹn (${integrity}) — đã xoá, dừng lại`);
  }
  const sha256 = await sha256File(outputPath);
  return { outputPath, sha256 };
}

// ── Bước 3: applySlice4Schema + ensureDev13Identity ──────────────────────────────────────────
// applySlice4Schema TÁI DÙNG đúng chuỗi bootstrap thật của server (bootstrapDatabase(), tách ra từ
// server/db.ts) — không chép lại danh sách applyXSchema()/migration ở đây, tránh 2 nơi có thể lệch
// nhau theo thời gian.
export function applySlice4Schema(targetDb: DatabaseSync, dataDirForContext: string): void {
  targetDb.exec('PRAGMA foreign_keys = ON');
  const context: DbMigrationContext = {
    dataDir: dataDirForContext,
    withTransaction: <T>(fn: () => T): T => {
      targetDb.exec('BEGIN TRANSACTION');
      try {
        const result = fn();
        targetDb.exec('COMMIT');
        return result;
      } catch (error) {
        if (targetDb.isTransaction) targetDb.exec('ROLLBACK');
        throw error;
      }
    }
  };
  bootstrapDatabase(targetDb, context);
}

export interface Dev13Identity {
  teamId: number;
}

// KHÔNG map bằng email/display_name (CR §6.3) — `leaderUserId` phải do người vận hành tự tra và
// truyền vào (đã xác nhận qua kênh khác, ngoài phạm vi hàm này) là đúng User đã đăng nhập OIDC thật.
export function ensureDev13Identity(targetDb: DatabaseSync, leaderUserId: number, teamName = 'Dev13'): Dev13Identity {
  const leader = targetDb.prepare('SELECT id, status FROM users WHERE id = ?').get(leaderUserId) as { id: number; status: string } | undefined;
  if (!leader) throw new Error(`ensureDev13Identity: không tìm thấy user id=${leaderUserId}`);
  if (leader.status !== 'active') throw new Error(`ensureDev13Identity: user id=${leaderUserId} chưa active (status=${leader.status}) — phải đăng nhập + được duyệt trước`);

  let team = targetDb.prepare('SELECT id FROM teams WHERE name = ?').get(teamName) as { id: number } | undefined;
  const now = new Date().toISOString();
  if (!team) {
    targetDb.exec('BEGIN TRANSACTION');
    try {
      const result = targetDb.prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)').run(teamName, now);
      const teamId = Number(result.lastInsertRowid);
      const insertVisibility = targetDb.prepare(
        "INSERT INTO team_feature_visibility (team_id, feature, level, updated_at) VALUES (?, ?, 'off', ?)"
      );
      for (const feature of ['personal_task', 'project', 'weekly_report', 'release', 'mind_map']) {
        insertVisibility.run(teamId, feature, now);
      }
      targetDb.exec('COMMIT');
      team = { id: teamId };
    } catch (error) {
      if (targetDb.isTransaction) targetDb.exec('ROLLBACK');
      throw error;
    }
  }

  const existingLeader = targetDb.prepare("SELECT user_id FROM team_members WHERE team_id = ? AND role = 'leader'").get(team.id) as { user_id: number } | undefined;
  if (existingLeader && existingLeader.user_id !== leaderUserId) {
    throw new Error(`ensureDev13Identity: team "${teamName}" đã có Leader khác (user_id=${existingLeader.user_id}) — cần người vận hành tự xử lý, không tự ghi đè`);
  }
  if (!existingLeader) {
    const membership = targetDb.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(team.id, leaderUserId) as { role: string } | undefined;
    if (membership) {
      targetDb.prepare("UPDATE team_members SET role = 'leader' WHERE team_id = ? AND user_id = ?").run(team.id, leaderUserId);
    } else {
      targetDb.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'leader')").run(team.id, leaderUserId);
    }
  }
  return { teamId: team.id };
}

// ── Bước 4: backfillDev13Scope ────────────────────────────────────────────────────────────────
// Gán team_id/owner_user_id cho TOÀN BỘ dữ liệu hiện có đang NULL (dữ liệu desktop cũ, tạo trước khi
// khái niệm team/user tồn tại). CHỈ chạm dòng đang NULL — idempotent, chạy lại không đổi gì thêm.
export interface BackfillCounts {
  projects: number;
  projectTasks: number;
  pics: number;
  weeklyGoals: number;
  weeklyTaskEvaluations: number;
  weeklyProjectSummaries: number;
  weeklyReportHistory: number;
  tasks: number;
  mindmaps: number;
}

export function backfillDev13Scope(targetDb: DatabaseSync, dev13TeamId: number, leaderUserId: number): BackfillCounts {
  targetDb.exec('BEGIN TRANSACTION');
  try {
    // Project hệ thống "Khác": trước Lát 4 là ĐÚNG 1 dòng toàn app. Nếu có nhiều hơn 1 (không nên
    // xảy ra, nhưng không tự đoán/xoá) thì dừng lại để người vận hành tự xử lý — tránh vi phạm
    // unique partial index idx_projects_system_per_team ngay khi gán team_id.
    const systemProjectCount = (targetDb.prepare('SELECT COUNT(*) AS c FROM projects WHERE is_system = 1 AND team_id IS NULL').get() as { c: number }).c;
    if (systemProjectCount > 1) {
      throw new Error(`backfillDev13Scope: có ${systemProjectCount} project hệ thống "Khác" chưa gán team (chỉ nên có 1) — cần người vận hành tự gộp/xử lý trước khi chạy tiếp`);
    }

    const projects = targetDb.prepare('UPDATE projects SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    // project_tasks.team_id LẤY TỪ projects.team_id qua join (CR §6.3) — không gán hằng số theo
    // từng dòng, để đúng theo project cha thật (an toàn kể cả khi sau này còn project khác team).
    const projectTasks = targetDb.prepare(`
      UPDATE project_tasks SET team_id = (SELECT p.team_id FROM projects p WHERE p.id = project_tasks.project_id)
      WHERE team_id IS NULL
    `).run();
    const pics = targetDb.prepare('UPDATE pics SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    const weeklyGoals = targetDb.prepare('UPDATE weekly_goals SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    const weeklyTaskEvaluations = targetDb.prepare('UPDATE weekly_task_evaluations SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    const weeklyProjectSummaries = targetDb.prepare('UPDATE weekly_project_summaries SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    const weeklyReportHistory = targetDb.prepare('UPDATE weekly_report_history SET team_id = ? WHERE team_id IS NULL').run(dev13TeamId);
    // Task cá nhân + Mind Map: owner_user_id = Leader hiện tại (dữ liệu desktop cũ vốn chỉ 1 người
    // dùng). Mind Map cũ mặc định private, KHÔNG tự chia sẻ (CR §6.3).
    const tasks = targetDb.prepare('UPDATE tasks SET owner_user_id = ? WHERE owner_user_id IS NULL').run(leaderUserId);
    const mindmaps = targetDb.prepare(
      "UPDATE mindmaps SET owner_user_id = ?, visibility = COALESCE(visibility, 'private') WHERE owner_user_id IS NULL"
    ).run(leaderUserId);

    targetDb.exec('COMMIT');
    return {
      projects: Number(projects.changes), projectTasks: Number(projectTasks.changes), pics: Number(pics.changes),
      weeklyGoals: Number(weeklyGoals.changes), weeklyTaskEvaluations: Number(weeklyTaskEvaluations.changes),
      weeklyProjectSummaries: Number(weeklyProjectSummaries.changes), weeklyReportHistory: Number(weeklyReportHistory.changes),
      tasks: Number(tasks.changes), mindmaps: Number(mindmaps.changes)
    };
  } catch (error) {
    if (targetDb.isTransaction) targetDb.exec('ROLLBACK');
    throw error;
  }
}

// ── Bước 5: migrateLegacyPicLabels ───────────────────────────────────────────────────────────
// Copy NGUYÊN VĂN (không tách chuỗi nhiều tên, không so khớp hoa/thường, không tra pics/
// users.display_name, không đoán tài khoản — CR §6.3). CHÚ Ý: 3 UPDATE đầu (projects/project_tasks/
// weekly_goals) và rebuild project_task_assignments ĐÃ chạy tự động mỗi boot qua
// runSlice4Migrations() (gọi trong applySlice4Schema() ở bước 3, qua bootstrapDatabase()) — hàm này
// lặp lại CHÍNH XÁC cùng câu lệnh (idempotent, WHERE legacy_pic_label IS NULL) để là một bước tường
// minh, độc lập kiểm chứng được trong hợp đồng 7 bước, không phải vì bước 3 chưa làm.
export interface LegacyPicLabelCounts {
  projects: number;
  projectTasks: number;
  weeklyGoals: number;
}

export function migrateLegacyPicLabels(targetDb: DatabaseSync): LegacyPicLabelCounts {
  targetDb.exec('BEGIN TRANSACTION');
  try {
    const projects = targetDb.prepare(
      "UPDATE projects SET legacy_pic_label = pic WHERE legacy_pic_label IS NULL AND pic IS NOT NULL AND TRIM(pic) <> ''"
    ).run();
    const projectTasks = targetDb.prepare(
      "UPDATE project_tasks SET legacy_pic_label = assignee WHERE legacy_pic_label IS NULL AND assignee IS NOT NULL AND TRIM(assignee) <> ''"
    ).run();
    const weeklyGoals = targetDb.prepare(
      "UPDATE weekly_goals SET legacy_pic_label = assignee WHERE legacy_pic_label IS NULL AND assignee IS NOT NULL AND TRIM(assignee) <> ''"
    ).run();
    targetDb.exec('COMMIT');
    return { projects: Number(projects.changes), projectTasks: Number(projectTasks.changes), weeklyGoals: Number(weeklyGoals.changes) };
  } catch (error) {
    if (targetDb.isTransaction) targetDb.exec('ROLLBACK');
    throw error;
  }
}

// Kiểm assignment (CR §6.3 bước 6: "kiểm assignment: task tồn tại, ngày hợp lệ, nhãn legacy khớp
// đúng chuỗi nguồn, User mới nếu có thuộc đúng team"). Tách riêng khỏi diffCanonicalContent dù có
// phần trùng (legacy_pic_label cũng được kiểm ở diffProjectTaskAssignments) vì đây là kiểm NGỮ NGHĨA
// (task cha có thật không, ngày có hợp lệ không, user có đúng team không) — thứ hash không phát hiện
// được, và cho thông điệp lỗi cụ thể dễ đọc hơn "hash lệch".
//
// ⚠️ DB nguồn thật chỉ có cột `pic` (không có `legacy_pic_label`) — đọc thẳng `legacy_pic_label` từ
// sourceDb ở đây từng là bug thật (SQL "no such column", cùng gốc với bug ở diffCanonicalContent, xem
// comment ở CANONICAL_TABLE_CONFIG). Đọc `pic`, tính lại đúng công thức rebuild bằng
// expectedLegacyPicLabel() — CHỈ so khi dòng đích chưa gán User thật (user_id IS NULL), khớp đúng
// logic diffProjectTaskAssignments().
function verifyAssignments(sourceDb: DatabaseSync, targetDb: DatabaseSync, problems: string[]): void {
  if (!tableExists(targetDb, 'project_task_assignments')) return;
  const MAX_EXAMPLES = 5;
  const taskTeamById = new Map(
    (targetDb.prepare('SELECT id, team_id FROM project_tasks').all() as { id: number; team_id: number | null }[])
      .map((t) => [t.id, t.team_id])
  );
  const sourceAssignmentRows = (
    tableExists(sourceDb, 'project_task_assignments')
      ? sourceDb.prepare('SELECT id, pic FROM project_task_assignments').all()
      : []
  ) as { id: number; pic: string | null }[];
  const sourceLabelById = new Map(sourceAssignmentRows.map((r) => [r.id, expectedLegacyPicLabel(r.pic)]));

  const rows = targetDb.prepare(`
    SELECT id, project_task_id, user_id, legacy_pic_label, start_date, end_date
    FROM project_task_assignments
  `).all() as { id: number; project_task_id: number; user_id: number | null; legacy_pic_label: string | null; start_date: string; end_date: string }[];

  const missingTask: number[] = [];
  const invalidDate: number[] = [];
  const labelMismatch: number[] = [];
  const wrongTeamUser: number[] = [];
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  for (const row of rows) {
    const taskTeamId = taskTeamById.get(row.project_task_id);
    if (taskTeamId === undefined) { missingTask.push(row.id); continue; }

    if (!ISO_DATE_RE.test(row.start_date) || !ISO_DATE_RE.test(row.end_date) || row.end_date < row.start_date) {
      invalidDate.push(row.id);
    }

    if (row.user_id == null && sourceLabelById.has(row.id) && sourceLabelById.get(row.id) !== row.legacy_pic_label) {
      labelMismatch.push(row.id);
    }

    if (row.user_id != null && taskTeamId != null) {
      const belongs = targetDb.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(taskTeamId, row.user_id);
      if (!belongs) wrongTeamUser.push(row.id);
    }
  }

  if (missingTask.length > 0) problems.push(`project_task_assignments: ${missingTask.length} dòng trỏ tới project_task không tồn tại — id: ${missingTask.slice(0, MAX_EXAMPLES).join(', ')}`);
  if (invalidDate.length > 0) problems.push(`project_task_assignments: ${invalidDate.length} dòng có ngày không hợp lệ (sai định dạng hoặc end < start) — id: ${invalidDate.slice(0, MAX_EXAMPLES).join(', ')}`);
  if (labelMismatch.length > 0) problems.push(`project_task_assignments: ${labelMismatch.length} dòng có legacy_pic_label KHÔNG khớp chuỗi nguồn — id: ${labelMismatch.slice(0, MAX_EXAMPLES).join(', ')}`);
  if (wrongTeamUser.length > 0) problems.push(`project_task_assignments: ${wrongTeamUser.length} dòng có user_id KHÔNG thuộc team của project_task — id: ${wrongTeamUser.slice(0, MAX_EXAMPLES).join(', ')}`);
}

interface ProjectRollupSummary {
  minStart: string | null;
  maxEnd: string | null;
  totalEstimate: number;
  progressPercent: number;
}

// Chạy lại ĐÚNG thuật toán rollup thật (mapProjectTasksWithCalculatedRollups, tái dùng từ
// server/lib/mappers.ts — không viết lại) trên toàn bộ project_tasks của 1 project, rồi tóm tắt
// thành 4 số CR §6.3 bước 6 yêu cầu so trước/sau: ngày min/max + tổng estimate + % hoàn thành —
// tính ở cấp TOÀN PROJECT (gộp các task gốc, level 1) thay vì so từng task theo id, vì phép so theo
// id đã được diffCanonicalContent phủ riêng (estimate_hours/tien_do/ngày nằm trong canonical columns
// của project_tasks) — hàm này bổ sung một lớp kiểm ĐỘC LẬP ở mức tổng hợp, đúng như CR yêu cầu.
function computeProjectRollupSummaries(db: DatabaseSync): Map<number, ProjectRollupSummary> {
  const result = new Map<number, ProjectRollupSummary>();
  if (!tableExists(db, 'project_tasks') || !tableExists(db, 'projects')) return result;
  const projectIds = (db.prepare('SELECT id FROM projects').all() as { id: number }[]).map((r) => r.id);
  for (const projectId of projectIds) {
    const rows = db.prepare('SELECT * FROM project_tasks WHERE project_id = ?').all(projectId) as Record<string, unknown>[];
    const withRollup = mapProjectTasksWithCalculatedRollups(rows);
    const roots = withRollup.filter((t) => t.level === 1);
    const totalEstimate = roots.reduce((sum, t) => sum + (t.estimateHours ?? 0), 0);
    const completedEstimate = roots.reduce((sum, t) => sum + ((t.estimateHours ?? 0) * (t.tienDo ?? 0) / 100), 0);
    const progressPercent = totalEstimate > 0 ? Math.floor((completedEstimate / totalEstimate) * 100) : 0;
    const starts = withRollup.map((t) => t.ngayBatDauDuKien).filter((v): v is string => Boolean(v)).sort();
    const ends = withRollup.map((t) => t.ngayKetThucDuKien).filter((v): v is string => Boolean(v)).sort();
    result.set(projectId, {
      minStart: starts[0] ?? null,
      maxEnd: ends.at(-1) ?? null,
      totalEstimate,
      progressPercent
    });
  }
  return result;
}

function diffProjectRollups(sourceDb: DatabaseSync, targetDb: DatabaseSync, problems: string[]): void {
  const sourceSummaries = computeProjectRollupSummaries(sourceDb);
  const targetSummaries = computeProjectRollupSummaries(targetDb);
  for (const [projectId, sourceSummary] of sourceSummaries) {
    const targetSummary = targetSummaries.get(projectId);
    if (!targetSummary) continue; // project bị mất đã báo ở diffCanonicalContent, không lặp lại lỗi ở đây
    if (sourceSummary.minStart !== targetSummary.minStart || sourceSummary.maxEnd !== targetSummary.maxEnd) {
      problems.push(`Project ${projectId}: rollup ngày min/max lệch sau di trú (nguồn min=${sourceSummary.minStart} max=${sourceSummary.maxEnd}, đích min=${targetSummary.minStart} max=${targetSummary.maxEnd})`);
    }
    if (sourceSummary.totalEstimate !== targetSummary.totalEstimate) {
      problems.push(`Project ${projectId}: rollup tổng estimate lệch sau di trú (nguồn=${sourceSummary.totalEstimate}, đích=${targetSummary.totalEstimate})`);
    }
    if (sourceSummary.progressPercent !== targetSummary.progressPercent) {
      problems.push(`Project ${projectId}: rollup % hoàn thành lệch sau di trú (nguồn=${sourceSummary.progressPercent}%, đích=${targetSummary.progressPercent}%)`);
    }
  }
}

// Kiểm weekly goal/evaluation/summary trỏ đúng project/task CÙNG TEAM (CR §6.3 bước 6).
function verifyWeeklyScoping(targetDb: DatabaseSync, problems: string[]): void {
  const MAX_EXAMPLES = 5;
  const projectTeamById = new Map((targetDb.prepare('SELECT id, team_id FROM projects').all() as { id: number; team_id: number | null }[]).map((r) => [r.id, r.team_id]));
  const taskTeamById = new Map((targetDb.prepare('SELECT id, team_id FROM project_tasks').all() as { id: number; team_id: number | null }[]).map((r) => [r.id, r.team_id]));

  if (tableExists(targetDb, 'weekly_goals')) {
    const rows = targetDb.prepare('SELECT id, team_id, project_id, project_task_id FROM weekly_goals').all() as
      { id: number; team_id: number | null; project_id: number | null; project_task_id: number | null }[];
    const mismatched = rows.filter((r) =>
      (r.project_id != null && projectTeamById.get(r.project_id) !== r.team_id) ||
      (r.project_task_id != null && taskTeamById.get(r.project_task_id) !== r.team_id)
    );
    if (mismatched.length > 0) problems.push(`weekly_goals: ${mismatched.length} dòng trỏ project/task KHÔNG cùng team — id: ${mismatched.slice(0, MAX_EXAMPLES).map((r) => r.id).join(', ')}`);
  }
  if (tableExists(targetDb, 'weekly_task_evaluations')) {
    const rows = targetDb.prepare('SELECT project_task_id, team_id FROM weekly_task_evaluations').all() as { project_task_id: number; team_id: number | null }[];
    const mismatched = rows.filter((r) => taskTeamById.get(r.project_task_id) !== r.team_id);
    if (mismatched.length > 0) problems.push(`weekly_task_evaluations: ${mismatched.length} dòng trỏ project_task KHÔNG cùng team — project_task_id: ${mismatched.slice(0, MAX_EXAMPLES).map((r) => r.project_task_id).join(', ')}`);
  }
  if (tableExists(targetDb, 'weekly_project_summaries')) {
    const rows = targetDb.prepare('SELECT project_id, team_id FROM weekly_project_summaries').all() as { project_id: number; team_id: number | null }[];
    const mismatched = rows.filter((r) => projectTeamById.get(r.project_id) !== r.team_id);
    if (mismatched.length > 0) problems.push(`weekly_project_summaries: ${mismatched.length} dòng trỏ project KHÔNG cùng team — project_id: ${mismatched.slice(0, MAX_EXAMPLES).map((r) => r.project_id).join(', ')}`);
  }
}

// Trích danh sách "storedName" file đính kèm được nhắc trong JSON Mind Map — dùng lại NGUYÊN VĂN quy
// tắc regex/decode của server/lib/mindmap-gc.ts (URL_RE) để không lệch với logic GC thật đang chạy.
const MINDMAP_FILE_URL_RE = /\/api\/mindmaps\/files\/([^"'\s]+)/g;

// Kiểm Mind Map DI SẢN trước Lát 5 (CR §6.3 bước 6): parse JSON hợp lệ + file đính kèm (kiểu cũ, lưu
// URL tự do trong JSON, thư mục `mindmap-files/`) còn tồn tại trên đĩa.
//
// KHÔNG kiểm được "hash khớp manifest" cho NHÓM FILE NÀY: kiểu đính kèm cũ (trước Lát 5) không có
// bảng/manifest nào lưu hash lúc tải lên (server/routes/mindmaps.ts bản cũ chỉ lưu file bằng tên
// ngẫu nhiên). Đây là khoảng trống THẬT của kiến trúc CŨ, không phải lười làm. Lát 5 đã thêm bảng
// `mindmap_attachments` (CÓ hash) cho cơ chế đính kèm MỚI — phần kiểm hash cho bảng đó nằm ở hàm
// RIÊNG verifyMindmapAttachmentHashes() ngay dưới đây (2 cơ chế khác thư mục, khác thế hệ, không gộp
// chung một hàm).
// Thư mục `mindmap-files/` cũng KHÔNG nằm trong phạm vi createVerifiedBackup/
// buildServerDatabaseFromDesktopSnapshot (2 hàm đó chỉ VACUUM INTO đúng file .sqlite, xem comment ở
// server/routes/mindmaps.ts) — người vận hành thật phải tự copy thư mục này sang `targetDataDir` TRƯỚC
// khi gọi verify; nếu chưa copy, kiểm "file còn tồn tại" dưới đây sẽ đúng đắn báo THIẾU (không phải bug).
function verifyMindmapAttachments(targetDb: DatabaseSync, targetDataDir: string, problems: string[]): void {
  if (!tableExists(targetDb, 'mindmaps')) return;
  const filesDir = path.join(targetDataDir, 'mindmap-files');
  const rows = targetDb.prepare('SELECT id, data FROM mindmaps').all() as { id: number; data: string }[];
  const MAX_EXAMPLES = 5;
  const invalidJson: number[] = [];
  const missingFiles: string[] = [];

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data ?? '{}');
    } catch {
      invalidJson.push(row.id);
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) { invalidJson.push(row.id); continue; }

    for (const match of String(row.data).matchAll(MINDMAP_FILE_URL_RE)) {
      let storedName: string;
      try {
        storedName = decodeURIComponent(match[1]);
      } catch {
        missingFiles.push(`mindmap ${row.id}: URL file không decode được ("${match[1]}")`);
        continue;
      }
      const full = path.join(filesDir, storedName);
      if (!full.startsWith(filesDir) || !existsSync(full)) {
        missingFiles.push(`mindmap ${row.id}: file đính kèm "${storedName}" không tồn tại tại ${filesDir}`);
      }
    }
  }

  if (invalidJson.length > 0) problems.push(`mindmaps: ${invalidJson.length} dòng có cột data KHÔNG parse được JSON hợp lệ — id: ${invalidJson.slice(0, MAX_EXAMPLES).join(', ')}`);
  if (missingFiles.length > 0) problems.push(`mindmaps: ${missingFiles.length} file đính kèm bị thiếu trên đĩa (mindmap-files/ chưa được copy sang đích, hoặc file đã mất) — ví dụ: ${missingFiles.slice(0, MAX_EXAMPLES).join(' | ')}`);
}

// Lát 5 (BL-20260913-001, việc dọn nợ #3) — QUAY LẠI bổ sung phần "hash khớp manifest" mà comment ở
// verifyMindmapAttachments() phía trên nói CHƯA làm được ở Lát 4 (chưa có bảng lưu hash lúc đó).
// Bảng `mindmap_attachments` (server/schema/mindmap.ts, Lát 5) giờ CHÍNH LÀ manifest đó — mỗi dòng
// `status = 'ready'` có `sha256` tính lúc upload thật (server/routes/mindmaps.ts). Đây là kiểm ĐỘC LẬP
// với verifyMindmapAttachments() ở trên (bảng khác, thư mục khác `mindmap-attachments/` chứ không phải
// `mindmap-files/` cũ) — không gộp chung để không lẫn 2 cơ chế đính kèm khác thế hệ.
function verifyMindmapAttachmentHashes(targetDb: DatabaseSync, targetDataDir: string, problems: string[]): void {
  if (!tableExists(targetDb, 'mindmap_attachments')) return;
  const attachmentsDir = path.join(targetDataDir, 'mindmap-attachments');
  const rows = targetDb.prepare(
    "SELECT id, storage_key, sha256, original_name FROM mindmap_attachments WHERE status = 'ready'"
  ).all() as { id: string; storage_key: string; sha256: string; original_name: string }[];
  const MAX_EXAMPLES = 5;
  const missing: string[] = [];
  const mismatched: string[] = [];

  for (const row of rows) {
    const full = path.join(attachmentsDir, row.storage_key);
    if (!full.startsWith(attachmentsDir) || !existsSync(full)) {
      missing.push(`attachment ${row.id} ("${row.original_name}"): file không tồn tại tại ${attachmentsDir}`);
      continue;
    }
    const actualHash = createHash('sha256').update(readFileSync(full)).digest('hex');
    if (actualHash !== row.sha256) {
      mismatched.push(`attachment ${row.id} ("${row.original_name}"): sha256 lệch (manifest=${row.sha256}, thực tế=${actualHash})`);
    }
  }

  if (missing.length > 0) problems.push(`mindmap_attachments: ${missing.length} file 'ready' bị thiếu trên đĩa (mindmap-attachments/ chưa được copy sang đích, hoặc file đã mất) — ví dụ: ${missing.slice(0, MAX_EXAMPLES).join(' | ')}`);
  if (mismatched.length > 0) problems.push(`mindmap_attachments: ${mismatched.length} file có sha256 KHÔNG khớp manifest (nội dung đã bị đổi hoặc sao chép hỏng) — ví dụ: ${mismatched.slice(0, MAX_EXAMPLES).join(' | ')}`);
}

// ── Bước 6: verifySlice4Migration ────────────────────────────────────────────────────────────
// Kiểm ĐỦ danh sách CR §6.3 bước 6: số dòng + TẬP ID trước/sau từng bảng; hash nội dung canonical
// (cột cũ không đổi giá trị); scope/owner không còn NULL ngoài chỗ thiết kế nullable; cây project
// không vòng lặp; assignment (task tồn tại, ngày hợp lệ, nhãn legacy khớp nguồn, user mới đúng team);
// rollup trước/sau (ngày min/max + tổng estimate + % task cha, tái dùng đúng thuật toán thật);
// weekly goal/evaluation/summary trỏ đúng project/task cùng team; Mind Map JSON hợp lệ + file đính
// kèm còn tồn tại (đính kèm kiểu CŨ trước Lát 5 — không kiểm được hash, xem comment
// verifyMindmapAttachments) VÀ hash khớp manifest cho đính kèm kiểu MỚI Lát 5 (bảng
// `mindmap_attachments`, xem verifyMindmapAttachmentHashes); PRAGMA foreign_key_check + quick_check.
//
// `targetDataDir`: thư mục chứa `tasks.sqlite` ĐÍCH (đúng quy ước dùng chung với
// smokeBootMigratedServer) — cần để (a) định vị `mindmap-files/` lúc kiểm file đính kèm, (b) biết
// đường dẫn file DB đích để tự ROLLBACK khi phát hiện vấn đề (CR §6.3: "lệch bất kỳ điều gì thì
// rollback DB đích và dừng, không tiếp tục"). Rollback ở đây = ĐÓNG kết nối `targetDb` đang giữ rồi
// XOÁ hẳn file DB đích (+ -wal/-shm nếu còn) — bản backup (bước 1) và DB desktop gốc hoàn toàn không
// bị đụng tới (Q9, CR §6.3), nên xoá file đích hỏng là an toàn: người vận hành sửa xong chạy lại từ
// bước 2 (buildServerDatabaseFromDesktopSnapshot) với đường dẫn đích sạch. Mặc định TỰ rollback khi
// ok=false — truyền `autoRollbackOnFailure: false` nếu caller muốn tự kiểm tra thêm trước khi xoá.
export interface VerifyResult {
  ok: boolean;
  problems: string[];
  rowCounts: Record<string, number>;
  rolledBack: boolean;
}

export interface VerifySlice4MigrationOptions {
  autoRollbackOnFailure?: boolean;
}

export function verifySlice4Migration(
  sourceDbPath: string,
  targetDb: DatabaseSync,
  targetDataDir: string,
  options: VerifySlice4MigrationOptions = {}
): VerifyResult {
  const autoRollbackOnFailure = options.autoRollbackOnFailure !== false;
  const problems: string[] = [];

  const sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true });
  let sourceCounts: Record<string, number>;
  try {
    sourceCounts = countRowsByTable(sourceDb, CORE_TABLES);
    const targetCountsForRowCompare = countRowsByTable(targetDb, CORE_TABLES);
    for (const table of CORE_TABLES) {
      if (sourceCounts[table] !== targetCountsForRowCompare[table]) {
        problems.push(`Số dòng bảng ${table} lệch: nguồn=${sourceCounts[table]}, đích=${targetCountsForRowCompare[table]}`);
      }
    }

    diffCanonicalContent(sourceDb, targetDb, problems);
    diffProjectTaskAssignments(sourceDb, targetDb, problems);
    verifyAssignments(sourceDb, targetDb, problems);
    diffProjectRollups(sourceDb, targetDb, problems);
  } finally {
    sourceDb.close();
  }

  const targetCounts = countRowsByTable(targetDb, CORE_TABLES);

  const fkViolations = targetDb.prepare('PRAGMA foreign_key_check').all();
  if (fkViolations.length > 0) problems.push(`PRAGMA foreign_key_check phát hiện ${fkViolations.length} vi phạm khoá ngoại`);

  const quickCheck = (targetDb.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
  if (quickCheck !== 'ok') problems.push(`PRAGMA quick_check = ${quickCheck} (không phải "ok")`);

  // Scope không còn NULL sau backfill — trừ project hệ thống "Khác" đã gán ở bước 4 (không nên còn
  // NULL nếu bước 4 chạy thành công); không kiểm project_task_assignments.user_id vì dòng legacy
  // (user_id NULL, legacy_pic_label có giá trị) là thiết kế hợp lệ, không phải lỗi.
  const nullTeamProjects = (targetDb.prepare('SELECT COUNT(*) AS c FROM projects WHERE team_id IS NULL').get() as { c: number }).c;
  if (nullTeamProjects > 0) problems.push(`Còn ${nullTeamProjects} project chưa gán team_id`);
  const nullTeamTasks = (targetDb.prepare('SELECT COUNT(*) AS c FROM project_tasks WHERE team_id IS NULL').get() as { c: number }).c;
  if (nullTeamTasks > 0) problems.push(`Còn ${nullTeamTasks} project_task chưa gán team_id`);
  const nullOwnerTasks = (targetDb.prepare('SELECT COUNT(*) AS c FROM tasks WHERE owner_user_id IS NULL').get() as { c: number }).c;
  if (nullOwnerTasks > 0) problems.push(`Còn ${nullOwnerTasks} task cá nhân chưa gán owner_user_id`);

  // Cây project: parent phải tồn tại, cùng project, level 1-3 (CHECK đã có ở schema — kiểm lại đây
  // là kiểm KHÔNG VÒNG LẶP, thứ CHECK constraint không phát hiện được).
  const taskRows = targetDb.prepare('SELECT id, project_id, parent_id FROM project_tasks').all() as { id: number; project_id: number; parent_id: number | null }[];
  const byId = new Map(taskRows.map((t) => [t.id, t]));
  for (const t of taskRows) {
    if (t.parent_id == null) continue;
    const parent = byId.get(t.parent_id);
    if (!parent) { problems.push(`project_task ${t.id} trỏ tới parent_id ${t.parent_id} không tồn tại`); continue; }
    if (parent.project_id !== t.project_id) problems.push(`project_task ${t.id} và parent ${t.parent_id} khác project_id`);
    let cursor: typeof parent | undefined = parent;
    const seen = new Set<number>([t.id]);
    while (cursor) {
      if (seen.has(cursor.id)) { problems.push(`project_task ${t.id} nằm trong VÒNG LẶP cha-con`); break; }
      seen.add(cursor.id);
      cursor = cursor.parent_id == null ? undefined : byId.get(cursor.parent_id);
    }
  }

  verifyWeeklyScoping(targetDb, problems);
  verifyMindmapAttachments(targetDb, targetDataDir, problems);
  verifyMindmapAttachmentHashes(targetDb, targetDataDir, problems);

  const ok = problems.length === 0;
  let rolledBack = false;
  if (!ok && autoRollbackOnFailure) {
    const targetDbPath = path.join(targetDataDir, 'tasks.sqlite');
    try {
      targetDb.close();
    } catch {
      // đã đóng từ trước — bỏ qua, vẫn tiếp tục xoá file.
    }
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const p = `${targetDbPath}${suffix}`;
      if (existsSync(p)) unlinkSync(p);
    }
    rolledBack = true;
  }

  return { ok, problems, rowCounts: targetCounts, rolledBack };
}

// ── Bước 7: smokeBootMigratedServer ──────────────────────────────────────────────────────────
//
// ⚠️ QUYẾT ĐỊNH KỸ THUẬT QUAN TRỌNG (đọc trước khi sửa hàm này): bản trước dùng `await import()`
// với query-string "cache-bust" để nạp lại server/app.js NHIỀU LẦN trong CÙNG một tiến trình Node,
// giả định mỗi lần nạp lại sẽ đọc process.env.DATA_DIR MỚI. Đã TỰ KIỂM CHỨNG bằng thực nghiệm (không
// đoán — đúng R-CODE-07 "không đoán cờ/hành vi thư viện"): cache-bust chỉ buộc Node coi CHÍNH module
// app.js là "mới", nhưng mọi thứ app.js import bằng specifier tương đối KHÔNG kèm query (`./db.js`,
// `./paths.js`, `./lib/auth-config.js`...) vẫn resolve về ĐÚNG module đã nạp/cache từ lần gọi TRƯỚC —
// singleton `db` trong server/db.ts vẫn trỏ về DATA_DIR CŨ. Gọi hàm này 2 lần trong 1 tiến trình
// (đúng thứ yêu cầu CR §6.3 bước 7 "restart lần hai") với bản cũ sẽ ÂM THẦM đọc/ghi nhầm DB — nguy
// hiểm hơn cả việc không kiểm. Bằng chứng: script thực nghiệm boot 2 dataDir khác nhau liên tiếp,
// dataDir thứ 2 KHÔNG hề có file tasks.sqlite nào được tạo (server vẫn phục vụ dữ liệu của dataDir
// đầu). Sửa đúng gốc: mỗi lần "boot" ở đây là một TIẾN TRÌNH NODE THẬT SỰ RIÊNG (spawn), đúng ĐÚNG NGHĨA
// "restart" — cách này cũng khớp sát hơn với `npm start` (`node --import tsx server/index.ts`) thật,
// thay vì chỉ import server/app.ts.
//
// ⚠️ QUYẾT ĐỊNH THỨ HAI: "smoke test đăng nhập Leader" KHÔNG dựng lại toàn bộ vòng OIDC giả (mock
// auth.drjoy.vn + /api/auth/login + /api/auth/callback) như test/integration/fixtures/auth-harness.ts
// vẫn làm cho test tích hợp. Lý do: route callback thật tìm user theo ĐÚNG CẶP (issuer, subject) —
// muốn đăng nhập lại ĐÚNG Leader đã di trú (đã tồn tại sẵn trong DB đích, issuer/subject THẬT của
// auth.drjoy.vn) qua một mock auth server nội bộ, mock đó phải tự xưng `iss` trùng với issuer thật
// (bắt buộc, vì server/lib/jwks-client.ts ép `issuer: authConfig.baseUrl` khi verify JWT) — nghĩa là
// phải SỬA TẠM cột `users.issuer` của đúng Leader thật thành URL mock, hoặc phải TẠO USER MỚI (không
// phải Leader thật) rồi tự gán quyền. Cả hai đều tệ hơn phương án đã chọn: tạo thẳng 1 dòng
// `user_sessions` hợp lệ cho ĐÚNG `leaderUserId` bằng chính thuật toán server/lib/session.ts đang dùng
// (token ngẫu nhiên 256-bit + sha256(token) lưu vào token_hash — xem hàm mintSessionToken() dưới) rồi
// dùng token đó làm cookie `__Host-tm_session` gọi thẳng API thật. Vẫn là "tạo 1 session hợp lệ" như
// yêu cầu, vẫn đi qua ĐÚNG middleware requireSession/requireActiveAccount/authorize() thật ở phía
// server (không bypass bất kỳ lớp kiểm tra nào) — chỉ khác ở chỗ KHÔNG giả lập vòng OIDC, tránh phải
// đụng vào cột định danh thật của Leader. Phiên smoke-test bị XOÁ khỏi user_sessions ngay sau khi xong
// (xem restoreTempState()), không để lại dấu vết trong DB đã di trú.
//
// ⚠️ QUYẾT ĐỊNH THỨ BA: team MỚI mặc định TẮT cả 5 chức năng (ensureDev13Identity seed level='off') —
// đúng quyết định sản phẩm đã chốt (xem AGENTS.md-style ghi chú R-SCOPE trong docs dự án này). Nếu
// không bật tạm, mọi API đọc (project/weekly/mindmap) sẽ trả 403 FEATURE_DISABLED dù dữ liệu di trú
// hoàn toàn đúng — không phản ánh lỗi migration. Hàm này BẬT TẠM 4 chức năng cần đọc
// (personal_task/project/weekly_report/mind_map) ngay trước khi gọi, rồi TRẢ VỀ ĐÚNG mức cũ ngay sau
// khi xong (xem restoreTempState()) — việc "Admin bật chức năng thật cho Dev13" vẫn là hành động
// riêng, con người quyết, KHÔNG bị hàm này âm thầm bật vĩnh viễn.
//
// Vì server/db.ts đọc DATA_DIR/APPDATA lúc import (side effect module-level) — không đổi — hàm này
// vẫn bắt buộc nhận `dataDirWithMigratedDb` chứa SẴN file `tasks.sqlite` đã di trú xong, không tự
// copy/di chuyển file.
export interface SmokeBootResult {
  ok: boolean;
  problems: string[];
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServerReady(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/health/ready`);
      if (r.status === 200) return true;
    } catch {
      // Server con chưa mở cổng xong — thử lại tới khi hết thời gian chờ.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

interface ChildServerHandle {
  baseUrl: string;
  stop(): Promise<void>;
}
interface ChildServerError {
  error: string;
}

// Khởi động `server/index.ts` THẬT (đúng lệnh `npm start` dùng: `node --import tsx server/index.ts`)
// như MỘT TIẾN TRÌNH NODE RIÊNG, trỏ DATA_DIR vào đúng thư mục đã di trú — đây là "restart" đúng
// nghĩa đen, không phải import lại module trong cùng tiến trình (xem giải thích ở đầu file/bước 7).
async function bootServerChildProcess(dataDir: string, extraEnv: Record<string, string> = {}): Promise<ChildServerHandle | ChildServerError> {
  const port = await pickFreePort();
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const indexTsPath = path.join(repoRoot, 'server', 'index.ts');
  const stderrChunks: string[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', indexTsPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      APPDATA: dataDir,
      ENABLE_LUYEN_DE: 'false',
      PORT: String(port),
      HOST: '127.0.0.1',
      NO_BROWSER: '1',
      OPEN_BROWSER: '0'
      , ...extraEnv
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr?.on('data', (chunk: Buffer) => { stderrChunks.push(chunk.toString('utf8')); });

  const baseUrl = `http://127.0.0.1:${port}`;
  const ready = await waitForServerReady(baseUrl, 20000);
  if (!ready) {
    try { child.kill(); } catch { /* tiến trình có thể đã thoát */ }
    return { error: `Tiến trình server con (dataDir=${dataDir}) không sẵn sàng (/health/ready) sau 20s. stderr: ${stderrChunks.join('').slice(0, 2000) || '(rỗng)'}` };
  }

  async function stop(): Promise<void> {
    if (child.exitCode !== null || child.killed) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* đã thoát trong lúc chờ */ }
        resolve();
      }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }

  return { baseUrl, stop };
}

function mintSessionToken(db: DatabaseSync, userId: number): string {
  // Thuật toán PHẢI khớp đúng server/lib/session.ts:createSession() — token ngẫu nhiên 256-bit dạng
  // base64url, DB chỉ lưu sha256(token), không lưu giá trị thật (không tái dùng import trực tiếp vì
  // session.ts import `db` singleton của server/db.ts — file vận hành này KHÔNG được lỡ tay mở thêm
  // kết nối nào ngoài tham số được truyền, xem comment đầu file).
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = new Date();
  // Phiên smoke-test chỉ sống trong đúng 1 lượt gọi hàm này rồi bị xoá hẳn (xem restoreTempState) —
  // 1 giờ là đủ dư, không cần khớp SESSION_TTL_MS thật (7 ngày) của phiên người dùng thường.
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, tokenHash, now.toISOString(), expiresAt, now.toISOString());
  return token;
}

const SMOKE_TEST_FEATURES = ['personal_task', 'project', 'weekly_report', 'mind_map'] as const;

function snapshotForIdempotencyCheck(db: DatabaseSync): unknown {
  const counts = countRowsByTable(db, CORE_TABLES);
  const hashes: Record<string, string[]> = {};
  for (const [table, config] of Object.entries(CANONICAL_TABLE_CONFIG)) {
    hashes[table] = [...canonicalRowHashes(db, table, config).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, h]) => `${k}=${h}`);
  }
  return { counts, hashes };
}

export async function smokeBootMigratedServer(dataDirWithMigratedDb: string, leaderUserId: number): Promise<SmokeBootResult> {
  const problems: string[] = [];
  const dbFile = path.join(dataDirWithMigratedDb, 'tasks.sqlite');
  if (!existsSync(dbFile)) {
    return { ok: false, problems: [`Không tìm thấy ${dbFile} — phải đặt DB đã di trú đúng tên tasks.sqlite trong thư mục này trước`] };
  }

  // ── Chuẩn bị: xác nhận Leader, lấy/tạo team Dev13 (idempotent), bật tạm 4 chức năng, tạo session.
  let dev13TeamId: number;
  let sessionToken: string;
  const originalFeatureLevels = new Map<string, string>();
  {
    const prepDb = new DatabaseSync(dbFile);
    try {
      const leader = prepDb.prepare('SELECT id, status FROM users WHERE id = ?').get(leaderUserId) as { id: number; status: string } | undefined;
      if (!leader) return { ok: false, problems: [`Không tìm thấy Leader user id=${leaderUserId} trong DB đã di trú`] };
      if (leader.status !== 'active') return { ok: false, problems: [`Leader user id=${leaderUserId} chưa active (status=${leader.status})`] };

      dev13TeamId = ensureDev13Identity(prepDb, leaderUserId).teamId;

      const now = new Date().toISOString();
      for (const feature of SMOKE_TEST_FEATURES) {
        const row = prepDb.prepare('SELECT level FROM team_feature_visibility WHERE team_id = ? AND feature = ?').get(dev13TeamId, feature) as { level: string } | undefined;
        originalFeatureLevels.set(feature, row?.level ?? 'off');
        prepDb.prepare("UPDATE team_feature_visibility SET level = 'on', updated_at = ? WHERE team_id = ? AND feature = ?").run(now, dev13TeamId, feature);
      }

      sessionToken = mintSessionToken(prepDb, leaderUserId);
    } finally {
      prepDb.close();
    }
  }

  async function restoreTempState(): Promise<void> {
    const cleanupDb = new DatabaseSync(dbFile);
    try {
      const now = new Date().toISOString();
      for (const [feature, level] of originalFeatureLevels) {
        cleanupDb.prepare('UPDATE team_feature_visibility SET level = ?, updated_at = ? WHERE team_id = ? AND feature = ?').run(level, now, dev13TeamId, feature);
      }
      const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
      cleanupDb.prepare('DELETE FROM user_sessions WHERE user_id = ? AND token_hash = ?').run(leaderUserId, tokenHash);
    } finally {
      cleanupDb.close();
    }
  }

  // ── Lần boot thứ nhất: health/Luyện đề + đăng nhập Leader + chọn Dev13 + đọc project/tree/weekly/
  // tasks/mindmaps thật qua HTTP thật tới tiến trình con.
  const firstBoot = await bootServerChildProcess(dataDirWithMigratedDb);
  if ('error' in firstBoot) {
    await restoreTempState();
    return { ok: false, problems: [firstBoot.error] };
  }
  try {
    const cookie = `__Host-tm_session=${sessionToken}`;
    const authHeaders = { Cookie: cookie };

    const ready = await fetch(`${firstBoot.baseUrl}/health/ready`);
    if (ready.status !== 200) problems.push(`GET /health/ready trả ${ready.status}, kỳ vọng 200`);

    // Luyện đề không có route trên server (ENABLE_LUYEN_DE=false) -> 404, không phải SQL 500.
    const luyenDe = await fetch(`${firstBoot.baseUrl}/api/de-thi/ky-thi`);
    if (luyenDe.status !== 404) problems.push(`GET /api/de-thi/ky-thi trả ${luyenDe.status}, kỳ vọng 404 (Luyện đề không mount trên server)`);

    // "Đăng nhập Leader": xác nhận session vừa tạo thật sự hợp lệ và đúng đúng identity Leader.
    const meRes = await fetch(`${firstBoot.baseUrl}/api/auth/me`, { headers: authHeaders });
    if (meRes.status !== 200) {
      problems.push(`GET /api/auth/me trả ${meRes.status}, kỳ vọng 200 (session smoke-test không hợp lệ)`);
    } else {
      const meBody = await meRes.json() as { user?: { id: number } };
      if (meBody.user?.id !== leaderUserId) {
        problems.push(`GET /api/auth/me trả về user id=${meBody.user?.id}, kỳ vọng đúng Leader id=${leaderUserId}`);
      }
    }

    // "Chọn Dev13" + đọc project.
    let firstProjectId: number | null = null;
    const projectsRes = await fetch(`${firstBoot.baseUrl}/api/projects?teamId=${dev13TeamId}`, { headers: authHeaders });
    if (projectsRes.status !== 200) {
      problems.push(`GET /api/projects?teamId=${dev13TeamId} trả ${projectsRes.status}, kỳ vọng 200`);
    } else {
      const projectsBody = await projectsRes.json() as { id: string }[];
      if (Array.isArray(projectsBody) && projectsBody.length > 0) firstProjectId = Number(projectsBody[0].id);
    }

    // tree/Gantt: cùng 1 endpoint trả cây task đã tính rollup (FE dùng chung cho cả 2 màn) — chỉ gọi
    // được khi có ít nhất 1 project; DB nguồn không có project nào thì bỏ qua bước này, KHÔNG phải lỗi.
    if (firstProjectId != null) {
      const treeRes = await fetch(`${firstBoot.baseUrl}/api/projects/${firstProjectId}/tasks`, { headers: authHeaders });
      if (treeRes.status !== 200) problems.push(`GET /api/projects/${firstProjectId}/tasks trả ${treeRes.status}, kỳ vọng 200`);
    }

    // weekly (tuần hiện tại).
    const weekStart = new Date().toISOString().slice(0, 10);
    const weeklyRes = await fetch(`${firstBoot.baseUrl}/api/weeks/${weekStart}/goals?teamId=${dev13TeamId}`, { headers: authHeaders });
    if (weeklyRes.status !== 200) problems.push(`GET /api/weeks/${weekStart}/goals?teamId=${dev13TeamId} trả ${weeklyRes.status}, kỳ vọng 200`);

    // tasks (cá nhân — không theo team).
    const tasksRes = await fetch(`${firstBoot.baseUrl}/api/tasks`, { headers: authHeaders });
    if (tasksRes.status !== 200) problems.push(`GET /api/tasks trả ${tasksRes.status}, kỳ vọng 200`);

    // mindmaps.
    const mindmapsRes = await fetch(`${firstBoot.baseUrl}/api/mindmaps`, { headers: authHeaders });
    if (mindmapsRes.status !== 200) problems.push(`GET /api/mindmaps trả ${mindmapsRes.status}, kỳ vọng 200`);
  } finally {
    await firstBoot.stop();
  }

  if (problems.length > 0) {
    await restoreTempState();
    return { ok: false, problems };
  }

  // ── Kiểm tính idempotent THẬT (CR §6.3 bước 7): gọi lại chuỗi hàm di trú lần 2 trên CÙNG DB đích,
  // so số dòng + hash canonical trước/sau — phải giống hệt (không backfill lặp, không đổi dữ liệu).
  const idempotencyProblems: string[] = [];
  {
    const reDb = new DatabaseSync(dbFile);
    try {
      const before = snapshotForIdempotencyCheck(reDb);
      applySlice4Schema(reDb, dataDirWithMigratedDb);
      ensureDev13Identity(reDb, leaderUserId);
      const backfillAgain = backfillDev13Scope(reDb, dev13TeamId, leaderUserId);
      const legacyAgain = migrateLegacyPicLabels(reDb);
      const after = snapshotForIdempotencyCheck(reDb);

      const totalBackfillChanges = Object.values(backfillAgain).reduce((a, b) => a + b, 0);
      const totalLegacyChanges = Object.values(legacyAgain).reduce((a, b) => a + b, 0);
      if (totalBackfillChanges > 0) idempotencyProblems.push(`backfillDev13Scope lần gọi thứ 2 vẫn còn đổi ${totalBackfillChanges} dòng — KHÔNG idempotent`);
      if (totalLegacyChanges > 0) idempotencyProblems.push(`migrateLegacyPicLabels lần gọi thứ 2 vẫn còn đổi ${totalLegacyChanges} dòng — KHÔNG idempotent`);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        idempotencyProblems.push('Dữ liệu (số dòng hoặc hash nội dung) đổi khác sau khi chạy lại chuỗi hàm di trú lần 2 trên cùng DB — KHÔNG idempotent');
      }
    } finally {
      reDb.close();
    }
  }

  await restoreTempState();

  if (idempotencyProblems.length > 0) {
    return { ok: false, problems: idempotencyProblems };
  }

  // ── "Restart lần hai" thật sự (tiến trình mới hoàn toàn) — xác nhận server vẫn boot đúng sau khi
  // đã chạy lại chuỗi di trú lần 2 ở trên, chỉ cần health-check nhẹ (đã smoke đầy đủ ở lần boot đầu).
  const secondBoot = await bootServerChildProcess(dataDirWithMigratedDb);
  if ('error' in secondBoot) return { ok: false, problems: [secondBoot.error] };
  await secondBoot.stop();

  return { ok: true, problems: [] };
}

// Chỉ để test đọc mtime/size khi cần dựng fixture — không dùng trong luồng chính.
export function fileSize(filePath: string): number {
  return statSync(filePath).size;
}
