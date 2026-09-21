# CR-20260805-chuan-hoa-prompt-automation — Chuẩn hóa & tối ưu prompt automation AI (Dr.JOY post)

| Trường | Giá trị |
|---|---|
| Loại | ☑ Sửa hành vi |
| Mức tác động | ☑ Vừa (đụng automation đang chạy thật, không đổi API/DB) |
| Người đề xuất | Claude (BA), theo yêu cầu tuan.vu |
| Ngày | 2026-08-05 |
| Trạng thái | ☑ Đã nghiệm thu (code/docs/test xong; AC-7 smoke connector thật — Leader chủ động HOÃN, xem ghi chú dưới) |
| Spec liên quan | [docs/specs/03-api-business-logic-spec.md §2](../../specs/03-api-business-logic-spec.md) (Automation AI); [docs/exchanges/2026-08-05.md](../../exchanges/2026-08-05.md) (thảo luận & chốt) |

## 1. Bối cảnh & Vấn đề

Pha automation AI (`server/routes/automation.ts` + `server/lib/claude-runner.ts`) tự ráp dữ liệu (task,
DB bài Dr.JOY đã đăng, quy ước Dr.JOY) thành 1 đoạn prompt dài gửi cho Claude headless qua stdin. Toàn bộ
constants prompt (`CONTRACT_DOC`, `DRJOY_TARGET_RULES`) và hàm build prompt hiện nằm lẫn trong route file,
chưa có unit test riêng, không cap độ dài `note`/`aiNote` (rủi ro phình prompt/tốn token), danh sách
"bài mình đã đăng" (`pastPostsFor`) luôn trả tối đa 20 bài dù đã xác định được bài đích (★) — gây nhiễu lựa
chọn — và quy ước mention (giữ `@...` trong content + set mention hệ thống) chưa được viết thành rule tường
minh trong `DRJOY_TARGET_RULES`, dễ khiến AI tự đoán sai người nhận.

Rà soát và phương án đã bàn với Codex + Leader chốt trong [docs/exchanges/2026-08-05.md](../../exchanges/2026-08-05.md).

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Tách constants + hàm thuần dựng prompt/format context ra `server/lib/automation-prompts.ts`; route
    (`automation.ts`) chỉ còn lấy task, query DB, gọi Claude runner.
  - `note` của task `actionType=post` không bao giờ bị cắt âm thầm: vượt 10.000 ký tự → precheck trả
    `ready=false` (blocked), không tự ý truncate nội dung sẽ đăng.
  - `aiNote` và context phụ (note của task liên quan trong `relatedContext`) được cap mềm ở 2.000 ký tự,
    có đánh dấu rõ trong prompt khi bị rút gọn (không block).
  - `pastPostsFor`/`formatPastPosts`: khi có ít nhất 1 bài ★ (liên kết trực tiếp qua `relatedIds`/`replyToRef`)
    → hiển thị **tất cả** bài ★ + tối đa 5 bài không-★ gần nhất (nhãn "tham khảo gần đây"). Khi không có
    bài ★ nào → giữ nguyên hành vi cũ (tối đa 20 bài).
  - `DRJOY_TARGET_RULES` có thêm rule mention tường minh: không xoá text `@...` khỏi `content`; `mentions`
    là người nhận hệ thống đã map thật (không phải copy chữ trong body); `@Mọi người` → dùng preset toàn
    bộ nếu có, không có preset thì lấy toàn bộ thành viên group qua read tool; không map được → `ready=false`.
    **Không** áp giới hạn số người nhận (đúng theo `docs/playbooks/release-ai-prompts.md` §2 — API
    `to_user_office_user_ids` không giới hạn).
  - Có unit test hành vi cho các hàm build prompt/format (không chỉ snapshot nguyên khối) theo danh sách ở
    mục 9.
- **Ngoài phạm vi (không làm lần này):**
  - KHÔNG đổi whitelist tool (`CLAUDE_READ_TOOLS`/`CLAUDE_WRITE_TOOLS_*`) hay cách phân quyền tool theo
    connector (Drive/Sheets) — việc đó thuộc CR riêng do Codex phụ trách
    (`CR-20260805-whitelist-tool-theo-task-automation`, xem điểm cuối file exchange).
  - KHÔNG đổi API contract (`/api/automation/*`) hay schema DB.
  - KHÔNG đổi hành vi `buildExecutePrompt` ngoài việc chuyển vị trí (vẫn dùng nguyên văn `content` đã duyệt).

