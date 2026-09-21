# CR-20260804-cong-may-gio-vn — Cổng máy chặn API/helper giờ-máy trong vùng quyết định

| Trường | Giá trị |
|---|---|
| Loại | ✅ Thêm mới ⬜ Sửa hành vi ⬜ Xóa/Deprecate |
| Mức tác động | ⬜ Nhỏ ✅ Vừa ⬜ Lớn (đụng DB/nhiều màn/automation) |
| Người đề xuất | Claude (từ rà soát của Codex — [exchanges/2026-08-04](../../exchanges/2026-08-04.md)) |
| Ngày | 2026-08-04 |
| Trạng thái | ⬜ Draft ⬜ Đã review ✅ Đã duyệt ✅ Đã triển khai ✅ **Đã nghiệm thu** — ghi chú 2026-08-21: 3 checkbox cuối bị bỏ quên chưa tick dù cổng máy `scripts/check-tz.mjs` đã chạy thật trong `npm run check` từ lâu (bước "Gốc thời gian (giờ VN)", `scripts/check.mjs`) — sửa lại đúng thực tế, không đổi code |
| Spec liên quan | [rules/06-rules-frontend](../../rules/06-rules-frontend.md) · [rules/07-rules-backend §8.1](../../rules/07-rules-backend.md) · [team-operating ADR-P2](../../standards/team-operating-standard.md) |

## 1. Bối cảnh & Vấn đề

[BUG-20260803](../bugs/BUG-20260803-automation-sai-mui-gio.md) (task AI bị đánh "đã lỡ giờ" sớm 2 tiếng trên máy
`Asia/Tokyo`) đã kết thúc bằng hành động cải tiến **viết rule**: [rules/07 §8.1](../../rules/07-rules-backend.md) nay
CẤM nguyên văn `new Date(y,m,d,h,m)`, `setHours()`, `getHours()`, `getFullYear/getMonth/getDate` trong logic quyết định.

Rule đó **đã bị vi phạm 3 lần ngay sau khi được viết**, và không cổng nào phát hiện:

| Chỗ | Vi phạm gì | Hậu quả |
|---|---|---|
| `server/routes/automation.ts` `occKeyOf` | `getFullYear/getMonth/getDate` | khóa occurrence ghi sai ngày sau 22:00 VN ⇒ nhật ký tách đôi |
| `server/routes/schedules.ts` `todayLocalDate` | `getFullYear/getMonth/getDate` | release sync bỏ im lặng task **của hôm nay** sau 22:00 VN |
| `src/main.tsx:1516` `quaGio` | gọi helper giờ-máy `localDateInputValue` + `parseLocalDateTime` | popup mời "Phê duyệt & chạy ngay" **sớm 1.5 tiếng** ⇒ đăng bài sai giờ |

Bài học: rule chỉ có người gác thì lần sau vẫn lọt. `npm run check` không biết rule đó tồn tại. Đây là CR để **máy
thi hành rule**, không phải để viết thêm chữ.

> Chi tiết rà soát + phản biện hai chiều: [exchanges/2026-08-04.md](../../exchanges/2026-08-04.md) §8, §9, §13.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Chạy `node scripts/check-tz.mjs` trên code **chưa sửa** ⇒ đỏ **đúng 3** chỗ ở bảng trên, không đỏ chỗ nào khác.
  - Cổng nằm trong `npm run check` ⇒ mọi lần giao sau đều bị gác.
  - Chi phí miễn trừ cho toàn vùng quyết định: **17 marker** (số đo thật, xem §6.2 — dự tính ban đầu 6 là sai).
