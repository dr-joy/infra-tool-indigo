import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { type ProjectBody, type ProjectTaskBody, type ProjectTaskAssignmentsBody, type ProjectTaskAssignmentInput, isValidProjectTaskProgress } from '../types.js';
import { normalizeTaskLinks, isDateInput, isDateRangeValid, parseProjectEstimateHours, sendRouteError, parseIdList, HttpError } from '../lib/utils.js';
import { mapProject, mapProjectTask, mapProjectTasksWithCalculatedRollups, recalculateProjectTaskRollups, attachAssignments, deriveLeafFromAssignments } from '../lib/mappers.js';
import { mondayOf, addDays, toISODate, taskOverlapsWeek } from '../lib/date.js';

const router = Router();

// Lưu (thay thế toàn bộ) giai đoạn phân công của 1 task lá:
// validate -> xóa cũ -> chèn mới -> suy ra ngày/estimate/assignee -> tính lại rollup.
// Ném HttpError nếu dữ liệu sai (caller bắt qua sendRouteError). Giả định caller đã chắc task là lá.
function saveTaskAssignments(projectId: number, taskId: number, inputs: ProjectTaskAssignmentInput[]) {
  const cleaned = inputs.map((a, i) => {
    const pic = a.pic?.trim();
    const startDate = a.startDate?.trim();
    const endDate = a.endDate?.trim();
    if (!pic) throw new HttpError(400, `Giai đoạn #${i + 1} chưa chọn người`);
    if (!isDateInput(startDate)) throw new HttpError(400, `Giai đoạn #${i + 1} có ngày bắt đầu không hợp lệ`);
    if (!isDateInput(endDate)) throw new HttpError(400, `Giai đoạn #${i + 1} có ngày kết thúc không hợp lệ`);
    if (!isDateRangeValid(startDate, endDate)) throw new HttpError(400, `Giai đoạn #${i + 1}: ngày kết thúc không thể trước ngày bắt đầu`);
    const estimate = parseProjectEstimateHours(a.estimateHours);
    if (estimate != null && (!Number.isFinite(estimate) || estimate <= 0)) throw new HttpError(400, `Giai đoạn #${i + 1} có giờ dự kiến không hợp lệ`);
    return { pic, startDate, endDate, estimate };
  });
  withTransaction(() => {
    db.prepare('DELETE FROM project_task_assignments WHERE project_task_id = ?').run(taskId);
    const insert = db.prepare(`
      INSERT INTO project_task_assignments (project_task_id, pic, start_date, end_date, estimate_hours, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    cleaned.forEach((a, index) => insert.run(taskId, a.pic, a.startDate, a.endDate, a.estimate, index));
    console.log(`[ptask:assignments] task=${taskId} đã lưu ${cleaned.length} giai đoạn`);
    // Có giai đoạn -> ngày/estimate/assignee của task lá được suy ra từ giai đoạn.
    // Không còn giai đoạn nào -> giữ nguyên giá trị nhập tay hiện có.
    const derived = deriveLeafFromAssignments(taskId);
    if (derived) {
      db.prepare(`
        UPDATE project_tasks
        SET ngay_bat_dau_du_kien = ?, ngay_ket_thuc_du_kien = ?, estimate_hours = ?, assignee = ?, updated_at = ?
        WHERE id = ? AND project_id = ?
      `).run(derived.start, derived.end, derived.estimate, derived.assignee, new Date().toISOString(), taskId, projectId);
    }
    recalculateProjectTaskRollups(projectId);
  });
}

router.get('/projects', (_req, res) => {
  const rows = db.prepare(`
    SELECT * FROM projects
    WHERE closed_at IS NULL AND pending_at IS NULL
    ORDER BY sort_order ASC, id DESC
  `).all() as Record<string, unknown>[];
  res.json(rows.map(mapProject));
});

router.get('/projects/closed', (_req, res) => {
  const rows = db.prepare(`
    SELECT * FROM projects
    WHERE closed_at IS NOT NULL OR pending_at IS NOT NULL
    ORDER BY COALESCE(pending_at, closed_at) DESC, sort_order ASC, id DESC
  `).all() as Record<string, unknown>[];
  res.json(rows.map(mapProject));
});

router.post('/projects', (req, res) => {
  const body = req.body as ProjectBody;
  const ten = body.ten?.trim();
  const pic = body.pic?.trim();
  const ngayBatDau = body.ngayBatDau?.trim();
  if (!ten) return res.status(400).json({ message: 'Tên Project là bắt buộc' });
  if (!pic) return res.status(400).json({ message: 'PIC là bắt buộc' });
  if (!ngayBatDau || !/^\d{4}-\d{2}-\d{2}$/.test(ngayBatDau)) {
    return res.status(400).json({ message: 'Ngày bắt đầu không hợp lệ' });
  }

  const now = new Date().toISOString();
  const nextSortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM projects').get() as { next: number };
  const result = db.prepare(`
    INSERT INTO projects (ten_project, pic, ngay_bat_dau, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ten, pic, ngayBatDau, nextSortOrder.next, now, now);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  res.status(201).json(mapProject(row));
});

router.patch('/projects/reorder', (req, res) => {
  const body = req.body as { projectIds?: Array<string | number> };
  const projectIds = parseIdList(body.projectIds);
  if (!projectIds || projectIds.length === 0) {
    return res.status(400).json({ message: 'Thứ tự project không hợp lệ' });
  }

  const existingRows = db.prepare('SELECT id FROM projects WHERE closed_at IS NULL AND pending_at IS NULL ORDER BY sort_order ASC, id DESC').all() as { id: number }[];
  const existingIds = existingRows.map((row) => row.id);
  const existingSet = new Set(existingIds);
  const uniqueIds = [...new Set(projectIds)];
  if (uniqueIds.length !== projectIds.length || uniqueIds.length !== existingIds.length || uniqueIds.some((id) => !existingSet.has(id))) {
    return res.status(400).json({ message: 'Danh sách project không khớp' });
  }

  const updateSortOrder = db.prepare('UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  try {
    withTransaction(() => {
      uniqueIds.forEach((id, index) => updateSortOrder.run(index + 1, now, id));
    });
  } catch (error) {
    return sendRouteError(res, error, 'Không thể sắp xếp project');
  }

  const rows = db.prepare('SELECT * FROM projects WHERE closed_at IS NULL AND pending_at IS NULL ORDER BY sort_order ASC, id DESC').all() as Record<string, unknown>[];
  res.json(rows.map(mapProject));
});

router.patch('/projects/:projectId/close', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = db.prepare('SELECT id, is_system FROM projects WHERE id = ? AND closed_at IS NULL AND pending_at IS NULL').get(projectId) as { id: number; is_system: number } | undefined;
  if (!project) return res.status(404).json({ message: 'Không tìm thấy project đang mở' });
  if (project.is_system) return res.status(400).json({ message: 'Không thể đóng project hệ thống "Khác"' });
  const incompleteTasks = db.prepare(`
    SELECT COUNT(*) AS total FROM project_tasks WHERE project_id = ? AND tien_do <> 100
  `).get(projectId) as { total: number };
  if (incompleteTasks.total > 0) {
    return res.status(400).json({ message: 'Chỉ có thể close project khi tiến độ tất cả task là 100%' });
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE projects SET closed_at = ?, updated_at = ? WHERE id = ?').run(now, now, projectId);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
  res.json(mapProject(row));
});

router.patch('/projects/:projectId/pending', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = db.prepare('SELECT id, is_system FROM projects WHERE id = ? AND closed_at IS NULL AND pending_at IS NULL').get(projectId) as { id: number; is_system: number } | undefined;
  if (!project) return res.status(404).json({ message: 'Không tìm thấy project đang mở' });
  if (project.is_system) return res.status(400).json({ message: 'Không thể pending project hệ thống "Khác"' });

  const now = new Date().toISOString();
  db.prepare('UPDATE projects SET pending_at = ?, updated_at = ? WHERE id = ?').run(now, now, projectId);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
  res.json(mapProject(row));
});

router.patch('/projects/:projectId/restore', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = db.prepare('SELECT id, is_system, pending_at, closed_at FROM projects WHERE id = ?').get(projectId) as { id: number; is_system: number; pending_at: string | null; closed_at: string | null } | undefined;
  if (!project) return res.status(404).json({ message: 'Không tìm thấy project' });
  if (project.is_system) return res.status(400).json({ message: 'Không thể restore project hệ thống "Khác"' });
  if (!project.pending_at || project.closed_at) return res.status(400).json({ message: 'Chỉ project pending mới có thể chuyển lại Inprogress' });

  const now = new Date().toISOString();
  db.prepare('UPDATE projects SET pending_at = NULL, updated_at = ? WHERE id = ?').run(now, projectId);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
  res.json(mapProject(row));
});

