# Thiết kế: Module "Báo cáo tuần" (Weekly Report) liên kết 2 chiều với Quản lý Project

> 🗄️ **HẾT HIỆU LỰC — 2026-08-01.** Thiết kế đã hiện thực **và tiến hóa thêm** (chính file này đã tự ghi
> chú từ 2026-06). Đọc để hiểu *ý định thiết kế ban đầu*, **không dùng làm mô tả hệ thống hiện tại**.
>
> **Thay bằng:** [../specs/01-product-requirement-spec.md](../specs/01-product-requirement-spec.md) ·
> [../specs/02-screen-design-user-flow.md](../specs/02-screen-design-user-flow.md) ·
> [../specs/03-api-business-logic-spec.md](../specs/03-api-business-logic-spec.md).
> Code thật: `server/lib/weekly-report.ts`, `server/routes/weekly.ts`, `src/screens/weekly.tsx`.

> Mục tiêu: giảm tải việc viết tay file họp tuần ("Dev13 - Weekly"). Dữ liệu tiến độ
> lấy tự động từ module Quản lý Project; mục tiêu tuần đặt ở đây phản ánh ngược lại
> bảng project. Có 2 góc tổng hợp: **theo dự án** (cho doc họp) và **theo member**
> (để mỗi người biết tuần này mình làm gì).
>
> ⚠️ **Trạng thái 2026-06: thiết kế dưới đây đã được hiện thực và TIẾN HÓA THÊM** —
> phần schema/luồng trong doc này là bản gốc, hiện trạng thực tế:
> - Wizard **4 bước**: 1. Nhập tiến độ (bảng nhóm theo project, droplist 10%) →
>   2. Lý do & ghi chú từng task (kèm task ngoài kế hoạch, mục tiêu gõ tay) →
>   3. Summary (con người chốt ✅ đạt / 🔼 vượt / ❌ không đạt từng task) →
>   4. Duyệt mục tiêu tuần (đề xuất tự tính + thêm mục tiêu "Khác" gõ tay).
> - Đánh giá **theo từng task** (`weekly_task_evaluations`), KHÔNG còn lý do chung
>   theo project (bảng `weekly_project_reasons` đã bỏ). Không dùng snapshot
>   (`project_task_snapshots` đã bỏ) — so sánh bằng `target_progress` của goal.
> - Màn báo cáo: vào màn trống, nội dung sinh sau wizard, nháp sửa/xóa được,
>   **Phê duyệt → lưu `weekly_report_history`** (validate trùng tuần+loại+góc, có ghi đè),
>   panel "Mục tiêu tuần này" (xóa được goal duyệt nhầm), panel History.
> - PIC quản lý động qua tab "Quản lý PIC" (bảng `pics`), task chọn nhiều PIC
>   (chuỗi "A, B"); trường ngày thực tế của task đã bỏ toàn hệ thống.
> - "ID task" hiển thị = số thứ tự phân cấp trong project (1, 1.1, 1.1.1).
> Output: **sinh text để copy dán** (3 loại: nội bộ / cấp trên VN / 日本語 × 2 góc).
> Tuần Thứ 2 → Chủ nhật theo giờ máy.

---

## 1. Pattern hiện tại trong file Weekly

Mỗi tuần (`# YYYY/MM/DD`) nhóm theo **stream/project** (Cloud Run, Security, IDE Plugin,
Khác). Mỗi project lặp lại 3 khối:

| Khối | Ý nghĩa | Nguồn dữ liệu lý tưởng |
|------|---------|------------------------|
| **Kết quả tuần trước** | Mục tiêu tuần trước đạt không + lý do nếu trượt | Tiến độ task của các mục tiêu tuần trước |
| **Tiến độ** | Tuần này thực tế làm được gì (hay kèm người + số task) | Task có % tăng / vừa hoàn thành trong tuần |
| **Mục tiêu tuần** | Tuần tới định làm gì (kèm người + số task) | Danh sách task được chọn làm mục tiêu |

Mục **"Khác"** là việc vận hành lẻ, không gắn project cụ thể (vd: nâng MEM, rotate
credential, lấy data API latency...).

Khâu tốn thời gian nhất: **Kết quả tuần trước** — phải nhớ mục tiêu cũ, mở từng chỗ
check đã xong chưa, rồi tự đánh giá + viết lý do.

## 2. Lỗ hổng dữ liệu hiện tại

Module project có `projects` (≈ stream) và `project_tasks` (cây 3 cấp: `tien_do` %,
`ngay_*_du_kien`, `ngay_*_thuc_te`, `estimate_hours`). Còn thiếu:

1. **Khái niệm "mục tiêu của tuần"** — không biết tuần trước nhắm task nào để đánh giá.
2. **Lịch sử tiến độ** — chỉ có % hiện tại, không biết tuần này tăng bao nhiêu.
3. **Người phụ trách ở cấp task** — hiện chỉ project có `pic`; task không có assignee
   nên không tách được theo người (Nam/Định/Cường...).

