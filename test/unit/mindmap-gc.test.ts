// Unit test GC mark-and-sweep cho file đính kèm mindmap (BL-20260831-001).
// DB + filesystem cô lập bằng APPDATA tạm, đặt TRƯỚC khi import db.ts (db.ts đọc APPDATA lúc import).

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mindmap-gc-'));
process.env.APPDATA = tmpAppData;

const { db } = await import('../../server/db.js');
const { runMindmapGc } = await import('../../server/lib/mindmap-gc.js');

const filesDir = path.join(tmpAppData, 'TaskManager', 'data', 'mindmap-files');
const quarantineDir = path.join(filesDir, '.quarantine');

function writeFile(name: string, content = 'noi dung'): string {
  fs.mkdirSync(filesDir, { recursive: true });
  const full = path.join(filesDir, name);
  fs.writeFileSync(full, content);
  return full;
}

function insertMindmap(data: string): number {
  const now = new Date().toISOString();
  const result = db.prepare('INSERT INTO mindmaps (title, data, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('test', data, now, now);
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  db.prepare('DELETE FROM mindmaps').run();
  try { fs.rmSync(filesDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  fs.mkdirSync(filesDir, { recursive: true });
});

after(() => {
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

test('file được mindmap còn sống tham chiếu -> không bị đụng vào', () => {
  const stored = `${'a'.repeat(16)}__con-song.txt`;
  writeFile(stored);
  insertMindmap(JSON.stringify({ text: `xem file /api/mindmaps/files/${encodeURIComponent(stored)}` }));

  runMindmapGc();

  assert.ok(fs.existsSync(path.join(filesDir, stored)), 'file còn được tham chiếu phải còn nguyên trong filesDir');
  assert.ok(!fs.existsSync(path.join(quarantineDir, stored)), 'không bị đưa vào quarantine');
});

test('file không còn được tham chiếu -> bị đưa vào .quarantine với tên có tiền tố timestamp', () => {
  const stored = `${'b'.repeat(16)}__mo-coi.txt`;
  writeFile(stored);
  // Không insert mindmap nào nhắc tới file này (giống mindmap đã bị xoá khỏi DB).

  runMindmapGc();

  assert.ok(!fs.existsSync(path.join(filesDir, stored)), 'file rác phải biến mất khỏi filesDir');
  const quarantined = fs.existsSync(quarantineDir) ? fs.readdirSync(quarantineDir) : [];
  const match = quarantined.find((f) => f.endsWith(`__${stored}`));
  assert.ok(match, `phải xuất hiện trong .quarantine với tiền tố timestamp, thấy: ${quarantined.join(', ')}`);
});

test('file trong .quarantine đã quá 24 giờ -> bị xoá vĩnh viễn', () => {
  fs.mkdirSync(quarantineDir, { recursive: true });
  const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString().replace(/:/g, '-');
  const name = `${oldTimestamp}__het-han.txt`;
  fs.writeFileSync(path.join(quarantineDir, name), 'noi dung');

  runMindmapGc();

  assert.ok(!fs.existsSync(path.join(quarantineDir, name)), 'file quá 24h trong quarantine phải bị xoá hẳn');
});

test('file trong .quarantine chưa quá 24 giờ -> vẫn còn nguyên', () => {
  fs.mkdirSync(quarantineDir, { recursive: true });
  const recentTimestamp = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString().replace(/:/g, '-');
  const name = `${recentTimestamp}__chua-het-han.txt`;
  fs.writeFileSync(path.join(quarantineDir, name), 'noi dung');

  runMindmapGc();

  assert.ok(fs.existsSync(path.join(quarantineDir, name)), 'file chưa quá 24h phải còn nguyên trong quarantine');
});

// Codex chi ra phan doi chan that (review): ban truoc chi bao ve rieng file cua DONG JSON HONG
// bang regex, roi VAN sweep binh thuong cac dong/file khac - khong dung "khong dong gi ca" nhu
// thiet ke goc. Ca 4 test duoi day khoa dung hanh vi da sua: 1 dong JSON hong (hoac 1 URL decode
// loi, hoac chinh viec doc DB that bai) phai HUY CA LUOT GC - khong sweep, khong purge, ke ca voi
// file KHONG lien quan gi toi dong/loi do.

test('1 dòng mindmaps có data JSON hỏng -> huỷ CẢ LƯỢT GC: file mồ côi KHÔNG liên quan dòng đó cũng KHÔNG bị quarantine', () => {
  const storedInBrokenRow = `${'c'.repeat(16)}__trong-json-hong.txt`;
  const unrelatedOrphan = `${'d'.repeat(16)}__mo-coi-khong-lien-quan.txt`;
  writeFile(storedInBrokenRow);
  writeFile(unrelatedOrphan);
  insertMindmap(`{khong phai json hop le, nhung co nhac /api/mindmaps/files/${encodeURIComponent(storedInBrokenRow)}`);
  // unrelatedOrphan không được mindmap nào nhắc tới - nếu GC chỉ bảo vệ riêng dòng hỏng rồi vẫn
  // sweep bình thường, file này sẽ bị quarantine oan. Đúng thiết kế thì KHÔNG được đụng gì cả.

  assert.doesNotThrow(() => runMindmapGc());

  assert.ok(fs.existsSync(path.join(filesDir, storedInBrokenRow)), 'file thuộc dòng JSON hỏng phải còn nguyên');
  assert.ok(fs.existsSync(path.join(filesDir, unrelatedOrphan)), 'file mồ côi KHÔNG liên quan cũng phải còn nguyên - cả lượt GC bị huỷ, không riêng dòng hỏng');
  assert.ok(!fs.existsSync(quarantineDir) || fs.readdirSync(quarantineDir).length === 0, 'không file nào được quarantine trong lượt bị huỷ này');
});

test('1 URL trong data có phần trăm-encode hỏng (decodeURIComponent ném lỗi) -> huỷ cả lượt GC, không sweep gì', () => {
  const unrelatedOrphan = `${'e'.repeat(16)}__mo-coi-do-url-hong.txt`;
  writeFile(unrelatedOrphan);
  // "%" không theo sau 2 ký tự hex hợp lệ -> decodeURIComponent() ném URIError thật.
  insertMindmap(JSON.stringify({ text: '/api/mindmaps/files/ten-file-%zz-hong' }));

  assert.doesNotThrow(() => runMindmapGc());

  assert.ok(fs.existsSync(path.join(filesDir, unrelatedOrphan)), 'file mồ côi phải còn nguyên - lượt GC bị huỷ vì URL decode lỗi, không phải vì file này được bảo vệ riêng');
});

test('đọc bảng mindmaps thất bại thật (bảng không tồn tại) -> huỷ cả lượt GC, không quarantine bất kỳ file nào', () => {
  const orphan = `${'f'.repeat(16)}__mo-coi-luc-db-loi.txt`;
  writeFile(orphan);
  db.exec('DROP TABLE mindmaps');
  try {
    assert.doesNotThrow(() => runMindmapGc());
    assert.ok(fs.existsSync(path.join(filesDir, orphan)), 'lỗi đọc DB (fail-CLOSED) không được coi mọi file là rác rồi quarantine hết (bug fail-open cũ)');
  } finally {
    // Khôi phục đúng schema gốc (server/db.ts) để các test sau không bị ảnh hưởng.
    db.exec(`
      CREATE TABLE IF NOT EXISTS mindmaps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
});
