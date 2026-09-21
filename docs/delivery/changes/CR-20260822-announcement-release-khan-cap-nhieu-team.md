# CR-20260822-announcement-release-khan-cap-nhieu-team — Announcement release khẩn cấp hỗ trợ nhiều team, AI chỉ thu thập facts

| Trường | Giá trị |
|---|---|
| Loại | ✅ Thêm mới ✅ Sửa hành vi ⬜ Xóa/Deprecate |
| Mức tác động | ✅ Lớn (đụng DB/nhiều màn/automation) |
| Người đề xuất | Claude + Codex |
| Ngày | 2026-08-22 |
| Backlog item | `BL-20260822-001` (`Picked`, Route C) |
| Trạng thái | ⬜ Draft ✅ Đã review (tự soi Dev/Tester/Infra + `security-gate`) ✅ Đã duyệt (DoR 2026-08-22) ✅ Đã triển khai (Lát 1-10 code+test xong, Codex PASS checkpoint code §4.83) ⬜ Đã nghiệm thu (chờ UAT Claude CLI thật + go-live, xem go-live guide §10) |
| Spec liên quan | [specs/03](../../specs/03-api-business-logic-spec.md), [specs/04](../../specs/04-database-design.md), [rules/07](../../rules/07-rules-backend.md), [ai-prompts/emergency-release](../../ai-prompts/release/emergency-release.md), [automation-ai-go-live-guide](../../operations/automation-ai-go-live-guide.md) |

Toàn bộ pha thiết kế (18 vòng đối thoại Claude⇄Codex⇄Leader) nằm ở
[docs/exchanges/2026-08-21.md §4](../../exchanges/2026-08-21.md) — CR này chuyển các quyết định đã chốt ở
đó (§4.1-§4.18) thành FR/AC/schema chính thức, không thiết kế lại từ đầu. Mọi tham chiếu "§4.x" trong CR
này trỏ vào file đó.

**Phạm vi TÁCH RA (2026-08-23, xem §4.90/R3 §4.92):** quản lý động Team/Người/DM/Group Dr.JOY + 4 mẫu nội
dung bài (VN/JP × 1-team/nhiều-team) — hiện đang là JSON tự do (`automation_announcement_mentions` và 2 key
group) — đã chuyển sang **[`CR-20260823-cai-dat-release-khan-cap`](CR-20260823-cai-dat-release-khan-cap.md)**
(`BL-20260823-001`). CR này giữ nguyên phạm vi: schema/gate/dispatcher/execute-lock/chống trùng ticket E3/
activation script (FR-1…FR-15). Go-live thật cần CẢ 2 CR xong.

## 1. Bối cảnh & Vấn đề

Task `Announcement - VN_Release` (E6) và `Announcement - 研究開発部` (E7) trong release khẩn cấp hiện chỉ
hỗ trợ đúng 1 team/1 ticket mỗi đợt: AI đọc Note đã điền sẵn ngày giờ, tự tra Redmine/Drive/Dr.JOY rồi **tự
viết đè toàn văn bài đăng** (số ticket, link, người mention) và tự đăng luôn — không ai xác minh lại URL hay
người được mention trước khi đăng. Thực tế có đợt gộp nhiều team, hệ thống hiện không hỗ trợ được, Leader
phải tự viết tay ngoài luồng automation. Mention GM/DM đang hardcode trong prompt
(`docs/ai-prompts/release/emergency-release.md:349-355, 401-407`), sửa người phải sửa văn bản prompt. Gate
chống lệch definition (`kiemTraLechDefinition`, `server/routes/automation.ts:55-70`) chỉ tra bảng
`release_task_definitions`, không tra được `emergency_release_task_definitions` (`BL-20260818-009`) — nên
task khẩn cấp không bao giờ được so lệch thật.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - E6/E7 tạo được đúng 1 bài đăng gộp N ≥ 1 team trong 1 đợt khẩn cấp, đúng cấu trúc VN (gom theo field)
    và JP (lặp khối theo ticket, ẩn danh) đã chốt ở §4.2/§4.9.
  - AI không còn tự quyết câu chữ cuối cùng: AI chỉ trả **facts thô** (id + evidence), backend validate +
    tự dựng `content`/`contentHtml` canonical; execute chỉ đăng đúng snapshot đã duyệt.
  - Mọi `#<ticket>` là hyperlink thật tới Redmine; `Thread`/`File schedule` là hyperlink chữ "Link"; có
    thêm mục "Phạm vi ảnh hưởng" ở cả 2 bài.
  - GM/DM/team/người cố định theo locale cấu hình được qua Settings, không còn hardcode trong prompt;
    lưu bằng ID Dr.JOY thật (đã resolve lúc lưu), không lưu tên suông.
  - Gate lệch definition nhận diện đúng cả `emergency_release_task_definitions`, áp chính sách theo
    `automation_contract` (chặn cứng cho E6/E7, cảnh báo cho task khẩn cấp khác) — giải quyết
    `BL-20260818-009` trong cùng CR.
- **Ngoài phạm vi (không làm lần này):**
  - Không đổi periodic release (30 task A1-B11) — đã chốt ở §4 phần "periodic vs emergency" (không cùng
    vấn đề nên không cần đổi).
  - Không đổi 20 task khẩn cấp khác (E1-E5, E8-E22) — vẫn AI tự soạn + tự đăng như hôm nay, chỉ hưởng lây
    chính sách cảnh báo (không chặn) từ gate lệch definition đã tổng quát hoá.
  - Không xây adapter server gọi thẳng Redmine/Drive/Dr.JOY API (Codex finding §4.15 High #1, Leader chốt
    phương án B ở §4.16) — xác minh facts vẫn qua 1 lượt AI đọc lại độc lập.
  - Không vá toàn bộ lỗi propagation `related_ids` từ definition xuống task thật (mục 4 báo cáo kỹ thuật
    dưới đây) — chỉ thêm 1 kênh đọc kết quả có cấu trúc hẹp (FR-12/FR-13) đủ dùng cho ticket khẩn cấp, không
    sửa cơ chế `relatedIds`/`replyToRef` chung.
  - Không đổi UI hiển thị automation_result dạng text hiện có cho các task khác.
  - Không tổng quát hoá cơ chế operation→tool cho mọi contract (đó là phạm vi `BL-20260815-007`, vẫn
    `Inbox`) — CR này chỉ thêm đúng 1 rẽ nhánh hẹp giới hạn write tool cho riêng `emergency_announcement_v1`.

## 3. Người dùng & Kịch bản

- Là Leader (member Dev13, trực tiếp thực hiện release và đăng thông báo), tôi muốn 1 đợt khẩn cấp gộp N
  team vẫn ra đúng 1 bài đăng đầy đủ, đúng người liên quan, không phải tự viết
  tay ngoài automation.
- Là Leader, tôi muốn sửa GM/DM/team qua màn Settings khi tổ chức thay đổi, không phải sửa văn bản prompt.
- Là Leader, tôi muốn khi AI tìm ra nhiều hơn 1 kết quả khớp (ticket/file/bài post trùng tên), hệ thống hỏi
  tôi chọn đúng 1, không tự đoán và không đăng liều.
- Là Leader, tôi muốn nếu definition của E6/E7 đã đổi mà task sắp đăng vẫn là bản cũ, hệ thống **chặn hẳn**
  cho tới khi tôi đồng bộ lại — không được đăng theo hướng dẫn cũ.

## 4. Yêu cầu chức năng

> **Đã sửa theo Codex review §4.20** (xem [exchanges/2026-08-21.md §4.20](../../exchanges/2026-08-21.md)):
> đánh số lại FR-1…FR-15 liền mạch, thêm FR-3 mới (nguồn canonical team/hệ thống của batch), viết lại
> FR-2/FR-6/FR-7/FR-11/FR-14 theo đúng finding High/Medium.
> **Đã sửa tiếp theo Codex re-review §4.22** (xem §4.22 cùng file): FR-1 snapshot cả `automation_contract`/
> `announcement_locale` xuống task (không chỉ `origin_kind`) để gate/dispatch/rollback nhất quán; FR-3 thêm
> lifecycle/transaction cho batch; FR-5/FR-7 thêm `partialFacts`, bỏ `systems` khỏi facts AI; FR-7 chốt cơ
> chế claim bằng conditional UPDATE; FR-12 định nghĩa cụ thể "bằng chứng chắc chắn"; FR-14 thêm resolver
> mapping tool cụ thể; FR-1 PATCH thêm validator chi tiết.

### Nhận diện definition & gate lệch (giải quyết High §4.20 #1, §4.22 High #1, `BL-20260818-009`)

- **FR-1:** Thêm cột `origin_kind TEXT` (giá trị `'regular_release'|'emergency_release'`, NOT NULL cho task
  mới) + **`automation_contract TEXT` (nullable) + `announcement_locale TEXT` (nullable, `'vi'|'ja'`)** vào
  `tasks` — cả 3 cột được **snapshot xuống task ngay lúc tạo**, đọc từ đúng definition gốc tại thời điểm đó
  (route tạo task luôn biết đang ghi bảng definition nào nên tự stamp, không suy đoán). Thêm cùng 2 cột
  `automation_contract`/`announcement_locale` vào **cả 2 bảng** `release_task_definitions` và
  `emergency_release_task_definitions` (nguồn để snapshot từ đó, và để definition có thể sửa sau này).

  **Tách rõ 2 pha triển khai — `schema migration` và `activation migration`** (sửa theo Codex §4.37 High:
  bản trước gộp chung "thêm cột" với "seed contract thật" trong cùng 1 migration, khiến kế hoạch code §4.35
  định dời việc seed ra lát cuối bị mâu thuẫn với chính CR này):
  - **Schema migration** (chạy ngay, an toàn, không kích hoạt gì): ALTER TABLE ADD COLUMN toàn bộ cột trên —
    giá trị mặc định NULL cho `automation_contract`/`announcement_locale` ở CẢ task lẫn definition. Backfill
    `origin_kind` cho task cũ (a) `release_month LIKE 'emergency:%'` → `emergency_release`; (b) còn lại,
    resolve `origin_ref` DUY NHẤT ở đúng 1 bảng definition — resolve 1 bảng → gán; cả hai/không bảng nào →
    `origin_kind=NULL` + log cảnh báo. Sau bước này, **mọi definition/task đều `automation_contract=NULL`**
    — hệ thống chạy 100% như hôm nay, kể cả sau khi toàn bộ code Lát 2-9 đã deploy (dispatcher/gate mới tồn
    tại trong code nhưng chưa ai đi vào được vì chưa có gì mang giá trị contract khớp).
  - **Activation migration** (chỉ chạy ở Lát 10B/10C, sau khi Lát 1-9 đã xong và test đủ): seed
    `emergency_release_task_1779783182912` (E6) → `automation_contract='emergency_announcement_v1'`,
    `announcement_locale='vi'`; `emergency_release_task_1779783210782` (E7) → cùng contract,
    `announcement_locale='ja'`; seed definition `Tạo ticket Release khẩn cấp` (E3) →
    `automation_contract='emergency_ticket_v1'` (FR-12). Trong CÙNG transaction, backfill nốt
    `automation_contract`/`announcement_locale` cho task cũ **chưa terminal** (`automation_status` không
    phải `done`/`done_with_warning`) mà `origin_ref` resolve đúng về đúng 1 definition vừa seed — task đã
    terminal giữ nguyên NULL vĩnh viễn (không sửa lịch sử). **Fail-closed nếu có task liên quan đang
    `checking`/`preview`/`needs_input`/`approved`/`running` tại thời điểm activation** — abort toàn bộ
    activation, không chạy nửa chừng (một batch đang xử lý dở không được đổi luật giữa đường).

  **Cờ rollout toàn cục `automation_announcement_rollout_enabled`** (mới, `app_settings`, mặc định `false`
  — giải quyết High §4.37 "PATCH có thể tự bật contract sớm, phá bất biến chưa-nửa-vời"): cả 2 nơi sau đều
  PHẢI kiểm cờ này, không chỉ dựa vào việc definition có mang `automation_contract` hay không:
  1. **Dispatcher** (FR-4): chỉ route qua pipeline mới khi task có `automation_contract` khớp **VÀ** cờ
     đang `true`; cờ `false` → coi như không có contract (rơi về pipeline generic), bất kể dữ liệu DB nói gì.
  2. **`PATCH /release/emergency/task-definitions/:id`**: reject 409 nếu cố set
     `automation_contract='emergency_announcement_v1'` trong khi cờ đang `false` — không cho set thủ công
     trước khi chính thức activation, đóng đường lách qua API.

  **Cô lập smoke khỏi scheduler toàn cục** (thêm theo Codex §4.39 High — bật cờ rollout riêng KHÔNG đủ an
  toàn: mọi task khác đang `idle`/`approved` đủ giờ vẫn có thể bị scheduler nhặt và đi vào pipeline mới ngay
  khi cờ bật, không chỉ đúng batch smoke đang test). Thêm 2 setting nữa trong `app_settings`:
  - `automation_announcement_smoke_release_month` (nullable TEXT): khi **có giá trị** VÀ cờ rollout đang
    `true` → dispatcher CHỈ coi task thuộc ĐÚNG `release_month` này là "có contract kích hoạt"; mọi task
    khác (dù snapshot contract khớp, dù đang `idle`/`approved` đủ giờ) đều bị dispatcher bỏ qua, rơi về
    generic — đây là **chế độ smoke bị giới hạn phạm vi**. Khi setting này là `NULL` (không set) và cờ
    `true` → chế độ production bình thường, mọi task có contract đều được xử lý (chỉ 10C mới để `NULL`).
  - **Group đích không còn là hằng số cứng trong code** — cấu hình `(automation_contract,
    announcement_locale) → targetGroupId` chuyển thành 1 key `app_settings` mới (đọc/ghi qua
    `automation-config.ts`, cùng pattern một cửa), để lúc smoke (Lát 10B) trỏ tạm về group Dr.JOY nháp/test,
    và lúc go-live thật (Lát 10C) mới cấu hình lại đúng group `VN_Release`/`研究開発部` thật. `PATCH` set
    contract vẫn reject 400 nếu cặp `(contract, locale)` chưa có mapping trong config này.
  - **Lát 10B bắt buộc dùng `finally`**: dù smoke pass hay throw lỗi giữa chừng, phải set lại
    `automation_announcement_rollout_enabled=false` VÀ xoá `automation_announcement_smoke_release_month` —
    không được để cờ treo ở `true` sau khi kết thúc (dù thành công hay thất bại) window smoke.
  Ngoài các điều kiện đó, `PATCH` vẫn validate như cũ: `actionType==='post'`, `announcement_locale` đúng
  enum, `template_id` tồn tại trong `emergency_release_templates` — reject 400 nếu bất kỳ điều kiện nào
  không đạt hoặc chuỗi contract lạ. **Id definition chỉ dùng đúng 1 lần lúc activation/seed** — mọi runtime
  dispatch chỉ đọc `(origin_kind, automation_contract, announcement_locale, cờ rollout, smoke scope)` đã
  snapshot/cấu hình, không bao giờ so sánh theo id definition.
