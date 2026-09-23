import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { HttpError, sendRouteError } from '../lib/utils.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';
import { vietnamDateKey } from '../lib/vn-time.js';
import { VALID_EMERGENCY_SYSTEMS } from './schedules.js';
import {
  parseWallClock, wallClockDateKey, computeDeployDemoAt, findOrCreateEmergencyCycle,
  reconcileConflictsForCycle, forceRegistrationTimes, renderEmergencyPersonalTask,
  emergencyPersonalReleaseMonthKey, emergencyPersonalReleaseMonthPrefix, parseEmergencyPersonalLocale,
  likeEscape, regularPersonalReleaseMonthKey, type EmergencyRegistrationAnchors, type EmergencyDefinitionForGenerate
} from '../lib/release-schedule.js';
import type { EmergencyTemplateLocale } from '../lib/emergency-template-render.js';
import { buildDefinitionTargetPayload, type ReleaseTaskDefinitionRow } from '../lib/release-render.js';

// CR-20260913 Lát 6 — Release nhiều team: FR-23a (đăng ký/sửa lịch khẩn cấp của team mình), FR-24
// (lịch chung, lọc field), FR-25 (xung đột + ép giờ chung), FR-26 (khoá/mở/đồng bộ task cá nhân),
// FR-27 (huỷ đợt), FR-23b (1 ngày chính định kỳ do Leader điều phối ấn định), FR-28a nhánh "Khẩn cấp"
// (sinh task cá nhân khớp đúng lịch chính thức của team).
const router = Router();

const VALID_PLATFORMS = new Set(['Web', 'Mobile']);

function parseIntIdOrThrow(raw: unknown, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw new HttpError(400, `${label} không hợp lệ`);
  return id;
}

interface WallClockInput { date?: string; time?: string; }

function resolveWallClock(input: WallClockInput | undefined, label: string): string {
  const wc = input && parseWallClock(String(input.date || ''), String(input.time || ''));
  if (!wc) throw new HttpError(400, `${label} không hợp lệ`);
  return wc;
}

function parseAllowlistArray(raw: unknown, allowed: Set<string>, label: string): string[] {
  const arr = [...new Set((Array.isArray(raw) ? raw : []).map((v) => String(v).trim()).filter(Boolean))].sort();
  if (arr.length === 0) throw new HttpError(400, `Thiếu ${label}`);
  if (arr.some((v) => !allowed.has(v))) throw new HttpError(400, `${label} không hợp lệ`);
  return arr;
}

function parseTicketNumbers(raw: unknown): number[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'Mã ticket phải là mảng số nguyên dương');
  const nums = raw.map((v) => Number(v));
  if (nums.some((n) => !Number.isInteger(n) || n <= 0)) throw new HttpError(400, 'Mã ticket phải là số nguyên dương');
  return [...new Set(nums)];
}

// FR-23a: link trao đổi Nhật HOẶC lý do không có — đúng 1 trong 2, không cả hai cùng có/cùng trống.
function resolveJapanCoordination(link: unknown, reason: unknown): { link: string | null; reason: string | null } {
  const l = typeof link === 'string' ? link.trim() : '';
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (Boolean(l) === Boolean(r)) {
    throw new HttpError(400, 'Phải điền đúng 1 trong 2: link trao đổi với Nhật, hoặc lý do không có');
  }
  return { link: l || null, reason: r || null };
}

interface RegistrationRow {
  id: number; cycle_id: number; team_id: number;
  deploy_staging_at: string; release_at: string; deploy_demo_at: string;
  affected_systems: string; platforms: string; ticket_numbers: string;
  japan_coordination_link: string | null; no_japan_coordination_reason: string | null;
  notes: string; status: 'submitted' | 'locked' | 'cancelled';
  row_version: number; created_at: string; updated_at: string;
}

function loadRegistrationRow(id: number): RegistrationRow | undefined {
  return db.prepare('SELECT * FROM team_release_registrations WHERE id = ?').get(id) as RegistrationRow | undefined;
}

