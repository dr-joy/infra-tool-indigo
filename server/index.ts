import path from 'node:path';
import fs from 'node:fs';
import { spawn, exec } from 'node:child_process';
import { isSea } from './paths.js';
import { app } from './app.js';
import { runMindmapGc } from './lib/mindmap-gc.js';

const PORT = Number(process.env.PORT || 4000);

function openBrowser(url: string): Promise<void> {
  const chromePaths = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  const chrome = chromePaths.find((p) => p && fs.existsSync(p));
  if (chrome) {
    const WORK_EMAIL = 'tuan.vu@drjoy.jp';
    let profileDir: string | undefined;
    try {
      const localState = path.join(
        process.env.LOCALAPPDATA || '',
        'Google', 'Chrome', 'User Data', 'Local State'
      );
      const data = JSON.parse(fs.readFileSync(localState, 'utf8'));
      const cache = data?.profile?.info_cache ?? {};
      for (const [dir, info] of Object.entries<{ user_name?: string }>(cache)) {
        if (info?.user_name === WORK_EMAIL) {
          profileDir = dir;
          break;
        }
      }
    } catch {
      // Fallback to Chrome's default profile when Local State is unavailable.
    }
    const args = profileDir ? [`--profile-directory=${profileDir}`, url] : [url];
    const child = spawn(chrome, args, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => console.error('[open-browser]', err));
    child.unref();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    exec(`cmd /c start "" "${url}"`, (err) => {
      if (err) console.error('[open-browser]', err);
      resolve();
    });
  });
}

// Không để 1 lỗi lẻ làm sập cả app (đây là tool chạy nền lâu dài).
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`App running at http://localhost:${PORT}`);
  // GC file đính kèm mindmap: chỉ chạy 1 lần lúc khởi động (không định kỳ) — gọi ở đây (không ở
  // app.ts) để test tích hợp import app.ts không bị ảnh hưởng.
  runMindmapGc();
  // Mốc nhận diện bản server đang chạy (để chắc chắn đã restart đúng code mới).
  console.log('[server] features: luyen-de, gantt-phan-cong-giai-doan v2');
  // Tự mở trình duyệt khi khởi động qua launcher (đặt OPEN_BROWSER=1).
  if ((process.env.OPEN_BROWSER === '1' || isSea) && process.env.NO_BROWSER !== '1') {
    void openBrowser(`http://localhost:${PORT}`).catch((err) => console.error('[open-browser]', err));
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { server.close(() => process.exit(0)); });
}

// Cổng đã bị chiếm = app đã chạy sẵn (mở lần 2, hoặc một tiến trình MCP vừa bật trùng).
// PHẢI THOÁT: giữ tiến trình sống mà không listen được thì nó thành tiến trình rác — không phục vụ
// gì, không có scheduler, nhưng vẫn hiện trong Task Manager và làm người dùng tưởng app bị mở trùng
// (BUG-006: đã tồn đọng nhiều tiến trình như vậy). Vẫn mở lại browser: nếu cửa sổ/profile bị lạc,
// double-click exe phải đưa người dùng về app đang chạy sẵn.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Cổng ${PORT} đang được dùng — app đã chạy sẵn tại http://localhost:${PORT}. Thoát tiến trình trùng.`);
    if (process.env.NO_BROWSER === '1') {
      process.exit(0);
    }
    void openBrowser(`http://localhost:${PORT}`)
      .catch((openErr) => console.error('[open-browser]', openErr))
      .finally(() => process.exit(0));
  }
  console.error('[server error]', err);
});