- **FR-2:** Tổng quát hoá `kiemTraLechDefinition()` (`automation.ts:55-70`) để nhận thêm tham số
  `originKind` (đọc từ cột mới ở FR-1) và tra ĐÚNG bảng tương ứng — `regular_release` →
  `release_task_definitions`, `emergency_release` → `emergency_release_task_definitions`; `origin_kind=NULL`
  (dữ liệu cũ chưa backfill được) → giữ nguyên hành vi cảnh báo chung hiện tại, không đoán bảng. So sánh
  field lệch mở rộng thêm **`automation_contract`/`announcement_locale`** (task snapshot vs definition hiện
  tại) — coi như 2 field bình thường trong bộ so lệch, không xử lý riêng. Áp chính sách theo
  `automation_contract` **đã snapshot trên task** (không phải đọc sống từ definition):
  - Task snapshot `automation_contract='emergency_announcement_v1'` **và** có bất kỳ field nào lệch (kể cả
    chính `automation_contract`/`announcement_locale` đã đổi trên definition) → hard block y hệt hành vi
    periodic hiện tại (`reasons:[{code:'task_lech_definition',...}]`, `ready=false`).
  - Task snapshot contract khác (kể cả rỗng) và có lệch field → **cảnh báo thật** (`driftWarning` liệt kê
    đúng field lệch) — không chặn.
  - Không tìm được definition ở đúng bảng (đã xoá) → giữ nguyên hành vi cảnh báo chung hiện tại.
  **Rollback nhất quán (sửa theo Codex §4.24 Medium — `NOT IN` bỏ sót NULL, và không được âm thầm đổi task
  đang chạy):** trước khi rollback, vận hành viên PHẢI xác nhận không có task nào của E6/E7 đang
  `approved`/`running` (nếu có, chờ nó kết thúc hoặc dừng thủ công trước — không rollback đè lên); sau khi
  xác nhận, migration rollback chỉ sửa đúng các trạng thái **liệt kê tường minh** (không dùng `NOT IN` — dễ
  bỏ sót NULL):
  ```sql
  UPDATE tasks SET automation_contract = NULL, announcement_locale = NULL
  WHERE origin_ref IN (...)
    AND automation_status IN ('idle', 'preview', 'needs_input', 'blocked', 'checking')
  ```
  Task `done`/`done_with_warning` giữ nguyên snapshot lịch sử vĩnh viễn (không sửa lại quá khứ); task
  `approved`/`running` không nằm trong danh sách trên nên không bao giờ bị câu UPDATE này chạm tới — đúng
  với việc đã xác nhận không còn task nào ở 2 trạng thái đó trước khi chạy rollback.

### Nguồn canonical team/hệ thống của 1 đợt (giải quyết High §4.20 #2, §4.22 Medium lifecycle)

- **FR-3:** Thêm bảng mới `emergency_release_batches` (`release_month TEXT PRIMARY KEY`, `teams TEXT` JSON
  mảng tên team, `systems TEXT` JSON mảng `'Dr.JOY'|'Pr.JOY'`, `created_at`, `updated_at`). Route tạo task
  giai đoạn 1 (`POST /schedules/emergency-release/tasks`, key stage 1) nhận thêm `teams`/`systems` bắt buộc
  cùng request, và ghi bảng này + insert các task trong **CÙNG 1 transaction** (dùng `withTransaction`) —
  không transaction riêng, tránh batch tồn tại mà task tạo lỗi hoặc ngược lại. FE thêm 2 ô chọn bắt buộc vào
  popup hiện có: "Team tham gia đợt này" (multi-select) và "Hệ thống ảnh hưởng" (multi-select Dr.JOY/Pr.JOY),
  KHÔNG suy từ `mentionTeamHints`/Note tự do.
  **Liên kết task↔batch: dùng ĐÚNG cột `tasks.release_month` đã có sẵn** (giải quyết Medium §4.26 — không
  thêm cột mới, không suy từ Note/key dạng chuỗi). Route tạo task giai đoạn 1 đã ghi `release_month` vào mỗi
  task (hành vi hiện có, không đổi); `emergency_release_batches.release_month` dùng ĐÚNG GIÁ TRỊ đó làm khoá
  — mọi chỗ cần "task cùng batch" (PATCH guard dưới đây, FR-13, renderer) chỉ cần `WHERE release_month = ?`.
  **Vòng đời:** cùng `release_month` gửi lại ĐÚNG `teams`/`systems` đã lưu → no-op (chỉ cập nhật
  `updated_at`, idempotent — cho phép bấm lại an toàn). Cùng `release_month` gửi `teams`/`systems` KHÁC với
  dữ liệu đã lưu → 409, phải gọi riêng `PATCH /release/emergency-batches/:releaseMonth` (route mới) mới được
  đổi. **`PATCH` này BẤT BIẾN ngay khi có side effect** (sửa theo Codex §4.26 High — bản trước còn cho PATCH
  khi task đã `done`, có thể làm 2 bài VI/JA cùng đợt dùng 2 bộ team khác nhau): trước khi cho đổi, kiểm MỌI
  task cùng `release_month` có `automation_contract='emergency_announcement_v1'` — chỉ cho phép PATCH khi
  **TẤT CẢ** các task đó đang `idle` (chưa từng chạy precheck lần nào). Bất kỳ task nào đã rời khỏi `idle`
  (kể cả `checking`/`preview`/`needs_input`/`approved`/`running`/`done`/`done_with_warning`) → 409, từ chối
  toàn bộ PATCH — vì `done`/`done_with_warning` nghĩa là ĐÃ đăng theo dữ liệu batch cũ, đổi batch lúc này sẽ
  khiến bài E6/E7 còn lại (nếu có) dùng team/systems khác bài đã đăng. **Nguyên tử hoá**: toàn bộ "đếm task
  không-idle" + "UPDATE batch nếu qua được điều kiện" nằm trong CÙNG 1 lời gọi đồng bộ bên trong
  `withTransaction`, không có `await` chen giữa — do driver `node:sqlite` chạy đồng bộ và Node đơn luồng nên
  không request nào khác có thể xen vào giữa lúc đếm và lúc ghi (cùng cơ chế đã dùng cho claim ở FR-7, không
  cần thêm khoá gì khác). Task giai đoạn 2 (key `:schedule`, cùng `release_month`) đọc lại ĐÚNG batch row đã
  tạo ở giai đoạn 1, không tạo row mới. Xoá toàn bộ task của 1 đợt (nếu route hiện có cho phép) KHÔNG xoá
  `emergency_release_batches` — giữ lại làm dấu vết audit, vô hại vì không có gì đọc batch row của 1
  `release_month` đã hết task trừ khi có task E6/E7 mới thật sự tham chiếu `release_month` đó. Đây là
  **nguồn sự thật duy nhất** để đối chiếu — `AiAnnouncementFactsV1` do AI trả về (FR-5) chỉ được dùng để
  ĐIỀN CHI TIẾT ticket/thread/file, KHÔNG được có field `systems`/`teams` trong
  schema output của AI (loại bỏ hẳn khỏi facts — xem §6.3) để tránh kiểm tra vòng tròn.

### Pipeline facts → verify → render (giải quyết High/Medium §4.8/§4.15/§4.20)

- **FR-4:** Khi `runPrecheckAndApply()` xác định task có `automation_contract='emergency_announcement_v1'`
  đã snapshot **VÀ** cờ `automation_announcement_rollout_enabled` đang `true` **VÀ** (`automation_announcement_smoke_release_month`
  đang `NULL` **HOẶC** trùng đúng `release_month` của task đó) (FR-1) — thiếu bất kỳ điều kiện nào thì coi
  như không có contract, rơi về pipeline generic — route qua dispatcher mới
  (`buildAnnouncementFactsPrompt` → validate → verify độc lập → render), thay cho `buildPrecheckPrompt()`/nội
  dung tự do hiện tại. AI ở bước này CHỈ được trả **facts thô theo schema `AiAnnouncementFactsV1`** (xem
  §6.3) — không có trường `url` tự do, không có `content` tự soạn, không có `candidateId`/`precheckRunId`
  (2 field đó do backend sinh SAU). Prompt truyền kèm `teams`/`systems` đã đọc từ FR-3 làm căn cứ đối chiếu,
  không để AI tự khai lại.
- **FR-5:** Backend validate `AiAnnouncementFactsV1` theo đúng bộ invariant ở §6.3 (INV-1 … INV-12). Nhánh
  `ready` sai bất kỳ invariant nào → `blocked`, nêu rõ field/lý do — không render best-effort. Nhánh
  `needs_input` được backend enrich thành `PendingAnnouncementContextV1` (sinh `precheckRunId`, gán
  `candidateId` cho từng option) trước khi lưu vào `automation_preview` — xem FR-7.
- **FR-6:** Sau khi facts qua validate hình thức, spawn **1 lượt AI đọc lại độc lập** (verifier), tách biệt
  hoàn toàn khỏi lượt tìm facts ban đầu. Verifier nhận **typed request** `{kind:'redmine_ticket'|'drive_file'
  |'drjoy_post', id, groupId?, requestKey}[]` (KHÔNG nhận lại `rawTitle`/evidence AI đã tự nhận — tránh mô
  hình tự xác nhận lại lời chính nó). Verifier phải trả đúng 1 kết quả cho MỖI `requestKey` đã gửi — backend
  reject nếu thiếu/thừa/trùng `requestKey` trong response (đối chiếu 1:1 tuyệt đối, không suy diễn theo thứ
  tự mảng). Kết quả trả về là bằng chứng thô đọc được qua tool (tiêu đề/tên file/tác giả bài post thật).
  Backend so bằng chứng verifier với `rawTitle`/mô tả AI ban đầu — lệch → `blocked`. `groupId` cho
  `drjoy_post` phải nằm trong allowlist group id đã cấu hình (không chấp nhận group id tự do AI đưa ra).
  Đúng chốt §4.16 phương án B: đây KHÔNG phải backend tự gọi thẳng MCP, phải ghi rõ trong code/comment giới
  hạn thật của cơ chế này (verifier vẫn là model, không phải xác minh độc lập tuyệt đối).
- **FR-7:** Nếu bất kỳ fact nào (ticket/file/thread) khớp nhiều hơn 1 kết quả, AI trả nhánh `needs_input` ở
  shape `AiAnnouncementCandidate[]` (KHÔNG có `candidateId` — xem ranh giới 2 pha ở §6.3) cùng
  **`partialFacts`** (các field ĐƠN TRỊ đã tìm được, đúng shape con của nhánh `ready`). Backend nhận output
  AI này, validate connector/resourceId, rồi **mới** sinh 1 `precheckRunId` (nonce ngẫu nhiên) và enrich mỗi
  option thành `CandidateOptionBase` có `candidateId` = hash ổn định từ `(precheckRunId, field, slot,
  connector, resourceId)` — `slot` = `team` cho field theo-team (`releaseTicket`/`thread`), hằng số
  `'_single_'` cho field còn lại (tránh 2 option cùng `resourceId` nhưng khác team bị hash trùng) — KHÔNG
  dùng index mảng. Toàn bộ `partialFacts`/`AnnouncementCandidate[]` đã enrich/round hiện tại được lưu làm
  **pending context** trong chính `automation_preview` (cột đã có, không cần bảng mới) khi status chuyển
  `needs_input` — sửa `ghiTrangThai` để KHÔNG xoá preview trong trường hợp này.
  `POST /automation/answer` nhận union rõ ràng: `{taskId, answer: string}` (giữ nguyên cho mọi task khác)
  **hoặc** `{taskId, precheckRunId: string, candidateId: string}` (mới, chỉ dùng cho contract này). Backend
  **claim nguyên tử bằng conditional UPDATE có predicate**, KHÔNG phải read-then-write:
  ```sql
  UPDATE tasks SET automation_status = 'checking', automation_updated_at = ?
  WHERE id = ? AND automation_status = 'needs_input'
    AND json_extract(automation_preview, '$.precheckRunId') = ?
  ```
  chỉ khi `changes === 1` mới coi là claim thành công và tiếp tục xử lý; `changes === 0` → 409 (đã bị claim,
  hoặc `precheckRunId` stale/từ vòng cũ) — không có `await` nào chen giữa lúc đọc và lúc UPDATE (khớp cách
  `node:sqlite` đồng bộ hiện tại, không cần cơ chế khoá nào khác). Sau khi claim, merge candidate đã chọn vào
  `partialFacts` (theo đúng field/resourceId), validate lại toàn bộ object; còn candidate khác chưa chọn →
  tiếp tục ở `needs_input` với `partialFacts` đã cập nhật; hết candidate → chuyển `ready`, chạy verifier
  (FR-6) — KHÔNG chạy lại bước search cho field đã có trong `partialFacts`. Giữ nguyên giới hạn
  `MAX_QA_ROUNDS=5`.
