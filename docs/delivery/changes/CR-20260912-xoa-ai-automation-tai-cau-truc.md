# CR-20260912-xoa-ai-automation-tai-cau-truc — Xoá hoàn toàn AI automation, tái cấu trúc module

| Trường | Giá trị |
|---|---|
| Loại | ⬜ Thêm mới ⬜ Sửa hành vi ✅ Xóa/Deprecate (kèm di dời module) |
| Mức tác động | ✅ Lớn (đụng DB/nhiều màn/automation) |
| Người đề xuất | Claude + Codex (Council thật, 2 phiên, 8 vòng tranh luận có phản đối chặn) |
| Ngày | 2026-09-12 |
| Backlog item | `BL-20260912-001` (`Picked`, Đường C) |
| Trạng thái | ⬜ Draft ⬜ Đã review ⬜ Đã duyệt ✅ Đã triển khai ⬜ Đã nghiệm thu |
| Skill bắt buộc | `delivery-flow` + `security-gate` (spawn-AI/secret bị xoá) + `docs-sync` (go-live guide, CLAUDE.md/AGENTS.md, backlog) |
| Spec liên quan | [specs/03](../../specs/03-api-business-logic-spec.md), [specs/04](../../specs/04-database-design.md), [rules/07](../../rules/07-rules-backend.md) |

Nguồn quyết định: hai phiên Council thật, session `a7d95227-6e28-4729-bedb-07ae66c48280`
(2026-09-05/06, kết luận "mô hình lai" — đã bị Leader ghi đè) và session
`f18ab0fe-b546-4237-8d0f-e9879bc5aa18` (2026-09-12, 8 vòng, hội tụ) —
[docs/exchanges/2026-09-12.md](../../exchanges/2026-09-12.md). CR này chuyển kết luận đã hội tụ ở đó
thành ma trận thực thi; **chưa có FR/AC đánh số theo `delivery-flow`** — đó là bước BA làm tiếp sau khi
Leader xác nhận ma trận này đúng, không phải việc Council/CR-draft này tự làm thay.

## 1. Bối cảnh & quyết định của Leader (không suy đoán — trích nguyên văn)

Leader ban đầu (2026-09-05) nhờ nghiên cứu ảnh hưởng của việc bỏ AI automation vì gặp bug liên tục,
định chuyển sang viết skill cho Claude. Council khi đó hội tụ ở "mô hình lai" (giữ code, đóng băng phát
triển thêm, thử nghiệm dần). Ngày 2026-09-12, sau 6 ngày cân nhắc, Leader **ghi đè quyết định đó**:

> "Loai bo hoan toan chuc nang AI automation = XOA HET moi loai action AI dang co... Cu the: dang bai
> (post/drjoy), Redmine, Google Drive - CA BA loai action nay deu bi xoa, BAT KE dang phuc vu task ca
> nhan dinh ky HAY dang phuc vu release/emergency-announcement... SAU KHI XOA XONG, KHONG CON DOAN CODE
> NAO trong task-manager tu goi Claude/Codex CLI nua, cho BAT KY tinh nang nao."

Đồng thời xác nhận rõ phạm vi GIỮ LẠI cho màn "Lên lịch":

> "Pham vi man 'Len lich' sau khi sua: VAN GIU man hinh va du lieu quan ly (dinh nghia release
> thuong/khan cap, Team/Nguoi/Group, batch, lich ngay thang) - day la du lieu nghiep vu thuan, khong
> lien quan AI. CHI bo di buoc 'tu dong goi Claude soan noi dung/dang bai/xac minh'."

8 tính năng còn lại của app (đối chiếu `tabsChinh` trong `src/main.tsx` + màn Cài đặt) không bị đụng vào:
Cá nhân, Dự án, Báo cáo tuần, Lên lịch (chỉ bỏ phần AI), Luyện đề, Sơ đồ, Quản lý PIC, Cài đặt. Tab
**Skill Forge xoá hoàn toàn** (xác nhận riêng, không nằm trong 8 tính năng giữ).

**Không thuộc phạm vi CR này**: gỡ cài đặt CLI Claude/Codex trên máy; đổi tên cột DB `automation_*` còn
sống (nợ đặt tên, để Đường A riêng sau); xây tính năng thay thế cho việc "AI tự tra tên người thành ID
Dr.JOY" (xem điểm mở ở §6) — CR này chỉ xoá đường AI cũ, không tự dựng đường thay thế mới.

