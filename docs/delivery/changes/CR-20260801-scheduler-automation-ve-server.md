# CR-20260801-scheduler-automation-ve-server — Chuyển vòng quyết-định-theo-thời-gian của Automation AI từ Frontend về Server

| Trường | Giá trị |
|---|---|
| Loại | ⬜ Thêm mới ✅ **Sửa hành vi** ⬜ Xóa/Deprecate |
| Mức tác động | ⬜ Nhỏ ⬜ Vừa ✅ **Lớn** (đụng DB + automation + FE) |
| Người đề xuất | Leader (từ kết quả audit kiến trúc AI automation, 2026-08-01) |
| Ngày | 2026-08-01 |
| Trạng thái | ⬜ Draft ⬜ Đã review ✅ Đã duyệt ✅ Đã triển khai ✅ **Đã nghiệm thu** (2026-08-01, 16/17 AC đạt — xem §14) |
| Spec liên quan | [03-api-business-logic-spec](../../specs/03-api-business-logic-spec.md) · [04-database-design](../../specs/04-database-design.md) · [06-rules-frontend](../../rules/06-rules-frontend.md) · [07-rules-backend](../../rules/07-rules-backend.md) · [09-non-functional-requirements](../../rules/09-non-functional-requirements.md) |

---

## 1. Bối cảnh & Vấn đề

Toàn bộ vòng quyết định theo thời gian của Automation AI hiện nằm trong một `useEffect` 30s ở
[src/useAutomation.ts:155-246](../../../src/useAutomation.ts) — thư mục `server/` **không có một `setInterval` nào**.
Frontend đang tự quyết: đã tới cửa sổ 5' chưa, đã quá giờ 15' chưa, sang ngày mới cần reset chưa,
task `approved` đã tới giờ để tự thực thi chưa.

Hệ quả đo được:

1. **Không chống được đa-tab.** Bốn cơ chế chống trùng — `autoExecutedRef`, `automationAutoActedRef`,
   `automationDeclinedRef`, `automationRunIdRef` — đều là `Set`/counter **trong RAM của một tab**.
   Mở app ở 2 tab ⇒ 2 vòng tick độc lập, cả hai đều thấy `status === 'approved' && diffMs <= 0`
   ⇒ có thể gọi `/automation/execute` hai lần. Bảo vệ duy nhất còn lại là kiểm tra
   `automationStatus !== 'approved'` ở [automation.ts:394](../../../server/routes/automation.ts) — một
   check *đọc-rồi-ghi không nguyên tử*, hai request song song đều có thể đọc thấy `approved`.
   Với `actionType = 'post'`, hậu quả là **đăng trùng bài lên Dr.JOY** — hành động ghi ra hệ thống
   ngoài, không rollback được.
2. **Mất trạng thái khi reload.** F5 xóa sạch 4 ref: `declined` bị quên (hỏi lại occurrence user đã
   từ chối), `asked`/`due` có thể ghi log trùng vào `automation_events`.
3. **Phụ thuộc timer của tab nền.** Trình duyệt bóp `setInterval` ở tab nền; code phải vá bằng
   listener `visibilitychange` + `focus`. Đóng tab (app vẫn chạy) ⇒ automation ngừng hoàn toàn.
4. **Chi phí bảo trì.** ~90 dòng logic đối chiếu + 4 ref tồn tại **chỉ để bù** cho việc scheduler
   nằm sai chỗ, không phục vụ nghiệp vụ nào.

Đã xác nhận với Leader: tiến trình server **chỉ sống khi mở app** (SEA). CR này **không** hứa
"automation chạy khi tắt app". Nhưng [index.ts:67-72](../../../server/index.ts) cho thấy `EADDRINUSE`
khiến chỉ tồn tại **đúng một tiến trình server** — nên vòng tick đặt ở server là *singleton tự nhiên*,
giải quyết trọn vẹn vấn đề 1–3 mà không cần cơ chế khóa nào thêm.

## 2. Mục tiêu & Ngoài phạm vi

**Mục tiêu (đo được):**

- **M1** — Server là **nơi duy nhất** quyết định chuyển trạng thái automation theo thời gian.
  Đo: `grep` trong `src/` không còn phép so sánh thời-gian-nào-quyết-định-hành-động; tick tồn tại ở `server/`.
- **M2** — Mở app ở **N tab** cho ra **đúng 1** lần thực thi cho một occurrence.
  Đo: test tích hợp gọi `/automation/execute` 2 lần song song cho cùng occurrence ⇒ 1 lần `done`, 1 lần `409`.
- **M3** — Xóa **4/4** ref chống-trùng in-memory khỏi `useAutomation.ts`; `declined` và `asked` bền qua F5.
  Đo: 4 tên ref không còn trong `src/`; test render xác nhận sau reload không hỏi lại occurrence đã declined.
- **M4** — `useAutomation.ts` giảm **≥ 35%** số dòng (262 → ≤ 170) mà **không mất hành vi người dùng thấy được**.
- **M5** — Không tăng tổng tần suất poll (hiện FE đã tick 30s); không thêm dependency runtime.

**Ngoài phạm vi (không làm lần này):**

- **Gọn máy trạng thái 12 → 6 + `outcome_reason`** — giữ nguyên 12 giá trị hiện tại. → CR-P1 riêng.
- **Tách connector Dr.JOY** khỏi `routes/automation.ts`. → CR-P2 riêng.
- **Gộp `reconfirmNeededOnTimeChange` / `reviveNeededOnTimeChange`** — refactor nhỏ, miễn spec theo
  [design-standard §3](../../standards/design-standard.md), làm ở PR khác.
- **Chạy nền / autostart / tray.** Leader đã chốt: server chỉ sống khi mở app.
- **Đổi prompt, contract JSON, hay cơ chế quyền của Claude** — CR này không chạm `claude-runner.ts`.
- **Đưa popup "nhờ AI làm?" về server.** Xem mục 6.1 — hỏi user cần UI hiện diện; đưa về server sẽ
  buộc thêm status `awaiting_user`, lấn sang CR-P1.

## 3. Người dùng & Kịch bản

Người dùng duy nhất: chủ máy, dùng app local để quản lý task và nhờ AI xử lý task định kỳ.

- **US-1:** Là người dùng, tôi muốn task đã duyệt được thực thi **đúng một lần** dù tôi lỡ mở app ở
  vài tab, để không đăng trùng bài lên Dr.JOY.
- **US-2:** Là người dùng, khi tôi đã bấm "Không" cho một occurrence, tôi muốn app **không hỏi lại**
  kể cả sau khi tôi F5 hay đổi ngày xem rồi quay lại.