- **FR-8:** Renderer canonical (`renderAnnouncementVi`/`renderAnnouncementJa`, hàm mới) dựng `content` +
  `contentHtml` từ facts nhánh `ready` đã verify + mentions đã resolve (FR-11). Quy tắc dựng đúng
  §4.2/§4.9/§4.11:
  - Mọi `ticketId` (release/relate/emergency) → `<a href="{REDMINE_BASE}/issues/{ticketId}">#{ticketId}</a>`
    (app tự ráp URL từ id + base URL đã cấu hình sẵn, không nhận `url` từ AI).
  - `threads[].link`/`fileSchedule` → `<a href="...">Link</a>` (URL dựng từ `postId`+`groupId`/`fileId` qua
    đúng quy ước hiện có, không phải chuỗi AI tự cho).
  - `rawTitle` tách theo dấu `|`: JP lấy phần trước, VN lấy phần sau; không có `|` thì dùng nguyên chuỗi —
    app tách, AI không tự cắt.
  - Ticket có `platforms` chứa cả `web` và `mobile` → hiện ở CẢ 2 nhóm (§4.11.D phương án A đã chốt), dedupe
    trong từng nhóm, không dedupe chéo nhóm.
  - VN: gom theo field (Team phụ trách nối phẩy → Release Ticket theo team → Relate Ticket theo nền tảng →
    Thread theo team → File schedule 1 dòng), có thêm "■ Phạm vi ảnh hưởng" từ `systems[]` (từ FR-3, không
    phải từ facts AI).
  - JP: lặp khối ①②③... theo từng `releaseTickets` (không in tên team), có "■ 影響範囲" từ `systems[]`.

### Cấu hình mention động (giải quyết Medium identity §4.8/§4.15/§4.20, thiết kế §4.10)

- **FR-9:** Thêm key `app_settings` mới `automation_announcement_mentions`, đọc/ghi qua cặp hàm typed mới
  trong `server/lib/automation-config.ts` (theo đúng pattern hiện có — không export `getSetting`/`setSetting`
  trực tiếp), hình dạng:
  ```json
  {
    "gm": { "id": "<dr.joy member id>", "displayName": "タツ Tuan (BrSE)" },
    "alwaysTeam": "Dev13",
    "teamDm": [ { "team": "Dev1", "dm": { "id": "...", "displayName": "タイン Thanh" } }, ... ],
    "fixedExtra": { "vi": [], "ja": [ { "id": "...", "displayName": "片桐 宏樹" } ] }
  }
  ```
  Mọi entry người **chỉ được lưu dưới dạng `{id, displayName}`** — không có API nào chấp nhận entry chỉ có
  tên suông.
- **FR-10:** Thêm route `POST /automation/settings/announcement-mentions/resolve` (đọc-only) nhận
  `{name, hint?}`, spawn 1 lượt AI đọc read-only qua đúng runner hiện có (`runClaude(mode:'read')`) với tool
  `get-group-members`/`list-groups`, trả về đúng 1 trong 3 kết quả: `{resolved:{id,displayName}}`,
  `{candidates:[...]}`, hoặc `{notFound:true}`. FE Settings chỉ cho thêm 1 người vào cấu hình sau khi route
  này trả `resolved`. `PUT /automation/settings/announcement-mentions` chỉ chấp nhận payload đã toàn bộ ở
  dạng `{id, displayName}` — reject 400 nếu bất kỳ entry nào thiếu `id` hợp lệ.
- **FR-11:** Công thức mandatory mentions (áp dụng khi precheck E6/E7, đọc từ FR-9 + FR-3):
  ```
  teams = {team release trong đợt, đọc từ FR-3} ∪ {alwaysTeam}
  dms   = với mỗi team trong teams, tra teamDm — thiếu dòng nào → ready=false, báo rõ team chưa cấu hình DM
  mandatory = {gm} ∪ dms ∪ (toàn bộ member mỗi team trong teams, qua get-group-members) ∪ fixedExtra[locale]
  ```
  Riêng `locale='ja'`: cộng thêm `jpVariableMentions` — schema bắt buộc `{id, displayName, sourcePostId}`
  (KHÔNG chấp nhận name-only ở nhánh này, nhất quán với FR-9) — người được mention trong đúng bài post JP đã
  dùng để yêu cầu từng ticket release (tra 1 lần, dùng chung với việc lấy `threads[]` ở FR-4, không tra 2
  lần). Dedupe toàn bộ danh sách theo `id` Dr.JOY (không theo tên hiển thị).

  **Giới hạn đã biết — bảo đảm "toàn bộ member" là best-effort, KHÔNG phải tuyệt đối 100%** (chốt qua đối
  thoại Claude⇄Codex⇄Leader, `docs/exchanges/2026-08-21.md` §4.56→§4.62, Leader chọn phương án B ở §4.62):
  kiến trúc automation hiện tại KHÔNG có đường backend gọi thẳng Dr.JOY MCP — mọi lượt đọc `get-group-members`
  đều phải qua spawn Claude, nên backend không có bằng chứng độc lập với dữ liệu Claude tự đọc + tự báo cáo.
  Để giảm rủi ro "AI bỏ sót người lúc chép lại" (không phải lỗi lọc sai team — team vẫn còn người khác nên
  không rỗng), `resolveAllTeamMembers()` (`server/routes/automation.ts`) bắt Claude tự đếm `groupMemberCount`
  NGAY SAU khi tool trả kết quả (một bước nhận thức tách biệt khỏi việc liệt kê từng người), backend đối
  chiếu với `members.length`, VÀ chặn id trùng lặp trong raw list (Codex §4.62 chỉ ra: id trùng có thể làm
  `length` khớp `groupMemberCount` trong khi dedupe theo id lại rút mất 1 người thật). 3 lớp chặn này bắt
  được các lớp lỗi phổ biến (bỏ sót người, dữ liệu hỏng, id trùng) nhưng KHÔNG chứng minh được toán học rằng
  Claude không bao giờ vừa đếm sai vừa liệt kê sai theo đúng cùng 1 kiểu lỗi. Muốn có bảo đảm tuyệt đối 100%
  cần backend tự gọi thẳng Dr.JOY (bỏ qua Claude cho riêng phần đọc member) — đây là thay đổi kiến trúc nằm
  NGOÀI phạm vi CR này; nếu tương lai cần nâng lên cổng cứng, mở CR/backlog item riêng.

### Kết quả có cấu trúc cho ticket khẩn cấp dùng chung (giải quyết High §4.20 #3)

- **FR-12:** Thêm cột `automation_result_data TEXT` (nullable, JSON) + **`automation_idempotency_key TEXT`**
  (nullable, riêng biệt) vào `tasks`. Seed thêm `automation_contract='emergency_ticket_v1'` cho definition
  `Tạo ticket Release khẩn cấp` (E3) — dùng lại đúng cột `automation_contract` đã thêm ở FR-1. Định nghĩa
  `ExecuteResult` riêng cho contract này: `{schemaVersion:1, ticketId: number>0, rawTitle: nonEmptyString,
  evidence: nonEmptyString}`.
  **Idempotency key TÁCH RIÊNG khỏi `automation_occurrence_key`** (sửa theo Codex §4.30 High — bản trước
  định dùng lại `automation_occurrence_key` làm gốc marker, nhưng Codex chỉ ra cột đó thuộc vòng đời
  reservation/claim hiện có: bị `NULL` hoá khi reconcile-về-`idle`, và việc giữ/xoá nó phục vụ mục đích khác
  — không an toàn để mượn làm marker chống-trùng-ticket lâu dài). Thay vào đó:
  - `automation_idempotency_key` là cột MỚI, HOÀN TOÀN TÁCH BIỆT khỏi cơ chế reservation/occurrence hiện có
    — không bị bất kỳ luồng reconcile/cancel/retry nào hiện hành đụng tới.
  - Sinh **đúng 1 lần**, atomically (get-or-create: nếu cột đang NULL thì sinh giá trị ngẫu nhiên dạng hex
    ngắn, an toàn để nhúng vào chuỗi tìm kiếm — không dùng nguyên `automation_occurrence_key` vì giá trị đó
    chứa `:`/giờ, không an toàn format khi ghép vào marker) **trước lần execute đầu tiên** của task này.
  - **Không bao giờ bị xoá/reset** bởi retry/reconcile/restart — chỉ mất đi khi CHÍNH task row đó bị xoá
    (task E3 vốn là task đơn/không lặp lại theo ngày, nên 1 row sống suốt vòng đời của đợt khẩn cấp đó).
  - Marker nhúng vào ticket lúc tạo: `EMG-<taskId>-<automation_idempotency_key>`.
  Mở rộng `buildExecutePrompt` cho contract này: (a) bắt buộc Claude trả thêm field cấu trúc `ExecuteResult`;
  (b) bắt buộc nhúng marker trên vào mô tả/field ticket lúc tạo; (c) bắt buộc tự search Redmine theo marker
  TRƯỚC khi tạo — nếu đã có ticket mang marker đó (từ lần thử trước) → dùng luôn, không tạo thêm.
  **Định nghĩa "bằng chứng chắc chắn" — sửa theo Codex §4.30 High (verifier vẫn là AI đọc, không phải adapter
  deterministic, nên "0 kết quả" KHÔNG được tự động coi là bằng chứng đủ mạnh để mở retry):**
  1. **Xác nhận CÓ THẬT + tiêu đề khớp** (qua marker, không qua `ticketId` report tự khai) → ghi
     `automation_result_data` ngay, trong CÙNG transaction với trạng thái terminal `done`.
  2. **CHƯA XÁC NHẬN CÓ SIDE EFFECT** (gộp chung "search ra 0 kết quả" VÀ "search lỗi/timeout" thành 1 nhóm
     duy nhất — không còn `confirmed_absent` tự động, đúng giới hạn đã chốt cho kiến trúc verifier B) → KHÔNG
     ghi artifact, terminal `done_with_warning` kèm reason `emergency_ticket_not_confirmed`. **KHÔNG cho hệ
     thống tự động chạy lại** trong mọi trường hợp thuộc nhóm này.
  **Luồng retry bắt buộc qua người, không tự động** (thay cho "an toàn tự retry" đã bị Codex bác):
  - Leader bấm hành động đọc-only **"Kiểm tra lại"** — search lại đúng marker cũ; tìm thấy → backfill
    `automation_result_data` ngay, xong, không cần làm gì thêm.
  - Không tìm thấy → hệ thống hiển thị rõ: "Chưa xác nhận được ticket đã tạo hay chưa — bạn có chắc muốn thử
    tạo lại?" — Leader phải **xác nhận rõ ràng riêng biệt** qua route mới
    **`POST /automation/emergency-ticket/retry-authorize`** (body `{taskId, idempotencyKey, confirmation:true}`)
    — giải quyết finding High §4.32 (route/state machine cụ thể để mở lại task đã terminal mà không né
    bước duyệt hay đụng cơ chế reservation hiện có):
    1. Trong 1 transaction, conditional `UPDATE`: chỉ nhận task có
       `automation_contract='emergency_ticket_v1'` và đang đúng `automation_status='done_with_warning'`
       **và** reason hiện tại đúng `emergency_ticket_not_confirmed` **và** `automation_idempotency_key` trong
       DB khớp `idempotencyKey` gửi lên (CAS chống stale confirmation/race 2 request) — `changes===1` mới
       tiếp tục, `changes===0` → 409.
    2. UPDATE đó đưa task về `automation_status='idle'`, giải phóng reservation occurrence cũ theo ĐÚNG cơ
       chế reconcile hiện có và set `automation_occurrence_key=NULL` — nhưng **tuyệt đối không đụng tới
       `automation_idempotency_key`** (giữ nguyên). Lệnh xoá reservation ở route này phải là bản **strict**:
       lỗi/không xoá đúng reservation phải throw để toàn transaction rollback; không dùng helper `goGiuCho()`
       hiện hành vốn nuốt lỗi và có thể để task về `idle` trong khi reservation vẫn còn.
    3. Ghi audit event `retry_authorized` (dùng lại `logEvent` hiện có, cùng kiểu với event `approved`).
    4. Task quay lại `idle` phải đi lại đúng đường **precheck → preview → approve → execute** bình thường —
       KHÔNG có đường tắt nhảy thẳng `running`/execute ngay sau khi xác nhận, để không né bước duyệt.
    Execute lần kế tiếp (sau khi Leader tự precheck/approve lại như bình thường) đọc lại đúng
    `automation_idempotency_key` cũ (không đổi) để dựng marker + search-trước-khi-tạo như đã định nghĩa ở
    trên — đóng vòng an toàn.
  - Ghi rõ trong go-live guide: kiến trúc verifier hiện tại (1 lượt AI đọc lại) không đủ mạnh để tự động hoá
    hoàn toàn bước này — cần người xác nhận là có chủ đích, không phải thiếu sót.
  **Xử lý partial success**: nếu bước tạo ticket đã rơi vào outcome 1 (xác nhận có thật) nhưng 1 bước phụ
  sau đó (vd gắn version) lỗi → VẪN ghi `automation_result_data` (ticket đã có thật, cần chống tạo trùng lần
  sau), trạng thái terminal là `done_with_warning` (khác reason code với outcome 2).