## 3. Người dùng & Kịch bản

- Là **operator vận hành automation** (tuan.vu), tôi muốn prompt gửi AI đủ chuẩn (đúng bài đích, đúng
  người nhận, không cắt nội dung cần đăng) để AI không đăng nhầm bài/nhầm group/thiếu người nhận, và tôi
  không phải review thủ công nhiều hơn mức cần thiết.
- Là **Claude headless (automation)**, khi nhận task `actionType=post` có nhiều bài Dr.JOY liên quan cùng
  đợt release, tôi cần thấy rõ bài nào là bài đích (★) mà không bị 19 bài khác gây nhiễu.

## 4. Yêu cầu chức năng

- **FR-1:** Tách `CONTRACT_DOC`, `DRJOY_TARGET_RULES`, `formatLinks`, `formatPastPosts`,
  `buildPrecheckPrompt`, `buildExecutePrompt` sang `server/lib/automation-prompts.ts` (hàm thuần, không
  query DB). `automation.ts` import từ module này; `pastPostsFor`/`relatedContext` (có query DB) giữ ở
  route hoặc tách sang `server/lib/automation-context.ts` nếu giúp test dễ hơn.
- **FR-2:** Thêm cap độ dài cho `aiNote` và từng note trong `relatedContext` — vượt 2.000 ký tự thì cắt
  và chèn dấu hiệu rõ ràng (vd `[...đã rút gọn...]`) ngay trong đoạn text nhúng vào prompt.
