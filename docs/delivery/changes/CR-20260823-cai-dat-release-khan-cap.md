> **SUPERSEDED (2026-09-12):** thiết kế dưới đây giả định vẫn còn AI automation (dispatcher, cờ
> rollout, resolve qua Claude). Sau `CR-20260912-xoa-ai-automation-tai-cau-truc`, `BL-20260823-001`
> đã thu hẹp phạm vi chỉ còn phần MỞ RỘNG chưa xây (mẫu nội dung động, cách thay thế resolve-qua-AI) —
> phần CRUD Team/Người/Group đã chuyển sang CR-20260912. Không dùng CR này nguyên trạng; xem
> `docs/backlog/README.md` mục `BL-20260823-001` để biết phạm vi hiện tại.

# CR-20260823-cai-dat-release-khan-cap — Cài đặt Release khẩn cấp (master Team/Người/DM/Group + template động)

| Trường | Giá trị |
|---|---|
| Loại | ✅ Thêm mới ⬜ Sửa hành vi ⬜ Xóa/Deprecate |
| Mức tác động | ✅ Lớn (đụng DB/nhiều màn/automation) |
| Người đề xuất | Claude + Codex |
| Ngày | 2026-08-23 |
| Backlog item | `BL-20260823-001` (`Picked`, Route C) |
| Trạng thái | ✅ Draft ⬜ Đã review ⬜ Đã duyệt ⬜ Đã triển khai ⬜ Đã nghiệm thu |
| Spec liên quan | [specs/03](../../specs/03-api-business-logic-spec.md), [specs/04](../../specs/04-database-design.md), [rules/07](../../rules/07-rules-backend.md) |

Tách từ `CR-20260822-announcement-release-khan-cap-nhieu-team` theo quyết định Leader
([docs/exchanges/2026-08-21.md §4.90](../../exchanges/2026-08-21.md)) và đề xuất R3
([§4.92](../../exchanges/2026-08-21.md)) — phạm vi đã vượt CR gốc (7 bảng, ~28 route, +1 màn). Toàn bộ pha
thiết kế nằm ở `docs/exchanges/2026-08-21.md`:
[§4.86-§4.89](../../exchanges/2026-08-21.md) (Codex đề xuất mô hình Team/Người/Group),
[§4.90-§4.92](../../exchanges/2026-08-21.md) (Leader chọn phương án A + Claude thiết kế hợp nhất 10 nguyên
tắc P1-P10), [§4.93](../../exchanges/2026-08-21.md) (Codex review — 5 finding HIGH/MEDIUM, đã sửa),
[§4.94](../../exchanges/2026-08-21.md) (Claude tự review — 12 finding, đã sửa),
[§4.95](../../exchanges/2026-08-21.md) (đối chiếu 2 bản review → DDL + cơ chế revision đã sửa cuối cùng),
[§4.96](../../exchanges/2026-08-21.md) (review tầng SA — thứ tự UAT, nhập nhằng "teams", `schemaVersion`),
[§4.97](../../exchanges/2026-08-21.md) (Leader chốt 6 câu cuối), [§4.100-§4.102](../../exchanges/2026-08-21.md)
(Leader mô tả lại luồng tạo task thật qua chat trực tiếp — bổ sung/ghi đè 1 số quyết định trước đó, xem
"Amendment sau §4.97" ở cuối mỗi FR liên quan). CR này chuyển các quyết định đã chốt ở đó thành FR/AC/schema
chính thức, không thiết kế lại từ đầu. Mọi tham chiếu "§4.x" trong CR này trỏ vào file đó.

**Amendment quan trọng sau §4.97 (§4.100-§4.102, đọc trước khi vào FR chi tiết):**
- **FR-12 bản gốc (cơ chế "xác nhận nhóm thread 1 lần, nhớ mãi") ĐÃ RÚT LẠI** — Leader sẽ tự dán URL bài
  đăng thật của từng team ngay ở bước confirm giai đoạn 1, không cần AI tìm/Leader xác nhận nữa. Đây là
  amendment cho **CR-20260822** (đã code), không phải CR-20260823 — xem [§4.102](../../exchanges/2026-08-21.md).
- **FR-2 (audience segmented control) rút từ 3 xuống 2 lựa chọn** — bỏ "chỉ VN_Release" (§4.101 D7), hệ quả
  bắt buộc của việc công thức mention JP đổi thành "y nguyên VN + thêm riêng" ở CR-20260822 (§4.102 Amendment 2).
- **Thêm FR-16/FR-17** cho 2 yêu cầu mới của Leader: dropdown Team/Người ở popup tạo task (thay gõ tự do),
  và dời "Hệ thống ảnh hưởng" + thêm "phạm vi ticket" sang popup chọn ngày giờ (§4.100 D1/D2/D3).

**Thứ tự làm việc bắt buộc (§4.97 Q4):** CR-20260822 (dispatcher/execute-lock/E3) phải được UAT bằng Claude
CLI thật + group Dr.JOY nháp, **dùng ĐÚNG cấu hình JSON cũ hiện có**, TRƯỚC KHI bắt đầu code CR này — để khi
UAT có lỗi thì biết chắc lỗi nằm ở pipeline (CR-822), không lẫn với tầng cấu hình đang thay (CR-823). Đây là
quyết định của Leader sau khi cân nhắc SA-1 ([§4.96](../../exchanges/2026-08-21.md)): "1 buổi UAT thừa" rẻ
hơn nhiều so với gỡ rối 2 lớp thay đổi chồng nhau. Việc UAT thuộc CR-20260822 (lệnh activation `smoke` của
script cũ, đã xoá — xem [go-live guide §10](../../operations/automation-ai-go-live-guide.md)), không phải
việc của CR này — nhưng **code CR-823 không bắt đầu cho tới khi UAT đó PASS** (mục này chỉ còn giá trị
lịch sử, xem banner đầu file).

## 1. Bối cảnh & Vấn đề

CR-20260822 xây xong pipeline tự động đăng Announcement (E6/E7) và tạo ticket dùng chung (E3), nhưng lớp
**cấu hình** cho pipeline đó vẫn là 4 key JSON tự do trong `app_settings`
(`automation_announcement_mentions`, `automation_announcement_member_group`,
`automation_announcement_target_group`, `automation_announcement_group_allowlist`), nhét chung vào tab
"Cài đặt → AI" — nơi vốn dành cho tham số kỹ thuật của Claude, không phải master data nghiệp vụ. Hậu quả cụ
thể Leader đã nêu ([§4.86-§4.89](../../exchanges/2026-08-21.md)):

