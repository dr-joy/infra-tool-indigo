# CR-20260814-cau-hinh-claude-bin-khong-phu-thuoc-env — Cấu hình automation AI không phụ thuộc env lúc launch

| Trường | Giá trị |
|---|---|
| Loại | ⬜ Thêm mới ✅ Sửa hành vi ⬜ Xóa/Deprecate |
| Mức tác động | ⬜ Nhỏ ⬜ Vừa ✅ Lớn (automation + vùng nhạy cảm spawn + endpoint mới) |
| Người đề xuất | Leader |
| Ngày | 2026-08-14 |
| Backlog item | `BL-20260814-013` (`Picked`) |
| Trạng thái | ⬜ Draft ⬜ Đã review ⬜ Đã duyệt ✅ Đã triển khai (lát 1) ✅ **Đã nghiệm thu (chấp nhận rủi ro, không có smoke máy thật — Leader quyết định 2026-08-21, xem `exchanges/2026-08-21.md`)** |
| Spec liên quan | [03 API](../../specs/03-api-business-logic-spec.md) · [04 DB](../../specs/04-database-design.md) · [07 BE](../../rules/07-rules-backend.md) · [security-standard §9](../../standards/security-standard.md) · [operations go-live](../../operations/automation-ai-go-live-guide.md) |

Quyết định nền: [exchange 2026-08-14 §4.3](../../exchanges/2026-08-14.md) — Claude ⇄ Codex chốt C1–C10,
Leader approve C1–C10 + `?8` + `?9` (2026-08-14).

## 1. Bối cảnh & Vấn đề

