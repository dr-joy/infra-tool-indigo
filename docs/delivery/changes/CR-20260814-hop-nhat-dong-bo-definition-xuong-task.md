# CR-20260814-hop-nhat-dong-bo-definition-xuong-task — Hợp nhất luật đồng bộ definition → task release và phát hiện lệch

| Trường | Giá trị |
|---|---|
| Loại | ⬜ Thêm mới ✅ Sửa hành vi ⬜ Xóa/Deprecate |
| Mức tác động | ⬜ Nhỏ ⬜ Vừa ✅ Lớn (đụng nhiều màn + automation ghi ra ngoài) |
| Người đề xuất | Leader |
| Ngày | 2026-08-14 |
| Backlog item | `BL-20260814-014` (`Picked`) |
| Trạng thái | ⬜ Draft ✅ Đã review (Codex §14 → Claude §15) ✅ Đã duyệt (Leader 2026-08-18) ✅ Đã triển khai (§16, code+test+check xanh, FR-5 đủ 3/3 nơi) ✅ **Đã nghiệm thu (chấp nhận rủi ro, không có smoke máy thật — Leader quyết định 2026-08-21, xem `exchanges/2026-08-21.md`)** — Bob/Codex đã nghiệm thu độc lập 13/13 AC PASS (§17); Leader đóng mà không chạy 3 điểm smoke đợt thật đã lên kế hoạch (sửa `ai_note` → task cập nhật đúng, badge lệch đúng số, banner `driftWarning` đúng chỗ) |
| Bug liên quan | [BUG-20260814-ai-dang-bai-bang-huong-dan-cu](../bugs/BUG-20260814-ai-dang-bai-bang-huong-dan-cu.md) — mở theo yêu cầu review §14 |
| Spec liên quan | [02 UI](../../specs/02-screen-design-user-flow.md) · [03 API](../../specs/03-api-business-logic-spec.md) · [04 DB](../../specs/04-database-design.md) · [06 FE](../../rules/06-rules-frontend.md) · [07 BE](../../rules/07-rules-backend.md) |

## 1. Bối cảnh & Vấn đề

Task release là **bản chụp** definition tại thời điểm sinh task: `ten_task`/`ghi_chu`/`action_type`/`ai_note`
được COPY vào bảng `tasks`. Sửa definition sau đó **không** tự động sửa task đã sinh trong mọi trường hợp.

Hiện có **hai đường lan truyền, hai luật khác nhau, không đường nào phát hiện lệch**:

