import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { type ProjectBody, type ProjectTaskBody, type ProjectTaskAssignmentsBody, type ProjectTaskAssignmentInput, isValidProjectTaskProgress } from '../types.js';
import { normalizeTaskLinks, isDateInput, isDateRangeValid, parseProjectEstimateHours, sendRouteError, parseIdList, HttpError } from '../lib/utils.js';
import { mapProject, mapProjectTask, mapProjectTasksWithCalculatedRollups, recalculateProjectTaskRollups, attachAssignments, deriveLeafFromAssignments } from '../lib/mappers.js';
import { mondayOf, addDays, toISODate, taskOverlapsWeek } from '../lib/date.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize, type Actor } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';

// CR-20260913 Lát 4 (§6.2/§6.3) — mọi route dưới đây giờ có team_id thật (projects/project_tasks) và
// đi qua authorize() (policyKind 'team_feature', resource 'project'/'project_task'/
// 'project_task_assignment'). Team scope LUÔN suy từ DB (bản ghi đích hoặc project cha qua
// project_tasks.project_id), KHÔNG tin `teamId` client gửi cho các route có sẵn resource — chỉ 2 route
// KHÔNG có resource sẵn (GET /projects, POST /projects, PATCH /projects/reorder) mới nhận `teamId` từ
// client, và authorize() vẫn tự xác nhận actor thật sự là thành viên team đó trước khi cho qua.
const router = Router();

function parseTeamIdParam(raw: unknown): number {
  const teamId = Number(raw);
  if (!Number.isInteger(teamId)) throw new HttpError(400, 'teamId không hợp lệ');
  return teamId;
}

// Nạp project + team_id thật từ DB (không tin client) — dùng cho mọi route có :projectId.
function loadProjectOrThrow(projectId: number): { id: number; team_id: number | null; is_system: number } {
  const project = db.prepare('SELECT id, team_id, is_system FROM projects WHERE id = ?').get(projectId) as
    { id: number; team_id: number | null; is_system: number } | undefined;
  if (!project) throw new HttpError(404, 'Không tìm thấy project');
  return project;
}

// FR-8/AC-7 (CR §3.1): Member chỉ sửa được task mình được gán phụ trách; Leader sửa được mọi task.
// authorize() chỉ kiểm được role-list chung (leader/member đều qua) — phần "task NÀY có phải của
// actor" là kiểm theo TỪNG bản ghi, phải tự làm thêm ở route, không nhét được vào AUTHORIZATION_POLICY.
function assertMemberOwnsTask(actor: Actor, effectiveRole: string, taskId: number): void {
  if (effectiveRole !== 'member') return;
  const owns = db.prepare('SELECT 1 FROM project_task_assignments WHERE project_task_id = ? AND user_id = ?')
    .get(taskId, actor.userId);
  if (!owns) throw new HttpError(403, 'Bạn không phải người phụ trách task này', 'ROLE_FORBIDDEN');
}

interface AssignmentRow {
  user_id: number | null;
  legacy_pic_label: string | null;
  start_date: string;
  end_date: string;
  estimate_hours: number | null;
}

// So khớp một dòng phân công KHÔNG kèm id (client không gửi id — mỗi lần lưu là thay toàn bộ mảng).
// Chỉ so (userId, startDate, endDate, estimateHours) — legacyPicLabel không có trong input nên không so.
function assignmentKey(userId: number | null, startDate: string, endDate: string, estimateHours: number | null): string {
  return JSON.stringify([userId, startDate, endDate, estimateHours]);
}

// FR-16 (CR §6.3, vòng làm rõ 17): Member CHỈ được thêm/sửa/xoá đúng dòng của chính mình trong mảng
// phân công — mọi dòng KHÔNG thuộc actor phải giữ NGUYÊN VĂN so với trước khi lưu (không bị xoá, không
// bị sửa). Đụng dòng người khác dưới bất kỳ hình thức nào -> từ chối TOÀN BỘ yêu cầu (403), không âm
// thầm lọc bớt rồi lưu phần hợp lệ (Leader xác nhận trực tiếp 19/09).
function enforceMemberOwnAssignmentsOnly(actorUserId: number, oldRows: AssignmentRow[], inputs: ProjectTaskAssignmentInput[]): void {
  const oldOthers = oldRows.filter((r) => r.user_id !== actorUserId);
  const oldOtherKeys = new Set(oldOthers.map((r) => assignmentKey(r.user_id, r.start_date, r.end_date, r.estimate_hours)));

  const newOtherKeys = new Set<string>();
  for (const input of inputs) {
    const userId = input.userId == null || input.userId === '' ? null : Number(input.userId);
    if (userId === actorUserId) continue; // dòng của chính actor -> luôn hợp lệ
    const estimate = input.estimateHours == null || input.estimateHours === '' ? null : Number(input.estimateHours);
    const key = assignmentKey(userId, String(input.startDate || ''), String(input.endDate || ''), estimate);
    if (!oldOtherKeys.has(key)) {
      throw new HttpError(403, 'Bạn chỉ được sửa phân công của chính mình', 'ROLE_FORBIDDEN');
    }
    newOtherKeys.add(key);
  }
  for (const key of oldOtherKeys) {
    if (!newOtherKeys.has(key)) {
      throw new HttpError(403, 'Bạn không được xoá phân công của người khác', 'ROLE_FORBIDDEN');
    }
  }
}

