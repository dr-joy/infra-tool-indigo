import { Router } from 'express';
import { db } from '../db.js';
import { recalculateProjectTaskRollups } from '../lib/mappers.js';
import { sendRouteError } from '../lib/utils.js';
import { isValidProjectTaskProgress } from '../types.js';
import {
  buildReportPlan, renderReport, renderDmReport, reportKinds, mondayOf, addDays, toISODate,
  validEvalStatuses, taskOverlapsWeek, buildTaskNumbers, buildWeekData, type EvalStatus,
} from '../lib/weekly-report.js';
import { buildDmReportWorkbook } from '../lib/weekly-report-excel.js';

const router = Router();

function normWeek(input: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  return mondayOf(input);
}

// Danh sách loại báo cáo + tuần hiện tại
router.get('/weeks/report-kinds', (_req, res) => {
  res.json({
    currentWeek: mondayOf(toISODate(new Date())),
    kinds: reportKinds.map((k) => ({ id: k.id, label: k.label, lang: k.lang })),
  });
});

// ── Badge & cảnh báo trên bảng project ───────────────────────────────────────────

// Task được đánh badge 🎯: mục tiêu của TUẦN CÓ MỤC TIÊU MỚI NHẤT và chưa hoàn thành.
router.get('/weeks/goal-badge-ids', (_req, res) => {
  const latest = db.prepare('SELECT MAX(week_start) AS w FROM weekly_goals WHERE project_task_id IS NOT NULL').get() as { w: string | null };
  if (!latest.w) return res.json([]);
  const rows = db.prepare(`
    SELECT DISTINCT g.project_task_id AS id
    FROM weekly_goals g
    JOIN project_tasks t ON t.id = g.project_task_id
    WHERE g.week_start = ? AND t.tien_do < 100
  `).all(latest.w) as { id: number }[];
  res.json(rows.map((r) => String(r.id)));
});

// Task CARRY-OVER (badge ⚠ "phải lưu tâm"): là mục tiêu của TUẦN CÓ MỤC TIÊU MỚI NHẤT, chưa xong,
// VÀ đã từng là mục tiêu ở một tuần trước đó (tức bị mang sang vì chưa hoàn thành).
// Hiển thị song song với badge 🎯 mục tiêu, kể cả khi đã được duyệt tiếp làm mục tiêu tuần này.
router.get('/weeks/at-risk-ids', (_req, res) => {
  const latest = db.prepare('SELECT MAX(week_start) AS w FROM weekly_goals WHERE project_task_id IS NOT NULL').get() as { w: string | null };
  if (!latest.w) return res.json([]);
  const rows = db.prepare(`
    SELECT DISTINCT g.project_task_id AS id
    FROM weekly_goals g
    JOIN project_tasks t ON t.id = g.project_task_id
    JOIN projects p ON p.id = t.project_id AND p.closed_at IS NULL
    WHERE g.week_start = ?
      AND t.tien_do < 100
      AND EXISTS (
        SELECT 1 FROM weekly_goals g2
        WHERE g2.project_task_id = g.project_task_id AND g2.week_start < ?
      )
  `).all(latest.w, latest.w) as { id: number }[];
  res.json(rows.map((r) => String(r.id)));
});

// ── History báo cáo đã phê duyệt ─────────────────────────────────────────────────

