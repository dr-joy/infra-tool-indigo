# 03 — API & Business Logic Spec

> Nguồn: `server/app.ts`, `server/index.ts`, `server/routes/*.ts`, `server/lib/*.ts`, `server/types.ts`. Mô tả hành vi **thực tế trong code**.
> Không có auth người dùng (app cục bộ, bind `127.0.0.1`). Mọi router mount dưới `/api`.

## 0. Hạ tầng chung

- **Express**, tắt `x-powered-by`. Header bảo mật mọi request: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- **CORS**: chỉ origin `^https?://(localhost|127\.0\.0\.1)(:\d+)?$`.
- Body limit `32mb` (đủ cho các payload JSON lớn — export/import dữ liệu, mindmap...).
- Static: serve `dist/` nếu có; SPA fallback trả `index.html` cho GET không phải `/api`.
- **Error handler toàn cục**: log server-side, trả `500 {message:'Lỗi server nội bộ'}` — KHÔNG lộ stack/SQL.
- Port `PORT||4000`, bind `127.0.0.1`. SEA/exe hoặc `OPEN_BROWSER=1` → tự mở Chrome (profile `tuan.vu@drjoy.jp`) trừ khi `NO_BROWSER=1`.
- **Error contract**: `HttpError(status,message,code?)`; `sendRouteError` → `{message, code?}`; lỗi khác → 500 fallback.

## 1. Tasks (`routes/tasks.ts`)

| Method + Path | Mục đích | Validation | Codes | Logic / side effect |
|---|---|---|---|---|
| GET `/api/tasks?date=YYYY-MM-DD` | Dữ liệu board theo ngày | date (mặc định hôm nay VN) | 200 `{khoTask,taskHomNay,taskDinhKy,lichSu}` | khoTask=đơn lẻ chưa làm; taskHomNay=đơn lẻ đang làm; lichSu=đơn lẻ done/canceled; taskDinhKy=định kỳ khớp `recurringMatchesDate`, sort theo giờ; mỗi item `taskDinhKy` có thêm `lechDefinition: boolean` (CR-20260814 FR-5) — bulk 1 lượt cho đúng tập đang hiển thị (`diffTaskAgainstDefinition`, `lib/release-render.ts`), `true` CHỈ khi chắc chắn lệch (definition còn tồn tại và so được); thiếu `origin_ref`/definition đã xoá → `false` (không báo động khi không biết) |
| GET `/api/history?keyword=` | Tìm lịch sử | keyword optional | 200 array | đơn lẻ done/canceled, LIKE nhiều cột |
| POST `/api/tasks` | Tạo task | `tenTask` bắt buộc (400); loại/lịch lặp phải hợp lệ | 201 task | định kỳ: giờ mặc định 09:00, lặp mặc định `hang_ngay`; đơn lẻ + `thucHienNgay` → `dang_tien_hanh` |
| PATCH `/api/tasks/:id/status` | Đổi trạng thái | trangThai ∈ 4 enum (400); 404 | 200 `{ok}` | done/canceled → set ngay_hoan_thanh=now |
| PATCH `/api/tasks/:id/schedule` | Đổi giờ định kỳ | `HH:MM`; start≥07:30, end≤18:00, end>start (400); phải là task định kỳ | 200 `{ok,taskId}` | cập nhật lịch của task |
| PATCH `/api/tasks/:id` | Sửa task | `tenTask` bắt buộc; 404 | 200 `{ok,taskId}` | field vắng giữ giá trị cũ; `updateRelated` cập nhật task cùng tên+lịch |
| DELETE `/api/tasks/:id` | Xoá | — | 200 `{ok}`; 404 | hard delete |

## 2. Projects + Project Tasks (`routes/projects.ts`)

