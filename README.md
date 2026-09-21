# Dashboard quản lý task cá nhân

Ứng dụng full-stack gồm React + TypeScript + Tailwind CSS ở frontend và Node.js + TypeScript + SQLite local ở backend.

## Chạy local

```bash
npm install
npm run dev
```

Sau khi chạy:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000/api/tasks`
- Database SQLite: `data/tasks.sqlite`

Nếu PowerShell chặn `npm`, dùng `npm.cmd`:

```powershell
npm.cmd install
npm.cmd run dev
```

## Build kiểm tra

```bash
npm run build
```

## Cổng chất lượng trước khi push

```bash
npm run check          # tsc + test (BE/FE) + build + ngân sách bundle + link markdown
npm run hooks:install  # cài pre-push hook — CHẠY MỘT LẦN trên mỗi máy mới clone về
npm run backup-db      # sao lưu DB sang OneDrive
```

`npm run check` gom mọi mục Definition of Done mà **máy** kiểm được vào một lệnh, rồi in ra
checklist những mục chỉ **người** làm được (soi diff, smoke thủ công, cập nhật docs…).

Sau khi `npm run hooks:install`, mỗi `git push` sẽ tự chạy `npm run check` và **chặn nếu đỏ**.
Hook nằm ở `.git/hooks/` nên **không đi theo repo** — máy mới clone về phải cài lại.
Bỏ qua một lần khi thật sự cần: `git push --no-verify`.

Dự án **không dùng CI và không dùng Pull Request** — lý do và hạn chế đã ghi ở
[ADR-P1 / ADR-P2](docs/standards/team-operating-standard.md).

## Truy cập database

Cách dễ nhất là cài DB Browser for SQLite:

1. Tải tại `https://sqlitebrowser.org/`
2. Mở app, chọn `Open Database`
3. Chọn file `data/tasks.sqlite`
4. Bảng chính là `tasks`

Hoặc dùng SQLite CLI:

```bash
sqlite3 data/tasks.sqlite
.tables
SELECT * FROM tasks;
```

Database sẽ được tự tạo và seed dữ liệu mẫu khi backend chạy lần đầu.

## Đóng gói thành app desktop (.exe)

Tạo app dùng được trên máy khác mà **không cần cài Node** (Node Single Executable Application):

```bash
npm run package
```

Kết quả nằm ở `release/TaskManager/`:

- `TaskManager.exe` — app (đã nhúng sẵn Node runtime + server)
- `dist/` — giao diện

Cách dùng:

1. Copy **cả thư mục** `release/TaskManager` sang máy khác (Windows 64-bit).
2. Double-click `TaskManager.exe`.
3. App tự khởi động server và mở trình duyệt tại `http://localhost:4000`.
4. Database `data/tasks.sqlite` được tạo **cạnh** file `.exe` ngay lần chạy đầu.

Đóng cửa sổ console = tắt app. Muốn giữ dữ liệu cũ thì copy kèm thư mục `data/`.

## Claude Desktop / MCP task-manager

Repo này có MCP server để Claude Desktop đọc và thao tác với Task Manager qua API local.
Mục tiêu: khi Claude Desktop được cấu hình MCP, Claude có thể gọi các tool như:

- `get_today_tasks` — đọc danh sách task theo ngày.
- `list_projects` — liệt kê dự án.
- `get_project_tasks` — đọc task của một dự án.
- `get_week_goals` — đọc mục tiêu tuần.
- `search_history` — tìm lịch sử task.
- `create_task` — tạo task mới.
- `set_task_status` — đổi trạng thái task.

### Build MCP

Sau khi pull repo về máy local:

```bash
npm install
npm run build:mcp
```

Nếu PowerShell chặn `npm`, dùng:

```powershell
npm.cmd install
npm.cmd run build:mcp
```

Kết quả build nằm ở:

```text
dist-mcp/mcp.mjs
```

`dist-mcp/` là file build local, không commit vào Git.

### Cấu hình Claude Desktop

Mỗi máy phải tự cấu hình Claude Desktop một lần vì đường dẫn repo khác nhau theo từng local.
Thêm MCP server trỏ tới file `dist-mcp/mcp.mjs`, ví dụ:

```json
{
  "mcpServers": {
    "task-manager": {
      "command": "node",
      "args": [
        "<ĐƯỜNG_DẪN_REPO>/dist-mcp/mcp.mjs"
      ]
    }
  }
}
```

Đổi đường dẫn trong `args` theo vị trí repo trên máy đang dùng, rồi restart Claude Desktop.

Khi Claude Desktop kết nối MCP:

1. MCP server kiểm tra Task Manager API ở `http://127.0.0.1:4000`.
2. Nếu app chưa chạy, MCP sẽ tự bật backend bằng `node --import tsx server/index.ts`.
3. Sau khi backend sẵn sàng, Claude Desktop có thể gọi các tool task-manager.

### Ghi chú cho AI/lần sau

- Không commit file cấu hình local của Claude Desktop như `.claude/settings.local.json` hoặc `claude_desktop_config.json` nếu file đó chứa đường dẫn/permission riêng của máy.
- Nếu người dùng hỏi "pull về có dùng được ngay không?", câu trả lời là: code MCP có sẵn, nhưng mỗi máy vẫn cần chạy `npm install`, `npm run build:mcp`, rồi cấu hình Claude Desktop trỏ tới `dist-mcp/mcp.mjs`.
- Khi thêm tool MCP mới, sửa `server/mcp.ts`, chạy `npm run build:mcp`, rồi kiểm tra `npm run build`.
- Mọi tool MCP ghi dữ liệu (`create_task`, `set_task_status`) chạy trực tiếp không qua bước duyệt nào —
  cẩn trọng khi thêm tool ghi mới, không giả định có lớp xác nhận phía người dùng.
