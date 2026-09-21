# CR-20260821-whitelist-tool-vao-app — Chuyển whitelist tool automation vào app (lát 2 của BL-20260814-013)

| Trường | Giá trị |
|---|---|
| Loại | ☑ Sửa hành vi |
| Mức tác động | ☑ Lớn (đụng DB/nhiều màn/automation, cấp quyền ghi AI) |
| Người đề xuất | Claude (Leader pick, BA nháp) |
| Ngày | 2026-08-21 |
| Backlog item | `BL-20260821-001` (`Picked`) |
| Trạng thái | ☑ **Đã nghiệm thu (chấp nhận rủi ro, không có smoke máy thật)** — Codex review implementation tìm 2 finding (High + Medium), Claude đã sửa cả hai + viết test đỏ trước, Codex re-review PASS, `npm run check` xanh 10/10 cổng, `npm run package` xong 2026-08-21. **Leader quyết định đóng dựa trên bằng chứng test tự động, không chạy smoke thủ công theo kế hoạch §10** (xem `docs/exchanges/2026-08-21.md`) — rủi ro còn lại: chưa xác nhận bằng mắt UI checkbox/banner trên máy thật, chưa chạy 1 task read/write thật qua connector mới cấu hình |
| Spec liên quan | `docs/rules/` (automation config một cửa), `server/lib/automation-config.ts`, `server/routes/automation.ts`, `docs/operations/automation-ai-go-live-guide.md` |

## 1. Bối cảnh & Vấn đề

CR-20260814 đã sửa `CLAUDE_BIN` (file `claude` chạy) khỏi phụ thuộc biến môi trường Windows — lưu trong app,
có UI chọn, dò lại tại thời điểm ghi. Nhưng whitelist tool đọc/ghi cho từng **profile automation** (8 biến
`CLAUDE_READ/WRITE_TOOLS_POST/OTHER/DRIVE/REDMINE`) vẫn ở kiểu cũ: đặt bằng
`[Environment]::SetEnvironmentVariable(...,'User')`, gõ tay tên tool MCP dài
(`mcp__claude_ai_Google_Drive__create_file`), không UI, không validate, đúng lớp lỗi env-stale mà CR-20260814
đã diệt cho `CLAUDE_BIN` — Windows chụp env lúc spawn tiến trình nên đổi env xong vẫn phải khởi động lại app
"đúng cách" mới ăn. Lỗi này đã gây sự cố lặp lại 20/08 (thiếu whitelist Drive, thiếu whitelist Redmine), chỉ
lộ ra khi task automation chạy tới bước preview và bị chặn — quá muộn.

Vá tạm (đường B, cùng ngày 2026-08-21) đã làm màn Cài đặt → AI cảnh báo thiếu Drive/Redmine sớm hơn, nhưng
chưa sửa gốc: người dùng vẫn phải tự đặt env + khởi động lại đúng cách mỗi lần đổi quyền tool. CR này là lát 2
— sửa gốc bằng cách chuyển việc *lưu* whitelist vào app (giống `CLAUDE_BIN`).

Điểm khác biệt quan trọng với `CLAUDE_BIN`: `CLAUDE_BIN` là chọn **file chạy Claude**, còn whitelist tool là
cấp **quyền AI được đọc/ghi tool nào ra hệ thống ngoài** (Dr.JOY, Drive, Redmine) — cấp sai ở đây có thể làm
AI xoá/gỡ dữ liệu thật. Vì vậy không thể áp nguyên khuôn "dò rồi cho chọn" của `CLAUDE_BIN`: dò được một tool
tồn tại trong MCP không có nghĩa tool đó đã được kiểm tra an toàn để bật cho automation (Codex review,
`docs/exchanges/2026-08-21.md` mục "Codex input cho lát 2").

**Điểm chỉnh sau review vòng 3 (quan trọng — đổi mô hình dữ liệu):** whitelist runtime hiện tại KHÔNG cấp
quyền theo "connector" 1-1 (Dr.JOY/Drive/Redmine) mà cấp theo **profile `actionType`** (`post`/`drive`/
`redmine`), và một profile có thể chứa tool của NHIỀU connector khác nhau — ví dụ `CLAUDE_READ_TOOLS_POST`
go-live thật hiện có cả 9 tool Dr.JOY **và** 2 tool Redmine (`search_issues`, `get_issue`) để AI tự tra ticket
trước khi đăng bài (xem `docs/operations/automation-ai-go-live-guide.md` dòng 199-201). CR bản đầu gọi nhầm
đây là "connector" khiến catalog `post.read` chỉ có Dr.JOY — nếu code theo bản đó, `adoptEnvWhitelistToolsOnce`
sẽ âm thầm làm rớt 2 tool Redmine khỏi profile `post` đang chạy thật, hỏng khả năng tra ticket khi đăng bài
khẩn cấp. Toàn bộ CR dưới đây dùng từ **profile** (khớp `ActiveAutomationActionType`), không dùng "connector"
để chỉ nhóm cấu hình; `toolConnector` chỉ còn là field phụ để UI gom nhóm hiển thị.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Whitelist tool đọc/ghi cho 3 **profile active** (`post`, `drive`, `redmine` — đúng `ActiveAutomationActionType`)
    cấu hình được qua UI Cài đặt → AI, lưu trong `app_settings`, không cần đặt env + khởi động lại app.
  - Route ghi chỉ chấp nhận tool nằm trong **danh sách đã promote** — liệt kê cứng ở §6.4 theo đúng giá trị
    go-live thật hiện tại (không phải suy diễn), không chấp nhận "mọi tool đang có trong MCP server".
  - Máy đang chạy bằng env cũ được **nhận nuôi một lần**, phần tool bị loại (không thuộc danh sách promote)
    phải hiện cảnh báo rõ, không âm thầm bỏ qua — và không được làm rớt tool đang go-live thật (§6.4).
  - Sau khi đã lưu trong app, runtime đọc theo app trước — không rơi lại env cũ (cùng luật đã áp cho
    `CLAUDE_BIN`).
