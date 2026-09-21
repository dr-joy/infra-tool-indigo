# CR-20260819-o-nhap-nguoi-mention-emergency-giai-doan-1 — Ô nhập người mention lúc tạo task khẩn cấp giai đoạn 1

| Trường | Giá trị |
|---|---|
| Loại | ✅ Thêm mới ⬜ Sửa hành vi ⬜ Xóa/Deprecate |
| Mức tác động | ✅ Nhỏ ⬜ Vừa ⬜ Lớn |
| Người đề xuất | Claude (theo yêu cầu Leader) |
| Ngày | 2026-08-19 |
| Backlog item | `BL-20260819-016` (`Picked`) |
| Trạng thái | ⬜ Đã duyệt ⬜ Đã triển khai ✅ Đã nghiệm thu (5/5 AC + smoke thật, §13) |
| Spec liên quan | [docs/ai-prompts/release/emergency-release.md §E1](../../ai-prompts/release/emergency-release.md) |

## 1. Bối cảnh & Vấn đề

Task `Confirm các thông tin cần thiết` (E1, `emergency_release_task_1779781779061`, `actionType=post`) đăng
bài lên Dr.JOY với dòng đầu Note là `@` để trống (template `emergency_template_1779787584273`). `ai_note`
đã có cơ chế: dòng `@` để trống → AI hỏi `needsInput` "to tới ai" lúc precheck; dòng `@` **đã có sẵn tên** →
AI dùng luôn, không hỏi. Cơ chế thứ hai (điền sẵn) chỉ dùng được bằng cách sửa tay Note **sau khi** task đã
được tạo — không có ô nhập nào ngay lúc bấm "Tạo task giai đoạn 1" (`PopupChonNgayReleaseKhanCap`). Hai task
thật đã chạy (`id 1044`, `1017`) đều để sót dòng `@` trơ, phải rơi vào nhánh hỏi.

Leader muốn: có chỗ nhập tên **ngay lúc tạo giai đoạn 1**, không phải mở sửa task sau đó.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):** Popup chọn ngày release khẩn cấp có thêm ô nhập tên (tuỳ chọn). Điền tên → dòng
  `@` trong Note của **đúng** task E1 được thay bằng `@<tên>` ngay lúc tạo. Để trống → hành vi giữ nguyên như
  hiện tại (AI hỏi lúc precheck).
- **Ngoài phạm vi:**
  - Không đổi cơ chế `needsInput` — vẫn là lưới an toàn khi bỏ trống hoặc tên không tra ra được người.
  - Không thêm cột DB, không đổi hợp đồng API `/schedules/emergency-release/tasks` (payload `tasks[]` giữ
    nguyên hình dạng, chỉ đổi *nội dung* `ghiChu` của 1 phần tử).
  - Không áp dụng cho task khác ngoài E1 (E3 cố ý luôn hỏi theo thiết kế đã chốt trước; các task còn lại
    không có dòng `@` trơ nào — xem quét toàn bộ 16 template ở §6.1).

## 3. Người dùng & Kịch bản

- Là Leader, khi bấm "Tạo task giai đoạn 1" cho đợt khẩn cấp, tôi muốn gõ luôn tên người cần mention (nếu đã
  biết), để AI không phải dừng lại hỏi lúc precheck.

## 4. Yêu cầu chức năng

- **FR-1:** `PopupChonNgayReleaseKhanCap` thêm 1 ô text tuỳ chọn "Người cần mention (tuỳ chọn)". `onConfirm`
  truyền thêm giá trị này (đã `trim()`) cho `createEmergencyTasks`.
- **FR-2:** `emergencyReleaseTaskPayloads(releaseDate, definitions, templates, mentionName?)` — nhận thêm
  tham số tuỳ chọn. Với **mỗi** definition: nếu dòng **đầu tiên** của `templateContent` (trước khi render
  token) là đúng `@` (không có gì sau, cho phép khoảng trắng) **và** `mentionName` không rỗng → thay dòng đó
  bằng `@${mentionName}` trong `generatedNote`. Không khớp điều kiện → giữ nguyên như cũ.
- **FR-3:** Không hardcode ID definition — điều kiện nhận diện là **nội dung dòng đầu**, để nếu sau này có
  thêm task khác dùng đúng khuôn `@` trơ thì tự động được hưởng, không cần sửa code lần nữa.

## 5. Yêu cầu phi chức năng