- **Ngoài phạm vi (không làm lần này):**
  - **Không sửa 3 lỗi** — đó là [BUG-20260804-gio-may-lot-3-call-site](../bugs/) ở commit kế tiếp. CR này chỉ dựng cổng,
    và trạng thái đỏ của nó **chính là test đỏ** của bug đó.
  - Không quét `server/lib/{mappers,utils,weekly-report}.ts`, `src/screens/*` — gần như toàn bộ là hiển thị, kéo vào
    sẽ cần ~15 marker và biến cổng thành tiếng ồn ngày đầu. Xem §5 "giới hạn đã biết".
  - Không đổi tên `parseLocalDateTime` (chỉ thêm doc-comment cảnh báo) — đổi tên sẽ lan sang `src/screens/release.tsx`
    và trộn refactor vào bugfix.
  - Không cấm `Date.now()` / `getTime()`: chúng là **thời điểm tuyệt đối**, không phụ thuộc múi giờ.

## 3. Người dùng & Kịch bản

- Là **người sửa code sau này (người hoặc AI)**, tôi muốn máy chặn ngay khi tôi dùng giờ máy trong logic quyết định,
  để tôi không phải nhớ một rule nằm ở file khác — và để lỗi này không lọt lần thứ tư.
- Là **Leader**, tôi muốn `npm run check` trả lời được câu *"lần giao này có tái phạm gốc thời gian không"*, thay vì
  phải tự grep mỗi lần review.

## 4. Yêu cầu chức năng

- **FR-1:** `scripts/check-tz.mjs` báo lỗi khi **API giờ-máy** xuất hiện trong vùng quyết định:
  `new Date(y, m, d, …)` (≥3 tham số), `setHours`, `getHours`, `getMinutes`, `getFullYear`, `getMonth`, `getDate`, `getDay`.
  (`getMinutes`/`getDay` là **bổ sung** so với rule hiện tại: `getMinutes` đi cặp với `getHours`; `getDay` cho
  thứ-trong-tuần theo giờ máy, lệch ở ranh giới ngày — [`recurrence.ts`](../../../server/lib/recurrence.ts) so `weekday`.)
- **FR-1b:** báo lỗi khi **helper giờ-máy** xuất hiện trong vùng quyết định:
  `localDateInputValue`, `parseLocalDateTime`, `taoNgayTuInput`, `congNgayInput`, `congThangInput`.
  *Không có FR-1b thì cổng vô dụng với lỗi nặng nhất*: `src/main.tsx` có **0** lần dùng API bị cấm trực tiếp — nó sai
  hoàn toàn qua helper.
- **FR-2:** miễn trừ bằng marker `// tz-ok: <ly-do-ascii>` đặt ngay trên `function` (miễn trừ cả thân hàm) hoặc ngay
  trên một dòng call site. Marker **không có lý do** ⇒ lỗi. Marker **không miễn trừ cho gì** (không có vi phạm nào bên
  dưới) ⇒ lỗi — chống marker mục ruỗng sau khi code đổi.
- **FR-3:** bỏ **comment**, **string literal** và **dòng `import`** trước khi khớp. Không có bước này cổng sẽ đỏ ở
  [`vn-time.ts:3`](../../../server/lib/vn-time.ts) và [`date.ts:44`](../../../src/lib/date.ts) — hai comment *dạy* về
  chính rule này — và ở mọi dòng `import { localDateInputValue }`.
- **FR-4:** cắm vào [`scripts/check.mjs`](../../../scripts/check.mjs) thành bước **5c**, cạnh 2 cổng docs.
- **FR-5:** cập nhật [rules/07 §8.1](../../rules/07-rules-backend.md) + [rules/06](../../rules/06-rules-frontend.md):
  ghi rõ **cổng nào thi hành** rule, danh sách API/helper bị cấm, và cú pháp marker.

## 5. Yêu cầu phi chức năng

- Không thêm dependency. Tìm biên thân hàm bằng cân ngoặc `{}` — cùng kỹ thuật đã có ở
  [`claude-runner.ts extractJsonObject`](../../../server/lib/claude-runner.ts).
