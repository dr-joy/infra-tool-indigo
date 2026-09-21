# CR-20260809-tach-connector-automation-drive-redmine — Tách quyền automation Google Drive và Redmine

| Trường | Giá trị |
|---|---|
| Loại | ✅ Thêm mới ✅ Sửa hành vi ✅ Deprecate `other` |
| Mức tác động | ✅ Lớn (frontend, API, scheduler, dữ liệu cũ, automation/MCP và đóng gói) |
| Người đề xuất | tuan.vu (Leader), thiết kế: Codex |
| Ngày | 2026-08-09 |
| Backlog item | `BL-20260809-006` — `Picked` |
| Trạng thái | ✅ Draft · ✅ Claude review vòng 1 · ✅ Claude final review · ✅ Leader duyệt · ✅ Code + machine gate · ✅ Claude code review (PASS WITH 2 note, §49) · ✅ UAT thật 2026-08-15 (§15) · ✅ Remediation task 21/22 (§16) · ✅ Codex final review PASS (§44-§45) · ✅ **Nghiệm thu — Leader đóng 2026-08-15** |
| Spec liên quan | [UI flow](../../specs/02-screen-design-user-flow.md) · [API](../../specs/03-api-business-logic-spec.md) · [DB](../../specs/04-database-design.md) · [Frontend rules](../../rules/06-rules-frontend.md) · [Backend rules](../../rules/07-rules-backend.md) · [NFR](../../rules/09-non-functional-requirements.md) |

## 1. Bối cảnh & Vấn đề

`actionType='other'` hiện dùng chung `CLAUDE_READ_TOOLS_OTHER` và `CLAUDE_WRITE_TOOLS_OTHER` cho mọi tích hợp ngoài Dr.JOY. Nếu mở đồng thời Google Drive và Redmine, một task chỉ cần Redmine vẫn có thể được cấp tool Drive và ngược lại. Leader đã chốt mỗi task chỉ làm việc với **một connector**, nên phương án được chọn là tách thẳng `actionType` thành `drive` và `redmine`, không thêm tầng `capability` song song.

Rà DB ngày 2026-08-09 cho thấy có đúng hai task `other` đang hoạt động (`id=21`, `id=22`), cả hai là task test Google Drive theo tiêu đề/mô tả; không có release definition hay result snapshot nào mang `other`. Đây là bằng chứng để xử lý hai bản ghi đã biết, không phải quy tắc cho phép suy đoán mọi dữ liệu `other` trong các bản cài khác.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu:**
  - Task `drive` chỉ nhận whitelist đọc/ghi Google Drive; task `redmine` chỉ nhận whitelist đọc/ghi Redmine.
  - UI bắt user chọn connector rõ ràng và hiển thị đúng connector trong editor, preview, popup và kết quả.
  - `other` trở thành giá trị legacy: vẫn đọc/mở sửa được nhưng không được scheduler, preview hay execute.
  - Bảo toàn luồng preview → duyệt → execute, reservation, `unknown_outcome` và chống ghi trùng đã có.
  - Có bằng chứng CLI thật cả chiều được phép lẫn bị từ chối trước khi mở khóa production.
- **Ngoài phạm vi:**
  - Một task ghi nhiều connector trong cùng lượt.
  - Google Calendar, Gmail, Google Sheets hoặc connector thứ ba; mỗi connector mới cần backlog/CR riêng.
  - Direct Redmine REST sync hoặc thay đổi màn hình cấu hình API key Redmine hiện hữu.
  - Tự suy luận connector từ title/`ai_note`, sửa lịch sử event cũ hoặc tạo nơi lưu secret mới.
  - Bỏ bước duyệt đối với task chỉ đọc; BL-006 giữ nguyên state machine hiện tại.

## 3. Người dùng & Kịch bản

- Là Leader, tôi chọn “Google Drive” hoặc “Redmine” cho một task để biết chính xác phạm vi quyền AI có thể dùng.
- Là người duyệt, tôi thấy connector và đích tác động trong preview trước khi cho phép ghi.
- Là operator, tôi thấy task legacy `other` bị chặn với hướng dẫn chọn lại connector, thay vì app âm thầm chạy bằng quyền dùng chung.

