import { type LoaiTask, type TrangThai, type EmergencyTimingToken, validEmergencyTimingTokens } from '../types.js';
import { parseTaskLinks, sanitizeReleaseTemplateContent } from './utils.js';
import { recurrenceMatches } from './recurrence.js';
import { db } from '../db.js';

export function mapTask(row: Record<string, unknown>) {
  const rawThuTrongTuan = row.thu_trong_tuan == null ? null : String(row.thu_trong_tuan);
  return {
    id: Number(row.id),
    tenTask: String(row.ten_task),
    ghiChu: String(row.ghi_chu || ''),
    loaiTask: row.loai_task as LoaiTask,
    trangThai: row.trang_thai as TrangThai,
    ngayTao: String(row.ngay_tao),
    ngayHoanThanh: row.ngay_hoan_thanh == null ? null : String(row.ngay_hoan_thanh),
    gioBatDau: row.gio_bat_dau == null ? null : String(row.gio_bat_dau),
    gioKetThuc: row.gio_ket_thuc == null ? null : String(row.gio_ket_thuc),
    lapLaiKieu: row.lap_lai_kieu == null ? null : String(row.lap_lai_kieu),
    ngayTrongThang: row.ngay_trong_thang == null ? null : Number(row.ngay_trong_thang),
    thuTrongTuan: rawThuTrongTuan == null
      ? null
      : rawThuTrongTuan.includes(',')
        ? rawThuTrongTuan.split(',').map(Number).filter((v) => Number.isInteger(v))
        : Number(rawThuTrongTuan),
    ngayCuThe: row.ngay_cu_the == null ? null : String(row.ngay_cu_the),
    releaseMonth: row.release_month == null ? null : String(row.release_month),
    releaseDate: row.release_date == null ? null : String(row.release_date),
    links: parseTaskLinks(row.task_links),
    originRef: row.origin_ref == null ? null : String(row.origin_ref),
    replyToRef: row.reply_to_ref == null ? null : String(row.reply_to_ref)
  };
}

export function mapProject(row: Record<string, unknown>) {
  const pic = String(row.pic || '');
  return {
    id: String(row.id),
    ten: String(row.ten_project),
    pic,
    ngayBatDau: String(row.ngay_bat_dau),
    moTa: pic ? `PIC: ${pic}` : '',
    sortOrder: Number(row.sort_order || 0),
    closedAt: row.closed_at == null ? null : String(row.closed_at),
    pendingAt: row.pending_at == null ? null : String(row.pending_at),
    isSystem: Number(row.is_system || 0) === 1
  };
}

export function mapProjectTask(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    parentId: row.parent_id == null ? null : String(row.parent_id),
    level: Number(row.level),
    tieuDe: String(row.tieu_de),
    ghiChu: String(row.ghi_chu || ''),
    ngayBatDauDuKien: String(row.ngay_bat_dau_du_kien),
    ngayKetThucDuKien: String(row.ngay_ket_thuc_du_kien),
    estimateHours: row.estimate_hours == null ? null : Number(row.estimate_hours),
    tienDo: Number(row.tien_do),
    assignee: row.assignee == null ? '' : String(row.assignee),
    sortOrder: Number(row.sort_order || 0),
    executionOrder: Number(row.execution_order || row.sort_order || 0),
    links: parseTaskLinks(row.task_links)
  };
}

export function mapProjectTasksWithCalculatedRollups(rows: Record<string, unknown>[]) {
  const tasks = rows.map(mapProjectTask);
  const byParent = tasks.reduce<Record<string, typeof tasks>>((groups, task) => {
    const key = task.parentId || 'root';
    groups[key] = [...(groups[key] || []), task];
    return groups;
  }, {});
  const estimateById = new Map(tasks.map((task) => [task.id, task.estimateHours as number | null]));
  const progressById = new Map(tasks.map((task) => [task.id, task.tienDo]));
  const plannedStartById = new Map(tasks.map((task) => [task.id, task.ngayBatDauDuKien]));
  const plannedEndById = new Map(tasks.map((task) => [task.id, task.ngayKetThucDuKien]));

  [...tasks]
    .sort((a, b) => b.level - a.level)
    .forEach((task) => {
      const children = byParent[task.id] || [];
      if (children.length === 0) return;
      const childEstimates = children
        .map((child) => estimateById.get(child.id))
        .filter((estimate): estimate is number => estimate != null && estimate > 0);
      const totalEstimate = childEstimates.reduce((total, estimate) => total + estimate, 0);
      estimateById.set(task.id, totalEstimate > 0 ? totalEstimate : null);
      const childStarts = children.map((child) => plannedStartById.get(child.id)).filter((v): v is string => Boolean(v));
      const childEnds = children.map((child) => plannedEndById.get(child.id)).filter((v): v is string => Boolean(v));
      if (childStarts.length > 0) plannedStartById.set(task.id, childStarts.sort()[0]);
      if (childEnds.length > 0) plannedEndById.set(task.id, childEnds.sort().at(-1) || childEnds[0]);
      const completedEstimate = children.reduce((total, child) => {
        const childEstimate = estimateById.get(child.id);
        if (childEstimate == null || childEstimate <= 0) return total;
        const childProgress = Math.max(0, Math.min(100, progressById.get(child.id) || 0));
        return total + (childEstimate * childProgress / 100);
      }, 0);
      const calculatedProgress = totalEstimate > 0 ? Math.floor(completedEstimate / totalEstimate * 100) : 0;
      progressById.set(task.id, calculatedProgress);
    });

  return tasks.map((task) => ({
    ...task,
    ngayBatDauDuKien: plannedStartById.get(task.id) || task.ngayBatDauDuKien,
    ngayKetThucDuKien: plannedEndById.get(task.id) || task.ngayKetThucDuKien,
    estimateHours: estimateById.get(task.id) ?? null,
    tienDo: progressById.get(task.id) || 0
  }));
}