- **FR-13:** Khi dispatcher E6/E7 cần `emergencyTicket`, trước khi yêu cầu AI tự tra Redmine, tra các task
  khác cùng `release_month` có định nghĩa mang `automation_contract='emergency_ticket_v1'`, đọc
  `automation_result_data` nếu có — dùng thẳng, không cần AI tìm lại. Không có/rỗng → fallback đúng hành vi
  cũ (yêu cầu facts-AI tự tra Redmine ở FR-4). Nếu facts-AI vẫn tự tìm ra `emergencyTicket` khác với giá trị
  app đã biết từ cột này → coi là **lệch** (INV-8, `blocked`), không tự động tin bên nào đúng hơn.

### Hồi quy & khoá execute

- **FR-14:** `executeApprovedTask()`/`buildExecutePrompt()` cho contract `emergency_announcement_v1`: bỏ
  quyền AI tự chèn/sửa anchor và bỏ hoàn toàn fallback tự dựng `contentHtml` (`noteToQuillHtml`) — `content`
  + `contentHtml` dùng đúng NGUYÊN VĂN từ `automation_preview` đã duyệt (đã render ở FR-8), không tính toán
  lại. Hành vi legacy (AI tự chèn/tự dựng fallback) giữ nguyên cho 20 task khẩn cấp khác và toàn bộ periodic
  qua đúng nhánh dispatcher theo contract, không đổi code path chung. **Không bỏ tool đọc ở pha execute**:
  theo đúng `security-gate`, AI vẫn giữ tool đọc Dr.JOY cần thiết để tự kiểm tra bước "Group chưa có bài
  thông báo của đợt này" trước khi đăng — chỉ khoá quyền TỰ SOẠN/SỬA nội dung, không khoá toàn bộ quyền đọc.
  **Giới hạn write tool theo đúng operation cố định, có resolver rõ ràng** (không hardcode 1 tên tool MCP
  duy nhất): định nghĩa mapping hẹp `automation_contract='emergency_announcement_v1' → operation='new_post'
  → {danh sách tool id trong catalog hiện có coi là thực hiện đúng operation này, ví dụ alias
  'create-group-article'}`. Lúc execute, resolver lọc đúng những tool trong danh sách đó đang THẬT SỰ được
  bật trong whitelist hiện hành của máy:
  - Đúng 1 tool khớp và đang bật → cấp đúng tool đó, không cấp gì khác (không dùng nguyên `writeToolsFor('post')`
    vốn cấp cả tool tạo comment).
  - 0 tool khớp đang bật, hoặc ≥2 tool cùng khớp mà không rõ ưu tiên → **fail-closed** (`blocked`, báo rõ lý
    do "chưa xác định được đúng 1 tool đăng bài cho contract này"), không tự chọn đại hay cấp nhiều tool.
  Việc tổng quát hoá operation→tool cho MỌI contract khác vẫn để ở `BL-20260815-007` (ngoài phạm vi CR này)
  — ở đây chỉ cần 1 resolver hẹp, đúng contract `emergency_announcement_v1`.

  **Ranh giới máy-kiểm-được cho "nguyên văn"** (thêm theo Codex §4.67 High #1 — chỉ dặn AI trong prompt
  KHÔNG phải khoá thật, vì Claude vẫn là bên tự dựng tham số gọi MCP tool, app chưa từng thấy/kiểm tham số
  thật trước khi ra ngoài): dùng Claude Code **PreToolUse hook** (`scripts/announcement-write-guard.mjs`) —
  chạy TRƯỚC khi tool call `create-group-article` thật thực thi, nhận đúng `{tool_name, tool_input}`, đối
  chiếu `group_id`/`contents`/`contents_formatted`/`to_user_office_user_ids` với snapshot đã duyệt
  (`automation_preview`), và **CHẶN** (deny) nếu lệch bất kỳ field nào — không chỉ log/cảnh báo sau khi đã
  ghi. Mỗi lượt execute Announcement tự sinh 1 thư mục tạm riêng chứa `settings.json` (nạp hook qua
  `--settings <path>`, chỉ áp cho ĐÚNG lượt gọi này) + `receipt.json` (hook tự ghi lại đã chạy hay chưa,
  khớp hay không). Sau khi Claude thoát, server đọc lại `receipt.json`: **thiếu/không khớp → KHÔNG được coi
  là 'done'** (kể cả khi report tự khai `success:true` và các field khác đều nhất quán) — vì Claude Code có
  thể ÂM THẦM bỏ qua hook nếu workspace chưa "trusted" (giới hạn đã biết của cơ chế hook, không do CR này
  gây ra), receipt vắng mặt là tín hiệu duy nhất phân biệt "đã kiểm và khớp" với "chưa từng được kiểm".

  **Siết thêm sau Codex §4.69** (2 khe hở còn lại của bản đầu):
  1. **Cardinality — chỉ 1 lần allow cho cả lượt.** Bản đầu: mỗi lần payload khớp là mỗi lần allow — Claude
     gọi `create-group-article` 2 lần cùng payload ĐÚNG vẫn đăng được 2 bài (đăng trùng ngay trong 1
     occurrence). Sửa: hook tự tạo 1 file marker bằng flag ghi ĐỘC QUYỀN (`wx`, atomic ở tầng OS, an toàn cả
     khi có race) ngay khi cho allow lần đầu — mọi lần gọi tool ghi tiếp theo trong CÙNG lượt (dù payload có
     khớp hay không) đều bị deny vì marker đã tồn tại. `receipt.json` của lần allow hợp lệ đầu tiên được giữ
     nguyên, không bị lần gọi thừa ghi đè.
  2. **Fail-AFTER-detection, không phải fail-closed thật.** Bản đầu: nếu Claude Code bỏ qua hook NGAY LÚC
     GHI THẬT, `--allowedTools` vẫn chứa tool đăng bài thật — Claude vẫn gọi được, bài (có thể sai) có thể
     đã đăng ra Dr.JOY TRƯỚC KHI server phát hiện thiếu `receipt.json` (chỉ phát hiện được SAU khi Claude đã
     thoát). Sửa bằng 1 lượt **"trust probe"** read-only chạy TRƯỚC khi cấp write tool thật: gắn cùng script
     hook (chế độ probe, không đối chiếu tool_input) vào 1 tool ĐỌC vô hại (`list-groups`), yêu cầu Claude
     gọi tool đó, đối chiếu 1 nonce ngẫu nhiên trong receipt — probe KHÔNG có write tool nào để mất nên an
     toàn tuyệt đối dù hook không chạy. Chỉ khi probe xác nhận nonce khớp mới spawn lượt ghi thật (write
     guard lúc đó mới thật sự đứng chắn trước tool call, không phải "hy vọng nó đứng chắn"); probe fail →
     fail-closed NGAY, không cấp write tool, task giữ nguyên `approved` (chưa giành quyền/claim gì).

  **Giới hạn còn lại, cần UAT thủ công trước go-live** (Codex §4.69 Medium, chưa tự động hoá được trong CR
  này): mọi test hiện có (unit spawn script thật + integration) đều dùng `mock-claude.mjs`, KHÔNG chứng minh
  Claude CLI thật đọc `--settings`, matcher khớp đúng tên MCP tool thật, và thứ tự hook-deny → tool không
  chạy trên máy thật (đặc biệt bản đóng gói SEA/Windows). Trước go-live (Lát 10) cần 1 lượt UAT dùng Claude
  CLI thật + fake MCP write tool không tác động ngoài, xác nhận: (a) hook thật sự chặn được payload sai;
  (b) allow chỉ xảy ra đúng 1 lần khi gọi 2 lần cùng payload đúng; (c) probe thật sự phát hiện được khi hook
  bị bỏ qua (vd thử trên workspace chưa add vào trusted list của Claude Code).

  **Sửa thêm sau Codex §4.71** (2 điểm nhỏ, không đổi thiết kế tổng thể):
  1. **Trust probe phải resolve theo whitelist đọc thật, không hardcode alias.** Bản §4.70 hardcode tool
     probe là `mcp__claude_ai_Dr_JOY_MCP__list-groups` — máy chỉ còn cấu hình alias CŨ
     (`mcp__drjoy__list-groups`, chưa migrate whitelist) thì probe gọi tool KHÔNG nằm trong `allowedTools`,
     Claude không gọi được, nonce không bao giờ khớp → execute luôn 503 dù write resolver đã chọn alias cũ
     hợp lệ cho tool GHI (mâu thuẫn với chính mục tiêu "hỗ trợ cả 2 alias" của resolver ghi). Sửa:
     `resolveAnnouncementTrustProbeTool()` resolve tool probe theo ĐÚNG `executeReadTools` của lượt này,
     cùng thứ tự ưu tiên (alias mới trước, cũ sau) như `resolveAnnouncementWriteTool` — nhất quán xuyên
     suốt cả nhánh đọc lẫn ghi. 0 tool phù hợp trong whitelist đọc hiện hành → fail-closed ngay (không thử
     gọi 1 tool ngoài whitelist).
  2. **Mention ID lặp lại phải bị coi là KHÔNG khớp.** So sánh `to_user_office_user_ids` bằng `Set` trước
     đây coi ID lặp lại trong tool call là "vẫn khớp" (Set tự loại trùng) — nhưng AC đòi "đúng danh sách,
     không thêm/bớt": lặp lại 1 ID đã là THÊM so với danh sách đã duyệt. Sửa: kiểm độ dài mảng bằng nhau
     TRƯỚC (bắt được thừa do lặp), rồi mới kiểm nội bộ mỗi mảng không tự có phần tử lặp, sau đó mới so tập
     hợp không phân biệt thứ tự.
- **FR-15:** Test hồi quy ca 1-team: golden fixture VI/JA mới do Leader duyệt 1 lần trước khi merge — phần
  KHÔNG bị yêu cầu mới đụng tới (ngày giờ deploy, tên team, thứ tự mục) phải giống byte-for-byte với bài thật
  đã đăng hôm nay (chụp lại từ dữ liệu thật làm baseline trước khi sửa code); phần bị yêu cầu mới đổi
  (hyperlink, phạm vi ảnh hưởng, mention theo cấu hình) so với đúng fixture đã duyệt.

## 5. Yêu cầu phi chức năng

- **Bảo mật** (theo `security-gate`): prompt vẫn qua stdin; verifier run KHÔNG được cấp write tool, chỉ tool
  đọc scoped đúng connector (Redmine/Drive/Dr.JOY read) qua whitelist hiện có; execute run cho contract này
  chỉ cấp đúng write tool đăng bài Dr.JOY, không cấp tool khác; timeout+SIGKILL dùng lại cơ chế runner hiện
  có; lần chạy thật đầu tiên nhắm group nháp/test, không phải `VN_Release`/`研究開発部` thật (§10).
- **Hiệu năng:** thêm 1 lượt AI verifier độc lập mỗi lần precheck E6/E7 → tăng thời gian precheck (chấp nhận
  được vì đây là task chạy vài lần/đợt khẩn cấp, không phải vòng lặp tick thường xuyên).
- **Tương thích dữ liệu cũ:** mọi cột mới nullable, definition/task cũ không có `automation_contract` tiếp
  tục chạy đúng pipeline generic hiện tại — không migration bắt buộc phải backfill toàn bộ dữ liệu lịch sử.
- **i18n:** văn bản tiếng Nhật giữ nguyên văn, không dịch; nhãn UI Settings mới theo tiếng Việt như phần còn
  lại của app.
- **Validate input size** (`security-gate`): `PUT /automation/settings/announcement-mentions` giới hạn số
  dòng `teamDm` và độ dài `displayName`/`team` hợp lý (chặn payload bất thường lớn), tương tự giới hạn
  `ANSWER_MAX_LEN` đã áp cho `/automation/answer`.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI

- Màn Settings/AI: thêm khối "Cấu hình mention Announcement khẩn cấp" — 1 ô GM (gõ tên+hint, submit gọi
  FR-10, hiện `displayName` đã resolve hoặc danh sách candidate để chọn), 1 ô "Team luôn có mặt", bảng
  Team↔DM (thêm/xoá dòng, mỗi DM cũng qua FR-10 trước khi thêm vào bảng), 2 danh sách người cố định VN/JP.
  Trạng thái rỗng: chưa cấu hình gì → banner nhắc "chưa cấu hình, E6/E7 sẽ hỏi khi chạy thật". Lỗi resolve
  (0 hoặc nhiều candidate) hiện ngay dưới ô nhập, không cho submit tới khi rõ 1 người.
