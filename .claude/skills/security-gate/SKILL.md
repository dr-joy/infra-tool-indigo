---
name: security-gate
description: Checklist bảo mật bắt buộc khi chạm vùng nhạy cảm secret, spawn tiến trình con/AI, serve file, import dữ liệu, SQL động, đóng gói/phân phối, hoặc thêm endpoint mới. Dùng trong bước Infra review của delivery-flow, hoặc bất kỳ lúc nào code chạm các vùng này kể cả ở đường A/B.
---

# Security Gate

Nguồn đầy đủ: [security-standard.md](../../../docs/standards/security-standard.md).

## Vùng nhạy cảm (trigger)

secret · spawn/AI · serve file · import · SQL động · đóng gói · endpoint mới

## Cổng review (bắt buộc trước khi coi là xong)

- [ ] Không có secret/token trong log, response, commit.
- [ ] Input mới đã validate (shape + size + scheme); SQL dùng prepared statement — `${...}` trong SQL
      chỉ được là placeholder sinh động hoặc hằng số, **không nội suy giá trị user**.
- [ ] Không nới bề mặt mạng (vẫn bind `127.0.0.1`); không thêm host ngoài không kiểm soát.
- [ ] Hành động AI ghi ra ngoài vẫn cần người duyệt; không bypass permission.
- [ ] Error không lộ stack/SQL/path (trả `message` generic, log chi tiết server-side).
- [ ] Dep mới (nếu có) đã `npm audit` + đánh giá cần thiết.

## Riêng khi spawn AI/tiến trình con

- [ ] Prompt đẩy qua **stdin**, không qua argv.
- [ ] Không dùng `--dangerously-skip-permissions`.
- [ ] Tính read-only đến từ **whitelist tool**, không từ tên cờ (`--permission-mode plan` KHÔNG phải chỉ-đọc).
- [ ] Pha ghi vẫn cần được cấp tool ĐỌC để tự kiểm trước khi ghi (không ra lệnh "kiểm tra rồi hãy đăng" mà chỉ cấp tool ghi).
- [ ] Lần chạy thật đầu tiên nhắm **đích nháp**, không phải đích thật.
- [ ] Có timeout + SIGKILL cho tiến trình spawn.
- [ ] Kiểm chứng bằng CLI thật hai chiều (đọc được / bị chặn ghi) — mock không tính vì không đọc cờ quyền.

## Riêng khi serve file / upload

- [ ] Chặn path traversal (`path.basename` + kiểm prefix).
- [ ] `Content-Disposition: attachment` hoặc whitelist MIME cho HTML/SVG (tránh stored-XSS).

## Riêng khi đóng gói (SEA)

- [ ] Không nhúng secret vào `.exe`.
- [ ] DB tạo ở `%APPDATA%/TaskManager/data/`, không phải thư mục build/temp.