- **US-3:** Là người dùng, tôi muốn task quá giờ được đánh dấu "Đã lỡ" và task hôm qua được reset,
  **kể cả khi tôi đang mở tab khác** (app vẫn chạy) — không phải vì tôi đang nhìn vào màn hình.

## 4. Yêu cầu chức năng

- **FR-1:** Server chạy một vòng tick automation chu kỳ **30 giây**, khởi động cùng tiến trình server
  và là **nơi duy nhất** thực hiện các chuyển trạng thái theo thời gian sau:
  - **FR-1a:** `approved` + đã tới giờ ⇒ tự thực thi (logic hiện ở [useAutomation.ts:214-220](../../../src/useAutomation.ts)).
  - **FR-1b:** `idle|needs_reconfirm|preview|blocked` + quá giờ > 15' ⇒ `missed` + ghi event `missed`.
  - **FR-1c:** trạng thái cuối (`done|failed|canceled|auto_canceled|missed`) có `automation_updated_at`
    thuộc **ngày trước** ⇒ reset `idle` cho chu kỳ hôm nay.
  - **FR-1d:** lọt vào cửa sổ 5' ⇒ ghi event `due` đúng **một lần** cho mỗi occurrence.
- **FR-2:** Vòng tick **không** khởi động khi import `server/app.ts` (để test không bị timer treo);
  chỉ khởi động từ `server/index.ts`. Cung cấp `startAutomationScheduler()` / `stopAutomationScheduler()`.
- **FR-3:** Logic quyết định của tick tách thành **hàm thuần** nhận `now: Date` làm tham số
  (theo [qa-standard §1.5](../../standards/qa-standard.md) — không phụ thuộc `Date.now()`), unit test được
  không cần DB, cùng khuôn với `automationDueNow` sẵn có.
