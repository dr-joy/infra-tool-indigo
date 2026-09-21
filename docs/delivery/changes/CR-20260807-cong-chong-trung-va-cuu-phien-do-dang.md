# CR-20260807-cong-chong-trung-va-cuu-phien-do-dang — Cổng chống ghi trùng theo occurrence + cứu phiên automation dở dang

| Trường | Giá trị |
|---|---|
| Loại | ☑ Thêm mới ☑ Sửa hành vi |
| Mức tác động | ☑ Lớn (đụng DB, state machine automation, vòng tick, FE + BE, vùng nhạy cảm spawn-AI) |
| Người đề xuất | tuan.vu (Leader chốt gộp phạm vi), BA: Claude, phản biện: Codex |
| Ngày | 2026-08-07 |
| Backlog item | `BL-20260809-003` (`Picked`) |
| Trạng thái | ☑ **Đã nghiệm thu và đóng (§25)** |
| Spec liên quan | [docs/specs/03-api-business-logic-spec.md §2](../../specs/03-api-business-logic-spec.md) (Automation AI), [docs/specs/04-database-design.md](../../specs/04-database-design.md), [docs/exchanges/2026-08-07.md](../../exchanges/2026-08-07.md) (3 lượt họp + Codex review lượt 3) |

## 1. Bối cảnh & Vấn đề

Ngày 2026-08-07 là ngày đầu AI thật sự đăng bài ra ngoài. Ba lượt họp + review của Codex chốt lại **hai lỗ
hổng cùng nằm trên đường ghi ra ngoài**, và chúng liên quan nhau nên Leader chốt làm chung một lần:

1. **Chống ghi trùng đang dựa hoàn toàn vào trạng thái luôn đúng** — mà trong ngày 07/08 trạng thái đã sai
   2 lần. Cổng duy nhất hiện có là claim nguyên tử `approved → running` (`server/routes/automation.ts:435`),
   nó chỉ chặn được **hai request song song trong cùng một tiến trình đang sống**. Tiến trình chết rồi bật
   lại thì cổng đó biến mất, trong khi bài đã đăng vẫn nằm ngoài Dr.JOY. `automation_events.executed` có ghi
   nhưng **không ai đọc trước khi ghi lần sau**.
2. **Phiên tương tác dở dang không có đường về.** `needs_input` (AI đang hỏi user) và `checking` (đang
   precheck) đều không nằm trong `TERMINAL` lẫn `UNHANDLED` của `decideAutomationAction`
   (`server/lib/automation-helpers.ts:96,100`) → không tự hồi sinh sang ngày mới, không bao giờ thành
   `missed`. Vòng quét hỏi lại chỉ nhận `idle`/`needs_reconfirm` (`src/lib/automation-ask.ts:28`), và phiên
   chỉ sống trong state React (đổi ngày là xoá — `src/useAutomation.ts:41`, F5 là mất). Người dùng bình
   thường **mất đường phục hồi qua UI**; task định kỳ dính là các chu kỳ sau cũng câm luôn.

Codex bổ sung một ràng buộc quyết định thiết kế: **`running` không được đánh đồng với hai cái trên**. Tiến
trình có thể đã đăng bài xong rồi mới chết trước khi kịp ghi `done`; tự hồi `running` về `idle` là biến lỗi
kẹt thành **đăng trùng**. Vì vậy cổng chống trùng (mục 1) là **điều kiện tiên quyết** để dám phục hồi
`running`, và đó là lý do hai phần này đi chung một CR.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Một occurrence chỉ có thể ghi ra ngoài **đúng một lần**, kể cả khi app bị tắt/bật lại giữa chừng —
    ràng buộc nằm ở **tầng dữ liệu** (UNIQUE index), không dựa vào trạng thái trong RAM hay cột trạng thái.
  - Trước khi spawn Claude pha ghi, nếu occurrence đã ghi/đã giữ chỗ rồi thì **không spawn** (tiết kiệm cả
    rủi ro lẫn chi phí), trả 409 rõ nghĩa.
  - `needs_input`/`checking` bỏ dở luôn có đường về: hết hạn theo occurrence, và mở lại được từ UI.
  - `running` bị bỏ dở **không bao giờ tự chạy lại**; nó chuyển sang trạng thái nói rõ "không rõ đã ghi
    chưa" để người xử tay.
  - Người dùng nhìn timeline phân biệt được "AI đang hỏi bạn" với "chưa duyệt".
- **Ngoài phạm vi (không làm lần này):**
  - **Hồ sơ 2c — bằng chứng tra cứu do hệ thống thu** (Leader đã chốt hướng "chặn", nhưng tách CR riêng).
  - Hồ sơ 2 (trạng thái theo occurrence + màn hình nhật ký AI), 2b (gói đợt kế tiếp), 2d (trust boundary
    trong prompt), 9 (log vòng hỏi-đáp), 10 (atomic `/answer`), 11 (bài ★ bị `LIMIT` cắt).
  - KHÔNG đổi cửa sổ nhắc 5' / overdue 15' / nhịp tick 30s.
  - KHÔNG đụng pha precheck về mặt nội dung prompt.

## 3. Người dùng & Kịch bản

- Là **operator vận hành automation** (tuan.vu), tôi muốn chắc chắn rằng một bài/ticket chỉ được tạo đúng
  một lần cho mỗi lần chạy, kể cả khi tôi lỡ tắt app giữa chừng rồi mở lại — vì bài đã gửi tới đồng nghiệp
  thì không thu hồi sạch được.
- Là operator, khi AI hỏi tôi một câu mà lúc đó tôi bận, tôi muốn **quay lại trả lời sau** — mở task ra là
  thấy câu hỏi và trả lời được ngay, thay vì mất luôn cả lượt chạy đó mà không biết.
- Là operator, khi app chết lúc AI đang thực thi, tôi muốn app **nói thẳng "không rõ đã đăng chưa, đi kiểm
  tra đi"** thay vì âm thầm mời tôi chạy lại.

## 4. Yêu cầu chức năng

### Phần A — Cổng chống ghi trùng (hồ sơ 1)

- **FR-1 (giữ chỗ trước khi ghi):** Trong `executeApprovedTask`, **trước khi spawn Claude pha ghi**, ghi
  một bản ghi **giữ chỗ** vào `automation_events`: `event='execute_reserved'`,
  `dedupe_key='<occurrenceKey>:execute_reserved'`. UNIQUE index sẵn có (`idx_auto_events_dedupe`) khiến lần
  giữ chỗ thứ hai cho cùng occurrence **ném lỗi** → chuyển thành `HttpError(409)` với message nêu rõ
  occurrence đã được thực thi/đang thực thi, và **KHÔNG spawn Claude**.
  - Giữ chỗ phải nằm **ngoài** transaction bao quanh phần cập nhật kết quả — nó là mốc bền, không được
    rollback theo kết quả.
  - Thứ tự bắt buộc: claim nguyên tử `approved → running` (giữ nguyên, chặn race trong tiến trình) → giữ
    chỗ (chặn race xuyên tiến trình) → spawn Claude.
