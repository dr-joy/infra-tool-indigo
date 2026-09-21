# BUG-20260803-automation-sai-mui-gio — Task AI bị báo "đã lỡ giờ" trước giờ chạy 2 tiếng

| Trường | Giá trị |
|---|---|
| Ngày phát hiện | 2026-08-03 |
| Người phát hiện | Leader (dùng thật trên máy làm việc) |
| Mức nghiêm trọng | ✅ Chặn dùng ⬜ Sai dữ liệu ⬜ Khó chịu ⬜ Cosmetic |
| **Sinh ra bởi** | ✅ [CR-20260801-scheduler-automation-ve-server](../changes/CR-20260801-scheduler-automation-ve-server.md) ⬜ Có sẵn từ trước khi có CR ⬜ Không truy được |
| **Cổng lẽ ra phải bắt** | ⬜ ① Yêu cầu ✅ ② Thiết kế ⬜ ③ Feedback sớm ⬜ ④ DoR ⬜ ⑤ Bàn giao test ⬜ ⑥ Cổng hạ tầng ⬜ ⑦ Nghiệm thu ⬜ ⑧ Chốt/ship |
| **Loại nguyên nhân** | ⬜ RC-REQ ✅ RC-SPEC ⬜ RC-IMPL ⬜ RC-TEST ⬜ RC-DATA ⬜ RC-INTEG ⬜ RC-PERF ⬜ RC-SEC ⬜ RC-DOC ⬜ RC-PROC |
| Trạng thái | ⬜ Mới ⬜ Đã có test đỏ ✅ Đã sửa ✅ Đã rút kinh nghiệm |
| Test tái hiện | `test/unit/automation-scheduler.test.ts` (nhóm `BUG-002`, `BUG-003`) · `test/unit/automation-helpers.test.ts` · `test/client/automation-ask.test.ts` |

## 1. Triệu chứng

Máy làm việc đặt múi giờ **Asia/Tokyo (+9)**. Task `Announcement - PMs` hẹn **10:00** (giờ VN).
Lúc **08:15 giờ VN**, popup *"Task AI đã lỡ giờ hôm nay (1)"* đã bung ra và task bị chuyển
`automation_status = 'missed'` — trong khi còn 1 giờ 45 phút nữa mới tới giờ chạy.

## 2. Tái hiện

1. Đặt múi giờ máy = `Asia/Tokyo` (+9), chạy app.
2. Tạo task định kỳ AI (`actionType = post`) giờ bắt đầu `10:00`, ngày cụ thể = hôm nay.
3. Chờ tới 08:15 giờ VN (= 10:15 JST).

- **Kỳ vọng:** task còn `idle`; 09:55 VN mới hỏi "nhờ AI làm?"; 10:15 VN mới thành `missed`.
- **Thực tế:** `due` + `asked` ghi lúc 07:55 VN, `missed` ghi lúc 08:15 VN (đúng 10:00/10:15 **JST**).

Bằng chứng trong `automation_events` của occurrence `2026-08-03:1068:10:00`:
`due` 00:55:07Z · `asked` 00:55:07Z · `missed` 01:15:07Z.

Kèm theo, một lỗi thứ hai cùng ổ được phát hiện khi soi vòng tick: task release của **ngày khác**
(vd `Book mtg…`, `ngay_cu_the = 2026-08-10`, 10:00) cũng bị đánh `missed` ngay hôm nay.

## 3. Nguyên nhân gốc

- **Sai ở đâu (kỹ thuật):**
  1. *Múi giờ.* `decideAutomationAction` dựng mốc giờ bằng `target.setHours(...)` và cắt ngày bằng
     `getFullYear/getMonth/getDate` — cả hai lấy **múi giờ của máy**. Giờ người dùng nhập lại là
     **giờ VN**: FE hiển thị/khởi tạo bằng `Asia/Ho_Chi_Minh` (`src/lib/date.ts`). Máy đặt JST ⇒ lệch 2h.
     Cùng lỗi ở `automationDueNow`, `occurrenceKeyOf`, và ở FE: `trongCuaSoNhac` (`parseLocalDateTime`),
     `occKey` + điều kiện chạy vòng đồng bộ trong `src/useAutomation.ts`.
  2. *Phạm vi ngày.* Vòng tick lấy **mọi** task `dinh_ky` + AI rồi chỉ so giờ-trong-ngày; nó không hỏi
     luật lặp (`ngay_cu_the` / `lap_lai_kieu` / `thu_trong_tuan` / `ngay_trong_thang`) như dashboard làm
     qua `recurringMatchesDate`. Hai nơi cùng trả lời câu "task nào của ngày X" nhưng chỉ một nơi có luật.
