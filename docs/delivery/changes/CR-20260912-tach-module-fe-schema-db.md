# CR-20260912 — Tách module cụ thể: schema DB và màn hình frontend

| Trường | Giá trị |
|---|---|
| Loại | Tech debt / Refactor (không đổi hành vi) |
| Mức tác động | Trung bình — sửa cấu trúc file trên diện rộng (server/db.ts, src/main.tsx), không đổi API/schema dữ liệu/hành vi UI |
| Người đề xuất | Leader (yêu cầu trực tiếp sau khi rà soát kiến trúc phát hiện `server/db.ts` và `src/main.tsx` chưa tách theo tính năng) |
| Ngày | 2026-09-12 |
| Backlog item | `BL-20260912-002` |
| Trạng thái | ✅ Đã triển khai, đã qua Council review, hội tụ — chưa merge vào `main` |
| Spec liên quan | Không có (thuần tái cấu trúc code, không đổi FR/AC) |

## 1. Bối cảnh

Sau khi CR-20260912-xoa-ai-automation-tai-cau-truc hoàn tất, một đợt rà soát kiến trúc (agent đọc code
thật, không đoán) phát hiện: backend tách module khá tốt (9 router theo đúng tính năng), nhưng 2 file
lớn chưa tách theo tính năng:

- `server/db.ts` (996 dòng) — gộp schema của cả 8 tính năng + toàn bộ migration lịch sử + seed data +
  logic archive-xoá AI automation vào một file.
- `src/main.tsx` (2555 dòng) — 5/8 tính năng đã được tách thành file riêng (Project/Weekly/Release/
  Luyện đề/MindMap), nhưng Task cá nhân (~1550 dòng) và Cài đặt (PIC/Redmine/Category/Phím tắt, ~565
  dòng) vẫn nằm trực tiếp trong `App()`.

Leader yêu cầu: council lên kế hoạch tách cả FE và DB sao cho hợp lý rồi triển khai code, xong thì
council review, sửa, review cho tới khi ổn định.

## 2. Quyết định thiết kế (Council thật, run `022dd1e5`, 3 vòng — xem `docs/exchanges/2026-09-12.md`)

### 2.1. Tách schema DB

`server/db.ts` tách thành:

- 8 file `server/schema/{tasks,release,project,pic,weekly-report,luyen-de,mindmap,app-settings}.ts` —
  mỗi file export `applyXSchema(db)`, giữ nguyên văn SQL và thứ tự khoá ngoại nội bộ từng tính năng.
  Xác nhận qua đọc code thật: toàn schema chỉ có 2 nhóm khoá ngoại xuyên bảng — nội bộ Project
  (`project_task_assignments → project_tasks`) và nội bộ Luyện đề (chuỗi `de_thi_*`) — không có FK
  xuyên tính năng khác, nên thứ tự gọi giữa các file KHÁC tính năng không bị ràng buộc kỹ thuật.
- Tách PIC ra khỏi khối "Báo cáo tuần" cũ — PIC là khái niệm dùng chung (Project/Task/Weekly đều tham
  chiếu), không phải phụ thuộc riêng của Weekly Report.
- `emergency_release_batches` dời từ vùng migration sang `applyReleaseSchema` — bước CHUẨN HÓA schema
  hiện hành có chủ đích (không phải "giữ nguyên văn"), xác nhận an toàn: không đụng archive automation,
  không seed nào ghi trước điểm tạo cũ.
- `server/db-migrations.ts` (`runLegacyMigrations`, `runVersionedMigrations`) và `server/db-seed.ts`
  (`runSeed`) — tách theo TRỤC LOẠI (không theo tính năng) vì nhiều đoạn có ràng buộc thứ tự tường minh
  ghi trong comment gốc; nhận `db`/`context` qua tham số, không import ngược singleton `db`.
- `db.ts` còn lại: mở `DatabaseSync` + `withTransaction` (hạ tầng dùng chung) + gọi tuần tự 8 schema →
  `runLegacyMigrations` → `runSeed` → `runVersionedMigrations`.

### 2.2. Tách frontend

- `src/screens/settings.tsx` — `ManHinhQuanLyDanhMuc` (vỏ 4 mục con) + `ManHinhQuanLyPic` +
  `ManHinhCauHinhRedmine`, giữ nguyên văn, cả ba tự chủ hoàn toàn.
- `src/screens/luyen-de-category.tsx` — `ManHinhQuanLyCategory` tách RIÊNG (không định nghĩa trong
  `src/luyen-de.tsx`) để không kéo module Luyện đề (đang `React.lazy`) vào dependency graph của tab
  Cài đặt.
- `src/screens/personal-task.tsx` — `ManHinhTaskCaNhan` (bước rủi ro cao nhất, làm sau cùng): chứa toàn
  bộ state/effect/hàm nghiệp vụ Task cá nhân + `CotTask`/`CotDinhKy`/`TaskDinhKy` + 7 popup. LUÔN ĐƯỢC
  MOUNT (khác 5 màn tách trước — vốn unmount hẳn theo tab) để giữ đúng hành vi cũ (state/popup không
  mất khi đổi tab). Giao tiếp với shell qua đúng 2 kênh:
  - Props xuôi: `{ active: boolean; notificationPermission: NotificationPermission }`.
  - Ref-handle: `{ openQuickAdd(): void; openHistory(): void; refresh(date?: string): Promise<void> }`.
- `main.tsx` còn lại 229 dòng (từ 2555 dòng) — app-shell thuần: tab nav, lazy-load các màn, mmGuard/
  pendingTab (MindMap), `notificationPermission` + nút xin quyền (ở shell vì nằm trên thanh nav).

