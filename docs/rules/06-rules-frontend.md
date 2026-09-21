# 06 - Frontend Rules

> Nguồn: `docs/_archive/system-standardization-rules.md`, `docs/_archive/ui-two-layer-rules.md`, `src/ui.tsx`, `src/shortcuts.tsx`, `src/i18n.ts`, `src/styles.css`.
> Đây là rule frontend đang áp dụng cho task-manager; ưu tiên giữ đúng pattern hiện có.

## 1. UI Identity

> Từ CR-20260913-c (BL-20260913-005): giá trị số/hex KHÔNG còn ghi trực tiếp ở đây — nguồn canonical
> duy nhất là CSS custom property trong `src/styles.css` `:root`, `tailwind.config.js` chỉ ánh xạ
> `var(--...)`. Bảng dưới chỉ ghi TÊN token + mục đích; đổi giá trị thì sửa ở `styles.css`, không sửa
> ở đây (tránh 2 nguồn sự thật lệch nhau — đúng thứ CR này sinh ra để chặn). Danh sách đầy đủ + lý do
> chọn từng token xem §10.

| Thành phần | Token |
|---|---|
| Primary | `--color-primary` (`bg-primary`/`text-primary` qua Tailwind) |
| Primary hover | `--color-primary-hover` |
| Primary soft bg | `--color-primary-soft` |
| Border mặc định | `--color-border` (= `border-vien` đã có) |
| Text mặc định | `--color-text` (= `text-muc` đã có) |
| Text phụ/muted | `--color-muted` (= `text-phu` đã có) |
| Nền trang | `--color-bg` (= `bg-nen` đã có) |
| Nền surface (card/modal/popup) | `--color-surface` |
| Trạng thái đang ghi/capture (vd rebind phím tắt) | `--color-record` |
| Danger/destructive | `--color-danger` |
| Warning | `--color-warning` |
| Success | `--color-success` |

- Primary action: tạo, lưu, submit, xác nhận.
- Danger/delete: `--color-danger`, không đổi sang primary.
- Secondary/outline: nền trắng, viền xám (`--color-border`), hover primary-soft nếu không có semantic riêng.

## 2. Workbench Layout

- App đi thẳng vào công cụ làm việc, không làm landing/hero.
- Vùng làm việc chính chiếm tối đa diện tích.
- Sidebar dùng cho list object; detail/work area dùng cho thao tác chính.
- Header/toolbar quan trọng nên sticky trong vùng của nó.
- Nội dung dài scroll trong work area hoặc modal body, hạn chế cả page scroll.
- Không lồng card trong card.

## 3. Two-Layer Surface

| Lớp | Nền |
|---|---|
| Container/panel lớn | `bg-white` |
| Record/item/work area phụ | `bg-slate-50` |

Ví dụ:

- Task cá nhân: `.cot-kanban` trắng; `.task-row` và `.timeline` xám nhẹ.
- Project: màn, sidebar, detail trắng; `.project-item`, `.project-task-card` xám nhẹ.
- Báo cáo tuần: panel lớn trắng; goal/history/empty area xám nhẹ.
- Luyện đề: `.ld-card` xám nhẹ.

## 4. Button & Icon

- Dùng `lucide-react` cho icon action.
- Icon-only button phải có `title` hoặc `aria-label`.
- Prev/next phải dùng `ChevronLeft`/`ChevronRight`, không hiện text `<` hoặc `>`.
- Button đổi label khi tương tác nên có width cố định để tránh reflow.
- Control thay trạng thái phải cùng kích thước (`box-border`, `h-*`, `w-*`).

## 5. Form, Modal, Input

- Form tạo/sửa entity dùng modal hoặc panel rõ ràng.
- Modal có title, body, footer action.
- Form dài: body scroll riêng, footer action giữ gần người dùng.
- Date dùng `input type="date"`.
- Number dùng `input type="number"`.
- Giờ không dùng `<input type="time">`; bắt buộc dùng `TimeInput` trong `src/ui.tsx`.
- `TimeInput` chuẩn hóa input như `1000 -> 10:00`, `930 -> 09:30`, `9 -> 09:00`, `9:5 -> 09:05`; range qua `min/max`.
- Text hướng dẫn/giải thích dùng `InfoTip`, không để inline chiếm chỗ nếu chỉ là help text.

## 6. Feedback & State

- Mọi thao tác ghi dữ liệu phải có loading/disabled, success ngắn, lỗi rõ.
- Mọi UI hiển thị **tiến trình AI đang làm** phải dùng layout **Step Tracker có nghĩa thật**: timeline dọc với mốc done/current/pending, label là bước nghiệp vụ thật người dùng hiểu được. Không thay bằng spinner/dòng "đang chờ" trơ trọi, progress bar phần trăm, hoặc timer giả. FE hay BE giữ nguồn sự kiện tiến trình tùy thiết kế từng CR; phần hiển thị cuối cùng vẫn phải theo layout Step Tracker này.
- Delete/overwrite/import phải có confirm.
- Save fail không được im lặng.
- Empty state cần ngắn và có action tiếp theo nếu phù hợp.
- Conflict cần modal hoặc message có lựa chọn xử lý.

