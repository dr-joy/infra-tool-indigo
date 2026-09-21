// Test tích hợp CRUD tasks + chuẩn hóa lỗi (HttpError -> đúng status). Chạy Express thật + DB cô lập.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tasks-itest-'));
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

test('POST /tasks thiếu tên -> 400 kèm message (HttpError qua middleware)', async () => {
  const r = await req('POST', '/api/tasks', { loaiTask: 'don_le' });
  assert.equal(r.status, 400);
  assert.match(String(r.json.message), /Tên task/);
});

test('POST /tasks đơn lẻ -> 201, rồi GET /tasks thấy trong kho', async () => {
  const created = await req('POST', '/api/tasks', { tenTask: '[itest] task A', loaiTask: 'don_le' });
  assert.equal(created.status, 201);
  assert.equal(created.json.tenTask, '[itest] task A');
  const list = await req('GET', '/api/tasks?date=2026-07-24');
  assert.ok(list.json.khoTask.some((t: any) => t.id === created.json.id));
});

// ── QA-2026-09-12: review toàn diện từng tính năng — Task cá nhân ──────────────────────────────

test('QA: POST /tasks loaiTask không hợp lệ -> 400 (trước đây vỡ CHECK constraint -> 500)', async () => {
  const r = await req('POST', '/api/tasks', { tenTask: '[itest] bad loai', loaiTask: 'khong_hop_le' });
  assert.equal(r.status, 400);
  assert.match(String(r.json.message), /Loại task/);
});

