# CR-20260807-hoi-dap-tuong-tac-automation — Cho AI hỏi lại user 1 lượt trong pha precheck automation

| Trường | Giá trị |
|---|---|
| Loại | ☑ Thêm mới |
| Mức tác động | ☑ Lớn (đụng DB, state machine automation, FE + BE, vùng nhạy cảm spawn-AI) |
| Người đề xuất | tuan.vu (Leader), BA: Claude |
| Ngày | 2026-08-07 |
| Trạng thái | ☑ **Đã nghiệm thu** — ghi chú 2026-08-21: dòng trạng thái này bị bỏ quên "Draft" dù đã triển khai và mở rộng từ lâu (state machine `needs_input` ở `server/db.ts`; `MAX_QA_ROUNDS` nâng từ 1 lên 5 lượt, `server/lib/automation-prompts.ts`; route trả lời ở `server/routes/automation.ts`) — sửa lại đúng thực tế, không đổi code |
| Spec liên quan | [docs/specs/03-api-business-logic-spec.md §2](../../specs/03-api-business-logic-spec.md) (Automation AI), [docs/exchanges/2026-08-05.md](../../exchanges/2026-08-05.md) (bối cảnh phát sinh — task E1 cần hỏi tên người) |

## 1. Bối cảnh & Vấn đề

Pha precheck automation hiện là **1 lượt gọi duy nhất**: BE dựng prompt → gọi Claude headless → nhận về
`ready=true` (preview) hoặc `ready=false` (blocked, liệt kê lý do). Nếu thiếu thông tin, user phải tự sửa
Note/aiNote rồi bấm "Đã sửa, kiểm tra lại" — không có cách nào AI **hỏi trực tiếp** một câu cụ thể rồi
dùng câu trả lời để tự tra cứu tiếp.

Vấn đề lộ rõ khi soạn task `Confirm các thông tin cần thiết` (Release khẩn cấp, xem
[emergency-release.md](../../ai-prompts/release/emergency-release.md) E1): AI cần biết **tên người cần
hỏi** — thông tin này KHÁC NHAU mỗi lần khẩn cấp, không thể viết cố định trong prompt. Giải pháp tạm hiện
tại (Leader tự điền tên vào Note trước khi tạo task thật) hoạt động nhưng cứng nhắc — User đề xuất thêm 1
bước tương tác chung: AI hỏi → user trả lời → AI tự tra cứu (dùng tool đọc) → mang kết quả về cho user xác
nhận trước khi duyệt.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Trong pha precheck (đọc, trước khi có preview), AI có thể trả về "cần hỏi thêm" kèm 1 câu hỏi cụ
    thể, thay vì bắt buộc phải chọn `ready=true`/`false` ngay.
  - User trả lời ngay trong popup automation đang có (không mở popup mới) → BE gọi lại AI đúng 1 lần nữa
    kèm câu trả lời, AI tự tra cứu bằng tool đọc rồi **bắt buộc** kết luận `ready=true`/`false` ở lượt này
    (không được hỏi thêm lượt 2).
  - Thời gian user đang trả lời câu hỏi KHÔNG bị tính vào cửa sổ "quá giờ 15 phút" (không tự động chuyển
    `missed` trong lúc chờ trả lời).
  - Áp dụng chung cho mọi automation (`actionType=post` và `other`), không riêng task nào.
- **Ngoài phạm vi (không làm lần này):**
  - KHÔNG áp dụng cho pha **execute** (sau khi đã duyệt) — pha đó vẫn 1 lượt như cũ.
  - KHÔNG cho hỏi nhiều hơn 1 lượt/lần precheck (nếu AI cố hỏi lượt 2 → BE chặn, coi là `blocked`).
  - KHÔNG đổi cơ chế tick 30s hay cửa sổ nhắc 5 phút trước giờ.

## 3. Người dùng & Kịch bản

- Là **operator vận hành automation** (tuan.vu), khi AI thiếu 1 thông tin không thể viết cố định trong
  prompt (vd "hỏi ai" ở task khẩn cấp), tôi muốn AI hỏi đúng câu cần hỏi, tôi trả lời ngay trong popup,
  rồi AI tự tra cứu và cho tôi xem kết quả tìm được TRƯỚC khi tôi bấm Duyệt — để tôi biết chắc AI đã tìm
  đúng chứ không phải đoán.

