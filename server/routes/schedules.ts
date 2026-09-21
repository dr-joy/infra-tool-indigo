import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { type TaoReleaseTasksBody, type TaoMotReleaseTaskBody, type ReleaseSyncBody } from '../types.js';
import { normalizeTaskLinks, parseTaskLinks, toMinutes, toTime, HttpError, sendRouteError, emergencyBatchKeyOf, hashEmergencyDefinitionSnapshot } from '../lib/utils.js';
import { vietnamDateKey } from '../lib/vn-time.js';
import {
  buildDefinitionTargetPayload, diffTaskAgainstDefinition, buildReleaseUpdateStatement,
  compareReleaseTaskDefinitions, type ReleaseTaskDefinitionRow, type DefinitionTargetPayload, type TaskRowForDiff
} from '../lib/release-render.js';

const router = Router();

// ── Sync definition -> task đã sinh (không phá) ────────────────────────────────
// CR-20260814-hop-nhat-dong-bo-definition-xuong-task: MỘT luật ghi duy nhất (FR-1), match
// theo (release_month, origin_ref), UPDATE tại chỗ — không còn DELETE+INSERT theo tên (xem
// BUG-20260814: đổi tên definition từng làm mất task đã chạy vì match theo `ten_task`).
// Ma trận an toàn:
//  - task chưa/đang làm, ngày chưa qua, có field lệch  -> UPDATE (content + giờ).
//  - task đã hoàn thành / đã hủy                        -> BỎ QUA (giữ lịch sử, không hồi sinh).
//  - ngày cụ thể đã qua (lỡ)                            -> BỎ QUA.
//  - không có task khớp trong đợt                       -> BỎ QUA ('sync' cả đợt) hoặc TẠO MỚI
//    ('lưu 1 definition' — đường duy nhất được phép insert, xem allowInsert).
//  - không lệch gì                                      -> BỎ QUA.
// Ngày của task release đã QUA chưa — so theo NGÀY VIỆT NAM.
//
// Trước đây hàm này cắt ngày bằng giờ MÁY. Máy đặt Asia/Tokyo: sau 22:00 VN (= 00:00 JST hôm sau)
// "hôm nay" đã là ngày mai theo VN, nên task của ĐÚNG HÔM NAY bị xếp `skipped: 'past'` và **bị bỏ
// im lặng** khỏi lượt sync — người dùng không thấy lỗi nào, chỉ thấy task không được cập nhật
// (BUG-20260804 §7).
//
// Tách thành hàm thuần nhận `now`: query DB bên trong vòng lặp nên không unit test được nếu
// không dựng DB fixture (qa-standard §1.5).
export function isPastReleaseTaskDate(ngayCuThe: string | null | undefined, now: Date): boolean {
  if (!ngayCuThe) return false;
  return ngayCuThe < vietnamDateKey(now);
}

interface WritePlanItem {
  mode: 'update' | 'insert';
  taskId?: number;
  originRef: string;
  title: string;
  changedFields: string[];
  releaseDate: string;
  target: DefinitionTargetPayload;
}
interface WriteSkip { originRef: string; title: string; reason: 'done' | 'canceled' | 'past' | 'unchanged' | 'missing'; }

function loadTemplatesMap(): Map<string, string> {
  const rows = db.prepare('SELECT id, content FROM release_templates').all() as { id: string; content: string }[];
  return new Map(rows.map((r) => [r.id, r.content]));
}

function loadDefinitions(definitionIds?: string[]): ReleaseTaskDefinitionRow[] {
  if (definitionIds && definitionIds.length > 0) {
    const placeholders = definitionIds.map(() => '?').join(', ');
    return db.prepare(`SELECT * FROM release_task_definitions WHERE id IN (${placeholders})`).all(...definitionIds) as unknown as ReleaseTaskDefinitionRow[];
  }
  return db.prepare('SELECT * FROM release_task_definitions').all() as unknown as ReleaseTaskDefinitionRow[];
}

// MỘT lượt truy vấn cho toàn bộ task của đợt, key theo origin_ref (Codex §14 P2 #4 — tránh N+1
// khi phân loại nhiều definition cùng lúc, dùng chung cho cả preview/apply lẫn drift FR-5).
function loadTasksByOriginRef(releaseMonth: string): Map<string, Record<string, unknown>> {
  const rows = db.prepare("SELECT * FROM tasks WHERE release_month = ? AND origin_ref IS NOT NULL AND origin_ref != ''")
    .all(releaseMonth) as Record<string, unknown>[];
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) map.set(String(row.origin_ref), row);
  return map;
}