- FE-only, không gọi API mới. `mentionName` không lưu riêng — chỉ là input tạm build payload, giống hệt
  cách `releaseDate` đang được dùng.
- Không escape/inject rủi ro: `mentionName` là text thường chèn vào Note (đi qua đúng đường Note vốn đã cho
  người dùng gõ tự do), không phải HTML/SQL.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI
Popup "Tạo task giai đoạn 1 khẩn cấp" (`PopupChonNgayReleaseKhanCap`): thêm field ngay dưới ô ngày, đặt
placeholder gợi ý (vd "Sơn (team Dev1)") — khớp đúng cách `ai_note` của E1 hướng dẫn AI hỏi ("tên + team").
Để trống vẫn tạo được task bình thường (không bắt buộc).

Quét toàn bộ 16 template khẩn cấp xác nhận: **chỉ đúng 1** template (`emergency_template_1779787584273`,
dùng bởi E1) có dòng đầu là `@` trơ; các template khác đã có sẵn `@Mọi người`/`＠Mọi người`/`皆様`. Nên FR-2
chỉ chạm đúng 1 task trong 22 task, đúng phạm vi mong muốn.

### 6.2. API & nghiệp vụ
Không đổi route. `POST /schedules/emergency-release/tasks` vẫn nhận `tasks[]`; chỉ nội dung `ghiChu` của
phần tử ứng với E1 khác đi khi `mentionName` có giá trị.

### 6.3. Dữ liệu & schema
Không đổi.

### 6.4. Automation / tích hợp
Không đổi `ai_note`/`automation.ts`. Cơ chế `needsInput` giữ nguyên làm lưới an toàn.

## 7. Phân tích tác động

- [x] Frontend (`src/screens/release.tsx`) · [ ] API route · [ ] DB/migration · [ ] Automation/MCP
- [ ] i18n (chuỗi mới — thêm 2 key nhãn tiếng Việt vào `src/i18n.ts`) · [x] Đóng gói SEA (đụng `src/`, phải
  `npm run package` + bật lại exe theo `L-009`) · [ ] Bảo mật · [ ] Dữ liệu cũ/backward-compat
- **Rủi ro & giảm thiểu:** nhận diện sai dòng `@` (vd dòng `@Mọi người` bị thay nhầm) → chặn bằng test unit
  khẳng định chỉ dòng **đúng bằng `@`** (sau khi trim) mới bị thay, các biến thể `@Mọi người`/`＠...` không
  bị đụng.
- **Ảnh hưởng chức năng đang chạy:** không — trống thì y hệt hành vi cũ; `needsInput` vẫn chạy nếu Leader bỏ
  qua ô mới.

## 8. Tiêu chí nghiệm thu

- **AC-1 (FR-1):** Given popup tạo giai đoạn 1, When gõ tên vào ô mới rồi bấm tạo, Then `onConfirm` nhận
  đúng giá trị đã trim.
- **AC-2 (FR-2):** Given definition E1 (template dòng đầu `@`) và `mentionName='Sơn'`, When build payload,
  Then `ghiChu` của task đó có dòng đầu `@Sơn`, các dòng còn lại giữ nguyên.
- **AC-3 (FR-2, không hồi quy):** Given `mentionName` rỗng/undefined, When build payload, Then `ghiChu` của
  E1 giữ nguyên dòng đầu `@` như trước (hành vi cũ, để `needsInput` xử lý).
- **AC-4 (FR-3, không lan sai):** Given các definition có dòng đầu `@Mọi người`/`＠Mọi người `/`皆様` và
  `mentionName='Sơn'`, When build payload, Then `ghiChu` của các task đó **không đổi gì** — chỉ đúng dòng
  bằng hẳn `@` mới bị thay.
- **AC-5:** Given `mentionName` có khoảng trắng thừa (`'  Sơn  '`), When build payload, Then dòng thành
  `@Sơn` (đã trim), không giữ khoảng trắng thừa.

## 9. Kế hoạch test

- Tầng: ✅ Unit (hàm `emergencyReleaseTaskPayloads` — test thuần, không cần DOM) ⬜ Integration route (không
  đổi route) ✅ Render component (popup có field mới, gọi `onConfirm` đúng tham số) ⬜ Smoke thủ công (không
  bắt buộc vì không đụng automation/ghi ra ngoài — nhưng sẽ mở popup thật kiểm bằng mắt sau khi đóng gói).
- Ca lỗi/biên: mentionName rỗng; chỉ khoảng trắng; có khoảng trắng thừa; definition khác có `@` kèm chữ.