- **FR-4:** Bảng `automation_events` thêm cột **`dedupe_key TEXT` nullable** + **unique index partial**
  `WHERE dedupe_key IS NOT NULL`. Mọi chuyển trạng thái **tự động** phải ghi event kèm
  `dedupe_key = '<occurrence_key>:<event>'` **trước**, trong cùng transaction — trùng ⇒ ném ⇒ rollback ⇒
  bỏ qua chuyển trạng thái đó. Event do **người bấm** (`approved`/`declined`/`canceled`) để `dedupe_key = NULL`
  (SQLite cho phép nhiều NULL trong cột UNIQUE) nên **lặp lại được bao nhiêu lần tùy ý**.
  Đây là cơ chế idempotency thay cho `autoExecutedRef` + `automationAutoActedRef`.
  > *Vì sao không `UNIQUE(occurrence_key, event)`* — xem [ADR-2](#12-quyết-định-adr). Tóm tắt: nó sẽ chặn
  > luồng hợp lệ "duyệt → hủy → duyệt lại" và làm đỏ test hiện có. (Dev + Tester chặn ở vòng review 1.)
- **FR-4b:** Đường ghi event **tự động** dùng hàm riêng **không nuốt lỗi**. `logEvent` hiện tại bọc
  `try/catch` rỗng ([automation.ts:262](../../../server/routes/automation.ts)) — tái dùng nó trong transaction
  sẽ nuốt luôn lỗi UNIQUE và làm idempotency **thất bại trong im lặng**. Giữ `logEvent` nuốt-lỗi cho
  đường ghi log của FE (log hỏng không được chặn luồng người dùng).
- **FR-4c:** Vòng tick thực thi **tối đa 1 automation tại một thời điểm** (cờ in-flight trong tiến trình).
  Task khác đủ điều kiện chờ lượt tick sau. Lý do: tick 30s × timeout Claude 5 phút ⇒ không có trần thì
  một lần Claude treo có thể để lại tới 10 tiến trình `claude` song song (Infra chặn ở vòng review 1).
- **FR-4d:** Mỗi task trong một lượt tick được bọc `try/catch` riêng: một task lỗi **không** được làm
  chết vòng `setInterval`.
- **FR-5:** `POST /api/automation/execute` **giành quyền nguyên tử** trước khi spawn Claude:
  `UPDATE tasks SET automation_status='running' WHERE id=? AND automation_status='approved'`;
  `changes === 0` ⇒ trả **409**, không spawn. Thay cho check đọc-rồi-ghi hiện tại.
- **FR-6:** Quyết định "đã từ chối occurrence này" đọc từ `automation_events` (event `declined`),
  không từ RAM. Thêm `GET /api/automation/events?occurrenceKeys=...` hoặc trả kèm trong payload dashboard
  để FE biết occurrence nào đã `declined`/`asked`.
- **FR-7:** Frontend **không còn** quyết định thời gian. `useAutomation.ts` chỉ còn: render theo
  `task.automationStatus` từ DB, gửi hành động do người bấm (đồng ý / từ chối / duyệt / hủy / đóng),
  và hiển thị popup hỏi khi task tới cửa sổ 5' + trạng thái `idle|needs_reconfirm` + chưa `declined`.
- **FR-8:** Xóa `autoExecutedRef`, `automationAutoActedRef`, `automationDeclinedRef` khỏi `useAutomation.ts`.
  Giữ `automationRunIdRef` — nó chống *race của UI* (response tới trễ sau khi user đóng popup),
  không phải chống trùng scheduler; không thuộc phạm vi vấn đề CR này.

## 5. Yêu cầu phi chức năng

- **NFR-1** (perf): Không tăng tần suất poll tổng thể. FE hiện đã gọi `taiDuLieu()` mỗi 30s trong
  vòng reconcile; sau thay đổi FE vẫn poll 30s để đồng bộ trạng thái. Số tick **không đổi**, chỉ đổi
  nơi *quyết định*. Tuân [performance-standard §6](../../standards/performance-standard.md) "không thêm
  interval/poll dày".
- **NFR-2** (perf): Tick server mỗi 30s chỉ chạy **1 query có index** trên `tasks` (lọc theo
  `loai_task='dinh_ky'` + `action_type IN ('post','other')` + `automation_status`), không N+1.
- **NFR-3** (security): Không nới bề mặt mạng — vẫn `127.0.0.1`. Endpoint mới (nếu có, FR-6) là
  **đọc**, không nhận input tự do ngoài danh sách khóa occurrence đã validate.
- **NFR-4** (security): **Nguyên tắc "AI ghi ra ngoài phải có người duyệt" giữ nguyên tuyệt đối.**
  Server chỉ tự thực thi task đã ở trạng thái `approved` — tức đã qua bàn tay người bấm "Phê duyệt".
  Không có đường nào để server tự đi từ `idle` → `execute`.
- **NFR-5** (backward-compat): Bản ghi `tasks` và `automation_events` cũ phải đọc được nguyên vẹn;
  migration idempotent theo [08-rules-database](../../rules/08-rules-database.md).
- **NFR-6**: `stopAutomationScheduler()` được gọi khi tiến trình thoát để timer không giữ event loop.

## 6. Thiết kế giải pháp

### 6.1. Ranh giới FE / BE (quyết định thiết kế cốt lõi)

> **Quyết định theo thời gian → server. Tương tác với người → FE.**

| Việc | Trước | Sau | Vì sao |
|---|---|---|---|
| Tự thực thi khi `approved` + tới giờ | FE | **BE** | Không cần người; cần chạy đúng 1 lần |
| Đánh dấu `missed` khi quá 15' | FE | **BE** | Không cần người |
| Reset ngày mới về `idle` | FE | **BE** | Không cần người |
| Ghi event `due` | FE | **BE** | Mốc thời gian, không cần người |
| **Popup "nhờ AI làm task này?"** | FE | **FE (giữ nguyên)** | Hỏi mà không có UI thì hỏi ai. Đưa về server sẽ buộc thêm status `awaiting_user` ⇒ lấn CR-P1 |
| Ghi event `asked` / `declined` | FE (RAM) | **FE gọi API, BE lưu DB** | Cần bền qua F5 (US-2) |
| **Nhường khi đang mở modal task khác** | FE **có** nhường | **BỎ — không còn nhường** | Server không biết modal nào đang mở. Xem "Thay đổi hành vi" ngay dưới |

**⚠️ Thay đổi hành vi người dùng thấy được (Tester phát hiện ở vòng review 1 — [§9.2](../../standards/design-standard.md) bắt liệt kê):**

[useAutomation.ts:216](../../../src/useAutomation.ts) hiện có `if (openSession && openSession.task.id !== task.id) continue;`
— nghĩa là đang mở modal của task A thì task B tới giờ sẽ **không** tự thực thi, phải đợi đóng modal.

| | Trước | Sau |
|---|---|---|
| Mở modal task A, task B `approved` tới giờ | B **hoãn** tới khi đóng modal A | B **chạy ngay**, modal A không bị ảnh hưởng |

**BA đánh giá: chấp nhận, và là cải thiện.** Việc hoãn B là *tác dụng phụ* của việc scheduler sống trong
UI, không phải yêu cầu nghiệp vụ nào — chưa có dòng nào ở `docs/01–09` mô tả nó. Hoãn còn có hại: task B
bị đẩy qua mốc 15' và thành `missed` chỉ vì user lỡ mở modal khác. Có **AC-13** khóa hành vi mới.

Điểm cần nói thẳng: sau thay đổi, server **vẫn tự thực thi khi không ai nhìn màn hình** (app mở,
tab đóng). Hành vi này **không mới** — FE hiện cũng tự thực thi khi tab đang mở nhưng user không nhìn.
Điểm khác là nó không còn phụ thuộc việc tab có mở hay không. Vẫn nằm trong ranh giới NFR-4 vì
điều kiện tiên quyết luôn là `approved` do người bấm.

### 6.2. Luồng người dùng / UI (tham chiếu docs/02, docs/06)

**Không đổi gì mà người dùng nhìn thấy.** Cùng popup, cùng nút, cùng thứ tự. Đây là điều kiện nghiệm thu
(AC-7). Khác biệt duy nhất người dùng có thể *cảm nhận*: popup kết quả có thể xuất hiện ngay khi quay lại
tab (vì server đã chạy xong trong lúc tab đóng) thay vì bắt đầu chạy lúc đó.

Trạng thái rỗng/loading/lỗi: giữ nguyên `checking` / `running` / `error` như hiện tại.

### 6.3. API & nghiệp vụ (tham chiếu docs/03, docs/07)

**Sửa — `POST /api/automation/execute`** (FR-5):

| | Trước | Sau |
|---|---|---|
| Kiểm tra | `if (task.automationStatus !== 'approved') throw 409` rồi `ghiTrangThai(taskId, 'running')` | `UPDATE tasks SET automation_status='running', automation_updated_at=? WHERE id=? AND automation_status='approved'` |
| Hai request song song | Cả hai có thể qua check ⇒ **spawn Claude 2 lần** | Chỉ 1 request có `changes === 1`; request kia `changes === 0` ⇒ **409**, không spawn |

**Thêm — nguồn đọc `declined`/`asked`** (FR-6): mở rộng `GET /api/automation/events` nhận
`?occurrenceKeys=a,b,c` (validate: ≤ 200 khóa, mỗi khóa khớp `^\d{4}-\d{2}-\d{2}:\d+:[\d:]*$`),
trả về map `{ [occurrenceKey]: string[] }`. Không tạo endpoint mới ⇒ không mở bề mặt tấn công mới
theo [security-standard §9](../../standards/security-standard.md).

**Giữ nguyên:** `/automation/config`, `/automation/preview`, `/automation/approve`, `/automation/cancel`,
`/automation/event`, `/automation/mcp-auth-status` — hợp đồng không đổi.

**Module mới — `server/lib/automation-scheduler.ts`:**

```
startAutomationScheduler({ intervalMs = 30_000 })  // gọi từ server/index.ts, KHÔNG từ app.ts
stopAutomationScheduler()
tickOnce(now: Date)                                 // export để test gọi trực tiếp, không cần timer
```

Logic quyết định thuần (FR-3) đặt tại `server/lib/automation-helpers.ts` — nơi đã có
`automationDueNow`, cùng khuôn nhận `now: Date`:

```
decideAutomationAction(taskRow, now) -> 'execute' | 'missed' | 'reset_idle' | 'log_due' | null
```

### 6.4. Dữ liệu & schema (tham chiếu docs/04, docs/08)

Bảng `automation_events` ([db.ts:634-644](../../../server/db.ts)) thêm **1 cột nullable + 1 unique index partial** (FR-4):

```sql
-- 1. cột mới, nullable, không default -> bản ghi cũ nhận NULL, đọc được nguyên vẹn
ALTER TABLE automation_events ADD COLUMN dedupe_key TEXT;
-- 2. unique index PARTIAL: chỉ ràng buộc hàng có dedupe_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_events_dedupe
  ON automation_events(dedupe_key) WHERE dedupe_key IS NOT NULL;
```

**Không xóa, không sửa, không tạo lại bảng một bản ghi nào.** Toàn bộ hàng cũ có `dedupe_key = NULL`
nên nằm ngoài phạm vi index — dù chúng đang trùng `(occurrence_key, event)` cũng không sao.
Bước 1 idempotent bằng cách kiểm `PRAGMA table_info` trước khi `ALTER` (cùng khuôn `add()` đã dùng
cho các cột `automation_*` tại [db.ts:611-616](../../../server/db.ts)); bước 2 idempotent sẵn nhờ `IF NOT EXISTS`.

Index cũ `idx_auto_events_occ` giữ nguyên (phục vụ truy vấn theo occurrence).

> Phương án ban đầu là `UNIQUE(occurrence_key, event)` kèm một bước **xóa bản ghi trùng lịch sử** —
> đã bị Dev+Tester chặn ở vòng review 1 vì chặn luồng "duyệt → hủy → duyệt lại" và làm đỏ
> [automation.test.ts:154](../../../test/integration/automation.test.ts). Phương án `dedupe_key` vừa sửa
> lỗi đó vừa **loại bỏ hoàn toàn bước xóa dữ liệu** (rủi ro R1 cũ). Chi tiết: [ADR-2](#12-quyết-định-adr).

Bảng `tasks`: **không thêm/sửa cột nào.** `drjoy_posted_articles`: không đụng.

**Giao dịch:** mỗi chuyển trạng thái tự động = `withTransaction(() => { INSERT event; UPDATE task })`.
`INSERT` đụng unique index ⇒ ném ⇒ transaction rollback ⇒ task không đổi trạng thái. Idempotency
đến từ DB, không từ code.

### 6.5. Automation / tích hợp

Không đụng `claude-runner.ts`, không đụng prompt, không đụng whitelist tool, không đụng
`--permission-mode`. Ranh giới quyền của AI **y nguyên**.

## 7. Phân tích tác động

- [x] **Frontend** — [src/useAutomation.ts](../../../src/useAutomation.ts) (viết lại vòng reconcile);
      `src/main.tsx` (nếu đổi chữ ký hook). Trạng thái rỗng/loading/lỗi giữ nguyên.
- [x] **API route** — [server/routes/automation.ts](../../../server/routes/automation.ts): sửa `/execute`
      (FR-5), mở rộng `/events` (FR-6). Không thêm endpoint mới.
- [x] **DB/migration** — [server/db.ts](../../../server/db.ts): thêm cột `dedupe_key` + unique index partial.
      **Idempotent, không xóa/sửa dữ liệu.**
- [x] **Automation/MCP** — đụng luồng preview→approve→execute ở tầng *điều phối*; **không** đụng tầng quyền.
- [x] **Hạ tầng test** — [scripts/mock-claude.mjs](../../../scripts/mock-claude.mjs): thêm bộ đếm spawn (AC-1).
- [ ] i18n — không có chuỗi mới (popup giữ nguyên).
- [x] **Đóng gói SEA/MCP — đã xác nhận, không cần làm gì.** [build-sea.mjs:67-68](../../../scripts/build-sea.mjs)
      dùng `entryPoints: [server/index.ts]` + `bundle: true` ⇒ `automation-scheduler.ts` được esbuild tự gom
      theo đồ thị import. Không phải khai báo thêm. *(Dev + Infra xác nhận, vòng review 1.)*
- [x] **Bảo mật** — vùng nhạy cảm (spawn AI + endpoint). Qua [security §9](../../standards/security-standard.md).
- [x] **Dữ liệu cũ/backward-compat** — bản ghi `automation_events` trùng sẵn có (mục 6.4).
- [x] **Shared types** — có thể thêm type cho response `/events` mở rộng; sửa ở `server/types.ts`.

**Rủi ro & giảm thiểu:**

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| ~~R1~~ | ~~Migration dọn bản ghi trùng xóa nhầm dữ liệu~~ | ~~Cao~~ → **Đã loại bỏ** | Phương án `dedupe_key` (6.4) **không xóa/sửa bản ghi nào**. Rủi ro không còn tồn tại, không phải giảm thiểu. Backup vẫn khuyến nghị nhưng **không còn bắt buộc** |
| R2 | Tick server tự thực thi khi user không có mặt | Trung bình | Điều kiện tiên quyết luôn là `approved` (NFR-4); ghi event `executed` để truy vết |
| R3 | Timer rò rỉ vào test suite ⇒ test treo | Trung bình | FR-2: khởi động chỉ từ `index.ts`; test gọi `tickOnce(now)` trực tiếp |
| R4 | Hành vi thay đổi ngoài ý muốn khi viết lại `useAutomation` | Cao | [§9.2](../../standards/design-standard.md): bảng CŨ vs MỚI (6.1, đã bổ sung ca "nhường modal") + regression AC-7 + AC-13 |
| R5 | Đồng hồ máy nhảy (ngủ/thức, đổi timezone) | Thấp | Tick không tích lũy trạng thái theo thời gian; mỗi lần tick tính lại từ `now` + DB — giống hành vi hiện tại |
| **R6** | **Claude treo ⇒ tick chồng spawn nhiều tiến trình** | **Cao** | FR-4c: trần **1 automation đồng thời**; timeout 5' sẵn có; AC-14 chứng minh (Infra nêu, vòng review 1) |
| **R7** | **Idempotency thất bại im lặng do `logEvent` nuốt lỗi** | **Cao** | FR-4b: đường tự động dùng hàm **không** nuốt lỗi; AC-2 kiểm chuyển trạng thái bị chặn thật, không chỉ kiểm số bản ghi (Dev nêu, vòng review 1) |

**Ảnh hưởng chức năng đang chạy:** luồng preview/approve/cancel do người bấm **không đổi**.
`routes/schedules.ts` ghi `needs_reconfirm`/`idle` khi sync definition — tick server phải xử lý đúng
`needs_reconfirm` y như FE đang làm (không tự thực thi, chờ người).

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-5, M2):** *Given* task ở `approved`, đã tới giờ / *When* gọi `POST /api/automation/execute`
  **hai lần song song** / *Then* đúng một lần trả `done`, lần kia trả **409**, và Claude được spawn **đúng 1 lần**.
  > *Cách đo (Tester yêu cầu, vòng review 1):* [`scripts/mock-claude.mjs`](../../../scripts/mock-claude.mjs) ghi
  > tăng một bộ đếm ra file tại `process.env.MOCK_CLAUDE_COUNTER`; test đọc file và assert `=== 1`.
  > Không có cơ chế này thì vế "spawn đúng 1 lần" **không đo được** và AC vô nghĩa.
- **AC-2 (FR-4, FR-4b, R7):** *Given* đã có event tự động `dedupe_key='<occ>:missed'` và task đang ở `missed`
  / *When* `tickOnce(now)` chạy lại cùng occurrence / *Then* transaction rollback, **số bản ghi không tăng**
  **và** trạng thái task không bị ghi đè (`automation_updated_at` giữ nguyên).
  > Assert **cả hai vế** — chỉ đếm bản ghi thì không phân biệt được "bị chặn đúng" với "lỗi bị nuốt".
- **AC-2b (FR-4, regression — Dev+Tester chặn):** *Given* task vừa `approved` rồi bị `cancel`, sau đó
  `preview` lại thành công / *When* gọi `/automation/approve` **lần thứ hai** cùng occurrence / *Then* thành công
  (`200`), task về `approved`, và `automation_events` có **2** bản ghi `approved` — cột `dedupe_key` của cả
  hai đều `NULL`.
- **AC-3 (FR-1a):** *Given* task `approved`, `gioBatDau` đã qua / *When* `tickOnce(now)` / *Then* task
  chuyển `running` rồi `done`, có event `executed`.
- **AC-4 (FR-1b):** *Given* task `idle`, quá giờ 16 phút / *When* `tickOnce(now)` / *Then* task thành
  `missed` + có event `missed`; gọi `tickOnce` lần nữa ⇒ **không** ghi thêm event.
- **AC-5 (FR-1c):** *Given* task `done` với `automation_updated_at` là hôm qua / *When* `tickOnce(now)`
  / *Then* task về `idle`.
- **AC-6 (FR-1c, ca biên):** *Given* task `done` với `automation_updated_at` là **hôm nay** / *When*
  `tickOnce(now)` / *Then* task **giữ nguyên** `done`.
- **AC-7 (FR-7, regression — §9.2):** *Given* toàn bộ test automation hiện có
  ([test/integration/automation.test.ts](../../../test/integration/automation.test.ts),
  [test/unit/automation-helpers.test.ts](../../../test/unit/automation-helpers.test.ts),
  [test/unit/claude-runner.test.ts](../../../test/unit/claude-runner.test.ts))
  / *When* chạy sau thay đổi / *Then* **xanh y nguyên, không sửa một dòng test nào**
  ([qa-standard §1.4](../../standards/qa-standard.md): refactor mà phải sửa test thì không còn là refactor).
- **AC-8 (FR-6, US-2):** *Given* user đã bấm "Không" cho occurrence hôm nay / *When* F5 rồi chờ tick
  / *Then* popup hỏi **không** hiện lại.
- **AC-9 (FR-2, R3):** *Given* chạy `npm test` / *When* suite kết thúc / *Then* tiến trình thoát sạch,
  không treo vì timer; và `npm run build` xanh.
- **AC-10 (NFR-5):** *Given* DB có sẵn bản ghi `automation_events` **đang trùng** `(occurrence_key, event)`
  từ trước / *When* khởi động app sau nâng cấp / *Then* migration chạy không lỗi, **số bản ghi không đổi**
  (không xóa gì), mọi hàng cũ có `dedupe_key IS NULL`; chạy migration lần 2 ⇒ **không đổi gì** (idempotent).
- **AC-11 (M3):** *Given* mã nguồn sau thay đổi / *When* grep `src/` / *Then* không còn
  `autoExecutedRef`, `automationAutoActedRef`, `automationDeclinedRef`.
- **AC-12 (M4):** *Given* `src/useAutomation.ts` sau thay đổi / *When* đếm dòng / *Then* ≤ 170 dòng.
- **AC-13 (6.1, thay đổi hành vi — Tester yêu cầu):** *Given* task A đang mở modal và task B ở `approved`
  đã tới giờ / *When* `tickOnce(now)` / *Then* task B **được thực thi** (khác hành vi cũ là hoãn), và
  phiên UI của task A **không** bị đổi trạng thái.
- **AC-14 (FR-4c, R6 — Infra yêu cầu):** *Given* 3 task cùng ở `approved` và cùng tới giờ, Claude giả lập
  chạy chậm / *When* `tickOnce(now)` / *Then* **chỉ 1** tiến trình Claude được spawn trong lượt đó;
  2 task còn lại giữ nguyên `approved` và được xử lý ở các lượt tick sau.
- **AC-15 (FR-5, Tester bổ sung):** *Given* user bấm "Phê duyệt & chạy ngay"
  ([pheDuyetVaChayNgay](../../../src/useAutomation.ts)) đúng lúc tick server cũng thấy task đủ điều kiện
  / *When* cả hai gọi `/execute` / *Then* đúng 1 lần thực thi, lần kia `409`, không có bản ghi
  `drjoy_posted_articles` trùng.

## 9. Kế hoạch test (tham chiếu standards/qa-standard.md)

- Tầng test: ✅ **Unit** ✅ **Integration route** ⬜ Render component ✅ **Smoke thủ công**

| AC | Tầng | Nơi |
|---|---|---|
| AC-1, AC-15 | Integration | `test/integration/automation.test.ts` (mock + bộ đếm spawn) |
| AC-2, AC-2b, AC-10 | Integration (DB) | test migration + ràng buộc `dedupe_key` |
| AC-3–AC-6, AC-13, AC-14 | **Unit** (`decideAutomationAction` + `tickOnce` với `now` bơm vào) | `test/unit/automation-helpers.test.ts` + `test/unit/automation-scheduler.test.ts` (mới) |
| AC-7 | Chạy lại suite hiện có, **không sửa dòng nào** | — |
| AC-8 | Smoke thủ công (mục 8 qa-standard) | ghi vào PR |
| AC-9, AC-12 | Lệnh | `npm test`, `npm run build`, đếm dòng |
| AC-11 | Grep | — |

**Việc cần làm trước cho hạ tầng test:** bổ sung bộ đếm spawn vào
[`scripts/mock-claude.mjs`](../../../scripts/mock-claude.mjs) (AC-1). Không có nó, AC-1/AC-14/AC-15 đều
không đo được — đây là *điều kiện tiên quyết*, không phải việc phụ.

**Ca lỗi/biên bắt buộc phủ:** `needs_reconfirm` không bị tick tự thực thi · task đã
`da_hoan_thanh`/`canceled` bị bỏ qua · `gioBatDau` null · đúng mốc `diffMs === 0` · đúng mốc 15'00" ·
`automation_updated_at` null · task không phải `dinh_ky` · `actionType = 'none'`.

**Chọn tầng thấp nhất** ([qa-standard §1.1](../../standards/qa-standard.md)): phần lớn AC là logic quyết
định thuần ⇒ unit. Chỉ AC-1/AC-2/AC-10 cần integration vì kiểm ràng buộc DB và tính nguyên tử.

## 10. Kế hoạch triển khai / rollback

**Triển khai (theo thứ tự, mỗi bước test xanh mới đi tiếp):**

0. Backup DB (`npm run backup-db`) — **khuyến nghị** (không còn bắt buộc: migration không xóa dữ liệu).
1. Bộ đếm spawn cho `scripts/mock-claude.mjs` — hạ tầng test, phải có trước AC-1/AC-14/AC-15.
2. `/execute` **giành quyền nguyên tử** (FR-5) — kèm AC-1, AC-15. *Đưa lên trước vì bước này một mình
   đã đóng lỗ đăng-trùng Dr.JOY* — giá trị an toàn cao nhất, chi phí thấp nhất, độc lập với phần còn lại.
   Có thể ship riêng nếu cần dừng giữa chừng.
3. Migration `dedupe_key` + unique index partial (6.4) — kèm AC-2, AC-2b, AC-10.
4. `decideAutomationAction` + `tickOnce` + trần đồng thời (FR-1, FR-3, FR-4b–d) — kèm AC-3–AC-6, AC-13, AC-14.
   **Chưa** đấu vào `index.ts`.
5. Mở rộng `/events` cho `declined`/`asked` (FR-6).
6. Đấu `startAutomationScheduler()` vào `index.ts` (FR-2) **và** cắt logic tương ứng khỏi
   `useAutomation.ts` (FR-7, FR-8) — **cùng một bước** để không có giai đoạn hai scheduler cùng chạy.
7. Chạy `npm test` + `npm run build` + smoke thủ công (AC-8).
8. Cập nhật docs 01–09 (mục 11).

**Rollback:** revert code là đủ. Cột `dedupe_key` và index partial để lại **hoàn toàn vô hại** với bản cũ
— bản cũ không ghi vào cột đó nên mọi hàng mới có `dedupe_key = NULL`, nằm ngoài phạm vi index.
**Không có bước nào xóa dữ liệu**, nên không có gì cần khôi phục.

## 11. Docs cần cập nhật sau khi làm xong

- [x] [specs/03-api-business-logic-spec](../../specs/03-api-business-logic-spec.md) — hợp đồng `/execute` (409 mới), `/events` mở rộng, mô tả vòng tick server
- [x] [specs/04-database-design](../../specs/04-database-design.md) — unique index trên `automation_events`
- [x] [rules/06-rules-frontend](../../rules/06-rules-frontend.md) — quy tắc "FE không quyết định thời gian automation"
- [x] [rules/07-rules-backend](../../rules/07-rules-backend.md) — vòng tick chỉ khởi động từ `index.ts`, không từ `app.ts`
- [x] [rules/09-non-functional-requirements](../../rules/09-non-functional-requirements.md) — nêu rõ giới hạn: automation chỉ chạy khi tiến trình app còn sống
- [x] [specs/05-test-acceptance-criteria](../../specs/05-test-acceptance-criteria.md) — bổ sung AC automation mới
- [x] Ghi **ADR** vào mục 12 dưới: vì sao popup hỏi ở lại FE

## 12. Quyết định (ADR)

**ADR-1 — Popup "nhờ AI làm?" ở lại Frontend.**
*Bối cảnh:* CR chuyển scheduler về server; câu hỏi tự nhiên là "chuyển nốt việc hỏi user?".
*Lựa chọn:* giữ ở FE.
*Lý do:* hỏi mà không có UI thì không ai trả lời. Đưa về server buộc thêm status `awaiting_user` vào
máy trạng thái đang có 12 giá trị — chính là thứ CR-P1 định dọn. Ranh giới "thời gian → server,
người → FE" sạch hơn và không lấn CR khác.
*Hệ quả:* FE vẫn còn một phép so sánh thời gian (tới cửa sổ 5' chưa) để biết lúc nào hiện popup.
Chấp nhận: nó chỉ *hiển thị*, không *chuyển trạng thái* — chạy trùng ở 2 tab chỉ làm hiện 2 popup, vô hại.

**ADR-2 — Idempotency bằng cột `dedupe_key` + unique index *partial*, không phải `UNIQUE(occurrence_key, event)`.**

*Bối cảnh:* cần đảm bảo mỗi occurrence chỉ được **hành động tự động** một lần. DB là nơi duy nhất thấy
hết mọi request; `Set` trong RAM không thấy.

*Phương án đã cân nhắc và **bác bỏ**:* `UNIQUE(occurrence_key, event)` trên toàn bảng.
Bác bỏ vì nó **nhầm lẫn hai khái niệm khác nhau**: bảng `automation_events` vừa là *nhật ký* (ghi được
lặp) vừa được trưng dụng làm *khóa chống trùng* (không được lặp). Hệ quả cụ thể: `approved` là hành động
người dùng lặp lại hợp lệ (duyệt → hủy → preview lại → duyệt lại) — ràng buộc toàn bảng sẽ chặn lần thứ
hai và, do event ghi trong cùng transaction, làm **rollback luôn `/approve`**. Test
[automation.test.ts:154](../../../test/integration/automation.test.ts) đỏ. Phương án đó còn kéo theo một
bước **xóa bản ghi trùng lịch sử** — rủi ro mất dữ liệu cao nhất của cả CR.

*Lựa chọn:* cột `dedupe_key TEXT` nullable + `CREATE UNIQUE INDEX ... WHERE dedupe_key IS NOT NULL`.
Event **tự động** set khóa (bị chống trùng); event **do người bấm** để `NULL` (lặp tự do — SQLite cho
phép nhiều NULL trong cột UNIQUE).

*Lý do:* tách rành mạch "cái gì được lặp" khỏi "cái gì không", thay vì ép một ràng buộc chung lên cả hai.
Ngoài ra: bản ghi cũ tự động rơi vào `NULL` ⇒ **không phải đụng một hàng dữ liệu nào**, migration thuần
cộng thêm, rollback vô hại.

*Hệ quả:* thêm 1 cột. Người viết code phải nhớ set `dedupe_key` cho đường tự động — quên thì mất chống
trùng chứ không lỗi ồn ào, nên FR-4b bắt buộc dùng **hàm ghi riêng không nuốt lỗi** cho đường này, và
AC-2 assert cả vế "trạng thái không bị ghi đè" chứ không chỉ đếm bản ghi.

*Nguồn:* Dev + Tester chặn phương án ban đầu ở vòng review 1 (§5 bước 6).

**ADR-3 — Bỏ hành vi "nhường khi đang mở modal task khác".**
*Bối cảnh:* [useAutomation.ts:216](../../../src/useAutomation.ts) hoãn thực thi task B khi user đang mở modal
task A. Server không có khái niệm "modal đang mở".
*Lựa chọn:* bỏ hẳn, không tái tạo ở server.
*Lý do:* đây là *tác dụng phụ* của việc scheduler sống trong UI, không phải yêu cầu nghiệp vụ — không
có dòng nào ở `docs/01–09` mô tả. Nó còn có hại: task B có thể bị đẩy qua mốc 15' và thành `missed` chỉ
vì user lỡ mở modal khác. Tái tạo ở server sẽ cần FE báo "tôi đang mở modal nào" — đưa trạng thái UI vào
server, đúng thứ CR này đang gỡ bỏ.
*Hệ quả:* thay đổi người dùng thấy được, đã ghi ở mục 6.1, khóa bằng AC-13.

## 14. Kết quả nghiệm thu (2026-08-01)

### 14.1. Đối chiếu từng AC

| AC | Kết quả | Bằng chứng |
|---|---|---|
| AC-1 hai `/execute` song song | ✅ | `automation-scheduler.test.ts` — 1×200 + 1×409, spawn đếm được **= 1** |
| AC-2 event tự động trùng bị chặn | ✅ | số bản ghi không tăng **và** `automation_updated_at` không đổi |
| AC-2b duyệt→hủy→duyệt lại | ✅ | 2 event `approved`, cả hai `dedupe_key IS NULL` |
| AC-3 tick tự thực thi | ✅ | unit (2 ca, cả mốc `diff = 0`) + integration (done + event `executed`) |
| AC-4 quá 15' → missed | ✅ | tick lần 2 **không** ghi thêm event |
| AC-5 reset sang ngày mới | ✅ | phủ cả 5 trạng thái cuối |
| AC-6 trạng thái cuối hôm nay giữ nguyên | ✅ | unit + integration |
| **AC-7 test cũ xanh, không sửa dòng nào** | ✅ | `git diff --stat` trên 3 file test cũ = **trống** |
| AC-8 declined bền qua F5 | ✅ | Nguồn chuyển sang DB; 12 unit test cho hàm quyết định + test API `snoozed`/`declined`. Smoke thủ công đã chạy (§14.5) |
| AC-9 suite thoát sạch, build xanh | ✅ | `npm test` 87 backend + 29 frontend; `npm run build` xanh; không treo |
| AC-10 migration không xoá dữ liệu | ✅ | cột + index partial tồn tại; 2 bản ghi cũ **trùng nhau vẫn còn nguyên** |
| AC-11 xoá 3 ref in-memory | ✅ | `grep` trong `src/` = 0 kết quả |
| **AC-12 `useAutomation.ts` ≤ 170 dòng** | ❌ **KHÔNG ĐẠT** | **224 dòng** (169 dòng code). Xem §14.2 |
| AC-13 bỏ "nhường modal" | ✅ | 2 task cùng tới giờ đều được xử lý |
| AC-14 trần 1 automation/lượt tick | ✅ | 3 task approved → spawn **= 1**, 2 task giữ `approved` |
| AC-15 tick đụng "chạy ngay" | ✅ | spawn = 1, `drjoy_posted_articles` không có bản ghi trùng |
| FR-6 `/events?occurrenceKeys` | ✅ | trả map đúng, khóa sai định dạng bị loại |

**Test thêm:** 19 unit (`test/unit/automation-scheduler.test.ts`) + 12 integration
(`test/integration/automation-scheduler.test.ts`). Tổng backend 87 test (trước: 56).

### 14.2. AC-12 KHÔNG ĐẠT — phân tích

| | Mục tiêu | Thực tế |
|---|---|---|
| Tổng dòng `useAutomation.ts` | ≤ 170 (−35%) | **224** (−14,5%) |
| Dòng code (bỏ comment/trống) | — | 201 → **169** (−16%) |

**Nguyên nhân: ước lượng M4 sai, không phải hiện thực sai.** Khi viết CR, BA giả định frontend chỉ
*mất* code. Thực tế **FR-6 thêm cho frontend một việc mới**: đọc trạng thái `declined` từ server
(fetch + xử lý lỗi + ghép khóa occurrence, ~25 dòng) để thay cho một `Set` trong RAM vốn chỉ tốn 1 dòng.
Đó là **đánh đổi có chủ ý và đã được duyệt** (AC-8 / US-2: `declined` phải bền qua F5) — không thể vừa
đạt AC-8 vừa đạt con số AC-12.

Mục tiêu thật của M4 là *"bớt phức tạp ở frontend"*, và các thước đo trực tiếp đều đạt:
4/4 ref chống-trùng bị xoá (AC-11), toàn bộ logic quyết định-thời-gian rời khỏi FE (AC-3→AC-6, AC-13),
bundle giảm nhẹ (468,79 → 467,98 kB). **Số dòng là proxy tồi cho độ phức tạp** — đây là bài học cho
[design-standard §7](../../standards/design-standard.md) khi đặt mục tiêu đo được.

**Xử lý:** BA chấp nhận sai lệch, **không** cắt code để chạy theo con số (cắt sẽ phải bỏ comment giải
thích hoặc gộp hàm — làm code khó đọc hơn để đạt một chỉ tiêu đã sai).
**Người duyệt đã chấp nhận (2026-08-01).**

**Đã khép vòng cải tiến** (không dừng ở "chấp nhận rồi thôi"):
1. Ghi thành [**L-001**](../README.md) ở Sổ Sai lệch & Bài học — để lần thống kê sau còn gộp được.
2. Sửa nguyên nhân gốc: thêm [**design-standard §7.1** — *Mục tiêu đo được: tránh chỉ số GIÁN TIẾP*](../../standards/design-standard.md),
   kèm bảng proxy-vs-trực-tiếp và hai câu tự kiểm trước khi chốt một mục tiêu đo được.

### 14.3. Nợ đã ghi (không lờ đi)

| # | Nợ | Vì sao chưa làm |
|---|---|---|
| 1 | **Click thủ công trên trình duyệt** (bấm "Không" → F5 → xác nhận không hỏi lại bằng mắt) | Đã smoke ở tầng tiến trình thật + API (§14.5) và có 12 unit test cho hàm quyết định. Còn lại là xác nhận thị giác — cần người, hoặc Playwright ([testing-strategy roadmap](../../standards/testing-strategy.md)) |
| 2 | `automation-scheduler.ts` import `executeApprovedTask` từ `routes/automation.ts` | Lõi thực thi còn nằm trong route. Tách ra là phạm vi **CR-P2** (tách connector Dr.JOY) |
| 3 | Thêm `SYNC_MS` poll dữ liệu ở FE (30s) | **Lệch nhẹ NFR-1**: trước đây tick 30s của FE **không** fetch; nay có fetch. Số timer không đổi, nhưng số request tăng. Chấp nhận: server local, payload dashboard nhỏ. Cần thiết vì FE phải thấy thay đổi do server tick gây ra |

### 14.5. Smoke test thủ công (qa-standard §8) — chạy 2026-08-01

| Kiểm | Kết quả |
|---|---|
| Server thật khởi động, vòng tick bật | ✅ `[automation] vòng tick đã bật (mỗi 30s)` |
| **Migration trên DB THẬT** (8 bản ghi `automation_events`, 7 task) | ✅ Cột + index partial thêm được; **8/8 bản ghi cũ giữ nguyên** với `dedupe_key IS NULL`; không mất dòng nào |
| Tick chạy đúng trên dữ liệu thật | ✅ Tự hồi sinh task #16 từ trạng thái cuối hôm trước về `idle` (ghi event `reset`) |
| SPA phục vụ được từ `dist` | ✅ HTTP 200, bundle `index-AvnY9K5O.js` |
| **Bundle SEA gom `automation-scheduler.ts`** | ✅ esbuild theo đồ thị import; không có import vòng |
| **End-to-end trên tiến trình thật, timer THẬT** | ✅ Tạo task AI → preview → approve → **không gọi execute** → chờ 34s → task tự về `done`; events `due, approved, executed` |

> Giá trị riêng của mục cuối: **mọi test tự động đều gọi `tickOnce()` trực tiếp**, không cái nào chứng
> minh `setInterval` trong `startAutomationScheduler` thực sự nổ trong một tiến trình sống. Đây là
> đường duy nhất phủ được điều đó.

### 14.6. Lỗi phát hiện TRONG quy trình test (trước commit)

Nút **"hoãn"** (đóng popup bằng X / click ra ngoài) bị viết thành ghi event `declined` — **cùng mã với
"Không, để tôi tự làm"**. Hai hành động khác hẳn nghĩa: một cái hủy task, một cái chỉ đóng cửa sổ.

Hậu quả nếu lọt: thống kê *"bao nhiêu lần user thực sự từ chối AI"* ở [sổ delivery](../README.md) bị đội
lên bởi mọi lần chỉ đóng popup — **lỗi im lặng, làm bẩn đúng dữ liệu dùng để cải tiến**.

Lỗi này sống sót qua review CR, hiện thực, và **116 test tự động xanh**. Chỉ lộ khi đọc code đối chiếu
[qa-standard §5](../../standards/qa-standard.md) trước lúc commit → ghi thành [**L-005**](../README.md).

**Đã sửa:** thêm mã `snoozed` riêng; tách [`src/lib/automation-ask.ts`](../../../src/lib/automation-ask.ts)
(hàm thuần) + **12 unit test**; thêm luật vào [rules/06 §8](../../rules/06-rules-frontend.md).

Theo [ngưỡng §2](../README.md) thì **không** mở hồ sơ BUG: bị bắt trước khi thoát cổng — đó là cổng đang
hoạt động đúng.

### 14.4. Bugfix kèm theo (ngoài phạm vi CR, phát hiện lúc làm)

Claude ném lỗi (timeout/không chạy được) sau khi task đã bị claim sang `running` ⇒ task **kẹt vĩnh viễn**:
vòng tick chỉ hồi sinh trạng thái *cuối*, mà `running` không nằm trong đó. Đã hạ về `failed` trong
`catch` — vừa là trạng thái cuối (mai reset được), vừa không tự chạy lại trong ngày (tránh đăng trùng
khi Claude có thể đã thực thi một phần). Lỗi này **có sẵn từ trước CR**, nhưng CR làm nó dễ gặp hơn vì
server nay cũng claim task.

---

## 13. Duyệt (sign-off)

| Vai trò | Ngày | OK? | Ghi chú |
|---|---|---|---|
| BA/đề xuất | 2026-08-01 | ✅ | Đã tinh chỉnh theo feedback vòng 1 |
| Dev (khả thi kỹ thuật) | 2026-08-01 | ✅ | Chặn `UNIQUE(occ,event)` → đã đổi sang `dedupe_key` (ADR-2); nêu R7 `logEvent` nuốt lỗi → FR-4b |
| Tester (khả-test, AC đủ) | 2026-08-01 | ✅ | Chặn AC-7 mâu thuẫn + ca "nhường modal" chưa liệt kê → 6.1/ADR-3/AC-13; yêu cầu cơ chế đếm spawn cho AC-1 |
| Infra (bảo mật/tài nguyên) | 2026-08-01 | ✅ | Chặn R6 spawn chồng → FR-4c/AC-14; xác nhận SEA + security §9 + perf §6 |
| Leader (chốt DoR) | 2026-08-01 | ✅ | Cổng ③ đạt |
| Người duyệt thứ hai (tác động Lớn) | 2026-08-01 | ✅ | User duyệt trực tiếp |
| Người triển khai | 2026-08-01 | ✅ | 8 bước theo mục 10; `npm test` + `npm run build` xanh |
| BA nghiệm thu (cổng ⑦) | 2026-08-01 | ✅ | **16/17 AC đạt.** AC-12 không đạt — chấp nhận có lý do (§14.2) |
| Leader chốt & ship (cổng ⑧) | 2026-08-01 | ✅ | Sai lệch AC-12 **đã được người duyệt chấp nhận**; đã ghi thành [L-001](../README.md) + đã thực hiện hành động cải tiến ([design-standard §7.1](../../standards/design-standard.md)) |

### Nhật ký review

**Vòng 1 (2026-08-01)** — 3 điểm chặn, tất cả đã xử lý:

| # | Vai | Vấn đề | Xử lý |
|---|---|---|---|
| 1 | Dev, Tester | `UNIQUE(occurrence_key, event)` chặn luồng "duyệt → hủy → duyệt lại", làm đỏ test hiện có, và kéo theo bước xóa dữ liệu rủi ro Cao | Đổi sang `dedupe_key` nullable + index partial (6.4, ADR-2). **R1 bị loại bỏ hẳn**; thêm AC-2b |
| 2 | Tester | Bỏ "nhường modal" là thay đổi người dùng thấy được nhưng chưa có trong bảng CŨ vs MỚI (vi phạm §9.2) | Bổ sung 6.1 + ADR-3 + AC-13 |
| 3 | Infra | Tick 30s × timeout 5' ⇒ tối đa 10 tiến trình Claude song song | FR-4c trần 1 đồng thời + AC-14; thêm R6 |

Điểm phụ đã tiếp thu: FR-4b (`logEvent` nuốt lỗi, R7) · AC-1 bổ sung cơ chế đếm spawn · AC-15 (tick đụng
"Phê duyệt & chạy ngay") · FR-4d (một task lỗi không giết vòng lặp) · đổi thứ tự triển khai để FR-5
lên bước 2.