## 4. Yêu cầu chức năng

- **FR-1 — phân loại:** `ActionType` hỗ trợ `none`, `post`, `drive`, `redmine`; `other` chỉ tồn tại để đọc dữ liệu legacy và không còn là lựa chọn tạo/sửa mới.
- **FR-2 — một task, một connector:** mọi entry point tạo/cập nhật task chỉ lưu đúng một `actionType`; không có danh sách connector hay fallback từ `drive` sang `redmine`/`other`.
- **FR-3 — fail closed:** scheduler chỉ chọn `post|drive|redmine`. Task `none`, `other` hoặc giá trị không hợp lệ không được spawn AI và trả trạng thái/lời nhắc sửa rõ ràng khi user thao tác trực tiếp.
- **FR-4 — whitelist riêng:** preview của từng connector nhận common read tools cộng đúng scoped read tools; execute nhận đúng scoped write tools và scoped read tools cùng connector. Scoped read list rỗng không được coi là sẵn sàng chỉ vì common read list có giá trị.
- **FR-5 — deny ghi khi preview:** deny-list ở read mode phải là hợp của write tools `post`, `drive`, `redmine` và legacy `other`, để preview không gọi bất kỳ tool ghi đã biết nào.
- **FR-6 — xác minh preview:** response `ready` phải khai báo `kind` và `target.connector` khớp `actionType`; mismatch hoặc thiếu connector bị chặn trước duyệt/execute.
- **FR-7 — UI:** editor, badge, preview, session popup và result feed hiển thị tên connector riêng; `other` hiển thị cảnh báo “Chưa phân loại — chọn Google Drive hoặc Redmine”, không có CTA chạy.
- **FR-8 — dữ liệu cũ:** không auto-migrate theo text. Sau backup, hai task đã xác minh `id=21,22` trên DB của Leader được cập nhật thành `drive` qua API/UI bình thường và kiểm tra lại; mọi `other` khác giữ nguyên ở trạng thái legacy bị khóa.
- **FR-9 — snapshot/đích:** snapshot và preview target hỗ trợ trường chung, cộng dồn và tương thích ngược để UI có thể hiện connector, tên tài nguyên, ID/URL và mode; schema Dr.JOY cũ vẫn đọc được.
- **FR-10 — hành vi cũ:** logic lưu article Dr.JOY vẫn chỉ chạy với `post`; reservation/reconcile/result acknowledgement không đổi theo connector.

## 5. Yêu cầu phi chức năng

- Least privilege và fail closed tại cả route, scheduler, runner và UI; UI không phải lớp bảo mật duy nhất.
- Không truyền secret trong prompt, log, snapshot hay tài liệu. Claude CLI tiếp tục nhận prompt qua stdin và không dùng chế độ bỏ qua permission.
- Không thêm DB `CHECK` trong CR này: cột hiện là `TEXT`, rebuild SQLite tạo rủi ro migration không tương xứng. Một registry/helper tập trung ở application layer là nguồn hợp lệ duy nhất cho active/legacy action types; route và scheduler đều phải dùng nó.
- Thay đổi tương thích ngược với snapshot `post|other|null`; unknown value không được tự động biến thành connector có quyền.
- Bản SEA/EXE phải nhận các biến môi trường mới và qua smoke trên cấu hình đóng gói thật.

## 6. Thiết kế giải pháp

### 6.1. UI và luồng người dùng

Selector tạo/sửa task có bốn lựa chọn hoạt động: “Không nhờ AI”, “Đăng Dr.JOY”, “Google Drive”, “Redmine”. `other` không xuất hiện cho task mới. Nếu mở task legacy, editor hiển thị cảnh báo và bắt chọn Drive/Redmine trước khi Save có thể biến task đó thành automation hợp lệ; không tự chọn hộ.

Preview hiển thị tối thiểu connector, hành động/mode và đích (`displayName`, `resourceId` hoặc `url` khi có). Luồng vẫn là:

```text
Chọn 1 connector → precheck chỉ-đọc → xem đúng đích → duyệt → execute đúng whitelist → đối chiếu kết quả
```

### 6.2. API & nghiệp vụ

