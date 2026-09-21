---
name: ket-phien
description: >-
  Ghi điểm dừng phiên làm việc vào docs/exchanges/YYYY-MM-DD.md cho phiên
  Codex/Claude kế tiếp
metadata:
  user-invocable: true
  disable-model-invocation: true
---

Kết phiên — ghi lại trạng thái để Codex/Claude phiên sau đọc và nối tiếp:

1. Lấy ngày hôm nay dạng `yyyy-mm-dd` (dùng `date +%Y-%m-%d` qua Bash nếu cần).
2. Mở/tạo `docs/exchanges/<yyyy-mm-dd>.md` (nếu file ngày hôm nay chưa có, tạo mới theo format các file
   exchanges đã có; nếu đã có, nối thêm — không ghi đè).
3. Thêm một mục **"Điểm dừng"** ở cuối file, gồm:
   - **Tóm tắt ngắn gọn bằng lời thường** (không thuật ngữ/code) — việc gì đã làm xong trong phiên này.
   - Việc **đang dở** (nếu có) — bước tiếp theo cụ thể.
   - Câu hỏi/quyết định còn treo cần user hoặc phiên sau xử lý — **kẻ bảng** nếu có nhiều lựa chọn (theo
     quy tắc ở CLAUDE.md mục "Đầu phiên, backlog & vấn đề còn mở").
   - Việc mới phát hiện ngoài phạm vi hiện tại ⇒ thêm/cập nhật item trong `docs/backlog/README.md`; không để
     exchange thành backlog ngầm.
   - Nếu Leader đã `Picked` item đường C ⇒ nhắc rõ đã mở CR (`/mo-cr`) hay chưa; item chưa pick thì không mở CR.
4. Cập nhật bảng "File hiện có" trong `docs/exchanges/README.md` nếu đây là file exchanges đầu tiên của ngày.
5. Báo cho user đường dẫn file đã ghi.