// Danh sách history (mới nhất trước)
router.get('/weeks/report-history', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, week_start, kind, mode, content, created_at, updated_at
    FROM weekly_report_history
    ORDER BY week_start DESC, kind ASC, mode ASC
  `).all() as Record<string, unknown>[];
  res.json(rows.map((r) => ({
    id: String(r.id),
    weekStart: String(r.week_start),
    kind: String(r.kind),
    mode: String(r.mode),
    content: String(r.content),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  })));
});

router.delete('/weeks/report-history/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'History không hợp lệ' });
  const result = db.prepare('DELETE FROM weekly_report_history WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy báo cáo' });
  res.json({ ok: true });
});

// Phê duyệt báo cáo: validate đã tồn tại cho tuần đó chưa; force = ghi đè
router.post('/weeks/:weekStart/report-history', (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const body = req.body as { kind?: string; content?: string; force?: boolean };
  const kind = String(body.kind || 'internal');
  // 1 báo cáo = dự án + member ghép lại -> mỗi tuần+loại chỉ có 1 bản (mode cố định 'full')
  const mode = 'full';
  const content = String(body.content || '').trim();
  if (!reportKinds.some((k) => k.id === kind)) return res.status(400).json({ message: 'Loại báo cáo không hợp lệ' });
  if (!content) return res.status(400).json({ message: 'Nội dung báo cáo trống' });

  const existing = db.prepare('SELECT id FROM weekly_report_history WHERE week_start = ? AND kind = ? AND mode = ?')
    .get(weekStart, kind, mode) as { id: number } | undefined;
  if (existing && !body.force) {
    return res.status(409).json({ message: 'Báo cáo của tuần này đã tồn tại', code: 'REPORT_EXISTS' });
  }

  const now = new Date().toISOString();
  if (existing) {
    db.prepare('UPDATE weekly_report_history SET content = ?, updated_at = ? WHERE id = ?').run(content, now, existing.id);
  } else {
    db.prepare('INSERT INTO weekly_report_history (week_start, kind, mode, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(weekStart, kind, mode, content, now, now);
  }
  res.json({ ok: true, overwritten: Boolean(existing) });
});

// ── Wizard tạo báo cáo ───────────────────────────────────────────────────────────

// Kế hoạch báo cáo: đánh giá từng task tuần trước + đề xuất mục tiêu tuần (kèm giải thích tính toán)
router.get('/weeks/:weekStart/plan', (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  res.json(buildReportPlan(weekStart));
});

// Áp dụng kết quả wizard: cập nhật tiến độ task + đánh giá từng task (tuần trước) + tạo mục tiêu đã duyệt
router.post('/weeks/:weekStart/apply', (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const prevWeekStart = addDays(weekStart, -7);
  const body = req.body as {
    progressUpdates?: { taskId: string | number; progress: number }[];
    evaluations?: { taskId: string | number; status?: string; note?: string; unplanned?: boolean }[];
    manualGoalUpdates?: { goalId: string | number; done?: boolean; note?: string }[];
    projectSummaries?: { projectId: string | number; content?: string }[];
    approvedGoals?: { projectTaskId?: string | number; projectId?: string | number; assignee?: string; targetProgress?: number; goalText?: string }[];
    newKhacGoals?: { text?: string; assignee?: string; targetProgress?: number }[];
  };

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
    // 1) Cập nhật tiến độ task (ghi đè tien_do)
    const updProgress = db.prepare('UPDATE project_tasks SET tien_do = ?, updated_at = ? WHERE id = ?');
    for (const u of progressUpdates) {
      const taskId = Number(u.taskId);
      const progress = Number(u.progress);
      if (!Number.isInteger(taskId) || !isValidProjectTaskProgress(progress)) continue;
      const task = db.prepare('SELECT project_id FROM project_tasks WHERE id = ?').get(taskId) as { project_id: number } | undefined;
      if (!task) continue;
      updProgress.run(progress, now, taskId);
      affectedProjects.add(task.project_id);
    }

    // 2) Đánh giá từng task của TUẦN TRƯỚC (status + lý do/ghi chú + cờ ngoài kế hoạch)
    const upEval = db.prepare(`
      INSERT INTO weekly_task_evaluations (week_start, project_task_id, status, note, unplanned) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(week_start, project_task_id) DO UPDATE SET status = excluded.status, note = excluded.note, unplanned = excluded.unplanned
    `);
    for (const e of evaluations) {
      const taskId = Number(e.taskId);
      if (!Number.isInteger(taskId)) continue;
      const exists = db.prepare('SELECT id FROM project_tasks WHERE id = ?').get(taskId);
      if (!exists) continue;
      const status = validEvalStatuses.has(e.status as EvalStatus) ? (e.status as EvalStatus) : 'dat';
      upEval.run(prevWeekStart, taskId, status, String(e.note || ''), e.unplanned ? 1 : 0);
    }

    // 2b) Đánh dấu xong / ghi chú cho mục tiêu gõ tay của TUẦN TRƯỚC
    const updManual = db.prepare(`
      UPDATE weekly_goals SET manual_done = ?, reason = ?, updated_at = ?
      WHERE id = ? AND project_task_id IS NULL
    `);
    for (const m of manualGoalUpdates) {
      const goalId = Number(m.goalId);
      if (!Number.isInteger(goalId)) continue;
      updManual.run(m.done ? 1 : 0, String(m.note || ''), now, goalId);
    }

    // 2c) Đánh giá chung theo project (bước Summary) — lưu cho TUẦN TRƯỚC
    const upSummary = db.prepare(`
      INSERT INTO weekly_project_summaries (week_start, project_id, content) VALUES (?, ?, ?)
      ON CONFLICT(week_start, project_id) DO UPDATE SET content = excluded.content
    `);
    for (const s of projectSummaries) {
      const pid = Number(s.projectId);
      if (!Number.isInteger(pid)) continue;
      upSummary.run(prevWeekStart, pid, String(s.content || ''));
    }

    // 3) Tạo mục tiêu tuần đã được duyệt
    const insGoal = db.prepare(`
      INSERT INTO weekly_goals (week_start, project_id, project_task_id, assignee, goal_text, reason, start_progress, target_progress, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)
    `);
    let order = (db.prepare('SELECT COALESCE(MAX(sort_order),0) n FROM weekly_goals WHERE week_start = ?').get(weekStart) as { n: number }).n;
    for (const g of approvedGoals) {
      const taskId = g.projectTaskId == null || g.projectTaskId === '' ? null : Number(g.projectTaskId);
      let projectId = g.projectId == null || g.projectId === '' ? null : Number(g.projectId);
      const goalText = g.goalText?.trim() || '';
      const assignee = g.assignee?.trim() || null;
      const target = g.targetProgress == null ? null : Math.max(0, Math.min(100, Math.round(Number(g.targetProgress))));
      let startProgress: number | null = null;
      if (taskId != null) {
        const task = db.prepare('SELECT project_id, assignee, tien_do, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien FROM project_tasks WHERE id = ?').get(taskId) as {
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
          const wasPrevGoal = db.prepare('SELECT 1 FROM weekly_goals WHERE project_task_id = ? AND week_start = ?').get(taskId, prevWeekStart);
          if (!(wasPrevGoal && task.tien_do < 100)) {
            skippedOutOfWeek += 1;
            continue;
          }
        }
        if (projectId == null) projectId = task.project_id;
        // PIC duyệt ở wizard phản ánh ngược vào task trong project
        if (assignee && assignee !== (task.assignee || '')) {
          db.prepare('UPDATE project_tasks SET assignee = ?, updated_at = ? WHERE id = ?').run(assignee, now, taskId);
        }
        const dup = db.prepare('SELECT id FROM weekly_goals WHERE week_start = ? AND project_task_id = ?').get(weekStart, taskId);
        if (dup) continue;
      } else if (!goalText) {
        continue;
      }
      order += 1;
      insGoal.run(weekStart, projectId, taskId, assignee, goalText, startProgress, target, order, now, now);
      created += 1;
    }

    // 4) Mục tiêu "Khác" gõ tay -> tạo task THẬT trong project hệ thống "Khác" (ngày = tuần này),
    //    rồi thêm làm mục tiêu tuần. Nhờ vậy có tiến độ + đánh giá như task project bình thường.
    if (newKhacGoals.length > 0) {
      const sys = db.prepare('SELECT id FROM projects WHERE is_system = 1 ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
      if (sys) {
        const insTask = db.prepare(`
          INSERT INTO project_tasks (project_id, parent_id, level, tieu_de, ghi_chu, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien,
            estimate_hours, tien_do, task_links, assignee, sort_order, execution_order, created_at, updated_at)
          VALUES (?, NULL, 1, ?, '', ?, ?, NULL, 0, '[]', ?, ?, ?, ?, ?)
        `);
        for (const g of newKhacGoals) {
          const text = g.text?.trim();
          if (!text) continue;
          const assignee = g.assignee?.trim() || null;
          const target = g.targetProgress == null ? 100 : Math.max(0, Math.min(100, Math.round(Number(g.targetProgress))));
          const nextSort = (db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM project_tasks WHERE project_id = ? AND parent_id IS NULL').get(sys.id) as { n: number }).n;
          const nextExecution = (db.prepare('SELECT COALESCE(MAX(execution_order),0)+1 n FROM project_tasks WHERE project_id = ?').get(sys.id) as { n: number }).n;
          const r = insTask.run(sys.id, text, weekStart, weekEnd, assignee, nextSort, nextExecution, now, now);
          order += 1;
          insGoal.run(weekStart, sys.id, Number(r.lastInsertRowid), assignee, '', 0, target, order, now, now);
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

// Text báo cáo đã format
router.get('/weeks/:weekStart/text', (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const kind = String(req.query.kind || 'internal');
  res.json({ text: renderReport(weekStart, kind) });
});

// Báo cáo DM kèm Risk: nhận risk + biện pháp theo từng project, trả text đã format
router.post('/weeks/:weekStart/dm-report', (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const body = req.body as { risks?: { projectId?: string | number | null; risk?: string; mitigation?: string }[] };
  const risks = Array.isArray(body.risks) ? body.risks.map((r) => ({
    projectId: r.projectId == null || r.projectId === '' ? null : String(r.projectId),
    risk: String(r.risk || ''),
    mitigation: String(r.mitigation || ''),
  })) : [];
  res.json({ text: renderDmReport(weekStart, risks) });
});

// Xuất Excel cho report kind "Báo cáo DM" — CR-20260915-xuat-excel-bao-cao-dm. Không nhận Risk (dữ liệu
// Risk chỉ thuộc POST /dm-report ở trên, không liên quan file này).
router.get('/weeks/:weekStart/dm-report.xlsx', async (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });

  const data = buildWeekData(weekStart);
  const hasContent = data.groups.some((g) => g.goals.length > 0 || g.lastWeekGoals.length > 0);
  if (!hasContent) return res.status(404).json({ message: 'Tuần này chưa có dữ liệu để xuất báo cáo' });

  const workbook = buildDmReportWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bao-cao-dm-tuan-${weekStart}.xlsx"`);
  res.send(Buffer.from(buffer));
});

