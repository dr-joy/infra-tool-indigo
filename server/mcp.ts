// MCP server cho Task Manager.
// Claude Desktop khởi động file này qua stdio (xem claude_desktop_config.json).
// Nhiệm vụ:
//   1) Đảm bảo app Express (localhost:4000) đang chạy — nếu chưa thì bật nền + mở dashboard.
//   2) Expose tool cho Claude đọc/ghi công việc trong ngày qua REST API sẵn có.
//
// QUAN TRỌNG (giao thức MCP dùng stdout): TUYỆT ĐỐI không console.log ra stdout.
// Mọi log phải đi stderr (console.error) để không phá khung JSON-RPC.

import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  acquireLaunchLock, releaseLaunchLock, isPortBusy, chooseAppLauncher
} from './lib/app-singleton.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const PORT = Number(process.env.PORT || 4000);
const BASE = `http://127.0.0.1:${PORT}`;
// server/mcp.ts -> repo gốc là thư mục cha của server/.
const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const log = (...a: unknown[]) => console.error('[task-manager-mcp]', ...a);

// ── Health / khởi động app ──────────────────────────────────────────────────
async function isUp(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${BASE}/api/tasks`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

// Thư mục dữ liệu app (cùng chỗ DB) — nơi đặt khóa khởi động dùng chung giữa mọi tiến trình MCP.
const APP_DATA_DIR = path.join(process.env.APPDATA || os.homedir(), 'TaskManager');
const EXE_PATH = path.join(REPO_DIR, 'release', 'TaskManager', 'TaskManager.exe');

function spawnServer(): boolean {
  const launcher = chooseAppLauncher({
    repoDir: REPO_DIR,
    exePath: EXE_PATH,
    nodePath: process.execPath,
    envBin: process.env.TASK_MANAGER_APP_BIN
  });
  log(`App chưa chạy — bật bản ${launcher.kind === 'exe' ? 'đóng gói (exe)' : 'dev (source)'}:`, launcher.command);
  try {
    const child = spawn(launcher.command, launcher.args, {
      cwd: REPO_DIR,
      // OPEN_BROWSER=1 -> app tự mở Chrome (profile công việc) khi sẵn sàng.
      env: { ...process.env, OPEN_BROWSER: '1' },
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (e) => log('spawn server lỗi:', e));
    child.unref();
    return true;
  } catch (e) {
    log('spawn server lỗi:', e);
    return false;
  }
}

async function choAppLen(soGiay: number): Promise<boolean> {
  for (let i = 0; i < soGiay; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isUp()) return true;
  }
  return false;
}

// Chỉ MỘT tiến trình app trên máy. Nhiều tiến trình MCP (Claude Desktop + Codex, mỗi lần bật /
// chuyển mode lại thêm một) đều gọi hàm này gần như đồng thời -> phải chặn ở 3 lớp (BUG-006).
async function ensureServer(): Promise<void> {
  // Lớp 1 — app đã trả HTTP: chỉ kết nối, không mở thêm dashboard/instance.
  if (await isUp()) {
    log('App đã chạy sẵn — MCP chỉ kết nối, không bật thêm.');
    return;
  }

  // Lớp 2 — port đã bị chiếm: có tiến trình app đang boot (hoặc treo). Bật thêm chỉ tạo tiến trình
  // rác (EADDRINUSE) nên tuyệt đối KHÔNG spawn; chỉ chờ.
  if (await isPortBusy(PORT)) {
    log(`Port ${PORT} đã có tiến trình giữ — không bật thêm, chờ app trả lời.`);
    if (await choAppLen(40)) log('App đã sẵn sàng.');
    else log(`CẢNH BÁO: port ${PORT} bị chiếm nhưng app không trả lời — kiểm tra tiến trình đang giữ port.`);
    return;
  }

  // Lớp 3 — khóa file: hai MCP cùng thấy "chưa có gì" trong cùng một khoảnh khắc thì chỉ một bên
  // được spawn, bên kia chờ.
  if (!acquireLaunchLock(APP_DATA_DIR)) {
    log('Một tiến trình MCP khác đang bật app — chờ, không bật thêm.');
    if (await choAppLen(40)) log('App đã sẵn sàng (do tiến trình khác bật).');
    else log('CẢNH BÁO: app chưa lên sau 40s (tiến trình khác đang bật).');
    return;
  }

  try {
    if (!spawnServer()) return;
    if (await choAppLen(40)) log('App đã sẵn sàng.');
    else log('CẢNH BÁO: app chưa lên sau 40s. Tool sẽ báo lỗi tới khi app chạy.');
  } finally {
    // Nhả khóa ngay khi biết kết quả — không giữ tới lúc MCP thoát, vì MCP sống rất lâu.
    releaseLaunchLock(APP_DATA_DIR);
  }
}

// ── Helper gọi API ────────────────────────────────────────────────────────────
async function apiGet(pathname: string): Promise<unknown> {
  const r = await fetch(`${BASE}${pathname}`);
  if (!r.ok) throw new Error(`GET ${pathname} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function apiSend(method: string, pathname: string, body?: unknown): Promise<unknown> {
  const r = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${pathname} -> ${r.status} ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Trả kết quả dạng text JSON cho Claude.
const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `Lỗi: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

// ── MCP server ────────────────────────────────────────────────────────────────
const server = new McpServer({ name: 'task-manager', version: '1.0.0' });

// ---- ĐỌC ----
server.registerTool(
  'get_today_tasks',
  {
    title: 'Lấy công việc trong ngày',
    description:
      'Trả về công việc theo ngày: khoTask (chưa làm), taskHomNay (đang làm), taskDinhKy (định kỳ khớp ngày), lichSu (đã xong/hủy). Dùng để tóm tắt việc hôm nay, nhắc việc, lập kế hoạch.',
    inputSchema: {
      date: z.string().optional().describe('Ngày YYYY-MM-DD. Bỏ trống = hôm nay.'),
    },
  },
  async ({ date }) => {
    try {
      const q = date ? `?date=${encodeURIComponent(date)}` : '';
      return ok(await apiGet(`/api/tasks${q}`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'list_projects',
  {
    title: 'Danh sách dự án',
    description: 'Liệt kê các dự án đang mở (kèm PIC, ngày bắt đầu).',
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await apiGet('/api/projects'));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'get_project_tasks',
  {
    title: 'Task của một dự án',
    description: 'Lấy cây task (giai đoạn phân công, tiến độ) của một dự án theo projectId.',
    inputSchema: {
      projectId: z.union([z.string(), z.number()]).describe('ID dự án.'),
    },
  },
  async ({ projectId }) => {
    try {
      return ok(await apiGet(`/api/projects/${encodeURIComponent(String(projectId))}/tasks`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'get_week_goals',
  {
    title: 'Mục tiêu tuần',
    description: 'Lấy mục tiêu của tuần theo ngày đầu tuần (weekStart, YYYY-MM-DD, thường là Thứ 2).',
    inputSchema: {
      weekStart: z.string().describe('Ngày đầu tuần YYYY-MM-DD.'),
    },
  },
  async ({ weekStart }) => {
    try {
      return ok(await apiGet(`/api/weeks/${encodeURIComponent(weekStart)}/goals`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'search_history',
  {
    title: 'Tìm lịch sử công việc',
    description: 'Tìm trong các task đơn lẻ đã hoàn thành/hủy theo từ khóa (tên, ghi chú, ngày...).',
    inputSchema: {
      keyword: z.string().describe('Từ khóa tìm kiếm.'),
    },
  },
  async ({ keyword }) => {
    try {
      return ok(await apiGet(`/api/history?keyword=${encodeURIComponent(keyword)}`));
    } catch (e) {
      return fail(e);
    }
  }
);

// ---- GHI ----
server.registerTool(
  'create_task',
  {
    title: 'Tạo task mới',
    description:
      'Tạo một task đơn lẻ (mặc định) hoặc định kỳ. thucHienNgay=true -> đưa thẳng vào "đang làm" hôm nay.',
    inputSchema: {
      tenTask: z.string().describe('Tên task (bắt buộc).'),
      ghiChu: z.string().optional().describe('Ghi chú.'),
      loaiTask: z.enum(['don_le', 'dinh_ky']).optional().describe('Loại task. Mặc định don_le.'),
      thucHienNgay: z.boolean().optional().describe('true = làm ngay hôm nay (chỉ task đơn lẻ).'),
      gioBatDau: z.string().optional().describe('Giờ bắt đầu HH:mm (task định kỳ).'),
      gioKetThuc: z.string().optional().describe('Giờ kết thúc HH:mm (task định kỳ).'),
    },
  },
  async (args) => {
    try {
      return ok(await apiSend('POST', '/api/tasks', args));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'set_task_status',
  {
    title: 'Đổi trạng thái task',
    description:
      'Cập nhật trạng thái một task: chua_thuc_hien | dang_tien_hanh | da_hoan_thanh | canceled.',
    inputSchema: {
      id: z.union([z.string(), z.number()]).describe('ID task.'),
      trangThai: z
        .enum(['chua_thuc_hien', 'dang_tien_hanh', 'da_hoan_thanh', 'canceled'])
        .describe('Trạng thái mới.'),
    },
  },
  async ({ id, trangThai }) => {
    try {
      return ok(await apiSend('PATCH', `/api/tasks/${encodeURIComponent(String(id))}/status`, { trangThai }));
    } catch (e) {
      return fail(e);
    }
  }
);

// ── Boot ──────────────────────────────────────────────────────────────────────
async function main() {
  await ensureServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP sẵn sàng (stdio).');
}

main().catch((e) => {
  log('Khởi động MCP thất bại:', e);
  process.exit(1);
});
