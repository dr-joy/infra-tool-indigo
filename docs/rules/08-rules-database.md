# 08 - Database Rules

> Nguồn: `docs/_archive/system-standardization-rules.md`, `docs/specs/04-database-design.md`, `server/db.ts`, `server/lib/mappers.ts`, `server/paths.ts`.
> Đây là rule DB/migration để giữ an toàn cho file SQLite runtime.

## 1. Naming & Mapping

- DB dùng `snake_case`.
- API/FE dùng `camelCase`.
- Mapper backend chịu trách nhiệm chuyển đổi.
- Frontend không dùng tên cột DB.
- Boolean lưu `INTEGER 0/1`, API trả boolean thật.
- Date-only lưu `YYYY-MM-DD`; time-only lưu `HH:MM`; timestamp lưu ISO string.

## 2. Runtime DB

- Runtime DB chuẩn: `%APPDATA%\TaskManager\data\tasks.sqlite`.
- Dev và exe dùng chung vị trí này để rebuild exe không mất data.
- `data/tasks.sqlite` trong repo có thể là dữ liệu dev/cũ, không coi là nguồn runtime chính.
- Bulk update runtime DB phải backup trước.
- Backup nên dùng cơ chế nhất quán như `VACUUM INTO`.

## 3. Schema & Migration

- Schema/migration đặt trong `server/db.ts`.
- Tạo bảng bằng `CREATE TABLE IF NOT EXISTS`.
- Thêm cột phải check `PRAGMA table_info` trước.
- Cột `NOT NULL` mới phải có default an toàn.
- Không assume runtime DB đã giống source.
- Nếu cần đổi constraint/drop column: rebuild bảng, copy data, drop cũ, rename mới, tạo lại index.
- Bật `PRAGMA foreign_keys = ON`; WAL qua `PRAGMA journal_mode = WAL`.

## 4. Entity User-Editable

Entity thường nên có:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `created_at`
- `updated_at`
- `sort_order` nếu UI có reorder hoặc cần thứ tự ổn định
- index cho khóa ngoại/query hay dùng

## 5. JSON Trong TEXT

Chỉ dùng JSON cho config/data phụ có schema nhỏ và ổn định:

- `task_links`
- `related_ids`
- `cau_hinh_json`
- `dap_an_chon_json`
- `mindmaps.data`

Mapper phải parse phòng thủ: JSON hỏng không làm sập API.

## 6. Domain Notes

| Domain | Rule |
|---|---|
| Luyện đề | `_en` là nội dung gốc/import; `_vi` là bản dịch/chỉnh sửa tiếng Việt |
| Project task | Tối đa 3 level; parent lấy ngày/estimate/progress từ con |
| Project assignment | Leaf task có assignment theo phase; phase derive ngày/estimate/assignee của leaf |
| Weekly | Goal/evaluation/summary liên kết mềm với project/task |
| Release | `origin_ref`/`reply_to_ref` là ref mềm dùng để nối bài Dr.JOY |

## 7. FK & Soft Link

- FK enforced chủ yếu ở assignment: `project_task_assignments`.
- Nhiều quan hệ là soft link: `projects.pic`, `tasks.related_ids`, weekly project/task ids, release refs.
- Khi đổi/xóa dữ liệu soft link, route phải tự cascade hoặc chặn theo rule nghiệp vụ.

## 8. Cần Bổ Sung

> ⏳ User điền nốt: chính sách backup tần suất/nơi lưu/retention.
> ⏳ User điền nốt: có cần multi-user hoặc sync nhiều máy không.