## 3. Kiến trúc giải pháp

Tạo một thực thể trung tâm **"Mục tiêu tuần" (`weekly_goals`)** làm **cầu nối 2 chiều**:
chọn ở màn Báo cáo tuần ↔ hiển thị trên bảng project. Một nguồn dữ liệu duy nhất.

```
┌────────────────────┐     weekly_goals      ┌────────────────────┐
│  Quản lý Project    │◄────(cầu nối)────────►│   Báo cáo tuần     │
│  - projects         │                       │  - chọn mục tiêu   │
│  - project_tasks    │  badge 🎯 "mục tiêu   │  - sinh text doc   │
│    (+ assignee)     │     tuần này"         │  - theo dự án      │
│  - snapshots tuần   │                       │  - theo member     │
└────────────────────┘                       └────────────────────┘
```

## 4. Thay đổi dữ liệu (không phá schema cũ)

### 4.1. Bảng mới `weekly_goals` — cầu nối 2 chiều
```sql
CREATE TABLE weekly_goals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start      TEXT NOT NULL,          -- thứ 2 của tuần, 'YYYY-MM-DD' (chuẩn hoá)
  project_id      INTEGER,                -- NULL nếu thuộc mục "Khác"
  project_task_id INTEGER,                -- trỏ task cụ thể; NULL nếu mục tiêu gõ tay
  assignee        TEXT,                   -- người phụ trách (suy ra từ task hoặc gõ tay)
  goal_text       TEXT NOT NULL DEFAULT '',-- text tự gõ / ghi đè tiêu đề task
  reason          TEXT NOT NULL DEFAULT '',-- lý do khi trượt (điền lúc review tuần sau)
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_weekly_goals_week ON weekly_goals(week_start);
CREATE INDEX idx_weekly_goals_task ON weekly_goals(project_task_id);
```

### 4.2. Bảng mới `project_task_snapshots` — ảnh chụp tiến độ cuối tuần
```sql
CREATE TABLE project_task_snapshots (
  week_start          TEXT NOT NULL,      -- tuần được "chốt"
  project_task_id     INTEGER NOT NULL,
  project_id          INTEGER NOT NULL,
  tien_do             INTEGER NOT NULL,
  ngay_ket_thuc_thuc_te TEXT,
  assignee            TEXT,
  PRIMARY KEY (week_start, project_task_id)
);
```
Dùng để tính "tuần này % tăng bao nhiêu" và "vừa hoàn thành trong tuần".

### 4.3. Cột mới `project_tasks.assignee` (migration ALTER, mặc định NULL)
```sql
ALTER TABLE project_tasks ADD COLUMN assignee TEXT;
```
Cho phép tách theo người. Có thể để trống với task chưa gán.

## 5. API (đề xuất, thêm vào `server/routes/`)

```
GET    /api/weeks/:weekStart/report      -> dữ liệu tổng hợp tuần (xem mục 7)
GET    /api/weeks/:weekStart/goals       -> danh sách mục tiêu tuần
POST   /api/weeks/:weekStart/goals       -> thêm mục tiêu (task hoặc gõ tay)
PATCH  /api/weeks/:weekStart/goals/:id   -> sửa goal_text / reason / assignee / thứ tự
DELETE /api/weeks/:weekStart/goals/:id   -> bỏ mục tiêu
POST   /api/weeks/:weekStart/close       -> chốt tuần = chụp snapshot toàn bộ task
GET    /api/weeks/:weekStart/text?mode=by_project|by_member  -> trả text đã format
```
Tiện ích: `weekStart` luôn chuẩn hoá về thứ 2 (giờ VN) để tránh lệch ngày.

## 6. Màn hình (UI)

Thêm tab **"Báo cáo tuần"** cạnh tab Project. Bố cục:

- **Chọn tuần** (mặc định tuần hiện tại) + nút **"Chốt tuần"**.
- **Cột trái — Đặt mục tiêu tuần:** cây project/task, tick để thêm vào mục tiêu;
  ô thêm mục tiêu "Khác" gõ tay; gán assignee.
- **Cột phải — Xem trước & sinh text:** 2 nút radio `Theo dự án` / `Theo member`,
  khung preview, nút **Copy**.
- Trên **bảng Project**: task là mục tiêu tuần hiện tại có badge 🎯 + filter
  "Chỉ hiện mục tiêu tuần".

## 7. Logic tự sinh (thuật toán)

Định nghĩa tuần: `week_start` = thứ 2; `week_end` = chủ nhật. "Tuần trước" =
`week_start - 7 ngày`.

