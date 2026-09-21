# BUG-20260807-digest-da-lo-khong-chan-ngay — Mở lịch sang ngày khác vẫn bị mời "Chạy bù ngay" task AI đã lỡ của hôm nay

| Trường | Giá trị |
|---|---|
| Ngày phát hiện | 2026-08-07 |
| Người phát hiện | Leader (dùng thật) |
| Mức nghiêm trọng | ☑ Sai dữ liệu (bấm "Chạy bù ngay" = đăng bài THẬT ra Dr.JOY trong khi tưởng đang thao tác trên ngày khác) |
| **Sinh ra bởi** | ☑ Có sẵn từ trước — digest ra đời cùng cơ chế `missed`, chưa từng có ràng buộc ngày |
| **Cổng lẽ ra phải bắt** | ☑ ② Thiết kế |
| **Loại nguyên nhân** | ☑ RC-SPEC |
| Trạng thái | ☑ Đã sửa |
| Test tái hiện | `test/client/automation-ask.test.ts::locTaskDaLo — digest task AI đã lỡ giờ` |

## 1. Triệu chứng

Đang xem một ngày khác hôm nay trên màn hình lịch (vd nhảy sang ngày tương lai), app vẫn bật popup
**"Task AI đã lỡ giờ hôm nay (n)"** liệt kê task AI của HÔM NAY và mời **Chạy bù ngay**.

## 2. Tái hiện