- **FR-2 (cổng đọc trước, thân thiện):** Trước cả FR-1, kiểm nhanh occurrence đã có event `executed` chưa;
  có rồi → 409 với message "Occurrence này đã ghi ra ngoài rồi" và không đổi trạng thái gì. Đây là cổng
  *thông báo đẹp*; cổng *đúng đắn* vẫn là FR-1 (không được coi FR-2 là bảo đảm — nó có cửa sổ race).
- **FR-3 (giải phóng khoá — chỉ khi có bằng chứng):** Bản giữ chỗ không được khoá vĩnh viễn một occurrence
  chưa hề ghi gì. Ba nhánh:
  1. **Chưa từng spawn** (`ClaudeNotConfiguredError`) → gỡ khoá, task về `failed`, thử lại được.
  2. **Claude chạy xong và trả báo cáo đọc được, không có dấu vết ghi** (`articleId`/`link`/`success` đều
     trống) → "hỏng CÓ bằng chứng" → gỡ khoá, task về `failed` như hành vi cũ. Không gỡ ở đây thì nút
     "Thử lại" sẽ 409 vĩnh viễn — chỉ là đổi ngõ cụt này lấy ngõ cụt khác.
  3. **Claude NÉM** (timeout / thoát khác 0 / CLI báo lỗi) → **KHÔNG BIẾT** nó đã kịp ghi hay chưa →
     **giữ khoá** và đưa task sang `unknown_outcome` (không phải `failed`, vì `failed` mời bấm "Thử lại").
  - **Ghi nhận trong lúc triển khai (đổi so với bản Draft):** bản đầu định dùng thêm mã lỗi `spawn_failed`
    làm bằng chứng "chưa chạy". Thực nghiệm cho thấy **không dùng được trên Windows**: runner spawn qua
    `shell: true` (để chạy `claude.cmd`), nên binary không tồn tại KHÔNG bắn event `error` mà đi tới nhánh
    "thoát khác 0" — không phân biệt được với "Claude đã chạy rồi hỏng giữa chừng". Tin vào nó là gỡ khoá
    nhầm cho một tiến trình có thể đã đăng bài xong. Mã lỗi vẫn được giữ trong `ClaudeRunError` (hữu ích
    trên nền khác + để chẩn đoán), nhưng nhánh 1 chỉ nhận `ClaudeNotConfiguredError`. Đo bằng **AC-4b**.

### Phần B — Cứu phiên dở dang (hồ sơ 1b)

- **FR-4 (hết hạn theo occurrence):** `decideAutomationAction` thêm nhóm `STALE_RECOVERABLE =
  ['needs_input', 'checking']`. Task ở các trạng thái này mà `automation_updated_at` thuộc **ngày VN khác**
  hôm nay → trả action mới `expire_stale`; vòng tick reset về `idle` (dọn `automation_question`/
  `automation_qa_history`) và ghi event `expired` (dedupe theo occurrence). Chu kỳ sau chạy lại bình thường.