- **Ngoài phạm vi (không làm lần này):**
  - **`actionType='other'` KHÔNG được đưa vào CR này** (Codex review vòng 2, finding High): `other` là dữ
    liệu legacy đã bị khoá cứng (`server/types.ts` — input mới không được lưu, `automation.ts:43` chặn 400,
    scheduler không chạy). Không thêm UI, không thêm profile `'other'` vào body `PUT`, không thêm khoá
    `app_settings` cho `other`. `CLAUDE_READ/WRITE_TOOLS_OTHER` giữ nguyên như hiện tại — chỉ dùng làm nguồn
    deny-list bổ sung trong `claude-runner.ts` (`envWriteTools()`), không phải quyền cấu hình được.
  - Promote thêm tool Drive/Redmine chưa nằm trong tập go-live/direct-UAT hiện tại (thuộc
    `BL-20260815-005/006/007`) — danh sách promote ở CR này CHỈ khớp đúng giá trị đang chạy thật, liệt kê ở
    §6.4. Riêng emergency-release F1/F2 (Redmine `sprint_versions` cộng vào profile đọc của `post`) CHƯA
    go-live đầy đủ theo go-live guide dòng 216-222 — CR này KHÔNG promote `sprint_versions` vào `post.read`.
  - Least-privilege theo từng operation (vd chỉ cấp `update_issue_note` thay vì cả whitelist actionType) —
    thuộc `BL-20260815-007`, CR riêng. Nhiều tool Redmine đã **direct UAT PASS** (20/20, xem
    `docs/exchanges/2026-08-15.md`) nhưng CHƯA được promote vào profile runtime vì đưa hết vào whitelist
    actionType là quá rộng — CR này giữ nguyên đúng tập đã promote/go-live hiện tại, không mở rộng.
  - Dò tool MCP tự động theo thời gian thực từ server thật (Dr.JOY/Drive/Redmine) — danh sách promote lần
    này là catalog tĩnh trong code (§6.4), không query MCP server sống. Khi cần discovery ổn định hơn, đó là
    CR riêng sau này.

## 3. Người dùng & Kịch bản

- Là **người vận hành máy chạy automation** (Leader/Dev), tôi muốn bật/tắt quyền đọc-ghi tool cho từng
  profile ngay trong Cài đặt → AI, để không phải mở PowerShell đặt env rồi khởi động lại app đúng cách mỗi
  lần đổi quyền.
- Là **người duyệt hành động AI**, tôi muốn chắc chắn AI không thể tự có quyền ghi vào một tool nguy hiểm
  (`delete_*`/`trash_*`/`close_*`) chỉ vì tool đó tình cờ có mặt trong MCP server đang kết nối.

## 4. Yêu cầu chức năng

- **FR-1:** Server có danh sách promote tĩnh (`TOOL_CATALOG`) cho 3 profile active (`post`/`drive`/
  `redmine`) × mode (`read`/`write`), liệt kê CỨNG trong code (không tự sinh từ env lúc chạy) đúng bảng
  promoted catalog ở §6.4 — khớp đúng giá trị go-live thật hiện tại, mỗi tool có thêm `toolConnector`
  (`drjoy`/`drive`/`redmine`) để UI gom nhóm hiển thị mà không đổi quyền runtime. Đây là danh sách đóng duy
  nhất route ghi được phép chấp nhận. Không có `other` trong `TOOL_CATALOG` (xem mục 2 — ngoài phạm vi).
- **FR-2:** `toolId` là hash ổn định của `{profile, mode, toolName}` (theo mẫu `candidateIdOf` của
  `CLAUDE_BIN`) — không dùng index mảng, vì thứ tự hiển thị có thể đổi giữa lần GET và PUT.
- **FR-3:** `GET /api/automation/config` trả thêm `toolCatalog`: với mỗi `profile`×`mode`, danh sách
  `{toolId, toolName, toolConnector}` (toàn bộ catalog đều đã promote vì đã tĩnh) và `enabledToolIds` — danh
  sách `toolId` đang được **bật** (đã lưu trong app_settings) theo cùng cấu trúc `profile`×`mode`.
- **FR-4:** `PUT /api/automation/config/tools` nhận `{profile, mode, toolIds: string[]}`; server đối chiếu
  từng `toolId` với `TOOL_CATALOG[profile][mode]` tại thời điểm ghi (không tin danh sách phía client giữ từ
  lần GET trước — cùng nguyên tắc `saveClaudeBinCandidate`); `toolId` lạ ⇒ `400`, không âm thầm bỏ qua. Ghi
  đè toàn bộ tập tool đang bật cho đúng `profile`+`mode` đó vào `app_settings`.
- **FR-5:** `adoptEnvWhitelistToolsOnce()` — khi app_settings chưa có cấu hình tool cho một `profile`+`mode`
  (khoá tồn tại hay chưa, giống điều kiện `adoptEnvClaudeBinOnce`), đọc biến env tương ứng
  (`CLAUDE_{READ|WRITE}_TOOLS_{PROFILE}`), lọc từng tool qua `TOOL_CATALOG[profile][mode]`, chỉ ghi phần
  khớp; phần bị loại (có trong env nhưng không có trong catalog) trả về danh sách riêng để log + hiển thị
  cảnh báo — không ghi, không im lặng bỏ. Vì catalog `post.read` đã bao gồm cả 2 tool Redmine go-live thật
  (§6.4), máy đang chạy đúng cấu hình go-live sẽ KHÔNG bị rớt tool nào khi nhận nuôi.
