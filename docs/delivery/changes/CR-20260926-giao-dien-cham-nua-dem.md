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

- **Pha 2 XONG (commit `3b87fe07`, nhánh `feature/style-cham-nua-dem`).** Đổi `src/main.tsx` từ nav
  ngang (`.menu-tabs`) sang sidebar dọc, nhóm "Làm việc"/"Hệ thống" đúng prototype, tiêu đề màn hiện
  động ở topbar. Giữ nguyên 100% logic cũ (lọc tab theo quyền/feature-visibility, `?tab=` URL, cảnh
  báo rời MindMap, phím tắt). TeamSwitcher dời xuống chân sidebar, cố ý tách khỏi vùng cuộn
  `.sidebar-nav` để popup của nó không bị cắt (đã ghi lý do kỹ thuật trong code). Icon riêng cho từng
  tab bằng `lucide-react`. Xoá CSS chết `.app-brand`/`.menu-tabs`/`.menu-tab*` (đã grep xác nhận
  không còn nơi nào khác dùng trước khi xoá). Sửa 1 test client lệch theo cấu trúc mới (đổi
  `menu-tab-active` → `side-item-active`, hành vi thật không đổi). `npm run check` xanh 10/11 cổng
  (Design token vẫn là nợ cũ không liên quan, xem trên). **Chưa smoke thủ công bằng trình duyệt**
  (không có công cụ chụp màn hình trong môi trường agent) — dev server vẫn chạy tại
  `http://127.0.0.1:4000` để Leader tự kiểm tra khi thuận tiện. Council review đang chạy nền song
  song với Pha 3 đợt 1 (không chặn tiến độ, Leader đã cho phép không cần đợi phê duyệt giữa các pha).

- **Pha 3 — đợt 1/N XONG (commit `1c891dc5`, nhánh `feature/style-cham-nua-dem`).** Di trú màu cho
  các FILE DÙNG CHUNG (không thuộc riêng 1 màn): `ui.tsx` (InfoTip — đổi màu + THÊM tính vị trí thông
  minh theo FR-6, lật trên/dưới + kẹp trái/phải theo mép màn hình khi hover/focus, giữ nguyên cơ chế
  hiện/ẩn CSS cũ), `context.tsx` (toast bubble), `team-switcher.tsx`, `auth-errors.tsx`
  (PermissionLostModal + Conflict409Notice), `shortcuts.tsx` (màn Phím tắt). Cùng đợt: di trú TOÀN BỘ
  hệ thống nút/popup dùng chung trong `styles.css` (`nut-chinh`/`nut-phu`/`nut-them`/`nut-huy`/
  `nut-icon`/`nut-nguy-hiem-text`/`nav-step-button`/`nut-lich-su`/`nut-trash-icon`/`checkbox-xong`/
  `.popup`/`.overlay`/`.popup-release-manager`/`.project-info-table`) — đây là điểm đòn bẩy cao nhất
  vì MỌI màn đều dùng chung các class này, sửa 1 lần lan toả toàn app. Đã xoá `boxShadow.mem` (hết
  chỗ dùng sau khi `team-switcher.tsx` đổi sang `shadow-token-md`).
  **Phát hiện thêm về phạm vi thật của Pha 3 (quan trọng, sửa lại nhận định trước đó):** phần lớn
  "hardcode Tailwind" KHÔNG nằm ở className trong `.tsx` như ước lượng ban đầu, mà nằm ở CHÍNH
  `styles.css` dưới dạng hàng trăm class dùng chung (`@apply ... bg-white/border-slate-*/bg-teal-*`)
  — nghĩa là việc "sửa từng file `src/screens/*`" ở mục 6.1 KHÔNG đơn giản chỉ là sửa className trong
  file `.tsx` đó, mà phần lớn công sức thực tế nằm ở việc tìm và sửa đúng các class `.tsx-đó-dùng`
  bên trong `styles.css` (file CSS chung 3600+ dòng, không tách riêng theo màn). Thứ tự màn dễ→khó
  Leader đã chốt vẫn giữ nguyên, nhưng "độ khó" mỗi màn giờ nên hiểu là "có bao nhiêu class riêng của
  màn đó còn hardcode trong styles.css", không phải chỉ đếm `className=` trong `.tsx`.
  `npm run check`: TypeScript/build/token gate xanh; test: 1 lần dính lại đúng test tích hợp backend
  flaky đã biết (không liên quan), đã tự xác nhận riêng `npx vitest run` (15 file/112 test frontend)
  pass 100%. Ngoài phạm vi đợt này (để dành cho lượt riêng): `quick-add-*`/`quick-project-*` (thuộc
  popup "thêm task nhanh" của Task cá nhân/Project, không phải file dùng chung thật).

