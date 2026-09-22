import { db } from '../db.js';
// Tiện ích ngày thuần (mondayOf/addDays/toISODate/taskOverlapsWeek) dùng chung nhiều tính năng —
// tách sang server/lib/date.ts (kế hoạch Council run 022dd1e5, xem docs/exchanges/2026-09-12.md),
// re-export tại đây để các nơi đang import từ file này không phải sửa lại đường dẫn.
export { toISODate, mondayOf, addDays, taskOverlapsWeek } from './date.js';
import { toISODate, mondayOf, addDays, taskOverlapsWeek, parseISO } from './date.js';

export function ddmm(iso: string | null | undefined): string {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

export function slashDate(iso: string): string {
  return iso.replace(/-/g, '/');
}

// ── Tổng hợp dữ liệu tuần ────────────────────────────────────────────────────────

export type EvalStatus = 'dat' | 'vuot' | 'khong_dat';
export const validEvalStatuses = new Set<EvalStatus>(['dat', 'vuot', 'khong_dat']);

// Tự phân loại theo % đạt được so với % mục tiêu (con người có thể sửa lại ở bước Summary).
export function autoEvalStatus(current: number | null, target: number | null): EvalStatus {
  if (current == null || target == null) return 'khong_dat';
  if (current > target) return 'vuot';
  if (current >= target) return 'dat';
  return 'khong_dat';
}

export interface GoalView {
  goalId: number;
  text: string;
  assignee: string;
  tienDo: number | null;
  dueDate: string;
  taskId: string | null;
  targetProgress: number | null; // % mục tiêu đã đặt cho task tuần đó
  status: EvalStatus;            // đánh giá con người (nếu có) hoặc tự động
  note: string;                  // lý do / ghi chú từng task
  achieved: boolean;             // status != khong_dat
}

export interface UnplannedItem {
  text: string;
  assignee: string;
  tienDo: number | null;
  note: string;
}

export interface ProjectGroup {
  projectId: string | null;
  name: string;
  lastWeekGoals: GoalView[];
  unplanned: UnplannedItem[]; // task đã làm tuần trước nhưng ngoài mục tiêu
  summary: string;            // đánh giá chung cho project (nhập ở bước Summary)
  goals: GoalView[];
  doneCount: number;
  totalCount: number;
}

export interface WeekData {
  weekStart: string;
  weekEnd: string;
  prevWeekStart: string;
  groups: ProjectGroup[];
  byMember: { assignee: string; items: { project: string; isOther: boolean; text: string; dueDate: string; tienDo: number | null; targetProgress: number | null }[] }[];
}

interface GoalRow {
  id: number;
  project_id: number | null;
  project_task_id: number | null;
  assignee: string | null;
  goal_text: string;
  reason: string;
  start_progress: number | null;
  target_progress: number | null;
  manual_done: number | null;
  sort_order: number;
}

interface TaskRow {
  id: number;
  project_id: number;
  tieu_de: string;
  tien_do: number;
  assignee: string | null;
  ngay_ket_thuc_du_kien: string;
}

const OTHER_LABEL = 'Khác';

// CR-20260913 Lát 4 (§6.2/§6.3): mọi hàm đọc dữ liệu Báo cáo tuần dưới đây giờ BẮT BUỘC nhận `teamId`
// và lọc theo đúng team đó — `projects`/`project_tasks`/`weekly_goals`/`weekly_task_evaluations`/
// `weekly_project_summaries` đều đã có cột `team_id`. Route (server/routes/weekly.ts) tự suy `teamId`
// qua authorize() trước khi gọi các hàm này; KHÔNG được để trống, nếu không dữ liệu nhiều team sẽ trộn
// lẫn vào cùng 1 báo cáo.
export function buildWeekData(weekStartInput: string, teamId: number): WeekData {
  const weekStart = mondayOf(weekStartInput);
  const weekEnd = addDays(weekStart, 6);
  const prevWeekStart = addDays(weekStart, -7);

  const projects = db.prepare('SELECT id, ten_project, sort_order, closed_at, pending_at, is_system FROM projects WHERE team_id = ?').all(teamId) as {
    id: number; ten_project: string; sort_order: number; closed_at: string | null; pending_at: string | null; is_system: number;
  }[];
  const projectName = new Map(projects.map((p) => [String(p.id), p.ten_project]));
  const projectOrder = new Map(projects.map((p) => [String(p.id), p.sort_order]));
  const systemProjectIds = new Set(projects.filter((p) => p.is_system).map((p) => String(p.id)));
  // Project pending: kết quả tuần trước vẫn giữ (lịch sử đã xảy ra), nhưng KHÔNG có mục tiêu tuần này.
  const pendingProjectIds = new Set(projects.filter((p) => p.pending_at).map((p) => String(p.id)));

  const tasks = db.prepare('SELECT id, project_id, tieu_de, tien_do, assignee, ngay_ket_thuc_du_kien FROM project_tasks WHERE team_id = ?').all(teamId) as unknown as TaskRow[];
  const taskById = new Map(tasks.map((tk) => [String(tk.id), tk]));

  const thisGoals = db.prepare('SELECT * FROM weekly_goals WHERE week_start = ? AND team_id = ? ORDER BY sort_order ASC, id ASC').all(weekStart, teamId) as unknown as GoalRow[];
  const lastGoals = db.prepare('SELECT * FROM weekly_goals WHERE week_start = ? AND team_id = ? ORDER BY sort_order ASC, id ASC').all(prevWeekStart, teamId) as unknown as GoalRow[];

  // Đánh giá từng task của tuần trước (điền ở wizard).
  const evalRows = db.prepare('SELECT project_task_id, status, note, unplanned FROM weekly_task_evaluations WHERE week_start = ? AND team_id = ?').all(prevWeekStart, teamId) as {
    project_task_id: number; status: EvalStatus; note: string; unplanned: number;
  }[];
  const evalByTask = new Map(evalRows.filter((r) => !r.unplanned).map((r) => [String(r.project_task_id), r]));

  // Đánh giá chung theo project (bước Summary)
  const summaryRows = db.prepare('SELECT project_id, content FROM weekly_project_summaries WHERE week_start = ? AND team_id = ?').all(prevWeekStart, teamId) as { project_id: number; content: string }[];
  const summaryByProject = new Map(summaryRows.map((r) => [String(r.project_id), r.content]));

  function goalView(g: GoalRow, useEval: boolean): GoalView {
    const task = g.project_task_id == null ? undefined : taskById.get(String(g.project_task_id));
    const text = g.goal_text?.trim() || task?.tieu_de || '(không tên)';
    const assignee = g.assignee?.trim() || task?.assignee?.trim() || '';
    const tienDo = task ? task.tien_do : null;
    const dueDate = task?.ngay_ket_thuc_du_kien || '';
    // Mục tiêu mặc định nếu chưa đặt = hoàn thành (100%).
    const targetProgress = task ? (g.target_progress ?? 100) : null;
    const saved = useEval && task ? evalByTask.get(String(task.id)) : undefined;
    const status: EvalStatus = saved?.status
      || (task ? autoEvalStatus(tienDo, targetProgress) : (g.manual_done === 1 ? 'dat' : 'khong_dat'));
    // Mục tiêu gõ tay: ghi chú lưu ngay trong weekly_goals.reason (đánh dấu xong ở wizard)
    const note = task ? (saved?.note || '') : (g.reason || '');
    return {
      goalId: g.id, text, assignee, tienDo, dueDate,
      taskId: task ? String(task.id) : null,
      targetProgress, status, note, achieved: status !== 'khong_dat',
    };
  }

  // Task đã làm tuần trước nhưng ngoài mục tiêu (unplanned = 1).
  const unplannedByProject = new Map<string, UnplannedItem[]>();
  evalRows.filter((r) => r.unplanned).forEach((r) => {
    const task = taskById.get(String(r.project_task_id));
    if (!task) return;
    const key = String(task.project_id);
    if (!unplannedByProject.has(key)) unplannedByProject.set(key, []);
    unplannedByProject.get(key)!.push({
      text: task.tieu_de, assignee: task.assignee?.trim() || '', tienDo: task.tien_do, note: r.note || '',
    });
  });

  // Gom nhóm theo project (kèm nhóm "Khác" cho goal không thuộc project nào)
  const groupKeys = new Set<string>();
  thisGoals.forEach((g) => groupKeys.add(g.project_id == null ? 'other' : String(g.project_id)));
  lastGoals.forEach((g) => groupKeys.add(g.project_id == null ? 'other' : String(g.project_id)));
  unplannedByProject.forEach((_v, key) => groupKeys.add(key));
  summaryByProject.forEach((content, key) => { if (content && projectName.has(key)) groupKeys.add(key); });

  const groups: ProjectGroup[] = [...groupKeys].map((key): ProjectGroup => {
    const isOther = key === 'other';
    const projectId = isOther ? null : key;
    const name = isOther ? OTHER_LABEL : (projectName.get(key) || `Project ${key}`);

    // Project hệ thống "Khác": chỉ giữ mục có nội dung thật (task còn tồn tại / đã nhập tên).
    // Mục rác (task đã xóa, chưa nhập gì) sẽ không đưa vào báo cáo.
    const isSystem = systemProjectIds.has(key);
    const keepGoal = (g: GoalView) => !isSystem || g.text !== '(không tên)';
    const isPending = pendingProjectIds.has(key);
    const goals = isPending ? [] : thisGoals.filter((g) => (g.project_id == null ? 'other' : String(g.project_id)) === key).map((g) => goalView(g, false)).filter(keepGoal);
    const lastWeekGoals = lastGoals.filter((g) => (g.project_id == null ? 'other' : String(g.project_id)) === key).map((g) => goalView(g, true)).filter(keepGoal);

    const doneCount = lastWeekGoals.filter((g) => g.achieved).length;
    return {
      projectId, name, lastWeekGoals,
      unplanned: unplannedByProject.get(key) || [],
      summary: isOther ? '' : (summaryByProject.get(key) || ''),
      goals, doneCount, totalCount: lastWeekGoals.length,
    };
  }).filter((grp) => grp.goals.length > 0 || grp.lastWeekGoals.length > 0 || grp.unplanned.length > 0 || !!grp.summary);

  groups.sort((a, b) => {
    if (a.projectId == null) return 1;
    if (b.projectId == null) return -1;
    return (projectOrder.get(a.projectId) ?? 0) - (projectOrder.get(b.projectId) ?? 0);
  });

  // Tổng hợp theo member (mục tiêu tuần này). Task nhiều PIC ("Định, Nam") hiện dưới từng người.
  const memberMap = new Map<string, { project: string; isOther: boolean; text: string; dueDate: string; tienDo: number | null; targetProgress: number | null }[]>();
  groups.forEach((grp) => {
    grp.goals.forEach((g) => {
      const members = g.assignee ? g.assignee.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const keys = members.length > 0 ? members : ['(Chưa gán)'];
      keys.forEach((key) => {
        if (!memberMap.has(key)) memberMap.set(key, []);
        memberMap.get(key)!.push({ project: grp.name, isOther: grp.projectId == null, text: g.text, dueDate: g.dueDate, tienDo: g.tienDo, targetProgress: g.targetProgress });
      });
    });
  });
  const byMember = [...memberMap.entries()]
    .sort((a, b) => (a[0] === '(Chưa gán)' ? 1 : b[0] === '(Chưa gán)' ? -1 : a[0].localeCompare(b[0], 'vi')))
    .map(([assignee, items]) => ({ assignee, items }));

  return { weekStart, weekEnd, prevWeekStart, groups, byMember };
}

// ── Render text theo loại báo cáo ────────────────────────────────────────────────
// Mỗi báo cáo gồm 2 phần ghép lại: (1) tổng hợp theo dự án, (2) tổng kết theo member.
// Các "section builder" bên dưới là phần dùng chung; mỗi loại báo cáo có hàm render
// riêng (renderInternal / renderVnManagement) để dễ tách luồng khi cần khác nhau.

interface Labels {
  lastWeek: string;
  goals: string;
  doneSummary: (a: number, b: number) => string;
  reasonLabel: string;
  noteLabel: string;
  summaryLabel: string;
  unplanned: string;
  noData: string;
  due: string;
  other: string;
  memberTitle: (week: string) => string;
  goalTarget: (from: number, to: number) => string;
  sep: string;
}

const VI_LABELS: Labels = {
  lastWeek: 'Kết quả tuần trước',
  goals: 'Mục tiêu tuần',
  doneSummary: (a, b) => `Hoàn thành ${a}/${b} mục tiêu`,
  reasonLabel: 'Lý do',
  noteLabel: 'Ghi chú',
  summaryLabel: 'Đánh giá',
  unplanned: 'Ngoài kế hoạch',
  noData: '(chưa có dữ liệu)',
  due: 'hạn',
  other: 'Khác',
  memberTitle: (week) => `Mục tiêu tuần theo người — tuần ${week}:`,
  goalTarget: (from, to) => `Mục tiêu: ${from}% -> ${to}%`,
  sep: '='.repeat(89),
};

const STATUS_ICONS: Record<EvalStatus, string> = { dat: '✅', vuot: '🔼', khong_dat: '❌' };

function groupLabel(grp: ProjectGroup, L: Labels): string {
  return grp.projectId == null ? L.other : grp.name;
}
// PIC đặt ở cuối dòng trong ngoặc vuông — dạng "<nội dung> — [Định, Nam]" để paste Google Docs gọn.
function withPics(text: string, assignee: string): string {
  return assignee ? `${text} — [${assignee}]` : text;
}
// Mục tiêu tuần: tên task ở dòng chính, PIC và "Mục tiêu: x% -> y%" tách thành dòng con.
function renderGoalLines(g: GoalView, L: Labels): string[] {
  const lines = [`      - ${g.text}`];
  if (g.assignee) lines.push(`         - PIC: ${g.assignee}`);
  if (g.tienDo != null && g.targetProgress != null) lines.push(`         - ${L.goalTarget(g.tienDo, g.targetProgress)}`);
  return lines;
}

function renderUnplannedLines(grp: ProjectGroup, L: Labels): string[] {
  if (grp.unplanned.length === 0) return [];
  const lines = [`      - ${L.unplanned}:`];
  grp.unplanned.forEach((u) => {
    let line = `          - ${withPics(u.text, u.assignee)}`;
    if (u.tienDo != null) line += ` (${u.tienDo}%)`;
    if (u.note) line += ` — ${u.note}`;
    lines.push(line);
  });
  return lines;
}

// ── Section builders (dùng chung cho các loại báo cáo) ───────────────────────────

// Phần "theo dự án" — gọn cho cấp trên VN (tập trung kết quả + mục tiêu, ít chi tiết người)
function projectSummarySection(data: WeekData, L: Labels): string {
  // Khoảng ngày hiển thị theo tuần làm việc T2–T6 (Thứ 2 → Thứ 6), không tính cuối tuần.
  const lines: string[] = [`Báo cáo tuần ${slashDate(data.weekStart)} – ${ddmm(addDays(data.weekStart, 4))}`, ''];
  let n = 0;
  for (const grp of data.groups) {
    if (grp.projectId == null && grp.goals.length === 0 && grp.lastWeekGoals.length === 0 && grp.unplanned.length === 0) continue;
    n += 1;
    lines.push(`${n}) ${groupLabel(grp, L)}:`);
    if (grp.totalCount > 0 || grp.summary) {
      if (grp.totalCount > 0) {
        lines.push(`  • ${L.lastWeek}: ${L.doneSummary(grp.doneCount, grp.totalCount)}`);
        grp.lastWeekGoals.filter((g) => !g.achieved).forEach((g) => {
          lines.push(`      - ❌ ${g.text}${g.tienDo != null && g.targetProgress != null ? ` (${g.tienDo}%/${g.targetProgress}%)` : ''}`);
          if (g.note) lines.push(`          - ${L.reasonLabel}: ${g.note}`);
        });
      } else {
        lines.push(`  • ${L.lastWeek}:`);
      }
      lines.push(...renderUnplannedLines(grp, L));
      if (grp.summary) lines.push(`      - ${L.summaryLabel}: ${grp.summary}`);
    }
    if (grp.goals.length > 0) {
      lines.push(`  • ${L.goals}:`);
      grp.goals.forEach((g) => lines.push(...renderGoalLines(g, L)));
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

// Phần "theo member"
function memberSection(data: WeekData, L: Labels): string {
  const lines: string[] = [L.memberTitle(slashDate(data.weekStart)), ''];
  if (data.byMember.length === 0) return `${lines[0]}\n\n${L.noData}`;
  data.byMember.forEach((m, i) => {
    lines.push(`${i + 1}) ${m.assignee}:`);
    m.items.forEach((it) => {
      lines.push(`  - (${it.isOther ? L.other : it.project}) ${it.text}`);
      if (it.tienDo != null && it.targetProgress != null) lines.push(`     - ${L.goalTarget(it.tienDo, it.targetProgress)}`);
    });
    lines.push('');
  });
  return lines.join('\n').trim();
}

// ── Render từng loại báo cáo (mỗi loại = phần dự án + phần member) ────────────────
// Tách riêng từng hàm để khi 1 loại cần khác đi thì sửa độc lập, không ảnh hưởng loại khác.

// Đường kẻ ngăn giữa phần "theo dự án" và phần "theo người" — thụt vào cho dễ nhìn khi paste.
const SECTION_SEP = `\n\n${' '.repeat(19)}${VI_LABELS.sep}\n\n`;

// Báo cáo nội bộ dạng Markdown (docs): giữ chi tiết riêng của nội bộ — kết quả từng mục tiêu
// tuần trước (✅/❌/🔼 + lý do), bảng mục tiêu tuần, và phần "mục tiêu theo người".
function renderInternal(data: WeekData): string {
  const blocks: string[] = [];
  let n = 0;

  for (const grp of data.groups) {
    const hasLastWeek = grp.lastWeekGoals.length > 0 || grp.unplanned.length > 0 || !!grp.summary;
    if (!hasLastWeek && grp.goals.length === 0) continue;
    n += 1;
    const lines: string[] = [`# ${n}. ${grp.name}`, ''];

    if (hasLastWeek) {
      lines.push('## Kết quả tuần trước', '');
      if (grp.lastWeekGoals.length > 0) {
        lines.push(`Hoàn thành ${grp.doneCount}/${grp.totalCount} mục tiêu.`, '');
        lines.push('| Trạng thái | Hạng mục | PIC | Kết quả | Lý do / Ghi chú |');
        lines.push('| --- | --- | --- | --- | --- |');
        grp.lastWeekGoals.forEach((g) => {
          const ket = g.tienDo != null && g.targetProgress != null ? `${g.tienDo}%/${g.targetProgress}%` : '';
          lines.push(`| ${STATUS_ICONS[g.status]} | ${mdCell(g.text)} | ${mdCell(g.assignee)} | ${ket} | ${mdCell(g.note)} |`);
        });
        lines.push('');
      }
      if (grp.unplanned.length > 0) {
        lines.push('**Ngoài kế hoạch:**', '');
        lines.push('| Hạng mục | PIC | Tiến độ | Ghi chú |');
        lines.push('| --- | --- | --- | --- |');
        grp.unplanned.forEach((u) => {
          lines.push(`| ${mdCell(u.text)} | ${mdCell(u.assignee)} | ${u.tienDo != null ? `${u.tienDo}%` : ''} | ${mdCell(u.note)} |`);
        });
        lines.push('');
      }
      if (grp.summary) lines.push(`**Đánh giá chung:** ${grp.summary}`, '');
    }

    if (grp.goals.length > 0) {
      lines.push('## Mục tiêu tuần', '');
      lines.push('| Hạng mục | PIC | Mục tiêu |');
      lines.push('| --- | --- | --- |');
      grp.goals.forEach((g) => {
        const mt = g.tienDo != null && g.targetProgress != null ? `${g.tienDo}% → ${g.targetProgress}%` : '';
        lines.push(`| ${mdCell(g.text)} | ${mdCell(g.assignee)} | ${mt} |`);
      });
    }

    blocks.push(lines.join('\n').trim());
  }

  // Phần "mục tiêu theo người"
  if (data.byMember.length > 0) {
    const m: string[] = [`# Mục tiêu tuần theo người (${slashDate(data.weekStart)})`, ''];
    data.byMember.forEach((mem) => {
      m.push(`## ${mem.assignee}`, '');
      m.push('| Dự án | Hạng mục | Mục tiêu |');
      m.push('| --- | --- | --- |');
      mem.items.forEach((it) => {
        const mt = it.tienDo != null && it.targetProgress != null ? `${it.tienDo}% → ${it.targetProgress}%` : '';
        m.push(`| ${mdCell(it.isOther ? OTHER_LABEL : it.project)} | ${mdCell(it.text)} | ${mt} |`);
      });
      m.push('');
    });
    blocks.push(m.join('\n').trim());
  }

  return blocks.join('\n\n---\n\n').trim();
}

function renderVnManagement(data: WeekData): string {
  return `${projectSummarySection(data, VI_LABELS)}${SECTION_SEP}${memberSection(data, VI_LABELS)}`;
}

// ── Registry các loại báo cáo (mở rộng được) ─────────────────────────────────────

export interface ReportKind {
  id: string;
  label: string;
  lang: 'vi';
  render: (data: WeekData) => string;
}

export const reportKinds: ReportKind[] = [
  { id: 'internal', label: 'Nội bộ Dev13', lang: 'vi', render: renderInternal },
  { id: 'vn_management', label: 'Báo cáo DM', lang: 'vi', render: renderVnManagement },
];

export function renderReport(weekStart: string, kindId: string, teamId: number): string {
  const kind = reportKinds.find((k) => k.id === kindId) || reportKinds[0];
  const data = buildWeekData(weekStart, teamId);
  return kind.render(data);
}

// ── Báo cáo DM kèm Risk ───────────────────────────────────────────────────────────
// Mỗi project (thuộc mục tiêu tuần này hoặc tuần trước): Đánh giá chung tuần trước
// + số mục tiêu hoàn thành / không hoàn thành / vượt chỉ tiêu, Mục tiêu tuần này,
// và Risk + biện pháp đối ứng (người dùng nhập ở bước trước).

export interface ProjectRiskInput {
  projectId: string | null; // null = nhóm "Khác"
  risk: string;
  mitigation: string;
}

// Một ô trong bảng markdown: thoát ký tự '|' và bỏ xuống dòng để không vỡ bảng.
function mdCell(s: string): string {
  return (s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

// Format Markdown (docs): mỗi project là 1 khối "# n. Tên", có Đánh giá chung (kèm số đếm),
// bảng Mục tiêu tuần, Risk, Biện pháp đối ứng; ngăn cách giữa các project bằng "---".
function renderDmReportText(data: WeekData, risks: Map<string, { risk: string; mitigation: string }>): string {
  const blocks: string[] = [];
  let n = 0;

  for (const grp of data.groups) {
    const hasThisWeek = grp.goals.length > 0;
    const hasLastWeek = grp.lastWeekGoals.length > 0 || !!grp.summary;
    if (!hasThisWeek && !hasLastWeek) continue;
    n += 1;
    const lines: string[] = [];

    lines.push(`# ${n}. ${grp.name}`, '');

    // Đánh giá chung: phần chữ (nhập ở wizard) + số đếm theo trạng thái tuần trước
    const done = grp.lastWeekGoals.filter((g) => g.status === 'dat').length;
    const failed = grp.lastWeekGoals.filter((g) => g.status === 'khong_dat').length;
    const exceeded = grp.lastWeekGoals.filter((g) => g.status === 'vuot').length;
    lines.push('## Đánh giá chung', '');
    lines.push(grp.summary ? grp.summary : '*(Chưa có đánh giá)*', '');
    lines.push(`* Số mục tiêu hoàn thành: ${done}`);
    lines.push(`* Số mục tiêu không hoàn thành: ${failed}`);
    lines.push(`* Số mục tiêu vượt chỉ tiêu: ${exceeded}`, '');

    // Mục tiêu tuần: bảng markdown (Hạng mục | PIC | Mục tiêu)
    lines.push('## Mục tiêu tuần', '');
    if (grp.goals.length === 0) {
      lines.push('*(Chưa có mục tiêu tuần này)*', '');
    } else {
      lines.push('| Hạng mục | PIC | Mục tiêu |');
      lines.push('| --- | --- | --- |');
      grp.goals.forEach((g) => {
        const muctieu = g.tienDo != null && g.targetProgress != null ? `${g.tienDo}% → ${g.targetProgress}%` : '';
        lines.push(`| ${mdCell(g.text)} | ${mdCell(g.assignee)} | ${muctieu} |`);
      });
      lines.push('');
    }

    // Risk + Biện pháp đối ứng (nhập tay ở bước trước)
    const r = risks.get(grp.projectId == null ? 'other' : grp.projectId);
    lines.push('## Risk', '');
    lines.push(`* ${r?.risk?.trim() || 'Không có.'}`, '');
    lines.push('## Biện pháp đối ứng', '');
    lines.push(`* ${r?.mitigation?.trim() || 'Không có.'}`);

    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n---\n\n').trim();
}

export function renderDmReport(weekStart: string, risks: ProjectRiskInput[], teamId: number): string {
  const data = buildWeekData(weekStart, teamId);
  const map = new Map<string, { risk: string; mitigation: string }>();
  for (const r of risks) {
    map.set(r.projectId == null ? 'other' : String(r.projectId), { risk: r.risk || '', mitigation: r.mitigation || '' });
  }
  return renderDmReportText(data, map);
}

// ── Tính kế hoạch báo cáo (đánh giá + đề xuất mục tiêu) ───────────────────────────

function maxISO(a: string, b: string): string { return a >= b ? a : b; }
function minISO(a: string, b: string): string { return a <= b ? a : b; }

// Số ngày làm việc (T2–T6) trong [from, to] (bao gồm 2 đầu). 0 nếu from > to.
function workingDaysBetween(from: string, to: string): number {
  if (from > to) return 0;
  let count = 0;
  const cur = parseISO(from);
  const end = parseISO(to);
  // chặn vòng lặp quá dài
  let guard = 0;
  while (cur <= end && guard < 3650) {
    const day = cur.getDay();
    if (day >= 1 && day <= 5) count++;
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return count;
}

// Số thứ tự task trong project ("1", "1.1", "1.1.1") — người dùng gọi đây là "ID task".
// order = thứ tự duyệt cây, dùng để sort danh sách đúng theo bảng project.
export function buildTaskNumbers(teamId: number): Map<string, { label: string; order: number }> {
  const rows = db.prepare('SELECT id, project_id, parent_id, sort_order FROM project_tasks WHERE team_id = ? ORDER BY sort_order ASC, id ASC').all(teamId) as {
    id: number; project_id: number; parent_id: number | null; sort_order: number;
  }[];
  const children = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.project_id}|${r.parent_id == null ? 'root' : r.parent_id}`;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(r);
  }
  const result = new Map<string, { label: string; order: number }>();
  let order = 0;
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  for (const pid of projectIds) {
    const walk = (parentKey: string, prefix: string) => {
      (children.get(`${pid}|${parentKey}`) || []).forEach((task, index) => {
        const label = prefix ? `${prefix}.${index + 1}` : String(index + 1);
        order += 1;
        result.set(String(task.id), { label, order });
        walk(String(task.id), label);
      });
    };
    walk('root', '');
  }
  return result;
}

export interface EvalGoal {
  taskId: string;
  taskNumber: string;      // "ID task" dạng 1, 1.1, 1.1.1
  taskOrder: number;
  title: string;
  assignee: string;
  currentProgress: number;
  startProgress: number | null;
  targetProgress: number;
  autoStatus: EvalStatus;  // máy tự phân loại theo % (phục vụ summary)
  status: EvalStatus;      // đánh giá đã lưu (nếu có), mặc định = autoStatus
  note: string;            // lý do / ghi chú đã lưu
}
export interface EvalProject {
  projectId: string;
  name: string;
  goals: EvalGoal[];
}
export interface SavedUnplanned {
  taskId: string;
  taskNumber: string;
  taskOrder: number;
  projectId: string;
  projectName: string;
  title: string;
  currentProgress: number;
  note: string;
}
// Mục tiêu gõ tay (không gắn task) của tuần trước — đánh dấu xong/ghi chú ở wizard
export interface ManualGoalPlan {
  goalId: string;
  projectName: string; // tên project hoặc "Khác"
  text: string;
  assignee: string;
  done: boolean;
  note: string;
}
export interface ProposedGoal {
  taskId: string;
  taskNumber: string;
  taskOrder: number;
  projectId: string;
  projectName: string;
  title: string;
  assignee: string;
  dueDate: string;
  currentProgress: number;
  computedTarget: number;
  estimateHours: number | null;
  isCarryOver: boolean;
  explanation: string;
  // Hằng số theo NGÀY (không đổi theo %) để client tính lại target khi % thực tế ở bước 1 thay đổi.
  remainingDays: number;
  thisWeekDays: number;
}
export interface ReportPlan {
  weekStart: string;
  weekEnd: string;
  today: string;
  evaluation: EvalProject[];
  manualGoals: ManualGoalPlan[];
  savedUnplanned: SavedUnplanned[];
  projectSummaries: { projectId: string; content: string }[]; // đánh giá chung đã lưu (tuần trước)
  summaryProjects: { projectId: string; name: string }[]; // project cần nhập "Đánh giá chung" (tuần trước ∪ tuần này)
  proposals: ProposedGoal[];
}

export function buildReportPlan(weekStartInput: string, teamId: number): ReportPlan {
  const weekStart = mondayOf(weekStartInput);
  const weekEnd = addDays(weekStart, 6);
  const prevWeekStart = addDays(weekStart, -7);
  const today = toISODate(new Date());

  // Chỉ lấy project đang chạy — project đã close hoặc đang pending không vào báo cáo
  // (pending = tạm dừng, task của nó không được đề xuất làm mục tiêu tuần).
  const projects = db.prepare('SELECT id, ten_project, sort_order, is_system FROM projects WHERE team_id = ? AND closed_at IS NULL AND pending_at IS NULL').all(teamId) as { id: number; ten_project: string; sort_order: number; is_system: number }[];
  const projectName = new Map(projects.map((p) => [String(p.id), p.ten_project]));
  const projectOrder = new Map(projects.map((p) => [String(p.id), p.sort_order]));

  const allTasks = db.prepare('SELECT id, project_id, tieu_de, tien_do, assignee, estimate_hours, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien FROM project_tasks WHERE team_id = ?').all(teamId) as unknown as {
    id: number; project_id: number; tieu_de: string; tien_do: number; assignee: string | null; estimate_hours: number | null; ngay_bat_dau_du_kien: string; ngay_ket_thuc_du_kien: string;
  }[];
  const tasks = allTasks.filter((t) => projectName.has(String(t.project_id)));
  const taskById = new Map(tasks.map((t) => [String(t.id), t]));
  const taskNumbers = buildTaskNumbers(teamId);
  const numberOf = (id: string) => taskNumbers.get(id)?.label || id;
  const orderOf = (id: string) => taskNumbers.get(id)?.order ?? Number(id);
  // task cha (có con) -> bỏ qua khi đề xuất (chỉ tính task lá)
  const parentIds = new Set(
    (db.prepare('SELECT DISTINCT parent_id FROM project_tasks WHERE team_id = ? AND parent_id IS NOT NULL').all(teamId) as { parent_id: number }[]).map((r) => String(r.parent_id))
  );

  const lastGoals = db.prepare('SELECT * FROM weekly_goals WHERE week_start = ? AND team_id = ? AND project_task_id IS NOT NULL ORDER BY sort_order ASC, id ASC').all(prevWeekStart, teamId) as unknown as GoalRow[];
  const lastManualGoals = db.prepare('SELECT * FROM weekly_goals WHERE week_start = ? AND team_id = ? AND project_task_id IS NULL ORDER BY sort_order ASC, id ASC').all(prevWeekStart, teamId) as unknown as GoalRow[];
  const thisGoalTaskIds = new Set(
    (db.prepare('SELECT project_task_id FROM weekly_goals WHERE week_start = ? AND team_id = ? AND project_task_id IS NOT NULL').all(weekStart, teamId) as { project_task_id: number }[]).map((r) => String(r.project_task_id))
  );
  // Đánh giá từng task đã lưu cho tuần trước (mở lại wizard vẫn thấy)
  const savedEvalRows = db.prepare('SELECT project_task_id, status, note, unplanned FROM weekly_task_evaluations WHERE week_start = ? AND team_id = ?').all(prevWeekStart, teamId) as {
    project_task_id: number; status: EvalStatus; note: string; unplanned: number;
  }[];
  const savedEvalByTask = new Map(savedEvalRows.filter((r) => !r.unplanned).map((r) => [String(r.project_task_id), r]));

  // 1) Đánh giá tuần trước: từng task, nhóm theo project, sort theo id task
  const evalByProject = new Map<string, EvalProject>();
  for (const g of lastGoals) {
    const task = taskById.get(String(g.project_task_id));
    if (!task) continue;
    const pid = String(task.project_id);
    const target = g.target_progress ?? 100;
    const startProgress = g.start_progress == null ? null : Number(g.start_progress);
    const autoStatus = autoEvalStatus(task.tien_do, target);
    if (!evalByProject.has(pid)) {
      evalByProject.set(pid, { projectId: pid, name: projectName.get(pid) || `Project ${pid}`, goals: [] });
    }
    const saved = savedEvalByTask.get(String(task.id));
    evalByProject.get(pid)!.goals.push({
      taskId: String(task.id), taskNumber: numberOf(String(task.id)), taskOrder: orderOf(String(task.id)),
      title: task.tieu_de, assignee: g.assignee?.trim() || task.assignee?.trim() || '',
      currentProgress: task.tien_do, startProgress, targetProgress: target,
      autoStatus, status: saved?.status || autoStatus, note: saved?.note || '',
    });
  }
  const evaluation = [...evalByProject.values()].sort((a, b) => (projectOrder.get(a.projectId) ?? 0) - (projectOrder.get(b.projectId) ?? 0));
  evaluation.forEach((ep) => ep.goals.sort((a, b) => a.taskOrder - b.taskOrder));

  // Mục tiêu gõ tay tuần trước (nhóm "Khác" hoặc gắn project nhưng không gắn task)
  const manualGoals: ManualGoalPlan[] = lastManualGoals.map((g) => ({
    goalId: String(g.id),
    projectName: g.project_id == null ? OTHER_LABEL : (projectName.get(String(g.project_id)) || `Project ${g.project_id}`),
    text: g.goal_text || '(không tên)',
    assignee: g.assignee?.trim() || '',
    done: g.manual_done === 1,
    note: g.reason || '',
  }));

  // Task ngoài kế hoạch đã ghi nhận trước đó
  const savedUnplanned: SavedUnplanned[] = savedEvalRows
    .filter((r) => r.unplanned)
    .map((r) => {
      const task = taskById.get(String(r.project_task_id));
      if (!task) return null;
      return {
        taskId: String(task.id), taskNumber: numberOf(String(task.id)), taskOrder: orderOf(String(task.id)),
        projectId: String(task.project_id),
        projectName: projectName.get(String(task.project_id)) || `Project ${task.project_id}`,
        title: task.tieu_de, currentProgress: task.tien_do, note: r.note || '',
      };
    })
    .filter((v): v is SavedUnplanned => v != null);

  // Đánh giá chung theo project đã lưu cho tuần trước
  const projectSummaries = (db.prepare('SELECT project_id, content FROM weekly_project_summaries WHERE week_start = ? AND team_id = ?').all(prevWeekStart, teamId) as { project_id: number; content: string }[])
    .map((r) => ({ projectId: String(r.project_id), content: r.content }));

  // Project cần nhập "Đánh giá chung" ở bước Tổng kết: hợp của project có mục tiêu TUẦN TRƯỚC
  // (để đánh giá kết quả) và project có mục tiêu TUẦN NÀY (để báo cáo có đánh giá kèm theo).
  const thisWeekProjectIds = (db.prepare('SELECT DISTINCT project_id FROM weekly_goals WHERE week_start = ? AND team_id = ? AND project_id IS NOT NULL').all(weekStart, teamId) as { project_id: number }[])
    .map((r) => String(r.project_id));
  const summaryIds = new Set<string>();
  evaluation.forEach((ep) => summaryIds.add(ep.projectId));
  thisWeekProjectIds.forEach((id) => { if (projectName.has(id)) summaryIds.add(id); });
  const summaryProjects = [...summaryIds]
    .map((id) => ({ projectId: id, name: projectName.get(id) || `Project ${id}` }))
    .sort((a, b) => (projectOrder.get(a.projectId) ?? 0) - (projectOrder.get(b.projectId) ?? 0));

  // 2) Đề xuất mục tiêu tuần này:
  //    - CARRY-OVER: mọi task là mục tiêu TUẦN TRƯỚC mà chưa xong (<100%) -> LUÔN đề xuất tiếp
  //      (kể cả quá hạn), mặc định được tick để tự tiếp tục; user bỏ tick nếu không muốn.
  //    - Task lá chưa xong có NGÀY DỰ KIẾN GIAO VỚI TUẦN cũng được đề xuất (kể cả việc lẻ "Khác").
  const carryOverSet = new Set<string>();
  for (const g of lastGoals) {
    const t = taskById.get(String(g.project_task_id));
    if (!t || parentIds.has(String(t.id)) || t.tien_do >= 100) continue;
    carryOverSet.add(String(t.id));
  }
  const candidateIds = new Set<string>(carryOverSet); // carry-over luôn là ứng viên
  for (const t of tasks) {
    if (parentIds.has(String(t.id))) continue;       // bỏ task cha
    if (t.tien_do >= 100) continue;                   // đã xong
    if (taskOverlapsWeek(t.ngay_bat_dau_du_kien, t.ngay_ket_thuc_du_kien, weekStart, weekEnd)) candidateIds.add(String(t.id));
  }

  const proposals: ProposedGoal[] = [];
  for (const id of candidateIds) {
    if (thisGoalTaskIds.has(id)) continue; // đã là mục tiêu tuần này rồi
    const t = taskById.get(id)!;
    const cur = t.tien_do;
    const remainingPct = 100 - cur;
    const plannedEnd = t.ngay_ket_thuc_du_kien;
    const startFrom = maxISO(today, t.ngay_bat_dau_du_kien); // mốc: hôm nay hoặc ngày bắt đầu nếu ở tương lai
    const remainingDays = workingDaysBetween(startFrom, plannedEnd);
    const thisWeekFrom = maxISO(startFrom, weekStart);
    const thisWeekTo = minISO(plannedEnd, weekEnd);
    const thisWeekDays = workingDaysBetween(thisWeekFrom, thisWeekTo);
    const est = t.estimate_hours;

    let computedTarget: number;
    let explanation: string;
    if (remainingDays <= 0) {
      computedTarget = 100;
      explanation = `Quá hạn (${ddmm(plannedEnd)}) → đặt mục tiêu hoàn thành 100% trong tuần.`;
    } else {
      const addPct = Math.round((remainingPct / remainingDays) * thisWeekDays);
      computedTarget = Math.min(100, cur + addPct);
      if (est != null && est > 1) {
        const consumed = +(est * cur / 100).toFixed(1);
        const remainH = +(est - consumed).toFixed(1);
        const perDayH = +(remainH / remainingDays).toFixed(2);
        const weekH = +(perDayH * thisWeekDays).toFixed(1);
        explanation = `Estimate ${est}h, đã xong ${cur}% (${consumed}h) → còn ${remainH}h. ` +
          `Còn ${remainingDays} ngày làm việc tới hạn ${ddmm(plannedEnd)} → ${perDayH}h/ngày. ` +
          `Tuần này ${thisWeekDays} ngày ⇒ ${weekH}h ≈ +${addPct}% ⇒ mục tiêu ${computedTarget}%.`;
      } else {
        explanation = `Chưa có estimate → chia đều % còn lại: còn ${remainingPct}%, ` +
          `${remainingDays} ngày làm việc tới hạn ${ddmm(plannedEnd)}, tuần này ${thisWeekDays} ngày ⇒ +${addPct}% ⇒ mục tiêu ${computedTarget}%.`;
      }
    }

    proposals.push({
      taskId: id, taskNumber: numberOf(id), taskOrder: orderOf(id),
      projectId: String(t.project_id), projectName: projectName.get(String(t.project_id)) || `Project ${t.project_id}`,
      title: t.tieu_de, assignee: t.assignee?.trim() || '', dueDate: plannedEnd,
      currentProgress: cur, computedTarget, estimateHours: est, isCarryOver: carryOverSet.has(id), explanation,
      remainingDays, thisWeekDays,
    });
  }
  // Gom theo project, sort theo "ID task" (số thứ tự trong project) — thống nhất với các bước khác
  proposals.sort((a, b) => {
    const po = (projectOrder.get(a.projectId) ?? 0) - (projectOrder.get(b.projectId) ?? 0);
    if (po !== 0) return po;
    return a.taskOrder - b.taskOrder;
  });

  return { weekStart, weekEnd, today, evaluation, manualGoals, savedUnplanned, projectSummaries, summaryProjects, proposals };
}
