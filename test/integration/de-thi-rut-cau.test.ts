// QA-2026-09-12: review toàn diện tính năng Luyện đề — chưa có test tích hợp nào trước đây.
//
// Bug thật tìm thấy + sửa: POST /de-thi/rut-cau nhận `soCau` âm rồi đưa thẳng vào SQL `LIMIT ?` —
// SQLite coi LIMIT âm là "không giới hạn", nên soCau=-1 trả về TOÀN BỘ ngân hàng câu hỏi thay vì 0
// câu / bị từ chối. Dropdown FE chỉ có giá trị dương cố định nên không tự gặp được qua UI bình
// thường, nhưng route vẫn phải tự vệ khi gọi API trực tiếp.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-dethi-itest-'));
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

async function taoBoDe5Cau(): Promise<number> {
  const cauHoi = Array.from({ length: 5 }, (_, i) => ({
    noiDungEn: `Question ${i + 1}`,
    dapAn: [{ noiDungEn: 'A', laDapAnDung: true }, { noiDungEn: 'B', laDapAnDung: false }]
  }));
  const r = await req('POST', '/api/de-thi/import', { ten: '[itest] bo 5 cau', cauHoi });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.boId;
}

test('QA: POST /de-thi/rut-cau với soCau ÂM -> KHÔNG trả về nhiều hơn 0 câu (trước đây trả về TOÀN BỘ ngân hàng)', async () => {
  const boId = await taoBoDe5Cau();
  const r = await req('POST', '/api/de-thi/rut-cau', { boId, soCau: -1 });
  assert.equal(r.status, 200);
  assert.equal(r.json.cauHoi.length, 0, 'soCau âm phải bị kẹp về 0, không được trả về cả ngân hàng');
});

test('QA: POST /de-thi/rut-cau với soCau=0 -> 0 câu (hành vi không đổi, vẫn đúng như trước)', async () => {
  const boId = await taoBoDe5Cau();
  const r = await req('POST', '/api/de-thi/rut-cau', { boId, soCau: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.json.cauHoi.length, 0);
});

test('QA: POST /de-thi/rut-cau với soCau hợp lệ nhỏ hơn tổng -> đúng số câu yêu cầu', async () => {
  const boId = await taoBoDe5Cau();
  const r = await req('POST', '/api/de-thi/rut-cau', { boId, soCau: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.json.cauHoi.length, 3);
});

test('QA: POST /de-thi/rut-cau với soCau lớn hơn tổng số câu có -> kẹp về đúng tổng số câu, không lỗi', async () => {
  const boId = await taoBoDe5Cau();
  const r = await req('POST', '/api/de-thi/rut-cau', { boId, soCau: 999 });
  assert.equal(r.status, 200);
  assert.equal(r.json.cauHoi.length, 5);
});

test('QA: POST /de-thi/rut-cau với soCau="all" -> lấy hết', async () => {
  const boId = await taoBoDe5Cau();
  const r = await req('POST', '/api/de-thi/rut-cau', { boId, soCau: 'all' });
  assert.equal(r.status, 200);
  assert.equal(r.json.cauHoi.length, 5);
});
