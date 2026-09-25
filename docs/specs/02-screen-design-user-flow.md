# 02 - Screen Design & User Flow

> Nguồn: `src/main.tsx`, `src/mind-map.tsx`, `src/shortcuts.tsx`, `src/ui.tsx`, `src/i18n.ts`, `src/styles.css`, và handoff "Screens & Flows Digest".
> Tài liệu mô tả UI/flow thực tế trong code. Chỗ còn là quyết định sản phẩm sẽ đánh dấu `> ⏳ User điền nốt`.

## 1. App Shell

- App là workbench nội bộ, không có landing page.
- Backend bind `127.0.0.1:4000`; frontend Vite trong dev; bản exe serve `dist/`.
- Tab hiện tại sync với URL query `?tab=`.
- Điều hướng nhanh: `Alt+1..6` đổi tab; `Ctrl+Q` mở thêm task nhanh.
- Modal primitive dùng component `Modal` trong `src/main.tsx`; overlay khai báo `role="dialog"` và `aria-modal`.

## 2. Danh Sách Tab

| Key | Label i18n | Nghĩa VN | Component / vùng chính |
|---|---|---|---|
| `task_ca_nhan` | Tasks | Task cá nhân | Board inline 3 cột |
| `project` | Projects | Quản lý project | `ManHinhProject` |
| `bao_cao_tuan` | Reports | Báo cáo tuần | `ManHinhBaoCaoTuan` |
| `len_lich` | Releases | Lên lịch | `ManHinhLenLich` |
| `so_do` | MindMap | Sơ đồ | `ManHinhMindMap` |
| `quan_ly_pic` | Settings | Cài đặt | `ManHinhQuanLyDanhMuc` |

## 3. Screen Spec

### 3.1 Task Cá Nhân

| Region | Nội dung / hành vi |
|---|---|
| Header / ngày xem | Chọn ngày, điều hướng ngày |
| Cột Kho task | Task đơn lẻ `chua_thuc_hien` |
| Cột Hôm nay | Task đơn lẻ đang làm trong ngày |
| Cột Task định kỳ | Timeline task định kỳ khớp ngày xem |
| Actions | Tạo task, sửa, hoàn thành, hủy, xem lịch sử, thêm nhanh |

Popup/modal: `TaoTask`, `SuaTask`, `XacNhanHoanThanh`, `XacNhanCancel`, `LichSu`, `ThemTaskNhanh`.

### 3.2 Projects

| Region | Nội dung / hành vi |
|---|---|
| Sidebar project | Danh sách project, reorder, chọn project; URL sync `?project=` |
| Detail project | Header thông tin, progress circle, trạng thái đóng/pending |
| Tree task | `ProjectTaskTree` tối đa 3 cấp, inline progress %, phase/PIC |
| Gantt / roadmap | Roadmap project và Gantt tổng; lọc project/PIC; lane theo PIC |

Popup/modal: `TaoProject`, `LichSuProjectClose`, `ProjectRoadmap`, `ProjectInfo`, `GanttTong`, `TaoProjectTask`, `XacNhanXoa`.

### 3.3 Báo Cáo Tuần

| Region | Nội dung / hành vi |
|---|---|
| Week navigator | Chọn tuần Thứ 2-CN |
| Kind select | `internal` hoặc `vn_management` |
| Editor / preview | Text báo cáo render từ dữ liệu project/goal/evaluation |
| Goals list | Mục tiêu tuần hiện tại/carry-over |
| History | Báo cáo đã duyệt, unique theo week+kind+mode |

Popup/modal: `TaoBaoCao` wizard 4 bước, `RiskDM`.

### 3.4 Releases

| Region | Nội dung / hành vi |
|---|---|
| Toggle mode | Khẩn cấp / Định kỳ |
| Định kỳ | `LayoutReleaseDinhKy`: chọn ngày release, template, definition, sinh task |
| Khẩn cấp | `LayoutReleaseKhanCap`: immediate + scheduled theo mốc deploy |
| Quản trị | Template message và task definition |
| Badge lệch definition (CR-20260814 FR-5) | Cạnh nút "Áp dụng thay đổi vào đợt này": `N task lệch definition`, đọc `GET /api/schedules/release/drift?releaseMonth=` mỗi khi đổi ngày release/tải lại definition — **chủ động**, không cần bấm gì. Bấm nút mở popup `PopupXacNhanSyncRelease` (preview + đồng bộ) như cũ |

Popup/modal: `QuanLyReleaseTemplate`, `QuanLyReleaseTask`, `QuanLyEmergencyReleaseTask`, `XacNhanTaoLaiRelease`, `ChonNgayReleaseKhanCap`, `PopupXacNhanSyncRelease`.

**Dấu lệch definition — 2 nơi (CR-20260814 FR-5, `?4` chốt ở §14):**

