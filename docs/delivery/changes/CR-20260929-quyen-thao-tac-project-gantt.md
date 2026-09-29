# CR-20260929 — Phản ánh quyền thao tác Project và Gantt trên giao diện

| Trường | Giá trị |
|---|---|
| Loại | Sửa hành vi UI |
| Mức tác động | Vừa — Project/Gantt, không đổi API hay DB |
| Người đề xuất | Leader (user) |
| Ngày | 2026-09-29 |
| Backlog item | `BL-20260929-001` |
| Trạng thái | Đã triển khai, chờ nghiệm thu |
| Spec liên quan | [CR-20260913](CR-20260913-nen-tang-da-nguoi-dung.md) FR-8, FR-16 |

## Mục tiêu

Người dùng không được bấm các thao tác Project/Task mà server sẽ từ chối. Trên Gantt, Member chỉ
được đổi ngày hoặc resize giai đoạn có `userId` là chính mình; Leader quản lý tự do mọi task/giai
đoạn của team.

## Phạm vi và tiêu chí nghiệm thu

1. Member thấy nút tạo, sửa, xóa và kéo sắp xếp **Project** ở trạng thái không thao tác được; nút
   xóa task cũng disabled. Các quyền Member đang được server cấp (tạo task, sửa task của mình) giữ
   nguyên.
2. Task không có giai đoạn của Member không mở popup sửa và không đổi nhanh tiến độ được. Task được
   gán cho Member vẫn sửa được.
3. Trên Gantt, lane của Member kéo/resize được; lane của người khác và dữ liệu legacy không gắn User
   không nhận thao tác kéo/resize. Thanh task không có assignment chỉ kéo được nếu task thuộc Member.
4. Member không có tay nắm đổi thứ tự Gantt; Leader có đủ tay nắm và quyền kéo/sửa mọi thanh.
5. Không thay thế kiểm tra server: `authorize()` và các kiểm tra theo assignment trong
   `server/routes/projects.ts` vẫn là cổng bắt buộc khi request được gửi trực tiếp.

## Thay đổi kỹ thuật

- `ManHinhProject` đọc `actor` và vai trò của team đang chọn từ `AuthContext`, rồi truyền quyền tối
  thiểu cần thiết vào cây task và popup Gantt.
- `ProjectTaskTree` disabled thao tác xóa/tiến độ và chặn mở sửa với task không thuộc Member.
- `PopupGanttTong` chỉ gắn handler kéo/resize cho assignment hợp lệ; các nút resize còn lại có
  `disabled`. Chỉ Leader có drag-and-drop để sắp thứ tự thực thi.
- Test client mới `test/client/project-permissions.test.tsx` phủ Member ở cả danh sách Project và Gantt.

## Kiểm tra

- `npm.cmd run build` — pass.
- `npm.cmd run test:client -- project-permissions.test.tsx` — 2/2 pass.
- Còn chạy `npm run check` trước khi nghiệm thu/commit.