- Preview automation của E6/E7 (`AiKetQua.tsx` và popup liên quan): hiện đúng Step Tracker theo layout đã
  quy định ở CLAUDE.md — bước "Đang thu thập thông tin" (facts) → "Đang xác minh" (verifier) → "Đã dựng bài,
  chờ duyệt" — không dùng spinner/progress bar giả.
- Popup hỏi chọn candidate: liệt kê đủ candidate kèm evidence, nút chọn gọi `/automation/answer` với
  `candidateId` tương ứng — không phải ô nhập text tự do như hỏi thường.
- Task E3 (`Tạo ticket Release khẩn cấp`) khi rơi vào outcome "chưa xác nhận" (`emergency_ticket_not_confirmed`):
  hiện rõ 2 hành động tách biệt — (1) nút "Kiểm tra lại" (đọc-only, không tạo gì); (2) nếu (1) vẫn không tìm
  thấy, hiện tiếp cảnh báo + 1 xác nhận riêng "Tôi hiểu và muốn thử tạo lại" mới cho phép mở 1 lượt execute
  mới. Không gộp 2 hành động này thành 1 nút "Chạy lại" chung chung.

### 6.2. API & nghiệp vụ

- `PATCH /release/emergency/task-definitions/:id` (route sẵn có, `server/routes/release.ts`): mở rộng nhận
  `automation_contract`/`announcement_locale`, validate `actionType='post'` + enum locale + `template_id`
  tồn tại + group đích suy từ config canonical (không đọc tên definition) trước khi chấp nhận
  `automation_contract='emergency_announcement_v1'` (FR-1). Chỉ set giá trị lên DEFINITION — task MỚI tạo
  sau đó mới snapshot; task cũ không tự đổi theo (xem rollback ở FR-2).
- `POST /schedules/emergency-release/tasks` (route sẵn có, giai đoạn 1): nhận thêm `teams`/`systems` bắt
  buộc, ghi `emergency_release_batches` + insert task trong cùng transaction (FR-3).
- `PATCH /release/emergency-batches/:releaseMonth` (mới, FR-3) — đổi `teams`/`systems` của batch đã tồn tại,
  yêu cầu xác nhận rõ ràng ở FE (không phải side-effect ngầm của việc tạo lại task); 404 nếu batch chưa tồn
  tại (phải tạo qua route giai đoạn 1 trước).
- `POST /automation/settings/announcement-mentions/resolve` (mới, FR-10) — 200 `{resolved|candidates|notFound}`.
- `PUT /automation/settings/announcement-mentions` (mới, FR-9) — 200 khi hợp lệ, 400 nếu có entry thiếu
  `id` hợp lệ, dùng `HttpError` đúng convention (`server/lib/utils.ts:12-21`).
- `POST /automation/answer` (mở rộng, FR-7) — body là union `{taskId, answer}` (giữ nguyên) hoặc
  `{taskId, precheckRunId, candidateId}` (mới); claim bằng conditional `UPDATE ... WHERE automation_status=
  'needs_input' AND json_extract(...)=?`, `changes===1` mới tiếp tục — `changes===0` → 409.
- `POST /automation/emergency-ticket/retry-authorize` (mới, FR-12) — body `{taskId, idempotencyKey,
  confirmation:true}`; conditional `UPDATE ... WHERE automation_status='done_with_warning' AND
  automation_reasons LIKE '%emergency_ticket_not_confirmed%' AND automation_idempotency_key=?` (đối chiếu
  đúng reason code trong cột `automation_reasons` JSON có sẵn, cùng quy ước với các reason code khác đã
  dùng, ví dụ `task_lech_definition`), `changes===1` mới tiếp tục, đưa task
  về `idle` (giải phóng reservation occurrence cũ, giữ nguyên `automation_idempotency_key`) + ghi audit
  `retry_authorized`; `changes===0` → 409. Task về `idle` vẫn phải đi lại đúng precheck→preview→approve→execute,
  không có đường tắt.
- `runPrecheckAndApply()`/`executeApprovedTask()` (`automation.ts`): thêm nhánh dispatcher theo
  `automation_contract` **đã snapshot trên task** (không đọc sống từ definition) — code path cũ giữ nguyên
  hoàn toàn cho mọi task không có giá trị này.

### 6.3. Dữ liệu & schema

**Migration — 2 pha tách biệt (FR-1, giải quyết High §4.37: schema và activation không còn gộp chung):**

*Pha schema (chạy ngay cùng lát code, không kích hoạt gì):*
- `tasks`: + `origin_kind TEXT`, + `automation_contract TEXT`, + `announcement_locale TEXT` (snapshot,
  FR-1, giá trị NULL), + `automation_result_data TEXT` (JSON, nullable), + `automation_idempotency_key TEXT`
  (nullable, tách biệt hoàn toàn khỏi `automation_occurrence_key` có sẵn — FR-12), +
  **`origin_snapshot_hash TEXT`** (nullable — sửa theo Codex §4.49 High #3: hash `(note, template_id, nội
  dung template)` của definition khẩn cấp TẠI THỜI ĐIỂM SINH TASK, dùng để gate FR-2 phát hiện definition
  đổi các field này về sau dù không dựng lại được nội dung Note thật — xem `hashEmergencyDefinitionSnapshot`,
  `server/lib/utils.ts`).
- `release_task_definitions` + `emergency_release_task_definitions`: + `automation_contract TEXT`,
  + `announcement_locale TEXT` (giá trị NULL, chưa seed).
- `emergency_release_batches` (bảng mới, FR-3): `release_month TEXT PRIMARY KEY`, `teams TEXT` (JSON),
  `systems TEXT` (JSON), `created_at TEXT`, `updated_at TEXT`.
- `app_settings`: không đổi schema (key-value sẵn có); thêm 3 key mới
  `automation_announcement_mentions` (FR-9), `automation_announcement_rollout_enabled` (FR-1, mặc định
  `false`) và `automation_announcement_group_allowlist` (FR-6, mặc định rỗng — allowlist group id Dr.JOY
  cho verifier đọc `drjoy_post`, fail-closed nếu chưa cấu hình).
- `GET /release/emergency/task-definitions` trả kèm field mới `revisionHash` (sửa theo Codex §4.51 High —
  chống TOCTOU giữa lúc FE tải definition/template để render task và lúc server thật sự tạo task); FE PHẢI
  mang giá trị này vào field mới `definitionRevision` của MỖI task khi gọi
  `POST /schedules/emergency-release/tasks` — server so `definitionRevision` với hash LIVE ngay trong
  transaction tạo task, reject 409 KHÔNG tạo task nào (kể cả các task khác trong cùng request) nếu lệch
  hoặc thiếu. Đây là hợp đồng API mới, không phải cột DB — không cần migration nhưng PHẢI cập nhật
  `docs/specs/03-api-business-logic-spec.md` cùng lượt với FR-2 khi merge.

*Pha activation (chỉ chạy ở Lát 10B/10C — xem kế hoạch code §4.35):*
- Seed 2 dòng E6/E7 + 1 dòng E3 vào 2 bảng definition tương ứng (FR-1/FR-12).
- Backfill `automation_contract`/`announcement_locale` cho task chưa terminal resolve được đúng 1 definition
  vừa seed **VÀ đồng thời backfill `origin_snapshot_hash`** cho ĐÚNG các task đó (hash tính từ definition/
  template LIVE tại thời điểm activation — đây là lần "chốt mốc" hợp lệ duy nhất cho task cũ, vì tại thời
  điểm activation không còn client nào đang render dở dang). Task nào không backfill được `origin_snapshot_hash`
  (definition/template đã xoá) → giữ NULL, gate FR-2 coi là "không biết" (không đoán, nhất quán AC-6b) —
  KHÔNG được để mãi mãi bỏ qua drift note/template chỉ vì hash NULL: ghi rõ trong go-live guide rằng Leader
  phải rà thủ công danh sách task nào có `origin_snapshot_hash IS NULL` sau activation trước khi coi go-live
  là an toàn.
- Set `automation_announcement_rollout_enabled=true`.
- Toàn bộ trong 1 transaction, fail-closed nếu có task liên quan đang in-flight (xem FR-1).

**Schema `ReadyFacts`/`AiAnnouncementFactsV1`/`PendingAnnouncementContextV1` — discriminated union (sửa
theo Codex §4.20/§4.22/§4.24/§4.30: bỏ mâu thuẫn `fileSchedule`/`candidates` cùng tồn tại trong 1 object
phẳng; bỏ hẳn `systems`/`teams` khỏi output AI — renderer đọc thẳng từ `emergency_release_batches`, tránh
kiểm tra vòng tròn; TÁCH RIÊNG type "AI trả" khỏi type "backend đã enrich" — không dùng chung 1 union nữa;
`candidates[].options` **discriminated theo field**, mỗi option mang đủ thuộc tính để merge thẳng thành
fact đích — không cần suy diễn hay search lại):**
```ts
type ReadyFacts = {
  schemaVersion: 1;
  status: 'ready';
  // KHÔNG có field `systems`/`teams` — renderer đọc thẳng emergency_release_batches (FR-3)
  releaseTickets: Array<{
    team: string;                                        // phải thuộc `teams` của batch (FR-3)
    platforms: Array<'web' | 'mobile'>;                   // không rỗng, không trùng phần tử, có thể cả 2
    ticketId: number;                                     // số nguyên dương
    rawTitle: string;                                     // non-empty, nguyên văn, không tự cắt "|"
    evidence: string;                                     // non-empty, ≤500 ký tự
  }>;                                                      // đúng 1 phần tử / team, không thiếu không thừa
  relateTickets: Array<{ platforms: Array<'web'|'mobile'>; ticketId: number; rawTitle: string; evidence: string }>; // 0-2 phần tử, không trùng ticketId
  emergencyTicket: { ticketId: number; rawTitle: string; evidence: string };   // BẮT BUỘC, không nullable
  threads: Array<{ team: string; postId: string; groupId: string; evidence: string }>;  // đúng 1 / team
  fileSchedule: { fileId: string; evidence: string };      // BẮT BUỘC đúng 1, không nullable trong nhánh ready
  jpVariableMentions: Array<{ id: string; displayName: string; sourcePostId: string }>;  // BẮT BUỘC non-empty khi locale='ja', PHẢI RỖNG khi locale='vi'
};

// Sửa theo Codex §4.28 Medium: TÁCH RÕ 2 pha — AI không thể tự trả `candidateId` (vì `precheckRunId`
// chỉ sinh SAU khi AI trả lời và backend quyết định chuyển `needs_input`). AI chỉ trả connector+resourceId
// thô; backend mới enrich thành candidate có `candidateId` sau khi validate.
type AiOptionBase = {
  connector: 'redmine' | 'drive' | 'drjoy';
  resourceId: string;     // id thật của connector (ticket id, file id, post id) — AI trả, CHƯA có candidateId
  evidence: string;
};
type AiAnnouncementCandidate =                              // <-- shape AI THỰC SỰ TRẢ VỀ trong facts thô
  | { field: 'releaseTicket'; team: string; options: Array<AiOptionBase & { platforms: Array<'web'|'mobile'>; ticketId: number; rawTitle: string }> }
  | { field: 'relateTicket'; options: Array<AiOptionBase & { platforms: Array<'web'|'mobile'>; ticketId: number; rawTitle: string }> }
  | { field: 'emergencyTicket'; options: Array<AiOptionBase & { ticketId: number; rawTitle: string }> }
  | { field: 'thread'; team: string; options: Array<AiOptionBase & { postId: string; groupId: string }> }
  | { field: 'fileSchedule'; options: Array<AiOptionBase & { fileId: string }> };

// Backend transform (SAU khi nhận AI output, validate connector/resourceId, sinh precheckRunId khi quyết
// định chuyển needs_input): enrich mỗi option thành PendingAnnouncementCandidate rồi mới persist/expose cho
// client — đây mới là shape thật sự nằm trong `automation_preview`/trả về FE, KHÔNG PHẢI shape AI trả.
type CandidateOptionBase = {
  candidateId: string;    // backend sinh = hash(precheckRunId, field, slot, connector, resourceId) — xem giải thích `slot` bên dưới; UNIQUE trong toàn precheckRunId
  connector: 'redmine' | 'drive' | 'drjoy';
  resourceId: string;
  evidence: string;
};
// `slot` = khoá phân biệt vị trí lựa chọn trong cùng field — sửa theo Codex §4.28 Medium: thiếu slot khiến
// 2 option cùng resourceId nhưng khác team (2 candidate `releaseTicket` khác nhau) có thể bị hash trùng.
// slot = `team` cho field theo-team (`releaseTicket`, `thread`); slot = hằng số `'_single_'` cho field không
// theo team (`relateTicket`, `emergencyTicket`, `fileSchedule`).
type AnnouncementCandidate =
  | { field: 'releaseTicket'; team: string; options: Array<CandidateOptionBase & { platforms: Array<'web'|'mobile'>; ticketId: number; rawTitle: string }> }
  | { field: 'relateTicket'; options: Array<CandidateOptionBase & { platforms: Array<'web'|'mobile'>; ticketId: number; rawTitle: string }> }
  | { field: 'emergencyTicket'; options: Array<CandidateOptionBase & { ticketId: number; rawTitle: string }> }
  | { field: 'thread'; team: string; options: Array<CandidateOptionBase & { postId: string; groupId: string }> }
  | { field: 'fileSchedule'; options: Array<CandidateOptionBase & { fileId: string }> };