// Lõi phân loại DÙNG CHUNG cho "lưu 1 definition" (đường 1, allowInsert=true, cần releaseDate vì
// task có thể chưa tồn tại) và "đồng bộ cả đợt" (đường 2, allowInsert=false, không backfill task
// còn thiếu — giữ đúng phạm vi cũ). Không nhận payload FE dựng sẵn (FR-10) — tự đọc definition +
// template theo `origin_ref`, tự render bằng release_date của CHÍNH task đó (mỗi task tự mang
// theo ngày release của nó, không cần suy đoán "đợt đang mở là ngày nào").
function planReleaseWrite(
  releaseMonth: string, definitionIds: string[] | undefined, now: Date,
  opts: { allowInsert: boolean; releaseDateForInsert?: string }
): { willUpdate: WritePlanItem[]; willInsert: WritePlanItem[]; skipped: WriteSkip[] } {
  const definitions = [...loadDefinitions(definitionIds)].sort(compareReleaseTaskDefinitions);
  const templates = loadTemplatesMap();
  const tasksByOriginRef = loadTasksByOriginRef(releaseMonth);
  const willUpdate: WritePlanItem[] = [];
  const willInsert: WritePlanItem[] = [];
  const skipped: WriteSkip[] = [];

  for (const definition of definitions) {
    const templateContent = definition.template_id ? (templates.get(String(definition.template_id)) ?? null) : null;
    const task = tasksByOriginRef.get(definition.id);

    if (!task) {
      if (opts.allowInsert) {
        if (!opts.releaseDateForInsert) throw new HttpError(500, 'Thiếu releaseDate để tạo task release mới');
        const target = buildDefinitionTargetPayload(definition, opts.releaseDateForInsert, templateContent);
        willInsert.push({
          mode: 'insert', originRef: definition.id, title: target.tenTask, changedFields: [],
          releaseDate: opts.releaseDateForInsert, target
        });
      } else {
        skipped.push({ originRef: definition.id, title: definition.title, reason: 'missing' });
      }
      continue;
    }

    const title = definition.title;
    if (task.trang_thai === 'da_hoan_thanh') { skipped.push({ originRef: definition.id, title, reason: 'done' }); continue; }
    if (task.trang_thai === 'canceled') { skipped.push({ originRef: definition.id, title, reason: 'canceled' }); continue; }
    const oldDate = task.ngay_cu_the == null ? null : String(task.ngay_cu_the);
    if (isPastReleaseTaskDate(oldDate, now)) { skipped.push({ originRef: definition.id, title, reason: 'past' }); continue; }

    // Mỗi task tự mang release_date của chính nó — không cần tham số ngoài để render template.
    const releaseDateForTask = task.release_date == null ? opts.releaseDateForInsert : String(task.release_date);
    if (!releaseDateForTask) { skipped.push({ originRef: definition.id, title, reason: 'missing' }); continue; }
    const target = buildDefinitionTargetPayload(definition, releaseDateForTask, templateContent);

    const changedFields = diffTaskAgainstDefinition(task as unknown as TaskRowForDiff, target);
    if (changedFields.length === 0) { skipped.push({ originRef: definition.id, title, reason: 'unchanged' }); continue; }

    willUpdate.push({
      mode: 'update', taskId: Number(task.id), originRef: definition.id, title, changedFields,
      releaseDate: releaseDateForTask, target
    });
  }
  return { willUpdate, willInsert, skipped };
}

function applyUpdate(item: WritePlanItem & { taskId: number }) {
  const { sql, params } = buildReleaseUpdateStatement(item.target, item.taskId);
  db.prepare(sql).run(...params);
}

const INSERT_RELEASE_TASK = db.prepare(`
  INSERT INTO tasks (
    ten_task, ghi_chu, loai_task, do_uu_tien, trang_thai, ngay_tao, gio_bat_dau, gio_ket_thuc,
    lap_lai_kieu, ngay_trong_thang, thu_trong_tuan, ngay_cu_the, release_month, release_date, task_links,
    origin_ref, reply_to_ref
  )
  VALUES (?, ?, 'dinh_ky', NULL, 'chua_thuc_hien', ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
`);

function applyInsert(item: WritePlanItem, releaseMonth: string, now: string) {
  const t = item.target;
  INSERT_RELEASE_TASK.run(
    t.tenTask, t.ghiChu ?? '', now, t.gioBatDau, t.gioKetThuc, t.ngayCuThe,
    releaseMonth, item.releaseDate, t.linksJson, item.originRef, t.replyToRef
  );
}

function validateReleaseMonth(body: ReleaseSyncBody) {
  const releaseMonth = body.releaseMonth?.trim();
  if (!releaseMonth) throw new HttpError(400, 'Thiếu release_month');
  return { releaseMonth, originRefs: Array.isArray(body.originRefs) ? body.originRefs.filter(Boolean) : undefined };
}