| Method + Path | Mục đích | Validation/Codes | Logic |
|---|---|---|---|
| GET `/api/projects` | Project đang mở | — | closed & pending NULL |
| GET `/api/projects/closed` | Đã đóng/pending | — | |
| POST `/api/projects` | Tạo | ten/pic bắt buộc; ngày `YYYY-MM-DD` (400) | sort=max+1 |
| PATCH `/api/projects/reorder` | Sắp xếp | projectIds phải khớp tập (400) | transactional |
| PATCH `/api/projects/:id/close` | Đóng | **400** nếu is_system; **400** nếu có task tien_do≠100; 404 | set closed_at |
| PATCH `/api/projects/:id/pending` / `/restore` | Pending / khôi phục | không system | |
| PATCH `/api/projects/:id` | Sửa | system = sửa tên; else pic+ngày | |
| DELETE `/api/projects/:id` | Xoá | không system; 404 | xoá task rồi project (transaction) |
| GET `/api/projects/:id/tasks` | Cây task | 404 | rollup + assignments |
| POST `/api/projects/:id/tasks` | Tạo task | tieuDe; ngày valid+range; estimate **>0** nếu set; tien_do 0..100; system cấm task con; parent level<3 (max **3 cấp**) | rollup lại; lưu assignments |
| PATCH `.../tasks/reorder` | Sắp xếp cùng cha | taskIds khớp anh em | transactional |
| PATCH `.../tasks/execution-order` | Sắp xếp thứ tự Gantt (task lá) | taskIds = tập lá | transactional |
| PATCH `.../tasks/:taskId` | Sửa task | estimate/tien_do check chỉ với lá; **409 `GOAL_CONFLICT`** nếu đổi ngày làm task rớt khỏi tuần mục tiêu (trừ khi `confirmRemoveGoal`) | rollup lại |
| PUT `.../tasks/:taskId/assignments` | Thay giai đoạn phân công | chỉ lá; mỗi phase pic+ngày+estimate>0 | derive ngày/estimate/assignee lá từ phase; rollup |
| DELETE `.../tasks/:taskId` | Xoá task + con | 404 | CTE recursive; rollup |

**Rollup**: parent estimate=Σ child(>0); progress=weighted theo estimate; ngày=min/max con.

## 3. Schedule — sinh task release (`routes/schedules.ts`)

| Method + Path | Mục đích | Validation/Codes | Logic |
|---|---|---|---|
| POST `/api/schedules/regular-release/tasks` | Bulk tạo task release định kỳ | releaseDate; tasks[]; giờ clamp [07:30,17:45], end=+15 ≤18:00; **409 `REGULAR_RELEASE_EXISTS`** nếu tồn tại & !force | releaseMonth=date[0:7]; force xoá tháng cũ (+legacy window, match theo `ten_task` — người dùng đã xác nhận qua 409, có marker `ten-task-match-ok`) |
| POST `/api/schedules/regular-release/task` | "Lưu 1 definition" — tạo/cập nhật ĐÚNG 1 task theo definition | body `{releaseDate, definitionId}` — **KHÔNG** nhận nội dung task từ FE (CR-20260814 FR-10/AC-13); definitionId không tồn tại → 400 | Dùng chung lõi phân loại/ghi với `/release/sync` (CR-20260814 FR-1): match DUY NHẤT theo `(release_month, origin_ref=definitionId)`, UPDATE tại chỗ nếu có task, INSERT nếu chưa — **không còn** DELETE theo `ten_task` (hồi quy BUG-20260814); cổng máy `scripts/check-release-sync.mjs` chặn tái diễn |
| POST `/api/schedules/release/sync-preview` | Xem trước đồng bộ cả đợt (không ghi) | body `{releaseMonth, originRefs?}` — không nhận `tasks[]` nữa | BE tự đọc `release_task_definitions`+`release_templates`, so với task hiện có bằng `diffTaskAgainstDefinition` (`lib/release-render.ts`); trả `willUpdate`/`skipped` (`done`\|`canceled`\|`past`\|`unchanged`\|`missing`) |
| POST `/api/schedules/release/sync` | Áp dụng đồng bộ cả đợt | body `{releaseMonth, originRefs?}` | Chỉ UPDATE task đã tồn tại (không backfill task thiếu — đó là việc của route "lưu 1 definition"); cột `ghi_chu` chỉ được SET khi definition có template (FR-4/FR-8); idempotent (AC-8) |
| GET `/api/schedules/release/drift?releaseMonth=` | Đếm/liệt kê task lệch definition — CHỦ ĐỘNG, không cần bấm gì (CR-20260814 FR-5) | releaseMonth bắt buộc (400) | 1 lượt truy vấn task + definitions + templates của đợt (không N+1); trả `{lech[], boQua[], khongXacDinhNguon[]}` — `khongXacDinhNguon` = task thiếu/sai `origin_ref` (không chặn, chỉ liệt kê) |
| POST `/api/schedules/emergency-release/tasks` | Bulk khẩn cấp | start≥0,end≤24:00; **409 `EMERGENCY_RELEASE_EXISTS`** nếu tồn tại & !force & !replaceMatching | key=`releaseKey`\|`emergency:{date}`; `replaceMatching` xoá theo `ten_task` là lựa chọn người dùng chủ động, có marker `ten-task-match-ok` |
| PATCH `/api/schedules/emergency-release/batches/:releaseMonth` | Sửa team/hệ thống của 1 batch đã tồn tại (chỉ gọi qua API, không có UI — CR-20260914) | body `{teams, systems}`; batch không tồn tại → 404 | Không còn cờ "đã đăng bài"/guard 409 already-posted (xoá cùng màn danh sách batch, CR-20260914) |
| DELETE `/api/schedules/emergency-release/tasks?releaseKey=` | Xoá batch | releaseKey (400) | xoá theo release_month |

