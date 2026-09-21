# 01 — Product / Requirement Spec

> Tổng quan sản phẩm + yêu cầu chức năng đang có trong code. Chỗ mang tính định hướng/kinh doanh để `> ⏳ User điền nốt`.

## 1. Tổng quan

**Personal Tool (Task Manager)** — công cụ cá nhân chạy cục bộ, gói thành `TaskManager.exe` (Node SEA) với giao diện React và dữ liệu SQLite trên máy.

- **Vấn đề giải quyết:** quản lý công việc cá nhân/định kỳ, project và Gantt, báo cáo tuần, lịch release, luyện thi chứng chỉ, sơ đồ tư duy và các cấu hình hỗ trợ.
- **Tích hợp hiện hành:** Redmine để kiểm tra kết nối; MCP task-manager để Claude Desktop gọi một số API local. App không tự gọi AI để thực hiện task.
> ⏳ User điền nốt: **tầm nhìn sản phẩm**, **đối tượng chính** và **mục tiêu đo lường thành công**.

## 2. Nguyên tắc sản phẩm hiện hành

- **Workbench, không landing/hero** — tối ưu diện tích làm việc.
- **Local-first, single-user** — chưa có đăng nhập hoặc phân quyền; backend bind `127.0.0.1`; dữ liệu ở `%APPDATA%\TaskManager`.
- **Không tự động thực hiện hành động bên ngoài** — task và release hiện do người dùng thao tác trực tiếp.
- **Dữ liệu nghiệp vụ là nguồn thật** — thao tác nhiều bước dùng transaction; migration giữ khả năng mở DB cũ và archive dữ liệu trước khi xoá schema cũ.

## 3. Phạm vi chức năng

### FR-1 Task cá nhân
- FR-1.1 Tạo/sửa/xoá task đơn lẻ (`don_le`) và định kỳ (`dinh_ky`).
- FR-1.2 Board 3 cột: Kho task · Hôm nay · Task định kỳ theo ngày.
- FR-1.3 Đổi trạng thái, hoàn thành/hủy, lịch sử và tìm kiếm.
- FR-1.4 Link đính kèm tối đa 4, ghi chú và độ ưu tiên.
- FR-1.5 Lặp hàng ngày, T2–T6, hằng tuần hoặc hằng tháng.
- FR-1.6 Thêm task nhanh bằng `Ctrl+Q`, hỗ trợ cả task project.

### FR-2 Project & WBS
- FR-2.1 Project mở/đóng/pending/khôi phục; project hệ thống “Khác” không xoá hoặc đóng.
- FR-2.2 Task tối đa 3 cấp, tiến độ, ngày dự kiến, estimate và nhiều PIC theo giai đoạn.
- FR-2.3 Task cha rollup ngày, estimate và tiến độ từ task con.
- FR-2.4 Gantt tổng có lọc project/PIC và kéo/resize giai đoạn.
- FR-2.5 Chỉ đóng project khi mọi task hoàn thành 100%.

### FR-3 Báo cáo tuần
- FR-3.1 Wizard 4 bước: nhập tiến độ, đánh giá, tổng kết project và duyệt mục tiêu tuần.
- FR-3.2 Mục tiêu bám project/task, hỗ trợ carry-over và target progress.
- FR-3.3 Báo cáo nội bộ và báo cáo DM, xuất nội dung để copy; báo cáo DM có thêm nút tải file Excel
  (Project → PIC → Task, 2 vùng tiến độ tuần trước/mục tiêu tuần này) — CR-20260915.
- FR-3.4 Lưu lịch sử báo cáo đã duyệt, duy nhất theo tuần và loại.

### FR-4 Release định kỳ và khẩn cấp
- FR-4.1 Định nghĩa task mẫu và template có token để sinh task release.
- FR-4.2 Release định kỳ dùng chu kỳ theo ngày release; release khẩn cấp có hai pha immediate và scheduled.
- FR-4.3 Task release giữ `origin_ref` và `reply_to_ref` để theo đúng definition nguồn.
- FR-4.4 Có kiểm tra task lệch definition, xem trước và áp dụng đồng bộ.
- FR-4.5 Batch khẩn cấp lưu team, hệ thống ảnh hưởng và cờ “đã đăng bài”; đổi team/hệ thống sau khi đã đăng phải xác nhận và tự bỏ cờ.

### FR-5 Luyện đề / Chứng chỉ
- FR-5.1 Kỳ thi, bộ đề và câu hỏi single/multi song ngữ EN/VI.
- FR-5.2 Import HTML/JSON, chống trùng theo file name và export JSON song ngữ.
- FR-5.3 Rút câu ưu tiên câu ít xuất hiện, phiên review/exam, timer, chấm điểm và lịch sử.

### FR-6 MindMap
- FR-6.1 Cây node autosave, canvas SVG, edge, grid và định dạng node.
- FR-6.2 Pen, undo/redo, zoom, export Markdown/Mermaid và tạo task từ node.
- FR-6.3 File đính kèm được giới hạn loại/kích thước và luôn tải xuống dạng attachment.

### FR-7 Settings
- FR-7.1 PIC: thêm/sửa/xoá/sắp xếp/màu; đổi tên cascade; chặn xoá khi đang dùng.
- FR-7.2 Category chứng chỉ.
- FR-7.3 Redmine URL và API key mã hoá, có kiểm tra kết nối.
- FR-7.4 Phím tắt có thể cấu hình, lưu trong localStorage.
- FR-7.5 Cấu hình Team/Người/Group phục vụ nội dung release thủ công.

## 4. Ngoài phạm vi của bản hiện hành

- Đa người dùng, đăng nhập và phân quyền. Phần này đang được thiết kế trong `CR-20260913-nen-tang-da-nguoi-dung`, chưa phải hành vi đã triển khai.
- App server public hoặc chạy nhiều instance.
- AI automation, tự đăng Dr.JOY, tự thao tác Drive/Redmine và Skill Forge — đã bị xoá theo `CR-20260912-xoa-ai-automation-tai-cau-truc`.

## 5. Glossary

- **PIC**: người phụ trách (Person In Charge).
- **carry-over**: mục tiêu tuần trước chưa xong, mang sang tuần này.
- **Khác**: project hệ thống chứa việc lẻ, không xoá/đóng.
- **origin_ref**: definition đã sinh ra task release.
- **reply_to_ref**: definition mà task cần phản hồi/comment theo nội dung release.

## 6. Yêu cầu cần làm rõ

> ⏳ User điền nốt: KPI/metrics thành công, ưu tiên roadmap và các ràng buộc vận hành dài hạn.