- **FR-5 (lease cho `checking`):** `checking` **trong cùng ngày** mà `automation_updated_at` cũ hơn
  `CHECKING_LEASE_MINUTES = 10` (gấp đôi timeout 5' của `runClaude`) → coi là tiến trình đã chết, reset về
  `idle` + event `checking_timeout`. Không cần chờ sang ngày mới, vì pha precheck **chưa ghi gì ra ngoài**
  nên phục hồi là an toàn tuyệt đối.
- **FR-6 (`running` bỏ dở → `unknown_outcome`, KHÔNG tự chạy lại):** Thêm trạng thái mới
  `unknown_outcome`. `running` mà `automation_updated_at` cũ hơn `RUNNING_LEASE_MINUTES = 10` → chuyển
  `unknown_outcome` + event `unknown_outcome`, ghi `automation_error` nêu rõ "tiến trình thực thi bị gián
  đoạn — chưa xác nhận được đã ghi ra ngoài hay chưa".
  - `unknown_outcome` **KHÔNG** thuộc `UNHANDLED` (không thành `missed`), **KHÔNG** được vòng quét mời chạy
    lại, và **KHÔNG** tự reset sang ngày mới. Nó chỉ thoát bằng thao tác tay của user (FR-8).
  - Bản `execute_reserved` **giữ nguyên** → kể cả user có bấm gì thì FR-1 vẫn chặn lần ghi thứ hai.
- **FR-7 (mở lại phiên `needs_input` từ UI):**
  - `automationTimelineBadge` có nhãn riêng cho `needs_input`: "AI đang hỏi" (`ai-badge-pending`, khác hẳn
    "Chưa duyệt"). Thêm nhãn cho `checking` ("Đang kiểm tra") và `unknown_outcome` ("Không rõ kết quả").
  - `dangChoNguoiQuyetDinh` **KHÔNG** thêm `needs_input` (không được tự bật popup đè lên người dùng); thay
    vào đó FE có **đường mở lại chủ động**: bấm vào badge/khối "AI đã làm gì" của task đang `needs_input`
    thì dựng lại phiên automation từ dữ liệu đã có trong `Task` (`automationQuestion` đã sẵn sàng ở
    `mapTask`/`types.ts`, không cần API mới).
- **FR-8 (thoát `unknown_outcome` bằng tay):** Khối "AI đã làm gì" trong popup sửa task hiện cảnh báo +
  2 lựa chọn, dùng lại `POST /api/automation/cancel` đã có: "Tôi đã kiểm tra — ĐÃ ghi ra ngoài rồi"
  (→ `done_with_warning`, giữ khoá occurrence) và "Tôi đã kiểm tra — CHƯA ghi gì" (→ `idle`, đồng thời gỡ
  bản `execute_reserved` để chạy lại được).
  - `POST /api/automation/cancel` mở rộng: chấp nhận thêm `status` = `done_with_warning` và `unknown_outcome`;
    riêng nhánh về `idle` **từ `unknown_outcome`** thì gỡ luôn bản giữ chỗ của occurrence hôm nay.
- **FR-9 (sửa chữ sai luật — K3):** `components/automation-popup.tsx` bỏ câu "Đây là lượt hỏi DUY NHẤT…",
  thay bằng câu nêu đúng luật hiện hành. Số lượt **KHÔNG được hard-code ở FE** (đó chính là cái bẫy đã sinh
  ra K3, cùng họ với D2).
  - **Cách làm sau khi cân nhắc:** không import `MAX_QA_ROUNDS` từ server (FE cố ý chỉ `import type` từ
    `server/`, xem đầu `src/types.ts` — kéo runtime của server vào bundle client là phá kỷ luật đó và tốn
    ngân sách bundle). Thay vào đó **BE trả kèm `askedRound`/`maxRounds`** trong response `needs_input`;
    FE chỉ hiển thị. Nguồn chân lý ở lại đúng một chỗ, và người dùng còn biết mình đang ở lượt mấy.

## 5. Yêu cầu phi chức năng

- Cổng chống trùng phải đúng **kể cả khi app bị kill -9**: vì thế nó là UNIQUE index trong DB, không phải
  biến trong RAM hay cột trạng thái.
- Không thêm truy vấn nặng vào vòng tick 30s: các kiểm tra mới đều đi qua index sẵn có
  (`idx_auto_events_occ`, `idx_auto_events_dedupe`).
- Tương thích dữ liệu cũ: task đang ở `running`/`checking`/`needs_input` từ trước khi triển khai vẫn phải
  được xử lý đúng theo luật mới (không cần migration dữ liệu — luật đọc `automation_updated_at` vốn đã có).
- Occurrence đã chạy **trước** CR này không có bản `execute_reserved`; FR-2 (đọc `executed`) là lưới đỡ cho
  các occurrence cũ đó.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI

```
Timeline badge:
  needs_input     -> "AI · AI đang hỏi"      (bấm vào -> mở lại phiên, hiện đúng câu hỏi cũ)
  checking        -> "AI · Đang kiểm tra"
  unknown_outcome -> "AI · Không rõ kết quả" (đỏ)

Popup sửa task, khối "AI đã làm gì", khi status=unknown_outcome:
  ⚠ Lần chạy trước bị gián đoạn. Chưa xác nhận được AI đã đăng/ghi ra ngoài hay chưa.
    Hãy mở đích đến kiểm tra bằng mắt, rồi chọn:
    [ Đã ghi ra ngoài rồi ]   [ Chưa ghi gì — cho chạy lại ]
```

### 6.2. API & nghiệp vụ

- `POST /api/automation/execute` — response không đổi; thêm **409** khi occurrence đã `executed` (FR-2)
  hoặc đã có bản giữ chỗ (FR-1).
- `POST /api/automation/cancel` — nhận thêm `status ∈ {done_with_warning, unknown_outcome}`; nhánh
  `unknown_outcome → idle` gỡ bản `execute_reserved` của occurrence hôm nay (FR-8).
- Không có endpoint mới.

### 6.3. Dữ liệu & schema

- **Không thêm bảng/cột nào.** Toàn bộ cổng chống trùng dùng lại `automation_events.dedupe_key` +
  `idx_auto_events_dedupe` đã có sẵn từ CR-20260801 — đây là lý do phần A rẻ hơn vẻ ngoài của nó.
- Giá trị mới của `automation_status`: `unknown_outcome` (cột là TEXT, chỉ cần tài liệu hoá).
- Giá trị `event` mới trong `automation_events`: `execute_reserved`, `expired`, `checking_timeout`,
  `unknown_outcome`.

### 6.4. Automation / tích hợp

- **KHÔNG đổi whitelist tool, không đổi permission-mode, không đổi cách truyền prompt qua stdin.**
- Thay đổi *giảm* số lần spawn Claude (FR-1/FR-2 chặn trước khi spawn), không tăng.
- Nguyên tắc "mọi hành động ghi ra ngoài phải có người duyệt" giữ nguyên: CR này chỉ siết thêm, không nới.

## 7. Phân tích tác động

- [x] Frontend (`src/lib/automation-ask.ts`, `src/components/AiKetQua.tsx`,
      `src/components/automation-popup.tsx`, `src/useAutomation.ts`, `src/types.ts`, `src/main.tsx`)
- [x] API route (`server/routes/automation.ts`) · [x] Automation/MCP (vòng tick)
- [ ] DB/migration (không thêm cột/bảng) · [ ] i18n · [ ] Đóng gói SEA/MCP
- [x] Bảo mật (vùng nhạy cảm spawn-AI → áp `security-gate`, xem mục Infra ở §12)
- [x] Dữ liệu cũ/backward-compat (occurrence cũ không có bản giữ chỗ — FR-2 đỡ)
- **Rủi ro & giảm thiểu:**
  - *Bản giữ chỗ khoá nhầm occurrence khi Claude chết ngay lúc spawn* → FR-3 gỡ khoá đúng nhóm lỗi "chắc
    chắn chưa ghi gì"; timeout cố ý KHÔNG được gỡ (thà kẹt còn hơn đăng trùng).
  - *`unknown_outcome` làm phiền user* → chỉ xuất hiện khi tiến trình thật sự chết giữa pha ghi, và đó đúng
    là ca cần người nhìn.
  - *Diff lớn (Leader đã được cảnh báo khi chốt gộp)* → chia commit theo 2 phần A/B, tự soi từng phần.
- **Ảnh hưởng chức năng đang chạy:** đường chạy thành công bình thường **không đổi hành vi** — chỉ thêm 1
  INSERT giữ chỗ trước khi spawn. Đường lỗi/gián đoạn đổi hành vi theo đúng chủ đích.

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1):** Given task approved đã thực thi xong (có `execute_reserved` + `executed`), When gọi
  `/execute` lần nữa cho **cùng occurrence** sau khi ép trạng thái về `approved`, Then trả 409 và
  **Claude KHÔNG được spawn lần nào** (đếm số lần gọi mock).
- **AC-2 (FR-1):** Given hai lời gọi `/execute` **song song**, Then đúng 1 thành công, 1 lỗi, và mock Claude
  được spawn đúng 1 lần (giữ nguyên bảo đảm cũ, không được hồi quy).
- **AC-3 (FR-1, xuyên tiến trình):** Given occurrence đã có bản `execute_reserved` trong DB nhưng trạng
  thái task bị ép về `approved` (mô phỏng app chết rồi bật lại), When `/execute`, Then 409 và không spawn.
- **AC-4 (FR-3.1):** Given chưa cấu hình `CLAUDE_BIN` (runner từ chối TRƯỚC khi spawn), When `/execute`,
  Then 503, task về `failed` **và** bản `execute_reserved` bị gỡ (approve lại rồi `/execute` thì chạy được).
- **AC-4b (FR-3.3):** Given `CLAUDE_BIN` trỏ file không tồn tại (trên Windows KHÔNG phân biệt được với
  "đã chạy rồi hỏng"), When `/execute`, Then task sang `unknown_outcome`, bản giữ chỗ **VẪN CÒN**, và lần
  `/execute` sau bị 409 mà không spawn lần nào.
- **AC-5 (FR-3.2, sửa theo Amendment §13):** Given Claude đã chạy pha ghi và tự báo thất bại nhưng app không có
  bằng chứng độc lập rằng chưa ghi ra ngoài, When `/execute`, Then task về `unknown_outcome`, bản giữ chỗ **vẫn còn**
  và không có đường “Thử lại” trước khi người dùng kiểm tra đích đến rồi reconcile bằng một trong hai lựa chọn của AC-11.
- **AC-6 (FR-4):** Given task ở `needs_input` với `automation_updated_at` của **hôm qua**, When tick chạy,
  Then task về `idle`, `automation_question`/`automation_qa_history` được dọn, có event `expired`.
- **AC-7 (FR-5):** Given task `checking` cùng ngày nhưng cũ hơn 10 phút, When tick chạy, Then về `idle` +
  event `checking_timeout`. Given mới 3 phút, Then **không** đụng vào.
- **AC-8 (FR-6):** Given task `running` cũ hơn 10 phút, When tick chạy, Then chuyển `unknown_outcome`, có
  event, và **KHÔNG** bị execute lại ở các lượt tick sau.
