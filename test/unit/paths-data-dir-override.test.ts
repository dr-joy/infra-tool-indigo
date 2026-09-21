// server/paths.ts (CR-20260913 FR-36): DATA_DIR override cho bản container. Env phải đặt TRƯỚC import
// đầu tiên trong tiến trình (module-level const) — theo đúng pattern top-level set-env-rồi-import đã dùng
// ở các test tích hợp khác trong repo. Tách file riêng khỏi test "không có DATA_DIR" để mỗi file chỉ
// import module 1 lần với đúng 1 giá trị env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-datadir-override-'));
const custom = path.join(tmp, 'custom-data');
process.env.DATA_DIR = custom;
process.env.APPDATA = path.join(tmp, 'should-not-be-used');

const { dataDir } = await import('../../server/paths.js');

test('paths.dataDir: có DATA_DIR -> dùng nguyên giá trị đó, không suy theo APPDATA', () => {
  assert.equal(dataDir, custom);
});
