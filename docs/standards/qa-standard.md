# Bộ chuẩn Test / QA — Task Manager

> Tài liệu **tham chiếu bắt buộc** mỗi khi thêm chức năng mới, sửa bug, hay refactor.
> Phần *cơ chế/chiến lược* (runner, cách chạy, cấu trúc) nằm ở [TESTING.md](testing-strategy.md).
> Tài liệu này là *quy chuẩn + checklist thao tác*: mở ra, làm theo, tick từng ô.

---

## 0. TL;DR — 30 giây

- **Không** merge code không kèm test cho phần logic thay đổi (trừ thay đổi thuần văn bản/CSS).
- **Sửa bug** ⇒ viết test **tái hiện bug (đỏ)** TRƯỚC, rồi mới sửa cho **xanh**.
- Chạy trước khi commit: **`npm run check`** — gom tsc + test + build + ngân sách bundle + link markdown vào một lệnh ([ADR-P2](team-operating-standard.md)). Đã cài hook thì `git push` tự chạy.
- Chọn tầng test **thấp nhất** đủ để chứng minh: ưu tiên unit > integration route > render component. E2E chỉ khi thật cần.
- Với app này (local, 1 người dùng) → chạy **smoke test thủ công** (mục 8) khi đụng UI-flow và ghi kết quả vào commit message / CR. `npm run check` **không** thay được mục này.

---

## 1. Nguyên tắc

1. **Kim tự tháp test**: nhiều unit (nhanh, rẻ) → ít integration → rất ít E2E. Không viết integration cho thứ unit test được.
2. **Risk-based**: đầu tư test theo *rủi ro × tần suất dùng*. Logic nghiệp vụ (automation state machine, tính lịch định kỳ, release payload, mục tiêu tuần, rollup project) = rủi ro cao → phủ kỹ. Nhãn UI tĩnh = rủi ro thấp.
3. **Test hành vi, không test cài đặt**: assert *kết quả quan sát được* (response, DOM, giá trị trả về), không assert chi tiết nội bộ (biến private, thứ tự gọi hàm) trừ khi đó chính là hợp đồng.
4. **Refactor = hành vi KHÔNG đổi**: test hiện có phải vẫn xanh y nguyên. Nếu phải sửa test khi refactor → đó không còn là refactor.
5. **Cô lập & tất định (deterministic)**: mỗi test tự dựng dữ liệu, tự dọn, không phụ thuộc thứ tự chạy, không phụ thuộc `Date.now()`/mạng/máy thật. Không có test flaky được phép tồn tại.
6. **Một test — một lý do fail**: mỗi `it/test` kiểm một hành vi. Tên test nói rõ *điều kiện → kỳ vọng*.

---

## 2. Định nghĩa "Done" về test (DoD)

Một thay đổi **chỉ được coi là xong** khi:

- [ ] **`npm run check` xanh** (tsc + test backend/frontend + build + ngân sách bundle + link markdown).
- [ ] Phần **logic mới/đã sửa** có test tương ứng ở tầng phù hợp (mục 4–5).
- [ ] Với **bugfix**: có test tái hiện bug, đã xác nhận nó **đỏ trước khi sửa**.
- [ ] Không giảm số test đang xanh; không `skip`/`only` sót lại.
- [ ] Nhánh lỗi (400/404/409, input rỗng, quyền thiếu, dữ liệu rỗng) được cover, không chỉ "happy path".
- [ ] Nếu đụng luồng UI người dùng thấy được → đã chạy **smoke thủ công** (mục 8) và ghi lại kết quả.

---

## 3. Quy trình sửa bug (bắt buộc theo thứ tự)

Các bước thực thi (tái hiện → sửa → chống tái phát → quét lân cận → mở hồ sơ khi thoát cổng) đã chuyển
sang skill [`.claude/skills/bugfix-flow/SKILL.md`](../../.claude/skills/bugfix-flow/SKILL.md) — nguồn
thật duy nhất cho phần "làm thế nào". Phần dưới đây giữ lại vì là **lý do/ví dụ**, không phải bước lặp lại.