- **Council review Pha 2 XONG (run `759c9024`, Codex 2 lượt `invalid_turn_output` — Claude tự tổng
  hợp).** Tìm ra và đã SỬA (commit `d8116b99`): popup `TeamSwitcher` mở xuống dưới (`top-full`) sau
  khi dời xuống chân sidebar sẽ tràn khỏi viewport, bị `overflow-hidden` của `<main>` cắt mất — đổi
  hướng mở lên trên (`bottom-full`). Council cũng nêu 1 điểm CẦN CÂN NHẮC, chưa sửa (nằm ngoài phạm
  vi Pha 2 đã khai): topbar mới lấy tiêu đề từ `i18nKey` của tab (số nhiều, vd "Projects"), trong khi
  `project.tsx:729` vẫn tự vẽ `<h2>{t('project.title')}</h2>` riêng (số ít, "Project") làm header cho
  sidebar-con CỦA MÀN Project — không hẳn trùng lặp (2 ngữ cảnh khác nhau: tiêu đề app-level vs tiêu
  đề panel danh sách project bên trong màn), nhưng cần Dev quyết định khi tới lượt di trú màn Project
  (Pha 3): giữ nguyên, đổi chữ cho khác biệt rõ hơn, hay bỏ hẳn. Chưa quyết định vội để không tự ý
  đụng vào cấu trúc màn Project trước đúng lượt của nó.

- **Pha 3 — đợt 2/N XONG (commit `60f9a43f`, nhánh `feature/style-cham-nua-dem`) — màn Settings (màn
  đầu tiên theo thứ tự dễ→khó).** Di trú `settings.tsx` (PIC/Redmine/Phím tắt). Phát hiện thêm 1 điểm
  đòn bẩy cao trong lúc làm: rule nền `input`/`textarea`/`select` ở `@layer base` (`styles.css`) vẫn
  hardcode `bg-white` + mũi tên SVG của `<select>` hardcode màu gần-đen (`#111827`) — ảnh hưởng MỌI ô
  nhập/droplist trong toàn app, không riêng Settings. Đã sửa: `bg-surface`/`text-muc`, focus dùng
  token primary, mũi tên SVG đổi sang hex hiện tại của `--color-muted` (data-URI không dùng `var()`
  được, đã ghi chú rõ trong code). Cũng xác nhận thêm 1 quy tắc cần áp dụng nhất quán cho các màn
  sau: Tailwind class `border` (không kèm màu) trên `<div>`/`<button>` dùng màu xám nhạt MẶC ĐỊNH của
  Tailwind (không phải `--color-border` của app) — phải thêm `border-vien` tường minh; riêng
  `<input>`/`<textarea>`/`<select>` thì KHÔNG cần vì rule nền ở trên đã lo (trừ khi JSX tự ghi đè bằng
  1 class màu viền khác). `npm run check` xanh 10/11 cổng.

- **Council review Pha 3 đợt 1+2 XONG (run `bc2f9540`, Codex 2 lượt `invalid_turn_output` — Claude tự
  tổng hợp).** Xác nhận PASS toàn bộ các điểm kỹ thuật đề bài lo (quy tắc `border` mặc định Tailwind
  đúng; `.popup`/`.overlay` animation không bị ảnh hưởng nhờ `popupSoftEnter` cố ý kết thúc ở
  `transform: none`, có comment giải thích từ trước; `.nut-icon` mặc định đỏ/danger là hành vi CŨ có
  từ trước, đổi hex→token không đổi ý nghĩa). **Tìm ra và đã SỬA (commit `f7ae72d8`) 1 lỗi thật MỚI
  phát sinh từ chính Pha 3:** `InfoTip` (`ui.tsx`) vừa `aria-hidden="true"` vừa `tabIndex={0}` trên
  cùng icon — vi phạm ARIA cơ bản, tạo 1 điểm dừng Tab "câm" cho người dùng bàn phím/trình đọc màn
  hình. Đã chuyển `tabIndex`/`role="button"`/`aria-label` lên span bao ngoài, icon SVG giữ
  `aria-hidden` vì đã có nhãn ở ngoài.

