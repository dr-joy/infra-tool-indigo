---
name: bugfix-flow
description: Đường B — sửa lỗi rõ ràng, không đổi hợp đồng API/DB, không cần Change Spec. Dùng khi user báo bug hoặc bạn tự phát hiện lỗi hành vi. Bắt buộc viết test đỏ tái hiện TRƯỚC khi sửa. Nếu phân vân giữa bugfix và thêm/sửa chức năng, dùng delivery-flow thay vì cái này.
---

# Bugfix Flow — Đường B

Nguồn đầy đủ: [team-operating-standard.md §5.0](../../../docs/standards/team-operating-standard.md),
[qa-standard.md §3](../../../docs/standards/qa-standard.md).

## Điều kiện dùng đường này

Thông thường bug phải có [backlog item](../../../docs/backlog/README.md) đã được Leader `Picked`. Ngoại lệ:
bug production khẩn cấp, sai/mất dữ liệu, bảo mật hoặc bug thoát cổng có thể mở BUG và xử lý ngay; Leader link
vào backlog sau nếu còn cần xếp lịch. Finding thuộc CR chưa nghiệm thu ở lại trong CR, không tách BUG/backlog.

Lỗi **rõ ràng**, sửa **không đổi hợp đồng API/DB**. Câu hỏi phân loại: *"sửa này có làm ai đó phải học
lại cách dùng, hay có thể hỏng dữ liệu/chức năng khác không?"* → **Có** ⇒ dùng `delivery-flow` thay vì
cái này. Phân vân ⇒ chọn `delivery-flow`.

## Các bước

1. **Tái hiện** — viết 1 test mô phỏng đúng bug. Chạy → phải **đỏ** (xanh nghĩa là chưa tái hiện đúng).
2. **Sửa** — sửa nguyên nhân gốc, không patch triệu chứng, tới khi test xanh.
3. **Chống tái phát** — giữ test đó lại vĩnh viễn (regression test), đặt tên gợi bug.
4. **Quét lân cận** — quét **bằng máy** (grep/script), theo **API/hành vi thật gây lỗi**, không theo tên
   hàm mình nhớ ra. Chỉ ghi "đã quét lân cận" khi kèm **một lệnh chạy lại được** + kết quả của nó — nhớ
   ra vài chỗ không tính là đã quét. Nhớ quét cả **helper** dựng ra giá trị sai, không chỉ API bị cấm.
5. **`npm run check`** phải xanh (test mới + toàn bộ suite + tsc + build).
6. **Tự soi `git diff --staged`** như review code người khác.
7. **Commit** — message ghi rõ đã sửa gì + test nào chứng minh.
8. **Khép backlog** — cập nhật item `Done` trong cùng lần giao, hoặc ghi blocker/bước tiếp theo nếu chưa thể đóng.

Không cần Change Spec, không triệu tập vai nào khác.

> Quy trình sửa hụt nhưng **không phải bug** (AC đặt sai, docs lệch code, cổng mô tả thứ không tồn tại)
> ⇒ ghi 1 dòng vào [Sổ Sai lệch & Bài học](../../../docs/delivery/README.md#5b-sổ-sai-lệch--bài-học-lesson) — tín hiệu hay bị mất nhất vì không có lỗi nào nhắc ghi.

## Khi nào cần mở hồ sơ `BUG-*`

Chỉ khi bug đã **thoát cổng** — lọt tới sau nghiệm thu / phát hiện lúc dùng thật, hoặc gây sai-mất dữ
liệu/bảo mật. Bug bắt được ngay trong lúc code/test thì **không cần hồ sơ**.

Nếu thoát cổng:
1. Copy [bug-record-template.md](../../../docs/templates/bug-record-template.md) → `docs/delivery/bugs/BUG-<yyyymmdd>-<slug>.md`.
2. Điền đủ: **CR sinh ra nó** (hoặc "có sẵn từ trước"/"không truy được"), **cổng ①–⑧ nào hụt**, **mã RC** (RC-REQ/SPEC/IMPL/TEST/DATA/INTEG/PERF/SEC/DOC/PROC), và **hành động cải tiến cụ thể** — không chấp nhận "lần sau cẩn thận hơn".
3. Nếu hành động cải tiến là sửa/thêm rule → cập nhật đúng standard chịu trách nhiệm theo mã RC.