router.patch('/projects/:projectId', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = db.prepare('SELECT id, is_system FROM projects WHERE id = ?').get(projectId) as { id: number; is_system: number } | undefined;
  if (!project) return res.status(404).json({ message: 'Không tìm thấy project' });

  const body = req.body as ProjectBody;
  const ten = body.ten?.trim();
  if (!ten) return res.status(400).json({ message: 'Tên Project là bắt buộc' });

  // Project hệ thống "Khác": chỉ cho đổi tên, giữ nguyên PIC/ngày bắt đầu
  if (project.is_system) {
    db.prepare('UPDATE projects SET ten_project = ?, updated_at = ? WHERE id = ?')
      .run(ten, new Date().toISOString(), projectId);
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
    return res.json(mapProject(row));
  }

  const pic = body.pic?.trim();
  const ngayBatDau = body.ngayBatDau?.trim();
  if (!pic) return res.status(400).json({ message: 'PIC là bắt buộc' });
  if (!ngayBatDau || !/^\d{4}-\d{2}-\d{2}$/.test(ngayBatDau)) {
    return res.status(400).json({ message: 'Ngày bắt đầu không hợp lệ' });
  }

  db.prepare('UPDATE projects SET ten_project = ?, pic = ?, ngay_bat_dau = ?, updated_at = ? WHERE id = ?')
    .run(ten, pic, ngayBatDau, new Date().toISOString(), projectId);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>;
  res.json(mapProject(row));
});

