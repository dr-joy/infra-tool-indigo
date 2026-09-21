# CR-20260913-nen-tang-da-nguoi-dung — Nền tảng đa người dùng: đưa Task Manager lên server cho nhiều team

| Trường | Giá trị |
|---|---|
| Loại | ✅ Thêm mới ✅ Sửa hành vi ✅ Xóa/Deprecate |
| Mức tác động | ⬜ Nhỏ ⬜ Vừa ✅ **Lớn** (đụng DB toàn bộ, mọi màn hình, xác thực, đóng gói, hạ tầng) |
| Người đề xuất | Leader (user) — phân tích BA bởi Claude |
| Ngày | 2026-09-13 |
| Backlog item | `BL-20260913-001` (trạng thái `Picked`) |
| Trạng thái | ⬜ Draft ✅ **Đã review** ⬜ Đã duyệt ⬜ Đã triển khai ⬜ Đã nghiệm thu |
| Spec liên quan | [01](../../specs/01-product-requirement-spec.md) · [02](../../specs/02-screen-design-user-flow.md) · [03](../../specs/03-api-business-logic-spec.md) · [04](../../specs/04-database-design.md) · [05](../../specs/05-test-acceptance-criteria.md) · [rules 06–09](../../rules/) · [security-standard](../../standards/security-standard.md) |
| Nguồn quyết định | [exchange 2026-09-13](../../exchanges/2026-09-13.md) — mục 1-8 (quyết định BA + lý do), bảng Q1-Q11 (quyết định bổ sung của Leader), Council thật `0caf00ab` (khám phá độc lập), `38c458f1` (kiến trúc backend, **converged**), `4dd7a70c` (bảo mật + hiệu năng, **converged**, `open_material_decisions = 0`), `1a86deaf` (rà soát vòng 2 sau khi Claude sửa CR — **converged**, xử lý dứt điểm Q7 + FR-30 + gap FR↔AC + phân bổ Nhóm F/3 cổng DoR) · [exchange 2026-09-12](../../exchanges/2026-09-12.md) (bức tranh lớn) · [exchange 2026-09-19](../../exchanges/2026-09-19.md) — Leader tự rà lại mô hình phân quyền, Council thật `e1e76a1e` (hội tụ 3 vòng, đơn giản hoá tầng 2 + mở rộng FR-28a); cùng ngày, sau khi mở nhánh `feature/da-nguoi-dung`, Council thật `1aa7fe8b` (thiết kế kỹ thuật chi tiết Lát 3 — schema, `authorize()`, route inventory) `76e03307` (thiết kế kỹ thuật chi tiết Lát 4 — di trú dữ liệu/PIC→User, đọc trực tiếp DB Dev13 thật), `74715c65` (thiết kế kỹ thuật chi tiết Lát 5 — cấu hình báo cáo/Risk/mindmap attachment/Redmine SSRF/gỡ MCP), và `84473697` (thiết kế kỹ thuật chi tiết Lát 6 — Release nhiều team, dừng ở bước hỏi Leader vì lỗi hành văn); sau đó Leader tự mô tả lại trực tiếp cách team điều phối vận hành thật, lộ ra 4 chỗ Council hiểu sai, chốt lại toàn bộ qua 6 câu hỏi coaching trực tiếp với Leader (không qua Council) |

