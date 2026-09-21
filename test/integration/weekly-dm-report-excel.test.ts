// Test tích hợp cho GET /api/weeks/:weekStart/dm-report.xlsx (CR-20260915-xuat-excel-bao-cao-dm).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import ExcelJS from 'exceljs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
void repoRoot;
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-weekly-xlsx-itest-'));
process.env.APPDATA = tmpAppData;

const { app } = await import('../../server/app.js');
const { db } = await import('../../server/db.js');

let server: Server;
let base = '';

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

const WEEK_START = '2026-09-14'; // thứ Hai thật
const PREV_WEEK_START = '2026-09-07';

function seedBaseData() {
  const now = new Date().toISOString();
  const project = db.prepare(`
    INSERT INTO projects (ten_project, pic, ngay_bat_dau, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run('Project Test Excel', 'itest', '2026-01-01', now, now);
  const projectId = Number(project.lastInsertRowid);

  const task = db.prepare(`
    INSERT INTO project_tasks (
      project_id, parent_id, level, tieu_de, ghi_chu, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien,
      estimate_hours, tien_do, task_links, assignee, sort_order, execution_order, created_at, updated_at
    ) VALUES (?, NULL, 1, ?, '', '2026-09-07', '2026-09-07', 7, 0, '[]', 'Nam', 1, 1, ?, ?)
  `).run(projectId, 'Task tuần trước', now, now);
  const taskId = Number(task.lastInsertRowid);

  // Task này là "mục tiêu" của TUẦN TRƯỚC (weekly_goals week_start = PREV_WEEK_START) -> xuất hiện ở
  // lastWeekGoals khi build cho WEEK_START. Đánh giá kèm theo: khong_dat + note.
  db.prepare(`
    INSERT INTO weekly_goals (week_start, project_id, project_task_id, assignee, goal_text, target_progress, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 'Nam', '', 100, 1, ?, ?)
  `).run(PREV_WEEK_START, projectId, taskId, now, now);
  db.prepare(`
    INSERT INTO weekly_task_evaluations (week_start, project_task_id, status, note, unplanned)
    VALUES (?, ?, 'khong_dat', 'Bận việc khác', 0)
  `).run(PREV_WEEK_START, taskId);

  // Mục tiêu TUẦN NÀY (gõ tay, không gắn task cụ thể) cho cùng project, giao 2 người -> nhân dòng.
  db.prepare(`
    INSERT INTO weekly_goals (week_start, project_id, project_task_id, assignee, goal_text, target_progress, sort_order, created_at, updated_at)
    VALUES (?, ?, NULL, 'Nam, Phú', 'Việc tuần này', 100, 2, ?, ?)
  `).run(WEEK_START, projectId, now, now);

  return { projectId, taskId };
}

async function getBuffer(p: string) {
  const res = await fetch(`${base}${p}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf };
}

test('GET /weeks/:weekStart/dm-report.xlsx: weekStart sai định dạng -> 400', async () => {
  const { res } = await getBuffer('/api/weeks/khong-phai-ngay/dm-report.xlsx');
  assert.equal(res.status, 400);
});

test('GET /weeks/:weekStart/dm-report.xlsx: tuần rỗng hoàn toàn -> 404 kèm message rõ', async () => {
  const { res, buf } = await getBuffer('/api/weeks/2099-01-05/dm-report.xlsx');
  assert.equal(res.status, 404);
  const body = JSON.parse(buf.toString('utf8'));
  assert.match(body.message, /chưa có dữ liệu/i);
});

test('GET /weeks/:weekStart/dm-report.xlsx: có dữ liệu -> 200, đúng content-type, đúng cấu trúc file', async () => {
  seedBaseData();
  const { res, buf } = await getBuffer(`/api/weeks/${WEEK_START}/dm-report.xlsx`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(res.headers.get('content-disposition') || '', new RegExp(`bao-cao-dm-tuan-${WEEK_START}\\.xlsx`));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];

  // Header đúng thứ tự 7 cột ở dòng 2.
  const headerValues = [1, 2, 3, 4, 5, 6, 7].map((c) => ws.getCell(2, c).value);
  assert.deepEqual(headerValues, ['Project', 'PIC', 'Tiến độ đến hết tuần trước', 'Status', 'Note', 'Mục tiêu tuần này', 'Note']);

  // Dòng 1 (title) merge hết 7 cột.
  const titleCell = ws.getCell(1, 1);
  assert.ok(String(titleCell.value).includes('BÁO CÁO TUẦN'));

  // FR-8: viền mảnh xám áp cho TOÀN BẢNG, kể cả title/header — không chỉ vùng dữ liệu
  // (bug tìm thấy qua review Codex 2026-09-15: ban đầu chỉ data row có border).
  assert.equal(titleCell.border?.top?.style, 'thin', 'title (dòng 1) phải có viền');
  const headerCell = ws.getCell(2, 1);
  assert.equal(headerCell.border?.top?.style, 'thin', 'header (dòng 2) phải có viền');

  // Tìm đúng dòng dữ liệu của task "Task tuần trước" (khong_dat) -> Status "Không hoàn thành" + Note.
  let foundKhongDat = false;
  let foundNhanDong = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const lastWeekText = ws.getCell(r, 3).value;
    const statusVal = ws.getCell(r, 4).value;
    const noteVal = ws.getCell(r, 5).value;
    if (lastWeekText === 'Task tuần trước') {
      foundKhongDat = true;
      assert.equal(statusVal, 'Không hoàn thành');
      assert.equal(noteVal, 'Bận việc khác');
      const fill = ws.getCell(r, 4).fill as ExcelJS.FillPattern;
      assert.equal(fill.fgColor?.argb, 'FFFFC7CE');
    }
    const thisWeekText = ws.getCell(r, 6).value;
    // Mục tiêu gõ tay (không gắn project_task) không có targetProgress -> buildWeekData trả null ->
    // buildDmReportRows không thêm suffix "(→x%)" (khác task thật, xem goalView() trong weekly-report.ts).
    if (thisWeekText === 'Việc tuần này') foundNhanDong++;
  }
  assert.ok(foundKhongDat, 'phải tìm thấy dòng "Task tuần trước" với Status Không hoàn thành');
  assert.equal(foundNhanDong, 2, 'mục tiêu giao "Nam, Phú" phải nhân thành 2 dòng');

  // Mọi dòng dữ liệu cao bằng nhau.
  const heights = new Set<number>();
  for (let r = 3; r <= ws.rowCount; r++) heights.add(ws.getRow(r).height || 0);
  assert.equal(heights.size, 1, 'mọi dòng dữ liệu phải cao bằng nhau');
});