- **FR-6:** `readToolsFor`/`writeToolsFor` (`server/routes/automation.ts`) và mọi call-site runtime khác đọc
  whitelist qua `automation-config.ts` (một cửa hiện có) theo thứ tự: `app_settings` đã lưu (kể cả rỗng, tức
  người dùng chủ ý bỏ hết) → nếu **khoá chưa từng ghi** thì rơi về env như hiện tại (đường tương thích test/CI
  + máy chưa nhận nuôi) → không có gì thì coi như chưa cấu hình (giữ nguyên lỗi 503
  `READ/WRITE_TOOLS_NOT_CONFIGURED` đang có).
  **Sửa theo Codex review vòng 5, finding High:** khi `app_settings` key đã tồn tại cho `profile`+`mode` đó,
  kết quả trả về phải là **CHÍNH XÁC** danh sách trong DB — không được cộng thêm `DEFAULT_POST_READ_TOOLS`/
  `DEFAULT_POST_WRITE_TOOLS` (fallback Dr.JOY hard-code hiện có trong `automation.ts`) hay bất kỳ nguồn nào
  khác, kể cả khi DB rỗng hoặc chỉ có 1 tool. `DEFAULT_POST_*` chỉ còn tác dụng ở nhánh **khoá chưa từng ghi**
  (đúng vai trò cũ: cứu máy đang chạy bằng env chưa cấu hình `_POST`, theo BUG-20260813). Nói cách khác: DB đã
  ghi ⇒ DB là toàn bộ sự thật, không union với gì thêm; DB chưa từng ghi ⇒ giữ nguyên hành vi cũ (env ∪
  `DEFAULT_POST_*`).
- **FR-7:** UI Cài đặt → AI hiển thị theo `profile` × `mode`, mỗi tool trong catalog là 1 checkbox (bật/tắt)
  kèm badge `toolConnector` (vd "Dr.JOY"/"Redmine") để user hiểu tool này thuộc hệ thống nào dù nằm chung
  profile `post`, không có ô nhập chuỗi tự do. Card hiển thị `envRefreshWarnings`/`adoptEnvWhitelistToolsOnce`
  warning nếu có tool bị loại khi nhận nuôi.

## 5. Yêu cầu phi chức năng

- **Bảo mật (an toàn là trọng tâm CR này):** route ghi không nhận chuỗi tool tự do; `TOOL_CATALOG` là hằng số
  trong code (đổi catalog = đổi code = qua review), không đọc từ input HTTP nào. Không log giá trị tool đang
  bật/tắt ở mức chi tiết nhạy cảm ra ngoài response lỗi (trả tên khoá, không trả toàn bộ danh sách trong log
  lỗi).
- **Tương thích dữ liệu cũ:** máy đang chạy bằng env không bị tắt câm sau khi lên bản mới có CR này (FR-5,
  FR-6 nhánh rơi về env); đặc biệt máy đang chạy đúng profile go-live thật không bị rớt tool khi nhận nuôi
  (§6.4 catalog khớp 100% giá trị go-live).
- **Hiệu năng:** không có bước dò MCP server sống nào trong luồng này (đã bỏ khỏi phạm vi ở mục 2) nên không
  phát sinh rủi ro treo/chậm màn Cài đặt.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI (tham chiếu docs/02, docs/06)

Màn Cài đặt → AI, thêm khối "Quyền tool automation" dưới khối chọn `CLAUDE_BIN` hiện có:

- 3 nhóm theo **profile automation active**: **Đăng Dr.JOY (`post`)**, **Google Drive (`drive`)**,
  **Redmine (`redmine`)**. Không có nhóm `other` — `other` là dữ liệu legacy đã khoá, không cấu hình được
  qua UI (xem mục 2).
- Mỗi nhóm 2 cột: **Tool được đọc** / **Tool được ghi**, mỗi cột là danh sách checkbox lấy từ `toolCatalog`
  (tên tool rút gọn dễ đọc, ví dụ `create-group-article` thay vì tên đầy đủ `mcp__claude_ai_Dr_JOY_MCP__...`
  — có thể hiện tooltip tên đầy đủ). Mỗi dòng có badge nhỏ theo `toolConnector` (vd "Dr.JOY", "Redmine") —
  quan trọng cho nhóm **`post`** vì cột đọc có cả tool Dr.JOY lẫn Redmine, không để user hiểu nhầm profile
  `post` chỉ liên quan Dr.JOY.
- Không có ô nhập text tự do, không có nút "thêm tool khác" — đúng tinh thần "danh sách đóng".
- Nếu `adoptEnvWhitelistToolsOnce` phát hiện tool trong env cũ không thuộc catalog: hiện dòng cảnh báo màu
  vàng "Có N tool trong cấu hình cũ không được nhận vì chưa được xác nhận an toàn — liên hệ Leader nếu cần
  bật thêm" (không liệt kê tên tool ra UI nếu tool đó là tool ghi nguy hiểm; liệt kê tên nếu là tool đọc).
- Trạng thái lưu: giống khối `CLAUDE_BIN` hiện tại (lưu ngay khi tick, có toast xác nhận), không cần nút Lưu
  riêng để tránh lệch trạng thái giữa các card.

### 6.2. API & nghiệp vụ (tham chiếu docs/03, docs/07)