- Thời gian chạy ≤ 1s (9 file), không làm `npm run check` chậm đáng kể.
- **Giới hạn đã biết (cố ý, không phải bỏ sót):**
  1. Quét theo **danh sách file** (§6.1), không quét cả repo ⇒ code mới nằm ngoài danh sách sẽ không được gác.
     Mở rộng khi cổng đã yên; mỗi lần mở rộng phải bổ sung marker cho vùng hiển thị.
  2. Khớp bằng regex sau khi bỏ comment/string, **không phải AST** ⇒ có thể sót ca lạ (vd gọi động
     `obj['getHours']()`). Chấp nhận: cổng này nhằm chặn lỗi *vô tình*, không nhằm chống người cố tình lách.

## 6. Thiết kế giải pháp

### 6.1. Vùng quyết định (danh sách file quét — chốt tại đây, không đoán lúc code)

```
server/lib/automation-helpers.ts     server/routes/automation.ts
server/lib/automation-scheduler.ts   server/routes/schedules.ts
server/lib/recurrence.ts             src/lib/date.ts
src/lib/automation-ask.ts            src/useAutomation.ts
src/main.tsx
```

`src/lib/date.ts` và `src/main.tsx` **có mặt trong danh sách** dù chứa nhiều code hiển thị — vì chúng cũng chứa logic
quyết định. Đó là lý do marker phải theo **hàm/dòng**, không phải theo file (allowlist theo file sẽ làm thủng cổng ở
đúng chỗ nó cần gác).

### 6.2. Marker cần thêm — số đo THẬT: 17, không phải 6 như dự tính

| File | Số marker | Chỗ nào | Lý do miễn trừ |
|---|---|---|---|
| `src/lib/date.ts` | 9 | `localDateInputValue`, `taoNgayTuInput`, `congNgayInput`, `congThangInput`, `dinhDangNgay`, `dinhDangNgayDayDu`, `addDays`, `mondayOfWeek`, `parseLocalDateTime` | `hien-thi` / `ngay-lich-round-trip` / `dieu-huong-ngay-tren-form` |
| `server/routes/schedules.ts` | 7 | `toDateInput` (×2 — code lặp ở 2 handler) + 5 mốc cửa sổ legacy `new Date(y, m, ±n)` | `ngay-lich-round-trip` — phép lịch thuần từ chuỗi `yyyy-mm`, **không đọc đồng hồ** |
| `src/main.tsx` | 1 | `doiNgay` (nút lùi/tiến ngày trên form) | `dieu-huong-ngay-tren-form` |

**Vì sao dự tính 6 sai:** lúc lập kế hoạch mình grep tên *helper* trong `main.tsx` (ra 4 dòng, đúng) rồi
**suy diễn** `src/lib/date.ts` chỉ có 5 hàm cần marker. Chạy cổng thật ra **34 vi phạm**: `date.ts` có 9 hàm
lịch/hiển thị (thiếu `dinhDangNgay`, `dinhDangNgayDayDu`, `addDays`, `mondayOfWeek`), và `schedules.ts` có cả
khối cửa sổ legacy mà mình chưa mở ra xem. Bài học nhỏ: *"đã đo"* phải là chạy thật, không phải grep một
phần rồi ngoại suy.

**Chi phí này không phải phí.** Mỗi marker buộc một chỗ dùng giờ máy **tự khai** là hiển thị hay phép lịch —
trước đó không có gì phân biệt "giờ máy vì đúng" với "giờ máy vì quên". `ngay-lich-round-trip` là carve-out
có sẵn trong rule: `Date` dựng từ `yyyy-mm-dd` rồi đọc lại bằng **cùng** múi giờ máy thì round-trip đúng,
không có `now` nào tham gia nên không có gì để lệch.

`src/main.tsx:1517` (`quaGio`), `automation.ts occKeyOf`, `schedules.ts todayLocalDate` **cố ý KHÔNG có
marker** — chúng là lỗi, phải đỏ, và được sửa ở commit kế tiếp.

### 6.2b. Hai lỗi của chính cổng, phát hiện khi dựng (ghi lại vì cả hai đều thuộc loại "im lặng cho qua")

