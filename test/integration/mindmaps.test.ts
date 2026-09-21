// Test tích hợp cho server/routes/mindmaps.ts — khoá lại bản vá bảo mật từ Council review (phiên
// a24496ba, xem docs/exchanges/2026-09-12.md): file đính kèm mind map trước đây không kiểm tra loại
// file và phục vụ lại bằng Content-Disposition: inline, nên một file .html/.svg độc hại đính vào sơ đồ
// có thể được trình duyệt RENDER trực tiếp cùng origin với API, script trong đó gọi được fetch('/api/...')
// mà không bị CORS chặn (CORS không chặn same-origin) — CRUD toàn bộ dữ liệu app. Test này xác nhận:
// (1) upload đuôi file "nội dung chủ động" (html/svg/js...) bị từ chối ngay lúc tải lên,
// (2) upload đuôi file tài liệu bình thường vẫn thành công,
// (3) file phục vụ lại LUÔN có Content-Disposition: attachment, không bao giờ inline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
void repoRoot;
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mindmaps-itest-'));
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

function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

async function upload(name: string, content: string) {
  const res = await fetch(`${base}/api/mindmaps/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, dataBase64: toBase64(content) })
  });
  const json = await res.json();
  return { status: res.status, json };
}

const duoiNguyHiem = ['.html', '.htm', '.xhtml', '.svg', '.mhtml', '.js'];

for (const ext of duoiNguyHiem) {
  test(`upload file đuôi ${ext} (nội dung chủ động) bị từ chối 400, không lưu xuống đĩa`, async () => {
    const { status, json } = await upload(`evil${ext}`, '<script>fetch("/api/tasks")</script>');
    assert.equal(status, 400);
    assert.match(String(json.message), /không hỗ trợ/i);
    const filesDir = path.join(tmpAppData, 'TaskManager', 'data', 'mindmap-files');
    const files = fs.existsSync(filesDir) ? fs.readdirSync(filesDir) : [];
    assert.equal(files.some((f) => f.toLowerCase().endsWith(ext)), false, 'file nguy hiểm không được lưu xuống đĩa');
  });
}

test('upload file đuôi .txt (tài liệu bình thường) vẫn thành công', async () => {
  const { status, json } = await upload('ghi-chu.txt', 'nội dung ghi chú bình thường');
  assert.equal(status, 201);
  assert.equal(json.name, 'ghi-chu.txt');
  assert.ok(String(json.url).startsWith('/api/mindmaps/files/'));
});

test('file phục vụ lại LUÔN có Content-Disposition: attachment, không bao giờ inline', async () => {
  const { status, json } = await upload('bao-cao.txt', 'nội dung báo cáo');
  assert.equal(status, 201);
  const fileRes = await fetch(`${base}${json.url}`);
  assert.equal(fileRes.status, 200);
  const disposition = fileRes.headers.get('content-disposition') || '';
  assert.match(disposition, /^attachment/i);
  assert.doesNotMatch(disposition, /inline/i);
});
