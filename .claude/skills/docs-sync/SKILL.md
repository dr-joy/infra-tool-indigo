---
name: docs-sync
description: Quy tắc khi tạo/sửa/di chuyển/xoá bất kỳ file trong docs/, README.md, hoặc CLAUDE.md — phân loại đúng nhóm, đặt tên, cập nhật bản đồ, đồng bộ với code. Dùng ở bước cuối của delivery-flow hoặc bất kỳ lúc nào một thay đổi code kéo theo phải sửa doc.
---

# Docs Sync

Nguồn đầy đủ: [docs-standard.md](../../../docs/standards/docs-standard.md).

## Trước khi tạo doc mới

1. Tìm doc **cùng vai trò** đã có để sửa/mở rộng — trùng vai trò là mùi lỗi, không tạo file mới.
2. Xác định đúng 1 nhóm (không có nhóm phù hợp ⇒ thêm nhóm mới vào `docs/README.md`, đừng nhét vào `_archive/`):

| Nhóm | Thư mục | Trả lời câu hỏi |
|---|---|---|
| Specs | `docs/specs/01-05` | Hệ thống LÀ gì hiện tại |
| Rules | `docs/rules/06-09` | Xây dựng NHƯ THẾ NÀO |
| Standards | `docs/standards/` | Chúng ta LÀM VIỆC ra sao |
| Playbooks | `docs/playbooks/` | Các bước khi XÂY |
| Operations | `docs/operations/` | Vận hành & duy trì cái đã xây |
| Backlog | `docs/backlog/` | Còn việc gì, ưu tiên nào, Leader đã pick chưa |
| Exchanges | `docs/exchanges/` | Trao đổi bất đồng bộ, chưa chốt |
| Proposals | `docs/proposals/` | Thiết kế chưa triển khai |
| Delivery | `docs/delivery/` | Đã làm gì (CR) / đã hỏng gì (BUG) — không xoá, vĩnh viễn |
| Templates | `docs/templates/` | Khuôn điền |
| Archive | `docs/_archive/` | Hết hiệu lực, giữ lịch sử |

3. Đặt tên theo quy ước: specs/rules `NN-kebab.md`, standards `*-standard.md`/`*-strategy.md`, playbooks
   `*-playbook.md`, CR `CR-<yyyymmdd>-<slug>.md`, BUG `BUG-<yyyymmdd>-<slug>.md`.

## Khi sửa xong

- [ ] Specs/rules có dòng `Nguồn:` trỏ đúng file code thật (không trỏ file đã xoá/đổi tên) — `npm run check` tự kiểm đường dẫn này.
- [ ] Code đổi hành vi ⇒ doc liên quan cập nhật **trong cùng lần giao** — kể cả `README.md`/`CLAUDE.md` gốc:

| Đổi gì trong code | Doc gốc phải sửa |
|---|---|
| Thêm/đổi/xoá script `package.json` | `README.md` (mục lệnh) + `CLAUDE.md` (Lệnh nhanh) |
| Đổi hành vi tính năng README có mô tả | `README.md` |
| Đổi kiến trúc | `CLAUDE.md` (Kiến trúc tóm tắt) |
| Đổi quy trình/cổng chất lượng | `CLAUDE.md` (Definition of Done) |

- [ ] Đổi cấu trúc/di chuyển/xoá doc ⇒ cập nhật `docs/README.md` (bản đồ) + link tương đối liên quan trong cùng lần giao.
- [ ] Thư mục có index (`README.md`) ⇒ cập nhật index đó.
- [ ] Doc hết hiệu lực ⇒ `git mv` vào `docs/_archive/` (không xoá trắng), thêm banner đầu file trỏ bản thay thế.
- [ ] `npm run check` xanh (tự kiểm link hỏng + dòng Nguồn + lệnh `npm run` được nhắc trong doc).

## Ngoại lệ

`docs/delivery/changes/` và `docs/delivery/bugs/` **không bao giờ** archive hay xoá — là dữ liệu thống
kê vĩnh viễn, kể cả CR đã "Đã nghiệm thu" hay BUG đã "Đã rút kinh nghiệm".
