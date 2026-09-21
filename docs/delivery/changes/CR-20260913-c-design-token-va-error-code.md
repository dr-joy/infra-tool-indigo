# CR-20260913-c-design-token-va-error-code — Ruleset design token FE + registry mã lỗi BE

| Trường | Giá trị |
|---|---|
| Loại | ✅ Thêm chuẩn/công cụ (không đổi hành vi sản phẩm hiện có) |
| Mức tác động | ⬜ Nhỏ ✅ **Vừa** (đụng CSS/Tailwind toàn cục + thêm 2 cổng máy mới vào `npm run check`) |
| Người đề xuất | Leader (user) — thiết kế chốt qua Council thật, triển khai bởi Claude |
| Ngày | 2026-09-13 |
| Backlog item | `BL-20260913-005` |
| Trạng thái | ⬜ Draft ⬜ Đã review ⬜ Đã duyệt ✅ **Đã triển khai** ⬜ Đã nghiệm thu |
| Spec liên quan | [rules/06](../../rules/06-rules-frontend.md) §1, §10 · [rules/07](../../rules/07-rules-backend.md) §5 |
| Council thiết kế | run `0e0ddc52-91cf-4cba-9852-fdefbffed7e5` (hội tụ 3 vòng) — [exchange 2026-09-13](../../exchanges/2026-09-13.md) |

## 1. Bối cảnh & Vấn đề

`src/styles.css` (3555 dòng) có font-size/màu/spacing rải rác không theo thang nào, không có CSS
custom property toàn cục nào (chỉ có vài token cục bộ như `--project-task-frame-height`,
`--release-week-accent`). `rules/06 §10` tự ghi khoảng trống "có cần design token chính thức
không". BE không có registry mã lỗi machine-readable nào — kiểm kê xác nhận chỉ 6 mã thật rải rác
trong `server/routes/*`, không nơi nào liệt kê đủ.

Rủi ro cụ thể: `BL-20260913-001` (đa người dùng) sắp thêm rất nhiều màn hình mới; không có chuẩn
để agent tự theo thì Leader phải soát/prompt chi tiết từng tí một, và màu/cỡ chữ sẽ tiếp tục trôi
lệch như đã thấy (vd `#0d9488` xuất hiện trực tiếp nhiều nơi thay vì qua một tên chung).

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Có một nguồn canonical duy nhất cho 4 nhóm token (màu ngữ nghĩa, typography theo vai trò,
    spacing con cho shell/form/control, control height/icon size) — CSS custom property ở
    `src/styles.css` `:root`, Tailwind chỉ ánh xạ.
  - Có cổng máy chặn hardcode CSS **mới** ngoài baseline, không chặn giá trị cũ.
  - Có registry mã lỗi BE + cổng chặn mã **mới** chưa đăng ký.
  - `rules/06 §10` đóng, không còn ⏳.
- **Ngoài phạm vi (không làm lần này):**
  - Migrate toàn bộ `src/styles.css` hiện có sang dùng token (chỉ chặn hardcode MỚI).
  - Tách component library riêng.
  - Fold `SEC-PERF-001..016` vào `security-standard.md` — điều kiện kích hoạt là `CR-20260913` đạt
    "Đã duyệt", **chưa đạt** tại thời điểm CR này (đang "Đã review") — để lại cho lúc điều kiện đúng.
  - Radius/shadow: kiểm kê không thấy drift thật (`rounded-md`/`rounded-lg`/`shadow-sm` nhất quán) —
    không thêm token cho đủ bộ.

## 3. Người dùng & Kịch bản

- **Là agent (Claude/Codex) viết màn hình mới cho `BL-20260913-001`**, tôi muốn tra được tên token
  màu/typography/spacing đã chuẩn hoá thay vì tự đoán hex/rem, để không tạo thêm giá trị lệch mới.
- **Là Leader**, tôi muốn một hardcode mới lọt vào `styles.css` bị cổng máy chặn ngay, thay vì phải
  tự soi bằng mắt mỗi lần review.

## 4. Yêu cầu chức năng