// mỗi `options[]` ≥2 phần tử (đúng 1 phần tử thì không phải candidate, đã resolve thẳng vào partialFacts);
// backend reject nếu 2 option (cùng field hay khác field) trùng `candidateId` trong cùng `precheckRunId`.

// Sửa theo Codex §4.30 Medium: type "facts do AI trả về" và type "pending context backend giữ" là 2 pha
// KHÁC NHAU — trước đây gộp chung 1 union `AnnouncementFactsV1` khiến nhánh `needs_input` vẫn khai
// `AnnouncementCandidate[]` (shape backend-enriched) như thể đó là thứ AI tự trả, sai ranh giới trust.

// (1) Shape AI THỰC SỰ TRẢ VỀ ở bước facts (FR-4) — validator áp đúng type này lên output AI:
type AiAnnouncementFactsV1 =
  | ReadyFacts
  | {
      schemaVersion: 1;
      status: 'needs_input';
      partialFacts: Partial<Omit<ReadyFacts, 'schemaVersion' | 'status'>>;
      candidates: AiAnnouncementCandidate[];                // AI trả, CHƯA có candidateId
    };

// (2) Shape backend GIỮ làm pending context (trong `automation_preview`) sau khi enrich — KHÔNG PHẢI thứ
// AI trả, là kết quả transform của backend sau bước (1):
type PendingAnnouncementContextV1 = {
  schemaVersion: 1;
  precheckRunId: string;
  round: number;                                            // đếm theo MAX_QA_ROUNDS
  partialFacts: Partial<Omit<ReadyFacts, 'schemaVersion' | 'status'>>;  // xem bảng merge rule bên dưới
  candidates: AnnouncementCandidate[];                       // đã enrich candidateId, ≥1 phần tử
};
```
**Chọn candidate — server-side, không tin payload client gửi lại:** `/automation/answer` chỉ nhận
`{taskId, precheckRunId, candidateId}` — client KHÔNG gửi option. Backend đọc `PendingAnnouncementContextV1`
đang lưu trong `automation_preview`, tìm đúng option có `candidateId` khớp trong toàn bộ
`candidates[].options` (reject nếu không tìm thấy — coi như stale/sai run), lấy NGUYÊN VĂN option đã lưu
sẵn đó để merge vào `partialFacts` — không nhận/echo lại payload option từ request.

**Bảng merge rule cho `partialFacts`** (giải quyết Low §4.26 — mỗi field có key & luật upsert riêng, không
merge chung chung):

| Field | Merge key | Luật |
|---|---|---|
| `releaseTickets` | `team` | Thêm mới nếu `team` chưa có trong `partialFacts.releaseTickets`; đã có `team` đó rồi mà lại chọn candidate khác cho cùng `team` → reject (409, "team đã được xác định, không chọn lại") |
| `threads` | `team` | Giống `releaseTickets` — thêm theo team, reject chọn lại cho team đã có |
| `relateTickets` | `ticketId` | Thêm mới nếu `ticketId` chưa có trong danh sách (dedupe theo INV-2); tối đa 2 phần tử theo INV-5 |
| `emergencyTicket` | singleton | Chỉ set 1 lần; đã có giá trị mà chọn candidate khác → reject |
| `fileSchedule` | singleton | Chỉ set 1 lần; đã có giá trị mà chọn candidate khác → reject |
| `jpVariableMentions` | `id` | Append, dedupe theo `id` |

**Bảng invariant (test âm bắt buộc cho từng dòng):**

| # | Invariant | Vi phạm → |
|---|---|---|
| INV-1 | Mỗi team trong `teams` (FR-3) có đúng 1 phần tử `releaseTickets`, không thiếu không thừa | `blocked` |
| INV-2 | `ticketId` trong `releaseTickets` không trùng giữa 2 team khác nhau; `relateTickets` không trùng `ticketId` với nhau | `blocked` |
| INV-3 | Mọi `team` trong `releaseTickets`/`threads` phải thuộc `teams` (FR-3) — không lẫn team ngoài batch | `blocked` |
| INV-4 | `platforms` chỉ chứa `'web'\|'mobile'`, không rỗng, không trùng phần tử | `blocked` (schema hình thức) |
| INV-5 | `relateTickets` tối đa 2 phần tử, mỗi phần tử platform khác nhau (không 2 relate ticket cùng platform) | `blocked` |
| INV-6 | Mỗi team có đúng 1 phần tử `threads` (không thiếu, không thừa — không có khái niệm "thread dùng chung" trừ khi §4 xác nhận lại) | `blocked` |
| INV-7 | `fileSchedule` đúng 1 giá trị, không nullable trong nhánh `ready` — thiếu thì phải ở nhánh `needs_input` với `field='fileSchedule'`, không phải `null` trong nhánh `ready` | schema reject (không parse được thành `ready`) |
| INV-8 | `emergencyTicket` khác với giá trị app đã biết trước (FR-13) | `blocked`, báo lệch, không tự override |
| INV-9 | `jpVariableMentions` bắt buộc có `id` thật (không name-only); rỗng bắt buộc khi `locale='vi'`, không rỗng khi `locale='ja'` | `blocked` (schema hình thức) |
| INV-10 | `rawTitle`/evidence mỗi fact khớp với bằng chứng verifier độc lập (FR-6), đối chiếu 1:1 theo `requestKey` | `blocked` |
| INV-11 | Payload tổng: `releaseTickets`+`relateTickets`+`threads`+`candidates[].options` mỗi mảng ≤ 50 phần tử (chặn payload bất thường lớn) | `blocked` (schema hình thức) |
| INV-12 | `candidateId` của mọi option trong `candidates[]` phải UNIQUE trong toàn bộ `precheckRunId` (kể cả giữa các `field` khác nhau) — không được trùng | `blocked` (schema hình thức) |

### 6.4. Automation / tích hợp

- Verifier run (FR-6): `actionType` nội bộ mới hoặc cờ `mode:'verify'` trong runner — chỉ nhận typed request
  `{kind, id, groupId?, requestKey}[]`, chỉ có tool đọc, không có `content`/`rawTitle` gốc trong prompt
  (tránh mô hình tự xác nhận lại lời chính nó vừa nói). `groupId` cho `drjoy_post` phải nằm trong allowlist
  cấu hình sẵn (danh sách group id hợp lệ), reject nếu AI đưa group id ngoài allowlist.
  Ghi rõ trong comment code + go-live guide: đây là 1 lượt AI đọc lại độc lập, KHÔNG phải xác minh độc lập
  tuyệt đối kiểu adapter deterministic.
- Pending context (FR-7): lưu trong `automation_preview` khi `needs_input`, gồm `precheckRunId` +
  `partialFacts` + `candidates` còn chờ chọn + round hiện tại — sửa `ghiTrangThai` để không xoá preview
  trong case này. Claim/tiếp tục dùng conditional `UPDATE` có predicate, không phải transaction đọc-rồi-ghi.
- Verifier run (FR-6) được **dùng lại nguyên cơ chế** ở bước execute của contract `emergency_ticket_v1`
  (FR-12) để xác nhận `ticketId` Claude vừa tạo là có thật trước khi ghi `automation_result_data` — không
  phải 2 cơ chế verify khác nhau, chỉ khác thời điểm gọi (precheck vs sau execute).
- Resolver tool cho execute (FR-14): tra bảng mapping `automation_contract → operation → tool id` tĩnh
  trong code, đối chiếu với whitelist tool đang bật của máy — fail-closed nếu không ra đúng 1 tool.
- Mọi hành động ghi ra ngoài (đăng bài) vẫn qua đúng cơ chế duyệt hiện có — không có đường tắt nào bỏ qua
  bước approve cho contract mới này.
- `related_ids`/`replyToRef` propagation gap (mục 4 báo cáo kỹ thuật) — không sửa trong CR này, chỉ note lại
  làm rõ vì sao FR-12/13 chọn cách thêm cột `automation_result_data` mới thay vì dựa vào `relatedIds`.

## 7. Phân tích tác động

- [x] Frontend (Settings mới, popup candidate, ô chọn team/systems ở popup tạo batch, Step Tracker preview)
  · [x] API route (7 route mới/mở rộng) · [x] DB/migration (1 bảng mới `emergency_release_batches` + 5 cột
  mới trên `tasks` + 2 cột mới lặp trên 2 bảng definition) · [x] Automation/MCP (dispatcher mới, verifier
  run dùng chung cho precheck lẫn execute, tool resolver riêng)
- [ ] i18n (không có chuỗi dịch mới, chỉ nhãn tiếng Việt) · [ ] Đóng gói SEA/MCP (không đổi cách đóng gói)
  · [x] Bảo mật (xem §5 + `security-gate`) · [x] Dữ liệu cũ/backward-compat (cột nullable, code path cũ
  không đổi cho definition không có `automation_contract`)
- **Rủi ro & giảm thiểu:**
  - AI verifier vẫn là model, không phải xác minh độc lập tuyệt đối (Codex lưu ý §4.15/§4.17) → giảm thiểu
    bằng cách verifier không thấy facts gốc, chỉ thấy id + phải tự đọc lại từ đầu; ghi rõ giới hạn này trong
    comment code và trong go-live guide, không quảng cáo quá mức độ tin cậy.
  - Gate chặn cứng E6/E7 khi lệch definition có thể trì hoãn thông báo giữa lúc khẩn cấp nếu Leader quên
    đồng bộ → giảm thiểu bằng thông báo lỗi rõ ràng "cần đồng bộ lại với definition mới" + hướng dẫn 1 bước
    bấm để đồng bộ (không yêu cầu sửa tay).
  - Cấu hình mention sai (DM/GM chưa cập nhật khi tổ chức đổi người) → giảm thiểu bằng validate resolve lúc
    lưu (FR-10) + cảnh báo rõ field nào chưa cấu hình khi precheck (FR-11).
- **Ảnh hưởng chức năng đang chạy:** 20 task khẩn cấp khác + toàn bộ periodic release không đổi hành vi
  (dispatcher rẽ nhánh theo `automation_contract`, mặc định null/không set = code path cũ nguyên vẹn).

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1):** Given đã chạy XONG pha schema (chưa activation), When đọc `automation_contract` ở BẤT KỲ
  definition nào (kể cả E6/E7/E3), Then luôn `NULL` — pha schema không seed gì. Given đã chạy XONG pha
  activation, When đọc lại, Then đúng `emergency_announcement_v1`/`vi`, `emergency_announcement_v1`/`ja`,
  `emergency_ticket_v1` tương ứng E6/E7/E3; định nghĩa khác vẫn `NULL`.
- **AC-1b (FR-1, cờ rollout):** Given cờ `automation_announcement_rollout_enabled=false` (mặc định) nhưng 1
  task test đã bị set thủ công `automation_contract='emergency_announcement_v1'` (giả lập sửa DB tay/lách
  qua đường khác), When precheck task đó, Then dispatcher vẫn coi như KHÔNG có contract — chạy pipeline
  generic, không phải pipeline mới.
- **AC-1c (FR-1, PATCH fail-closed trước activation):** Given cờ rollout đang `false`, When gọi
  `PATCH task-definitions/:id` cố set `automation_contract='emergency_announcement_v1'`, Then 409 — từ chối,
  không set được cho tới khi cờ `true`.
- **AC-1d (FR-1, activation fail-closed khi in-flight):** Given có 1 task E6 đang `preview` (chưa duyệt) tại
  thời điểm chạy activation migration, When activation transaction kiểm tra in-flight, Then TOÀN BỘ
  activation abort (không seed, không set cờ, không backfill) — không có trạng thái "activation nửa chừng".
- **AC-1e (FR-1, cô lập smoke):** Given cờ rollout `true` VÀ `smoke_release_month='emergency:smoke-test'`,
  và có 1 task E7 THẬT khác (`release_month='emergency:250901'`) đang `idle`/`approved` đủ giờ chạy, When
  scheduler quét task đến hạn, Then task E7 thật đó KHÔNG được dispatcher đưa vào pipeline mới (rơi về
  generic) — chỉ đúng task thuộc `emergency:smoke-test` mới được xử lý.
- **AC-1f (FR-1, revert sau smoke dù lỗi):** Given smoke ở Lát 10B throw lỗi giữa chừng (ví dụ verifier
  timeout), When khối `finally` chạy, Then `automation_announcement_rollout_enabled` vẫn được set về
  `false` và `automation_announcement_smoke_release_month` vẫn được xoá — không treo ở trạng thái bật dở.
- **AC-2 (FR-1):** Given task cũ có `origin_ref` resolve được ở CẢ HAI bảng definition (collision giả lập),
  When backfill `origin_kind`, Then để `NULL` + ghi log cảnh báo, KHÔNG đoán bảng theo prefix id.
- **AC-3 (FR-1):** Given `PATCH task-definitions/:id` set `automation_contract='emergency_announcement_v1'`
  cho definition chưa có `template_id`, When gọi API, Then 400, không lưu.
- **AC-4 (FR-2):** Given task khẩn cấp có `origin_kind='emergency_release'` và definition đã sửa field
  `note`, When precheck, Then nếu definition có `automation_contract='emergency_announcement_v1'` →
  `ready=false`, `reasons[0].code='task_lech_definition'`; nếu là definition khẩn cấp khác → không bị chặn
  nhưng preview có `driftWarning` liệt kê đúng field lệch.
- **AC-5 (FR-3):** Given Leader tạo task giai đoạn 1 mà không chọn đủ team/systems, When submit, Then 400,
  không tạo được `emergency_release_batches` thiếu dữ liệu.
- **AC-6 (FR-4/FR-5):** Given batch 2 team đã có `teams=['Dev5','Dev12']` ở FR-3, When AI facts chỉ trả
  `releaseTickets` cho `Dev5` (thiếu `Dev12`), Then `blocked` theo INV-1 — không phải vì so với chính output
  AI mà so với `teams` đã khai từ FR-3.
- **AC-7 (FR-5):** Given facts có 2 team trả cùng 1 `ticketId` (vi phạm INV-2), When validate, Then
  `blocked`, message nêu đúng ticket/2 team xung đột.
- **AC-8 (FR-5):** Given facts nhánh `ready` có `fileSchedule=null`, When parse schema, Then reject ngay ở
  tầng schema (không phải business rule) — nhánh `ready` không cho phép `fileSchedule` rỗng.
- **AC-9 (FR-6):** Given verifier đọc lại 1 `ticketId` ra tiêu đề khác với `rawTitle` AI facts đã trả, When
  so khớp theo `requestKey`, Then `blocked`, không render bài với `rawTitle` chưa xác minh.
- **AC-10 (FR-6):** Given verifier trả thiếu 1 `requestKey` đã gửi hoặc trả thừa 1 key lạ, When backend đối
  chiếu, Then `blocked`, không coi các key còn lại là "đủ để qua".
- **AC-11 (FR-6):** Given verifier trả về `groupId` cho `drjoy_post` không nằm trong allowlist cấu hình, When
  validate, Then `blocked`.
- **AC-12 (FR-7):** Given AI trả nhánh `needs_input` cho 1 `fileSchedule` (2 file cùng tên khác ngày), When
  precheck, Then `needsInput=true`, `precheckRunId` mới được sinh, câu hỏi liệt kê đủ 2 candidate kèm
  `candidateId`; When Leader gọi `/automation/answer` với đúng `{precheckRunId, candidateId}`, Then precheck
  tiếp tục dùng đúng candidate đã chọn, không tra lại các fact khác đã xong.
- **AC-13 (FR-7):** Given 2 request `/automation/answer` gửi gần như đồng thời với cùng `precheckRunId` và
  cùng `candidateId` (giả lập 2 tab), When cả 2 tới server, Then đúng 1 request được xử lý, request còn lại
  nhận 409.
- **AC-14 (FR-7):** Given `precheckRunId` từ 1 vòng `needs_input` cũ (đã bị thay bởi vòng mới), When gọi
  `/automation/answer` với `precheckRunId` cũ, Then reject (stale), không áp dụng câu trả lời vào pending
  context hiện tại.
- **AC-15 (FR-8):** Given facts hợp lệ đã verify, When render VN, Then mọi `#<ticketId>` là `<a>` trỏ đúng
  `{REDMINE_BASE}/issues/{ticketId}`, `Thread`/`File schedule` là `<a>` chữ "Link", có mục "■ Phạm vi ảnh
  hưởng" đúng `systems`.