- `GET /api/automation/config` (route hiện có) — mở rộng response, thêm field `toolCatalog` và
  `enabledToolIds` theo cấu trúc FR-3. Không đổi field cũ, không đổi status code hiện tại. Ví dụ rút gọn
  (Codex review vòng 2 finding Medium — cần sample JSON tường minh; vòng 3 đổi `connector` thành `profile` +
  thêm `toolConnector` để FE/BE không hiểu nhầm là 1-1 với hệ thống ngoài):
  ```json
  {
    "toolCatalog": {
      "post": {
        "read": [
          { "toolId": "a1b2c3d4e5f60718", "toolName": "mcp__claude_ai_Dr_JOY_MCP__list-groups", "toolConnector": "drjoy" },
          { "toolId": "9f8e7d6c5b4a3210", "toolName": "mcp__claude_ai_Redmine_MCP__search_issues", "toolConnector": "redmine" }
        ],
        "write": [
          { "toolId": "f0e1d2c3b4a59687", "toolName": "mcp__claude_ai_Dr_JOY_MCP__create-group-article", "toolConnector": "drjoy" }
        ]
      },
      "drive": { "read": [ /* ... */ ], "write": [ /* ... */ ] },
      "redmine": { "read": [ /* ... */ ], "write": [ /* ... */ ] }
    },
    "enabledToolIds": {
      "post": { "read": ["a1b2c3d4e5f60718", "9f8e7d6c5b4a3210"], "write": [] },
      "drive": { "read": [], "write": [] },
      "redmine": { "read": [], "write": [] }
    }
  }
  ```
  `toolCatalog` là danh sách ĐẦY ĐỦ (mọi tool đã promote, kể cả chưa bật); `enabledToolIds` chỉ gồm `toolId`
  đang được bật trong `app_settings`. Không có khoá `other` ở cả hai object.
- `PUT /api/automation/config/tools` (route mới) — body `{profile: 'post'|'drive'|'redmine', mode:
  'read'|'write', toolIds: string[]}`. `profile` chỉ nhận 3 giá trị active — `'other'` bị coi là `profile`
  không hợp lệ, trả `400`.
  - `400` nếu `profile`/`mode` không hợp lệ, hoặc bất kỳ `toolId` nào không có trong `TOOL_CATALOG[profile]
    [mode]`.
  - `200` trả lại danh sách tool đang bật sau khi ghi (để UI đồng bộ ngay, không cần GET lại).
  - Ghi trong `withTransaction` nếu đụng nhiều dòng `app_settings` cùng lúc (khớp `server/lib/*` hiện có).
- Không thêm quyền đăng nhập mới (app vẫn local-only, `127.0.0.1`) — an toàn dựa vào danh sách đóng
  `TOOL_CATALOG`, không dựa vào auth.

### 6.3. Dữ liệu & schema (tham chiếu docs/04, docs/08)

- Không thêm bảng mới. Dùng `app_settings` (key-value đã có), thêm **6 khoá mới** (3 profile active ×
  2 mode — KHÔNG có khoá cho `other`): `automation_tools_read_post`, `automation_tools_write_post`,
  `automation_tools_read_drive`, `automation_tools_write_drive`, `automation_tools_read_redmine`,
  `automation_tools_write_redmine`. Giá trị: chuỗi tên tool nối bằng dấu phẩy (giống format env hiện tại, để
  đổi hướng đọc dễ đối chiếu) — server luôn ghi lại từ `toolName` đã đối chiếu catalog, không ghi trực tiếp
  input client. `automation_tools_read_post` khi lưu sẽ chứa CẢ tool Dr.JOY lẫn Redmine đã bật (không tách
  bảng theo connector — connector chỉ là field hiển thị `toolConnector` ở tầng catalog/API).
- Không cần migration dữ liệu cũ ngoài `adoptEnvWhitelistToolsOnce` (chạy lười, tương tự
  `adoptEnvClaudeBinOnce`, không phải migration SQL).

### 6.4. Automation / tích hợp

`TOOL_CATALOG` định nghĩa trong `server/lib/automation-config.ts` (cùng file một-cửa hiện có), **liệt kê
CỨNG** đúng bảng dưới đây — khớp 100% giá trị go-live thật đang chạy (`docs/operations/automation-ai-go-live-guide.md`
dòng 197-208), không tự suy diễn từ env lúc code/chạy (Codex review vòng 2 finding High). Chỉ 3 profile
active; `other` không xuất hiện trong catalog.

| Profile | Mode | Tool đã promote (fully-qualified) | `toolConnector` | Nguồn |
|---|---|---|---|---|
| `post` | read | `mcp__claude_ai_Dr_JOY_MCP__list-groups`, `mcp__claude_ai_Dr_JOY_MCP__get-group-articles`, `mcp__claude_ai_Dr_JOY_MCP__get-group-article-detail`, `mcp__claude_ai_Dr_JOY_MCP__get-group-article-comments`, `mcp__claude_ai_Dr_JOY_MCP__get-group-article-recipients`, `mcp__claude_ai_Dr_JOY_MCP__get-group-members`, `mcp__claude_ai_Dr_JOY_MCP__list-group-to-presets`, `mcp__claude_ai_Dr_JOY_MCP__parse-group-url`, `mcp__claude_ai_Dr_JOY_MCP__search-content` | `drjoy` | Go-live guide dòng 201 |
| `post` | read | `mcp__claude_ai_Redmine_MCP__search_issues`, `mcp__claude_ai_Redmine_MCP__get_issue` | `redmine` | Go-live guide dòng 201: đã cộng vào `CLAUDE_READ_TOOLS_POST` thật để AI tự tra ticket trước khi đăng bài |
| `post` | write | `mcp__claude_ai_Dr_JOY_MCP__create-group-article`, `mcp__claude_ai_Dr_JOY_MCP__create-group-comment` | `drjoy` | Go-live guide dòng 202 |
| `drive` | read | `mcp__claude_ai_Google_Drive__search_files`, `mcp__claude_ai_Google_Drive__get_file_metadata` | `drive` | Go-live guide dòng 204, `BL-20260815-005` UAT |
| `drive` | write | `mcp__claude_ai_Google_Drive__create_file`, `mcp__claude_ai_Google_Drive__copy_file` | `drive` | Go-live guide dòng 205 — `copy_file` dùng cho release schedule E5 (copy template) |
| `redmine` | read | `mcp__claude_ai_Redmine_MCP__search_issues`, `mcp__claude_ai_Redmine_MCP__get_issue` | `redmine` | Go-live guide dòng 207 |
| `redmine` | write | `mcp__claude_ai_Redmine_MCP__create_issue`, `mcp__claude_ai_Redmine_MCP__update_issue` | `redmine` | Go-live guide dòng 208 — cả hai đã UAT PASS trực tiếp + headless negative trên issue `#276098` (`exchanges/2026-08-15.md`) |