**Định nghĩa → task release (CR-20260814-hop-nhat-dong-bo-definition-xuong-task):** task release là **bản
chụp** (`snapshot`) nội dung definition tại thời điểm sinh/đồng bộ — sửa definition sau đó KHÔNG tự động sửa
task đã sinh, phải bấm "Áp dụng thay đổi"/lưu lại definition khi ô ngày release đang trỏ đúng đợt. `origin_ref`
là khoá bền map task ↔ definition (không phải `ten_task` — đổi tên definition không được làm mất/nhân đôi
task). `server/lib/release-render.ts` là **nguồn duy nhất** dựng nội dung từ definition (`buildDefinitionTargetPayload`)
và so lệch (`diffTaskAgainstDefinition`) — badge Release cùng preview/apply sync đều gọi chung hai hàm này, không có bộ so sánh riêng. Task legacy thiếu `origin_ref`: **không** backfill tự động
(rủi ro trùng tên đúng là thứ CR này xoá bỏ) — chỉ hiện ở nhóm `khongXacDinhNguon` của endpoint drift, xử lý
tay nếu cần map lại.

## 4. Release definitions & templates (`routes/release.ts`)

- **Template định kỳ** `/api/release/templates[/:id]`: CRUD; `name` bắt buộc; content sanitize và token phải thuộc `validReleaseTemplateTokens`. Xoá template đặt `template_id=NULL` ở definition đang tham chiếu.
- **Template khẩn cấp** `/api/release/emergency/templates[/:id]`: CRUD; token phải thuộc `validEmergencyReleaseTemplateTokens`. Token `mention` được thay bằng danh sách tên đã nhập; không có tên thì thay bằng chuỗi rỗng.
- **Definition định kỳ** `/api/release/task-definitions[/:id]`: `title`, `startTime`, `dateToken`, template, links, thứ tự và `replyToDefinitionId`. Backend xác nhận definition được reply tồn tại cùng bảng và không tự trỏ chính nó.
- **Definition khẩn cấp** `/api/release/emergency/task-definitions[/:id]`: thêm timing token, immediate priority, relative offset và schedule mode; `replyToDefinitionId` tuân cùng quy tắc cùng loại/không tự trỏ.
## 5. Weekly Report (`routes/weekly.ts` + `lib/weekly-report.ts`)