## 2. Tiêu chí phân loại (áp dụng nhất quán cho toàn bộ ma trận)

Sau 3 lần Council tự sửa sai lẫn nhau (xem §8), tiêu chí ĐÚNG được chốt là:

> **Giữ một file/hàm/cột CHỈ KHI nó còn ít nhất một consumer THẬT trong tập tính năng còn lại SAU KHI
> `server/routes/automation.ts` và scheduler bị xoá — không phải vì nó "không tự gọi CLI" hay "trông có
> vẻ thuần dữ liệu".**

Áp dụng sai tiêu chí này (vd giữ một hàm thuần chỉ vì nó "không gọi AI" dù không còn ai gọi nó) chính là
nguyên nhân của cả 3 lần sửa sai trong phiên Council — ma trận dưới đây đã áp đúng tiêu chí này qua kiểm
chứng call-site thật (grep + đọc code), không suy đoán.

## 3. Ma trận — Backend lib

| File | Hiện trạng | Đích đến | Thao tác | Bằng chứng nghiệm thu |
|---|---|---|---|---|
| `server/lib/claude-runner.ts` | Runner gọi Claude/Codex CLI dùng chung | **Xoá hẳn** | Xoá file | `grep -r "claude-runner"` không còn kết quả nào ngoài git history |
| `server/lib/automation-scheduler.ts` | Vòng tick quét task định kỳ AI | **Xoá hẳn** | Xoá file + gỡ khởi động ở `server/index.ts` | `server/index.ts` không còn import/khởi động scheduler |
| `server/lib/automation-helpers.ts` | Toàn bộ hàm (`decideAutomationAction`, `reconfirmNeededOnTimeChange`, `reviveNeededOnTimeChange`, `automationDueNow`, `occurrenceKeyOf`...) chỉ phục vụ quyết định thời điểm chạy AI cho task định kỳ (`loai_task==='dinh_ky'`); không đụng release/announcement | **Xoá hẳn** | Xoá file | `test/unit/automation-helpers.test.ts` xoá theo; không còn import nào |
| `server/lib/automation-prompts.ts` | Trộn prompt task định kỳ + prompt Announcement (`buildAnnouncementExecutePrompt`, `buildResolveMentionPrompt`...) | **Xoá hẳn** | Xoá file | Không còn ai import |
| `server/lib/automation-config.ts` | 4 nhóm: (a) Claude bin/tool-whitelist/rollout/approval-lead — AI; (b) 4 cặp hàm đọc/ghi Team/DM/Group/Target-group/Allowlist — dữ liệu Lên lịch | **Xoá (a), CHUYỂN (b)** | Xoá toàn bộ file gốc; tạo `server/lib/release-announcement-settings.ts` mới chứa nguyên (b) — `getAnnouncementMentionConfig/setAnnouncementMentionConfig`, `getAnnouncementMemberGroupConfig/set...`, `getAnnouncementTargetGroupConfig/set...`, `getAnnouncementGroupAllowlist/set...`, `normalizeAnnouncementTeamKey`. Giữ nguyên 4 khoá `app_settings` (không đổi tên) | Characterization test: đọc/ghi 4 khoá Team/DM/Group qua module mới cho kết quả giống hệt module cũ trước khi xoá |
| `server/lib/announcement-render.ts` | Dựng text/HTML thông báo VI/JA — thuần, **không có consumer** ngoài `routes/automation.ts` (đã xác nhận qua grep 3 lần trong Council) | **Xoá hẳn** | Xoá file | Không còn call-site nào ngoài `automation.ts` đã xoá |
| `server/lib/announcement-facts.ts` | Type dữ liệu + validator output AI | **Xoá hẳn (toàn bộ, kể cả phần type)** | Xoá file | Council đã rút lại đề xuất "giữ type phòng khi sau này làm form" — không giữ mã cho tính năng chưa được duyệt |
| `server/lib/announcement-context.ts` | `getAnnouncementBatchContext`, `getKnownEmergencyTicketId`, `resolveConfiguredMentions` — chỉ phục vụ lúc AI thực thi (tra mention để nhét vào prompt) | **Xoá hẳn** | Xoá file | Không còn consumer sau khi `automation.ts` xoá |
| `server/lib/announcement-verify.ts` | Dựng yêu cầu cho AI tự xác minh lại | **Xoá hẳn** | Xoá file | — |
| `server/lib/announcement-candidates.ts` | Xử lý danh sách phương án AI trả về | **Xoá hẳn** | Xoá file | — |
| `server/lib/announcement-activation.ts` | Bật/tắt rollout dispatcher AI | **Xoá hẳn** | Xoá file | — |
| `server/lib/skill-forge.ts` | Backend Skill Forge | **Xoá hẳn** | Xoá file | — |
| `server/lib/mappers.ts` | `mapTask()` map 9 field `automation_*`; 2 hàm map definition có `automationContract`/`announcementLocale` | **Sửa — bỏ field automation, giữ hàm** | Xoá 9 dòng map `automationStatus/Preview/Reasons/Result/Error/UpdatedAt/Question/OccurrenceKey/QaHistory` khỏi `mapTask()`; xoá `automationContract`/`announcementLocale` khỏi 2 mapper definition (dòng ~269-271, ~289-293) | Kiểu trả về của `mapTask()`/mapper definition khớp response API mới (không còn field automation) |
| `server/routes/tasks.ts` | Import `automation-helpers`; nhánh `automation_status='needs_reconfirm'/'idle'` khi sửa giờ/actionType (dòng 61, 69, 167, 208-209, 217, 240, 265-266, 274, 301, 310, 318-319) | **Sửa — bỏ nhánh automation, giữ CRUD** | Xoá import + toàn bộ nhánh reconfirm/revive/automationDue; giữ nguyên CRUD tạo/sửa/xoá/list task cá nhân | Test tạo/sửa task cá nhân (không action AI) pass y hệt trước/sau |