router.post('/schedules/release/sync-preview', (req, res) => {
  try {
    const { releaseMonth, originRefs } = validateReleaseMonth(req.body as ReleaseSyncBody);
    const { willUpdate, skipped } = planReleaseWrite(releaseMonth, originRefs, new Date(), { allowInsert: false });
    res.json({
      willUpdate: willUpdate.map(({ taskId, originRef, title, changedFields }) => ({ taskId, originRef, title, changedFields })),
      skipped
    });
  } catch (error) {
    sendRouteError(res, error, 'Không thể xem trước đồng bộ');
  }
});

router.post('/schedules/release/sync', (req, res) => {
  try {
    const { releaseMonth, originRefs } = validateReleaseMonth(req.body as ReleaseSyncBody);
    // AC-10 (chống race preview<->apply): plan được tính LẠI từ đầu ngay trong request này, đọc
    // thẳng DB hiện tại — không nhận lại giá trị đã tính từ lượt preview trước đó. Cột nào không
    // đổi (vd. `ghi_chu` khi không có template) thì UPDATE không set cột đó (FR-4/FR-8), nên
    // không có bước "đọc giá trị cũ rồi ghi lại" nào có thể bị lệch vì user sửa giữa chừng.
    const { willUpdate, skipped } = planReleaseWrite(releaseMonth, originRefs, new Date(), { allowInsert: false });
    db.exec('BEGIN TRANSACTION');
    try {
      for (const item of willUpdate) {
        applyUpdate(item as typeof item & { taskId: number });
      }
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
    res.json({ updated: willUpdate.length, skipped: skipped.length });
  } catch (error) {
    sendRouteError(res, error, 'Không thể đồng bộ task release');
  }
});

router.post('/schedules/regular-release/tasks', (req, res) => {
  const body = req.body as TaoReleaseTasksBody;
  if (!body.releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.releaseDate)) {
    return res.status(400).json({ message: 'Ngày release không hợp lệ' });
  }
  if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
    return res.status(400).json({ message: 'Danh sách task không hợp lệ' });
  }

  const releaseMonth = body.releaseDate.slice(0, 7);
  const releaseTaskNames = [
    ...new Set(body.tasks.map((task) => task.tenTask?.trim()).filter((v): v is string => Boolean(v)))
  ];
  const legacyPlaceholders = releaseTaskNames.map(() => '?').join(', ');
  // tz-ok: ngay-lich-round-trip — doc lai ngay bang chinh mui gio may da dung Date
  const toDateInput = (date: Date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
  const legacyWindowStart = `${releaseMonth}-01`;
  const [releaseYear, releaseMonthNumber] = releaseMonth.split('-').map(Number);
  // 3 mốc dưới là PHÉP LỊCH thuần từ chuỗi `yyyy-mm` (cuối tháng / cửa sổ ±34-35 ngày), không đọc
  // đồng hồ nên không có gì để lệch múi giờ: dựng bằng giờ máy rồi đọc lại bằng giờ máy.
  // tz-ok: ngay-lich-round-trip
  const legacyWindowEnd = toDateInput(new Date(releaseYear, releaseMonthNumber, 0));
  // tz-ok: ngay-lich-round-trip
  const legacyDeleteWindowStart = toDateInput(new Date(releaseYear, releaseMonthNumber - 1, -34));
  // tz-ok: ngay-lich-round-trip
  const legacyDeleteWindowEnd = toDateInput(new Date(releaseYear, releaseMonthNumber, 35));
  const legacyWhere = legacyPlaceholders
    ? ` OR (release_month IS NULL AND loai_task = 'dinh_ky' AND ngay_cu_the BETWEEN ? AND ? AND ten_task IN (${legacyPlaceholders}))`
    : '';
  const legacyDeleteWhere = legacyPlaceholders
    ? ` OR (release_month IS NULL AND loai_task = 'dinh_ky' AND ngay_cu_the BETWEEN ? AND ? AND ten_task IN (${legacyPlaceholders}))`
    : '';
  const existing = db.prepare(`SELECT COUNT(*) AS total FROM tasks WHERE release_month = ?${legacyWhere}`)
    .get(releaseMonth, ...(legacyPlaceholders ? [legacyWindowStart, legacyWindowEnd, ...releaseTaskNames] : [])) as { total: number };
  if (existing.total > 0 && !body.force) {
    return res.status(409).json({
      code: 'REGULAR_RELEASE_EXISTS',
      message: 'Đã có task tồn tại, bạn có muốn tạo lại hay không'
    });
  }

  const timePattern = /^\d{2}:\d{2}$/;
  const insert = db.prepare(`
    INSERT INTO tasks (
      ten_task, ghi_chu, loai_task, do_uu_tien, trang_thai, ngay_tao, gio_bat_dau, gio_ket_thuc,
      lap_lai_kieu, ngay_trong_thang, thu_trong_tuan, ngay_cu_the, release_month, release_date, task_links,
      origin_ref, reply_to_ref
    )
    VALUES (?, ?, 'dinh_ky', NULL, 'chua_thuc_hien', ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
  `);
  const normalizeStart = (value: string) => toTime(Math.min(17 * 60 + 45, Math.max(7 * 60 + 30, toMinutes(value))));
  const now = new Date().toISOString();

  // Council thiết kế run 7fd3e4d1 (xem docs/exchanges/2026-09-12.md): backend LUÔN là nguồn thẩm
  // quyền duy nhất cho replyToRef khi task khai báo originRef — KHÔNG tin giá trị task.replyToRef do
  // FE gửi (trước đây ghi thẳng xuống DB, không đối chiếu — có thể là dữ liệu cũ/giả). Nạp trước 1
  // lượt toàn bộ definition được originRef nào đó trong lô này tham chiếu (tránh N+1), đồng thời phát
  // hiện SỚM originRef không resolve được để 409 + rollback TOÀN BỘ lô trước khi ghi bất kỳ dòng nào —
  // nhất quán với cách emergency đã làm từ trước (tinhRevisionHashTuOriginRef bên dưới).
  const originRefs = [...new Set(
    (body.tasks || []).map((t) => t.originRef?.trim()).filter((v): v is string => Boolean(v))
  )];
  const replyToByOriginRef = new Map<string, string | null>();
  if (originRefs.length > 0) {
    const originRefPlaceholders = originRefs.map(() => '?').join(', ');
    const rows = db.prepare(`SELECT id, reply_to_definition_id FROM release_task_definitions WHERE id IN (${originRefPlaceholders})`)
      .all(...originRefs) as { id: string; reply_to_definition_id: string | null }[];
    for (const row of rows) replyToByOriginRef.set(row.id, row.reply_to_definition_id);
  }

  try {
    db.exec('BEGIN TRANSACTION');
    // Xoá-tạo-lại theo TÊN ở đây là hành động NGƯỜI DÙNG CHỦ ĐỘNG XÁC NHẬN qua cổng 409 phía trên
    // (`force=true` sau khi được hỏi lại) — khác hẳn nhánh "lưu 1 definition" bên dưới, vốn chạy
    // IM LẶNG mỗi lần bấm Lưu và chính là nguồn gây BUG-20260814. Không thuộc phạm vi FR-1/FR-2.
    // ten-task-match-ok: xoa-tao-lai-ca-dot-co-xac-nhan-nguoi-dung-qua-409-force
    if (body.force) {
      db.prepare(`DELETE FROM tasks WHERE release_month = ?${legacyDeleteWhere}`)
        .run(releaseMonth, ...(legacyPlaceholders ? [legacyDeleteWindowStart, legacyDeleteWindowEnd, ...releaseTaskNames] : []));
    }
    for (const task of body.tasks || []) {
      if (!task.tenTask?.trim() || !task.ngayCuThe || !/^\d{4}-\d{2}-\d{2}$/.test(task.ngayCuThe) || !task.gioBatDau || !timePattern.test(task.gioBatDau)) {
        throw new HttpError(400, 'Task release không hợp lệ');
      }
      const normalizedStart = normalizeStart(task.gioBatDau);
      const start = toMinutes(normalizedStart);
      const end = start + 15;
      if (start < 7 * 60 + 30 || end > 18 * 60) throw new HttpError(400, 'Khoảng giờ task release không hợp lệ');
      const originRef = task.originRef?.trim() || null;
      let replyToRef: string | null = null;
      if (originRef) {
        if (!replyToByOriginRef.has(originRef)) {
          throw new HttpError(409, `Definition '${originRef}' không còn tồn tại — tải lại danh sách task rồi thử lại (task "${task.tenTask.trim()}").`);
        }
        replyToRef = replyToByOriginRef.get(originRef) ?? null;
      }
      insert.run(task.tenTask.trim(), task.ghiChu?.trim() || '', now, normalizedStart, toTime(end), task.ngayCuThe, releaseMonth, body.releaseDate, JSON.stringify(normalizeTaskLinks(task.links)), originRef, replyToRef);
    }
    db.exec('COMMIT');
    res.status(201).json({ created: body.tasks!.length });
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    sendRouteError(res, error, 'Không thể tạo task release');
  }
});

