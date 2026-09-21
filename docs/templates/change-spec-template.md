<!--
  TEMPLATE Đặc tả Thay đổi (Change Spec) — copy file này thành:
    docs/delivery/changes/CR-<yyyymmdd>-<slug>.md
  rồi điền. Xoá các dòng hướng dẫn <!-- ... -->. Quy chuẩn: docs/standards/design-standard.md
-->

# CR-<yyyymmdd>-<slug> — <Tên thay đổi ngắn gọn>

| Trường | Giá trị |
|---|---|
| Loại | ⬜ Thêm mới ⬜ Sửa hành vi ⬜ Xóa/Deprecate |
| Mức tác động | ⬜ Nhỏ ⬜ Vừa ⬜ Lớn (đụng DB/nhiều màn/automation) |
| Người đề xuất | <tên> |
| Ngày | <yyyy-mm-dd> |
| Backlog item | `BL-<yyyymmdd>-<nnn>` (phải ở trạng thái `Picked`) |
| Trạng thái | ⬜ Draft ⬜ Đã review ⬜ Đã duyệt ⬜ Đã triển khai ⬜ Đã nghiệm thu |
| Spec liên quan | <link tới docs/01..09 sẽ bị ảnh hưởng> |

## 1. Bối cảnh & Vấn đề
<!-- Hiện trạng đang thế nào, đau ở đâu / cơ hội gì. 3–6 câu. -->

## 2. Mục tiêu & Ngoài phạm vi
- **Mục tiêu (đo được):**
  - …
- **Ngoài phạm vi (không làm lần này):**
  - …

## 3. Người dùng & Kịch bản
<!-- Ai dùng, khi nào, để làm gì. User story: "Là <vai trò>, tôi muốn <việc> để <giá trị>." -->
- …

## 4. Yêu cầu chức năng
<!-- Đánh số FR-1, FR-2… để test & code truy vết được. -->
- **FR-1:** …
- **FR-2:** …

## 5. Yêu cầu phi chức năng (nếu có)
<!-- Hiệu năng, bảo mật, tương thích dữ liệu cũ, offline/local, đóng gói SEA… Tham chiếu docs/09. -->
- …

## 6. Thiết kế giải pháp
### 6.1. Luồng người dùng / UI (tham chiếu docs/02, docs/06)
<!-- Màn hình nào, popup nào, thao tác, trạng thái rỗng/loading/lỗi. Có thể kèm ascii/mockup. -->
### 6.2. API & nghiệp vụ (tham chiếu docs/03, docs/07)
<!-- Endpoint (method, path, body, response, status lỗi 400/404/409), rule validation, giao dịch. -->
### 6.3. Dữ liệu & schema (tham chiếu docs/04, docs/08)
<!-- Bảng/cột thêm-sửa, migration idempotent, tương thích bản ghi cũ, default. -->
### 6.4. Automation / tích hợp (nếu đụng)
<!-- action_type/ai_note/related_ids, MCP, quyền ghi, mọi hành động ghi ra ngoài phải có duyệt. -->

## 7. Phân tích tác động
<!-- Tick mọi lớp bị đụng — xem checklist đầy đủ ở DESIGN-STANDARD mục 8. -->
- [ ] Frontend (màn/component) · [ ] API route · [ ] DB/migration · [ ] Automation/MCP
- [ ] i18n (chuỗi mới) · [ ] Đóng gói SEA/MCP · [ ] Bảo mật · [ ] Dữ liệu cũ/backward-compat
- **Rủi ro & giảm thiểu:** …
- **Ảnh hưởng chức năng đang chạy:** …

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)
<!-- Given/When/Then, mỗi cái map tới ≥1 test. Đây là hợp đồng để QA nghiệm thu. -->
- **AC-1 (FR-1):** Given … / When … / Then …
- **AC-2 (FR-2):** Given … / When … / Then …

## 9. Kế hoạch test (tham chiếu standards/qa-standard.md)
- Tầng test dự kiến: ⬜ Unit ⬜ Integration route ⬜ Render component ⬜ Smoke thủ công
- Ca test chính + ca lỗi/biên: …

## 10. Kế hoạch triển khai / rollback
- Bước triển khai: …
- Rollback nếu hỏng: …
- Với **Xóa/Deprecate**: kế hoạch gỡ dần, xử lý dữ liệu tồn, thông báo.

## 11. Docs cần cập nhật sau khi làm xong
<!-- Change spec là DELTA; sau khi merge phải cập nhật nguồn chân lý 01..09. -->
- [ ] docs/01 … [ ] docs/02 … [ ] docs/03 … [ ] docs/04 … [ ] docs/05 … [ ] rules 06–09

## 12. Duyệt (sign-off)
| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | | | |
| Người triển khai | | | |
| QA nghiệm thu | | | |