router.delete('/projects/:projectId', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = db.prepare('SELECT id, is_system FROM projects WHERE id = ?').get(projectId) as { id: number; is_system: number } | undefined;
  if (!project) return res.status(404).json({ message: 'Không tìm thấy project' });
  if (project.is_system) return res.status(400).json({ message: 'Không thể xóa project hệ thống "Khác"' });

  try {
    withTransaction(() => {
      db.prepare('DELETE FROM project_tasks WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không thể xóa project');
  }
});

router.get('/projects/:projectId/tasks', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ message: 'Không tìm thấy project' });

  const rows = db.prepare(`
    SELECT * FROM project_tasks
    WHERE project_id = ?
    ORDER BY level ASC, parent_id IS NOT NULL ASC, parent_id ASC, sort_order ASC, id ASC
  `).all(projectId) as Record<string, unknown>[];
  res.json(attachAssignments(mapProjectTasksWithCalculatedRollups(rows)));
});

router.post('/projects/:projectId/tasks', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = db.prepare('SELECT id, is_system FROM projects WHERE id = ?').get(projectId) as { id: number; is_system: number } | undefined;
  if (!project) return res.status(404).json({ message: 'Không tìm thấy project' });

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
  const assignee = body.assignee?.trim() || null;

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
      project_id, parent_id, level, tieu_de, ghi_chu, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien,
      estimate_hours, tien_do, task_links, assignee, sort_order, execution_order, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId, parentId, level, tieuDe, ghiChu,
    ngayBatDauDuKien, ngayKetThucDuKien,
    estimateHours, tienDo,
    JSON.stringify(taskLinks), assignee, nextSortOrder.next, nextExecutionOrder.next, now, now
  );
  recalculateProjectTaskRollups(projectId);
  // Task mới luôn là lá -> nếu có giai đoạn thì lưu và suy ra envelope.
  if (Array.isArray(body.assignments) && body.assignments.length > 0) {
    try { saveTaskAssignments(projectId, Number(result.lastInsertRowid), body.assignments); }
    catch (error) { return sendRouteError(res, error, 'Không thể lưu phân công'); }
  }
  const row = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  res.status(201).json(attachAssignments([mapProjectTask(row)])[0]);
});