**Về alias cũ `mcp__drjoy__*` (sửa theo Codex review vòng 4, finding Medium):** `TOOL_CATALOG`/UI **chỉ**
promote tên tool fully-qualified `mcp__claude_ai_...` đúng như go-live guide — KHÔNG đưa alias ngắn cũ
`mcp__drjoy__create-group-article` v.v. vào catalog/checkbox, để giữ đúng nghĩa "khớp 100% go-live thật".
Alias cũ vẫn tồn tại độc lập trong `DEFAULT_POST_READ_TOOLS`/`DEFAULT_POST_WRITE_TOOLS`
(`server/routes/automation.ts`) như một nhánh fallback runtime cho máy chưa cập nhật tên server — CR này
KHÔNG đổi 2 hằng số đó, không đưa chúng vào `TOOL_CATALOG`, không hiện chúng trên UI.

**Về phần "chưa promote" (sửa wording + số lượng theo Codex review vòng 3+4):** Redmine MCP có 20 tool, đã
có bằng chứng **direct UAT PASS cả 20/20** (`exchanges/2026-08-15.md`). Catalog runtime promote đúng 4 tool
riêng biệt (`search_issues`, `get_issue`, `create_issue`, `update_issue` — 2 tool đầu dùng chung cho cả
`post.read` và `redmine.read`, không tính trùng), nên còn **16 tool** ngoài bảng: `create_issue_tree`,
`copy_issue`, `relate_issue`, `close_issue_tree`, `delete_issue_note`, `delete_time_entry`,
`create_time_entry`, `update_time_entry`, `update_issue_note`, `list_active_users`, `list_custom_fields`,
`list_time_entries`, `check_time_entry_activities`, `upload_attachment`, `sprint_versions`,
`get_current_user`. Đây **KHÔNG phải "chưa UAT"** mà là **đã UAT nhưng chưa được promote vào profile
runtime**, vì đưa hết vào whitelist actionType hiện tại là quá rộng cho least-privilege — việc promote có
kiểm soát theo operation thuộc `BL-20260815-007`.

Riêng Drive (11 tool tổng), catalog promote đúng 4 (`search_files`, `get_file_metadata`, `create_file`,
`copy_file`), còn **7 tool** ngoài bảng **thật sự CHƯA UAT** (`BL-20260815-005` mới xong 4/11 sau khi CR này
promote `copy_file`): `list_recent_files`, `read_file_content`, `download_file_content`,
`get_file_permissions`, `share_file`, `trash_file`, `update_file`.

Cả hai nhóm (16 Redmine + 7 Drive) đều không có trong `TOOL_CATALOG` ở CR này — route ghi từ chối vì không
có `toolId` nào được cấp cho chúng.

**Amend 2026-08-21 (sau khi CR đã triển khai — Leader trực tiếp yêu cầu, xem `exchanges/2026-08-21.md`):**
câu "không hiện trong UI" ở trên đã đổi. Leader xem bản nháp "Sổ tay tool AI" (artifact tham khảo mô tả
từng tool + lý do chưa cấp quyền) và yêu cầu đưa thẳng bảng đó vào màn Cài đặt → AI thay vì chỉ để ở tài
liệu riêng — mục đích: người dùng thấy ngay "còn tool nào đã biết nhưng chưa bật, vì sao" mà không cần đọc
CR. Đã triển khai ở `src/components/automation-config-settings.tsx` (`CHUA_CAP_QUYEN`, commit `b31fe12` +
fix drift `Codex review` sau đó): hiển thị 23 tool này dưới dạng dòng tham khảo, **checkbox luôn disabled,
không có `toolId` thật** — không mở thêm bất kỳ quyền ghi nào so với thiết kế gốc, chỉ khác ở CHỖ hiển thị.
Do đây là amend sau sign-off, không đi lại đủ 6 vòng review thiết kế như phần còn lại của CR — Codex đã
review riêng phần code này (tìm đúng rủi ro "2 nguồn sự thật" giữa `CHUA_CAP_QUYEN` tĩnh và `TOOL_CATALOG`
server, đã vá bằng cách lọc loại trừ tool trùng + test chứng minh không hiện đôi).

- `readToolsFor`/`writeToolsFor` (`server/routes/automation.ts`) giữ nguyên chữ ký, chỉ đổi nguồn đọc bên
  trong theo FR-6. **Lưu ý quan trọng (Codex review vòng 5, finding High):** implementation hiện tại luôn
  `[...envTools(raw), ...fallback]` — cộng `DEFAULT_POST_READ/WRITE_TOOLS` vô điều kiện cho `post`. Sau CR
  này, phép cộng fallback đó CHỈ được giữ ở nhánh "khoá `app_settings` chưa từng ghi" (tương đương `raw` đọc
  từ env như cũ); khi khoá DB đã tồn tại, hàm phải trả đúng danh sách trong DB, không union với
  `DEFAULT_POST_*` nữa — nếu không, UI/`TOOL_CATALOG` sẽ không phải là nguồn quyền thật, user tắt tool trên
  UI mà runtime vẫn tự thêm lại (xem AC-4b/AC-5b).