1. **Marker không che được arrow function có thân là mảng.** Bản đầu chỉ cân `{}` nên
   `const toDateInput = (d: Date) => [ d.getFullYear(), … ]` không được che ⇒ phải cân cả `{}`, `[]`, `()`.
2. **Code trong `${…}` của template literal bị bỏ cùng với chuỗi.** Bản đầu chạy ra **2** vi phạm thay vì 3 —
   `occKeyOf` lọt, vì nó gọi `getFullYear/getMonth/getDate` hoàn toàn bên trong một template literal. Đúng
   lỗi nặng mà cổng sinh ra để bắt, mà cổng lại im lặng cho qua. Đã sửa + chốt bằng test
   `FR-3: code trong ${…} … VẪN bị bắt (ca occKeyOf)`.

Nếu AC-1 chỉ ghi *"phải đỏ"* thay vì *"đỏ **đúng 3 chỗ**"* thì lỗi (2) đã trôi qua — cổng vẫn đỏ 2 chỗ, vẫn
trông như đang hoạt động.

### 6.3. Dữ liệu & schema

Không đụng DB.

### 6.4. Automation / tích hợp

Không đổi hành vi automation. Cổng là công cụ build; 3 lỗi mà nó phát hiện được sửa ở CR/BUG khác.

Doc-comment `parseLocalDateTime` sửa lại vì câu hiện tại đang **mời** dùng sai:

```diff
-// Ghép ngày (yyyy-mm-dd) + giờ (HH:mm) thành Date local. Dùng ở nhiều nơi (App reconcile,
-// màn release, popup automation) nên đặt ở module date trung lập.
+// Ghép ngày (yyyy-mm-dd) + giờ (HH:mm) thành Date theo giờ MÁY.
+// CHỈ dùng cho UI/hiển thị. KHÔNG dùng cho quyết định theo thời gian (đã tới giờ chưa / hôm nay
+// là ngày nào) — dùng `vietnamInstant` + `currentVietnamDateInputValue`. Xem BUG-20260804 (§9).
```

## 7. Phân tích tác động

- [ ] Frontend (màn/component) · [ ] API route · [ ] DB/migration · [ ] Automation/MCP
- [ ] i18n (chuỗi mới) · [ ] Đóng gói SEA/MCP · [ ] Bảo mật · [ ] Dữ liệu cũ/backward-compat
- [x] Build/tooling (`scripts/check.mjs` — ADR-P2) · [x] Rules 06/07
- **Rủi ro & giảm thiểu:**
  - *Cổng ồn ⇒ người học cách tắt nó.* Giảm thiểu: FR-3 (bỏ comment/string/import) + đã đo trước chỉ cần 6 marker.
  - *Cổng chặn `git push` vì 3 lỗi chưa sửa.* Đây là **có chủ đích** — xem §10.
  - *Marker bị lạm dụng để tắt cổng.* Giảm thiểu: marker phải có lý do; marker không miễn trừ cho gì ⇒ đỏ.
- **Ảnh hưởng chức năng đang chạy:** không. Không file runtime nào bị đổi logic; chỉ thêm comment + script build.

## 8. Tiêu chí nghiệm thu

- **AC-1 (FR-1, FR-1b):** Given code **chưa** sửa 3 lỗi / When chạy `node scripts/check-tz.mjs` / Then đỏ **đúng 3**
  chỗ: `automation.ts occKeyOf`, `schedules.ts todayLocalDate`, `main.tsx:1516 quaGio` — và **không** chỗ nào khác.
- **AC-2 (FR-1b):** Given bỏ riêng luật helper (FR-1b) / When chạy lại / Then `main.tsx` **không** đỏ ⇒ chứng minh
  FR-1b là thứ bắt được §9, không phải trang trí.
- **AC-3 (FR-3):** Given `server/lib/vn-time.ts` và `src/lib/date.ts` có comment nêu tên API bị cấm / When chạy cổng /
  Then **không** đỏ vì comment.
- **AC-4 (FR-2):** Given một marker `// tz-ok:` không có lý do, hoặc đặt ở chỗ không có vi phạm nào bên dưới /
  When chạy cổng / Then **đỏ** với thông báo phân biệt được 2 ca đó.
