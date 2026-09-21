# CR-20260807-ai-xong-danh-done-va-xem-ket-qua — AI chạy xong thì đánh dấu task hoàn thành, click task xem được AI đã làm gì

| Trường | Giá trị |
|---|---|
| Ngày | 2026-08-07 |
| Người đề xuất | Leader (tuan.vu) |
| Mức tác động | **Vừa** — đổi hành vi ghi `trang_thai`, thêm khối UI, sửa 4 helper thời gian |
| Trạng thái | ✅ **Đã nghiệm thu** — ghi chú 2026-08-21: dòng trạng thái này bị bỏ quên "Đang làm" dù cả 3 FR đã triển khai từ lâu (`daXongTrongNgay()` ở `server/lib/automation-helpers.ts` ghi rõ comment "CR-20260807"; ghi `da_hoan_thanh` ở `server/routes/automation.ts`; khối "AI đã làm gì" ở `src/components/AiKetQua.tsx` + `src/main.tsx`) — sửa lại đúng thực tế, không đổi code |

## 1. Bối cảnh

Lần đầu chạy AI thật (task #30, 07/08): AI đăng bài thành công lúc 15:55, `automation_status = done`,
nhưng `trang_thai` vẫn là `chua_thuc_hien` — task vẫn nằm trong danh sách việc phải làm dù đã xong. Người
dùng cũng không có chỗ nào xem lại AI đã làm gì (link bài, báo cáo) ngoài việc mở DB.

## 2. Mục tiêu

1. AI thực thi xong → task tự được đánh dấu hoàn thành.
2. Click vào task → thấy ngay AI đã làm gì: kết quả, link bài, cảnh báo/lý do nếu có.

## 3. Người dùng & tình huống

Leader dùng dashboard hằng ngày: nhìn timeline biết việc nào AI đã làm hộ, mở ra soát kết quả — không
phải sang Dr.JOY dò hay mở DB.

## 4. Yêu cầu chức năng

- **FR-1 (điều kiện tiên quyết, sửa bug sẵn có):** 4 helper trong `automation-helpers.ts`
  (`reconfirmNeededOnTimeChange`, `reviveNeededOnTimeChange`, `decideAutomationAction`,
  `automationDueNow`) phải hiểu "đã xong" **theo NGÀY** như API dashboard đã làm: task định kỳ hoàn thành
  ở **ngày khác** thì occurrence hôm nay vẫn phải chạy. Hiện chúng đọc `trang_thai` thô nên hễ
  `da_hoan_thanh` là bỏ qua **vĩnh viễn**.
- **FR-2:** `executeApprovedTask` ghi thành công (`done` **và** `done_with_warning` — Leader chốt
  2026-08-07) → set `trang_thai = 'da_hoan_thanh'`, `ngay_hoan_thanh = now`, trong CÙNG transaction với
  `ghiTrangThai` + `logEvent`.
- **FR-3:** Popup sửa task có khối **"AI đã làm gì"** khi task là AI và đã có dấu vết chạy: trạng thái,
  kết quả (`automationResult`), cảnh báo/lỗi (`automationError`), link bài đã đăng, thời điểm cập nhật.
- **FR-4:** `done_with_warning` vẫn giữ badge riêng **"Xong, cần xem lại"** và popup phải hiện rõ phần
  cảnh báo — bù lại việc nó cũng bị đánh done (giảm rủi ro bỏ sót của BUG-005).

## 5. Yêu cầu phi chức năng

- Không thêm endpoint mới: dữ liệu (`automationResult`/`automationError`/`automationUpdatedAt`) đã có sẵn
  trong `mapTask`, FE chỉ hiển thị.
- FR-2 phải nằm trong transaction sẵn có — không được để "đã đăng bài mà chưa đánh done".

## 6. Thiết kế

### 6.1 Máy trạng thái / dữ liệu

Không thêm cột. `trang_thai` và `automation_status` là **hai trục độc lập** và giữ nguyên như vậy:
`automation_status` mô tả lượt chạy của AI, `trang_thai` mô tả việc của người. FR-2 chỉ nối 1 chiều
(automation xong → việc xong), không có chiều ngược lại.

### 6.2 Nghiệp vụ / API

`executeApprovedTask` thêm 1 câu UPDATE trong transaction đang có. Không đổi hợp đồng API nào.

### 6.3 Tương tác với automation

FR-1 là điều kiện tiên quyết: nếu làm FR-2 mà không có FR-1, task định kỳ AI chạy xong hôm nay sẽ **không
bao giờ chạy lại** ở chu kỳ sau (`decideAutomationAction` thấy `da_hoan_thanh` là trả `null`). Đây đúng là
cái bẫy đã làm task #30 kẹt trong lúc thử nghiệm.

### 6.4 Bảo mật

Không đụng spawn-AI, không đổi whitelist tool, không thêm quyền ghi ra ngoài.

## 7. Phân tích tác động

| Vùng | Ảnh hưởng |
|---|---|
| Frontend | Popup sửa task thêm khối chỉ-đọc |
| API | Không đổi hợp đồng |
| DB | Không đổi schema; đổi CÁCH ghi `trang_thai`/`ngay_hoan_thanh` |
| Automation | FR-1 mở lại đường chạy cho occurrence của ngày sau |
| Bảo mật | Không |

## 8. Tiêu chí nghiệm thu

- **AC-1 (FR-1):** Task định kỳ AI `da_hoan_thanh` với `ngay_hoan_thanh` = HÔM QUA, tới giờ hôm nay →
  `decideAutomationAction` KHÔNG trả `null` (vẫn xử lý occurrence hôm nay).
- **AC-2 (FR-1):** Cùng task đó nhưng `ngay_hoan_thanh` = HÔM NAY → trả `null` (không chạy lại trong ngày).
- **AC-3 (FR-2):** Execute thành công → `trang_thai = 'da_hoan_thanh'` và `ngay_hoan_thanh` có giá trị.
- **AC-4 (FR-2):** Execute ra `done_with_warning` → cũng `da_hoan_thanh` (Leader chốt).
- **AC-5 (FR-2):** Execute `failed` → `trang_thai` KHÔNG đổi.
- **AC-6 (FR-3):** Popup sửa task của task AI đã chạy hiện kết quả + link; task chưa chạy thì không hiện khối đó.

## 9. Kế hoạch test

- Unit `test/unit/automation-helpers.test.ts`: AC-1, AC-2 (+ ca `canceled` vẫn bỏ qua vô điều kiện).
- Integration `test/integration/automation.test.ts`: AC-3, AC-4, AC-5.
- Component `test/client/`: AC-6.

## 10. Triển khai / rollback

Thứ tự: FR-1 (helper + test) → FR-2 (route + test) → FR-3 (UI + test) → `npm run check` → soi diff →
commit. Rollback = revert commit; không có migration dữ liệu.

## 11. Docs cần cập nhật

- [ ] `docs/specs/03-api-business-logic-spec.md` — luật "đã xong theo ngày" + việc automation đánh done

## 12. Duyệt

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-08-07 | |
| Leader | tuan.vu | 2026-08-07 | ✅ chốt qua AskUserQuestion: done_with_warning CÓ đánh done · xem kết quả trong popup sửa task |