- Tạo helper/registry trung tâm phân biệt:
  - active AI types: `post`, `drive`, `redmine`;
  - legacy blocked type: `other`;
  - non-AI: `none`.
- Các route create/update phải nhận và round-trip `drive|redmine`; input không thuộc tập lưu trữ đã định nghĩa bị `400`, không âm thầm nâng thành connector có quyền.
- Precheck/execute kiểm tra active type trước khi claim/spawn. `other` trả lỗi nghiệp vụ có mã ổn định và hướng dẫn mở editor chọn connector.
- `writeToolsFor`/`readToolsFor` map tường minh, không dùng nhánh `else => OTHER`:

| `actionType` | Read scope | Write scope |
|---|---|---|
| `post` | `CLAUDE_READ_TOOLS_POST` | `CLAUDE_WRITE_TOOLS_POST` |
| `drive` | `CLAUDE_READ_TOOLS_DRIVE` | `CLAUDE_WRITE_TOOLS_DRIVE` |
| `redmine` | `CLAUDE_READ_TOOLS_REDMINE` | `CLAUDE_WRITE_TOOLS_REDMINE` |

- Common read tools vẫn có thể được cộng vào command, nhưng **không** thay thế yêu cầu connector-scoped read list có cấu hình.
- Preview contract mở rộng cộng dồn:
  - `kind: 'post'|'drive'|'redmine'`;
  - `target.connector: 'drjoy'|'google_drive'|'redmine'`;
  - giữ các field Dr.JOY cũ; thêm optional `displayName`, `resourceId`, `url`, `mode`.
- Backend đối chiếu cặp `actionType ↔ kind ↔ target.connector`. Sai/thiếu trả lỗi fail-closed, không tạo approval hợp lệ.
- Hai lớp có vai trò khác nhau và không thay thế nhau: whitelist CLI (`allowedTools`/`disallowedTools` và deny pattern) là lớp **chặn kỹ thuật** side effect sai connector; kiểm tra `kind`/`target.connector` là lớp **bảo vệ người duyệt** khỏi hiểu nhầm mình đang duyệt đích nào. Contract đúng không được dùng làm lý do nới whitelist.

### 6.3. Dữ liệu & migration

- Không thêm cột và không rebuild bảng để thêm `CHECK`.
- Mở rộng TypeScript/validation/snapshot parser để hiểu `drive`, `redmine`, đồng thời đọc được `other` cũ như legacy blocked.
- Không rewrite `automation_events` hoặc snapshot lịch sử.
- Runbook remediation DB Leader:
  1. backup và integrity check;
  2. chạy lại query `WHERE action_type='other'` ngay trước remediation để lấy danh sách mới nhất; xác nhận id/title/`ai_note` của từng dòng, không giả định chỉ còn task 21, 22;
  3. chỉ PATCH các task đã được người vận hành xác nhận chắc chắn là Drive/Redmine qua đường ứng dụng; task 21, 22 là hai ứng viên Drive đã biết, mọi dòng chưa rõ giữ legacy blocked;
  4. GET/khởi động lại để xác nhận round-trip;
  5. query còn bao nhiêu `other`, mọi bản ghi còn lại phải tiếp tục bị khóa.
- Không đặt migration SQL dựa trên `LIKE '%Drive%'` hay nội dung mô tả.

### 6.4. Automation / tích hợp

- Prompt preview và execute ghi rõ action type, connector kỳ vọng và schema response; không dùng cụm generic `other`.
- Runner read mode phải deny hợp tất cả write env, gồm cả `OTHER` legacy để không giảm bảo vệ khi nâng cấp từ cấu hình cũ.
- Existing Redmine API key/config không được coi là bằng chứng Claude MCP đã đăng nhập hoặc được cấp quyền. Drive và Redmine đều phải qua preflight CLI thật.
- Lượt ghi đầu tiên chỉ dùng đích thử nghiệm: file/folder draft trên Drive và test project/issue trên Redmine. Sau duyệt, phải kiểm tra đích ngoài thật chứ không chỉ tin text Claude trả về.

## 7. Phân tích tác động