## 4. Yêu cầu chức năng

- **FR-1:** `CONTRACT_DOC` (schema JSON pha precheck) thêm 2 field tuỳ chọn ở top-level:
  `needsInput: boolean` (mặc định false), `question: string|null`. Khi `needsInput=true`, các field
  `ready/reasons/target/...` không cần điền đủ (AI đang hỏi, chưa kết luận).
- **FR-2:** DB — thêm cột `automation_question TEXT` và `automation_answer TEXT` vào bảng `tasks`
  (migration idempotent, theo đúng pattern `themCotAutomationState()` hiện có trong `server/db.ts`).
  Thêm giá trị `needs_input` vào enum trạng thái `automation_status` (chỉ tài liệu hoá — cột là TEXT,
  không cần ALTER thêm).
- **FR-3:** `buildPrecheckPrompt` (`server/lib/automation-prompts.ts`) nhận thêm tham số tuỳ chọn
  `priorQA?: { question: string; answer: string }`. Khi có, prompt phải nêu rõ: "Bạn đã hỏi: `<question>`.
  User trả lời: `<answer>`. Dùng câu trả lời này để tự tra cứu (tool đọc) rồi **BẮT BUỘC** kết luận
  `ready=true` hoặc `ready=false` NGAY LƯỢT NÀY — KHÔNG được đặt `needsInput=true` lần nữa."
- **FR-4:** Route `POST /api/automation/preview` (`server/routes/automation.ts`):
  - Parse thêm `needsInput`/`question` từ kết quả AI.
  - `needsInput=true` VÀ task chưa có `automation_question` lưu sẵn (chưa hỏi lượt nào) → lưu câu hỏi,
    set `automation_status='needs_input'`, trả `{status:'needs_input', question}`.
  - `needsInput=true` NHƯNG task ĐÃ có `automation_question` (tức đây là lượt 2, AI phá luật hỏi tiếp)
    → KHÔNG hỏi thêm, ép thành `blocked` với 1 reason cố định: "AI cố hỏi lần 2 (không được phép) —
    cần Leader can thiệp/sửa aiNote trực tiếp".
  - `needsInput` không có/false → chạy logic `ready`/`preview`/`blocked` như hiện tại, ĐỒNG THỜI xoá
    `automation_question`/`automation_answer` (dọn cho lượt sau).
- **FR-5:** Endpoint mới `POST /api/automation/answer` `{ taskId, answer }`:
  - 400 nếu thiếu `taskId`/`answer`, hoặc `answer` dài hơn 2.000 ký tự (cap an toàn, dùng lại `capText`
    có sẵn ở `automation-prompts.ts` nếu cần cắt hiển thị log, nhưng nội dung gửi AI giữ nguyên trong
    ngưỡng cho phép — không cắt câu trả lời thật của user).
  - 409 nếu `task.automationStatus !== 'needs_input'`.
  - Lưu `answer` vào `automation_answer`, set `automation_status='checking'`.
  - Gọi lại `runClaude` với `buildPrecheckPrompt(task, ..., { priorQA: { question: automation_question,
    answer } })` — dùng CHUNG hàm xử lý kết quả với FR-4 (tách thành 1 hàm nội bộ `runPrecheckAndApply`
    dùng lại ở cả 2 route để không lặp code).
  - Trả kết quả giống `/preview`: `{status:'preview'|'blocked', ...}` (không thể trả `needs_input` nữa
    vì đã dùng hết 1 lượt hỏi — nếu AI cố hỏi tiếp, áp FR-4 nhánh "lượt 2").