router.patch('/projects/:projectId/tasks/reorder', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ message: 'Không tìm thấy project' });

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

router.patch('/projects/:projectId/tasks/execution-order', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ message: 'Không tìm thấy project' });

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

router.patch('/projects/:projectId/tasks/:taskId', (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  if (!Number.isInteger(taskId)) return res.status(400).json({ message: 'Task không hợp lệ' });
  const task = db.prepare('SELECT id, estimate_hours, tien_do FROM project_tasks WHERE id = ? AND project_id = ?')
    .get(taskId, projectId) as { id: number; estimate_hours: number | null; tien_do: number } | undefined;
  if (!task) return res.status(404).json({ message: 'Không tìm thấy task project' });

  const body = req.body as ProjectTaskBody;
  const tieuDe = body.tieuDe?.trim();
  const ghiChu = body.ghiChu?.trim() || '';
  const taskLinks = normalizeTaskLinks(body.links);
  const ngayBatDauDuKien = body.ngayBatDauDuKien?.trim();
  const ngayKetThucDuKien = body.ngayKetThucDuKien?.trim();
  const estimateHours = parseProjectEstimateHours(body.estimateHours);
  const tienDo = Number(body.tienDo ?? 0);
  const assignee = body.assignee?.trim() || null;

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

  db.prepare(`
    UPDATE project_tasks
    SET tieu_de = ?, ghi_chu = ?, ngay_bat_dau_du_kien = ?, ngay_ket_thuc_du_kien = ?,
        estimate_hours = ?, tien_do = ?, task_links = ?, assignee = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(
    tieuDe, ghiChu, ngayBatDauDuKien, ngayKetThucDuKien,
    effectiveEstimateHours, effectiveTienDo,
    JSON.stringify(taskLinks), assignee, new Date().toISOString(),
    taskId, projectId
  );
  recalculateProjectTaskRollups(projectId);
  // Giai đoạn phân công chỉ áp dụng cho task lá. [] = xóa hết giai đoạn (quay về nhập tay).
  if (Array.isArray(body.assignments) && !hasChildren) {
    try { saveTaskAssignments(projectId, taskId, body.assignments); }
    catch (error) { return sendRouteError(res, error, 'Không thể lưu phân công'); }
  }
  const row = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
  res.json(attachAssignments([mapProjectTask(row)])[0]);
});

// Lưu (thay thế toàn bộ) các giai đoạn phân công của 1 task lá.
// Sau khi lưu: suy ra ngày/estimate/assignee của task từ giai đoạn rồi tính lại rollup.
router.put('/projects/:projectId/tasks/:taskId/assignments', (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  if (!Number.isInteger(taskId)) return res.status(400).json({ message: 'Task không hợp lệ' });
  const task = db.prepare('SELECT id FROM project_tasks WHERE id = ? AND project_id = ?').get(taskId, projectId);
  if (!task) return res.status(404).json({ message: 'Không tìm thấy task project' });

  const childCount = db.prepare('SELECT COUNT(*) AS total FROM project_tasks WHERE parent_id = ? AND project_id = ?')
    .get(taskId, projectId) as { total: number };
  if (childCount.total > 0) return res.status(400).json({ message: 'Chỉ task lá (không có task con) mới phân công theo giai đoạn' });

  const body = req.body as ProjectTaskAssignmentsBody;
  try {
    saveTaskAssignments(projectId, taskId, Array.isArray(body.assignments) ? body.assignments : []);
    const row = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
    res.json(attachAssignments([mapProjectTask(row)])[0]);
  } catch (error) {
    sendRouteError(res, error, 'Không thể lưu phân công');
  }
});

router.delete('/projects/:projectId/tasks/:taskId', (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(projectId)) return res.status(400).json({ message: 'Project không hợp lệ' });
  if (!Number.isInteger(taskId)) return res.status(400).json({ message: 'Task không hợp lệ' });
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
  });
  recalculateProjectTaskRollups(projectId);
  res.json({ deleted });
});

export default router;
