// QA-2026-09-12: review toàn diện tính năng PIC — chưa có test tích hợp nào trước đây.
//
// Bug thật tìm thấy + sửa: PATCH /pics/:id khi gửi CẢ TÊN (trùng/rỗng) LẪN MÀU cùng lúc — trước đây
// cập nhật màu chạy TRƯỚC khi kiểm tên có hợp lệ/trùng hay không, nên request bị từ chối (400 "PIC này
// đã tồn tại") vẫn ÂM THẦM LƯU màu mới xuống DB — client thấy lỗi, tưởng không có gì thay đổi, nhưng
// thực ra màu đã đổi. Tái hiện qua HTTP thật trước khi sửa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-pics-itest-'));
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

test('QA: PATCH /pics/:id gửi tên TRÙNG + màu mới cùng lúc -> 400, màu KHÔNG được lưu (atomic)', async () => {
  const a = await req('POST', '/api/pics', { name: '[itest] PIC A', color: '#111111' });
  assert.equal(a.status, 201);
  const b = await req('POST', '/api/pics', { name: '[itest] PIC B', color: '#222222' });
  assert.equal(b.status, 201);

  const patch = await req('PATCH', `/api/pics/${a.json.id}`, { name: '[itest] PIC B', color: '#ff0000' });
  assert.equal(patch.status, 400);

  const list = await req('GET', '/api/pics');
  const found = (list.json as { id: string; color: string | null }[]).find((p) => p.id === a.json.id);
  assert.equal(found?.color, '#111111', 'màu phải giữ nguyên như trước request bị từ chối');
});

test('QA: PATCH /pics/:id gửi tên RỖNG + màu mới cùng lúc -> 400, màu KHÔNG được lưu', async () => {
  const a = await req('POST', '/api/pics', { name: '[itest] PIC C', color: '#333333' });
  assert.equal(a.status, 201);

  const patch = await req('PATCH', `/api/pics/${a.json.id}`, { name: '   ', color: '#ff0000' });
  assert.equal(patch.status, 400);

  const list = await req('GET', '/api/pics');
  const found = (list.json as { id: string; color: string | null }[]).find((p) => p.id === a.json.id);
  assert.equal(found?.color, '#333333');
});

test('QA: PATCH /pics/:id chỉ đổi màu (không đổi tên) -> vẫn hoạt động bình thường', async () => {
  const a = await req('POST', '/api/pics', { name: '[itest] PIC D', color: '#444444' });
  const patch = await req('PATCH', `/api/pics/${a.json.id}`, { color: '#555555' });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.color, '#555555');
});

test('QA: PATCH /pics/:id đổi tên hợp lệ + màu cùng lúc -> cả 2 đều lưu', async () => {
  const a = await req('POST', '/api/pics', { name: '[itest] PIC E', color: '#666666' });
  const patch = await req('PATCH', `/api/pics/${a.json.id}`, { name: '[itest] PIC E đã đổi', color: '#777777' });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.name, '[itest] PIC E đã đổi');
  assert.equal(patch.json.color, '#777777');
});

// CR-20260913 Lát 4: `projects.pic`/`project_tasks.assignee` không còn nhận input qua
// POST/PATCH /api/projects[...] (route ngừng đọc 2 field này — FR-15) — 2 test dưới đây kiểm cơ chế
// đổi-tên-lan-toả của pics.ts, vốn vẫn đọc/ghi thẳng 2 cột này bằng SQL thô (route đó không thuộc phạm
// vi Lát 4, không sửa). Vì API không còn đường ghi chuỗi tự do vào 2 cột này, mô phỏng đúng DỮ LIỆU
// LỊCH SỬ (di trú trước Lát 4) bằng cách chèn thẳng vào DB, thay vì gọi qua route mới.
test('QA: đổi tên PIC lan sang project.pic / project_tasks.assignee (chuỗi "A, B")', async () => {
  const pic = await req('POST', '/api/pics', { name: '[itest] Renamer' });
  const now = new Date().toISOString();
  const proj = db.prepare(`
    INSERT INTO projects (ten_project, pic, ngay_bat_dau, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run('[itest] proj for rename', '[itest] Renamer', '2026-09-01', now, now);
  const projectId = Number(proj.lastInsertRowid);
  const task = db.prepare(`
    INSERT INTO project_tasks (project_id, level, tieu_de, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien, tien_do, assignee, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, 0, ?, ?, ?)
  `).run(projectId, 'task', '2026-09-01', '2026-09-02', 'Ai đó, [itest] Renamer', now, now);
  const taskId = Number(task.lastInsertRowid);

  const rename = await req('PATCH', `/api/pics/${pic.json.id}`, { name: '[itest] Renamer đã đổi' });
  assert.equal(rename.status, 200);

  const projRow = db.prepare('SELECT pic FROM projects WHERE id = ?').get(projectId) as { pic: string };
  assert.equal(projRow.pic, '[itest] Renamer đã đổi');

  const taskRow = db.prepare('SELECT assignee FROM project_tasks WHERE id = ?').get(taskId) as { assignee: string };
  assert.equal(taskRow.assignee, 'Ai đó, [itest] Renamer đã đổi', 'chỉ phần tử khớp CHÍNH XÁC mới đổi, không đụng "Ai đó"');
});

test('QA: xoá PIC còn task chưa hoàn thành -> 400, không cho xoá', async () => {
  const pic = await req('POST', '/api/pics', { name: '[itest] Busy PIC' });
  const now = new Date().toISOString();
  const proj = db.prepare(`
    INSERT INTO projects (ten_project, pic, ngay_bat_dau, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run('[itest] proj busy', 'ai', '2026-09-01', now, now);
  db.prepare(`
    INSERT INTO project_tasks (project_id, level, tieu_de, ngay_bat_dau_du_kien, ngay_ket_thuc_du_kien, tien_do, assignee, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, 50, ?, ?, ?)
  `).run(Number(proj.lastInsertRowid), 'task chưa xong', '2026-09-01', '2026-09-02', '[itest] Busy PIC', now, now);

  const del = await req('DELETE', `/api/pics/${pic.json.id}`);
  assert.equal(del.status, 400);
});

test('QA: tạo PIC trùng tên chính xác -> 400', async () => {
  await req('POST', '/api/pics', { name: '[itest] Dup Exact' });
  const second = await req('POST', '/api/pics', { name: '[itest] Dup Exact' });
  assert.equal(second.status, 400);
});

// QA-2026-09-12 (xác nhận với người dùng): "Nam" và "nam" phải coi là trùng — tránh gõ nhầm case
// tạo ra 2 PIC khác nhau trong dropdown.
test('QA: tạo PIC trùng tên nhưng KHÁC HOA/THƯỜNG -> vẫn bị coi là trùng, 400', async () => {
  await req('POST', '/api/pics', { name: '[itest] CaseTest' });
  const second = await req('POST', '/api/pics', { name: '[itest] casetest' });
  assert.equal(second.status, 400);
});

test('QA: đổi tên PIC khác sang tên đã tồn tại nhưng KHÁC HOA/THƯỜNG -> vẫn 400', async () => {
  await req('POST', '/api/pics', { name: '[itest] Original' });
  const other = await req('POST', '/api/pics', { name: '[itest] To Rename' });
  const rename = await req('PATCH', `/api/pics/${other.json.id}`, { name: '[itest] original' });
  assert.equal(rename.status, 400);
});
