import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { recalculateProjectTaskRollups } from '../lib/mappers.js';
import { sendRouteError, HttpError, parseIntId } from '../lib/utils.js';
import { isValidProjectTaskProgress } from '../types.js';
import {
  buildReportPlan, renderReport, renderDmReport, mondayOf, addDays, toISODate,
  validEvalStatuses, taskOverlapsWeek, buildWeekData, buildTaskNumbers, type EvalStatus,
  listReportKinds, findReportKindById, findReportKindByCode, upsertProjectRisks, listProjectRisks, VALID_RENDER_MODES,
  RiskVersionConflictError,
} from '../lib/weekly-report.js';
import { buildDmReportWorkbook } from '../lib/weekly-report-excel.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';

// CR-20260913 Lát 4 (§6.2/§6.3, FR-21/FR-21a) — Báo cáo tuần giờ là dữ liệu THEO TEAM (trước Lát 4 là
// toàn app 1 danh sách). Mọi route bắt buộc qua authorize() (policyKind 'team_feature', feature
// 'weekly_report') và truyền `teamId` xuống server/lib/weekly-report.ts (đã sửa để lọc theo team_id ở
// mọi câu SELECT). `teamId` LUÔN lấy từ query/body do client chọn (bộ chọn team, FR-13) — không có bản
// ghi đích sẵn có để tự suy như route theo :projectId — nhưng authorize() vẫn tự xác nhận actor thật sự
// là thành viên team đó (feature Bật + có membership) trước khi cho qua, không tin suông giá trị này.
//
// Chỉ Leader mới chốt tuần/xoá (FR-21: "Giữ nguyên cơ chế hiện tại — KHÔNG có luồng Member tự đặt mục
// tiêu tuần"; Member chỉ xem) — xem AUTHORIZATION_POLICY['weekly_goal'/'weekly_report'] trong
// server/lib/authorization-policy.ts.
const router = Router();

// `unknown` (không phải `string`) — Express 5 khai báo `req.params[x]: string | string[]`
// (route pattern lặp lại tham số), giống quy ước `parseIntId(value: unknown)` đã dùng ở nơi khác.
function normWeek(input: unknown): string | null {
  const value = String(input ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return mondayOf(value);
}

function parseTeamIdParam(raw: unknown): number {
  const teamId = Number(raw);
  if (!Number.isInteger(teamId)) throw new HttpError(400, 'teamId không hợp lệ');
  return teamId;
}

// `id` ở đây CỐ Ý trả về `code` (không phải row id UUID nội bộ) — giữ tương thích với hợp đồng cũ mà
// frontend đang dùng (dropdown chọn loại báo cáo gửi thẳng giá trị này làm `?kind=` cho GET
// /weeks/:weekStart/text và `body.kind` cho POST /weeks/:weekStart/report-history, cả hai đều so khớp
// theo CODE — xem renderReport()/findReportKindByCode() ở server/lib/weekly-report.ts). Row id UUID
// thật (cần cho CRUD Leader sau này) trả riêng ở `rowId`.
function mapReportKind(k: ReturnType<typeof listReportKinds>[number]) {
  return {
    id: k.code,
    rowId: k.id,
    code: k.code,
    label: k.label,
    renderMode: k.render_mode,
    requiresProjectRisk: Boolean(k.requires_project_risk),
    sortOrder: k.sort_order,
    isActive: Boolean(k.is_active),
    rowVersion: k.row_version,
  };
}

// Danh sách loại báo cáo (CR-20260913 Lát 5, FR-22 — cấu hình theo team, không còn ghi cứng
// internal/vn_management) + tuần hiện tại.
router.get('/weeks/report-kinds', requireSession, requireActiveAccount, (req, res) => {
  const teamId = parseTeamIdParam(req.query.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'weekly_report_kind', action: 'list', scope: { teamId } });
  res.json({
    currentWeek: mondayOf(toISODate(new Date())),
    kinds: listReportKinds(teamId).map(mapReportKind),
  });
});