- [x] Frontend · [x] API route · [ ] DB schema · [x] Automation/MCP
- [x] i18n/chuỗi · [x] Đóng gói SEA/MCP · [x] Bảo mật · [x] Dữ liệu cũ/backward-compat
- Điểm code phải rà: shared types/normalizer; automation routes/helpers/scheduler; schedules route; Claude runner deny-list; automation ask/prompt; editor fields; popup/result/release badges; `src/i18n.ts` với key riêng cho Drive/Redmine; tests và docs vận hành.
- **Rủi ro cấp nhầm connector:** map tường minh + contract mismatch gate + positive/negative CLI smoke.
- **Rủi ro task legacy tự chạy:** scheduler loại `other`, direct route chặn, UI không có CTA.
- **Rủi ro migrate nhầm:** không suy luận hàng loạt; chỉ remediation hai bản ghi đã xác minh sau backup.
- **Ảnh hưởng BL-003:** không đổi state machine, occurrence, reservation hoặc reconcile; regression suite phải chứng minh các invariant này giữ nguyên.

## 8. Tiêu chí nghiệm thu

- **AC-1 (FR-1,2,7):** Given tạo/sửa task / When chọn Drive hoặc Redmine / Then API round-trip đúng một type và mọi UI surface hiện đúng nhãn; không thể chọn `other` cho task mới.
- **AC-2 (FR-3,8):** Given task legacy `other` / When scheduler quét hoặc user yêu cầu preview / Then không spawn CLI, hiện hướng dẫn chọn connector; sau khi user đổi type hợp lệ mới được precheck.
- **AC-3 (FR-4):** Given task Drive/Redmine / When precheck và execute / Then command chỉ nhận common read + read/write scope đúng connector và không nhận scope connector kia.
- **AC-4 (FR-4):** Given scoped read hoặc write list của connector rỗng / When precheck hoặc execute / Then fail trước spawn/side effect với thông báo cấu hình cụ thể.
- **AC-5 (FR-5):** Given preview mode / When Claude cố gọi bất kỳ write tool đã cấu hình cho post/drive/redmine/other / Then permission từ chối và không có side effect.
- **AC-6 (FR-6,9):** Given AI trả `kind`/`target.connector` thiếu hoặc khác action type / When backend parse preview / Then lượt bị blocked/error, không thể duyệt/execute; target hợp lệ hiển thị đủ cho người duyệt đối chiếu.
- **AC-7 (FR-3):** Given scheduler / When tới giờ / Then chọn `post|drive|redmine`, loại `none|other|invalid`, không fallback.
- **AC-8 (FR-8):** Given DB Leader đã backup / When remediation task 21/22 / Then cả hai round-trip thành `drive`, lịch sử không bị rewrite, mọi `other` ngoài danh sách vẫn bị khóa.
- **AC-9 (FR-10):** Regression reservation, unknown outcome, reconcile, acknowledgement và post article đều xanh; connector mới không làm thay đổi quyền retry hoặc chống ghi trùng.
- **AC-10:** Bản EXE chạy positive và cross-negative smoke thật cho cả Drive/Redmine; mỗi lần ghi chỉ xảy ra sau approval và được xác nhận trực tiếp ở đích test.

## 9. Kế hoạch test

- **Unit:** registry/normalizer; active vs legacy; mapping env; preview connector contract; snapshot backward compatibility.
- **Integration API/scheduler:** create/update/GET Drive và Redmine; `other` blocked; invalid `400`; scheduler include/exclude; missing scoped read/write fail trước spawn; no cross-scope command.
- **Runner/security:** read-mode deny-list chứa mọi write scope; stdin prompt; không skip permission; connector mismatch không tạo approval.
- **Frontend/render:** selector, legacy warning, badges, generic target và CTA bị khóa.
- **Regression:** toàn bộ automation state machine, reservation/reconcile và Dr.JOY post.
- **UAT/CLI thật:**

| Ca | Preview | Execute sau duyệt | Bằng chứng |
|---|---|---|---|
| Drive positive | đọc đúng đích test, write bị deny | tạo/sửa đúng draft test | kiểm tra file/folder ngoài thật |
| Drive cross-negative | yêu cầu Redmine write | bị deny, không side effect | Redmine test project không đổi |
| Redmine positive | đọc đúng test project, write bị deny | tạo/sửa đúng issue test | kiểm tra issue ngoài thật |
| Redmine cross-negative | yêu cầu Drive write | bị deny, không side effect | Drive test target không đổi |