> **Vì sao "quét lân cận" phải kèm lệnh chạy lại được:** [BUG-20260803](../delivery/bugs/BUG-20260803-automation-sai-mui-gio.md)
> ghi *"đã đối chiếu `occurrenceKeyOf` ↔ `occKey` FE"* — đúng với hai chỗ *được nhớ tới*, và chính câu đó
> tạo cảm giác đã quét xong. Cùng gốc lỗi còn **3 call site sống** (`occKeyOf` trong route, `todayLocalDate`,
> `quaGio`), lộ ra ở [BUG-20260804](../delivery/bugs/BUG-20260804-gio-may-lot-3-call-site.md). Trong đó
> `quaGio` **không chứa API bị cấm nào** — nó sai qua *helper*, nên grep theo tên API cũng sẽ trượt.

> **Vì sao bước 1–4 (test) khác bước 5 (hồ sơ BUG):** bug xuất hiện = có lỗ hổng test. Vá bằng code mà
> không vá bằng test ⇒ bug sẽ quay lại. Bug **thoát cổng** = có lỗ hổng **quy trình**. Vá bằng test mà
> không vá bằng cổng ⇒ loại bug đó sẽ quay lại ở chỗ khác. Test chặn *đúng bug này*; cổng chặn *cả họ bug đó*.

---

## 4. Chọn tầng test theo loại thay đổi

| Bạn thay đổi… | Tầng test BẮT BUỘC | Nơi đặt |
|---|---|---|
| Hàm thuần (lib, helper, normalize, tính toán) | **Unit** | `test/unit/` (BE) · `test/client/*.test.ts` (FE) |
| API route (thêm/sửa endpoint, validation, status) | **Integration route** (Express thật + DB cô lập) | `test/integration/` |
| Truy vấn DB / migration / schema | **Integration** (kiểm dữ liệu sau thao tác) | `test/integration/` |
| Component/atom React (render, tương tác) | **Render test** (RTL + jsdom) | `test/client/` |
| Màn hình lớn (screen) | **Render smoke** (mount không nổ + tương tác chính) | `test/client/screens.test.tsx` |
| Luồng nghiệp vụ xuyên nhiều bước (automation) | **Integration** mô phỏng cả luồng | `test/integration/automation.test.ts` (mẫu) |
| Chỉ CSS / văn bản / nhãn i18n | Không cần test tự động; smoke thủ công nếu ảnh hưởng layout | — |

Quy tắc vàng: **chọn tầng thấp nhất chứng minh được**. Đừng dựng cả server để test một hàm cộng ngày.

---

## 5. Playbook theo loại công việc (checklist copy-paste)

### 5.0. Bốn họ bug đã lặp trong lịch sử

Khi thay đổi chạm một trong bốn họ dưới đây, test/smoke phải có ca tương ứng. Đây là rút ra từ các hồ sơ
BUG-20260803…BUG-20260813, không phải checklist trang trí.

| Họ bug | Ca phải nghĩ tới |
|---|---|
| Thời gian/ngày | Ngày khác hôm nay, qua ngày VN, máy khác múi giờ, fixture dùng thời điểm tuyệt đối |
| Automation ghi ra ngoài | Tool đọc/ghi đúng quyền, đã ghi nhưng AI báo lỗi, id/link bên ngoài thắng cờ tự đánh giá |
| Hệ thống ngoài/MCP | Connector đổi tên/auth/token vắng mặt, namespace tool thật khác tài liệu, smoke CLI thật khi đổi quyền |
| Race/đa phiên | Response cũ về trễ, double-click, hai request song song, mở app lần hai |

Nếu không thêm test tự động được, ghi rõ ca smoke thủ công nào bù lại. "Đã đọc code thấy ổn" không đủ cho 4 họ này.