- **FR-1:** Thêm block `:root` trong `@layer base` của `src/styles.css` với 4 nhóm token (không có
  radius/shadow — xem lý do ở mục 2): màu ngữ nghĩa (`--color-bg/-surface/-border/-text/-muted/
  -primary/-primary-hover/-primary-soft/-record/-danger/-warning/-success`), typography theo vai trò
  (`--font-size-*`/`--line-height-*` cho `label`/`body`/`heading`), spacing con
  (`--space-xs/-sm/-md/-lg`), control (`--control-height`, `--control-icon-size`).
- **FR-2:** `tailwind.config.js` ánh xạ `theme.extend.colors` (`nen/vien/muc/phu` cũ đổi giá trị sang
  `var(--...)`, giữ nguyên tên; thêm tên mới `surface/primary/primary-hover/primary-soft/record/
  danger/warning/success`), `fontSize` (`label/body/heading`), `spacing` (`xs/sm/md/lg`), `height`
  (`control`), `width` (`control-icon`) — tất cả trỏ `var(--...)`, không tự định nghĩa giá trị riêng.
- **FR-3:** `scripts/check-design-tokens.mjs` — quét `src/styles.css` cho các thuộc tính CSS liên
  quan token (`font-size`, `color`, `background(-color)`, `border-color`, `gap`, `padding*`,
  `margin*`; KHÔNG quét `width`/`height` chung chung để tránh false-positive Gantt/canvas), so
  multiset `(file, thuộc tính, giá trị)` với baseline (`scripts/design-tokens-baseline.json`, snapshot
  hiện trạng lúc viết CR này), báo hardcode **mới** ngoài baseline. Ngoại lệ đánh dấu inline:
  `/* design-token-ok: lý do */` ngay dòng đó (thiếu lý do → lỗi marker riêng). Wired vào `npm run
  check`.
- **FR-4:** `server/lib/error-codes.ts` — registry `ERROR_CODE_REGISTRY` liệt kê đủ 6 mã lỗi thật
  đang chạy (`GOAL_CONFLICT`, `REGULAR_RELEASE_EXISTS`, `EMERGENCY_RELEASE_EXISTS`,
  `EMERGENCY_BATCH_TEAMS_MISMATCH`, `EMERGENCY_BATCH_ALREADY_POSTED`, `REPORT_EXISTS`), mỗi mã kèm
  `status` + `note`.
- **FR-5:** `scripts/check-error-codes.mjs` — quét `server/routes/*.ts` tìm `code: 'X'` (field JSON)
  và tham số thứ 3 của `new HttpError(status, msg, 'X')`, báo mã **mới** chưa có trong
  `ERROR_CODE_REGISTRY`. Không bắt gắn code cho lỗi cũ chỉ có `message`. Wired vào `npm run check`.
- **FR-6:** `rules/06-rules-frontend.md` §1 đổi từ liệt kê hex trực tiếp sang liệt kê TÊN token (tránh
  2 nguồn sự thật lệch nhau); thêm §10 đóng câu hỏi cũ, liệt kê đủ 5 nhóm (kể cả nhóm "không có" của
  radius/shadow kèm lý do). `rules/07-rules-backend.md` §5 thêm quy ước đặt tên + trỏ registry.

## 5. Yêu cầu phi chức năng

- Không đổi bất kỳ className/JSX nào đang dùng `bg-nen`/`border-vien`/`text-muc`/`text-phu` — chỉ đổi
  giá trị phía sau tên đó (không cần sửa file `.tsx` nào).
- Bundle CSS không được phình bất thường (ngân sách bundle chính vẫn phải qua cổng `npm run check`).
- 2 script gate mới phải có test riêng cho chính logic của nó (không chỉ test bằng cách chạy trên
  file thật) — vì đây là công cụ gác cổng, sai logic gác thì tệ hơn không có cổng.

## 6. Thiết kế giải pháp

### 6.1. Giá trị token chọn theo đâu (không phải chọn tuỳ ý)

Mỗi giá trị khớp lựa chọn đang dùng NHIỀU NHẤT thật trong code (kiểm kê bằng grep), không phải màu
mới nghĩ ra:

| Token | Giá trị | Căn cứ |
|---|---|---|
| `--color-primary` | `#0d9488` (teal-600) | `bg-teal-600` xuất hiện 17 lần — nhiều nhất trong mọi màu nút; khớp luôn giá trị đã ghi sẵn ở `rules/06 §1` cũ |
| `--color-primary-hover` | `#0f766e` (teal-700) | `bg-teal-700` 15 lần, cặp hover của trên |
| `--color-primary-soft` | `#f0fdfa` (teal-50) | khớp giá trị đã ghi sẵn ở `rules/06 §1` cũ |
| `--color-record` | `#f43f5e` (rose-500) | khớp đúng màu nút "Ghi" lúc đang capture phím tắt (`src/shortcuts.tsx:207`) |
| `--color-danger` | `#dc2626` (red-600) | **Sửa sau Council review (run ce616b1f):** bản đầu chọn rose-600 dựa trên đếm nhầm — các chỗ dùng rose thực ra là 3 ý nghĩa khác nhau (marker "giờ hiện tại" ở timeline, trạng thái "đang ghi" ở rebind phím tắt, viền "danger zone"), không phải nút phá huỷ thật. Nút xác nhận xoá CANONICAL DUY NHẤT (`PopupXacNhanXoa` → class `.nut-nguy-hiem-text`, dùng ở mọi màn qua `dialogs.tsx`) là `border-red-600 bg-red-600 ... hover:bg-red-700` — đây mới là giá trị đang dùng thật cho hành động phá huỷ |
| `--color-warning` | `#b45309` (amber-700) | khớp cặp `bg-amber-50`/`text-amber-700` — pattern banner cảnh báo nhất quán duy nhất đang có |
| `--color-success` | `#059669` (emerald-600) | chưa có pattern rõ (chỉ 1 lần dùng `emerald-400` ở toast) — chọn cùng họ emerald, đậm hơn 1 bậc cho dễ đọc trên nền trắng |
| `--font-size-label/body/heading` | khớp `text-xs`/`text-sm`/`text-xl` | 3 cỡ dùng nhiều nhất (57/116/24 lần) trong tổng 6 cỡ đang dùng |
| `--space-xs/sm/md/lg` | `0.25/0.5/0.75/1rem` | khớp `gap-1/2/3/4`, 4 giá trị dùng nhiều nhất |
| `--control-height` | `2rem` (`h-8`) | chiều cao control tường minh dùng nhiều nhất (7 lần, so với `h-7/h-9/h-11/h-12` chỉ 1-2 lần) |
| `--control-icon-size` | `16px` | cỡ icon `size={16}` dùng nhiều nhất (64 lần trong tổng các cỡ 12-24) |

### 6.2. Vì sao cổng phải là snapshot multiset, không phải đếm tổng

Đếm tổng số hardcode bị vượt qua dễ dàng: xoá 1 giá trị cũ, thêm 1 giá trị MỚI khác, tổng số dòng
không đổi nên cổng đếm-tổng xanh nhầm. Cổng này khoá theo đúng bộ ba `(file, thuộc tính, giá trị)` —
baseline chỉ cho phép ĐÚNG những bộ ba đã tồn tại lúc chốt CR, giá trị mới ở CÙNG vị trí property
vẫn bị chặn dù tổng dòng bằng nhau. 3 ca bắt buộc (test riêng cho script, không chỉ chạy trên file
thật): (a) hardcode hoàn toàn mới → chặn; (b) hardcode cũ bị xoá + hardcode mới khác thay vào, tổng
dòng không đổi → vẫn chặn; (c) có marker ngoại lệ hợp lệ → qua cổng.

### 6.2b. Review tìm thấy gì trước khi commit (Council run `ce616b1f-6eb0-4b49-9b41-26b76a4467bf`)

Council review (Claude + Codex, 2 vòng, hội tụ) trước khi commit phát hiện 1 blocker thật + 1 điểm
nên sửa trong bản triển khai đầu tiên, cả hai đều đã sửa và có test hồi quy trước khi commit:

1. **Blocker — scanner bỏ lọt khai báo CSS compact 1 dòng.** Regex bản đầu neo `^\s*` (đầu dòng) nên
   chỉ nhận diện khai báo khi thuộc tính đứng đầu dòng vật lý; CSS thật trong `src/styles.css` có rất
   nhiều khai báo compact dạng `.ld-warn { color: #b45309; }` (selector + declaration cùng dòng) —
   những dòng này bị bỏ qua hoàn toàn, nghĩa là hardcode MỚI viết theo kiểu compact sẽ lọt qua cổng.
   Baseline sinh lại bằng scanner đã sửa tăng từ 192 → 1213 mục, xác nhận quy mô lỗ hổng thật (không
   phải lỗi nhỏ). Sửa: bỏ neo `^`, dùng regex toàn cục quét bất kỳ vị trí nào trong nguồn, giá trị
   loại trừ `{`/`}` nên tự nhiên không khớp nhầm pseudo-selector/media breakpoint. Thêm 3 test hồi quy.