- **FR-3:** Với task `actionType=post`, nếu `note` (nội dung đăng nguyên văn) vượt 10.000 ký tự →
  `buildPrecheckPrompt` phải khiến kết quả precheck trả `ready=false` với reason rõ ràng ("note quá dài,
  cần rút gọn/chia bài") — không được để AI nhận bản đã bị cắt rồi vẫn báo `ready=true`.
- **FR-4:** Sửa `formatPastPosts` (hoặc hàm chọn bài hiển thị) theo rule: có ★ → show hết ★ + tối đa 5
  bài không-★ gần nhất (sort theo `postedAt` desc, nhãn "tham khảo gần đây"); không có ★ → giữ nguyên tối
  đa 20 như hiện tại. Không đổi `pastPostsFor` (vẫn LIMIT 20 khi query DB) — việc rút gọn hiển thị làm ở
  tầng format.
- **FR-5:** Bổ sung đoạn rule mention vào `DRJOY_TARGET_RULES` (nội dung nêu ở mục 2), áp dụng cho cả
  `buildPrecheckPrompt` (task `actionType=post`).
- **FR-6:** Thêm unit test (xem mục 9) cho toàn bộ hàm ở FR-1, bao test hành vi FR-2/FR-3/FR-4/FR-5.

## 5. Yêu cầu phi chức năng (nếu có)

- Không tăng thời gian phản hồi đáng kể của pha precheck (thao tác cap/format là xử lý chuỗi thuần,
  không thêm I/O).
- Không đổi cấu trúc `automation_events`/DB — thay đổi chỉ ở tầng dựng prompt.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI (tham chiếu docs/02, docs/06)

Không đổi UI — FE (`weekly`/`project` screens, popup duyệt automation) không thay đổi hành vi hiển thị.
Trường hợp `note` post quá dài, popup preview vẫn hiển thị `reasons` như các trường hợp `blocked` khác đã
có sẵn (không cần UI mới).

### 6.2. API & nghiệp vụ (tham chiếu docs/03, docs/07)

Không đổi request/response của `/api/automation/preview`, `/approve`, `/execute`, `/cancel`. Thay đổi nằm
hoàn toàn trong cách `buildPrecheckPrompt`/`buildExecutePrompt` dựng nội dung `prompt` gửi cho
`runClaude()` — response envelope và cấu trúc `preview`/`reasons` giữ nguyên schema (`CONTRACT_DOC`).

### 6.3. Dữ liệu & schema (tham chiếu docs/04, docs/08)

Không đổi bảng/cột. `pastPostsFor` vẫn query `drjoy_posted_articles` như cũ (LIMIT 20) — chỉ đổi cách
**format** kết quả trả về khi dựng prompt.

### 6.4. Automation / tích hợp (nếu đụng)

- `server/lib/automation-prompts.ts` (mới): export `CONTRACT_DOC`, `DRJOY_TARGET_RULES`, `formatLinks`,
  `formatPastPosts`, `buildPrecheckPrompt`, `buildExecutePrompt`, và helper cap độ dài (vd `capText(text,
  maxLen, marker)`).
- `server/routes/automation.ts`: import từ module trên; `pastPostsFor`/`relatedContext` giữ nguyên vị trí
  (query DB) hoặc chuyển sang `automation-context.ts` nếu cần để test độc lập.
- Không đổi `claude-runner.ts` (whitelist tool, `buildArgs`) — nằm ngoài phạm vi CR này.

## 7. Phân tích tác động

- [x] Frontend (màn/component) — **không đụng**, ghi để xác nhận đã rà soát, không có thay đổi
- [x] API route — đụng nội bộ (`automation.ts`), không đổi contract
- [ ] DB/migration
- [x] Automation/MCP — đụng nội dung prompt gửi Claude headless (không đổi whitelist tool)
- [ ] i18n (chuỗi mới)
- [ ] Đóng gói SEA/MCP
- [ ] Bảo mật
- [ ] Dữ liệu cũ/backward-compat
- **Rủi ro & giảm thiểu:** Sai sót khi tách module có thể làm lệch nội dung prompt (vd quên 1 dòng rule)
  → giảm thiểu bằng test hành vi (mục 9) chạy trước khi ship, và tự soi diff `automation-prompts.ts` vs
  bản gốc trong `automation.ts` trước khi xoá code cũ.
- **Ảnh hưởng chức năng đang chạy:** Task `actionType=post` có note > 10.000 ký tự (nếu có) sẽ chuyển từ
  chạy được (cắt âm thầm — hành vi ẩn hiện nay) sang bị block rõ ràng — cần rà DB thực tế trước khi ship
  để chắc không có task nào đang ở ngưỡng này (đã kiểm tra: bài dài nhất hiện có 607 ký tự, an toàn).

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1):** Given `automation-prompts.ts` tồn tại, When gọi `buildPrecheckPrompt`/`buildExecutePrompt`
  từ `automation.ts`, Then nội dung prompt sinh ra giống hệt bản trước khi tách (trừ các thay đổi có chủ
  đích ở FR-2..FR-5).
- **AC-2 (FR-2):** Given `aiNote` dài 3.000 ký tự, When build precheck prompt, Then đoạn nhúng vào prompt
  bị cắt còn ≤2.000 ký tự kèm dấu hiệu rút gọn.
- **AC-3 (FR-3):** Given task `actionType=post` có `note` dài 12.000 ký tự, When build precheck prompt,
  Then kết quả precheck (giả lập hoặc chỉ thị trong prompt) dẫn tới `ready=false` với reason nêu rõ note
  quá dài — nội dung `note` KHÔNG bị cắt trong bất kỳ đoạn nào của prompt.
- **AC-4 (FR-4):** Given danh sách `pastPosts` có 1 bài ★ và 10 bài không-★, When format, Then output có
  đủ bài ★ + đúng 5 bài không-★ gần nhất, các bài không-★ còn lại không xuất hiện.
- **AC-5 (FR-4):** Given danh sách `pastPosts` có 3 bài ★, When format, Then cả 3 bài ★ đều xuất hiện
  (không bị giới hạn số lượng ★).
- **AC-6 (FR-5):** Given task `actionType=post`, When build precheck prompt, Then prompt chứa rule mention
  (giữ `@...`, set mention hệ thống, xử lý `@Mọi người`, không giới hạn số người) và KHÔNG chứa bất kỳ con
  số giới hạn người nhận nào.
- **AC-7 (security-gate):** Given prompt mới đã qua unit test, When chạy smoke test bằng CLI thật
  (`CLAUDE_BIN`, mode `read`) nhắm **1 task nháp/test** (không phải group Dr.JOY thật đang vận hành), Then
  precheck trả về preview hợp lệ đúng như kỳ vọng trước khi áp dụng prompt mới cho task thật — theo đúng
  yêu cầu "lần chạy thật đầu tiên nhắm đích nháp" của `security-gate`.