### 5.1. Thêm/sửa một API route (`server/routes/*.ts`)
- [ ] Happy path: status đúng (200/201) + shape response đúng.
- [ ] Validation: input thiếu/sai → **400** kèm `message` rõ (throw `HttpError`, KHÔNG `res.status().json()` rải rác — xem [utils.ts](../../server/lib/utils.ts)).
- [ ] Không tồn tại → **404**; xung đột trạng thái → **409**.
- [ ] Thao tác **đa bước** (nhiều `db.prepare().run()`) → bọc `withTransaction` và có test xác nhận **không lệch nửa chừng**.
- [ ] Không rò rỉ stack/SQL ra client (chỉ message generic ở 500).
- [ ] Nếu route async → chắc chắn lỗi được forward về error middleware (Express 5 tự lo; nếu nghi ngờ dùng `asyncHandler`).
- [ ] Test đặt ở `test/integration/<route>.test.ts` theo khuôn [tasks.test.ts](../../test/integration/tasks.test.ts).

### 5.2. Thêm/sửa logic thuần (`server/lib/*`, `src/lib/*`)
- [ ] Bảng giá trị biên: rỗng, null, số âm, tràn (ví dụ cộng ngày qua tháng), chuỗi sai định dạng.
- [ ] Tính bất biến: hàm không đột biến tham số đầu vào (nếu thiết kế vậy).
- [ ] Tất định: không phụ thuộc `new Date()` thật → truyền ngày vào tham số để test được.
- [ ] Round-trip nếu có (encode↔decode, parse↔format).

### 5.3. Thêm/sửa component/màn hình React
- [ ] **Render không nổ** với `fetch` mock (tối thiểu, xem [screens.test.tsx](../../test/client/screens.test.tsx)).
- [ ] Trạng thái rỗng (data `[]`) hiển thị đúng, không crash.
- [ ] Tương tác chính: click nút → gọi đúng callback/API; disabled đúng lúc (đang lưu/thiếu input).
- [ ] Nếu màn hình có filter/ngày/search và request async → có test response cũ về trễ **không** ghi đè state mới.
- [ ] Nếu UI hiển thị “hiện tại/bây giờ/live” trong view theo ngày → có test ngày đang xem **không phải hôm nay** thì dấu hiệu đó không hiện.
- [ ] Không phụ thuộc provider thật nếu context có default; cần dữ liệu PIC/toast → bọc `PicProvider`/`ToastProvider`.
- [ ] Component **tách được ra file/hàm thuần** thì tách để test rẻ hơn (ưu tiên test logic ở `lib`, chừa UI mỏng).

### 5.4. Migration DB / đổi schema (`server/db.ts`)
- [ ] Idempotent: chạy migration 2 lần liên tiếp không lỗi (pattern `PRAGMA table_info` + `ALTER ... ADD COLUMN`).
- [ ] Dữ liệu cũ vẫn đọc được (backward compatible) — test với DB seed sẵn cột cũ.
- [ ] Có test integration đọc/ghi cột mới đúng.
- [ ] Không mất dữ liệu khi rebuild-table (nếu dùng): so số dòng trước/sau.

### 5.6. Đổi build / bundle / đóng gói SEA
- [ ] `npm run build` xanh; kiểm bundle không phình bất thường (hiện ~468kB main; nếu tăng mạnh → cân nhắc `lazy`).
- [ ] Nếu đụng `scripts/build-sea.mjs`: smoke thủ công chạy `TaskManager.exe` mở được app + DB tạo đúng chỗ.

---

## 6. Quy ước viết test