Mock chỉ chứng minh wiring/state; không được dùng làm bằng chứng permission connector. Full `npm run check`, docs gate, package EXE smoke và DB integrity là điều kiện nghiệm thu.

## 10. Kế hoạch triển khai / rollback

1. Sau Claude PASS và Leader duyệt DoR, triển khai registry/types/backend trước, test đỏ → xanh.
2. Triển khai UI và generic preview target; cập nhật prompt, runner env và tài liệu cấu hình.
3. Chạy full gate trên DB cô lập; build EXE.
4. Backup DB thật, cấu hình env riêng, chạy CLI preflight positive/negative rồi mới remediation task 21/22.
5. Chạy UAT trên đích test, không mở rộng sang dữ liệu production cho tới khi bằng chứng đủ.

Rollback: dừng scheduler/automation, gỡ các env Drive/Redmine và revert code. Không đổi schema nên có thể quay về binary cũ. Binary cũ chỉ coi `post|other` là AI, vì vậy task đã đổi sang `drive|redmine` sẽ rơi vào nhánh non-AI và bị bỏ qua — an toàn hơn việc silent-run bằng nhầm quyền. Giữ bản backup để phục hồi có chủ đích; không tự đổi ngược thành `other` nếu chưa đánh giá quyền dùng chung.

## 11. Docs cần cập nhật khi triển khai

- [x] `docs/specs/01-product-requirement-spec.md`
- [x] `docs/specs/02-screen-design-user-flow.md`
- [x] `docs/specs/03-api-business-logic-spec.md`
- [x] `docs/specs/04-database-design.md`
- [x] `docs/specs/05-test-acceptance-criteria.md`
- [x] `docs/rules/06-rules-frontend.md`
- [x] `docs/rules/07-rules-backend.md`
- [ ] `docs/rules/09-non-functional-requirements.md`
- [x] Operations/go-live guide và env matrix liên quan
- [x] Unknown-outcome runbook đã rà; không đổi state machine nên không cần sửa nội dung

Mục NFR đã rà và không có quy tắc nào cần đổi cho CR này; giữ ô chưa đánh dấu để thể hiện không tạo diff hình thức.

## 12. Duyệt (sign-off / DoR)

| Vai trò | Tên | Ngày | Kết quả |
|---|---|---|---|
| Leader/BA | tuan.vu | 2026-08-09 | ✅ Chốt hướng A và ràng buộc một task/một connector; chờ duyệt spec cuối |
| Dev reviewer | Codex | 2026-08-09 | ✅ Khả thi; cần registry tập trung, không dùng fallback `else => OTHER` |
| Tester reviewer | Codex | 2026-08-09 | ✅ AC có positive, negative, legacy, regression và external verification |
| Infra/Security reviewer | Codex | 2026-08-09 | ✅ Thiết kế fail-closed; yêu cầu env riêng và CLI smoke thật |
| Reviewer độc lập | Claude | 2026-08-09 | ✅ PASS tại §45 (WITH NOTES) và §47 (final, sau khi hấp thụ đủ 4 note) — không còn finding |
| Leader | tuan.vu | 2026-08-09 | ✅ Duyệt trực tiếp trong phiên — cho phép Codex code theo đúng Change Spec |

### DoR trước khi code

- [x] Backlog ở `Picked`, mục tiêu/phạm vi/FR/AC/rollback đã rõ.
- [x] Dev, Tester, Infra/Security self-review không thấy blocker thiết kế.
- [x] Claude review độc lập PASS WITH NOTES; mọi note §45.3 đã được hấp thụ.
- [x] Claude xác nhận lần cuối bản đã tinh chỉnh không tạo finding mới (§47).
- [x] Leader duyệt Change Spec cuối để bắt đầu code.

**Điểm dừng đã mở:** Codex có thể bắt đầu code theo trình tự §10. Chưa được bật quyền Drive/Redmine ở env thật hoặc remediation
task 21/22 cho tới khi đủ bằng chứng CLI positive/cross-negative theo §9.

## 13. Bằng chứng triển khai trước code review