1. Không quản lý được **Team**/**Người** như danh mục dùng lại nhiều lần — mỗi lần thêm DM phải gõ lại tên
   team dạng tự do, dễ gõ sai/trùng (`Dev5` vs `dev5`).
2. Cùng 1 người (vd vừa là DM vừa là người phía Nhật cố định) không có cách biểu diễn tự nhiên — JSON hiện
   tại buộc chép lại `{id, displayName}` ở nhiều chỗ, không có khái niệm "1 người, nhiều vai trò".
3. Không quản lý GM/người thêm cố định theo **phạm vi xuất hiện** (chỉ VN, chỉ JP, hay cả hai) — hiện `gm`
   là đúng 1 slot mặc định cả hai, `fixedExtra` tách cứng theo locale mà không có UI phân biệt vai trò.
4. Group Dr.JOY (group đăng bài, group tra member) phải nhớ **gõ tay ID** — không có màn tra cứu/xác nhận
   trước khi lưu như đã làm cho mention.
5. Nội dung 4 kiểu bài (VN/JP × 1-team/nhiều-team) đang **hardcode** trong `server/lib/announcement-render.ts`
   — muốn đổi câu chữ/bố cục phải sửa code và phát hành lại bản mới, không có cách Leader tự sửa.

Ba lượt review độc lập ([§4.93](../../exchanges/2026-08-21.md) Codex, [§4.94](../../exchanges/2026-08-21.md)
Claude tự review, [§4.96](../../exchanges/2026-08-21.md) review tầng SA) đã tìm và sửa 17 lỗ hổng thiết kế
trước khi CR này được viết — bao gồm 1 lỗi có thể làm **app không khởi động được** (migration gọi nhầm guard
chống-in-flight của thao tác activation) và 1 cơ chế phát hiện "cấu hình đã đổi" ban đầu **không chạy được**
vì đòi gọi AI thêm một lượt. Bản DDL/cơ chế trong CR này là bản đã sửa cuối cùng.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Leader cấu hình Team/Người/vai trò/Group/4 mẫu nội dung **một lần**, dùng lại cho mọi đợt release khẩn
    cấp — tạo đợt mới không phải nhập lại bất kỳ thứ gì trong danh sách này.
  - Toàn bộ identity (người, group) lưu theo **ID Dr.JOY thật đã resolve**, không lưu tên suông — giữ đúng
    nguyên tắc đã áp dụng cho mention từ CR-20260822 FR-10.
  - `resolveConfiguredMentions(teams, locale)` (`server/lib/announcement-context.ts`) **giữ nguyên chữ ký và
    kiểu trả về** — pipeline dispatcher/execute-lock/verifier của CR-20260822 không phải sửa gì.
  - Đổi cấu hình sau khi 1 task đã được duyệt **không** làm bài đăng sai lệch so với bản đã duyệt (preview
    đã đóng băng), nhưng Leader phải được cảnh báo rõ ràng — **ngay lúc sửa cấu hình**, không phải sau khi
    bài đã đăng xong.
  - Migration của CR này **không được** làm app không khởi động được trong bất kỳ tình huống nào (kể cả khi
    có task đang xử lý dở giữa lúc nâng cấp).
- **Ngoài phạm vi (không làm lần này):**
  - Token động (`{{...}}`) trong khối `staticText` của template — hoãn có chủ đích
    ([§4.93](../../exchanges/2026-08-21.md) trả lời câu hỏi Leader, [§4.92](../../exchanges/2026-08-21.md)
    §F). Thêm sau nếu Leader cần, không phá gì hiện có.
  - Bảng audit ghi lịch sử thay đổi cấu hình — Leader xác nhận **không cần**
    ([§4.97](../../exchanges/2026-08-21.md) Q6). Có thể thêm lại sau nếu phát sinh nhu cầu cụ thể.
  - Xoá 4 key JSON cũ khỏi `app_settings` — giữ lại làm nguồn cho script `export-legacy` (FR-15), gỡ ở một
    lần giao sau khi vận hành ổn định.
  - Token động (`{{...}}`) trong "phạm vi ticket"/"Hệ thống ảnh hưởng" mới (FR-17) — chỉ dropdown/checkbox
    đơn giản, không có ô chữ tự do nào cần thêm ở đây.

  **Cập nhật sau §4.100 (không còn ngoài phạm vi nữa):** đổi cách Leader nhập team lúc tạo đợt release —
  từng ghi nhận là rủi ro liên quan ([§4.92](../../exchanges/2026-08-21.md) R1) và tạm để ngoài phạm vi —
  Leader xác nhận muốn làm luôn trong CR này (D1, xem FR-16).

## 3. Người dùng & Kịch bản

- Là **Leader**, tôi muốn cấu hình 1 lần Team/DM/GM/người thêm cố định/Group Dr.JOY để mỗi đợt release khẩn
  cấp chỉ cần chọn team tham gia, hệ thống tự lắp đủ người cần mention và group cần đăng.
- Là **Leader**, tôi muốn tự sửa câu chữ/bố cục của 4 kiểu bài thông báo qua UI, không cần nhờ sửa code.
- Là **Leader**, khi tôi sửa cấu hình mà đang có task đã duyệt còn chờ tới giờ chạy, tôi muốn được cảnh báo
  ngay lúc lưu — không phải chờ tới sau khi bài đăng xong mới biết.
- Là **Leader**, tôi muốn chọn Team/Người cần mention từ danh sách có sẵn (dropdown) thay vì gõ tự do lúc
  tạo task, để không gõ sai/gõ trùng — dropdown lấy đúng dữ liệu từ màn Cài đặt này (§4.100 D1).

## 4. Yêu cầu chức năng

### Master identity & vai trò (giải quyết §4.86/§4.87/§4.88, nguyên tắc P1-P4)

- **FR-1:** Thêm 3 bảng master **identity thuần** (không chứa vai trò) —
  `emergency_release_teams`, `drjoy_people`, `drjoy_groups`. Mọi cột `active` có `CHECK (active IN (0,1))`
  (Codex §4.93 Finding 3). Team dùng **khoá chuẩn hoá làm PRIMARY KEY** (`code_key`, không phải `code` dạng
  hiển thị) — sửa theo Claude §4.94 F6: nếu PK là `code` (dạng hiển thị), mọi câu join phải tự nhớ normalize,
  và **quên đúng 1 chỗ tái hiện y hệt lỗi Codex đã bắt ở §4.51** của CR-20260822 (validate so
  case-insensitive, resolve so case-sensitive → báo "thiếu DM" oan dù đã cấu hình đúng). Dùng `code_key` làm
  PK khiến việc quên đó **không thể xảy ra**, vì bảng không có khoá dạng hiển thị để mà lỡ join nhầm vào.

  ```sql
  CREATE TABLE emergency_release_teams (
    code_key        TEXT PRIMARY KEY,        -- normalizeAnnouncementTeamKey(code); MỌI FK trỏ vào đây
    code            TEXT NOT NULL,            -- dạng hiển thị 'Dev5' — BẤT BIẾN sau khi tạo, không sửa được
    display_name    TEXT NOT NULL DEFAULT '',
    always_included INTEGER NOT NULL DEFAULT 0 CHECK (always_included IN (0,1)),
    active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

  CREATE TABLE drjoy_people (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    drjoy_member_id TEXT NOT NULL UNIQUE,     -- khoá kỹ thuật thật, KHÔNG phải tên
    display_name    TEXT NOT NULL,
    active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

  CREATE TABLE drjoy_groups (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    drjoy_group_id TEXT NOT NULL UNIQUE,
    display_name   TEXT NOT NULL,
    active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  ```

  `code` (dạng hiển thị) **không sửa được sau khi tạo** — chỉ `display_name` sửa được (Codex §4.93 Finding
  4). Route tạo Team nhận `code` từ Leader, tự tính `code_key = normalizeAnnouncementTeamKey(code)`; nếu đã
  tồn tại `code_key` đó → 409, không tạo bản ghi trùng bằng casing khác.

- **FR-2:** Thêm 3 bảng **gán vai trò**, tách khỏi identity (nguyên tắc P1 — cùng 1 người có thể mang nhiều
  vai trò mà không nhân bản identity). Tất cả có FK thật `ON DELETE RESTRICT` (Codex §4.93 Finding 3 —
  `foreign_keys=ON` đã bật sẵn ở `db.ts:10`, gọi các quan hệ này là "soft ref" là tự bỏ đúng lợi ích DB cho):

  ```sql
  CREATE TABLE emergency_release_team_dms (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    team_code_key TEXT NOT NULL REFERENCES emergency_release_teams(code_key) ON DELETE RESTRICT,
    person_id     INTEGER NOT NULL REFERENCES drjoy_people(id) ON DELETE RESTRICT,
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX ux_team_dm_active ON emergency_release_team_dms(team_code_key) WHERE active = 1;

  -- 'fixed_extra' thay vì tên 'japan_stakeholder' Codex đề xuất ban đầu — cấu hình hiện có `fixedExtra.vi`
  -- (người thêm cố định phía VN) nữa, đặt tên theo quốc tịch sẽ không diễn tả được nửa còn lại.
  CREATE TABLE emergency_release_person_roles (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES drjoy_people(id) ON DELETE RESTRICT,
    role      TEXT NOT NULL CHECK (role IN ('gm','fixed_extra')),
    -- CHỈ 'ja'/'both' — KHÔNG có 'vi' (đã bỏ, xem Amendment sau §4.97 đầu file / §4.102 Amendment 2-3):
    -- công thức mention JP giờ LUÔN = y nguyên danh sách VN + thêm riêng, nên "chỉ hiện ở VN_Release" là
    -- lựa chọn không thể thực thi được (ai cũng lọt sang JP qua nền VN) — Leader xác nhận bỏ hẳn (D7).
    audience  TEXT NOT NULL CHECK (audience IN ('ja','both')),
    active    INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX ux_person_role_active ON emergency_release_person_roles(person_id, role) WHERE active = 1;

  CREATE TABLE emergency_release_group_bindings (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES drjoy_groups(id) ON DELETE RESTRICT,
    binding  TEXT NOT NULL CHECK (binding IN (
               'announcement_target_vi','announcement_target_ja',
               'member_source_vi','member_source_ja','verify_allowed')),
    active   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  -- 4 binding đơn: đúng 1 active mỗi loại (thay `automation_announcement_target_group`/`_member_group`).
  CREATE UNIQUE INDEX ux_group_binding_single_active ON emergency_release_group_bindings(binding)
    WHERE active = 1 AND binding <> 'verify_allowed';
  -- verify_allowed: nhiều group, nhưng KHÔNG được thêm trùng cùng 1 group (Codex §4.93 Finding 3 — bản
  -- trước thiếu ràng buộc này, 1 group có thể bị thêm lặp nhiều lần vào allowlist).
  CREATE UNIQUE INDEX ux_group_binding_verify_active ON emergency_release_group_bindings(group_id)
    WHERE active = 1 AND binding = 'verify_allowed';
  ```

  `audience` nằm trên **assignment vai trò** (`person_roles`), không nằm trên `drjoy_people` — để cùng 1
  người có thể mang nhiều vai trò với phạm vi khác nhau (Codex §4.87, Claude đồng ý). DM không có cột
  `audience` riêng — mặc định mention ở cả 2 bài của đúng team đó, đúng hành vi F1/F2 hiện tại.

  **`audience` chỉ còn 2 giá trị (`ja`/`both`), không còn `vi`** (Amendment sau §4.97, D6/D7 —
  [§4.102](../../exchanges/2026-08-21.md)): CR-20260822 đổi công thức mention JP thành "y nguyên toàn bộ
  danh sách VN đã resolve, cộng thêm người riêng cho JP" (không còn tính độc lập theo audience='ja' như
  trước) — hệ quả là bất kỳ ai lọt vào danh sách VN (`audience='both'` hoặc chỉ là DM/team-member) ĐỀU chắc
  chắn xuất hiện ở JP, nên "chỉ hiện ở VN_Release" là 1 lựa chọn không có tác dụng thật (không loại trừ được
  gì) — Leader xác nhận bỏ hẳn, segmented control UI (§6.1) chỉ còn "Cả hai" (mặc định) / "Chỉ 研究開発部".

  Mọi thao tác "thay DM của 1 team" hoặc "thay group cho 1 binding" (deactivate bản ghi cũ + insert/reactivate
  bản ghi mới) phải chạy trong **đúng 1 `withTransaction()`** (Codex §4.93 Finding 3) — lỗi giữa chừng để
  team/binding không có bản ghi active nào là bug, không phải trạng thái tạm chấp nhận được.

- **FR-3:** Quy tắc **active lan truyền** (giải quyết Codex §4.93 Finding 5 + Claude §4.94 F2/F3 — bản thiết
  kế gốc chỉ lọc `active` ở bảng gán vai trò, không lọc ở bảng identity, nên vô hiệu hoá 1 người/group không
  chặn được việc nó vẫn bị dùng nếu mapping còn `active=1`):
  - Mọi lookup (DM của team, GM/fixed_extra theo audience, group theo binding) đòi **CẢ HAI**:
    `assignment.active=1 AND master.active=1`. Ví dụ SQL cho DM của 1 team:
    ```sql
    SELECT p.drjoy_member_id, p.display_name
    FROM emergency_release_team_dms d JOIN drjoy_people p ON p.id = d.person_id
    WHERE d.team_code_key = ? AND d.active = 1 AND p.active = 1;
    ```
  - Team có mapping DM nhưng người đó đã `active=0` → tính là **"team chưa có DM hợp lệ"**, đưa vào
    `missingTeams` giống hệt trường hợp chưa gán bao giờ — **nhưng** UI/readiness phải phân biệt 2 thông báo
    khác nhau (xem AC-3): *"Team X chưa gán DM"* vs *"Team X có DM là Y nhưng người này đã ngưng dùng"* —
    thông báo thứ hai cứu Leader khỏi ngồi đoán tại sao "đã cấu hình rồi mà vẫn báo thiếu".
  - **Không cho deactivate** team đang `always_included=1` (409, yêu cầu tắt cờ đó trước); **không cho
    deactivate** người/group đang là **assignment active duy nhất** của 1 vai trò bắt buộc (GM — xem FR-9)
    hoặc 1 binding đơn (409, yêu cầu gán người/group thay thế trước).
  - Không cascade deactivate assignment khi deactivate master (Codex §4.93 Finding 5 — chọn giữ lịch sử +
    biểu diễn "không hiệu lực", không tự động dọn mapping).

### Nội dung bài — template động (giải quyết §4.89 #6, nguyên tắc P8)

- **FR-4:** Thêm bảng `announcement_templates`, đúng **4 dòng cố định** (không có route tạo/xoá), khoá ghép
  tự nhiên (Claude §4.94 F11 — tránh phải parse chuỗi `id` để biết locale/pattern):

  ```sql
  CREATE TABLE announcement_templates (
    locale     TEXT NOT NULL CHECK (locale IN ('vi','ja')),
    pattern    TEXT NOT NULL CHECK (pattern IN ('single','multi')),
    blocks     TEXT NOT NULL,   -- JSON: { schemaVersion: 1, blocks: Block[] } — KHÔNG phải mảng trần
    updated_at TEXT NOT NULL,
    PRIMARY KEY (locale, pattern)
  );
  ```

  `blocks` bọc trong `{schemaVersion, blocks}` thay vì mảng trần (SA §4.96 SA-3) — đây là dữ liệu Leader tự
  sửa và lưu lâu dài, tức loại dữ liệu **dễ sống lâu hơn code**. Không có version thì không trả lời được
  "bản sau đổi tên/bỏ 1 `DataBlockType`, template Leader đã lưu chứa type cũ thì đọc lên ra gì?".

  ```ts
  type Block =
    | { type: DataBlockType; label: string; hidden: boolean }   // code render nội dung
    | { type: 'staticText'; text: string; hidden: boolean };    // Leader gõ, plain text, escape khi ra HTML

  type DataBlockType =
    | 'emergencyTicket' | 'teamList' | 'releaseTickets'
    | 'relateTickets'   | 'threads'  | 'fileSchedule' | 'impactScope';
  ```

  - Leader đổi được: **thứ tự** block, **`label`** của block dữ liệu (≤`MAX_LABEL_LEN=100` ký tự, cấm
    `<`/`>` — dùng lại hằng số đã có ở `automation-config.ts`), **ẩn/hiện**, và **thêm/sửa/xoá block
    `staticText`** (≤500 ký tự/block, tối đa 30 block/template).
  - Leader **KHÔNG** đổi được cách 1 block dữ liệu đổ dữ liệu bên trong (link Redmine, gom nhóm theo
    platform, lặp theo team) — phần đó 100% vẫn trong `announcement-render.ts`, chỉ tách hàm hiện tại
    (`renderAnnouncementVi`/`Ja`) thành từng `buildXxxBlock()` rồi lặp qua `blocks.filter(b => !b.hidden)`,
    **không viết lại công thức**.
  - `staticText` xuống dòng theo ĐÚNG quy ước `renderLines`/`noteToQuillHtml` đã có (dòng có chữ → `<p>`,
    dòng trống → `<br>`, chuẩn hoá `\r\n`/`\r` → `\n` trước khi tách); escape qua đúng `escapeHtml()` sẵn có
    trong `announcement-render.ts` — không viết hàm escape mới.
  - `emergencyTicket` và `impactScope` **bắt buộc phải hiện**, không cho `hidden:true` (Codex §4.93 xác nhận
    — 2 thông tin cốt lõi của mọi bài khẩn cấp).
  - Bản JA chỉ chấp nhận tập con `emergencyTicket | releaseTickets | impactScope | staticText` — đúng FR-8
    của CR-20260822 (JP không có phần relate ticket/thread/file schedule).
  - Đọc template gặp `schemaVersion` cao hơn code hỗ trợ hoặc `type` lạ → **KHÔNG** âm thầm bỏ qua block đó
    (âm thầm đổi nội dung bài đăng thật là điều tệ nhất có thể xảy ra) — precheck trả `blocked` với reason
    rõ ràng, màn Cài đặt hiện nút "Khôi phục mặc định" cho đúng template đó.
  - Migration seed 4 dòng = **đúng layout đang code cứng hôm nay** (không đổi hành vi mặc định ngày đầu).

- **FR-5:** `pattern` (`single`/`multi`) của bài phải tính theo **đúng 1 định nghĩa "teams" tường minh**,
  đặt tên phân biệt để không thể nhầm. **Sửa lại sau khi Leader chỉ ra bản đầu tự dựng 1 tình huống không
  thể xảy ra** (Leader hỏi trực tiếp trên UI thật: "team tham gia đợt" đã gõ sẵn ở popup tạo đợt thì dùng
  ngay để chọn pattern có được không, hay bắt buộc phải chờ AI tra Redmine?). Kiểm lại code
  (`announcement-facts.ts:190-213`, `requireFullCoverage=true` lúc facts vào trạng thái `ready`) xác nhận:
  **mọi team đã khai ở batch PHẢI có đúng 1 ticket khớp, thiếu team nào thì CẢ facts bị `blocked`** (INV-1) —
  không có đường nào để 1 team đã khai "âm thầm biến mất" khỏi `releaseTickets` rồi hệ thống tự hạ xuống ít
  team hơn. Vì vậy **chỉ cần 2 khái niệm, không phải 3**:

  | Tên trong code | Là gì | Ví dụ |
  |---|---|---|
  | `batchTeams` | Team Leader khai lúc tạo đợt (`emergency_release_batches.teams`) — **luôn bằng đúng tập team có ticket** khi facts đạt trạng thái `ready` (INV-1 ép buộc, không phải trùng hợp) | Dev5, Dev12 |
  | `mentionTeams` | `batchTeams` ∪ team đang `always_included` — **chỉ dùng để tìm người mention**, KHÔNG cần có ticket (không đi qua validate INV-1/INV-3 của facts) | + Dev13 |

  `pattern = batchTeams.length > 1 ? 'multi' : 'single'` — tính được **NGAY lúc Leader khai đợt** (đúng ô
  "Team tham gia đợt này" trên popup), không cần chờ AI tra xong Redmine. AI vẫn phải tra Redmine như CR-
  20260822 đã xây (FR-4/FR-5 của CR đó) — nhưng việc đó để lấy **đúng số ticket/tiêu đề thật** cho từng team
  đã khai (chống AI tự bịa số), KHÔNG phải để quyết định pattern. Nếu 1 team đã khai mà AI không tìm ra
  ticket khớp → cả bài `blocked` (Leader phải xử lý: sửa lại danh sách team, hoặc tạo ticket cho team đó) —
  không có nhánh "tự động loại team đó rồi hạ xuống mẫu ít team hơn".

  **Không** dùng `mentionTeams` để tính pattern — `always_included` (vd Dev13, chỉ để CC/mention, không tham
  gia release) sẽ khiến MỌI đợt luôn thành "nhiều team" nếu dùng nhầm, mẫu 1-team không bao giờ được chọn.
  Cấm dùng biến trần tên `teams` trong vùng code quyết định `pattern`/chọn template — luôn dùng 1 trong 2 tên
  trên.

### Giữ nguyên hợp đồng runtime + phát hiện cấu hình lệch (nguyên tắc P5, giải quyết §4.95 §2, §4.97 §2)

- **FR-6:** `resolveConfiguredMentions(teams, locale)` (`server/lib/announcement-context.ts:68`) **giữ
  nguyên chữ ký và kiểu trả về** (`{ready:true, mentions}` | `{ready:false, missingTeams}`) — chỉ đổi phần
  thân hàm từ đọc JSON sang đọc bảng mới. Công thức mới:

  ```
  allTeams (= mentionTeams) = batchTeams ∪ { t.code : t.active AND t.always_included }
  missing  = { t ∈ allTeams : không có DM hợp lệ cho normalize(t) }         -- FR-3, fail-closed giữ nguyên
  mentions = { người active có role active, audience ∈ {locale,'both'} }   -- gộp gm + fixed_extra
           ∪ { DM hợp lệ của từng team ∈ allTeams }
           ∪ (giữ nguyên) thành viên team đọc qua group binding member_source_<locale>
           ∪ (giữ nguyên) jpVariableMentions từ post nguồn
  dedupe theo drjoy_member_id, GIỮ LẦN XUẤT HIỆN ĐẦU TIÊN (không phải lần cuối — xem FR-7)
  ```

  Vì hợp đồng không đổi, **~37/57 test hiện có của CR-20260822 chỉ cần đổi 1 dòng dựng fixture** (seed bảng
  thay vì gọi `setAnnouncementMentionConfig`), không phải viết lại assertion — xem §9.

- **FR-7:** Thứ tự phần tử trong `mentions`/`preview.mentions` phải **tất định** (SA §4.94 F7 — cùng lớp lỗi
  Codex đã bắt ở §4.56 #9 cho renderer: "cùng bộ dữ liệu, thứ tự khác nhau giữa 2 lần chạy" là không xứng
  "canonical"). Với nhiều GM/fixed_extra (mô hình mới cho phép nhiều, khác hiện tại chỉ 1 GM), thứ tự DB trả
  về không tất định nếu không `ORDER BY` tường minh:
  1. GM — `ORDER BY display_name, drjoy_member_id`.
  2. DM theo **đúng thứ tự `batchTeams` Leader khai** (không phải thứ tự trong bảng), rồi tới team
     `always_included` theo `ORDER BY sort_order, code_key`.
  3. `fixed_extra` khớp audience — `ORDER BY display_name, drjoy_member_id`.
  4. Thành viên team (AI đọc) — giữ nguyên thứ tự AI trả về.
  5. `jpVariableMentions` — giữ nguyên.

  Dedupe theo `drjoy_member_id` giữ **lần xuất hiện đầu tiên** (đổi từ hành vi hiện tại — `Map.set()` giữ
  lần cuối) để vai trò ưu tiên cao hơn (GM) luôn đứng trước trong danh sách hiển thị cho người duyệt đọc.
  Write-guard so `to_user_office_user_ids` bằng set-equality nên **không** bị ảnh hưởng bởi thay đổi thứ tự
  này — chỉ `preview.mentions` (hiển thị) mới cần tất định.

- **FR-8:** Phát hiện "cấu hình đã đổi sau khi duyệt" bằng **3 revision tách biệt**, KHÔNG gộp thành 1 hash
  chung (sửa theo Codex §4.93 Finding 1 — "hash chung chỉ biết CÓ gì đổi, không biết PHẦN NÀO đổi", cần để
  áp đúng chính sách chặn/cảnh báo khác nhau theo phần; và Claude §4.95 §2 — cách tính lại phải **thuần DB**,
  không được đọc `mentionIds` đã resolve, vì resolve toàn bộ member team đòi **gọi AI** qua
  `resolveAllTeamMembers()` (`server/routes/automation.ts:1065-1150`) — tính lại lúc execute bằng cách gọi AI
  thêm 1 lượt vừa đắt/chậm vừa **không tất định**, sẽ bắn cảnh báo giả liên tục):

  | Revision | Cách tính | Chi phí | So với |
  |---|---|---|---|
  | Group đích | **Không hash** — so thẳng `preview.groupId` với `drjoy_group_id` của binding `announcement_target_<locale>` đang active | 1 SELECT | Group đích lúc execute |
  | `mentionConfigRevision` | `sha256(canonicalJson({ personRoles: [{memberId,role,audience}…] sort theo (memberId,role), teamDms: [{teamCodeKey,memberId}…] sort theo teamCodeKey }))` — hash **ĐẦU VÀO cấu hình** đọc thuần từ DB, KHÔNG hash `mentionIds` đầu ra | ~1ms, thuần DB, tất định | `mentionConfigRevision` đã lưu trong preview |
  | `templateRevision` | `sha256(canonicalJson(blocks))` — **giữ nguyên thứ tự** block (thứ tự là một phần nội dung, không phải khoá sort) | ~1ms | `templateRevision` đã lưu trong preview |

  `canonicalJson` = JSON có **tên trường tường minh** (chống canonicalization mơ hồ — Codex §4.93 Finding 1),
  mảng có phần tử sort theo khoá ổn định như ghi ở cột "Cách tính".

  **Giới hạn phải ghi rõ, không giấu:** cơ chế này phát hiện *cấu hình trong app đổi*, **KHÔNG** phát hiện
  *thành viên team đổi phía Dr.JOY* (ai vào/rời group thật sau khi đã duyệt) — muốn biết cái sau bắt buộc
  phải gọi AI lại, đúng thứ vừa loại bỏ vì lý do chi phí/tất định. Đây là ranh giới có chủ đích.

- **FR-9:** Chính sách khi cấu hình đổi **sau khi task đã duyệt** (chốt theo mức tối thiểu của Codex §4.93 +
  xác nhận của Leader §4.97 Q1, khả thi được nhờ 3 revision tách biệt ở FR-8):
  - **Group đích đổi** (so bằng SELECT trực tiếp) → **CHẶN** lúc execute (409, buộc preview lại). Đăng nhầm
    CHỖ không hoàn tác sạch được (bài học BUG-005); group hầu như không bao giờ đổi giữa lúc duyệt và lúc
    chạy nên chặn gần như không tốn gì trong thực tế.
  - **Có người bị GỠ khỏi mention** (so `mentionConfigRevision`: nếu 1 `drjoy_member_id` từng có trong tập
    đã hash lúc duyệt mà giờ không còn trong tập tính lại) → **CHẶN**, buộc preview lại. Mất 1 người khỏi
    danh sách tag là mất thông tin thật, không phải thẩm mỹ.
  - **Chỉ THÊM người mới, hoặc template đổi** → **CẢNH BÁO**, vẫn đăng đúng bản đã duyệt. Release khẩn cấp
    là việc gấp; nội dung vẫn đúng cái người duyệt đã đọc và chấp nhận.
  - `GM` là vai trò **bắt buộc phải có ≥1 người active** (Codex §4.93 xác nhận, đổi hành vi so với hiện tại —
    `add(config.gm)` hiện bỏ qua `null` mà không báo lỗi). Readiness/precheck phải chặn nếu không có GM active
    nào — xem FR-11.
  - Cảnh báo ghi vào field kiểu riêng trong `ResultSnapshot`
    (`configDriftWarnings?: {kind:'mentions'|'template'; detail:string}[]`) — **không** dùng
    `automation_error` (Codex §4.93 Finding 1: field đó điều khiển hiển thị lỗi trên UI, nhét cảnh báo vào
    đó biến 1 lần đăng thành công thành "trạng thái lỗi giả"). UI hiện dạng thông tin, không đổi `status`.

- **FR-10:** Cảnh báo **CHỦ ĐỘNG lúc Leader sửa cấu hình**, không chỉ cảnh báo bị động sau khi bài đã đăng
  (yêu cầu mới từ Leader, §4.97 §2 — bản thiết kế trước chỉ cảnh báo SAU execute, lúc đó đã trễ để cân nhắc
  dừng lại). Mọi endpoint PATCH/PUT sửa mention/group-binding/template phải, TRƯỚC KHI ghi, kiểm tra có task
  nào `automation_status='approved'` với `automation_contract` khớp locale bị ảnh hưởng chưa tới giờ chạy
  hay không; nếu có, response vẫn `200 {ok:true}` (không chặn việc lưu) nhưng kèm:

  ```ts
  { ok: true, warnings: [{
    taskId, taskTitle, scheduledAt,
    message: 'Task này đã duyệt, dùng cấu hình ĐÃ ĐÓNG BĂNG lúc duyệt — thay đổi vừa lưu KHÔNG áp dụng cho nó.'
  }] }
  ```

  UI hiện banner vàng ngay sau khi lưu thành công. Dùng lại đúng việc so `mentionConfigRevision`/
  `templateRevision`/group đích của FR-8 để biết task nào bị ảnh hưởng — không phải cơ chế tính mới, chỉ
  gọi SỚM HƠN (lúc lưu cấu hình) thay vì CHỈ lúc execute.

### Một cửa validate + readiness (nguyên tắc P6, giải quyết Codex §4.93 Finding 5)

- **FR-11:** Thêm hàm lõi thuần `checkConfig(snapshot, scope)` (SA §4.96 SA-6 — tách lõi test-được-không-cần-
  DB/HTTP khỏi 2 nơi gọi nó, tránh chữ ký mập mờ nếu nhét cả 2 chế độ vào 1 hàm có tham số tuỳ chọn):

  ```ts
  type Scope = 'overview' | { locale: 'vi'|'ja'; batchTeams: string[] };
  function checkConfig(snapshot: ConfigSnapshot, scope: Scope): Gap[];
  // Gap = { code, message, howToFix, anchor }  -- `anchor` để UI cuộn thẳng tới khối cần sửa
  ```

  Hai adapter mỏng gọi lõi này:
  - `GET /readiness` (không tham số) → `scope:'overview'` — tình trạng **tổng quan** cho đầu màn Cài đặt:
    có GM active chưa, team nào chưa có DM hợp lệ, binding nào trống, template nào lỗi `schemaVersion`.
    Khi mọi thứ còn rỗng (máy mới, chưa migrate xong lần đầu), đây **là checklist khởi tạo lần đầu**, không
    chỉ bảng chẩn đoán lỗi (SA §4.96 SA-7) — UI nên trình bày dạng "còn N bước để dùng được", không phải N
    dòng lỗi đỏ, dù dữ liệu nền là một.
  - `GET /readiness?locale=&teams=` → `scope:{locale, batchTeams}` — kiểm cho **1 đợt cụ thể**, gọi
    ĐÚNG hàm này thay vì tự viết lại logic riêng.
  - **Gỡ 4 chỗ kiểm tra rời rạc hiện có** trong `server/routes/automation.ts` để P6 thật sự "một cửa", không
    còn 2 nguồn kiểm tra song song (Claude §4.94 F8 — liệt kê chính xác, giữ nguyên `code` cũ để không phá
    thông báo/test hiện có):

    | Vị trí hiện tại | `code` | Hành động |
    |---|---|---|
    | `runAnnouncementDispatch` (dòng ~1317-1326) | `ANNOUNCEMENT_MENTIONS_NOT_CONFIGURED` | Thay bằng gọi `checkConfig` |
    | `finalizeReadyAnnouncementFacts` (dòng ~1160-1169, lặp lại gate trên) | (như trên) | Xoá — đã có gate sớm |
    | `finalizeReadyAnnouncementFacts` (dòng ~1174-1182) | `ANNOUNCEMENT_MEMBER_GROUP_NOT_CONFIGURED` | Gộp vào `checkConfig` |
    | `finalizeReadyAnnouncementFacts` (dòng ~1187-1196) | `ANNOUNCEMENT_TARGET_GROUP_NOT_CONFIGURED` | Gộp vào `checkConfig` |

### FR-12 — RÚT LẠI (Amendment sau §4.97, xem [§4.100](../../exchanges/2026-08-21.md) D5 /
[§4.102](../../exchanges/2026-08-21.md) Amendment 1)

Cơ chế "xác nhận 1 lần khi thấy thật, nhớ mãi cho lần sau" cho `threads[].groupId` mô tả ở bản trước **không
còn cần thiết**: Leader sẽ **tự tay dán URL bài đăng thật của từng team** ngay ở bước "Confirm thông tin với
các team" (giai đoạn 1 tạo task), thay vì để AI tự tìm rồi Leader xác nhận lại. App tách URL bằng hàm có sẵn
`parseDrjoyUrl()` (`server/routes/automation.ts:233`) — không còn gì để AI "tự tìm" nên không còn gì cần
"xác nhận lại" nữa. Đây là amendment cho **CR-20260822** (facts pipeline đã code), không phải việc của
CR-20260823 — xem chi tiết cơ chế mới ở CR-20260822 (mục Amendment sau §4.97). Bảng
`emergency_release_team_thread_groups` và route `/team-thread-groups` **KHÔNG còn trong phạm vi CR này nữa**
— đã gỡ khỏi FR-13/§6.3/§7/§9.

### API & migration

- **FR-13:** Bề mặt API dưới prefix mới `/api/emergency-release/settings/*` (không nhét vào
  `/api/automation/settings/*` — đây là master data nghiệp vụ, không phải tham số kỹ thuật AI, đúng lập luận
  Codex §4.86):

  | Nhóm | Route |
  |---|---|
  | Team | `GET /teams` · `POST /teams` · `PATCH /teams/:codeKey` · `POST /teams/:codeKey/deactivate` (+`/reactivate`) |
  | Người | `GET /people` · `POST /people` (bắt buộc đã resolve) · `PATCH /people/:id` · `POST /people/:id/deactivate` |
  | Vai trò người | `GET /person-roles` · `POST /person-roles` · `PATCH /person-roles/:id` · `POST /person-roles/:id/deactivate` |
  | Team–DM | `GET /team-dms` · `PUT /team-dms/:teamCodeKey` (đặt/thay DM active, 1 transaction) · `DELETE /team-dms/:teamCodeKey` |
  | Group | `GET /groups` · `POST /groups` · `PATCH /groups/:id` · `POST /groups/:id/deactivate` |
  | Binding group | `GET /group-bindings` · `PUT /group-bindings/:binding` (4 binding đơn) · `POST`/`DELETE /group-bindings/verify-allowed/:groupId` |
  | Template | `GET /templates` · `PATCH /templates/:locale/:pattern` (kèm cảnh báo FR-10) · `POST /templates/:locale/:pattern/preview` · `POST /templates/:locale/:pattern/reset` |
  | Tình trạng | `GET /readiness` (tổng quan) · `GET /readiness?locale=&teams=` (theo đợt) — FR-11 |
  | Popup tạo task (D1/D2/D3) | `GET /team-options` · `GET /people-options` (nguồn dropdown, FR-16) |

  Resolve người/group **dùng lại nguyên 2 route đã có** ở CR-20260822
  (`POST /automation/settings/announcement-mentions/resolve`,
  `POST /automation/settings/announcement-groups/resolve`) — không nhân bản route resolve mới. Mọi route
  PATCH/PUT sửa mention/group-binding/template phải trả `warnings[]` theo FR-10.

- **FR-14:** Migration schema + seed **thuần**, idempotent, chạy trong transaction, an toàn tự chạy lúc mở
  app — **KHÔNG được gọi bất kỳ guard nào kiểu "không có task in-flight"** (sửa lỗi HIGH của Codex §4.93
  Finding 2: `server/db.ts` chạy migration **lúc mở app**; nếu migration gọi
  `assertNoInFlightAnnouncementOrTicketTasks()` — cơ chế activation có chủ đích của CR-20260822 — và nó ném
  lỗi vì phát hiện task đang xử lý dở, app sẽ **không mở được**; app không mở thì chính task đó cũng không
  ai xử lý được để gỡ blocker → tắc vĩnh viễn, không có đường ra). Guard đó **chỉ** dùng ở thao tác
  activation/switch-over do người chủ động chạy (đúng cách CR-20260822 đang dùng), tuyệt đối không dùng làm
  điều kiện khởi động app.

  Migration seed:
  1. Team từ hợp của `DISTINCT` team trong `emergency_release_batches.teams` (JSON array trong cột TEXT →
     gom bằng JS, không bằng SQL — SQLite không có `json_each` bật sẵn ở mọi build) ∪ `teamDm[].team` ∪
     `alwaysTeam` — không đợt cũ nào trở thành "team lạ". `always_included=1` cho đúng team bằng
     `alwaysTeam` cũ (cardinality mở rộng từ "đúng 1 team" thành "nhiều team được", nhưng ngày đầu hành vi
     không đổi — SA §4.96 F9).
  2. `drjoy_people` từ `gm` ∪ `teamDm[].dm` ∪ `fixedExtra.vi` ∪ `fixedExtra.ja`, khoá theo `drjoy_member_id`
     (cùng người ở nhiều chỗ → 1 dòng duy nhất).
  3. `team_dms` từ `teamDm[]`; `person_roles`: `gm` → role `gm` audience `both`; người có mặt CẢ
     `fixedExtra.vi` và `.ja` → 1 assignment `fixed_extra` audience `both` (không phải 2 dòng).
  4. `drjoy_groups` + bindings từ 3 key group JSON.
  5. 4 `announcement_templates` = layout code cứng hôm nay, `schemaVersion:1`.
  6. **Không xoá** 4 key JSON cũ — giữ làm nguồn cho FR-15; code ngừng đọc chúng ngay (P9, không dual-write).

  **AC bắt buộc chứng minh migration không cần backfill dữ liệu runtime:** 1 task đã `approved` TRƯỚC
  migration (preview đã đóng băng `mentionIds`/`groupId`/`content`) vẫn `execute` đúng SAU migration mà
  KHÔNG cần đọc bảng master mới — vì mọi thứ cần cho execute đã nằm sẵn trong preview.

  Backup DB (`npm run backup-db`) là **bước vận hành trước khi thay binary/nâng cấp**, ghi ở operations
  guide — không phải điều kiện migration tự bảo đảm được (Codex §4.93 Finding 2: code chạy lúc mở app không
  thể tự đòi người vận hành đã backup trước đó).

- **FR-15:** Đường lùi (rollback) — script một chiều `emergency-config:export-legacy` (Claude §4.94 F4: bản
  thiết kế trước nói "giữ JSON cũ làm backup" nhưng không có cách đồng bộ lại nếu Leader đã sửa cấu hình qua
  UI mới rồi cần hạ cấp code — JSON cũ lúc đó đã cũ, mọi chỉnh sửa từ lúc migration sẽ mất sạch nếu chỉ đơn
  thuần revert code). Script đọc bảng mới, dựng lại đúng 4 key JSON theo shape cũ
  (`AnnouncementMentionConfig`, 2 group config theo locale, allowlist), ghi đè `app_settings`. Quy trình
  rollback: `npm run backup-db` → chạy script rollback `emergency-config:export-legacy` (thêm vào
  `package.json` khi code FR-15 xong — **chưa tồn tại ở bản Draft này**) → revert code → code đọc JSON đã
  đồng bộ lại từ nguồn mới nhất. Script **phải in cảnh báo liệt kê rõ** dữ liệu bị mất khi ép về dạng cũ
  (nhiều GM → 1 GM, `audience` riêng từng vai trò → mất, nhiều team `always_included` → giữ 1) — không được
  im lặng.

### Popup tạo task — dropdown + dời trường (giải quyết §4.100 D1/D2/D3)

- **FR-16:** Popup "Tạo task giai đoạn 1" (`src/screens/release.tsx`, form tạo task `immediate`) đổi 2 ô
  "Team tham gia đợt này"/"Người cần mention" từ **input gõ tự do** sang **dropdown đa chọn**, nguồn dữ liệu
  lấy TRỰC TIẾP từ 2 bảng master của FR-1 (`emergency_release_teams`, `drjoy_people`) qua 2 route mới
  `GET /team-options`/`GET /people-options` (chỉ trả `active=1`, xem FR-13). Đây là lý do Leader muốn làm
  ngay trong CR này thay vì hoãn (§4.100): dropdown không có gì để chọn nếu master data chưa tồn tại — 2 tính
  năng phải đi cùng nhau.
  - Giá trị lưu xuống `emergency_release_batches.teams` vẫn là `code` hiển thị (không đổi kiểu cột, không
    đổi hợp đồng đọc của CR-20260822) — chỉ đổi CÁCH Leader chọn ra giá trị đó, không đổi shape lưu trữ.
  - Submit với 1 `code`/`memberId` không còn tồn tại/đã deactivate (do đổi ở tab Settings khác cùng lúc
    popup đang mở) → 400 rõ ràng, không tạo task với dữ liệu tham chiếu tới bản ghi đã chết.
  - Không thêm token động/ô nhập tự do nào ở đây — đúng "Ngoài phạm vi" đã ghi ở §2.

- **FR-17:** Dời trường **"Hệ thống ảnh hưởng"** (`systems`, hiện bắt buộc ngay ở bước tạo task giai đoạn 1 —
  `server/routes/schedules.ts:496-497`) sang popup **"Chọn ngày giờ"** (bước nộp lịch, giai đoạn 2) — đúng
  thời điểm Leader thực sự biết đủ thông tin để điền (§4.100 D2). Nới điều kiện bắt buộc ở bước 1: chỉ còn
  chặn thiếu `teams`, không còn chặn thiếu `systems`. Thêm **trường mới** "Phạm vi ticket cần tạo" —
  `web`/`mobile`/`both` — cũng ở popup giai đoạn 2, bắt buộc, thay cho cơ chế hiện tại là AI tự hỏi qua Q&A
  lúc precheck E3 (`docs/ai-prompts/release/emergency-release.md`) — chuyển từ hỏi-bằng-AI sang khai-trước-
  bằng-UI, giảm phụ thuộc vào AI trả lời đúng ý định Leader.
  - Chọn `both` → tạo **2 instance task riêng** cho định nghĩa "Tạo ticket Release khẩn cấp" (E3), 1 gắn
    `platform:'web'`, 1 gắn `platform:'mobile'` — vì Redmine chỉ nhận 1 platform/ticket, không có lựa chọn
    "cả hai" trên chính Redmine (§4.101 D3, đã hỏi và Leader xác nhận trực tiếp). Chọn `web`/`mobile` đơn →
    vẫn 1 instance như hành vi hiện tại.
  - AI không còn cần hỏi platform trong prompt precheck E3 — giá trị đã có sẵn trên task, prompt đọc thẳng.
  - **Không thuộc FR này nhưng ghi chú vì cùng nguồn quyết định (§4.100 D4):** 3 định nghĩa task thật "Tạo
    ticket Release khẩn cấp" (E3), "Announcement - VN_Release" (E6), "Announcement - 研究開発部" (E7) sẽ được
    Leader tự đổi mốc thời gian từ `immediate`/`release_deploy` sang **`after_schedule`** qua UI hiện có
    (`emergencyStageOrder`, `src/screens/release.tsx`) — đây là 1 thao tác **cấu hình dữ liệu**, không phải
    thay đổi code, nên không cần FR/AC riêng; ghi ở §10 Kế hoạch triển khai để không quên khi go-live.

## 5. Yêu cầu phi chức năng

- Migration KHÔNG được làm app chậm khởi động đáng kể hay chặn boot vì lý do nghiệp vụ (FR-14) — đây là yêu
  cầu cứng, không phải "nên tránh".
- Mọi bảng mới tuân thủ pattern hiện có: `created_at`/`updated_at` ISO string, `active` là cột chuẩn hoá
  (không dùng NULL để biểu diễn "chưa quyết" ở các bảng này — khác với `automation_ai_enabled` cố ý cho phép
  vắng mặt).
- Không thêm phân quyền/role người dùng cho CRUD — app local, không auth (specs/03 §0); thêm "quyền" giả sẽ
  tạo cảm giác an toàn sai.
- `MAX_STATIC_TEXT_LEN=500`, `MAX_BLOCKS=30`, `MAX_LABEL_LEN=100` (dùng lại hằng số đã có) — cùng tinh thần
  các giới hạn payload đã áp cho `automation_announcement_mentions` (`MAX_TEAM_DM_ROWS`,
  `MAX_FIXED_EXTRA_ENTRIES`).

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI

Tab mới **"Release khẩn cấp"** trong màn Settings (`ManHinhQuanLyDanhMuc`, `src/main.tsx:1094` — hiện có
`pic | category | redmine | ai | phim_tat`), tách hẳn khỏi tab AI. Các khối trong tab, theo đúng thứ tự
Leader sẽ thao tác:

1. **Tình trạng cấu hình** (trên cùng) — gọi `GET /readiness` (chế độ tổng quan, FR-11), liệt kê đúng thứ
   còn thiếu kèm link nhảy tới khối tương ứng (`anchor`). Khi mọi thứ còn rỗng, trình bày dạng "còn N bước
   để dùng được" (SA §4.96 SA-7), không phải N dòng lỗi đỏ.
2. **Team** — bảng CRUD: `Mã` (khoá, không sửa sau khi tạo), `Tên hiển thị`, `Luôn có mặt` (toggle
   `always_included`), `Đang dùng` (toggle active, chặn nếu đang là DM duy nhất/mandatory role active).
3. **Người & vai trò** — danh sách người đã resolve ID thật (dùng lại `ONhapNguoiCanResolve` pattern từ
   `announcement-mention-settings.tsx`); mỗi người có chip vai trò `GM` / `Người thêm cố định`, mỗi vai trò
   kèm **segmented control 2 lựa chọn** `Cả hai | Chỉ 研究開発部` (Codex §4.87 — radio/segmented, KHÔNG phải
   checkbox, vì 2 giá trị loại trừ nhau; rút từ 3 xuống 2 theo Amendment sau §4.97 D6/D7 — xem đầu file/FR-2).
4. **Mapping Team ↔ DM** — mỗi team đúng 1 dòng, chọn người từ master (không gõ tên tự do).
5. **Group Dr.JOY** — bảng group đã resolve + gán vai trò (dùng lại `ONhapGroupCanResolve` pattern từ
   `announcement-group-settings.tsx`); nút "Đồng bộ lại tên" (giữ ID, cập nhật `display_name`).
6. **Nội dung bài (4 mẫu)** — 4 thẻ (VI×1-team, VI×multi-team, JA×1-team, JA×multi-team), mỗi thẻ: danh
   sách block kéo-thả sắp xếp + input nhãn + toggle ẩn/hiện + thêm/sửa/xoá `staticText` + nút xem trước
   (gọi `POST /templates/:locale/:pattern/preview`, render bằng ĐÚNG hàm execute dùng trên fixture cố định —
   giữ bất biến "preview thấy sao, đăng vậy") + nút "Khôi phục mặc định".

Hai component cũ (`CauHinhMentionAnnouncement`, `CauHinhGroupAnnouncement`) **gỡ khỏi tab AI** sau khi
migration chạy — không để 2 UI cùng ghi 2 nguồn (P9). Banner cảnh báo FR-10 hiện ngay dưới nút Lưu của mọi
khối 3-6 khi API trả `warnings[]`.

**Popup tạo task giai đoạn 1 và giai đoạn 2 (D1/D2/D3, xem FR-16/FR-17)** — không thuộc tab Settings này,
nhưng lấy dữ liệu TỪ đây:
8. **Popup giai đoạn 1 ("Tạo task giai đoạn 1")** — 2 ô "Team tham gia đợt này"/"Người cần mention" đổi từ
   input tự do thành **dropdown đa chọn**, nguồn `GET /team-options`/`GET /people-options` (chỉ liệt kê
   `active=1`). Thêm ô dán **URL bài đăng thật của từng team** (Amendment CR-20260822 §4.102 Amendment 1 —
   không thuộc CR này, chỉ nêu ở đây vì cùng popup).
9. **Popup giai đoạn 2 ("Chọn ngày giờ")** — thêm 2 ô mới **sau khi** đã có ở đây: "Hệ thống ảnh hưởng" (dời
   từ popup giai đoạn 1 sang, D2) và "Phạm vi ticket cần tạo" — `Web`/`Mobile`/`Cả hai` (mới, D3).

### 6.2. API & nghiệp vụ

Xem bảng route đầy đủ ở FR-13. Mọi route CRUD theo đúng convention lỗi hiện có của
`server/routes/release.ts` (`res.status(400/404/409).json({message})`, không dùng `HttpError` — file này
chưa từng dùng `HttpError`, giữ nhất quán với style file). Route `GET /readiness` và 2 route resolve dùng lại
là ngoại lệ — đặt trong `server/routes/automation.ts` (đã có sẵn 2 route resolve ở đó) hoặc file mới
`server/routes/emergency-release-settings.ts` tuỳ theo Codex góp ý lúc review code.

### 6.3. Dữ liệu & schema

7 bảng mới, đầy đủ FK/CHECK/UNIQUE index — xem DDL tại FR-1 (identity, 3 bảng), FR-2 (vai trò, 3 bảng), FR-4
(template, 1 bảng).
Không sửa bảng nào đang có của CR-20260822 (`tasks`, `emergency_release_batches`,
`emergency_release_task_definitions`) — hoàn toàn cộng thêm, không migrate cột cũ.

### 6.4. Automation / tích hợp

Không đụng gì tới cơ chế spawn Claude/execute-lock/write-guard của CR-20260822 — chỉ đổi NGUỒN dữ liệu mà
`resolveConfiguredMentions()`/`getAnnouncementTargetGroupConfig()`-tương-đương đọc từ. `security-gate` không
áp thêm gì mới ở CR này (không có endpoint spawn AI mới, không có serve file mới) — các route resolve người/
group vẫn dùng đúng cơ chế `runClaude(mode:'read')` đã có, không phải route mới.

## 7. Phân tích tác động

- [x] Frontend (màn/component) · [x] API route · [x] DB/migration · [ ] Automation/MCP
- [x] i18n (chuỗi mới — `src/i18n.ts`, toàn bộ tab mới) · [ ] Đóng gói SEA/MCP · [ ] Bảo mật · [x] Dữ liệu cũ/backward-compat (FR-14/FR-15)
- **Rủi ro & giảm thiểu:**
  - Migration sai gây mất cấu hình đang chạy → giảm thiểu bằng FR-14 (idempotent, không xoá JSON cũ ngay,
    AC chứng minh task đã duyệt vẫn chạy đúng sau migration) + FR-15 (đường lùi export-legacy).
  - Boot deadlock nếu lỡ tay gọi nhầm guard activation trong migration → chặn bằng chính thiết kế FR-14 +
    test riêng khẳng định migration không import/gọi `assertNoInFlightAnnouncementOrTicketTasks`.
  - `pattern` single/multi tính nhầm dùng `mentionTeams` (gồm cả `always_included`) thay vì `batchTeams` →
    chặn bằng FR-5 đặt tên tường minh + AC-8 (test riêng chứng minh `always_included` không lọt vào phép
    tính pattern).
- **Ảnh hưởng chức năng đang chạy:** Dispatcher/execute-lock/verifier/E3 của CR-20260822 **không đổi hành
  vi** nếu FR-6 (giữ hợp đồng `resolveConfiguredMentions`) được tuân thủ đúng — đây là điều kiện tiên quyết
  của toàn bộ CR này, không phải hệ quả phụ.

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1):** Given 2 request tạo Team cùng lúc với `code` khác casing (`'Dev5'` và `'dev5'`), When cả
  hai gửi lên, Then chỉ 1 request thành công (201), request còn lại 409 — không tạo 2 dòng `code_key` trùng.
- **AC-2 (FR-1):** Given 1 Team đã tạo, When gửi PATCH đổi `code`, Then 400 hoặc field bị bỏ qua — `code`
  không sửa được sau khi tạo, chỉ `display_name` sửa được.
- **AC-3 (FR-3):** Given Team `Dev5` có mapping DM nhưng người đó đã bị deactivate, When gọi
  `resolveConfiguredMentions(['Dev5'], 'vi')`, Then trả `{ready:false, missingTeams:['Dev5']}` — VÀ
  `GET /readiness` phân biệt rõ thông báo "có DM nhưng đã ngưng dùng" khác với "chưa gán DM bao giờ" (test 2
  case Given/When/Then riêng, không gộp).
- **AC-4 (FR-3):** Given Team `Dev13` đang `always_included=1`, When gọi deactivate Team đó, Then 409, Team
  vẫn active — phải tắt cờ `always_included` trước.
- **AC-5 (FR-4):** Given template `(vi, single)` seed lúc migration, When đọc lại và render trên fixture cố
  định, Then output byte-for-byte giống hệt `renderAnnouncementVi()` của CR-20260822 trước khi có bảng này
  (chứng minh migration không đổi hành vi mặc định — tương đương FR-15 golden fixture của CR-20260822).
- **AC-6 (FR-4):** Given template có `blocks.schemaVersion` cao hơn code hỗ trợ, When precheck 1 task dùng
  template đó, Then `blocked` với reason rõ ràng, KHÔNG render bỏ qua block lạ một cách âm thầm.
- **AC-7 (FR-5):** Given đợt khai `batchTeams=['Dev5','Dev12']`, When chọn template, Then dùng mẫu `multi`
  — tính được ngay từ `batchTeams.length`, không cần chờ facts/verify.
- **AC-7b (FR-5):** Given đợt khai `batchTeams=['Dev5','Dev12']` nhưng AI tra Redmine KHÔNG tìm ra ticket
  khớp cho `Dev12`, When facts được validate, Then CẢ facts `blocked` với lỗi `INV-1` nêu rõ team thiếu —
  KHÔNG có nhánh nào lặng lẽ loại `Dev12` ra rồi tự đổi bài sang mẫu `single`.
- **AC-8 (FR-5):** Given Team `Dev13` đang `always_included=1` và đợt chỉ khai `batchTeams=['Dev5']`, When
  chọn template, Then vẫn dùng mẫu `single` — chứng minh `always_included` không lọt vào phép tính `pattern`
  (không dùng nhầm `mentionTeams`, dù `mentionTeams` lúc đó có 2 phần tử `['Dev5','Dev13']`).
- **AC-9 (FR-6):** Given cấu hình mention đã seed từ JSON cũ (qua migration hoặc helper test), When gọi
  `resolveConfiguredMentions(teams, locale)`, Then trả kết quả (`ready`/`mentions`/`missingTeams`) giống hệt
  hành vi cũ với CÙNG input — chạy được với helper seed test thay vì set JSON, không sửa gì ở phía gọi.
- **AC-10 (FR-7):** Given 2 GM active + gọi `resolveConfiguredMentions` 2 lần liên tiếp với cùng dữ liệu,
  Then thứ tự `mentions` trả về giống hệt nhau cả 2 lần (tất định).
- **AC-11 (FR-8):** 5 test riêng cho revision — chỉ group đổi / chỉ người đổi / chỉ template đổi / nhiều
  phần cùng đổi / đổi rồi đổi lại về ĐÚNG cấu hình cũ (Then revision phải bằng đúng giá trị ban đầu — chứng
  minh canonical thật sự canonical, không lệch vì thứ tự ghi).
- **AC-12 (FR-9):** Given task đã `approved`, When group đích đổi trước lúc execute, Then 409 — buộc preview
  lại. Given người bị GỠ khỏi mention trước lúc execute, Then cũng 409. Given chỉ THÊM người mới hoặc
  template đổi, Then execute vẫn chạy, `ResultSnapshot.configDriftWarnings` có cảnh báo, `status` không đổi
  thành lỗi.
- **AC-13 (FR-9):** Given migration seed xong mà JSON cũ có `gm:null`, When đọc readiness, Then báo thiếu GM
  — chặn (đổi hành vi có chủ đích so với hiện tại, phải có test khẳng định đây là hành vi MỚI mong muốn).
- **AC-14 (FR-10):** Given 1 task `approved` chưa tới giờ chạy dùng contract Announcement locale `vi`, When
  Leader PATCH sửa `person-roles` (thêm 1 fixed_extra), Then response `200` kèm `warnings` nêu đúng
  `taskId`/`scheduledAt`/nội dung cảnh báo.
- **AC-15 (FR-11):** Given gọi `GET /readiness` không tham số, Then trả tình trạng tổng quan (không đòi
  `locale`/`teams`). Given gọi `GET /readiness?locale=vi&teams=Dev5`, Then trả đúng gap cho riêng đợt đó,
  dùng CHUNG lõi `checkConfig` với gate precheck (test bằng cách trigger cùng 1 tình huống thiếu cấu hình từ
  cả 2 đường, kỳ vọng cùng 1 `code`).
- **AC-16, AC-17 (FR-12) — RÚT LẠI** cùng với FR-12 (Amendment sau §4.97, D5) — 2 AC này kiểm cơ chế
  "xác nhận nhóm thread 1 lần, nhớ mãi" đã không còn tồn tại. AC tương ứng cho cơ chế thay thế (URL Leader tự
  dán) thuộc CR-20260822, xem test plan ở [§4.102](../../exchanges/2026-08-21.md).
- **AC-21 (FR-16):** Given popup tạo task giai đoạn 1, When mở dropdown "Team tham gia đợt này", Then chỉ
  liệt kê team `active=1` từ `emergency_release_teams` — không cho gõ tự do, không hiện team đã deactivate.
  Given chọn 1 người ở dropdown "Người cần mention" mà người đó đã bị deactivate SAU khi popup đã mở (đổi ở
  tab khác cùng lúc), When submit, Then 400 rõ ràng ("người đã ngưng dùng"), không tạo task với dữ liệu chết.
- **AC-22 (FR-17):** Given đã tạo xong task giai đoạn 1 (chưa có "Hệ thống ảnh hưởng"), When mở popup "Chọn
  ngày giờ", Then thấy đủ 2 ô mới "Hệ thống ảnh hưởng" (bắt buộc) và "Phạm vi ticket" (`Web`/`Mobile`/`Cả
  hai`, bắt buộc) — task giai đoạn 1 tạo được TRƯỚC khi 2 ô này có giá trị (không còn bắt buộc ở bước 1).
- **AC-23 (FR-17):** Given Leader chọn "Phạm vi ticket" = `Cả hai` ở popup giai đoạn 2, When submit, Then hệ
  thống tạo **2 instance task** "Tạo ticket Release khẩn cấp" (E3) — 1 gắn platform `web`, 1 gắn platform
  `mobile` — không phải 1 task duy nhất mang cả 2 platform (Redmine chỉ nhận 1 platform/ticket — §4.101 D3).
  Given chọn `Web` hoặc `Mobile` (không phải cả hai), Then chỉ tạo đúng 1 instance E3 như hành vi hiện tại.
- **AC-18 (FR-14):** Given 1 task `approved` (preview đã đóng băng) TRƯỚC khi chạy migration, When migration
  chạy xong rồi task đó `execute`, Then thành công với ĐÚNG nội dung/group/mention đã đóng băng — không cần
  đọc bảng master mới, không lỗi vì thiếu dữ liệu master.
- **AC-19 (FR-14):** Given có 1 task `automation_status='running'` (in-flight) tại thời điểm app khởi động
  lần đầu sau khi có migration này, When app khởi động, Then migration chạy xong bình thường, app mở được —
  chứng minh migration không gọi guard chống-in-flight.
- **AC-20 (FR-15):** Given cấu hình mới có 2 GM active, When chạy `emergency-config:export-legacy`, Then
  script in cảnh báo rõ ràng về việc chỉ 1 GM được giữ lại trong JSON cũ (liệt kê đúng GM nào bị bỏ), không
  im lặng mất dữ liệu.

## 9. Kế hoạch test

- Tầng test dự kiến: ✅ Unit ✅ Integration route ✅ Render component ⬜ Smoke thủ công (thuộc UAT
  CR-20260822, không lặp lại ở đây)
- **Chiến lược giảm effort (SA §4.96 SA-5):** viết 1 helper test
  `seedEmergencyConfigFromLegacyShape(cfg: AnnouncementMentionConfig)` nhận nguyên shape JSON cũ, seed xuống
  bảng mới. Nhờ đó:
  - `test/integration/announcement-dispatch.test.ts` (33 test) và phần `resolveConfiguredMentions` của
    `test/unit/announcement-context.test.ts` (4 test) — **chỉ đổi 1 dòng setup**, assertion giữ nguyên 100%.
    Đây chính là bằng chứng sống cho việc FR-6 (giữ hợp đồng) đã được tuân thủ — nếu helper seed không đủ để
    2 file này pass nguyên vẹn, nghĩa là hợp đồng đã bị phá.
  - `test/unit/announcement-mention-config.test.ts` (14 test) — **viết lại** thành test CRUD + ràng buộc
    bảng (unique active, FK restrict).
  - `test/integration/announcement-mention-settings.test.ts` (~8 test),
    `test/integration/announcement-group-settings.test.ts` (17 test) — **viết lại** theo route mới; giữ
    nguyên các ca test route resolve (route đó không đổi).
  - `test/client/announcement-mention-settings.test.tsx` (9 test),
    `test/client/announcement-group-settings.test.tsx` (9 test) — **viết lại** cho UI mới.
- Ca test chính: toàn bộ AC-1…AC-15, AC-18…AC-23 ở trên map 1:1 sang test integration/unit (AC-16/AC-17 đã
  rút lại cùng FR-12).
- Ca lỗi/biên bổ sung ngoài AC: `verify_allowed` thêm trùng 1 group 2 lần → 409 (unique index); xoá Team
  đang là `team_code_key` FK của 1 `team_dms` active → FK RESTRICT chặn ở tầng DB, route trả 409 rõ ràng
  thay vì lỗi SQL thô lộ ra ngoài; test hồi quy route tạo task giai đoạn 1 (FR-16/FR-17) đảm bảo request cũ
  dùng `systems` ngay ở bước 1 (nếu còn client cũ nào gọi) không còn bị 400 vì thiếu — trường đó đã hết bắt
  buộc ở bước này.

## 10. Kế hoạch triển khai / rollback

- **Trước khi bắt đầu code CR này:** CR-20260822 phải UAT PASS bằng Claude CLI thật + group Dr.JOY nháp,
  dùng cấu hình JSON cũ (§4.97 Q4, xem đầu file) — không phải bước của CR này nhưng là điều kiện tiên quyết.
- Bước triển khai: (1) migration schema+seed (FR-14, tự chạy lúc mở app, không guard); (2) route CRUD +
  `checkConfig`/readiness (FR-11, FR-13); (3) route template + render tách block (FR-4); (4) UI tab mới
  (6.1); (5) popup giai đoạn 1/2 đổi dropdown + dời trường (FR-16/FR-17) — làm SAU bước (2) vì cần
  `GET /team-options`/`GET /people-options` đã có; (6) gỡ 4 chỗ kiểm tra rời rạc cũ + 2 component UI cũ khỏi
  tab AI (FR-11, 6.1) — làm SAU CÙNG, sau khi đường mới đã chạy xanh, để không có khoảng hở mất khả năng cấu
  hình giữa chừng.
- **Việc vận hành thuần dữ liệu, không phải code (§4.100 D4):** sau khi CR này go-live, Leader tự vào UI hiện
  có đổi mốc thời gian của 3 định nghĩa task thật E3/E6/E7 sang `after_schedule` (xem ghi chú cuối FR-17) —
  làm SAU khi FR-16/FR-17 đã chạy ổn định, vì lúc đó "Hệ thống ảnh hưởng"/"Phạm vi ticket" đã có ở đúng popup
  giai đoạn 2 để E3 dùng khi chạy ở mốc `after_schedule`.
- Rollback nếu hỏng: `npm run backup-db` → script rollback `emergency-config:export-legacy` (FR-15, chưa tồn
  tại tới khi CR này code xong) → revert code.
  4 key JSON cũ vẫn còn nguyên trong `app_settings` cho tới khi có 1 lần giao riêng dọn hẳn (ngoài phạm vi
  CR này).

## 11. Docs cần cập nhật sau khi làm xong

- [ ] `docs/specs/03-api-business-logic-spec.md` — thêm mục mô tả toàn bộ route `/emergency-release/settings/*`
  + cơ chế `checkConfig`/revision (thêm subsection mới, sau §2.3 đã có của CR-20260822); cập nhật hợp đồng
  popup tạo task giai đoạn 1/2 theo FR-16/FR-17 (dropdown, dời `systems`, thêm `platform`)
- [ ] `docs/specs/04-database-design.md` — 7 bảng mới
- [ ] `docs/specs/02-screen-design-user-flow.md` — cập nhật mô tả popup giai đoạn 1/2 theo FR-16/FR-17
- [ ] `docs/rules/07-rules-backend.md` — luật "một cửa `checkConfig`", luật "2 khái niệm teams
  (`batchTeams`/`mentionTeams`) không dùng lẫn nhau", luật migration không gọi guard activation
- [ ] `docs/ai-prompts/release/emergency-release.md` — cập nhật phần mô tả cách mention/group được cấu hình
  (không còn hardcode trong prompt aiNote); bỏ đoạn AI phải hỏi platform web/mobile qua Q&A (FR-17 — giá trị
  đã có sẵn trên task, không cần hỏi nữa)
- [ ] `docs/operations/automation-ai-go-live-guide.md` — thêm bước "cấu hình qua màn Cài đặt Release khẩn
  cấp" vào trình tự go-live, sau bước UAT CR-20260822; thêm bước đổi mốc `after_schedule` cho E3/E6/E7 (D4)
- [ ] `docs/backlog/README.md` — `BL-20260823-001` → cập nhật tiến độ theo từng lát, `Done` khi CR nghiệm thu

## 12. Duyệt (sign-off)
| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | | | |
| Người triển khai | | | |
| QA nghiệm thu | | | |