- `envWriteTools()` (`server/lib/claude-runner.ts`) — deny-list cho pha đọc — tiếp tục gộp cả
  `CLAUDE_WRITE_TOOLS_OTHER` (không đổi, giữ nguyên đọc env vì `other` không migrate ở CR này) VÀ tập write
  tool đã promote của `post`/`drive`/`redmine` (nguồn đổi sang `app_settings`-trước-env theo FR-6, bao gồm cả
  `copy_file` mới thêm vào `drive.write`). Không bỏ sót nguồn nào khỏi deny-list — nếu bỏ, tool ghi có thể
  lọt vào whitelist đọc. Cần test riêng chứng minh write tool đọc từ `app_settings` (không chỉ từ env) vẫn bị
  deny đúng ở pha đọc (Codex review vòng 3).
- Mọi hành động ghi ra ngoài của AI vẫn cần người duyệt ở bước preview→approval (không đổi ở CR này) — CR
  này chỉ đổi *nơi cấu hình quyền tool*, không đổi luồng duyệt.

## 7. Phân tích tác động

- [x] Frontend (màn Cài đặt → AI) · [x] API route (`GET` mở rộng + `PUT` mới) · [x] DB (6 khoá `app_settings`
  mới, 3 profile active × 2 mode) · [x] Automation/MCP (nguồn đọc whitelist)
- [ ] i18n · [ ] Đóng gói SEA/MCP (không đổi cách đóng gói) · [x] Bảo mật (trọng tâm CR) · [x] Dữ liệu cũ/
  backward-compat (nhận nuôi env)
- **Rủi ro & giảm thiểu:**
  - Rủi ro cấp nhầm quyền ghi nguy hiểm → giảm bằng danh sách đóng `TOOL_CATALOG` tĩnh trong code, route ghi
    fail-closed với `toolId` lạ.
  - Rủi ro máy đang chạy tốt bằng env bị mất quyền sau khi lên bản mới (đặc biệt profile `post` bị rớt tool
    Redmine tra ticket) → giảm bằng cách catalog khớp 100% giá trị go-live thật (§6.4) + cảnh báo phần bị
    loại thay vì âm thầm bỏ.
  - Rủi ro lệch giữa danh sách hiển thị (GET) và lúc ghi (PUT) do đổi thứ tự → giảm bằng `toolId` hash ổn
    định (FR-2), không dùng index.
  - Rủi ro hiểu nhầm "profile" là "connector" (đúng lỗi review vòng 3 phát hiện trong bản đầu CR) → toàn bộ
    thuật ngữ trong CR/API/UI dùng `profile`, `toolConnector` chỉ là field hiển thị phụ.
- **Ảnh hưởng chức năng đang chạy:** Không đổi hành vi `preview`/`execute` khi đã cấu hình đủ; chỉ đổi nơi
  cấu hình. Máy chưa từng cấu hình gì (cả app lẫn env) vẫn báo thiếu như hiện tại.

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1/FR-4):** Given `TOOL_CATALOG['drive']['write']` không có tool `X`, When gọi `PUT
  /api/automation/config/tools` với `toolIds` chứa hash của `X`, Then trả `400`, không ghi gì vào
  `app_settings`.
- **AC-2 (FR-4):** Given `TOOL_CATALOG['redmine']['read']` có tool `search_issues`, When PUT với đúng
  `toolId` của `search_issues`, Then `app_settings.automation_tools_read_redmine` chứa `search_issues`, GET
  sau đó trả đúng tool này trong `enabledToolIds`.
- **AC-3 (FR-5):** Given máy có env `CLAUDE_WRITE_TOOLS_DRIVE` chứa 1 tool trong catalog + 1 tool ngoài
  catalog, chưa từng lưu `app_settings` cho khoá này, When app khởi động (hoặc gọi
  `adoptEnvWhitelistToolsOnce`), Then chỉ tool trong catalog được ghi vào `app_settings`, và có cảnh báo liệt
  kê phần bị loại.
- **AC-3b (FR-5, thêm sau review vòng 3 — chống regression go-live thật):** Given máy đang chạy đúng go-live
  profile thật: `CLAUDE_READ_TOOLS_POST` = 9 tool Dr.JOY + `search_issues,get_issue`, When
  `adoptEnvWhitelistToolsOnce` chạy, Then CẢ 11 tool đều được ghi vào `app_settings.automation_tools_read_post`
  (không tool Redmine nào bị loại), không có cảnh báo nào phát sinh.
- **AC-4 (FR-6):** Given `app_settings` đã có khoá `automation_tools_write_post` (kể cả rỗng), When
  `writeToolsFor('post')` được gọi, Then không đọc `CLAUDE_WRITE_TOOLS_POST` nữa dù env vẫn còn giá trị cũ.
- **AC-4b (FR-6, thêm sau review vòng 5, finding High — điểm quan trọng nhất):** Given `app_settings.
  automation_tools_write_post = ''` (DB đã ghi, cố ý rỗng), When `writeToolsFor('post')` được gọi, Then trả
  về `[]` — KHÔNG tự cộng `DEFAULT_POST_WRITE_TOOLS` (`create-group-article`, `create-group-comment`, alias
  `mcp__drjoy__*`). Given `automation_tools_read_post` chỉ lưu đúng 1 tool, When `readToolsFor('post')` được
  gọi, Then trả về đúng 1 tool đó — không tự thêm 8 tool Dr.JOY còn lại của `DEFAULT_POST_READ_TOOLS` và
  không thêm alias `mcp__drjoy__*`. Đây là ca chứng minh DB đã ghi thì DB là toàn bộ sự thật, không union với
  fallback hard-code.