- **AC-9 (FR-6):** Given task `unknown_outcome` từ hôm qua, When tick chạy, Then **vẫn** `unknown_outcome`
  (không auto reset như các trạng thái cuối khác).
- **AC-10 (FR-7):** Given task `needs_input`, When render timeline của hôm nay, Then badge là "AI đang hỏi"
  chứ không phải "Chưa duyệt".
- **AC-11 (FR-8):** Given task `unknown_outcome`, When user chọn "Chưa ghi gì", Then task về `idle` và bản
  `execute_reserved` bị gỡ (chạy lại được). When chọn "Đã ghi rồi", Then `done_with_warning` và bản giữ chỗ
  còn nguyên (không chạy lại được).
- **AC-12 (FR-9):** Given popup ở `needs_input`, Then chữ hiển thị nêu đúng số lượt theo `MAX_QA_ROUNDS`,
  không còn câu "lượt hỏi DUY NHẤT".

## 9. Kế hoạch test

- Tầng test: ☑ Unit (`decideAutomationAction`, badge) ☑ Integration route (`/execute`, `/cancel`, tick)
  ☑ Render component (popup, AiKetQua) ☑ Smoke thủ công (mở app, giả lập kẹt)
- Ca lỗi/biên bắt buộc: đúng mốc 10 phút (biên lease); occurrence cũ **không có** bản giữ chỗ (tương thích
  ngược, phải chạy được); `unknown_outcome` không bị `missed`; giữ chỗ ghi bằng khóa ngày VN (không phải
  ngày máy — cùng bẫy BUG-20260804 §1).

## 10. Kế hoạch triển khai / rollback

- Thứ tự: Phần A (cổng chống trùng, BE + test) → chạy `npm run check` → Phần B (cứu phiên, BE tick + FE +
  test) → `npm run check` → tự soi diff từng phần → commit 2 commit tách bạch.
- Rollback: revert commit. Không có migration dữ liệu nên rollback sạch; các bản ghi
  `execute_reserved`/`expired` còn lại trong `automation_events` là vô hại (chỉ là dòng nhật ký thừa).
- **Việc vận hành làm ngay, không chờ code** (Leader chốt): tạm khoá 2 task release dạng `other` cho tới khi
  cấu hình xong `CLAUDE_READ_TOOLS_OTHER` **và** smoke từng capability.

## 11. Docs cần cập nhật sau khi làm xong

- [x] `docs/specs/03-api-business-logic-spec.md` §2 — cổng giữ chỗ ở `/execute`, `/cancel` mở rộng
- [x] `docs/specs/04-database-design.md` §4 — `unknown_outcome`, bảng "phiên dở dang", các `event` mới
- [ ] `docs/operations/` — quy trình xử lý task `unknown_outcome` (chưa làm: chờ smoke thủ công lần đầu để
      viết đúng những gì người vận hành thật sự phải bấm)

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-08-07 | |
| Phản biện — **thiết kế** | Codex | 2026-08-07 | ✅ (review lượt 3: tách `running` khỏi `checking`, giữ chống trùng ở ưu tiên 1) |
| Phản biện — **implementation** | Codex | 2026-08-07 | ✅ **Approve `dd224f8`** sau 3 lượt review (5 + 4 + 2 = 11 finding, đã xử lý hết — xem §13/§14/§15) |
| Leader | tuan.vu | 2026-08-07 | ✅ chốt gộp hồ sơ 1 + 1b, khoá `other`, hướng "chặn" cho 2c |
| Người triển khai | Claude | 2026-08-07 | commit `cde1497` + bản sửa 5 finding |
| QA nghiệm thu | | | |

## 13. Amendment (2026-08-07): xử lý 5 finding của Codex + 1 lỗi tự phát hiện

Codex review implementation `cde1497` và **không duyệt**. Nhận cả 5, đã sửa. Một lỗi nữa Claude tự
phát hiện khi đọc lại log test của chính mình cũng gộp vào đây.

| # | Finding | Kết luận | Đã sửa thế nào |
|---|---|---|---|
| 1 | **Sửa giờ xuyên được cổng chống trùng.** Khóa occurrence CÓ CHỨA GIỜ; `unknown_outcome` bị coi là "đã engage" nên đổi giờ đẩy nó sang `needs_reconfirm` → duyệt lại → khóa MỚI, không đụng bản giữ chỗ cũ | **Đúng, và nặng nhất** — nó vô hiệu hoá đúng thứ CR này sinh ra để bảo vệ | Loại `unknown_outcome` khỏi nhóm `engaged` trong `reconfirmNeededOnTimeChange`: trạng thái này CHỈ thoát bằng xác nhận tay của người, không bằng sửa task. Thêm cột bền `tasks.automation_occurrence_key` lưu occurrence đang treo |
| 2 | **`/cancel` có thể vô tình mở khoá.** Status gõ sai bị nuốt thành `idle`, mà `idle` từ `unknown_outcome` chính là lệnh gỡ khoá. Và `done_with_warning` nhận từ BẤT KỲ trạng thái nguồn nào | **Đúng** | Status ngoài whitelist → **400**, không mặc định `idle` nữa. Hai thao tác reconcile chỉ hợp lệ từ `unknown_outcome`, chuyển trạng thái bằng **compare-and-set** (`WHERE automation_status='unknown_outcome'`) nên request đến muộn không áp được lên trạng thái đã đổi |
| 3 | **"Claude báo thất bại" chưa phải bằng chứng chưa ghi gì** — nhất là `actionType='other'`: AI có thể đã tạo file Drive/ticket Redmine rồi hỏng ở bước phụ, mà report không có id bắt buộc cho các đích đó | **Đúng — đây là chỗ bản Draft §4 FR-3.2 của Claude sai** | Bỏ hẳn nhánh "hỏng CÓ bằng chứng". Nguyên tắc mới: **đã spawn pha ghi thì chỉ gỡ khoá tự động khi có bằng chứng ĐỘC LẬP** (chưa có → hồ sơ 2c). Mọi kết quả không chứng minh được đều về `unknown_outcome` |
| 4 | **Reconcile sang ngày khác thao tác sai occurrence** — `/cancel` tính khoá bằng giờ hiện tại | **Đúng, cùng gốc với #1** | Reconcile đọc `automation_occurrence_key` đã lưu; chỉ fallback sang tính lại cho bản ghi cũ chưa có cột |
| 5 | **Chưa có cổng thực thi việc tạm khoá `other`** — CR ghi là "việc vận hành", code không có gì | **Đúng** | Chặn **trong code**: `runPrecheckAndApply` trả `blocked` với reason `READ_TOOLS_NOT_CONFIGURED` **trước khi spawn** nếu whitelist tool đọc của `actionType` rỗng |
| + | **Vòng tick lặp 409 vô hạn** (Claude tự phát hiện, Codex không nêu) | Lỗi thật, do chính bản sửa gây ra | Bị cổng chặn thì task phải **ra khỏi vòng lập lịch** (`done_with_warning` nếu đã `executed`, `unknown_outcome` nếu chỉ có bản giữ chỗ), thay vì trả về `approved` — để nguyên `approved` là tick gọi lại mỗi 30s và 409 mãi mãi |

