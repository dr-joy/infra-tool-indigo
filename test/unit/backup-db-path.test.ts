// Chốt chặn cho một lớp lỗi đã xảy ra thật (Codex review báo cáo triển khai #1):
// `scripts/backup-db.mjs` LẶP LẠI công thức đường dẫn DB của `server/paths.ts` thay vì dùng chung
// helper — và có lúc hai bên đã lệch nhau. Hậu quả: lệnh backup in "đã sao lưu an toàn" cho một DB
// cũ, trong khi app chạy trên DB khác. Backup nói dối nguy hơn không có backup vì nó được dùng làm
// điều kiện an toàn trước migration.
//
// Không gộp được thành một helper dùng chung: script là .mjs chạy bằng node trần (bấm đúp file
// .bat), không qua tsx, nên không import được TypeScript của server. Vì vậy chốt bằng test: hai
// công thức phải cho ra CÙNG một đường dẫn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptSrc = fs.readFileSync(path.join(repoRoot, 'scripts', 'backup-db.mjs'), 'utf8');

// Công thức của runtime (server/paths.ts): APPDATA -> XDG_DATA_HOME -> homedir, + TaskManager/data.
function duongDanRuntime(): string {
  const base = process.env.APPDATA || process.env.XDG_DATA_HOME || os.homedir();
  return path.join(base, 'TaskManager', 'data', 'tasks.sqlite');
}

test('backup-db.mjs dùng ĐÚNG thư mục dữ liệu của app, không phải <repo>/data', () => {
  // Trích công thức trong script rồi tự tính lại, thay vì so chuỗi cứng.
  assert.match(scriptSrc, /process\.env\.APPDATA/, 'phải bắt nguồn từ APPDATA như server/paths.ts');
  assert.match(scriptSrc, /'TaskManager',\s*'data',\s*'tasks\.sqlite'/, 'phải trỏ TaskManager/data/tasks.sqlite');
  assert.ok(
    !/path\.join\(projectRoot,\s*'data',\s*'tasks\.sqlite'\)/.test(scriptSrc),
    'KHÔNG được quay lại trỏ <repo>/data/tasks.sqlite — đó chính là lỗi đã xảy ra'
  );
});

test('công thức trong script cho ra cùng đường dẫn với server/paths.ts', async () => {
  const { dataDir } = await import('../../server/paths.js');
  const runtime = duongDanRuntime();
  assert.equal(path.join(dataDir, 'tasks.sqlite'), runtime, 'hai bên lệch nhau = backup sai DB');
});

test('script fail-closed khi DB nguồn thiếu bảng emergency_release_batches', () => {
  assert.match(scriptSrc, /emergency_release_batches/, 'phải kiểm tra sự tồn tại của bảng emergency_release_batches');
  assert.match(scriptSrc, /process\.exit\(1\)/, 'và phải dừng hẳn thay vì báo thành công');
});