`claudeConfigured()` = `Boolean(process.env.CLAUDE_BIN)` ([claude-runner.ts:72](../../../server/lib/claude-runner.ts#L72))
và `runClaude()` đọc `process.env.CLAUDE_BIN` lần nữa ở chỗ khác ([:182](../../../server/lib/claude-runner.ts#L182)).
`process.env` trên Windows là **bản chụp lúc spawn tiến trình**: biến đặt ở cấp User **sau** khi app đã mở
không lan vào tiến trình đang chạy, và `explorer.exe` còn cache khối env của chính nó nên shortcut trên
taskbar tiếp tục đẻ tiến trình mang env cũ.

Sự cố 2026-08-14: env cấp User có `C:\Users\<user>\AppData\Roaming\npm\claude.cmd` (file tồn tại), nhưng
`GET /api/automation/config` trả `{"configured":false}` vì `TaskManager.exe` (PID 5264) khởi động 09:32 trước
đó. Người dùng bấm "Thử lại" trong popup nhiều lần đều thất bại — **không có cách nào biết vì sao**, vì lỗi
chỉ nói "chưa cấu hình CLAUDE_BIN ở phía server". Phải kill tiến trình và mở lại exe mới chạy được.

Đây không phải lỗi một dòng `if` mà là **cấu hình vận hành đặt sai tầng**: một app desktop không nên phụ
thuộc env của tiến trình cha để quyết định có được chạy automation hay không. Cùng lớp lỗi với
[BUG-20260808](../bugs/BUG-20260808-banner-mcp-bao-dong-gia.md) (`CLAUDE_BIN` chưa từng được lưu bền ⇒ AI tắt
mỗi lần bật app) — lần đó vá bằng cách dạy người dùng đặt env cấp User, tức vá triệu chứng.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Đổi cấu hình automation **không cần khởi động lại app**: lưu xong, request kế tiếp đã dùng giá trị mới.
  - `process.env.CLAUDE_*` chỉ còn được đọc ở **đúng một file** (`server/lib/automation-config.ts`), có cổng
    máy trong `npm run check` thi hành.
  - `GET /api/automation/config` trả đủ dữ kiện để tự chẩn đoán: `enabled`, `configured`, `source`, path đang
    dùng, danh sách candidate dò được, những cấu hình còn thiếu.
  - Không có đường nào cho phép đặt path spawn **tự do** qua HTTP: chỉ nhận candidate do **server tự dò lại
    tại thời điểm ghi**.
  - Máy đang chạy được hôm nay, sau khi cập nhật exe **vẫn chạy** (không bị cờ mới tắt ngầm).
- **Ngoài phạm vi (lát 2, không làm lần này — `?9`):**
  - Route **ghi** cho `CLAUDE_READ_TOOLS*` / `CLAUDE_WRITE_TOOLS*` / `CLAUDE_MODEL` / `CLAUDE_MCP_CONFIG`. Lần
    này chúng **đọc qua resolver** và hiển thị read-only; sửa vẫn bằng env. Lý do: whitelist tool ghi là
    **quyền AI được ghi ra Dr.JOY**, mà tên tool không có "danh sách tự dò" nào để khoá như path — cần chốt
    cách khoá riêng trước khi mở route ghi.
  - Sửa file `.env` cạnh exe (phương án C đã bị loại).
  - Đăng nhập/phân quyền cho API local (vấn đề rộng hơn CR này; chính vì chưa có nên FR-4 phải khoá bằng
    candidate).

## 3. Người dùng & Kịch bản

- Là **người dùng app trên máy mới**, tôi muốn app tự tìm ra `claude` và chỉ cần bấm xác nhận một lần, để bật
  automation mà không phải học cách đặt biến môi trường Windows.
- Là **người dùng đang gặp lỗi "automation chưa bật"**, tôi muốn thấy ngay app đang dùng path nào, lấy từ đâu,
  thiếu gì — thay vì một câu báo lỗi chung chung.
- Là **người vừa sửa cấu hình**, tôi muốn bấm "Thử lại" là chạy, không phải tắt/bật lại app.
- Là **người viết test**, tôi muốn vẫn trỏ `CLAUDE_BIN` sang `scripts/mock-claude.cmd` như hiện nay
  ([qa-standard](../../standards/qa-standard.md)).
- Là **chủ máy**, tôi không muốn một request tới cổng local (không auth) chỉ định được chương trình mà app sẽ
  chạy.

## 4. Yêu cầu chức năng

- **FR-1 — Một cửa đọc cấu hình (C1).** Thêm `server/lib/automation-config.ts` với
  `resolveClaudeBin(): { path: string | null; source: ClaudeBinSource; enabled: boolean }`
  (`ClaudeBinSource = 'config' | 'env' | 'disabled' | 'none'`), `detectClaudeCandidates()`,
  `readAutomationSettings()`, `saveClaudeBinCandidate()`. `claudeConfigured()` và `runClaude()` chỉ được đi qua
  hàm này; **không** đọc `process.env.CLAUDE_BIN` trực tiếp nữa.
- **FR-2 — Nguồn cấu hình trên máy, đọc mỗi lần dùng (C2, C3).** Lưu trong bảng key-value `app_settings` đã có
  (tiền lệ Redmine): `automation_claude_bin` (path), `automation_ai_enabled` (`'1'`/`'0'`). Không cache theo
  tiến trình. Thứ tự quyết định:

  | Trạng thái | Kết quả |
  |---|---|
  | `automation_ai_enabled = '0'` | `source='disabled'`, `path=null` — automation tắt, kể cả khi env có |
  | có `automation_claude_bin` và file tồn tại | `source='config'` |
  | không có config, `process.env.CLAUDE_BIN` có | `source='env'` (đường dành cho test/CI và máy chưa nhận nuôi) |
  | không có gì | `source='none'`, `path=null` |

  `automation_ai_enabled` **vắng mặt** = "chưa quyết", **không** đồng nghĩa tắt — đây là điều kiện để bản mới
  không tự tắt automation trên máy đang chạy (`?8`).
- **FR-3 — Tự dò candidate, không spawn (C4).** `detectClaudeCandidates()` trả danh sách `{ id, path }` từ:
  `%APPDATA%\npm\claude.cmd|.exe`, `%LOCALAPPDATA%\Programs\claude\claude.exe`, và từng thư mục trong `PATH`
  ghép với tên `claude` + đuôi `.cmd/.exe/.bat`. Chỉ kiểm tra tồn tại bằng `fs`, **không** chạy tiến trình nào.
  `id` là hash ổn định của path đã chuẩn hoá (không phải chỉ số mảng — chỉ số đổi theo lần dò).
- **FR-4 — Route lưu chỉ nhận candidate, dò lại lúc ghi (C5, S1).** `PUT /api/automation/config` nhận
  `{ candidateId?: string; enabled?: boolean }`. Server **dò lại ngay tại thời điểm ghi** rồi mới đối chiếu
  `candidateId`; không khớp ⇒ `400`. **Không** nhận path dạng chuỗi tự do dưới bất kỳ tên field nào. Trả về
  đúng payload của FR-5 sau khi lưu.
- **FR-5 — Diagnostic thật (C6).** `GET /api/automation/config` trả
  `{ configured, enabled, source, path, candidates: [{id, path}], missing: string[] }`. Giữ nguyên field
  `configured` (FE và 2 test đang dùng). `missing` liệt kê cấu hình automation còn thiếu (vd
  `CLAUDE_READ_TOOLS_POST`, `CLAUDE_WRITE_TOOLS_POST`) để người dùng biết vì sao preview rơi về `plan`.
- **FR-6 — Nút "Kiểm tra" (C7, S3).** `POST /api/automation/config/test` chạy `claude --version` **chỉ khi
  người dùng bấm**, đi qua đúng đường validate + `windowsHide` + timeout của runner (không viết `spawn` thứ
  hai). Trả `{ ok, version?, message? }`. Chưa cấu hình ⇒ `503` với code `CLAUDE_NOT_CONFIGURED`.
- **FR-7 — Nhận nuôi cấu hình cũ, một lần (`?8`).** Khi `automation_claude_bin` chưa có và
  `process.env.CLAUDE_BIN` trỏ tới một file **khớp đúng một candidate** vừa dò được ⇒ ghi
  `automation_claude_bin` + `automation_ai_enabled='1'` và log rõ "đã nhận cấu hình từ biến môi trường".
  Idempotent: chỉ chạy khi key còn trống. Env trỏ file không khớp candidate (vd `mock-claude.cmd` trong test)
  ⇒ **không** ghi gì, vẫn dùng đường `source='env'` của FR-2.
- **FR-8 — Khối Cài đặt automation AI (C6).** Thêm tab **AI** trong màn Cài đặt (cạnh PIC / Chứng chỉ /
  Redmine / Phím tắt): hiện trạng thái bật/tắt, `source` bằng lời (đang dùng cấu hình đã lưu / biến môi trường
  / chưa cấu hình), path đang dùng, danh sách candidate để chọn, cấu hình còn thiếu; nút **Lưu & bật**, **Tắt**,
  **Dò lại**, **Kiểm tra**. Popup automation khi lỗi `CLAUDE_NOT_CONFIGURED` phải chỉ tới đây thay vì nhắc tên
  biến môi trường.
- **FR-9 — Cổng máy (C8).** `scripts/check-claude-env.mjs` chạy trong `npm run check`: đỏ nếu `process.env.CLAUDE_`
  xuất hiện ngoài `server/lib/automation-config.ts` (miễn trừ: `test/`, `scripts/`, và marker
  `// claude-env-ok: <lý do>` theo cùng quy ước `check-tz.mjs`).
- **FR-10 — Docs (C9).** [go-live guide](../../operations/automation-ai-go-live-guide.md) đổi env thành đường
  fallback cho test/CI, đường chính là khối Cài đặt AI; [spec 03](../../specs/03-api-business-logic-spec.md)
  cập nhật 3 endpoint; [spec 04](../../specs/04-database-design.md) ghi 2 key mới của `app_settings`.

## 5. Yêu cầu phi chức năng

- **Bảo mật (security-standard §9):** không có đường nào nhận path spawn từ HTTP; candidate được server dò lại
  mỗi lần ghi; `runClaude` vẫn `shell:true` trên win32 nên path **phải** thuộc tập server tự sinh — đây là lý do
  bác bỏ phương án "validate tên file + ký tự".
- **Tương thích ngược:** máy đang chạy bằng env vẫn chạy sau cập nhật (FR-2 tri-state + FR-7). Test hiện tại
  trỏ `CLAUDE_BIN` sang mock **không phải sửa**.
- Đọc cấu hình là 1 query `app_settings` — rẻ; `resolveClaudeBin()` được gọi trong scheduler tick nên **không**
  được spawn hay quét PATH ở đường nóng (chỉ quét khi cần candidate: `GET`/`PUT`/FR-7).
- Không migration phá dữ liệu: chỉ thêm 2 key vào bảng key-value đã có.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI (docs/02, docs/06)
Cài đặt → tab **AI**: dải trạng thái (Đang bật / Đang tắt / Chưa cấu hình) + dòng "Đang dùng: `<path>` (từ
cấu hình đã lưu | từ biến môi trường)". Nếu chưa cấu hình: danh sách candidate + nút **Lưu & bật**. Nếu đã cấu
hình: nút **Kiểm tra** (hiện version thật), **Tắt**, **Dò lại**. Danh sách "cấu hình còn thiếu" hiện read-only
kèm ghi chú "sửa bằng biến môi trường ở bản này" (lát 2 sẽ cho sửa trong app).

### 6.2. API & nghiệp vụ (docs/03, docs/07)
| Endpoint | Vào | Ra |
|---|---|---|
| `GET /api/automation/config` | — | `{ configured, enabled, source, path, candidates, missing }` |
| `PUT /api/automation/config` | `{ candidateId?, enabled? }` | như trên; `400` nếu `candidateId` không khớp lần dò tại chỗ |
| `POST /api/automation/config/test` | — | `{ ok, version?, message? }`; `503 CLAUDE_NOT_CONFIGURED` |

### 6.3. Dữ liệu & schema (docs/04, docs/08)
`app_settings` (đã có): thêm 2 key `automation_claude_bin`, `automation_ai_enabled`. Không thêm bảng, không
ALTER — nên không cần migration schema; FR-7 là seeding dữ liệu, idempotent.

### 6.4. Automation / tích hợp
`runClaude` lấy bin qua resolver; thông điệp `ClaudeNotConfiguredError` đổi sang hướng người dùng vào Cài đặt →
AI. `automation_ai_enabled='0'` trở thành **công tắc tắt tường minh** thay cho "không set env".

## 7. Phân tích tác động

- [x] Frontend (màn Cài đặt, popup automation) · [x] API route (1 đổi, 2 mới) · [x] DB (2 key trong bảng có sẵn)
  · [x] Automation/MCP · [x] Bảo mật (vùng spawn) · [x] Dữ liệu cũ/backward-compat · [ ] Đóng gói SEA
- **Rủi ro & giảm thiểu:**
  - *Nới quyền spawn* → chỉ nhận candidate, dò lại lúc ghi, test ca "path tự do bị từ chối".
  - *Bản mới tự tắt automation* → tri-state `enabled` + FR-7 + test ca "env cũ vẫn chạy khi chưa có config".
  - *Cổng máy FR-9 gây tiếng ồn* → miễn trừ `test/`, `scripts/` + marker có lý do.
- **Ảnh hưởng chức năng đang chạy:** cách bật automation đổi (env → Cài đặt). Máy hiện tại không phải làm gì.

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1, FR-9):** Given repo sau thay đổi, When chạy `npm run check`, Then cổng `check-claude-env` xanh và
  chỉ `server/lib/automation-config.ts` (+ `test/`, `scripts/`) còn đọc env automation. **Phạm vi cổng nói cho
  đúng:** nó là cổng **theo mẫu văn bản**, bắt 4 dạng đọc thường gặp (truy cập thẳng, `['CLAUDE_…']`,
  destructuring, alias cả khối `process.env`) sau khi đã bỏ comment/string; **không** bắt tên biến ghép động
  (`process.env['CLAUDE_'+'BIN']`). Giới hạn này được khoá bằng test riêng
  ([`test/unit/check-claude-env-gate.test.ts`](../../../test/unit/check-claude-env-gate.test.ts)) để không ai
  đọc AC-1 thành "chứng minh tuyệt đối" (Codex review lát 1, P2).
- **AC-2 (FR-2):** Given DB có `automation_claude_bin` trỏ file tồn tại và env `CLAUDE_BIN` trỏ file **khác**,
  When `resolveClaudeBin()`, Then trả path của **DB** với `source='config'`.
- **AC-3 (FR-2, back-compat):** Given DB chưa có key nào và env `CLAUDE_BIN` trỏ mock, When gọi
  `GET /api/automation/config`, Then `configured=true`, `source='env'` — automation vẫn chạy được.
- **AC-4 (FR-2):** Given `automation_ai_enabled='0'` và env `CLAUDE_BIN` hợp lệ, When `/automation/execute`,
  Then `503 CLAUDE_NOT_CONFIGURED`, `source='disabled'`, và **không** có tiến trình nào được spawn.
- **AC-5 (FR-2, mục tiêu chính):** Given app đang chạy và `configured=false`, When `PUT /api/automation/config`
  lưu một candidate hợp lệ, Then `GET` ngay sau đó trả `configured=true` — **không khởi động lại tiến trình**.
- **AC-6 (FR-4, bảo mật):** Given kẻ gọi thử `PUT /api/automation/config` với `{ claudeBin: 'C:\\evil.cmd' }`
  hoặc `{ candidateId: '<không tồn tại>' }`, Then `400`, DB **không** đổi, và không có spawn nào.
- **AC-7 (FR-4, S1):** Given `candidateId` lấy từ một lần `GET` trước, nhưng file đó **đã bị xoá** khi `PUT`,
  Then `400` (vì server dò lại tại thời điểm ghi), không lưu path không còn tồn tại.
- **AC-8 (FR-3):** Given `%APPDATA%\npm\claude.cmd` tồn tại, When `detectClaudeCandidates()`, Then path đó có
  trong danh sách, `id` giống nhau qua 2 lần dò, và **không** tiến trình con nào được tạo.
- **AC-9 (FR-6):** Given cấu hình trỏ `scripts/mock-claude.cmd`, When `POST /api/automation/config/test`, Then
  `{ ok: true }` kèm chuỗi version từ tiến trình thật; Given chưa cấu hình, Then `503 CLAUDE_NOT_CONFIGURED`.
- **AC-10 (FR-7):** Given DB trống và env `CLAUDE_BIN` trỏ **đúng một candidate** dò được, When app khởi động,
  Then `automation_claude_bin` + `automation_ai_enabled='1'` được ghi và log nêu rõ nguồn; When khởi động lần
  hai, Then **không** ghi lại (idempotent).
- **AC-11 (FR-7):** Given env `CLAUDE_BIN` trỏ file **không** thuộc candidate (mock trong repo), When khởi động,
  Then DB vẫn trống và `source='env'` — automation của test không bị đụng.
- **AC-12 (FR-5):** Given thiếu `CLAUDE_WRITE_TOOLS_POST`, When `GET /api/automation/config`, Then key đó có
  trong `missing`.
- **AC-13 (FR-8):** Given tab Cài đặt → AI, When chưa cấu hình, Then thấy danh sách candidate + nút "Lưu & bật";
  When đã cấu hình, Then thấy path + `source` bằng lời + nút Kiểm tra/Tắt/Dò lại. Popup automation lỗi
  `CLAUDE_NOT_CONFIGURED` chỉ tới tab này, không nhắc tên biến môi trường.
- **AC-14 (FR-2, Codex P1):** Given `automation_claude_bin` đã lưu nhưng **file bị xoá**, và env `CLAUDE_BIN`
  đang trỏ một file chạy được, When `resolveClaudeBin()` / `GET /config` / `POST /config/test`, Then
  `source='config_missing'`, `configured=false`, `path=null`, `503` khi Kiểm tra — **không** lần nào chạy bằng
  path của env; UI hiện cảnh báo đỏ "file đã chọn không còn trên máy".
- **AC-15 (FR-4, Codex P2):** Given chưa có config dùng được (đang chạy bằng env), When `PUT` với
  `{enabled:true}` mà không kèm `candidateId`, Then **400**; When `{enabled:false}`, Then 200. Given đã lưu
  config, Then tắt rồi bật lại bằng `enabled`-only chạy được. UI: chưa lưu file thì **không có** nút "Bật lại".

## 9. Kế hoạch test (qa-standard)

- Tầng: ✅ Unit (`automation-config`: thứ tự ưu tiên, candidate id ổn định, adoption idempotent) ·
  ✅ Integration route (3 endpoint + ca 400/503 + AC-5 không cần restart) · ✅ Render component (tab AI) ·
  ✅ Smoke thủ công (máy thật: tắt env đi, bật bằng UI, chạy 1 task AI mode read).
- Ca lỗi/biên: path tự do bị từ chối; candidateId lạ; file candidate bị xoá giữa GET và PUT; `enabled='0'` chặn
  execute; DB trống + env mock (back-compat); PATH có thư mục không tồn tại; `%APPDATA%` không có `npm`.
- Test **không** được gọi CLI thật ngoài `scripts/mock-claude.cmd` (qa-standard §mock Claude).

## 10. Kế hoạch triển khai / rollback

- Thứ tự: (1) `automation-config.ts` + unit test; (2) đổi `claude-runner` sang resolver; (3) 3 route +
  integration test; (4) FR-7 adoption + test; (5) FR-9 cổng máy; (6) FR-8 UI + test render; (7) `npm run check`;
  (8) smoke máy thật; (9) `docs-sync` FR-10.
- `npm run backup-db` trước bước (4) vì đó là bước đầu tiên ghi vào DB người dùng.
- Rollback: revert commit. Dữ liệu để lại chỉ là 2 key trong `app_settings`; bản cũ bỏ qua chúng và quay về đọc
  env như trước — không cần dọn.

## 11. Docs cần cập nhật sau khi làm xong

- [x] [docs/03 API](../../specs/03-api-business-logic-spec.md) — 3 endpoint + **§2.1 mới** (luật resolver) thay mô tả "configured = Boolean(CLAUDE_BIN)"
- [x] [docs/04 DB](../../specs/04-database-design.md) — 2 key `app_settings` + ghi rõ "vắng mặt ≠ tắt"
- [x] [rules/07](../../rules/07-rules-backend.md) — §6 luật path spawn không nhận từ HTTP; **§6.1 mới** cấu hình một cửa
- [x] [operations/automation-ai-go-live-guide](../../operations/automation-ai-go-live-guide.md) — env thành fallback test/CI
- [x] [standards/qa-standard](../../standards/qa-standard.md) — mock vẫn qua env, vì sao adoption không đụng
- [x] [CLAUDE.md](../../../CLAUDE.md) (kiến trúc) + [README.md](../../../README.md) (cách bật)

## 14. Kết quả triển khai lát 1 (2026-08-14)

Code:

| File | Việc |
|---|---|
| [`server/lib/automation-config.ts`](../../../server/lib/automation-config.ts) **(mới)** | resolver một cửa, dò candidate, lưu theo candidateId, nhận nuôi env |
| [`server/lib/claude-runner.ts`](../../../server/lib/claude-runner.ts) | `claudeConfigured`/`runClaude` đi qua resolver; tách `spawnClaude()` dùng chung; thêm `runClaudeVersion()`; `ClaudeNotConfiguredError` đổi thông điệp theo `disabled`/`none` |
| [`server/routes/automation.ts`](../../../server/routes/automation.ts) | `GET` trả diagnostic; `PUT` + `POST /config/test` mới; whitelist tool đọc qua `automationEnv()` |
| [`server/app.ts`](../../../server/app.ts) | gọi `adoptEnvClaudeBinOnce()` lúc dựng app |
| [`src/components/automation-config-settings.tsx`](../../../src/components/automation-config-settings.tsx) **(mới)** + [`src/main.tsx`](../../../src/main.tsx) | tab Cài đặt → AI |
| [`src/useAutomation.ts`](../../../src/useAutomation.ts) | thông điệp lỗi dùng message của server (không nhắc tên biến env) |
| [`scripts/check-claude-env.mjs`](../../../scripts/check-claude-env.mjs) **(mới)** + [`scripts/check.mjs`](../../../scripts/check.mjs) | cổng máy một-cửa |

Test: **28 ca mới** — 16 unit ([`test/unit/automation-config.test.ts`](../../../test/unit/automation-config.test.ts)),
7 integration ([`test/integration/automation-config-cr20260814.test.ts`](../../../test/integration/automation-config-cr20260814.test.ts)),
5 render ([`test/client/automation-config-settings.test.tsx`](../../../test/client/automation-config-settings.test.tsx)).
`npm run check` xanh toàn bộ (285→301 backend + 208→213 frontend; bundle 497.4/500 kB).

AC-1…AC-15 đều có test tự động phủ, **trừ AC-13 phần "popup chỉ tới tab AI"** (đã đổi code + có test render tab
AI, nhưng câu chữ trong popup thật cần smoke tay) và **smoke máy thật** (§9) — hai việc này còn nợ, xem §12.

> Dòng trên là **báo cáo của người triển khai**: `npm run check` do Claude chạy tại máy này, reviewer chưa chạy
> lại (Codex review §15 nhận xét phụ). Kết quả sau vòng sửa review: xem §16.

Giới hạn đã biết của lát 1:

- Whitelist tool/model/MCP vẫn chỉ đặt được bằng env (đúng phạm vi đã chốt, `?9`) — màn AI hiển thị phần thiếu
  nhưng không sửa được.
- `spawn(..., shell:true)` trên win32 vẫn phát cảnh báo `DEP0190` của Node. Không nới rủi ro so với trước (path
  giờ *hẹp hơn*: chỉ candidate server dò), nhưng nếu muốn bỏ hẳn `shell:true` thì phải chạy `.cmd` qua
  `cmd.exe /c` tường minh — việc riêng, không thuộc CR này.
- Ngân sách bundle còn **2.6 kB**; lát 2 thêm UI nữa thì phải `React.lazy` tab Cài đặt.

## 15. Codex review lát 1 (2026-08-14)

Trạng thái review: **chưa nên nghiệm thu ngay**. Hướng triển khai đúng và test phủ tốt, nhưng còn 3 điểm nên xử
lý/ghi quyết định trước khi sign-off QA.

### Findings

| Mức | Vị trí | Nhận xét | Đề xuất |
|---|---|---|---|
| P1 | [`server/lib/automation-config.ts:169`](../../../server/lib/automation-config.ts#L169) → [`:173`](../../../server/lib/automation-config.ts#L173) | Nếu `automation_claude_bin` đã lưu nhưng file bị xoá/mất ổ mạng, resolver im lặng rơi xuống `source='env'`. Đây có thể chạy một Claude khác với cấu hình user vừa chọn, nhất là đúng lớp lỗi "env cũ/stale đè cấu hình mới" CR đang sửa. | Khi key config **có tồn tại nhưng path chết**, trả `source='config_missing'` hoặc `none` + `configured=false`, không fallback env. Chỉ fallback env khi **chưa từng có config**. Nếu muốn giữ fallback thì phải hiện cảnh báo đỏ và test AC riêng. |
| P2 | [`src/components/automation-config-settings.tsx:190`](../../../src/components/automation-config-settings.tsx#L190) + [`server/routes/automation.ts:376`](../../../server/routes/automation.ts#L376) | Nút **Bật lại** gửi `{ enabled: true }` không kèm `candidateId`. Backend chấp nhận enabled-only, nên trong trạng thái chưa có config nhưng còn env, user có thể "bật lại" bằng env thay vì nhận nuôi path vào app. Điều này làm UI có hai đường bật khác nghĩa nhau: "Lưu & bật" và "Bật lại". | Chỉ cho enabled-only khi đã có `automation_claude_bin` hợp lệ. Nếu chưa có config, nút chính phải là **Lưu & bật** với candidate. Backend nên reject `{ enabled:true }` khi không có config và không có candidateId. |
| P2 | [`scripts/check-claude-env.mjs:29`](../../../scripts/check-claude-env.mjs#L29) | Cổng máy chỉ bắt literal `process.env.CLAUDE_`. Nó không bắt các kiểu đọc tương đương như `process.env['CLAUDE_BIN']`, destructuring `const { CLAUDE_BIN } = process.env`, hoặc alias `const env = process.env; env.CLAUDE_BIN`. Cổng này vẫn có giá trị, nhưng chưa đủ mạnh để khẳng định "chỉ còn một file đọc env" theo AC-1. | Mở rộng regex/AST nhẹ để bắt bracket + destructuring cơ bản, hoặc đổi wording AC-1 thành "cổng text-pattern chống lỗi thường gặp" và thêm `rg` phụ trong check. |

### Nhận xét phụ

- `PUT /api/automation/config` đang nói trong comment "path + cờ bật là MỘT đơn vị", nhưng code vẫn cho ghi từng nửa (`candidateId`-only hoặc `enabled`-only). Tắt automation cần enabled-only, nhưng bật thì nên nghiêm hơn để tránh trạng thái mơ hồ.
- CR ghi `AC-1…AC-13 đều có test tự động phủ`, nhưng review chưa chạy lại `npm run check`; dòng này nên hiểu là báo cáo từ người triển khai, chưa phải xác nhận của reviewer.
- Chưa review sâu phần smoke UI popup `CLAUDE_NOT_CONFIGURED` vì CR cũng đã ghi còn nợ smoke tay.

## 16. Claude xử lý review (2026-08-14) — nhận cả 3, đã sửa + test

| Finding | Xử lý | Sửa ở đâu |
|---|---|---|
| **P1** — config path chết thì im lặng rơi về env | **Nhận.** Thêm `source='config_missing'`: đã lưu path mà file không còn ⇒ `configured=false`, `path=null`, **không** fallback env; UI hiện cảnh báo đỏ và nút Kiểm tra bị chặn. Fallback env chỉ còn khi **chưa từng** lưu config | [`automation-config.ts`](../../../server/lib/automation-config.ts) `resolveClaudeBin()` · [`automation-config-settings.tsx`](../../../src/components/automation-config-settings.tsx) · **AC-14** mới · 3 test (unit `P1:` ×2, integration `P1:`, render `P1:`) |
| **P2 (nút Bật lại)** — bật enabled-only bằng env | **Nhận.** Backend: `enabled:true` mà không kèm `candidateId` và chưa có config dùng được ⇒ **400** (`enabled:false` vẫn luôn được phép). Payload thêm `hasSavedConfig` để FE **ẩn** nút "Bật lại" khi chưa lưu file — đường bật duy nhất lúc đó là "Lưu & bật" | [`automation.ts`](../../../server/routes/automation.ts) `PUT /automation/config` · `coCauHinhDungDuoc()` · **AC-15** mới · 3 test (unit `P2:`, integration `P2:` ×2, render `P2:`) |
| **P2 (cổng máy yếu)** — chỉ bắt literal | **Nhận, làm cả hai việc reviewer đề xuất.** Cổng nay bắt 4 dạng: truy cập thẳng, `process.env['CLAUDE_…']`, destructuring, alias cả khối `process.env`. **Và** sửa lời AC-1 thành "cổng theo mẫu văn bản chống lỗi thường gặp", kèm test khoá **giới hạn đã biết** (tên biến ghép động thì không bắt) để không ai đọc AC-1 quá lời | [`check-claude-env.mjs`](../../../scripts/check-claude-env.mjs) (`CAM_PATTERNS`, `viPhamCua`, `quet` — tách hàm để test được) · [`test/unit/check-claude-env-gate.test.ts`](../../../test/unit/check-claude-env-gate.test.ts) 12 ca · **AC-1** viết lại |

Nhận xét phụ:

- "PUT ghi từng nửa" — đã siết đúng như đề xuất: **bật** nghiêm (phải có path trong app), **tắt** vẫn dễ. Hai
  lần ghi settings đã nằm trong một `withTransaction` từ lần soi diff trước.
- "AC-1…AC-13 có test phủ" — công nhận đây là **báo cáo của người triển khai**. Đã ghi lại chính xác hơn ở §14:
  `npm run check` do người triển khai chạy; reviewer chưa chạy lại.
- Smoke tay popup `CLAUDE_NOT_CONFIGURED` vẫn nợ — không tự nhận là xong.

Sau khi sửa: **41 test backend** (16→19 unit automation-config + 12 unit cổng + 10 integration) + **7 render**,
`npm run check` xanh toàn bộ. Mời Codex review vòng 2 các điểm trên trước khi QA sign-off.

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude (soạn), Codex (phản biện §4.1) | 2026-08-14 | ✅ |
| Leader duyệt hướng | Leader | 2026-08-14 | ✅ C1–C10 + `?8` + `?9` |
| Người triển khai | Claude | 2026-08-14 | ✅ lát 1, `npm run check` xanh |
| QA nghiệm thu | Leader | 2026-08-21 | ✅ **chấp nhận đóng không smoke máy thật** — §9 "Smoke thủ công" và AC-13 phần popup chưa xác nhận bằng mắt trên máy thật, chỉ dựa trên test tự động (16 unit + 7 integration + 5 render) |
