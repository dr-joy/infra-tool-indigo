# CR-20260805-whitelist-tool-theo-action-automation — Whitelist tool đọc theo nhóm automation

| Trường | Giá trị |
|---|---|
| Loại | ✅ Sửa hành vi |
| Mức tác động | ✅ Vừa (automation + phân quyền tool) |
| Người đề xuất | Claude + Codex |
| Ngày | 2026-08-05 |
| Trạng thái | ⚠️ **Đã bị thay thế (superseded) — 2026-08-21.** Cơ chế whitelist env-based (`CLAUDE_READ_TOOLS_POST/OTHER`) mô tả ở CR này đã được xây dựng lại hoàn toàn thành hệ thống profile trong app/DB (`app_settings`) ở [CR-20260814-cau-hinh-claude-bin](CR-20260814-cau-hinh-claude-bin-khong-phu-thuoc-env.md) (lát 1) và [CR-20260821-whitelist-tool-vao-app](CR-20260821-whitelist-tool-vao-app.md) (lát 2); `actionType='other'` mà CR này nhắm tới nay đã bị khoá legacy (BL-006, tách thành `drive`/`redmine` riêng). Hồ sơ này **giữ nguyên vĩnh viễn** theo quy tắc `docs/delivery/README.md` (không archive CR/BUG), chỉ ghi chú lại để không ai tưởng đây là việc còn dở |
| Spec liên quan | [spec 03](../../specs/03-api-business-logic-spec.md), [rules 07](../../rules/07-rules-backend.md), [go-live guide](../../operations/automation-ai-go-live-guide.md), [release-ai-prompts](../../ai-prompts/release/periodic-release.md) |

## 1. Bối cảnh & Vấn đề

Leader đã chốt hướng B trong [exchanges/2026-08-05](../../exchanges/2026-08-05.md): tách whitelist tool đọc theo nhóm tác vụ thay vì mở rộng `CLAUDE_READ_TOOLS` chung. Hiện whitelist thật trên máy chỉ có Dr.JOY, trong khi nhiều task release cần đọc Google Sheet/Drive/Calendar. Nếu chỉ thêm Drive/Sheets vào env chung, mọi preview đều được mở quyền đọc các connector đó, kể cả task không cần. Cần giữ tương thích với cấu hình Dr.JOY hiện tại nhưng cho phép mở quyền đọc theo `actionType`.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu:**
  - Thêm `CLAUDE_READ_TOOLS_POST` và `CLAUDE_READ_TOOLS_OTHER`.
  - Preview và execute dùng read tools chung + read tools đúng `actionType`.
  - Pha write vẫn chỉ dùng write tools từ `CLAUDE_WRITE_TOOLS_POST/OTHER`, nhưng được cộng read tools đúng nhóm để kiểm trước khi ghi.
  - Go-live guide có bước đối chiếu task -> connector/tool -> env -> smoke CLI.
- **Ngoài phạm vi:**
  - Không thêm DB/UI metadata tool requirements theo từng task.
  - Không tự cấu hình OAuth hoặc cài connector Google/Calendar.
  - Không sửa prompt-building của `CR-20260805-chuan-hoa-prompt-automation`.

## 3. Người dùng & Kịch bản

- Là người vận hành automation release, tôi muốn cấp tool đọc theo nhóm task để A/B/C task đọc đúng connector cần thiết mà không mở Drive/Calendar cho mọi preview.
- Là dev bảo trì automation, tôi muốn test runner bắt được việc pha write kéo nhầm read tools chung khi route đã truyền scoped tools.

## 4. Yêu cầu chức năng

- **FR-1:** Backend đọc thêm env `CLAUDE_READ_TOOLS_POST` cho `actionType=post` và `CLAUDE_READ_TOOLS_OTHER` cho `actionType=other`.
- **FR-2:** `CLAUDE_READ_TOOLS` vẫn là danh sách đọc chung và được cộng với danh sách scoped, giữ tương thích cấu hình cũ.
- **FR-3:** Route preview truyền read tools theo `actionType` cho `runClaude(mode:'read')`.
- **FR-4:** Route execute truyền cùng read tools theo `actionType` cho `runClaude(mode:'write')`; runner cộng danh sách này với write tools đã duyệt.
- **FR-5:** Runner vẫn lọc read tools bằng `sanitizeReadTools`; tool mang nghĩa ghi/built-in không được lọt vào allow.
- **FR-6:** Tài liệu vận hành phải có checklist tool theo task/action trước khi bật automation thật.