**Hợp đồng đổi theo** (đã đồng bộ vào `docs/specs/03` và `04`):

- `POST /automation/execute` có thể trả `{status:'unknown_outcome'}` — trước chỉ có `done`/`failed`.
  `failed` giờ chỉ còn cho ca **chưa từng spawn**.
- `POST /automation/cancel` trả **400** với status ngoài whitelist, **409** khi reconcile từ trạng thái
  không phải `unknown_outcome`. Whitelist bỏ `unknown_outcome` (không ai cần set thẳng vào đó).
- DB thêm cột `tasks.automation_occurrence_key` (nullable, migration idempotent) — **CR bản Draft ghi
  "không thêm cột nào", điều đó không còn đúng**; đây là cái giá phải trả để khoá không phụ thuộc giờ.
- Precheck có thể `blocked` **trước khi gọi AI** khi thiếu whitelist tool đọc.

**Test:** 230 backend (+7 ca mới bám đúng từng finding) + 73 frontend. Ba ca cũ đổi hợp đồng, trong đó
có ca từng tên là *"cancel status lạ → mặc định idle (an toàn)"* — Codex chứng minh nó **không** an toàn.

## 14. Amendment lượt 2 (2026-08-07): Codex review `1c9256d` — 4 finding nữa

Codex review bản sửa và **vẫn không duyệt**: hai lỗ hổng High còn lại đều nằm ở chỗ tôi vừa đụng vào.

| # | Finding | Kết luận | Đã sửa thế nào |
|---|---|---|---|
| 1 | **`unknown_outcome` vẫn thoát được qua status khác.** Whitelist còn nhận `canceled`/`auto_canceled`/`missed`, và chúng rơi xuống đường cũ → chuỗi lách `unknown_outcome → canceled → đổi giờ/sang ngày → idle → chạy với khoá MỚI` | **Đúng** — tôi chỉ rào hai lối ra mà quên rào cái cửa còn lại của chính hàm đó | Chặn theo **trạng thái nguồn**: đang `unknown_outcome` thì mọi đích khác `idle`/`done_with_warning` đều **409**, không cần biết đích là gì |
| 2 | **Giữ chỗ và cột occurrence chưa ghi nguyên tử.** Crash đúng giữa 2 statement → có reservation bền mà cột NULL, tái tạo đúng ca cột này sinh ra để diệt. Nhánh reconcile cũng gỡ khoá **ngoài** transaction | **Đúng** | Cả hai gộp vào **một** `withTransaction`. Nhánh gặp reservation đã tồn tại cũng gắn đúng occurrence vào task trước khi sang `unknown_outcome`. Reconcile gộp 3 việc (chốt trạng thái + gỡ khoá + ghi nhật ký) vào một transaction |
| 3 | **Fallback legacy vẫn tính lại khoá theo giờ hiện tại** — đúng phép đoán đã bị bác ở lượt trước | **Đúng** | Bỏ hẳn fallback. Thay bằng: (a) **backfill lúc migration** — tra `automation_events`, chỉ điền khi có ĐÚNG MỘT occurrence giữ chỗ; (b) lúc chạy, tra ngược tương tự; (c) không xác định được → **409, bắt xử lý tay**, không đoán |
| 4 | **Cổng tool đọc mới chỉ kiểm "có ít nhất một tool"**, chưa xác minh đúng connector (`CLAUDE_READ_TOOLS` chung khiến task `other` cần Drive vẫn lọt nếu biến chung có tool Dr.JOY) | **Đúng** | Không mở rộng cổng ở CR này (thuộc hồ sơ capability/evidence 2c). Thay vào đó **hạ đúng mức bảo đảm** trong code comment + hồ sơ: cổng chỉ bắt ca "không có tool đọc nào" |

**Trả lời hai câu tôi hỏi Codex:** cột `automation_occurrence_key` **đủ cho CR này** miễn giữ đúng
invariant (mỗi task tối đa một lượt ghi treo; không chạy occurrence mới khi occurrence cũ còn
`unknown_outcome`; reservation + cột + trạng thái cập nhật nguyên tử) — cả ba giờ đều đã có. Khi làm hồ sơ
2 (trạng thái theo occurrence) thì chuyển sang bảng execution riêng, vì một cột không biểu diễn được
occurrence cũ đang reconcile song song với occurrence mới. Về legacy: backfill, không đoán — đã làm đúng vậy.

**Test:** 235 backend (+5 ca cho lượt này, gồm `unknown_outcome → canceled/auto_canceled/missed` đều 409,
nhánh xung đột phải gắn đúng occurrence, và ca "không xác định được lượt treo → 409") + 73 frontend.

**Một lỗi tự phát hiện khi chạy test:** backfill đặt trong `themCotAutomationState()` chạy **trước** khi
bảng `automation_events` được tạo → DB mới toanh nổ `no such table`. Đã tách thành bước migration riêng
chạy sau. Ca này chỉ lộ ra vì test dùng DB trống hoàn toàn — máy đang chạy sẽ không bao giờ thấy.

## 15. Amendment lượt 3 (2026-08-07): Codex review `e0b1b9d` — 2 finding

| # | Finding | Kết luận | Đã sửa thế nào |
|---|---|---|---|
| 1 | **Backfill/lookup đếm cả reservation lịch sử đã hoàn tất.** Bản giữ chỗ của lượt THÀNH CÔNG được cố ý giữ vĩnh viễn, nên task định kỳ tích nhiều reservation cũ → (a) nhiều lượt xong + 1 lượt treo thì `COUNT>1` → 409 oan; (b) đúng 1 reservation cũ đã `executed` + lượt legacy không reservation → **gắn khoá của lượt đã xong** cho lần hỏng hiện tại | **Đúng — và tự mâu thuẫn với thiết kế của chính CR này** | Cả truy vấn migration lẫn truy vấn runtime chỉ tính reservation **chưa được giải quyết**: `NOT EXISTS (SELECT 1 FROM automation_events WHERE occurrence_key = e.occurrence_key AND event='executed')` |
| 2 | **`claimForRun` vẫn ngoài transaction giữ chỗ.** Crash giữa claim và reserve → task `running` không khoá → lease đẩy sang `unknown_outcome` không có occurrence → cả hai nút xác nhận đều 409 = ngõ cụt | **Đúng** | Gộp `claim` + `INSERT execute_reserved` + ghi cột vào **một** transaction. Mất claim → ném để rollback sạch, task vẫn `approved` |

**Một chỗ cố ý lệch khỏi đề xuất Codex** (đã nêu trong kênh trao đổi để Codex chốt): khi không xác định
được lượt treo, Codex đề xuất chặn **cả hai** thao tác xác nhận. Bản này chặn *"đã ghi rồi"* (ghi `executed`
cần occurrence có thật) nhưng **cho phép** *"chưa ghi gì"* — vì lúc đó không có khoá nào để gỡ nên app không
suy đoán gì, và chặn cả hai sẽ để lại đúng cái ngõ cụt mà finding #2 của Codex dùng để bác bản trước.

