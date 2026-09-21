---
name: delivery-flow
description: Đường C — Standard Delivery Flow đầy đủ. Dùng khi thêm/sửa/xoá chức năng, đụng DB, automation, hợp đồng API, hoặc nhiều màn hình — bất kỳ thay đổi nào làm ai đó phải học lại cách dùng hoặc có thể hỏng dữ liệu/chức năng khác. Không dùng cho cosmetic (xem bugfix-flow cho lỗi rõ ràng).
---

# Delivery Flow — Đường C

Nguồn đầy đủ: [team-operating-standard.md §5.1](../../../docs/standards/team-operating-standard.md),
[design-standard.md](../../../docs/standards/design-standard.md). File này là bản rút gọn để thực thi,
không lặp lại phần lý luận.

## Trước khi bắt đầu

Item phải có trong [backlog canonical](../../../docs/backlog/README.md) và đã được **Leader chuyển sang
`Picked`**. User yêu cầu làm ngay có thể được ghi nhận + pick trong cùng lượt, nhưng không được bỏ dấu vết này.
Backlog chỉ giữ vấn đề/ưu tiên/trạng thái/link; không chép FR/AC hay thiết kế từ CR sang backlog.

Nếu vấn đề **còn mở** (chưa rõ giải pháp) — chạy pha đối thoại Claude ⇄ Codex trong
`docs/exchanges/YYYY-MM-DD.md` trước (xem [CLAUDE.md](../../../CLAUDE.md)), user chốt phương án, rồi mới
vào flow này.

## 11 bước (đúng thứ tự, không bỏ/đảo)

1. **Kích hoạt** — xác nhận backlog item đang `Picked`, đóng vai Leader và xác định mức tác động (Nhỏ/Vừa/Lớn).
2. **Triệu tập BA** — đóng vai BA, nghe yêu cầu (Leader ngồi cùng nếu tác động Lớn).
3. **Nghe & phân tích** — hỏi làm rõ tới khi hiểu đúng vấn đề (cổng ①).
4. **Thiết kế** — viết **Change Spec**: copy [change-spec-template.md](../../../docs/templates/change-spec-template.md) → `docs/delivery/changes/CR-<yyyymmdd>-<slug>.md`, điền theo design-standard.
5. **Truyền đạt cho Dev + Tester + Infra** — trình bày thiết kế, KHÔNG đợi code xong mới cho Tester/Infra xem (shift-left, cổng ②).
6. **Feedback** — tự đóng 3 góc nhìn:
   - Dev: khả thi kỹ thuật, đánh đổi, rủi ro
   - Tester: khả-test, AC đủ & đo được chưa, thiếu ca lỗi-biên nào
   - Infra: bảo mật/tài nguyên/đóng gói/vùng nhạy cảm — nếu chạm vùng nhạy cảm, dùng thêm skill `security-gate`
7. **Tinh chỉnh** — cập nhật Change Spec tới khi đạt **DoR** (mọi góc nhìn ở bước 6 đồng ý) — cổng ③④.
8. **Code** — theo spec + rules 06-08 + security/performance-standard; viết test theo qa-standard (DoD).
9. **Test** — chạy theo **từng AC** + ca lỗi/biên; bug tìm được → viết test tái hiện đỏ trước, sửa.
10. **Nghiệm thu** — đối chiếu kết quả với **yêu cầu gốc + AC** (cổng ⑦); đạt → chấp nhận, chưa đạt → trả về đúng khâu (không sửa ngầm).
11. **Chốt & ship** — xác nhận đã qua đủ cổng, cập nhật `docs/specs/01-05` + `docs/rules/06-09` liên quan (dùng skill `docs-sync`), CR → "Đã nghiệm thu" (cổng ⑧).

## Sau khi ship

- `npm run check` phải xanh.
- Cập nhật backlog item → `Done` trong cùng lần giao; nếu còn việc ngoài phạm vi, tạo item mới thay vì kéo dài CR.
- Commit message: `Ref: CR-<yyyymmdd>-<slug> (FR-x)` + test đã chạy — tự soi `git diff --staged` trước khi commit.
- Bug thoát cổng phát hiện SAU nghiệm thu ⇒ mở hồ sơ bằng skill `bugfix-flow` (mục mở BUG-*), không phải delivery-flow.