## 9. Kế hoạch test (tham chiếu standards/qa-standard.md)

- Tầng test dự kiến: ☑ Unit (node:test, theo `qa-standard.md`)
- Ca test chính + ca lỗi/biên:
  - `formatPastPosts`: không có bài nào; 1 bài ★ (theo `relatedIds`); 1 bài ★ (theo `replyToRef`); nhiều
    bài ★; nhiều bài không-★ (đúng giới hạn 5); URL có/không `commentId` không làm sai `articleId`.
  - `buildPrecheckPrompt`: có đoạn cảnh báo read-only; có `CONTRACT_DOC` (schema JSON); có
    `DRJOY_TARGET_RULES` (bao gồm rule mention) khi `actionType=post`; KHÔNG có `DRJOY_TARGET_RULES` khi
    `actionType=other`.
  - Cap/block: `aiNote` > 2.000 ký tự bị đánh dấu rút gọn; `note` post > 10.000 ký tự khiến prompt chỉ thị
    `ready=false` (không xuất hiện bản đầy đủ lẫn bản bị cắt của `note` trong prompt).
  - `buildExecutePrompt`: giữ nguyên hành vi cũ (không có test case mới ngoài regression sau khi tách file).
- Smoke test (security-gate, AC-7): sau khi unit test xanh, chạy 1 lần `POST /api/automation/preview` bằng
  CLI thật (mode `read`, có `CLAUDE_BIN`) nhắm **task nháp/test** (KHÔNG phải group Dr.JOY thật đang vận
  hành) để xác nhận prompt mới không làm precheck gãy/hiểu sai trước khi để chạy trên task thật.

## 10. Kế hoạch triển khai / rollback

- Bước triển khai: tách file → thêm helper cap → sửa `formatPastPosts` → thêm rule mention → viết test →
  `npm run check` xanh → smoke test CLI thật trên task nháp (AC-7) → tự soi `git diff --staged` → commit
  `Ref: CR-20260805-chuan-hoa-prompt-automation (FR-1..FR-6)`.
- Rollback nếu hỏng: revert commit (thay đổi không đụng DB/API contract nên rollback an toàn, không cần
  xử lý dữ liệu).

## 11. Docs cần cập nhật sau khi làm xong

- [ ] docs/specs/03 — cập nhật mô tả ngắn ở §2 (Automation AI) nếu hành vi block/cap được nhắc tới ở đó
- [ ] docs/01 … [ ] docs/02 … [ ] docs/04 … [ ] docs/05
- [ ] rules 06–09 — không cần, không đổi rule kiến trúc chung

## Kết quả triển khai — 2026-08-05 (Claude)

| Mục | Kết quả |
|---|---|
| Code | Tạo `server/lib/automation-prompts.ts` (FR-1..FR-5); sửa `server/routes/automation.ts` (block note quá dài trước khi gọi Claude, cap `aiNote`/`relatedContext`, dùng module mới). |
| Test | Thêm `test/unit/automation-prompts.test.ts` — 17 test (capText, isPostNoteTooLong, formatPastPosts, buildPrecheckPrompt), tất cả xanh. |
| `npm run check` | Xanh toàn bộ: backend 169 test, frontend 49 test, build, bundle, link, docs, tz gate. |
| AC-7 (smoke connector thật) | **Deferred theo quyết định Leader** — Leader sẽ tự chạy sau trên task nháp/test có connector thật. Không còn là blocker sign-off code của CR này. |

### Còn lại sau CR

1. Leader tự chạy smoke `preview` trên task nháp/test khi sẵn sàng.
2. Nếu smoke thật phát hiện connector/env/prompt lệch kỳ vọng, mở bug/CR riêng theo kết quả test vận hành.

## 12. Duyệt (sign-off)
| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-08-05 | OK |
| Người triển khai | Claude | 2026-08-05 | OK |
| Code review | Codex | 2026-08-05 | OK — không còn blocker code |
| QA nghiệm thu | tuan.vu | 2026-08-05 | OK phần code/docs/test; smoke thật test sau |