> **Trạng thái thật sau 3 phiên review:** ba phiên Council (Claude + Codex) đã hội tụ về hướng kiến trúc
> backend (xác thực, phân quyền, giới hạn tài nguyên), cách chuyển giờ VN→JST an toàn, cách phủ AC cho
> toàn bộ FR, và cách phân kỳ 3 cổng DoR. **DoR CHƯA đạt** — hai artefact vẫn còn thiếu là điều kiện bắt
> buộc trước Cổng C (§10): (1) **route inventory** đầy đủ 11 trường cho từng route production, sinh/kiểm
> trực tiếp từ router đã đăng ký; (2) **benchmark** trên dữ liệu Dev13 sau di trú. Không mô tả hai thứ
> này như đã hoàn thành ở bất kỳ đâu trong file này.
>
> **Một lỗi thật đang tồn tại trong code đã được xác nhận qua Council `1a86deaf` (không phải giả thuyết):**
> `src/screens/release.tsx:322` cộng cứng 120 phút để hiển thị giờ Nhật, dựa trên `Date` theo giờ máy và
> **đoán ngôn ngữ** từ nội dung — nằm ngoài cổng `check-tz.mjs`, cùng họ lỗi với `BUG-20260803`/`BUG-20260804`
> đã xảy ra thật trong dự án này. Xem chi tiết và cách sửa bắt buộc ở FR-30.
>
> **Vòng coaching Q12-Q20 với Leader (13/09, trước khi duyệt DoR — xem
> [exchange 2026-09-13](../../exchanges/2026-09-13.md)):** bỏ hẳn FR-5 (cảnh báo đăng nhập lạ, kèm bảng
> `login_events` và AC-4); thêm **FR-9a** (Admin tự động được báo khi team điều phối release mất Leader
> hiệu lực — kể cả khi mất do Leader bị bớt khỏi team lẫn khi Leader vẫn còn trong team nhưng tài khoản bị
> `disabled`, chốt bổ sung sau một vòng hỏi lại);
> chốt màu task tự sinh từ FR-28a **giống hệt** task release khẩn cấp (tái dùng tiền tố `emergency:`, không
> đổi schema); chốt danh sách định dạng đính kèm Mind Map (FR-32a) cụ thể: ảnh + `.pdf`/`.txt`/`.md`/`.csv`/
> `.html` + `.docx`/`.xlsx`/`.pptx` (loại trừ định dạng nhị phân cũ `.doc`/`.xls`/`.ppt`); xác nhận
> "hệ thống bị ảnh hưởng" (FR-24) đã là danh sách đóng sẵn trong code (`VALID_EMERGENCY_SYSTEMS`), không
> cần đổi; thêm ghi chú di trú màu PIC→User (FR-17) và ghi chú khử trùng lặp khi tính số liệu tổng mục
> tiêu tuần cho task nhiều người phụ trách (FR-21a).
>
> **2 phiên Council bổ sung (13/09) rút gọn + soi UX bộ trang/popup — xem §6.1a:** rút gọn từ danh sách
> phẳng 21 mục xuống đúng cấp giao diện (5 trang mới thật sự, còn lại là tab/khu/popup/inline), phát
> hiện thêm 2 khoảng trống thật (FR-22 chưa có chỗ gắn, quản lý tài khoản/thu hồi phiên chưa có UI) và 1
> ngõ cụt thật khi thiết kế "Thay Leader" cho Admin (dễ va giới hạn tối đa 1 Leader/team của FR-6 nếu
> tách thao tác gỡ-cũ/gán-mới thành hai bước riêng).
>
> **Đơn giản hoá tầng 2 + mở rộng FR-28a (19/09, sau khi Leader tự rà lại toàn bộ mô hình phân quyền,
> Council thật `e1e76a1e` hội tụ 3 vòng — xem [exchange 2026-09-19](../../exchanges/2026-09-19.md)):**
> **FR-7 đổi từ 4 mức xuống đúng 2 mức (`Tắt`/`Bật`) cho cả 5 chức năng** — bỏ hẳn "cả team chỉ đọc"/"chỉ
> Leader"/"Leader chỉ đọc"; khác biệt Member/Leader chuyển hết sang tầng 3 (FR-8). Thêm **FR-7a** (mới):
> Báo cáo tuần của một team chỉ Bật được khi Project team đó đang Bật; tắt Project thì tự tắt theo Báo
> cáo tuần kèm cảnh báo Admin; bật lại Project không tự bật lại Báo cáo tuần. **FR-28a mở rộng** từ
> chỉ-Leader sang **mọi Member**, trigger đổi từ "tự động khi Leader đăng ký lịch" sang **"mỗi người tự
> bấm áp dụng checklist của mình"**. **FR-24 mở rộng** người xem lịch release chung từ chỉ-Leader sang cả
> Member. **FR-9 bổ sung** rõ: quyền tầng 4 của Leader team điều phối **không phụ thuộc** trạng thái
> Bật/Tắt Release (tầng 2) của chính team đó. Không đổi: FR-11, FR-11a, FR-17a, FR-23a, FR-28, FR-31,
> FR-32 (Mind Map vẫn single-writer — ý định thêm chế độ "chia sẻ cho sửa được" đã bị Leader tự rút lại
> sau khi được nhắc lại rủi ro ghi đè trên canvas).
>
> **Thiết kế kỹ thuật chi tiết Lát 3 (19/09, cùng ngày, sau khi mở nhánh `feature/da-nguoi-dung` — Council
> thật `1aa7fe8b` hội tụ qua 3 vòng, xem [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** chốt
> hợp đồng `authorize()` một cổng vào duy nhất (§6.2), 8 bảng schema cho Lát 3 kèm `system_role` (Admin),
> `row_version` kéo sớm cho 5 bảng, `audit_log` kéo sớm từ Lát 4 (§6.3), và 20 route đầy đủ 11 trường
> inventory. Ba quyết định của Leader: team mới mặc định Tắt hết 5 chức năng; "team đang chọn" chỉ nhớ
> phía trình duyệt, không thêm cột server; danh sách thành viên team (`GET .../members`) mở cho cả
> Member xem, chỉ thêm/bớt vẫn là quyền Leader.
>
> **Thiết kế kỹ thuật chi tiết Lát 4 (19/09, cùng ngày — Council thật `76e03307` hội tụ 2 vòng, KHÔNG cần
> hỏi lại Leader, xem [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** đọc trực tiếp DB Dev13
> thật (chỉ đọc) để lấy số liệu thay vì đoán; phát hiện **4/6 `project_task_assignments` đang gắn vào
> task đã có con** (lỗi dữ liệu thật, không phải giả thuyết) — giữ nguyên làm lịch sử, báo cáo cho Leader
> xử lý tay sau di trú. Chốt: thêm `responsible_user_id`+`legacy_pic_label` cho `projects` (khoảng trống
> FR-15 chưa có trong bản CR trước); `project_tasks.team_id` denormalize có **trigger hai chiều** bảo vệ
> khỏi rò dữ liệu chéo team; rebuild `project_task_assignments` (đổi `pic`→`user_id`, bỏ cột `tien_do`
> chết) và `weekly_report_history` (sửa unique toàn hệ thống thành theo từng team — lỗi thật sẽ chặn 2
> team cùng có báo cáo cùng loại cùng tuần); bảng `team_member_gantt_colors` mới, **không chặn phân công
> khi thiếu màu**; `mindmaps` thêm `shared_team_id`. Audit Release (khoá/mở khoá/ép giờ/huỷ đợt) xác nhận
> **chưa có route nào trong code thật** nên dời hẳn sang Lát 6, không khai báo sớm.
>
> **Thiết kế kỹ thuật chi tiết Lát 5 (19/09, cùng ngày — Council thật `74715c65` hội tụ 2 vòng sạch, cả
> hai phản đối chặn ban đầu tự gỡ được bằng cách đọc sát câu chữ FR, không cần hỏi Leader — xem
> [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** thêm 2 bảng mới lấp khoảng trống FR-22 —
> `weekly_report_kinds` (allowlist `render_mode` trong code, Leader chỉ quản mã/nhãn/thứ tự/bật-tắt/yêu
> cầu Risk) và `weekly_project_risks` (khoá theo team/tuần/loại/project). `mindmap_attachments` chốt đủ
> cột + quy tắc xác thực 3 lớp (đuôi/MIME khai báo/nội dung thật) + quyền tải luôn tính theo trạng thái
> sống của Mind Map (không lưu cứng ở bản ghi file — vá đúng lỗ hổng thật đang có ở
> `mindmaps.ts:142-153`, route tải hiện chỉ chặn path traversal, không tra quyền sở hữu/chia sẻ).
> `user_redmine_config` mỗi người 1 khoá; sửa lỗi soạn thảo CR cũ (URL Redmine không nằm ở `app_config`
> — vẫn ở `app_settings` như code thật). FR-44 chốt đủ 11 quy tắc chống SSRF. FR-38 chốt danh sách xoá
> MCP cụ thể bằng grep code thật.
>
> **Thiết kế kỹ thuật chi tiết Lát 6 (19/09, cùng ngày):** Council thật `84473697` dừng ở vòng 2 vì
> `semantic_gate_failed` (**lỗi hành văn** — sót từ tiếng Anh "canonical", không phải lỗi thiết kế). Bản
> Council đó giả định sai vai trò team điều phối (suy từ code hệ 1-user cũ); sau đó **Leader tự mô tả lại
> trực tiếp** cách Release nên vận hành (xem [exchange 2026-09-19](../../exchanges/2026-09-19.md)), làm lộ
> **4 chỗ hiểu sai** — đã hỏi lại qua 6 câu hỏi coaching và Leader chốt trực tiếp toàn bộ, thay hẳn bản
> Council ban đầu. Kết quả cuối (§6.3, §10 Lát 6): **FR-23 tách 3 việc** thay vì 2 — (a) Leader mọi team tự
> đăng ký lịch **khẩn cấp** cho team mình; (b) **chỉ Leader team điều phối** ấn định **1 ngày chính duy
> nhất cho định kỳ, dùng chung toàn hệ thống** (không phải mỗi team một lịch riêng); (c) **mọi người**
> (không riêng team điều phối) có tab cá nhân tự quản lý template + định nghĩa task để sinh task cho bản
> thân. **FR-25** (xung đột lịch) **chỉ áp dụng khẩn cấp**, so theo mốc `release_at`. **FR-28 gộp hoàn
> toàn vào FR-28a** — bỏ hẳn khái niệm "checklist vận hành riêng của team điều phối" và bảng
> `release_operational_checklist_items`: Leader điều phối dùng đúng tab cá nhân như mọi người. **Bỏ hẳn
> bảng `personal_release_checklists`** (tự tạo sai ở Lát 3/4, commit `70b63697`) — checklist cá nhân dùng
> đúng 4 bảng thật có sẵn trong code (`release_templates`/`release_task_definitions`/hai bảng khẩn cấp
> tương ứng), thêm `owner_user_id` vì mỗi người có bộ riêng, không chia sẻ. Khẩn cấp cần 3 mốc giờ
> (`deploy_staging_at`/`release_at`/`deploy_demo_at`) thay vì 1 mốc — và tab cá nhân khi sinh task khẩn
> cấp **bắt buộc khớp đúng 3 mốc chính thức team đã đăng ký**, không cho gõ tay lệch. Giữ nguyên: công tắc
> Admin riêng theo team cho FR-28a (Leader xác nhận không mặc định mở). **(Cập nhật lần 5, xem dưới: bảng
> `release_announcements`+`release_announcement_revisions` mà bản Council đầu thiết kế đã bị bỏ hẳn cùng
> FR-29 — không còn tính năng bài thông báo gộp.)**
>
> **Vòng làm rõ thứ 3 cùng ngày (19/09) — Leader mô tả trực tiếp các trường/luồng cụ thể của Release, xem
> [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** `team_release_registrations` thêm các trường
> Leader vừa mô tả: `platforms` (Web/Mobile), `ticket_numbers` (nhập nhiều số dạng thẻ), `japan_coordination_link`
> + `no_japan_coordination_reason` (bắt buộc đúng 1 trong 2), `notes` (textarea + phím tắt Tab/Enter tự
> đánh số, không rich-text); `deploy_demo_at` đổi thành **tự tính = 16:00 cùng ngày `release_at`**, không
> cho nhập tay. **FR-25 chốt quy tắc so xung đột cụ thể:** cùng ngày release + khác giờ release/ngày hoặc
> giờ deploy staging mới tính xung đột — các trường khác (hệ thống, ticket, ghi chú...) không tham gia so
> sánh. **`release_cycles` cho khẩn cấp không cần ai "mở đợt" trước** — tự tìm-hoặc-tạo theo đúng ngày
> release, nên 1 tháng tự nhiên có nhiều đợt khác nhau. **FR-26 khoá toàn bộ trường** (không riêng ngày
> giờ như bản trước), có luồng mở khoá → sửa → **tự khoá lại khi lưu** kèm cảnh báo xác nhận và thông báo
> cho Leader điều phối; `release_unlock_requests` đơn giản hoá (`kind='edit'|'cancel'`, không lưu giá trị
> đề xuất trước).
>
> **Vòng làm rõ thứ 4 cùng ngày (19/09) — 3 câu hỏi phạm vi/vòng đời còn sót:** Member của **chính team
> đăng ký** xem đầy đủ ticket/ghi chú/link Nhật như Leader team mình — chỉ team KHÁC mới bị lọc bớt (sửa
> FR-24, ranh giới lọc field là theo team sở hữu, không theo Member/Leader). **Bỏ hẳn trạng thái `draft`**
> của `team_release_registrations` — tạo là coi như nộp luôn (`submitted`/`locked`/`cancelled`). Release
> định kỳ **cho phép nhiều `release_cycles` `status='open'` song song** — Leader điều phối được đặt sẵn
> ngày cho kỳ sau trong khi kỳ hiện tại chưa xong; tab cá nhân định kỳ phải cho chọn đúng đợt khi có nhiều
> đợt đang mở. Lát 6 coi như **xong thiết kế** — không còn câu hỏi chặn nào.
>
> **Vòng làm rõ thứ 5 cùng ngày (19/09) — bỏ hẳn tính năng bài thông báo gộp:** Sau khi được nhắc lại nội
> dung, Leader xác nhận trực tiếp **không cần "bài thông báo song ngữ Việt/Nhật gộp nhiều team"** — mỗi
> team tự lo báo bên Nhật theo cách riêng (qua `japan_coordination_link` đã đăng ký ở FR-23a). **Bỏ hẳn
> FR-29** (giữ mã, không còn nội dung) và **bỏ hẳn 2 bảng `release_announcements`/`release_announcement_revisions`**.
> **FR-30 được giữ lại nhưng thu hẹp phạm vi** — không còn về "bài thông báo", mà về đúng lỗi thật đã xác
> nhận ở `release.tsx:322` (`addMinutes(date,120)`) trong hàm render **nội dung template cá nhân khẩn cấp**
> (FR-23c/FR-28a) — bug này độc lập với tính năng bài thông báo đã bỏ, vẫn phải sửa vì hàm đó vẫn dùng cho
> template cá nhân đang giữ lại.
>
> **Vòng làm rõ thứ 6 cùng ngày (19/09) — chốt đúng phạm vi khoá/mở khoá:** Claude phát hiện §6.1 (13/09)
> giả định "khoá cấp TOÀN KỲ, không phải nút từng dòng team" trong khi thiết kế lần 3 lại viết theo hướng
> khoá từng registration riêng — nêu rõ mâu thuẫn, hỏi lại. Leader chốt: **khoá là 1 nút cấp cả đợt** (khoá
> hết mọi team cùng lúc); **duyệt 1 yêu cầu mở khoá thì mở lại TOÀN BỘ các team trong đợt** (không chỉ
> riêng team đã gửi); nhưng **mỗi team tự khoá lại riêng dòng của mình khi họ bấm Lưu** (team khác chưa lưu
> vẫn còn mở), Leader điều phối vẫn giữ nút khoá cấp đợt để khoá cưỡng bức nốt các dòng còn treo. Đã sửa
> FR-26, AC-21, `release_unlock_requests` cho khớp.
>
> **Vòng làm rõ thứ 7 cùng ngày (19/09) — task cá nhân tự cập nhật khi team đổi lịch:** Leader xác nhận
> trực tiếp khi 1 team đổi giờ (qua luồng khoá/mở ở trên): "Tự động cập nhật lại giờ task đã sinh" — mọi
> task cá nhân (FR-28a) đã sinh cho đúng team+đợt đó phải tự đồng bộ lại. Tái dùng đúng cơ chế đồng bộ
> theo `originRef`/`release_key` **đã có sẵn trong code** (`planReleaseWrite()` ở `schedules.ts`), không
> cần thêm bảng/cột truy vết ngược — chỉ cần kích hoạt lại đúng luồng này cho mọi User thuộc team đó ngay
> sau khi registration lưu xong.
>
> **Vòng làm rõ thứ 8 cùng ngày (19/09) — ép giờ chung, mốc quá hạn, tự đóng xung đột:** "Ép giờ chung"
> (FR-25) là **ngoại lệ duy nhất** Leader team điều phối được ghi đè trực tiếp `deploy_staging_at`/
> `release_at` của team khác, phải khai tường minh trong route inventory (không suy ngầm từ vai trò) và
> ghi đủ `audit_log`. **Không có mốc "quá hạn" cứng** — nút ép giờ luôn sẵn có ngay khi có xung đột, Leader
> điều phối tự quyết định khi dùng. **Xung đột tự đóng (`resolved`)** ngay khi rà soát lại thấy giờ đã
> khớp, không cần xác nhận tay.
>
> **Vòng làm rõ thứ 9 cùng ngày (19/09) — chặn đăng ký mới vào đợt đã khoá:** Leader xác nhận team chưa
> từng có mặt trong đợt **không được tự tạo đăng ký mới nếu đợt đó đang khoá** — phải đi đúng luồng yêu
> cầu mở khoá như các team đã có mặt. Thêm `release_cycles.locked_at`/`locked_by` (đặt khi Leader điều
> phối bấm "Khoá lịch", gỡ khi duyệt mở khoá) làm cờ chặn tạo mới — tách khỏi
> `team_release_registrations.status` (trạng thái sửa/không-sửa-được của từng dòng đã có).
>
> **Vòng làm rõ thứ 10 cùng ngày (19/09) — cascade khi tắt Release/đổi team điều phối:** Admin tắt Release
> cho 1 team đang có đăng ký khẩn cấp còn hiệu lực → **giữ nguyên dữ liệu, chỉ chặn tạo đăng ký mới** (đúng
> nguyên tắc cascade "tắt không phá dữ liệu cũ" đã dùng cho FR-7a). Đổi team điều phối (Admin đổi
> `app_config.release_coordinator_team_id`) → **team mới tiếp quản ngay** mọi đợt đang mở/đang khoá, không
> cần bàn giao thủ công — vì `authorize()` luôn tra cấu hình này tại thời điểm gọi, không lưu cứng theo
> từng cycle. Tiện thể dọn 2 chỗ còn sót nhắc tới FR-29 đã bỏ ở FR-9/FR-9a (thay bằng đúng
> FR-25/FR-26/FR-27).
>
> **Vòng làm rõ thứ 11 cùng ngày (19/09) — dọn 2 tình huống cạnh tranh còn sót ở xung đột/mở khoá:** Huỷ 1
> bên đang xung đột → xung đột đó **tự đóng (`resolved`)** ngay, không còn ai để xung đột. Nhiều yêu cầu
> mở khoá cùng chờ duyệt cho cùng 1 cycle → duyệt 1 cái là **các yêu cầu `pending` khác của cùng cycle tự
> chuyển `approved`** (không phải `rejected`, vì mục đích đã đạt), không bắt Leader điều phối duyệt lặp.
>
> **Council thật `95a26ee6` — rà soát thiết kế Release, 19/09 (dừng ở `invalid_turn_output` sau vòng 1 do
> Codex 2 lần trả sai định dạng, Claude tự tổng hợp trực tiếp cả 2 luồng — xem
> [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** phát hiện **1 lỗi kỹ thuật thật trong CR** —
> "tự cập nhật giờ task cá nhân khẩn cấp" (FR-26 bước 5) **không** tái dùng được cơ chế đồng bộ có sẵn như
> văn bản cũ ghi nhầm, vì cơ chế đó (`planReleaseWrite()`) chỉ tồn tại cho nhánh định kỳ, nhánh khẩn cấp
> chưa có sync ở backend — cần thiết kế route mới. Phát hiện thêm 1 hệ quả kỹ thuật của quyết định "nhiều
> đợt định kỳ song song" (lần 4): code hiện dùng `release_month` làm khoá nhóm task định kỳ, 2 cycle cùng
> tháng sẽ đụng nhau nếu không đổi khoá theo `cycle_id`. Còn **3 câu hỏi sản phẩm thật chưa được hỏi Leader**
> (xem cuối §6.3 phần Lát 6): (1) đổi ngày release có chuyển registration sang cycle mới không; (2) task cá
> nhân xử lý sao khi registration bị huỷ; (3) thứ tự tương tác khoá-cả-đợt với xung đột/ép giờ.
>
> **Vòng làm rõ thứ 13 cùng ngày (19/09) — chốt cả 4 điểm Council `95a26ee6` phát hiện:** Leader xác nhận
> trực tiếp cả 4: đổi ngày release **tự chuyển registration sang cycle của ngày mới** (cycle cũ giữ lịch
> sử); huỷ đợt **chỉ huỷ task cá nhân chưa xong & chưa qua ngày** (giữ nguyên việc đã hoàn thành); Leader
> điều phối **không bị chặn** khoá lịch dù còn xung đột `open`; **ép giờ chung tác dụng được ngay cả khi
> đang `locked`**, không cần mở khoá trước. Đã áp dụng vào FR-25/FR-26.
>
> **Vòng làm rõ thứ 14 cùng ngày (19/09) — rà lại phần phân quyền (FR-6→FR-14) theo yêu cầu Leader, tránh
> hiểu nhầm:** phát hiện + sửa 1 lỗi tham chiếu cũ ở bảng năng lực Release trong FR-8 (còn trỏ tới
> FR-28/FR-29 đã gộp/xoá). Chốt thêm 3 điểm mơ hồ thật: **Admin đồng thời là thành viên thật của 1 team
> thì xem/sửa dữ liệu nghiệp vụ đúng team đó qua vai trò thật, không qua đặc quyền Admin** (FR-11); **Member
> (không riêng Leader) cũng xem được chi tiết đầy đủ nhật ký hoạt động team mình** (FR-11a); **hành động
> chạm 2 team (vd ép giờ chung) phải ghi vào nhật ký của CẢ HAI team** — kỹ thuật: ghi 2 dòng `audit_log`
> cùng nội dung khác `team_id`, không thêm cột mới.
>
> **Vòng làm rõ thứ 15 cùng ngày (19/09) — mở rộng cảnh báo mất Leader sang mọi team:** Leader xác nhận
> trực tiếp: **mọi team** (không riêng team điều phối) mất Leader hiệu lực đều tự động báo Admin ngay, nêu
> rõ team nào và hậu quả cụ thể. FR-9a giờ là **trường hợp nặng hơn** của quy tắc chung này (chuyển sang
> FR-12), không phải cơ chế riêng của team điều phối nữa.
>
> **Vòng làm rõ thứ 16 cùng ngày (19/09) — rà chức năng Task cá nhân, phát hiện lỗ hổng chéo người dùng
> thật trong code:** Leader xác nhận FR-31 là **tuyệt đối chỉ chủ sở hữu, không ngoại lệ nào** (kể cả
> Admin, kể cả hỗ trợ/sự cố). Đọc trực tiếp `server/routes/tasks.ts` phát hiện **cả 7 route thật hiện có
> đều chưa lọc theo người dùng** (đúng với desktop 1 người, phải sửa khi lên multi-user) — nghiêm trọng
> nhất: câu UPDATE hàng loạt ở `PATCH /tasks/:id?updateRelated=true` khớp theo **tên task + hình dạng lịch
> lặp, không giới hạn `id`**, nên nếu 2 User đặt tên task định kỳ trùng nhau, sửa của người này sẽ **ghi
> đè thẳng task của người kia** nếu thiếu `owner_user_id` trong WHERE. Đã ghi rõ vào FR-31, Lát 4 (`tasks`),
> và AC-24.
>
> **Vòng làm rõ thứ 17 cùng ngày (19/09) — rà chức năng Project, phát hiện lỗ hổng cùng dạng ở phân công
> nhiều người (FR-16):** Đọc trực tiếp `server/routes/projects.ts` — `PUT .../tasks/:taskId/assignments`
> thay **toàn bộ mảng phân công trong 1 lần gọi**, không kiểm dòng nào thuộc về ai. AC-12 đã đúng yêu cầu
> ("sửa khoảng người khác ⇒ 403") nhưng cơ chế thay-toàn-bộ hiện tại không tự chặn được — cần backend so
> diff mảng cũ/mới, Member chỉ được thêm/sửa/xoá đúng dòng của mình. Leader xác nhận: **Member đụng dòng
> người khác thì từ chối toàn bộ yêu cầu (403)**, không âm thầm lọc rồi lưu phần hợp lệ. Đã ghi vào FR-16.
>
> **Vòng làm rõ thứ 18 cùng ngày (19/09) — chống 2 người cùng sửa danh sách người phụ trách gần lúc nhau:**
> Vì route vẫn gửi/thay cả danh sách trong 1 lần, 2 người mở popup gần nhau rồi lưu nối tiếp có thể vô
> tình xoá thay đổi của nhau (giống lỗi 2 người cùng sửa 1 file Excel chia sẻ). Leader chọn tái dùng đúng
> cơ chế chống-sửa-trùng đã có (FR-18/46) thay vì thiết kế route mới: client gửi kèm `row_version` của
> `project_tasks` đọc lúc mở popup, lệch thì `409`. Đã ghi vào FR-16.
>
> **Vòng làm rõ thứ 19 cùng ngày (19/09) — soi tiếp Project, phát hiện route sắp xếp danh sách sẽ hỏng
> hoàn toàn ở multi-team:** `GET /projects`, `GET /projects/closed`, `POST /projects`,
> `PATCH /projects/reorder` đều truy vấn không lọc theo team. Nghiêm trọng nhất: `PATCH /projects/reorder`
> bắt buộc mảng gửi lên khớp **toàn bộ danh sách project mở trên TOÀN HỆ THỐNG** — không sửa thì route này
> **hỏng hoàn toàn** ở multi-team (Leader sắp xếp project team mình luôn bị từ chối vì thiếu project team
> khác). Đây là bug chức năng rõ ràng, không chỉ là lỗ hổng bảo mật như 2 lần trước. Đã ghi vào FR-13, kèm
> lưu ý route inventory (FR-41) cần rà lại mọi route liệt kê/sắp xếp hàng loạt tương tự ở các chức năng
> khác, không riêng Project.
>
> **Vòng làm rõ thứ 20 cùng ngày (19/09) — bỏ hẳn ô chữ tự do, bắt buộc chọn User thật:** Đọc code thấy
> cả `project_tasks.assignee` (tách biệt với `project_task_assignments`) lẫn `projects.pic` (bắt buộc khi
> tạo project) đều là cột chữ tự do còn sống song song với cơ chế User thật mới. Leader xác nhận trực
> tiếp: **bỏ hẳn cả hai ô chữ tự do này**, bắt buộc chọn qua đúng cơ chế User thật (kể cả project/task chỉ
> cần 1 người). `POST /projects` ngừng nhận `body.pic`; `PATCH .../tasks/:taskId` ngừng nhận `body.assignee`
> — 2 cột gốc thành dữ liệu chết sau di trú, giá trị cũ chỉ còn đọc qua `legacy_pic_label`.
>
> **Council thật `812796b0` — rà soát tính thống nhất toàn bộ CR sau 20 vòng làm rõ, 19/09 (dừng ở
> `invalid_turn_output` sau vòng 1 do Codex 2 lần trả sai định dạng, Claude tự tổng hợp — xem
> [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** kết luận CR **đã nhất quán về mặt quyết định**
> — không tìm thấy mâu thuẫn thiết kế thật nào giữa các phần đã sửa riêng lẻ trong ngày; chỉ tìm thấy 3
> chỗ **câu chữ ở phần đầu tài liệu** (§2 Mục tiêu, §3 Kịch bản — hai phần hiếm khi bị sửa lại) còn nhắc
> tới "bài thông báo gộp" và "khoá lịch tại hạn chót" đã bị bỏ, và 1 chỗ đặt tên cột không nhất quán
> (`version` ở FR-46/§6.2 thay vì `row_version` đã chốt ở §6.3) — đã sửa cả 4. Bù thêm 2 khoảng trống nhỏ:
> AC-21a (traceability cho 3 quyết định ở vòng làm rõ thứ 13 chưa có AC riêng) và làm rõ FR-16 lấy vai trò
> Leader/Member theo đúng `team_id` suy từ DB, không tin bộ chọn team phía client. **Không phát hiện
> khoảng trống thiết kế nào chặn tiến độ ở Lát 3-6** ngoài 2 artefact đã tự khai còn thiếu từ đầu (route
> inventory đầy đủ, benchmark Dev13).

> **Đây là CR nền tảng (umbrella).** Nó chốt hợp đồng cho **tầng nền** dùng chung: danh tính, team, phân
> quyền, hạ tầng, di trú dữ liệu. Phần điều chỉnh riêng của từng chức năng được liệt kê ở §10 theo lát;
> lát nào đủ lớn để cần DoR riêng thì mở CR con trỏ ngược về CR này, **không mở rộng CR này**.

---

## 1. Bối cảnh & Vấn đề

Task Manager hiện là **ứng dụng desktop một người dùng**: đóng gói SEA thành `TaskManager.exe`, dữ liệu
SQLite nằm ở `%APPDATA%/TaskManager/data/tasks.sqlite`, server bind `127.0.0.1`, **không có khái niệm
người dùng nào trong toàn bộ backend** — không session, không xác thực, không cột chủ sở hữu trên bất kỳ
bảng nào.

Leader muốn mở tool cho các team trong công ty dùng chung, bắt đầu từ Dev13. Nhu cầu thật đằng sau:
Member tự tạo task và tự xác nhận tiến độ bằng Gantt, Leader nhìn được bức tranh cả team, và quy trình
release — vốn do Dev13 điều phối cho toàn công ty — được đưa vào tool thay vì trao đổi thủ công.

Vấn đề không nằm ở chỗ "thêm màn đăng nhập". Ba thứ khiến đây là thay đổi Lớn:

1. **Mọi bảng dữ liệu hiện tại đều không biết ai sở hữu gì.** `pics.name` và `project_tasks.assignee` là
   chuỗi tự do, có thể chứa `"A, B"` — không phải khoá ngoại. Chuyển sang người dùng thật là thay đổi
   schema thật.
2. **Dữ liệu nền đang nằm lẫn trong tab làm việc hằng ngày** (mẫu release, định nghĩa task release, cấu
   hình mention/group, danh sách PIC, khoá Redmine). Khoá theo tab là chưa đủ — xem [exchange §6.1](../../exchanges/2026-09-13.md).
3. **Mở ra Internet công khai** phá thẳng giả định "chỉ chạy local, bind `127.0.0.1`" mà toàn bộ chuẩn
   bảo mật hiện hành đang dựa vào.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Nhiều người trong nhiều team đăng nhập được bằng tài khoản công ty và làm việc trên **cùng một kho dữ
    liệu dùng chung theo team**, không ai thấy dữ liệu team mình không thuộc về.
  - Admin bật/tắt được **từng chức năng cho từng team** ở **một khu vực cấu hình duy nhất**, với đúng 2
    mức Tắt/Bật cho cả 5 chức năng (sửa 19/09), không cần sửa code.
  - Toàn bộ dữ liệu thật hiện có của Dev13 (project, task, mục tiêu tuần, cấu hình release, Mind Map)
    **chuyển lên server nguyên vẹn**, không mất bản ghi nào.
  - Quy trình release nhiều team chạy được đầu-cuối: mỗi team đăng ký lịch khẩn cấp → hệ thống phát hiện
    trùng → khoá lịch → tab cá nhân mỗi người tự sinh task theo đúng lịch team, nội dung tiếng Nhật (nếu
    có) tự đổi đúng giờ (**SỬA 19/09 — bỏ hẳn tính năng "bài thông báo gộp" từng nêu ở bản trước, xem
    FR-29**).
  - Không còn đường ghi dữ liệu nào không qua xác thực.

- **Ngoài phạm vi (không làm lần này):**
  - **Luyện đề** — ở lại bản desktop, không lên server (quyết định 13/09, đổi so với 12/09).
  - **Giao diện cho điện thoại** — chỉ hỗ trợ trình duyệt máy tính.
  - **Cập nhật thời gian thực** giữa các người dùng (không WebSocket).
  - **Môi trường staging** — triển khai thẳng bản chính thức.
  - Giới hạn IP và 2FA riêng của app (lớp bảo vệ 3 và 4) — hoãn, xem §5.
  - Danh sách việc chung của team / liên team (lộ trình sau của Task cá nhân) — ghi nhận ở backlog riêng.
  - Tự động xoá dữ liệu của người đã rời công ty.

## 3. Người dùng & Kịch bản

Bộ từ về danh tính (Admin / Leader / Member / Team điều phối release / Người phụ trách / Người tạo) được
chốt tại [exchange 2026-09-13 §1](../../exchanges/2026-09-13.md) và **dùng nguyên vẹn trong code và
docs**. Nhắc lại hai luật dễ nhầm: *Leader/Member là vai trò trong một team cụ thể, quyền luôn tính theo
team đang xem*; *được gán làm người phụ trách không tự sinh ra quyền*.

- **Là Member của Dev13**, tôi muốn tự tạo task trong project của team và tự cập nhật tiến độ trên Gantt,
  để Leader thấy được tôi đang làm gì mà không phải hỏi.
- **Là Leader của Dev13**, tôi muốn điều phối thứ tự thực thi và chốt mục tiêu tuần cho cả team, để báo
  cáo lên trên phản ánh đúng số liệu thật.
- **Là Leader của một team phát triển**, tôi muốn đăng ký ngày giờ release khẩn cấp của team mình và nhìn
  thấy các team khác đã đặt ngày nào, để tự tránh trùng trước khi bị nhắc.
- **Là Leader của team điều phối release**, tôi muốn biết ngay khi hai team trùng ngày khác giờ, ép được
  giờ chung khi họ không tự thoả thuận được, và tự quyết định khi nào khoá lịch — không cần chờ một mốc
  giờ cố định nào (**SỬA 19/09 — bỏ hẳn "hạn chót" và "bài thông báo gộp" từng nêu ở bản trước, xem
  FR-25/FR-26/FR-29**).
- **Là Admin**, tôi muốn bật/tắt từng chức năng cho từng team tại một chỗ và được báo khi có người mới
  đăng nhập chọn team/vai trò, để soát lại mà không phải đi hỏi từng người.

## 4. Yêu cầu chức năng

### Nhóm A — Danh tính và phiên đăng nhập

- **FR-1:** Đăng nhập qua **OIDC của công ty** bằng luồng **Authorization Code + `state` + `nonce` +
  PKCE**; backend là **confidential client**, tự giữ phiên. Trình duyệt **không bao giờ thấy** access/id/
  refresh token của OIDC — chỉ nhận cookie phiên riêng của app. `state`/`nonce`/PKCE verifier dùng
  **một lần**, TTL ngắn; callback kiểm issuer, audience, chữ ký, thời gian và khớp đúng redirect URI đã
  đăng ký — không nhận URL quay lại tuỳ ý (chống open redirect). Không tự dựng cơ chế mật khẩu riêng.
  **Không có tài khoản dự phòng** — hệ xác thực sập thì không ai đăng nhập được.
- **FR-1a — Bootstrap Admin đầu tiên (Q2):** email của Admin đầu tiên được **cấu hình trước khi triển
  khai** (biến môi trường). Lần đăng nhập đầu tiên có email khớp cấu hình sẽ được **bind với danh tính ổn
  định của OIDC — cặp `(issuer, subject)`**, không phải email (email có thể đổi). Lần bind thứ hai hoặc
  xung đột (một `(issuer, subject)` khác cũng có email khớp) phải **fail-closed** và ghi nhật ký; ràng
  buộc unique + transaction phải đảm bảo hai callback đồng thời không tạo ra hai Admin hoặc bind một danh
  tính vào hai user.
- **FR-2:** Người đăng nhập lần đầu (không phải Admin) được **tạo tài khoản tự động** ở trạng thái
  **`pending`** từ thông tin OIDC (email + tên hiển thị), rồi **chọn team và vai trò mong muốn** (Member /
  Leader) từ danh sách team **đã có sẵn** — không tự tạo team mới. **Đây chỉ là gửi yêu cầu tham gia,
  KHÔNG cấp quyền nghiệp vụ nào ngay** (đổi so với thiết kế ban đầu — xem Q3 ở
  [exchange 2026-09-13](../../exchanges/2026-09-13.md)).
- **FR-3:** **Admin nhận thông báo trong app** ngay khi có yêu cầu tham gia mới (FR-2), **duyệt** thì
  người đó mới chuyển sang `active` và có quyền; Admin **có thể sửa team/vai trò ngay trong lúc duyệt**
  nếu thấy bất hợp lý, không phải duyệt xong mới sửa. Lần đầu tiên sau khi được duyệt, người dùng **bắt
  buộc phải xem một popup thông báo rõ team và vai trò đã được cấp** (chỉ cần bấm "Đã hiểu" một lần) trước
  khi vào được màn hình khác.
- **FR-3a — Từ chối yêu cầu tham gia:** Admin **từ chối không cần nhập lý do** — bấm nút là xong. Bị từ
  chối **không phải khoá vĩnh viễn**: lần đăng nhập kế tiếp, người đó **quay lại đúng màn "Chọn team và
  vai trò"** như lần đầu, được thử chọn lại (có thể chọn khác đi) chứ không bị kẹt ở trạng thái từ chối.
- **FR-4:** Phiên lưu **trong DB** (không lưu RAM) để chịu được restart/deploy và **thu hồi được toàn bộ
  phiên của một user bất kỳ lúc nào** (Q4). Cookie phiên `__Host-<tên>`, giá trị ngẫu nhiên ≥256 bit, DB
  chỉ lưu **hash** của giá trị đó — không lưu token OIDC. Cookie: `HttpOnly`, `Secure`, `SameSite=Lax`,
  `Path=/`, không đặt `Domain` (ràng buộc vào đúng origin). Hạn tuyệt đối **1 tuần**; xoay vòng (rotate)
  session sau khi đăng nhập lại và sau mỗi lần đổi quyền nhạy cảm. **Không có khoá tạm khi "đăng nhập sai
  nhiều lần"** — app không tự xác minh mật khẩu OIDC, việc chống đoán mò/replay nằm ở giới hạn tốc độ của
  chính bước callback OIDC (xem SEC-PERF-004/005 ở §5).
- **FR-4a — Kiểm trạng thái mỗi request (Q4):** mỗi request phải tra lại trạng thái tài khoản
  (`active`/`disabled`) và tư cách thành viên team **từ DB**, không tin vào bất cứ thứ gì đã ký/cache
  trong cookie hay token. Tài khoản bị vô hiệu, phiên bị thu hồi, hoặc vai trò/team bị đổi phải có hiệu
  lực **ngay ở request kế tiếp** — không có độ trễ cache. **Khi FE nhận lỗi mất quyền giữa lúc đang thao
  tác**, hiện popup rõ ràng: *"Quyền của bạn đã bị thay đổi, hãy xác nhận lại với Leader hoặc Admin"* —
  không phải thông báo lỗi chung chung khiến người dùng tưởng app hỏng.

> **FR-5 đã BỎ (quyết định 13/09, đảo ngược so với bản trước).** Bản trước có "cảnh báo đăng nhập từ
> thiết bị/vị trí lạ" như lớp bảo vệ tự làm thứ hai. Leader xác nhận không cần — chấp nhận tin hoàn toàn
> vào hệ xác thực OIDC của công ty cho việc này, kể cả khi tài khoản bị chiếm dụng thì app sẽ không tự
> phát hiện/báo được. Hệ quả: bảng `login_events` (chỉ phục vụ FR-5) cũng bỏ theo — xem §6.3. AC-4 (test
> cho FR-5) cũng bỏ theo — xem §8.

### Nhóm B — Team và phân quyền

- **FR-6:** Mô hình **User ↔ Team nhiều-nhiều**; mỗi team có **tối đa một Leader** (0 hoặc 1, không bao
  giờ nhiều hơn 1). **Team mới tạo có thể tạm thời chưa có Leader** — Admin tạo team trống trước, gán
  Leader sau khi có người đăng nhập chọn vào team đó (không bắt buộc chọn sẵn tài khoản lúc tạo, vì lúc
  đó có thể chưa ai từng đăng nhập vào team này). Một người có thể là Leader ở team này và Member ở team
  khác.
- **FR-7 (SỬA 19/09 — đơn giản hoá sau khi Leader tự rà lại toàn bộ mô hình phân quyền, xem
  [exchange 2026-09-19.md](../../exchanges/2026-09-19.md)):** **Bảng hiển thị chức năng** (tầng 2): mỗi ô
  `(team × chức năng)` chỉ còn **2 mức** — `Tắt` · `Bật`. Do Admin cấu hình, có hiệu lực không cần deploy
  lại. **Đúng 5 cột, cùng một mô hình 2 mức cho cả 5**: Task cá nhân, Project, Báo cáo tuần, Release,
  Mind Map (Luyện đề không có cột vì đã ở lại bản desktop; Cài đặt không có cột vì không phải thứ bật/tắt
  theo team). **Bản 13/09 từng có 4 mức** (`Tắt`/`Cả team chỉ đọc`/`Cả team làm việc`/`Chỉ Leader`, riêng
  Release co lại còn 3 mức) — **bản này đã bị thay thế hoàn toàn**: việc mất các trạng thái "chỉ đọc" và
  "chỉ Leader" ở tầng 2 là **có chủ đích**, không được tái tạo ngầm ở tầng 3. Khác biệt Member/Leader
  trong một chức năng đã Bật nay hoàn toàn do **tầng 3 (FR-8)** quyết định, giống nhau ở mọi team, Admin
  không cấu hình lại được nữa. **Nguyên tắc chung cho mọi cột (giữ nguyên từ 13/09):** `Tắt` một chức
  năng **không bao giờ xoá dữ liệu đã có** — chỉ ẩn giao diện. Bật lại thì thấy đủ nguyên trạng như trước
  khi tắt.
- **FR-7a — Báo cáo tuần phụ thuộc Project (mới 19/09):** một team chỉ **Bật** được Báo cáo tuần khi
  Project của **chính team đó** đang Bật (Báo cáo tuần lấy dữ liệu mục tiêu/tiến độ từ Project). Tắt
  Project của một team thì **tự động tắt theo** Báo cáo tuần của team đó trong cùng một giao dịch, kèm
  **cảnh báo cho Admin** nêu rõ lý do bị tắt theo. **Bật lại Project sau đó KHÔNG tự bật lại Báo cáo
  tuần** — Admin phải tự bật lại nếu muốn (tránh bật nhầm một chức năng Admin có thể đã tắt độc lập từ
  trước, không liên quan gì tới Project). Bất biến bắt buộc ở backend: **Báo cáo tuần Bật ⇒ Project
  Bật**, không được để xảy ra trạng thái ngược lại kể cả khi hai Admin thao tác đồng thời. Bảng chuyển
  trạng thái đầy đủ:

  | Trạng thái trước | Thao tác | Kết quả |
  |---|---|---|
  | Project Tắt, Báo cáo tuần Tắt | Bật Báo cáo tuần | Bị chặn, giải thích phải bật Project trước |
  | Project Bật, Báo cáo tuần Tắt | Tắt Project | Project tắt; Báo cáo tuần giữ nguyên Tắt |
  | Project Bật, Báo cáo tuần Bật | Tắt Project | Cảnh báo Admin; một giao dịch tắt cả hai cùng lúc |
  | Project Tắt, Báo cáo tuần Tắt | Bật Project | Chỉ Project bật; Báo cáo tuần vẫn Tắt |
  | Project Tắt, Báo cáo tuần Bật | (bất kỳ) | Trạng thái không hợp lệ — backend không bao giờ được để xảy ra |
- **FR-8 (SỬA 19/09 cho Release và Báo cáo tuần):** **Luật năng lực (tầng 3) cố định trong code, giống
  nhau ở mọi team**, không cấu hình được. Bảng gốc theo từng chức năng ở
  [exchange §3, 13/09](../../exchanges/2026-09-13.md) vẫn đúng cho Project/Task cá nhân/Mind Map. Riêng
  **Release** và **Báo cáo tuần** đổi theo quyết định 19/09 ([exchange 2026-09-19.md](../../exchanges/2026-09-19.md)):
  - **Báo cáo tuần khi Bật:** Leader thao tác với các record nhất định (chốt tuần bằng wizard, xoá toàn
    bộ mục tiêu tuần — đúng bảng năng lực đã có); **Member chỉ xem** mục tiêu/báo cáo đã lưu trên màn
    hình (không có tính năng xuất file trong phạm vi CR này).
  - **Release khi Bật, ba chủ thể tách riêng — không cộng dồn quyền:**

    | Chủ thể | Quyền cố định |
    |---|---|
    | Member của team được Bật Release (kể cả team điều phối) | Xem bảng lịch chung (FR-24); không đăng ký/sửa lịch team; tự quản lý template + tự áp dụng task cá nhân của mình nếu muốn (FR-23c/FR-28a) |
    | Leader team phát triển | Mọi quyền của Member ở trên, **cộng thêm**: đăng ký/sửa/huỷ lịch khẩn cấp của team mình (FR-23a/FR-27) |
    | Leader team điều phối | Mọi quyền của Member ở trên (cho chính team mình, giống mọi Leader team khác), **cộng thêm**: ấn định 1 ngày chính cho định kỳ dùng chung toàn hệ thống (FR-23b); khoá lịch/duyệt mở khoá/ép giờ chung — kể cả ghi đè trực tiếp lịch team khác (FR-25/FR-26) |

  **SỬA 19/09 (dọn 2 tham chiếu sai tới FR-28/FR-29 đã bị gộp/xoá sau 13 vòng làm rõ chức năng Release —
  xem [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** không còn "checklist vận hành riêng của
  team điều phối" (đã gộp vào FR-28a, dùng chung cơ chế cá nhân với mọi người) và không còn "sinh bài gộp"
  (FR-29 đã bỏ hẳn). Thi hành **ở backend**, không chỉ ẩn nút ở giao diện.
- **FR-9 (bổ sung 19/09, không đổi bản chất):** **Vai đặc biệt (tầng 4)**: cấu hình chọn **một team làm
  team điều phối release**; các team còn lại là **team phát triển**. Một team chỉ đóng **một vai**.
  **Quyền tầng 4 độc lập với trạng thái Bật/Tắt Release (tầng 2) của chính team điều phối** — nếu Admin
  tắt Release cho team điều phối, Leader team đó **vẫn giữ** quyền khoá lịch/duyệt mở khoá/ép giờ chung
  trên dữ liệu của các team khác (Leader xác nhận rõ 19/09: đây là vai trò riêng, không nên phụ thuộc một
  công tắc bật/tắt có thể bị tắt nhầm, tránh làm kẹt toàn bộ quy trình release của công ty). **Đổi team
  điều phối (Admin chọn team khác trong `app_config.release_coordinator_team_id`) tự động chuyển giao
  ngay quyền xử lý mọi đợt đang mở/đang khoá sang Leader team điều phối mới** (chốt 19/09 lần 10, Leader
  xác nhận trực tiếp) — vì `authorize()` luôn tra `app_config.release_coordinator_team_id` **tại thời điểm
  gọi**, không lưu cứng "team điều phối của cycle X" vào từng cycle, nên đổi cấu hình là có hiệu lực ngay
  lập tức trên mọi cycle hiện có, không cần thao tác bàn giao thủ công nào thêm.
- **FR-9a — Cảnh báo khi team điều phối mất Leader (mới, thêm 13/09; SỬA 19/09 lần 15 — nay là trường hợp
  nặng hơn của quy tắc chung ở FR-12, không phải cơ chế riêng biệt):** team điều phối release **có thể
  tạm thời không có Leader hiệu lực** theo **hai cách** (chốt cả hai, không chỉ ca đầu): (a) Leader cũ **rời
  khỏi team** (row `team_members` role=`leader` biến mất) — Admin chưa kịp chỉ định người mới, theo đúng
  cơ chế FR-12 "team mất Leader thì Admin chỉ định người mới"; (b) Leader cũ **vẫn còn giữ vai trong team**
  nhưng **tài khoản bị Admin chuyển `disabled`** (FR-4a) — về dữ liệu team "vẫn có Leader" nhưng người đó
  không đăng nhập/thao tác được gì, hiệu quả giống hệt ca (a). Trong lúc đó, các thao tác **chỉ Leader
  điều phối mới làm được** (khoá lịch, duyệt mở khoá, ép giờ chung — FR-25/26/27) tạm thời không ai xử
  lý; **các thao tác khác không bị ảnh hưởng** (team phát triển vẫn đăng ký/sửa
  lịch của mình bình thường, vì FR-23 đã tách hai phần gác riêng). Để rút ngắn thời gian treo: **ngay khi
  team điều phối không còn Leader hiệu lực (đúng ca (a) hoặc (b)), hệ thống tự động gửi thông báo cho
  Admin** qua đúng kênh FR-34 sẵn có, **nêu rõ hậu quả** (*"Team điều phối release [tên team] hiện không
  có Leader hiệu lực — các thao tác khoá/duyệt lịch release của MỌI team đang bị treo cho tới khi có
  Leader mới, cần chỉ định ngay"*) — không cấp thêm quyền tạm thời nào cho Admin (không vi phạm FR-11),
  chỉ giúp Admin biết sớm để dùng đúng luồng FR-12 sẵn có.
- **FR-10:** Toàn bộ cấu hình ở FR-7 và FR-9, cùng việc tạo team và chỉ định Leader, nằm trong **một khu
  vực quản trị duy nhất, chia theo khu**, và **chỉ Admin** sửa được.
- **FR-11:** **Admin chỉ xem và sửa cấu hình. Admin KHÔNG xem, KHÔNG sửa dữ liệu nghiệp vụ của bất kỳ
  team nào** mà mình không thuộc về. Không có chế độ xem khẩn cấp. **Làm rõ 19/09 lần 14 (Leader xác nhận
  trực tiếp, tránh hiểu nhầm khi rà lại phần phân quyền):** nếu tài khoản Admin **đồng thời cũng là
  Member/Leader thật của một team** (có row `team_members`), họ xem/sửa đầy đủ dữ liệu nghiệp vụ của
  **đúng team đó** — y hệt mọi Member/Leader khác, đi qua đúng vai trò thật của họ ở team đó, **không phải
  qua đặc quyền Admin**. Ranh giới FR-11 chỉ chặn dữ liệu của team họ **không** có mặt.
- **FR-11a — Hai mức xem nhật ký (Q5, SỬA 19/09 lần 14 — thêm Member, tránh hiểu nhầm):** **Admin chỉ thấy
  metadata quản trị** trong nhật ký thao tác (FR-19): ai, hành động gì, team nào, thời điểm — không thấy
  nội dung nghiệp vụ chi tiết. **Cả Leader lẫn Member đều thấy chi tiết đầy đủ nhật ký của team mình**
  (không riêng Leader — Leader xác nhận trực tiếp: nhật ký team là minh bạch cho mọi thành viên), không
  thấy nhật ký team khác. Đây là hai *projection* khác nhau trên cùng một nguồn `audit_log`, không phải
  hai bảng riêng. **Hành động chạm tới 2 team (chốt 19/09 lần 14) — ví dụ "ép giờ chung" (FR-25) ghi đè
  trực tiếp lịch của team khác:** phải **ghi 2 dòng `audit_log`** cho cùng 1 hành động, mỗi dòng
  `team_id` khác nhau (team của actor thực hiện, và team có dữ liệu bị ảnh hưởng) — cùng nội dung
  action/payload/actor — để Leader/Member **cả hai team** đều thấy đúng trong nhật ký của team mình, không
  phải chỉ team của người thực hiện hành động.
- **FR-12 (SỬA 19/09 lần 15 — mở rộng thông báo mất Leader từ riêng team điều phối sang MỌI team, tránh
  hiểu nhầm khi rà lại phân quyền):** **Leader tự quản thành viên team mình**: thêm và bớt được. Chỉ thêm
  được **người đã từng đăng nhập ít nhất một lần**. Việc tạo team và chỉ định Leader vẫn thuộc Admin; team
  mất Leader thì **Admin chỉ định người mới**. **Bất kỳ team nào mất Leader hiệu lực đều tự động báo
  Admin ngay** (Leader xác nhận trực tiếp: không riêng team điều phối) — dùng đúng cơ chế đã tả ở FR-9a
  (hai cách mất hiệu lực: rời team, hoặc tài khoản bị `disabled`), qua kênh FR-34, nêu rõ **team nào** và
  **hậu quả cụ thể của team đó** (vd "Team X hiện không có Leader — Member team X không đăng ký/sửa được
  lịch Release, không chốt được tuần, không sửa được project của team"); không cấp thêm quyền tạm thời nào
  cho Admin (không vi phạm FR-11). FR-9a là **trường hợp nặng hơn** của đúng quy tắc chung này (mất Leader
  ở team điều phối làm treo thao tác của MỌI team khác, không chỉ team đó), không phải một cơ chế riêng.
- **FR-12a — Cảnh báo trước khi bớt thành viên:** khi Leader định bớt một người khỏi team, hệ thống phải
  **hiện số task chưa hoàn thành của người đó** trước khi Leader xác nhận — không bớt âm thầm ngay lập
  tức. Đây là bước xác nhận có thông tin, không phải chặn cứng: Leader vẫn bớt được sau khi thấy cảnh báo.
- **FR-13:** Người thuộc nhiều team có **bộ chọn team hiện tại**; mọi màn hình nghiệp vụ hiển thị theo
  đúng team đang chọn, **không gộp dữ liệu nhiều team trên một màn**.

  **Cảnh báo kỹ thuật thật, đọc trực tiếp code (`server/routes/projects.ts`), 19/09 lần 19 — không phải
  rủi ro giả thuyết:** `GET /projects`, `GET /projects/closed`, `POST /projects` (tính `sort_order` kế
  tiếp qua `MAX(sort_order)`) đều truy vấn **không lọc theo team** — đúng với desktop hiện chỉ có 1 team
  Dev13. **Nghiêm trọng nhất:** `PATCH /projects/reorder` (dòng 87-114) bắt buộc mảng `projectIds` gửi lên
  khớp **chính xác toàn bộ danh sách project đang mở trên TOÀN HỆ THỐNG** (`existingIds.length !==
  uniqueIds.length` ⇒ từ chối) — lên multi-team mà không sửa, route này **hỏng hoàn toàn**: Leader team A
  sắp xếp lại project của team mình sẽ luôn nhận lỗi "danh sách project không khớp" vì thiếu project của
  team B/C. Bắt buộc thêm `WHERE team_id = ?` (từ `activeTeam` do `authorize()` xác định, không tin
  client) vào cả 4 truy vấn này khi implement — đây là ví dụ cụ thể cho việc **route liệt kê/sắp xếp hàng
  loạt cần lọc phạm vi tường minh**, khác với kiểm tra quyền trên 1 bản ghi đơn lẻ mà hợp đồng
  `authorize()` (FR-40) đã mô tả — route inventory (FR-41) khi làm đủ phải rà lại toàn bộ nhóm route dạng
  này (liệt kê/sắp xếp hàng loạt) ở mọi chức năng, không riêng Project.
- **FR-14:** **Task cá nhân** nằm trong bảng FR-7 nhưng theo **luật hợp nhất**: người thuộc nhiều team
  chỉ cần **một team bật** là có chức năng này. Danh sách task cá nhân **là một, không đổi theo bộ chọn team**.

### Nhóm C — Dữ liệu và tính toàn vẹn

- **FR-15 (làm rõ 19/09 lần 20, Leader xác nhận trực tiếp):** **PIC → Người phụ trách là User thật.**
  Task/project di trú giữ **nguyên tên chữ cũ làm nhãn tham khảo chỉ-đọc**; không tự động nối tên cũ với
  tài khoản. Ai sửa task sau này thì tự chọn người thật thay vào — **bỏ hẳn mọi ô nhập tên chữ tự do**
  (task/project), bắt buộc chọn qua đúng cơ chế User thật (kể cả task chỉ cần đúng 1 người, vẫn đi qua
  cùng cơ chế `assignments` của FR-16, không có đường ghi chữ tự do song song).
- **FR-16:** Một task project có thể có **nhiều người phụ trách**, mỗi người **một khoảng thời gian
  riêng, được phép chồng lấn**. Mỗi người **chỉ sửa được phần thời gian của mình**; tên task và thông tin
  chung thì **người phụ trách và Leader** đều sửa được. **`% tiến độ` là một con số chung cho cả task.**
  **Ma trận thêm/bớt người phụ trách (Q7, tạm chấp nhận, mở lại nếu vận hành thật phát sinh khó khăn):**
  **Leader thêm/bớt được bất kỳ ai**; **Member chỉ tự thêm được chính mình** (không thêm người khác) và
  **tự rút được chính mình** ra khỏi task (không bớt người khác). **Thao tác qua popup sửa task hiện có**
  (thêm ô chọn nhiều người + khoảng thời gian từng người vào bên trong), **không** thao tác trực tiếp
  trên thanh Gantt. **Chi tiết implement (bù khoảng trống nhỏ Council `812796b0` nêu):** vai trò
  "Leader hay Member" ở đây tính theo **`team_id` của `projects` cha** (suy ra từ `project_tasks.team_id`
  qua đúng resolver chuẩn của `authorize()`, FR-40) — không tính theo team đang chọn ở bộ chọn team (FR-13)
  nếu 2 giá trị này khác nhau (không nên xảy ra do trigger hai chiều ở Lát 4, nhưng resolver vẫn phải đọc
  từ DB, không tin giá trị bộ chọn phía client).

  **Cảnh báo kỹ thuật thật, đọc trực tiếp code (`server/routes/projects.ts`), 19/09 lần 17:**
  `PUT /projects/:projectId/tasks/:taskId/assignments` (và nhánh `assignments` trong
  `PATCH /projects/:projectId/tasks/:taskId`) hiện **thay thế toàn bộ mảng phân công trong 1 lần gọi** —
  `saveTaskAssignments()` chạy `DELETE ... WHERE project_task_id = ?` rồi ghi lại nguyên mảng client gửi,
  **không kiểm từng dòng thuộc về ai**. AC-12 đã đúng yêu cầu ("sửa khoảng của người khác ⇒ 403") nhưng cơ
  chế "thay toàn bộ mảng" hiện tại **không tự nhiên chặn được** — cần backend **so sánh mảng cũ với mảng
  mới** trước khi ghi: nếu actor là Member, chỉ chấp nhận diff thuộc 1 trong 3 dạng (thêm đúng 1 dòng của
  chính mình / sửa đúng dòng của chính mình / xoá đúng dòng của chính mình), **bất kỳ dòng nào khác trong
  diff thuộc về người khác đều từ chối TOÀN BỘ yêu cầu** (`403`, chốt 19/09 lần 17 — Leader xác nhận trực
  tiếp: không âm thầm lọc bớt rồi lưu phần hợp lệ) — Leader thì không cần diff-check, mọi thay đổi đều hợp
  lệ.

  **Chống 2 người cùng sửa danh sách gần như cùng lúc (chốt 19/09 lần 18 — Leader chọn "Cách A", tái dùng
  cơ chế đã có, không thiết kế route mới):** vì route vẫn gửi/thay **cả danh sách người phụ trách trong 1
  lần**, 2 người mở popup gần nhau rồi lưu nối tiếp có thể vô tình xoá mất thay đổi của nhau (kiểu lỗi
  giống 2 người cùng sửa 1 file Excel chia sẻ). Khoá bằng đúng cơ chế FR-18/FR-46 đã dùng ở mọi nơi khác:
  client phải gửi kèm `row_version` của `project_tasks` đọc lúc mở popup; server so với `row_version` hiện
  tại **trước khi** áp diff ở trên — lệch thì trả `409` ("có người vừa thay đổi, tải lại rồi sửa tiếp"),
  không âm thầm ghi đè. Mọi lần `saveTaskAssignments()` ghi thành công phải **tăng `project_tasks.row_version`
  của đúng task đó** (dù bảng `project_task_assignments` có `row_version` riêng theo dòng) — vì khoá theo
  toàn bộ danh sách của 1 task, không phải theo từng dòng phân công riêng lẻ.
- **FR-17:** Trên Gantt, task nhiều người hiển thị **mỗi người một thanh riêng**, xếp dưới tên task, theo
  màu của người đó, **kèm tên người ngay trên/cạnh thanh** (không cần bảng chú thích riêng). **Màu chọn
  từ một bảng màu cố định 15 màu** (không phải color picker tự do; team thực tế không vượt 15 người, nên
  không cần cơ chế dự phòng khi hết màu) — Leader chọn cho cả team; mặc định bật cho mọi team có chức
  năng Project. **Di trú màu PIC cũ (chốt 13/09):** bảng `pics` hiện có (tên + màu) được **giữ nguyên
  cặp tên-màu** làm dữ liệu tham khảo (không map tự động sang User nào — khớp FR-15). Màn "chọn màu Gantt
  cho từng người" hiển thị kèm danh sách (tên PIC cũ, màu cũ) này để Leader **tự đối chiếu bằng mắt và
  chọn đúng màu cũ cho đúng User** khi gán màu lần đầu sau di trú — không có logic so khớp tên tự động.
  Sau khi Leader chọn xong, `pics` không còn được đọc để hiển thị màu nữa.
- **FR-17a — Lọc "chỉ task của tôi" (mới, vì Project giờ là bảng chung cả team):** thêm nút lọc nhanh ở
  đầu bảng task/Gantt, thu hẹp về đúng task người đang xem được gán phụ trách — **kể cả khi chỉ là một
  trong nhiều người phụ trách** (task nhiều người theo FR-16), không chỉ khi là người phụ trách duy nhất.
  Đây là tuỳ chọn hiển thị, không đổi dữ liệu hay quyền — Member vẫn thấy được toàn bộ task khi tắt lọc.
- **FR-18:** **Chống sửa trùng lúc**: khi hai người cùng sửa một bản ghi, người lưu sau nhận lỗi rõ ràng
  *"có người vừa thay đổi, tải lại rồi sửa tiếp"*. **Không ghi đè im lặng**, không khoá bản ghi.
- **FR-19:** **Nhật ký thao tác quan trọng**: ghi lại ai làm gì, lúc nào, cho nhóm thao tác không hoàn
  tác được hoặc ảnh hưởng nhiều người — tối thiểu: xoá project, xoá task project, chốt tuần, xoá toàn bộ
  mục tiêu tuần, khoá/mở khoá lịch release, huỷ đợt release, thêm/bớt thành viên team, đổi cấu hình tầng
  2 và tầng 4. **Không ghi mọi thay đổi.**
- **FR-20:** **Di trú dữ liệu hiện có** của Dev13 lên server nguyên vẹn, và **tách Luyện đề ở lại bản
  desktop**. Sau khi cắt chuyển, server là nơi duy nhất được sửa dữ liệu (**cắt hẳn**, không chạy song song).

### Nhóm D — Điều chỉnh theo từng chức năng

- **FR-21 (SỬA 13/09, sau khi Leader đính chính thực tế đang chạy):** **Giữ nguyên cơ chế hiện tại — không
  có luồng "Member tự đặt mục tiêu tuần".** Mục tiêu tuần **tự sinh từ toàn bộ task đã phân công trong
  tuần** (không phải Member gõ tay); chỉ **Leader** điền % từ-tới và chạy wizard 4 bước ("Xác nhận & lưu")
  để chốt tuần. Xoá toàn bộ mục tiêu tuần cũng thuộc Leader. Member **chỉ xem**, không có form riêng nào.
  *(Điều này thay thế phát biểu trước đó trong CR — bản trước giả định sai rằng Member tự đặt mục tiêu;
  Leader đã đính chính ngày 13/09.)*
- **FR-21a — Thiết kế lại màn mục tiêu tuần vì giờ cả team xem được (không chỉ Leader):** hiện màn này
  chủ yếu sinh ra **một khối chữ để Leader copy đi nơi khác** — cách trình bày đó không có nghĩa với
  Member. **Nội dung chính của màn phải đổi thành danh sách task** thuộc mục tiêu tuần, mỗi dòng hiện:
  tên task, người phụ trách, % hoàn thành, và **project chứa task đó**. Khối chữ tổng hợp kiểu cũ vẫn
  giữ lại **bên dưới** để Leader còn copy được như trước, nhưng không còn là trọng tâm của màn hình.
  **Mặc định nhóm theo project**; mỗi người tự đổi sang nhóm theo **người phụ trách** nếu muốn — đây là
  **tuỳ chọn cá nhân, không ảnh hưởng tới người khác đang xem cùng màn** (lưu phía client, không phải cấu
  hình dùng chung). **Phần "Risk & biện pháp xử lý" (bước trong wizard của Leader) cũng hiện cho cả team
  xem** — minh bạch những vướng mắc chung, không giữ riêng cho Leader nữa.
  **Task nhiều người phụ trách (FR-16) khi nhóm theo người (chốt 13/09):** task đó **hiện lặp lại dưới
  mỗi người phụ trách** (cả 3 người ngang hàng, không có khái niệm "người phụ trách chính"). **Lưu ý bắt
  buộc lúc implement:** mọi số liệu tổng hợp của màn (số task, % hoàn thành trung bình...) phải tính từ
  **danh sách task đã khử trùng lặp** (theo `task.id`), không tính trên danh sách đã "trải phẳng" theo
  người — nếu không, task 3 người phụ trách sẽ bị đếm 3 lần và làm sai số liệu tổng của cả mục tiêu tuần.
- **FR-22:** **Danh sách loại báo cáo tuần chuyển thành cấu hình theo từng team** (Leader quản), thay cho
  hai giá trị ghi cứng `internal` = "Nội bộ Dev13" và `vn_management` = "Báo cáo DM".
- **FR-23 (SỬA 19/09 lần 2 — viết lại theo mô tả trực tiếp của Leader, thay bản "2 phần" ban đầu vì hiểu
  sai vai trò team điều phối, xem [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** **Release có 3
  việc tách bạch, không phải 2:**
  - **(a) Đăng ký/sửa lịch release khẩn cấp của team mình** — Leader của **mọi team** (kể cả Leader team
    điều phối, cho chính team mình) tự làm cho team mình, không đụng được lịch team khác. **Các trường của
    1 lượt đăng ký (chốt 19/09 lần 3, mô tả trực tiếp của Leader):**
    - *Bắt buộc:* ngày giờ deploy staging mong muốn; ngày giờ release mong muốn; **deploy demo tự động =
      16:00 cùng ngày release** (không cho nhập tay, chỉ hiển thị để Leader xem lại); hệ thống bị ảnh
      hưởng (checkbox Dr.JOY/Pr.JOY, allowlist đã có sẵn trong code — không đổi); nền tảng bị ảnh hưởng
      (checkbox Web/Mobile — **cột mới**, cùng kiểu allowlist với hệ thống); mã ticket (**cho nhập nhiều
      số**, kèm cảnh báo rõ trong giao diện "điền sai mã có thể làm bài thông báo sai" — thiết kế ô nhập
      dạng tag: gõ số + Enter/dấu phẩy để tách thành từng thẻ, chặn ký tự không phải số, không giới hạn số
      lượng); link trao đổi với bên Nhật (bắt buộc **hoặc** phải điền lý do nếu chọn "Không có" — đúng một
      trong hai, không được để trống cả hai).
    - *Không bắt buộc:* ghi chú dạng văn bản dài — ô textarea thường, hỗ trợ phím tắt (Tab thụt lề, Enter
      tự tăng số thứ tự kiểu `1.` → thụt lề `1.1.`) xử lý bằng JS phía client, **không dùng thư viện
      rich-text** (Leader xác nhận textarea + phím tắt là đủ); lưu dữ liệu dạng text thuần có sẵn tiền tố
      số/thụt lề, không phải HTML.
    **Admin tắt Release cho 1 team đang có đăng ký khẩn cấp còn hiệu lực (chốt 19/09 lần 10, Leader xác
    nhận trực tiếp):** giữ nguyên toàn bộ đăng ký hiện có (vẫn hiện trên Lịch chung, vẫn khoá/mở khoá được
    bình thường tới hết đợt) — Tắt Release **chỉ chặn tạo đăng ký MỚI** cho team đó từ sau, không tự huỷ gì
    cả (đúng nguyên tắc cascade "tắt không phá dữ liệu cũ" đã dùng nhất quán cho FR-7a).
  - **(b) Ấn định 1 ngày chính cho release định kỳ** — **chỉ Leader team điều phối**, và đây là **một lịch
    định kỳ duy nhất dùng chung cho toàn hệ thống** (không phải mỗi team tự có lịch định kỳ riêng); mọi
    mốc jack/develop/staging/demo tự tính từ đúng ngày này, giữ nguyên cơ chế `tinhNgayRelease()` đã có.
    Leader các team thường không tạo/sửa được gì cho định kỳ, chỉ xem (FR-24).
  - **(c) Quản lý template + định nghĩa task cá nhân** (định kỳ và khẩn cấp) để tự sinh task cho bản thân
    — **của từng người** (bất kỳ Member hay Leader nào, kể cả Leader team điều phối dùng cho chính họ),
    **không phải đặc quyền của team điều phối** như bản 13/09 mô tả nhầm; chỉ hiện khi Admin đã bật FR-28a
    cho đúng team đó (xem FR-28a).
- **FR-24 (SỬA 19/09 — mở rộng người xem từ chỉ-Leader sang cả Member):** **Màn danh sách lịch release
  chung**: **Member và Leader** của bất kỳ team nào đang Bật Release đều thấy được ngày giờ các team
  khác đã đăng ký, để tự tránh trùng trước khi nộp (chỉ Leader mới đăng ký/sửa được, Member chỉ xem —
  đúng FR-8). **Ai cũng thấy thêm hệ thống bị ảnh hưởng và phạm vi ảnh hưởng của từng đợt** (Q6, gồm cả
  **nền tảng Web/Mobile** — cột mới chốt 19/09, cùng nhóm "phạm vi ảnh hưởng" với hệ thống) — nhưng
  **không** thấy **mã ticket, link trao đổi với Nhật, ghi chú nội bộ** (chốt 19/09: đây chính là 3 trường
  Q6 đã cảnh báo trước phải giấu, giờ có tên cột cụ thể) hay cấu hình release **của team khác**; ranh giới
  lọc field là theo **team sở hữu đăng ký, không theo Member/Leader** (chốt 19/09 lần 4) — **Member của
  chính team đăng ký đó xem được đầy đủ**, kể cả ticket/ghi chú/link Nhật, y hệt Leader team mình; chỉ
  người ở team khác mới bị lọc bớt các trường này. API lịch chung phải lọc đúng tập trường được phép ở
  tầng backend theo đúng ranh giới team-sở-hữu-vs-team-khác này,
  không lọc bằng ẩn cột ở giao diện. **"Hệ thống bị ảnh hưởng" đã là danh sách đóng, xác nhận bằng code
  thật (13/09):** `server/routes/schedules.ts:394` đã có `VALID_EMERGENCY_SYSTEMS = new Set(['Dr.JOY',
  'Pr.JOY'])` — backend từ chối mọi giá trị ngoài 2 cái này. Yêu cầu "không cho gõ tự do, tránh lệch chính
  tả giữa team" **đã được thi hành từ trước**, không cần đổi gì thêm khi mở rộng lên nhiều team; giữ
  nguyên biểu diễn mảng chuỗi có allowlist, không cần tách thành 2 cột boolean riêng (tương đương về chức
  năng, đổi sẽ chỉ là churn không cần thiết).
- **FR-25 (chốt phạm vi + quy tắc cụ thể 19/09, mô tả trực tiếp của Leader, xem
  [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** **Phát hiện và xử lý xung đột lịch chỉ áp dụng
  cho release khẩn cấp**, không áp dụng release định kỳ (định kỳ chỉ có 1 lịch chung, không có 2 team để
  so). **"Chung 1 đợt" là tự động, không cần ai tạo trước** — chỉ cần **trùng đúng ngày release** (không
  phân biệt giờ) là hệ thống tự coi các team đó thuộc cùng 1 đợt (kỹ thuật: `release_cycles` cho khẩn cấp
  được **tự tìm-hoặc-tạo theo đúng ngày release**, không phải Leader điều phối mở đợt trước — nhờ vậy 1
  tháng có thể có nhiều đợt khác nhau, mỗi ngày release riêng là 1 đợt riêng). **Trong 1 đợt, xung đột được
  tính khi VÀ CHỈ KHI** ít nhất một trong ba: giờ release khác nhau, ngày deploy staging khác nhau, hoặc
  giờ deploy staging khác nhau — **các trường khác (hệ thống, nền tảng, ticket, ghi chú, link Nhật) không
  tính vào việc phát hiện xung đột**, kể cả khi 2 team hoàn toàn không liên quan tới nhau, chỉ tình cờ
  trùng ngày. Khi có xung đột, hệ thống báo cho **cả Leader team điều phối lẫn Leader các team đang trùng**.
  **Xung đột tự đóng ngay khi hệ thống rà soát lại thấy giờ đã khớp** (bất kỳ lần nào 1 registration được
  lưu đều phải chạy lại rà soát xung đột trong cùng cycle, không chỉ lúc mở khoá) — không cần Leader điều
  phối xác nhận tay (chốt 19/09 lần 8).

  **"Ép giờ chung" — ngoại lệ duy nhất trong toàn bộ Release được phép sửa trực tiếp dữ liệu của team khác
  (chốt 19/09 lần 8, Leader xác nhận trực tiếp):** Leader team điều phối được **ghi đè thẳng**
  `deploy_staging_at`/`release_at` (không đụng ticket/nền tảng/ghi chú/link Nhật — những trường đó vẫn của
  riêng team, ngoài phạm vi "ép giờ") lên đăng ký của **bất kỳ team nào đang xung đột**, không cần đợi team
  đó tự sửa. **Không có mốc "quá hạn" cứng nào** — nút ép giờ luôn sẵn có ngay khi phát hiện xung đột, Leader
  điều phối tự quyết định khi nào dùng đến, hệ thống không tự đếm giờ/nhắc hạn. Vì đây là **ngoại lệ phá
  nguyên tắc chung** "Leader team nào chỉ sửa được lịch team đó" (hợp đồng `authorize()` một-cổng-vào của
  Lát 3), hành động này phải khai riêng trong route inventory (FR-41) là ngoại lệ tường minh — không suy
  ra ngầm từ vai trò điều phối — và bắt buộc ghi `audit_log` đủ actor thật/team bị ép/giá trị cũ-mới.
  **Ép giờ chung tác dụng được ngay cả khi registration đang `locked`** (chốt 19/09 lần 13, Leader xác
  nhận trực tiếp) — không cần Leader điều phối mở khoá trước; xung đột `open` cũng **không chặn** Leader
  điều phối bấm "Khoá lịch" cấp đợt (FR-26) — khoá tuỳ ý bất kể còn xung đột treo, xử lý xung đột sau qua
  đúng ép giờ chung này (registration đã khoá vẫn ép được).
- **FR-26 (làm rõ phạm vi + luồng khoá/mở đầy đủ 19/09 lần 3, tinh chỉnh phạm vi khoá/mở lần 6, mô tả trực
  tiếp của Leader — xem [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** **Khoá lịch chỉ áp dụng
  cho release khẩn cấp** (định kỳ chỉ có 1 người viết — Leader điều phối tự sửa trực tiếp, không có khái
  niệm khoá/mở). **Khoá là hành động cấp cả đợt (1 nút duy nhất)** — Leader team điều phối bấm 1 lần là
  **toàn bộ lượt đăng ký của mọi team trong đợt đó** cùng chuyển sang khoá, không phải khoá riêng từng
  team. Khi đã khoá, **mọi trường** (hệ thống, nền tảng, ticket, link Nhật, ghi chú, không chỉ ngày giờ)
  đều không ai sửa được nữa, kể cả chính team sở hữu. Luồng mở khoá:
  1. Bất kỳ team nào muốn sửa gửi **yêu cầu mở khoá** (lý do tự do).
  2. Leader team điều phối **duyệt** → **mở lại toàn bộ các lượt đăng ký của MỌI team trong đợt** (không
     chỉ riêng team vừa gửi yêu cầu) — chốt 19/09 lần 6.
  3. Team nào sửa xong, khi bấm **Lưu**, giao diện phải hiện **cảnh báo xác nhận trước khi lưu**: "Lưu
     xong sẽ khoá lại thông tin này, bạn chắc chưa?".
  4. Xác nhận lưu → **chỉ riêng lượt đăng ký của đúng team đó tự động khoá lại ngay** (các team khác vẫn
     đang mở cho tới khi họ cũng tự lưu), đồng thời **gửi thông báo** (FR-34) tới Leader team điều phối
     rằng team đó vừa sửa xong. Leader team điều phối vẫn giữ nút "Khoá lịch" cấp đợt để **khoá cưỡng bức**
     nốt những team còn treo mở nếu cần, không bắt buộc phải chờ mọi team tự lưu.
  5. **Khi 1 registration đổi giờ (bước 4), mọi task cá nhân đã sinh từ FR-28a cho đúng team+đợt đó phải
     tự cập nhật lại theo giờ mới** (chốt 19/09 lần 7, Leader xác nhận trực tiếp: "Tự động cập nhật lại
     giờ task đã sinh"). **SỬA KỸ THUẬT 19/09 lần 12 (Council thật `95a26ee6`, vòng 1, phát hiện độc lập
     bởi Claude — xem [exchange 2026-09-19](../../exchanges/2026-09-19.md)):** bản trước ghi nhầm là "tái
     dùng cơ chế đồng bộ `planReleaseWrite()` đã có sẵn" — **sai với code thật**. Đọc trực tiếp
     `server/routes/schedules.ts` xác nhận `planReleaseWrite()`/`GET /schedules/release/drift` **chỉ hoạt
     động cho nhánh ĐỊNH KỲ** (bảng `release_task_definitions`, dùng `date_token`). Nhánh **KHẨN CẤP**
     (`POST /schedules/emergency-release/tasks`, bảng `emergency_release_task_definitions`) **không có bất
     kỳ hàm sync/drift nào ở backend** — client (`release.tsx`) tự tính giờ và gửi nguyên giá trị đã render,
     backend chỉ so hash của definition để chặn TOCTOU **lúc tạo mới**, không re-render lại sau khi task đã
     tồn tại. Kết luận: cơ chế "tự động cập nhật giờ task khẩn cấp" **phải thiết kế route + hàm render mới
     hoàn toàn** (nhận `team_id`+`cycle_id`, đọc đúng 3 mốc mới nhất từ `team_release_registrations`, tìm
     task cũ qua `origin_ref` rồi ghi đè giờ) — không phải "kích hoạt lại luồng có sẵn" như văn bản cũ mô
     tả sai. **Người dùng có thể thuộc nhiều team cùng lúc** (schema `team_members` không cấm) — route mới
     này phải khoá đúng theo `(user_id, team_id, cycle_id, definition_id)`, không chỉ `(release_key,
     origin_ref)` như code định kỳ cũ, để không lẫn task của 2 team khác nhau cùng 1 User trong cùng 1 đợt.
  6. **Khi registration bị huỷ (FR-27) — chốt 19/09 lần 13, Leader xác nhận trực tiếp:** chỉ huỷ **task cá
     nhân chưa hoàn thành và chưa qua ngày** của đúng team+đợt đó (tự cascade `tasks.trang_thai='canceled'`
     hoặc tương đương); **task đã hoàn thành hoặc đã qua ngày giữ nguyên làm lịch sử**, không viết lại quá
     khứ — nhất quán với các cascade khác trong CR.
  7. **Đổi ngày release (`release_at` sang ngày khác, sau khi mở khoá) — chốt 19/09 lần 13, Leader xác
     nhận trực tiếp:** registration **tự chuyển sang `cycle_id` của ngày mới** (tìm-hoặc-tạo theo đúng
     `release_key` mới, y hệt lúc đăng ký lần đầu ở FR-25) — cycle cũ nếu rỗng vẫn giữ làm lịch sử, không
     xoá; ghi rõ vào `audit_log` việc chuyển cycle kèm lý do. Xung đột/task cá nhân tính lại theo đúng
     cycle mới sau khi chuyển.
  8. **Team chưa từng có mặt trong đợt không được tự tạo đăng ký mới nếu đợt đó đang khoá** (chốt 19/09
     lần 9, Leader xác nhận trực tiếp) — kiểm tra `release_cycles.locked_at` (đặt khi bước 1 chạy, gỡ khi
     bước 2 duyệt) trước khi cho `POST` tạo `team_release_registrations` mới; muốn tham gia thì đi đúng
     luồng yêu cầu mở khoá như các team đã có mặt, không có đường tắt tạo mới.
  Mọi lần khoá/gửi yêu cầu/duyệt/lưu-rồi-tự khoá lại/chuyển cycle đều vào nhật ký FR-19.
- **FR-27 (làm rõ 19/09 lần 3 — thống nhất với luồng khoá đầy đủ của FR-26):** **Huỷ đợt release**: Leader
  của team nào **tự huỷ được đợt của chính team đó — CHỈ khi lịch CHƯA khoá** (Q8, huỷ trực tiếp qua
  `status='cancelled'`). **Sau khi đã khoá (FR-26), huỷ đợt gửi yêu cầu riêng `kind='cancel'`** (khác
  `kind='edit'` của yêu cầu sửa thông tin) — Leader điều phối duyệt là chuyển thẳng `status='cancelled'`,
  **không** đi qua bước "mở khoá cho sửa rồi tự khoá lại" như luồng sửa thông tin (không có ý nghĩa gì để
  mở khoá một đợt sắp huỷ) — không có đường huỷ tắt riêng nào khác sau khi đã khoá.
- **FR-28 (SỬA 19/09 lần 2 — gộp hoàn toàn vào FR-28a, xem [exchange 2026-09-19](../../exchanges/2026-09-19.md)):**
  Bản 13/09 mô tả "checklist của đợt thuộc về team điều phối, chỉ Leader team đó thấy và thực hiện", ngầm
  định một cơ chế riêng tách khỏi cá nhân — Leader xác nhận trực tiếp **không có cơ chế "vận hành" nào
  tách riêng**: Leader team điều phối muốn sinh task cho chính mình thì dùng **đúng tab cá nhân** (FR-23c)
  như mọi Member khác, cùng cơ chế, cùng bảng, không có bảng/luồng riêng cho vai trò điều phối. Giữ lại mã
  FR-28 chỉ để không xáo trộn thứ tự đánh số — nội dung đã chuyển hết sang FR-28a.
- **FR-28a (SỬA 19/09 lần 2 — dùng đúng 4 bảng thật thay vì bảng riêng, bổ sung ràng buộc khớp lịch chính
  thức cho khẩn cấp) — Tab cá nhân "Quản lý template + Quản lý task" cho release (tuỳ chọn theo từng
  team):** Admin bật/tắt **riêng cho từng team phát triển** một cấu hình (không đổi so với bản trước —
  Leader xác nhận vẫn cần giữ công tắc riêng này, không mặc định mở). Khi Bật, **mỗi Member hoặc Leader
  của team đó** — kể cả Leader team điều phối, dùng đúng cơ chế này cho chính họ, không có đường riêng
  nào khác — có 1 tab cá nhân với 2 tab con:
  - **Định kỳ:** tự quản lý template + định nghĩa task **của riêng mình** (không chia sẻ với người khác),
    dùng đúng cơ chế `date_token` đã có (`release_task_definitions`/`release_templates`, nay thêm
    `owner_user_id`); bấm submit ứng với 1 đợt định kỳ (`release_cycles.kind='regular'`) đang mở, hệ
    thống tự tính ngày cụ thể từ **1 ngày chính do Leader team điều phối đã ấn định** (FR-23b) — người
    dùng không tự nhập ngày.
  - **Khẩn cấp:** tương tự, dùng `emergency_release_task_definitions`/`emergency_release_templates` (nay
    thêm `owner_user_id`); khi submit cho 1 đợt khẩn cấp, hệ thống **bắt buộc lấy đúng 3 mốc giờ (deploy
    staging/release/deploy demo) từ chính lịch khẩn cấp mà team đó đã đăng ký chính thức**
    (`team_release_registrations`, FR-23a) — **không cho người dùng tự gõ tay 3 mốc này** (chốt 19/09,
    Leader xác nhận trực tiếp: "Bắt buộc khớp lịch chính thức của team"), tránh lệch giữa task cá nhân và
    lịch thật của team.

  Đây là hành động tách rời khỏi FR-23(a)/(b) — đăng ký lịch **không** tự động sinh task cho bất kỳ ai, kể
  cả chính Leader — mỗi người phải tự bấm áp dụng phần của mình nếu muốn. **Điều kiện bắt buộc:** setting
  này chỉ có tác dụng khi **Task cá nhân đang
  `Bật` cho đúng team đó** (FR-7) — Admin bật FR-28a mà Task cá nhân đang `Tắt` thì không có gì xảy ra,
  giao diện phải nói rõ điều kiện này khi Admin bật. **Hiển thị (đã kiểm
  chứng bằng code thật, không phải suy đoán):** quy ước màu sắc theo nguồn gốc task **đã có sẵn nhưng chỉ
  ở đúng một chỗ** — hàm `taskSourceClass()` (`src/screens/personal-task.tsx:62-66`) tô màu tím (release
  định kỳ) / đỏ hồng (release khẩn cấp) cho **khối task trên lịch timeline** (`src/styles.css:1998-2004`);
  **dòng task dạng danh sách phẳng** (vd "Task hôm nay") lại **không có** phân biệt màu — cùng một màu nền
  cho cả 2 nguồn gốc (`src/styles.css:1601-1622`). Cơ chế hiện tại nhận diện qua tiền tố chuỗi
  `releaseMonth` (vd `emergency:...`), không phải cột `origin_kind` riêng. **Đã chốt 13/09:** task tự sinh
  từ FR-28a **tái dùng đúng tiền tố `releaseMonth` (`emergency:...`) hiện có** — cố ý hiện **giống hệt màu
  đỏ hồng** của task release khẩn cấp thật, không tách màu riêng (Leader xác nhận: về mặt cảm nhận, đây
  vẫn là việc phát sinh từ cùng một đợt release, không cần phân biệt trực quan với task release khẩn cấp
  gốc). Không cần thêm cột `origin_kind`, không cần đổi schema — chỉ cần đảm bảo `releaseMonth` của task
  tự sinh này dùng đúng tiền tố `emergency:` khi implement lát 6. **Không bổ sung màu cho dòng danh sách
  phẳng** ("Task hôm nay") — giữ nguyên như hiện tại, ngoài phạm vi CR này.
- **FR-29 — ĐÃ BỎ (chốt 19/09 lần 5, Leader xác nhận trực tiếp):** Bản trước mô tả "bài thông báo gộp
  nhiều team" (Leader điều phối sinh 1 bài tổng hợp cho các team trong đợt). Leader xác nhận **không cần
  tính năng này** — mỗi team tự lo việc báo bên Nhật theo cách riêng (qua đúng `japan_coordination_link`
  đã đăng ký ở FR-23a), hệ thống không tự sinh văn bản gộp nào. Giữ lại mã FR-29 để không xáo trộn số thứ
  tự, không còn nội dung.
- **FR-30 (SỬA 19/09 lần 5 — thu hẹp từ "bài thông báo song ngữ" xuống đúng phạm vi còn lại: nội dung
  template cá nhân khẩn cấp):** Nội dung **template cá nhân khẩn cấp** (FR-23c/FR-28a, dùng bảng
  `emergency_release_templates`) khi render token dạng `...At` (vd `staging.deployAt`,
  `release.deployAt`) và nội dung có tiếng Nhật, phải **tự đổi giờ sang JST đúng cách** — không cộng cứng
  phút. Giờ phải được **điền động từ dữ liệu đăng ký thật** (`team_release_registrations`), không còn ghi
  cứng trong mẫu. Ví dụ chuẩn: team đăng ký release `15:00` giờ VN ⇒ nội dung tiếng Nhật hiển thị `17:00`.
  **Bắt buộc dùng helper giờ VN tường minh có sẵn (họ `vn-time.ts`), không tính giờ bằng `Date` theo giờ
  máy chạy tiến trình**, và **chọn định dạng theo locale được truyền tường minh** (`vi`/`ja`), không đoán
  ngôn ngữ đích từ nội dung mẫu. File thật sinh nội dung có ngày giờ **phải nằm trong vùng quyết định của
  cổng máy `check-tz.mjs`**.

  > **Rủi ro cụ thể đã xác nhận bằng code thật (Council `1a86deaf`, vòng 2 — hội tụ):** cơ chế "cộng giờ
  > kiểu Nhật" **đã tồn tại sẵn** ở `src/screens/release.tsx:322` — `addMinutes(date, 120)` — cộng cứng
  > 120 phút vào một `Date` dựng từ `parseDateTimeInput()`, được kích hoạt bằng cách **đoán ngôn ngữ**
  > qua `hasJapaneseText(content)`, và **nằm hoàn toàn ngoài phạm vi quét của `check-tz.mjs`** (file này
  > không thuộc "vùng quyết định" đã khai báo cho cổng). Đây đúng là kiểu lỗi đã thoát cổng **hai lần**
  > trong dự án ([BUG-20260803](../bugs/BUG-20260803-automation-sai-mui-gio.md),
  > [BUG-20260804](../bugs/BUG-20260804-gio-may-lot-3-call-site.md) — cả hai đều là lỗi tính giờ theo giờ
  > MÁY chứ không phải giờ VN tường minh, xem [docs/delivery/README.md §5](../README.md)). Khi chuyển
  > logic sinh nội dung này lên backend (canonical, không phải riêng frontend nữa), **không được chép
  > nguyên cơ chế `addMinutes(date, 120)` này** — phải viết lại theo đúng yêu cầu ở trên và đưa file mới
  > vào vùng quét của cổng `check-tz.mjs`. Test phải phủ ca qua nửa đêm, cuối tháng, cuối năm, và chạy
  > dưới nhiều giá trị `TZ` khác nhau của máy chạy test — không giả định máy dev/CI luôn đặt giờ VN.
- **FR-31 (làm rõ phạm vi 19/09 lần 16, Leader xác nhận trực tiếp, tránh hiểu nhầm khi rà lại):** **Task cá
  nhân riêng tư tuyệt đối, không ngoại lệ** — chỉ đúng chủ sở hữu (`owner_user_id`) xem/sửa/xoá được task
  của mình. Không Leader, không Member khác dù cùng team, **không cả Admin** (kể cả khi hỗ trợ/xử lý sự cố)
  được xem hay sửa task cá nhân của người khác dưới bất kỳ hình thức nào — khớp đúng `policyKind: 'personal_task'`
  với `ownerOnly: true` tuyệt đối trong hợp đồng `authorize()` (§6.2), không có nhánh miễn trừ nào.

  **Cảnh báo kỹ thuật thật, đọc trực tiếp code (`server/routes/tasks.ts`), 19/09 lần 16:** toàn bộ 7 route
  hiện có (`GET /tasks`, `GET /history`, `POST /tasks`, `PATCH /tasks/:id/status`,
  `PATCH /tasks/:id/schedule`, `PATCH /tasks/:id`, `DELETE /tasks/:id`) **không hề lọc theo người dùng**
  — đúng với desktop 1-người-dùng hiện tại, nhưng **bắt buộc thêm `owner_user_id = ?` vào mọi WHERE** khi
  lên multi-user, không riêng gì việc thêm cột. **Rủi ro cụ thể nghiêm trọng nhất:** `PATCH /tasks/:id` khi
  `updateRelated=true` chạy **UPDATE hàng loạt khớp theo tên task + hình dạng lịch lặp
  (`ten_task`/`lap_lai_kieu`/`ngay_trong_thang`/`thu_trong_tuan`/...), hoàn toàn không giới hạn theo `id`**
  (dòng 246-270 `tasks.ts`) — nếu 2 User khác nhau tình cờ đặt tên task định kỳ giống hệt nhau (vd "Họp
  team hàng tuần"), sửa của User A sẽ **ghi đè thẳng task của User B** nếu thiếu `owner_user_id` trong
  WHERE của câu UPDATE hàng loạt này. Đây là lỗ hổng dữ liệu chéo người dùng thật cần chặn ngay từ lúc
  implement Lát 4, không phải rủi ro giả thuyết.
- **FR-32:** **Mind Map**: người tạo chọn **riêng tư** hoặc **chia sẻ cho team** bằng **một công tắc nhỏ
  ngay trong màn soạn thảo sơ đồ, cạnh tên sơ đồ** — không phải màn danh sách sơ đồ. **Xác nhận quan
  trọng (13/09): "chia sẻ" chỉ cấp quyền XEM cho các thành viên còn lại trong team — CHỈ người tạo mới
  được sửa**, dù ở chế độ riêng tư hay chia sẻ. Đây **không phải** dữ liệu nhiều người cùng ghi, nên
  **FR-18 (chống sửa trùng lúc, `409`) không áp dụng cho Mind Map** — không có kịch bản hai người cùng
  sửa một sơ đồ, vì chỉ đúng một người (người tạo) có quyền ghi. Quyền đọc file đính kèm phải được kiểm
  **tại chính đường tải file** (không chỉ ở API danh sách/chi tiết sơ đồ) — hiện
  `GET /api/mindmaps/files/:name` chỉ chặn path traversal, không tra quyền sở hữu/chia sẻ; đổi sơ đồ từ
  `chia sẻ` sang `riêng tư` phải thu hồi quyền tải ngay.
- **FR-32a — Loại file đính kèm (Q10), chốt kỹ thuật 19/09 (Council `74715c65`):** đúng danh sách đóng
  `.png`/`.jpg`/`.jpeg`/`.gif`/`.webp` (ảnh), `.pdf`, `.txt`/`.md`/`.csv`/`.html` (văn bản), `.docx`/
  `.xlsx`/`.pptx` (Office không macro) — **không** nhận `.svg`/`.htm`/`.bmp`/`.tiff`/`.heic`/`.doc`/`.xls`/
  `.ppt`/`.rtf`/`.zip`/`.docm`/`.xlsm`/`.pptm`. Ba lớp phải khớp nhau: đuôi tên + MIME khai báo + loại
  phát hiện thật. **Ảnh/PDF** kiểm signature (magic bytes) thật. **`.txt`/`.md`/`.csv`/`.html` không có
  magic bytes chuẩn** — kiểm bằng UTF-8 hợp lệ + không chứa control byte bất thường + khớp bộ phân loại
  nội dung tương ứng (gọi đúng tên bước kiểm này, không gọi nhầm là "magic bytes"). **`.docx`/`.xlsx`/
  `.pptx`** phải là ZIP hợp lệ (không ZIP64, không mã hoá, giới hạn số entry/dung lượng giải nén/tỉ lệ
  nén/độ sâu), có `[Content_Types].xml` + entry đặc trưng đúng loại, **từ chối nếu có `vbaProject.bin`**/
  content type macro/entry path traversal/symlink. `.html` được phép nhưng **luôn tải xuống
  (`Content-Disposition: attachment`), không bao giờ render inline cùng origin** — an toàn XSS chỉ khi
  storage nằm ngoài static root Express. **Từ chối phải nói rõ danh sách định dạng được phép**, không
  phải thông báo chung chung "File không hợp lệ". Upload qua `multipart/form-data`, stream vào file tạm
  vừa ghi vừa tính SHA-256 (không dùng base64/`express.json`), chuyển `pending`→`ready` bằng rename
  nguyên tử, GC quét theo cột `status` (không dò URL trong JSON như GC hiện tại) cộng dọn định kỳ file
  `pending` quá hạn (24h).
- **FR-33:** **Redmine (Q11): công ty chỉ có một Redmine — URL cấu hình ở cấp hệ thống, chỉ Admin sửa
  được.** Mỗi người **tự nhập API key riêng của mình** (tuỳ chọn — người chưa cần dùng Redmine không phải
  nhập). Không còn khoá dùng chung để gọi Redmine thay cho người khác. Trong màn Cài đặt, **Member chỉ
  thấy thứ của riêng mình** (khoá Redmine của mình + phím tắt); sửa URL hệ thống là việc của Admin, tách
  hẳn khỏi màn Cài đặt của Member.
- **FR-34:** **Thông báo trong app** có **danh sách xem lại được và đánh dấu đã đọc**, không chỉ là chấm
  đỏ mất khi bấm. Đây là kênh thông báo duy nhất — **không email, không Telegram**.

### Nhóm E — Đóng gói và vận hành

- **FR-35:** Đóng gói **container chuẩn**, toàn bộ cấu hình qua **biến môi trường**, để đội hạ tầng chạy
  CI/CD tự động. **Chạy đúng một bản, không nhân bản.**
- **FR-36:** Dữ liệu (file SQLite + thư mục file đính kèm) nằm trên **ổ lưu trữ bền gắn ngoài**, tồn tại
  độc lập với vòng đời container.
- **FR-37:** **Sao lưu tự động hằng ngày, giữ 30 ngày, bao gồm cả thư mục file đính kèm Mind Map**, cất ở
  nơi nằm ngoài máy chủ.
- **FR-38 — Gỡ bỏ MCP server, danh sách chốt bằng grep code thật 19/09 (Council `74715c65`):** đây là
  đường ghi dữ liệu thứ hai không qua xác thực (`server/mcp.ts` gọi thẳng REST API nội bộ bằng HTTP
  thường, không có cookie/session). **Xoá:** `server/mcp.ts`, `server/lib/app-singleton.ts` +
  `server/lib/mcp-auth.ts` (xác nhận bằng grep: hai file này **chỉ** được import bởi `mcp.ts` và test
  riêng của chúng, không dùng cho khoá instance của bản server thật), `test/unit/app-singleton.test.ts`,
  `test/unit/mcp-auth.test.ts`, `scripts/build-mcp.mjs`, script `build:mcp` trong `package.json`,
  dependency `@modelcontextprotocol/sdk` (để package manager tự cập nhật lockfile, không tự tay kéo theo
  `zod` — chỉ bỏ nếu package manager xác nhận không còn nơi nào reachable), thư mục `dist-mcp/` + dòng
  `.gitignore` tương ứng, dòng comment nhắc MCP ở `server/index.ts:76`, và trọn mục "Claude Desktop / MCP
  task-manager" trong `README.md`. Mô tả MCP còn lại trong `AGENTS.md`/`CLAUDE.md`/specs/standards để lại
  cho bước `docs-sync` khi triển khai thật. Kiểm chứng "không còn đường ghi thứ hai": không còn entry
  point server/stdio ngoài `server/index.ts`; không còn script build/dependency MCP; mọi router nghiệp vụ
  nằm trong route inventory Lát 3 và qua session/authz — việc rà toàn bộ 84 route là phạm vi riêng của
  FR-41/AC-29, không lặp lại ở đây.
- **FR-39:** Cung cấp hai địa chỉ kiểm tra sức khoẻ **có nghĩa tách biệt**: `/health/live` (tiến trình và
  event loop còn sống, **không truy vấn DB**) và `/health/ready` (migration đã xong, DB đọc/ghi được, ổ
  lưu trữ còn ghi được, giữ được khoá instance, không đang shutdown; **không phụ thuộc OIDC hay Redmine**
  vì đó là hệ thống ngoài). `/health/ready` false khi thiếu bất kỳ điều kiện nào — đủ để hạ tầng biết khi
  nào an toàn nhận traffic.

### Nhóm F — Bảo mật và giới hạn tài nguyên tầng backend (chốt qua Council `38c458f1` + `4dd7a70c`)

> Đây là các yêu cầu **App tự chịu trách nhiệm**, tách bạch với lớp mạng/WAF/CDN/DDoS mà Leader đã giao
> hẳn cho đội hạ tầng (Council không thiết kế thay, chỉ công bố hợp đồng App cần ở Infra — xem FR-44).
> Toàn bộ áp dụng cho **mọi route**, kể cả pilot chỉ có một mình Leader dùng, vì pilot vẫn chạy trên hạ
> tầng public thật.

- **FR-40 — Uỷ quyền fail-closed tập trung:** một hàm `authorize(actor, activeTeam, resource, action)`
  duy nhất; resolver tải resource và **tự suy ra team/quyền sở hữu từ DB**, không tin `teamId`/`ownerId`
  do client gửi. Route không khai báo được `(resource, action)` bị **chặn ở mức khởi động/CI**, không
  mặc định cho qua. Áp cho mọi route hiện có lẫn route mới, trừ 3 ngoại lệ có policy riêng: Task cá nhân
  (FR-31), lịch Release liên team (FR-24), và audit (FR-11a).
- **FR-41 — Route inventory là cổng DoR/CI, không phải tài liệu tay:** mỗi route phải khai báo đủ **11
  trường** — access class; resource/action; cách suy ra scope; validation schema; resource class; body
  limit; timeout; concurrency; audit; idempotency; optimistic concurrency (bảng chi tiết ở §6.2). Inventory
  **sinh/kiểm trực tiếp từ router đã đăng ký trong Express lúc chạy** (ví dụ duyệt `app._router`), không
  phải bảng viết tay — bảng tay dễ lệch khỏi route thật, đúng loại lỗi `L-010` đã ghi nhận. CI phải
  **fail** khi route mới thiếu bất kỳ trường nào; giá trị `n/a` chấp nhận được nhưng phải tường minh và có
  lý do. Phạm vi thật: **84 route hiện hữu giữ lại** (106 route hiện có trừ 22 route Luyện đề sẽ gỡ) cộng
  toàn bộ route mới của FR-1 → FR-39 (auth/onboarding/admin/health/attachment) — 84 không phải tổng cố
  định, tăng theo route mới.
- **FR-42 — Giới hạn tài nguyên theo lớp route:** body mặc định nhỏ (route không cần nhận file), chỉ nới
  cho route upload; giới hạn số header, timeout request/keep-alive, thời gian shutdown; danh sách phải
  phân trang bằng cursor ổn định, không trả nguyên bảng. Rate limit theo nhiều khoá: IP tin cậy cho route
  chưa đăng nhập (đặc biệt OIDC callback); `user_id`/`session_id` cho route đã đăng nhập, IP chỉ làm khoá
  phụ (để không chặn nhầm nhiều nhân viên chung IP công ty). Quota/semaphore riêng cho upload, export/báo
  cáo, và gọi Redmine — hàng đợi có trần, quá tải trả `429`/`503` kèm `Retry-After`, không giữ request vô
  hạn.
- **FR-43 — Upload/attachment an toàn:** multipart streaming vào file tạm (không decode base64 nguyên
  khối vào RAM như hiện tại); kiểm đuôi + MIME khai báo + magic bytes; định dạng nén (Office/ZIP) giới
  hạn số entry, tổng kích thước giải nén, tỉ lệ nén, độ sâu, không giải nén ra thư mục phục vụ. Attachment
  có bản ghi riêng (id ngẫu nhiên, sơ đồ/owner/team, kích thước, hash, trạng thái); publish chỉ sau khi
  transaction tạo bản ghi thành công; download luôn `Content-Disposition: attachment` + `nosniff`.
- **FR-44 — Redmine chống SSRF (kể cả khi URL do Admin cấu hình), 11 quy tắc chốt kỹ thuật 19/09 (Council
  `74715c65`):** (1) chỉ `https:`; (2) cấm username/password/fragment trong URL, chuẩn hoá hostname IDNA;
  (3) **allowlist cổng là hằng số trong code, khởi điểm đúng `{443}`** — Admin không tự mở cổng khác qua
  UI, cổng bổ sung là thay đổi hằng số do dev triển khai + review bảo mật riêng; (4) resolve cả A/AAAA,
  chặn nếu bất kỳ đáp án nào là loopback/private/link-local/unspecified/multicast/reserved; (5) nếu
  Redmine thật nằm trong mạng nội bộ, ngoại lệ phải là allowlist hạ tầng cố định theo hostname/dải IP,
  không phải quyền Admin tự tạo; (6) **kết nối tới đúng IP đã kiểm** qua DNS lookup/dispatcher riêng,
  giữ hostname gốc cho TLS SNI/kiểm chứng thư — một lần `dns.lookup()` rồi để `fetch()` tự resolve lại là
  **không đủ**, mở đường DNS rebinding; (7) cấm mọi redirect (`3xx` là lỗi); (8) chỉ ghép path Redmine cố
  định bằng `new URL()`, không proxy path/URL tuỳ ý từ client; (9) timeout riêng cho connect/headers/body/
  tổng request, đọc body streaming có trần byte trước khi parse JSON; (10) semaphore theo user và toàn
  app, quá tải trả `429`/`503` kèm `Retry-After`; (11) log chỉ gồm request ID/actor/hostname đã chuẩn
  hoá/thao tác/trạng thái/thời gian — không log header API key hay body Redmine. Quyền Admin cấu hình
  được URL **không đồng nghĩa** được phép biến backend thành cầu nối vào mạng nội bộ tuỳ ý.
- **FR-45 — SQLite dưới tải nhiều người:** giữ `DatabaseSync`/WAL ở baseline; thêm `busy_timeout` hữu
  hạn; mọi ghi qua **hàng đợi FIFO có trần** dùng `BEGIN IMMEDIATE`; transaction **không được chứa** lời
  gọi mạng/file I/O. Tách riêng đo **thời gian SQL thực thi** và **thời gian chờ trong hàng đợi** — nếu
  chỉ đo latency đầu-cuối sẽ không biết cần tối ưu query, hàng đợi hay mạng.
- **FR-46 — Optimistic concurrency mở rộng từ FR-18 (SỬA 19/09 — thống nhất tên cột theo §6.3):** cột
  **`row_version`** (không dùng `version` — tên cột thống nhất chốt ở Lát 4, §6.3) cho các bảng có nhiều
  người thật sự cùng sửa (project, project_task, project_task_assignments, weekly_goals/report, release
  cycle/registration, cấu hình tầng 2/4) — **không** áp cho dữ liệu chỉ một người ghi được (Mind Map ở
  **mọi trạng thái riêng tư/chia sẻ** — vì chỉ người tạo mới sửa, xem FR-32; khoá Redmine cá nhân). Update
  dùng `WHERE id=? AND row_version=?`; lệch trả `409`.
- **FR-47 — Crash và restart có kiểm soát:** `uncaughtException`/`unhandledRejection` phải chuyển
  `/health/ready` sang false, ngừng nhận request mới, cố hoàn tất thao tác đang chạy trong thời hạn hữu
  hạn rồi **thoát tiến trình** để supervisor khởi động lại — không log rồi sống tiếp như hành vi hiện tại
  của bản desktop (`server/index.ts`), vì một tiến trình dùng chung cho nhiều người mà tiếp tục chạy sau
  lỗi không lường trước là trạng thái không đáng tin.
- **FR-48 — Audit và log không rò secret:** log có `request_id`, `actor_id`, hành động, trạng thái, độ
  trễ; **redact theo allowlist trường được phép**, không log nguyên `body`/`header` nhạy cảm. Không bao
  giờ xuất hiện trong log/error/audit: cookie phiên, giá trị CSRF token, mã/token OIDC, khoá Redmine,
  nội dung riêng tư của người dùng.
- **FR-49 — Dependency và build tái lập:** khoá phiên bản qua lockfile; quét dependency trong CI; tiến
  trình chạy non-root; filesystem container chỉ đọc, trừ đúng thư mục volume cần ghi.

## 5. Yêu cầu phi chức năng

- **Bảo mật — thay đổi giả định nền:** ứng dụng **mở ra Internet công khai, không qua VPN**. Điều này
  **phá trực tiếp** luật *"không nới bề mặt mạng, vẫn bind `127.0.0.1`"* trong
  [security-standard](../../standards/security-standard.md) và skill `security-gate`. Hai tài liệu đó
  **phải được cập nhật trong cùng lần giao này** (§11), không để lệch âm thầm.
- **Lớp bảo vệ tự làm, không phụ thuộc hệ xác thực ngoài:** cứng hoá phiên (FR-4) — hạn tuyệt đối, xoay
  vòng, thu hồi được toàn bộ phiên một user. **Đã bỏ (13/09):** cảnh báo đăng nhập lạ (FR-5 cũ) — Leader
  xác nhận chấp nhận tin hoàn toàn vào OIDC công ty cho việc phát hiện truy cập bất thường, không cần lớp
  tự làm thứ hai. **Hoãn:** giới hạn theo IP và 2FA riêng của app — chỉ làm nếu có sự cố lộ tài khoản thật
  hoặc quy mô tăng mạnh.
- **Phân quyền thi hành ở backend.** Ẩn nút ở giao diện không tính là phân quyền; mọi endpoint phải tự
  kiểm tra quyền theo team đang thao tác.
- **Hiệu năng và quy mô:** dưới 30 người dùng, không cần thời gian thực. Giữ **SQLite** — không đổi sang
  DB server. Ràng buộc kèm theo: một bản chạy duy nhất (FR-35).
- **Ranh giới trách nhiệm mạng, chốt sau khi Codex nêu phản đối:** Leader giao **toàn bộ lớp mạng** (WAF/
  CDN/chống DDoS, firewall, che IP origin, TLS termination) cho đội hạ tầng tự thực hiện — Council/CR
  **không chọn sản phẩm thay Infra** và **không được tuyên bố backend tự chống được DDoS làm đầy đường
  truyền**, việc đó nằm ngoài khả năng của một app đơn lẻ. Ngược lại, App **phải công bố một hợp đồng tối
  thiểu** cho Infra: số hop proxy tin cậy để khai `trust proxy` đúng, cách nhận IP client đáng tin
  (`X-Forwarded-For`/header riêng), nơi TLS kết thúc (để biết `X-Forwarded-Proto` có đáng tin cho cờ
  `Secure`), và timeout tầng proxy hiện có (để App không đặt timeout xung đột).

### Bộ yêu cầu bảo mật + hiệu năng tầng App (`SEC-PERF-001..016`)

Mỗi mã trong bảng dưới đi kèm **chi phí hiệu năng nó tạo ra** và **fast path để không tự biến bảo mật
thành DoS** — đây là điểm Codex nhấn mạnh nhất: "an toàn nhưng không biết tốn bao nhiêu" không được coi
là xong. Không mã nào được nới lỏng chỉ để đạt số benchmark đẹp.

| Mã | Yêu cầu | Chi phí / nguy cơ tự-DoS | Fast path / giới hạn |
|---|---|---|---|
| `SEC-PERF-001` | Schema nghiêm cho params/query/body/header; từ chối field thừa | Validation sâu + JSON lớn tốn CPU/RAM trước khi route chạy | Chặn byte ở parser trước; schema biên dịch sẵn, tái dùng; giới hạn độ sâu/mảng/chuỗi |
| `SEC-PERF-002` | Prepared statement; identifier/sort/fragment chỉ từ allowlist trong code | Không đáng kể; truy vấn thiếu index mới là rủi ro thật | Cache statement; index theo scope + cursor |
| `SEC-PERF-003` | React text mặc định; kiểm kê mọi HTML sink; CSP nghiêm; URL scheme allowlist | Sanitize lúc đọc lặp CPU mỗi lần hiển thị | Sanitize một lần lúc ghi nếu có HTML hợp lệ, không sanitize lại mỗi lần đọc |
| `SEC-PERF-004` | Cookie phiên ngẫu nhiên, chỉ lưu hash trong DB; token OIDC không rời backend | Tra session + membership mỗi request tăng DB read; cập nhật `last_seen` mỗi request gây write amplification | Index session hash/user/membership; gộp cập nhật `last_seen`, không ghi mỗi request |
| `SEC-PERF-005` | Origin allowlist + CSRF token gắn phiên cho mọi request ghi | Không đáng kể | So sánh hằng thời gian; không gọi DB riêng chỉ để kiểm CSRF |
| `SEC-PERF-006` | IDOR/BOLA: scope lấy từ resource trong DB; mass assignment chặn bằng DTO allowlist | Thêm join/lookup có thể tăng latency | Một query có index lấy cả resource lẫn scope; projection tối thiểu |
| `SEC-PERF-007` | Redmine: chống SSRF/redirect/rebinding; timeout + response cap + concurrency cap | DNS pinning tăng latency; request treo cạn socket | Không theo redirect; timeout từng pha; semaphore theo user và toàn app |
| `SEC-PERF-008` | Upload streaming; tên lưu do server sinh; attachment có bản ghi + quyền; kiểm OOXML/ZIP có giới hạn | Quét archive tốn CPU/IO, chạy song song nhiều có thể tự gây DoS | Byte cap trước khi ghi; số entry/nesting/tỉ lệ nén có trần; semaphore nhỏ |
| `SEC-PERF-009` | Redaction secret trong log/error; mã lỗi ổn định | Redaction đệ quy trên payload lớn tốn CPU | Log theo allowlist field, không log nguyên body/header nhạy cảm |
| `SEC-PERF-010` | Request budget theo resource class; pagination/timeout/rate/quota/backpressure | Limiter/queue không giới hạn tự thành điểm nghẽn RAM | Bucket có TTL + số key hữu hạn; queue hữu hạn, từ chối sớm bằng `429/503` |
| `SEC-PERF-011` | Dependency lock + scan CI + artefact tái lập | Không ảnh hưởng request path | Cache scan theo lockfile nhưng không bỏ khi lockfile đổi |
| `SEC-PERF-012` | Audit cùng transaction với thao tác quan trọng | Mỗi write quan trọng thêm 1 DB write, tăng lock time | Payload audit nhỏ, có index vừa đủ; không audit read thường |
| `SEC-PERF-013` | Crash fail-fast; graceful drain hữu hạn; supervisor restart | Drain quá lâu làm deploy treo | Readiness false ngay; deadline cứng; không nhận việc mới trong lúc drain |
| `SEC-PERF-014` | Live/ready tách nghĩa, có response budget riêng | Readiness kiểm quá thường xuyên tự tạo tải DB/IO | Live không chạm DB; ready dùng query nhẹ, cache ngắn kết quả kiểm volume |
| `SEC-PERF-015` | SQLite write queue + `busy_timeout` + `BEGIN IMMEDIATE` + optimistic concurrency | Queue dài che triệu chứng quá tải, latency tăng vô hạn nếu không có trần | FIFO có trần + deadline; đo riêng SQL execution và queue wait; không retry ghi vô hạn |
| `SEC-PERF-016` | Membership/revoke có hiệu lực ở request kế tiếp | Cache authorization dễ trả quyền cũ (vi phạm FR-4a) | **Baseline: KHÔNG cache** quyền/membership, đọc DB có index mỗi request; chỉ thêm cơ chế phiên bản hoá kiểu security-epoch nếu benchmark chứng minh cần |

**Quyết định trade-off quan trọng nhất (đã hội tụ):** ở baseline, **không cache authorization/membership**
— chấp nhận chi phí một lượt tra DB có index mỗi request để giữ đúng FR-4a (thu hồi quyền có hiệu lực
ngay). Chỉ khi benchmark thật chứng minh chính việc tra quyền làm route vượt ngân sách mới xét thêm
security epoch (version hoá + invalidation trong transaction) — không phát minh cơ chế cache trước khi có
số đo.

### Hợp đồng hiệu năng ban đầu — chỉ là ngưỡng kỹ thuật để phát hiện vấn đề, KHÔNG phải SLA

Đo trên **bản sao dữ liệu Dev13 đã di trú** (giữ nguyên số dòng, kích thước, phân bố thật), qua đúng cấu
hình container + volume dự kiến production. Mỗi lớp ghi p50 (phát hiện thay đổi phân bố), p95 (trải
nghiệm thường xuyên) và p99 (tail latency) — **không dùng riêng p50 để qua cổng**.

| Lớp endpoint | Ngưỡng kỹ thuật ban đầu |
|---|---|
| Phiên, thành viên, phân quyền (fast path) | p95 ≤ 50 ms; p99 ≤ 150 ms |
| Đọc chi tiết hoặc danh sách đã phân trang | p95 ≤ 250 ms; p99 ≤ 750 ms |
| Ghi đơn giản một aggregate | p95 ≤ 400 ms; p99 ≤ 1.200 ms |
| Ghi nhiều bảng (chốt tuần, kéo Gantt, release batch) | p95 ≤ 1.500 ms; p99 ≤ 5.000 ms |
| Event-loop lag dưới tải kỳ vọng | p99 ≤ khoảng 50 ms |
| Chờ trong hàng đợi ghi SQLite | p95 ≤ 250 ms; p99 ≤ 1.000 ms |
| `/health/live`, `/health/ready` | p99 ≤ khoảng 200 ms; live không chạm DB |
| `SQLITE_BUSY` dưới tải kỳ vọng | 0 lần — quá tải phải bị hàng đợi/backpressure chặn trước |
| `429`/`503` dưới tải kỳ vọng | 0 ngoài burst đã định nghĩa |
| RSS ổn định | không vượt 70% giới hạn bộ nhớ; không tăng đơn điệu qua nhiều chu kỳ tải |

**Workload chuẩn để đo (8 lớp):** auth/session/membership · đọc chi tiết + danh sách phân trang + màn tổng
hợp Gantt/tuần/release · ghi đơn giản · ghi nhiều bảng · upload/download (file nhỏ/trung vị/sát giới hạn)
· Redmine (thành công/chậm/response lớn/timeout) · tải hỗn hợp 30 người có burst đăng nhập/revoke/đổi
quyền giữa lúc chạy · overload có kiểm soát để quan sát `429/503`/queue saturation/health. Tải hỗn hợp
khởi đầu: 70% đọc, 20% ghi đơn giản, 5% ghi hàng loạt, 3% upload/download, 2% Redmine — tỷ lệ này **phải
thay bằng telemetry pilot thật** khi có dữ liệu.

**Bảng kích hoạt đổi kiến trúc (đo trước, đổi sau — không đoán trước):**

| Dấu hiệu đo được | Quyết định được kích hoạt |
|---|---|
| Event-loop lag p99 vượt ~50 ms hoặc health bị trễ do SQL, sau khi đã tối ưu query/index/pagination | Chuyển DB access sang worker thread — **vẫn giữ SQLite** |
| Tra thành viên (membership) chiếm tỷ trọng lớn, route vượt ngân sách sau khi có index | Thiết kế security epoch có invariant + test invalidation |
| Chờ hàng đợi vượt ngân sách kéo dài, hoặc `SQLITE_BUSY` xuất hiện dù đã chuyển worker + tối ưu transaction | Đánh giá chuyển DB server (không quyết định trước) |
| RSS vượt 70%, tăng theo kích thước upload, không về vùng ổn định | Giảm concurrency/chunk, sửa streaming trước khi tăng memory limit |
| Redmine timeout chiếm worker/socket, ảnh hưởng route nội bộ khác | Giảm timeout/concurrency, thêm circuit breaker có thời hạn mở |
| Nhiều bản chạy (replica) trở thành nhu cầu thật | Lúc đó mới xét distributed rate limit, session strategy dùng chung, DB server — **không dùng chung 1 file SQLite cho nhiều writer** |

**Ba mốc phân kỳ, không lẫn lộn:**

| Mốc | Bắt buộc có |
|---|---|
| Trước pilot public (dù chỉ 1 người) | Toàn bộ `SEC-PERF-001..016`; OIDC/session/revoke; pending fail-closed (FR-2/FR-3); Origin+CSRF; IDOR/BOLA; body/header/timeout mặc định; rate cap; Redmine chống SSRF; upload streaming + kiểm định dạng; attachment authorization; audit/redaction; dependency gate; crash-restart; live/ready; SQLite queue; backup/restore; loại bỏ MCP và Luyện đề khỏi artefact server |
| Trước khi mở cho nhiều người | Inventory hoàn chỉnh cho mọi route đã giao; ma trận deny đủ vai trò/team/resource; benchmark tải hỗn hợp 30 người; hiệu chỉnh rate/quota/concurrency từ số đo; kiểm revoke/đổi quyền giữa tải; restore drill bằng dữ liệu di trú thật |
| Chỉ khi có bằng chứng tăng quy mô | Security epoch, DB chạy worker riêng, DB server, object storage, distributed limiter, nhiều replica — không kích hoạt chỉ vì "sắp có thêm người dùng" |
- **Múi giờ:** máy chủ đặt `Asia/Ho_Chi_Minh`. Toàn bộ luật giờ VN hiện hành ([rules/07](../../rules/07-rules-backend.md),
  cổng máy `check-tz.mjs`) **vẫn áp dụng nguyên vẹn**; FR-30 là chỗ **duy nhất** được phép đổi múi giờ, và
  chỉ cho nội dung bài tiếng Nhật.
- **Tương thích dữ liệu cũ:** migration phải **idempotent**, chạy lại an toàn, và **sao lưu + kiểm tổng
  trước khi đụng dữ liệu thật** (theo tiền lệ archive-then-drop của CR-20260912).
- **Trình duyệt:** chỉ hỗ trợ trình duyệt máy tính.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI (tham chiếu [docs/02](../../specs/02-screen-design-user-flow.md), [docs/06](../../rules/06-rules-frontend.md))

**Luồng đăng nhập lần đầu (sửa lại theo Q2/Q3 — không còn "có quyền ngay"):**

```
Chưa đăng nhập ──► Chuyển sang hệ xác thực công ty (OIDC, Authorization Code + PKCE)
                        │ callback hợp lệ (state/nonce/PKCE khớp)
                        ▼
              Email khớp cấu hình Admin? ──có──► Bind (issuer, sub) → tài khoản Admin
                        │ không
                        ▼
              Tạo tài khoản trạng thái "pending" (email + tên hiển thị)
                        │
                        ▼
        Màn "Chọn team và vai trò mong muốn"  ──►  Gửi YÊU CẦU THAM GIA
                        │                              (chưa có quyền nghiệp vụ nào)
                        ▼
              Admin nhận thông báo trong app ──► Admin duyệt (có thể sửa team/vai trò)
                        │
                        ▼
         Chuyển "active", quyền có hiệu lực ──► Popup bắt buộc xem: "Bạn đã được cấp team X, vai trò Y"
```

Ở mọi bước trước khi `active`, người dùng có phiên hợp lệ (đã qua OIDC) nhưng **mọi API nghiệp vụ vẫn
trả lỗi từ chối riêng cho trạng thái `pending`** — khác `401` (chưa đăng nhập) và khác `403` chung chung,
để FE phân biệt được "chưa đăng nhập" với "đã đăng nhập, đang chờ duyệt" (mã lỗi cụ thể chốt ở thiết kế
chi tiết lát 2). Phiên `pending` chỉ gọi được `GET /api/auth/me`, xem trạng thái đơn của mình, và logout.

**Thanh điều hướng** dựng động từ bảng FR-7 theo team đang chọn (SỬA 19/09, chỉ còn 2 mức): chức năng
`Tắt` không hiện tab; `Bật` hiện tab, các nút bấm/thao tác hiện đúng theo bảng năng lực tầng 3 (FR-8) cho
vai Member/Leader đang xem — không còn trạng thái "chỉ đọc toàn tab" ở tầng 2 nữa, quy ước xám/khoá nút
chỉ còn áp dụng cho từng nút cụ thể mà tầng 3 nói Member/Leader không được bấm (ví dụ Member không thấy
nút "Chốt tuần" ở Báo cáo tuần), không áp cho cả tab. **Bộ chọn team hiện tại** (FR-13)
đặt ở **góc trên, cạnh tên người dùng** — kiểu chuyển workspace quen thuộc (Slack/Notion), **chuyển ngay
không tải lại trang** khi đổi. **Chuông thông báo** (FR-34) đặt cạnh đó, bấm ra dropdown, không phải
trang riêng; **bấm vào một thông báo chuyển thẳng tới màn liên quan và đánh dấu đã đọc luôn**.

**Task cá nhân: không đổi giao diện gì** so với bản desktop hiện tại — xác nhận rõ để tránh thiết kế thừa,
vì đây là dữ liệu riêng tư tuyệt đối (FR-31), không có khái niệm team liên quan tới cách hiển thị.

**Khu quản trị (chỉ Admin)** — **một trang riêng, sidebar liệt kê từng khu**: *Teams & Leader* ·
*Bảng hiển thị chức năng* (lưới team × chức năng, mỗi ô một **công tắc Tắt/Bật** — cả 5 cột dùng chung
đúng 2 nhãn từ 19/09, không còn dropdown 3-4 lựa chọn; ô Báo cáo tuần disable kèm giải thích khi Project
của team đó đang `Tắt`, **không có thao tác hàng loạt**) · *Vai đặc biệt* (chọn team điều phối
release; **và bảng bật/tắt "Checklist cá nhân khi release" cho từng team phát triển**, FR-28a — mỗi dòng
ghi rõ điều kiện phụ thuộc Task cá nhân đang Bật hay Tắt cho team đó) · **URL Redmine hệ
thống** (FR-33, chuyển vào đây, không còn ở màn Cài đặt) · *Nhật ký thao tác* · **Người chờ duyệt** (mỗi
dòng sẵn team/vai trò họ đã chọn + 2 nút *Duyệt*/*Từ chối*, sửa được ngay trên dòng trước khi duyệt,
không cần mở popup riêng; *Từ chối* không bắt nhập lý do).

**Màn "Chọn team và vai trò" lúc onboarding:** chỉ hiện tên team + mô tả ngắn (nếu Admin có ghi) — không
lộ danh sách thành viên hiện có cho người chưa được duyệt.

**Trạng thái `pending`:** một trang riêng báo đang chờ Admin duyệt, **không vào được màn nào khác** của
app (khớp với việc backend chặn toàn bộ API nghiệp vụ ở lớp 1.5). Sau khi được duyệt, popup bắt buộc chỉ
cần bấm **"Đã hiểu"** một lần là qua, không bắt chọn lại team/vai trò.

**Màn quản lý team của Leader** (FR-12): 2 tab con trong cùng một màn — *Thành viên* (thêm/bớt người +
**chọn màu Gantt cho từng người**, FR-17; bớt người hiện số task chưa xong trước khi xác nhận, FR-12a) và
**Nhật ký** (FR-11a, chi tiết đầy đủ hoạt động của team mình, danh sách xuôi theo thời gian, không cần
lọc). Leader vào một chỗ là xong mọi việc điều hành team.

**Đăng ký lịch release trước khi khoá** (FR-25/FR-26): Leader team phát triển **sửa/nộp lại tự do, không
giới hạn số lần, không cần xác nhận thêm** — khớp đúng cơ chế `force:true` đã có sẵn trong code hiện tại.
Chỉ sau khi Leader điều phối **khoá lịch** mới chuyển sang luồng yêu cầu mở khoá (FR-26).

**Cài đặt (Member):** sau khi URL Redmine chuyển sang khu Admin, màn Cài đặt của Member **chỉ còn ô nhập
khoá Redmine riêng + phím tắt** — không còn thấy URL hệ thống.

**Màn hình mới của Release:** *Lịch release chung* (FR-24) dạng **danh sách, sắp theo ngày gần nhất**
(không phải lịch tháng), hiển thị đợt của mọi team kèm trạng thái (`nháp` / `đã nộp` / `xung đột` /
`đã khoá`). Khi xung đột: **dòng đó tự chuyển màu cảnh báo** trong danh sách, **đồng thời gửi thông báo**
(FR-34) cho cả 3 Leader liên quan (điều phối + hai team đang trùng) — không chỉ đổi màu thụ động.

**Yêu cầu mở khoá** (FR-26): form của team gồm **ngày giờ mới mong muốn + lý do** (ô chữ tự do). Leader
điều phối **duyệt ngay trên dòng**, cùng kiểu thao tác với màn *Người chờ duyệt* (FR-3) — không mở popup
riêng, để đồng bộ cách thao tác duyệt/từ chối trong toàn app.

**Màn Lên lịch khác nhau theo vai trò team (FR-9/FR-23, SỬA 19/09 lần 2 — viết lại theo mô tả trực tiếp
của Leader, thay bản mô tả "team điều phối có tab Cấu hình đợt riêng" ban đầu vì hiểu sai):** Leader team
điều phối thấy thêm 1 khu riêng để **ấn định 1 ngày chính cho release định kỳ** (FR-23b — dùng chung cho
toàn hệ thống, không phải cấu hình riêng của team họ) bên cạnh phần đăng ký lịch **khẩn cấp** cho chính
team mình (FR-23a, giống mọi Leader team khác); Leader team phát triển **chỉ thấy** phần đăng ký lịch
khẩn cấp của team mình + *Lịch release chung* (xem định kỳ + mọi đợt khẩn cấp, không sửa được gì ngoài
team mình). **Tách bạch khỏi khu trên:** nếu Admin đã bật FR-28a cho team đó, **mọi Member/Leader** của
team đó (không riêng Leader, không riêng team điều phối) thấy thêm **tab cá nhân "Quản lý template + Quản
lý task"** (FR-28a) với 2 tab con định kỳ/khẩn cấp — mỗi người tự định nghĩa & sinh task cho riêng mình,
không dùng chung với ai, kể cả Leader team điều phối cũng dùng đúng tab này cho bản thân, không có tab
"quản lý đợt" nào khác dành riêng cho vai trò điều phối.

**Không có màn "bài thông báo song ngữ" nào (bỏ hẳn 19/09 lần 5, xem FR-29)** — nội dung Việt/Nhật vẫn
**đính sẵn vào task tự sinh** từ template cá nhân khẩn cấp như cơ chế mẫu→task đã có sẵn trong app, chỉ
đúng phần tự động đổi giờ VN→JST (FR-30, đã thu hẹp) là còn cần sửa; không có bước "sinh bài gộp" hay màn
xem trước nào khác cho tính năng đã bỏ.

**Báo cáo tuần** (FR-21/FR-21a): **không có form riêng cho Member** — Member chỉ xem. Trọng tâm màn hình
đổi từ "khối chữ để copy" sang **danh sách task** (tên task, người phụ trách, % hoàn thành, project) —
khối chữ tổng hợp kiểu cũ giữ lại phía dưới cho Leader copy như trước. Wizard 4 bước giữ nguyên cấu trúc
nhưng chỉ Leader mở được, và phải nêu rõ trong bước xác nhận rằng thao tác này ghi đè tiến độ nhiều task
của cả team.

### 6.1a. Kiểm kê trang/popup cần dựng + hướng dẫn UX theo vai trò

> Chốt qua 2 phiên Council thật (run `9cd18851` — rút gọn danh sách; run `7565ec40` — soi theo từng
> role), 2026-09-13. Xem toàn văn ở [exchange 2026-09-13](../../exchanges/2026-09-13.md). Mục này gom
> lại để không phải tra rải rác trong văn xuôi §6.1 mỗi khi thiết kế chi tiết một lát.

**Kiểm kê theo đúng cấp giao diện (không đếm phẳng — tab/khu/inline không phải "màn" riêng):**

| Cấp | Số lượng | Danh sách |
|---|---|---|
| **Trang mới** | 5 | Chọn team & vai trò (FR-2) · Đang chờ duyệt (FR-2/3) · Khu quản trị — 1 trang, 7 khu con (FR-10) · Quản lý team Leader — 1 trang, 3 tab (FR-12/17/22) · Lịch release chung (FR-24/25) |
| **↳ 7 khu con trong Khu quản trị** | | Teams & Leader · Bảng hiển thị chức năng · Vai đặc biệt (+ bật FR-28a từng team) · URL Redmine hệ thống · Nhật ký thao tác (Admin, metadata) · Người chờ duyệt · **Người dùng** (mới — vô hiệu hoá/kích hoạt lại, thu hồi phiên, FR-4/4a) |
| **↳ 3 tab trong Quản lý team Leader** | | Thành viên (add/bớt + màu Gantt, FR-12/17) · Nhật ký hoạt động team (FR-11a) · **Cấu hình báo cáo** (mới — FR-22) |
| **Popup mới** | 4 | "Đã cấp team/vai trò" (FR-3) · Cảnh báo bớt thành viên (FR-12a) · Tạo team mới · Yêu cầu mở khoá (FR-26) |
| **Component lỗi dùng chung, làm SỚM (không phải cuối)** | 2 | Popup mất quyền (FR-4a) — 3 nhánh nội dung: mất team / đổi vai trò / tài khoản bị khoá hẳn (nhánh khoá đưa thẳng về trạng thái "không được phép truy cập" của vỏ xác thực, không quay vòng login/logout) · Component lỗi `409` (FR-18/46) — bắt buộc có nút tải lại dữ liệu mới, không chỉ toast |
| **Inline/bổ sung vào màn có sẵn** | 6 | Lọc "chỉ task của tôi" (FR-17a) · Control "ép giờ chung" trong Lịch chung (FR-25) · Duyệt mở khoá inline trên dòng (FR-26) · "Checklist cá nhân khi release" (FR-28a) · Công tắc riêng tư/chia sẻ Mind Map (FR-32) · Deep-link thông báo FR-9a |
| **Sửa màn có sẵn** | 3 | Báo cáo tuần (FR-21a) · Cài đặt Member (FR-33) · Popup sửa task Project — thêm multi-assignee (FR-16) |
| **FR-1/1a (đăng nhập)** | — | Không có trang riêng — chuyển thẳng sang OIDC; mọi lỗi (callback sai, bootstrap Admin đụng nhau, tài khoản bị khoá) dùng **chung một trạng thái lỗi của vỏ xác thực**, không tạo trang riêng cho từng loại lỗi |

**Hướng dẫn UX theo vai trò (run `7565ec40`, hội tụ — không cần thêm trang nào, chỉ cần tinh chỉnh
điều hướng/nhãn/liên kết):**

- **Member:**
  - Trang "Đang chờ duyệt" phải tự cập nhật: hiện lại team/vai trò đã xin, nút **"Kiểm tra lại"**, tự
    chuyển màn ngay khi Admin duyệt/từ chối trong lúc trang đang mở (không bắt Member tự đoán khi nào
    được vào).
  - **Cẩn thận ngôn ngữ, tránh gợi ý sai quyền:** dùng nhãn **"Task tôi phụ trách"**, không dùng
    "Project của tôi"/"sửa project" (Member chỉ sửa task được giao — FR-8/AC-8, không sửa project).
    Báo cáo tuần ghi rõ *"Bạn đang xem báo cáo của team; Leader là người chốt tuần"* thay vì chỉ ẩn nút
    wizard — tránh để Member tưởng mình phải tự gửi báo cáo.
- **Leader team phát triển:**
  - "Cấu hình báo cáo" (tab trong Quản lý team) và màn Báo cáo tuần cần **link 2 chiều** — không bắt
    Leader tự đoán phải rời màn nào đi đâu để đổi loại báo cáo.
  - "Lịch của team tôi" và "Lịch chung" nên là **2 tab anh em trong cùng khu Release**, giữ nguyên
    ngày/đợt đang xem khi chuyển qua lại — không phải 2 mục điều hướng rời rạc làm mất ngữ cảnh.
  - Đổi nhãn **"Nhật ký" → "Nhật ký hoạt động team"** (tránh nhầm với Nhật ký Admin, FR-11a).
  - Thông báo xung đột (FR-25) phải nhảy thẳng đúng dòng/đợt xung đột, không chỉ mở đầu trang Lịch chung.
- **Leader team điều phối release:**
  - Thêm **thanh trạng thái đầu trang** Lịch release chung: *Còn xung đột → Chờ mở khoá → Sẵn sàng
    khoá → Đã khoá* — để trình tự thao tác nhìn thấy được, không phải tự biết làm gì trước.
  - **"Khoá lịch" đặt ở cấp TOÀN KỲ** (header, kèm tên kỳ + bước xác nhận rõ phạm vi), không phải nút
    trên từng dòng team — tránh hiểu nhầm "khoá 1 team" khi thực ra khoá cả đợt.
  - Khối **"Việc cần xử lý"** gom xung đột quá hạn + yêu cầu mở khoá — tránh chìm trong danh sách dài.
- **Admin:**
  - **Phát hiện quan trọng nhất:** thao tác **"Thay Leader" phải là MỘT hành động nguyên tử** (gỡ Leader
    cũ + gán Leader mới cùng một giao dịch). Nếu tách hai bước, Admin có thể vướng **giới hạn "tối đa 1
    Leader/team" của FR-6** — không gán được Leader mới vì Leader cũ (đã `disabled` nhưng vẫn còn giữ
    vai trong `team_members`) chưa được gỡ — **đây là ngõ cụt thật**, không phải rủi ro giả định.
  - Thông báo FR-9a cần **2 CTA khác nhau tuỳ tình huống**: *"Chỉ định/Thay Leader"* (ca Leader bị bớt
    khỏi team) và thêm *"Xem tài khoản bị vô hiệu hoá"* (ca Leader vẫn còn giữ vai nhưng tài khoản bị
    `disabled`) — deep-link phải chọn sẵn đúng team, cuộn tới đúng dòng, làm nổi vấn đề.
  - Badge số lượng ở mục **"Người chờ duyệt"** trong sidebar (hàng đợi dễ bị bỏ sót nếu chỉ là mục
    ngang hàng không có dấu hiệu).
  - Bảng hiển thị chức năng (team × chức năng) cần header cố định + tìm/lọc team — vì CR cấm thao tác
    hàng loạt, bảng nhiều team dễ nặng hơn cả sidebar.
  - *(Cải thiện phụ, không bắt buộc):* có thể gom 7 khu sidebar thành 3 cụm nhãn — "Team & quyền" /
    "Truy cập" / "Hệ thống".

**Rủi ro dùng chung cho mọi vai trò (áp dụng khi thiết kế chi tiết, không phân biệt role):**

- Popup mất quyền (FR-4a) phải phân biệt rõ **3 tình huống khác nhau** (mất team / đổi vai trò / tài
  khoản bị khoá) để người dùng biết nên hỏi Leader hay Admin — không dùng một câu chung chung cho cả 3.
- Component `409` (FR-18/FR-46) bắt buộc có hành động **tải lại dữ liệu mới**; chỉ hiện toast rồi giữ
  nguyên form cũ sẽ khiến người dùng tiếp tục sửa trên dữ liệu đã lỗi thời.
- Bộ chọn team hiện tại (FR-13) phải **luôn hiện rõ** ở mọi màn phụ thuộc team (Quản lý team, Báo cáo
  tuần, Release) — đây là nơi hậu quả nhầm team lớn nhất.
- Mỗi loại notification (FR-3, FR-9a, FR-25, FR-34) cần **đích deep-link riêng** phù hợp với nó — "mở
  màn liên quan" ở mức trang chung là chưa đủ khi hàng đợi/danh sách dài.

### 6.2. API & nghiệp vụ (tham chiếu [docs/03](../../specs/03-api-business-logic-spec.md), [docs/07](../../rules/07-rules-backend.md))

**Tầng xác thực + phân quyền đặt trước mọi route nghiệp vụ**, không rải rác trong từng handler:

| Lớp | Trách nhiệm | Lỗi trả về |
|---|---|---|
| 1. Phiên | Đọc cookie phiên, tra DB xác định `user_id`; hết hạn/không có/không hợp lệ ⇒ buộc đăng nhập lại | `401` |
| 1.5. Trạng thái tài khoản | Tra `users.status` **mỗi request** (FR-4a); `pending` chỉ qua được whitelist rất nhỏ (`/me`, xem đơn, logout); `disabled` chặn hết | Mã riêng cho `pending` (không phải `401`/`403` chung) · `403` cho `disabled` |
| 2. Ngữ cảnh team | Xác định team đang thao tác **từ bản ghi đích trong DB**, không tin `teamId` do client gửi; xác định vai trò của người dùng trong team đó | `403` |
| 3. Hiển thị (tầng 2) | Tra bảng `team_feature_visibility`; `Tắt` (chỉ còn 2 mức từ 19/09, không còn `chỉ đọc`) mà gọi bất kỳ đường nào của chức năng đó ⇒ chặn | `403` |
| 4. Năng lực (tầng 3) | Áp bảng luật cố định theo `(chức năng, hành động, vai trò)` — hàm `authorize()` tập trung (FR-40) | `403` |
| 5. Vai đặc biệt (tầng 4) | Chỉ team điều phối release qua được các endpoint điều phối | `403` |

Ba ngoại lệ không đi theo đúng 5 lớp trên, cần policy/projection riêng: **Task cá nhân** (không có ngữ
cảnh team, chỉ owner), **lịch Release liên team** (đọc chéo team có chủ đích, field-set giới hạn theo
FR-24), **audit** (hai projection khác nhau theo FR-11a).

Nguyên tắc bắt buộc: **fail-closed** — endpoint không khai báo được chức năng/hành động của nó thì bị
chặn, không mặc định cho qua.

**Hợp đồng `authorize()` — MỘT cổng vào duy nhất (chốt qua Council thật `1aa7fe8b`, 19/09, xem
[exchange 2026-09-19](../../exchanges/2026-09-19.md) cho toàn bộ thiết kế Lát 3):**

```
authorize(input: AuthorizeInput): AuthorizationDecision
```

- `AuthorizeInput = { actor: {userId, systemRole, memberships}, policyKind: 'team_feature' | 'personal_task' | 'cross_team_release' | 'audit', resource: string, action: string, scope: {...theo policyKind} }`.
  `policyKind` là **union đóng** — core tự dispatch nội bộ tới đúng policy; **route không được gọi thẳng
  hàm nội bộ nào khác** (kể cả cho 3 ngoại lệ) — đây là điểm bắt buộc để giữ đúng MỘT cổng vào fail-closed
  của FR-40, không phải "một hàm nhưng nhiều lối vòng".
- Luôn `throw HttpError(403, message, code)` khi từ chối, không bao giờ trả `false`. Khi cho qua, trả
  `AuthorizationDecision {viewerTeamId, effectiveRole, projection, ownerOnly}` đã chuẩn hoá — route dùng
  trực tiếp, không tự suy luận thêm quyền chi tiết.
- `policyKind: 'team_feature'` (đường thường, đa số route): (1) `team_feature_visibility(scope.teamId, feature)`
  = `off` ⇒ `403 FEATURE_DISABLED`; (2) actor không phải thành viên `scope.teamId` ⇒ `403 NOT_TEAM_MEMBER`;
  (3) tra `AUTHORIZATION_POLICY[resource][action]` (object literal cố định trong
  `server/lib/authorization-policy.ts`, không lưu DB — đúng FR-8) ⇒ vai trò không hợp lệ thì
  `403 ROLE_FORBIDDEN`; (4) nếu `resource==='release_coordinator'`: kiểm actor là Leader hiệu lực của
  đúng team đang là `app_config.release_coordinator_team_id`, **độc lập** với trạng thái Bật/Tắt Release
  của chính team đó (FR-9) ⇒ không đạt thì `403 NOT_RELEASE_COORDINATOR`.
- `policyKind: 'personal_task'`: actor có ít nhất 1 membership ở team đang `personal_task=on` (luật hợp
  nhất FR-14) và `scope.ownerId === actor.userId` — không có khái niệm `activeTeamId`.
- `policyKind: 'cross_team_release'`: không phải allow/deny — mọi Member/Leader của team đang Bật Release
  đều được đọc; khác biệt chỉ ở field nào trả về, nằm trong `AuthorizationDecision.projection` (FR-24).
- `policyKind: 'audit'`: đọc route vẫn qua `authorize()` bình thường; `projection` quyết định Admin nhận
  `{actor, action, team, created_at}` hay Leader nhận thêm `payload` đầy đủ của team mình (FR-11a).
- `actor.memberships`/`systemRole` load **mới hoàn toàn mỗi request**, không cache.
- Mã lỗi mới trong `server/lib/error-codes.ts`: `FEATURE_DISABLED`, `NOT_TEAM_MEMBER`, `ROLE_FORBIDDEN`,
  `NOT_RELEASE_COORDINATOR`.
- Lát 4-6 chỉ cần: (a) viết 1 scope resolver cho resource mới, (b) thêm dòng vào `AUTHORIZATION_POLICY`,
  (c) gọi `authorize()` đúng `policyKind`/`resource`/`action` — không sửa core.

**Nhóm endpoint mới** (chi tiết thân/đáp ứng chốt ở bước thiết kế từng lát):

- `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/onboarding/join-request` — gửi yêu cầu tham gia (team + vai trò mong muốn), trạng thái `pending`
- `GET|POST /api/admin/join-requests`, `POST /api/admin/join-requests/:id/approve` — Admin duyệt, có thể sửa team/vai trò (FR-3)
- `GET|POST|PATCH|DELETE /api/admin/teams`, `/api/admin/teams/:id/members`, `/api/admin/feature-visibility`, `/api/admin/release-coordinator`
- `GET /api/teams/:teamId/members` (mọi thành viên team đó xem được, chốt 19/09) `POST`/`DELETE /api/teams/:teamId/members/:userId` (chỉ Leader — FR-12)
- `POST /api/admin/users/:id/revoke-sessions` — Admin thu hồi toàn bộ phiên của một user (FR-4a)
- `GET /api/notifications`, `PATCH /api/notifications/:id/read`
- `GET /api/audit` — nhật ký thao tác quan trọng, projection theo Admin (metadata) hoặc Leader (chi tiết team mình) — FR-11a
- `GET /api/release/schedule-board` — lịch release chung, field-set khác nhau theo vai trò (FR-24)
- `POST /api/release/batches/:id/submit|lock|unlock-request|approve-unlock|force-time` (FR-25, FR-26, FR-27)
- `GET|PUT /api/me/redmine` — khoá Redmine cá nhân (FR-33); `PUT /api/admin/redmine-url` — URL hệ thống, chỉ Admin
- `GET /health/live`, `GET /health/ready` — tách nghĩa (FR-39)

**Route inventory — cổng DoR/CI (FR-41), 11 trường bắt buộc cho MỌI route, kể cả route đã có từ trước:**

| # | Trường | Nội dung |
|---|---|---|
| 1 | Access class | `public` \| `onboarding` (pending) \| `authenticated` \| `admin` \| `health` |
| 2 | Resource/action | Tài nguyên + hành động dùng để `authorize()` kiểm |
| 3 | Scope resolution | Cách suy ra owner/team: từ bản ghi DB, từ user hiện tại, hoặc ngoại lệ (Release liên team) |
| 4 | Validation schema | Schema params/query/body/header; chính sách field thừa |
| 5 | Resource class | `read` \| `write` \| `bulk` \| `upload` \| `download` \| `outbound` \| `health` |
| 6 | Body limit | Số byte cụ thể cho route đó |
| 7 | Timeout | Deadline và cách huỷ công việc khi quá hạn |
| 8 | Concurrency | Semaphore/bucket áp dụng |
| 9 | Audit | Có ghi nhật ký không, field nào được phép ghi |
| 10 | Idempotency | Có cần idempotency key không, phạm vi + TTL |
| 11 | Optimistic concurrency | Có cần `row_version` không, quy tắc `409` |

Inventory phải **sinh hoặc kiểm trực tiếp từ router đã đăng ký** (không phải bảng viết tay dễ lệch code
thật — đúng loại lỗi `L-010` đã ghi nhận). Test phân quyền phải **sinh từ inventory này**, không chỉ vài
test mẫu viết tay. **Phạm vi: 84 route hiện hữu được giữ lại** (106 route hiện có, trừ 22 route Luyện đề
sẽ gỡ) cộng mọi route mới ở trên — con số này tăng theo route mới, không cố định.

**Chống sửa trùng lúc (FR-18, FR-46):** mỗi bảng cần `row_version` có cột tăng mỗi lần ghi (SỬA 19/09 —
thống nhất tên cột, không dùng `version`, xem §6.3); update dùng `WHERE id=? AND row_version=?`, lệch thì
trả `409` kèm mã lỗi riêng để giao diện hiện đúng thông điệp *"có người vừa thay đổi"*.

**Toàn bộ endpoint hiện có phải được gán nhãn `(chức năng, hành động)` và đủ 11 trường ở trên** để lớp
3–5 áp được — đây là công việc rà soát bắt buộc trước khi coi DoR xong (FR-41), không phải tuỳ chọn.
Danh sách hành động đầy đủ đã kiểm kê sơ bộ từ code, xem [exchange §6](../../exchanges/2026-09-13.md);
route inventory thật phải đối chiếu lại với router đã đăng ký, không chỉ dựa vào kiểm kê thủ công đó.

### 6.3. Dữ liệu & schema (tham chiếu [docs/04](../../specs/04-database-design.md), [docs/08](../../rules/08-rules-database.md))

**Bảng mới:**

| Bảng | Nội dung chính |
|---|---|
| `users` | `id`, `issuer`, `subject` (định danh OIDC ổn định — unique cùng `issuer`), `email` (không unique, chỉ hiển thị/bootstrap), `display_name`, `status` (`pending`\|`active`\|`disabled`), **`system_role` (`user`\|`admin`, thêm 19/09 — bản trước không có cách biểu diễn Admin)**, **`row_version`** (kéo sớm từ FR-46), `created_at`, `last_login_at` |
| `join_requests` | `user_id`, `requested_team_id`, `requested_role` (giữ nguyên làm lịch sử yêu cầu gốc), **`approved_team_id`, `approved_role`** (nullable, thêm 19/09 — Admin có thể sửa team/vai trò khi duyệt theo FR-3, tách khỏi yêu cầu gốc), `status` (`pending`\|`approved`\|`rejected`), `reviewed_by`, `reviewed_at`, **`row_version`**, unique index `(user_id)` `WHERE status='pending'` — một user chỉ có đúng 1 đơn đang chờ |
| `teams` | `id`, `name` (unique), `description`, `created_at`, **`row_version`** |
| `team_members` | `team_id`, `user_id`, `role` (`leader` \| `member`) — khoá chính ghép; **partial unique index `(team_id) WHERE role='leader'`** thi hành "tối đa một Leader/team" (FR-6) — SQLite `CHECK` không kiểm được số dòng khác trong bảng nên không dùng CHECK |
| `team_feature_visibility` | `team_id`, `feature`, `level` (`off` \| `on` — chỉ 2 giá trị từ 19/09, bỏ `read_only`/`team`/`leader_only`), `row_version`, `updated_at`, `updated_by`. Seed đủ 5 dòng `off` trong cùng transaction tạo team (fail-closed mặc định, chốt 19/09) |
| `app_config` | singleton `id=1 CHECK(id=1)`, **chỉ một cột nghiệp vụ**: `release_coordinator_team_id` (FK `teams.id`), `row_version`. **Sửa 19/09** — bỏ hẳn `admin_bootstrap_email` (chuyển thành biến môi trường đọc lúc khởi động, đúng FR-1a — để trong DB là mâu thuẫn đã phát hiện) và bỏ hẳn `redmine_base_url` (giữ nguyên ở `app_settings` key-value đang chạy thật, tránh trùng vai trò với hai cách lưu cấu hình song song) |
| `user_sessions` | `id`, `user_id`, `token_hash` (không lưu giá trị thật), `created_at`, `expires_at`, `revoked_at`, `last_seen_at` — phục vụ thu hồi phiên (FR-4). **Không còn dấu hiệu thiết bị** kể từ khi bỏ FR-5 (13/09) |
| `audit_log` | **Kéo sớm lên Lát 3 (sửa 19/09 — trước đó §10 xếp ở Lát 4, nhưng chính hành động của Lát 3 — đổi thành viên, tầng 2, tầng 4 — đã cần ghi log theo FR-19; Lát 4 chỉ mở rộng thêm danh mục hành động nghiệp vụ):** `actor_user_id`, `team_id` (nullable — có hành động không gắn 1 team, vd tạo team/đổi team điều phối), `action` (dạng `resource.verb`), `target`, `payload` (JSON **đầy đủ**, không tóm tắt sẵn — lọc field làm ở tầng đọc qua 2 hàm projection Admin/Leader+Member, không tách 2 bảng), `created_at`; index `(team_id, created_at)` và `(created_at)` (FR-19, đọc qua 2 projection theo FR-11a — Admin xem metadata, Leader **và Member** xem chi tiết đầy đủ của đúng team mình). **Hành động chạm 2 team (chốt 19/09 lần 14, vd "ép giờ chung" FR-25):** ghi **2 dòng** cùng `action`/`payload`/`actor_user_id`, khác `team_id` (team của actor và team bị ảnh hưởng) — không thêm cột `secondary_team_id`, đơn giản hơn và không đổi hình dạng bảng |
| `notifications` | `user_id`, `kind`, `payload`, `read_at` (FR-34) |
| `user_redmine_config` | PK `user_id`, `api_key_ciphertext`, `created_at`/`updated_at` — không `team_id` (1 khoá dùng ở mọi team), không `row_version` (chỉ chính User ghi secret của mình). **Sửa lỗi soạn thảo 19/09:** URL hệ thống **KHÔNG** nằm ở `app_config` như câu cũ ghi nhầm — vẫn ở `app_settings.redmine_base_url` key-value đang chạy thật, đúng dòng `app_config` phía trên (2 câu này tự đá nhau trong bản cũ, Council `74715c65` phát hiện) |
| `weekly_report_kinds` (mới, lấp khoảng trống FR-22 — Council `74715c65`, 19/09) | `id` ngẫu nhiên bất biến, `team_id`, `code` (unique không phân biệt hoa/thường theo `(team_id, code)`), `label`, `render_mode` (**allowlist đóng trong code**, khởi điểm `internal_markdown`/`management_summary` — Leader KHÔNG tự soạn template, chỉ quản `code`/`label`/`sort_order`/`is_active`/`requires_project_risk`), `requires_project_risk` (bool), `sort_order`, `is_active` (ngừng dùng không phá lịch sử), `row_version`, `created_at`/`updated_at`, `created_by`/`updated_by`. Seed 2 dòng/team khi di trú: `internal`→"Nội bộ Dev13", `vn_management`→"Báo cáo DM" |
| `weekly_project_risks` (mới, cùng Council) | `id` ngẫu nhiên, `team_id`, `week_start`, `report_kind_id` (FK), `project_id` (FK), `risk`, `mitigation`, `row_version`, `created_by`/`updated_by`, `created_at`/`updated_at`; unique `(team_id, week_start, report_kind_id, project_id)`; cần trigger/ràng buộc đảm bảo `report_kind_id` và `project_id` đều thật sự thuộc `team_id` |
| `release_unlock_requests` | yêu cầu mở khoá/huỷ sau khi đã chốt (FR-26, FR-27) |
| `mindmap_attachments` | `id` ngẫu nhiên (≥128 bit), `mindmap_id` (FK, `ON DELETE CASCADE`), `owner_user_id`, `team_id` (nullable — **chỉ là metadata lúc upload, KHÔNG phải nguồn quyền**, quyền tải luôn join trạng thái sống của `mindmaps` để tránh quyền cũ còn hiệu lực sau khi đổi riêng tư/đổi team), `original_name`, `storage_key` (unique, server sinh), `extension`, `declared_mime`, `detected_mime`, `byte_size` (`>0`), `sha256`, `status` (`pending`\|`ready`\|`quarantined`\|`deleted`), `created_at`/`ready_at`/`deleted_at`, `created_by` — download authorize qua bảng này, không suy từ độ khó đoán tên file |
| `team_release_task_autogen_settings` | `team_id`, `enabled` (FR-28a) — cấu hình Admin bật/tắt riêng cho từng team phát triển. **Không còn bảng `personal_release_checklists` riêng (sửa 19/09 lần 2, xem Lát 6 bên dưới)** — Leader xác nhận checklist cá nhân dùng đúng 4 bảng thật đã có trong code (`release_templates`/`release_task_definitions`/`emergency_release_templates`/`emergency_release_task_definitions`, thêm `owner_user_id` ở Lát 6), không cần bảng tự tạo riêng |

Bảng nào cần chống sửa trùng (FR-46) thêm cột `row_version` riêng, không liệt kê lặp lại ở đây — **ngoại lệ:
`users`, `teams`, `join_requests`, `team_feature_visibility`, `app_config` đã có `row_version` ngay từ
Lát 3** (kéo sớm một phần FR-46, chốt 19/09) vì hai Admin có thể đổi cấu hình cùng lúc ngay từ lát này,
không cần chờ Lát 4.

**Sửa bảng hiện có — thiết kế kỹ thuật chi tiết Lát 4 (chốt qua Council thật `76e03307`, 19/09, hội tụ 2
vòng không cần hỏi lại Leader — xem [exchange 2026-09-19](../../exchanges/2026-09-19.md) cho toàn bộ quá
trình, kể cả số liệu đọc trực tiếp từ DB Dev13 thật):**

| Bảng | Cột/thay đổi | Ghi chú |
|---|---|---|
| `projects` | + `team_id` (FK `teams.id`), + `responsible_user_id` (FK `users.id`, nullable — **bổ sung mới**, FR-15 nói cả project dùng User thật nhưng bản CR trước chỉ nêu cho task/assignment), + `legacy_pic_label`, + `row_version` | `team_id` nullable trước, backfill Dev13, rebuild sau nếu cần `NOT NULL`. **Cột `pic TEXT` hiện có (`server/schema/project.ts`, bắt buộc khi tạo project — `POST /projects`) chốt 19/09 lần 20 cùng quyết định FR-15: bỏ hẳn, `POST /projects` ngừng nhận `body.pic`, bắt buộc chọn `responsible_user_id` thật** — giá trị cũ copy sang `legacy_pic_label` ở bước di trú, cột `pic` gốc thành dữ liệu chết |
| `project_tasks` | + `team_id`, + `legacy_pic_label`, + `row_version` | **Bắt buộc trigger hai chiều** (không chỉ kỷ luật route): `BEFORE INSERT/UPDATE OF project_id, team_id ON project_tasks` từ chối nếu không tồn tại project có đúng cặp `(id, team_id)`; `BEFORE UPDATE OF team_id ON projects` từ chối đổi team của project đã có task — vì `authorize()` một-cổng-vào của Lát 3 đọc `team_id` thẳng trên resource, lệch `team_id` giữa task và project cha là rò dữ liệu chéo team, không phải lỗi hiển thị thường. **Cột `assignee TEXT` đã có sẵn (tách biệt với `project_task_assignments`) — chốt 19/09 lần 20, Leader xác nhận trực tiếp: bỏ hẳn ô chữ tự do này, bắt buộc chọn User thật qua đúng cơ chế `assignments` (kể cả task chỉ 1 người, vẫn là mảng 1 dòng)** — route `PATCH /projects/:projectId/tasks/:taskId` phải **ngừng nhận/ghi `body.assignee`** sau khi lên multi-user; giá trị cũ trong cột này chỉ còn đọc được qua `legacy_pic_label` (đã copy sang ở bước di trú 5), cột `assignee` gốc trở thành **dữ liệu chết, không còn route nào ghi/đọc**, có thể xoá ở một đợt dọn sau, không bắt buộc xoá ngay |
| `project_task_assignments` | **Rebuild bảng** (không chỉ `ADD COLUMN`, vì `pic` đang `NOT NULL`): `user_id` (FK `users.id`, nullable), `legacy_pic_label` (nullable), bỏ cột `pic`, **deprecate cột `tien_do`** (đã tồn tại trong DB nhưng chưa từng dùng ở `mappers.ts`, không trả API/không tính toán), giữ nguyên `start_date`/`end_date`/`estimate_hours`/`sort_order`, + `row_version`. `CHECK` bắt buộc đúng một trong hai: dòng mới có `user_id` thật, hoặc dòng legacy có `legacy_pic_label` không rỗng. Partial unique `(project_task_id, user_id) WHERE user_id IS NOT NULL` — mỗi User đúng một khoảng trên một task (không cấm khoảng của nhiều User chồng nhau) |
| `pics` | + `team_id` | Chuyển hẳn thành chỉ đọc, không còn là nguồn chọn người; không có `team_id` thì team mới sẽ nhìn thấy nhãn/màu lịch sử của Dev13 |
| `team_member_gantt_colors` (bảng mới) | `team_id`, `user_id`, `color_key` (token cố định trong 15 giá trị, ánh xạ sang hex ở tầng code — không lưu chỉ số mảng vì sắp xếp lại palette sẽ đổi màu dữ liệu đã lưu), `row_version`, `updated_at`, `updated_by`; PK `(team_id, user_id)`; unique `(team_id, color_key)` | Tách khỏi `pics`/`team_members` vì lifecycle riêng. **Không chặn phân công task khi User chưa có màu** — Gantt vẽ xám trung tính kèm tên cho tới khi Leader gán màu; đây là quyết định 2 agent tự thống nhất (không ghép cứng nghiệp vụ chính với cấu hình hiển thị phụ), không cần hỏi Leader |
| `weekly_goals`, `weekly_task_evaluations`, `weekly_project_summaries` | + `team_id`, + `legacy_pic_label` (riêng `weekly_goals`), + `row_version` | |
| `weekly_report_history` | + `team_id`, + `row_version`, **rebuild để đổi unique** từ `(week_start, kind, mode)` toàn hệ thống sang `(team_id, week_start, kind, mode)` | Unique cũ là lỗi thật sẽ chặn cứng hai team cùng có báo cáo cùng loại cùng tuần — không sửa được chỉ bằng `ADD COLUMN` |
| Project hệ thống "Khác" | không đổi cột, đổi **cách seed** | Hiện là 1 bản ghi toàn app — phải tách thành đúng 1 project hệ thống mỗi team, unique partial `(team_id) WHERE is_system=1` |
| `tasks` | + `owner_user_id` | Không thêm `team_id` (đúng luật hợp nhất FR-14), không thêm `row_version` (chỉ owner ghi). **Bắt buộc thêm `owner_user_id = ?` vào WHERE của cả 7 route thật hiện có** (xem chi tiết + rủi ro cụ thể ở FR-31) — riêng câu UPDATE hàng loạt theo tên trùng ở `PATCH /tasks/:id?updateRelated=true` phải thêm điều kiện này, không chỉ thêm cột rồi để nguyên câu SQL cũ |
| `mindmaps` | + `owner_user_id`, + `visibility`, + `shared_team_id` (nullable — **bổ sung mới**, chỉ `owner_user_id+visibility` chưa đủ biết chia sẻ cho team nào khi chủ sở hữu thuộc nhiều team) | Không `row_version` (chỉ creator ghi, đúng FR-32) |

**Danh sách bảng cần `row_version` từ Lát 4** (tên cột thống nhất `row_version` cho mọi lát, không dùng
lẫn `version`): `projects`, `project_tasks`, `project_task_assignments`, `team_member_gantt_colors` (khoá
`(team_id,user_id)`, không phải `id`), `weekly_goals`, `weekly_task_evaluations` (khoá
`(team_id,week_start,project_task_id)`), `weekly_project_summaries` (khoá `(team_id,week_start,project_id)`),
`weekly_report_history`. Không áp dụng: `tasks`, `mindmaps`, `pics`, `audit_log` (append-only). Các bảng
cấu hình/batch Release (`release_templates`, `release_task_definitions`, batch/lịch từng team) cần
`row_version` khi **Lát 6** sửa chúng — không kéo sớm vào Lát 4 vì thiết kế Release nhiều team (kể cả
bảng lưu đăng ký lịch theo từng team, hiện **chưa tồn tại** trong `server/schema/release.ts` — chỉ có
template/định nghĩa/batch đơn-team) thuộc đúng phạm vi Lát 6.

**Danh mục `audit_log` mở rộng ở Lát 4** (đã đối chiếu trực tiếp `server/routes/schedules.ts`/`release.ts`
thật — loại bỏ các hành động Release mà code hiện tại chưa có route/trạng thái nào biểu diễn):
`project.delete`, `project_task.delete`, `weekly_report.finalize`, `weekly_goals.delete_all`,
`project_task.assignment.add`, `project_task.assignment.remove`. Các hành động
`release_schedule.lock`/`unlock_request`/`unlock_approve`/`force_time`, `release_batch.cancel` **chỉ khai
báo và phát sinh khi Lát 6** tạo đúng route/schema cho chúng (khoá lịch, yêu cầu mở khoá, ép giờ chung,
huỷ đợt đều **chưa tồn tại** trong code thật hôm nay — `schedules.ts` hiện chỉ có tạo/đồng bộ task, sửa
`teams`/`systems`/`da_dang` của batch, xoá task theo `releaseKey`).

**Người phụ trách (FR-15, FR-16):** giữ bảng `project_task_assignments`, rebuild để trỏ `user_id` (xem
trên), **cho phép nhiều dòng có khoảng thời gian chồng lấn** — schema hiện tại (`start_date`/`end_date`/
`estimate_hours`, xoá-rồi-chèn-lại toàn bộ khi lưu) đã tương thích sẵn, không cần sửa gì thêm ngoài đổi
`pic`→`user_id`. `pics` giữ lại **chỉ như dữ liệu lịch sử phục vụ nhãn cũ**, không còn là nguồn chọn người.

**⚠️ Phát hiện thật cần Leader biết trước khi chạy di trú thật (không phải quyết định thiết kế — là hiện
trạng dữ liệu):** đọc trực tiếp DB Dev13 thật (chỉ đọc) cho thấy **4/6 `project_task_assignments` hiện
đang gắn vào task đã có task con** — vi phạm quy tắc "chỉ task lá mới có phân công theo giai đoạn" mà
route hiện tại áp đặt (khả năng cao: assignment được tạo khi task còn là lá, sau đó có người thêm task
con mà không dọn/chặn assignment cũ). Xử lý: **giữ nguyên làm dữ liệu lịch sử, không tự xoá, không đưa
lên Gantt**, và báo cáo migration phải liệt kê rõ 4 dòng này để Leader tự xử lý tay sau khi di trú; route
tạo task con (mọi lát sau này) phải chặn hoặc yêu cầu xác nhận nếu task cha tương lai còn assignment thật.

**Di trú (FR-20) — hợp đồng 7 hàm theo đúng thứ tự bắt buộc (chốt kỹ thuật 19/09):**

1. `createVerifiedBackup()` — đưa app vào chế độ chỉ đọc, đóng mọi writer; sao lưu DB nguồn cùng WAL/SHM
   đúng cách hoặc dùng SQLite backup API; tính SHA-256 + manifest (kích thước, thời điểm, `user_version`,
   số dòng từng bảng); **không sang bước 2 nếu chưa đọc thử và khớp checksum**.
2. `buildServerDatabaseFromDesktopSnapshot()` — **không xoá** bảng `de_thi_*` khỏi DB desktop gốc (Luyện
   đề còn dùng ở desktop); tạo DB server từ snapshot/allowlist bảng được chuyển; build server **không
   mount** `de-thi.ts` — test endpoint phải trả `404`, không phải SQL `500`; xác nhận DB gốc + Luyện đề
   còn nguyên vẹn sau bước này.
3. `applySlice4Schema()` + `ensureDev13Identity()` — tạo bảng/cột/index mới; tìm hoặc tạo đúng một team
   `Dev13`; xác nhận User Leader đích đã tồn tại (`active`, đã bind OIDC) và có membership `leader` hợp
   lệ **trước khi** backfill owner — **không map bằng email hay display name** ở bước này.
4. `backfillDev13Scope(dev13TeamId, leaderUserId)` — gán Dev13 cho project/dữ liệu tuần/`pics` lịch sử;
   `owner_user_id = leaderUserId` cho toàn bộ `tasks`/`mindmaps` hiện có (Mind Map cũ mặc định `private`,
   không tự chia sẻ); `project_tasks.team_id` lấy từ `projects.team_id` qua join, không gán hằng số theo
   từng dòng; project hệ thống "Khác" trở thành đúng 1 dòng cho mỗi team.
5. `migrateLegacyPicLabels()` — copy nguyên văn (không tách chuỗi, không so khớp hoa/thường, không tra
   `pics`/`users.display_name`, không đoán tài khoản): `projects.legacy_pic_label = pic`,
   `project_tasks.legacy_pic_label = assignee` (giữ nguyên cả dạng nhiều tên `"A, B"`),
   `project_task_assignments.legacy_pic_label = pic` với `user_id = NULL`, `weekly_goals.legacy_pic_label = assignee`.
   **Không** tự sinh assignment mới từ chuỗi `assignee` (chuỗi không đủ ngày/estimate cho từng người).
6. `verifySlice4Migration()` — so số dòng + tập ID trước/sau từng bảng; hash nội dung canonical (cột cũ
   không đổi giá trị); mọi cột scope/owner đã backfill không còn `NULL` ngoài chỗ được thiết kế nullable;
   kiểm cây project (parent tồn tại, cùng project/team, level 1-3, không vòng); kiểm assignment (task tồn
   tại, ngày hợp lệ, nhãn legacy khớp đúng chuỗi nguồn, User mới nếu có thuộc đúng team); chạy lại rollup
   trước/sau, so ngày min/max + tổng estimate + `%` task cha; kiểm weekly goal/evaluation/summary trỏ
   đúng project/task cùng team; parse JSON Mind Map, kiểm file đính kèm còn tồn tại + hash khớp manifest;
   chạy `PRAGMA foreign_key_check` + `PRAGMA quick_check`; **lệch bất kỳ điều gì thì rollback DB đích và
   dừng**, không tiếp tục.
7. `smokeBootMigratedServer()` — khởi động đúng build server với DB vừa di trú; smoke test đăng nhập
   Leader, chọn Dev13, đọc project/tree/Gantt/weekly/tasks/mindmaps; xác nhận Luyện đề không có route
   trên server; chỉ đánh dấu migration hoàn tất sau khi **restart lần hai** không chạy backfill lặp/đổi
   dữ liệu (kiểm tính idempotent thật, không chỉ tin code).

Migration phải **idempotent** và bọc trong giao dịch theo [rules/08](../../rules/08-rules-database.md).
ALTER TABLE dùng đúng khuôn 2 pha đã có: cột đơn giản qua `PRAGMA table_info` + `ADD COLUMN` (nullable
trước, backfill, rebuild sau nếu cần ràng buộc cứng); bảng cần đổi unique/NOT NULL/CHECK
(`project_task_assignments`, `weekly_report_history`) phải **rebuild toàn bảng** theo đúng khuôn
`db-migrations.ts` đã dùng cho `project_tasks` trước đây, không chỉ `ADD COLUMN`.

**Q9 — không có đường quay lại desktop (quyết định 13/09, thay thế mọi giả định trước đó về rollback):**
sau khi di trú, **server là nguồn dữ liệu duy nhất** cho 6 chức năng đã chuyển — không có kế hoạch quay
lại desktop. Leader sẽ **dùng server một mình trong giai đoạn pilot** (chạy trên đúng hạ tầng public
thật, không phải bản tạm/local), làm cho đạt yêu cầu rồi mới mở cho người khác. Vì trong pilot chỉ có
Leader thao tác, không có rủi ro nhiều người cùng sửa trong lúc chuyển. Nếu server lỗi trong hoặc sau
pilot, hướng xử lý là **sửa/khôi phục trên chính server** (từ bản sao lưu FR-37), không dùng desktop làm
nguồn ghi thứ hai. Đây là hai quyết định tách bạch, không được gộp lại: (a) *quyết định sản phẩm* — server
là nguồn duy nhất, không rollback desktop; (b) *phương án kỹ thuật khi server tự nó hỏng* — khôi phục từ
backup, chấp nhận mất tối đa dữ liệu giữa lần backup gần nhất và lúc sự cố (đã nêu ở FR-37/AC-28).

**Bảng mới — thiết kế kỹ thuật chi tiết Lát 6, Release nhiều team.** Bản đầu chốt qua Council thật
`84473697` (19/09) dừng ở `semantic_gate_failed` (lỗi hành văn — sót từ tiếng Anh "canonical", không phải
lỗi thiết kế). Sau đó Leader tự mô tả lại chi tiết cách team điều phối vận hành thật (xem
[exchange 2026-09-19](../../exchanges/2026-09-19.md)), làm lộ ra **4 chỗ bản đầu hiểu sai** — đã hỏi lại
và Leader chốt trực tiếp cả 6 điểm, thay cho bản Council ban đầu. Thay bảng đơn-team
`emergency_release_batches` (cột `release_month` làm khoá, cột `teams` là mảng nhãn tự do) bằng các bảng
sau, giữ `emergency_release_batches` cũ **chỉ đọc làm lịch sử**, không tự map nhãn cũ sang `team_id` (đúng
tiền lệ di trú "giữ nguyên, báo cáo cho Leader" của Lát 4):

| Bảng | Nội dung chính |
|---|---|
| `release_cycles` | `id`, `release_key`, `kind` (`emergency`\|`regular`), `status` (`open`\|`closed`), **`locked_at`/`locked_by`** (nullable — chốt 19/09 lần 9, đánh dấu cấp cycle khi Leader điều phối bấm "Khoá lịch"; khác `team_release_registrations.status` là trạng thái sửa/không-sửa-được của TỪNG dòng, cột này chỉ để **chặn tạo đăng ký MỚI vào cycle đã khoá** — team chưa từng có mặt muốn tham gia đợt đã khoá phải qua đúng luồng yêu cầu mở khoá như các team đã có mặt, không có đường tắt tạo mới; null lại khi duyệt mở khoá, set lại khi khoá cưỡng bức lần nữa), `regular_release_date` (nullable, CHỈ dùng khi `kind='regular'` — đúng 1 "ngày chính" do **Leader team điều phối** ấn định; mọi mốc jack/develop/staging/demo tự tính từ đúng ngày này qua `tinhNgayRelease()` **đã có sẵn trong code**, không đổi logic đó), `row_version`, `created_at`/`created_by`. **Với `kind='emergency'`, không ai chủ động "mở đợt" trước** (chốt 19/09 lần 3) — cycle được **tự tìm-hoặc-tạo theo đúng ngày release** khi 1 team nộp đăng ký đầu tiên cho ngày đó (`release_key = 'emergency:YYYY-MM-DD'` của đúng ngày `release_at`); team thứ 2 đăng ký cùng ngày sẽ tự khớp vào đúng cycle đó qua `release_key`. Nhờ vậy 1 tháng tự nhiên có nhiều đợt (mỗi ngày release riêng là 1 đợt riêng), không cần Leader điều phối thao tác gì để "mở đợt". `status` của cycle chỉ dùng cho việc đóng sổ báo cáo. **Với `kind='regular'`, cho phép nhiều dòng `status='open'` cùng lúc** (chốt 19/09 lần 4 — Leader xác nhận Leader điều phối được đặt sẵn ngày cho kỳ sau trong khi kỳ hiện tại chưa xong): **không** có ràng buộc unique nào giới hạn chỉ 1 đợt định kỳ mở tại 1 thời điểm; tab cá nhân (FR-28a, định kỳ) khi có nhiều đợt đang mở phải cho người dùng **chọn đúng đợt** muốn đăng ký task (sắp theo `regular_release_date` gần nhất trước), không tự đoán 1 đợt duy nhất. **Cảnh báo kỹ thuật (Council thật `95a26ee6`, Codex phát hiện, 19/09 lần 12):** code định kỳ hiện tại (`server/routes/schedules.ts`) dùng **`release_month` (`YYYY-MM`) làm khoá nhóm task cá nhân định kỳ** — nếu 2 `release_cycles` `kind='regular'` cùng tháng dương lịch cùng mở (đã cho phép ở lần 4), task cá nhân sinh từ 2 đợt đó sẽ **tự nhận nhầm chung 1 nhóm** qua đúng khoá `release_month` này, đè/lẫn dữ liệu của nhau. Khi implement Lát 6 **bắt buộc đổi khoá nhóm task cá nhân định kỳ từ `release_month` sang gắn trực tiếp theo `cycle_id`** (mỗi cycle 1 nhóm task riêng, không gộp theo tháng dương lịch nữa) — đây là hệ quả kỹ thuật bắt buộc của quyết định "nhiều đợt định kỳ song song" đã chốt, chưa từng nêu rõ trước lần 12 này |
| `team_release_registrations` | **Chỉ áp dụng khi `kind='emergency'`** (CHECK/trigger chặn tạo dòng cho cycle `regular`). `id`, `cycle_id` (FK), `team_id` (FK), `deploy_staging_at`, `release_at` (2 mốc do team tự nhập), **`deploy_demo_at`** (**không cho nhập tay** — luôn tự tính = `DATE(release_at)` lúc 16:00, chốt 19/09 lần 3; lưu lại thành cột thật, không suy diễn lúc đọc, để ổn định lịch sử), `affected_systems` (checkbox Dr.JOY/Pr.JOY, allowlist có sẵn), **`platforms`** (checkbox Web/Mobile — cột mới, cùng kiểu allowlist với `affected_systems`), **`ticket_numbers`** (JSON mảng số nguyên dương, nhập dạng thẻ tag — sai số này có thể gây nhầm lẫn khi tra cứu/báo cáo, giao diện phải cảnh báo rõ), **`japan_coordination_link`** (nullable, URL) + **`no_japan_coordination_reason`** (nullable, text) — `CHECK` đúng một trong hai khác NULL, không được cả hai cùng NULL, **`notes`** (nullable, text thuần — UI xử lý Tab/Enter tự thêm số/thụt lề bằng JS, không phải rich-text/HTML), `status` (`submitted`\|`locked`\|`cancelled` — **không có `draft`**, chốt 19/09 lần 4: Leader xác nhận không cần bước nháp riêng, tạo là coi như nộp luôn, hiện cho team khác và tính vào so xung đột ngay), `registration_version_requested`, `row_version`, `created_by`/`updated_by`, `created_at`/`updated_at`; unique `(cycle_id, team_id)` |
| `release_schedule_conflicts` | `id`, `cycle_id`, `registration_a_id`, `registration_b_id` (`CHECK(registration_a_id < registration_b_id)`), `status` (`open`\|`resolved`\|`forced`), `detected_at`, `resolved_at`/`resolved_by`; partial unique `(registration_a_id, registration_b_id) WHERE status='open'`. **Quy tắc so xung đột, chốt 19/09 lần 3 — mô tả trực tiếp của Leader:** 2 đăng ký cùng `cycle_id` (tức cùng ngày `release_at`, xem `release_cycles`) bị coi là xung đột **khi và chỉ khi** khác nhau ở ít nhất một trong ba: giờ `release_at`, ngày `deploy_staging_at`, hoặc giờ `deploy_staging_at`. **Không** so `platforms`/`affected_systems`/`ticket_numbers`/`notes`/`japan_coordination_link` — 2 team trùng ngày nhưng hoàn toàn không liên quan (khác hệ thống, khác ticket) **vẫn không** bị coi là xung đột nếu giờ giấc khớp nhau; `deploy_demo_at` không cần so vì luôn tự bằng 16:00 cùng ngày `release_at` nên hai bên đương nhiên khớp khi cùng cycle. **Tự đóng (`resolved`), chốt 19/09 lần 8:** mọi lần 1 registration trong cycle được lưu (kể cả tự khoá lại sau sửa) phải chạy lại đúng quy tắc so xung đột này cho mọi cặp trong cycle — cặp nào hết lệch thì tự chuyển `resolved` ngay, không cần Leader điều phối xác nhận tay. `status='forced'` chỉ đặt khi Leader điều phối dùng đúng hành động "ép giờ chung" (xem FR-25) — ghi đè `deploy_staging_at`/`release_at` trực tiếp lên đăng ký của cả 2 (hoặc nhiều) team đang xung đột. **Huỷ 1 bên (chốt 19/09 lần 11):** `registration_a_id`/`registration_b_id` chuyển `cancelled` (FR-27) thì mọi xung đột `open` liên quan tự chuyển `resolved` ngay — không còn ai để xung đột với |
| `release_unlock_requests` (đơn giản hoá 19/09 lần 3, phạm vi khoá/mở tinh chỉnh lần 6) | `id`, `registration_id` (FK — bản ghi của đúng team đã gửi yêu cầu; định kỳ do coordinator tự sửa trực tiếp, không qua bảng này), `kind` (`edit`\|`cancel`), `reason` (text, bắt buộc), `registration_version_requested` (snapshot lúc gửi), `status` (`pending`\|`approved`\|`rejected`), `reviewed_by`/`reviewed_at`, `created_by`/`created_at`. **Luồng khoá/mở đầy đủ, mô tả trực tiếp của Leader:** "Khoá lịch" là 1 hành động **cấp cả cycle** (route riêng, không qua bảng này) — set `status='locked'` cho **mọi** `team_release_registrations` của cycle đó cùng lúc. Team gửi yêu cầu (`kind='edit'`) → Leader điều phối duyệt **1 yêu cầu** → set `status='submitted'` cho **mọi** registration của cả cycle đó (mở lại toàn bộ, không chỉ riêng team đã gửi). Team nào sửa xong bấm Lưu — giao diện bắt buộc **cảnh báo xác nhận** "Lưu xong sẽ khoá lại, bạn chắc chưa?" — xác nhận xong: **chỉ riêng dòng của đúng team đó** tự động chuyển `status` về `locked` lại ngay (các team khác vẫn `submitted` cho tới khi họ cũng tự lưu) **và gửi thông báo** (bảng `notifications`, FR-34) báo Leader điều phối. Leader điều phối vẫn dùng lại route "Khoá lịch" cấp cả cycle để khoá cưỡng bức nốt các dòng còn treo mở. `kind='cancel'` duyệt xong chuyển thẳng `status='cancelled'` **chỉ cho đúng registration đó**, không đụng team khác, không qua bước mở-sửa-khoá lại. **Nhiều yêu cầu `edit` cùng chờ duyệt cho cùng 1 cycle (chốt 19/09 lần 11):** duyệt 1 yêu cầu bất kỳ (đã mở toàn bộ cycle) thì **mọi yêu cầu `edit` khác đang `pending` của cùng cycle đó tự chuyển `approved`** (không phải `rejected` — mục đích của chúng đã đạt, không cần Leader điều phối duyệt lặp lại việc đã xong), kèm `reviewed_by`/`reviewed_at` ghi hệ thống tự động chứ không phải người duyệt gốc. Mọi bước (khoá cả cycle / gửi yêu cầu / duyệt mở cả cycle / tự khoá lại từng dòng sau lưu / khoá cưỡng bức / tự đóng yêu cầu trùng) vào `audit_log` (FR-19) |

**Bỏ hẳn `release_operational_checklist_items` khỏi thiết kế** (bảng này có ở bản Council đầu cho "checklist
vận hành riêng của team điều phối") — Leader xác nhận trực tiếp **không có cơ chế nào tách riêng cho vai
trò điều phối**: Leader team điều phối muốn sinh task cho chính mình thì dùng **đúng tab cá nhân** như mọi
Member khác (xem FR-23c/FR-28a bên dưới), không có bảng/luồng riêng. FR-28 (bản 13/09, "checklist của đợt
thuộc về team điều phối") coi như **đã gộp hoàn toàn vào FR-28a**, không còn là mục riêng.

**Bỏ hẳn `release_announcements`/`release_announcement_revisions` khỏi thiết kế** (chốt 19/09 lần 5) —
Leader xác nhận trực tiếp không cần tính năng "bài thông báo song ngữ gộp nhiều team" (FR-29, đã bỏ), mỗi
team tự lo báo bên Nhật theo cách riêng qua `japan_coordination_link` đã đăng ký; xem thu hẹp phạm vi
tương ứng ở FR-30 (chỉ còn về đúng lỗi timezone thật trong hàm render template cá nhân khẩn cấp).

**Bỏ hẳn `personal_release_checklists`** (bảng tôi tự tạo ở Lát 3/4, commit `70b63697`) — Leader xác nhận
mỗi người tự có **template + định nghĩa task của riêng mình** (không dùng chung), và đây chính xác là vai
trò của 4 bảng **đã có sẵn trong code thật**: `release_templates`, `release_task_definitions`,
`emergency_release_templates`, `emergency_release_task_definitions` — chỉ cần thêm cột sở hữu. Giữ cả
`personal_release_checklists` lẫn 4 bảng thật sẽ tạo 2 nguồn định nghĩa task cá nhân cho cùng một việc, dễ
lệch dữ liệu; bỏ bảng tự tạo, sửa 4 bảng thật là lựa chọn Leader đã chọn (không phải Claude tự quyết).

**Sửa 4 bảng release đã có (ALTER, thay cho phần "row_version khi Lát 6 sửa chúng" nói chung ở Lát 4):**
mỗi bảng trong `release_templates`, `release_task_definitions`, `emergency_release_templates`,
`emergency_release_task_definitions` thêm `owner_user_id` (FK `users.id`, **NOT NULL sau di trú** — mỗi
định nghĩa/template thuộc đúng 1 User, không chia sẻ), `row_version`, `created_at`/`updated_at`,
`created_by`/`updated_by`. Di trú: gán `owner_user_id = leaderUserId` (Leader Dev13 hiện tại) cho toàn bộ
dữ liệu cũ — **không tự nhân bản** cho user khác, mỗi User mới tự tạo bộ của mình từ đầu nếu muốn dùng tab
cá nhân (đúng nguyên tắc "cá nhân, không chia sẻ" Leader vừa xác nhận).

API lịch chung (FR-24) chỉ trả ngày/giờ/hệ thống/phạm vi cho team khác, không trả ticket/lý do mở khoá/nội
dung nội bộ — đúng nguyên tắc lọc field ở tầng backend đã dùng từ Lát 3.

**4 điểm phát hiện qua Council thật `95a26ee6` — Leader đã chốt trực tiếp cả 4, 19/09 lần 13:**

- **Đổi ngày release (sau mở khoá) → registration tự chuyển sang cycle của ngày mới** (tìm-hoặc-tạo như
  lúc đăng ký lần đầu qua đúng `release_key`) — cycle cũ rỗng giữ làm lịch sử, ghi audit rõ lý do chuyển.
  Đã thêm vào FR-26.
- **Registration bị huỷ (FR-27) → chỉ huỷ task cá nhân chưa hoàn thành và chưa qua ngày**, giữ nguyên
  lịch sử cho việc đã xong (không viết lại quá khứ). Đã thêm vào FR-26/FR-27.
- **Leader điều phối KHÔNG bị chặn bấm "Khoá lịch" khi đợt còn xung đột `open` chưa xử lý** — khoá tuỳ ý,
  xung đột vẫn hiển thị để xử lý sau qua ép giờ chung. Đã thêm vào FR-25/FR-26.
- **"Ép giờ chung" tác dụng được ngay cả khi registration đang `locked`** — không cần mở khoá trước. Đã
  thêm vào FR-25.

### 6.4. Automation / tích hợp

- **MCP server bị gỡ bỏ** khỏi bản server (FR-38). Bản desktop còn lại (chỉ Luyện đề) không cần MCP.
- **Không còn automation AI** (đã xoá ở CR-20260912) — không có hành động AI ghi ra ngoài trong phạm vi
  CR này.
- **Redmine** là tích hợp ngoài duy nhất còn lại: URL hệ thống do Admin cấu hình (FR-33), khoá theo từng
  người; giữ nguyên cách mã hoá hiện tại nhưng khoá mã hoá chuyển sang **nhận từ biến môi trường** thay vì
  file cạnh DB. Mọi lời gọi phải qua lớp chống SSRF/redirect/DNS-rebinding của FR-44 — quyền Admin cấu
  hình được URL không miễn trừ yêu cầu này.
- **Render nội dung template cá nhân khẩn cấp** (FR-30, đã thu hẹp) là logic thuần trong app, không gọi
  ra ngoài; việc báo bên Nhật vẫn do từng team tự thực hiện thủ công (FR-29 đã bỏ).

## 7. Phân tích tác động

- ✅ Frontend (toàn bộ màn) · ✅ API route (toàn bộ) · ✅ DB/migration · ⬜ Automation/MCP *(gỡ bỏ, không sửa)*
- ✅ i18n (chuỗi mới cho phân quyền, thông báo, xung đột lịch) · ✅ Đóng gói (SEA → container) · ✅ Bảo mật · ✅ Dữ liệu cũ/backward-compat

**Rủi ro & giảm thiểu:**

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| **CI/CD deploy xoá sạch dữ liệu** vì file SQLite nằm trong container | Nghiêm trọng | FR-36 bắt buộc ổ lưu trữ bền; ghi thành yêu cầu số 1 gửi đội hạ tầng; kiểm bằng một lần deploy thử có dữ liệu mẫu trước khi di trú thật |
| **Nhiều bản chạy song song** làm hỏng file SQLite | Nghiêm trọng | FR-35 ghi rõ một bản; yêu cầu hạ tầng không bật autoscaling |
| Di trú làm **mất hoặc gán sai dữ liệu** của Dev13 | Nghiêm trọng | Sao lưu + mã kiểm trước khi chạy; kiểm đếm đối chiếu từng bảng; **không đoán** ánh xạ PIC → tài khoản |
| **Phân quyền chỉ ẩn ở giao diện**, backend vẫn cho qua | Cao | §6.2 đặt phân quyền thành tầng trước route; fail-closed; test cho từng cặp `(vai trò, endpoint)` |
| **Mở ra Internet công khai** trong khi chuẩn bảo mật vẫn giả định chạy local | Cao | §5 + §11: cập nhật `security-standard` và skill `security-gate` trong cùng lần giao |
| **Nội dung template khẩn cấp tiếng Nhật sai giờ** sau khi chuyển sang giờ động | Cao | FR-30 có ví dụ chuẩn 15:00 VN ⇒ 17:00 JST; test riêng cho chuyển múi giờ, kể cả ca qua nửa đêm |
| Sửa trùng lúc gây **mất việc âm thầm** | Trung bình | FR-18/FR-46 optimistic concurrency, trả `409` thay vì ghi đè |
| **Dev13 không đăng ký được release của chính mình** do một team một vai | Trung bình | Đã ghi nhận, chấp nhận trước mắt; mở lại khi phát sinh nhu cầu thật |
| CR quá lớn, làm một mạch dễ hỏng | Trung bình | §10 chia 6 lát có thứ tự, mỗi lát tự chạy được và kiểm chứng được |
| **Backend hiện tại xuất phát từ con số 0 tuyệt đối** trên mọi trục Council được giao — không middleware xác thực/CSRF/rate-limit nào, `body limit` 32MB áp toàn cục, `cors` chỉ localhost, tiến trình sống tiếp sau `uncaughtException`, không dependency nào cho OIDC/session/rate-limit có trong `package.json` (xác nhận bằng đọc trực tiếp `app.ts`/`index.ts`/`db.ts`, Council `38c458f1`) | Cao | Không đánh giá thấp lát 2-3 thành "thêm vài middleware"; toàn bộ FR-40..49 là xây mới, không phải chỉnh cấu hình có sẵn |
| **`DatabaseSync` là API đồng bộ, chặn event loop** — một câu lệnh SQL nặng (vd chốt tuần ghi đè nhiều task, kéo Gantt cả project) có thể làm **mọi user khác** bị đứng hình trong lúc đó, không chỉ ảnh hưởng riêng người đang thao tác | Cao | FR-45 tách đo SQL execution / queue wait riêng; bảng kích hoạt ở §5 quy định rõ khi nào chuyển DB access sang worker thread — quyết định dựa trên đo thật, không đoán trước |
| **Nhầm lẫn phạm vi trách nhiệm mạng** — CR/Council tự nhận backend chống được DDoS/tấn công băng thông | Cao nếu xảy ra | §5 ghi rõ: WAF/CDN/firewall/DDoS-protection là trách nhiệm Infra, App chỉ công bố hợp đồng proxy tối thiểu (FR-44 khác — đây là ranh giới trách nhiệm, không phải yêu cầu kỹ thuật) |

**Ảnh hưởng chức năng đang chạy:** toàn bộ 7 chức năng đều bị chạm ở mức phân quyền; **Báo cáo tuần** và
**Release** bị đổi cả luồng nghiệp vụ; **Luyện đề** bị tách hẳn khỏi bản server; **Cài đặt** đổi mô hình
Redmine; **Mind Map** thêm khái niệm riêng tư/chia sẻ. Bản desktop sau khi cắt chuyển **chỉ còn Luyện đề**.

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1, FR-4):** Given người chưa đăng nhập / When mở bất kỳ đường dẫn nghiệp vụ nào / Then bị
  chuyển sang hệ xác thực công ty và mọi lời gọi API trả `401`, không lộ dữ liệu.
- **AC-2 (FR-2, FR-3):** Given người dùng mới đăng nhập lần đầu (không khớp email Admin) / When chọn
  team và vai trò mong muốn / Then tài khoản ở trạng thái `pending`, **mọi API nghiệp vụ vẫn từ chối**,
  Admin nhận thông báo yêu cầu tham gia; When Admin duyệt (có hoặc không sửa team/vai trò) / Then tài
  khoản chuyển `active`, quyền có hiệu lực, và lần mở app kế tiếp bắt buộc hiện popup thông báo team/vai
  trò đã cấp trước khi vào được màn khác.
- **AC-2a (FR-1a):** Given hai callback OIDC gần như đồng thời cùng khớp email Admin cấu hình / When cả
  hai cùng cố bind / Then chỉ đúng một tài khoản Admin được tạo, callback còn lại thất bại có kiểm soát
  và được ghi nhật ký — không tạo ra hai Admin hoặc bind nhầm danh tính.
- **AC-2b (FR-3a):** Given Admin từ chối một yêu cầu tham gia / When người đó đăng nhập lại lần sau /
  Then quay lại đúng màn "Chọn team và vai trò" như lần đầu, không bị kẹt ở trạng thái từ chối vĩnh viễn.
- **AC-3 (FR-4):** Given phiên đã quá 1 tuần / When gọi API / Then trả `401` và buộc đăng nhập lại.
- ~~**AC-4 (FR-5):** cảnh báo đăng nhập lạ~~ — **bỏ 13/09 cùng FR-5** (xem Nhóm A). Giữ số AC-4 trống, không
  tái sử dụng, để các tham chiếu AC-số khác trong tài liệu không bị lệch.
- **AC-5 (FR-6, FR-13):** Given người dùng là Leader ở team A và Member ở team B / When chuyển bộ chọn
  team sang B / Then mọi quyền áp theo vai trò Member, các thao tác Leader bị chặn ở backend.
- **AC-6 (FR-7):** Given Admin đặt ô `(team B, Project)` = `Tắt` / When Member team B gọi API Project /
  Then trả `403` và tab không hiện; đổi sang `Bật` thì thấy tab và thao tác theo đúng bảng năng lực tầng
  3 (FR-8) cho vai của mình.
- **AC-7 (FR-8):** Given Member được gán phụ trách task X và không phụ trách task Y / When sửa X thì
  thành công; When sửa Y thì trả `403`.
- **AC-8 (FR-8):** Given Member / When gọi các đường chỉ dành cho Leader (tạo/xoá project, xoá task
  project, đổi thứ tự thực thi Gantt, chốt tuần, xoá toàn bộ mục tiêu tuần) / Then tất cả trả `403`.
- **AC-9 (FR-11):** Given Admin không thuộc team B / When gọi bất kỳ API dữ liệu nghiệp vụ nào của team B
  / Then trả `403`, kể cả đường chỉ đọc.
- **AC-10 (FR-12):** Given Leader team A / When thêm một người **chưa từng đăng nhập** / Then bị từ chối
  với thông báo rõ; When thêm người đã từng đăng nhập / Then thành công và vào nhật ký.
- **AC-10a (FR-12a):** Given một Member đang có 3 task chưa hoàn thành / When Leader mở thao tác bớt
  người đó khỏi team / Then màn hiện rõ "còn 3 task chưa hoàn thành" trước khi Leader xác nhận; Leader
  vẫn bớt được sau khi xác nhận (không bị chặn cứng).
- **AC-11 (FR-14):** Given người dùng thuộc team A (Task cá nhân `Tắt`) và team B (Task cá nhân `Bật`) /
  When mở app / Then vẫn thấy Task cá nhân, và danh sách không đổi khi chuyển bộ chọn team.
- **AC-12 (FR-16, FR-17):** Given task có ba người phụ trách với khoảng thời gian chồng lấn / When mỗi
  người sửa phần của mình / Then chỉ phần của người đó đổi; When một người sửa khoảng của người khác /
  Then `403`; Gantt vẽ ba thanh riêng đúng màu.
- **AC-13 (FR-16):** Given task nhiều người phụ trách / When một người đổi `% tiến độ` / Then con số chung
  của task đổi, không sinh % riêng theo người.
- **AC-14 (FR-18):** Given hai người cùng mở một task / When người thứ hai lưu sau / Then nhận `409` với
  thông điệp yêu cầu tải lại, và **dữ liệu của người thứ nhất không bị ghi đè**.
- **AC-15 (FR-19):** Given thực hiện từng thao tác trong danh sách quan trọng / When hoàn tất / Then mỗi
  thao tác sinh đúng một bản ghi nhật ký có người thực hiện, thời điểm và đối tượng.
- **AC-16 (FR-20):** Given bản sao DB thật của Dev13 / When chạy di trú / Then số bản ghi từng bảng khớp
  trước–sau, nhãn PIC cũ còn nguyên trên mọi task, **không bảng `de_thi_*` nào tồn tại trên server**, và
  chạy di trú lần thứ hai không đổi gì thêm.
- **AC-17 (FR-21):** Given Member / When gọi API chốt tuần (wizard "Xác nhận & lưu") hoặc xoá toàn bộ mục
  tiêu tuần / Then cả hai đều `403`; Member không có API "tự đặt mục tiêu" nào để gọi (đã bỏ theo đính
  chính của Leader).
- **AC-17a (FR-21a):** Given một mục tiêu tuần có nhiều task / When bất kỳ ai trong team mở màn báo cáo
  tuần / Then thấy đúng danh sách task (tên, người phụ trách, %, project) làm nội dung chính; khối chữ
  tổng hợp kiểu cũ vẫn có mặt để copy nhưng không phải phần đầu tiên hiển thị.
- **AC-18 (FR-22):** Given hai team có danh sách loại báo cáo khác nhau / When mỗi Leader mở màn báo cáo /
  Then thấy đúng danh sách của team mình, không còn chuỗi "Nội bộ Dev13" ghi cứng trong code.
- **AC-19 (FR-23, SỬA 19/09 lần 2 — viết lại vì template/định nghĩa giờ là của riêng từng người, không
  còn là đặc quyền team điều phối):** Given User X / When gọi API sửa template/định nghĩa task release
  thuộc `owner_user_id` của **User khác** (Y) / Then `403`, bất kể X là Member, Leader team thường hay
  Leader team điều phối — quyền chỉ theo sở hữu (`owner_user_id`), không theo vai trò team. Given User X
  gọi đúng template/định nghĩa của chính mình / Then thành công. Given Leader team điều phối / When gọi
  API ấn định "1 ngày chính" cho release định kỳ (FR-23b) / Then thành công; When Leader team thường gọi
  cùng API đó / Then `403`.
- **AC-19a (FR-28a, SỬA 19/09 lần 2 — gộp FR-28, thêm ràng buộc khớp lịch chính thức khẩn cấp):** Given
  Admin bật "checklist cá nhân khi release" cho team A, và Task cá nhân đang `Tắt` cho team A / When một
  Member/Leader team A bấm "Áp dụng checklist của tôi" cho một đợt release đang có / Then **không** có
  task nào được sinh, giao diện giải thích rõ lý do (Task cá nhân đang tắt). Given Task cá nhân sau đó
  chuyển `Bật` / When người đó tự bấm áp dụng lại cho đợt tiếp theo / Then task tự sinh đúng theo định
  nghĩa cá nhân của riêng họ — **không** tự sinh chỉ vì Leader vừa đăng ký lịch của team. **Riêng khẩn
  cấp:** Given team A đã đăng ký lịch chính thức (`deploy_staging_at`/`release_at`/`deploy_demo_at`) /
  When một thành viên team A áp dụng checklist khẩn cấp cá nhân / Then hệ thống tự lấy đúng 3 mốc giờ từ
  lịch chính thức của team, **không nhận** 3 mốc do người dùng tự nhập khác với lịch đó.
- **AC-20 (FR-25, SỬA 19/09 lần 3 — quy tắc so xung đột cụ thể):** Given team A đăng ký release ngày 5/10
  15:00 (stg 3/10 09:00), team B đăng ký release **cùng ngày 5/10** nhưng **09:30** (khác giờ release) /
  When nộp / Then cả hai tự khớp chung 1 `cycle_id` (theo đúng ngày release) và hệ thống đánh dấu xung đột,
  báo cả ba Leader (điều phối + hai team). Given team A và team C cùng ngày 5/10, **cùng giờ release, cùng
  giờ/ngày stg**, nhưng khác hệ thống ảnh hưởng và khác ticket / Then **không** đánh dấu xung đột — hệ
  thống/ticket/nền tảng/ghi chú/link Nhật không tham gia việc so xung đột. Given hai team cùng đăng ký cho
  **đợt định kỳ** / Then không áp dụng AC này.
- **AC-21 (FR-26, SỬA 19/09 lần 3+6 — khoá toàn trường, khoá/mở cấp cả cycle, tự khoá lại riêng theo từng
  team khi lưu):** Given đợt X có team A và team B cùng khẩn cấp / When Leader điều phối bấm "Khoá lịch" /
  Then **cả** đăng ký của team A lẫn team B chuyển `locked`; When team A tự sửa bất kỳ trường nào (kể cả
  ticket/ghi chú, không riêng ngày giờ) / Then `403`. When team A gửi yêu cầu mở khoá (`kind='edit'`) và
  Leader điều phối duyệt / Then **cả team A lẫn team B** chuyển về `submitted` (mở lại toàn bộ, không chỉ
  riêng team A); When team A sửa xong và bấm Lưu / Then giao diện hiện cảnh báo xác nhận trước, xác nhận
  xong **chỉ riêng đăng ký của team A** tự động khoá lại (`status` về `locked`) và gửi thông báo cho Leader
  điều phối, **đăng ký của team B vẫn `submitted`** (chưa lưu) cho tới khi team B cũng tự lưu hoặc Leader
  điều phối bấm "Khoá lịch" lần nữa để khoá cưỡng bức; toàn bộ các bước vào nhật ký. Release định kỳ không
  có khái niệm khoá/mở khoá.
- **AC-22 (FR-27, SỬA 19/09 lần 3 — tách `kind='cancel'` khỏi luồng sửa):** Given team A có đợt release
  khẩn cấp **chưa khoá** / When Leader team A huỷ đợt của chính họ / Then thành công (`status='cancelled'`
  trực tiếp); When Leader team A huỷ đợt của team B / Then `403`. Given đợt đó **đã khoá** / When Leader
  team A gọi huỷ trực tiếp / Then `403`; When Leader team A gửi yêu cầu `kind='cancel'` và Leader điều phối
  duyệt / Then chuyển thẳng `status='cancelled'` (không qua bước mở-sửa-khoá lại của `kind='edit'`) và vào
  nhật ký.
- **AC-21a (FR-26, mới 19/09 lần 13 — bù traceability FR↔AC còn thiếu, phát hiện qua Council `812796b0`):**
  Given team A có task cá nhân **chưa hoàn thành** và task cá nhân **đã hoàn thành từ tuần trước**, cùng
  sinh từ đợt X / When team A huỷ đợt X (`status='cancelled'`) / Then task chưa hoàn thành tự huỷ theo,
  task đã hoàn thành **giữ nguyên không đổi**. Given team A đăng ký release ngày 5/10 rồi được mở khoá sửa
  sang ngày 6/10 / When lưu / Then registration **tự chuyển sang `cycle_id` của ngày 6/10** (cycle ngày
  5/10 nếu rỗng vẫn còn, không bị xoá). Given đợt Y đã bị Leader điều phối khoá / When team C (chưa từng
  đăng ký trong đợt Y) gọi `POST` tạo đăng ký mới cho đúng ngày của đợt Y / Then `403`, phải đi qua đúng
  luồng yêu cầu mở khoá như các team đã có mặt.
- **AC-23 (FR-30, SỬA 19/09 lần 5 — bỏ FR-29, AC chỉ còn kiểm đúng lỗi timezone thật):** Given template cá
  nhân khẩn cấp có nội dung tiếng Nhật tham chiếu `{{release.deployAt}}`, team đăng ký release `15:00` giờ
  VN / When render nội dung cho task tự sinh / Then hiển thị đúng `17:00` (dùng `vietnamInstant()`, không
  `addMinutes(date,120)`), và không còn chuỗi giờ ghi cứng trong mẫu.
- **AC-24 (FR-31, SỬA 19/09 lần 16 — mở rộng đủ chủ thể + ca UPDATE hàng loạt):** Given Leader team A /
  When gọi API task cá nhân của một Member / Then `403`. Given Admin / When gọi API xem/sửa task cá nhân
  của bất kỳ User nào khác chính họ / Then `403` (không có ngoại lệ hỗ trợ/sự cố). Given User A và User B
  cùng có 1 task định kỳ **trùng tên và trùng hình dạng lịch lặp** (vd cùng tên "Họp team hàng tuần", cùng
  `lapLaiKieu`/`ngayTrongThang`/`thuTrongTuan`) / When User A gọi `PATCH /tasks/:id` với `updateRelated=true`
  để sửa hàng loạt task của mình / Then **chỉ** task của User A bị đổi, task của User B **không đổi gì**.
- **AC-25 (FR-32):** Given Mind Map đặt `riêng tư` / When người khác cùng team mở / Then `403`; đổi sang
  `chia sẻ` / Then đọc được **nhưng gọi API sửa/lưu thì vẫn `403`** — kể cả khi đang chia sẻ, chỉ đúng
  người tạo mới ghi được. Không có ca test "hai người cùng sửa một Mind Map" vì kịch bản đó không tồn tại.
- **AC-26 (FR-33):** Given hai người nhập hai khoá Redmine khác nhau / When mỗi người tra cứu / Then kết
  quả theo đúng quyền của khoá người đó, và không ai đọc được khoá của người kia qua bất kỳ API nào.
- **AC-27 (FR-34):** Given có thông báo chưa đọc / When mở app / Then thấy danh sách thông báo; When đánh
  dấu đã đọc / Then trạng thái bền qua tải lại trang.
- **AC-28 (FR-36, FR-37):** Given container bị xoá và deploy lại / When mở app / Then toàn bộ dữ liệu còn
  nguyên; và bản sao lưu hằng ngày có mặt, **chứa cả file đính kèm Mind Map**, khôi phục được ra bản chạy được.
- **AC-29 (FR-38):** Given bản server / When tìm đường ghi không qua xác thực / Then không còn MCP server
  và không endpoint nghiệp vụ nào bỏ qua lớp phiên.
- **AC-30 (FR-11a):** Given một thao tác quan trọng xảy ra trong team A / When Admin xem nhật ký / Then
  chỉ thấy metadata (ai, hành động, team, thời điểm), không thấy nội dung nghiệp vụ; When Leader team A
  xem / Then thấy đầy đủ chi tiết; When Leader team B xem / Then không thấy dòng nào của team A.
- **AC-31 (FR-24, SỬA 19/09 — mở rộng người xem từ chỉ-Leader sang cả Member):** Given lịch release chung
  có ticket/ghi chú nội bộ của team A, và Release đang `Bật` cho team B / When Member **hoặc** Leader
  team B mở màn lịch chung / Then cả hai đều thấy ngày giờ + hệ thống ảnh hưởng + phạm vi ảnh hưởng của
  team A, nhưng **không** thấy ticket hay ghi chú nội bộ của team A; Member team B không thấy nút đăng
  ký/sửa lịch (đó vẫn là quyền riêng của Leader team B).
- **AC-32 (FR-16 Q7):** Given task có 2 người phụ trách / When Member thêm chính mình vào task / Then
  thành công; When Member cố thêm người khác / Then `403`; When Member tự rút mình ra / Then thành công;
  When Member cố bớt người khác / Then `403`; When Leader thêm/bớt bất kỳ ai / Then thành công.
- **AC-33 (FR-33):** Given Member / When gọi API sửa URL Redmine hệ thống / Then `403`; When Admin sửa /
  Then thành công và áp dụng cho mọi lời gọi Redmine tiếp theo của mọi người.
- **AC-34 (FR-41):** Given một route mới được thêm vào router mà thiếu bất kỳ trong 11 trường inventory /
  When chạy `npm run check` (hoặc bước CI tương ứng) / Then thất bại rõ ràng, nêu đúng route và trường
  còn thiếu — không merge được cho tới khi bổ sung.
- **AC-35 (FR-39):** Given DB bị mất quyền ghi, hoặc volume đầy, hoặc migration lỗi, hoặc tiến trình đang
  shutdown / When gọi `/health/ready` / Then trả false ngay; `/health/live` vẫn phản ánh đúng process còn
  sống hay không, không phụ thuộc DB.

**Bổ sung sau Council `1a86deaf` (vòng 2, hội tụ) — 8 mã FR trước đó chưa có AC riêng, nay có:**

- **AC-36 (FR-4a):** Given tài khoản bị `disabled` hoặc phiên bị revoke / When request kế tiếp của chính
  phiên đó gọi bất kỳ API nghiệp vụ nào / Then bị chặn ngay lập tức, không có độ trễ cache nào cho phép
  request đó lọt qua.
- **AC-37 (FR-9):** Given Admin đổi cấu hình "team điều phối release" từ Dev13 sang một team khác / When
  Leader team mới gọi API cấu hình release (template/định nghĩa task) / Then thành công; When Leader
  Dev13 (đã mất vai) gọi cùng API / Then `403`.
- **AC-37a (FR-9a):** Given team điều phối release vừa mất Leader hiệu lực theo **ca (a)** (Leader bị bớt
  khỏi team) / When request kế tiếp bất kỳ / Then Admin nhận được thông báo (kênh FR-34) nêu rõ tên team
  và hậu quả (thao tác khoá/duyệt lịch của mọi team đang treo). Given thay vào đó là **ca (b)** (Leader
  vẫn còn trong team nhưng tài khoản chuyển `disabled`) / When request kế tiếp bất kỳ / Then Admin cũng
  nhận đúng thông báo tương đương — **không phân biệt theo cách nào dẫn tới mất Leader hiệu lực**. Cả hai
  ca: API đăng ký/sửa lịch của team phát triển khác **vẫn hoạt động bình thường** (không bị chặn theo
  tình trạng của team điều phối).
- **AC-38 (FR-10):** Given Admin sửa bất kỳ khu nào trong màn quản trị (Teams & Leader, bảng hiển thị,
  vai đặc biệt) / When lưu / Then thay đổi có hiệu lực ngay cho request kế tiếp, không cần deploy lại.
- **AC-39 (FR-15):** Given task cũ có tên PIC dạng chuỗi tự do / When di trú xong / Then task hiển thị
  đúng nhãn cũ ở chế độ chỉ đọc, **không có gợi ý/tự động gán** vào bất kỳ tài khoản nào.
- **AC-40 (FR-32a):** Given file `.docm` (có macro) / When tải lên Mind Map trước khi danh sách mở rộng
  cho macro / Then bị từ chối; ảnh và PDF hợp lệ vẫn tải được.
- **AC-41 (FR-35):** Given cố tình deploy chồng (hai tiến trình app cùng khởi động gần như đồng thời) /
  When cả hai cố giữ instance lock / Then chỉ đúng một tiến trình đạt `/health/ready`, tiến trình còn lại
  không phục vụ traffic.
- **AC-42 (FR-40):** Given một route được thêm vào router mà không khai báo `(resource, action)` / When
  app khởi động hoặc route đó được gọi / Then bị chặn ở mức khởi động/CI hoặc trả `403` mặc định — không
  bao giờ mặc định cho qua.
- **AC-43 (FR-46):** Given một bảng chỉ một người ghi được (Mind Map — cả riêng tư lẫn chia sẻ, vì chỉ
  người tạo mới sửa; khoá Redmine cá nhân) / When kiểm tra migration/schema / Then bảng đó **không có**
  cột `row_version` — xác nhận phạm vi optimistic concurrency đúng như chốt (không rải thừa vào dữ liệu
  không thể xung đột).
- **AC-44 (FR-7a, mới 19/09):** Given team A có Project `Tắt` / When Admin cố Bật Báo cáo tuần cho team A
  / Then bị chặn, thông báo rõ phải Bật Project trước. Given team A có Project `Bật` và Báo cáo tuần
  `Bật` / When Admin tắt Project của team A / Then cả hai chuyển `Tắt` trong cùng một giao dịch, và Admin
  nhận cảnh báo nêu rõ Báo cáo tuần bị tắt theo. Given team A sau đó Bật lại Project / When Admin xem lại
  cấu hình team A / Then Báo cáo tuần **vẫn `Tắt`** — không tự bật lại.

**AC âm bắt buộc (nhóm — mỗi ý là ít nhất một test riêng, theo yêu cầu của Council):** SQL/identifier
injection ở mọi trường nhận input; field lạ trong body bị từ chối, body vượt giới hạn bị từ chối; XSS qua
mọi HTML sink đã kiểm kê, URL scheme nguy hiểm bị chặn bởi CSP; đọc/sửa/xoá/tải file **chéo team** đều
`403` cho mọi resource loại `detail`/`update`/`delete`/`download`; sửa trường chỉ-Leader-được-phép bởi
Member đều `403`; request ghi thiếu Origin hoặc thiếu/sai CSRF token đều bị chặn; phiên bị revoke hoặc
tài khoản bị đổi role/team giữa lúc đang có request khác chạy phải mất quyền **ngay ở request kế tiếp**;
Redmine trả redirect hoặc DNS đổi giữa lúc kiểm tra/kết nối (rebinding) đều bị chặn; file upload dạng
traversal, OOXML giả mạo, ZIP64 dị dạng, compression bomb đều bị từ chối trước khi ghi bản ghi attachment;
secret (cookie phiên, CSRF token, mã/token OIDC, khoá Redmine) không xuất hiện trong bất kỳ log/error nào
kể cả khi cố tình gài một canary secret vào payload; hàng đợi ghi SQLite bị bão hoà trả `429`/`503` có
kiểm soát, không treo vô hạn; tiến trình gặp exception không lường trước thoát có kiểm soát và không phục
vụ tiếp ở trạng thái hỏng, kể cả khi đĩa đầy hoặc bị kill giữa lúc ghi.

**Nhãn con truy vết cho 7 mã FR còn lại (Council yêu cầu: phủ toàn bộ hợp đồng, không chỉ ca âm):**

| FR | Bằng chứng test bắt buộc (ca thuận + ca âm) |
|---|---|
| `FR-42` | Ca thuận: request trong hạn mức đi qua bình thường, phân trang trả đúng cursor. Ca âm: đã có ở khối AC âm (body/rate/queue) |
| `FR-43` | Ca thuận: upload ảnh/PDF hợp lệ tạo đúng bản ghi attachment. Ca âm: đã có ở khối AC âm (traversal/OOXML/ZIP) |
| `FR-44` | Ca thuận: gọi Redmine hợp lệ trả đúng dữ liệu trong timeout. Ca âm: đã có ở khối AC âm (SSRF/redirect/rebinding) |
| `FR-45` | Ca thuận: nhiều ghi liên tiếp đều thành công qua hàng đợi, không mất thao tác nào. Ca âm: đã có ở khối AC âm (queue saturation) |
| `FR-47` | Ca thuận: shutdown chủ động (không phải crash) hoàn tất thao tác đang chạy trong hạn rồi thoát sạch. Ca âm: đã có ở khối AC âm (crash/disk-full) |
| `FR-48` | Ca thuận: log **có đủ** các trường bắt buộc (`request_id`, `actor_id`, hành động, trạng thái, độ trễ) để điều tra được. Ca âm: đã có ở khối AC âm (không rò secret) |
| `FR-49` | Ca thuận: build chứng minh chạy **non-root** và filesystem container **chỉ đọc** trừ đúng thư mục volume. Ca âm: CI thất bại khi lockfile có dependency dính lỗ hổng nghiêm trọng đã biết |

## 9. Kế hoạch test (tham chiếu [qa-standard](../../standards/qa-standard.md))

- Tầng test dự kiến: ✅ Unit ✅ Integration route ✅ Render component ✅ Smoke thủ công
- **Ma trận phân quyền là trọng tâm:** sinh test theo tích `(vai trò × chức năng × hành động)` cho lớp
  3–4 ở §6.2. Mọi endpoint phải có ít nhất một ca **bị chặn** và một ca **được phép** — ca bị chặn quan
  trọng hơn, vì lỗi phân quyền là lỗi im lặng.
- **Di trú:** chạy trên **bản sao DB thật**, kiểm đếm từng bảng, chạy hai lần để chứng minh idempotent,
  và thử khôi phục từ bản sao lưu.
- **Chuyển múi giờ (FR-30):** unit test cho chuyển VN→JST, gồm ca qua nửa đêm và ca ngày cuối tháng.
- **Chống sửa trùng (FR-18):** integration test hai phiên song song trên cùng bản ghi.
- **Ca lỗi/biên bắt buộc:** phiên hết hạn giữa chừng; người dùng bị bớt khỏi team khi đang mở màn của
  team đó; Leader bị đổi khi đang thao tác; team điều phối bị đổi sang team khác; ô hiển thị bị Admin
  chuyển từ `Bật` sang `Tắt` trong lúc người dùng đang mở form (kể cả ca Project bị tắt kéo theo Báo cáo
  tuần tắt theo — FR-7a — trong lúc người dùng đang mở màn Báo cáo tuần).
- **Smoke thủ công:** chạy đủ một vòng release khẩn cấp hai team từ đăng ký → xung đột → khoá → sinh bài
  hai ngôn ngữ, trên môi trường thật sau khi deploy.
- **Route inventory là cổng CI** (FR-41): test tự sinh từ inventory, không viết tay từng route; fail nếu
  route mới thiếu bất kỳ trong 11 trường.
- **Benchmark hiệu năng — bắt buộc trước khi coi DoR xong, KHÔNG được bỏ qua:** chạy 8 lớp workload (§5)
  trên **bản sao dữ liệu Dev13 đã di trú thật** (không phải dữ liệu giả định), qua cấu hình container +
  volume gần production. Mỗi lần đo ghi lại commit, phiên bản Node, giới hạn CPU/RAM, loại volume, kích
  thước DB/WAL, số dòng, index, kích thước attachment, cấu hình limiter, thời gian warm-up — để so sánh
  được giữa các lần đo. Đo riêng SQL execution và write-queue wait (không gộp vào latency đầu-cuối, nếu
  không sẽ không biết cần tối ưu query, hàng đợi hay mạng). Các ngưỡng trong §5 là **initial engineering
  threshold**, chỉnh lại bằng số đo, không bao giờ hạ để đạt biểu đồ đẹp.
- **AC âm (§8) test theo cụm, không rời rạc:** injection/XSS/mass-assignment một nhóm; cross-team IDOR
  một nhóm; session/CSRF/Origin một nhóm; upload/archive một nhóm; crash/disk-full/queue-saturation một
  nhóm — để dễ đối chiếu khi một cụm có bug thật (đúng cách đọc theo cụm mà `docs/delivery/README.md §6`
  khuyến nghị khi số hồ sơ còn ít).

## 10. Kế hoạch triển khai / rollback

**Ba cổng riêng biệt (chốt qua Council `1a86deaf`, vòng 2 — giải quyết đúng vòng phụ thuộc mà bản trước
mắc phải: benchmark cần dữ liệu di trú thật, nên không thể vừa là điều kiện "trước khi bắt đầu mọi việc"
vừa đợi tới lát 4 mới có dữ liệu để đo).**

**Cổng A — trước khi bắt đầu lát 1:** phải có câu trả lời của đội hạ tầng cho 6 câu chặn (ổ lưu trữ bền,
tên miền, HTTPS, thông tin OIDC, sao lưu, cách truyền secret) **cộng** hợp đồng proxy tối thiểu ở §5 (số
hop tin cậy, cách nhận IP client, nơi TLS kết thúc, timeout tầng proxy). Không thiết kế chi tiết tầng xác
thực khi chưa biết loại OIDC client. **Không cần** route inventory hay benchmark ở cổng này — lát 1 không
đụng route nghiệp vụ nào.

**Cổng B — trước khi coi MỘT lát bất kỳ (từ lát 2 trở đi) là xong:** mọi route được thêm/sửa **trong
chính lát đó** phải có đủ 11 trường inventory (FR-41) và đi qua `authorize()` (FR-40) — CI thất bại nếu
thiếu. Đây là điều kiện **tăng dần theo từng lát**, không phải một khối 84 route phải xong hết một lần
trước khi code bất cứ gì.

**Cổng C — trước khi Leader thật sự bắt đầu pilot trên hạ tầng public (sau khi lát 4 xong, dữ liệu đã di
trú):** (1) route inventory đã **đầy đủ và khớp router thật** cho toàn bộ route tính tới lát đang mở; (2)
benchmark 8 lớp workload chạy trên **bản sao dữ liệu Dev13 đã di trú thật** (§9); (3) toàn bộ mục "Trước
pilot public" ở bảng phân kỳ 3 mốc trong §5 đã đạt. Hai artefact (1)(2) có thể làm đổi ngưỡng hiệu năng ở
§5 hoặc quyết định có cần chuyển DB access sang worker thread hay không, nhưng **không** làm đổi baseline
bảo mật đã hội tụ (FR-40 → FR-49).

**Chia lát theo thứ tự — mỗi lát tự chạy được và kiểm chứng được. Nhóm F (FR-40 → FR-49) KHÔNG phải một
lát riêng — nó áp dụng ngay từ lát mở route nghiệp vụ đầu tiên (lát 3) và đi cùng mọi lát sau, theo đúng
cách Council chốt "không tách lát bảo mật riêng":**

| Lát | Nội dung | FR chính |
|---|---|---|
| 1 | Đóng gói container + cấu hình qua env + ổ lưu trữ bền + sao lưu + health check; **chưa đổi tính năng**, chưa cần Nhóm F vì chưa có route nghiệp vụ | 35–37, 39 |
| 2 | Danh tính: OIDC, phiên, onboarding chọn team, thông báo Admin, cảnh báo đăng nhập lạ. Route auth/onboarding **đã phải qua inventory** vì đây là route thật đầu tiên | 1–5, 34 |
| 3 | Nền phân quyền: `users`/`teams`/`team_members`/bảng hiển thị, 6 lớp gác (kể cả lớp 1.5), khu quản trị, bộ chọn team. **Route inventory + `authorize()` (FR-40/FR-41) mở chính thức từ đây**, cùng phần còn lại của Nhóm F áp được ngay (rate limit, body limit, validation — FR-42). **Sửa 19/09:** `audit_log` + ghi log tối thiểu (đổi thành viên, tầng 2, tầng 4 — một phần FR-19) và `row_version` cho 5 bảng nền tảng (một phần FR-46) kéo sớm vào lát này — xem chi tiết đầy đủ ở [exchange 2026-09-19](../../exchanges/2026-09-19.md). Khu "Vai đặc biệt" ở lát này **chỉ** có phần chọn team điều phối release; bảng bật/tắt "Checklist cá nhân" của FR-28a dời hẳn sang Lát 6 (đúng chủ FR 23-30) | 6–14, 19 (một phần), 40–42, 46 (một phần) |
| 4 | Di trú dữ liệu + PIC→User + nhiều người phụ trách + chống sửa trùng + nhật ký nghiệp vụ (mở rộng danh mục hành động `audit_log` đã tạo ở Lát 3, không tạo bảng mới). Optimistic concurrency (FR-46, phần còn lại cho các bảng nghiệp vụ) và audit (FR-48) đi cùng lát này vì gắn trực tiếp với các bảng vừa di trú | 15–20, 46, 48 |
| 5 | Điều chỉnh theo chức năng: Báo cáo tuần, Task cá nhân, Mind Map (kèm FR-43 upload/attachment), Redmine (kèm FR-44 chống SSRF), gỡ MCP | 21–22, 31–33, 38, 43–44 |
| 6 | Release nhiều team: 3 việc tách bạch (khẩn cấp theo team / định kỳ 1 lịch chung do team điều phối / tab cá nhân của từng người), xung đột (chỉ khẩn cấp), khoá/mở toàn trường (kèm FR-30 viết lại theo helper giờ VN tường minh cho nội dung template cá nhân khẩn cấp — không còn tính năng bài thông báo gộp, FR-29 đã bỏ). **Thiết kế kỹ thuật chi tiết đã chốt xong 19/09** (Council `84473697` + nhiều vòng coaching trực tiếp với Leader sau khi Council hiểu sai vai trò team điều phối, xem §6.3) — không còn câu hỏi chặn nào | 23–30 |

Xuyên suốt lát 3–6: **FR-45 (SQLite queue) và FR-47 (crash/restart)** không gắn riêng một lát mà là điều
kiện nền phải đúng ngay khi có route ghi đầu tiên (lát 3); **FR-49 (dependency/build)** áp dụng từ lát 1
vì liên quan tới cách đóng gói, không phải logic nghiệp vụ. CI phải **buộc mọi route mới ở lát 4-6 tiếp
tục khai đủ 11 trường** — không có "lát an toàn" nào được miễn cổng B.

Lát nào đủ lớn để cần DoR riêng thì mở CR con trỏ về CR này. **Cắt chuyển thật (bỏ desktop cho 6 chức
năng) chỉ xảy ra sau khi lát 6 nghiệm thu** — theo quyết định "xây đủ hết rồi mới ra mắt". **Không lát
trung gian nào được mở ra Internet công khai trước khi Cổng C hoàn tất** — pilot của Leader vẫn phải chờ
đủ ba cổng, kể cả khi chỉ có một mình Leader dùng.

**Rollback nếu hỏng (sửa lại theo Q9 — KHÔNG có đường quay lại desktop sau di trú):**

- Trước khi chạy di trú thật (bước 3-7 ở §6.3): bản desktop vẫn nguyên vẹn, chưa đụng gì; huỷ kế hoạch ở
  bước này không mất gì.
- Sau khi di trú: **server là nguồn dữ liệu duy nhất**, không còn đường quay lại desktop cho 6 chức năng
  đã chuyển. Sự cố xử lý bằng khôi phục từ bản sao lưu **trên chính server** (FR-37) — mất tối đa dữ liệu
  giữa lần sao lưu gần nhất và lúc sự cố, đã được chấp nhận (Q9). Container tự nó rollback về ảnh trước
  đó qua CI/CD như bình thường; **ổ lưu trữ bền không bị đụng khi rollback ảnh container**.
- Di trú có đường lùi riêng **chỉ trong lúc pilot chưa mở cho ai khác**: bản sao trước di trú + mã kiểm
  toàn vẹn cho phép huỷ kết quả di trú và thử lại từ đầu, miễn là chưa có dữ liệu mới nào được tạo trên
  server (vì Leader dùng một mình, việc này khả thi trong giai đoạn pilot). Sau khi mở cho người khác,
  đường lùi này không còn dùng được — chỉ còn khôi phục từ backup như trên.

**Với phần Xóa/Deprecate:** MCP server gỡ khỏi bản server (bản desktop còn Luyện đề không dùng tới);
`pics` chuyển sang vai trò dữ liệu lịch sử, không xoá; hai giá trị loại báo cáo ghi cứng bị thay bằng cấu
hình theo team, dữ liệu báo cáo cũ giữ nguyên.

## 11. Docs cần cập nhật sau khi làm xong

- [ ] [docs/01](../../specs/01-product-requirement-spec.md) — sản phẩm chuyển từ một người dùng sang nhiều team; phạm vi chức năng bản server so với bản desktop
- [ ] [docs/02](../../specs/02-screen-design-user-flow.md) — luồng đăng nhập, onboarding, bộ chọn team, khu quản trị, màn lịch release chung; tách luồng Báo cáo tuần
- [ ] [docs/03](../../specs/03-api-business-logic-spec.md) — 5 lớp gác, nhóm endpoint mới, quy ước lỗi `401`/`403`/`409`
- [ ] [docs/04](../../specs/04-database-design.md) — bảng mới, cột `team_id`/`owner_user_id`/`row_version`, mô hình người phụ trách nhiều người
- [ ] [docs/05](../../specs/05-test-acceptance-criteria.md) — ma trận phân quyền làm tiêu chí nghiệm thu thường trực
- [ ] [rules/06](../../rules/06-rules-frontend.md) — luật dựng điều hướng theo quyền; không coi ẩn nút là phân quyền
- [ ] [rules/07](../../rules/07-rules-backend.md) — luật fail-closed cho lớp gác; ngoại lệ múi giờ duy nhất của FR-30
- [ ] [rules/08](../../rules/08-rules-database.md) — quy ước `team_id`/`owner_user_id`, `row_version`
- [ ] [rules/09](../../rules/09-non-functional-requirements.md) — đóng gói: SEA → container, biến môi trường, ổ lưu trữ bền
- [ ] **[security-standard](../../standards/security-standard.md)** — bỏ giả định "chỉ bind `127.0.0.1`"; thêm toàn bộ `SEC-PERF-001..016`, ranh giới trách nhiệm mạng (App vs Infra), hợp đồng proxy tối thiểu
- [ ] **`.claude/skills/security-gate/SKILL.md`** — sửa ô "không nới bề mặt mạng" cho đúng thực tế mới; thêm mục kiểm route inventory 11 trường khi chạm "endpoint mới"
- [ ] [operations/](../../operations/README.md) — runbook vận hành bản server: sao lưu, khôi phục, xử lý khi hệ xác thực sập, quy trình xử lý khi `/health/ready` false kéo dài, cách đọc benchmark/decision-trigger ở §5
- [ ] [README gốc](../../../README.md) — phân biệt bản desktop (chỉ Luyện đề) và bản server
- [ ] [performance-standard](../../standards/performance-standard.md) — hợp đồng hiệu năng ban đầu (p50/p95/p99 theo lớp endpoint), bảng kích hoạt đổi kiến trúc

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude (phân tích ban đầu) | 2026-09-13 | ✅ Bản đầu xong |
| Reviewer (Dev/Tester/Infra) | Council thật Claude + Codex — run `0caf00ab` (khám phá), `38c458f1` (kiến trúc backend, converged), `4dd7a70c` (bảo mật + hiệu năng, converged), `1a86deaf` (rà soát vòng 2, converged) | 2026-09-13 | ✅ Hội tụ hướng kiến trúc + đã xử lý dứt điểm Q7, FR-30, gap FR↔AC, phân bổ Nhóm F/3 cổng; ⬜ 2 artefact còn thiếu (route inventory, benchmark) trước Cổng C |
| Leader | | | ⬜ Chưa duyệt — chờ đọc bản đã sửa theo Council + xác nhận Q1-Q11 đã phản ánh đúng |
| Người triển khai | | | |
| QA nghiệm thu | | | |

**Ba góc nhìn shift-left — kết quả thật từ Council, không phải tự soi (bước 6 của delivery-flow):**

- **Dev (Codex, run `38c458f1`):** điểm xuất phát là **con số 0 tuyệt đối** — code hiện tại không có
  middleware xác thực/CSRF/rate-limit nào, `DatabaseSync` chặn event loop nếu SQL nặng, chưa dependency
  nào cho OIDC/session có trong `package.json`. Rủi ro lớn nhất không phải viết logic sai mà là **gán
  nhãn `(chức năng, hành động)` cho toàn bộ endpoint hiện có** thiếu sót — một endpoint quên khai báo là
  một lỗ phân quyền câm; bằng chứng cụ thể đã tìm thấy: comment tại `server/routes/schedules.ts:568-572`
  tự ghi nhận route đổi team/hệ thống của batch release **đã mất một lớp bảo vệ thật** sau khi xoá AI
  automation mà chưa thay bằng gì (D2/`BL-20260913-003`).
- **Tester (cả hai agent):** AC-6 → AC-11, AC-19 → AC-22, và toàn bộ **AC âm** (§8) phải test ở **tầng
  API**, không qua giao diện — lỗi hay nằm ở chỗ giao diện ẩn nút nhưng backend vẫn cho gọi. Ca lỗi-biên
  đáng lo nhất: đổi quyền/thu hồi phiên **giữa lúc** người dùng đang mở form hoặc request khác đang chạy
  (đã đưa vào §9 và FR-4a). Route inventory phải tự sinh test, không viết tay từng ca.
- **Infra (Codex, cả hai run):** hai rủi ro nghiêm trọng nhất nằm ngoài code (ổ lưu trữ bền, số bản
  chạy) — phải chốt trước lát 1. **Ranh giới mới, chốt sau phản đối của Codex:** lớp mạng (WAF/CDN/
  firewall/DDoS) do Infra tự lo hoàn toàn, App chỉ công bố hợp đồng proxy tối thiểu (§5) — Council không
  được tuyên bố backend tự chống được DDoS. Việc mở ra Internet công khai buộc cập nhật chuẩn bảo mật
  trong cùng lần giao — đã ghi ở §5 và §11.
- **Vòng 2 (Council `1a86deaf`, cả hai agent):** xác nhận cách hiểu Q7 của Claude là đúng (không cần
  sửa FR-16/AC-32); tìm được **bằng chứng code thật** cho một rủi ro giờ-máy đã lặp lại lần thứ ba
  (`release.tsx:322`, xem FR-30); chỉ ra 15 mã FR chưa có AC tương ứng và cùng thống nhất cách phủ (8 AC
  số riêng + 7 nhãn con); phát hiện vòng phụ thuộc giữa "benchmark cần dữ liệu di trú" và "route
  inventory bắt buộc trước khi bắt đầu" — giải bằng cách tách 3 cổng riêng thay vì một cổng DoR duy nhất.

**Điểm yếu nhất còn lại, theo đúng lời Codex (không diễn giải bớt):** *"chưa có inventory 11 trường cho
từng route production và chưa có benchmark trên dữ liệu Dev13 đã di trú — đây là hai artefact nghiệm thu
thiết kế; chúng có thể đổi threshold hoặc kích hoạt worker, nhưng không mở lại baseline bảo mật."*