### 7.1. Kết quả tuần trước (đánh giá tự động)
Với mỗi `weekly_goals` của **tuần trước** có `project_task_id`:
- Lấy `tien_do` hiện tại của task; `prev` = snapshot tuần trước (nếu có).
- Phân loại:
  - `tien_do == 100` → **✅ Hoàn thành**
  - `tien_do > prev` và `< 100` → **🟡 Đang tiến hành** (`prev%→tien_do%`), chưa đạt
  - quá `ngay_ket_thuc_du_kien` mà `< 100` → **🔴 Trượt tiến độ** → chèn sẵn `Lý do:`
    (lấy từ `reason`/ghi chú task để bạn sửa)
  - còn lại → **⏳ Chưa bắt đầu**
- Dòng tổng: `Hoàn thành a/b mục tiêu` (a = số task 100%).
- Goal gõ tay (không có task): trạng thái do người tự đánh dấu.

### 7.2. Tiến độ (tuần này làm được gì)
Với mỗi project, lấy task thoả 1 trong 2:
- `ngay_ket_thuc_thuc_te` ∈ `[week_start, week_end]` → "✅ <title>"
- `tien_do` > snapshot tuần trước → "<title> (`prev%→now%`)"
Sắp xếp theo project → (tuỳ chọn) gom theo `assignee`.

### 7.3. Mục tiêu tuần
Liệt kê `weekly_goals` của **tuần này**: `goal_text` (hoặc tiêu đề task) + assignee +
link task + hạn (`ngay_ket_thuc_du_kien`).

### 7.4. Chốt tuần (snapshot)
Nút "Chốt tuần" ghi `project_task_snapshots` cho toàn bộ task đang mở của tuần đó →
tuần sau có gốc so sánh cho 7.1 và 7.2.

## 8. Hai góc tổng hợp (output)

### 8.1. Theo dự án — bám đúng format doc hiện tại
```
# 2026/06/16

Cloud Run:
  - Kết quả tuần trước:
      - Hoàn thành 1/3 mục tiêu
      - ✅ Import hết dữ liệu của các DB
      - 🔴 Hoàn thiện DBs/Storage/giải mã để deploy hết service (75%)
          - Lý do: <điền>
      - 🟡 Bàn bạc môi trường run job (đang tiến hành)
  - Tiến độ:
      - ✅ Cấu hình deployments Cloud Run cho toàn bộ service (Nam)
      - Cấu hình .drone.yaml service-config (Định) 50%→100%
  - Mục tiêu tuần:
      - [Định] Hoàn thiện giải mã DB (#22) — hạn 20/6
      - [Nam] Import dữ liệu DB còn lại

Security:
  - ...

Khác:
  - Rotate cluster credentials — Tối thứ 6, thầy Phú
```

### 8.2. Theo member — để mỗi người biết tuần này làm gì
```
== Mục tiêu tuần theo người — tuần 2026/06/16 ==

Thầy Định:
  - [Cloud Run] Hoàn thiện giải mã DB (#22) — hạn 20/6
  - [Cloud Run] Cấu hình secret cho từng repo

Thầy Nam:
  - [Cloud Run] Import dữ liệu DB còn lại

Thầy Cường:
  - [Security] Export toàn bộ Findings SCC

(Chưa gán người:)
  - [IDE Plugin] Review phương án
```

## 9. Lộ trình

- **Phase 1 (lõi):** `weekly_goals` + tab Báo cáo tuần (chọn mục tiêu, badge 🎯 +
  filter trên project) + sinh text 2 chế độ (theo dự án / theo member). Đánh giá
  "Kết quả tuần trước" ở mức dựa trên `tien_do` hiện tại + ngày dự kiến (chưa cần
  snapshot).
- **Phase 2:** `project_task_snapshots` + nút "Chốt tuần" → đánh giá & "Tiến độ"
  chính xác theo diff tuần.
- **Phase 3 (tuỳ chọn):** AI tự thảo "lý do trượt" từ ghi chú task; xuất thẳng Google
  Docs qua Docs API (cần OAuth riêng — bộ Drive hiện tại chỉ đọc/tạo file mới, không
  chèn-sửa doc đang có).

## 10. Giả định & điểm cần xác nhận

- Tên member dùng dạng tự do (vd "Thầy Định") hay theo email drjoy.jp? → ảnh hưởng cột
  `assignee` và cách gom nhóm.
- Mục "Khác" quản lý bằng goal gõ tay trong `weekly_goals` (project_id NULL) — đủ chưa,
  hay cần tách thành một bảng việc-lẻ riêng?
- Tuần tính theo giờ VN, thứ 2 → chủ nhật. Đúng với nhịp họp của team chứ?
- Ngưỡng "trượt tiến độ" đang dùng `ngay_ket_thuc_du_kien < hôm nay`. Có cần linh hoạt
  hơn (vd theo tuần) không?
```