## 10. Kế hoạch triển khai / rollback

- Bước: (1) unit test cho `emergencyReleaseTaskPayloads` (đỏ trước); (2) sửa hàm; (3) thêm field + test
  render popup; (4) `npm run check`; (5) `npm run package` + bật lại exe; (6) mở popup thật kiểm bằng mắt.
- Rollback: revert commit — không có dữ liệu DB nào bị đụng.

## 11. Docs cần cập nhật sau khi làm xong

- [x] [docs/ai-prompts/release/emergency-release.md](../../ai-prompts/release/emergency-release.md) mục E1 —
  ghi thêm "có thể điền tên ngay lúc tạo giai đoạn 1 qua popup, không bắt buộc sửa tay Note nữa".

## 19. Feedback vòng 5 (2026-08-19) — team KHÔNG được lộ vào nội dung bài đăng, chỉ là gợi ý riêng cho AI

Sau vòng 4 (thêm ô team), bản đầu nối team THẲNG vào chuỗi hiển thị: `"Sơn (Dev1), Cường"` — chuỗi này
chèn nguyên văn vào dòng `@` của Note, tức là **team bị lộ vào nội dung đăng công khai lên Dr.JOY**. Leader
chỉ rõ: *"Về nối chuỗi thì không cần thêm team mà cái thông tin team đó sẽ cung cấp thêm cho AI để dễ tìm
đúng người để mention hơn thôi"* — team chỉ nên là ngữ cảnh giúp AI tra người lúc precheck, không phải thứ
để post.

### Sửa: tách 2 luồng dữ liệu riêng biệt

- **`mentionText`** (vào nội dung, token `{{mention}}`): CHỈ nối tên, đúng quy tắc "A, B, C" như cũ — bỏ hẳn
  phần `(${team})` khỏi chuỗi này.
- **`mentionTeamHints`** (KHÔNG vào nội dung): khối text riêng, mỗi dòng 1 người có điền team, dạng
  `- "<tên>" → team <team>`. Khối này nối thêm vào **`aiNote`** của task (chỉ dẫn riêng cho AI, không phải
  nội dung đăng) — CHỈ nối cho task có template dùng token `{{mention}}` (task khác không liên quan việc
  mention người thì không cần thấy khối này).
- `PopupChonNgayReleaseKhanCap.onConfirm` đổi chữ ký từ `(releaseDate, mentionName)` thành
  `(releaseDate, mentionName, mentionTeamHints)` — 2 tham số tách bạch, không còn 1 chuỗi gộp cả hai.
- `emergencyReleaseTaskPayloads` thêm tham số `mentionTeamHints?`; nối vào `aiNote` bằng tiêu đề rõ ràng
  `"## Gợi ý team cho người mention (bổ sung — KHÔNG phải nội dung bài đăng, chỉ giúp tra đúng người)"` để
  AI không nhầm đây là phần cần đăng.
- `docs/ai-prompts/release/emergency-release.md` mục E1 và bản nháp `ai_note` cập nhật theo: bước nhận diện
  team đổi từ "tách dấu ngoặc đơn trong dòng @" sang "đọc khối gợi ý team riêng ở cuối phần chỉ dẫn".

### Test bổ sung

- 7 render test popup viết lại: `onConfirm` giờ nhận **2 tham số** (`mentionName` chỉ tên, `mentionTeamHints`
  khối gợi ý) thay vì 1 chuỗi gộp `"tên (team)"`.
- 3 unit test mới cho `emergencyReleaseTaskPayloads`: có hint + template dùng token → nối đúng vào `aiNote`,
  `ghiChu` không chứa `"team Dev1"`; không điền hint → `aiNote` giữ nguyên, không thêm khối rỗng; template
  không dùng token `{{mention}}` → dù có hint cũng không đụng `aiNote` của task đó.

`npm run check` xanh toàn bộ (373 test). Exe đóng gói lại + bật lại đúng `L-009` trước khi coi là xong.

## 18. Feedback vòng 4 (2026-08-19) — thêm ô "team" đi kèm tên, cho AI khớp thẳng tên+team

Leader: *"Chắc code thêm đoạn điền Dev mấy để cho chắc đỡ tìm sai người"* — lo ngại chỉ so tên (không dấu)
qua PM-filter (Nhánh A bước 3 trong `ai_note`) có thể chọn NHẦM người khi 2+ người khác team trùng tên và
đều có chữ "PM" trong `fullName`. Thêm ô nhập team tuỳ chọn để AI tra thẳng `deptName`, không cần suy luận.

