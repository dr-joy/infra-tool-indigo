# Dashboard quản lý task cá nhân

Ứng dụng full-stack gồm React + TypeScript + Tailwind CSS ở frontend và Node.js + TypeScript + SQLite local ở backend.

## Cấu trúc thư mục (root)

### Core — app thật, đụng vào là ảnh hưởng build/deploy

| Thư mục/file | Là gì |
|---|---|
| `server/` | Backend (Express + SQLite) — route, schema/migration DB, logic nghiệp vụ |
| `src/` | Frontend (React + Vite) — màn hình, component |
| `test/` | Test tự động (backend `node:test` + frontend Vitest) |
| `scripts/` | Script vận hành: build/đóng gói exe, backup DB, các cổng kiểm tra của `npm run check` |
| `docs/` | **Tài liệu canonical** — backlog, CR/BUG, spec, rule, playbook. Xem [docs/README.md](docs/README.md) để biết đọc gì ở đâu |
| `Dockerfile`, `.dockerignore` | Đóng gói container cho bản server dùng chung nhiều team |
| `public/`, `index.html` | Asset tĩnh + entry point cho Vite |
| `assets/` | Icon dùng khi đóng gói exe (`app-icon.ico`) |
| `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `tailwind.config.js`, `postcss.config.js` | Config chuẩn của dự án Node/Vite, không tự sửa tay trừ khi biết rõ |
| `conclave/` | Nhật ký các phiên Council review (Claude+Codex đối chiếu code) — lưu lại làm bằng chứng, có link từ `docs/exchanges/` |
| `AGENTS.md`, `CLAUDE.md` | Hướng dẫn vận hành cho AI agent (Codex/Claude) khi làm việc trong repo này |
| `Task Manager.bat`, `backup-db.bat` | Launcher chạy app / backup DB bằng cách double-click (Windows, dùng cho bản desktop) |

### Sinh ra tự động — KHÔNG commit, tự tạo lại được, không cần dọn tay

`build/`, `dist/`, `release/`, `data/`, `tmp/`, `.relay-state/`, `_backup_recovery/`, `node_modules/` —
đều nằm trong `.gitignore`. Xoá thoải mái nếu cần dọn ổ đĩa, chạy lại `npm install`/`npm run build`/
`npm run package` là có lại.

### Tool phụ không liên quan Task Manager — lẫn ở root vì lịch sử, không phải core app

| Thư mục/file | Là gì |
|---|---|
| `glossaries/` | Dữ liệu JSON (thuật ngữ AWS/PMP/PSM) cho 1 tool quiz phụ, không route/code nào của Task Manager đọc tới |
| `instroduction/` | Tên gõ sai từ đầu, giữ nguyên vì đã có script tham chiếu (`scripts/check-docs.mjs`). Chỉ còn 2 file HTML mockup màu/theme cũ — tự ghi chú "Non-canonical", nội dung thật đã chuyển hết sang `docs/` |
| `HTML Quiz To JSON Tool.bat` | Launcher cho tool quiz phụ ở trên, không phải Task Manager |

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

## Chạy bằng container (bản server dùng chung nhiều team)

`BL-20260913-001`/`CR-20260913` — lát 1: đóng gói container chuẩn, cấu hình qua biến môi trường, chưa đổi
tính năng. Chi tiết đầy đủ ở [CR-20260913 §10](docs/delivery/changes/CR-20260913-nen-tang-da-nguoi-dung.md).

```bash
docker build -t task-manager .
docker run -d --name task-manager \
  -p 4000:4000 \
  -v task-manager-data:/data \
  task-manager
```

Image đã đặt sẵn default cho container (`HOST=0.0.0.0`, `DATA_DIR=/data`) — chỉ cần mount volume vào
`/data`. Biến môi trường có thể override khi cần:

- `PORT` — cổng lắng nghe (default `4000`).
- `HOST` — địa chỉ bind (default `0.0.0.0` trong container; script chạy trực tiếp `npm start` ngoài
  container mặc định `127.0.0.1`, an toàn cho desktop).
- `DATA_DIR` — thư mục chứa DB SQLite + file đính kèm (default `/data` trong container). **Phải là ổ lưu
  trữ bền gắn ngoài** — deploy/restart container không được làm mất dữ liệu.

Health check (dùng cho readiness/liveness probe hoặc `docker healthcheck`):

- `GET /health/live` — tiến trình còn sống, không chạm DB. Luôn `200` trừ khi process treo thật.
- `GET /health/ready` — DB đọc/ghi được, `DATA_DIR` còn ghi được, không đang trong quá trình tắt. `200`
  khi sẵn sàng nhận traffic, `503` khi thiếu bất kỳ điều kiện nào.

**Vận hành: chỉ chạy đúng 1 container tại một thời điểm, không bật autoscaling** — dữ liệu là 1 file
SQLite, chạy nhiều bản song song sẽ hỏng dữ liệu (xem `CR-20260913` FR-35).