- **Vì sao lọt qua:** CR-20260801 chuyển vòng quyết-định-theo-thời-gian từ FE về server và mô tả kỹ
  *tính idempotent* + *singleton*, nhưng **không tuyên bố gốc thời gian** ("giờ nào là giờ nghiệp vụ")
  và không nói vòng tick phải dùng chung luật lặp với dashboard. Test cũ dựng mốc bằng
  `new Date(2026, 7, 1, h, m)` — cũng là giờ máy — nên trên máy dev đặt JST chúng vẫn xanh:
  test và code sai **cùng một kiểu**, triệt tiêu nhau.

## 4. Cổng nào hụt & vì sao

| Cổng | Đáng lẽ phải bắt bằng cách nào | Vì sao không bắt được |
|---|---|---|
| ② Thiết kế | Change Spec phải chốt "gốc thời gian = giờ VN" và "vòng tick dùng chung luật lặp với dashboard" như một ràng buộc, vì đây là logic **di chuyển giữa 2 tầng** (FE→BE) — nơi mọi giả định ngầm dễ rơi | Spec chỉ mô tả *ai chạy* và *chống lặp thế nào*, coi "so giờ" là chi tiết hiển nhiên. Không có ràng buộc nào để Dev/Tester đối chiếu, nên cả 3 vai đều bỏ qua |

## 5. Cách sửa

- **Test đỏ tái hiện** (viết TRƯỚC khi sửa — [qa-standard §3](../../standards/qa-standard.md)): 12 test đỏ.
  Mốc thời gian trong test đổi sang **thời điểm tuyệt đối** (`Date.UTC(..., h - 7, m)`) nên kết quả
  không còn phụ thuộc múi giờ máy chạy test.
- **Sửa:**
  - Thêm [`server/lib/vn-time.ts`](../../../server/lib/vn-time.ts) — `vietnamParts` / `vietnamDateKey` /
    `vietnamInstant` / `minutesUntilVietnam`. VN không có DST nên ghép ISO `+07:00` là đủ chính xác.
  - Thêm [`server/lib/recurrence.ts`](../../../server/lib/recurrence.ts) — luật lặp **định nghĩa một lần**;
    `mappers.recurringMatchesDate` và `automation-helpers.occurrenceIsToday` cùng gọi vào đó.
  - `decideAutomationAction`: so giờ theo VN + cổng `occurrenceIsToday`. Nhánh reset trạng thái cuối
    đặt **trước** cổng đó, để task một-lần không mắc ở trạng thái cuối vĩnh viễn.
  - FE: `vietnamInstant` trong [`src/lib/date.ts`](../../../src/lib/date.ts), dùng ở
    [`automation-ask.ts`](../../../src/lib/automation-ask.ts); `occKey` và điều kiện vòng đồng bộ trong
    [`useAutomation.ts`](../../../src/useAutomation.ts) đổi sang ngày VN để **khóa occurrence trùng server**.
- **Quét lân cận:**
  - `automationDueNow` (dùng khi tạo/sửa/đổi giờ task) — đã sửa cùng gốc VN + cổng ngày.
  - `occurrenceKeyOf` ↔ `occKey` FE: đã đối chiếu, cùng ngày VN (trước đó lệch nhau sau 22:00 VN).
  - Dữ liệu đã bị đánh sai: task id 1068 reset `missed → idle`, xoá 3 event sai
    (`due`/`asked`/`missed`) của occurrence `2026-08-03:1068:10:00` để chu kỳ hôm nay hỏi lại.
  - Dashboard `recurringMatchesDate` giữ nguyên hành vi (ngày lịch truyền vào), chỉ đổi sang gọi luật chung.

## 6. Hành động cải tiến

| # | Thay đổi gì | Ở đâu | Trạng thái |
|---|---|---|---|
| 1 | Rule: mọi so sánh thời gian nghiệp vụ phải quy về **giờ VN**; cấm `new Date(y,m,d,h,m)` / `setHours` / `getHours` trong logic quyết định | [rules/07-rules-backend.md](../../rules/07-rules-backend.md) · [rules/06-rules-frontend.md](../../rules/06-rules-frontend.md) | ✅ Xong |
| 2 | Rule: test logic thời gian phải bơm **thời điểm tuyệt đối**, không dùng giờ máy — nếu không test sẽ sai cùng kiểu với code | [standards/qa-standard.md](../../standards/qa-standard.md) | ✅ Xong |
| 3 | Rule: chuyển logic giữa 2 tầng ⇒ Change Spec phải liệt kê **giả định ngầm** đang dựa vào (múi giờ, phạm vi dữ liệu, nguồn chân lý) | [standards/design-standard.md](../../standards/design-standard.md) | ✅ Xong |

## 7. Liên kết

- CR liên quan: [CR-20260801-scheduler-automation-ve-server](../changes/CR-20260801-scheduler-automation-ve-server.md)
- Commit sửa: (điền sau khi commit)
- Bug tương tự đã từng gặp: chưa có — đây là hồ sơ đầu tiên về gốc thời gian
