// ============================================================
//  SCRIPT BACKUP DATABASE - Task Manager
//  Tạo một bản sao sạch của database, có ghi ngày giờ.
//  An toàn ngay cả khi app đang chạy (dùng VACUUM INTO).
//
//  CÁCH DÙNG: bấm đúp vào file  backup-db.bat  ở thư mục gốc.
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// ---- CẤU HÌNH (có thể sửa) --------------------------------
// Thư mục backup trên mây: để file vào đây là OneDrive tự đồng bộ.
// Muốn đổi sang Google Drive thì sửa đường dẫn này.
const CLOUD_BACKUP_DIR = path.join(
  process.env.OneDrive || process.env.USERPROFILE,
  'TaskManagerBackups'
);

// Giữ lại tối đa bao nhiêu bản backup gần nhất (xoá bớt bản cũ).
const GIU_LAI = 5;
// -----------------------------------------------------------

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

const userBaseDir = process.env.APPDATA || process.env.XDG_DATA_HOME || os.homedir();
const dbPath = path.join(userBaseDir, 'TaskManager', 'data', 'tasks.sqlite');
const localBackupDir = path.join(userBaseDir, 'TaskManager', 'data', 'backups');

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function donDepBanCu(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith('tasks-') && f.endsWith('.sqlite'))
    .sort();
  const thua = files.length - GIU_LAI;
  for (let i = 0; i < thua; i++) {
    fs.rmSync(path.join(dir, files[i]), { force: true });
    console.log(`   (đã xoá bản cũ: ${files[i]})`);
  }
}

console.log('==============================================');
console.log('   BACKUP DATABASE - TASK MANAGER');
console.log('==============================================\n');

// In rõ NGUỒN trước khi làm gì. Lỗi vừa rồi (sao lưu nhầm một DB cũ) sống sót được chính vì output
// chỉ khoe "đã sao lưu an toàn" mà không nói sao lưu CỦA CÁI GÌ.
console.log(`Nguồn (DB app đang dùng): ${dbPath}\n`);

if (!fs.existsSync(dbPath)) {
  console.error('❌ Không tìm thấy database tại:', dbPath);
  process.exit(1);
}

const ten = `tasks-${timestamp()}.sqlite`;

try {
  // 1) Tạo bản backup local sạch bằng VACUUM INTO
  fs.mkdirSync(localBackupDir, { recursive: true });
  const localFile = path.join(localBackupDir, ten);

  const db = new DatabaseSync(dbPath);
  db.exec(`VACUUM INTO '${localFile.replace(/\\/g, '/')}'`);
  db.close();

  // 2) Kiểm tra bản backup vừa tạo có toàn vẹn không
  const check = new DatabaseSync(localFile);
  const integrity = check.prepare('PRAGMA integrity_check').get().integrity_check;
  const soTask = check.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  const coBangBatch = check.prepare(
    "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='emergency_release_batches'"
  ).get().n > 0;
  check.close();

  if (integrity !== 'ok') {
    console.error('❌ Bản backup KHÔNG toàn vẹn! Dừng lại.');
    process.exit(1);
  }

  // FAIL-CLOSED khi thiếu schema bắt buộc (Codex review 6472cd4 §1). Nếu DB tồn tại nhưng không có
  // bảng `emergency_release_batches` thì gần như chắc chắn ta lại đang trỏ vào một file cũ — đúng cái
  // bẫy vừa mắc. Thà dừng và báo còn hơn in "an toàn" cho một bản sao lưu sai.
  if (!coBangBatch) {
    console.error('❌ DB nguồn KHÔNG có bảng `emergency_release_batches` — gần như chắc chắn đây là một');
    console.error('   bản cũ, không phải dữ liệu app đang dùng. Kiểm tra lại đường dẫn nguồn rồi chạy lại.');
    fs.rmSync(localFile, { force: true });
    process.exit(1);
  }

  const kb = Math.round(fs.statSync(localFile).size / 1024);
  console.log(`✅ Đã tạo backup local:`);
  console.log(`   ${localFile}`);
  console.log(`   (${soTask} tasks, ${kb} KB, integrity OK)\n`);

  // 3) Sao chép thêm một bản lên thư mục đồng bộ mây (OneDrive)
  try {
    fs.mkdirSync(CLOUD_BACKUP_DIR, { recursive: true });
    const cloudFile = path.join(CLOUD_BACKUP_DIR, ten);
    fs.copyFileSync(localFile, cloudFile);
    console.log(`☁️  Đã copy lên thư mục đồng bộ mây:`);
    console.log(`   ${cloudFile}`);
    console.log(`   (OneDrive sẽ tự đẩy lên mây)\n`);
    donDepBanCu(CLOUD_BACKUP_DIR);
  } catch (e) {
    console.log(`⚠️  Không copy được lên mây (bỏ qua, bản local vẫn an toàn):`);
    console.log(`   ${e.message}\n`);
  }

  // 4) Dọn bớt bản local cũ
  donDepBanCu(localBackupDir);

  console.log('\n🎉 XONG! Dữ liệu đã được sao lưu an toàn.');
} catch (e) {
  console.error('❌ Lỗi khi backup:', e.message);
  process.exit(1);
}
