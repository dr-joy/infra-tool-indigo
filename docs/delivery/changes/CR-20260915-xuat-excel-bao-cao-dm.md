# CR-20260915-xuat-excel-bao-cao-dm — Xuất file Excel cho Báo cáo DM

| Trường | Giá trị |
|---|---|
| Loại | ☑ Thêm mới |
| Mức tác động | ☑ Vừa (endpoint mới, dependency mới, không đụng DB/schema) |
| Người đề xuất | Claude (theo yêu cầu user) |
| Ngày | 2026-09-15 |
| Backlog item | `BL-20260915-001` (`Picked`) |
| Trạng thái | ☑ Đã triển khai (chờ user smoke thật + `npm run package`/khởi động lại exe) |
| Spec liên quan | [docs/specs/01-product-requirement-spec.md](../../specs/01-product-requirement-spec.md) · [docs/specs/03-api-business-logic-spec.md](../../specs/03-api-business-logic-spec.md) |

## 1. Bối cảnh & Vấn đề

Cấp trên (DM) yêu cầu báo cáo tuần phải nộp dưới dạng file Excel có layout cố định (project → người phụ
trách → task, chia 2 vùng "tuần trước"/"tuần này"), thay vì text copy-paste như hiện tại. User đã duyệt
layout qua 4 vòng prototype dựng nhanh bằng Excel COM automation (chỉ để xem, không phải code thật) — xem
[exchange 2026-09-15 mục 5](../../exchanges/2026-09-15.md#5-thu-hẹp-phạm-vi-ngay-trong-ngày-chốt-bởi-user).
User đã chốt: **redesign toàn màn hình để sau**, việc làm ngay là thêm nút xuất Excel cho đúng report kind
"Báo cáo DM" hiện có.

**Phát hiện phụ khi đọc code (ghi nhận, không sửa trong CR này):** report kind `vn_management` trong
`reportKinds` registry (hàm `renderVnManagement`/`projectSummarySection`/`memberSection`) thực ra là
**dead code** — FE (`weekly.tsx` hàm `changeKind`) không bao giờ gọi `/weeks/:weekStart/text?kind=vn_management`
cho kind này; luồng "Báo cáo DM" thật trên UI luôn đi qua popup Risk → `POST /weeks/:weekStart/dm-report`
(hàm `renderDmReportText`). Đã thêm `BL-20260915-002` (Tech debt, `Inbox`) để Leader quyết xoá code chết
này ở lần khác — ngoài phạm vi CR này.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Tuần đang có dữ liệu (mục tiêu tuần này hoặc đánh giá tuần trước) → user bấm 1 nút, tải về đúng 1 file
    `.xlsx` đúng layout đã duyệt, mở được bằng Excel, không cần cài gì thêm trên máy user.
  - File tạo được trên môi trường server không có Excel cài sẵn (chuẩn bị cho `BL-20260913-001`).
- **Ngoài phạm vi (không làm lần này):**
  - Màn hình bảng xem trực tiếp trong app (Project→PIC→Task) — để ở `BL-20260915-001` phần còn lại.
  - Gộp/xoá report kind "Nội bộ Dev13" hay "Báo cáo DM" — không đụng.
  - Cột Risk/Biện pháp đối ứng trong file Excel — layout đã duyệt không có cột này; dữ liệu Risk (nếu có
    nhập ở popup) không đưa vào file.
  - Đổi luồng nhập liệu wizard hiện có.
  - Xoá dead code `renderVnManagement` (đã tách sang `BL-20260915-002`).

## 3. Người dùng & Kịch bản

Là **Leader (Dev13)**, tôi muốn bấm 1 nút ở màn Báo cáo tuần (đang xem "Báo cáo DM") để tải file Excel
đúng layout cấp trên yêu cầu, để nộp báo cáo tuần mà không phải tự tay dựng bảng trong Excel mỗi tuần.

## 4. Yêu cầu chức năng

- **FR-1:** Khi report kind đang chọn là "Báo cáo DM" (`kind === 'vn_management'`), hiển thị nút **"Tải
  Excel"** ở khu điều khiển trên cùng của màn Báo cáo tuần (cạnh nút "Tạo báo cáo").
- **FR-2:** Bấm nút gọi `GET /api/weeks/:weekStart/dm-report.xlsx`, tải file tên
  `bao-cao-dm-tuan-<weekStart>.xlsx` (vd `bao-cao-dm-tuan-2026-09-14.xlsx`).
- **FR-3:** Nội dung file dựng từ `buildWeekData(weekStart)` — không phụ thuộc dữ liệu Risk (popup Risk
  không liên quan tới file này):
  - Nhóm theo `Project` (từ `WeekData.groups`, giữ thứ tự có sẵn) → `PIC` (tách theo dấu phẩy trong
    `assignee`, nhân dòng cho task nhiều người) → `Task`.
  - 2 vùng cột: **Tiến độ đến hết tuần trước** (từ `grp.lastWeekGoals`) + **Status** + **Note**, và
    **Mục tiêu tuần này** (từ `grp.goals`) + **Note**.
  - Số dòng của 1 PIC trong 1 project = `max(số task tuần trước, số task tuần này)` của người đó; dòng
    lệch (1 bên có mục, bên kia không) thì bên thiếu ghi `"-"` (không merge, không tô màu nền).
- **FR-4:** Cột **Status** suy từ `GoalView.status` của từng mục trong `lastWeekGoals`: `dat`/`vuot` →
  `"Hoàn thành"` (nền xanh lá nhạt `#C6EFCE`, chữ xanh đậm `#006100`); `khong_dat` → `"Không hoàn thành"`
  (nền đỏ nhạt `#FFC7CE`, chữ đỏ đậm `#9C0006`). Dòng không có task tuần trước (padding `"-"`) → Status
  cũng `"-"`, không tô màu.
- **FR-5:** Cột **Note** cạnh Status chỉ có nội dung khi Status = "Không hoàn thành" (lấy `GoalView.note`);
  các trường hợp khác để trống (không ghi `"-"`, không ghi gì).
- **FR-6:** Cột **Note** cạnh "Mục tiêu tuần này": lấy `GoalView.text`/ghi chú mục tiêu nếu server có sẵn
  field tương ứng; hiện tại `GoalView` cho tuần này không có field note riêng ngoài `text` → để trống mặc
  định (không có nguồn dữ liệu, không tự chế).
- **FR-7:** Merge cell dọc cho cột Project và PIC theo đúng nhóm (rowspan thật). Không merge cột nội dung.
- **FR-8:** Trình bày: dòng tiêu đề (merge hết bề ngang, nền navy đậm `#1F3A5B` chữ trắng, nội dung
  `"BÁO CÁO TUẦN <dd/mm> – <dd/mm/yyyy>  ·  Tuần trước: <dd/mm> – <dd/mm>"`), dòng header (nền navy vừa
  `#21388C` chữ trắng, AutoFilter), freeze pane dưới header, mọi dòng dữ liệu cao bằng nhau (auto-fit 1
  lần lấy max rồi áp dụng đều), nền còn lại toàn bộ màu trắng (không dải xen kẽ), viền mảnh xám toàn bảng.
- **FR-9 (điều chỉnh khi code — xem ghi chú):** Nút "Tải Excel" luôn bấm được khi đang ở kind DM (không
  disable theo `weekGoals.length`) — vì FE không có sẵn số liệu `lastWeekGoals` (thứ quyết định "tuần có
  gì để xuất" thật sự) mà không gọi thêm 1 API riêng chỉ để biết disable hay không. Thay vào đó: bấm nút
  luôn gọi endpoint; nếu server trả `404` (tuần rỗng thật) thì hiện đúng message đó qua banner lỗi có sẵn
  của màn hình. Đơn giản hơn, không cần đồng bộ 2 nguồn sự thật (điều kiện disable ở FE vs điều kiện 404 ở
  BE) — chấp nhận đánh đổi 1 cú bấm thừa trong trường hợp hiếm (tuần hoàn toàn rỗng) để đổi lấy code đơn
  giản, không lệch logic giữa 2 tầng.

## 5. Yêu cầu phi chức năng

- Không phụ thuộc Excel cài trên máy chạy server (dùng thư viện `exceljs`, build buffer thuần Node).
- File tạo trong bộ nhớ (không ghi ra đĩa server), trả thẳng qua response — không để lại rác tạm.
- Không thêm quyền/scope bảo mật mới (app hiện chưa có auth, endpoint mới cùng mức lộ diện với mọi
  endpoint `/weeks/*` khác — không phải phần mở rộng bề mặt tấn công có ý nghĩa riêng).

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI

- Màn Báo cáo tuần (`src/screens/weekly.tsx`), khu điều khiển trên cùng, ngay sau nút "Tạo báo cáo": thêm
  nút `"Tải Excel"` (icon `Download` từ `lucide-react`). Chỉ render khi `isDM && !viewingHistory`.
- Bấm nút: `fetch('/api/weeks/:weekStart/dm-report.xlsx')` (relative path, cùng origin với server —
  giống toàn bộ `api()` call khác trong app, không cần base URL riêng). Response `ok` → `res.blob()` →
  tạo `<a>` ẩn với `URL.createObjectURL(blob)` + `a.download = "bao-cao-dm-tuan-<weekStart>.xlsx"` → click
  → `URL.revokeObjectURL`. Response lỗi (404/400) → đọc `message` từ body JSON, hiện qua `setError()` có
  sẵn của màn hình (banner lỗi đã tồn tại, không tạo UI lỗi riêng).
- Trạng thái: nút disable tạm trong lúc đang tải (`dangXuatExcel`), tránh bấm trùng — xem FR-9 (đã bỏ ý
  định disable theo "tuần có dữ liệu hay không" vì lý do nêu ở FR-9).

### 6.2. API & nghiệp vụ

- **`GET /api/weeks/:weekStart/dm-report.xlsx`**
  - Validate `weekStart` bằng `normWeek()` có sẵn (400 nếu sai).
  - Gọi `buildWeekData(weekStart)`.
  - Nếu **không có gì để xuất** (mọi `group.goals.length === 0` và mọi `group.lastWeekGoals.length === 0`)
    → `404` kèm message rõ ràng (`"Tuần này chưa có dữ liệu để xuất báo cáo"`) — FE hiện lỗi qua toast/error
    banner có sẵn.
  - Dựng workbook bằng `exceljs` (hàm mới `buildDmReportWorkbook(data: WeekData): ExcelJS.Workbook` trong
    `server/lib/weekly-report-excel.ts` — file MỚI, tách khỏi `weekly-report.ts` để không phình file có
    sẵn, theo đúng tinh thần `BL-20260912-002` vừa tách module).
  - Set header: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
    `Content-Disposition: attachment; filename="bao-cao-dm-tuan-<weekStart>.xlsx"`, ghi buffer qua
    `workbook.xlsx.write(res)` (exceljs hỗ trợ stream thẳng ra `http.ServerResponse`).
  - Không nhận body — không có tham số Risk.

### 6.3. Dữ liệu & schema

- Không đổi DB/schema. Chỉ đọc qua `buildWeekData()` đã có sẵn.

### 6.4. Automation / tích hợp

- Không đụng (tính năng AI automation đã bị xoá theo CR-20260912).

## 7. Phân tích tác động

- [x] Frontend (`weekly.tsx` — thêm 1 nút) · [x] API route (1 endpoint mới `server/routes/weekly.ts`)
  · [ ] DB/migration · [ ] Automation/MCP
- [ ] i18n (chuỗi mới — nhãn nút tiếng Việt duy nhất, cân nhắc thêm vào `i18n.ts` nếu app có đa ngôn ngữ
  cho màn này; kiểm tra trước khi code) · [x] Đóng gói SEA (cần `npm run package` sau khi xong, theo
  `L-009`) · [x] Bảo mật (xem `security-gate` bên dưới) · [ ] Dữ liệu cũ/backward-compat (không đụng dữ
  liệu cũ)
- **Rủi ro & giảm thiểu:**
  - Thêm dependency mới (`exceljs`, pure JS, không cần binding native) → kiểm tra bundle/budget server
    không bị ảnh hưởng (server không bundle qua Vite, chỉ FE mới tính budget — xác nhận lại ở bước code).
    `npm install exceljs` kéo theo 92 package con; `npm audit` sau khi cài chỉ tăng thêm đúng 1 vuln THẬT
    do thay đổi này (`uuid` moderate — "Missing buffer bounds check khi truyền `buf`"), toàn bộ vuln khác
    trong báo cáo audit đã tồn tại từ trước (kiểm bằng `git diff package-lock.json`, không phải do lần cài
    này). Rủi ro thực tế thấp: exceljs chỉ dùng `uuid` để sinh ID nội bộ, code CR này không truyền `buf` từ
    input người dùng vào bất kỳ hàm `uuid` nào — chấp nhận, không chặn.
  - Layout phức tạp (merge + màu + auto-fit chiều cao) dễ lệch giữa dev và thực tế mở bằng Excel/LibreOffice
    → test bằng cách đọc lại file vừa tạo qua `exceljs` (parse ngược, so merge/màu/text) thay vì chỉ nhìn
    bằng mắt.
  - `assignee` nhiều người phân tách bằng dấu phẩy nhưng có thể lẫn khoảng trắng/dấu phẩy thừa → tái dùng
    logic `trim().filter(Boolean)` giống `splitAssignees` ở FE (`src/lib/task-utils.ts`), viết bản nhỏ
    riêng cho server (không import ngang từ `src/` sang `server/`).
- **Ảnh hưởng chức năng đang chạy:** Không — thuần thêm mới, không sửa route/hàm cũ.

### Security-gate (endpoint mới + serve file)

- Input duy nhất là `weekStart` (path param) → validate bằng `normWeek()` có sẵn, reject sớm nếu sai định
  dạng, không dùng trực tiếp vào truy vấn động không tham số hoá (toàn bộ query đã dùng prepared statement
  có sẵn trong `buildWeekData`).
- `weekStart` sau khi validate mới được đưa vào `Content-Disposition` filename → không có ký tự lạ (đã ép
  định dạng `YYYY-MM-DD` bởi `normWeek()`), không có rủi ro header injection.
- File dựng hoàn toàn trong RAM (`exceljs` buffer/stream), không ghi tạm ra đĩa server → không có rủi ro
  path traversal hay rác file tồn đọng.
- Không đọc/ghi thêm bảng nào ngoài những gì `buildWeekData()` đã đọc (read-only, không có ghi mới).
- App hiện chưa có auth (toàn bộ `/api/weeks/*` đều mở) — endpoint này không làm xấu thêm bề mặt tấn công
  so với hiện trạng; vấn đề auth tổng thể thuộc phạm vi `BL-20260913-001`, không phải CR này.

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1):** Given đang ở màn Báo cáo tuần, kind = "Báo cáo DM", không đang xem History / When xem
  màn hình / Then thấy nút "Tải Excel" hiển thị và bấm được (không phụ thuộc có dữ liệu hay không).
- **AC-2 (FR-9):** Given tuần hoàn toàn không có mục tiêu tuần này lẫn đánh giá tuần trước / When bấm "Tải
  Excel" / Then KHÔNG tải file nào, banner lỗi hiện đúng message "Tuần này chưa có dữ liệu để xuất báo
  cáo" (từ response 404 của server).
- **AC-3 (FR-2):** Given điều kiện AC-1 / When bấm "Tải Excel" / Then trình duyệt tải về đúng 1 file tên
  `bao-cao-dm-tuan-<weekStart>.xlsx`.
- **AC-4 (FR-3, FR-7):** Given tuần có project A với 2 người (X có 2 task tuần trước + 1 task tuần này, Y
  có 0 task tuần trước + 1 task tuần này) / When mở file / Then cột Project merge đúng hết các dòng của A,
  cột PIC merge đúng 2 dòng của X và 1 dòng của Y; ô "tuần trước" của Y = `"-"` căn giữa 2 chiều, không
  merge, nền trắng.
- **AC-5 (FR-4, FR-5):** Given 1 task tuần trước status `khong_dat` có `note` = "Bận việc khác" / When mở
  file / Then Status = "Không hoàn thành" (nền đỏ nhạt), Note cạnh đó = "Bận việc khác"; 1 task khác status
  `dat` / Then Status = "Hoàn thành" (nền xanh lá nhạt), Note cạnh đó rỗng.
- **AC-6 (FR-3):** Given 1 task tuần này giao cho "A, B" / When mở file / Then task đó xuất hiện ở CẢ 2
  dòng của A và B (nhân dòng).
- **AC-7 (FR-8):** Given file đã tạo / When kiểm tra bằng `exceljs` (đọc ngược) / Then dòng 1 merge hết 7
  cột có text tiêu đề đúng tuần, dòng 2 là header 7 cột đúng thứ tự, mọi dòng dữ liệu có `row.height` bằng
  nhau, ô có `-` có `alignment.horizontal/vertical = center`.
- **AC-8 (an toàn):** Given `weekStart` sai định dạng (vd `abc`) / When gọi endpoint / Then `400`, không
  crash server. Given tuần hợp lệ nhưng rỗng dữ liệu / When gọi endpoint trực tiếp (bỏ qua FE disable) /
  Then `404` với message rõ ràng, không trả file rỗng.

## 9. Kế hoạch test

- Tầng test: ☑ Unit (hàm dựng dữ liệu nhóm Project→PIC→Task + hàm dựng workbook) ☑ Integration route
  (`test/integration/weekly.test.ts` hoặc file mới `weekly-dm-report-excel.test.ts`) ☐ Render component
  (cân nhắc thêm nếu thời gian cho phép — tối thiểu 1 test xác nhận nút chỉ hiện khi `isDM`) ☐ Smoke thủ
  công (user tự mở file bằng Excel thật sau khi merge, KHÔNG coi là thay thế test tự động).
- Ca chính: đủ dữ liệu 2 vùng, merge đúng, màu Status đúng, nhân dòng multi-assignee, tên file đúng.
- Ca biên: project không có PIC nào cả 2 vùng (không nên xảy ra do query gốc, nhưng test phòng thủ);
  1 project chỉ có tuần trước không có tuần này (và ngược lại); `weekStart` sai định dạng; tuần rỗng hoàn
  toàn (404); assignee rỗng chuỗi (dùng nhãn "(chưa gán)" nhất quán với các chỗ khác nếu có tiền lệ — kiểm
  tra lại trước khi code, không tự chế nhãn mới nếu đã có sẵn convention).

## 10. Kế hoạch triển khai / rollback

- Bước triển khai: thêm dependency → viết `weekly-report-excel.ts` (unit test trước theo tinh thần
  qa-standard) → thêm route → thêm nút FE → `npm run check` → `npm run package` → khởi động lại
  `TaskManager.exe` → user smoke thật 1 lần trên dữ liệu tuần hiện tại.
- Rollback nếu hỏng: xoá route mới + nút FE + gỡ dependency (thuần thêm mới, không đụng code cũ nên revert
  an toàn, không cần migration ngược).

## 11. Docs cần cập nhật sau khi làm xong

- [x] docs/01 (product requirement — thêm dòng FR-3.3 mô tả nút xuất Excel) · [x] docs/03 (API spec — thêm
  dòng endpoint mới) · [ ] docs/04 (không đổi DB — bỏ qua, đúng như dự kiến) · [ ] rules 06–09 (đã tự áp
  checklist `security-gate` inline trong §6/§7 của CR này, không phát sinh rule chung mới cần ghi)

## Kết quả triển khai (2026-09-15)

- Code: `server/lib/weekly-report-excel.ts` (mới), route `GET /api/weeks/:weekStart/dm-report.xlsx`
  (`server/routes/weekly.ts`), nút "Tải Excel" (`src/screens/weekly.tsx`), export thêm `ddmm`/`slashDate`
  từ `weekly-report.ts` (đổi `function` → `export function`, không đổi hành vi).
  Dependency mới: `exceljs@^4.4.0`.
- Test: 7 unit (`test/unit/weekly-report-excel.test.ts`) + 3 integration
  (`test/integration/weekly-dm-report-excel.test.ts`) — **PASS**. `npm run check`: 245 test backend +
  40 test frontend PASS, tsc sạch, build/budget bundle OK (386.9kB/508kB), link/docs/giờ VN/error-code/
  release-sync đều xanh.
- **1 cổng đỏ SẴN CÓ TRƯỚC CR NÀY, không liên quan** (`design-token` — 3 hardcode gradient ở
  `src/styles.css:1534,1551,1618`, đã log `BL-20260914-002` từ trước, xác nhận qua `git diff` không đụng
  file này trong CR này) — không phải điều kiện chặn CR này.
- **Còn lại trước khi coi là ĐÃ GIAO tới tay user (bài học `L-009`):** `npm run package` + khởi động lại
  `TaskManager.exe`, rồi user tự smoke 1 lần trên dữ liệu tuần thật (bấm "Tải Excel" ở kind Báo cáo DM).
- **Chưa commit git** — working tree hiện có thêm 1 khối thay đổi KHÔNG THUỘC CR này đang dang dở
  (xoá `announcement-group-settings`/`announcement-mention-settings`, sửa `release.tsx`/`schedules.ts` —
  khớp việc "đã code xong, chưa package" ghi ở `BL-20260914-00x`/item hoàn thành gần nhất). Không tự ý
  `git add -A`/commit gộp cả 2 để tránh trộn lẫn 2 thay đổi không liên quan trong 1 commit — chờ user xác
  nhận cách tách commit trước khi ghi vào git.

## Vòng review độc lập (2026-09-15, Codex qua `codex review`)

Theo yêu cầu user "council review" — gọi thật Codex CLI (không phải Claude tự chấm bài mình, đúng
`R-CRIT-04` tinh thần) review đúng phạm vi 8 file của CR này, đối chiếu từng FR/AC. Kết quả 3 phát hiện:

1. **[Đã sửa]** FR-8 yêu cầu viền mảnh xám cho TOÀN BẢNG, nhưng code gốc chỉ áp border cho vùng dữ liệu
   (`DATA_START_ROW..lastRow`), thiếu ở dòng tiêu đề (dòng 1) và dòng header (dòng 2) —
   `server/lib/weekly-report-excel.ts`. Sửa: tách hằng `THIN_BORDER` dùng chung, áp cho cả 2 dòng đó.
   Thêm 2 assertion mới vào `test/integration/weekly-dm-report-excel.test.ts` khoá lại hành vi (test đỏ
   trước khi sửa, xanh sau khi sửa — đã tự kiểm chạy lại).
2. **[Ghi nhận, không sửa — ngoài phạm vi CR này]** `normWeek()`/`mondayOf()` (dùng chung mọi route
   `/api/weeks/:weekStart/*`, không riêng Excel) không validate ngày lịch thật (`2026-02-30` bị "lăn"
   thành ngày khác thay vì 400). Đây là hàm CHUNG, sửa sẽ đổi hành vi nhiều endpoint — đã tách thành
   `BL-20260915-003` (Bug candidate) để Leader quyết riêng, không tự mở rộng phạm vi CR này.
3. **[Ghi nhận]** Test tích hợp trước đó chưa assert đủ layout (merge range, freeze pane, border) — đã bổ
   sung 1 phần (border title/header) khi sửa mục 1; phần còn lại (merge range, freeze pane) chưa bổ sung,
   không chặn vì không phát hiện lỗi thật ở các phần đó qua đọc code + kiểm bằng mắt kết quả file test tạo
   ra.

Sau khi sửa: `npx tsc --noEmit` sạch, 10/10 test Excel (7 unit + 3 integration) PASS. Đã chạy lại
`npm run check` toàn bộ — chỉ còn đúng 1 cổng đỏ (`design-token`, đã xác nhận KHÔNG liên quan CR này —
3 hardcode ở `src/styles.css` dòng 1534/1551/1618, file này không nằm trong diff của CR-20260915, đã log
từ trước ở `BL-20260914-002`). Cảnh báo "exe khớp code" và "file chưa git add" là cảnh báo dự kiến (chưa
package lại, chưa commit — đúng như mục "Còn lại" phía trên).

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-09-15 | |
| Người triển khai | Claude | 2026-09-15 | |
| Reviewer độc lập | Codex (qua `codex review`) | 2026-09-15 | 1 finding chặn đã sửa, 1 finding tách backlog riêng, 1 finding ghi nhận |
| QA nghiệm thu | User | | (chờ smoke thật sau khi package) |
