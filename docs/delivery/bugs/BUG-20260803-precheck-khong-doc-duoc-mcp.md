# BUG-20260803-precheck-khong-doc-duoc-mcp — Bản xem trước của AI không đối chiếu được với Dr.JOY, nên không chống được đăng trùng bài

| Trường | Giá trị |
|---|---|
| Ngày phát hiện | 2026-08-03 |
| Người phát hiện | Tester (lượt test 7 — lần đầu chạy Claude thật, không dùng mock) |
| Mức nghiêm trọng | ⬜ Chặn dùng ✅ Sai dữ liệu ⬜ Khó chịu ⬜ Cosmetic |
| **Sinh ra bởi** | ⬜ CR ✅ Có sẵn từ khi làm Automation AI ⬜ Không truy được |
| **Cổng lẽ ra phải bắt** | ⬜ ① Yêu cầu ✅ ② Thiết kế ⬜ ③ Feedback sớm ⬜ ④ DoR ⬜ ⑤ Bàn giao test ⬜ ⑥ Cổng hạ tầng ⬜ ⑦ Nghiệm thu ⬜ ⑧ Chốt/ship |
| **Loại nguyên nhân** | ⬜ RC-REQ ✅ RC-SPEC ⬜ RC-IMPL ✅ RC-TEST ⬜ RC-DATA ⬜ RC-INTEG ⬜ RC-PERF ⬜ RC-SEC ⬜ RC-DOC ⬜ RC-PROC |
| Trạng thái | ⬜ Mới ⬜ Đã có test đỏ ✅ Đã sửa ✅ Đã rút kinh nghiệm |
| Test tái hiện | `test/unit/claude-runner.test.ts` (nhóm `BUG-004`) |
| CR sửa | [CR-20260803-precheck-doc-duoc-mcp](../changes/CR-20260803-precheck-doc-duoc-mcp.md) |

## 1. Triệu chứng

Precheck task `Announcement - PMs` trả `blocked` với lý do:
*"mọi tool `mcp__drjoy__*` bị chặn — `Cannot call mcp__drjoy__list-groups while in plan mode`"*.
Bản xem trước người dùng duyệt vì thế chỉ là **nội dung AI tự soạn**, chưa từng đối chiếu với Dr.JOY thật:
không biết group còn quyền đăng không, **không biết group đã có bài của đợt này chưa**, không biết
mention được ai.

## 2. Tái hiện

1. Set `CLAUDE_READ_TOOLS` chứa các tool đọc Dr.JOY (`mcp__drjoy__list-groups`, `get-group-members`…).
2. Gọi `POST /api/automation/preview` cho một task `actionType=post`.
3. Đọc `reasons` trả về.

- **Kỳ vọng:** precheck gọi được tool ĐỌC đã whitelist → xác nhận group/quyền/trùng bài/người nhận.
- **Thực tế:** mọi tool MCP bị CLI chặn; `CLAUDE_READ_TOOLS` vô hiệu với tool MCP.

## 3. Nguyên nhân gốc

- **Sai ở đâu (kỹ thuật):** pha đọc chạy `--permission-mode plan` ([claude-runner.ts](../../../server/lib/claude-runner.ts)).
  `plan` không phải "chỉ đọc" như tên gợi ý — nó chặn **mọi** tool MCP, kể cả tool đọc đã nằm trong
  `--allowedTools`. Cơ chế an toàn thật của headless là *tool ngoài `--allowedTools` bị từ chối* (vì
  không có ai bấm duyệt live), nên `plan` chỉ là lớp thừa mà lại chặn quá tay.
- **Vì sao lọt qua:** cả test suite dùng `scripts/mock-claude.cmd` — mock **không đọc cờ
  `--permission-mode`**, cứ trả JSON hợp lệ. Vì vậy 100% test xanh trong khi Claude thật chặn sạch.
  Không có ca nào chạy CLI thật, cũng không có ca nào assert "pha đọc phải gọi được tool đọc".

## 4. Cổng nào hụt & vì sao

| Cổng | Đáng lẽ phải bắt bằng cách nào | Vì sao không bắt được |
|---|---|---|
| ② Thiết kế | Khi chốt "pha đọc read-only", phải chỉ rõ **cơ chế nào tạo ra tính read-only** (whitelist? permission-mode? cả hai?) và **kiểm chứng bằng cách nào**. Chọn `plan` mà không kiểm nghĩa của nó với tool MCP là giả định chưa thử | Spec chỉ ghi "mode read = plan = không ghi được gì", coi đó là hiển nhiên đúng. Không ai chạy thử CLI thật để xem `plan` còn chặn thêm gì |

## 5. Cách sửa

- **Test đỏ** (viết TRƯỚC khi sửa): 5 ca `BUG-004` trong `test/unit/claude-runner.test.ts`.
- **Sửa:** xem [CR-20260803-precheck-doc-duoc-mcp](../changes/CR-20260803-precheck-doc-duoc-mcp.md).
  Tóm: pha đọc dùng `--permission-mode default` + chỉ whitelist tool ĐỌC (đã lọc), thêm
  `--disallowedTools` tường minh; whitelist rỗng sau lọc thì quay về `plan`.
- **Kiểm chứng bằng Claude THẬT** (không mock), 2 chiều:
  - Pha đọc gọi `mcp__drjoy__get-group-members` → `{"goiDuocTool": true, "soThanhVien": 15}`.
  - Pha đọc bị yêu cầu ghi file bằng tool `Write` → *"Write tool bị chặn context này"*, file không tồn tại trên đĩa.
- **Quét lân cận:** pha ghi (`mode: 'write'`) cũng được bổ sung `--disallowedTools` chặn tool ghi
  built-in (`Write`/`Edit`/`Bash`…) — trước đây chỉ dựa vào việc "không whitelist thì không gọi được".

## 6. Hành động cải tiến

| # | Thay đổi gì | Ở đâu | Trạng thái |
|---|---|---|---|
| 1 | Rule: chốt "read-only" phải nói rõ **cơ chế** + **cách kiểm chứng**; cấm suy diễn ngữ nghĩa của cờ CLI mà chưa chạy thử | [security-standard §9](../../standards/security-standard.md) | ✅ Xong |
| 2 | Rule: mock **không được** làm nơi kiểm chứng ràng buộc quyền. Ràng buộc quyền phải có ít nhất 1 ca chạy **CLI thật** (2 chiều: được đọc / bị chặn ghi), chạy tay khi go-live và mỗi lần đổi cờ | [qa-standard §8](../../standards/qa-standard.md) | ✅ Xong |
| 3 | Ghi rõ trong go-live guide: `CLAUDE_READ_TOOLS` giờ **thật sự có hiệu lực** với tool MCP; whitelist sai = pha đọc mất khả năng đối chiếu | [operations/automation-ai-go-live-guide.md](../../operations/automation-ai-go-live-guide.md) | ✅ Xong |

## 7. Liên kết

- CR sửa: [CR-20260803-precheck-doc-duoc-mcp](../changes/CR-20260803-precheck-doc-duoc-mcp.md)
- Bug cùng ngày, khác gốc: [BUG-20260803-automation-sai-mui-gio](BUG-20260803-automation-sai-mui-gio.md)
- Commit sửa: (điền sau khi commit)
