# Change Specs (CR)

> Mỗi thay đổi chức năng (thêm/sửa/xóa) tạo 1 file tại đây theo quy chuẩn
> [design-standard](../../standards/design-standard.md). Sổ cái tổng: [../README.md](../README.md).

## Cách dùng

Các bước tạo/điền/duyệt CR đã chuyển sang skill
[`.claude/skills/delivery-flow/SKILL.md`](../../../.claude/skills/delivery-flow/SKILL.md) (bước 4, 7, 11)
— dùng slash command `/mo-cr <slug>` để dựng khung file nhanh. File này chỉ giữ phần riêng của thư mục:
mapping Bug↔CR và quy tắc không xoá.

## Liên hệ với Bug

Bug thoát cổng sinh ra từ một CR ⇒ hồ sơ [BUG](../bugs/README.md) phải ghi mã CR đó ở trường
**"Sinh ra bởi"**, và cột **"Bug sinh ra"** của CR trong sổ cái được cập nhật ngược lại.
Mapping hai chiều này là thứ cho phép trả lời *"CR nào đắt nhất"* và *"cổng nào hay hụt"*
([../README.md §6](../README.md)).

File CR giữ lại làm **lịch sử quyết định** — không xóa sau khi hoàn thành.
