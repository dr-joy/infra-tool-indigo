# Bugs — hồ sơ lỗi đã thoát cổng

> Chỉ mở hồ sơ cho lỗi **lọt qua được các cổng** (phát hiện sau nghiệm thu / lúc dùng thật), hoặc lỗi
> **sai-mất dữ liệu** / **bảo mật** dù bắt được sớm. Ngưỡng đầy đủ: [../README.md §2](../README.md).
> Khuôn: [../../templates/bug-record-template.md](../../templates/bug-record-template.md).

## Cách dùng

Các bước tái hiện/sửa/quét lân cận/mở hồ sơ đã chuyển sang skill
[`.claude/skills/bugfix-flow/SKILL.md`](../../../.claude/skills/bugfix-flow/SKILL.md) — nguồn thật duy
nhất. Sau khi mở hồ sơ, thêm một dòng vào bảng Sổ Bug ở [../README.md §5](../README.md).

## Đánh dấu để thống kê được

Trong bảng header, đổi `⬜` thành `✅` ở ô đã chọn. Các lệnh đếm ở
[../README.md §6](../README.md) dựa vào ký tự đó — để nguyên `⬜` thì hồ sơ không vào được thống kê.

## Không xóa hồ sơ

Kể cả sau khi bug đã đóng từ lâu. Chúng là dữ liệu để trả lời *"cổng nào hay hụt nhất"* — mà câu hỏi
đó chỉ có ý nghĩa khi nhìn nhiều hồ sơ cùng lúc.