- Đã triển khai registry/type/validation tập trung; API từ chối giá trị lạ bằng `400`, mapper dữ liệu cũ fail-safe về `none`.
- Scheduler và direct automation chỉ nhận `post|drive|redmine`; `other` legacy bị khóa. Read/write env được map tường minh theo connector, scoped read là bắt buộc và không có fallback chéo.
- Preview đối chiếu `actionType ↔ kind ↔ target.connector`; mismatch fail-closed. Read mode tiếp tục deny hợp mọi write scope, gồm cả `OTHER` legacy.
- UI có lựa chọn Drive/Redmine, nhãn/badge/target riêng; task `other` chỉ hiện khi mở dữ liệu legacy kèm cảnh báo để user chọn lại.
- Test tự động sau triển khai: `npm run check` xanh với 291 backend test, 212 frontend test, TypeScript/build/docs gates xanh; main bundle 492.0/500 kB.
- Chưa thực hiện và không giả lập là đã thực hiện: authorize connector thật, CLI positive/cross-negative, package EXE UI smoke, remediation DB task 21/22 hoặc bất kỳ external write thật nào. Đây là các điểm dừng trước nghiệm thu, không phải bằng chứng code gate.
- Đã hấp thụ code review Claude §49: test integration khóa chủ ý fail toàn batch `sync-preview` khi một item có `actionType` sai; runbook cảnh báo xử lý tay task `other` đang ở trạng thái dở dang vì scheduler/UI không còn tự phục hồi loại legacy này.

## 14. Kết quả UAT thật ngày 2026-08-09

| Ca | Kết quả | Bằng chứng / điểm dừng |
|---|---|---|
| Package + EXE boot | ✅ PASS | `npm run package` thành công, tự backup DB trước build; EXE mới chạy với APPDATA/DB UAT cô lập, config Claude `true`, trang gốc HTTP 200. |
| API round-trip/legacy trên EXE | ✅ PASS | Task `drive` round-trip đúng type; tạo mới `other` trả `400`; Drive thiếu scoped env bị block `READ_TOOLS_NOT_CONFIGURED` trước spawn. |
| Redmine positive read | ✅ PASS | CLI headless gọi read tool thành công; biên bản không lưu PII. |
| Redmine preview qua EXE | ✅ PASS về fail-closed | Precheck đọc thật, không tìm được project test/sandbox/UAT có quyền; đích truy cập được là production nên trả `blocked`, không cho duyệt/ghi. |
| Redmine preview write-deny | ✅ PASS | CLI `permission_denials` ghi nhận tool tạo issue bị chặn; không tạo issue. |
| Redmine scope → Drive write | ✅ PASS | CLI `permission_denials` ghi nhận tool tạo file bị chặn trước connector; không tạo file. |
| Drive positive read/write | ⛔ BLOCKED | `mcp list` có Drive Connected nhưng headless tool call vẫn yêu cầu OAuth; scoped env thật chưa sẵn sàng. Không dùng mock thay bằng chứng. |
| Drive scope → Redmine write | ⚠️ INCONCLUSIVE | Deferred tool alias/OAuth trả kết quả không nhất quán và không có `permission_denials`; không tính PASS. |
| Redmine positive write | ⛔ BLOCKED | Không có project test an toàn mà credential hiện tại truy cập được; tuyệt đối không tạo issue UAT vào project production. |
| UI click-through | ⛔ BLOCKED | Phiên Codex không có in-app/external browser kết nối; HTTP 200 không thay cho manual UI PASS. |

Môi trường UAT dùng DB tạm riêng đã được dừng và xóa sau test; DB Leader, task 21/22 và external target không bị sửa. Chưa đủ AC-10 nên CR chưa nghiệm thu/close. Điều kiện để chạy tiếp: authorize Drive cho đúng Claude CLI headless, cung cấp/cấp quyền một Redmine project test, và kết nối browser để smoke UI.

**Leader chốt 2026-08-09:** tạm dừng tại đây và chuyển sang `Pending UAT tại công ty`. Khi tiếp tục, kiểm lại Google Drive bằng tool call headless thật (không chỉ trạng thái Connected trong `/mcp`), chọn Redmine project test an toàn và chạy UI click-through. Không close CR/backlog, không remediation DB trong thời gian pending.