test('QA: POST /tasks dinh_ky lapLaiKieu=hang_tuan không kèm thuTrongTuan -> 400, không tạo task (trước đây 201 nhưng task không bao giờ hiện ra)', async () => {
  const r = await req('POST', '/api/tasks', {
    tenTask: '[itest] hang_tuan no weekday', loaiTask: 'dinh_ky', gioBatDau: '09:00', gioKetThuc: '09:30', lapLaiKieu: 'hang_tuan'
  });
  assert.equal(r.status, 400);
  assert.match(String(r.json.message), /Hàng tuần/);
  const total = (db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE ten_task = '[itest] hang_tuan no weekday'").get() as { c: number }).c;
  assert.equal(total, 0);
});

test('QA: POST /tasks dinh_ky lapLaiKieu=hang_tuan kèm thuTrongTuan hợp lệ -> 201', async () => {
  const r = await req('POST', '/api/tasks', {
    tenTask: '[itest] hang_tuan ok', loaiTask: 'dinh_ky', gioBatDau: '09:00', gioKetThuc: '09:30',
    lapLaiKieu: 'hang_tuan', thuTrongTuan: [1, 3]
  });
  assert.equal(r.status, 201);
});

test('QA: POST /tasks dinh_ky lapLaiKieu=hang_thang không kèm ngayTrongThang -> 400, không tạo task', async () => {
  const r = await req('POST', '/api/tasks', {
    tenTask: '[itest] hang_thang no day', loaiTask: 'dinh_ky', gioBatDau: '09:00', gioKetThuc: '09:30', lapLaiKieu: 'hang_thang'
  });
  assert.equal(r.status, 400);
  assert.match(String(r.json.message), /Hàng tháng/);
  const total = (db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE ten_task = '[itest] hang_thang no day'").get() as { c: number }).c;
  assert.equal(total, 0);
});

test('QA: POST /tasks dinh_ky lapLaiKieu=hang_thang ngayTrongThang=45 (ngoài phạm vi 1-31) -> 400', async () => {
  const r = await req('POST', '/api/tasks', {
    tenTask: '[itest] hang_thang out of range', loaiTask: 'dinh_ky', gioBatDau: '09:00', gioKetThuc: '09:30',
    lapLaiKieu: 'hang_thang', ngayTrongThang: 45
  });
  assert.equal(r.status, 400);
});

test('QA: PATCH /tasks/:id đổi lapLaiKieu sang hang_tuan mà không kèm thuTrongTuan -> 400, task giữ nguyên trạng thái cũ', async () => {
  const created = await req('POST', '/api/tasks', {
    tenTask: '[itest] patch hang_tuan invalid', loaiTask: 'dinh_ky', gioBatDau: '09:00', gioKetThuc: '09:30', lapLaiKieu: 'hang_ngay'
  });
  assert.equal(created.status, 201);
  const r = await req('PATCH', `/api/tasks/${created.json.id}`, {
    tenTask: '[itest] patch hang_tuan invalid', lapLaiKieu: 'hang_tuan'
  });
  assert.equal(r.status, 400);
  const row = db.prepare('SELECT lap_lai_kieu FROM tasks WHERE id = ?').get(created.json.id) as { lap_lai_kieu: string };
  assert.equal(row.lap_lai_kieu, 'hang_ngay', 'không được đổi khi request bị từ chối');
});

test('CR-20260814: sync-preview không nhận payload tasks nữa — chỉ đọc releaseMonth, tự so definition đã lưu', async () => {
  const releaseMonth = '2099-01';
  const created = await req('POST', '/api/tasks', {
    tenTask: '[itest] bl006-valid', loaiTask: 'dinh_ky', gioBatDau: '10:00',
    gioKetThuc: '10:15', lapLaiKieu: 'hang_ngay'
  });
  assert.equal(created.status, 201);
  db.prepare('UPDATE tasks SET release_month=?, origin_ref=?, ngay_cu_the=?, release_date=? WHERE id=?')
    .run(releaseMonth, 'bl006-valid-def', '2099-01-15', '2099-01-15', created.json.id);

  const def = await req('POST', '/api/release/task-definitions', {
    id: 'bl006-valid-def', title: '[itest] valid changed', startTime: '10:00', dateToken: 'release.date'
  });
  assert.equal(def.status, 201);

  const preview = await req('POST', '/api/schedules/release/sync-preview', { releaseMonth });
  assert.equal(preview.status, 200);
  assert.ok(preview.json.willUpdate.some((item: { originRef: string }) => item.originRef === 'bl006-valid-def'));
});

test('CR-20260814 FR-5: GET /tasks trả lechDefinition=true cho task đang lệch definition gốc', async () => {
  const releaseMonth = '2099-12';
  const releaseDate = '2099-12-15';
  const created = await req('POST', '/api/tasks', {
    tenTask: '[itest] fr5-dashboard', loaiTask: 'dinh_ky', gioBatDau: '10:00',
    gioKetThuc: '10:15', lapLaiKieu: 'hang_ngay'
  });
  const definitionId = `itest-fr5-def-${created.json.id}`;
  await req('POST', '/api/release/task-definitions', {
    id: definitionId, title: '[itest] fr5-dashboard ĐÃ ĐỔI KHÁC HẲN', startTime: '10:00', dateToken: 'release.date'
  });
  db.prepare('UPDATE tasks SET origin_ref = ?, release_month = ?, release_date = ?, ngay_cu_the = ? WHERE id = ?')
    .run(definitionId, releaseMonth, releaseDate, releaseDate, created.json.id);

  const list = await req('GET', `/api/tasks?date=${releaseDate}`);
  const found = (list.json.taskDinhKy as { id: number; lechDefinition?: boolean }[]).find((t) => t.id === created.json.id);
  assert.equal(found?.lechDefinition, true);
});

test('CR-20260814 FR-5: task release KHÔNG lệch (hoặc không tra được definition) -> lechDefinition=false', async () => {
  const created = await req('POST', '/api/tasks', {
    tenTask: '[itest] fr5-khong-lech', loaiTask: 'dinh_ky', gioBatDau: '10:00',
    gioKetThuc: '10:15', lapLaiKieu: 'hang_ngay'
  });
  const list = await req('GET', '/api/tasks?date=2099-01-01');
  const found = (list.json.taskDinhKy as { id: number; lechDefinition?: boolean }[]).find((t) => t.id === created.json.id);
  assert.equal(found?.lechDefinition, false);
});

test('PATCH status không hợp lệ -> 400; task không tồn tại -> 404', async () => {
  const bad = await req('PATCH', '/api/tasks/999999/status', { trangThai: 'xyz' });
  assert.equal(bad.status, 400);
  const missing = await req('PATCH', '/api/tasks/999999/status', { trangThai: 'da_hoan_thanh' });
  assert.equal(missing.status, 404);
});

test('Hoàn thành task -> xuất hiện ở /history', async () => {
  const created = await req('POST', '/api/tasks', { tenTask: '[itest] xong', loaiTask: 'don_le' });
  const done = await req('PATCH', `/api/tasks/${created.json.id}/status`, { trangThai: 'da_hoan_thanh' });
  assert.equal(done.status, 200);
  const history = await req('GET', '/api/history?keyword=itest');
  assert.ok(history.json.some((t: any) => t.id === created.json.id));
});

test('DELETE task không tồn tại -> 404; xóa task thật -> ok', async () => {
  const missing = await req('DELETE', '/api/tasks/999999');
  assert.equal(missing.status, 404);
  const created = await req('POST', '/api/tasks', { tenTask: '[itest] để xóa', loaiTask: 'don_le' });
  const del = await req('DELETE', `/api/tasks/${created.json.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.ok, true);
});

test('PATCH schedule giờ không hợp lệ -> 400', async () => {
  const created = await req('POST', '/api/tasks', {
    tenTask: '[itest] định kỳ', loaiTask: 'dinh_ky', gioBatDau: '10:00', gioKetThuc: '10:30', lapLaiKieu: 'hang_ngay'
  });
  const bad = await req('PATCH', `/api/tasks/${created.json.id}/schedule`, { gioBatDau: '25:00', gioKetThuc: '26:00' });
  assert.equal(bad.status, 400);
});

function ngayVaThuHomNay() {
  const n = new Date();
  const ngay = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  return { ngay, thu: n.getDay() };
}

async function layTaskDinhKy(id: number) {
  const { ngay } = ngayVaThuHomNay();
  const r = await req('GET', `/api/tasks?date=${ngay}`);
  return ((r.json?.taskDinhKy || []) as any[]).find((t) => t.id === id) || null;
}

test('BUG-20260807: PATCH chỉ gửi tenTask -> KHÔNG được xoá ghiChu/links/lịch', async () => {
  // Lặp vào ĐÚNG thứ của hôm nay, để task luôn hiện ở dashboard bất kể chạy test ngày nào.
  const { thu } = ngayVaThuHomNay();
  const created = await req('POST', '/api/tasks', {
    tenTask: '[itest] partial', ghiChu: 'nội dung phải giữ', loaiTask: 'dinh_ky',
    gioBatDau: '14:00', gioKetThuc: '14:30', lapLaiKieu: 'hang_tuan', thuTrongTuan: [thu],
    links: [{ type: 'git', url: 'https://github.com/x' }]
  });
  assert.equal(created.status, 201);
  const id = created.json.id as number;

  const patched = await req('PATCH', `/api/tasks/${id}`, { tenTask: '[itest] partial đã đổi' });
  assert.equal(patched.status, 200);

  const t = await layTaskDinhKy(id);
  assert.equal(t.tenTask, '[itest] partial đã đổi', 'tenTask phải đổi');
  assert.equal(t.ghiChu, 'nội dung phải giữ', 'ghiChu KHÔNG được bị xoá');
  assert.equal(t.links.length, 1, 'links KHÔNG được bị xoá');
  assert.equal(t.gioKetThuc, '14:30', 'gioKetThuc KHÔNG được bị xoá');
  assert.equal(t.lapLaiKieu, 'hang_tuan', 'lapLaiKieu KHÔNG được nhảy về hang_ngay');
  assert.equal(String(t.thuTrongTuan), String(thu), 'thuTrongTuan KHÔNG được bị xoá');
});

test('BUG-20260807: gửi tường minh giá trị rỗng thì VẪN được xoá (phân biệt undefined vs có gửi)', async () => {
  // Dùng `hang_ngay` để task luôn khớp ngày hôm nay -> đọc lại được từ dashboard.
  const created = await req('POST', '/api/tasks', {
    tenTask: '[itest] xoa tuong minh', ghiChu: 'sẽ bị xoá', loaiTask: 'dinh_ky',
    gioBatDau: '14:00', gioKetThuc: '14:30', lapLaiKieu: 'hang_ngay',
    links: [{ type: 'git', url: 'https://github.com/y' }]
  });
  const id = created.json.id as number;

  const patched = await req('PATCH', `/api/tasks/${id}`, {
    tenTask: '[itest] xoa tuong minh', ghiChu: '', links: []
  });
  assert.equal(patched.status, 200);

  const t = await layTaskDinhKy(id);
  assert.equal(t.ghiChu, '', 'gửi ghiChu="" thì phải xoá thật');
  assert.equal(t.links.length, 0, 'gửi links=[] thì phải xoá thật');
  assert.equal(t.gioKetThuc, '14:30', 'trường không gửi vẫn phải giữ nguyên');
});