- **FR-6:** `decideAutomationAction` (`server/lib/automation-helpers.ts`): **KHÔNG** thêm `needs_input`
  vào danh sách `UNHANDLED` (danh sách trạng thái có thể bị đánh `missed` khi quá giờ 15'). Task ở trạng
  thái `needs_input` không bao giờ tự chuyển `missed` — chỉ đứng yên chờ user trả lời (user có thể tự
  Hủy nếu muốn bỏ qua). `reconfirmNeededOnTimeChange`/`reviveNeededOnTimeChange` coi `needs_input` là
  trạng thái "đã engage" (đổi giờ task → cần hỏi lại như các trạng thái đang xử lý khác).
- **FR-7 (FE — types/state):** `AutomationStatus` thêm `'needs_input'`. `AutomationSessionState` thêm
  `question?: string | null`. `useAutomation.ts`: nhánh xử lý response `r.status === 'needs_input'` trong
  `startAutomationPreview`; thêm hàm `answerAutomationQuestion(answer: string)` gọi endpoint FR-5, cùng
  cơ chế `runId`/`busy` như các hàm khác trong file (chống race khi đóng popup giữa lúc đang chờ).
- **FR-8 (FE — UI):** `PopupAutomationSession` (`src/main.tsx`) thêm nhánh `status === 'needs_input'`:
  hiển thị câu hỏi AI (`session.question`), 1 `<textarea>` cho user nhập câu trả lời (state cục bộ trong
  component cha, reset khi đổi task), nút "Gửi trả lời" gọi `answerAutomationQuestion`, disabled khi rỗng
  hoặc đang `busy`. Trong lúc gửi, hiện trạng thái loading giống nhánh `checking` hiện có.

## 5. Yêu cầu phi chức năng (nếu có)

- Không đổi cơ chế tick 30s / cửa sổ nhắc 5 phút cho các trạng thái khác.
- `answer` là input người dùng tự do — validate độ dài (≤2.000 ký tự) trước khi nhúng vào prompt, tránh
  phình prompt bất thường (nhất quán với cap `aiNote`/`note` đã làm ở CR-20260805-chuan-hoa-prompt-automation).
- Không log `answer` ra ngoài phạm vi cần thiết (không phải secret, nhưng vẫn theo nguyên tắc chung không
  log dư thừa dữ liệu người dùng nhập).

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI (tham chiếu docs/02, docs/06)

```
[Popup automation]
  status=checking  → (AI đang precheck)
  status=needs_input → hiện câu hỏi AI + textarea trả lời + nút "Gửi trả lời"
       → bấm gửi → status=checking (đang tra lại) → status=preview | blocked (như luồng cũ)
  status=preview/blocked → luồng cũ, không đổi
```
Nếu user đóng popup (X) lúc đang `needs_input`: giữ nguyên trạng thái DB (giống cách `checking`/`approved`
đang xử lý — ẩn popup nhưng không mất tiến trình), mở lại task sau vẫn thấy đúng câu hỏi cũ để trả lời.

### 6.2. API & nghiệp vụ (tham chiếu docs/03, docs/07)

- `POST /api/automation/preview` — không đổi request; response thêm nhánh `{status:'needs_input', question}`.
- `POST /api/automation/answer` **(mới)** — request `{taskId: number, answer: string}`; response
  `{status:'preview', preview}` | `{status:'blocked', reasons}` (409 nếu task không ở `needs_input`).
- Factor chung: tách phần "gọi runClaude + parse + set trạng thái" ở `/preview` hiện tại thành hàm
  `runPrecheckAndApply(task, opts?: {priorQA})` dùng lại ở cả 2 route.

### 6.3. Dữ liệu & schema (tham chiếu docs/04, docs/08)

- `tasks.automation_question TEXT` (mới, nullable, default NULL).
- `tasks.automation_answer TEXT` (mới, nullable, default NULL).
- `tasks.automation_status` — thêm giá trị hợp lệ `'needs_input'` (không đổi kiểu cột, chỉ tài liệu hoá
  trong comment `server/db.ts` + `docs/specs/03`).
- Migration idempotent theo đúng pattern `add()` helper hiện có trong `themCotAutomationState()`.

### 6.4. Automation / tích hợp (nếu đụng)

- Prompt vẫn qua **stdin** (không đổi cơ chế truyền prompt của `claude-runner.ts`) — chỉ nội dung prompt
  (`buildPrecheckPrompt`) có thêm đoạn `priorQA` khi gọi lượt 2.
- Vẫn giữ nguyên: pha hỏi/tra cứu là **read-only** (mode `'read'`), không mở thêm quyền ghi nào. Việc AI
  "tự tra cứu" sau khi có câu trả lời chỉ dùng đúng whitelist tool đọc đã cấp cho `actionType` đó — không
  cấp thêm tool nào riêng cho cơ chế hỏi-đáp này.

## 7. Phân tích tác động

- [x] Frontend (`src/useAutomation.ts`, `src/main.tsx`, `src/types.ts`)
- [x] API route (`server/routes/automation.ts` — 1 endpoint mới + sửa `/preview`)
- [x] DB/migration (2 cột mới, idempotent)
- [x] Automation/MCP (đổi nội dung prompt precheck khi có `priorQA`; KHÔNG đổi whitelist tool)
- [ ] i18n (chuỗi mới) — dự án hiện chưa thấy cơ chế i18n đầy đủ cho automation, giữ tiếng Việt như các
  chuỗi khác trong popup automation
- [ ] Đóng gói SEA/MCP
- [x] Bảo mật (chạm vùng nhạy cảm spawn-AI — áp dụng `security-gate`, xem mục Feedback/Infra dưới)
- [ ] Dữ liệu cũ/backward-compat — cột mới nullable, task cũ không có `automation_question` vẫn hoạt
  động bình thường (coi như chưa từng hỏi)
- **Rủi ro & giảm thiểu:**
  - AI phá luật hỏi lượt 2 → BE ép thành `blocked` (FR-4), không loop vô hạn, không tự ý gọi AI lần 3.
  - User bỏ popup `needs_input` không trả lời → task đứng yên KHÔNG bị `missed` (FR-6) — cần đảm bảo có
    cách User tự Hủy (`onCancel` đã có sẵn, dùng lại được) để không kẹt vĩnh viễn nếu user đổi ý.
  - Prompt phình do `answer` dài → cap 2.000 ký tự (mục 5).
- **Ảnh hưởng chức năng đang chạy:** Không đổi hành vi khi AI không hỏi (đường cũ chạy y nguyên) — chỉ
  thêm 1 nhánh mới, không sửa nhánh `ready=true/false` hiện có.

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1/FR-3):** Given prompt precheck có `priorQA`, When AI vẫn trả `needsInput=true` lần 2,
  Then hàm build prompt vẫn tạo được prompt hợp lệ (test ở tầng prompt builder — hành vi CHẶN lượt 2 là
  việc của route, kiểm ở AC-4).
