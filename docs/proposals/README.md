# Proposals — Thiết kế chưa triển khai

> Nhóm tài liệu trả lời câu hỏi **"ta ĐANG CÂN NHẮC xây gì"**.
> **Chưa phải cam kết.** Đây không phải spec của hệ thống hiện tại — muốn biết hệ thống *đang* là gì,
> đọc [../specs/](../specs/).
> Quy chuẩn: [../standards/docs-standard.md §2](../standards/docs-standard.md).

| Tài liệu | Trạng thái thực tế trong code |
|---|---|
| [Tích hợp Redmine + dùng chung cho team](redmine-integration-design.md) | Mới có `/redmine/config` (lưu URL + API key) và `/redmine/test` (kiểm kết nối) ở `server/routes/redmine.ts`. **Phần đồng bộ task lên Redmine và phần host chung cho team chưa code.** |

## Vòng đời một proposal

```
proposals/xxx-design.md ──► backlog BL-* ──Leader pick──► changes/CR-<ngày>-<slug>.md ──nghiệm thu──► fold vào specs/ + rules/
        │                                                                                          │
        └──────────────────────── quyết định KHÔNG làm ────────────────────────►  _archive/ ◄──────┘
```

- Muốn triển khai ⇒ viết Change Spec theo [design-standard](../standards/design-standard.md), **không**
  code thẳng từ proposal (proposal không có FR/AC đánh số, không qua DoR).
- Proposal đã thành CR và nghiệm thu xong ⇒ chuyển [`../_archive/`](../_archive/) kèm banner.
- Proposal bị bác ⇒ chuyển `_archive/` kèm banner ghi **lý do bác** (để sau này không đề xuất lại từ đầu).
