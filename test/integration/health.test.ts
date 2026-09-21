// GET /health/live + /health/ready (CR-20260913 FR-39).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-health-itest-'));
process.env.APPDATA = tmpAppData;

const { app } = await import('../../server/app.js');
const { shutdownState } = await import('../../server/lib/shutdown-state.js');

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

test('GET /health/live: luôn 200, không chạm DB', async () => {
  const res = await fetch(`${base}/health/live`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('GET /health/ready: DB đọc/ghi được + ổ lưu trữ ghi được -> 200', async () => {
  const res = await fetch(`${base}/health/ready`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ready');
});

test('GET /health/ready: đang shutdown -> 503 ngay lập tức (SEC-PERF-013)', async () => {
  shutdownState.shuttingDown = true;
  try {
    const res = await fetch(`${base}/health/ready`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.reason, 'shutting_down');
  } finally {
    shutdownState.shuttingDown = false;
  }
});