| Đường | Kích hoạt | Cách ghi | Điều kiện & lỗ |
|---|---|---|---|
| **(1) Lưu 1 definition** [release.tsx:1176](../../../src/screens/release.tsx#L1176) → `POST /schedules/regular-release/task` [schedules.ts:290](../../../server/routes/schedules.ts#L290) | Tự động, ngay khi bấm Lưu ở màn quản lý task | **DELETE theo `ten_task` + INSERT mới** | Chỉ chạy khi ô ngày release trên màn **đang trỏ đúng đợt** (`if (releaseDate)`); chỉ đẩy definition **vừa lưu**; match theo TÊN nên đổi tên là mất dấu; task bị tạo lại ⇒ mất `trang_thai`, `automation_status`, Note sửa tay; task **đã hoàn thành cũng bị xoá** (mất lịch sử) |
| **(2) Nút đồng bộ cả đợt** [release.tsx:642](../../../src/screens/release.tsx#L642) → `POST /schedules/release/sync` [schedules.ts:64](../../../server/routes/schedules.ts#L64) | **Thủ công**, phải tự nhớ bấm | UPDATE theo `(release_month, origin_ref)`, có preview, bỏ qua task done/canceled/quá ngày, reset `needs_reconfirm` | Không ai bấm thì không có gì xảy ra; `ghi_chu` **render lại từ template** nên definition không có template sẽ **xoá trắng Note** đang có; không sửa được task đã chạy |

**Hậu quả thật (2026-08-14).** Task `Announcement - VN_Release` ngày 14/08 chạy AI theo `ai_note` **374 ký tự
bản cũ**, trong khi definition `notify-vn-schedule` đã là **1005 ký tự** — thiếu đúng các quy tắc mới:
hyperlink chữ `Link` tới file release, và "giữ nguyên `@Mọi người` trong bài + set mention/To = toàn bộ member".
Bài đã đăng sai lên Dr.JOY, không có cảnh báo nào trước đó.

Quét cả DB tại thời điểm phát hiện: **14 task chưa chạy** của đợt `2026-08` lệch definition, trong đó **10 task
còn `action_type='none'` + `ai_note` rỗng** dù definition đã bật `post` ⇒ chúng sẽ **im lặng không chạy AI**.
Thêm 4 task đợt 08 đã done/canceled và 34 task hai đợt khẩn cấp tháng 7 cũng lệch. Đã vá dữ liệu bằng
`PATCH /api/tasks/:id` (chỉ `actionType` + `aiNote`, giữ Note/giờ) — **vá dữ liệu, chưa vá cổng**.

Ba khoảng trống thật sự:

1. **Hai luật ghi khác nhau** cho cùng một việc "đưa definition xuống task" — một cái xoá-tạo-lại theo tên,
   một cái update theo `origin_ref`. Người dùng không thể biết mình đang dùng luật nào.
2. **Không phát hiện lệch.** App *biết* cách so (chính `classifyReleaseSync` dùng cho preview) nhưng chỉ trả lời
   khi user chủ động bấm. Không badge, không cảnh báo, không log.
3. **Pha precheck của automation không so `ai_note` của task với definition** trước khi ghi ra ngoài — nên bản
   hướng dẫn cũ vẫn được thi hành trọn vẹn.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Chỉ còn **một** luật ghi definition → task: match theo `origin_ref`, **UPDATE** (không DELETE/INSERT), không
    đụng task `da_hoan_thanh`/`canceled`. Đường (1) và (2) dùng chung đúng một hàm phân loại + một hàm ghi.
  - Task AI có `ai_note`/`action_type` lệch definition **không bao giờ được ghi ra ngoài trong im lặng**: hoặc
    tự đồng bộ trước khi chạy, hoặc dừng và báo (chốt ở `?3` §13).
  - Người dùng thấy được task nào đang lệch definition **mà không phải bấm gì** (badge/đếm trên màn Release).
  - Số task lệch definition trong một đợt đang mở = 0 sau khi bấm đồng bộ một lần, kể cả khi definition từng
    bị đổi tên.
- **Ngoài phạm vi (không làm lần này):**
  - Đồng bộ cho **đợt khẩn cấp** (`release_month LIKE 'emergency:%'`): chỉ **phát hiện + cảnh báo**, chưa làm
    luồng ghi (đợt khẩn cấp sinh mới theo từng sự cố nên rủi ro thấp hơn).
  - Lịch sử phiên bản `ai_note` (ai sửa gì lúc nào) — cần thì mở CR riêng.
  - Sửa hậu quả bài đã đăng sai trên Dr.JOY (việc tay, không phải phần mềm).
  - Thay đổi cơ chế snapshot (task vẫn giữ bản copy, KHÔNG đọc trực tiếp definition lúc chạy) — xem `?1` §13.

## 3. Người dùng & Kịch bản

- Là **người vận hành release**, tôi muốn sửa hướng dẫn AI ở một chỗ (definition) và chắc chắn task của đợt đang
  chạy dùng đúng bản đó, để AI không đăng theo bản cũ.
- Là **người vận hành**, tôi muốn nhìn màn Release là biết ngay đợt này có task nào lệch definition, thay vì phải
  nhớ bấm đồng bộ.
- Là **người duyệt automation**, tôi muốn app chặn/cảnh báo trước khi AI ghi ra ngoài bằng bản hướng dẫn cũ.
- Là **người vận hành**, tôi muốn đồng bộ **không** làm mất Note đã sửa tay và **không** hồi sinh task đã xong.

## 4. Yêu cầu chức năng

> Quyết định `?1–?5` đã chốt theo đề xuất Codex ở §14 và **đã nhúng vào FR/AC dưới đây** — không còn option mở:
> giữ snapshot (`?1`); legacy thiếu `origin_ref` chỉ cảnh báo, **không** backfill (`?2`); precheck **chặn**
> fail-closed, không tự đồng bộ rồi chạy (`?3`); hiện dấu lệch ở **3 nơi** (`?4`); **có** cổng máy (`?5`).

- **FR-1 — Một luật ghi duy nhất.** `POST /schedules/regular-release/task` (đường 1) chuyển sang dùng chung
  `classifyReleaseSync` + đường ghi UPDATE của `/schedules/release/sync`: match `(release_month, origin_ref)`,
  UPDATE tại chỗ, giữ `trang_thai`/`do_uu_tien`/`automation_*` theo đúng ma trận an toàn hiện có. Chỉ INSERT khi
  **không tìm thấy** task cùng `origin_ref` trong đợt.
- **FR-2 — Bỏ match theo tên.** Không còn `DELETE … WHERE ten_task IN (...)` ở đường regular release. Đổi tên
  definition không được sinh task trùng và không được xoá task cũ. Task **chưa có** `origin_ref` (legacy): chỉ
  **liệt kê ở nhóm "không xác định nguồn"** kèm cảnh báo, **không** tự backfill theo tên (`?2` — backfill theo
  tên chính là thứ CR này đang diệt) và **không** tự xoá.
- **FR-3 — Không xoá task đã xong.** Mọi đường ghi phải bỏ qua task `da_hoan_thanh`/`canceled` và báo rõ số task
  bị bỏ qua kèm lý do (đã có ở đường 2, phải áp cho cả đường 1).
- **FR-4 — Không xoá Note bằng hành động đồng bộ.** **Backend tự quyết**, không dựa vào chuỗi rỗng của payload:
  server đọc definition + template theo `origin_ref`; definition **không có** `template_id` ⇒ câu UPDATE **không
  set cột `ghi_chu`** (không phải "ghi lại giá trị cũ" — xem FR-8 về race). Chỉ set `ghi_chu` khi render được nội
  dung từ template. Lý do bỏ hẳn phương án cờ `noteUpdateMode` do FE gửi: chuỗi rỗng và "không có template" là
  hai chuyện khác nhau mà FE đang làm phẳng thành một (Codex P1 #1).
- **FR-5 — Phát hiện lệch, hiện chủ động.** `GET /api/schedules/release/drift?releaseMonth=…` (chỉ đọc) trả số
  task lệch + chi tiết field lệch từng task. **Backend tự load** task theo `release_month` + definitions +
  templates trong **một** lượt truy vấn rồi phân loại — không nhận payload FE resolve sẵn, không N+1 (Codex P2
  #4). Dấu lệch hiện ở **3 nơi** (`?4`): badge/đếm ở màn Release, dòng task ở màn task định kỳ, và popup
  automation (cửa cuối trước khi chạy — thiếu chỗ này thì user chỉ thấy "AI bị block" mà không hiểu vì sao).
- **FR-6 — Cổng trước khi AI ghi ra ngoài: CHẶN.** Precheck so task với definition gốc; lệch ⇒ **`ready=false`**
  cố định với `reasons[].code = 'task_lech_definition'`, nêu rõ field nào lệch và cách sửa; **không** tự đồng bộ
  rồi chạy tiếp (`?3` — tự đồng bộ nghĩa là AI thi hành nội dung user chưa xem lại). Task không tra được
  definition (legacy thiếu `origin_ref`) ⇒ **không** chặn, nhưng ghi cảnh báo vào preview (không biết thì đừng
  báo động — nguyên tắc từ [BUG-20260808](../bugs/BUG-20260808-banner-mcp-bao-dong-gia.md)).
- **FR-7 — Đồng bộ được cả những gì đang bị bỏ.** Đồng bộ phải phủ `action_type`, `ai_note`, `reply_to_ref` (bug
  đã biết: `relatedIds` của definition không xuống task), và nói rõ trên preview cái nào sẽ đổi.
- **FR-8 — Một hàm so lệch duy nhất, và apply re-classify trong transaction.** Hàm thuần
  `diffTaskAgainstDefinition(task, definition, rendered)` trả danh sách field lệch, **dùng chung** cho badge
  (FR-5), preview, apply và precheck (FR-6) — không viết 3 bộ so sánh riêng (Codex P1 #2). So sánh chuẩn hoá
  trước (`trim`, chuẩn hoá xuống dòng) để không false-positive vì khác cách render. Bước **apply** phải
  re-classify **trong cùng transaction** ngay trước khi ghi và dùng giá trị hiện tại của task cho field
  preserve — chống race "user sửa Note giữa lúc preview và lúc apply" (Codex P2 #5).
- **FR-9 — Cổng máy cụ thể (`?5`).** `scripts/check-release-sync.mjs` trong `npm run check`: **đỏ** nếu
  `server/routes/schedules.ts` còn `DELETE FROM tasks` đi kèm `ten_task` trong vùng regular release. Emergency
  `replaceMatching` nếu vẫn match theo tên thì phải có marker `// ten-task-match-ok: <lý do>` — có lý do tường
  minh, không im lặng miễn trừ. Kèm test hồi quy: `POST /schedules/regular-release/task` **không** xoá task cùng
  tên khác `origin_ref`.
- **FR-10 — Backend là nơi dựng payload release.** Port `releaseTokenDateMap` + `renderManagedReleaseTemplate` +
  luật `compareReleaseTaskDefinitions` sang `server/lib/release-render.ts` (hàm thuần, có unit test). FE gọi API
  thay vì tự dựng payload rồi gửi lên. Đây là điều kiện để FR-4/FR-5/FR-8 làm được đúng: backend phải **tự biết**
  definition nào có template, task nào thuộc đợt nào, mới phân loại được thay vì tin chuỗi FE gửi.

## 5. Yêu cầu phi chức năng

- Không migration phá dữ liệu; task legacy thiếu `origin_ref` vẫn phải dùng được (không tự xoá).
- Thao tác đồng bộ phải **atomic** (một `withTransaction`) và **idempotent**: bấm hai lần liên tiếp thì lần hai
  báo "không có gì cần cập nhật".
- Phát hiện lệch không gọi Claude, không I/O ngoài; chi phí O(số task trong đợt) — không được làm chậm màn Release.
- Vùng automation: mọi thay đổi ảnh hưởng đường ghi ra ngoài đi kèm `security-gate`.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI (tham chiếu docs/02, docs/06)
- Màn Release, khối đợt đang chọn: badge `N task lệch definition` + nút "Xem/đồng bộ" mở đúng popup preview đã có.
- Preview giữ nguyên dạng bảng hiện tại, thêm cột lý do bỏ qua (`done`/`canceled`/`past`) và cột field sẽ đổi.
- Lưu definition khi ô ngày release **rỗng**: hiện thông báo rõ "đã lưu definition, **chưa** đồng bộ xuống task
  của đợt nào" — hết cảnh im lặng như hiện tại.

### 6.2. API & nghiệp vụ (tham chiếu docs/03, docs/07)

| Endpoint | Đổi gì |
|---|---|
| `GET /api/schedules/release/drift?releaseMonth=` **(mới)** | Chỉ đọc. Backend tự load task theo `release_month` + definitions + templates (bulk, 1 lượt), trả `{ lech: [{taskId, originRef, title, fields[]}], boQua: [{originRef, reason}], khongXacDinhNguon: [{taskId, title}] }`. Không nhận payload FE resolve sẵn |
| `POST /api/schedules/regular-release/task` | Bỏ DELETE-theo-tên; dùng chung đường phân loại + ghi UPDATE với `/release/sync`; nhận `releaseDate` + `definitionId` (không nhận task payload FE dựng) |
| `POST /api/schedules/release/sync-preview` · `/sync` | Nhận `releaseMonth` (+ tuỳ chọn danh sách `originRef`); backend tự dựng nội dung từ definition/template. `sync` **re-classify trong transaction** ngay trước khi ghi |

- `server/lib/release-render.ts` **(mới)**: hàm thuần port từ FE (`releaseTokenDateMap`,
  `renderManagedReleaseTemplate`, thứ tự `compareReleaseTaskDefinitions`) + `diffTaskAgainstDefinition` của FR-8.
  Đây là **nguồn duy nhất** dựng nội dung task từ definition; FE không còn tự dựng.
- Câu UPDATE phải **động theo field cần đổi** (không set `ghi_chu` khi preserve) — không dùng một câu cố định ghi
  đè mọi cột như `SYNC_UPDATE` hiện tại.
- `automation` precheck: đọc definition theo `origin_ref`, gọi **cùng** `diffTaskAgainstDefinition`, lệch ⇒
  `ready=false` (FR-6).

### 6.3. Dữ liệu & schema (tham chiếu docs/04, docs/08)
- Không thêm bảng, **không migration**. Chốt `?2`: **không** backfill `origin_ref` cho task legacy — chúng chỉ
  hiện ở nhóm "không xác định nguồn" của endpoint drift. (Backfill theo tên + đợt có rủi ro trùng tên, đúng thứ
  FR-2 đang xoá; muốn map thì mở CR riêng có UI map tay.)

### 6.4. Automation / tích hợp
- FR-6 là thay đổi hành vi pha precheck: thêm một lý do `ready=false` mới (task lệch definition) và ghi rõ trong
  báo cáo. Ảnh hưởng trực tiếp tới quyền ghi ra ngoài ⇒ chạy `security-gate`.

## 7. Phân tích tác động

- [x] Frontend (màn Release, task định kỳ) · [x] API route · [ ] DB/migration (chỉ nếu backfill `origin_ref`) · [x] Automation/MCP
- [ ] i18n (chuỗi mới) — có, nếu badge/thông báo thêm chữ · [ ] Đóng gói SEA/MCP · [x] Bảo mật (đường ghi ra ngoài) · [x] Dữ liệu cũ/backward-compat
- **Rủi ro & giảm thiểu:** đổi luật ghi có thể làm mất dữ liệu nếu match sai ⇒ bắt buộc test đỏ trước cho từng ô
  ma trận (done/canceled/past/legacy-no-origin_ref) + `npm run backup-db` trước khi chạy thật.
- **Ảnh hưởng chức năng đang chạy:** luồng "lưu definition là task tự đổi" sẽ **không còn xoá-tạo-lại** ⇒ task
  không bị reset về `chua_thuc_hien` nữa. Đây là đổi hành vi user đang thấy, phải nói rõ khi giao.

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1):** Given đợt đã sinh task và definition `X` vừa được sửa `ai_note`, When lưu definition với ô ngày
  release trỏ đúng đợt, Then task cùng `origin_ref` được **UPDATE** — `id` task **không đổi**, `trang_thai` và
  `automation_status` giữ nguyên trừ reset `needs_reconfirm` theo ma trận.
- **AC-2 (FR-2):** Given definition đổi tên từ `A` sang `B` và đợt đang có task `origin_ref` đó, When lưu/đồng bộ,
  Then đúng **một** task tồn tại (được đổi tên tại chỗ), không sinh task `B` mới và không xoá task `A`.
- **AC-3 (FR-3):** Given task `da_hoan_thanh` cùng `origin_ref`, When lưu definition/đồng bộ, Then task **vẫn còn**
  nguyên trạng và kết quả báo nó bị bỏ qua với lý do `done`.
- **AC-4 (FR-4):** Given definition **không có** `template_id` và task đang có Note 200 ký tự, When đồng bộ, Then
  Note của task **không đổi** — và câu UPDATE chạy thật **không chứa cột `ghi_chu`** (kiểm bằng test ở tầng route,
  không chỉ so kết quả cuối: "giữ bằng cách ghi lại giá trị cũ" là ca race mà FR-8 cấm).
- **AC-4b (FR-4, Codex P1 #1):** Given definition **có** template và render ra chuỗi **rỗng**, When đồng bộ, Then
  `ghi_chu` được set rỗng — tức "không có template" và "template render ra rỗng" phải cho hai kết quả khác nhau.
- **AC-5 (FR-5):** Given đợt có 3 task lệch definition, When mở màn Release, Then badge hiện `3` **không cần bấm gì**;
  When bấm đồng bộ rồi mở lại, Then badge hiện `0`. Endpoint drift chỉ chạy **một** lượt truy vấn danh sách task
  của đợt (không N+1 theo từng definition).
- **AC-6 (FR-6):** Given task AI có `ai_note` lệch definition, When precheck chạy, Then **`ready=false`** với
  `reasons[].code = 'task_lech_definition'` nêu rõ field lệch, và **không** có lệnh ghi nào gửi ra ngoài. Không
  có nhánh "tự đồng bộ rồi chạy" — bỏ theo `?3`.
- **AC-6b (FR-6):** Given task AI **không tra được** definition (legacy thiếu `origin_ref`), When precheck chạy,
  Then **không** bị chặn vì lý do lệch, nhưng preview có cảnh báo "không xác định được nguồn definition".
- **AC-7 (FR-7):** Given definition có `relatedIds`, When đồng bộ, Then `reply_to_ref` của task khớp definition và
  preview đã liệt kê `replyToRef` trong danh sách field đổi.
- **AC-8 (NFR idempotent):** Given vừa đồng bộ xong, When bấm đồng bộ lần hai, Then báo "không có task nào cần cập
  nhật" và không có UPDATE nào chạy.
- **AC-9 (hồi quy sự cố 14/08 — [BUG-20260814](../bugs/BUG-20260814-ai-dang-bai-bang-huong-dan-cu.md)):** Given
  tái hiện đúng ca thật (task `notify-vn-schedule` giữ `ai_note` cũ 374 ký tự, definition 1005 ký tự, task
  `chua_thuc_hien`), When tới giờ và automation chạy, Then `ready=false` và **không** có bài nào được đăng —
  không có đường "tự đồng bộ rồi đăng".
- **AC-10 (FR-8, chống race):** Given preview đã tính xong, và user sửa Note của task **giữa** preview và apply,
  When apply, Then giá trị Note user vừa sửa **không bị mất** (apply re-classify trong transaction).
- **AC-11 (FR-8, một hàm so):** Given cùng một cặp (task, definition) lệch, When gọi badge / preview / precheck,
  Then cả ba trả **cùng** danh sách field lệch (test gọi chung `diffTaskAgainstDefinition`).
- **AC-12 (FR-9, cổng máy):** Given ai đó thêm lại `DELETE FROM tasks … ten_task IN (…)` vào vùng regular release,
  When `npm run check`, Then cổng `check-release-sync` **đỏ**; Given emergency có marker `// ten-task-match-ok: <lý do>`,
  Then xanh. Kèm test route: `POST /schedules/regular-release/task` không xoá task cùng tên khác `origin_ref`.
- **AC-13 (FR-10):** Given FE gọi tạo/đồng bộ task release, When kiểm request thật, Then FE **không** gửi nội dung
  `ghiChu`/`aiNote` do nó tự dựng — chỉ gửi `releaseDate`/`releaseMonth`/`definitionId`.

## 9. Kế hoạch test (tham chiếu standards/qa-standard.md)

- Tầng test dự kiến: ✅ Unit (`release-render`: token map, render template, `diffTaskAgainstDefinition`)
  ✅ Integration route ✅ Render component ✅ Smoke thủ công
- **Thứ tự bắt buộc:** viết **test đỏ** AC-9 (hồi quy sự cố đã đăng sai) và AC-12 (cổng máy) **TRƯỚC** khi sửa
  code — đây là bug đã thoát cổng, [qa-standard §3](../../standards/qa-standard.md).
- Ca chính: UPDATE tại chỗ giữ `id`; đổi tên definition; task done/canceled bị bỏ qua; definition không template
  **không set cột `ghi_chu`**; badge đếm đúng và chỉ 1 truy vấn; precheck **chặn** (`ready=false`); idempotent lần 2.
- Ca lỗi/biên: task legacy thiếu `origin_ref` (không chặn precheck, chỉ cảnh báo); hai definition **cùng tên** khác
  `origin_ref`; template render ra rỗng (AC-4b); user sửa Note giữa preview và apply (AC-10); đợt khẩn cấp (chỉ
  cảnh báo, không ghi); task quá ngày; lưu definition khi ô ngày release rỗng (phải báo rõ, không im lặng).
- Smoke thủ công: đợt thật 2026-08 — sửa `ai_note` một definition → xác nhận task đúng đợt đổi theo, task đã xong
  không bị đụng, Note không bay.

## 10. Kế hoạch triển khai / rollback

- Bước: (1) **test đỏ AC-9 + AC-12** và ma trận an toàn; (2) `server/lib/release-render.ts` + `diffTaskAgainstDefinition`
  (FR-8/FR-10) kèm unit test; (3) hợp nhất đường ghi + bỏ match theo tên (FR-1/FR-2/FR-3) + cổng máy FR-9;
  (4) FR-4/FR-7 (UPDATE động, preserve Note); (5) endpoint drift + UI 3 nơi (FR-5); (6) FR-6 precheck chặn +
  `security-gate`; (7) `npm run check`; (8) smoke đợt thật; (9) `docs-sync` 02/03/04/06/07 + đóng
  [BUG-20260814](../bugs/BUG-20260814-ai-dang-bai-bang-huong-dan-cu.md) §6.
- `npm run backup-db` trước mọi bước chạy thật trên DB người dùng.
- Rollback: revert commit; dữ liệu đã đồng bộ không cần hoàn nguyên (chỉ là `ai_note`/`action_type` đúng bản mới),
  nếu cần thì phục hồi từ backup cùng ngày.

## 11. Docs cần cập nhật sau khi làm xong

- [ ] docs/02 (dấu lệch definition ở 3 nơi) · [ ] docs/03 (endpoint drift + đổi hợp đồng 3 route ghi + lý do
  `ready=false` mới) · [ ] rules/06–07 (luật: một nguồn ghi, cấm match theo tên, snapshot phải phát hiện lệch
  chủ động) · [ ] [qa-standard](../../standards/qa-standard.md) (ca smoke bắt buộc khi đụng nguồn định nghĩa)
- [ ] [operations/automation-ai-go-live-guide](../../operations/automation-ai-go-live-guide.md) — lý do `ready=false` mới
- [ ] docs/04: **không đổi** (chốt `?2` không backfill) — ghi lại quyết định để lần sau không tưởng là bỏ sót
- [ ] Đóng §6 của [BUG-20260814](../bugs/BUG-20260814-ai-dang-bai-bang-huong-dan-cu.md) (4 hành động cải tiến)

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude (soạn) | 2026-08-14 | ✅ |
| Reviewer thiết kế | Codex (§14, 5 finding + chốt `?1–?5`) | 2026-08-14 | ✅ đã tiếp nhận ở §15 |
| Leader duyệt | Leader | 2026-08-18 | ✅ (chỉ thị "ok bắt tay vào bug đi", ghi tại [exchange 2026-08-18 §1](../../exchanges/2026-08-18.md)) |
| Người triển khai | Claude | 2026-08-18 | đang triển khai |
| QA nghiệm thu | Bob (thay Codex — hết token) | 2026-08-18 | ✅ PASS (cơ chế) |
| Leader đóng CR | Leader | 2026-08-21 | ✅ **chấp nhận rủi ro** — đóng không chạy smoke đợt thật đã lên kế hoạch, chỉ dựa trên PASS cơ chế ở trên |

## 13. Điểm cần chốt trước khi code — **ĐÃ CHỐT** (2026-08-14)

> Kết quả: `?1` = (a) giữ snapshot · `?2` = (a) chỉ cảnh báo, không backfill · `?3` = **chặn** `ready=false`
> (bỏ hẳn nhánh tự đồng bộ) · `?4` = 3 nơi (Release badge + dòng task định kỳ + popup automation) · `?5` = **có**
> cổng máy, cụ thể `DELETE FROM tasks … ten_task` ở vùng regular release.
> Đã nhúng vào FR-2/FR-5/FR-6/FR-9 và AC-6, AC-6b, AC-12 — bảng dưới giữ lại làm lịch sử lựa chọn.

| # | Câu hỏi | Lựa chọn |
|---|---|---|
| ?1 | Giữ **snapshot** (task copy `ai_note`) hay để task **đọc trực tiếp** definition lúc chạy? | (a) giữ snapshot + đồng bộ/cảnh báo (phạm vi CR này); (b) bỏ snapshot, chạy là đọc definition — hết lệch vĩnh viễn nhưng mất khả năng sửa hướng dẫn riêng cho một task, và mất bằng chứng "task này đã chạy bằng bản nào" |
| ?2 | Task legacy **không có** `origin_ref` xử lý sao? | (a) bỏ qua, chỉ cảnh báo; (b) backfill 1 lần theo tên + đợt (có rủi ro trùng tên); (c) cho user map tay |
| ?3 | Precheck phát hiện lệch thì **chặn** hay **tự đồng bộ rồi chạy**? | (a) chặn `ready=false` — an toàn, nhưng tới giờ mới biết thì trễ; (b) tự đồng bộ + ghi log; (c) chặn, nhưng badge FR-5 đã cảnh báo từ trước nên thực tế ít gặp |
| ?4 | Dấu hiệu lệch hiện ở đâu ngoài màn Release (màn task định kỳ? popup automation?) | |
| ?5 | Có cần **cổng máy** cấm route ghi task release match theo `ten_task` (test/lint) để lớp lỗi này không quay lại? | |

## 14. Codex review / quyết định đề xuất (2026-08-14)

Trạng thái review: **CR đúng hướng, nhưng cần chốt rõ 5 điểm dưới trước khi code**. Lỗi lần này đã ghi sai ra hệ
thống ngoài, nên ưu tiên của CR phải là "không chạy im lặng bằng bản cũ", không phải "cứ tới giờ là tự chạy".

### Chốt đề xuất cho §13

| # | Codex đề xuất | Lý do |
|---|---|---|
| ?1 | Chọn **(a) giữ snapshot + đồng bộ/cảnh báo** | Snapshot giữ được bằng chứng task đã/chưa chạy bằng bản nào và vẫn cho phép sửa riêng một task. Đọc trực tiếp definition lúc chạy sẽ xoá mất khả năng override theo task, đồng thời làm audit sau sự cố khó hơn. |
| ?2 | Chọn **(a) bỏ qua + cảnh báo**, chưa backfill tự động | Backfill theo tên + đợt có rủi ro đúng thứ CR đang diệt: match theo tên. Legacy thiếu `origin_ref` nên hiện thành nhóm "không xác định nguồn", cho user xử lý tay hoặc mở CR map tay nếu số lượng lớn. |
| ?3 | Chọn **(c) chặn precheck**, không tự đồng bộ rồi chạy | Tự đồng bộ ngay lúc tới giờ nghĩa là AI có thể thi hành nội dung user chưa xem lại. Badge chủ động ở FR-5 là cơ chế báo sớm; nếu vẫn lọt tới precheck thì fail-closed, `ready=false`, không ghi ra ngoài. |
| ?4 | Hiện ở **Release badge + dòng task định kỳ + popup automation** | Release là nơi sửa nguồn; task định kỳ là nơi user nhìn trước khi tới giờ; popup automation là cửa cuối cùng khi task sắp chạy. Thiếu popup thì user chỉ thấy "AI bị block" mà không biết vì sao. |
| ?5 | **Có**, cần cổng máy | Ít nhất chặn `DELETE FROM tasks ... ten_task` trong route release/schedules, và/hoặc test hồi quy đảm bảo `/schedules/regular-release/task` không còn xoá theo tên. Rule không có cổng thì sẽ quay lại. |

### Findings thiết kế cần sửa trước khi triển khai

| Mức | Vị trí | Nhận xét | Đề xuất |
|---|---|---|---|
| P1 | [`src/screens/release.tsx:395`](../../../src/screens/release.tsx#L395) → [`:399`](../../../src/screens/release.tsx#L399), [`server/routes/schedules.ts:64`](../../../server/routes/schedules.ts#L64) | FR-4 nói "definition không có template thì giữ Note", nhưng FE hiện render "không có template" thành `ghiChu: ''` trước khi gửi. Backend chỉ thấy chuỗi rỗng, không biết đó là "không có template" hay "cố ý muốn Note rỗng", nên nếu implement theo payload hiện tại rất dễ vẫn xoá trắng Note. | Payload sync phải có tín hiệu rõ, ví dụ `noteUpdateMode: 'rendered' | 'preserve'` hoặc `ghiChuRendered: boolean`; tốt hơn nữa là backend nhận `releaseMonth` + definition ids rồi tự đọc template/definition để phân loại. AC-4 phải test đúng ca payload không template. |
| P1 | [`server/routes/automation.ts:645`](../../../server/routes/automation.ts#L645) → [`:700`](../../../server/routes/automation.ts#L700) | FR-6 đang nói "precheck so task với definition", nhưng chưa định nghĩa hash/so sánh chuẩn. So raw string dễ false-positive vì trim/render khác nhau; so thiếu field thì lại lọt. | Tạo hàm thuần `diffTaskAgainstDefinition(task, definition, renderedPayload)` dùng chung cho badge, sync preview, và precheck. Không viết 3 bộ so sánh riêng. |
| P2 | [`server/routes/schedules.ts:290`](../../../server/routes/schedules.ts#L290) | Đường (1) hiện xoá theo `ten_task`; CR yêu cầu bỏ. Nhưng cổng máy ở ?5 cần cụ thể, nếu chỉ nói chung "cấm match theo tên" thì dễ không bắt được. | Thêm script/check hoặc test route fail nếu trong `server/routes/schedules.ts` còn pattern `DELETE FROM tasks` kèm `ten_task IN` cho regular release. Emergency `replaceMatching` nếu giữ theo tên phải có marker/ngoại lệ riêng và lý do. |
| P2 | [`server/routes/schedules.ts:64`](../../../server/routes/schedules.ts#L64) | `classifyReleaseSync` hiện query từng payload một và chỉ nhận payload FE đã resolve. Với FR-5 "mở màn Release là badge hiện", nếu gọi thường xuyên thì logic vừa phụ thuộc FE vừa dễ N+1. | Endpoint drift nên nhận `releaseMonth`, backend tự load task + definitions của đợt, hoặc ít nhất bulk-load tasks theo `release_month` một lần rồi phân loại. |
| P2 | [`server/routes/schedules.ts:31`](../../../server/routes/schedules.ts#L31) | SYNC_UPDATE đang ghi cả `ghi_chu`, `gio_bat_dau`, `ngay_cu_the` cùng lúc. Nếu FR-4 quyết định preserve Note, cần tránh kiểu "giữ bằng cách truyền lại old note" bị race với user sửa note giữa preview và apply. | Khi field nào không đổi/preserve thì câu UPDATE không nên set field đó, hoặc apply phải re-classify trong transaction ngay trước khi ghi và dùng giá trị task hiện tại cho field preserve. |

### Điều kiện để chuyển trạng thái "Đã review"

- CR cập nhật quyết định ?1–?5 vào §4/§6/§8, không để option mở trong AC.
- Thêm AC cho `noteUpdateMode/preserve` và cho precheck block bằng `ready=false` cố định.
- Thêm cổng máy/test đỏ trước cho route xoá theo tên.
- Mở BUG riêng cho sự cố đã đăng sai ra Dr.JOY. Phân loại đề xuất: `BUG`, RC nghiêng `RC-SPEC`, vì hệ thống đã cho automation ghi ra ngoài bằng snapshot stale mà không cảnh báo.

## 15. Claude tiếp nhận review (2026-08-14) — nhận cả 5 finding + 4 điều kiện

Chốt `?1–?5` **đúng như Codex đề xuất**, không phản biện điểm nào: 4 quyết định kia đều theo hướng *fail-closed*
và *một nguồn sự thật*, còn `?2` thì backfill theo tên đúng là thứ FR-2 đang xoá — nhận là hợp lý.

| Finding | Xử lý | Nhúng vào đâu |
|---|---|---|
| **P1 #1** — FE làm phẳng "không có template" thành `ghiChu:''`, backend không phân biệt được | **Nhận, nhưng chọn phương án mạnh hơn cờ `noteUpdateMode`**: backend **tự đọc** definition + template theo `origin_ref` và tự dựng nội dung, nên không cần tín hiệu từ FE. Definition không có `template_id` ⇒ câu UPDATE **không set cột `ghi_chu`**. Lý do không chọn cờ: cờ vẫn để FE làm nguồn sự thật về "có template hay không", tức vẫn còn một chỗ để lệch | **FR-4** viết lại · **FR-10** (BE dựng payload) mới · **AC-4** (kiểm câu UPDATE không chứa `ghi_chu`) + **AC-4b** (template render rỗng ≠ không có template) |
| **P1 #2** — FR-6 chưa định nghĩa cách so, dễ vừa false-positive vừa lọt field | **Nhận đúng đề xuất**: hàm thuần `diffTaskAgainstDefinition(task, definition, rendered)` **dùng chung** cho badge / preview / apply / precheck; chuẩn hoá `trim` + xuống dòng trước khi so | **FR-8** mới · **AC-11** (ba đường phải trả cùng danh sách field lệch) |
| **P2 #3** — cổng `?5` nói chung thì không bắt được | **Nhận**: cổng cụ thể `scripts/check-release-sync.mjs` — đỏ nếu vùng regular release còn `DELETE FROM tasks` kèm `ten_task`; emergency giữ theo tên thì phải có marker `// ten-task-match-ok: <lý do>` | **FR-9** · **AC-12** (gồm cả ca marker của emergency) |
| **P2 #4** — `classifyReleaseSync` phụ thuộc payload FE + N+1 khi badge gọi thường xuyên | **Nhận**: endpoint drift nhận `releaseMonth`, backend bulk-load task của đợt + definitions + templates rồi phân loại | **FR-5** viết lại · **6.2** bảng endpoint · **AC-5** (chỉ 1 lượt truy vấn) |
| **P2 #5** — `SYNC_UPDATE` ghi cố định mọi cột ⇒ preserve bằng "ghi lại giá trị cũ" sẽ race | **Nhận**: câu UPDATE **động theo field cần đổi**, và apply **re-classify trong cùng transaction** ngay trước khi ghi | **FR-8** · **6.2** · **AC-10** (user sửa Note giữa preview và apply thì không mất) |

Bốn điều kiện "Đã review":

1. ✅ `?1–?5` đã nhúng vào FR/AC, §13 đánh dấu ĐÃ CHỐT (bảng cũ giữ làm lịch sử).
2. ✅ AC cho preserve Note (**AC-4**, **AC-4b**) và precheck chặn cố định (**AC-6**, **AC-6b**, **AC-9**).
3. ✅ Cổng máy + test đỏ trước cho route xoá theo tên (**FR-9**, **AC-12**); §10 ghi rõ **test đỏ AC-9 + AC-12 là
   bước (1)**, trước khi sửa code.
4. ✅ Đã mở [BUG-20260814-ai-dang-bai-bang-huong-dan-cu](../bugs/BUG-20260814-ai-dang-bai-bang-huong-dan-cu.md) —
   nhận đúng phân loại Codex đề xuất: cổng hụt **② Thiết kế**, **RC-SPEC**, "Sinh ra bởi" = có sẵn từ trước. Hồ sơ
   ghi 4 hành động cải tiến, tất cả còn `⬜ Chưa` và neo vào CR này để không bị coi là xong khi CR đóng.

Một điểm bổ sung Claude tự thấy khi viết BUG: cổng ⑦ Nghiệm thu **không** phải cổng chịu trách nhiệm chính, vì
tiêu chí nghiệm thu automation ("AI đăng đúng nội dung `aiNote` của task") **đạt** — nó chưa bao giờ hỏi "`aiNote`
của task có còn là bản mới nhất". Đó là lỗi ở tầng thiết kế tiêu chí, nên ghi ② chứ không ghi ⑦.

**Chưa viết dòng code nào.** Chờ Leader duyệt §12 rồi mới vào bước (1) của §10 (test đỏ trước).

## 16. Claude triển khai (2026-08-18) — code + test xong, còn 3 việc trước khi nghiệm thu

Leader duyệt §12 qua chỉ thị "ok bắt tay vào bug đi" ([exchange 2026-08-18 §1](../../exchanges/2026-08-18.md)).
Đã làm đủ bước (1)–(7) và một phần (9) của §10; `npm run check` xanh cả 9 cổng (376 test backend + 223 test
frontend, TypeScript, build, budget bundle 499.8/500kB, link/docs/tz/claude-env/release-sync).

**Đã xong:**
- Test đỏ trước AC-9 ([test/integration/automation.test.ts](../../../test/integration/automation.test.ts)) và
  AC-12 ([test/unit/check-release-sync.test.ts](../../../test/unit/check-release-sync.test.ts)) — bước (1).
- `server/lib/release-render.ts` (FR-8/FR-10) + `test/unit/release-render.test.ts` — bước (2).
- Hợp nhất đường ghi, bỏ DELETE-theo-tên ở `/schedules/regular-release/task`, cổng máy
  `scripts/check-release-sync.mjs` (FR-1/2/3/9) — bước (3).
- UPDATE động không set `ghi_chu` khi không có template, đồng bộ `reply_to_ref` (FR-4/7) — bước (4).
- `GET /api/schedules/release/drift` + dấu lệch **đủ 3/3 nơi** (FR-5, `?4`): badge màn Release, icon trên dòng
  task định kỳ dashboard (`lechDefinition`, bulk 1 lượt), banner `driftWarning` trong popup automation — bước (5).
- Precheck automation chặn `task_lech_definition` trước khi spawn Claude (FR-6) — bước (6), đã tự chạy
  `security-gate` (xem finding residual bên dưới), và tự sửa thêm 1 lỗ hổng phát hiện sau đó (xem dưới).
- `docs-sync`: specs/02·03·04, rules/06·07, qa-standard §8.2b, go-live guide — bước (9) một phần.

**Còn thiếu trước khi chuyển "Đã nghiệm thu":**
1. **Smoke đợt thật** (bước 8) — chưa chạy trên DB thật với đợt release đang mở; `npm run backup-db` trước.
2. **Đóng BUG-20260814 §6** — chưa đánh dấu, chờ nghiệm thu xong.
3. **Codex review** vòng độc lập trước khi Leader đóng CR — theo đúng quy trình các CR trước (BL-006,
   CR-20260814-cau-hinh-claude-bin). **Codex đang hết token (2026-08-18) — hoãn, chưa có ai review.**

**Finding residual tự phát hiện lúc chạy `security-gate` (không phải lỗi code, là biên phạm vi CR):**
`ghi_chu` (Note) là nội dung đăng **verbatim** lên Dr.JOY khi `actionType='post'`
([`lib/automation-prompts.ts:216`](../../../server/lib/automation-prompts.ts#L216)). FR-4/AC-4 (theo đúng Codex
P1 #1 đã chốt) cố ý **không** so lệch `ghiChu` khi definition không có `template_id` — vì không có nguồn để so.
Hệ quả: nếu ai đó sửa `release_task_definitions.note` (không qua template) sau khi task đã sinh, kỳ vọng nó
"tự cập nhật" như các field khác của CR này, thay đổi đó **không** lan xuống task và **không** bị precheck chặn
— cùng HỌ lỗi với BUG-20260814 gốc, chỉ khác ở field `ghi_chu`-không-template thay vì `ai_note`. Đây là biên đã
được Codex+Claude duyệt có chủ đích (không phải sơ suất), nhưng Leader nên biết để quyết định: chấp nhận rủi ro
này (ghi vào rules/07 §6.2 là giới hạn đã biết), hay mở CR riêng cho cơ chế phát hiện sửa tay `note` không qua
template.

**Sửa thêm 2026-08-18 (phát hiện qua câu hỏi Leader về mockup UI):** gate FR-6 bản đầu bỏ sót ca `origin_ref`
CÒN nhưng definition đã bị xoá sau khi task đã sinh — rơi vào cùng nhánh trả `null` ("không tra được") như ca
`origin_ref` rỗng, nhưng code cũ chỉ cảnh báo cho ca `origin_ref` rỗng, ca definition-đã-xoá thì trôi qua im
lặng (không chặn, không cảnh báo). Đã viết test đỏ trước rồi sửa gộp chung — xem
[exchange 2026-08-18 §4](../../exchanges/2026-08-18.md).

## 17. Bob nghiệm thu (thay Codex — hết token) — 2026-08-18

> **Phạm vi nghiệm thu này:** kiểm tra code + test + docs theo từng AC. Việc duy nhất Bob không làm được
> thay là **smoke đợt thật** (bước 8 §10) vì cần DB người dùng thật — Leader phải tự tay.

### Kết quả từng AC

| AC | Nội dung | Cách kiểm | Kết quả |
|---|---|---|---|
| **AC-1** (FR-1) | UPDATE tại chỗ, id task không đổi, trang_thai giữ nguyên | `test/integration/schedules-release.test.ts` "AC-1: sửa ai_note … UPDATE tại chỗ, id task KHÔNG đổi" — dựng task, đổi `trang_thai` thủ công, lưu lại definition, khẳng định `id`/`trang_thai` không đổi nhưng `ai_note` đã cập nhật | ✅ PASS |
| **AC-2** (FR-2) | Đổi tên definition → 1 task, không sinh task mới, không xoá | "AC-2 (hồi quy BUG-20260814): đổi TÊN definition" — kiểm `rows.length === 1`, `rows[0].id === before.id` | ✅ PASS |
| **AC-3** (FR-3) | Task `da_hoan_thanh` → bỏ qua, lý do `done` | "AC-3: task đã hoàn thành" — set `trang_thai='da_hoan_thanh'`, kiểm `skip.reason === 'done'` và `ten_task` không đổi | ✅ PASS |
| **AC-4** (FR-4) | Definition không có template → câu UPDATE không chứa cột `ghi_chu` | `test/unit/release-render.test.ts` "AC-4: câu UPDATE dựng ra KHÔNG chứa cột ghi_chu" — kiểm SQL literal + `columns` array của `buildReleaseUpdateStatement` | ✅ PASS |
| **AC-4b** (FR-4) | Template render ra rỗng ≠ không có template | "AC-4b: definition CÓ template nhưng render ra rỗng" — `target.ghiChu === ''` (khác `null`), params chứa `''` | ✅ PASS |
| **AC-5** (FR-5) | Badge đếm đúng, cần 1 lượt query | `test/integration/schedules-release.test.ts` "FR-5 (drift)" — đổi title định nghĩa, `GET /drift` thấy lệch, sync xong thì biến mất. Code `loadTasksByOriginRef` + loop 1 lượt đã xác nhận không N+1 | ✅ PASS |
| **AC-6** (FR-6) | Task lệch definition → `blocked`, `task_lech_definition`, không spawn | `test/integration/automation.test.ts` "AC-9 (hồi quy BUG-20260814)" — task `ai_note` 374 ký tự, definition 1005, khẳng định `status='blocked'`, `code='task_lech_definition'` | ✅ PASS |
| **AC-6b** (FR-6) | Legacy (thiếu `origin_ref`) → không chặn, kèm `driftWarning` | Test "AC-6b" + "AC-6b (mở rộng)" — cả ca thiếu `origin_ref` lẫn ca `origin_ref` CÒN nhưng definition đã xoá đều trả `status='preview'` + `driftWarning` khớp | ✅ PASS |
| **AC-7** (FR-7) | `relatedIds` → `reply_to_ref` đúng definition | `test/unit/release-render.test.ts` "AC-7" + `test/integration/schedules-release.test.ts` scope đồng bộ đã dùng `buildDefinitionTargetPayload` tính `replyToRef` | ✅ PASS |
| **AC-8** (NFR) | Idempotent — lần 2 không có gì cần cập nhật | "AC-8: đồng bộ 2 lần" — `second.json.updated === 0` | ✅ PASS |
| **AC-9** (hồi quy) | Ca thật 14/08 không bao giờ ghi ra ngoài nữa | Test đỏ viết trước bước 1, xác nhận trực tiếp luồng `preview → blocked` trước khi spawn Claude | ✅ PASS |
| **AC-10** (FR-8 race) | User sửa Note giữa preview và apply → không mất | `buildReleaseUpdateStatement` không SET `ghi_chu` khi không có template (không có bước "đọc rồi ghi lại"), `planReleaseWrite` re-classify từ DB ngay tại request apply | ✅ PASS (thiết kế) — không có test "race" UI cụ thể nhưng cơ chế đủ |
| **AC-11** (FR-8) | Badge/preview/precheck dùng cùng `diffTaskAgainstDefinition` | `test/unit/release-render.test.ts` + grep: badge (`/drift`), `planReleaseWrite`, và `kiemTraLechDefinition` đều gọi cùng hàm từ `release-render.ts` | ✅ PASS |
| **AC-12** (FR-9) | Cổng máy đỏ nếu còn `DELETE … ten_task` ở route số ít | `test/unit/check-release-sync.test.ts` đủ 7 test + test "repo hiện tại xanh" chạy trên file thật | ✅ PASS |
| **AC-13** (FR-10) | FE không gửi `ghiChu`/`aiNote` tự dựng | `test/integration/schedules-release.test.ts` "AC-13: … request thiếu definitionId bị từ chối 400" | ✅ PASS |

### Kiểm tra docs-sync

| Doc | Cần cập nhật | Đã cập nhật? |
|---|---|---|
| `docs/specs/02` | Dấu lệch 3 nơi, mockup badge | ✅ — dòng 76–82 mô tả đủ 3 nơi + cách hiển thị |
| `docs/specs/03` | Endpoint drift, 3 route ghi, `task_lech_definition` | ✅ — mục 1 `taskDinhKy.lechDefinition`, mục automation precheck §2 |
| `docs/rules/07` | §6.2 một nguồn ghi, giới hạn `ghi_chu` không template | ✅ — §6.2 đầy đủ, giới hạn ghi rõ, marker `ten-task-match-ok` được mô tả |
| `docs/standards/qa-standard` | §8.2b smoke khi đụng nguồn định nghĩa | ✅ — có §8.2b |
| `docs/operations/automation-ai-go-live-guide` | `task_lech_definition` trong danh sách lý do `ready=false` | ✅ — dòng 249–251 |
| `docs/specs/04` | Không đổi (chốt `?2` không backfill) | ✅ — ghi rõ không đổi tại §11 |
| `docs/rules/06` | ~~Không có nội dung FE cần thêm~~ | ✅ — bỏ qua, đúng |

### Finding trong quá trình nghiệm thu

**NF-1 (không block):** `rules/06` không được cập nhật nhưng §11 gốc đã ghi `rules/06–07`. Sau khi kiểm tra nội dung `rules/06`, không có luật FE nào cần thêm liên quan CR này (FE chỉ hiển thị field backend tính) — bỏ qua là đúng, nhưng nên cập nhật §11 từ `rules/06–07` thành `rules/07` để không tạo nhầm lẫn về sau. → **Đã sửa ở §11 trên.**

**NF-2 (không block, chờ Leader quyết — đã ghi ở exchange §10 F1):** `planReleaseWrite` có thể insert task mới ngay cả khi đợt có task legacy trùng tên, không cảnh báo. Nằm ngoài phạm vi CR (đúng với `?2` đã chốt), nhưng rules/07 §6.2 chưa ghi giới hạn này — nên thêm tương tự `ghi_chu`-không-template.

### Kết luận

**PASS (cơ chế)** — 13/13 AC xanh qua test tự động, docs-sync đầy đủ, cổng máy FR-9 chạy trên repo thật.

**Còn chờ trước khi đóng hoàn toàn:**
1. **Smoke đợt thật** — Leader chạy `npm run backup-db` rồi vào màn Release kiểm 3 điểm: (a) sửa `ai_note` 1 definition → task đúng đợt cập nhật, task đã xong không bị đụng, Note không bay; (b) badge lệch hiện đúng số; (c) popup automation có banner `driftWarning` đúng chỗ.
2. **NF-2 (tùy Leader)** — thêm giới hạn insert-legacy vào `rules/07 §6.2` nếu muốn làm rõ.
3. **Đóng BUG-20260814 §6** sau khi smoke xong.