### 2.3. Phụ (gộp cùng đợt vì rủi ro gần 0)

- Tách 4 hàm ngày thuần (`mondayOf`/`addDays`/`toISODate`/`taskOverlapsWeek` + `parseISO`) từ
  `server/lib/weekly-report.ts` sang `server/lib/date.ts` mới (dùng chung) — trước đó
  `server/routes/projects.ts` phải import lib riêng của tính năng Weekly Report dù không liên quan.
- Xoá hàm chết `getRedmineBaseUrl()` (`server/routes/redmine.ts`).

### 2.4. Để riêng (backlog sau, không làm trong CR này)

- Tách `server/lib/mappers.ts` thành 3 file theo tính năng (đang lẫn cả ghi DB/rollup thật, không đơn
  thuần đổi tên file).
- `server/routes/projects.ts` tự tay xoá `weekly_goals` (không chỉ mượn hàm ngày, mà thực thi luôn
  chính sách dọn dữ liệu của tính năng khác) — cần thiết kế ranh giới sở hữu dữ liệu riêng.
- ~40 dòng import không dùng còn sót trong `main.tsx` — xác nhận qua Council review là nợ kỹ thuật có
  TRƯỚC cả 3 commit của CR này (di sản các đợt tách Project/Weekly/Release/Luyện đề/MindMap trước),
  không phải do CR này gây ra.

## 3. Phát hiện thật khi triển khai (khác giả định ban đầu của Council)

Khi tự đọc lại code thật trong lúc viết `personal-task.tsx`, phát hiện: hành vi HIỆN TẠI của
`main.tsx` (TRƯỚC khi tách) đã **KHÔNG forward tham số `date`** cho `taiDuLieu` —
`onTasksCreated={() => taiDuLieu().then(() => {})}` luôn bỏ qua ngày `ManHinhLenLich` truyền, chỉ
refresh theo `ngayDinhKy` đang chọn trên dashboard — khác với giả định ban đầu của Council (vòng 1-2)
rằng ngày được forward đúng. Đây CÓ THỂ là một khiếm khuyết có sẵn (task release tạo cho ngày tương lai
không tự nhảy dashboard tới đúng ngày đó), nhưng vì đây là REFACTOR THUẦN (không đổi hành vi), `refresh`
trong `personal-task.tsx` giữ NGUYÊN Y HỆT cách bỏ qua `date` — không tự sửa, đã ghi rõ trong comment.
Nếu cần sửa, đó là quyết định nghiệp vụ riêng (đổi hành vi thật), cần backlog/CR khác.

Council review (run `fb40d675`) đã tự xác nhận độc lập bằng `git show 7d00f32f^:src/main.tsx` rằng đây
đúng là hành vi lịch sử thật, không phải lời biện hộ được thêm sau.

## 4. Council code-review kết quả (run `fb40d675`, 2 vòng, hội tụ — xem `docs/exchanges/2026-09-12.md`)

Codex + Claude đọc độc lập `git show`/`git diff` của cả 3 commit, đối chiếu với thiết kế đã chốt. Hội tụ
ở vòng 2, **không có phản đối chặn**. Cả hai bên xác nhận:

- Toàn bộ SQL trong 8 file schema khớp verbatim với `server/db.ts` cũ (đối chiếu từng cột/kiểu/
  `CHECK`/`DEFAULT`/`REFERENCES`).
- Thứ tự bootstrap DB đúng thiết kế: 8 schema → `runLegacyMigrations` → `runSeed` →
  `runVersionedMigrations`.
- `archiveAndDropAutomationSchema()` không đổi logic, chỉ đổi cách nhận `dataDir`/`withTransaction` qua
  `context`.
- Toàn bộ 4 màn Cài đặt và toàn bộ state/effect/hàm/JSX của Task cá nhân chuyển đúng, không sót.
- Ref-handle đúng 3 phương thức đã chốt; `active` chỉ gate đúng phần lưới 3 cột (banner tải + popup
  không bị gate, khớp hành vi cũ).
- Phát hiện không chặn duy nhất: ~40 dòng import thừa trong `main.tsx`, xác nhận là nợ kỹ thuật có
  trước CR này (mục 2.4).

## 5. Bằng chứng nghiệm thu

- `npx tsc --noEmit` sạch sau cả 3 checkpoint.
- `npm run test:server` + `npm run test:client`: 179 backend + 57 frontend pass.
- `npm run check`: 10/10 cổng xanh (sau mỗi checkpoint và sau khi đóng gói lại exe).
- Smoke test Playwright thật (không phải mô tả): trên phiên `npm run dev` đang chạy sống (không khởi
  động lại) VÀ trên bản `TaskManager.exe` đã đóng gói lại — xác nhận: 3 cột Task cá nhân hiển thị đúng,
  popup Thêm nhanh/Lịch sử mở đúng qua click UI VÀ qua phím tắt `Ctrl+Q` (xác nhận ref-handle hoạt
  động thật qua đường phím tắt toàn cục), chuyển tab rồi quay lại vẫn còn state (đúng hành vi
  always-mounted), toàn bộ 7 tab tải được không lỗi console, và một vòng tạo/làm mới task thật qua API
  trên 1 instance DB cô lập (APPDATA tạm, không đụng dữ liệu thật của người dùng) xác nhận đúng.

## 6. Trạng thái nhánh

Nhánh `refactor/tach-module-fe-db`, 5 commit (3 checkpoint code + 2 biên bản Council), chưa merge vào
`main`. Sẽ merge fast-forward sau khi báo cáo lại Leader.