- **AC-16 (FR-8):** Given 1 ticket có `platforms=['web','mobile']`, When render, Then ticket đó xuất hiện ở
  cả dòng Web và dòng Mobile, không bị hỏi lại chọn 1 nền tảng.
- **AC-17 (FR-9/FR-10):** Given Leader gõ tên GM chưa từng cấu hình, When gọi resolve và nhận đúng 1 kết quả,
  Then lưu được `{id, displayName}`; When gọi resolve ra 2 candidate, Then KHÔNG cho lưu tới khi chọn rõ 1.
- **AC-18 (FR-11):** Given batch gồm Dev5+Dev12, When resolve mandatory mentions, Then danh sách gồm đúng
  GM + DM(Dev5) + DM(Dev12) + toàn bộ member Dev5/Dev12 + DM(Dev13) + toàn bộ member Dev13 (dedupe theo id).
- **AC-19 (FR-11):** Given batch có team `Dev12` chưa từng có dòng trong `teamDm`, When resolve mandatory
  mentions, Then `ready=false`, message nêu rõ "chưa cấu hình DM cho team Dev12" — không tự bỏ qua team đó.
- **AC-20 (FR-11):** Given locale `ja` mà facts trả `jpVariableMentions` chứa entry name-only (thiếu `id`),
  When validate, Then `blocked` — không union entry thiếu id vào mandatory mentions.
- **AC-21 (FR-12):** Given task E3 execute thành công và report kèm đúng field cấu trúc khớp `ExecuteResult`,
  When `executeApprovedTask` commit transaction, Then `automation_result_data` được ghi cùng lúc task chuyển
  `done`.
- **AC-22 (FR-12):** Given task E3 execute "thành công" nhưng report KHÔNG kèm field cấu trúc hợp lệ (hoặc
  `ticketId<=0`), When hoàn tất, Then task vẫn `done`/`done_with_warning` như bình thường nhưng
  `automation_result_data` vẫn NULL — không bịa artifact giả từ `message` tự do.
- **AC-22b (FR-12):** Given report nói tạo ticket thành công nhưng verifier read-only đọc lại KHÔNG tìm thấy
  ticket đó, When hoàn tất, Then KHÔNG ghi `automation_result_data` dù report tự nhận thành công.
- **AC-22c (FR-12):** Given ticket đã được verifier xác nhận có thật nhưng 1 bước phụ sau đó lỗi (partial
  success), When hoàn tất, Then VẪN ghi `automation_result_data`, trạng thái `done_with_warning`.
- **AC-23 (FR-13):** Given task E3 đã chạy xong trong cùng đợt và có `automation_result_data`, When precheck
  E6/E7 cần `emergencyTicket`, Then dùng thẳng giá trị đó, KHÔNG có lượt AI tự tra Redmine cho field này.
- **AC-24 (FR-13/INV-8):** Given `automation_result_data` của E3 nói ticket `#100`, nhưng facts-AI (do lỗi)
  tự tìm ra `#101`, When validate, Then `blocked`, báo rõ lệch giữa 2 nguồn.
- **AC-25 (FR-14):** Given preview đã duyệt cho E6/E7, When execute, Then `content`/`contentHtml` gửi đăng
  Dr.JOY giống hệt object đã duyệt trong `automation_preview`, không qua `noteToQuillHtml` hay bất kỳ bước
  tự dựng lại nào; `--allowedTools` (hoặc tương đương) chỉ chứa đúng 1 tool `create_group_article`, KHÔNG
  chứa tool tạo comment.
- **AC-25b (FR-14):** Given 0 tool trong catalog khớp operation `new_post` đang bật, hoặc ≥2 tool cùng khớp
  không rõ ưu tiên, When execute, Then `blocked`, KHÔNG tự chọn đại 1 tool hay cấp nhiều tool.
