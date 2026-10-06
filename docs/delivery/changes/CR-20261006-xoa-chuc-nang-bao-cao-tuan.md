# CR-20261006-xoa-chuc-nang-bao-cao-tuan — Xóa hẳn chức năng Báo cáo tuần (Reports)

| Trường | Giá trị |
|---|---|
| Loại | Xóa/Deprecate |
| Mức tác động | Lớn (đụng DB/nhiều màn/phân quyền) |
| Người đề xuất | Leader |
| Ngày | 2026-10-06 |
| Backlog item | `BL-20261006-001` (Picked) |
| Trạng thái | Đã nghiệm thu |
| Spec liên quan | docs/01, 02, 03, 04, 05 (mục Báo cáo tuần) |

## 1. Bối cảnh & Vấn đề
Leader quyết bỏ toàn bộ tab Báo cáo tuần (Reports): không còn dùng. Leader chọn xóa cả data (không giữ bảng nằm im).

## 2. Mục tiêu & Ngoài phạm vi
- **Mục tiêu:** gỡ FE (tab, màn, shortcut, i18n, badge 🎯/báo đỏ ở màn Project), BE (router, lib, Excel, quyền, feature key, seed),
  DB (DROP 6 bảng weekly_*), test, docs.
- **Ngoài phạm vi:** bảng `pics` (PIC dùng chung), tính năng Project/Task/Release/Mindmap.

## 4. Yêu cầu chức năng
- **FR-1:** Không còn tab Báo cáo tuần, shortcut `alt+3`, URL `?tab=bao_cao_tuan`.
- **FR-2:** Không còn endpoint `/api/weeks/*`; không còn feature key `weekly_report` (admin, provisioning, cascade tắt project).
- **FR-3:** Migration idempotent DROP `weekly_goals`, `weekly_task_evaluations`, `weekly_project_summaries`,
  `weekly_report_history`, `weekly_report_kinds`, `weekly_project_risks` và xóa dòng `feature_visibility.feature='weekly_report'`.
- **FR-4:** Xóa project/task và đổi lịch task không còn đụng tới dữ liệu tuần.

## 6. Thiết kế giải pháp
- DB: migration `DROP TABLE IF EXISTS` mỗi boot (data mất vĩnh viễn — **bắt buộc `npm run backup-db` trước**, và backup prod trước deploy).
  CHECK của `feature_visibility` trên DB cũ vẫn cho phép giá trị `weekly_report` (SQLite không sửa CHECK nếu không rebuild) — vô hại, dòng đã bị xóa.
- `weekly_project_risks` có FK cứng sang projects: DROP trước khi project bị xóa là an toàn.

## 7. Phân tích tác động
- [x] Frontend · [x] API route · [x] DB/migration · [x] i18n · [x] Dữ liệu cũ
- **Rủi ro:** mất data báo cáo tuần cũ; giảm thiểu bằng backup. Script ops `slice4-migrate` tham chiếu bảng cũ → bỏ qua bảng không tồn tại.

## 8. Tiêu chí nghiệm thu
- **AC-1 (FR-1):** tab Reports biến mất, `?tab=bao_cao_tuan` không còn mở màn nào.
- **AC-2 (FR-2):** `GET /api/weeks/...` trả 404; admin không còn công tắc "Báo cáo tuần".
- **AC-3 (FR-3):** boot trên DB cũ có 6 bảng → không còn bảng nào `weekly_*`; boot lần 2 không lỗi.
- **AC-4 (FR-4):** xóa project/đổi ngày task chạy đúng; `npm run check` xanh.

## 10. Kế hoạch triển khai / rollback
- Triển khai: backup DB → merge → deploy (migration tự DROP). Rollback: khôi phục DB từ backup + revert commit.

## 11. Docs cần cập nhật
- [x] docs/specs 01–05 gỡ mục Báo cáo tuần.