- **AC-5 (FR-4):** Given `npm run check` / When chạy / Then có bước "Gốc thời gian (giờ VN)" trong bảng tổng kết.
- **AC-6 (FR-5):** Given rules 06/07 / When đọc mục gốc thời gian / Then thấy tên cổng thi hành + cú pháp marker.

## 9. Kế hoạch test

- Tầng test dự kiến: ✅ Unit ⬜ Integration route ⬜ Render component ✅ Smoke thủ công
- `test/unit/check-tz.test.ts` — test **chính script** bằng chuỗi nguồn bơm vào (hàm thuần `quetNguon(text)`):

| Ca | Kỳ vọng |
|---|---|
| `getFullYear()` trong code thường | 1 vi phạm |
| `getFullYear()` trong **comment** | 0 vi phạm (FR-3) |
| `'getFullYear()'` trong **string** | 0 vi phạm (FR-3) |
| `import { localDateInputValue } from …` | 0 vi phạm (FR-3) |
| gọi `localDateInputValue()` trong code | 1 vi phạm (FR-1b) |
| `new Date(iso)` / `new Date(ms)` / `new Date()` | 0 vi phạm (chỉ ≥3 tham số mới cấm) |
| `new Date(y, m - 1, d, h, mi)` | 1 vi phạm |
| marker trên function ⇒ cả thân hàm | 0 vi phạm |
| marker không có lý do | 1 lỗi loại "marker thiếu lý do" |
| marker không miễn trừ gì | 1 lỗi loại "marker mục ruỗng" |

- Smoke thủ công: chạy `npm run check` — phải thấy bước mới và phải **đỏ** (đúng kỳ vọng ở lượt này).

## 10. Kế hoạch triển khai / rollback

- **Bước triển khai** (cách (b) — Leader chốt 2026-08-04):
  1. Commit 1 (CR này): script + 6 marker + doc-comment + rules + FR-4. `npm run check` **ĐỎ** vì 3 lỗi còn nguyên.
     **Chưa push.** Trạng thái đỏ này được dán vào hồ sơ BUG làm "test đỏ tái hiện".
  2. Commit 2 (BUG-20260804): sửa 3 call site ⇒ `npm run check` **xanh**.
  3. Push cả hai. `pre-push` chạy `npm run check` một lần tại thời điểm push ⇒ xanh.
  - Vì sao được phép commit đỏ: [ADR-P1](../../standards/team-operating-standard.md) bỏ Pull Request nên **commit ≠ push**;
    DoD *"check phải xanh"* áp cho **lần giao**, và lịch sử git giữ được bằng chứng "cổng thật sự bắt được lỗi".
- **Rollback:** xoá bước 5c khỏi `scripts/check.mjs` (1 dòng) — cổng thành script chạy tay, không chặn ai. Marker và
  doc-comment vô hại, để lại được.

## 11. Docs cần cập nhật sau khi làm xong

- [ ] docs/01 — không đụng · [ ] docs/02 — không đụng · [ ] docs/03 — không đụng · [ ] docs/04 — không đụng
- [x] [rules/06-rules-frontend](../../rules/06-rules-frontend.md) — cổng + marker (FR-5)
- [x] [rules/07-rules-backend §8.1](../../rules/07-rules-backend.md) — cổng + marker + 2 API bổ sung (FR-5)
- [x] [team-operating ADR-P2](../../standards/team-operating-standard.md) — liệt kê cổng mới trong `npm run check`
- [x] [Sổ Change Request](../README.md) — thêm dòng CR này

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-08-04 | ✅ |
| Review chéo | Codex | 2026-08-04 | ✅ (chốt FR-1b + marker theo hàm/call site) |
| Duyệt | Leader | 2026-08-04 | ✅ (duyệt tất 6 lượt + chốt cách cắt commit (b)) |
| Người triển khai | Claude | | |
| QA nghiệm thu | | | |