router.post('/schedules/regular-release/task', (req, res) => {
  try {
    const body = req.body as TaoMotReleaseTaskBody;
    const releaseDate = body.releaseDate?.trim();
    const definitionId = body.definitionId?.trim();
    if (!releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) throw new HttpError(400, 'Ngày release không hợp lệ');
    if (!definitionId) throw new HttpError(400, 'Thiếu definitionId');

    const releaseMonth = releaseDate.slice(0, 7);
    const { willUpdate, willInsert, skipped } = planReleaseWrite(releaseMonth, [definitionId], new Date(), {
      allowInsert: true, releaseDateForInsert: releaseDate
    });
    // Council code-review (run 581517e4, 2026-09-12): `definitionId` không resolve được (đã xoá/sai id)
    // -> loadDefinitions() trả mảng rỗng -> CẢ BA mảng willInsert/willUpdate/skipped đều rỗng. Trước đây
    // rơi xuống nhánh `skipped[0]?.reason || 'unchanged'` bên dưới, báo THÀNH CÔNG im lặng — sai với
    // nguyên tắc "originRef/definitionId không resolve = lỗi cứng 409" đã áp dụng cho 2 đường tạo task
    // còn lại (regular-bulk, emergency).
    if (willInsert.length === 0 && willUpdate.length === 0 && skipped.length === 0) {
      throw new HttpError(409, `Definition '${definitionId}' không còn tồn tại — tải lại danh sách task rồi thử lại.`);
    }

    const now = new Date().toISOString();
    db.exec('BEGIN TRANSACTION');
    try {
      if (willInsert.length > 0) {
        applyInsert(willInsert[0], releaseMonth, now);
        db.exec('COMMIT');
        return res.status(201).json({ created: 1, updated: 0 });
      }
      if (willUpdate.length > 0) {
        applyUpdate(willUpdate[0] as typeof willUpdate[0] & { taskId: number });
        db.exec('COMMIT');
        return res.status(200).json({ created: 0, updated: 1, changedFields: willUpdate[0].changedFields });
      }
      db.exec('COMMIT');
      const reason = skipped[0]?.reason;
      return res.status(200).json({ created: 0, updated: 0, skipped: reason || 'unchanged' });
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    sendRouteError(res, error, 'Không thể tạo task release');
  }
});

// FR-5: phát hiện lệch CHỦ ĐỘNG, không cần bấm gì. Chỉ đọc, MỘT lượt truy vấn task + definitions +
// templates của đợt rồi tự phân loại (Codex §14 P2 #4 — không N+1, vì màn Release gọi mỗi lần mở).
router.get('/schedules/release/drift', (req, res) => {
  try {
    const releaseMonth = String(req.query.releaseMonth || '').trim();
    if (!releaseMonth) throw new HttpError(400, 'Thiếu release_month');

    const definitions = loadDefinitions();
    const definitionsById = new Map(definitions.map((d) => [d.id, d]));
    const templates = loadTemplatesMap();
    const now = new Date();

    const tasks = db.prepare('SELECT * FROM tasks WHERE release_month = ?').all(releaseMonth) as Record<string, unknown>[];

    const lech: { taskId: number; originRef: string; title: string; fields: string[] }[] = [];
    const boQua: { originRef: string; title: string; reason: string }[] = [];
    const khongXacDinhNguon: { taskId: number; title: string }[] = [];

    for (const task of tasks) {
      const originRef = task.origin_ref == null ? '' : String(task.origin_ref);
      if (!originRef) { khongXacDinhNguon.push({ taskId: Number(task.id), title: String(task.ten_task) }); continue; }
      const definition = definitionsById.get(originRef);
      if (!definition) { khongXacDinhNguon.push({ taskId: Number(task.id), title: String(task.ten_task) }); continue; }
      if (task.trang_thai === 'da_hoan_thanh') { boQua.push({ originRef, title: definition.title, reason: 'done' }); continue; }
      if (task.trang_thai === 'canceled') { boQua.push({ originRef, title: definition.title, reason: 'canceled' }); continue; }
      const oldDate = task.ngay_cu_the == null ? null : String(task.ngay_cu_the);
      if (isPastReleaseTaskDate(oldDate, now)) { boQua.push({ originRef, title: definition.title, reason: 'past' }); continue; }

      const releaseDateForTask = task.release_date == null ? null : String(task.release_date);
      if (!releaseDateForTask) { khongXacDinhNguon.push({ taskId: Number(task.id), title: String(task.ten_task) }); continue; }
      const templateContent = definition.template_id ? (templates.get(String(definition.template_id)) ?? null) : null;
      const target = buildDefinitionTargetPayload(definition, releaseDateForTask, templateContent);
      const fields = diffTaskAgainstDefinition(task as unknown as TaskRowForDiff, target);
      if (fields.length > 0) lech.push({ taskId: Number(task.id), originRef, title: definition.title, fields });
    }

    res.json({ lech, boQua, khongXacDinhNguon });
  } catch (error) {
    sendRouteError(res, error, 'Không thể kiểm tra lệch definition');
  }
});

// Codex review §4.49 Medium #4: UI checkbox chỉ cho chọn Dr.JOY/Pr.JOY và giới hạn số team, nhưng đó
// không bảo vệ được API gọi trực tiếp — đóng enum/kích thước ở TẦNG BACKEND, dùng chung cho cả POST
// (giai đoạn 1) lẫn PATCH (đổi batch đã tồn tại).
const VALID_EMERGENCY_SYSTEMS = new Set(['Dr.JOY', 'Pr.JOY']);
const MAX_EMERGENCY_TEAMS = 20;
const MAX_EMERGENCY_TEAM_LABEL_LEN = 100;

function parseEmergencyBatchTeamsSystems(rawTeams: unknown, rawSystems: unknown): { teams: string[]; systems: string[] } | { error: string } {
  const teams = [...new Set((Array.isArray(rawTeams) ? rawTeams : []).map((t) => String(t).trim()).filter(Boolean))].sort();
  const systems = [...new Set((Array.isArray(rawSystems) ? rawSystems : []).map((s) => String(s).trim()).filter(Boolean))].sort();
  if (teams.length > MAX_EMERGENCY_TEAMS) return { error: `Tối đa ${MAX_EMERGENCY_TEAMS} team tham gia` };
  if (teams.some((t) => t.length > MAX_EMERGENCY_TEAM_LABEL_LEN)) {
    return { error: `Tên team quá dài (tối đa ${MAX_EMERGENCY_TEAM_LABEL_LEN} ký tự)` };
  }
  if (systems.some((s) => !VALID_EMERGENCY_SYSTEMS.has(s))) {
    return { error: "Hệ thống ảnh hưởng chỉ nhận 'Dr.JOY' hoặc 'Pr.JOY'" };
  }
  return { teams, systems };
}

router.post('/schedules/emergency-release/tasks', (req, res) => {
  const body = req.body as TaoReleaseTasksBody;
  if (!body.releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.releaseDate)) {
    return res.status(400).json({ message: 'Ngày release khẩn cấp không hợp lệ' });
  }
  if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
    return res.status(400).json({ message: 'Danh sách task không hợp lệ' });
  }

  const timePattern = /^\d{2}:\d{2}$/;
  const taskNames = [...new Set(body.tasks.map((task) => task.tenTask?.trim()).filter((v): v is string => Boolean(v)))];
  const placeholders = taskNames.map(() => '?').join(', ');
  const insert = db.prepare(`
    INSERT INTO tasks (
      ten_task, ghi_chu, loai_task, do_uu_tien, trang_thai, ngay_tao, gio_bat_dau, gio_ket_thuc,
      lap_lai_kieu, ngay_trong_thang, thu_trong_tuan, ngay_cu_the, release_month, release_date, task_links,
      origin_ref, reply_to_ref
    )
    VALUES (?, ?, 'dinh_ky', NULL, 'chua_thuc_hien', ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
  `);
  const layDefinitionChoKiemTraRevision = db.prepare(
    'SELECT note, template_id, reply_to_definition_id FROM emergency_release_task_definitions WHERE id = ?'
  );
  const layTemplateContentChoKiemTraRevision = db.prepare('SELECT content FROM emergency_release_templates WHERE id = ?');
  interface DinhNghiaChoKiemTraRevision { note: string | null; template_id: string | null; reply_to_definition_id: string | null; }
  // `null` = KHÔNG có originRef (task không gắn definition nào — hợp lệ, giữ nguyên NULL theo quy tắc
  // legacy). Definition không resolve được (đã xoá) THÌ KHÔNG trả `null` im lặng nữa — ném lỗi ngay, vì
  // đây là request TẠO MỚI, có đủ thông tin để biết chắc origin đã stale, khác hẳn precheck của task cũ
  // (AC-6b chỉ áp dụng cho dữ liệu ĐÃ TỒN TẠI trước khi biết gì hơn, không áp dụng lúc tạo task mới).
  //
  // Council thiết kế run 7fd3e4d1 (xem docs/exchanges/2026-09-12.md): trả kèm `replyToDefinitionId` từ
  // CHÍNH definition này — backend LUÔN là nguồn thẩm quyền cho replyToRef, không tin task.replyToRef
  // do FE gửi (trước đây ghi thẳng xuống DB, không hề đối chiếu với definition thật).
  function layThongTinDinhNghiaChoTaoTask(originRef: string, tenTaskDeBaoLoi: string): { hash: string; replyToDefinitionId: string | null } {
    const definition = layDefinitionChoKiemTraRevision.get(originRef) as DinhNghiaChoKiemTraRevision | undefined;
    if (!definition) {
      throw new HttpError(409, `Definition '${originRef}' không còn tồn tại — tải lại danh sách task rồi thử lại (task "${tenTaskDeBaoLoi}").`);
    }
    const templateContent = definition.template_id
      ? ((layTemplateContentChoKiemTraRevision.get(definition.template_id) as { content: string } | undefined)?.content ?? null)
      : null;
    return {
      hash: hashEmergencyDefinitionSnapshot(definition.note, definition.template_id, templateContent),
      replyToDefinitionId: definition.reply_to_definition_id
    };
  }
  const now = new Date().toISOString();
  const releaseMonth = body.releaseKey?.trim() || `emergency:${body.releaseDate}`;
  const existing = db.prepare('SELECT COUNT(*) AS total FROM tasks WHERE release_month = ?')
    .get(releaseMonth) as { total: number };
  if (existing.total > 0 && !body.force && !body.replaceMatching) {
    return res.status(409).json({
      code: 'EMERGENCY_RELEASE_EXISTS',
      message: 'Đã có task khẩn cấp tồn tại, bạn có muốn tạo lại hay không'
    });
  }

  // CR-20260822 FR-3: nguồn canonical team/hệ thống của cả đợt — CHỈ ghi ở giai đoạn 1 (releaseKey
  // KHÔNG có hậu tố `:schedule`; giai đoạn 2 dùng `${releaseKey}:schedule`, xem emergencyBatchKeyOf).
  // Giai đoạn 2 không đụng gì tới bảng này (Announcement E6/E7 đọc lại đúng batch giai đoạn 1 đã tạo).
  const laGiaiDoan1 = emergencyBatchKeyOf(releaseMonth) === releaseMonth;
  let teamsJson: string | null = null;
  let systemsJson: string | null = null;
  if (laGiaiDoan1) {
    const parsedTeamsSystems = parseEmergencyBatchTeamsSystems(body.teams, body.systems);
    if ('error' in parsedTeamsSystems) return res.status(400).json({ message: parsedTeamsSystems.error });
    const { teams, systems } = parsedTeamsSystems;
    if (teams.length === 0 || systems.length === 0) {
      return res.status(400).json({ message: 'Thiếu team tham gia hoặc hệ thống ảnh hưởng cho đợt khẩn cấp' });
    }
    teamsJson = JSON.stringify(teams);
    systemsJson = JSON.stringify(systems);
    // Codex review §4.49 High #1: kiểm tra mismatch này KHÔNG được phép bị `force` bỏ qua — `force` chỉ
    // có nghĩa "xoá-tạo-lại TASK của đợt", không phải "được phép đổi teams/systems canonical bỏ qua guard
    // bất biến". Nếu không, `force=true` có thể đổi team/hệ thống của 1 batch đã preview/duyệt/đăng mà
    // KHÔNG đi qua guard "không còn task Announcement non-idle" của PATCH — bài đã đăng ngoài đời vẫn
    // còn nhưng dấu vết batch trong app bị âm thầm ghi đè (trái FR-3/AC-29/AC-31/AC-31b). Muốn đổi
    // teams/systems của batch đã tồn tại PHẢI qua PATCH /schedules/emergency-release/batches/:releaseMonth.
    const batchCu = db.prepare('SELECT teams, systems FROM emergency_release_batches WHERE release_month = ?')
      .get(releaseMonth) as { teams: string; systems: string } | undefined;
    if (batchCu && (batchCu.teams !== teamsJson || batchCu.systems !== systemsJson)) {
      return res.status(409).json({
        code: 'EMERGENCY_BATCH_TEAMS_MISMATCH',
        message: 'Team/hệ thống của đợt này đã khác dữ liệu đang lưu — dùng PATCH /release/emergency-batches/:releaseMonth (có xác nhận) để đổi, không tự ghi đè.'
      });
    }
  }

  try {
    db.exec('BEGIN TRANSACTION');
    if (body.force) {
      // KHÔNG đụng `emergency_release_batches` ở đây (Codex §4.49 High #1) — teams/systems ở trên đã
      // được đảm bảo KHỚP dữ liệu đang lưu (hoặc batch chưa tồn tại) trước khi vào transaction; `force`
      // chỉ xoá-tạo-lại TASK, không xoá/ghi đè batch canonical (giữ dấu vết audit + không lách guard PATCH).
      db.prepare('DELETE FROM tasks WHERE release_month = ?').run(releaseMonth);
    } else if (body.replaceMatching && placeholders) {
      // Đợt khẩn cấp sinh mới theo từng sự cố (rủi ro thấp hơn định kỳ, xem CR-20260814 §2 "ngoài
      // phạm vi") và người dùng đã xác nhận muốn thay thế qua `replaceMatching` — match theo tên
      // ở đây là lựa chọn có ý thức, không phải lỗi im lặng như đường (1) cũ.
      // ten-task-match-ok: emergency-replace-matching-nguoi-dung-tu-chon-thay-the-theo-ten
      db.prepare(`DELETE FROM tasks WHERE release_month = ? AND ten_task IN (${placeholders})`).run(releaseMonth, ...taskNames);
    }
    if (laGiaiDoan1 && teamsJson && systemsJson) {
      db.prepare(`
        INSERT INTO emergency_release_batches (release_month, teams, systems, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(release_month) DO UPDATE SET teams = excluded.teams, systems = excluded.systems, updated_at = excluded.updated_at
      `).run(releaseMonth, teamsJson, systemsJson, now, now);
    }
    for (const task of body.tasks) {
      if (!task.tenTask?.trim() || !task.ngayCuThe || !/^\d{4}-\d{2}-\d{2}$/.test(task.ngayCuThe) || !task.gioBatDau || !timePattern.test(task.gioBatDau)) {
        throw new HttpError(400, 'Task release khẩn cấp không hợp lệ');
      }
      const start = toMinutes(task.gioBatDau);
      const end = start + 15;
      if (start < 0 || end > 24 * 60) throw new HttpError(400, 'Khoảng giờ task release khẩn cấp không hợp lệ');
      const originRef = task.originRef?.trim() || null;
      let replyToRef: string | null = null;

      // Codex §4.51/§4.53 High (TOCTOU): FE render `ghiChu` từ definition/template lúc TẢI (revision A).
      // Nếu definition bị SỬA hoặc XOÁ trước khi request này tới server, KHÔNG được tự ý cho qua — đây là
      // request TẠO MỚI với đủ thông tin để biết chắc origin có còn hợp lệ hay không, khác hẳn nhánh
      // tương thích dữ liệu cũ (AC-6b) của gate lúc PRECHECK. Definition không resolve được (đã xoá)
      // hoặc revision lệch (đã sửa) đều 409, rollback CẢ transaction — không chỉ task đó.
      if (originRef) {
        const { hash, replyToDefinitionId } = layThongTinDinhNghiaChoTaoTask(originRef, task.tenTask?.trim() || '');
        const declaredRevision = task.definitionRevision?.trim() || null;
        if (!declaredRevision || declaredRevision !== hash) {
          throw new HttpError(409, `Definition '${originRef}' đã bị sửa sau khi tải trang — tải lại danh sách task rồi thử lại (task "${task.tenTask?.trim() || ''}").`);
        }
        replyToRef = replyToDefinitionId;
      }
      insert.run(task.tenTask.trim(), task.ghiChu?.trim() || '', now, task.gioBatDau, toTime(end), task.ngayCuThe, releaseMonth, body.releaseDate, JSON.stringify(normalizeTaskLinks(task.links)), originRef, replyToRef);
    }
    db.exec('COMMIT');
    res.status(201).json({ created: body.tasks.length });
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    sendRouteError(res, error, 'Không thể tạo task release khẩn cấp');
  }
});