- **Pha 3 — đợt 3/N XONG (commit `3fe2875f`) — màn Quản lý team.** Di trú `team-management.tsx`
  (Tổng quan/Thành viên/Nhật ký + 2 popup Thêm/Bớt thành viên).

- **Pha 3 — đợt 4/N XONG (commit `fabb62ae`) — màn Lịch release chung.** Di trú
  `release-calendar.tsx` (board + 3 popup Đăng ký/Yêu cầu mở khoá/Ép giờ chung).

- **Pha 3 — đợt 5/N XONG (commit `aa59827e`) — màn Admin (7 mục con).** Di trú `admin.tsx` (Tổng
  quan/Người dùng/Phân quyền/Hiển thị chức năng/Audit log/Điều phối release/...). 3 toggle-switch
  track color đổi theo state (on/off), giữ nguyên thumb `bg-white` (mục "Màu cố ý giữ" đã liệt kê ở
  đầu CR — cần độ tương phản cố định trên cả 2 trạng thái track, không theo theme).

- **Phát hiện lỗi nghiêm trọng, tự phát hiện qua build+soi CSS biên dịch (commit `7a2e8fce`), KHÔNG
  phải do Council chỉ ra:** hậu tố opacity Tailwind (`bg-danger/15` kiểu) sinh ra **KHÔNG CSS NÀO** khi
  màu gốc là custom token dạng chuỗi `var(--color-...)` — khác hẳn màu built-in của Tailwind (có hỗ
  trợ opacity nội bộ riêng). Đã âm thầm làm hỏng mọi chỗ từng viết `bg-danger/15`/`bg-warning/15`/
  `bg-success/15` từ đợt 2-4 (nền trong suốt hoàn toàn, không phải lỗi hiển thị nhẹ — xác nhận bằng
  `npx vite build` + grep CSS biên dịch, rule không tồn tại). Sửa toàn cục: thêm 3 token `*-soft` mới
  (`--color-danger-soft`/`--color-warning-soft`/`--color-success-soft`) vào `:root` +
  `tailwind.config.js`, grep-replace toàn bộ chỗ đã dùng sai pattern trước đó. Đã ghi thành quy tắc
  chuẩn trong comment `tailwind.config.js` để các đợt sau không lặp lại: **không dùng hậu tố
  opacity (`/NN`) trên token tự định nghĩa, luôn dùng token `*-soft` riêng.**

- **Pha 3 — đợt 6/N XONG (commit `6f3d1b78`) — màn Project (sidebar/tree/Gantt/roadmap).** Di trú
  toàn bộ prefix `.project-*` trong `styles.css` (đây là phần CSS lớn nhất của 1 màn tính tới lúc đó).

- **Pha 3 — đợt 7/N XONG (commit `1918ed2d`) — hệ "release manager" (popup quản lý template/định nghĩa
  task).** Di trú `.release-manager-*` + 4 cặp biến `--release-week-*` (thang màu theo giai đoạn
  release: jack/develop/staging/demo).

- **Pha 3 — đợt 8/N XONG (commit `29eb74b3`) — trang trí "release timeline" + `.task-row`/
  `.task-link-badge`.** Gộp 3 biến thể `.task-row` trùng lặp thành 1. Nhân tiện tự dọn được 1 trong 3
  gradient nợ cũ (bỏ nền gradient sáng của `.release-timeline-decoration`, dùng
  `var(--color-surface)` phẳng) — còn lại đúng 2 gradient nợ cũ (xác nhận qua `git diff master`: y hệt
  master, có từ trước CR, không sửa vì ngoài phạm vi — xem đợt 14 dưới).