**Test:** 239 backend (+4 ca: 3 ca lịch sử reservation, 1 ca mất claim phải rollback sạch) + 73 frontend.

## 16. Triển khai (2026-08-07) — Codex approve `dd224f8`

Codex approve, không còn finding chặn merge, và **đồng ý chỗ Claude cố ý lệch** ở §15 (không có reservation
chưa giải quyết thì cho phép *"chưa ghi gì"*, vẫn chặn *"đã ghi rồi"*). Định nghĩa "chưa giải quyết" bằng
`NOT EXISTS (executed cùng occurrence_key)` được xác nhận là đủ.

### Đã làm theo đúng khuyến nghị của Codex trước khi migration chạm dữ liệu thật

| Bước | Kết quả |
|---|---|
| `npm run backup-db` | ⚠️ **Lần đầu SAI, đã sửa** — xem §17. Bản đúng: `%APPDATA%/TaskManager/data/backups/tasks-2026-08-07_220032.sqlite` (7 task, 21 event, integrity OK) + OneDrive |
| Smoke backfill trên **bản sao DB thật** | 6/6 pass — và đã chuyển thành **test tự động** để tái lập được (§17) |
| `npm run package` | `release/TaskManager/TaskManager.exe` dựng lại (88.9 MB) — trước đó exe từ **05/07**, tức mọi thay đổi hôm nay chưa hề chạy trên máy Leader (nợ I2 của biên bản sáng). **Đóng gói ≠ đã khởi động**: bản mới chưa được chạy lần nào |

**Smoke backfill** (gieo đúng các ca legacy vào bản sao DB thật rồi cho app thật khởi động):