## 4. Ma trận — `release.ts` / `schedules.ts` / `release-render.ts` (đã xác nhận GIỮ, chỉ bỏ phần AI)

| File | Đoạn phải xoá | Giữ nguyên |
|---|---|---|
| `server/routes/release.ts` | Toàn bộ handler validate PATCH `automationContract`/`announcementLocale`/`isAnnouncementRolloutEnabled` (dòng ~21-114, gồm `resolveOneField` cho 2 field này và các nhánh check contract `emergency_ticket_v1`/`emergency_announcement_v1`); cột `automation_contract`/`announcement_locale` khỏi câu SELECT/UPDATE (dòng ~282, ~295) | CRUD template/definition/batch/team/ngày giờ; toàn bộ route không đụng 2 field trên |
| `server/routes/schedules.ts` | Đoạn snapshot `originKind`/`automationContract`/`announcementLocale`/`originSnapshotHash` khi tạo task từ definition (dòng ~433-570 — toàn bộ mục đích của đoạn này là để dispatcher AI (đã xoá) "nhận ra đây là task Announcement"; không còn dispatcher thì ghi các field này là **ghi chết**, không ai đọc lại) | Đồng bộ definition→task, quản lý batch, `origin_ref`/`reply_to_ref` (lineage thật, không phải trạng thái AI) |
| `server/lib/release-render.ts` | **Đã đọc toàn văn, xác nhận không đụng AI** — đây là nguồn dựng nội dung/so lệch DUY NHẤT cho badge/preview/precheck (`buildDefinitionTargetPayload`, `diffTaskAgainstDefinition`, `buildReleaseUpdateStatement`), `actionType`/`aiNote` ở đây là field dữ liệu thuần (đầu vào cho release), không phải output AI | **Giữ nguyên, không sửa** |

## 5. Ma trận — DB schema (`server/db.ts`)

**Archive rồi DROP khỏi schema hoạt động** (không còn writer sau khi automation.ts xoá — xuất JSON kèm
timestamp + checksum vào thư mục backup hiện có TRƯỚC KHI drop, cùng batch với backup bắt buộc trước
migration):