- **Pha 3 — đợt 9/N XONG (commit `a31d5a65`) — `.task-dinh-ky`/`.ai-badge-*`/nhóm class timeline dùng
  chung.**

- **Đợt 10 (commit `7158e9a5`) — quét sạch màu Tailwind hardcode còn lại trong `styles.css`.** Di trú
  nốt `.cot-kanban`/`.project-gantt-header`/toàn bộ popup `quick-add-*`/`quick-project-*` (Thêm task
  nhanh, Task cá nhân) sang teal→primary/danger→danger-soft/v.v., cùng `field`/`field-checkbox`/
  `multi-select`/`multi-pic`/`search-box`/`toast`. Sau đợt này quét lại bằng regex chính xác hơn (loại
  false-positive `translate-` chứa substring `slate`) xác nhận vùng đang sống (< dòng 2900, trừ
  `.ld-*`/`.sf-*` chết đã xác nhận) không còn `bg-slate-*`/`bg-teal-*`/... nào ngoài màu nhận diện cố ý
  giữ.

- **Đợt 11-13 — hoàn tất 3 màn còn lại + MindMap ở tầng `.tsx` (không chỉ `styles.css`).**
  - Đợt 11 (`aab39c07`): `release.tsx` (1 chỗ sót), `auth-shell.tsx` (6 chỗ, màn đăng nhập/onboarding —
    không nằm trong bảng 9 màn gốc nhưng là màn thật người dùng thấy, sửa luôn cho nhất quán), và
    `personal-task.tsx` (Task cá nhân — timeline giờ/nghỉ trưa/vạch "hiện tại", popup Xem lịch sử).
    Kèm sửa `.bg-hoa-van` (hoạ tiết nền trang trí màn đăng nhập, hardcode nền sáng #edf1f0 cũ) sang
    nền tối theo token (stroke SVG phải hardcode hex vì data-URI không dùng `var()` được, đã ghi chú).
  - Đợt 12 (`ff7ada0a`): toàn bộ `weekly.tsx` (Báo cáo tuần — màn `.tsx` nặng nhất, ~124 dòng đổi).
    Nhân tiện bắt + sửa 20 chỗ `border` trần (không màu) trên `div`/`button`/`tr` theo đúng quy tắc đã
    chốt ở đợt 2 (Tailwind `border` trần = xám mặc định của Tailwind, không phải `--color-border` của
    app).
  - Đợt 13 (`845812e5`) — **màn Sơ đồ tư duy (MindMap), phát hiện lúc rà soát cuối: không nằm trong 9
    màn gốc vì MindMap không có trong bảng Pha 3, đã hỏi lại Leader qua AskUserQuestion và được xác
    nhận làm luôn trong CR này (không tách CR riêng).** ~196 rule `.mm-*` (raw CSS, không qua
    `@apply`) đổi từ bảng màu sáng cũ sang token, cộng 5 chỗ mặc định trắng/đen trong `mind-map.tsx`
    (bg/text mặc định khi node chưa tuỳ chỉnh màu). **Không đụng** `PEN_COLORS`/`PALETTE`/`SWATCHES`/
    `TEXT_SWATCHES`/`BG_SWATCHES` — đây là bảng màu NGƯỜI DÙNG CHỌN cho node/nét vẽ, không phải màu
    theme, cùng loại với màu PIC/avatar/emergency-shape đã liệt kê ở mục "Màu cố ý giữ".

- **Đợt 14-15 — quét bổ sung 2 loại hardcode nằm ngoài phạm vi quét trước đó (raw CSS + inline
  style).** Toàn bộ 10 đợt trước chỉ quét theo tên class Tailwind (`bg-slate-300` kiểu) — bỏ sót màu
  viết trực tiếp dạng `color: #hex`/`background: rgba(...)` trong CSS thuần (không qua `@apply`) và
  trong `style={{...}}` inline của `.tsx`. Quét lại toàn bộ 2 dạng này trên cả file, tìm và sửa
  (`959703e7`, `834c0f40`): nền/nút xanh dương lạc tông trong `.popup-release-emergency-manager` (đổi
  về đúng quy ước secondary/surface-2 đã dùng ở các popup release-manager anh em); 2 border-color
  focus `#0d9488` sót; nốt `--release-week-afterDemo` (1/5 cặp biến giai đoạn còn hex cũ, 4 cặp kia đã
  đổi từ đợt 7); `.release-token-guide`; và 2 chỗ `style={{color:'#hex'}}` trong `project.tsx` (icon
  "Mục tiêu tuần này", tên PIC). Xác nhận lại 2 lần bằng quét riêng từng vùng file (tránh lỗi đánh số
  dòng sai khi nối 2 đoạn awk) — không còn hardcode nào ngoài: token `:root`, 1 biến CSS chết
  (`--project-task-guide-color`, định nghĩa nhưng không nơi nào đọc, không đụng vì ngoài phạm vi dọn
  dẹp CSS chết), màu nhận diện cố ý giữ (PIC/Gantt-bar-text-contrast/thứ Bảy-Chủ Nhật/`.mm-add`), và 2
  gradient nợ cũ đã xác nhận qua `git diff master` (y hệt master, có trước CR).

- **Trạng thái hiện tại (sau đợt 15): toàn bộ 9 màn gốc + MindMap đã di trú xong ở cả 2 tầng
  (`styles.css` và `.tsx`).** `npm run check`: 9/11 cổng xanh thật; cổng Design token xanh (0 hardcode
  mới, baseline khớp); test backend+frontend — phát hiện MỚI đáng chú ý: bài test
  `project-tasks-rollup-and-delete.test.ts` (2 case con) đang FAIL **cả khi chạy riêng lẻ và 3/3 lần**
  (khác mô tả cũ "chỉ flaky lúc chạy chung"), đã xác nhận **fail y hệt trên `master` sạch** (dùng
  `git worktree`, không đụng gì của nhánh CR) → là lỗi/thay đổi hành vi có trước, không liên quan CSS,
  không sửa trong CR này (ngoài phạm vi), nhưng đáng báo cho Leader vì nghiêm trọng hơn mức "flaky" đã
  ghi nhận trước đó — nên có người kiểm lại độc lập với công việc CSS này. Còn lại: Council review cho
  toàn bộ đợt 3-15 (chưa chạy từ sau run `bc2f9540`, chỉ phủ đợt 1-2) sắp chạy; sau đó đến bước thêm
  lại `color-scheme: dark` (đủ điều kiện vì mọi màn đã xong) rồi merge 1 lần theo đúng kế hoạch.

- **Đính chính ngay dòng trên (trong vòng vài phút sau khi viết, trước khi Leader kịp đọc) — kết luận
  "fail cả khi chạy riêng, 3/3 lần" là SAI, xin lỗi vì đã viết vội.** Chạy lại `npm run check` lần nữa
  để soi cổng test lần này lại thấy 1 file KHÁC fail
  (`release-schedule-cycle-transfer.test.ts`), không phải file đã nêu — dấu hiệu rõ đây là flaky do
  chạy đồng thời (`--test-concurrency=4`), không phải lỗi cố định ở 1 file. Chạy cô lập file đó: 2/2
  pass. Quay lại chạy cô lập `project-tasks-rollup-and-delete.test.ts` thêm 8 lần liên tiếp (1+2+2+3):
  **8/8 pass**, không lặp lại được lần fail 3/3 trước đó — nhiều khả năng lần fail đó dính trạng thái
  tạm còn sót (port/temp dir) từ việc gọi liên tiếp nhiều tiến trình test trong cùng 1 phiên shell, chứ
  không phải bug thật cố định. **Rút lại phần "nghiêm trọng hơn flaky đã biết"** — quay về đúng mô tả
  gốc đã có từ trước CR này: 2 test tích hợp này chỉ flaky khi chạy đồng thời trong bộ đầy đủ, pass ổn
  định khi chạy riêng — không phải lỗi mới, không liên quan CSS, không sửa trong CR này.

## 11. Docs cần cập nhật sau khi làm xong

- [ ] `docs/standards/design-standard.md` (bộ token mới) · [ ] không đụng docs/01-05 khác (không đổi
  nghiệp vụ) · [ ] không đụng rules 06-09 (không đổi luật vận hành)

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Council (Claude) | 2026-09-26 | |
| Người triển khai | | | |
| QA nghiệm thu | | | |