// Danh sách mục tiêu của tuần (để xem & xóa mục tiêu duyệt nhầm)
router.get('/weeks/:weekStart/goals', (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const prevWeekStart = addDays(weekStart, -7);
  const taskNumbers = buildTaskNumbers();
  const projectOrder = new Map(
    (db.prepare('SELECT id, sort_order FROM projects').all() as { id: number; sort_order: number }[])
      .map((p) => [String(p.id), p.sort_order])
  );
  const rows = db.prepare(`
    SELECT g.id, g.project_id, g.project_task_id, g.assignee, g.goal_text, g.target_progress,
           t.tieu_de AS task_title, p.ten_project AS project_name
    FROM weekly_goals g
    LEFT JOIN project_tasks t ON t.id = g.project_task_id
    LEFT JOIN projects p ON p.id = g.project_id
    WHERE g.week_start = ?
    ORDER BY g.sort_order ASC, g.id ASC
  `).all(weekStart) as Record<string, unknown>[];

  // hasGoals + prevEvaluated dùng cho việc khóa nút "Tạo báo cáo" (đã chốt mục tiêu + đánh giá tuần trước)
  const evalCount = (db.prepare('SELECT COUNT(*) c FROM weekly_task_evaluations WHERE week_start = ?').get(prevWeekStart) as { c: number }).c
    + (db.prepare('SELECT COUNT(*) c FROM weekly_project_summaries WHERE week_start = ?').get(prevWeekStart) as { c: number }).c;

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
router.delete('/weeks/:weekStart/goals', (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const result = db.prepare('DELETE FROM weekly_goals WHERE week_start = ?').run(weekStart);
  res.json({ ok: true, deleted: result.changes });
});

router.delete('/weeks/:weekStart/goals/:id', (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  const id = Number(req.params.id);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Mục tiêu không hợp lệ' });
  const result = db.prepare('DELETE FROM weekly_goals WHERE id = ? AND week_start = ?').run(id, weekStart);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy mục tiêu' });
  res.json({ ok: true });
});

// Các task đang là mục tiêu của tuần (cho badge trên bảng project)
router.get('/weeks/:weekStart/goal-task-ids', (req, res) => {
  const weekStart = normWeek(req.params.weekStart);
  if (!weekStart) return res.status(400).json({ message: 'Tuần không hợp lệ' });
  const rows = db.prepare('SELECT DISTINCT project_task_id FROM weekly_goals WHERE week_start = ? AND project_task_id IS NOT NULL').all(weekStart) as { project_task_id: number }[];
  res.json(rows.map((r) => String(r.project_task_id)));
});

export default router;