| Ca | Kỳ vọng | Kết quả |
|---|---|---|
| Task định kỳ có 2 lượt **đã xong** + 1 lượt **đang treo** | Điền đúng occurrence đang treo | ✅ |
| Chỉ có 1 reservation **đã xong**, lượt hiện tại không có reservation | **KHÔNG** gắn khoá cũ đó (ca sai #2 Codex nêu ở lượt 3) | ✅ để NULL |
| Hai lượt treo chưa xong | Để NULL, không đoán | ✅ |
| Task không treo | Không bị gắn khoá — dữ liệu lành nguyên vẹn | ✅ |
| Số task + `PRAGMA integrity_check` | Không đổi / `ok` | ✅ |

Trên DB thật hiện tại, backfill là **no-op**: 0 task ở `running`/`unknown_outcome`, 0 bản `execute_reserved`
(cơ chế này chưa từng chạy thật). Smoke phải gieo dữ liệu mới chứng minh được gì — không lấy "no-op nên an
toàn" làm bằng chứng.

### Còn lại — việc của NGƯỜI, máy không kiểm hộ

- **Smoke UI thủ công** (qa-standard §8): badge "AI đang hỏi" / "Không rõ kết quả" trên timeline, nút
  "Mở lại để trả lời", 2 nút xác nhận trong popup sửa task. Có test render nhưng **chưa ai bấm thật** —
  máy này không có trình duyệt tự động. Đây là lý do CR chưa chuyển "Đã nghiệm thu".
- **`docs/operations/`**: mục quy trình xử lý `unknown_outcome` — cố ý viết sau smoke UI để tả đúng cái
  người vận hành thật sự phải bấm.
- **Tạm khoá 2 task `other`** cho tới khi cấu hình `CLAUDE_READ_TOOLS_OTHER` **và** smoke từng capability.
  Cổng code đã chặn tự động (`READ_TOOLS_NOT_CONFIGURED`), nhưng cổng đó chỉ bắt ca "không có tool nào" —
  không xác minh đúng connector (xem §14 #4).
- **Push code**: các commit vẫn ở local, xác thực GitHub chưa xong.

## 17. Codex review báo cáo triển khai — 2 finding, đã xử lý

Codex **giữ approve cho code `dd224f8`** nhưng **không duyệt phần báo cáo "đã triển khai"**. Cả hai đúng.

| # | Finding | Sự thật kiểm chứng được | Đã sửa |
|---|---|---|---|
| 1 (High) | `npm run backup-db` sao lưu **nhầm DB** | `scripts/backup-db.mjs:28` trỏ `<repo>/data/tasks.sqlite`, còn app dùng `%APPDATA%/TaskManager/data` (`server/paths.ts:29`). Đếm thật: file repo có **6 task và KHÔNG CÓ bảng `automation_events`** — là DB có từ trước khi tồn tại automation. DB thật: **7 task, 21 event** | Sửa script dùng đúng nguồn của `server/paths.ts`; in rõ dòng `Nguồn: <đường dẫn>` trước khi chạy; đếm thêm số event automation. Chạy lại: `tasks-2026-08-07_220032.sqlite` — **7 task, 21 event**, đã lên OneDrive |
| 2 (Medium) | Trạng thái "Đã triển khai" đi trước bằng chứng — đóng gói xong không có nghĩa đã khởi động | Đúng: không có tiến trình `TaskManager.exe` nào chạy, chưa smoke UI | Hạ trạng thái CR thành **"Đã đóng gói, chờ khởi động + smoke UI"** |
| 3 (khuyến nghị) | Kết quả smoke 6/6 chỉ nằm trong tài liệu, không tái lập được | Commit `8e54540` chỉ đổi 2 file Markdown | Chuyển thành **test tự động** trong `automation-scheduler.test.ts` (`migration backfill: điền đúng lượt treo, không đoán, không đụng dữ liệu lành`), gồm cả kiểm idempotent khi chạy hai lần |

**Điều đáng nói về finding #1:** con số mâu thuẫn đã nằm ngay trước mắt Claude — `backup-db` in "6 tasks",
còn ảnh chụp DB thật vài phút sau in "7 task" — và Claude đã đọc cả hai mà không đối chiếu. Một script
backup nói dối nguy hơn không có backup, vì nó được dùng làm **điều kiện an toàn trước migration**. Đây là
lỗi nghiêm trọng nhất trong cả ngày xét theo hậu quả tiềm tàng, và nó không nằm trong code sản phẩm.

**May mắn ngoài dự tính:** `npm run package` có tạo `%APPDATA%/TaskManager/data/backups/tasks-build-backup.sqlite`
từ đúng DB thật (7 task, 21 event) — nên thực tế vẫn luôn có một bản sao đúng. Nhưng đó là may, không phải
do quy trình, và không thể tính là bằng chứng an toàn.

## 18. Nghiệm thu (2026-08-08): phần máy kiểm được đã xong

Leader đề nghị "cứ đánh smoke rồi là được, tôi làm sau". **Không đánh dấu đã smoke khi chưa ai nhìn** — đó
đúng là lỗi Codex bắt ở §17 mục 2 (*trạng thái đi trước bằng chứng*), và sổ cái `docs/delivery/` là dữ liệu
vĩnh viễn. Thay vào đó: **kéo phần phải bấm tay xuống mức nhỏ nhất**.

Khối `AiKetQua` — nơi chứa cả hai lối thoát của CR này — trước đó chỉ có test cho `idle`/`done`/
`done_with_warning`, **chưa có test nào cho hai nhánh mới**. Đã bù `test/client/ai-ket-qua-loi-thoat.test.tsx`
(8 ca):

| Nhánh | Ca đã phủ |
|---|---|
| `needs_input` (FR-7) | hiện đúng câu hỏi đang treo · bấm "Mở lại để trả lời" gọi đúng callback kèm task · không có callback thì **không bày nút chết** |
| `unknown_outcome` (FR-8) | hiện cảnh báo + đúng 2 lựa chọn · "Đã ghi rồi" gửi `done_with_warning` (giữ khoá) · "Chưa ghi gì" gửi `idle` (gỡ khoá) · API lỗi thì nuốt lỗi, không sập popup, vẫn bấm lại được · trạng thái khác thì **tuyệt đối không bày 2 nút** |

Cộng với test badge timeline (`automation-ask.test.ts`) và test popup phiên (`automation-popup.test.tsx`)
đã có từ trước, **toàn bộ hành vi của giao diện đã có test tự động**.

### Phần còn lại — đúng những gì máy KHÔNG kiểm được

Test render dựng component trực tiếp; nó **không** chứng minh 3 điều sau, và chỉ mắt người mới xác nhận được:

1. Khối/badge **thật sự xuất hiện đúng chỗ** trong app đang chạy (dây nối từ `main.tsx` xuống, đúng task, đúng ngày).
2. Bấm "Mở lại để trả lời" thì popup phiên **mở ra và hiện đúng câu hỏi cũ** (đi qua `moLaiPhienHoi` + state thật).
3. Nhìn tổng thể không vỡ layout / không chồng chữ.

**Checklist smoke cho Leader (khoảng 1 phút):** mở app → tìm một task AI của hôm nay → nhìn badge trên
timeline → mở task đó ra xem khối "AI đã làm gì" có hiện không. Chỉ vậy. Sau khi Leader xác nhận, CR chuyển
"Đã nghiệm thu" và viết nốt `docs/operations/`.

**Trạng thái vì thế vẫn là "Đã đóng gói, chờ khởi động + smoke UI"** — không tự nâng.

## 19. Amendment (2026-08-09): tái kích hoạt qua BL-003 — kế hoạch nghiệm thu chờ Claude review

Leader đã pick `BL-20260809-003`. Từ khi §18 được viết, CR-20260808 đã thay đổi luồng popup/result feed và toàn bộ lịch sử đã được push lên
`main`; vì vậy không dùng lại file EXE cũ hoặc checklist cũ một cách máy móc. Kế hoạch mới phải kiểm đúng code hiện tại, không mở capability
`other` và không tạo hành động ghi thật ra Dr.JOY/Redmine/Drive.

Kế hoạch chi tiết, ma trận smoke, điều kiện dừng và câu hỏi review nằm tại
[exchange §35](../../exchanges/2026-08-09.md). Trình tự bắt buộc là: baseline an toàn → smoke UI trên DB cô lập bằng mock → preflight DB thật
rồi mới khởi động bản đóng gói mới nhất → viết runbook từ hành vi đã quan sát → full gate + đối chiếu AC → Claude audit bằng chứng → Leader nghiệm thu.

**HOLD:** chưa chạy package, chưa khởi động app và chưa tạo fixture cho tới khi Claude review kế hoạch §35 và trả `PASS` hoặc
`PASS WITH NOTES` không có blocker.

## 20. Amendment (2026-08-09): Claude review kế hoạch §35 — ✅ PASS WITH NOTES

Claude đối chiếu kế hoạch với code thật trên `main` (không chỉ đọc mô tả): state machine backend (`STALE_RECOVERABLE`,
`mark_unknown`), badge + khối `AiKetQua` FR-7/FR-8, và route `/automation/cancel` đều còn đúng nguyên vẹn sau refactor
CR-20260808; seam giữa hai CR ở `mark_unknown` → snapshot result-feed đã được xử lý từ trước (comment code trỏ đúng
"FR-4 (CR-20260808) §24.2"). Cơ chế single-instance (`EADDRINUSE`) đã tự chặn rủi ro 2 vòng tick cùng chạm DB thật, không cần
thêm bước preflight nào. Chi tiết trả lời từng câu hỏi ở [exchange §36](../../exchanges/2026-08-09.md).

**1 note không chặn:** AC-5 (§8) còn ghi hành vi CŨ ("báo thất bại không dấu vết → `failed`") đã bị chính Amendment §13 đảo
ngược — code thật hiện tại chuyển ca này sang `unknown_outcome`. Không chặn kế hoạch (G7 chỉ đối chiếu AC-7/8/11, AC-5 đã có
test backend riêng), nhưng nên sửa câu chữ AC-5 khi có dịp động vào file này.

**Verdict: ✅ PASS WITH NOTES — không có blocker.** Codex có thể tiến hành G0–G7 theo đúng trình tự đã viết ở §35.

## 21. Amendment (2026-08-09): Codex tiếp thu review §20 — chấp nhận PASS WITH NOTES

Codex kiểm tra note AC-5 với cả code thật (`server/routes/automation.ts`) và regression test
`AC-5: Claude tự báo thất bại KHÔNG phải bằng chứng -> unknown_outcome + GIỮ khóa`; finding là đúng. Đã sửa AC-5 ở §8 để mô tả
`unknown_outcome` + giữ reservation + bắt buộc reconcile tay, khớp Amendment §13 và hành vi hiện tại. Đây là sửa tài liệu lỗi thời,
không đổi code hoặc phạm vi kế hoạch.

**Kết luận nhận review:** chấp nhận `PASS WITH NOTES`; note duy nhất đã xử lý. BL-003 sẵn sàng bắt đầu G0, nhưng chưa có gate smoke nào
được tuyên bố đạt trong amendment này.

## 22. Amendment (2026-08-09): thực hiện BL-003 G0–G6 — máy/API PASS, UI manual HOLD

Đã thực hiện kế hoạch §19–§21 trên code hiện tại:

- **G0 PASS:** `npm run check` đạt 280 backend + 208 frontend; TypeScript/build/bundle/docs/gốc thời gian đều xanh.
- **G1 PASS:** đóng gói EXE mới 93,238,272 byte; EXE chạy với `APPDATA` cô lập, trả API 200; instance thứ hai cùng cổng tự thoát mã 0.
- **G2 machine PASS:** mock `needs_input` lưu bền câu hỏi qua API/DB và vẫn trả đúng task sau lần nạp dữ liệu mới. Browser runtime không có browser
  khả dụng nên badge/layout/nút “Mở lại để trả lời” chưa được mắt người xác nhận.
- **G3 PASS ở EXE/API/DB cô lập:** hai lượt mock sau spawn đều vào `unknown_outcome` với occurrence + reservation + result snapshot. Nhánh
  “đã ghi” chuyển `done_with_warning`, đánh task hoàn thành và giữ reservation.
- **G4 PASS ở EXE/API/DB cô lập:** nhánh “chưa ghi” về `idle`, gỡ reservation; restart cùng DB với mock `ready` rồi retry cùng occurrence đạt
  `done`, tổng spawn đúng 6 cho ba chuỗi preview/execute, không kẹt `running`.
- **G5 PASS:** backup thật `tasks-2026-08-09_144543.sqlite` được tạo local + OneDrive, 25 task/76 event, integrity `ok`. Preflight không có
  `approved/running/checking/needs_input/unknown_outcome`; EXE mới mở DB thật thành công, task giữ 25, integrity vẫn `ok`. Scheduler chỉ thêm
  ba event `reset` hợp lệ cho task chu kỳ cũ (event 77–79), không execute hay ghi ra hệ thống ngoài.
- **G6 PASS phần tài liệu máy:** viết runbook `docs/operations/automation-unknown-outcome-runbook.md`, cập nhật hai index; link/docs check xanh.

Đã mở lại EXE trên DB cô lập tại `http://127.0.0.1:4000` cho manual smoke: task `7` là `needs_input`; task `8` và `9` là hai fixture
`unknown_outcome` để Leader kiểm lần lượt nhánh “đã ghi”/“chưa ghi”. Tất cả dùng mock, không có connector hoặc side effect thật.

**Trạng thái: HOLD UI/manual.** Không đánh dấu `Đã nghiệm thu` và chưa đóng BL-003 cho tới khi Leader xác nhận các entry point/layout/nút trên UI;
sau đó chạy/ghi full gate cuối và nhờ Claude audit evidence trước khi đóng.

## 23. Amendment (2026-08-09): manual smoke bắt lỗi snapshot cũ — đã sửa, chờ Claude audit

Leader đi đúng đường `unknown_outcome` trên EXE fixture nhưng khi bấm **“Mở task để xử lý”**, editor không hiện khối
**“AI đã làm gì”** và vì vậy không có hai nút reconcile. Đây là finding trong CR chưa nghiệm thu, không tách BUG/backlog mới.

### Nguyên nhân và bản sửa

`PopupAutomationSession` giữ `session.task` là snapshot từ lúc bắt đầu preview (`idle`/`preview`). Sau khi `/execute` trả
`unknown_outcome`, dashboard đã tải task mới từ server nhưng handler `onOpenTask` vẫn truyền snapshot cũ vào `PopupSuaTask`.
`AiKetQua.coKetQuaAI()` nhìn thấy `idle` nên trả `null`; trạng thái DB đúng nhưng lối xử lý UI biến mất.

Đã sửa `src/main.tsx`: mọi đường **Mở task từ automation session** tìm task cùng ID trong `duLieu` mới nhất trước, chỉ fallback
về snapshot session nếu dashboard thật sự chưa có task. Cả nhánh có occurrence và nhánh chưa có occurrence dùng cùng bản mới nhất;
không đổi API, DB hoặc state machine.

### Bằng chứng đỏ → xanh và smoke thật

- Regression test mới trong `test/client/main-automation-integration.test.tsx` đi hết luồng create → preview → approve → execute
  `unknown_outcome` → “Mở task để xử lý”. Trước sửa test đỏ tại `AI đã làm gì`; sau sửa hiện đúng khối này và nút
  `Chưa ghi gì — cho chạy lại`.
- Quét lân cận bằng `rg -n "setTaskDangSua\\(|onOpenTask=|automationSession\\.task|session\\.task" src/main.tsx src/useAutomation.ts src/components`:
  đường result queue đã lấy task từ `duLieu`; đường direct session là chỗ duy nhất còn truyền snapshot cũ vào editor và đã sửa.
- `npm run check` sau sửa: **280 backend + 209 frontend**, TypeScript/build/bundle/docs/gốc thời gian đều xanh.
- Đóng gói lại EXE và chạy trên DB fixture cô lập; API 200, task `10` bắt đầu ở `unknown_outcome`.
- Leader F5, mở task và xác nhận UI mới đã dùng được. DB ghi event `reserve_released` với detail
  `người dùng xác nhận chưa ghi gì`, xóa occurrence treo; sau đó Leader chủ động duyệt lượt mới nên task chuyển sang `approved`.
  Chuỗi sau là bằng chứng task đã được mở khóa để retry, không phải app tự ý ghi lại. Toàn bộ fixture dùng mock `fail`, không có
  side effect ngoài.
- Sau smoke đã dừng EXE mock và xóa `.tmp` (chỉ chứa fixture, không có dữ liệu thật). Preflight DB thật: integrity `ok`, 25 task,
  không có `approved/running/checking/needs_input/unknown_outcome`; EXE mới đã mở lại DB thật, API 200, không còn biến môi trường mock.

**Trạng thái:** bản sửa và manual smoke nhánh “chưa ghi” đã đạt; giữ CR/BL-003 ở `Picked` để Claude audit finding, diff và bằng chứng
trước khi đóng nghiệm thu.

## 24. Amendment (2026-08-09): Claude audit finding §23 — ✅ PASS

Claude đọc diff, tự chạy 19/19 test, tự negative-proof (sabotage cả 2 nhánh `onOpenTask` về dùng snapshot cũ → đúng 1 test đỏ, 18 test
khác không đổi → khôi phục → xanh lại), và tự grep độc lập xác nhận đúng 3 điểm `onOpenTask=` trong `main.tsx`: 2 điểm (hàng chờ kết quả)
đã dùng `duLieu` tươi từ trước, chỉ điểm thứ 3 (direct/recovery session) là nơi duy nhất dính lỗi và đã được sửa — khớp với kết quả `rg`
Codex tự báo. Chuỗi DB `unknown_outcome → reserve_released → approved` nhất quán với invariant CAS đã review kỹ ở Amendment §14/§15
(chỉ gỡ khóa qua xác nhận tay, không có đường tự set `approved`). Chi tiết ở [exchange §41](../../exchanges/2026-08-09.md).

**Verdict: ✅ PASS — không có blocker, không có finding mới.** Có thể chốt phần manual còn lại và tiến hành đóng CR-20260807/BL-003.

## 25. Nghiệm thu và đóng CR (2026-08-09)

Leader đã xem kết quả manual smoke và review độc lập của Claude §24, xác nhận BL-003 có thể đóng. Đối chiếu cuối:

- Luồng `needs_input` và `unknown_outcome` có entry point phục hồi, không tự retry một lượt có thể đã ghi ra ngoài.
- Nhánh “đã ghi” giữ reservation và đóng task; nhánh “chưa ghi” gỡ đúng reservation rồi chỉ chạy lại sau hành động duyệt mới của user.
- Finding UI snapshot cũ được bắt bằng smoke thật, có regression test đỏ → xanh và Claude negative-proof PASS.
- EXE, API, DB cô lập, preflight DB thật, single-instance và runbook vận hành đều có bằng chứng tại §22–§24.
- Full gate cuối: 280 backend + 209 frontend; TypeScript/build/bundle/docs/gốc thời gian xanh.

Các nhu cầu UX phát hiện ngoài phạm vi đã vào backlog riêng (`BL-20260809-010`, `BL-20260809-011`), không kéo dài CR này.

**Kết luận:** đạt yêu cầu gốc và AC liên quan; CR-20260807 **Đã nghiệm thu**, BL-20260809-003 chuyển `Done`.
