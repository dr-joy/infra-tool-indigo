// QA-2026-09-12: review toàn diện tính năng Project — 2 bug thật tìm thấy khi đọc code + tái hiện
// qua HTTP trên dữ liệu thật.
//
// 1. Rollup task cha (mapProjectTasksWithCalculatedRollups, server/lib/mappers.ts) loại bỏ task con
//    có estimateHours=1 khỏi tổng estimate + % tiến độ của task cha (ngưỡng `estimate > 1` thay vì
//    `estimate > 0`) — trong khi input estimateHours=1 đã được xác nhận là giá trị HỢP LỆ ở chỗ khác
//    (xem test/integration/project-tasks-estimate.test.ts, bugfix cũ). Hậu quả: 1 project toàn task
//    1 giờ luôn hiện estimate=null, tiến độ=0% dù đã làm xong hết.
// 2. Xoá task project (kể cả cây con) để lại weekly_goals MỒ CÔI vĩnh viễn — bảng này không có FK,
//    không tự dọn theo. Goal hiện "(không tên)" trên Weekly Report mãi mãi dù task đã bị xoá.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ptask-rollup-delete-itest-'));
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

async function req(method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function taoProject(): Promise<number> {
  const r = await req('POST', '/api/projects', { ten: '[itest] rollup+delete', pic: 'QA', ngayBatDau: '2026-09-01' });
  assert.equal(r.status, 201);
  return r.json.id;
}

test('QA: rollup task cha KHÔNG được bỏ qua task con có estimateHours=1', async () => {
  const projectId = await taoProject();
  const parent = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Cha', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-20', tienDo: 0
  });
  const parentId = parent.json.id;
  await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Con 1 giờ, xong 100%', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-13',
    tienDo: 100, estimateHours: 1, parentId
  });

  const list = await req('GET', `/api/projects/${projectId}/tasks`);
  const parentRow = (list.json as { id: string; estimateHours: number | null; tienDo: number }[]).find((t) => t.id === parentId);
  assert.equal(parentRow?.estimateHours, 1, 'estimate 1 giờ của con phải được cộng vào tổng của cha');
  assert.equal(parentRow?.tienDo, 100, 'con xong 100% với estimate hợp lệ -> cha cũng phải 100%');
});

test('QA: rollup vẫn cộng đúng khi trộn task con estimate=1 và estimate lớn hơn', async () => {
  const projectId = await taoProject();
  const parent = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Cha 2', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-20', tienDo: 0
  });
  const parentId = parent.json.id;
  await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Con A 1 giờ xong 100%', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-13',
    tienDo: 100, estimateHours: 1, parentId
  });
  await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Con B 3 giờ chưa làm', ngayBatDauDuKien: '2026-09-13', ngayKetThucDuKien: '2026-09-14',
    tienDo: 0, estimateHours: 3, parentId
  });

  const list = await req('GET', `/api/projects/${projectId}/tasks`);
  const parentRow = (list.json as { id: string; estimateHours: number | null; tienDo: number }[]).find((t) => t.id === parentId);
  assert.equal(parentRow?.estimateHours, 4, 'tổng estimate phải là 1 + 3 = 4');
  assert.equal(parentRow?.tienDo, 25, '(1*100% + 3*0%) / 4 = 25%');
});

test('QA: xoá task project không được để lại weekly_goals mồ côi cho tuần hiện tại/tương lai', async () => {
  const projectId = await taoProject();
  const task = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Task sẽ bị xoá', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-20', tienDo: 0
  });
  const taskId = Number(task.json.id);

  const now = new Date().toISOString();
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // thứ Hai của tuần hiện tại
  const currentWeek = d.toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO weekly_goals (week_start, project_id, project_task_id, assignee, goal_text, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(currentWeek, projectId, taskId, 'QA', 'Mục tiêu tuần này', '', now, now);

  const del = await req('DELETE', `/api/projects/${projectId}/tasks/${taskId}`);
  assert.equal(del.status, 200);

  const orphan = db.prepare('SELECT COUNT(*) AS c FROM weekly_goals WHERE project_task_id = ?').get(taskId) as { c: number };
  assert.equal(orphan.c, 0, 'weekly_goals của tuần hiện tại phải bị dọn theo khi task bị xoá');
});

test('QA: xoá task project KHÔNG được đụng weekly_goals của TUẦN ĐÃ QUA (hồ sơ lịch sử)', async () => {
  const projectId = await taoProject();
  const task = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Task có lịch sử tuần trước', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-20', tienDo: 0
  });
  const taskId = Number(task.json.id);

  const now = new Date().toISOString();
  const pastWeek = '2020-01-06'; // chắc chắn đã qua
  db.prepare(`
    INSERT INTO weekly_goals (week_start, project_id, project_task_id, assignee, goal_text, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(pastWeek, projectId, taskId, 'QA', 'Mục tiêu tuần đã qua (lịch sử)', '', now, now);

  const del = await req('DELETE', `/api/projects/${projectId}/tasks/${taskId}`);
  assert.equal(del.status, 200);

  const historical = db.prepare('SELECT COUNT(*) AS c FROM weekly_goals WHERE project_task_id = ? AND week_start = ?').get(taskId, pastWeek) as { c: number };
  assert.equal(historical.c, 1, 'goal của tuần ĐÃ QUA là hồ sơ lịch sử, không được xoá theo');
});

test('QA: xoá task cha (có con) dọn weekly_goals của CẢ CÂY, không chỉ chính task đó', async () => {
  const projectId = await taoProject();
  const parent = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Cha sẽ bị xoá cả cây', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-20', tienDo: 0
  });
  const parentId = Number(parent.json.id);
  const child = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Con trong cây bị xoá', ngayBatDauDuKien: '2026-09-12', ngayKetThucDuKien: '2026-09-13',
    tienDo: 0, parentId
  });
  const childId = Number(child.json.id);

  const now = new Date().toISOString();
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const currentWeek = d.toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO weekly_goals (week_start, project_id, project_task_id, assignee, goal_text, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(currentWeek, projectId, childId, 'QA', 'Mục tiêu của con', '', now, now);

  const del = await req('DELETE', `/api/projects/${projectId}/tasks/${parentId}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.deleted, 2, 'phải xoá cả cha lẫn con (2 dòng)');

  const orphan = db.prepare('SELECT COUNT(*) AS c FROM weekly_goals WHERE project_task_id = ?').get(childId) as { c: number };
  assert.equal(orphan.c, 0, 'goal của task con (trong cây bị xoá) cũng phải được dọn theo');
});