export function recalculateProjectTaskRollups(projectId: number) {
  const rows = db.prepare(`
    SELECT * FROM project_tasks
    WHERE project_id = ?
    ORDER BY level ASC, parent_id IS NOT NULL ASC, parent_id ASC, sort_order ASC, id ASC
  `).all(projectId) as Record<string, unknown>[];
  const tasks = mapProjectTasksWithCalculatedRollups(rows);
  const parentIds = new Set(tasks.map((task) => task.parentId).filter((v): v is string => Boolean(v)));
  const updateRollup = db.prepare(`
    UPDATE project_tasks
    SET ngay_bat_dau_du_kien = ?, ngay_ket_thuc_du_kien = ?,
        estimate_hours = ?, tien_do = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `);
  const now = new Date().toISOString();
  tasks
    .filter((task) => parentIds.has(task.id))
    .forEach((task) => {
      updateRollup.run(
        task.ngayBatDauDuKien,
        task.ngayKetThucDuKien,
        task.estimateHours,
        task.tienDo,
        now,
        Number(task.id),
        projectId
      );
    });
}

export function mapProjectTaskAssignment(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    pic: String(row.pic),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    estimateHours: row.estimate_hours == null ? null : Number(row.estimate_hours),
    sortOrder: Number(row.sort_order || 0)
  };
}

// Gắn mảng `assignments` (giai đoạn phân công) vào mỗi task — nạp theo lô để tránh N+1.
export function attachAssignments<T extends { id: string }>(tasks: T[]) {
  if (tasks.length === 0) return tasks.map((t) => ({ ...t, assignments: [] as ReturnType<typeof mapProjectTaskAssignment>[] }));
  const ids = tasks.map((t) => Number(t.id));
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM project_task_assignments WHERE project_task_id IN (${placeholders}) ORDER BY project_task_id ASC, sort_order ASC, id ASC`
  ).all(...ids) as Record<string, unknown>[];
  const byTask = new Map<number, ReturnType<typeof mapProjectTaskAssignment>[]>();
  for (const r of rows) {
    const tid = Number(r.project_task_id);
    if (!byTask.has(tid)) byTask.set(tid, []);
    byTask.get(tid)!.push(mapProjectTaskAssignment(r));
  }
  return tasks.map((t) => ({ ...t, assignments: byTask.get(Number(t.id)) || [] }));
}

// Suy ra ngày bắt đầu/kết thúc + estimate (tổng giờ) + assignee của task lá từ các giai đoạn.
// KHÔNG suy ra % tiến độ — tiến độ task lá do người dùng nhập tay. Giai đoạn chỉ để biết
// ai làm từ thời điểm nào tới thời điểm nào (+ giờ dự kiến để tính estimate task).
// Trả null nếu task chưa có giai đoạn nào (giữ nguyên giá trị nhập tay).
export function deriveLeafFromAssignments(taskId: number): { start: string; end: string; estimate: number | null; assignee: string } | null {
  const rows = db.prepare(
    'SELECT pic, start_date, end_date, estimate_hours FROM project_task_assignments WHERE project_task_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(taskId) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const starts = rows.map((r) => String(r.start_date)).sort();
  const ends = rows.map((r) => String(r.end_date)).sort();
  const totalHours = rows.reduce((sum, r) => sum + (r.estimate_hours == null ? 0 : Number(r.estimate_hours)), 0);
  const seen = new Set<string>();
  const pics: string[] = [];
  for (const r of rows) {
    const p = String(r.pic);
    if (p && !seen.has(p)) { seen.add(p); pics.push(p); }
  }
  return {
    start: starts[0],
    end: ends[ends.length - 1],
    estimate: totalHours > 0 ? totalHours : null,
    assignee: pics.join(', ')
  };
}

export function recurringMatchesDate(task: ReturnType<typeof mapTask>, date = new Date()) {
  if (task.loaiTask !== 'dinh_ky') return false;
  return recurrenceMatches(task, {
    dateKey: [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-'),
    day: date.getDate(),
    weekday: date.getDay()
  });
}

export function mapReleaseTemplate(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    content: sanitizeReleaseTemplateContent(String(row.content))
  };
}

export function mapReleaseTaskDefinition(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    note: String(row.note || ''),
    startTime: String(row.start_time),
    dateToken: String(row.date_token),
    templateId: row.template_id == null ? '' : String(row.template_id),
    links: parseTaskLinks(row.task_links),
    sortOrder: Number(row.sort_order || 0),
    replyToDefinitionId: row.reply_to_definition_id == null ? null : String(row.reply_to_definition_id)
  };
}

export function mapEmergencyReleaseTaskDefinition(row: Record<string, unknown>) {
  const timingToken = String(row.task_date);
  return {
    id: String(row.id),
    title: String(row.title),
    note: String(row.note || ''),
    timingToken: validEmergencyTimingTokens.has(timingToken as EmergencyTimingToken) ? timingToken : 'hotfix',
    startTime: String(row.start_time),
    immediatePriority: row.immediate_priority == null ? null : Number(row.immediate_priority),
    relativeOffsetMinutes: row.relative_offset_minutes == null ? null : Number(row.relative_offset_minutes),
    scheduleMode: row.schedule_mode == null ? null : String(row.schedule_mode),
    templateId: row.template_id == null ? '' : String(row.template_id),
    links: parseTaskLinks(row.task_links),
    sortOrder: Number(row.sort_order || 0),
    replyToDefinitionId: row.reply_to_definition_id == null ? null : String(row.reply_to_definition_id)
  };
}
