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

test('QA: đổi tên PIC lan sang project.pic / project_tasks.assignee (chuỗi "A, B")', async () => {
  const pic = await req('POST', '/api/pics', { name: '[itest] Renamer' });
  const proj = await req('POST', '/api/projects', { ten: '[itest] proj for rename', pic: '[itest] Renamer', ngayBatDau: '2026-09-01' });
  const task = await req('POST', `/api/projects/${proj.json.id}/tasks`, {
    tieuDe: 'task', ngayBatDauDuKien: '2026-09-01', ngayKetThucDuKien: '2026-09-02', tienDo: 0, assignee: 'Ai đó, [itest] Renamer'
  });

  const rename = await req('PATCH', `/api/pics/${pic.json.id}`, { name: '[itest] Renamer đã đổi' });
  assert.equal(rename.status, 200);

  const projAfter = await req('GET', '/api/projects');
  const projRow = (projAfter.json as { id: string; pic: string }[]).find((p) => p.id === proj.json.id);
  assert.equal(projRow?.pic, '[itest] Renamer đã đổi');

  const tasksAfter = await req('GET', `/api/projects/${proj.json.id}/tasks`);
  const taskRow = (tasksAfter.json as { id: string; assignee: string }[]).find((t) => t.id === task.json.id);
  assert.equal(taskRow?.assignee, 'Ai đó, [itest] Renamer đã đổi', 'chỉ phần tử khớp CHÍNH XÁC mới đổi, không đụng "Ai đó"');
});

test('QA: xoá PIC còn task chưa hoàn thành -> 400, không cho xoá', async () => {
  const pic = await req('POST', '/api/pics', { name: '[itest] Busy PIC' });
  const proj = await req('POST', '/api/projects', { ten: '[itest] proj busy', pic: 'ai', ngayBatDau: '2026-09-01' });
  await req('POST', `/api/projects/${proj.json.id}/tasks`, {
    tieuDe: 'task chưa xong', ngayBatDauDuKien: '2026-09-01', ngayKetThucDuKien: '2026-09-02', tienDo: 50, assignee: '[itest] Busy PIC'
  });

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
