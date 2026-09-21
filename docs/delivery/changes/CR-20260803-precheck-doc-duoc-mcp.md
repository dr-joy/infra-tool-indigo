# CR-20260803-precheck-doc-duoc-mcp — Pha precheck phải đọc được Dr.JOY qua MCP

| Trường | Giá trị |
|---|---|
| Loại | Sửa hành vi (vùng nhạy cảm: phân quyền spawn AI) |
| Mức tác động | **Lớn** — đổi cơ chế giới hạn quyền của pha đọc |
| Trạng thái | ✅ Đã duyệt → đã code → đã test → đã ship |
| Sinh ra từ | [BUG-20260803-precheck-khong-doc-duoc-mcp](../bugs/BUG-20260803-precheck-khong-doc-duoc-mcp.md) |
| Spec liên quan | [specs/03 §2](../../specs/03-api-business-logic-spec.md) · [security-standard §9](../../standards/security-standard.md) · [rules/07](../../rules/07-rules-backend.md) |
| Cổng bắt buộc | [security-standard §9](../../standards/security-standard.md) (spawn AI + phân quyền tool) |

## 1. Bối cảnh & Vấn đề

Automation chia 2 pha: **đọc** (precheck → dựng bản xem trước cho người duyệt) và **ghi** (đăng thật sau
khi duyệt). Pha đọc chạy `--permission-mode plan` để đảm bảo không ghi được gì.

Thực tế `plan` chặn **mọi** tool MCP, kể cả tool ĐỌC đã whitelist qua `CLAUDE_READ_TOOLS`
(*"Cannot call mcp__drjoy__list-groups while in plan mode"*). Hệ quả: precheck không đối chiếu được gì
với Dr.JOY, nên bản xem trước chỉ là nội dung AI tự soạn.

Thiệt hại cụ thể — **không chống được đăng trùng**: việc "group đã có bài của đợt này chưa" bị dồn sang
pha ghi, mà pha ghi kiểm xong là đăng luôn, không có người xem giữa hai bước. Kèm theo: không xác nhận
được quyền đăng, không lấy được danh sách thành viên để mention.

## 2. Mục tiêu & Ngoài phạm vi

**Mục tiêu**

1. Pha đọc gọi được các tool **ĐỌC** MCP đã whitelist.
2. Pha đọc **vẫn tuyệt đối không ghi** được ra ngoài (Dr.JOY, file, shell).
3. Cấu hình whitelist sai không được biến pha đọc thành pha có quyền ghi.

**Ngoài phạm vi**

- Không đổi luồng duyệt của người dùng (vẫn preview → duyệt → ghi).
- Không đổi whitelist tool ghi, không thêm tool ghi mới.
- Không tự động hoá việc soát trùng bài thành một cổng chặn cứng ở backend (chỉ đưa vào steps của prompt).

## 3. Người dùng & Kịch bản

Leader mở app, tới giờ task AI, bấm xem bản xem trước. Người đó cần thấy *"đã kiểm tra với Dr.JOY: group
đúng, chưa có bài trùng, sẽ mention N người này"* — chứ không phải *"AI dự định làm thế này"*.

## 4. Yêu cầu chức năng

| FR | Yêu cầu |
|---|---|
| FR-1 | Pha đọc có whitelist tool đọc hợp lệ ⇒ chạy `--permission-mode default` + `--allowedTools <danh sách đã lọc>` |
| FR-2 | Whitelist pha đọc bị **lọc**: loại tool tên mang nghĩa ghi (`create/update/delete/send/post/draft/…`), tool ghi built-in, và mọi tool đang có trong `CLAUDE_WRITE_TOOLS_*` |
| FR-3 | Whitelist rỗng sau khi lọc ⇒ quay về `--permission-mode plan` (mặc định an toàn), không cấp `--allowedTools` |
| FR-4 | Cả hai pha luôn có `--disallowedTools` liệt kê tường minh tool ghi built-in; pha đọc thêm toàn bộ tool ghi từ env |
| FR-5 | Tool bị loại khỏi whitelist phải được `console.warn` (cấu hình sai phải thấy được, không im lặng) |
| FR-6 | Không bao giờ dùng `--dangerously-skip-permissions` (giữ nguyên) |

## 5. Yêu cầu phi chức năng

- Không tăng số lần spawn Claude, không tăng timeout.
- Toàn bộ quyết định quyền vẫn nằm trong **một chỗ duy nhất**: `server/lib/claude-runner.ts`.

## 6. Thiết kế

**API/nghiệp vụ** — `buildArgs()` trong [claude-runner.ts](../../../server/lib/claude-runner.ts):

| Tình huống | `--permission-mode` | `--allowedTools` | `--disallowedTools` |
|---|---|---|---|
| đọc, có tool đọc hợp lệ | `default` | tool đọc đã lọc | built-in ghi + tool ghi env |
| đọc, whitelist rỗng/toàn tool ghi | `plan` | (không có) | built-in ghi + tool ghi env |
| ghi (sau khi duyệt) | `default` | đúng tool ghi theo `actionType` | built-in ghi |

