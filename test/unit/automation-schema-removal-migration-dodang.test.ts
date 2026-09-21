
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-automation-removal-dodang-'));
process.env.APPDATA = tmpAppData;

const dataDir = path.join(tmpAppData, 'TaskManager', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'tasks.sqlite');

const setup = new DatabaseSync(dbPath);
setup.exec(`
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ten_task TEXT NOT NULL,
    ghi_chu TEXT NOT NULL DEFAULT '',
    loai_task TEXT NOT NULL CHECK (loai_task IN ('don_le', 'dinh_ky')),
    do_uu_tien INTEGER,
    trang_thai TEXT NOT NULL CHECK (trang_thai IN ('chua_thuc_hien', 'dang_tien_hanh', 'da_hoan_thanh', 'canceled')),
    ngay_tao TEXT NOT NULL,
    ngay_hoan_thanh TEXT,
    gio_bat_dau TEXT,
    gio_ket_thuc TEXT,
    lap_lai_kieu TEXT,
    ngay_trong_thang INTEGER,
    thu_trong_tuan INTEGER,
    ngay_cu_the TEXT,
    release_month TEXT,
    release_date TEXT,
    task_links TEXT NOT NULL DEFAULT '[]',
    action_type TEXT NOT NULL DEFAULT 'none',
    ai_note TEXT NOT NULL DEFAULT '',
    related_ids TEXT NOT NULL DEFAULT '[]',
    origin_ref TEXT,
    reply_to_ref TEXT,
    automation_result TEXT
    -- CỐ Ý THIẾU automation_status (đã bị drop ở lần chạy trước) và mọi cột automation khác.
  );

  CREATE TABLE automation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    event_type TEXT,
    created_at TEXT
  );
`);
setup.prepare(`
  INSERT INTO tasks (ten_task, loai_task, trang_thai, ngay_tao, automation_result)
  VALUES ('task dở dang', 'don_le', 'da_hoan_thanh', '2026-01-01', 'kết quả automation còn sót lại')
`).run();
setup.prepare(`
  INSERT INTO automation_events (task_id, event_type, created_at) VALUES (1, 'posted', '2026-01-01T00:00:00.000Z')
`).run();
setup.close();

const { db } = await import('../../server/db.js');

test('DB dở dang (mất automation_status nhưng còn cột + bảng automation khác) vẫn được migration dọn tiếp', () => {
  const cols = (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols.includes('automation_result'), 'cột automation còn sót từ lần chạy trước phải bị xoá nốt');

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (t) => t.name
  );
  assert.ok(!tables.includes('automation_events'), 'bảng automation_events còn sót từ lần chạy trước phải bị xoá nốt');
});

test('dữ liệu nghiệp vụ vẫn nguyên vẹn sau khi dọn nốt trạng thái dở dang', () => {
  const row = db.prepare('SELECT ten_task, trang_thai FROM tasks WHERE ten_task = ?').get('task dở dang') as
    { ten_task: string; trang_thai: string } | undefined;
  assert.ok(row, 'task phải còn tồn tại, chỉ mất cột automation');
  assert.equal(row!.trang_thai, 'da_hoan_thanh');
});

test('archive bắt đúng phần automation_result còn sót + dữ liệu automation_events, kèm checksum khớp thật', () => {
  const archiveDir = path.join(dataDir, 'archive');
  const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.json') && f.startsWith('automation-removed-'));
  assert.equal(files.length, 1, 'phải có đúng 1 file archive JSON cho lần dọn nốt này');

  const jsonPath = path.join(archiveDir, files[0]);
  const jsonBytes = fs.readFileSync(jsonPath, 'utf8');
  const snapshot = JSON.parse(jsonBytes);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].automation_result, 'kết quả automation còn sót lại');
  assert.equal(snapshot.automation_events.length, 1);
  assert.equal(snapshot.automation_events[0].event_type, 'posted');

  // Council code-review (phiên fd720e91, vòng 3): test cũ chỉ kiểm file .sha256 TỒN TẠI, không đối chiếu
  // nội dung — phải tính lại SHA-256 từ chính bytes JSON đã ghi và so khớp chuỗi hex trong file .sha256.
  const shaFileName = files[0].replace(/\.json$/, '.sha256');
  const shaContent = fs.readFileSync(path.join(archiveDir, shaFileName), 'utf8');
  const expectedChecksum = createHash('sha256').update(jsonBytes).digest('hex');
  assert.equal(shaContent, `${expectedChecksum}  ${files[0]}\n`, 'checksum trong file .sha256 phải khớp đúng SHA-256 tính lại từ bytes JSON thật');
});