- **Tên test = điều kiện → kỳ vọng**, tiếng Việt, cụ thể. Tốt: `'PATCH status không hợp lệ -> 400'`. Tệ: `'test status'`.
- **Cấu trúc AAA**: Arrange (dựng dữ liệu) → Act (gọi) → Assert (kiểm). Ngăn cách rõ.
- **Cô lập DB (integration)**: set `process.env.APPDATA` sang thư mục tạm **TRƯỚC** khi `import('../../server/app.js')`; `after()` đóng server + xóa temp. (db.ts đọc APPDATA lúc import.)
- **Mock fetch (FE)**: mặc định trả `[]` (setup). Test cần dữ liệu riêng → `globalThis.fetch = vi.fn(...)` trong chính test đó; dọn ở `afterEach` (đã có `vi.restoreAllMocks()`).
- **Không phụ thuộc thời gian thật**: truyền `now`/ngày vào hàm; nếu buộc dùng `Date`, mock nó.
- **Mốc thời gian phải là THỜI ĐIỂM TUYỆT ĐỐI, không phải giờ máy.** Dựng bằng
  `new Date(Date.UTC(y, mo, d, h - 7, mi))` (giờ VN) hoặc chuỗi ISO có offset — **không**
  `new Date(y, mo, d, h, mi)`. Fixture dùng giờ máy sẽ *sai cùng kiểu với code*, nên test vẫn xanh trên
  máy dev đặt JST rồi hỏng ở máy khác: đó chính là cách [BUG-20260803](../delivery/bugs/BUG-20260803-automation-sai-mui-gio.md)
  thoát cổng. Cần giờ VN của một thời điểm trong test integration thì tính bằng `Intl.DateTimeFormat`
  ngay trong test, đừng import helper của code đang kiểm.
- **Không test-to-test coupling**: không chia sẻ biến ghi giữa các test; mỗi test tự tạo bản ghi riêng (id/tên riêng, ví dụ prefix `[itest]`).
- **Không `.only`/`.skip`** khi commit. Test bị hoãn phải kèm lý do + issue.
- **File CRLF**: khi viết script sửa file nguồn, so khớp bằng `includes` (tránh dính `\r`).

---

## 7. Ma trận phủ tối thiểu (mục tiêu)

| Khu vực | Mức tối thiểu mong đợi |
|---|---|
| `server/lib/*` (logic thuần) | Unit cho mọi hàm có nhánh logic |
| `server/routes/*` | Integration cho mọi endpoint: ≥1 happy + các nhánh lỗi (400/404/409) |
| `server/db.ts` migration | 1 integration đọc/ghi cột mới + idempotent |
| `src/lib/*`, `src/api.ts` | Unit đầy đủ nhánh + biên |
| `src/components/*`, `src/screens/*` | Render smoke + tương tác chính |
| Luồng automation | Integration mọi transition |

> Không đặt **% coverage cứng** làm cổng chặn (dễ dẫn tới test rác chạy-cho-có). Thay vào đó: *mọi thay đổi logic phải kèm test* + review chất lượng test ở PR. Có thể theo dõi coverage tham khảo bằng `npx vitest run --coverage` (FE).

---

## 8. Smoke test thủ công (regression cầm tay)

Dùng khi đụng UI-flow mà chưa có E2E tự động. Chạy `npm run dev`, sau đó tick:

- [ ] App mở, tab **Task cá nhân**: tạo task nhanh, đổi trạng thái, xóa — cập nhật đúng.
- [ ] Tab **Project**: mở project, thêm task con, kéo Gantt, đổi % — không lỗi console.
- [ ] Tab **Báo cáo tuần**: chọn tuần, đặt mục tiêu, tự đánh giá đạt/vượt.
- [ ] Tab **Lên lịch (Release)**: sinh task theo ngày release; template render token đúng.
- [ ] Tab **Luyện đề / Sơ đồ**: mở được (lazy-load), không màn trắng.
- [ ] Đổi ngày xem: popup automation cũ đóng đúng.
- [ ] Cột task định kỳ: chọn ngày tương lai/gần nhất không phải hôm nay → dữ liệu thuộc ngày đó, **không** còn vạch giờ hiện tại của hôm nay.
- [ ] Không có lỗi đỏ trong DevTools Console.

> Khi có điều kiện: tự động hóa mục này bằng **Playwright** chạy trên app thật (xem roadmap TESTING.md).

### 8.3 Khởi động: bắt buộc có ca "mở lần thứ hai"