- **AC-5 (FR-6):** Given `app_settings` CHƯA từng có khoá `automation_tools_write_redmine` (chưa nhận nuôi,
  chưa cấu hình qua UI), When `writeToolsFor('redmine')` được gọi, Then vẫn rơi về `CLAUDE_WRITE_TOOLS_REDMINE`
  từ env (không phá máy CI/test hiện tại).
- **AC-5b (FR-6, đối chứng AC-4b):** Given `app_settings` CHƯA từng có khoá `automation_tools_write_post`
  (chưa nhận nuôi, chưa cấu hình qua UI) và env `CLAUDE_WRITE_TOOLS_POST` rỗng, When `writeToolsFor('post')`
  được gọi, Then vẫn trả về `DEFAULT_POST_WRITE_TOOLS` như hành vi hiện tại (BUG-20260813 harden) — fallback
  chỉ mất tác dụng SAU KHI khoá DB tồn tại (AC-4b), không phải ngay khi CR này merge.
- **AC-6 (FR-7):** Given một tool ghi nguy hiểm (vd `close_issue_tree`, `delete_time_entry`) có mặt trong
  MCP/env cũ nhưng KHÔNG có trong `TOOL_CATALOG` (đã UAT nhưng chưa promote, hoặc chưa UAT — xem §6.4), When
  mở màn Cài đặt → AI, Then tool đó không hiện checkbox nào (vì không tồn tại trong catalog, chứ không phải
  do UI ẩn thủ công); nếu tool này có trong env cũ lúc `adoptEnvWhitelistToolsOnce` chạy, nó bị loại và xuất
  hiện trong cảnh báo (AC-3), không được ghi vào `app_settings`.
- **AC-7 (FR-6, thêm sau review vòng 3):** Given `automation_tools_write_drive` đã lưu `create_file,copy_file`
  trong `app_settings` (không còn ở env), When pha đọc của bất kỳ profile nào chạy `sanitizeReadTools`, Then
  `copy_file` vẫn bị loại khỏi whitelist đọc bởi `envWriteTools()`/deny-list (đọc đúng nguồn `app_settings`,
  không chỉ nguồn env).

## 9. Kế hoạch test (tham chiếu standards/qa-standard.md)

- Tầng test dự kiến: Unit (`TOOL_CATALOG` lookup, hash `toolId`) · Integration route (`GET`/`PUT` mới,
  `adoptEnvWhitelistToolsOnce`) · Integration runner (`envWriteTools()` deny-list đọc đúng nguồn `app_settings`,
  AC-7) · Render component (card mới ở Cài đặt → AI, trạng thái disabled/cảnh báo/badge `toolConnector`) ·
  Smoke thủ công (đổi quyền qua UI, restart app, chạy 1 task mode read + 1 task mode write trên đích nháp).
- Ca test chính + ca lỗi/biên: `toolId` không tồn tại (400), `toolIds` rỗng (ghi rỗng = tắt hết quyền profile
  đó, hợp lệ), env có tool ngoài catalog (loại + cảnh báo, AC-3), env đúng go-live thật không bị rớt tool
  nào (AC-3b), `app_settings` đã có khoá (không fallback env dù rỗng, AC-4), `app_settings` chưa có khoá
  (fallback env, AC-5), hai profile độc lập nhau (đổi Drive không ảnh hưởng Redmine), write tool từ DB vẫn bị
  deny ở pha đọc (AC-7), **DB đã ghi (kể cả rỗng/subset) không union với `DEFAULT_POST_*` (AC-4b) — ca quan
  trọng nhất, test riêng cả rỗng và subset 1-tool**, DB chưa từng ghi vẫn giữ fallback cũ (AC-5b). Ghi chú
  test thêm từ Codex review vòng 6 (không chặn sign-off): khi test AC-4b cho `readToolsFor('post')`, đặt cả
  env `CLAUDE_READ_TOOLS` (common, không có hậu tố profile) rồi xác nhận DB subset vẫn KHÔNG union với
  common — làm rõ tường minh câu "không thêm env/common/fallback" ở FR-6.

## 10. Kế hoạch triển khai / rollback

- Bước triển khai: code → `npm run check` xanh → `npm run package` → tắt/bật lại `TaskManager.exe` (bắt buộc
  theo CLAUDE.md) → smoke máy thật theo AC-3b/AC-6/AC-7 → Leader duyệt → nghiệm thu.
- Rollback nếu hỏng: revert commit, `app_settings` 6 khoá mới không có ai đọc nếu revert code (không ảnh
  hưởng dữ liệu cũ vì đường đọc env vẫn còn nguyên ở FR-6 nhánh fallback).

## 11. Docs cần cập nhật sau khi làm xong

- [ ] `docs/operations/automation-ai-go-live-guide.md` — thêm hướng dẫn cấu hình whitelist tool qua UI thay
  vì PowerShell/env; cập nhật ghi chú "profile `post` gồm cả tool Redmine" nếu UI khiến điều này rõ hơn.
- [ ] Rules automation liên quan (`docs/rules/06-09` phần automation config) — cập nhật một-cửa
  `automation-config.ts` có thêm `TOOL_CATALOG`.
- [ ] `docs/backlog/README.md` — chuyển `BL-20260821-001` sang `Done` khi nghiệm thu xong.

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-08-21 | OK |
| Người triển khai | User (chốt triển khai qua chat, xem exchange) | 2026-08-21 | OK |
| QA nghiệm thu | | | |

---

## Bug phát hiện khi smoke thật (2026-08-26) — đã sửa trong cùng CR

Smoke máy thật (máy nhà) làm lộ **2 lỗi thiết kế của chính CR này**, cả hai đều thoát qua mọi vòng review vì
review chỉ đọc tài liệu, không có máy thứ hai để đối chiếu. Triệu chứng bên ngoài: task Redmine liên tục báo
`haven't granted it yet` như thể lỗi phân quyền tool — truy sai hướng mất hàng giờ (sửa env nhiều lần vô ích).

