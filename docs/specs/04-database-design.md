# 04 — Database Design

> Nguồn chân lý: `server/schema/*.ts`, `server/db-migrations.ts`, `server/db-seed.ts`, `server/db.ts`, `server/lib/mappers.ts` và `server/paths.ts`.
> Tài liệu này mô tả schema **thực tế trong code**. Chỗ nào là chính sách/quyết định vận hành sẽ đánh dấu `> ⏳ User điền nốt`.

## 1. Engine & lưu trữ

- Engine: **`node:sqlite`** (`DatabaseSync`), 1 file **`tasks.sqlite`**.
- PRAGMA khi mở: `journal_mode = WAL`, `foreign_keys = ON` (nên các FK khai báo `REFERENCES ... ON DELETE ...` được thực thi thật).
- Helper `withTransaction(fn)`: bọc `BEGIN/COMMIT`, lỗi → `ROLLBACK`.
- **Vị trí file DB** (dev và bản đóng gói .exe DÙNG CHUNG — cố ý, để rebuild exe không mất data):
  - base = `%APPDATA%` → `XDG_DATA_HOME` → `os.homedir()`.
  - `dataDir = <base>/TaskManager/data` → file `<base>/TaskManager/data/tasks.sqlite`.
  - Windows: `%APPDATA%\TaskManager\data\tasks.sqlite`.
- Schema tạo/migrate imperatively lúc import `db.ts`: `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` check + `ALTER` + table-rebuild + seed.

## 2. Sơ đồ quan hệ (tổng quan)

```
tasks.origin_ref / reply_to_ref ──> release_task_definitions.id hoặc emergency_release_task_definitions.id (soft)
release_task_definitions.reply_to_definition_id ──> release_task_definitions.id (soft, cùng loại)
emergency_release_task_definitions.reply_to_definition_id ──> emergency_release_task_definitions.id (soft, cùng loại)
emergency_release_batches.release_month ⇄ tasks.release_month

projects (1) ──< project_tasks (self-ref parent_id, 3 level) ──< project_task_assignments [FK CASCADE]
projects.pic ──> pics.name (soft)

weekly_goals / weekly_task_evaluations / weekly_project_summaries ──> projects.id, project_tasks.id (soft)
weekly_report_history (lịch sử báo cáo đã duyệt)

de_thi_category (1) ──< de_thi_ky_thi.nhom (soft)
de_thi_ky_thi (1) ──< de_thi_bo ──< de_thi_cau_hoi [FK CASCADE] ──< de_thi_dap_an [FK CASCADE]
de_thi_phien [FK bo SET NULL] ──< de_thi_tra_loi [FK CASCADE]

mindmaps (JSON tree)
app_settings (key-value; cấu hình Redmine và nội dung release)
```

FK thật được khai báo cho `project_task_assignments`, `de_thi_cau_hoi`, `de_thi_dap_an`, `de_thi_phien` và `de_thi_tra_loi`. Các ref project, parent, PIC, weekly và release còn lại là soft link do backend kiểm tra.
## 3. Chi tiết bảng

#

## 3.1 `tasks` — task cá nhân, định kỳ và task release

PK `id` AUTOINCREMENT.

| Cột | Kiểu / ràng buộc |
|---|---|
| `ten_task` | TEXT NOT NULL |
| `ghi_chu` | TEXT NOT NULL DEFAULT '' |
| `loai_task` | TEXT CHECK IN (`don_le`, `dinh_ky`) |
| `do_uu_tien` | INTEGER nullable |
| `trang_thai` | TEXT CHECK IN (`chua_thuc_hien`, `dang_tien_hanh`, `da_hoan_thanh`, `canceled`) |
| `ngay_tao`, `ngay_hoan_thanh` | ISO text; ngày hoàn thành nullable |
| `gio_bat_dau`, `gio_ket_thuc` | TEXT nullable |
| `lap_lai_kieu`, `ngay_trong_thang`, `thu_trong_tuan` | cấu hình lịch lặp; nullable |
| `ngay_cu_the` | TEXT nullable |
| `release_month`, `release_date` | TEXT nullable |
| `task_links` | TEXT NOT NULL DEFAULT '[]', JSON `{type,url}` |
| `origin_ref` | TEXT nullable, id definition sinh task release |
| `reply_to_ref` | TEXT nullable, id definition mà task này phản hồi/comment |

Index: `(loai_task, trang_thai)`, `(release_month)`, `(ngay_cu_the)`.