## 15. Kết quả UAT thật ngày 2026-08-15 — thay thế điều kiện "Pending UAT tại công ty" ở §14

Chi tiết đầy đủ và bằng chứng từng bước nằm ở `docs/exchanges/2026-08-15.md` §1–§36 (kênh trao đổi Claude/Codex/
Leader); mục này chỉ tóm tắt kết luận cuối cho hồ sơ CR.

| Ca | Kết quả | Ghi chú |
|---|---|---|
| Google Drive — MCP direct UAT | ✅ PASS | `search_files`, `get_file_metadata`, `create_file` gọi thật, có bằng chứng (§8). |
| Google Drive — AC-10 app-level (preview→approve→execute qua route thật) | ✅ PASS | Task `38`: đi qua UI/app + approval + scheduler, có file thật trên Drive; `result_recorded=done`. |
| Redmine — MCP direct UAT toàn bộ 20/20 tool | ✅ PASS | Đọc (9) + ghi/xoá/đóng (11), mỗi tool có bằng chứng gọi thật + read-back (§16, §19, §24, §31, §35). Đây là UAT **connector-level** (gọi tool trực tiếp/qua route app), CHƯA phải bằng chứng "app tự cấp đúng operation cho đúng kế hoạch". |
| Redmine — AC-10 app-level (preview→approve→scheduler tự execute) | ✅ PASS | Task `39`: ghi đúng 1 note vào issue `276098` qua route thật, không side effect ngoài ý muốn (§27). |
| Precheck prompt — pha đọc không được biết/gọi tool ghi | ✅ Đã sửa | Thêm giải thích rõ đây là giới hạn cố ý, không phải thiếu cấu hình; thêm cổng `WRITE_TOOLS_NOT_CONFIGURED` chặn sớm trước khi spawn nếu chưa cấu hình tool ghi; bỏ câu văn "blind ready" theo review Codex §36 finding 2. |
| Operation-scoped write permission | ⬜ CHƯA LÀM | Hiện `executeApprovedTask()` cấp NGUYÊN whitelist ghi của actionType cho mọi kế hoạch, không giới hạn theo đúng operation đã duyệt trong preview — Codex xác định đây là blocker trước khi promote go-live profile đầy đủ (§36 finding 1). Đã mở backlog riêng, không giải trong CR này. |

**Quyết định phạm vi:** theo yêu cầu Leader (§28/§29 exchange) mở rộng UAT Redmine ra toàn bộ 20 tool MCP (không
dừng ở tối thiểu), nhưng Codex xác nhận việc đó là **UAT connector**, tách biệt khỏi phạm vi gốc của CR này. Go-
live profile áp dụng cho CR-20260809 giữ ở mức tối thiểu đã duyệt trước đó (Redmine ghi: `create_issue`,
`update_issue`; đọc: `search_issues`, `get_issue`) — KHÔNG promote cả 11 tool ghi Redmine cho tới khi có lớp
operation-scoped permission (backlog riêng). Drive/Dr.JOY UAT toàn bộ tool tách thành 2 backlog riêng
(`BL-20260815-005`, `BL-20260815-006`).

**Còn lại trước khi đóng CR:** backup DB, remediation task `21/22` (chuyển `actionType='other'` sang `drive`),
cập nhật go-live profile persistent theo đúng mức tối thiểu ở trên, dừng chờ Codex review lần cuối.

## 16. Remediation hoàn tất ngày 2026-08-15

- **Backup DB:** `C:\Users\Tuan_Vu\AppData\Roaming\TaskManager\data\backups\tasks-2026-08-15_171831.sqlite`
  (SHA256 `6580ca5381a0e3de4bbfca56a786e396932bd08839a7b0b7be8c330848dcde37`), đồng bộ OneDrive.
- **Remediation task 21/22:** xác minh đúng 2 task duy nhất mang `action_type='other'` (tiêu đề rõ ràng là Drive,
  khớp §1 CR), chuyển qua `PATCH /api/tasks/:id` (đường ứng dụng, không sửa DB thô) sang `action_type='drive'`.
  Read-back đối chiếu toàn bộ 28 dòng `tasks` với bản backup: **chỉ đúng 2 dòng đổi** (`action_type` từ
  `other`→`drive`), tiêu đề và `automation_status` giữ nguyên, không dòng nào khác bị đụng.