Test tích hợp hiện import `server/app.ts` (Express thuần) nên **không chạy** `server/index.ts` — mà logic
khởi động (bind port, scheduler, mở browser, xử lý `EADDRINUSE`) chỉ nằm ở `index.ts`. Đó là cách
[BUG-006](../delivery/bugs/BUG-20260803-bat-app-trung.md) sống sót: chưa test nào mở app hai lần.

- [ ] Có ca **spawn `index.ts` thật 2 lần** trên cùng port (DB tạm, `NO_BROWSER=1`): instance 2 phải
      **thoát mã 0**, instance 1 phải vẫn phục vụ. Mẫu: `test/integration/app-single-instance.test.ts`.
- [ ] Đụng phần khởi động / khóa đơn-instance ⇒ chạy lại ca này, không chỉ chạy test `app.ts`.

---

## 9. Cổng trước khi commit (tự soi)

Dự án **không dùng PR** ([ADR-P1](team-operating-standard.md)) — thay bằng một điểm dừng bắt buộc:
đọc lại `git diff --staged` **như thể review code của người khác**, rồi tick:
- [ ] DoD (mục 2) đủ.
- [ ] Test **thực sự kiểm hành vi** (thử comment code sản phẩm → test phải đỏ). Cảnh giác test luôn xanh vô nghĩa.
- [ ] Có test nhánh lỗi, không chỉ happy path.
- [ ] Không có `.only/.skip`, không log rác, không mock rò rỉ giữa test.
- [ ] Bugfix có regression test kèm.
- [ ] Commit message ghi `Ref: CR-… (FR-x)` + đã chạy `npm test` + `npm run build` (+ smoke thủ công nếu cần).

---

## 10. Nợ test hiện tại & ưu tiên bổ sung

Ghi lại để không quên (cập nhật khi giải quyết):
1. Integration route còn trống: `projects`, `schedules`, `weekly`, `mindmaps` — ưu tiên `schedules` (logic sinh task định kỳ phức tạp).
2. Chưa có render test cho các popup tạo/sửa task (`PopupTaoTask`, `PopupSuaTask`) và `PopupAutomationSession`.
3. Chưa có E2E (Playwright) — mục 8 đang làm thủ công.
4. ~~Chưa có CI~~ → đã thay bằng `npm run check` + pre-push hook ([ADR-P2](team-operating-standard.md)). Lỗ hổng còn lại: dep chưa khai trong `package.json` vẫn lọt (không có "máy sạch").
5. `weekly-report.ts` (logic báo cáo, ~800 dòng) chưa có unit test.

---

## 11. Phụ lục — mẫu copy-paste

### A. Unit (FE, Vitest)
```ts
import { describe, it, expect } from 'vitest';
import { congNgayInput } from '../../src/lib/date';

describe('congNgayInput', () => {
  it('cộng ngày tràn sang tháng sau', () => {
    expect(congNgayInput('2026-01-30', 3)).toBe('2026-02-02');
  });
});
```

### B. Integration route (BE, node:test) — khuôn cô lập DB
```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs';
import { fileURLToPath } from 'node:url'; import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-x-'));
process.env.APPDATA = tmp;                 // TRƯỚC khi import app
const { app } = await import('../../server/app.js');
let server: Server, base = '';
before(async () => { await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => {
  const a = server.address(); base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`; r(); }); }); });
after(async () => { await new Promise<void>((r) => server.close(() => r())); fs.rmSync(tmp, { recursive: true, force: true }); });

test('POST thiếu field -> 400', async () => {
  const res = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 400);
});
```

### C. Render component (FE, RTL)
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PopupXacNhanXoa } from '../../src/components/dialogs';

it('gọi onConfirm khi submit', async () => {
  const onConfirm = vi.fn(async () => {});
  render(<PopupXacNhanXoa title="X" message="?" onClose={() => {}} onConfirm={onConfirm} />);
  fireEvent.submit(screen.getByRole('button', { name: /xóa|delete/i }).closest('form')!);
  expect(onConfirm).toHaveBeenCalled();
});
```

---

*Chuẩn này sống cùng project — thấy chỗ nào lỗi thời hoặc thiếu, sửa ngay tại đây trong cùng lần giao.*