Các cột `action_type`, `ai_note`, `related_ids` và toàn bộ `automation_*` đã được archive kèm checksum rồi xoá. Task release cũ thiếu `origin_ref` không được tự map theo tên; endpoint drift đưa chúng vào `khongXacDinhNguon` để xử lý có chủ đích.
#

## 3.2 `projects` — dự án
PK `id`. Cột: `ten_project` NN, `pic` NN (→ pics.name soft), `ngay_bat_dau` NN, `sort_order` NN d0, `closed_at?`, `pending_at?`, `is_system` NN d0 (1 = project hệ thống "Khác"), `created_at/updated_at` NN. Seed: tạo "Khác" nếu chưa có.

#

## 3.3 `project_tasks` — WBS 3 cấp
PK `id`. `project_id` NN (soft→projects), `parent_id?` (self-ref), `level` NN CHECK 1..3, `tieu_de` NN, `ghi_chu` d'', `ngay_bat_dau_du_kien`/`ngay_ket_thuc_du_kien` NN, `estimate_hours` REAL nullable, `tien_do` INT NN CHECK 0..100, `task_links` d'[]', `assignee?`, `sort_order` NN d0, `execution_order` NN d0 (thứ tự DFS toàn cục cho Gantt), timestamps. Index `(project_id)`, `(parent_id)`. (Đã bỏ cột ngày thực tế; migration rebuild đổi CHECK tien_do 25/50/75/100 → 0..100 và estimate_hours nullable.)

#

## 3.4 `project_task_assignments` — phân công giai đoạn (task lá)
PK `id`. `project_task_id` NN **FK→project_tasks ON DELETE CASCADE**, `pic` NN, `start_date`/`end_date` NN, `estimate_hours?`, `sort_order` NN d0, `tien_do` NN d0. Ngày/estimate/assignee của task lá **suy ra** từ các giai đoạn này (`deriveLeafFromAssignments`).

#

## 3.5 Release định kỳ và khẩn cấp

- `release_templates` / `emergency_release_templates`: PK `id TEXT`, `name`, `content`, timestamps.
- `release_task_definitions`: PK `id TEXT`; `title`, `note`, `start_time`, `date_token`, `template_id?`, `task_links`, `sort_order`, `reply_to_definition_id?`.
- `emergency_release_task_definitions`: cùng vai trò cho khẩn cấp; thêm `task_date`, `immediate_priority?`, `relative_offset_minutes?`, `schedule_mode?`; có `reply_to_definition_id?`.
- `reply_to_definition_id` chỉ được trỏ tới definition khác cùng loại và không tự trỏ; backend validate, không có FK SQLite.
- `emergency_release_batches`: PK `release_month`; `teams` và `systems` là JSON array; timestamps. Nguồn canonical team/hệ thống cho guard mismatch của `POST /schedules/emergency-release/tasks`; sửa `teams`/`systems` sau khi tạo chỉ qua `PATCH .../batches/:releaseMonth` (không có UI). Cột `da_dang` (cờ "đã đăng bài" thủ công, CR-20260913-b) đã bị archive-rồi-drop ở CR-20260914 cùng lúc xoá màn danh sách batch — không còn theo dõi trạng thái đăng bài trong app.

Các field automation trên definition đã được archive rồi xoá. Team/Người/Group còn lại là cấu hình nội dung release thủ công, không phải trạng thái AI.
#

## 3.6 Weekly report
- `weekly_goals`: mục tiêu tuần theo project/task. PK `id`. `week_start` NN, `project_id?`, `project_task_id?`, `assignee?`, `goal_text` d'', `reason` d'', `start_progress?`, `target_progress?`, `manual_done?`, `sort_order`, timestamps. Index `(week_start)`, `(project_task_id)`.
- `weekly_task_evaluations`: đánh giá task/tuần. **PK ghép `(week_start, project_task_id)`**. `status` NN CHECK IN (`dat`,`vuot`,`khong_dat`), `note` d'', `unplanned` NN d0.
- `weekly_project_summaries`: tổng kết project/tuần. **PK ghép `(week_start, project_id)`**, `content` d''.
- `weekly_report_history`: lịch sử báo cáo đã duyệt. PK `id`, `week_start` NN, `kind` NN, `mode` d'by_project', `content` NN, timestamps. **UNIQUE `(week_start, kind, mode)`**. (Bảng cũ `weekly_project_reasons` đã DROP.)