- **AC-2 (FR-2):** Given DB task cũ (trước migration), When chạy migration, Then 2 cột mới tồn tại, giá
  trị NULL, không lỗi, dữ liệu cũ không đổi.
- **AC-3 (FR-4):** Given AI trả `{needsInput:true, question:"..."}` lần đầu (task chưa có
  `automation_question`), When gọi `/api/automation/preview`, Then DB lưu câu hỏi, `automation_status`
  thành `needs_input`, response `{status:'needs_input', question}`.
- **AC-4 (FR-4):** Given task ĐÃ có `automation_question` (đã hỏi 1 lần), When AI lại trả
  `needsInput=true` (phá luật), Then route ép `blocked` với reason cố định, KHÔNG lưu câu hỏi mới, KHÔNG
  gọi AI thêm lần nữa trong request này.
- **AC-5 (FR-5):** Given task ở `needs_input` với câu hỏi đã lưu, When gọi
  `POST /api/automation/answer {taskId, answer}`, Then `automation_answer` được lưu, AI được gọi lại với
  `priorQA`, kết quả cuối là `preview` hoặc `blocked` (không phải `needs_input` nữa).
- **AC-6 (FR-5):** Given task KHÔNG ở trạng thái `needs_input`, When gọi `/api/automation/answer`, Then
  trả 409, không đổi gì trong DB.
- **AC-7 (FR-6):** Given task ở `needs_input` quá 15 phút so với giờ chạy, When tick server quét qua,
  Then task VẪN ở `needs_input` (không tự chuyển `missed`).
- **AC-8 (FR-7/FR-8):** Given popup automation ở trạng thái `needs_input`, When user nhập câu trả lời và
  bấm "Gửi trả lời", Then popup chuyển sang trạng thái loading rồi hiện đúng `preview`/`blocked` theo kết
  quả server trả về.

## 9. Kế hoạch test (tham chiếu standards/qa-standard.md)