### Sửa (vòng này, sau đó bị vòng 5 sửa lại phần nối chuỗi — xem trên)

- Popup: state đổi từ `mentionNames: string[]` sang `mentionEntries: {ten, team}[]` — mỗi người có 2 ô
  (tên bắt buộc để tính, team tuỳ chọn), thêm/xoá theo cặp.
- 2 key i18n mới: `release.emg.mention_team_placeholder` (`"Dev1"`), `release.emg.mention_team_label`.

Test: 7 render test (viết lại từ 6, thêm ca "gõ cả tên và team"). *(Bản nối `"tên (team)"` vào chuỗi hiển thị
ở vòng này đã bị vòng 5 sửa lại — xem mục 19 phía trên.)*

## 17. Feedback vòng 3 (2026-08-19) — đổi thiết kế: dò dòng theo vị trí → token tường minh `{{mention}}`

Leader chỉ ra lỗ hổng thiết kế thật: cơ chế cũ dò "dòng đầu tiên đúng bằng `@`" (regex `DONG_MENTION_TRONG`
áp trên `renderedNote.split('\n')[0]`) — nếu template có **nhiều hơn 1** dòng bắt đầu bằng `@` (vd nhắc lại
mention ở cuối bài để xác nhận), chỉ dòng **đầu tiên** được thay, các dòng `@` khác bị bỏ sót — bug âm thầm,
không có lỗi hiện ra. Leader đề xuất hướng token nhưng đúng băn khoăn: token theo-từng-người
(`{{mention1}}`, `{{mention2}}`...) dở vì không biết trước số lượng người; giải là dùng **1 token duy nhất
đại diện cho cả danh sách đã nối sẵn** theo quy tắc "A, B, C" — đúng cách CR này đã làm ở tầng popup.

### Thiết kế mới

- Token **`{{mention}}`** dùng chung cơ chế thay token có sẵn (`{{release.date}}`, `{{staging.deployAt}}`...)
  — không phải cơ chế riêng. Đặt ở bất kỳ đâu trong template, lặp bao nhiêu lần cũng được; mỗi chỗ có token
  đều được thay **giống nhau**, không còn phụ thuộc vị trí/số lượng dòng `@`.
- Có tên → token thay bằng `" <tên đã nối>"` (1 khoảng trắng cố định + danh sách). Không có tên (rỗng/không
  truyền) → token thay bằng `''`, nên `@{{mention}}` thành `@` trơ — **giữ nguyên** hành vi cũ để `needsInput`
  hỏi lúc precheck.
- `renderEmergencyReleaseTemplate` (export, unit-test trực tiếp) nhận thêm tham số `mentionText`; xoá hẳn
  `DONG_MENTION_TRONG` và khối string-manipulation dò-theo-dòng trong `emergencyReleaseTaskPayloads`.
- Thêm `mention` vào whitelist token khẩn cấp ở **cả hai phía** (`server/types.ts` và
  `src/screens/release.tsx`) — thiếu 1 trong 2 là lưu template sẽ bị 400 (đã tự bắt lỗi này lúc smoke: PATCH
  template thật trả 400 "Token không hợp lệ: mention" vì exe chưa đóng gói lại code server mới).
- **Cập nhật template thật trong DB**: dòng đầu template `emergency_template_1779787584273` (dùng bởi E1)
  đổi từ `@` → `@{{mention}}`, thực hiện qua đúng `PATCH /api/release/emergency/templates/:id` (không sửa
  thẳng SQL) để đi qua validate token thật.
- Thêm entry vào bảng token gợi ý ở màn "Quản lý template khẩn cấp" (`emergencyReleaseTemplateTokens`) —
  admin mở màn đó thấy `{{mention}}` như mọi token khác, có nút copy.

### Test bổ sung — trực tiếp tái hiện đúng lỗ hổng Leader chỉ ra

9 unit test mới cho `renderEmergencyReleaseTemplate` + `emergencyReleaseTaskPayloads`, trong đó 2 ca quan
trọng nhất:
- **Nhiều token `{{mention}}` trong cùng 1 template → cả hai đều được thay**, không chỉ chỗ đầu (test trực
  tiếp hàm render, và test riêng qua đúng đường `emergencyReleaseTaskPayloads` app dùng khi tạo task).