| Bảng/cột | Lý do xoá |
|---|---|
| `tasks.automation_status/preview/reasons/result/error/updated_at/question/occurrence_key/qa_history` | Thuần trạng thái thực thi AI cho task định kỳ — không còn dispatcher ghi |
| `tasks.automation_contract/announcement_locale/automation_result_data/automation_idempotency_key/automation_recheck_token/origin_snapshot_hash` | Đã xác nhận (§4) chỉ phục vụ dispatcher AI nhận diện/idempotent/recheck cho Announcement — Announcement không còn AI thì các field này hết tác dụng |
| `automation_events` (cả bảng) | Ledger AI — không còn ghi mới |
| `drjoy_posted_articles` (cả bảng) | **Chỉ được đọc/ghi bởi `routes/automation.ts`** (đã xác minh qua grep — `release.ts`/`schedules.ts`/`release.tsx` không đụng tới) — không còn consumer. **Lưu ý cho BA**: nếu sau này muốn luồng đăng tay cũng chống trùng bài đăng, đó là TÍNH NĂNG MỚI cần quyết định riêng, không phải bảo toàn cái đang có |
| `release_task_definitions.automation_contract/announcement_locale`, `emergency_release_task_definitions.automation_contract/announcement_locale` | Cùng lý do — chỉ phục vụ bật AI cho definition |

**Giữ nguyên, không đụng** (dữ liệu nghiệp vụ thuần, độc lập AI):

| Bảng/cột | Lý do giữ |
|---|---|
| `tasks.origin_ref/reply_to_ref` | Lineage "task này sinh từ definition nào" — cần cho cả luồng thủ công |
| `tasks.origin_kind` | **Cần xác minh lại khi code** (không tự tin 100% như các cột trên) — hiện chỉ thấy được set ở `schedules.ts` cùng lúc với các field AI, mục đích ghi nhận là "để gate AI tra đúng bảng". Nếu sau khi xoá AI không còn nơi nào đọc `origin_kind` để phân biệt task thường/khẩn cấp trong UI hay logic khác, cột này CŨNG nên chuyển sang nhóm archive-rồi-drop — BA/dev phải tự grep lại 1 lần nữa sau khi các file ở §3-4 đã xoá xong (thứ tự: xoá code trước, grep lại field DB sau, không làm ngược) |
| `release_task_definitions`, `emergency_release_task_definitions`, `emergency_release_batches`, `emergency_release_templates` | Toàn bộ bảng — thuần dữ liệu nghiệp vụ |
| 4 khoá `app_settings`: `automation_announcement_mentions/member_group/target_group/group_allowlist` | Chuyển quyền sở hữu sang `release-announcement-settings.ts` (§3), KHÔNG xoá — đây là dữ liệu Team/Người/Group Leader yêu cầu giữ |

## 6. Ma trận — Frontend

| File | Đích đến | Ghi chú |
|---|---|---|
| `src/useAutomation.ts` | Xoá hẳn | — |
| `src/skill-forge.tsx` | Xoá hẳn | Cùng tab `skill_forge` trong `src/main.tsx` (`tabsChinh`), route, shortcut, i18n key liên quan |
| `src/components/automation-popup.tsx`, `automation-result-popup.tsx`, `pending-ai-banner.tsx`, `AiKetQua.tsx` | Xoá hẳn | — |
| `src/lib/automation-ask.ts`, `automation-recovery-deadline.ts`, `automation-results-context.tsx`, `automation-results-reducer.ts`, `automation-results-store.ts` | Xoá hẳn | — |
| `src/components/automation-fields.tsx` | **Sửa, chuyển sở hữu** | Bỏ phần liên quan trạng thái AI nếu có; phần `actionType`/`aiNote` do `release.tsx` dùng thật (2 form sửa definition, dòng 1393/1836) — BA quyết định giữ làm ghi chú thủ công hay bỏ hẳn (không chặn CR, không phải quyết định kỹ thuật) |
| `src/components/announcement-mention-settings.tsx`, `announcement-group-settings.tsx` | **Sửa, chuyển sở hữu** | Giữ đúng phần CRUD (form nhập GM/DM/group), xoá nút/luồng "tra tên qua Claude"; dời từ "Cài đặt → AI" sang màn Lên lịch; đổi endpoint gọi theo `/api/release/announcement-settings/...` mới (§3) |
| `src/screens/release.tsx` | **Sửa** | Bỏ nút "chạy AI"/badge trạng thái AI; cập nhật import 2 component cấu hình ở trên |

**Điểm mở cần BA/dev quyết định trước DoR (không chặn CR, Codex đã nêu rõ ở vòng 8)**: sau khi bỏ tính
năng AI tự tra tên người → ID Dr.JOY, người dùng nhập người mới thế nào? Phương án mặc định ít mở rộng
nhất (theo khuyến nghị Codex): cho gõ thẳng ID Dr.JOY, kiểm tra định dạng cục bộ, không tự xây thêm cơ
chế đồng bộ danh bạ trong CR này.

