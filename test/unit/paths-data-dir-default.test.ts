// server/paths.ts: không có DATA_DIR -> giữ hành vi cũ (suy theo APPDATA), không phá bản desktop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

delete process.env.DATA_DIR;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-datadir-default-'));
process.env.APPDATA = tmp;

const { dataDir } = await import('../../server/paths.js');

test('paths.dataDir: không có DATA_DIR -> suy theo APPDATA/TaskManager/data như cũ', () => {
  assert.equal(dataDir, path.join(tmp, 'TaskManager', 'data'));
});