2. **Nên sửa — token `danger` chọn sai giá trị chiếm ưu thế thật.** Bản đầu đếm cả 3 cụm dùng
   rose/red khác ý nghĩa nhau (marker giờ hiện tại ở timeline, trạng thái "đang ghi" khi rebind phím
   tắt, viền "danger zone") thành một nhóm "danger", ra kết luận rose-600 là màu phá huỷ dùng nhiều
   nhất — sai. Đối chiếu lại đúng nút xác nhận xoá canonical (`.nut-nguy-hiem-text`, dùng chung qua
   `PopupXacNhanXoa` ở mọi màn) cho thấy red-600 mới là giá trị thật. Đã đổi `--color-danger` sang
   `#dc2626`.
3. **Góp ý nhỏ — comment gây hiểu nhầm.** Comment cũ nói "chạy lại cổng này để cập nhật baseline"
   trong khi script chỉ so sánh, không tự ghi. Đã tách riêng `scripts/gen-design-tokens-baseline.mjs`
   (chỉ chạy khi CHỦ ĐÍCH đổi baseline) và sửa lại câu chữ.

Council cũng xác nhận: cơ chế `soSanhBaseline` (multiset) đúng từ đầu — lỗi nằm ở bước THU THẬP đầu
vào (scanner), không phải bước so sánh; registry mã lỗi BE và việc không đụng radius/shadow/
security-standard.md đều đúng như cam kết, không có finding nào ở phần đó.

### 6.3. Registry mã lỗi BE — vì sao chỉ chặn mã mới

Kiểm kê 6/6 mã lỗi hiện có xác nhận: tuyệt đại đa số lỗi trong `server/routes/*` chỉ có `message`
tiếng Việt, không có `code` — đây là chủ ý (FE không cần branch theo code cho mọi lỗi), không phải
thiếu sót cần vá ngược. Registry chỉ đảm bảo mã MỚI (đi kèm route mới hoặc sửa route cũ thêm code)
không bị đặt tuỳ tiện mà không ai biết tới.

## 7. Phân tích tác động

- ✅ Frontend (`styles.css`, `tailwind.config.js`, `rules/06`) · ✅ Backend (`error-codes.ts`,
  `rules/07`) · ⬜ DB · ⬜ i18n · ⬜ Đóng gói (không đổi hành vi runtime, chỉ CSS/build-time config)
- ✅ Cổng máy (`npm run check` +2 bước) · ✅ Dữ liệu cũ/backward-compat (không đổi tên class nào đang
  dùng, chỉ đổi giá trị phía sau)

**Rủi ro & giảm thiểu:**

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Đổi giá trị màu `nen/vien/muc/phu` sang `var(--...)` làm lệch màu hiển thị thật | Thấp | Giá trị hex giữ NGUYÊN, chỉ đổi từ hex trực tiếp sang `var(--...)` trỏ tới đúng hex đó — `npx vite build` xác nhận build qua, không đổi hex |
| Cổng design-token false-positive trên code hợp lệ đã có | Trung bình | Baseline sinh trực tiếp từ `src/styles.css` thật lúc viết CR (192 mục), không phải danh sách tay — chạy `node scripts/check-design-tokens.mjs` xác nhận xanh trên chính file đó |
| Cổng error-code chặn nhầm 6 mã cũ | Thấp | Registry liệt kê đủ 6 mã bằng inventory script (grep có kiểm chứng số lượng), không chép tay |

**Ảnh hưởng chức năng đang chạy:** không đổi hành vi bất kỳ route/màn hình nào — thuần bổ sung
chuẩn + công cụ gác cổng cho tương lai.

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1, FR-2):** Given `npx vite build` chạy trên code trước CR / When so với sau CR / Then
  không có lỗi build, bundle CSS không phình bất thường.