## 5. Yêu cầu phi chức năng

- Không dùng `--dangerously-skip-permissions`.
- Không nới quyền ghi: write tools vẫn lấy từ `CLAUDE_WRITE_TOOLS_POST/OTHER`.
- Không log secret/token; chỉ ghi tên env/tool.
- Không thêm dependency.

## 6. Thiết kế giải pháp

### 6.1. UI

Không đổi UI.

### 6.2. API & nghiệp vụ

`server/routes/automation.ts` thêm helper:

- `CLAUDE_READ_TOOLS` = tool đọc chung.
- `CLAUDE_READ_TOOLS_POST` = tool đọc bổ sung cho `actionType=post`.
- `CLAUDE_READ_TOOLS_OTHER` = tool đọc bổ sung cho `actionType=other`.

Preview và execute đều gọi `readToolsFor(task.actionType)`.

### 6.3. Dữ liệu & schema

Không đổi DB.

### 6.4. Automation / tích hợp

`server/lib/claude-runner.ts` thêm option `readTools?: string[]`. Ở mode write:

- Nếu route truyền `readTools`, runner dùng danh sách đó.
- Nếu không truyền, fallback về `CLAUDE_READ_TOOLS` để tương thích code/test cũ.
- Danh sách read vẫn qua `sanitizeReadTools`.

## 7. Phân tích tác động

- [ ] Frontend · [x] API route · [ ] DB/migration · [x] Automation/MCP
- [ ] i18n · [ ] Đóng gói SEA/MCP · [x] Bảo mật · [ ] Dữ liệu cũ/backward-compat
- **Rủi ro:** env scoped bị set thiếu khiến task vẫn blocked. Giảm thiểu bằng guide + smoke CLI.
- **Ảnh hưởng đang chạy:** cấu hình cũ chỉ có `CLAUDE_READ_TOOLS` vẫn chạy như trước.

## 8. Tiêu chí nghiệm thu

- **AC-1 (FR-1/2/3):** Given task `post`/`other`, When preview, Then backend cấp read tools chung + read tools đúng action.
- **AC-2 (FR-4/5):** Given execute đã được duyệt, When runner build args, Then `--allowedTools` gồm write tools + read tools scoped đã lọc, không gồm tool đọc chung nếu route đã truyền scoped list riêng.
- **AC-3 (FR-5):** Given read tools scoped có `delete-*` hoặc `Bash`, When build args, Then các tool đó bị loại.
- **AC-4 (FR-6):** Given go-live guide, When vận hành `actionType=other`, Then có bước liệt kê connector/tool và đối chiếu env trước khi bật.

## 9. Kế hoạch test

- Unit: `test/unit/claude-runner.test.ts`
  - Pha write dùng `readTools` scoped do route truyền.
  - Read tools scoped vẫn bị lọc tool nguy hiểm.
  - Các test BUG-004/BUG-005 cũ vẫn xanh.
- Build/check: `npm run build`, `npm run check`.
- Smoke thủ công cần Leader/máy thật: chạy CLI với tool Dr.JOY/Drive/Calendar thật theo guide.

## 10. Triển khai / rollback

- Triển khai: set thêm env scoped khi cần:
  - `CLAUDE_READ_TOOLS_POST`
  - `CLAUDE_READ_TOOLS_OTHER`
- Rollback: xóa hai env scoped; hệ thống quay về dùng `CLAUDE_READ_TOOLS` chung như trước.

## 11. Docs cần cập nhật sau khi làm xong

- [x] [spec 03](../../specs/03-api-business-logic-spec.md)
- [x] [automation-ai-go-live-guide](../../operations/automation-ai-go-live-guide.md)
- [x] [release-ai-prompts](../../ai-prompts/release/periodic-release.md)
- [x] [delivery ledger](../README.md)

## 12. Duyệt

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude + Codex | 2026-08-05 | ✅ |
| Leader | User | 2026-08-05 | ✅ Chốt hướng B; ✅ duyệt code sau khi Claude review + Codex xử lý 3 finding (xem exchanges/2026-08-05) |
| Người triển khai | Codex | 2026-08-05 | ✅ |
| QA nghiệm thu | Codex + Leader smoke thật | 2026-08-05 | ✅ Máy check xanh; ⬜ Leader smoke connector thật (còn lại trước khi bật task `other` thật) |
