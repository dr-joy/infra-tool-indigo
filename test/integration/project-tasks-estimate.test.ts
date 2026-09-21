// Bugfix: task lá trong Project cho phép estimate = 1 giờ.
// Trước đây route chặn `estimateHours <= 1` (loại luôn giá trị 1), trong khi cùng khái niệm ở tầng
// "giai đoạn phân công" (`saveTaskAssignments`) lại cho phép `estimate > 0` — hai luật khác nhau cho cùng
// một field, và 1 giờ là giá trị thật rất hay gặp khi ước lượng WBS nhỏ. Test tái hiện lỗi trước khi sửa.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ptask-est-'));
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

async function taoProject(): Promise<number> {
  const r = await req('POST', '/api/projects', { ten: '[itest] estimate', pic: 'Nam', ngayBatDau: '2026-08-25' });
  assert.equal(r.status, 201);
  return r.json.id;
}

test('POST task lá: estimateHours=1 phải được chấp nhận (khớp luật assignment estimate > 0)', async () => {
  const projectId = await taoProject();
  const r = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Task 1 giờ', ngayBatDauDuKien: '2026-08-25', ngayKetThucDuKien: '2026-08-25', estimateHours: 1
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.estimateHours, 1);
});

test('PATCH task lá: estimateHours=1 phải được chấp nhận', async () => {
  const projectId = await taoProject();
  const created = await req('POST', `/api/projects/${projectId}/tasks`, {
    tieuDe: 'Task ban đầu', ngayBatDauDuKien: '2026-08-25', ngayKetThucDuKien: '2026-08-25', estimateHours: 5
  });
  const r = await req('PATCH', `/api/projects/${projectId}/tasks/${created.json.id}`, {
    tieuDe: 'Task ban đầu', ngayBatDauDuKien: '2026-08-25', ngayKetThucDuKien: '2026-08-25', estimateHours: 1
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.estimateHours, 1);
});

test('estimateHours=0 hoặc âm vẫn bị từ chối (chỉ nới cho >=1, không bỏ hẳn validate)', async () => {
  const projectId = await taoProject();
  for (const gio of [0, -1]) {
    const r = await req('POST', `/api/projects/${projectId}/tasks`, {
      tieuDe: 'Task xấu', ngayBatDauDuKien: '2026-08-25', ngayKetThucDuKien: '2026-08-25', estimateHours: gio
    });
    assert.equal(r.status, 400, `estimateHours=${gio} phải bị từ chối`);
  }
});