**Ba lớp chắn của pha đọc** (phòng thủ theo lớp — lớp sau vẫn giữ nếu lớp trước hụt):

1. Lọc theo tên: `READ_DENY_PATTERN` khớp theo **từ** trong tên tool (`get-group-members` không bị nhầm là ghi).
2. Loại giao với `CLAUDE_WRITE_TOOLS_*`: pha đọc không được chạm tool của pha ghi.
3. `--disallowedTools` tường minh: deny thắng allow.

**Vì sao bỏ `plan` là chấp nhận được:** tính read-only KHÔNG đến từ `plan` mà từ *"headless không có ai
bấm duyệt ⇒ tool ngoài `--allowedTools` bị từ chối"*. `plan` chỉ là lớp phụ, và là lớp đang gây hại.

**Dữ liệu/schema:** không đổi. **UI:** không đổi.

## 7. Phân tích tác động

| Vùng | Tác động |
|---|---|
| `server/lib/claude-runner.ts` | `buildArgs` đổi hành vi; thêm `sanitizeReadTools`, `BUILTIN_WRITE_TOOLS`, `READ_DENY_PATTERN` |
| `server/routes/automation.ts` | Không đổi code; pha preview nay thật sự đọc được ⇒ prompt (`aiNote`) nên yêu cầu xác minh thay vì bỏ qua |
| Prompt/aiNote 30 task release | [ai-prompts/release/periodic-release.md](../../ai-prompts/release/periodic-release.md) §2b viết lại: precheck **phải** xác nhận group + soát trùng bài + lấy người nhận |
| Env | `CLAUDE_READ_TOOLS` từ chỗ "gần như vô dụng" thành **có hiệu lực thật** — whitelist sai làm precheck mất khả năng đối chiếu |
| Bảo mật | Nới quyền pha đọc từ `plan` → `default`; bù lại 3 lớp chắn + kiểm chứng 2 chiều bằng CLI thật |

## 8. Tiêu chí nghiệm thu

| AC | Điều kiện | Kết quả | Trạng thái |
|---|---|---|---|
| AC-1 | Pha đọc, whitelist 9 tool đọc Dr.JOY | `--permission-mode default`, allow đủ 9 tool | ✅ |
| AC-2 | Whitelist đọc có lẫn `create-group-article`, `delete-group-comment`, `Write`, `Bash` | 4 tool đó bị loại khỏi allow | ✅ |
| AC-3 | Whitelist đọc chỉ toàn tool ghi | quay về `plan`, không cấp allow | ✅ |
| AC-4 | Cả hai pha | `--disallowedTools` có `Write`/`Edit`/`NotebookEdit`/`Bash`; tool ghi env chỉ bị deny ở pha đọc | ✅ |
| AC-5 | Không tool nào vừa allow vừa deny | allow ∩ deny = ∅ | ✅ |
| AC-6 | **Claude thật**, pha đọc gọi `get-group-members` group PM | `{"goiDuocTool": true, "soThanhVien": 15}` | ✅ |
| AC-7 | **Claude thật**, pha đọc bị bảo ghi file bằng `Write` | *"Write tool bị chặn context này"*, file không tồn tại trên đĩa | ✅ |

## 9. Kế hoạch test

- Unit: 5 ca `BUG-004` trong `test/unit/claude-runner.test.ts` (AC-1…AC-5) — viết **đỏ trước**.
- Smoke CLI thật, 2 chiều (AC-6, AC-7) — chạy tay, ghi kết quả vào CR/BUG.
- Regression: `npm run check` (tsc · 153 test · build · bundle · link · docs).

## 10. Triển khai / rollback

- Triển khai: build lại SEA (`npm run package`) + restart app.
- Rollback: đổi 1 dòng ở `buildArgs` về `plan` cho mọi trường hợp pha đọc; không có migration dữ liệu.

## 11. Docs cập nhật

- [security-standard §9](../../standards/security-standard.md) — cơ chế read-only + bắt buộc kiểm chứng bằng CLI thật.
- [qa-standard §8](../../standards/qa-standard.md) — mock không được dùng để kiểm chứng ràng buộc quyền.
- [specs/03 §2](../../specs/03-api-business-logic-spec.md) — bảng cờ CLI theo pha.
- [operations/automation-ai-go-live-guide.md](../../operations/automation-ai-go-live-guide.md) — `CLAUDE_READ_TOOLS` nay có hiệu lực thật.
- [ai-prompts/release/periodic-release.md](../../ai-prompts/release/periodic-release.md) §2b — precheck phải xác minh.

## 12. Sign-off

| Vai | Kết luận |
|---|---|
| BA | FR-1…FR-6 đủ, không mở rộng phạm vi sang luồng duyệt |
| Dev | Sửa tập trung ở 1 seam; 3 lớp chắn, có log khi lọc |
| Tester | 5 unit + 2 smoke CLI thật, 2 chiều — đạt |
| Infra/Security | Nới `plan`→`default` chấp nhận được vì read-only thực chất do whitelist tạo ra; deny tường minh là lớp cuối |
| Leader | Chốt ship cùng ngày phát hiện (rủi ro đăng trùng là rủi ro ghi ra ngoài) |