- Token `{{release.date}}` và `{{mention}}` cùng lúc trong 1 template → cả hai thay đúng, không đụng nhau.

### Smoke thật vòng 3 — trên chính template đã sửa

1. `PATCH /api/release/emergency/templates/emergency_template_1779787584273` đổi `@` → `@{{mention}}` qua
   API thật (không SQL) — lần đầu trả **400** vì exe cũ chưa có `mention` trong whitelist server, đóng gói
   lại rồi thử lại mới **200**.
2. Nhánh có tên (3 người): dòng đầu ra đúng `@ SmokeTest Sơn, SmokeTest Cường, SmokeTest Anh Tuấn`.
3. Nhánh không điền tên: dòng đầu ra đúng `@` trơ — xác nhận fallback không bị mất khi đổi sang token.
4. Dọn sạch cả hai lần, xác nhận `0` task sót.

## 15. Feedback vòng 2 (2026-08-19) — icon (!) rung lắc, popup hẹp, khoá xoá dòng đầu

Leader xem popup thật (kèm ảnh chụp), báo 3 điểm:

1. Icon `!` (`InfoTip`) khi hover **rung lắc**.
2. Nội dung tooltip **dài quá, không nhìn thấy hết** — đề xuất mở rộng popup.
3. Dòng người mention **đầu tiên không cho xoá**, chỉ từ dòng 2 trở đi mới cho xoá.

### Nguyên nhân gốc của #1 + #2

