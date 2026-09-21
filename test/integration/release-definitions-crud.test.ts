// QA-2026-09-12: review toàn diện tính năng Release — POST tạo mới template/definition (cả 4 route:
// release templates, emergency templates, regular definitions, emergency definitions) nhận `id` tự đặt
// tay (hoặc tự sinh theo Date.now() nếu không truyền), nhưng trước đây KHÔNG kiểm trùng trước khi INSERT
// -> gửi lại đúng id đã tồn tại vỡ ràng buộc PRIMARY KEY của SQLite, lộ ra 500 "Lỗi server nội bộ" thay
// vì báo lỗi rõ ràng. Test tái hiện + xác nhận đã sửa cho cả 4 route.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-release-defs-crud-itest-'));
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

test('QA: POST /release/templates với id trùng -> 409 (không phải 500)', async () => {
  const first = await req('POST', '/api/release/templates', { id: 'qa-dup-tpl', name: 'A', content: '' });
  assert.equal(first.status, 201);
  const second = await req('POST', '/api/release/templates', { id: 'qa-dup-tpl', name: 'B', content: '' });
  assert.equal(second.status, 409);
  assert.match(String(second.json.message), /tồn tại/);
});

test('QA: POST /release/emergency/templates với id trùng -> 409', async () => {
  const first = await req('POST', '/api/release/emergency/templates', { id: 'qa-dup-emg-tpl', name: 'A', content: '' });
  assert.equal(first.status, 201);
  const second = await req('POST', '/api/release/emergency/templates', { id: 'qa-dup-emg-tpl', name: 'B', content: '' });
  assert.equal(second.status, 409);
});

test('QA: POST /release/task-definitions với id trùng -> 409, không làm hỏng dòng đã có', async () => {
  const first = await req('POST', '/api/release/task-definitions', { id: 'qa-dup-def', title: 'A', startTime: '10:00', dateToken: 'release.date' });
  assert.equal(first.status, 201);
  const second = await req('POST', '/api/release/task-definitions', { id: 'qa-dup-def', title: 'B (không được ghi đè)', startTime: '11:00', dateToken: 'release.date' });
  assert.equal(second.status, 409);

  const list = await req('GET', '/api/release/task-definitions');
  const row = (list.json as { id: string; title: string }[]).find((d) => d.id === 'qa-dup-def');
  assert.equal(row?.title, 'A', 'dòng gốc phải giữ nguyên, không bị request thứ 2 đụng vào');
});

test('QA: POST /release/emergency/task-definitions với id trùng -> 409', async () => {
  const first = await req('POST', '/api/release/emergency/task-definitions', { id: 'qa-dup-emg-def', title: 'A', timingToken: 'hotfix', startTime: 'immediate' });
  assert.equal(first.status, 201);
  const second = await req('POST', '/api/release/emergency/task-definitions', { id: 'qa-dup-emg-def', title: 'B', timingToken: 'hotfix', startTime: 'immediate' });
  assert.equal(second.status, 409);
});