| Nơi | Component | Điều kiện hiện | Nội dung |
|---|---|---|---|
| Màn Release | `LayoutReleaseDinhKy` (bảng trên) | `driftCount > 0` (đọc `GET /schedules/release/drift`) | Badge `N task lệch definition` cạnh nút "Áp dụng thay đổi" |
| Dashboard chính, dòng task định kỳ | `TaskDinhKy` (`src/main.tsx`) | `task.lechDefinition === true` (BE tính sẵn, bulk, xem docs/specs/03 mục 1) | Icon cảnh báo nhỏ (`.drift-flag`), `title` nói rõ lệch — CHỈ hiện khi CHẮC CHẮN lệch, không hiện khi không tra được definition |

### 3.5 MindMap

| Region | Nội dung / hành vi |
|---|---|
| Sidebar maps | Danh sách sơ đồ, tạo/sửa/xóa |
| Canvas SVG | Node tree, grid, edge cong, kéo thả |
| Format toolbar | Màu, shape, font, link/file/icon |
| Pen bar | Vẽ tay, undo/redo |
| Export modal | Markdown/Mermaid và tạo task từ node |

### 3.6 Settings

Sub-tab: PIC, Redmine, Phím tắt.

| Sub-tab | Nội dung / hành vi |
|---|---|
| PIC | CRUD, reorder, màu; đổi tên cascade; xóa bị chặn nếu đang dùng |
| Redmine | Base URL, API key mã hóa, test connection |
| Phím tắt | Rebind từ `SHORTCUT_ACTIONS`, lưu localStorage |

## 4. User Flows Chính

### Flow 1 - Tạo task

1. User nhập tên task; tên là bắt buộc.
2. User nhập note, tối đa 4 link, loại task `don_le` hoặc `dinh_ky`.
3. Nếu chọn `dinh_ky`, form hiện cấu hình lặp (kiểu lặp, thứ/ngày).
4. Giờ dùng `TimeInput`, range `07:30`-`18:00`.
5. Kiểu lặp gồm hằng ngày, Thứ 2-Thứ 6, hằng tuần, hằng tháng; có thứ/ngày và khóa loại trừ tùy UI.
6. Submit gọi `POST /api/tasks`.

### Flow 2 - Báo cáo tuần

1. User chọn tuần và loại báo cáo.
2. Wizard bước 1 nhập tiến độ.
3. Bước 2 chọn đánh giá `dat`/`vuot`/`khong_dat`; nếu không đạt phải nhập lý do.
4. Bước 3 nhập summary theo project; summary bắt buộc theo flow hiện tại.
5. Bước 4 duyệt mục tiêu tuần tới; target gợi ý theo ngày còn lại.
6. Mục "Khác" tạo task thật trong project hệ thống.
7. Apply gọi `POST /api/weeks/:weekStart/apply`.
8. Xuất text; duyệt vào history. Nếu `409 REPORT_EXISTS`, user chọn ghi đè.

### Flow 3 - Release

Định kỳ:

1. Chọn ngày release.
2. Hệ thống tính chu kỳ khoảng 5 tuần theo token.
3. Sinh task từ definition/template.
4. Gọi `POST /api/schedules/regular-release/tasks`.
5. Nếu `409 REGULAR_RELEASE_EXISTS`, user xác nhận force để tạo lại.

Khẩn cấp:

1. Pha immediate tạo task cần làm ngay, lưu `releaseKey` vào localStorage.
2. Pha scheduled tạo task theo mốc deploy.
3. Gọi `POST /api/schedules/emergency-release/tasks` với key và force/replace khi cần.
4. Task sinh ra carry `originRef`, `replyToRef` (nguồn definition gốc, phục vụ phát hiện lệch).

### Flow 4 - Project + Gantt Tổng

1. User chọn project ở sidebar.
2. Detail mở project, có thể auto mở Gantt lần đầu.
3. User quản lý task tối đa 3 cấp, phase theo PIC.
4. Gantt tổng lọc theo project/PIC.
5. User kéo/resize phase; backend lưu assignments và rollup.

### Flow 5 - PIC

1. User tạo/sửa/xóa/reorder danh mục PIC.
2. Đổi tên PIC cascade sang dữ liệu liên quan.
3. Xóa bị chặn nếu PIC đang dùng.
4. Màu PIC dùng cho Gantt và các visual theo người phụ trách.

### Flow 6 - Phím tắt

1. Settings đọc danh sách `SHORTCUT_ACTIONS`.
2. User chọn action `tab:*` hoặc `action:*`, bấm tổ hợp mới.
3. Mapping lưu vào `localStorage` key `taskmanager.shortcuts.v1`.
4. `Ghi`, `Esc`, `Backspace` điều khiển quá trình chỉnh.
5. Trùng phím hiển thị đỏ.
6. Global handler bỏ qua khi user đang gõ trong input/textarea/contenteditable.

## 5. Cần Bổ Sung

> ⏳ User điền nốt: chuẩn cuối cho tên tab tiếng Việt/tiếng Anh trong release build.
> ⏳ User điền nốt: thứ tự ưu tiên user flow nào cần tối ưu tiếp theo.
> ⏳ User điền nốt: có cần screenshot/wireframe chính thức cho từng màn hình không.