- Tầng test dự kiến: ☑ Unit (route logic, prompt builder) ☑ Integration route (`/preview`, `/answer`)
  ☑ Render component (popup `needs_input`)
- Ca test chính + ca lỗi/biên:
  - `runPrecheckAndApply` với `needsInput=true` lần đầu vs lần 2 (đã có `automation_question` sẵn).
  - `/api/automation/answer`: thiếu `answer`, `answer` quá dài, task sai trạng thái (409), task đúng
    trạng thái (200 + gọi lại AI — mock `runClaude`).
  - `decideAutomationAction` với status `needs_input` + quá giờ 15' → phải trả `null` (không phải `missed`).
  - Component popup: render đúng câu hỏi, nút disable khi textarea rỗng, gọi đúng hàm khi submit.

## 10. Kế hoạch triển khai / rollback

- Bước triển khai: DB migration (FR-2) → BE (`automation-prompts.ts` FR-3, `automation.ts` FR-4/FR-5,
  `automation-helpers.ts` FR-6) → FE (`types.ts`, `useAutomation.ts`, `main.tsx` FR-7/FR-8) → test từng
  AC → `npm run check` → tự soi diff → commit.
- Rollback nếu hỏng: revert commit — 2 cột DB mới là additive (không xoá/đổi cột cũ), rollback code không
  cần xử lý dữ liệu (cột thừa vô hại nếu tạm thời còn sau revert).

## 11. Docs cần cập nhật sau khi làm xong

- [x] docs/specs/03-api-business-logic-spec.md §2 — thêm `needs_input`, endpoint `/answer`, máy trạng thái mới
- [ ] docs/01 … [ ] docs/02 … [ ] docs/04 … [ ] docs/05
- [ ] rules 06–09 — không cần rule mới, tuân theo rule sẵn có (validate input, spawn-AI an toàn)

## 12. Duyệt (sign-off)
| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-08-07 | |
| Leader | tuan.vu | 2026-08-07 | ✅ chốt scope qua AskUserQuestion (toàn bộ automation, 1 lượt hỏi, không tính overdue, tái dùng popup) |
| Người triển khai | | | |
| QA nghiệm thu | | | |

## 13. Amendment (2026-08-07, cùng ngày): nâng số lượt hỏi từ 1 lên `MAX_QA_ROUNDS=5`

Leader lo 1 lượt quá ít — giữa đường thiếu thông tin sẽ đứt luôn thành `blocked` (`AI_ASKED_TWICE` cũ).
Đổi sang cho phép AI hỏi **tối đa 5 lượt/lần precheck**, mỗi lượt vẫn đúng 1 câu, đợi trả lời rồi mới
quyết định hỏi tiếp hay kết luận.

- `automation-prompts.ts`: thêm `MAX_QA_ROUNDS = 5`; `buildPrecheckPrompt` nhận `priorQA: PriorQA[]`
  (mảng, thay cho 1 object) — hiển thị TOÀN BỘ lịch sử hỏi-đáp đã xong + số lượt còn lại; chỉ ép
  "không hỏi thêm" khi `priorQA.length >= MAX_QA_ROUNDS`.
- `automation.ts`: cột `automation_answer` (1 giá trị) đổi thành `automation_qa_history` (JSON mảng
  tích luỹ các cặp hỏi-đáp đã xong). `/answer` build `priorQA = [...history, {question, answer}]` rồi
  gọi lại `runPrecheckAndApply`. Vượt `MAX_QA_ROUNDS` mà AI vẫn `needsInput=true` → ép `blocked` với
  reason code `AI_ASKED_TOO_MANY` (đổi tên từ `AI_ASKED_TWICE`).
- `automation-helpers.ts` (UNHANDLED/`needs_input` exemption), FE (`types.ts`, `useAutomation.ts`,
  `components/automation-popup.tsx`): KHÔNG cần đổi — flow đã generic theo `status`, không giả định
  số lượt cố định.
- Test cập nhật: unit `buildPrecheckPrompt` với mảng `priorQA` (1 lượt, đủ 5 lượt); integration lặp
  5 lượt `needs_input` rồi lượt 6 mới `blocked`.
- DB: cột cũ `automation_answer` không bị xoá (ALTER ADD COLUMN không rollback) — vô hại, không còn
  được ghi/đọc.