// Tạo loại báo cáo mới cho team (Leader-only). `renderMode` PHẢI thuộc allowlist đóng trong code —
// Leader chọn từ danh sách có sẵn, không tự soạn logic hiển thị mới (CR §6.3).
router.post('/weeks/report-kinds', requireSession, requireActiveAccount, (req, res) => {
  const body = req.body as { teamId?: number | string; code?: string; label?: string; renderMode?: string; requiresProjectRisk?: boolean };
  const teamId = parseTeamIdParam(body.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'weekly_report_kind', action: 'create', scope: { teamId } });

  const code = String(body.code || '').trim();
  const label = String(body.label || '').trim();
  const renderMode = String(body.renderMode || '');
  if (!code) return res.status(400).json({ message: 'Mã loại báo cáo là bắt buộc' });
  if (!label) return res.status(400).json({ message: 'Nhãn hiển thị là bắt buộc' });
  if (!VALID_RENDER_MODES.has(renderMode)) return res.status(400).json({ message: `renderMode không hợp lệ. Cho phép: ${[...VALID_RENDER_MODES].join(', ')}` });

  const now = new Date().toISOString();
  const nextOrder = (db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM weekly_report_kinds WHERE team_id = ?').get(teamId) as { n: number }).n;
  try {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO weekly_report_kinds (id, team_id, code, label, render_mode, requires_project_risk, sort_order, is_active, row_version, created_at, updated_at, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
    `).run(id, teamId, code, label, renderMode, body.requiresProjectRisk ? 1 : 0, nextOrder, now, now, actor.userId, actor.userId);
    writeAudit(actor.userId, teamId, 'weekly_report_kind.create', `weekly_report_kind:${id}`, { code, label, renderMode });
    res.status(201).json(mapReportKind(findReportKindById(teamId, id)!));
  } catch (error) {
    if (error instanceof Error && /UNIQUE/.test(error.message)) {
      return res.status(409).json({ message: 'Mã loại báo cáo này đã tồn tại trong team' });
    }
    sendRouteError(res, error, 'Không tạo được loại báo cáo');
  }
});

// Sửa loại báo cáo đã có (Leader-only) — CHỈ mã/nhãn/thứ tự/bật-tắt/yêu cầu Risk, KHÔNG cho đổi
// `renderMode` sau khi tạo (CR §6.3: Leader không tự soạn render_mode).
router.patch('/weeks/report-kinds/:id', requireSession, requireActiveAccount, (req, res) => {
  const id = String(req.params.id);
  const body = req.body as { teamId?: number | string; code?: string; label?: string; sortOrder?: number; isActive?: boolean; requiresProjectRisk?: boolean; rowVersion?: number };
  const teamId = parseTeamIdParam(body.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'weekly_report_kind', action: 'update', scope: { teamId } });

  const existing = findReportKindById(teamId, id);
  if (!existing) return res.status(404).json({ message: 'Không tìm thấy loại báo cáo' });

  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (body.code !== undefined) { fields.push('code = ?'); values.push(String(body.code).trim()); }
  if (body.label !== undefined) { fields.push('label = ?'); values.push(String(body.label).trim()); }
  if (body.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(Number(body.sortOrder)); }
  if (body.isActive !== undefined) { fields.push('is_active = ?'); values.push(body.isActive ? 1 : 0); }
  if (body.requiresProjectRisk !== undefined) { fields.push('requires_project_risk = ?'); values.push(body.requiresProjectRisk ? 1 : 0); }
  if (fields.length === 0) return res.status(400).json({ message: 'Không có gì để sửa' });
  fields.push('updated_at = ?', 'updated_by = ?', 'row_version = row_version + 1');
  values.push(new Date().toISOString(), actor.userId);

  try {
    const result = db.prepare(`UPDATE weekly_report_kinds SET ${fields.join(', ')} WHERE id = ? AND team_id = ? AND row_version = ?`)
      .run(...values, id, teamId, body.rowVersion ?? -1);
    if (result.changes === 0) return res.status(409).json({ message: 'Có người vừa sửa loại báo cáo này, vui lòng tải lại', code: 'VERSION_CONFLICT' });
    writeAudit(actor.userId, teamId, 'weekly_report_kind.update', `weekly_report_kind:${id}`, body);
    res.json(mapReportKind(findReportKindById(teamId, id)!));
  } catch (error) {
    if (error instanceof Error && /UNIQUE/.test(error.message)) {
      return res.status(409).json({ message: 'Mã loại báo cáo này đã tồn tại trong team' });
    }
    sendRouteError(res, error, 'Không sửa được loại báo cáo');
  }
});

// ── Risk & biện pháp đối ứng theo team/tuần/loại/project (FR-22, FR-21a — hiện cho CẢ TEAM xem) ────
router.get('/weeks/:weekStart/risks', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const teamId = parseTeamIdParam(req.query.teamId);
  const reportKindId = String(req.query.reportKindId || '');
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'weekly_project_risk', action: 'list', scope: { teamId } });
  if (!reportKindId || !findReportKindById(teamId, reportKindId)) return res.status(400).json({ message: 'reportKindId không hợp lệ' });
  res.json(listProjectRisks(teamId, weekStart, reportKindId).map((r) => ({
    id: r.id, projectId: String(r.project_id), risk: r.risk, mitigation: r.mitigation, rowVersion: r.row_version,
  })));
});

router.put('/weeks/:weekStart/risks', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const body = req.body as { teamId?: number | string; reportKindId?: string; risks?: { projectId?: string | number; risk?: string; mitigation?: string; rowVersion?: number }[] };
  const teamId = parseTeamIdParam(body.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'weekly_project_risk', action: 'upsert', scope: { teamId } });

  const reportKindId = String(body.reportKindId || '');
  const kind = findReportKindById(teamId, reportKindId);
  if (!kind) return res.status(400).json({ message: 'reportKindId không hợp lệ' });
  const risks = (Array.isArray(body.risks) ? body.risks : [])
    .map((r) => ({
      projectId: Number(r.projectId), risk: String(r.risk || ''), mitigation: String(r.mitigation || ''),
      rowVersion: r.rowVersion == null ? undefined : Number(r.rowVersion),
    }))
    .filter((r) => Number.isInteger(r.projectId));

  // Trigger DB (schema/weekly-report.ts) đã chặn project_id không thuộc đúng team_id — bắt lỗi đó
  // thành 400 rõ ràng thay vì vỡ 500. RiskVersionConflictError (optimistic concurrency, xem
  // upsertProjectRisks()) -> 409 kèm danh sách projectId xung đột để client tải lại đúng dòng đó.
  try {
    upsertProjectRisks(teamId, weekStart, reportKindId, risks, actor.userId);
    writeAudit(actor.userId, teamId, 'weekly_project_risk.upsert', `weekly_project_risks:${weekStart}:${reportKindId}`, { weekStart, reportKindId, count: risks.length });
    res.json(listProjectRisks(teamId, weekStart, reportKindId).map((r) => ({
      id: r.id, projectId: String(r.project_id), risk: r.risk, mitigation: r.mitigation, rowVersion: r.row_version,
    })));
  } catch (error) {
    if (error instanceof RiskVersionConflictError) {
      return res.status(409).json({ message: 'Có Risk vừa bị người khác sửa, vui lòng tải lại', code: 'VERSION_CONFLICT', conflicts: error.conflicts });
    }
    if (error instanceof Error && /phai thuoc cung team_id/.test(error.message)) {
      return res.status(400).json({ message: 'Có project không thuộc team này' });
    }
    sendRouteError(res, error, 'Không lưu được Risk');
  }
});

// ── Badge & cảnh báo trên bảng project ───────────────────────────────────────────

// Task được đánh badge 🎯: mục tiêu của TUẦN CÓ MỤC TIÊU MỚI NHẤT và chưa hoàn thành.
router.get('/weeks/goal-badge-ids', requireSession, requireActiveAccount, (req, res) => {
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'weekly_report', action: 'badges', scope: { teamId } });
  const latest = db.prepare('SELECT MAX(week_start) AS w FROM weekly_goals WHERE team_id = ? AND project_task_id IS NOT NULL').get(teamId) as { w: string | null };
  if (!latest.w) return res.json([]);
  const rows = db.prepare(`
    SELECT DISTINCT g.project_task_id AS id
    FROM weekly_goals g
    JOIN project_tasks t ON t.id = g.project_task_id
    WHERE g.team_id = ? AND g.week_start = ? AND t.tien_do < 100
  `).all(teamId, latest.w) as { id: number }[];
  res.json(rows.map((r) => String(r.id)));
});

// Task CARRY-OVER (badge ⚠ "phải lưu tâm"): là mục tiêu của TUẦN CÓ MỤC TIÊU MỚI NHẤT, chưa xong,
// VÀ đã từng là mục tiêu ở một tuần trước đó (tức bị mang sang vì chưa hoàn thành).
// Hiển thị song song với badge 🎯 mục tiêu, kể cả khi đã được duyệt tiếp làm mục tiêu tuần này.
router.get('/weeks/at-risk-ids', requireSession, requireActiveAccount, (req, res) => {
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'weekly_report', action: 'badges', scope: { teamId } });
  const latest = db.prepare('SELECT MAX(week_start) AS w FROM weekly_goals WHERE team_id = ? AND project_task_id IS NOT NULL').get(teamId) as { w: string | null };
  if (!latest.w) return res.json([]);
  const rows = db.prepare(`
    SELECT DISTINCT g.project_task_id AS id
    FROM weekly_goals g
    JOIN project_tasks t ON t.id = g.project_task_id
    JOIN projects p ON p.id = t.project_id AND p.closed_at IS NULL
    WHERE g.team_id = ? AND g.week_start = ?
      AND t.tien_do < 100
      AND EXISTS (
        SELECT 1 FROM weekly_goals g2
        WHERE g2.project_task_id = g.project_task_id AND g2.week_start < ? AND g2.team_id = ?
      )
  `).all(teamId, latest.w, latest.w, teamId) as { id: number }[];
  res.json(rows.map((r) => String(r.id)));
});

// ── History báo cáo đã phê duyệt ─────────────────────────────────────────────────

// Danh sách history (mới nhất trước)
router.get('/weeks/report-history', requireSession, requireActiveAccount, (req, res) => {
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'weekly_report', action: 'history_list', scope: { teamId } });
  const rows = db.prepare(`
    SELECT id, week_start, kind, mode, content, row_version, created_at, updated_at
    FROM weekly_report_history
    WHERE team_id = ?
    ORDER BY week_start DESC, kind ASC, mode ASC
  `).all(teamId) as Record<string, unknown>[];
  res.json(rows.map((r) => ({
    id: String(r.id),
    weekStart: String(r.week_start),
    kind: String(r.kind),
    mode: String(r.mode),
    content: String(r.content),
    rowVersion: Number(r.row_version || 1),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  })));
});

router.delete('/weeks/report-history/:id', requireSession, requireActiveAccount, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'History không hợp lệ' });
  const row = db.prepare('SELECT team_id FROM weekly_report_history WHERE id = ?').get(id) as { team_id: number | null } | undefined;
  if (!row) return res.status(404).json({ message: 'Không tìm thấy báo cáo' });
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'weekly_report', action: 'history_delete', scope: { teamId: row.team_id ?? undefined } });
  const result = db.prepare('DELETE FROM weekly_report_history WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy báo cáo' });
  res.json({ ok: true });
});

// Phê duyệt báo cáo: validate đã tồn tại cho tuần đó chưa; force = ghi đè
router.post('/weeks/:weekStart/report-history', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const body = req.body as { teamId?: number | string; kind?: string; content?: string; force?: boolean; rowVersion?: number };
  const teamId = parseTeamIdParam(body.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'weekly_report', action: 'history_create', scope: { teamId } });

  const kind = String(body.kind || 'internal');
  // 1 báo cáo = dự án + member ghép lại -> mỗi tuần+loại chỉ có 1 bản (mode cố định 'full')
  const mode = 'full';
  const content = String(body.content || '').trim();
  // CR-20260913 Lát 5 (FR-22): danh sách hợp lệ giờ đọc từ cấu hình CỦA TEAM (weekly_report_kinds),
  // không còn 2 giá trị ghi cứng — `kind` khớp theo `code`, không phân biệt hoa/thường (giống unique
  // index của bảng).
  const kindRow = findReportKindByCode(teamId, kind);
  if (!kindRow) {
    return res.status(400).json({ message: 'Loại báo cáo không hợp lệ' });
  }
  if (!content) return res.status(400).json({ message: 'Nội dung báo cáo trống' });

  // Council review 2026-09-23 (lỗ hổng #1): `findReportKindByCode` khớp KHÔNG phân biệt hoa/thường,
  // nhưng UNIQUE(team_id, week_start, kind, mode) của weekly_report_history PHÂN BIỆT hoa/thường
  // (SQLite mặc định) -> nếu dùng lại biến `kind` gốc (chưa chuẩn hoá, do client gửi) thì "khac" và
  // "KHAC" cùng khớp một `kindRow` cấu hình nhưng tạo ra 2 dòng khác nhau trong bảng, vi phạm đúng bất
  // biến "mỗi tuần+loại chỉ có 1 bản". Từ đây trở đi dùng `kindRow.code` (giá trị ĐÃ CHUẨN HOÁ, đúng
  // casing lưu trong weekly_report_kinds), không dùng lại `kind` thô nữa.
  const existing = db.prepare('SELECT id, row_version FROM weekly_report_history WHERE team_id = ? AND week_start = ? AND kind = ? AND mode = ?')
    .get(teamId, weekStart, kindRow.code, mode) as { id: number; row_version: number } | undefined;
  if (existing && !body.force) {
    return res.status(409).json({ message: 'Báo cáo của tuần này đã tồn tại', code: 'REPORT_EXISTS' });
  }
  // Council review 2026-09-23 (lỗ hổng #2): check `is_active` chỉ được áp dụng cho điểm TẠO MỚI thật
  // sự (`!existing`) — Schema (`weekly_report_kinds.is_active`) ghi rõ ý định "ngừng dùng không phá
  // lịch sử": Leader vẫn phải sửa/ghi đè được báo cáo ĐÃ CÓ (`existing && force`) của một loại vừa bị
  // Admin tắt sau khi báo cáo đã tồn tại — chỉ chặn khi đây thực sự là bản ghi mới cho tuần/loại đó.
  if (!existing && !kindRow.is_active) {
    return res.status(400).json({ message: 'Loại báo cáo này đã ngừng dùng, không tạo được báo cáo mới bằng loại này' });
  }

  const now = new Date().toISOString();
  if (existing) {
    const updated = db.prepare('UPDATE weekly_report_history SET content = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?')
      .run(content, now, existing.id, body.rowVersion ?? -1);
    if (updated.changes === 0) throw new HttpError(409, 'Có người vừa thay đổi báo cáo này, vui lòng tải lại', 'VERSION_CONFLICT');
  } else {
    db.prepare('INSERT INTO weekly_report_history (week_start, team_id, kind, mode, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(weekStart, teamId, kindRow.code, mode, content, now, now);
  }
  writeAudit(actor.userId, teamId, 'weekly_report.finalize', `weekly_report_history:${weekStart}:${kindRow.code}`, { weekStart, kind: kindRow.code, overwritten: Boolean(existing) });
  res.json({ ok: true, overwritten: Boolean(existing) });
});

// ── Wizard tạo báo cáo ───────────────────────────────────────────────────────────

// Kế hoạch báo cáo: đánh giá từng task tuần trước + đề xuất mục tiêu tuần (kèm giải thích tính toán)
router.get('/weeks/:weekStart/plan', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'weekly_report', action: 'plan', scope: { teamId } });
  res.json(buildReportPlan(weekStart, teamId));
});

// Áp dụng kết quả wizard: cập nhật tiến độ task + đánh giá từng task (tuần trước) + tạo mục tiêu đã duyệt
router.post('/weeks/:weekStart/apply', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const body = req.body as {
    teamId?: number | string;
    progressUpdates?: { taskId: string | number; progress: number }[];
    evaluations?: { taskId: string | number; status?: string; note?: string; unplanned?: boolean }[];
    manualGoalUpdates?: { goalId: string | number; done?: boolean; note?: string }[];
    projectSummaries?: { projectId: string | number; content?: string }[];
    approvedGoals?: { projectTaskId?: string | number; projectId?: string | number; assignee?: string; targetProgress?: number; goalText?: string }[];
    newKhacGoals?: { text?: string; assignee?: string; targetProgress?: number }[];
  };
  const teamId = parseTeamIdParam(body.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'weekly_report', action: 'apply', scope: { teamId } });

  const progressUpdates = Array.isArray(body.progressUpdates) ? body.progressUpdates : [];
  const evaluations = Array.isArray(body.evaluations) ? body.evaluations : [];
  const manualGoalUpdates = Array.isArray(body.manualGoalUpdates) ? body.manualGoalUpdates : [];
  const projectSummaries = Array.isArray(body.projectSummaries) ? body.projectSummaries : [];
  const approvedGoals = Array.isArray(body.approvedGoals) ? body.approvedGoals : [];
  const newKhacGoals = Array.isArray(body.newKhacGoals) ? body.newKhacGoals : [];
  const weekEnd = addDays(weekStart, 6);
  const now = new Date().toISOString();
  const affectedProjects = new Set<number>();
  let created = 0;
  let skippedOutOfWeek = 0;
  let skippedPending = 0;

  try {
    db.exec('BEGIN TRANSACTION');
    // 1) Cập nhật tiến độ task (ghi đè tien_do) — CHỈ task thuộc đúng team (chống chỉnh chéo team qua
    // taskId gõ tay/giả mạo).
    const updProgress = db.prepare('UPDATE project_tasks SET tien_do = ?, updated_at = ? WHERE id = ? AND team_id = ?');
    for (const u of progressUpdates) {
      const taskId = Number(u.taskId);
      const progress = Number(u.progress);
      if (!Number.isInteger(taskId) || !isValidProjectTaskProgress(progress)) continue;
      const task = db.prepare('SELECT project_id FROM project_tasks WHERE id = ? AND team_id = ?').get(taskId, teamId) as { project_id: number } | undefined;
      if (!task) continue;
      updProgress.run(progress, now, taskId, teamId);
      affectedProjects.add(task.project_id);
    }

    // 2) Đánh giá từng task của TUẦN TRƯỚC (status + lý do/ghi chú + cờ ngoài kế hoạch)
    const upEval = db.prepare(`
      INSERT INTO weekly_task_evaluations (week_start, project_task_id, team_id, status, note, unplanned) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(week_start, project_task_id) DO UPDATE SET status = excluded.status, note = excluded.note, unplanned = excluded.unplanned
    `);
    for (const e of evaluations) {
      const taskId = Number(e.taskId);
      if (!Number.isInteger(taskId)) continue;
      const exists = db.prepare('SELECT id FROM project_tasks WHERE id = ? AND team_id = ?').get(taskId, teamId);
      if (!exists) continue;
      const status = validEvalStatuses.has(e.status as EvalStatus) ? (e.status as EvalStatus) : 'dat';
      upEval.run(prevWeekStartOf(weekStart), taskId, teamId, status, String(e.note || ''), e.unplanned ? 1 : 0);
    }

    // 2b) Đánh dấu xong / ghi chú cho mục tiêu gõ tay của TUẦN TRƯỚC
    const updManual = db.prepare(`
      UPDATE weekly_goals SET manual_done = ?, reason = ?, updated_at = ?
      WHERE id = ? AND team_id = ? AND project_task_id IS NULL
    `);
    for (const m of manualGoalUpdates) {
      const goalId = Number(m.goalId);
      if (!Number.isInteger(goalId)) continue;
      updManual.run(m.done ? 1 : 0, String(m.note || ''), now, goalId, teamId);
    }

    // 2c) Đánh giá chung theo project (bước Summary) — lưu cho TUẦN TRƯỚC
    const upSummary = db.prepare(`
      INSERT INTO weekly_project_summaries (week_start, project_id, team_id, content) VALUES (?, ?, ?, ?)
      ON CONFLICT(week_start, project_id) DO UPDATE SET content = excluded.content
    `);
    for (const s of projectSummaries) {
      const pid = Number(s.projectId);
      if (!Number.isInteger(pid)) continue;
      const ownsProject = db.prepare('SELECT 1 FROM projects WHERE id = ? AND team_id = ?').get(pid, teamId);
      if (!ownsProject) continue;
      upSummary.run(prevWeekStartOf(weekStart), pid, teamId, String(s.content || ''));
    }

    // 3) Tạo mục tiêu tuần đã được duyệt
    const insGoal = db.prepare(`
      INSERT INTO weekly_goals (week_start, team_id, project_id, project_task_id, assignee, goal_text, reason, start_progress, target_progress, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)
    `);
    let order = (db.prepare('SELECT COALESCE(MAX(sort_order),0) n FROM weekly_goals WHERE team_id = ? AND week_start = ?').get(teamId, weekStart) as { n: number }).n;
    for (const g of approvedGoals) {
      const taskId = g.projectTaskId == null || g.projectTaskId === '' ? null : Number(g.projectTaskId);
      let projectId = g.projectId == null || g.projectId === '' ? null : Number(g.projectId);
      const goalText = g.goalText?.trim() || '';
      const assignee = g.assignee?.trim() || null;
      const target = g.targetProgress == null ? null : Math.max(0, Math.min(100, Math.round(Number(g.targetProgress))));
      let startProgress: number | null = null;
      if (taskId != null) {
        const task = db.prepare('SELECT project_id, assignee, tien_do, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien FROM project_tasks WHERE id = ? AND team_id = ?').get(taskId, teamId) as {
          project_id: number; assignee: string | null; tien_do: number; ngay_bat_dau_du_kien: string; ngay_ket_thuc_du_kien: string;
        } | undefined;
        if (!task) continue;
        // Project pending (tạm dừng) thì task của nó không được làm mục tiêu tuần.
        const owner = db.prepare('SELECT pending_at FROM projects WHERE id = ?').get(task.project_id) as { pending_at: string | null } | undefined;
        if (owner?.pending_at) { skippedPending += 1; continue; }
        startProgress = task.tien_do;
        // Validate: ngày dự kiến phải giao với tuần mới được làm mục tiêu tuần.
        // NGOẠI LỆ carry-over: task là mục tiêu TUẦN TRƯỚC mà chưa xong (<100%) vẫn được tiếp tục dù quá hạn.
        if (!taskOverlapsWeek(task.ngay_bat_dau_du_kien, task.ngay_ket_thuc_du_kien, weekStart, weekEnd)) {
          const wasPrevGoal = db.prepare('SELECT 1 FROM weekly_goals WHERE project_task_id = ? AND week_start = ?').get(taskId, prevWeekStartOf(weekStart));
          if (!(wasPrevGoal && task.tien_do < 100)) {
            skippedOutOfWeek += 1;
            continue;
          }
        }
        if (projectId == null) projectId = task.project_id;
        // CR-20260913 Lát 4/Lát 5 dọn nợ (BL-20260913-001): KHÔNG còn ghi `assignee` do client gửi
        // ngược vào `project_tasks.assignee` — cột đó giờ là CACHE tự tính từ `project_task_assignments`
        // (server/lib/mappers.ts#deriveLeafFromAssignments), không phải input người dùng (đúng tinh
        // thần đã chốt ở Lát 4 cho mọi route khác). `assignee` ở đây chỉ còn dùng làm snapshot của
        // riêng `weekly_goals.assignee` (dòng insGoal bên dưới) — không lan ngược sang task.
        const dup = db.prepare('SELECT id FROM weekly_goals WHERE week_start = ? AND project_task_id = ?').get(weekStart, taskId);
        if (dup) continue;
      } else if (!goalText) {
        continue;
      }
      order += 1;
      insGoal.run(weekStart, teamId, projectId, taskId, assignee, goalText, startProgress, target, order, now, now);
      created += 1;
    }

    // 4) Mục tiêu "Khác" gõ tay -> tạo task THẬT trong project hệ thống "Khác" (ngày = tuần này),
    //    rồi thêm làm mục tiêu tuần. Nhờ vậy có tiến độ + đánh giá như task project bình thường.
    if (newKhacGoals.length > 0) {
      const sys = db.prepare('SELECT id FROM projects WHERE is_system = 1 AND team_id = ? ORDER BY id ASC LIMIT 1').get(teamId) as { id: number } | undefined;
      if (sys) {
        const insTask = db.prepare(`
          INSERT INTO project_tasks (project_id, parent_id, team_id, level, tieu_de, ghi_chu, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien,
            estimate_hours, tien_do, task_links, assignee, sort_order, execution_order, created_at, updated_at)
          VALUES (?, NULL, ?, 1, ?, '', ?, ?, NULL, 0, '[]', ?, ?, ?, ?, ?)
        `);
        for (const g of newKhacGoals) {
          const text = g.text?.trim();
          if (!text) continue;
          const assignee = g.assignee?.trim() || null;
          const target = g.targetProgress == null ? 100 : Math.max(0, Math.min(100, Math.round(Number(g.targetProgress))));
          const nextSort = (db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM project_tasks WHERE project_id = ? AND parent_id IS NULL').get(sys.id) as { n: number }).n;
          const nextExecution = (db.prepare('SELECT COALESCE(MAX(execution_order),0)+1 n FROM project_tasks WHERE project_id = ?').get(sys.id) as { n: number }).n;
          const r = insTask.run(sys.id, teamId, text, weekStart, weekEnd, assignee, nextSort, nextExecution, now, now);
          order += 1;
          insGoal.run(weekStart, teamId, sys.id, Number(r.lastInsertRowid), assignee, '', 0, target, order, now, now);
          created += 1;
        }
        affectedProjects.add(sys.id);
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    return sendRouteError(res, error, 'Không thể lưu báo cáo');
  }

  affectedProjects.forEach((pid) => recalculateProjectTaskRollups(pid));
  res.json({ ok: true, created, skippedOutOfWeek, skippedPending });
});

function prevWeekStartOf(weekStart: string): string {
  return addDays(weekStart, -7);
}

// Text báo cáo đã format
router.get('/weeks/:weekStart/text', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'weekly_report', action: 'render', scope: { teamId } });
  const kind = String(req.query.kind || 'internal');
  res.json({ text: renderReport(weekStart, kind, teamId) });
});

// Báo cáo DM kèm Risk: nhận risk + biện pháp theo từng project, trả text đã format.
// CR-20260913 Lát 5 (FR-22, FR-21a): nếu có `reportKindId` (loại báo cáo có `requiresProjectRisk`),
// ghi luôn vào weekly_project_risks để CẢ TEAM xem lại được ở màn báo cáo tuần (không chỉ ephemeral
// trong lần gọi này) — giữ tương thích ngược: không gửi `reportKindId` vẫn render được như cũ, chỉ
// không lưu lại. Bucket "Khác" (`projectId` rỗng) KHÔNG lưu được vào bảng này (project_id NOT NULL
// theo schema) — vẫn render bình thường, chỉ không có lịch sử xem lại cho đúng bucket đó.
//
// SEC (Council review sau FR-22, 2026-09-23): route này chỉ đòi quyền `render` (Leader+Member) vì bản
// thân việc RENDER báo cáo là hành động Member được phép (CR §... "Member chỉ xem"). Nhưng khi có
// `reportKindId`, route gọi thẳng upsertProjectRisks() — ĐÚNG hàm ghi mà PUT /weeks/:weekStart/risks
// dùng, và route đó đòi quyền `upsert` (Leader-only). Không kiểm thêm ở đây thì Member bị chặn ở PUT
// /risks nhưng vẫn ghi/ghi đè được Risk qua ngả này — cửa hậu. Quyết định đã chọn (không có gợi ý rõ
// hơn trong CR): PHƯƠNG ÁN (a) — Member gửi `reportKindId` (bất kể `risks` có phần tử ghi được hay
// không) bị chặn 403 NGAY, không âm thầm bỏ qua phần lưu rồi vẫn render — actor biết ngay hành vi bị
// chặn thay vì đoán tại sao Risk không được lưu. Member vẫn render báo cáo bình thường khi KHÔNG gửi
// `reportKindId`.
router.post('/weeks/:weekStart/dm-report', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const body = req.body as {
    teamId?: number | string; reportKindId?: string;
    risks?: { projectId?: string | number | null; risk?: string; mitigation?: string; rowVersion?: number }[];
  };
  const teamId = parseTeamIdParam(body.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'weekly_report', action: 'render', scope: { teamId } });
  const risks = Array.isArray(body.risks) ? body.risks.map((r) => ({
    projectId: r.projectId == null || r.projectId === '' ? null : String(r.projectId),
    risk: String(r.risk || ''),
    mitigation: String(r.mitigation || ''),
    rowVersion: r.rowVersion == null ? undefined : Number(r.rowVersion),
  })) : [];

  if (body.reportKindId) {
    // Cửa hậu ghi Risk (xem ghi chú SEC ở trên) — bắt buộc đúng quyền `upsert` (Leader-only) TRƯỚC khi
    // đụng tới upsertProjectRisks(), không dựa vào quyền `render` chung đã kiểm ở trên.
    authorize({ actor, policyKind: 'team_feature', resource: 'weekly_project_risk', action: 'upsert', scope: { teamId } });
    const kind = findReportKindById(teamId, body.reportKindId);
    if (!kind) return res.status(400).json({ message: 'reportKindId không hợp lệ' });
    const persistable = risks
      .filter((r) => r.projectId != null)
      .map((r) => ({ projectId: Number(r.projectId), risk: r.risk, mitigation: r.mitigation, rowVersion: r.rowVersion }))
      .filter((r) => Number.isInteger(r.projectId));
    try {
      upsertProjectRisks(teamId, weekStart, body.reportKindId, persistable, actor.userId);
    } catch (error) {
      if (error instanceof RiskVersionConflictError) {
        return res.status(409).json({ message: 'Có Risk vừa bị người khác sửa, vui lòng tải lại', code: 'VERSION_CONFLICT', conflicts: error.conflicts });
      }
      if (error instanceof Error && /phai thuoc cung team_id/.test(error.message)) {
        return res.status(400).json({ message: 'Có project không thuộc team này' });
      }
      return sendRouteError(res, error, 'Không lưu được Risk');
    }
  }
  res.json({ text: renderDmReport(weekStart, risks, teamId) });
});

// Xuất Excel cho report kind "Báo cáo DM" — CR-20260915-xuat-excel-bao-cao-dm. Không nhận Risk (dữ liệu
// Risk chỉ thuộc POST /dm-report ở trên, không liên quan file này).
router.get('/weeks/:weekStart/dm-report.xlsx', requireSession, requireActiveAccount, async (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'weekly_report', action: 'render', scope: { teamId } });

  const data = buildWeekData(weekStart, teamId);
  const hasContent = data.groups.some((g) => g.goals.length > 0 || g.lastWeekGoals.length > 0);
  if (!hasContent) return res.status(404).json({ message: 'Tuần này chưa có dữ liệu để xuất báo cáo' });

  const workbook = buildDmReportWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bao-cao-dm-tuan-${weekStart}.xlsx"`);
  res.send(Buffer.from(buffer));
});

// Danh sách mục tiêu của tuần (để xem & xóa mục tiêu duyệt nhầm)
router.get('/weeks/:weekStart/goals', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'weekly_goal', action: 'list', scope: { teamId } });
  const prevWeekStart = addDays(weekStart, -7);
  const projectOrder = new Map(
    (db.prepare('SELECT id, sort_order FROM projects WHERE team_id = ?').all(teamId) as { id: number; sort_order: number }[])
      .map((p) => [String(p.id), p.sort_order])
  );
  const rows = db.prepare(`
    SELECT g.id, g.project_id, g.project_task_id, g.assignee, g.goal_text, g.target_progress,
           t.tieu_de AS task_title, p.ten_project AS project_name
    FROM weekly_goals g
    LEFT JOIN project_tasks t ON t.id = g.project_task_id
    LEFT JOIN projects p ON p.id = g.project_id
    WHERE g.team_id = ? AND g.week_start = ?
    ORDER BY g.sort_order ASC, g.id ASC
  `).all(teamId, weekStart) as Record<string, unknown>[];

  // hasGoals + prevEvaluated dùng cho việc khóa nút "Tạo báo cáo" (đã chốt mục tiêu + đánh giá tuần trước)
  const evalCount = (db.prepare('SELECT COUNT(*) c FROM weekly_task_evaluations WHERE team_id = ? AND week_start = ?').get(teamId, prevWeekStart) as { c: number }).c
    + (db.prepare('SELECT COUNT(*) c FROM weekly_project_summaries WHERE team_id = ? AND week_start = ?').get(teamId, prevWeekStart) as { c: number }).c;

  const taskNumbers = buildTaskNumbers(teamId);
  res.json({
    hasGoals: rows.length > 0,
    prevEvaluated: evalCount > 0,
    goals: rows.map((r) => {
      const tid = r.project_task_id == null ? null : String(r.project_task_id);
      return {
        id: String(r.id),
        projectId: r.project_id == null ? null : String(r.project_id),
        projectName: r.project_name == null ? 'Khác' : String(r.project_name),
        projectOrder: r.project_id == null ? 9999 : (projectOrder.get(String(r.project_id)) ?? 9999),
        taskNumber: tid ? (taskNumbers.get(tid)?.label || '') : '',
        taskOrder: tid ? (taskNumbers.get(tid)?.order ?? 0) : 0,
        text: String(r.goal_text || '') || String(r.task_title || '(không tên)'),
        assignee: r.assignee == null ? '' : String(r.assignee),
        targetProgress: r.target_progress == null ? null : Number(r.target_progress),
        isManual: tid == null,
      };
    }),
  });
});

