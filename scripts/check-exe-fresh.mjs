#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = path.join(root, 'release', 'TaskManager', 'TaskManager.exe');

// Chỉ code CHẠY THẬT trong exe. Test/docs đổi không cần đóng gói lại.
const VUNG_CHAY_THAT = /^(server|src|scripts\/build-sea\.mjs|package\.json)/;
const KHONG_TINH = /^(src|server)\/.*\.(test|spec)\.(ts|tsx)$/;

if (!fs.existsSync(EXE)) {
  console.log('  (chưa có release/TaskManager/TaskManager.exe — bỏ qua)');
  process.exit(0);
}

const exeTime = fs.statSync(EXE).mtimeMs;
// `--others --exclude-standard` để tính CẢ file mới chưa `git add`: file mới chính là thứ dễ quên đóng gói
// nhất, mà `git ls-files` trơn thì không thấy chúng (tự bắt được lúc thêm drjoy-html.ts, 2026-08-17).
const files = execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter((f) => f && VUNG_CHAY_THAT.test(f) && !KHONG_TINH.test(f));

const moiHon = [];
for (const f of files) {
  const full = path.join(root, f);
  if (!fs.existsSync(full)) continue;
  if (fs.statSync(full).mtimeMs > exeTime) moiHon.push(f);
}

if (moiHon.length === 0) {
  console.log(`  exe khớp code hiện tại (${new Date(exeTime).toLocaleString('vi-VN')})`);
  process.exit(0);
}

console.log(`  ⚠ exe đóng gói lúc ${new Date(exeTime).toLocaleString('vi-VN')}, CŨ HƠN ${moiHon.length} file code chạy thật:`);
for (const f of moiHon.slice(0, 8)) console.log(`     ${f}`);
if (moiHon.length > 8) console.log(`     … và ${moiHon.length - 8} file nữa`);
console.log('  -> trước khi coi là ĐÃ GIAO: `npm run package` rồi tắt/bật lại TaskManager.exe.');
console.log('     (Bài học L-009: code đã sửa mà app chưa đổi thì với người dùng là chưa sửa.)');
process.exit(0); // cảnh báo, không chặn
