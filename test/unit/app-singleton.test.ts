// Chống bật app trùng (BUG-006): mỗi lần Claude/Codex bật hoặc chuyển mode là thêm 1 tiến trình
// MCP; tất cả đều muốn "đảm bảo app đang chạy". Không có khóa -> cùng spawn -> nhiều instance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLaunchLock, releaseLaunchLock, chooseAppLauncher, LAUNCH_LOCK_TTL_MS } from '../../server/lib/app-singleton.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tm-lock-'));
}
const at = (ms: number) => new Date(Date.UTC(2026, 7, 3, 0, 0, 0) + ms);

// ── Khóa khởi động: chỉ MỘT tiến trình được spawn ─────────────────────────────
test('tiến trình đầu lấy được khóa, tiến trình thứ hai KHÔNG', () => {
  const dir = tmpDir();
  assert.equal(acquireLaunchLock(dir, at(0)), true, 'lượt 1 phải lấy được');
  assert.equal(acquireLaunchLock(dir, at(1000)), false, 'lượt 2 phải bị chặn');
});

test('nhả khóa rồi thì tiến trình sau lấy được', () => {
  const dir = tmpDir();
  acquireLaunchLock(dir, at(0));
  releaseLaunchLock(dir);
  assert.equal(acquireLaunchLock(dir, at(500)), true);
});

test('khóa CŨ hơn TTL -> coi là rác của tiến trình đã chết, được phép lấy lại', () => {
  const dir = tmpDir();
  acquireLaunchLock(dir, at(0));
  assert.equal(acquireLaunchLock(dir, at(LAUNCH_LOCK_TTL_MS - 1)), false, 'còn trong TTL thì vẫn chặn');
  assert.equal(acquireLaunchLock(dir, at(LAUNCH_LOCK_TTL_MS + 1)), true, 'quá TTL thì lấy lại được');
});

test('khóa hỏng (nội dung rác) -> không làm chết luồng, vẫn lấy lại được', () => {
  const dir = tmpDir();
  acquireLaunchLock(dir, at(0));
  fs.writeFileSync(path.join(dir, 'app-launch.lock'), 'không phải json');
  assert.equal(acquireLaunchLock(dir, at(1000)), true);
});

test('nhả khóa khi chưa có khóa -> không ném lỗi', () => {
  const dir = tmpDir();
  assert.doesNotThrow(() => releaseLaunchLock(dir));
});

// ── Chọn cái gì để bật: ưu tiên exe đã đóng gói ────────────────────────────────
test('có exe -> bật exe (không bật bản dev)', () => {
  const dir = tmpDir();
  const exe = path.join(dir, 'TaskManager.exe');
  fs.writeFileSync(exe, 'x');
  const l = chooseAppLauncher({ repoDir: dir, exePath: exe, nodePath: 'C:/node.exe' });
  assert.equal(l.kind, 'exe');
  assert.equal(l.command, exe);
  assert.deepEqual(l.args, []);
});

test('không có exe -> fallback bản dev (node --import tsx server/index.ts)', () => {
  const dir = tmpDir();
  const l = chooseAppLauncher({ repoDir: dir, exePath: path.join(dir, 'khong-ton-tai.exe'), nodePath: 'C:/node.exe' });
  assert.equal(l.kind, 'dev');
  assert.equal(l.command, 'C:/node.exe');
  assert.deepEqual(l.args, ['--import', 'tsx', 'server/index.ts']);
});

test('env TASK_MANAGER_APP_BIN trỏ file tồn tại -> ưu tiên tuyệt đối', () => {
  const dir = tmpDir();
  const bin = path.join(dir, 'custom-app.exe');
  fs.writeFileSync(bin, 'x');
  const exe = path.join(dir, 'TaskManager.exe');
  fs.writeFileSync(exe, 'x');
  const l = chooseAppLauncher({ repoDir: dir, exePath: exe, nodePath: 'C:/node.exe', envBin: bin });
  assert.equal(l.kind, 'exe');
  assert.equal(l.command, bin);
});

test('env TASK_MANAGER_APP_BIN trỏ file KHÔNG tồn tại -> bỏ qua, không nổ', () => {
  const dir = tmpDir();
  const l = chooseAppLauncher({ repoDir: dir, exePath: path.join(dir, 'x.exe'), nodePath: 'C:/node.exe', envBin: path.join(dir, 'khong-co.exe') });
  assert.equal(l.kind, 'dev');
});