1. Có 1 task định kỳ AI (`actionType = post`, vd task #30 lặp thứ 6) đang ở `automation_status = missed`.
2. Trên màn hình lịch, chuyển ngày đang xem sang một ngày khác hôm nay.
3. Popup digest hiện lên với task đó.

- **Kỳ vọng:** digest chỉ hiện khi đang xem đúng ngày hôm nay — giống 2 vòng quét còn lại của automation.
- **Thực tế:** hiện ở mọi ngày đang xem; bấm "Chạy bù ngay" là vào thẳng luồng preview → duyệt → ĐĂNG THẬT.

## 3. Nguyên nhân gốc

- **Sai ở đâu (kỹ thuật):** digest lọc danh sách CHỈ theo `automationStatus` (`missed`/`auto_canceled`),
  không đối chiếu ngày đang xem. Mà `automation_status` là cột **toàn cục của một dòng task**, còn task
  định kỳ (`ngay_cu_the = null`) chỉ là **MỘT dòng** được hiện lại ở mọi ngày khớp lịch. Nên "trạng thái
  của occurrence hôm nay" bị đọc như "trạng thái của mọi occurrence".
- **Vì sao lọt qua:** hai vòng quét automation còn lại (vòng hỏi trong `useAutomation.ts`, vòng thông báo
  trong `main.tsx`) ĐỀU có chốt `if (ngayDinhKy !== currentVietnamDateInputValue()) return;`. Digest được
  thêm sau, viết inline trong JSX nên không đi qua hàm thuần nào có unit test — không có chỗ nào để luật
  "chỉ xử lý occurrence hôm nay" được nhắc lại. Ràng buộc này chưa bao giờ được viết ra thành quy tắc
  chung, chỉ tồn tại dưới dạng 2 dòng `if` lặp lại ở 2 nơi.

## 4. Cổng nào hụt & vì sao

| Cổng | Đáng lẽ phải bắt bằng cách nào | Vì sao không bắt được |
|---|---|---|
| ② Thiết kế | Khi thêm digest phải hỏi "nó có phải là quyết-định-theo-thời-gian không?" — nếu có thì thuộc vùng đã có luật (chỉ occurrence hôm nay) và phải tách hàm thuần + test như `locUngVienHoi` | Digest bị coi là "chỉ hiển thị danh sách", không nhận ra nó có nút dẫn thẳng tới hành động GHI ra ngoài, nên không ai soi nó theo luật thời gian |

## 5. Cách sửa

- **Test đỏ tái hiện** (viết TRƯỚC khi sửa): 4 ca trong
  [test/client/automation-ask.test.ts](../../../test/client/automation-ask.test.ts) — xem ngày mai / xem
  ngày cũ phải trả `[]`; xem đúng hôm nay vẫn trả task; nhận cả `auto_canceled`; bỏ qua task không phải AI.
  Chạy trước khi sửa: **4 failed** (`locTaskDaLo is not a function`).
- **Sửa:** thêm hàm thuần `locTaskDaLo(tasks, ngayDangXem, now)` trong
  [src/lib/automation-ask.ts](../../../src/lib/automation-ask.ts) — chặn `ngayDangXem !== hôm nay` ngay
  đầu hàm; [src/main.tsx](../../../src/main.tsx) gọi hàm này thay cho `.filter()` inline.
- **Quét lân cận** (chạy bằng máy, không dựa vào trí nhớ):

  ```bash
  grep -rn "automationStatus" src/ --include=*.ts --include=*.tsx | grep -v "types.ts"
  ```

  Kết quả 4 chỗ: `automation-ask.ts:27` (`dangChoNguoiQuyetDinh` — đã được vòng quét có chốt ngày bọc
  ngoài), `automation-ask.ts:63,72` (hàm vừa thêm), và `main.tsx:1338` `automationTimelineBadge` —
  **cùng gốc lỗi, ĐÃ SỬA luôn trong lần này** (Leader chốt 2026-08-07): badge trên thanh task cũng đọc
  status toàn cục nên xem ngày khác vẫn thấy "Đã lỡ"/"Hoàn thành" của hôm nay. Đã chuyển hàm sang
  `automation-ask.ts` + chặn ngày: ngày khác → badge trung tính `AI`.
  Vì sao KHÔNG chọn "ẩn badge" hay "hiện Chưa duyệt": badge là dấu hiệu DUY NHẤT nhận ra task có bật AI
  (ẩn đi sẽ tưởng chưa cấu hình), còn "Chưa duyệt" thì đúng cho ngày tương lai nhưng SAI cho ngày quá khứ
  (hôm đó có thể đã chạy xong). Badge trung tính không khẳng định trạng thái nào — khớp đúng sự thật là
  app không lưu trạng thái theo từng ngày.
  Phía server không dính: vòng tick đã lọc qua `occurrenceIsToday()` (`server/lib/automation-helpers.ts`).

## 6. Hành động cải tiến

| # | Thay đổi gì | Ở đâu | Trạng thái |
|---|---|---|---|
| 1 | Ghi thành luật: mọi thứ ở FE đọc `automationStatus` để **dẫn tới hành động ghi** đều phải đi qua hàm thuần trong `automation-ask.ts` có chốt "ngày đang xem = hôm nay" + unit test. Không lọc status inline trong JSX | [src/lib/automation-ask.ts](../../../src/lib/automation-ask.ts) (comment đầu hàm `locTaskDaLo`) | ☑ Xong |
| 2 | Chặn ngày cho `automationTimelineBadge`: ngày khác hôm nay → badge trung tính `AI`. Chuyển hàm từ JSX của `main.tsx` sang `automation-ask.ts` để có unit test (đúng luật #1) | [src/lib/automation-ask.ts](../../../src/lib/automation-ask.ts) `automationTimelineBadge` | ☑ Xong |
| 3 | `PATCH /api/tasks/:id` vá MỘT PHẦN cho MỌI trường (`undefined` = giữ nguyên), thay vì nửa partial nửa xoá-trắng | [server/routes/tasks.ts](../../../server/routes/tasks.ts) | ☑ Xong |
| 4 | `blocked` có nhãn badge RIÊNG ("Bị chặn"), không gộp vào "Chưa duyệt" | [src/lib/automation-ask.ts](../../../src/lib/automation-ask.ts) | ☑ Xong |
| 5 | Muốn hiện ĐÚNG trạng thái automation của ngày quá khứ thì phải tra `automation_events` theo `occurrence_key` — dữ liệu đã có sẵn, thiếu endpoint. Thuộc Đường C, chưa làm | `server/routes/automation.ts` (endpoint mới) | ⬜ Chưa (backlog) |

## 6b. Hai lỗi cùng phiên, lộ ra khi Leader thử chạy thật (2026-08-07, đã sửa luôn)

**(A) `PATCH /api/tasks/:id` xoá trắng trường không gửi — MẤT DỮ LIỆU.**
Cùng một endpoint mà nửa partial nửa full-replace: `actionType`/`aiNote`/`relatedIds` thiếu thì giữ
nguyên, còn `ghiChu`/`links`/`gioKetThuc`/`lapLaiKieu`/`ngayTrongThang`/`thuTrongTuan` thiếu thì **xoá**
(riêng `lapLaiKieu` còn tự nhảy về `hang_ngay`, đổi cả chu kỳ lặp).
Ca thật: gọi PATCH để dán `aiNote` cho task #30 → **Note của task bay sạch** → precheck trả `blocked`
lý do `empty_note`. Test: `test/integration/tasks.test.ts::BUG-20260807: PATCH chỉ gửi aiNote…` (đỏ
trước khi sửa). Sửa: `undefined` = giữ nguyên cho MỌI trường; muốn xoá phải gửi tường minh giá trị rỗng.

**(B) Badge gộp `blocked` vào "Chưa duyệt" — task kẹt mà nhìn không ra.**
`blocked` KHÔNG nằm trong nhóm được vòng quét hỏi lại (chỉ `idle`/`needs_reconfirm`), nên task ở trạng
thái này sẽ không bao giờ tự bật popup. Badge lại hiển thị y hệt "Chưa duyệt" → Leader ngồi đợi popup
không bao giờ tới, kéo giờ nhiều lần vẫn vô ích.
Càng kẹt hơn khi task đồng thời `da_hoan_thanh`: `reconfirmNeededOnTimeChange` đòi `!daXong` nên đổi giờ
cũng không hồi sinh được. Sửa: `blocked` có nhãn riêng **"Bị chặn"** (kiểu đỏ như `failed`).

## 7. Liên kết

- CR liên quan: [CR-20260807-hoi-dap-tuong-tac-automation.md](../changes/CR-20260807-hoi-dap-tuong-tac-automation.md) (cùng phiên, không phải nguyên nhân)
- Commit sửa: (điền khi commit)
- Bug tương tự đã từng gặp: [BUG-20260804-gio-may-lot-3-call-site.md](BUG-20260804-gio-may-lot-3-call-site.md)
  — cùng họ "quyết định theo thời gian bị viết lặp ở nhiều call-site, sót một chỗ"
