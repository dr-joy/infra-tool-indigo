// Chống bật app trùng — MỘT tiến trình app duy nhất trên máy.
//
// Vì sao cần (BUG-006): Claude Desktop và Codex mỗi lần bật / chuyển mode lại khởi động thêm một
// tiến trình MCP (`dist-mcp/mcp.mjs`), tiến trình cũ không chết. Đã thấy 5 MCP sống cùng lúc.
// Mỗi MCP đều gọi `ensureServer()`; nếu chỉ kiểm tra "app đã lên chưa" bằng HTTP thì lúc app đang
// khởi động (2–10s) mọi MCP đều thấy CHƯA lên và cùng spawn.
//
// Ba lớp kiểm tra, từ rẻ tới chắc:
//   1. HTTP `/api/tasks` OK          -> app đã chạy, không làm gì.
//   2. Port đang bị chiếm            -> có tiến trình giữ port (đang boot / treo) -> KHÔNG spawn.
//   3. Khóa file (atomic `wx`)       -> chỉ một tiến trình được spawn trong TTL.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

// Khóa quá hạn coi như rác của tiến trình đã chết (crash trước khi nhả khóa).
// 90s = dài hơn thời gian chờ app lên (40s) để không có hai lượt spawn chồng nhau.
export const LAUNCH_LOCK_TTL_MS = 90 * 1000;
const LOCK_NAME = 'app-launch.lock';

// Tạo khóa bằng cờ 'wx' (fail nếu file đã tồn tại) — atomic ở tầng hệ điều hành, nên hai tiến
// trình gọi cùng lúc chỉ một bên thành công. Không dùng tồn-tại-thì-ghi (đọc rồi ghi = có race).
export function acquireLaunchLock(dir: string, now: Date = new Date()): boolean {
  const file = path.join(dir, LOCK_NAME);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* đã có */ }
  const noiDung = JSON.stringify({ pid: process.pid, at: now.toISOString() });
  try {
    fs.writeFileSync(file, noiDung, { flag: 'wx' });
    return true;
  } catch {
    // Đã có khóa: còn hiệu lực thì nhường, quá hạn/hỏng thì dọn rồi thử lại đúng một lần.
    if (!lockConHieuLuc(file, now)) {
      try { fs.rmSync(file, { force: true }); } catch { return false; }
      try {
        fs.writeFileSync(file, noiDung, { flag: 'wx' });
        return true;
      } catch { return false; }
    }
    return false;
  }
}

function lockConHieuLuc(file: string, now: Date): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { at?: string };
    const at = raw.at ? Date.parse(raw.at) : NaN;
    if (Number.isNaN(at)) return false;             // khóa hỏng -> coi là rác
    return now.getTime() - at < LAUNCH_LOCK_TTL_MS;
  } catch {
    return false;                                    // không đọc/parse được -> coi là rác
  }
}

export function releaseLaunchLock(dir: string): void {
  try { fs.rmSync(path.join(dir, LOCK_NAME), { force: true }); } catch { /* không có gì để nhả */ }
}

// Có tiến trình nào đang GIỮ port không (kể cả đang boot, chưa trả HTTP).
// Đây là bằng chứng "app đã tồn tại" mạnh hơn HTTP: HTTP fail lúc boot, port thì đã bị chiếm.
export function isPortBusy(port: number, host = '127.0.0.1', timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const xong = (busy: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(timeoutMs, () => xong(false));
    socket.once('connect', () => xong(true));
    socket.once('error', () => xong(false));
  });
}

export type AppLauncher = { kind: 'exe' | 'dev'; command: string; args: string[] };

// Bật cái gì: ưu tiên bản đã đóng gói (exe) vì đó là bản người dùng thực sự dùng; không có exe
// thì chạy bản dev từ source. `TASK_MANAGER_APP_BIN` cho phép trỏ tay tới file khác.
export function chooseAppLauncher(opts: {
  repoDir: string;
  exePath: string;
  nodePath: string;
  envBin?: string;
}): AppLauncher {
  const { exePath, nodePath, envBin } = opts;
  if (envBin && fs.existsSync(envBin)) return { kind: 'exe', command: envBin, args: [] };
  if (fs.existsSync(exePath)) return { kind: 'exe', command: exePath, args: [] };
  return { kind: 'dev', command: nodePath, args: ['--import', 'tsx', 'server/index.ts'] };
}