#

## 3.7 PIC
- `pics`: PK `id`, `name` NN **UNIQUE**, `color?` (màu Gantt), `sort_order`, timestamps. Seed: `Định, Cường, Phú, Nam, Hoàng` + palette 10 màu.

#

## 3.8 Luyện đề / chứng chỉ (de_thi_*)
- `de_thi_category`: pick-list nhóm chứng chỉ. PK `id`, `name` NN UNIQUE, `sort_order`. Seed từ `DISTINCT nhom`.
- `de_thi_ky_thi`: kỳ thi/chứng chỉ. PK `id`, `nhom` d'' (→category soft), `ten` NN, `ghi_chu`, `exam_so_cau?`, `exam_thoi_gian_phut?`, `sort_order`, timestamps.
- `de_thi_bo`: bộ câu hỏi. PK `id`, `ky_thi_id?` (soft), `ten` NN, `nguon`, `file_name`, `ghi_chu`, `pass_percent?`, `duration_seconds?`, `sort_order`, timestamps. Index `(ky_thi_id)`.
- `de_thi_cau_hoi`: câu hỏi. PK `id`, `bo_id` NN **FK CASCADE**, `loai` NN CHECK IN (`single`,`multi`), `noi_dung_en` NN, `noi_dung_vi`, `giai_thich_en/_vi`, `chu_de`, `do_kho`, `dich_thu_cong` NN d0, `lan_ra` NN d0, `last_rut_at`, `sort_order`, timestamps. Index `(bo_id)`.
- `de_thi_dap_an`: đáp án. PK `id`, `cau_hoi_id` NN **FK CASCADE**, `noi_dung_en` NN, `noi_dung_vi`, `la_dap_an_dung` NN d0, `sort_order`. Index `(cau_hoi_id)`.
- `de_thi_phien`: phiên luyện. PK `id`, `bo_id?` **FK SET NULL**, `che_do` d'review', `so_cau`/`so_dung`/`thoi_gian_giay` d0, `cau_hinh_json` d'{}', `created_at`.
- `de_thi_tra_loi`: câu trả lời trong phiên. PK `id`, `phien_id` NN **FK CASCADE**, `cau_hoi_id` NN (soft), `dap_an_chon_json` d'[]', `dung_sai` d0. Index `(phien_id)`.

#

## 3.9 MindMap
- `mindmaps`: PK `id`, `title` d'', `data` NN d'{}' (cây JSON lồng nhau), timestamps.

#

## 3.10 Cấu hình ứng dụng

- `app_settings`: key-value, PK `key`, `value` NOT NULL, `updated_at`.
- Cấu hình Redmine dùng `redmine_base_url` và `redmine_api_key`; API key được mã hoá thuận nghịch vì backend phải gửi nó cho Redmine.
- Cấu hình nội dung release thủ công hiện giữ các key legacy có tiền tố `automation_announcement_` cho mentions, member group và target group. Tên key được giữ để tránh migration dữ liệu, nhưng không kích hoạt hoặc gọi AI.
- `automation_events`, `drjoy_posted_articles` và các key chỉ phục vụ runtime AI đã được archive rồi xoá theo CR-20260912.
## 4. Enum

**Enforced bằng CHECK:** `tasks.loai_task`, `tasks.trang_thai`, `project_tasks.level` (1..3), `project_tasks.tien_do` (0..100), `weekly_task_evaluations.status`, `de_thi_cau_hoi.loai`.
**Chỉ enforce ở code (không CHECK):** `lap_lai_kieu`, emergency `task_date` token và `schedule_mode`.

## 5. Cột JSON-trong-TEXT
`task_links`, `cau_hinh_json`, `dap_an_chon_json`, `mindmaps.data`, release `teams`/`systems` và cấu hình Team/Người/Group trong `app_settings`. Mapper parse phòng thủ (JSON hỏng → `[]`/`null`, không sập).

## 6. Không nằm trong DB
- **Redmine config** = rows trong `app_settings` (không có bảng riêng).

## 7. Chính sách vận hành — cần bổ sung

> ⏳ User điền nốt: chính sách backup DB (tần suất, nơi lưu, retention) và quy trình restore định kỳ.
> Thiết kế multi-user/server sẽ bổ sung schema owner/team/session sau khi từng lát của `CR-20260913-nen-tang-da-nguoi-dung` được triển khai; tài liệu hiện tại không mô tả schema tương lai như đã tồn tại.