// Xóa toàn bộ mục tiêu của tuần (1 lần)
router.delete('/weeks/:weekStart/goals', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const teamId = parseTeamIdParam(req.query.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'weekly_goal', action: 'delete_all', scope: { teamId } });
  const result = db.prepare('DELETE FROM weekly_goals WHERE team_id = ? AND week_start = ?').run(teamId, weekStart);
  writeAudit(actor.userId, teamId, 'weekly_goals.delete_all', `weekly_goals:${weekStart}`, { weekStart, deleted: result.changes });
  res.json({ ok: true, deleted: result.changes });
});

router.delete('/weeks/:weekStart/goals/:id', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  const id = parseIntId(req.params.id);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  if (id == null) return res.status(400).json({ message: 'Mục tiêu không hợp lệ' });
  const goal = db.prepare('SELECT team_id FROM weekly_goals WHERE id = ? AND week_start = ?').get(id, weekStart) as { team_id: number | null } | undefined;
  if (!goal) return res.status(404).json({ message: 'Không tìm thấy mục tiêu' });
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'weekly_goal', action: 'delete_one', scope: { teamId: goal.team_id ?? undefined } });
  const result = db.prepare('DELETE FROM weekly_goals WHERE id = ? AND week_start = ?').run(id, weekStart);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy mục tiêu' });
  res.json({ ok: true });
});

// Các task đang là mục tiêu của tuần (cho badge trên bảng project)
router.get('/weeks/:weekStart/goal-task-ids', requireSession, requireActiveAccount, (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'weekly_report', action: 'badges', scope: { teamId } });
  const rows = db.prepare('SELECT DISTINCT project_task_id FROM weekly_goals WHERE team_id = ? AND week_start = ? AND project_task_id IS NOT NULL').all(teamId, weekStart) as { project_task_id: number }[];
  res.json(rows.map((r) => String(r.project_task_id)));
});

export default router;
