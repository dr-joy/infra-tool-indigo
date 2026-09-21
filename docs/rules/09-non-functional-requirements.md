# 09 - Non-Functional Requirements

> Nguồn: `server/app.ts`, `server/index.ts`, `server/paths.ts`, `server/lib/secret.ts`, `scripts/*`, `docs/specs/03-api-business-logic-spec.md`, `docs/specs/04-database-design.md`.
> NFR dưới đây mô tả trạng thái/ràng buộc thực tế. Các mục chính sách chưa chốt đánh dấu `> ⏳ User điền nốt`.

## 1. Performance

- App ưu tiên local-first, single-user; truy vấn SQLite trực tiếp trong process.
- API list cần `ORDER BY` ổn định và index cho query thường dùng.
- Build Vite có thể warning chunk lớn; chỉ coi là lỗi nếu ảnh hưởng thay đổi đang làm.

> ⏳ User điền nốt: SLA/giới hạn chấp nhận cho thời gian mở app, load từng tab, import đề, render Gantt/MindMap.

## 2. Security

- Không có auth app; chỉ bind `127.0.0.1`.
- CORS chỉ chấp nhận localhost/127.0.0.1.
- Express set header: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- Không trả stack/SQL/path secret/API key ra response.
- Redmine API key mã hóa AES-256-GCM bằng key cục bộ.

> ⏳ User điền nốt: trách nhiệm phê duyệt nội dung khi AI đăng Dr.JOY thật; chính sách lưu/xóa secret; yêu cầu audit.

## 3. Reliability & Safety Net

- DB dùng WAL và transaction cho multi-write.
- Chỉ tồn tại đúng một tiến trình server (EADDRINUSE khi mở app lần hai).

## 4. Portability & Packaging

- Stack: React + Vite + TypeScript, Express + TypeScript, SQLite `node:sqlite`.
- Đóng gói bằng Node SEA thành `TaskManager.exe`.
- Runtime DB nằm ở `%APPDATA%\TaskManager\data\tasks.sqlite`, dùng chung dev/exe.
- Server port mặc định `4000`, bind `127.0.0.1`.

> ⏳ User điền nốt: phiên bản Windows hỗ trợ chính thức; có cần macOS/Linux không.

## 5. Usability

- Workbench density cao, không hero/landing.
- Shortcut hỗ trợ điều hướng và thao tác nhanh.
- UI phải có loading/error/empty state.
- Thao tác nguy hiểm có confirm.
- Text hướng dẫn dài đưa vào `InfoTip`.
- Không layout shift khi hover/toggle/save.

> ⏳ User điền nốt: accessibility target chính thức (keyboard-only, screen reader, contrast).

## 6. Maintainability

- Route theo domain.
- Schema/migration tập trung trong `server/db.ts`.
- Mapper chuyển DB snake_case sang API camelCase.
- Rule frontend/backend/database có file riêng trong bộ docs này và rule granular gốc ở `instroduction/rules`.
- Ưu tiên tách module khi feature có domain riêng, tránh phình thêm vào `src/main.tsx` nếu có thể.

> ⏳ User điền nốt: quy ước review/merge, owner từng module, cadence dọn technical debt.

## 7. Backup & Data Retention

- Có `scripts/backup-db.mjs` và backup khi build exe theo ghi chú hiện có.
- Bulk update runtime DB phải backup trước.
- `drjoy_posted_articles` lưu vĩnh viễn theo thiết kế hiện tại để nối bài reply.

## 8. Internationalization

- Tab chính dùng `src/i18n.ts`.
- Nhiều module/text vẫn có tiếng Việt local.
- Luyện đề lưu nội dung gốc `_en` và bản dịch/chỉnh sửa `_vi`.

> ⏳ User điền nốt: ngôn ngữ chính thức của app/docs; mức độ i18n cần hoàn thiện trước release.