- **AC-2 (FR-3):** Given `scripts/check-design-tokens.mjs` chạy trên `src/styles.css` hiện tại / Then
  xanh (không vi phạm) — vì baseline sinh từ đúng file này.
- **AC-3 (FR-3):** Given test riêng cho script / When bơm 1 hardcode hoàn toàn mới / Then bị chặn.
- **AC-4 (FR-3):** Given test riêng cho script / When hardcode cũ (có trong baseline) bị thay bằng
  hardcode mới khác, tổng số dòng bằng nhau / Then vẫn bị chặn (không bị đếm-tổng che lấp).
- **AC-5 (FR-3):** Given test riêng cho script / When có marker `design-token-ok` kèm lý do / Then
  không bị chặn; marker thiếu lý do → báo lỗi marker riêng.
- **AC-6 (FR-4, FR-5):** Given `scripts/check-error-codes.mjs` chạy trên `server/routes/*` hiện tại /
  Then xanh (6/6 mã thật đã đăng ký đủ).
- **AC-7 (FR-5):** Given test riêng cho script / When bơm 1 mã lỗi mới chưa đăng ký / Then bị chặn.
- **AC-8 (FR-6):** Given `rules/06-rules-frontend.md` / Then §10 không còn dòng `⏳ User điền nốt`
  về design token; §1 không còn hex trực tiếp trùng lặp với `styles.css`.

## 9. Kế hoạch test

- Tầng test: ✅ Unit (`test/unit/check-design-tokens.test.ts`, `test/unit/check-error-codes.test.ts`)
  ⬜ Integration (không cần — 2 script không đụng route/DB) ⬜ E2E
- Ca chính + ca biên: 13 test cho `check-design-tokens` (3 ca bắt buộc a/b/c + biến thể đối chứng +
  thuộc tính ngoài danh sách theo dõi + khoá đúng theo cặp property/value + 5 test hồi quy thêm sau
  Council review — compact 1 dòng, nhiều khai báo compact cùng dòng, shorthand pha token, marker
  trên dòng compact), 7 test cho `check-error-codes` (json-field, HttpError đa dòng, không có tham
  số thứ 3, đọc registry, mã đã/chưa đăng ký).

## 10. Kế hoạch triển khai / rollback

- Không có migration DB, không có bước triển khai runtime đặc biệt — chỉ commit code + docs.
- Rollback: revert commit là đủ, không có dữ liệu cần khôi phục.

## 11. Docs cần cập nhật sau khi làm xong

- [x] [rules/06](../../rules/06-rules-frontend.md) — §1 đổi sang tên token, §10 đóng
- [x] [rules/07](../../rules/07-rules-backend.md) — §5 thêm quy ước registry mã lỗi
- [x] [docs/backlog/README.md](../../backlog/README.md) — `BL-20260913-005` → Done
- [x] [docs/delivery/README.md](../README.md) — đăng ký CR này vào ledger

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Council (Claude + Codex, run `0e0ddc52`) | 2026-09-13 | ✅ hội tụ 3 vòng |
| Người triển khai | Claude | 2026-09-13 | ✅ code + test xong |
| Review độc lập | Council (Claude + Codex, run `ce616b1f`, 2 vòng) | 2026-09-13 | ✅ hội tụ — 1 blocker + 1 nên sửa, cả hai đã sửa (mục 6.2b) |

**Kết quả thật (2026-09-13, sau khi sửa theo review):** `npm run check` xanh 10/10 cổng máy kiểm
được (2 cổng mới do chính CR này thêm); 20 test unit mới PASS (13 cho `check-design-tokens` gồm 5
test hồi quy theo review + 7 cho `check-error-codes`). Baseline sinh lại bằng scanner đã sửa: 1213
mục (tăng từ 192 — xác nhận đúng quy mô lỗ hổng scanner cũ đã bỏ lọt). `npm run package` xong;
`TaskManager.exe` lúc kiểm tra **không đang chạy** nên không cần khởi động lại. **Chưa qua Leader
xác nhận UI thật** (đổi màu `--color-danger`/`--color-primary`... trên các màn thật) — nên tự mở app
một lần để xác nhận không có gì lệch mắt trước khi coi là khép hẳn ("Đã nghiệm thu").