Tuần = Thứ 2–CN. Eval `dat`/`vuot`/`khong_dat` (✅/🔼/❌). Kinds: `internal` (Nội bộ Dev13, Markdown), `vn_management` (DM).

| Method + Path | Mục đích | Codes | Logic |
|---|---|---|---|
| GET `/api/weeks/report-kinds` | Kinds + tuần hiện tại | 200 | |
| GET `/api/weeks/goal-badge-ids` | id 🎯 | 200 | goal tuần mới nhất, <100% |
| GET `/api/weeks/at-risk-ids` | ⚠ carry-over | 200 | goal <100% project mở & là goal tuần trước |
| GET/DELETE `/api/weeks/report-history[/:id]` | Lịch sử báo cáo | | |
| POST `/api/weeks/:weekStart/report-history` | Lưu/duyệt báo cáo | **409 `REPORT_EXISTS`** nếu tồn tại & !force | upsert per week+kind+mode |
| GET `/api/weeks/:weekStart/plan` | Plan wizard | 200 | `buildReportPlan` |
| POST `/api/weeks/:weekStart/apply` | Áp kết quả wizard | 200 `{ok,created,skippedOutOfWeek}` | transaction lớn (dưới) |
| GET `/api/weeks/:weekStart/text?kind=` | Text báo cáo | 200 | render |
| POST `/api/weeks/:weekStart/dm-report` | Báo cáo DM + risks | 200 | |
| GET/DELETE `/api/weeks/:weekStart/goals[/:id]` | Mục tiêu tuần | | |

**`/apply` transaction**: (1) cập nhật tien_do task; (2) upsert đánh giá task tuần TRƯỚC (+manual goal, +project summary); (3) insert mục tiêu tuần này (validate ngày trùng tuần trừ carry-over, else skippedOutOfWeek++; phản ánh PIC; dedupe); (4) `newKhacGoals` tạo task thật trong project "Khác" rồi thêm goal. Rollup lại.

## 6. PIC (`routes/pics.ts`)
GET (kèm `dangSuDung`) · POST (unique) · PATCH reorder · PATCH `:id` (đổi tên **cascade** projects.pic/assignee/weekly, đổi màu) · DELETE (**400** nếu còn task chưa xong).

## 7. Redmine (`routes/redmine.ts`)
Config trong `app_settings`; API key **mã hoá AES-256-GCM** (`enc:v1:...`), master key `%APPDATA%\TaskManager\data\secret.key` (0600, container: `DATA_DIR/secret.key`). GET config (mask key) · PUT (baseUrl bắt buộc, key rỗng→giữ cũ) · DELETE key · POST test (`/users/current.json` header `X-Redmine-API-Key`; **401** key sai, **502** lỗi khác).

## 8. MindMap (`routes/mindmaps.ts`)
Cây lưu JSON trong `mindmaps.data`; file đính kèm `dataDir/mindmap-files`. GET list/detail · POST/PUT (data phải là object) · POST upload (**413** >30MB) · GET file (chống path traversal) · DELETE.

## 9. Hằng số/tiện ích chung
- **Task link**: type `chat/file/git/release/zoom`; URL `^(https?|slack|zoommtg|file|vscode)://`; **tối đa 4 link**.
- **Thời gian**: `HH:MM`; ngày `YYYY-MM-DD` (timezone `Asia/Ho_Chi_Minh`).
- **recurringMatchesDate**: ngayCuThe khớp ngày; hoặc hang_ngay/thu_2_den_thu_6/hang_tuan/hang_thang.

## 10. Cần bổ sung

> Bản hiện hành vẫn là local single-user. Thiết kế multi-user/public server nằm trong `CR-20260913-nen-tang-da-nguoi-dung`; chỉ cập nhật tài liệu này sau khi từng lát đã được triển khai và nghiệm thu.
> ⏳ User điền nốt: hợp đồng API có cần versioning (`/api/v1`) khi mở cho bên thứ ba hay không.