// FR-24: projection đầy đủ cho team sở hữu (và Admin xem trực tiếp qua các route khác) — ticket/link
// Nhật/ghi chú CHỈ xuất hiện ở đây.
function mapRegistrationFull(row: RegistrationRow) {
  return {
    id: row.id, cycleId: row.cycle_id, teamId: row.team_id,
    deployStagingAt: row.deploy_staging_at, releaseAt: row.release_at, deployDemoAt: row.deploy_demo_at,
    affectedSystems: JSON.parse(row.affected_systems || '[]'), platforms: JSON.parse(row.platforms || '[]'),
    ticketNumbers: JSON.parse(row.ticket_numbers || '[]'),
    japanCoordinationLink: row.japan_coordination_link, noJapanCoordinationReason: row.no_japan_coordination_reason,
    notes: row.notes, status: row.status, rowVersion: row.row_version,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

// FR-24: projection rút gọn cho team KHÁC — không có ticket/link Nhật/lý do/ghi chú.
function mapRegistrationBoard(row: RegistrationRow) {
  return {
    id: row.id, cycleId: row.cycle_id, teamId: row.team_id,
    deployStagingAt: row.deploy_staging_at, releaseAt: row.release_at, deployDemoAt: row.deploy_demo_at,
    affectedSystems: JSON.parse(row.affected_systems || '[]'), platforms: JSON.parse(row.platforms || '[]'),
    status: row.status
  };
}

function getReleaseCoordinatorTeamId(): number | null {
  const row = db.prepare('SELECT release_coordinator_team_id FROM app_config WHERE id = 1').get() as { release_coordinator_team_id: number | null };
  return row.release_coordinator_team_id;
}

// Bước 4 của authorize() (policyKind 'team_feature', resource 'release_coordinator') tự tra lại
// app_config — nhưng nếu chưa cấu hình ai là điều phối, không có `teamId` nào để làm scope, phải chặn
// tường minh Ở ĐÂY trước khi gọi authorize() (không có team nào để kiểm membership/vai trò).
function authorizeReleaseCoordinatorAction(actor: ReturnType<typeof actorFromRequest>, action: string): number {
  const coordinatorTeamId = getReleaseCoordinatorTeamId();
  if (coordinatorTeamId == null) {
    throw new HttpError(403, 'Chưa cấu hình team điều phối Release', 'NOT_RELEASE_COORDINATOR');
  }
  authorize({ actor, policyKind: 'team_feature', resource: 'release_coordinator', action, scope: { teamId: coordinatorTeamId } });
  return coordinatorTeamId;
}

// ── FR-26 bước 6 — huỷ đợt/registration chỉ huỷ task cá nhân CHƯA hoàn thành & CHƯA qua ngày ───────
function cancelPersonalEmergencyTasksForRegistration(cycleReleaseKey: string, teamId: number, now: string): void {
  const prefix = likeEscape(emergencyPersonalReleaseMonthPrefix(cycleReleaseKey, teamId));
  const todayVn = vietnamDateKey(new Date());
  db.prepare(`
    UPDATE tasks SET trang_thai = 'canceled'
    WHERE release_month LIKE ? ESCAPE '\\'
      AND trang_thai NOT IN ('da_hoan_thanh', 'canceled')
      AND (ngay_cu_the IS NULL OR ngay_cu_the >= ?)
  `).run(`${prefix}%`, todayVn);
  void now;
}

// ── FR-26 bước 5 — route/hàm MỚI HOÀN TOÀN: registration đổi giờ -> mọi task cá nhân đã sinh cho
// đúng team+cycle (CỦA MỌI User đã tự áp dụng, không chỉ actor đang thao tác) tự cập nhật lại giờ +
// nội dung (re-render đúng locale đã dùng lúc sinh, mã hoá trong chính release_month — xem
// server/lib/release-schedule.ts). Task đã hoàn thành/đã huỷ/đã qua ngày GIỮ NGUYÊN làm lịch sử.
function syncPersonalEmergencyTasksForRegistration(anchors: EmergencyRegistrationAnchors, now: string): number {
  const prefix = likeEscape(emergencyPersonalReleaseMonthPrefix(anchors.cycleReleaseKey, anchors.teamId));
  const tasks = db.prepare(`
    SELECT id, release_month, origin_ref, trang_thai, ngay_cu_the FROM tasks
    WHERE release_month LIKE ? ESCAPE '\\' AND origin_ref IS NOT NULL AND origin_ref != ''
  `).all(`${prefix}%`) as { id: number; release_month: string; origin_ref: string; trang_thai: string; ngay_cu_the: string | null }[];
  if (tasks.length === 0) return 0;

  const definitionIds = [...new Set(tasks.map((t) => t.origin_ref))];
  const placeholders = definitionIds.map(() => '?').join(',');
  const definitions = db.prepare(`SELECT * FROM emergency_release_task_definitions WHERE id IN (${placeholders})`)
    .all(...definitionIds) as Record<string, unknown>[];
  const defById = new Map(definitions.map((d) => [String(d.id), d]));
  const templateIds = [...new Set(definitions.map((d) => d.template_id).filter((v): v is string => Boolean(v)))];
  const templates = templateIds.length
    ? new Map((db.prepare(`SELECT id, content FROM emergency_release_templates WHERE id IN (${templateIds.map(() => '?').join(',')})`)
        .all(...templateIds) as { id: string; content: string }[]).map((t) => [t.id, t.content]))
    : new Map<string, string>();

  const todayVn = vietnamDateKey(new Date());
  const update = db.prepare('UPDATE tasks SET ten_task = ?, ghi_chu = ?, ngay_cu_the = ?, gio_bat_dau = ?, gio_ket_thuc = ?, task_links = ?, reply_to_ref = ? WHERE id = ?');
  let updated = 0;
  for (const task of tasks) {
    if (task.trang_thai === 'da_hoan_thanh' || task.trang_thai === 'canceled') continue;
    if (task.ngay_cu_the && task.ngay_cu_the < todayVn) continue;
    const def = defById.get(task.origin_ref);
    if (!def) continue;
    const locale: EmergencyTemplateLocale = parseEmergencyPersonalLocale(task.release_month);
    const definitionForGenerate: EmergencyDefinitionForGenerate = {
      id: String(def.id), title: String(def.title), note: String(def.note || ''),
      taskDate: String(def.task_date), startTime: String(def.start_time),
      relativeOffsetMinutes: def.relative_offset_minutes == null ? null : Number(def.relative_offset_minutes),
      templateContent: def.template_id ? (templates.get(String(def.template_id)) ?? null) : null,
      taskLinksJson: String(def.task_links || '[]'), replyToDefinitionId: def.reply_to_definition_id == null ? null : String(def.reply_to_definition_id)
    };
    const rendered = renderEmergencyPersonalTask(definitionForGenerate, anchors, locale);
    if (!rendered) continue;
    update.run(rendered.title, rendered.ghiChu, rendered.ngayCuThe, rendered.gioBatDau, rendered.gioKetThuc, rendered.linksJson, rendered.replyToRef, task.id);
    updated++;
  }
  return updated;
}

// ── FR-23a — đăng ký lịch release KHẨN CẤP của team mình ─────────────────────────────────────────
router.post('/release/schedule/registrations', requireSession, requireActiveAccount, (req, res) => {
  try {
    const actor = actorFromRequest(req);
    const body = req.body as {
      teamId?: number; deployStagingAt?: WallClockInput; releaseAt?: WallClockInput;
      affectedSystems?: unknown; platforms?: unknown; ticketNumbers?: unknown;
      japanCoordinationLink?: string; noJapanCoordinationReason?: string; notes?: string;
    };
    const teamId = parseIntIdOrThrow(body.teamId, 'teamId');
    authorize({ actor, policyKind: 'team_feature', resource: 'team_release_registration', action: 'create', scope: { teamId } });

    const deployStagingAt = resolveWallClock(body.deployStagingAt, 'Giờ deploy staging');
    const releaseAt = resolveWallClock(body.releaseAt, 'Giờ release');
    const deployDemoAt = computeDeployDemoAt(releaseAt);
    const affectedSystems = parseAllowlistArray(body.affectedSystems, VALID_EMERGENCY_SYSTEMS, 'hệ thống bị ảnh hưởng');
    const platforms = parseAllowlistArray(body.platforms, VALID_PLATFORMS, 'nền tảng bị ảnh hưởng');
    const ticketNumbers = parseTicketNumbers(body.ticketNumbers);
    const { link, reason } = resolveJapanCoordination(body.japanCoordinationLink, body.noJapanCoordinationReason);
    const notes = typeof body.notes === 'string' ? body.notes : '';

    const now = new Date().toISOString();
    const releaseDateKey = wallClockDateKey(releaseAt);

    const created = withTransaction(() => {
      const cycle = findOrCreateEmergencyCycle(db, releaseDateKey, actor.userId, now);
      const cycleRow = db.prepare('SELECT locked_at FROM release_cycles WHERE id = ?').get(cycle.id) as { locked_at: string | null };
      const already = db.prepare('SELECT id FROM team_release_registrations WHERE cycle_id = ? AND team_id = ?').get(cycle.id, teamId);
      if (already) throw new HttpError(409, 'Team này đã có đăng ký cho ngày release đó', 'RELEASE_REGISTRATION_EXISTS');
      if (cycleRow.locked_at) {
        throw new HttpError(409, 'Đợt release này đang khoá — team chưa từng có mặt phải chờ Leader điều phối mở khoá', 'REGISTRATION_LOCKED');
      }

      const insertResult = db.prepare(`
        INSERT INTO team_release_registrations (
          cycle_id, team_id, deploy_staging_at, release_at, deploy_demo_at, affected_systems, platforms,
          ticket_numbers, japan_coordination_link, no_japan_coordination_reason, notes, status,
          row_version, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 1, ?, ?, ?, ?)
      `).run(
        cycle.id, teamId, deployStagingAt, releaseAt, deployDemoAt,
        JSON.stringify(affectedSystems), JSON.stringify(platforms), JSON.stringify(ticketNumbers),
        link, reason, notes, actor.userId, actor.userId, now, now
      );
      const registrationId = Number(insertResult.lastInsertRowid);
      reconcileConflictsForCycle(db, cycle.id, now);
      writeAudit(actor.userId, teamId, 'release_registration.create', `team_release_registration:${registrationId}`, {
        cycleId: cycle.id, deployStagingAt, releaseAt
      });
      return loadRegistrationRow(registrationId)!;
    });
    res.status(201).json(mapRegistrationFull(created));
  } catch (error) {
    sendRouteError(res, error, 'Không thể tạo đăng ký lịch release khẩn cấp');
  }
});

router.patch('/release/schedule/registrations/:id', requireSession, requireActiveAccount, (req, res) => {
  try {
    const id = parseIntIdOrThrow(req.params.id, 'id');
    const actor = actorFromRequest(req);
    const reg = loadRegistrationRow(id);
    if (!reg) return res.status(404).json({ message: 'Không tìm thấy đăng ký' });
    authorize({ actor, policyKind: 'team_feature', resource: 'team_release_registration', action: 'update', scope: { teamId: reg.team_id } });
    if (reg.status === 'cancelled') throw new HttpError(400, 'Đăng ký đã huỷ, không sửa được nữa');
    if (reg.status === 'locked') {
      throw new HttpError(409, 'Đăng ký đang khoá — gửi yêu cầu mở khoá trước khi sửa', 'REGISTRATION_LOCKED');
    }

    const body = req.body as {
      deployStagingAt?: WallClockInput; releaseAt?: WallClockInput;
      affectedSystems?: unknown; platforms?: unknown; ticketNumbers?: unknown;
      japanCoordinationLink?: string; noJapanCoordinationReason?: string; notes?: string; rowVersion?: number;
    };
    const deployStagingAt = resolveWallClock(body.deployStagingAt, 'Giờ deploy staging');
    const releaseAt = resolveWallClock(body.releaseAt, 'Giờ release');
    const deployDemoAt = computeDeployDemoAt(releaseAt);
    const affectedSystems = parseAllowlistArray(body.affectedSystems, VALID_EMERGENCY_SYSTEMS, 'hệ thống bị ảnh hưởng');
    const platforms = parseAllowlistArray(body.platforms, VALID_PLATFORMS, 'nền tảng bị ảnh hưởng');
    const ticketNumbers = parseTicketNumbers(body.ticketNumbers);
    const { link, reason } = resolveJapanCoordination(body.japanCoordinationLink, body.noJapanCoordinationReason);
    const notes = typeof body.notes === 'string' ? body.notes : '';
    // Đổi ngày release (khác ngày cycle hiện tại) -> chuyển sang cycle khác (FR-26 bước 7). Ngoài
    // phạm vi route này (giữ route PATCH đơn giản, đúng 1 việc "sửa thông tin trong cùng đợt") — báo lỗi
    // rõ ràng thay vì âm thầm để registration lệch khỏi cycle của chính nó.
    const newReleaseDateKey = wallClockDateKey(releaseAt);
    const cycle = db.prepare('SELECT release_key FROM release_cycles WHERE id = ?').get(reg.cycle_id) as { release_key: string };
    if (`emergency:${newReleaseDateKey}` !== cycle.release_key) {
      throw new HttpError(400, 'Đổi sang NGÀY release khác đợt hiện tại chưa được hỗ trợ ở route này — huỷ đăng ký cũ và tạo đăng ký mới cho ngày mới');
    }

    const now = new Date().toISOString();
    withTransaction(() => {
      const updated = db.prepare(`
        UPDATE team_release_registrations
        SET deploy_staging_at = ?, release_at = ?, deploy_demo_at = ?, affected_systems = ?, platforms = ?,
            ticket_numbers = ?, japan_coordination_link = ?, no_japan_coordination_reason = ?, notes = ?,
            updated_at = ?, updated_by = ?, row_version = row_version + 1
        WHERE id = ? AND row_version = ?
      `).run(
        deployStagingAt, releaseAt, deployDemoAt, JSON.stringify(affectedSystems), JSON.stringify(platforms),
        JSON.stringify(ticketNumbers), link, reason, notes, now, actor.userId, id, body.rowVersion ?? -1
      );
      if (updated.changes === 0) throw new HttpError(409, 'Có người vừa sửa đăng ký này, vui lòng tải lại', 'VERSION_CONFLICT');

      // Bất kỳ yêu cầu mở khoá nào đã được duyệt cho cycle này -> đợt đang ở "chế độ kỷ luật khoá lại
      // khi lưu" (FR-26 bước 3-4): registration của CHÍNH team vừa lưu tự khoá lại ngay.
      const everApproved = db.prepare(`
        SELECT 1 FROM release_unlock_requests r JOIN team_release_registrations t ON t.id = r.registration_id
        WHERE t.cycle_id = ? AND r.kind = 'edit' AND r.status = 'approved' LIMIT 1
      `).get(reg.cycle_id);
      if (everApproved) {
        db.prepare(`UPDATE team_release_registrations SET status = 'locked' WHERE id = ?`).run(id);
      }

      reconcileConflictsForCycle(db, reg.cycle_id, now);
      const syncedCount = syncPersonalEmergencyTasksForRegistration({
        teamId: reg.team_id, cycleId: reg.cycle_id, cycleReleaseKey: cycle.release_key,
        deployStagingAt, releaseAt, deployDemoAt
      }, now);
      writeAudit(actor.userId, reg.team_id, 'release_registration.update', `team_release_registration:${id}`, {
        deployStagingAt, releaseAt, autoRelocked: Boolean(everApproved), syncedPersonalTasks: syncedCount
      });
    });
    res.json(mapRegistrationFull(loadRegistrationRow(id)!));
  } catch (error) {
    sendRouteError(res, error, 'Không thể sửa đăng ký lịch release khẩn cấp');
  }
});

// FR-27 — huỷ trực tiếp, CHỈ khi chưa khoá.
router.post('/release/schedule/registrations/:id/cancel', requireSession, requireActiveAccount, (req, res) => {
  try {
    const id = parseIntIdOrThrow(req.params.id, 'id');
    const actor = actorFromRequest(req);
    const reg = loadRegistrationRow(id);
    if (!reg) return res.status(404).json({ message: 'Không tìm thấy đăng ký' });
    authorize({ actor, policyKind: 'team_feature', resource: 'team_release_registration', action: 'cancel', scope: { teamId: reg.team_id } });
    if (reg.status === 'cancelled') return res.json(mapRegistrationFull(reg));
    if (reg.status === 'locked') {
      throw new HttpError(409, 'Đợt đã khoá — gửi yêu cầu huỷ (kind=cancel) thay vì huỷ trực tiếp', 'REGISTRATION_LOCKED');
    }

    const now = new Date().toISOString();
    const cycle = db.prepare('SELECT release_key FROM release_cycles WHERE id = ?').get(reg.cycle_id) as { release_key: string };
    withTransaction(() => {
      const updated = db.prepare(`
        UPDATE team_release_registrations SET status = 'cancelled', updated_at = ?, updated_by = ?, row_version = row_version + 1
        WHERE id = ? AND row_version = ?
      `).run(now, actor.userId, id, (req.body as { rowVersion?: number })?.rowVersion ?? reg.row_version);
      if (updated.changes === 0) throw new HttpError(409, 'Có người vừa sửa đăng ký này, vui lòng tải lại', 'VERSION_CONFLICT');
      reconcileConflictsForCycle(db, reg.cycle_id, now);
      cancelPersonalEmergencyTasksForRegistration(cycle.release_key, reg.team_id, now);
      writeAudit(actor.userId, reg.team_id, 'release_registration.cancel', `team_release_registration:${id}`, { cycleId: reg.cycle_id });
    });
    res.json(mapRegistrationFull(loadRegistrationRow(id)!));
  } catch (error) {
    sendRouteError(res, error, 'Không thể huỷ đăng ký lịch release khẩn cấp');
  }
});

// FR-26/FR-27 — gửi yêu cầu mở khoá (kind=edit) hoặc huỷ (kind=cancel) khi đợt đang khoá.
router.post('/release/schedule/registrations/:id/unlock-requests', requireSession, requireActiveAccount, (req, res) => {
  try {
    const id = parseIntIdOrThrow(req.params.id, 'id');
    const actor = actorFromRequest(req);
    const reg = loadRegistrationRow(id);
    if (!reg) return res.status(404).json({ message: 'Không tìm thấy đăng ký' });
    authorize({ actor, policyKind: 'team_feature', resource: 'team_release_registration', action: 'request_unlock', scope: { teamId: reg.team_id } });
    if (reg.status !== 'locked') throw new HttpError(400, 'Chỉ gửi được yêu cầu khi đăng ký đang khoá');

    const body = req.body as { kind?: string; reason?: string };
    const kind = body.kind === 'cancel' ? 'cancel' : body.kind === 'edit' ? 'edit' : null;
    if (!kind) throw new HttpError(400, 'kind phải là "edit" hoặc "cancel"');
    const reason = String(body.reason || '').trim();
    if (!reason) throw new HttpError(400, 'Lý do là bắt buộc');

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO release_unlock_requests (registration_id, kind, reason, registration_version_requested, status, created_by, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, kind, reason, reg.row_version, actor.userId, now);
    writeAudit(actor.userId, reg.team_id, 'release_unlock_request.create', `team_release_registration:${id}`, { kind, reason });
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (error) {
    sendRouteError(res, error, 'Không thể gửi yêu cầu');
  }
});

// FR-26/FR-27 — Leader team điều phối duyệt 1 yêu cầu. kind=edit -> mở TOÀN BỘ cycle + tự đóng các
// yêu cầu edit pending khác cùng cycle. kind=cancel -> chuyển thẳng registration đó sang cancelled.
router.post('/release/schedule/unlock-requests/:id/approve', requireSession, requireActiveAccount, (req, res) => {
  try {
    const id = parseIntIdOrThrow(req.params.id, 'id');
    const actor = actorFromRequest(req);
    const reqRow = db.prepare('SELECT * FROM release_unlock_requests WHERE id = ?').get(id) as
      { id: number; registration_id: number; kind: 'edit' | 'cancel'; status: string } | undefined;
    if (!reqRow) return res.status(404).json({ message: 'Không tìm thấy yêu cầu' });
    const reg = loadRegistrationRow(reqRow.registration_id);
    if (!reg) return res.status(404).json({ message: 'Không tìm thấy đăng ký liên quan' });
    authorizeReleaseCoordinatorAction(actor, 'approve_unlock');

    const now = new Date().toISOString();
    withTransaction(() => {
      const selfUpdate = db.prepare(`UPDATE release_unlock_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'`)
        .run(actor.userId, now, id);
      if (selfUpdate.changes === 0) throw new HttpError(409, 'Yêu cầu này đã được xử lý trước đó', 'UNLOCK_REQUEST_STALE');

      if (reqRow.kind === 'edit') {
        db.prepare(`UPDATE release_cycles SET locked_at = NULL, locked_by = NULL, row_version = row_version + 1 WHERE id = ?`).run(reg.cycle_id);
        db.prepare(`UPDATE team_release_registrations SET status = 'submitted' WHERE cycle_id = ? AND status = 'locked'`).run(reg.cycle_id);
        const others = db.prepare(`
          SELECT r.id FROM release_unlock_requests r JOIN team_release_registrations t ON t.id = r.registration_id
          WHERE t.cycle_id = ? AND r.kind = 'edit' AND r.status = 'pending'
        `).all(reg.cycle_id) as { id: number }[];
        const autoApprove = db.prepare(`UPDATE release_unlock_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?`);
        for (const other of others) autoApprove.run(actor.userId, now, other.id);
        writeAudit(actor.userId, reg.team_id, 'release_unlock_request.approve_edit', `release_cycle:${reg.cycle_id}`, {
          requestId: id, autoApprovedOthers: others.map((o) => o.id)
        });
      } else {
        const cycle = db.prepare('SELECT release_key FROM release_cycles WHERE id = ?').get(reg.cycle_id) as { release_key: string };
        db.prepare(`UPDATE team_release_registrations SET status = 'cancelled', updated_at = ?, updated_by = ?, row_version = row_version + 1 WHERE id = ?`)
          .run(now, actor.userId, reg.id);
        reconcileConflictsForCycle(db, reg.cycle_id, now);
        cancelPersonalEmergencyTasksForRegistration(cycle.release_key, reg.team_id, now);
        writeAudit(actor.userId, reg.team_id, 'release_unlock_request.approve_cancel', `team_release_registration:${reg.id}`, { requestId: id });
      }
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không thể duyệt yêu cầu');
  }
});

// FR-26 — "Khoá lịch" cấp CẢ ĐỢT, chỉ Leader team điều phối. Không bị chặn bởi xung đột `open` còn treo.
router.post('/release/schedule/cycles/:cycleId/lock', requireSession, requireActiveAccount, (req, res) => {
  try {
    const cycleId = parseIntIdOrThrow(req.params.cycleId, 'cycleId');
    const actor = actorFromRequest(req);
    const coordinatorTeamId = authorizeReleaseCoordinatorAction(actor, 'lock_cycle');
    const cycle = db.prepare(`SELECT id FROM release_cycles WHERE id = ? AND kind = 'emergency'`).get(cycleId);
    if (!cycle) return res.status(404).json({ message: 'Không tìm thấy đợt release khẩn cấp' });

    const now = new Date().toISOString();
    withTransaction(() => {
      db.prepare(`UPDATE release_cycles SET locked_at = ?, locked_by = ?, row_version = row_version + 1 WHERE id = ?`).run(now, actor.userId, cycleId);
      db.prepare(`UPDATE team_release_registrations SET status = 'locked' WHERE cycle_id = ? AND status = 'submitted'`).run(cycleId);
      writeAudit(actor.userId, coordinatorTeamId, 'release_cycle.lock', `release_cycle:${cycleId}`, {});
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không thể khoá lịch');
  }
});

// FR-25 — "Ép giờ chung": ngoại lệ DUY NHẤT sửa trực tiếp dữ liệu team khác. Áp cho cả 2 registration
// của 1 xung đột cụ thể — tác dụng được ngay cả khi đang locked.
router.post('/release/schedule/conflicts/:id/force-time', requireSession, requireActiveAccount, (req, res) => {
  try {
    const conflictId = parseIntIdOrThrow(req.params.id, 'id');
    const actor = actorFromRequest(req);
    authorizeReleaseCoordinatorAction(actor, 'force_time');
    const conflict = db.prepare('SELECT * FROM release_schedule_conflicts WHERE id = ?').get(conflictId) as
      { id: number; cycle_id: number; registration_a_id: number; registration_b_id: number; status: string } | undefined;
    if (!conflict) return res.status(404).json({ message: 'Không tìm thấy xung đột' });
    if (conflict.status !== 'open') throw new HttpError(400, 'Xung đột này không còn ở trạng thái mở');

    const body = req.body as { deployStagingAt?: WallClockInput; releaseAt?: WallClockInput };
    const deployStagingAt = resolveWallClock(body.deployStagingAt, 'Giờ deploy staging');
    const releaseAt = resolveWallClock(body.releaseAt, 'Giờ release');
    const cycle = db.prepare('SELECT release_key FROM release_cycles WHERE id = ?').get(conflict.cycle_id) as { release_key: string };
    if (`emergency:${wallClockDateKey(releaseAt)}` !== cycle.release_key) {
      throw new HttpError(400, 'Ép giờ chung không được đổi sang NGÀY release khác đợt hiện tại');
    }

    const now = new Date().toISOString();
    withTransaction(() => {
      const results = forceRegistrationTimes(
        db, [conflict.registration_a_id, conflict.registration_b_id], deployStagingAt, releaseAt, actor.userId, now
      );
      reconcileConflictsForCycle(db, conflict.cycle_id, now);
      for (const r of results) {
        const regRow = loadRegistrationRow(r.registrationId)!;
        syncPersonalEmergencyTasksForRegistration({
          teamId: r.teamId, cycleId: conflict.cycle_id, cycleReleaseKey: cycle.release_key,
          deployStagingAt: regRow.deploy_staging_at, releaseAt: regRow.release_at, deployDemoAt: regRow.deploy_demo_at
        }, now);
        // Ngoại lệ phá nguyên tắc authorize() một-cổng-vào (FR-25) — khai TƯỜNG MINH ở đây, ghi audit
        // đủ actor thật/team bị ép/giá trị cũ-mới cho TỪNG team bị chạm (2 dòng, khác team_id).
        writeAudit(actor.userId, r.teamId, 'release_registration.force_time', `team_release_registration:${r.registrationId}`, {
          oldDeployStagingAt: r.oldDeployStagingAt, oldReleaseAt: r.oldReleaseAt,
          newDeployStagingAt: r.newDeployStagingAt, newReleaseAt: r.newReleaseAt
        });
      }
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không thể ép giờ chung');
  }
});

// FR-23b — CHỈ Leader team điều phối ấn định 1 ngày chính cho định kỳ (dùng chung toàn hệ thống).
// Cho phép nhiều dòng kind='regular' status='open' song song (CR §6.3 vòng làm rõ thứ 4).
router.post('/release/schedule/regular-cycles', requireSession, requireActiveAccount, (req, res) => {
  try {
    const actor = actorFromRequest(req);
    const coordinatorTeamId = authorizeReleaseCoordinatorAction(actor, 'set_regular_date');
    const body = req.body as { regularReleaseDate?: string };
    const date = body.regularReleaseDate;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'regularReleaseDate không hợp lệ');

    const releaseKey = `regular:${date}`;
    const now = new Date().toISOString();
    try {
      const result = db.prepare(`
        INSERT INTO release_cycles (release_key, kind, status, regular_release_date, created_at, created_by)
        VALUES (?, 'regular', 'open', ?, ?, ?)
      `).run(releaseKey, date, now, actor.userId);
      writeAudit(actor.userId, coordinatorTeamId, 'release_cycle.create_regular', `release_cycle:${result.lastInsertRowid}`, { regularReleaseDate: date });
      res.status(201).json({ id: Number(result.lastInsertRowid), releaseKey, regularReleaseDate: date });
    } catch {
      throw new HttpError(409, 'Đã có đợt release định kỳ cho đúng ngày này');
    }
  } catch (error) {
    sendRouteError(res, error, 'Không thể tạo đợt release định kỳ');
  }
});

// FR-24 — lịch chung: Member/Leader mọi team đang Bật Release đều xem được ngày/giờ/hệ thống/nền tảng
// của team khác; ticket/link Nhật/ghi chú CHỈ hiện cho team sở hữu (lọc field ở BACKEND).
router.get('/release/schedule-board', requireSession, requireActiveAccount, (req, res) => {
  try {
    const actor = actorFromRequest(req);
    authorize({ actor, policyKind: 'cross_team_release', resource: 'release_schedule', action: 'read', scope: {} });
    const myTeamIds = new Set(actor.memberships.map((m) => m.teamId));

    const cycles = db.prepare(`SELECT * FROM release_cycles WHERE kind = 'emergency' ORDER BY release_key DESC`).all() as
      { id: number; release_key: string; status: string; locked_at: string | null }[];
    const cycleBoards = cycles.map((cycle) => {
      const registrations = (db.prepare(`SELECT * FROM team_release_registrations WHERE cycle_id = ? AND status != 'cancelled'`)
        .all(cycle.id) as unknown as RegistrationRow[])
        .map((row) => (myTeamIds.has(row.team_id) ? mapRegistrationFull(row) : mapRegistrationBoard(row)));
      const conflicts = db.prepare(`SELECT id, registration_a_id, registration_b_id, status FROM release_schedule_conflicts WHERE cycle_id = ?`).all(cycle.id);
      return { id: cycle.id, releaseKey: cycle.release_key, status: cycle.status, lockedAt: cycle.locked_at, registrations, conflicts };
    }).filter((c) => c.registrations.length > 0);

    res.json({ cycles: cycleBoards });
  } catch (error) {
    sendRouteError(res, error, 'Không thể tải lịch release chung');
  }
});

// ── FR-28a nhánh "Khẩn cấp" — mỗi Member/Leader tự áp dụng checklist CỦA MÌNH cho team+đợt đã chọn.
// Bắt buộc khớp đúng 3 mốc giờ CHÍNH THỨC team đã đăng ký — không cho gõ tay (CR §6.3).
router.post('/release/schedule/personal-emergency-tasks', requireSession, requireActiveAccount, (req, res) => {
  try {
    const actor = actorFromRequest(req);
    authorize({ actor, policyKind: 'personal_task', resource: 'emergency_release_task_definition_personal', action: 'own', scope: { ownerId: actor.userId } });

    const body = req.body as { teamId?: number; cycleId?: number; locale?: string };
    const teamId = parseIntIdOrThrow(body.teamId, 'teamId');
    const cycleId = parseIntIdOrThrow(body.cycleId, 'cycleId');
    if (!actor.memberships.some((m) => m.teamId === teamId)) {
      throw new HttpError(403, 'Bạn không phải thành viên của team này', 'NOT_TEAM_MEMBER');
    }
    const autogen = db.prepare('SELECT enabled FROM team_release_task_autogen_settings WHERE team_id = ?').get(teamId) as { enabled: number } | undefined;
    if (!autogen || !autogen.enabled) throw new HttpError(403, 'Admin chưa bật Tab cá nhân cho team này', 'FEATURE_DISABLED');

    const registration = db.prepare(`SELECT * FROM team_release_registrations WHERE cycle_id = ? AND team_id = ? AND status != 'cancelled'`)
      .get(cycleId, teamId) as RegistrationRow | undefined;
    if (!registration) throw new HttpError(404, 'Team chưa có đăng ký lịch khẩn cấp cho đợt này');
    const cycle = db.prepare(`SELECT release_key FROM release_cycles WHERE id = ? AND kind = 'emergency'`).get(cycleId) as { release_key: string } | undefined;
    if (!cycle) return res.status(404).json({ message: 'Không tìm thấy đợt release khẩn cấp' });
    const locale: EmergencyTemplateLocale = body.locale === 'ja' ? 'ja' : 'vi';

    const definitions = db.prepare('SELECT * FROM emergency_release_task_definitions WHERE owner_user_id = ?').all(actor.userId) as Record<string, unknown>[];
    const templates = new Map((db.prepare('SELECT id, content FROM emergency_release_templates WHERE owner_user_id = ?').all(actor.userId) as { id: string; content: string }[])
      .map((t) => [t.id, t.content]));

    const anchors: EmergencyRegistrationAnchors = {
      teamId, cycleId, cycleReleaseKey: cycle.release_key,
      deployStagingAt: registration.deploy_staging_at, releaseAt: registration.release_at, deployDemoAt: registration.deploy_demo_at
    };
    const releaseMonth = emergencyPersonalReleaseMonthKey(cycle.release_key, teamId, actor.userId, locale);
    const now = new Date().toISOString();

    const summary = withTransaction(() => {
      let created = 0;
      let skippedNoAnchor = 0;
      let skippedExisting = 0;
      for (const def of definitions) {
        const definitionForGenerate: EmergencyDefinitionForGenerate = {
          id: String(def.id), title: String(def.title), note: String(def.note || ''),
          taskDate: String(def.task_date), startTime: String(def.start_time),
          relativeOffsetMinutes: def.relative_offset_minutes == null ? null : Number(def.relative_offset_minutes),
          templateContent: def.template_id ? (templates.get(String(def.template_id)) ?? null) : null,
          taskLinksJson: String(def.task_links || '[]'), replyToDefinitionId: def.reply_to_definition_id == null ? null : String(def.reply_to_definition_id)
        };
        const rendered = renderEmergencyPersonalTask(definitionForGenerate, anchors, locale);
        if (!rendered) { skippedNoAnchor++; continue; }
        const exists = db.prepare('SELECT id FROM tasks WHERE release_month = ? AND origin_ref = ?').get(releaseMonth, rendered.definitionId);
        if (exists) { skippedExisting++; continue; }
        db.prepare(`
          INSERT INTO tasks (
            ten_task, ghi_chu, loai_task, do_uu_tien, trang_thai, ngay_tao, gio_bat_dau, gio_ket_thuc,
            lap_lai_kieu, ngay_trong_thang, thu_trong_tuan, ngay_cu_the, release_month, release_date, task_links,
            origin_ref, reply_to_ref, owner_user_id
          ) VALUES (?, ?, 'dinh_ky', NULL, 'chua_thuc_hien', ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          rendered.title, rendered.ghiChu, now, rendered.gioBatDau, rendered.gioKetThuc, rendered.ngayCuThe,
          releaseMonth, rendered.ngayCuThe, rendered.linksJson, rendered.definitionId, rendered.replyToRef, actor.userId
        );
        created++;
      }
      writeAudit(actor.userId, teamId, 'personal_emergency_task.generate', `release_cycle:${cycleId}`, { created, skippedNoAnchor, skippedExisting });
      return { created, skippedNoAnchor, skippedExisting };
    });
    res.status(201).json(summary);
  } catch (error) {
    sendRouteError(res, error, 'Không thể sinh task cá nhân khẩn cấp');
  }
});

// ── FR-23b/FR-24 — liệt kê các đợt release ĐỊNH KỲ đang mở để chọn (CR §6.3 vòng làm rõ thứ 4: CHO
// PHÉP nhiều dòng kind='regular' status='open' song song — người dùng phải tự chọn đúng đợt, không
// suy đoán 1 đợt duy nhất). Sắp theo `regular_release_date` gần nhất trước. Dùng lại đúng gate
// 'cross_team_release'/'release_schedule'.'read' của FR-24 (mọi Member/Leader của 1 team đang Bật
// Release đều xem được — đây là lịch dùng chung toàn hệ thống, không lọc field theo team sở hữu như
// lịch khẩn cấp vì không có khái niệm "team sở hữu" cho định kỳ).
router.get('/release/schedule/regular-cycles', requireSession, requireActiveAccount, (req, res) => {
  try {
    const actor = actorFromRequest(req);
    authorize({ actor, policyKind: 'cross_team_release', resource: 'release_schedule', action: 'read', scope: {} });
    const cycles = db.prepare(`
      SELECT id, release_key, regular_release_date FROM release_cycles
      WHERE kind = 'regular' AND status = 'open' ORDER BY regular_release_date ASC
    `).all() as { id: number; release_key: string; regular_release_date: string }[];
    res.json(cycles.map((c) => ({ id: c.id, releaseKey: c.release_key, regularReleaseDate: c.regular_release_date })));
  } catch (error) {
    sendRouteError(res, error, 'Không thể tải danh sách đợt release định kỳ');
  }
});

// ── FR-28a nhánh "Định kỳ" — mỗi Member/Leader tự áp dụng template/definition ĐỊNH KỲ CỦA MÌNH cho 1
// đợt release_cycles kind='regular' ĐANG MỞ do actor tự chọn (KHÔNG cho tự nhập ngày — CR §6.3: "người
// dùng không tự nhập ngày"). Ngày cụ thể của từng task tự tính từ `regular_release_date` của cycle đã
// chọn qua ĐÚNG `buildDefinitionTargetPayload()`/`tinhNgayRelease()` có sẵn (server/lib/release-render.ts,
// dùng chung với nhánh sync cũ ở schedules.ts) — không viết lại thuật toán tính ngày.
//
// Khoá nhóm dùng `regularPersonalReleaseMonthKey(cycleId, ownerUserId)` (gắn TRỰC TIẾP theo cycle_id,
// không suy từ tháng dương lịch) — giải đúng cảnh báo kỹ thuật CR §6.3 dòng ~1513 cho ĐƯỜNG MỚI này.
router.post('/release/schedule/personal-regular-tasks', requireSession, requireActiveAccount, (req, res) => {
  try {
    const actor = actorFromRequest(req);
    authorize({ actor, policyKind: 'personal_task', resource: 'release_task_definition_personal', action: 'own', scope: { ownerId: actor.userId } });

    const body = req.body as { teamId?: number; cycleId?: number };
    const teamId = parseIntIdOrThrow(body.teamId, 'teamId');
    const cycleId = parseIntIdOrThrow(body.cycleId, 'cycleId');
    if (!actor.memberships.some((m) => m.teamId === teamId)) {
      throw new HttpError(403, 'Bạn không phải thành viên của team này', 'NOT_TEAM_MEMBER');
    }
    const autogen = db.prepare('SELECT enabled FROM team_release_task_autogen_settings WHERE team_id = ?').get(teamId) as { enabled: number } | undefined;
    if (!autogen || !autogen.enabled) throw new HttpError(403, 'Admin chưa bật Tab cá nhân cho team này', 'FEATURE_DISABLED');

    // Chỉ chấp nhận cycle ĐANG MỞ do actor CHỌN ĐÚNG — chọn id không tồn tại/không phải regular/đã đóng
    // đều 404 rõ ràng, không tự suy đoán/rơi về đợt khác (CR §6.3: "phải CHỌN ĐÚNG đợt").
    const cycle = db.prepare(`SELECT id, regular_release_date FROM release_cycles WHERE id = ? AND kind = 'regular' AND status = 'open'`)
      .get(cycleId) as { id: number; regular_release_date: string } | undefined;
    if (!cycle) throw new HttpError(404, 'Không tìm thấy đợt release định kỳ đang mở này — chọn lại đợt', 'REGULAR_CYCLE_NOT_FOUND');

    const definitions = db.prepare('SELECT * FROM release_task_definitions WHERE owner_user_id = ?')
      .all(actor.userId) as unknown as ReleaseTaskDefinitionRow[];
    const templates = new Map((db.prepare('SELECT id, content FROM release_templates WHERE owner_user_id = ?').all(actor.userId) as { id: string; content: string }[])
      .map((t) => [t.id, t.content]));

    const releaseMonth = regularPersonalReleaseMonthKey(cycle.id, actor.userId);
    const now = new Date().toISOString();

    const summary = withTransaction(() => {
      let created = 0;
      let skippedExisting = 0;
      for (const def of definitions) {
        const templateContent = def.template_id ? (templates.get(String(def.template_id)) ?? null) : null;
        const target = buildDefinitionTargetPayload(def, cycle.regular_release_date, templateContent);
        const exists = db.prepare('SELECT id FROM tasks WHERE release_month = ? AND origin_ref = ?').get(releaseMonth, def.id);
        if (exists) { skippedExisting++; continue; }
        db.prepare(`
          INSERT INTO tasks (
            ten_task, ghi_chu, loai_task, do_uu_tien, trang_thai, ngay_tao, gio_bat_dau, gio_ket_thuc,
            lap_lai_kieu, ngay_trong_thang, thu_trong_tuan, ngay_cu_the, release_month, release_date, task_links,
            origin_ref, reply_to_ref, owner_user_id
          ) VALUES (?, ?, 'dinh_ky', NULL, 'chua_thuc_hien', ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          target.tenTask, target.ghiChu ?? '', now, target.gioBatDau, target.gioKetThuc, target.ngayCuThe,
          releaseMonth, target.ngayCuThe, target.linksJson, def.id, target.replyToRef, actor.userId
        );
        created++;
      }
      writeAudit(actor.userId, teamId, 'personal_regular_task.generate', `release_cycle:${cycleId}`, { created, skippedExisting });
      return { created, skippedExisting };
    });
    res.status(201).json(summary);
  } catch (error) {
    sendRouteError(res, error, 'Không thể sinh task cá nhân định kỳ');
  }
});

export default router;