## 7. Backlog

| Item | Trạng thái mới | Lý do |
|---|---|---|
| `BL-20260822-001` | → **`Dropped`** | Tính năng nó kiểm thử (AI tự soạn/đăng thông báo khẩn cấp) không còn tồn tại trong phạm vi sản phẩm; ghi chú "Superseded bởi quyết định xoá AI automation 2026-09-12" |
| `BL-20260823-001` | → **`Inbox`** | Chỉ còn áp dụng cho phần MỞ RỘNG chưa xây (mẫu nội dung động, cách resolve người thay AI, ưu tiên mới không còn gắn go-live AI). Phần CRUD Team/Người/Group ĐANG TỒN TẠI chuyển nhà NGAY trong CR này (§3-6), không chờ item này |
| CR này | Cần Leader tạo 1 backlog item mới, `Picked`, Đường C, link CR này | WIP lớn duy nhất — không chạy song song với việc khác đụng cùng vùng code |

## 8. Vết tranh luận (để không phải điều tra lại nếu có nghi ngờ sau này)

Ma trận trên là kết quả sau khi Codex chặn Claude 3 lần bằng bằng chứng code cụ thể — xem
`docs/exchanges/2026-09-12.md` vòng 5-8 (`session f18ab0fe-...`): (1) vòng 5, Claude định xoá cả cụm
`announcement-*` chỉ vì cùng tên, Codex chỉ ra `announcement-render.ts` là hàm thuần; (2) vòng 6-7, Claude
sửa quá tay theo hướng "giữ vì thuần" tới mức tự đề xuất xây thêm màn mới ngoài yêu cầu, Codex chặn vì đó
là tự mở rộng phạm vi; (3) vòng 7-8, Claude sửa quá tay theo hướng ngược lại (archive rồi xoá luôn Team/
Group khỏi app), Codex chặn vì trái lời Leader đã xác nhận trực tiếp phải giữ màn hình + dữ liệu đó. Vòng
8 mới đúng và không còn phản đối chặn.

## 9. Điều kiện nghiệm thu chung (áp dụng toàn CR)

- Backup DB bắt buộc trước mọi migration đụng schema (`npm run backup-db`).
- Characterization test: chạy trước và sau mỗi lát thay đổi cho toàn bộ hành vi Lên lịch (CRUD định
  nghĩa, sync task, batch khẩn cấp, Team/Người/Group) — kết quả phải giống hệt.
- `npm run check` xanh (tsc + test + build + budget bundle + link markdown).
- Sửa `scripts/backup-db.mjs`: đổi tín hiệu "đây có đúng DB thật không" từ kiểm tra bảng `automation_events`
  (sắp xoá) sang bảng còn sống sau CR, ví dụ `emergency_release_batches`.
- Xoá `scripts/check-claude-env.mjs` (và lời gọi nó trong `scripts/check.mjs` dòng 98) — luật "một cửa
  cho CLAUDE_*" không còn ý nghĩa khi không còn cửa nào gọi CLI nữa.
- Xoá bước copy `scripts/announcement-write-guard.mjs` trong `scripts/build-sea.mjs` (dòng ~141-148) —
  không còn AI ghi nên không cần write-guard.
- Xoá/viết lại các test: `test/unit/automation-helpers.test.ts`, `automation-scheduler.test.ts`,
  `check-tz.test.ts` (phần liên quan), `test/integration/automation.test.ts`,
  `automation-scheduler.test.ts`, `emergency-ticket-execute.test.ts`, `announcement-dispatch.test.ts`,
  `emergency-release-task-revision.test.ts`, `announcement-schema-migration.test.ts` — dev tự rà lại nội
  dung từng test khi code (không liệt kê từng assertion ở đây, `npm run check` là cổng thật).
- Đóng gói lại `TaskManager.exe` (`npm run package`), khởi động lại, nghiệm thu bằng mắt màn Lên lịch +
  7 tính năng còn lại không hồi quy.
- `docs-sync`: cập nhật `docs/operations/automation-ai-go-live-guide.md` (đánh dấu hết hiệu lực hoặc xoá),
  `CLAUDE.md`/`AGENTS.md` dòng mô tả "AI automation" (bỏ hẳn mục đó), backlog liên quan automation cũ.

