# BUG-20260813-ngay-dinh-ky-dinh-data-hom-nay — Chọn ngày khác nhưng cột định kỳ vẫn có dấu hiệu của hôm nay

| Trường | Giá trị |
|---|---|
| Ngày phát hiện | 2026-08-13 |
| Người phát hiện | Leader, khi dùng exe mới |
| Backlog item | — |
| Mức nghiêm trọng | ✅ Khó chịu |
| **Sinh ra bởi** | ✅ Có sẵn từ trước — vùng UI task định kỳ/date loading chưa có test race theo ngày |
| **Cổng lẽ ra phải bắt** | ✅ ⑦ Nghiệm thu |
| **Loại nguyên nhân** | ✅ RC-TEST |
| Trạng thái | ✅ Đã sửa |
| Test tái hiện | `test/client/components.test.tsx::CotDinhKy chỉ hiện vạch giờ hiện tại khi đang xem hôm nay`; `test/client/main-automation-integration.test.tsx::đổi ngày khi request cũ về trễ -> không ghi đè data của ngày mới` |

## 1. Triệu chứng

Khi chọn ngày `17/08/2026`, tiêu đề cột đã đổi sang đúng ngày nhưng màn hình vẫn có dấu hiệu của hôm nay:

- Vạch đỏ “giờ hiện tại” vẫn hiện ở khoảng 14:01 dù đang xem ngày 17.
- Có nguy cơ dữ liệu request của hôm nay về trễ rồi ghi đè dữ liệu của ngày vừa chọn, làm người dùng thấy ngày đã đổi nhưng task vẫn giống hôm nay.

## 2. Tái hiện

1. Mở app vào ngày 2026-08-13.
2. Khi request `/api/tasks?date=2026-08-13` còn đang bay, đổi input ngày sang `2026-08-17`.
3. Request ngày 17 trả về trước, rồi request hôm nay trả về sau.

- **Kỳ vọng:** UI giữ dữ liệu của `2026-08-17`; vạch giờ hiện tại chỉ xuất hiện khi đang xem chính hôm nay.
- **Thực tế:** response cũ có thể ghi đè `duLieu`; vạch giờ hiện tại không kiểm tra `laHomNay`.

## 3. Nguyên nhân gốc

- **Sai ở đâu (kỹ thuật):**
  - `taiDuLieu(date)` không có guard chống stale response. Request nào về sau cùng thì `setDuLieu(data)`, kể cả request đó thuộc ngày cũ.
  - `CotDinhKy` tính `coVachHienTai` chỉ dựa vào giờ hiện tại nằm trong khung timeline, không thêm điều kiện ngày đang xem là hôm nay.

- **Vì sao lọt qua:**
  - Test trước đây kiểm render trạng thái đơn lẻ, chưa có ca “đổi ngày khi request cũ về trễ”.
  - UI ngày định kỳ chưa có invariant rõ: mọi thành phần “thời gian hiện tại” phải tắt khi `ngayDinhKy !== hôm nay theo giờ VN`.
  - Smoke thủ công thường đổi ngày sau khi dữ liệu đã tải xong, nên khó bắt race.

## 4. Cổng nào hụt & vì sao

| Cổng | Đáng lẽ phải bắt bằng cách nào | Vì sao không bắt được |
|---|---|---|
| ⑦ Nghiệm thu | Smoke chọn một ngày tương lai/quá khứ và nhìn cả dữ liệu lẫn vạch giờ hiện tại; test tự động phải mô phỏng request cũ về trễ | Bộ test thiếu fake timer cho cột định kỳ và thiếu deferred response cho luồng đổi ngày |

## 5. Cách sửa

- **Test đỏ tái hiện:** thêm test component cho vạch giờ hiện tại và test integration cho stale response.
- **Sửa:** thêm sequence guard trong `taiDuLieu`; chỉ request mới nhất được `setDuLieu` và `setDangTai`. Thêm điều kiện `laHomNay` vào `coVachHienTai`.
- **Quét lân cận:** rà các luồng cùng kiểu trong màn chính; các hành động automation đã có lock/guard riêng trong lượt sửa trước, bug này nằm ở lane tải dashboard theo ngày.

## 6. Hành động cải tiến

| # | Thay đổi gì | Ở đâu | Trạng thái |
|---|---|---|---|
| 1 | Mọi view có input ngày và request async phải có stale-response guard hoặc test chứng minh response cũ không ghi đè state mới | [rules/06 §8](../../rules/06-rules-frontend.md); [qa-standard §5.3](../../standards/qa-standard.md) | ✅ Xong |
| 2 | Mọi UI hiển thị “hiện tại/bây giờ” trong view theo ngày phải gate bằng “ngày đang xem là hôm nay” | [rules/06 §8](../../rules/06-rules-frontend.md); [qa-standard §5.3/§8](../../standards/qa-standard.md) | ✅ Xong |

## 7. Liên kết

- Commit sửa: chưa commit trong phiên này.
- Bối cảnh phát hiện: [docs/exchanges/2026-08-13.md](../../exchanges/2026-08-13.md)
- Bug cùng họ: [BUG-20260804-gio-may-lot-3-call-site](BUG-20260804-gio-may-lot-3-call-site.md) — cùng vùng “UI thời gian/ngày nhìn đúng ở hôm nay nhưng sai khi đổi mốc”.
