// BUG-006: mở app lần thứ hai phải TỰ THOÁT, không được sống tiếp thành tiến trình rác.
// Chạy `server/index.ts` thật 2 lần trên cùng một port, DB tạm, không mở browser.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-single-'));
const PORT = 4137;

const dangChay: ChildProcess[] = [];

function moApp(): ChildProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: repoRoot,
    env: { ...process.env, APPDATA: tmpAppData, PORT: String(PORT), NO_BROWSER: '1', OPEN_BROWSER: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  dangChay.push(child);
  return child;
}

function doiChu(child: ChildProcess, chu: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => resolve(false), timeoutMs);
    const xem = (d: Buffer) => {
      buf += String(d);
      if (buf.includes(chu)) { clearTimeout(t); resolve(true); }
    };
    child.stdout?.on('data', xem);
    child.stderr?.on('data', xem);
  });
}

function doiThoat(child: ChildProcess, timeoutMs: number): Promise<number | 'timeout'> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), timeoutMs);
    child.once('exit', (code) => { clearTimeout(t); resolve(code ?? 0); });
  });
}

after(() => {
  for (const c of dangChay) { try { c.kill('SIGKILL'); } catch { /* đã chết */ } }
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

test('BUG-006: instance thứ hai trên cùng port tự thoát, không thành tiến trình rác', async () => {
  const thu1 = moApp();
  assert.ok(await doiChu(thu1, `App running at http://localhost:${PORT}`, 30000), 'instance 1 phải lên được');

  const thu2 = moApp();
  assert.ok(await doiChu(thu2, 'app đã chạy sẵn', 20000), 'instance 2 phải báo app đã chạy sẵn');

  const ma = await doiThoat(thu2, 15000);
  assert.notEqual(ma, 'timeout', 'instance 2 PHẢI thoát, không được sống tiếp');
  assert.equal(ma, 0, 'thoát êm (mã 0) vì đây là tình huống bình thường, không phải lỗi');

  // Instance đầu vẫn phải sống và phục vụ bình thường.
  assert.equal(thu1.exitCode, null, 'instance 1 không được chết theo');
  const r = await fetch(`http://127.0.0.1:${PORT}/api/release/templates`);
  assert.equal(r.ok, true, 'instance 1 vẫn trả API');
});
