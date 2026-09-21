# Archive — tài liệu đã hết hiệu lực

> **Không dùng bất kỳ file nào ở đây làm nguồn.** Giữ lại để tra cứu *quyết định cũ và lý do*
> ([docs-standard §6](../standards/docs-standard.md)). Mỗi file có banner đầu trang trỏ tới bản thay thế.

| Tài liệu | Vì sao hết hiệu lực | Thay bằng |
|---|---|---|
| [drjoy-auto-post-design.md](drjoy-auto-post-design.md) | Tự ghi "chưa code" nhưng **đã hiện thực**; mô tả sinh-prompt-dán-tay không còn đúng | [specs/03](../specs/03-api-business-logic-spec.md), [operations/go-live](../operations/automation-ai-go-live-guide.md) |
| [task-automation-ai-implementation-brief.md](task-automation-ai-implementation-brief.md) | Brief bàn giao, việc đã xong | [specs/03](../specs/03-api-business-logic-spec.md) |
| [weekly-report-design.md](weekly-report-design.md) | Đã hiện thực và tiến hóa thêm | [specs/01](../specs/01-product-requirement-spec.md), [specs/02](../specs/02-screen-design-user-flow.md) |
| [system-standardization-rules.md](system-standardization-rules.md) | Đã curate vào rule canonical | [rules/06](../rules/06-rules-frontend.md), [07](../rules/07-rules-backend.md), [08](../rules/08-rules-database.md) |
| [ui-two-layer-rules.md](ui-two-layer-rules.md) | Đã curate vào rule frontend | [rules/06](../rules/06-rules-frontend.md) |
| [ai-daily-playbook.md](ai-daily-playbook.md) | Prompt dán tay, app nay tự gọi AI | [operations/go-live](../operations/automation-ai-go-live-guide.md) |

> **granular-rules/ đã xoá (2026-08-05):** bộ rule granular gốc (trước ở `instroduction/rules/`) đã
> curate xong vào [rules/](../rules/) `06–09` từ 2026-08-01 — bản archive chỉ còn trùng lặp không thêm
> giá trị. Xoá khỏi working tree, lịch sử vẫn còn trong Git nếu cần tra cứu.

## Không thuộc archive

Ba runbook vận hành **từng nằm nhầm ở đây** đã chuyển ra [operations/](../operations/README.md)
(2026-08-01), và thiết kế Redmine chuyển sang [proposals/](../proposals/README.md).
Xem [docs-standard §2](../standards/docs-standard.md) — mục cảnh báo về bẫy này.
