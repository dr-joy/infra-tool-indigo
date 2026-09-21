
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-reply-to-def-backfill-'));
process.env.APPDATA = tmpAppData;

const dataDir = path.join(tmpAppData, 'TaskManager', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'tasks.sqlite');

const setup = new DatabaseSync(dbPath);
setup.exec(`
  CREATE TABLE release_task_definitions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL,
    date_token TEXT NOT NULL,
    template_id TEXT,
    task_links TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    action_type TEXT NOT NULL DEFAULT 'none',
    ai_note TEXT NOT NULL DEFAULT '',
    related_ids TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE emergency_release_task_definitions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    task_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    immediate_priority INTEGER,
    relative_offset_minutes INTEGER,
    schedule_mode TEXT,
    template_id TEXT,
    task_links TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    action_type TEXT NOT NULL DEFAULT 'none',
    ai_note TEXT NOT NULL DEFAULT '',
    related_ids TEXT NOT NULL DEFAULT '[]'
  );
`);

const insertReg = setup.prepare(`
  INSERT INTO release_task_definitions (id, title, start_time, date_token, related_ids)
  VALUES (?, ?, '10:00', 'release.date', ?)
`);
insertReg.run('target', '[itest] target (không có related_ids)', '[]');
insertReg.run('valid-ref', '[itest] trỏ tới definition tồn tại', '["target"]');
insertReg.run('self-ref', '[itest] tự tham chiếu chính nó', '["self-ref"]');
insertReg.run('ghost-ref', '[itest] trỏ tới id không tồn tại', '["khong-ton-tai-999"]');
insertReg.run('malformed', '[itest] JSON hỏng', 'khong phai json{{{');
insertReg.run('empty-arr', '[itest] mảng rỗng', '[]');
insertReg.run('null-str', '[itest] chuỗi "null"', 'null');
insertReg.run('skip-blank-first', '[itest] phần tử đầu rỗng, phần tử sau hợp lệ', '["", "target"]');

const insertEmg = setup.prepare(`
  INSERT INTO emergency_release_task_definitions (id, title, task_date, start_time, related_ids)
  VALUES (?, ?, 'hotfix', 'immediate', ?)
`);
insertEmg.run('emg-target', '[itest] emg target', '[]');
insertEmg.run('emg-valid-ref', '[itest] emg trỏ tới definition tồn tại', '["emg-target"]');
insertEmg.run('emg-self-ref', '[itest] emg tự tham chiếu', '["emg-self-ref"]');
// Khác loại (regular id) không được coi là hợp lệ cho bảng emergency — 2 bảng có namespace id riêng,
// idSet chỉ build từ CHÍNH bảng đang backfill nên "target" (id của bảng regular) chắc chắn không nằm
// trong idSet của bảng emergency.
insertEmg.run('emg-cross-type', '[itest] emg trỏ nhầm sang id bảng khác loại', '["target"]');

setup.close();

const { db } = await import('../../server/db.js');

function replyToOf(table: string, id: string): string | null {
  const row = db.prepare(`SELECT reply_to_definition_id FROM ${table} WHERE id = ?`).get(id) as
    { reply_to_definition_id: string | null } | undefined;
  assert.ok(row, `definition ${id} phải còn tồn tại sau migration`);
  return row!.reply_to_definition_id;
}

test('backfill: related_ids trỏ đúng 1 definition tồn tại cùng bảng -> map thẳng sang reply_to_definition_id', () => {
  assert.equal(replyToOf('release_task_definitions', 'valid-ref'), 'target');
});

test('backfill: tự tham chiếu chính nó -> để NULL, không giữ vòng lặp tự trỏ', () => {
  assert.equal(replyToOf('release_task_definitions', 'self-ref'), null);
});

test('backfill: trỏ tới id không tồn tại (definition đã xoá trước đó) -> để NULL', () => {
  assert.equal(replyToOf('release_task_definitions', 'ghost-ref'), null);
});

test('backfill: related_ids là JSON hỏng -> KHÔNG sập, để NULL', () => {
  assert.equal(replyToOf('release_task_definitions', 'malformed'), null);
});

test('backfill: mảng rỗng hoặc chuỗi "null" -> để NULL', () => {
  assert.equal(replyToOf('release_task_definitions', 'empty-arr'), null);
  assert.equal(replyToOf('release_task_definitions', 'null-str'), null);
});

test('backfill: phần tử đầu rỗng -> bỏ qua, lấy phần tử hợp lệ tiếp theo', () => {
  assert.equal(replyToOf('release_task_definitions', 'skip-blank-first'), 'target');
});

test('backfill: chạy ĐỘC LẬP theo từng bảng — id "target" của bảng regular không hợp lệ cho bảng emergency', () => {
  assert.equal(replyToOf('emergency_release_task_definitions', 'emg-valid-ref'), 'emg-target');
  assert.equal(replyToOf('emergency_release_task_definitions', 'emg-self-ref'), null);
  assert.equal(replyToOf('emergency_release_task_definitions', 'emg-cross-type'), null);
});

test('archive-rồi-drop: action_type/ai_note/related_ids đã bị xoá khỏi cả 2 bảng sau migration', () => {
  const regCols = (db.prepare('PRAGMA table_info(release_task_definitions)').all() as { name: string }[]).map((c) => c.name);
  const emgCols = (db.prepare('PRAGMA table_info(emergency_release_task_definitions)').all() as { name: string }[]).map((c) => c.name);
  for (const col of ['action_type', 'ai_note', 'related_ids']) {
    assert.ok(!regCols.includes(col), `release_task_definitions không được còn cột ${col}`);
    assert.ok(!emgCols.includes(col), `emergency_release_task_definitions không được còn cột ${col}`);
  }
  assert.ok(regCols.includes('reply_to_definition_id'));
  assert.ok(emgCols.includes('reply_to_definition_id'));
});

test('archive: dữ liệu related_ids gốc (kể cả JSON hỏng) vẫn được lưu nguyên trạng trong file archive trước khi drop', () => {
  const archiveDir = path.join(dataDir, 'archive');
  const files = fs.readdirSync(archiveDir).filter((f) => f.startsWith('ai-legacy-fields-removed-') && f.endsWith('.json'));
  assert.equal(files.length, 1, 'phải có đúng 1 file archive cho lần dọn action_type/ai_note/related_ids này');
  const snapshot = JSON.parse(fs.readFileSync(path.join(archiveDir, files[0]), 'utf8'));
  const malformedRow = (snapshot.release_task_definitions as { id: string; related_ids: string }[]).find((r) => r.id === 'malformed');
  assert.ok(malformedRow, 'dòng có JSON hỏng vẫn phải được archive, không bị bỏ sót');
  assert.equal(malformedRow!.related_ids, 'khong phai json{{{', 'archive giữ nguyên văn dữ liệu gốc, không sửa/làm sạch');
});