## 7. Domain Visual Protection

Không xóa visual có ý nghĩa nghiệp vụ:

- MindMap: canvas, grid, màu branch/node, edge cong, drop hint, collapse/expand.
- Release: timeline, màu regular/emergency, token/stage/status visual.
- Luyện đề: màu đúng/sai, selected answer, timer, review.
- Project: tree level, Gantt bar, rollup/progress/carry-over warning.

Chuẩn hóa shell/action/form/spacing trước; chỉ chỉnh visual domain khi hiểu rõ ý nghĩa nghiệp vụ.

## 8. Data & API Usage

- Frontend dùng contract API camelCase; không dùng raw DB field snake_case.
- Gọi API qua helper hiện có.
- UI validate nhanh nhưng backend vẫn là lớp validate bắt buộc.
- Sau thao tác ghi, cập nhật state từ response hoặc reload danh sách liên quan rõ ràng.
- Không swallow lỗi ghi dữ liệu.
- Request đọc dữ liệu gắn với filter/ngày/search phải có quyền sở hữu rõ: `AbortController`, sequence guard, hoặc token
  tương đương. Response cũ về trễ không được ghi đè state của filter/ngày/search mới. Nguồn:
  [BUG-20260813](../delivery/bugs/BUG-20260813-ngay-dinh-ky-dinh-data-hom-nay.md).
- **Frontend KHÔNG quyết định thời gian nghiệp vụ.** Việc "tới giờ thì chạy", "quá giờ thì đánh dấu
  lỡ", "sang ngày thì reset" thuộc về server ([rules/07 §9](07-rules-backend.md)). FE chỉ *hiển thị*
  trạng thái từ DB và *hỏi người dùng*. Lý do: state trong RAM của một tab không thấy tab khác, mất
  khi F5, và bị trình duyệt bóp timer ở tab nền — mở 2 tab từng có thể gây thực thi hai lần
  (CR-20260801).
- Hệ quả: **không dùng `useRef(Set)` làm khóa chống trùng** cho hành động ghi ra ngoài. Chống trùng
  phải nằm ở DB (ràng buộc UNIQUE) hoặc ở một câu `UPDATE … WHERE` có điều kiện trạng thái.
- Được phép giữ ref cho **race của riêng UI** (vd bỏ response tới trễ sau khi user đã đóng popup).
- Phần quyết định còn lại của FE (vd *"có hiện popup hỏi không"*) phải **tách thành hàm thuần** ở
  `src/lib/*` để unit test được, không chôn trong hook/JSX ([qa-standard §5.3](../standards/qa-standard.md)).
- **Mỗi hành động người dùng có ý nghĩa khác nhau phải có mã sự kiện khác nhau.** Đừng tái dùng một mã
  cho hai ý (vd "từ chối" vs "hoãn") chỉ vì hệ quả trước mắt giống nhau — nó làm hỏng thống kê ở
  [delivery](../delivery/README.md) mà không ai nhận ra.
- **Giờ nghiệp vụ là giờ Việt Nam, kể cả ở FE.** Ghép ngày+giờ bằng `vietnamInstant()`
  ([`src/lib/date.ts`](../../src/lib/date.ts)); **không** dùng `parseLocalDateTime`/`new Date(y,m,d,h,m)`
  cho phép so "đã tới giờ chưa" — máy đặt JST là lệch 2 tiếng. Ngày trong **khóa occurrence** cũng phải là
  ngày VN để trùng khóa server ([rules/07 §8.1](07-rules-backend.md)).
  **Máy gác rule này ở FE nữa, không chỉ BE:** [`scripts/check-tz.mjs`](../../scripts/check-tz.mjs) quét
  giờ máy (`localDateInputValue`, `parseLocalDateTime`, `taoNgayTuInput`, `congNgayInput`, `congThangInput`),
  vì `main.tsx` từng sai **mà không dùng API bị cấm nào trực tiếp**. Chỗ hiển thị thật ⇒ marker
  `// tz-ok: <lý do>` (cú pháp ở [rules/07 §8.1](07-rules-backend.md)).
  Nguồn: [CR-20260804-cong-may-gio-vn](../delivery/changes/CR-20260804-cong-may-gio-vn.md).
- UI “bây giờ/hiện tại/live” trong màn hình có ngày đang xem phải gate bằng ngày đó. Ví dụ vạch giờ hiện tại trên
  timeline chỉ hiện khi `ngayDangXem` là hôm nay theo giờ VN; chọn ngày khác thì tắt, kể cả giờ hiện tại vẫn nằm trong
  khung timeline. Nguồn: [BUG-20260813](../delivery/bugs/BUG-20260813-ngay-dinh-ky-dinh-data-hom-nay.md).