router.patch('/schedules/emergency-release/batches/:releaseMonth', (req, res) => {
  const releaseMonth = String(req.params.releaseMonth || '').trim();
  if (!releaseMonth) return res.status(400).json({ message: 'release_month không hợp lệ' });
  const body = req.body as { teams?: string[]; systems?: string[] };

  const parsedTeamsSystems = parseEmergencyBatchTeamsSystems(body.teams, body.systems);
  if ('error' in parsedTeamsSystems) return res.status(400).json({ message: parsedTeamsSystems.error });
  const { teams, systems } = parsedTeamsSystems;
  if (teams.length === 0 || systems.length === 0) {
    return res.status(400).json({ message: 'Thiếu team tham gia hoặc hệ thống ảnh hưởng' });
  }

  try {
    const result = withTransaction(() => {
      const batch = db.prepare('SELECT teams, systems FROM emergency_release_batches WHERE release_month = ?')
        .get(releaseMonth) as { teams: string; systems: string } | undefined;
      if (!batch) throw new HttpError(404, 'Chưa có batch nào cho release_month này — tạo qua task giai đoạn 1 trước');

      const now = new Date().toISOString();
      const teamsJsonMoi = JSON.stringify(teams);
      const systemsJsonMoi = JSON.stringify(systems);
      db.prepare('UPDATE emergency_release_batches SET teams = ?, systems = ?, updated_at = ? WHERE release_month = ?')
        .run(teamsJsonMoi, systemsJsonMoi, now, releaseMonth);

      return { releaseMonth, teams, systems };
    });
    res.json(result);
  } catch (error) {
    sendRouteError(res, error, 'Không thể cập nhật batch');
  }
});

router.delete('/schedules/emergency-release/tasks', (req, res) => {
  const releaseKey = String(req.query.releaseKey || '').trim();
  if (!releaseKey) return res.status(400).json({ message: 'Release key khẩn cấp không hợp lệ' });
  const result = db.prepare('DELETE FROM tasks WHERE release_month = ?').run(releaseKey);
  res.json({ deleted: result.changes });
});

export default router;
