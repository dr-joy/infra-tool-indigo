# 05 - Test & Acceptance Criteria

> Nguồn: `test/**/*.test.ts`, `docs/specs/01-product-requirement-spec.md`, `docs/specs/02-screen-design-user-flow.md`, `docs/specs/03-api-business-logic-spec.md`.
> Tài liệu này mô tả tiêu chí nghiệm thu cho chức năng hiện có. AI automation và Skill Forge đã bị xoá, không còn thuộc ma trận nghiệm thu hiện hành.

## 1. Lệnh kiểm tra chuẩn

| Mục | Lệnh / cách kiểm tra | Kỳ vọng |
|---|---|---|
| Cổng đầy đủ | `npm run check` | TypeScript, backend/frontend test, build, bundle budget và các cổng tài liệu đều đạt |
| Test | `npm test` | Toàn bộ test backend và frontend đạt |
| Dev smoke | `npm run dev` | Frontend mở được; API local tại `127.0.0.1:4000` trả dữ liệu |
| Bản đóng gói | `npm run package` rồi khởi động lại exe | Exe phản ánh đúng source mới |

## 2. Acceptance theo feature

| Feature | Acceptance criteria |
|---|---|
| Task cá nhân | Tạo/sửa/xoá task đơn lẻ và định kỳ; board 3 cột đúng theo ngày; link tối đa 4; schedule hợp lệ; task hoàn thành/hủy xuất hiện trong lịch sử |
| Project | Project “Khác” không xoá/đóng; task tối đa 3 cấp; parent rollup từ con; task lá có assignment theo phase; chỉ đóng project khi mọi task 100% |
| Báo cáo tuần | Wizard 4 bước; lý do bắt buộc khi không đạt; apply tạo goal/task đúng tuần; history duy nhất; conflict `REPORT_EXISTS` có đường xác nhận ghi đè |
| Release | Template token hợp lệ; task map definition bằng `origin_ref`; sửa definition không tạo task trùng; drift preview/apply đúng; release khẩn cấp tách immediate/scheduled |
| Batch release khẩn cấp | Team/hệ thống là nguồn canonical của batch; cờ `da_dang` hiển thị và cập nhật được; đổi team/hệ thống sau khi đã đăng trả `409 EMERGENCY_BATCH_ALREADY_POSTED` nếu chưa xác nhận |
| Luyện đề | Import chống trùng `fileName`; câu có ít nhất 2 đáp án; rút câu ưu tiên `lan_ra`; lưu phiên luyện và câu trả lời |
| MindMap | Tạo/sửa/xoá map; autosave JSON tree; canvas và export hoạt động; upload chặn loại file chủ động; download luôn là attachment |
| Settings | PIC/category CRUD và reorder; đổi tên cascade; chặn xoá khi đang dùng; Redmine key được mask/mã hoá; shortcut lưu localStorage và phát hiện trùng |
| MCP local | Tool được khai báo gọi đúng API local; backend có thể được khởi động theo cơ chế MCP; tool ghi không được mô tả như có bước duyệt nếu code không có bước đó |

## 3. Chiến lược test

### 3.1 Unit test

- Logic thuần trong `server/lib/*`: ngày/giờ, recurring, weekly report, release render và cleanup MindMap.
- Parser/mapper: JSON hỏng không làm sập mapper; DB snake_case map đúng sang API camelCase.
- Validation helper: ngày, giờ, enum, link scheme và giới hạn payload.

### 3.2 Integration test

- Route Express với DB tạm/cô lập.
- Luồng nhiều bước có transaction: weekly apply, project task assignment, release bulk create/sync và cập nhật batch.
- Error contract: `400/404/409/500` trả `{message, code?}`; lỗi không lộ stack, SQL, path hoặc API key.
- Migration xoá schema cũ phải chạy tiếp được từ trạng thái dở dang, archive trước khi drop và checksum khớp nội dung thật.

### 3.3 Regression thủ công

- Sau thay đổi frontend lớn, smoke đủ 7 tab hiện hành.
- Sau thay đổi DB/migration, chạy với bản sao DB runtime và kiểm integrity.
- Sau thay đổi màn Release, chạy luồng định kỳ và khẩn cấp, gồm trạng thái “đã đăng bài”.
- Sau thay đổi source, đóng gói và khởi động lại `TaskManager.exe`.

## 4. UI regression checklist

- Màn hình render không lỗi; loading/error/empty state hoạt động.
- Không còn tab, shortcut, popup, badge hoặc nhãn thuộc AI automation/Skill Forge.
- Container, border, màu action và icon điều hướng tuân theo rules frontend.
- Không overlap hoặc tràn text trên viewport desktop thông dụng.
- Domain visual không bị mất: MindMap canvas, Release timeline, Luyện đề đúng/sai/timer, Project Gantt/tree.

## 5. BE/API checklist

- Input sai trả status và code đúng.
- Response entity map camelCase.
- Lỗi trả JSON `{message, code?}`, không lộ stack/SQL/path/secret/API key.
- SQL dùng prepared statement; fragment động chỉ lấy từ hằng số/allowlist.
- Multi-write dùng transaction; derived data được tính lại sau ghi.
- Không mount route đã xoá của AI automation hoặc Skill Forge.

## 6. DB checklist

- Migration idempotent và tiếp tục được từ trạng thái dở dang.
- Runtime DB cũ vẫn mở được; dữ liệu nghiệp vụ còn nguyên sau khi dọn schema cũ.
- Cột `NOT NULL` mới có default an toàn.
- Index được thêm cho query mới nếu cần.
- Migration phá huỷ schema phải archive + checksum trước và có backup DB.

## 7. Cần bổ sung

> ⏳ User điền nốt: mức coverage mong muốn theo domain và có dùng Playwright/screenshot regression chính thức hay không.
