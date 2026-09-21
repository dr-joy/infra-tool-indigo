---
description: Mở Change Spec (CR) mới trong docs/delivery/changes/ từ backlog item đã được pick
argument-hint: <slug-ngắn-gọn-không-dấu>
---

Mở một Change Spec mới cho đường C (xem skill `delivery-flow`):

1. Xác nhận việc có item trong `docs/backlog/README.md` và Leader đã chuyển nó sang `Picked`. Nếu chưa, dừng
   ở backlog; không dùng CR để thay quyết định ưu tiên.
2. Lấy ngày hôm nay dạng `yyyymmdd` (dùng `date +%Y%m%d` qua Bash nếu cần).
3. Slug: dùng `$ARGUMENTS` nếu có, không thì hỏi user 1 slug ngắn-gọn-không-dấu mô tả thay đổi.
4. Copy `docs/templates/change-spec-template.md` → `docs/delivery/changes/CR-<yyyymmdd>-<slug>.md`.
5. Sửa tiêu đề H1 thành `CR-<yyyymmdd>-<slug> — <tên mô tả>`, điền `Ngày` và `Backlog item`.
6. KHÔNG tự điền các mục còn lại (Bối cảnh, FR/AC…) — đó là việc của bước "BA viết Change Spec" trong
   `delivery-flow`, hỏi user hoặc chờ nội dung thật. Chỉ dựng khung file.
7. Báo cho user đường dẫn file vừa tạo.