- **FE không tự dựng nội dung task release từ definition rồi gửi lên** (CR-20260814-hop-nhat). Route ghi task
  release (`/schedules/regular-release/task`, `/schedules/release/sync[-preview]`) chỉ nhận `releaseDate`/
  `releaseMonth`/`definitionId` — backend tự đọc definition + template và tự dựng nội dung
  ([`server/lib/release-render.ts`](../../server/lib/release-render.ts)). Lý do: FE từng tự render rồi gửi
  `ghiChu`/`aiNote` lên, hai nơi (route "lưu 1 definition" và route "đồng bộ cả đợt") tự resolve khác nhau ⇒
  lệch nhau và không phát hiện được (BUG-20260814). Nguồn sự thật về nội dung task chỉ được ở phía backend.

## 9. Shortcut

- Action lấy từ `SHORTCUT_ACTIONS`.
- Mapping lưu ở `localStorage` key `taskmanager.shortcuts.v1`.
- Handler global bỏ qua khi user đang gõ input/textarea/contenteditable.
- UI rebind phải phát hiện trùng và hiển thị lỗi.

## 10. Design Token

> Chốt qua Council thật (run `0e0ddc52-91cf-4cba-9852-fdefbffed7e5`, hội tụ 3 vòng, 2026-09-13) và
> triển khai ở CR-20260913-c (BL-20260913-005). Đóng câu hỏi "có cần design token chính thức không"
> từng để ⏳ ở đây.

**Nguồn canonical**: CSS custom property trong `src/styles.css` `:root` (mở rộng từ pattern đã có
`--project-task-frame-height`). `tailwind.config.js` CHỈ ánh xạ `theme.extend` sang `var(--...)`,
không tự định nghĩa hex/rem riêng — đổi giá trị thì sửa ở `styles.css`, không sửa ở 2 nơi.

**5 nhóm token** (chỉ ghi tên + mục đích; giá trị thật xem `src/styles.css` `:root`):

| Nhóm | Token | Mục đích |
|---|---|---|
| Màu ngữ nghĩa | `--color-bg` | Nền trang (= `nen`/`bg-nen` cũ) |
| | `--color-surface` | Nền card/modal/popup — khái niệm mới, tách khỏi nền trang |
| | `--color-border` | Viền mặc định (= `vien`/`border-vien` cũ) |
| | `--color-text` | Chữ mặc định (= `muc`/`text-muc` cũ) |
| | `--color-muted` | Chữ phụ/ít quan trọng (= `phu`/`text-phu` cũ) |
| | `--color-primary` / `-hover` / `-soft` | Hành động chính: tạo, lưu, submit, xác nhận |
| | `--color-record` | Trạng thái đang ghi/capture (vd nút "Ghi" khi rebind phím tắt) — khác `danger` dù cùng họ màu, vì ý nghĩa khác (đang capture, không phải lỗi) |
| | `--color-danger` | Hành động phá hủy (xoá, huỷ không hồi phục) |
| | `--color-warning` | Cảnh báo cần chú ý nhưng chưa phải lỗi |
| | `--color-success` | Xác nhận thành công |
| Typography (theo VAI TRÒ, không theo số) | `--font-size-label` / `--line-height-label` | Nhãn/caption nhỏ |
| | `--font-size-body` / `--line-height-body` | Chữ nội dung mặc định |
| | `--font-size-heading` / `--line-height-heading` | Tiêu đề khu vực/modal |
| Spacing (tập con nhỏ cho shell/form/control, KHÔNG phải toàn thang Tailwind) | `--space-xs` .. `--space-lg` | Gap/padding/margin trong layout shell, form, control |
| Control | `--control-height` | Chiều cao chuẩn nút/input |
| | `--control-icon-size` | Cỡ icon mặc định trong control |
| Radius/shadow | *(không có)* | Kiểm kê 2026-09-13: `rounded-md`/`rounded-lg` + `shadow-sm` đã nhất quán, không có drift thật — Council quyết định chỉ thêm token khi có drift, không thêm cho đủ bộ |

**Cách chọn giá trị**: không phải chọn tuỳ ý — mỗi giá trị khớp đúng lựa chọn ĐANG dùng nhiều nhất
thật trong code lúc viết CR này (vd `--color-primary` khớp `bg-teal-600` đang dùng ở phần lớn nút
chính, `--control-height` khớp `h-8` đang dùng nhiều nhất cho control). Xem inventory đầy đủ trong
[CR-20260913-c](../delivery/changes/CR-20260913-c-design-token-va-error-code.md).

**Cổng máy**: `scripts/check-design-tokens.mjs` — snapshot multiset `(file, thuộc tính, giá trị)` so
với baseline (`scripts/design-tokens-baseline.json`), chặn hardcode CSS **mới** ở `src/styles.css`
(không bắt migrate ngược giá trị cũ — ngoài phạm vi CR này). Ngoại lệ đánh dấu NGAY DÒNG:
`padding: 3px; /* design-token-ok: lý do */`. Wired vào `npm run check`.

**Không thuộc phạm vi CR này**: migrate toàn bộ 3555 dòng `src/styles.css` hiện có sang token; tách
component library riêng.

## 11. Cần Bổ Sung

> ⏳ User điền nốt: breakpoint/responsive target ngoài desktop hiện tại.
