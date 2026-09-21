import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Khi chạy dưới dạng file .exe đã đóng gói (Node SEA), GIAO DIỆN (dist) nằm cạnh
// file thực thi. Khi chạy dev (tsx) hoặc chạy bundle bằng node, lấy thư mục gốc
// project (cha của thư mục chứa file này).
const requireFn = createRequire(import.meta.url);

let seaFlag = false;
try {
  seaFlag = requireFn('node:sea').isSea();
} catch {
  seaFlag = false;
}

export const isSea = seaFlag;

export const appBaseDir = isSea
  ? path.dirname(process.execPath)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// DB dùng CHUNG cho cả bản dev lẫn app đóng gói: một vị trí cố định trong hồ sơ
// người dùng (Windows: %APPDATA%\TaskManager\data). Nằm NGOÀI thư mục build nên
// rebuild/đóng gói lại không bao giờ đụng vào -> không còn cảnh "mất data sau build".
// Giữ chung 1 đường dẫn để dev và app luôn đọc/ghi đúng một DB.
const userBaseDir = process.env.APPDATA || process.env.XDG_DATA_HOME || os.homedir();
export const dataDir = path.join(userBaseDir, 'TaskManager', 'data');
