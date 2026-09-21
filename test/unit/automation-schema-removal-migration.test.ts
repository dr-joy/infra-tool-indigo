
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-automation-removal-migration-'));
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
    automation_status TEXT NOT NULL DEFAULT 'idle',
    automation_preview TEXT,
    automation_reasons TEXT,
    automation_result TEXT,
    automation_error TEXT,
    automation_updated_at TEXT,
    automation_question TEXT,
    automation_qa_history TEXT,
    automation_occurrence_key TEXT
    -- CỐ Ý THIẾU: origin_kind, automation_contract, announcement_locale, automation_result_data,
    -- automation_idempotency_key, origin_snapshot_hash, automation_recheck_token (thêm sau CR-20260822).
  );
`);
setup.prepare(`
  INSERT INTO tasks (ten_task, loai_task, trang_thai, ngay_tao, automation_status, automation_result)
  VALUES ('task cũ có automation', 'don_le', 'da_hoan_thanh', '2026-01-01', 'done', 'đã đăng bài xong')
`).run();
setup.close();

const { db } = await import('../../server/db.js');

test('archiveAndDropAutomationSchema KHÔNG sập trên DB thiếu cột automation thêm sau, vẫn xoá automation_status', () => {
  const cols = (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols.includes('automation_status'), 'automation_status phải bị xoá dù DB đời cũ thiếu cột khác');
  assert.ok(!cols.includes('automation_result'), 'các cột automation khác đang có cũng phải bị xoá');
  // Cột không tồn tại trên DB đời cũ này thì dĩ nhiên vẫn không tồn tại — không phải lỗi.
  assert.ok(!cols.includes('automation_recheck_token'));
});

test('dữ liệu nghiệp vụ không automation vẫn nguyên vẹn sau migration', () => {
  const row = db.prepare('SELECT ten_task, trang_thai FROM tasks WHERE ten_task = ?').get('task cũ có automation') as
    { ten_task: string; trang_thai: string } | undefined;
  assert.ok(row, 'task phải còn tồn tại sau migration, chỉ mất cột automation');
  assert.equal(row!.trang_thai, 'da_hoan_thanh');
});

test('archive JSON được tạo, chỉ chứa đúng các cột THẬT SỰ đã tồn tại trên DB đời cũ này, checksum khớp thật', () => {
  const archiveDir = path.join(dataDir, 'archive');
  const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.json') && f.startsWith('automation-removed-'));
  assert.equal(files.length, 1, 'phải có đúng 1 file archive JSON của archiveAndDropAutomationSchema');
  const jsonBytes = fs.readFileSync(path.join(archiveDir, files[0]), 'utf8');
  const snapshot = JSON.parse(jsonBytes);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].automation_status, 'done');
  assert.equal(snapshot.tasks[0].automation_result, 'đã đăng bài xong');
  assert.ok(!('automation_recheck_token' in snapshot.tasks[0]), 'không được bịa ra field cho cột chưa từng tồn tại');

  // Council code-review (phiên fd720e91, vòng 3): trước đây chỉ kiểm file .sha256 TỒN TẠI, không đối
  // chiếu nội dung — phải tính lại SHA-256 từ chính bytes JSON đã ghi và so khớp chuỗi hex trong file.
  const shaFileName = files[0].replace(/\.json$/, '.sha256');
  const shaContent = fs.readFileSync(path.join(archiveDir, shaFileName), 'utf8');
  const expectedChecksum = createHash('sha256').update(jsonBytes).digest('hex');
  assert.equal(shaContent, `${expectedChecksum}  ${files[0]}\n`, 'checksum trong file .sha256 phải khớp đúng SHA-256 tính lại từ bytes JSON thật');
});