- **Sự cố nhỏ đã tự phát hiện và sửa:** lượt PATCH đầu làm hỏng encoding UTF-8 của tiêu đề (dấu gạch ngang/dấu
  tiếng Việt) do gửi qua `curl -d` inline trong Git Bash trên Windows. Phát hiện bằng cách so title với bản
  backup, sửa lại ngay bằng cách gửi qua file JSON UTF-8 (`curl --data-binary @file`) thay vì inline string.
  Read-back sau sửa khớp 100% với bản backup.
- **Go-live profile persistent (User-level) — giá trị cuối cùng:**
  ```
  CLAUDE_READ_TOOLS_REDMINE=mcp__claude_ai_Redmine_MCP__search_issues,mcp__claude_ai_Redmine_MCP__get_issue
  CLAUDE_WRITE_TOOLS_REDMINE=mcp__claude_ai_Redmine_MCP__create_issue,mcp__claude_ai_Redmine_MCP__update_issue
  CLAUDE_READ_TOOLS_DRIVE=mcp__claude_ai_Google_Drive__search_files,mcp__claude_ai_Google_Drive__get_file_metadata
  CLAUDE_WRITE_TOOLS_DRIVE=mcp__claude_ai_Google_Drive__create_file
  ```
  Đã set persistent, app đã restart. **Sửa theo Codex §40 finding 3:** `GET /api/automation/config` CHỈ kiểm tra
  `CLAUDE_BIN`, không chứng minh scoped env Drive/Redmine đã vào process — không dùng làm bằng chứng. Bằng chứng
  thật: preview-only cho task `41` (drive, tìm file theo tên) và task `42` (redmine, tìm issue theo subject) —
  cả hai `ready=true`, KHÔNG có `READ_TOOLS_NOT_CONFIGURED`/`WRITE_TOOLS_NOT_CONFIGURED`, Redmine tìm đúng cả 4
  issue test thật qua `search_issues`. Lượt restart đầu tiên (qua lệnh Bash tách rời export và `npm run
  dev:server`) thực ra **KHÔNG kế thừa được env** (Bash tool: state không giữ qua các lệnh riêng biệt) — task 41
  preview lần đầu trả `READ_TOOLS_NOT_CONFIGURED`, phát hiện ngay, sửa bằng cách export + start server trong
  cùng một lệnh, restart lại, preview lần 2 mới PASS. **Sửa theo Codex §42 finding 1:** lượt "huỷ" task `41`/`42`
  đầu tiên gọi nhầm `PATCH /api/tasks/:id/status` (chỉ đổi `trang_thai` chung) thay vì `POST
  /api/automation/cancel` (đổi đúng `automation_status`) — read-back cho thấy `automation_status` vẫn kẹt ở
  `preview`. Đã gọi lại đúng endpoint cho task `40/41/42`, read-back xác nhận cả ba đều `automation_status=canceled`.
- **Trạng thái chính xác các issue Redmine test còn lại trên `drjoy_vn` (Codex §42 finding 3):**
  - `#276099`, `#276100`, `#276101` (cây `create_issue_tree`/`copy_issue`): **Closed** (đã đóng qua
    `close_issue_tree`, §35).
  - `#276098` (issue gốc UAT `create_issue`/`update_issue`): **vẫn New/mở** — CHƯA đóng/xoá, chờ Leader tự quyết
    định dọn dẹp (đúng quy ước đã dùng cho Drive ở §8/§11). Không tự close/delete issue này khi chưa có approval
    mới.
- **Runbook đã cập nhật:** `docs/operations/automation-ai-go-live-guide.md` sửa toàn bộ alias tool cũ, bước
  authorize connector (account-level claude.ai), và cảnh báo về `CLAUDE_READ_TOOLS` chung.
- **Full gate:** `npm run check` xanh toàn bộ 8 cổng sau các thay đổi trên.

**Trạng thái CR:** đủ điều kiện nghiệm thu về mặt kỹ thuật. Dừng ở đây chờ Codex review bằng chứng remediation
cuối trước khi Leader đánh dấu CR/BL-006 `Done` hoặc commit.
