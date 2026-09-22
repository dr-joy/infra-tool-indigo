// Test cho server/lib/weekly-report.ts (CR-20260913 Lát 4 §6.3, "viết hẳn lại" theo quyết định Leader
// 2026-09-22) — engine Báo cáo tuần KHÔNG còn đọc `project_tasks.assignee` (cột đã đóng băng hoàn
// toàn): người phụ trách hiển thị giờ suy trực tiếp từ `project_task_assignments`, lọc theo giai đoạn
// chồng lấn với ĐÚNG tuần đang render. Gọi thẳng buildWeekData() trên DB tạm — không qua HTTP/auth,
// vì logic cần kiểm là thuần dữ liệu (nhóm theo user_id/legacy_pic_label + tuần).
//
// ⚠️ Phải cô lập DATA_DIR TRƯỚC khi import bất kỳ module nào kéo theo `server/db.js` (module đó tự mở
// DB thật ở cấp import) — đúng bài học đã ghi ở test/unit/weekly-report-excel.test.ts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-weekly-assignments-unit-'));
process.env.DATA_DIR = tmpDataDir;

const { db } = await import('../../server/db.js');
const { buildWeekData } = await import('../../server/lib/weekly-report.js');

after(() => {
  try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

const WEEK_START = '2026-09-14'; // thứ Hai thật
const WEEK_END = '2026-09-20';

let seq = 0;
function nextName(prefix: string): string {
  seq += 1;
  return `${prefix} ${seq}`;
}

function makeTeam(): number {
  const now = new Date().toISOString();
  const r = db.prepare('INSERT INTO teams (name, row_version, created_at) VALUES (?, 1, ?)').run(nextName('Team'), now);
  return Number(r.lastInsertRowid);
}

function makeUser(displayName: string): number {
  const now = new Date().toISOString();
  const r = db.prepare(`
    INSERT INTO users (issuer, subject, email, display_name, status, created_at)
    VALUES ('https://auth.drjoy.vn', ?, ?, ?, 'active', ?)
  `).run(nextName('sub'), `${nextName('user')}@drjoy.jp`, displayName, now);
  return Number(r.lastInsertRowid);
}

function makeProject(teamId: number): number {
  const now = new Date().toISOString();
  const r = db.prepare(`
    INSERT INTO projects (ten_project, pic, team_id, ngay_bat_dau, sort_order, created_at, updated_at)
    VALUES (?, 'itest', ?, '2026-01-01', 1, ?, ?)
  `).run(nextName('Project'), teamId, now, now);
  return Number(r.lastInsertRowid);
}

// `assignee` (cột project_tasks) vẫn NHẬN giá trị khi insert (cột chưa xoá khỏi schema, xem CR
// §6.3) nhưng CỐ Ý set khác với kỳ vọng test — nếu engine lỡ còn đọc lại cột này, test sẽ bắt được.
function makeTask(teamId: number, projectId: number): number {
  const now = new Date().toISOString();
  const r = db.prepare(`
    INSERT INTO project_tasks (
      project_id, parent_id, team_id, level, tieu_de, ghi_chu, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien,
      estimate_hours, tien_do, task_links, assignee, sort_order, execution_order, created_at, updated_at
    ) VALUES (?, NULL, ?, 1, ?, '', ?, ?, NULL, 0, '[]', 'GIA TRI RAC - khong duoc doc lai', 1, 1, ?, ?)
  `).run(projectId, teamId, nextName('Task'), WEEK_START, WEEK_END, now, now);
  return Number(r.lastInsertRowid);
}

function makeAssignment(taskId: number, opts: { userId?: number; legacyPicLabel?: string; startDate: string; endDate: string; sortOrder: number }): void {
  db.prepare(`
    INSERT INTO project_task_assignments (project_task_id, user_id, legacy_pic_label, start_date, end_date, estimate_hours, sort_order)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `).run(taskId, opts.userId ?? null, opts.legacyPicLabel ?? null, opts.startDate, opts.endDate, opts.sortOrder);
}

// Mục tiêu tuần gắn với task — `assignee` (weekly_goals) để NULL để buộc goalView() phải suy từ
// project_task_assignments (đúng nhánh cần test), không phải lấy tắt từ cột free-text còn sống này.
function makeWeeklyGoal(teamId: number, projectId: number, taskId: number): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO weekly_goals (week_start, team_id, project_id, project_task_id, assignee, goal_text, reason, target_progress, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, '', '', 100, 1, ?, ?)
  `).run(WEEK_START, teamId, projectId, taskId, now, now);
}

function findGoal(teamId: number, taskId: number) {
  const data = buildWeekData(WEEK_START, teamId);
  const taskIdStr = String(taskId);
  for (const grp of data.groups) {
    const found = grp.goals.find((g) => g.taskId === taskIdStr);
    if (found) return found;
  }
  return undefined;
}

test('buildWeekData: task có 2 người phụ trách CHỒNG thời gian trong tuần -> assignee liệt kê đủ cả 2 (không gộp về 1 người)', () => {
  const teamId = makeTeam();
  const userA = makeUser('Nguyễn Văn A');
  const userB = makeUser('Trần Thị B');
  const projectId = makeProject(teamId);
  const taskId = makeTask(teamId, projectId);
  // 2 giai đoạn chồng lấn nhau VÀ chồng lấn tuần báo cáo [2026-09-14, 2026-09-20].
  makeAssignment(taskId, { userId: userA, startDate: '2026-09-14', endDate: '2026-09-16', sortOrder: 0 });
  makeAssignment(taskId, { userId: userB, startDate: '2026-09-15', endDate: '2026-09-18', sortOrder: 1 });
  makeWeeklyGoal(teamId, projectId, taskId);

  const goal = findGoal(teamId, taskId);
  assert.ok(goal, 'phải tìm thấy mục tiêu tuần gắn với task vừa tạo');
  assert.equal(goal!.assignee, 'Nguyễn Văn A, Trần Thị B', 'phải liệt kê đủ cả 2 người phụ trách, đúng thứ tự sort_order');
});

test('buildWeekData: giai đoạn phân công NGOÀI tuần báo cáo bị loại, chỉ giữ người phụ trách của ĐÚNG tuần', () => {
  const teamId = makeTeam();
  const userInWeek = makeUser('Phạm Văn Trong Tuần');
  const userOutOfWeek = makeUser('Lê Thị Ngoài Tuần');
  const projectId = makeProject(teamId);
  const taskId = makeTask(teamId, projectId);
  makeAssignment(taskId, { userId: userInWeek, startDate: '2026-09-14', endDate: '2026-09-20', sortOrder: 0 });
  // Giai đoạn của người này kết thúc TRƯỚC khi tuần báo cáo bắt đầu -> không được tính vào tuần này.
  makeAssignment(taskId, { userId: userOutOfWeek, startDate: '2026-08-01', endDate: '2026-08-10', sortOrder: 1 });
  makeWeeklyGoal(teamId, projectId, taskId);

  const goal = findGoal(teamId, taskId);
  assert.equal(goal!.assignee, 'Phạm Văn Trong Tuần');
});

test('buildWeekData: task còn legacy_pic_label (chưa di trú sang User thật) vẫn hiện đúng nhãn cũ trong báo cáo', () => {
  const teamId = makeTeam();
  const projectId = makeProject(teamId);
  const taskId = makeTask(teamId, projectId);
  // Dòng lịch sử di trú: user_id NULL, chỉ còn legacy_pic_label (đúng CHECK ở schema/project.ts).
  makeAssignment(taskId, { legacyPicLabel: 'Định (chưa di trú)', startDate: '2026-09-14', endDate: '2026-09-20', sortOrder: 0 });
  makeWeeklyGoal(teamId, projectId, taskId);

  const goal = findGoal(teamId, taskId);
  assert.ok(goal, 'phải tìm thấy mục tiêu tuần gắn với task legacy');
  assert.equal(goal!.assignee, 'Định (chưa di trú)', 'phải hiện đúng nhãn legacy_pic_label cũ, không rỗng');
});

test('buildWeekData: task hoàn toàn KHÔNG có project_task_assignments -> assignee rỗng, không crash, không đọc lại project_tasks.assignee', () => {
  const teamId = makeTeam();
  const projectId = makeProject(teamId);
  const taskId = makeTask(teamId, projectId);
  makeWeeklyGoal(teamId, projectId, taskId);

  const goal = findGoal(teamId, taskId);
  assert.ok(goal, 'phải tìm thấy mục tiêu tuần');
  assert.equal(goal!.assignee, '', 'không có giai đoạn phân công nào -> assignee rỗng, KHÔNG lấy giá trị rác từ project_tasks.assignee');
});