- **AC-25c (FR-14, Codex §4.67 High #1):** Given tool call thật gửi `group_id`/`contents`/
  `contents_formatted`/`to_user_office_user_ids` KHÁC bản đã duyệt (kể cả khi report cuối cùng tự khai
  `success:true` và các field khác nhất quán), When PreToolUse write guard đối chiếu, Then tool call bị
  DENY trước khi thực thi (không chỉ cảnh báo sau khi đã ghi).
- **AC-25d (FR-14, Codex §4.67 High #1):** Given lượt execute Announcement kết thúc mà KHÔNG có
  `receipt.json` write-guard (hook không chạy được, hoặc bị Claude Code bỏ qua vì workspace chưa
  "trusted"), When server đọc lại kết quả, Then KHÔNG được coi là `done`/`done_with_warning` dù report tự
  khai thành công và mọi field khác đều nhất quán — về `unknown_outcome`, giữ khoá occurrence.
- **AC-25e (FR-14, Codex §4.67 High #2):** Given report execute Announcement tự khai `success:true` nhưng
  thiếu `articleId`/group xác định được, HOẶC group trả về khác `preview.groupId` đã duyệt, HOẶC 2 nguồn
  (report field vs URL tách ra) tự mâu thuẫn nhau, When server xử lý kết quả, Then KHÔNG lưu vào
  `drjoy_posted_articles` và KHÔNG chuyển `done`/`done_with_warning` — về `unknown_outcome`, giữ khoá
  occurrence, yêu cầu người dùng tự kiểm tra đích đến.
- **AC-25f (FR-14, Codex §4.69 High #1 — "1 lần cho cả lượt"):** Given tool `create-group-article` được gọi
  ĐÚNG payload đã duyệt 2 lần liên tiếp trong CÙNG 1 lượt execute, When PreToolUse write guard xử lý lần gọi
  thứ 2, Then bị DENY (dù payload y hệt lần đầu đã allow) — chỉ ĐÚNG 1 lần allow cho cả lượt; receipt của
  lần allow hợp lệ đầu tiên KHÔNG bị lần gọi thừa ghi đè mất.
- **AC-25g (FR-14, Codex §4.69 High #2 — trust probe trước khi cấp write tool):** Given lượt "trust probe"
  read-only (chạy TRƯỚC khi cấp write tool thật) KHÔNG xác nhận được hook đã chạy (nonce không khớp/vắng
  mặt), When server xử lý kết quả probe, Then KHÔNG được spawn lượt ghi thật (không cấp write tool), trả lỗi
  fail-closed NGAY, task giữ nguyên `approved` (chưa hề giành quyền/claim) — khác AC-25d (đó là phát hiện
  SAU khi đã ghi thật, đây là chặn TRƯỚC khi có nguy cơ ghi sai ra ngoài).
- **AC-26 (FR-15):** Given ca 1-team đúng dữ liệu fixture đã duyệt, When chạy toàn bộ pipeline mới, Then
  phần ngày giờ/tên team giống byte-for-byte baseline hôm nay; phần hyperlink/phạm vi ảnh hưởng/mention giống
  đúng fixture mới đã Leader duyệt.
- **AC-27 (FR-7):** Given đã hỏi candidate đủ `MAX_QA_ROUNDS=5` lần mà vẫn chưa chọn được, When precheck lần
  kế tiếp, Then chặn với lý do đã hỏi quá số lượt cho phép — giữ nguyên hành vi `AI_ASKED_TOO_MANY` hiện có.
- **AC-28 (FR-1/FR-2, rollback):** Given định nghĩa E6/E7 bị xoá `automation_contract` (rollback) và có 1
  task đang ở đúng 1 trong 5 trạng thái được phép sửa theo FR-2 (`idle`/`preview`/`needs_input`/`blocked`/
  `checking`) đã snapshot contract cũ, When chạy migration rollback, Then task đó được `UPDATE` về
  `automation_contract=NULL` trong cùng thao tác — precheck sau đó rơi về đúng hành vi generic. Given task
  khác đã `done`/`done_with_warning` (dù ở nghĩa thông thường coi là "đã xong", KHÔNG nằm trong 5 trạng thái
  trên), Then giữ nguyên snapshot lịch sử không đổi — rollback KHÔNG chạm tới các task này.
- **AC-29 (FR-3):** Given batch `release_month` đã có `teams=['Dev5']`, When Leader tạo lại task giai đoạn 1
  cùng `release_month` với `teams=['Dev5','Dev12']` (khác dữ liệu cũ), Then 409, không tự ghi đè — phải gọi
  riêng `PATCH /release/emergency-batches/:releaseMonth` mới đổi được.
- **AC-30 (FR-7):** Given precheck có 2 field mơ hồ (fileSchedule + relateTicket) trong cùng 1 vòng, When
  Leader chọn xong candidate cho `fileSchedule` (vòng 1), Then `partialFacts.fileSchedule` được ghi nhận,
  hệ thống hỏi tiếp candidate cho `relateTicket` (vòng 2) mà KHÔNG tra lại `fileSchedule` đã chọn ở vòng 1.
- **AC-31 (FR-3):** Given task E6 của đợt `release_month=X` đang ở trạng thái `preview` (đã xem trước, chưa
  duyệt), When Leader gọi `PATCH /release/emergency-batches/X` để đổi `teams`, Then 409, từ chối — không cho
  đổi batch khi còn preview/approval dựa trên dữ liệu batch cũ chưa được xử lý xong.
- **AC-31b (FR-3):** Given task E6 của đợt `release_month=X` đã `done` (đã đăng xong) còn task E7 cùng đợt
  vẫn `idle` (chưa chạy), When Leader gọi `PATCH .../X` để đổi `teams`, Then 409 — KHÔNG cho đổi dù E7 chưa
  chạy, vì E6 đã đăng theo dữ liệu batch cũ và 2 bài VI/JA cùng đợt không được phép lệch nhau.
- **AC-32 (FR-7):** Given candidate đã lưu sẵn option `{candidateId:'c1', team:'Dev5', platforms:['web'],
  ticketId:123, rawTitle:'...', evidence:'...'}` trong pending context, When Leader chọn đúng `candidateId`
  đó qua `/automation/answer`, Then backend merge NGUYÊN VĂN option đã lưu vào `partialFacts.releaseTickets`
  — nếu request có gửi kèm 1 payload option khác (giả lập client/replay cố tình sửa), Then backend BỎ QUA
  payload đó, chỉ dùng bản đã lưu sẵn theo `candidateId`.
- **AC-32b (INV-12):** Given 2 option (khác field, ví dụ 1 `releaseTicket` và 1 `fileSchedule`) vô tình có
  cùng `candidateId` do lỗi sinh hash, When validate facts, Then `blocked` — không cho phép 2 option trùng
  `candidateId` trong cùng `precheckRunId`.
- **AC-32c (§6.3 ranh giới AI/backend):** Given output thô AI trả về (`AiAnnouncementCandidate[]`) có chứa
  field `candidateId` (AI tự thêm sai quy tắc), When backend parse, Then reject/bỏ qua field lạ đó — AI
  không được phép tự cấp `candidateId`, chỉ backend mới sinh sau khi nhận facts.
- **AC-32d (FR-7 slot):** Given 2 team khác nhau (`Dev5`, `Dev12`) cùng có candidate `releaseTicket` với 1
  option trùng `resourceId` ở cả 2 (ca hiếm nhưng có thể xảy ra), When backend sinh `candidateId` (hash có
  `slot=team`), Then 2 `candidateId` khác nhau — không bị coi là trùng theo INV-12.
- **AC-33 (FR-12):** Given verifier sau execute KHÔNG kết nối được Redmine (timeout), When hoàn tất, Then
  terminal `done_with_warning` với reason `emergency_ticket_not_confirmed`, KHÔNG ghi `automation_result_data`,
  và task này KHÔNG được hệ thống tự động cho chạy lại.
- **AC-33b (FR-12):** Given report khai `ticketId=999` (sai/không có thật) nhưng verifier search theo marker
  `EMG-<taskId>-<automation_idempotency_key>` tìm được đúng 1 ticket thật mang marker đó với `ticketId=888`,
  When ghi kết quả, Then dùng `ticketId=888` (theo marker, không theo số report tự khai) — outcome 1.
- **AC-33c (FR-12):** Given report khai `ticketId=999` không tìm thấy, và verifier search theo marker CŨNG
  không ra kết quả nào, When hoàn tất, Then vẫn là outcome 2 "chưa xác nhận" (KHÔNG còn nhãn
  `confirmed_absent` tự động an toàn) — terminal `done_with_warning`, không tự cho chạy lại; Leader phải chủ
  động bấm "Kiểm tra lại" rồi xác nhận riêng mới được thử tạo lại (xem AC-33e).
- **AC-33d (FR-12):** Given report khai `ticketId=999` không tìm thấy, và verifier search theo marker LỖI
  (không search được), When hoàn tất, Then CŨNG rơi vào outcome 2 — gộp chung với AC-33c, không có nhánh
  "an toàn hơn"/"kém an toàn hơn" nào giữa 2 case này (cả 2 đều chỉ là "chưa xác nhận có side effect").
- **AC-33e (FR-12, retry qua người):** Given task E3 ở outcome 2 (chưa xác nhận), When Leader bấm "Kiểm tra
  lại" mà vẫn không tìm thấy ticket theo marker, Then hệ thống hiển thị cảnh báo rõ và YÊU CẦU Leader xác
  nhận riêng biệt ("tôi muốn thử tạo lại") — KHÔNG có nút "chạy lại" đơn giản nào tự động mở execute mới nếu
  thiếu bước xác nhận này.
- **AC-33f (FR-12, chống trùng khi Leader đồng ý retry):** Given Leader đã xác nhận muốn thử tạo lại (sau
  AC-33e), When execute chạy lần nữa, Then dùng NGUYÊN `automation_idempotency_key` cũ (không sinh key mới)
  và bắt buộc search-trước-khi-tạo theo marker đó — nếu ticket lần trước hoá ra đã có thật nhưng xuất hiện
  trễ (giờ search thấy được), Then dùng thẳng ticket tìm thấy, backfill `automation_result_data`, KHÔNG tạo
  thêm 1 ticket thứ hai.
- **AC-33g (FR-12, tách cột):** Given task E3 vừa được reconcile về `idle` (cơ chế hiện có xoá
  `automation_occurrence_key`), When đọc lại `automation_idempotency_key`, Then giá trị này KHÔNG bị ảnh
  hưởng bởi việc reconcile đó — vẫn giữ nguyên giá trị đã sinh từ lần đầu.
- **AC-33h (FR-12, `retry-authorize`):** Given task E3 đang `done_with_warning` với reason
  `emergency_ticket_not_confirmed` và `idempotencyKey` gửi lên khớp DB, When gọi
  `POST /automation/emergency-ticket/retry-authorize`, Then task chuyển về `idle`, `automation_occurrence_key`
  cũ được giải phóng, `automation_idempotency_key` GIỮ NGUYÊN, có ghi audit `retry_authorized`.
- **AC-33i (`retry-authorize`, sai trạng thái):** Given task đang `idle`/`done` (không phải đúng
  `done_with_warning` + reason `emergency_ticket_not_confirmed`), When gọi `retry-authorize`, Then 409 —
  không cho xác nhận retry một task không ở đúng trạng thái chờ.
- **AC-33j (`retry-authorize`, sai key):** Given `idempotencyKey` gửi lên KHÁC với giá trị đang lưu trên
  task (payload cũ/stale từ UI), When gọi `retry-authorize`, Then 409 — không đổi trạng thái.
- **AC-33k (`retry-authorize`, race 2 request):** Given 2 request `retry-authorize` cùng `taskId` gửi gần
  như đồng thời, When cả 2 tới server, Then đúng 1 request `changes===1` thành công, request còn lại
  `changes===0` → 409.
- **AC-33l (`retry-authorize`, không né duyệt):** Given task vừa `retry-authorize` thành công (về `idle`),
  When Leader chưa chạy precheck/approve lại, Then task KHÔNG thể vào trạng thái `running`/execute — vẫn
  phải qua đủ `checking`→`preview`→`approved` như một task `idle` bình thường, không có đường tắt.
- **AC-34 (FR-1, PATCH definition):** Given `PATCH task-definitions/:id` set
  `automation_contract='emergency_announcement_v1'` + `announcement_locale='ja'` mà cấu hình canonical chỉ
  định nghĩa cặp `(emergency_announcement_v1, vi)` (chưa có cặp `ja` — ca giả lập lỗi cấu hình), Then 400,
  reject — không suy đoán group đích khi cặp `(contract, locale)` chưa được cấu hình.

## 9. Kế hoạch test

- Tầng test dự kiến: ✅ Unit ✅ Integration route ✅ Render component ✅ Smoke thủ công (group nháp)
- Unit: validator theo từng invariant INV-1…INV-12 (test âm riêng từng cái, đặc biệt INV-1/INV-3 phải test
  bằng `teams` từ FR-3, KHÔNG suy từ facts AI); renderer VN/JP với input cố định (snapshot); hàm tách
  `rawTitle` theo `|`; hàm resolve mandatory mentions với nhiều tổ hợp team; validator `ExecuteResult` cho
  `emergency_ticket_v1` (success/partial/timeout/id không hợp lệ).
- Integration route: `runPrecheckAndApply` full flow (facts hợp lệ → verify pass → preview render); gate
  `kiemTraLechDefinition` tổng quát hoá theo `(origin_kind, automation_contract)` (cả 2 bảng, cả 2 chính
  sách chặn/cảnh báo, cả case `origin_kind=NULL`); `/automation/answer` union `{answer}`/`{precheckRunId,
  candidateId}` — hợp lệ/không hợp lệ/hết hạn/stale/**race 2 request đồng thời (đúng 1 thành công, 1 nhận
  409)**/app restart giữa chừng (pending context còn nguyên trong DB); verifier reject khi thiếu/thừa/trùng
  `requestKey`, reject `groupId` ngoài allowlist; `PUT /automation/settings/announcement-mentions` reject
  entry thiếu `id`; execute chỉ nhận đúng 1 write tool `create_group_article`.
- Render component: Settings block mới (trạng thái rỗng/lỗi resolve/candidate); popup chọn candidate; ô
  chọn team/systems bắt buộc ở popup tạo batch giai đoạn 1.
- Smoke thủ công (bắt buộc, theo `security-gate`): chạy end-to-end trên **group Dr.JOY nháp/test**, không
  phải `VN_Release`/`研究開発部` thật — xác nhận hyperlink bấm được đúng ticket thật, mention đúng người thật
  qua ID, verifier bắt được 1 case cố tình cho sai tiêu đề để kiểm chứng cơ chế hoạt động.
- **Chuẩn bị trước khi code (bước 0, bắt buộc cho AC-14):** chụp lại nguyên văn bài VN_Release/研究開発部
  thật gần nhất (đã đăng công khai) làm baseline byte-for-byte TRƯỚC khi sửa code — không thể tái tạo baseline
  chính xác sau khi code đã đổi.

## 10. Kế hoạch triển khai / rollback

- Bước triển khai — **2 pha tách biệt, đúng kế hoạch code §4.35** (sửa theo Codex §4.37 High):
  1. **Pha schema**: migrate cột/bảng mới (rỗng/an toàn, kể cả `emergency_release_batches`), backfill
     `origin_kind` cho task cũ (để NULL nếu collision, không đoán), deploy toàn bộ code Lát 2-9 (dispatcher/
     gate/renderer/execute-lock). Cờ `automation_announcement_rollout_enabled=false` mặc định — dispatcher
     và `PATCH` set-contract đều fail-closed nếu ai đó cố kích hoạt sớm (thủ công sửa DB hoặc gọi API).
     Hệ thống chạy 100% như cũ trong suốt pha này, có thể kéo dài nhiều lần deploy.
  2. **Pha activation, tách 2 bước con** (sửa theo Codex §4.39 High — bật cờ rollout không đủ cô lập smoke
     khỏi task thật khác):
     - **10B (smoke, cô lập phạm vi)**: 1 transaction fail-closed nếu có task in-flight — seed
       `automation_contract`/`announcement_locale` cho E6/E7/E3 → backfill contract cho task cũ chưa
       terminal resolve được → cấu hình group đích tạm trỏ về group Dr.JOY nháp/test (setting, không phải
       hardcode) → set cờ rollout `true` **VÀ** `automation_announcement_smoke_release_month` = đúng
       `release_month` của 1 batch giả tạo riêng cho smoke → chạy smoke; **bọc trong `finally`**: dù pass
       hay throw, set cờ rollout về `false` + xoá `smoke_release_month` ngay khi xong.
     - **10C (go-live thật)**: cấu hình lại group đích về đúng `VN_Release`/`研究開発部` thật → seed/backfill
       lại (idempotent, không trùng lặp) → set cờ rollout `true`, **để `smoke_release_month` là `NULL`**
       (không giới hạn phạm vi nữa) → Leader xác nhận ngay trước khi commit → dùng cho đợt khẩn cấp thật đầu
       tiên, theo dõi sát.
- Rollback: **xác nhận trước không còn task E6/E7 nào đang `approved`/`running`** (chờ hoặc dừng thủ công
  nếu có) → set cờ `automation_announcement_rollout_enabled=false` (đủ để tắt ngay, dispatcher rơi về
  generic tức thì, không cần đụng dữ liệu contract) → (tuỳ chọn, nếu muốn dọn sạch) xoá/để trống
  `automation_contract` ở definition E6/E7/E3 → chạy `UPDATE` đồng bộ về task chưa chạy như đã nêu ở FR-2;
  `emergency_release_batches` và các cột DB mới để nguyên (không ảnh hưởng dữ liệu cũ); task `done`/
  `done_with_warning` giữ nguyên snapshot lịch sử.

## 11. Docs cần cập nhật sau khi làm xong

- [x] `docs/specs/03-api-business-logic-spec.md` — thêm §2.3 (dispatcher, execute-lock, E3 recheck/retry-
  authorize, PATCH validation, activation)
- [x] `docs/specs/04-database-design.md` — cột mới trên `tasks` + 2 bảng definition, bảng
  `emergency_release_batches`, key `app_settings` mới
- [x] `docs/rules/07-rules-backend.md` — thêm §9.2 (dispatcher theo `(origin_kind, automation_contract)`,
  verifier độc lập, PATCH validate trạng thái hiệu lực)
- [ ] `docs/ai-prompts/release/emergency-release.md` (viết lại toàn bộ mục F1/F2 theo pipeline mới) —
  **CHƯA làm**: nội dung F1/F2 hiện tại mô tả quy trình THỦ CÔNG cũ (AI tự tra Redmine/Drive bằng tool đọc,
  mapping DM hardcode trong prompt) — pipeline mới thay thế bằng facts-pipeline + mention config động
  (specs/03 §2.3). Đây là nội dung nghiệp vụ ảnh hưởng trực tiếp hành vi AI khi đăng lên group thật, nên cần
  Leader review/duyệt lại cùng lúc chuẩn bị go-live (Lát 10C), không tự ý viết lại một chiều ở đây.
- [x] `docs/operations/automation-ai-go-live-guide.md` — thêm §10 (activation script + thứ tự
  UAT→smoke→golive + mở rộng gate `task_lech_definition`)
- [x] `docs/backlog/README.md` — cập nhật ghi chú tiến độ thật cho cả 2 item (chưa chuyển `Done`, đúng ý
  gốc "khi CR nghiệm thu" — CR mới `Đã triển khai`, chưa `Đã nghiệm thu`)

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude + Codex | 2026-08-22 | ✅ DoR |
| Người triển khai | | | ⬜ |
| QA nghiệm thu | | | ⬜ |
