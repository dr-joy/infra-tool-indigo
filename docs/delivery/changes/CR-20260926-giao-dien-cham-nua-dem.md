# CR-20260926-giao-dien-cham-nua-dem — Đổi toàn bộ giao diện sang "Chàm Nửa Đêm"

| Trường | Giá trị |
|---|---|
| Loại | ⬜ Thêm mới ☑ Sửa hành vi ⬜ Xóa/Deprecate |
| Mức tác động | ☑ Lớn (đụng nhiều màn, đổi shell điều hướng, đổi bộ token thiết kế) |
| Người đề xuất | Council (Claude, run `4dcf3735-a1aa-4cfa-9fd6-f180c5ed4c26`) + Leader chốt |
| Ngày | 2026-09-26 |
| Backlog item | `BL-20260926-004` (Picked) |
| Trạng thái | ☑ Draft ⬜ Đã review ⬜ Đã duyệt ⬜ Đã triển khai ⬜ Đã nghiệm thu |
| Spec liên quan | `docs/standards/design-standard.md` (bộ token) |

## 1. Bối cảnh & Vấn đề

Leader thấy layout hiện tại (nav ngang, mật độ thông tin không đều, không phân biệt rõ vai trò) khó
dùng. Qua 2 phiên Council + 1 prototype Artifact tĩnh (HTML/CSS/JS, không phải code repo — link:
`https://claude.ai/code/artifact/7e12a424-42bd-4e40-ae47-2eb4b9b95685`), Leader đã duyệt một layout
mới (sidebar dọc thay menu-tab ngang, tiêu đề màn động ở topbar, bỏ khối "summary" thừa) và một bảng
màu tối "Chàm Nửa Đêm" (nền/surface #12131f·#1b1d2e·#20223a, chữ #e7e8f2, accent cyan #5ad1c9 + hồng
tím phụ #d68bd0, font Space Grotesk/IBM Plex Sans, bo góc 10/8/5px). Đây là giao diện tối ĐẦU TIÊN và
DUY NHẤT của app — hiện tại không có bất kỳ chế độ tối nào.

Việc này đổi shell điều hướng dùng chung cho toàn app và đổi bộ token thiết kế nền tảng
(`src/styles.css`, gate bởi `scripts/check-design-tokens.mjs`) — chắc chắn khiến người dùng phải học
lại cách dùng ⇒ **Đường C (full flow)** theo `AGENTS.md`.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Toàn bộ 9 màn (`Tasks/Projects/Reports/Releases/MindMap/Settings/Team/Admin` + shell) hiển thị
    đúng bảng màu "Chàm Nửa Đêm", không còn màn nào giữ nền/chữ sáng cũ (trừ các trạng thái chưa kịp
    thiết kế trong prototype — xem mục "Ngoài phạm vi").
  - Nav chuyển từ menu-tab ngang sang sidebar dọc; tiêu đề màn hiện động ở topbar theo tab đang chọn.
  - Toàn bộ hành vi/quyền/luồng hiện có (URL `?tab=`, ẩn tab theo quyền Admin + feature-visibility
    theo team, chặn rời MindMap khi chưa lưu, phím tắt, 2 Gantt riêng, wizard 4 bước 1 popup, kanban
    3 cột không đều + timeline giờ, PopupYeuCauMoKhoa gộp unlock/cancel) **giữ nguyên không đổi**.
  - `npm run check` xanh với baseline token mới.
- **Ngoài phạm vi (không làm lần này):**
  - KHÔNG thêm hiển thị vai trò (badge Leader/Member/Điều phối viên) mới ở tầng UI — Leader xác nhận
    26/09: "không cần cái chỗ hiển thị vai trò làm gì cả, user không cần biết". Giữ nguyên 2 điểm
    phân nhánh hiển thị theo quyền đã có (ẩn tab Admin, nhánh Leader/điều phối viên trong
    `release-calendar.tsx`), không mở rộng thêm.
  - KHÔNG giữ giao diện sáng song song / không có nút chuyển theme — Leader xác nhận: "cái này là
    vĩnh viễn".
  - KHÔNG tự dựng test ảnh/regression thị giác tự động (Playwright/Cypress) — ngoài phạm vi CR này.
  - KHÔNG rollout từng phần lên production — Leader xác nhận: "gom hết vào rồi mới đẩy" (xem mục 10).

## 3. Người dùng & Kịch bản

- Là **thành viên bất kỳ team nào** (Member/Leader), tôi muốn giao diện gọn, tối, dễ quét thông tin
  để dùng hằng ngày thoải mái hơn giao diện sáng cũ.
- Là **Admin**, tôi muốn mọi màn quản trị vẫn giữ đúng cấu trúc bảng/toggle hiện có, chỉ đổi màu/bố
  cục, không đổi hành vi.

## 4. Yêu cầu chức năng

- **FR-1:** Mở rộng bộ token trong `src/styles.css` để đủ khái niệm bảng màu tối: accent phụ, surface
  phụ, chữ mờ phụ, chữ-trên-nền-accent, token bo góc, token shadow — đặt giá trị theo "Chàm Nửa Đêm".
- **FR-2:** Cập nhật `tailwind.config.js` ánh xạ token mới; rà lại 12 ánh xạ cũ có còn đúng ý đồ màu
  tối không.
- **FR-3:** Đổi `src/main.tsx` từ nav ngang (`.menu-tabs`) sang sidebar dọc; đưa tiêu đề màn lên
  topbar dùng chung, đổi động theo tab đang chọn — không đổi logic lọc tab/URL/phím tắt/cảnh báo rời
  MindMap hiện có.
- **FR-4:** Sửa từng file trong 9 `src/screens/*` (+ file dùng chung `ui.tsx`, `context.tsx`,
  `auth-shell.tsx`, `team-switcher.tsx`, `auth-errors.tsx`, `shortcuts.tsx`) để dùng token mới thay
  utility Tailwind mặc định hardcode (`bg-white`, `text-slate-*`, `border-gray-*`...), theo thứ tự
  Pha 3 ở mục 6.1.
- **FR-5:** Bỏ các khối "summary"/stat-row thừa đang hiện trên các màn (theo đúng prototype).
- **FR-6:** Thay text giải thích/ghi chú rải rác (lý do 1 nút bị ẩn/mờ, giới hạn của 1 tính năng, phạm
  vi quyền...) bằng 1 icon "?" tròn nhỏ (`.help-icon`) hiện tooltip khi hover/focus. Tooltip dùng 1
  phần tử dùng chung, `position:fixed` + tự tính lại chỗ đặt (lật trên/dưới, kẹp trái/phải theo mép
  màn hình) để không bị cắt bởi vùng cuộn hay bị modal/phần tử khác che — xem cách làm mẫu ở
  prototype (khối CSS `.help-icon`/`.help-tip` + JS tính vị trí cuối file). **Ngoại lệ không đổi:**
  cảnh báo về hậu quả tức thời/không thể hoàn tác của 1 hành động sắp làm (ví dụ "Sau khi lưu, tiến
  độ nhiều task sẽ bị ghi đè... không thể hoàn tác" trong wizard Báo cáo tuần) vẫn giữ hiển thị ngay
  trên màn, KHÔNG được giấu vào tooltip vì người dùng dễ bỏ sót.
- **FR-7:** Ô chọn (dropdown) nào tự vẽ bằng div/JS (không phải `<select>` gốc trình duyệt) thì phần
  danh sách sổ ra PHẢI bo góc khớp với ô chọn đóng. Với 36 chỗ đang dùng `<select>` gốc trình duyệt
  (10 file, xem mục 7 "Chỗ không thể giống 100%" bên dưới): **Leader xác nhận 26/09 chấp nhận giữ
  nguyên `<select>` gốc**, không tự dựng lại thành component riêng — phần danh sách sổ ra của các ô
  này sẽ theo đúng kiểu mặc định của từng trình duyệt, không bo góc khớp được, đây là giới hạn đã biết
  trước và được chấp nhận, không phải thiếu sót.

## 5. Yêu cầu phi chức năng

- Tương phản chữ/nền phải đọc được (rà tay, không có công cụ đo tự động trong repo).
- Không đổi hợp đồng API/DB — đây thuần là thay đổi tầng hiển thị.
- Không đổi cấu trúc nghiệp vụ đã liệt kê ở mục "Ngoài phạm vi"/mục 2.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI

Triển khai theo pha, **gom hết vào 1 nhánh, chỉ release 1 lần khi cả 4 pha xong** (Leader chốt
26/09 — không đẩy production giữa chừng để tránh trạng thái "nửa tối nửa sáng"):

| Pha | Việc làm | File/khu vực | Điều kiện xong |
|---|---|---|---|
| 0 | CR này + backlog Picked | `docs/delivery/changes/`, `docs/backlog/README.md` | Leader duyệt CR |
| 1 | Mở rộng token + `tailwind.config.js` + cập nhật baseline | `src/styles.css`, `tailwind.config.js`, `scripts/gen-design-tokens-baseline.mjs` | `npm run check` xanh — **lưu ý: giao diện thật CHƯA đổi nhìn thấy được sau pha này** (chỉ ~12/1287 chỗ dùng token) |
| 2 | Sidebar dọc + topbar tiêu đề động | `src/main.tsx` + 9 screen expose tiêu đề | URL `?tab=`, ẩn tab Admin, feature-visibility theo team, cảnh báo rời MindMap, phím tắt — test lại thủ công không vỡ |
| 3 | Sửa từng file theo token, **thứ tự dễ → khó** (Leader chốt 26/09): file dùng chung trước, rồi Settings(41) → Team(71) → Release lịch chung/`release-calendar.tsx`(108) → Admin(146) → Project(200) → Weekly(211, có wizard) → Task cá nhân(223) → Release đăng ký/`release.tsx`(231, 2 Gantt + PopupYeuCauMoKhoa, khó nhất, làm cuối) | toàn bộ `src/screens/*`, `src/*.tsx` | Mỗi file: test client cũ pass + rà tương phản/hover/disabled/rỗng bằng tay, không làm phẳng cấu trúc nghiệp vụ |

**Đã cắt Pha 4 (hiển thị vai trò mới)** — Leader xác nhận không cần.

**4 chỗ chắc chắn không giống 100% prototype (đã xác nhận, xử lý như sau, không im lặng bỏ qua):**

1. Bo góc 10/8/5px không khớp thang Tailwind mặc định → thêm `borderRadius` riêng vào
   `tailwind.config.js` theo token mới (không làm tròn về thang có sẵn).
2. Prototype không dựng sẵn trạng thái hover/disabled thật/lỗi validate/rỗng/chữ tràn dòng → rà tay
   trên từng component thật ở Pha 3, coi là hạng mục QA riêng của từng file, không suy ra được từ
   "đã khớp prototype".
3. Prototype không có React mount/unmount cho popup → khi code thật, kiểm animation mở/đóng có giữ
   được không nếu React unmount hẳn component so với chỉ toggle class; chọn cách gần ý đồ hơn, không
   rập khuôn cách prototype làm.
4. Sidebar thật phải co giãn theo danh sách tab ngắn hơn 8 mục (ẩn theo quyền/feature-visibility),
   không giả định luôn đủ 8 mục như prototype tĩnh.
5. Danh sách sổ ra của 36 chỗ `<select>` gốc trình duyệt (10 file) không bo góc khớp được với ô chọn
   đóng — Leader đã xác nhận chấp nhận (26/09, xem FR-7), không dựng lại thành component riêng.

### 6.2. API & nghiệp vụ

Không đổi endpoint/hợp đồng nào.

### 6.3. Dữ liệu & schema

Không đổi.

### 6.4. Automation / tích hợp

Không đụng.

## 7. Phân tích tác động

- [x] Frontend (màn/component) · [ ] API route · [ ] DB/migration · [ ] Automation/MCP
- [ ] i18n (chuỗi mới) · [ ] Đóng gói SEA/MCP · [ ] Bảo mật · [ ] Dữ liệu cũ/backward-compat
- **Rủi ro & giảm thiểu:** `main.tsx` là vùng rủi ro cao nhất (mọi màn đi qua shell) — làm Pha 2 sớm
  để lộ vướng mắc sớm, test thủ công đủ 5 luồng đã liệt kê ở bảng Pha 2 trước khi coi là xong. Đổi
  token nền tối lan toả toàn cục nhưng phần lớn màu hardcode nằm ngoài vùng token — nếu chỉ đổi token
  mà không sửa Pha 3 thì app sẽ ở trạng thái pha trộn sáng/tối; do đó Pha 1 xong không được coi là
  "đã đổi giao diện", chỉ Pha 3 xong đủ 9 màn mới coi UI hoàn tất.
- **Ảnh hưởng chức năng đang chạy:** không đổi hành vi nghiệp vụ, chỉ đổi tầng hiển thị — vẫn phải
  test lại đủ vì đây là thay đổi diện rộng, rủi ro cao nằm ở lỗi vô ý khi sửa tay hàng trăm chỗ chứ
  không phải ở bản chất thay đổi.

## 8. Tiêu chí nghiệm thu

- **AC-1 (FR-1, FR-2):** Given token mới đã khai báo, When chạy `node scripts/gen-design-tokens-baseline.mjs` rồi `npm run check`, Then cổng token pass với baseline mới.
- **AC-2 (FR-3):** Given app đã build xong Pha 2, When thao tác đủ 5 luồng (URL tab, ẩn tab Admin, feature-visibility, cảnh báo rời MindMap, phím tắt), Then không luồng nào vỡ so với hành vi cũ.
- **AC-3 (FR-4):** Given 1 file trong Pha 3 đã sửa xong, When chạy test client của file đó + rà tay tương phản/hover/disabled/rỗng, Then pass và không còn `bg-white`/`text-slate-*`/`border-gray-*` hardcode sót lại trong file đó.
- **AC-4 (FR-5):** Given màn đã có summary/stat-row cũ, When mở màn đó sau khi sửa, Then không còn khối summary thừa, khớp prototype.
- **AC-5 (mục 2):** Given toàn bộ 4 pha đã xong, When Leader tự dùng thử cả 9 màn, Then không thấy màn nào còn giao diện sáng cũ và cấu trúc nghiệp vụ (cây task, kanban+timeline, wizard, 2 Gantt, PopupYeuCauMoKhoa) không bị làm phẳng.
- **AC-6 (FR-6):** Given 1 chỗ trước đây là text giải thích/ghi chú (không phải cảnh báo hậu quả tức thời), When xem lại UI, Then đã thay bằng icon "?" hiện tooltip đúng nội dung khi hover/focus, và tooltip không bị cắt/che khi icon nằm gần mép màn hình hoặc trong vùng cuộn.
- **AC-7 (FR-7):** Given 1 popup/menu tự vẽ bằng div/JS (không phải `<select>` gốc), When mở popup đó, Then phần danh sách sổ ra bo góc khớp với phần tử kích hoạt nó.

## 9. Kế hoạch test

- Tầng test dự kiến: ☑ Unit (không đổi) ☑ Integration route (không đổi) ☑ Render component (test client hiện có phải pass) ☑ Smoke thủ công (bắt buộc, vì không có test tương phản/thị giác tự động)
- Ca test chính: 12 file test client hiện có phải pass nguyên trạng sau mỗi file Pha 3.
- Ca lỗi/biên cần rà tay riêng (không có test tự động phủ): tương phản chữ/nền, trạng thái hover/focus/disabled, thông báo lỗi validate, empty-state, chữ tràn dòng dài, 3 breakpoint đã có (1024px/900px/760px).

## 10. Kế hoạch triển khai / rollback

- Bước triển khai: làm trên **1 nhánh riêng dài** (`feature/style-cham-nua-dem`), đi hết Pha 1→2→3,
  **KHÔNG merge/push từng pha lên `master`** — chỉ merge 1 lần khi cả 4 pha xong và Leader đã tự
  dùng thử đủ 9 màn (Leader chốt 26/09: "gom hết vào rồi mới đẩy").
- Rollback nếu hỏng: nhánh riêng chưa merge thì huỷ nhánh là xong, không ảnh hưởng `master`/production.
  Nếu đã merge mà phát hiện lỗi nghiêm trọng: revert commit merge, không sửa vá tại chỗ trên `master`.

### Tiến độ (cập nhật theo từng lát, không sửa lại các dòng cũ)

- **Pha 1 XONG (commit `bd8ccdd3` + fix `cabc345f`, nhánh `feature/style-cham-nua-dem`).** Đổi 12
  token gốc sang bảng "Chàm Nửa Đêm" + thêm token mới (surface-2, muted-2, secondary+soft,
  on-primary, on-secondary, radius-sm/md/lg, shadow-sm/md) trong `src/styles.css` + ánh xạ
  `tailwind.config.js` (tên không trùng thang mặc định Tailwind, xem lý do trong code). **Qua 1 vòng
  Council review thật (Claude+Codex, run `59bf8aee`, Codex 2 lượt `invalid_turn_output` — Claude tự
  tổng hợp) tìm ra và đã SỬA:** `color-scheme: dark` thêm quá sớm khiến control gốc (input/select)
  đổi màu chữ theo dark trong khi nền vẫn `bg-white` chưa migrate — chữ trắng trên nền trắng, không
  đọc được. Đã bỏ dòng này, sẽ thêm lại ở cuối Pha 3. Council cũng phát hiện thêm: khối CSS `.mm-*`
  (Mind Map) trong `src/styles.css` có ~150+ hex hardcode cần đưa vào Pha 3 (bổ sung vào danh sách
  file mục 6.1 — xem ghi chú ở đó); và 2 nhóm class `.ld-*`/`.sf-*` trong cùng file có vẻ là CSS chết
  (không còn `.tsx` nào tham chiếu, khả năng sót lại sau khi gỡ Luyện đề `BL-20260925-002`) — CHƯA
  xoá vì đây là dọn dẹp ngoài phạm vi CR này, ghi nhận làm việc riêng nếu Leader muốn (xem mục
  "Ngoài phạm vi" cần bổ sung).
- **Bổ sung phạm vi Pha 3 (phát hiện từ review Pha 1):** ngoài `src/screens/*` + file dùng chung đã
  liệt kê ở mục 6.1, khi tới màn MindMap phải sửa thêm khối `.mm-*` trong chính `src/styles.css` (CSS
  của MindMap nằm ở đây, không chỉ ở `mind-map.tsx`).
- **Đính chính số liệu `npm run check` (tự phát hiện sau khi Council review xong, không phải do
  Council chỉ ra):** báo cáo trước đó ghi "xanh đủ 11 cổng" là SAI — thực tế cổng "Design token" đỏ vì
  3 chỗ `linear-gradient`/`radial-gradient` hardcode trong `src/styles.css` (dòng ~1560/1577/1644,
  khối trang trí wizard Báo cáo tuần) không khớp `scripts/design-tokens-baseline.json`. Đã xác nhận
  bằng cách `git checkout master` (bỏ hết thay đổi Pha 1) và chạy lại — **lỗi này VẪN CÒN trên
  `master` nguyên trạng, chưa đụng gì của CR này** → đây là nợ cũ có trước, không phải do Pha 1 gây
  ra, đúng kiểu đã ghi nhận nhiều lần trong lịch sử backlog dự án ("npm run check xanh, trừ Design
  token — nợ cũ không liên quan"). Không sửa (ngoài phạm vi CR này, sửa baseline lúc này có rủi ro
  ẩn: baseline hiện tại nhạy với xuống dòng LF/CRLF của file nguồn — máy nào checkout ra CRLF sẽ thấy
  đỏ, máy nào ra LF sẽ thấy xanh — sửa ẩu có thể chỉ chuyển lỗi sang máy khác, cần 1 CR riêng nếu
  muốn xử lý triệt để). Cũng phát hiện 1 test tích hợp backend flaky
  (`project-tasks-rollup-and-delete.test.ts`, chạy riêng thì 5/5 pass, chạy chung `--test-concurrency=4`
  thì thỉnh thoảng fail) — không liên quan CSS, không sửa trong CR này.
  **Trạng thái đúng: `npm run check` xanh 10/11 cổng, cổng Design token đỏ vì nợ cũ không liên quan,
  test backend/frontend đều pass khi chạy lại.**

## 11. Docs cần cập nhật sau khi làm xong

- [ ] `docs/standards/design-standard.md` (bộ token mới) · [ ] không đụng docs/01-05 khác (không đổi
  nghiệp vụ) · [ ] không đụng rules 06-09 (không đổi luật vận hành)

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Council (Claude) | 2026-09-26 | |
| Người triển khai | | | |
| QA nghiệm thu | | | |
