# Operations — Vận hành & duy trì

> Nhóm tài liệu trả lời câu hỏi **"chạy và duy trì cái đã xây như thế nào"**.
> Phân biệt với [../playbooks/](../playbooks/): playbook nói cách **xây** (thêm feature, refactor UI),
> operations nói cách **chạy** (bật connector, theo lịch release, xử lý sự cố).
> Quy chuẩn: [../standards/docs-standard.md §2](../standards/docs-standard.md).

| Tài liệu | Dùng khi | Nguồn đối chiếu |
|---|---|---|
| [Hướng dẫn Release định kỳ](huong-dan-release-dinh-ky.md) | Nắm mục đích + follow chung của một chu kỳ release (bản dành cho cowork) | `server/routes/schedules.ts`, `server/routes/release.ts` |
| [Flow Release định kỳ — Runbook](release-dinh-ky-flow.md) | Thực thi theo dòng thời gian: tuần nào làm gì, tính từ ngày release `R` | 29 task definitions trong DB |

## Lưu ý

- Owner: **Infra** ([team-operating §2](../standards/team-operating-standard.md)). Runbook phải khớp
  thực tế máy đang chạy — lệch thì sửa runbook, không sửa trí nhớ.
- Đổi hành vi vận hành trong code ⇒ cập nhật runbook tương ứng **trong cùng lần giao**
  ([docs-standard §5](../standards/docs-standard.md)).