`InfoTip` (`src/ui.tsx`) có tooltip rộng **cứng 34rem (544px)** — rộng hơn cả popup này (`max-w-md`=448px).
`.popup` (`src/styles.css`) có `overflow-y-auto`; theo quy tắc CSS, khi một trục overflow khác `visible` thì
trục còn lại **tự động** thành `auto` — nên popup thực chất có `overflow-x: auto` dù không khai báo tường
minh. Mỗi lần hover, tooltip 544px xuất hiện vượt khỏi vùng cuộn ngang của popup, trình duyệt phải tính lại
`scrollWidth` → gây giật (#1), và vì tooltip `pointer-events-none` nên phần bị cắt ngoài vùng nhìn thấy
**không kéo được** để đọc hết (#2).

### Sửa

- **`src/ui.tsx`** — giảm `InfoTip` từ `w-[34rem]` xuống `w-72` (288px). Đây là fix **chung cho cả 6 nơi**
  đang dùng `InfoTip` trong repo (release, weekly, shortcuts, automation-config-settings) — không chỉ riêng
  popup này; rủi ro thấp vì chỉ làm chữ dài hơn thì tự xuống dòng, không mất nội dung ở đâu cả.
- **`src/screens/release.tsx`** — popup này riêng đổi `max-w-md` → `max-w-xl`, đủ chỗ để tooltip 288px không
  tràn ra ngoài dù icon nằm giữa dòng nhãn.
- **Dòng đầu không xoá được**: nút xoá của `index===0` thêm `disabled` (chặn thật, không chỉ ẩn) +
  `invisible` (ẩn khỏi mắt nhưng vẫn giữ layout, các ô không bị lệch dọc so hàng). Từ dòng 2 trở đi giữ
  nguyên nút xoá như cũ.

Test bổ sung: 1 render test khẳng định nút xoá dòng 1 `disabled=true`, dòng 2 `disabled=false`, và bấm vào
nút dòng 1 (dù bị ẩn) **không** làm gì (`assert` số ô không đổi) — tổng **6 test render** cho popup.

## 14. Feedback sau demo (2026-08-19) — hỗ trợ nhiều người + quy tắc nối chính xác

Leader xem popup thật, phản hồi 2 điểm:

1. **1 ô không đủ** khi cần mention nhiều người cùng lúc trong 1 đợt khẩn cấp.
2. **Quy tắc nối phải chính xác:** `@ A, B, C` — dấu phẩy+cách giữa các tên, người cuối **không** có dấu phẩy.

Xử lý:

- Popup đổi từ 1 ô text sang **mảng ô** (`mentionNames: string[]`), nút **"+ Thêm người"** thêm ô mới, mỗi
  ô có nút xoá riêng (`Trash2`). Ô trống không xoá vẫn được **lọc bỏ** trước khi nối — tránh dấu phẩy đôi.
- `submit` join bằng `.map(trim).filter(Boolean).join(', ')` — đúng cho 1, 2, hay N người, không bao giờ có
  dấu phẩy thừa ở cuối.
- Hàm thuần `emergencyReleaseTaskPayloads` đổi format chèn từ `@${ten}` sang **`@ ${ten}`** (thêm 1 khoảng
  trắng cố định sau `@`) — khớp đúng ví dụ Leader đưa. Hàm chỉ chèn nguyên văn, không tự parse/join lại —
  trách nhiệm nối danh sách thuộc về popup.

Test bổ sung: 3 unit (quy tắc nối cho hàm thuần, dòng đầu là `@ Sơn`/`@ Sơn, Cường`...) + 3 render (bấm "+"
2 lần rồi điền 3 tên; xoá 1 ô giữa chừng; để trống 1 ô giữa chừng mà không xoá) — tổng **8 unit + 5 render**.

Smoke thật lần 2: 3 người (`SmokeTest Sơn, SmokeTest Cường, SmokeTest Anh Tuấn`) qua đúng luồng
client→API→DB→đọc lại→xoá, dòng đầu Note khớp **`@ SmokeTest Sơn, SmokeTest Cường, SmokeTest Anh Tuấn`**
từng ký tự, dọn sạch không sót.

## 13. Kết quả triển khai + nghiệm thu (2026-08-19)

| File | Việc |
|---|---|
| [`src/screens/release.tsx`](../../../src/screens/release.tsx) | `emergencyReleaseTaskPayloads` export + tham số `mentionName?`; regex `DONG_MENTION_TRONG` nhận diện dòng `@` trơ theo NỘI DUNG (không hardcode id); `PopupChonNgayReleaseKhanCap` export + ô nhập mới; `createEmergencyTasks` xuyên tham số |
| [`src/i18n.ts`](../../../src/i18n.ts) | 3 key nhãn/placeholder/hint |
| [`src/main.tsx`](../../../src/main.tsx) | **Ngoài phạm vi ban đầu nhưng bắt buộc để ship:** `ManHinhLenLich` chuyển sang `React.lazy` giống 3 tab nặng khác — bundle chính đã hết dư địa từ CR-20260814 (còn 2.6 kB), thêm vài dòng của CR này đẩy vượt 500 kB (512.2 kB đo được lúc build). Sau khi tách: bundle chính 458 kB, chunk `release` riêng 54 kB — không nâng ngân sách, sửa đúng nợ hiệu năng đã cảnh báo trước |

Test: **5 unit** ([`test/unit/emergency-release-mention.test.ts`](../../../test/unit/emergency-release-mention.test.ts))
+ **2 render** ([`test/client/emergency-release-mention-popup.test.tsx`](../../../test/client/emergency-release-mention-popup.test.tsx)).
AC-2 viết đỏ trước (import lỗi vì chưa export), rồi mới implement.

**Smoke thật** (khác ca render/unit — chạy đúng luồng client→API→DB→đọc lại, không phải mock):
1. Lấy definition/template thật từ API đang chạy.
2. Gọi đúng `emergencyReleaseTaskPayloads` (client) với `mentionName='SmokeTest Sơn'`.
3. `POST /schedules/emergency-release/tasks` với `releaseKey` test riêng (`emergency:smoke-test-20260819`,
   `releaseDate` giả `2099-01-01` — không đụng đợt thật nào).
4. `GET /api/tasks` đọc lại → `ghiChu` dòng đầu = **`@SmokeTest Sơn`** — khớp.
5. `DELETE /schedules/emergency-release/tasks?releaseKey=...` dọn sạch — xác nhận lại `0` task sót.

Lưu ý kỹ thuật phát hiện lúc smoke: task `startTime='immediate'` (hotfix) luôn xếp vào **hôm nay/ngày mai**
theo giờ chạy thực tế, **không** theo `releaseDate` (đó là ngày release production, khác ngày các task chuẩn
bị chạy) — đúng thiết kế sẵn có, không phải bug.

`npm run check` xanh toàn bộ (gồm ngân sách bundle sau khi tách lazy). Exe đã đóng gói lại + bật lại đúng
`L-009`.

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-08-19 | ✅ |
| Leader duyệt | Leader | 2026-08-19 | ✅ "hay tạo thêm ô để nhập tên lúc tạo task giai đoạn 1 nhỉ" |
| Người triển khai | Claude | 2026-08-19 | ✅ test đỏ trước, `npm run check` xanh, exe đóng gói lại |
| QA nghiệm thu | Claude | 2026-08-19 | ✅ 5/5 AC + smoke thật end-to-end (tạo→đọc→xoá), không rác lại |