// Lưu (thay thế toàn bộ) giai đoạn phân công của 1 task lá:
// validate -> (kiểm quyền Member nếu có) -> xóa cũ -> chèn mới -> suy ra ngày/estimate/assignee ->
// tính lại rollup -> tăng row_version của task -> ghi audit thêm/bớt người. Ném HttpError nếu dữ liệu
// sai (caller bắt qua sendRouteError). Giả định caller đã chắc task là lá.
function saveTaskAssignments(
  actor: Actor, effectiveRole: string, teamId: number | null,
  projectId: number, taskId: number, inputs: ProjectTaskAssignmentInput[],
  // Khi có giá trị: bump row_version của project_tasks NGUYÊN TỬ (UPDATE ... WHERE row_version = ?)
  // TRƯỚC khi đụng gì khác trong transaction — dùng cho route PUT .../assignments (FR-16 vòng làm rõ
  // 18: khoá theo row_version của CẢ danh sách, không phải theo từng dòng riêng lẻ). Bỏ trống (POST
  // tạo task / nhánh assignments trong PATCH task) thì bump không điều kiện như hành vi cũ.
  expectedRowVersion?: number
) {
  const cleaned = inputs.map((a, i) => {
    const userId = a.userId == null || a.userId === '' ? null : Number(a.userId);
    const startDate = a.startDate?.trim();
    const endDate = a.endDate?.trim();
    if (!Number.isInteger(userId)) throw new HttpError(400, `Giai đoạn #${i + 1} chưa chọn người`);
    if (!isDateInput(startDate)) throw new HttpError(400, `Giai đoạn #${i + 1} có ngày bắt đầu không hợp lệ`);
    if (!isDateInput(endDate)) throw new HttpError(400, `Giai đoạn #${i + 1} có ngày kết thúc không hợp lệ`);
    if (!isDateRangeValid(startDate, endDate)) throw new HttpError(400, `Giai đoạn #${i + 1}: ngày kết thúc không thể trước ngày bắt đầu`);
    const estimate = parseProjectEstimateHours(a.estimateHours);
    if (estimate != null && (!Number.isFinite(estimate) || estimate <= 0)) throw new HttpError(400, `Giai đoạn #${i + 1} có giờ dự kiến không hợp lệ`);
    return { userId: userId as number, startDate: startDate as string, endDate: endDate as string, estimate };
  });

  const oldRows = db.prepare('SELECT user_id, legacy_pic_label, start_date, end_date, estimate_hours FROM project_task_assignments WHERE project_task_id = ?')
    .all(taskId) as unknown as AssignmentRow[];
  if (effectiveRole === 'member') enforceMemberOwnAssignmentsOnly(actor.userId, oldRows, inputs);

  const oldUserIds = new Set(oldRows.map((r) => r.user_id).filter((v): v is number => v != null));
  const newUserIds = new Set(cleaned.map((c) => c.userId));
  const added = [...newUserIds].filter((id) => !oldUserIds.has(id));
  const removed = [...oldUserIds].filter((id) => !newUserIds.has(id));

  withTransaction(() => {
    const now = new Date().toISOString();
    if (expectedRowVersion !== undefined) {
      const guarded = db.prepare('UPDATE project_tasks SET row_version = row_version + 1, updated_at = ? WHERE id = ? AND project_id = ? AND row_version = ?')
        .run(now, taskId, projectId, expectedRowVersion);
      if (guarded.changes === 0) {
        throw new HttpError(409, 'Có người vừa thay đổi phân công task này, vui lòng tải lại', 'VERSION_CONFLICT');
      }
    }
    db.prepare('DELETE FROM project_task_assignments WHERE project_task_id = ?').run(taskId);
    const insert = db.prepare(`
      INSERT INTO project_task_assignments (project_task_id, user_id, start_date, end_date, estimate_hours, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    cleaned.forEach((a, index) => insert.run(taskId, a.userId, a.startDate, a.endDate, a.estimate, index));
    // Có giai đoạn -> ngày/estimate/assignee (cache hiển thị) của task lá được suy ra từ giai đoạn.
    // Không còn giai đoạn nào -> giữ nguyên giá trị nhập tay hiện có.
    const derived = deriveLeafFromAssignments(taskId);
    if (derived) {
      db.prepare(`
        UPDATE project_tasks
        SET ngay_bat_dau_du_kien = ?, ngay_ket_thuc_du_kien = ?, estimate_hours = ?, assignee = ?,
            updated_at = ?${expectedRowVersion !== undefined ? '' : ', row_version = row_version + 1'}
        WHERE id = ? AND project_id = ?
      `).run(derived.start, derived.end, derived.estimate, derived.assignee, now, taskId, projectId);
    } else if (expectedRowVersion === undefined) {
      db.prepare('UPDATE project_tasks SET updated_at = ?, row_version = row_version + 1 WHERE id = ? AND project_id = ?')
        .run(now, taskId, projectId);
    }
    recalculateProjectTaskRollups(projectId);
    if (added.length > 0) writeAudit(actor.userId, teamId, 'project_task.assignment.add', `project_task:${taskId}`, { userIds: added });
    if (removed.length > 0) writeAudit(actor.userId, teamId, 'project_task.assignment.remove', `project_task:${taskId}`, { userIds: removed });
  });
}

router.get('/projects', requireSession, requireActiveAccount, (req, res) => {
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'project', action: 'list', scope: { teamId } });
  const rows = db.prepare(`
    SELECT * FROM projects
    WHERE team_id = ? AND closed_at IS NULL AND pending_at IS NULL
    ORDER BY sort_order ASC, id DESC
  `).all(teamId) as Record<string, unknown>[];
  res.json(rows.map(mapProject));
});

router.get('/projects/closed', requireSession, requireActiveAccount, (req, res) => {
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'project', action: 'list', scope: { teamId } });
  const rows = db.prepare(`
    SELECT * FROM projects
    WHERE team_id = ? AND (closed_at IS NOT NULL OR pending_at IS NOT NULL)
    ORDER BY COALESCE(pending_at, closed_at) DESC, sort_order ASC, id DESC
  `).all(teamId) as Record<string, unknown>[];
  res.json(rows.map(mapProject));
});

router.post('/projects', requireSession, requireActiveAccount, (req, res) => {
  const body = req.body as ProjectBody;
  const teamId = parseTeamIdParam(body.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'project', action: 'create', scope: { teamId } });

  const ten = body.ten?.trim();
  const responsibleUserId = body.responsibleUserId == null || body.responsibleUserId === '' ? null : Number(body.responsibleUserId);
  const ngayBatDau = body.ngayBatDau?.trim();
  if (!ten) return res.status(400).json({ message: 'Tên Project là bắt buộc' });
  // FR-15: bỏ hẳn `pic` chữ tự do — bắt buộc chọn responsibleUserId thật, không có ngoại lệ.
  if (!Number.isInteger(responsibleUserId)) return res.status(400).json({ message: 'Người phụ trách project là bắt buộc' });
  if (!ngayBatDau || !/^\d{4}-\d{2}-\d{2}$/.test(ngayBatDau)) {
    return res.status(400).json({ message: 'Ngày bắt đầu không hợp lệ' });
  }
  const owner = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, responsibleUserId);
  if (!owner) return res.status(400).json({ message: 'Người phụ trách phải là thành viên của team này' });

  const now = new Date().toISOString();
  const nextSortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM projects WHERE team_id = ?').get(teamId) as { next: number };
  const result = db.prepare(`
    INSERT INTO projects (ten_project, pic, team_id, responsible_user_id, ngay_bat_dau, sort_order, created_at, updated_at)
    VALUES (?, '', ?, ?, ?, ?, ?, ?)
  `).run(ten, teamId, responsibleUserId, ngayBatDau, nextSortOrder.next, now, now);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  res.status(201).json(mapProject(row));
});

router.patch('/projects/reorder', requireSession, requireActiveAccount, (req, res) => {
  const body = req.body as { teamId?: number | string; projectIds?: Array<string | number> };
  const teamId = parseTeamIdParam(body.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'project', action: 'reorder', scope: { teamId } });
  const projectIds = parseIdList(body.projectIds);
  if (!projectIds || projectIds.length === 0) {
    return res.status(400).json({ message: 'Thứ tự project không hợp lệ' });
  }

  const existingRows = db.prepare('SELECT id FROM projects WHERE team_id = ? AND closed_at IS NULL AND pending_at IS NULL ORDER BY sort_order ASC, id DESC').all(teamId) as { id: number }[];
  const existingIds = existingRows.map((row) => row.id);
  const existingSet = new Set(existingIds);
  const uniqueIds = [...new Set(projectIds)];
  if (uniqueIds.length !== projectIds.length || uniqueIds.length !== existingIds.length || uniqueIds.some((id) => !existingSet.has(id))) {
    return res.status(400).json({ message: 'Danh sách project không khớp' });
  }

  const updateSortOrder = db.prepare('UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ? AND team_id = ?');
  const now = new Date().toISOString();
  try {
    withTransaction(() => {
      uniqueIds.forEach((id, index) => updateSortOrder.run(index + 1, now, id, teamId));
    });
  } catch (error) {
    return sendRouteError(res, error, 'Không thể sắp xếp project');
  }

  const rows = db.prepare('SELECT * FROM projects WHERE team_id = ? AND closed_at IS NULL AND pending_at IS NULL ORDER BY sort_order ASC, id DESC').all(teamId) as Record<string, unknown>[];
  res.json(rows.map(mapProject));
});

router.patch('/projects/:projectId/close', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'project', action: 'close', scope: { teamId: project.team_id ?? undefined } });
  if (project.is_system) return res.status(400).json({ message: 'Không thể đóng project hệ thống "Khác"' });

  const body = req.body as { rowVersion?: number };
  const projectRow = db.prepare('SELECT closed_at, pending_at FROM projects WHERE id = ?').get(projectId) as { closed_at: string | null; pending_at: string | null };
  if (projectRow.closed_at != null || projectRow.pending_at != null) return res.status(404).json({ message: 'Không tìm thấy project đang mở' });
  const incompleteTasks = db.prepare(`
    SELECT COUNT(*) AS total FROM project_tasks WHERE project_id = ? AND tien_do <> 100
  `).get(projectId) as { total: number };
  if (incompleteTasks.total > 0) {
    return res.status(400).json({ message: 'Chỉ có thể close project khi tiến độ tất cả task là 100%' });
  }

  const now = new Date().toISOString();
  const updated = db.prepare('UPDATE projects SET closed_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?')
    .run(now, now, projectId, body.rowVersion ?? -1);
  if (updated.changes === 0) throw new HttpError(409, 'Có người vừa thay đổi project này, vui lòng tải lại', 'VERSION_CONFLICT');
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
  res.json(mapProject(row));
});

router.patch('/projects/:projectId/pending', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'project', action: 'close', scope: { teamId: project.team_id ?? undefined } });
  if (project.is_system) return res.status(400).json({ message: 'Không thể pending project hệ thống "Khác"' });

  const body = req.body as { rowVersion?: number };
  const projectRow = db.prepare('SELECT closed_at, pending_at FROM projects WHERE id = ?').get(projectId) as { closed_at: string | null; pending_at: string | null };
  if (projectRow.closed_at != null || projectRow.pending_at != null) return res.status(404).json({ message: 'Không tìm thấy project đang mở' });

  const now = new Date().toISOString();
  const updated = db.prepare('UPDATE projects SET pending_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?')
    .run(now, now, projectId, body.rowVersion ?? -1);
  if (updated.changes === 0) throw new HttpError(409, 'Có người vừa thay đổi project này, vui lòng tải lại', 'VERSION_CONFLICT');
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
  res.json(mapProject(row));
});

router.patch('/projects/:projectId/restore', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'project', action: 'close', scope: { teamId: project.team_id ?? undefined } });
  if (project.is_system) return res.status(400).json({ message: 'Không thể restore project hệ thống "Khác"' });

  const body = req.body as { rowVersion?: number };
  const projectRow = db.prepare('SELECT pending_at, closed_at FROM projects WHERE id = ?').get(projectId) as { pending_at: string | null; closed_at: string | null };
  if (!projectRow.pending_at || projectRow.closed_at) return res.status(400).json({ message: 'Chỉ project pending mới có thể chuyển lại Inprogress' });

  const now = new Date().toISOString();
  const updated = db.prepare('UPDATE projects SET pending_at = NULL, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?')
    .run(now, projectId, body.rowVersion ?? -1);
  if (updated.changes === 0) throw new HttpError(409, 'Có người vừa thay đổi project này, vui lòng tải lại', 'VERSION_CONFLICT');
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
  res.json(mapProject(row));
});

router.patch('/projects/:projectId', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'project', action: 'update', scope: { teamId: project.team_id ?? undefined } });

  const body = req.body as ProjectBody;
  const ten = body.ten?.trim();
  if (!ten) return res.status(400).json({ message: 'Tên Project là bắt buộc' });
  const now = new Date().toISOString();

  // Project hệ thống "Khác": chỉ cho đổi tên, giữ nguyên người phụ trách/ngày bắt đầu
  if (project.is_system) {
    const updated = db.prepare('UPDATE projects SET ten_project = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?')
      .run(ten, now, projectId, body.rowVersion ?? -1);
    if (updated.changes === 0) throw new HttpError(409, 'Có người vừa thay đổi project này, vui lòng tải lại', 'VERSION_CONFLICT');
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
    return res.json(mapProject(row));
  }

  const responsibleUserId = body.responsibleUserId == null || body.responsibleUserId === '' ? null : Number(body.responsibleUserId);
  const ngayBatDau = body.ngayBatDau?.trim();
  if (!Number.isInteger(responsibleUserId)) return res.status(400).json({ message: 'Người phụ trách project là bắt buộc' });
  if (!ngayBatDau || !/^\d{4}-\d{2}-\d{2}$/.test(ngayBatDau)) {
    return res.status(400).json({ message: 'Ngày bắt đầu không hợp lệ' });
  }
  if (project.team_id != null) {
    const owner = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(project.team_id, responsibleUserId);
    if (!owner) return res.status(400).json({ message: 'Người phụ trách phải là thành viên của team này' });
  }

  const updated = db.prepare('UPDATE projects SET ten_project = ?, responsible_user_id = ?, ngay_bat_dau = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?')
    .run(ten, responsibleUserId, ngayBatDau, now, projectId, body.rowVersion ?? -1);
  if (updated.changes === 0) throw new HttpError(409, 'Có người vừa thay đổi project này, vui lòng tải lại', 'VERSION_CONFLICT');
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
  res.json(mapProject(row));
});

router.delete('/projects/:projectId', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'project', action: 'delete', scope: { teamId: project.team_id ?? undefined } });
  if (project.is_system) return res.status(400).json({ message: 'Không thể xóa project hệ thống "Khác"' });

  try {
    withTransaction(() => {
      // BL-20260924-004: weekly_project_risks.project_id là FK cứng NOT NULL (không ON DELETE) —
      // để sót dù chỉ 1 dòng (kể cả tuần đã qua) là DB chặn thẳng xoá project bằng lỗi FK, khác
      // weekly_goals (FK mềm, không chặn) nên không áp dụng được nguyên tắc "chỉ dọn tuần hiện
      // tại/tương lai, giữ tuần đã qua làm hồ sơ" đang dùng khi xoá 1 task project (xem hàm xoá
      // task project ở dưới) — project không còn tồn tại thì Risk gắn với nó không thể giữ lại.
      db.prepare('DELETE FROM weekly_project_risks WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM project_tasks WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      writeAudit(actor.userId, project.team_id, 'project.delete', `project:${projectId}`, { projectId });
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không thể xóa project');
  }
});

router.get('/projects/:projectId/tasks', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'project_task', action: 'list', scope: { teamId: project.team_id ?? undefined } });

  const rows = db.prepare(`
    SELECT * FROM project_tasks
    WHERE project_id = ?
    ORDER BY level ASC, parent_id IS NOT NULL ASC, parent_id ASC, sort_order ASC, id ASC
  `).all(projectId) as Record<string, unknown>[];
  res.json(attachAssignments(mapProjectTasksWithCalculatedRollups(rows)));
});

router.post('/projects/:projectId/tasks', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  const actor = actorFromRequest(req);
  const decision = authorize({ actor, policyKind: 'team_feature', resource: 'project_task', action: 'create', scope: { teamId: project.team_id ?? undefined } });

  const body = req.body as ProjectTaskBody;
  // Project hệ thống "Khác" chỉ chứa việc lẻ -> chỉ task level 1, không cho task con
  if (project.is_system && body.parentId != null && body.parentId !== '') {
    return res.status(400).json({ message: 'Project "Khác" chỉ hỗ trợ task lẻ (level 1)' });
  }
  const tieuDe = body.tieuDe?.trim();
  const ghiChu = body.ghiChu?.trim() || '';
  const taskLinks = normalizeTaskLinks(body.links);
  const ngayBatDauDuKien = body.ngayBatDauDuKien?.trim();
  const ngayKetThucDuKien = body.ngayKetThucDuKien?.trim();
  const estimateHours = parseProjectEstimateHours(body.estimateHours);
  const tienDo = Number(body.tienDo ?? 0);

  if (!tieuDe) return res.status(400).json({ message: 'Tiêu đề task là bắt buộc' });
  if (!isDateInput(ngayBatDauDuKien)) return res.status(400).json({ message: 'Ngày bắt đầu dự kiến không hợp lệ' });
  if (!isDateInput(ngayKetThucDuKien)) return res.status(400).json({ message: 'Ngày kết thúc dự kiến không hợp lệ' });
  if (!isDateRangeValid(ngayBatDauDuKien, ngayKetThucDuKien)) return res.status(400).json({ message: 'Ngày kết thúc dự kiến không thể nhỏ hơn ngày bắt đầu dự kiến' });
  if (estimateHours != null && (!Number.isFinite(estimateHours) || estimateHours <= 0)) return res.status(400).json({ message: 'Estimate không hợp lệ' });
  if (!isValidProjectTaskProgress(tienDo)) return res.status(400).json({ message: 'Tiến độ không hợp lệ' });

  const parentId = body.parentId == null || body.parentId === '' ? null : Number(body.parentId);
  let level = 1;
  if (parentId != null) {
    if (!Number.isInteger(parentId)) return res.status(400).json({ message: 'Task cha không hợp lệ' });
    const parent = db.prepare('SELECT id, level FROM project_tasks WHERE id = ? AND project_id = ?')
      .get(parentId, projectId) as { id: number; level: number } | undefined;
    if (!parent) return res.status(404).json({ message: 'Không tìm thấy task cha' });
    if (parent.level >= 3) return res.status(400).json({ message: 'Task project chỉ hỗ trợ tối đa 3 level' });
    level = parent.level + 1;
  }

  // Member "tự nhận việc" khi tạo task -> nếu có mảng phân công, tất cả phải là chính actor (kiểm
  // trước khi ghi bất kỳ gì — nếu sai thì không tạo task luôn, tránh tạo xong rồi 403 phân công dở dang).
  if (decision.effectiveRole === 'member' && Array.isArray(body.assignments)) {
    for (const a of body.assignments) {
      const userId = a.userId == null || a.userId === '' ? null : Number(a.userId);
      if (userId !== actor.userId) throw new HttpError(403, 'Bạn chỉ được tự gán chính mình khi tạo task', 'ROLE_FORBIDDEN');
    }
  }

  const now = new Date().toISOString();
  const nextSortOrder = db.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next
    FROM project_tasks
    WHERE project_id = ? AND (
      (parent_id IS NULL AND ? IS NULL) OR parent_id = ?
    )
  `).get(projectId, parentId, parentId) as { next: number };
  const nextExecutionOrder = db.prepare(`
    SELECT COALESCE(MAX(execution_order), 0) + 1 AS next
    FROM project_tasks
    WHERE project_id = ?
  `).get(projectId) as { next: number };
  const result = db.prepare(`
    INSERT INTO project_tasks (
      project_id, parent_id, team_id, level, tieu_de, ghi_chu, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien,
      estimate_hours, tien_do, task_links, sort_order, execution_order, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId, parentId, project.team_id, level, tieuDe, ghiChu,
    ngayBatDauDuKien, ngayKetThucDuKien,
    estimateHours, tienDo,
    JSON.stringify(taskLinks), nextSortOrder.next, nextExecutionOrder.next, now, now
  );
  recalculateProjectTaskRollups(projectId);
  const newTaskId = Number(result.lastInsertRowid);
  // Task mới luôn là lá -> nếu có giai đoạn thì lưu và suy ra envelope.
  if (Array.isArray(body.assignments) && body.assignments.length > 0) {
    try { saveTaskAssignments(actor, decision.effectiveRole || 'member', project.team_id, projectId, newTaskId, body.assignments); }
    catch (error) { return sendRouteError(res, error, 'Không thể lưu phân công'); }
  }
  const row = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(newTaskId) as Record<string, unknown>;
  res.status(201).json(attachAssignments([mapProjectTask(row)])[0]);
});

router.patch('/projects/:projectId/tasks/reorder', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'project_task', action: 'reorder', scope: { teamId: project.team_id ?? undefined } });

  const body = req.body as { parentId?: string | number | null; taskIds?: Array<string | number> };
  const parentId = body.parentId == null || body.parentId === '' ? null : Number(body.parentId);
  const taskIds = parseIdList(body.taskIds);
  if (parentId != null && !Number.isInteger(parentId)) return res.status(400).json({ message: 'Task cha không hợp lệ' });
  if (!taskIds || taskIds.length === 0) {
    return res.status(400).json({ message: 'Thứ tự task không hợp lệ' });
  }

  const existingRows = db.prepare(`
    SELECT id FROM project_tasks
    WHERE project_id = ? AND (
      (parent_id IS NULL AND ? IS NULL) OR parent_id = ?
    )
    ORDER BY sort_order ASC, id ASC
  `).all(projectId, parentId, parentId) as { id: number }[];
  const existingIds = existingRows.map((row) => row.id);
  const uniqueTaskIds = [...new Set(taskIds)];
  const sameGroup = existingIds.length === uniqueTaskIds.length
    && existingIds.every((id) => uniqueTaskIds.includes(id));
  if (!sameGroup) return res.status(400).json({ message: 'Chỉ có thể sắp xếp các task cùng level/cùng task cha' });

  const updateSortOrder = db.prepare('UPDATE project_tasks SET sort_order = ?, updated_at = ? WHERE id = ? AND project_id = ?');
  const now = new Date().toISOString();
  try {
    withTransaction(() => {
      uniqueTaskIds.forEach((taskId, index) => updateSortOrder.run(index + 1, now, taskId, projectId));
    });
  } catch (error) {
    return sendRouteError(res, error, 'Không thể sắp xếp task');
  }

  const rows = db.prepare(`
    SELECT * FROM project_tasks
    WHERE project_id = ?
    ORDER BY level ASC, parent_id IS NOT NULL ASC, parent_id ASC, sort_order ASC, id ASC
  `).all(projectId) as Record<string, unknown>[];
  res.json(attachAssignments(mapProjectTasksWithCalculatedRollups(rows)));
});

router.patch('/projects/:projectId/tasks/execution-order', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'project_task', action: 'execution_order', scope: { teamId: project.team_id ?? undefined } });

  const body = req.body as { taskIds?: Array<string | number> };
  const taskIds = parseIdList(body.taskIds);
  if (!taskIds || taskIds.length === 0) return res.status(400).json({ message: 'Thứ tự task không hợp lệ' });
  const uniqueTaskIds = [...new Set(taskIds)];

  const existingRows = db.prepare(`
    SELECT t.id
    FROM project_tasks t
    WHERE t.project_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM project_tasks child
        WHERE child.project_id = t.project_id AND child.parent_id = t.id
      )
    ORDER BY t.execution_order ASC, t.sort_order ASC, t.id ASC
  `).all(projectId) as { id: number }[];
  const existingIds = existingRows.map((row) => row.id);
  const sameProjectLeafTasks = existingIds.length === uniqueTaskIds.length
    && existingIds.every((id) => uniqueTaskIds.includes(id));
  if (!sameProjectLeafTasks) return res.status(400).json({ message: 'Chỉ có thể sắp xếp các task thực thi trong cùng project' });

  const now = new Date().toISOString();
  const updateOrder = db.prepare('UPDATE project_tasks SET execution_order = ?, updated_at = ? WHERE id = ? AND project_id = ?');
  try {
    withTransaction(() => {
      uniqueTaskIds.forEach((taskId, index) => updateOrder.run(index + 1, now, taskId, projectId));
    });
  } catch (error) {
    return sendRouteError(res, error, 'Không thể sắp xếp task trên Gantt');
  }

  const rows = db.prepare(`
    SELECT * FROM project_tasks
    WHERE project_id = ?
    ORDER BY execution_order ASC, sort_order ASC, id ASC
  `).all(projectId) as Record<string, unknown>[];
  res.json(attachAssignments(mapProjectTasksWithCalculatedRollups(rows)));
});

router.patch('/projects/:projectId/tasks/:taskId', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  if (!Number.isInteger(taskId)) return res.status(400).json({ message: 'Task không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  const actor = actorFromRequest(req);
  const decision = authorize({ actor, policyKind: 'team_feature', resource: 'project_task', action: 'update', scope: { teamId: project.team_id ?? undefined } });
  assertMemberOwnsTask(actor, decision.effectiveRole || '', taskId);

  const task = db.prepare('SELECT id, estimate_hours, tien_do, row_version FROM project_tasks WHERE id = ? AND project_id = ?')
    .get(taskId, projectId) as { id: number; estimate_hours: number | null; tien_do: number; row_version: number } | undefined;
  if (!task) return res.status(404).json({ message: 'Không tìm thấy task project' });

  const body = req.body as ProjectTaskBody;
  const tieuDe = body.tieuDe?.trim();
  const ghiChu = body.ghiChu?.trim() || '';
  const taskLinks = normalizeTaskLinks(body.links);
  const ngayBatDauDuKien = body.ngayBatDauDuKien?.trim();
  const ngayKetThucDuKien = body.ngayKetThucDuKien?.trim();
  const estimateHours = parseProjectEstimateHours(body.estimateHours);
  const tienDo = Number(body.tienDo ?? 0);
  // CR-20260913 Lát 4 (FR-15, vòng làm rõ 19/09 lần 20): route NGỪNG nhận/ghi `body.assignee` — ô chữ
  // tự do đã bỏ hẳn, người phụ trách chỉ đi qua `assignments` (nhánh bên dưới).

  if (!tieuDe) return res.status(400).json({ message: 'Tiêu đề task là bắt buộc' });
  if (!isDateInput(ngayBatDauDuKien)) return res.status(400).json({ message: 'Ngày bắt đầu dự kiến không hợp lệ' });
  if (!isDateInput(ngayKetThucDuKien)) return res.status(400).json({ message: 'Ngày kết thúc dự kiến không hợp lệ' });
  if (!isDateRangeValid(ngayBatDauDuKien, ngayKetThucDuKien)) return res.status(400).json({ message: 'Ngày kết thúc dự kiến không thể nhỏ hơn ngày bắt đầu dự kiến' });

  const childCount = db.prepare('SELECT COUNT(*) AS total FROM project_tasks WHERE parent_id = ? AND project_id = ?')
    .get(taskId, projectId) as { total: number };
  const hasChildren = childCount.total > 0;
  if (!hasChildren && estimateHours != null && (!Number.isFinite(estimateHours) || estimateHours <= 0)) return res.status(400).json({ message: 'Estimate không hợp lệ' });
  if (!hasChildren && !isValidProjectTaskProgress(tienDo)) return res.status(400).json({ message: 'Tiến độ không hợp lệ' });

  const effectiveEstimateHours = hasChildren ? task.estimate_hours == null ? null : Number(task.estimate_hours) : estimateHours;
  const effectiveTienDo = hasChildren ? Number(task.tien_do || 0) : tienDo;

  // Validate: nếu task đang là mục tiêu tuần (hiện tại trở đi) mà ngày dự kiến mới
  // không còn giao với tuần đó -> cần user xác nhận; xác nhận thì gỡ khỏi mục tiêu tuần.
  const currentWeek = mondayOf(toISODate(new Date()));
  const goalWeeks = db.prepare('SELECT week_start FROM weekly_goals WHERE project_task_id = ? AND week_start >= ?')
    .all(taskId, currentWeek) as { week_start: string }[];
  const conflictWeeks = goalWeeks
    .map((g) => g.week_start)
    .filter((w) => !taskOverlapsWeek(ngayBatDauDuKien!, ngayKetThucDuKien!, w, addDays(w, 6)));
  if (conflictWeeks.length > 0) {
    if (!body.confirmRemoveGoal) {
      return res.status(409).json({
        message: 'Ngày dự kiến mới không còn thuộc tuần mà task đang là mục tiêu',
        code: 'GOAL_CONFLICT',
        details: { weeks: conflictWeeks },
      });
    }
    const delGoal = db.prepare('DELETE FROM weekly_goals WHERE project_task_id = ? AND week_start = ?');
    conflictWeeks.forEach((w) => delGoal.run(taskId, w));
  }

  const updated = db.prepare(`
    UPDATE project_tasks
    SET tieu_de = ?, ghi_chu = ?, ngay_bat_dau_du_kien = ?, ngay_ket_thuc_du_kien = ?,
        estimate_hours = ?, tien_do = ?, task_links = ?, updated_at = ?, row_version = row_version + 1
    WHERE id = ? AND project_id = ? AND row_version = ?
  `).run(
    tieuDe, ghiChu, ngayBatDauDuKien, ngayKetThucDuKien,
    effectiveEstimateHours, effectiveTienDo,
    JSON.stringify(taskLinks), new Date().toISOString(),
    taskId, projectId, body.rowVersion ?? -1
  );
  if (updated.changes === 0) throw new HttpError(409, 'Có người vừa thay đổi task này, vui lòng tải lại', 'VERSION_CONFLICT');
  recalculateProjectTaskRollups(projectId);
  // Giai đoạn phân công chỉ áp dụng cho task lá. [] = xóa hết giai đoạn (quay về nhập tay).
  if (Array.isArray(body.assignments) && !hasChildren) {
    try { saveTaskAssignments(actor, decision.effectiveRole || 'member', project.team_id, projectId, taskId, body.assignments); }
    catch (error) { return sendRouteError(res, error, 'Không thể lưu phân công'); }
  }
  const row = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
  res.json(attachAssignments([mapProjectTask(row)])[0]);
});

// Lưu (thay thế toàn bộ) các giai đoạn phân công của 1 task lá.
// Sau khi lưu: suy ra ngày/estimate/assignee của task từ giai đoạn rồi tính lại rollup.
router.put('/projects/:projectId/tasks/:taskId/assignments', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  if (!Number.isInteger(taskId)) return res.status(400).json({ message: 'Task không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  const actor = actorFromRequest(req);
  const decision = authorize({ actor, policyKind: 'team_feature', resource: 'project_task_assignment', action: 'update', scope: { teamId: project.team_id ?? undefined } });

  const task = db.prepare('SELECT id, row_version FROM project_tasks WHERE id = ? AND project_id = ?').get(taskId, projectId) as { id: number; row_version: number } | undefined;
  if (!task) return res.status(404).json({ message: 'Không tìm thấy task project' });

  const childCount = db.prepare('SELECT COUNT(*) AS total FROM project_tasks WHERE parent_id = ? AND project_id = ?')
    .get(taskId, projectId) as { total: number };
  if (childCount.total > 0) return res.status(400).json({ message: 'Chỉ task lá (không có task con) mới phân công theo giai đoạn' });

  const body = req.body as ProjectTaskAssignmentsBody;
  try {
    // FR-16 vòng làm rõ 18: khoá theo row_version của project_tasks (cả danh sách), không phải theo
    // từng dòng phân công riêng lẻ — bump nguyên tử bên trong saveTaskAssignments().
    saveTaskAssignments(actor, decision.effectiveRole || 'member', project.team_id, projectId, taskId, Array.isArray(body.assignments) ? body.assignments : [], body.rowVersion ?? -1);
    const row = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
    res.json(attachAssignments([mapProjectTask(row)])[0]);
  } catch (error) {
    sendRouteError(res, error, 'Không thể lưu phân công');
  }
});

router.delete('/projects/:projectId/tasks/:taskId', requireSession, requireActiveAccount, (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  if (!Number.isInteger(taskId)) return res.status(400).json({ message: 'Task không hợp lệ' });
  const project = loadProjectOrThrow(projectId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'project_task', action: 'delete', scope: { teamId: project.team_id ?? undefined } });
  const task = db.prepare('SELECT id FROM project_tasks WHERE id = ? AND project_id = ?').get(taskId, projectId);
  if (!task) return res.status(404).json({ message: 'Không tìm thấy task project' });

  const treeIds = (db.prepare(`
    WITH RECURSIVE task_tree(id) AS (
      SELECT id FROM project_tasks WHERE id = ? AND project_id = ?
      UNION ALL
      SELECT child.id
      FROM project_tasks child
      INNER JOIN task_tree parent ON child.parent_id = parent.id
      WHERE child.project_id = ?
    )
    SELECT id FROM task_tree
  `).all(taskId, projectId, projectId) as { id: number }[]).map((row) => row.id);
  const treeIdPlaceholders = treeIds.map(() => '?').join(', ');

  // QA-2026-09-12: xoá task project (kể cả cây con) trước đây để lại weekly_goals MỒ CÔI vĩnh viễn —
  // bảng này không có FK, không tự dọn theo khi project_tasks bị xoá (tái hiện được: tạo task, gán
  // làm mục tiêu tuần hiện tại, xoá task -> goal vẫn còn nguyên, hiện "(không tên)" trên Weekly Report
  // mãi mãi). Chỉ dọn mục tiêu tuần HIỆN TẠI/TƯƠNG LAI — task đã xoá thì không thể còn "đang là mục
  // tiêu" của tuần chưa qua, cùng nguyên tắc đã áp dụng ở PATCH task (GOAL_CONFLICT, phía trên). Tuần
  // ĐÃ QUA giữ nguyên — coi là hồ sơ lịch sử, không xoá goal/evaluation quá khứ.
  const currentWeek = mondayOf(toISODate(new Date()));
  let deleted = 0;
  withTransaction(() => {
    db.prepare(`DELETE FROM weekly_goals WHERE week_start >= ? AND project_task_id IN (${treeIdPlaceholders})`)
      .run(currentWeek, ...treeIds);
    const result = db.prepare(`DELETE FROM project_tasks WHERE id IN (${treeIdPlaceholders})`).run(...treeIds);
    deleted = Number(result.changes);
    writeAudit(actor.userId, project.team_id, 'project_task.delete', `project_task:${taskId}`, { taskId, treeIds });
  });
  recalculateProjectTaskRollups(projectId);
  res.json({ deleted });
});

export default router;
