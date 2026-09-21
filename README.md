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