| # | Lỗi | Vì sao review không bắt được | Đã sửa |
|---|---|---|---|
| 1 | `TOOL_CATALOG` liệt kê cứng tên tool **lấy từ tài liệu go-live** (toàn tiền tố `mcp__claude_ai_*`). Nhưng tên tool thật phụ thuộc CÁCH TỪNG MÁY đăng ký MCP: connector claude.ai → `mcp__claude_ai_Redmine_MCP__*`; `claude mcp add redmine` → `mcp__redmine__*`. Dự án chạy 2 máy ⇒ catalog 1-tiền-tố chắc chắn sai ở máy còn lại | Codex vòng 3/4 **đúng** khi bắt "không suy catalog từ env", nhưng cả hai bên đều coi tài liệu là nguồn chân lý cho TÊN tool — trong khi tên tool là **thuộc tính của máy**, không phải hằng số dự án | Catalog khai báo theo **capability** (`connector` + thao tác) rồi tự nhân với `SERVER_ALIASES`. Thêm kiểu đăng ký MCP mới = thêm 1 dòng. Alias không có trên máy đó chỉ đơn giản không khớp gì — vô hại, đúng cách `DEFAULT_POST_*` đã làm cho Dr.JOY từ trước |
| 2 | "adopt đúng 1 lần" + "DB thắng env tuyệt đối" (FR-6/AC-4b) ⇒ **một lần adopt trúng giá trị sai là khoá chết vĩnh viễn**: sửa env bao nhiêu lần cũng vô hiệu, app không có đường thoát nào ngoài sửa tay DB | AC-4b/AC-5b chỉ soi 2 nhánh "khoá đã ghi" vs "khoá chưa từng ghi" — không ai hỏi *"giá trị sai lọt vào DB thì gỡ bằng cách nào"* | "DB thắng env" giờ chỉ bảo vệ **lựa chọn của người dùng**. Thêm dấu vết `automation_tools_adopted_<mode>_<profile>`: giá trị do máy tự adopt thì adopt lại khi env đổi; giá trị user chọn tay (hoặc không rõ nguồn) thì tuyệt đối không đè |

Nhân tiện bổ sung `sprint_versions` + `get_current_user` vào `redmine.read` — đã direct-UAT PASS từ
`exchanges/2026-08-15.md` và là tool **bắt buộc** để tra target version (task "Tạo ticket cha (Web/Mobile)"
không chạy được nếu thiếu).

**Bài học cho lần sau:** danh sách promote phải khai báo theo *capability*, không theo *tên tool đầy đủ*; và
mọi cơ chế "tự nhận nuôi cấu hình" phải luôn có đường quay lại — nếu không, một lần đoán sai là hỏng vĩnh viễn.

## Ghi chú review (đường C, bước 6 — Dev/Tester/Infra tự đóng trước khi gửi Codex)

- **Dev:** Khả thi — tái dùng nguyên mẫu `candidateIdOf`/`saveClaudeBinCandidate` đã có cho `CLAUDE_BIN`.
  `TOOL_CATALOG` giờ liệt kê cứng theo bảng go-live thật ở §6.4 (không đoán, không đọc env lúc code) — nguồn
  đối chiếu là `docs/operations/automation-ai-go-live-guide.md` (giá trị go-live chính thức) và
  `docs/exchanges/2026-08-15.md` (bằng chứng UAT). `envWriteTools()` ở `claude-runner.ts` cần sửa để gộp
  nguồn `app_settings` mới (post/drive/redmine, bao gồm `copy_file`) VÀ giữ nguyên đọc `CLAUDE_WRITE_TOOLS_OTHER`
  từ env — 2 nguồn khác nhau, đừng gộp nhầm.
- **Tester:** AC-3/AC-5 là 2 ca dễ bỏ sót nhất (nhận nuôi có lọc, và fallback khi khoá chưa từng ghi). Thêm
  AC-3b (chống regression go-live thật cho profile `post`) và AC-7 (deny-list đọc đúng nguồn DB) sau review
  vòng 3 — đây là 2 ca dễ bị bỏ sót nhất nếu chỉ test theo catalog lý thuyết mà không đối chiếu go-live guide
  thật. Cần thêm ca "ghi `toolIds: []`" tường minh vì dễ nhầm với "chưa cấu hình".
- **Infra/Security (theo `security-gate`):** Route mới không mở port/host mới, không nhận input tự do (chỉ
  hash), không lộ giá trị tool trong log lỗi generic, không spawn tiến trình, không auth mới (giữ nguyên
  local-only), không cấu hình được cho `other` (đã chặn ở cả UI/API/DB). Đạt cổng review.

**Đã sửa xong finding review vòng 2 (4), vòng 3 (4), vòng 4 (4) và vòng 5 (1 High)** — vòng 5 là finding an
toàn runtime quan trọng nhất trong cả chuỗi review: `writeToolsFor('post')`/`readToolsFor('post')` hiện cộng
`DEFAULT_POST_*` VÔ ĐIỀU KIỆN, nếu implement không khoá lại thì UI/DB tắt tool vẫn vô nghĩa vì runtime tự
thêm lại. Đã sửa FR-6 + §6.4 + thêm AC-4b/AC-5b để tách rõ 2 nhánh: DB đã ghi (dù rỗng) ⇒ DB là toàn bộ sự
thật; DB chưa từng ghi ⇒ giữ nguyên fallback cũ. Xem tóm tắt tại `docs/exchanges/2026-08-21.md` — đang chờ
Codex review vòng 6 trước khi Leader duyệt sign-off.