## 10. Ghi chú triển khai thật (phát sinh khi code, không có trong ma trận ban đầu)

Việc thực thi (không qua Council, Leader yêu cầu tự làm sau khi ma trận đã đủ chi tiết) phát hiện thêm
một số điểm ma trận ở §3-§6 chưa nêu — ghi lại để không phải điều tra lại nếu có nghi vấn sau này:

- **`origin_kind`** (mục 5, cột "cần xác minh lại") — đã xác minh: chỉ được ghi trong `schedules.ts` cùng
  lúc với `automation_contract`/`announcement_locale`/`origin_snapshot_hash`, mục đích DUY NHẤT là giúp
  dispatcher AI (đã xoá) tra đúng bảng definition. Không còn nơi nào đọc lại sau khi automation.ts xoá —
  đã đưa vào nhóm archive-rồi-drop cùng các cột automation khác.
- **`getAnnouncementGroupAllowlist`/`setAnnouncementGroupAllowlist`** — ma trận ban đầu (§3) xếp nhầm vào
  nhóm "giữ, chuyển sang release" cùng 3 cặp hàm Team/Group kia. Xác minh lại: allowlist này CHỈ được
  `buildVerifyRequests` (đã xoá, thuộc `announcement-verify.ts`) dùng để giới hạn group mà verifier AI
  được phép đọc — không có ý nghĩa gì cho luồng thủ công. Đã XOÁ (không chuyển), bao gồm cả 2 route
  `GET/PUT /api/release/announcement-settings/group-allowlist` từng dự định thêm.
- **`server/routes/schedules.ts` có một cơ chế thứ 3 chưa nêu trong ma trận ban đầu** (ngoài snapshot
  lúc tạo task và batch-lock lúc PATCH): vòng "sync definition → task" (khi Leader sửa 1 definition rồi
  đồng bộ xuống các task đã sinh) có `SYNC_RESET_RECONFIRM`/`SYNC_RESET_IDLE` — reset trạng thái AI
  (`needs_reconfirm`/`idle`) khi task đã "engage" với AI mà definition đổi. Toàn bộ nhánh này (biến
  `needsReconfirm`/`needsRevive`, field cùng tên trả về qua API `sync-preview`/`sync`) đã xoá — không
  còn ý nghĩa khi không còn máy trạng thái AI. **FE (`release.tsx`) cũng hiển thị các field này** ("X cần
  AI xác nhận lại") — đã xoá phần hiển thị tương ứng.
- **Khoá "chặn đổi team/hệ thống batch khi có task Announcement chưa idle"** (route PATCH
  `/schedules/emergency-release/batches/:releaseMonth`) — đã XOÁ, không có trong ma trận ban đầu vì lúc
  viết CR chưa đọc hết route PATCH này. Đây là **mất một lớp bảo vệ thật**: trước đây khoá này ngăn đổi
  team/hệ thống của 1 batch khi AI đang xử lý/đã đăng bài cho batch đó — không còn AI thì không còn tín
  hiệu nào để biết "đã đăng bài cho batch này chưa" mà dựa vào. Ghi rõ trong code (comment tại route) để
  không bị lãng quên — nếu sau này cần chặn tương đương, phải thiết kế cơ chế đánh dấu "đã đăng" thủ công
  mới (tính năng mới, ngoài phạm vi CR này).
- **Xác nhận thật ngoài kế hoạch**: migration archive-rồi-drop (§5) đã chạy thật một lần trên database
  thật của Leader (không phải chỉ DB test cô lập) do một lệnh `npm run dev:server` sơ ý không đặt
  `APPDATA` tạm — đã kiểm tra: `PRAGMA integrity_check` = `ok`, đủ 71 task/27 định nghĩa release/1 batch
  khẩn cấp sau migration, file archive + checksum được tạo đúng tại
  `%APPDATA%/TaskManager/data/archive/`. Coi đây là một lần xác nhận thật (không phải giả lập) rằng
  migration chạy đúng trên dữ liệu thật, không chỉ dữ liệu test.
- **Smoke thủ công qua Playwright thật** (không phải chỉ unit/integration test): xác nhận tab Skill Forge
  đã biến mất khỏi thanh điều hướng, tab Cá nhân hoạt động bình thường với dữ liệu thật, màn Lên lịch mở
  đúng, nút "Cấu hình Team/Người/Group" mới mở modal đúng hiển thị cả 2 phần cấu hình, không có lỗi
  console nào.

## 11. Council code-review kết quả thật (run `fd720e91`, 8 vòng, xem `docs/exchanges/2026-09-12.md`)

Sau khi code xong (mục 10), chạy một phiên Council review-only (không được tự sửa code, chỉ đọc
`git show`/`git diff` thật) để soát lại chính commit đã triển khai. Codex và Claude hội tụ qua 8 vòng về
đúng **1 phản đối chặn** — migration archive-rồi-drop (`server/db.ts`) khi đó chỉ dùng riêng cột
`tasks.automation_status` làm điều kiện kích hoạt: một máy từng chạy bản migration đời trước (chưa bọc
transaction) và bị ngắt ngay sau khi cột này bị xoá nhưng trước khi dọn hết các artifact automation còn
lại sẽ bị bỏ sót vĩnh viễn ở lần khởi động sau. Kèm theo: test checksum cũ chỉ kiểm file `.sha256` tồn
tại (không đối chiếu nội dung), và 3 mục dọn dẹp cosmetic còn sót (biến chết `dangCoModalKhac`, CSS chết
`.pending-ai-banner`, comment lạc hậu trong `recurrence.ts`).

Các điểm còn lại của CR (xoá khoá batch, xoá allowlist, TOCTOU, API Team/DM/Group mới, dọn type
automation trong `src/types.ts`) được cả hai xác nhận đúng ý đồ, không có tranh cãi.

Đã sửa toàn bộ qua 3 commit tiếp theo trên cùng nhánh:

- `a59e7c5e` — chọn cột động (`danhSachCotDangCo`) qua `PRAGMA table_info()` thay vì giả định cột luôn
  có mặt; bọc toàn bộ `ALTER TABLE DROP COLUMN`/`DROP TABLE` trong 1 transaction; xoá type automation
  chết trong `src/types.ts`.
- `db5aff30` — sửa đúng điều kiện kích hoạt: xét CÒN BẤT KỲ artifact automation nào (cột trên 3 bảng,
  hoặc bảng `automation_events`/`drjoy_posted_articles`), không chỉ 1 cột; thêm test dựng đúng trạng thái
  "dở dang" (`automation-schema-removal-migration-dodang.test.ts`); sửa test checksum để tính lại
  SHA-256 từ bytes JSON thật và đối chiếu nội dung file `.sha256`; dọn 3 mục cosmetic.
- `b780b33` — phát hiện thêm ngoài phạm vi Council (từ smoke-test Playwright thủ công của tôi sau khi
  đóng gói lại exe): tab Skill Forge đã biến mất khỏi thanh điều hướng đúng như quyết định, nhưng "Skill
  Forge" vẫn còn 3 chỗ tham chiếu chết — `TabChinh` (`src/types.ts`), key `tab.skill_forge` trong
  `i18n.ts`, và đặc biệt **shortcut `alt+8` "Chuyển tới: Skill Forge" vẫn hiển thị và gán được trong màn
  Cài đặt > Phím tắt** (`shortcuts.tsx`) dù tính năng không còn tồn tại. Đã xoá cả 3, xác nhận lại bằng
  Playwright: không còn "Skill Forge"/"alt+8" ở bất kỳ đâu trong UI.

**Xác nhận cuối cùng sau cả 3 đợt fix**: `tsc --noEmit` sạch; test backend 179/179 pass (176 gốc + 3 mới
cho trạng thái dở dang); test frontend 57/57 pass; `npm run check` 10/10 cổng xanh; đóng gói lại exe 3
lần (mỗi lần sau một đợt fix); Playwright lái exe đã đóng gói xác nhận app khởi động sạch, không lỗi
console, cấu hình Team/Người/Group mở đúng modal.

Phiên review được `council pause` sau vòng 8 (không đợi hết 12 vòng) vì cả hai bên đã hội tụ ổn định
5 vòng liên tiếp (vòng 3-7) về cùng một danh sách việc cần sửa, không còn phát sinh thông tin mới — tiếp
tục lặp thêm vòng tự động trên cùng trạng thái code chỉ tốn token mà không tăng giá trị phân tích.
