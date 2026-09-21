# Hướng dẫn vận hành luồng "Tạo task định kỳ" (Release định kỳ)

> Tài liệu dành cho cowork. Mô tả mục đích, follow chung và lịch "khi nào làm gì" của một
> chu kỳ release định kỳ, dựa trên logic backend (`server/routes/schedules.ts`,
> `server/routes/release.ts`) và data cấu hình task định kỳ hiện có (29 task definitions).

---

## 1. Mục đích của luồng công việc

Mỗi tháng team có **một đợt release định kỳ**. Toàn bộ các đầu việc chuẩn bị → deploy → theo dõi
sau release đều lặp lại y hệt nhau giữa các tháng, chỉ khác **ngày**.

Thay vì tự nhớ và tạo tay ~29 task mỗi tháng, app cung cấp nút **"Tạo task định kỳ"**:

- Cowork chỉ cần **chọn 1 ngày Release** (ngày deploy master lên production — thường là **thứ 6**).
- App tự **tính ngược/xuôi ra toàn bộ các mốc** (tuần Jack, tuần Develop, tuần Staging, tuần Demo,
  sau Demo) và sinh ra đầy đủ các task với đúng **ngày + giờ + ghi chú (template)** cho cả chu kỳ
  trải dài ~5 tuần.

➡️ **Mục đích:** chuẩn hoá quy trình release, không sót đầu việc, không sai mốc thời gian, và giảm
thao tác thủ công xuống còn **1 click + 1 lần chọn ngày**.

---

## 2. Follow chung (cách thực hiện)

### 2.1. Cách app tính các tuần từ "ngày Release"

Khi chọn ngày Release `R` (mặc định coi như **thứ 6 deploy master**), backend lấy thứ 2 của tuần
chứa `R` làm gốc (`stagingMonday`) rồi suy ra các tuần khác:

| Tuần | Vị trí so với tuần Release | Ý nghĩa |
|------|----------------------------|---------|
| **Tuần Jack**     | Release − 2 tuần | Thông báo sớm cho PM |
| **Tuần Develop**  | Release − 1 tuần | Chốt lịch + thông báo các bên |
| **Tuần Staging / Release** | Tuần chứa ngày Release (Release = thứ 6) | Deploy staging đầu tuần, deploy master ngày Release |
| **Tuần Demo**     | Release + 1 tuần | Deploy & demo môi trường demo, monitoring |
| **Sau tuần Demo** | Release + 2 tuần | Tổng hợp đóng chu kỳ |

> Lưu ý: `release.date` = thứ 6 của tuần Staging. Vì vậy hãy luôn **chọn đúng ngày deploy master làm
> ngày Release** thì các mốc còn lại mới đúng.

### 2.2. Các bước thao tác

1. Vào màn **Release định kỳ**.
2. Chọn **Ngày Release** (ngày deploy master). Phần *Tóm tắt ngày* hiển thị bên dưới để kiểm tra
   lại các mốc trước khi tạo.
3. Bấm **"Tạo task định kỳ"**.
4. **Nếu tháng đó đã có task định kỳ** → app trả về cảnh báo (mã `REGULAR_RELEASE_EXISTS`,
   *"Đã có task tồn tại, bạn có muốn tạo lại hay không"*). Có 2 lựa chọn:
   - **Hủy:** giữ nguyên task cũ.
   - **Tạo lại:** app **xoá hết task định kỳ của tháng đó** rồi sinh lại từ đầu (`force = true`).
5. Tạo xong: hiển thị *"Đã tạo N task định kỳ cho release …"* và các task xuất hiện trên lịch.

### 2.3. Một số ràng buộc kỹ thuật cần biết

- **Mỗi task release dài 15 phút** (`gio_ket_thuc = gio_bat_dau + 15p`).
- **Giờ bị kẹp trong khung 07:30 – 18:00** (giờ bắt đầu tối đa 17:45). Nếu cấu hình giờ ngoài
  khung, app sẽ tự kéo về biên.
- Task tạo ra có `loai_task = 'dinh_ky'` và được gắn `release_month` = tháng của ngày Release →
  đây là khoá để app nhận biết "tháng này đã tạo rồi" và để xoá/tạo lại đúng tháng.
- **Ghi chú (template):** task nào có gắn template sẽ tự render nội dung kèm ngày thật (ví dụ
  `{{release.date}}` → ngày deploy master). Khi **sửa nội dung template**, có thể dùng chức năng
  đồng bộ để cập nhật lại ghi chú cho các task đã tạo của ngày Release đang chọn.

---

## 3. Khi nào thực hiện việc gì (lịch chi tiết một chu kỳ)

Dưới đây là **toàn bộ 29 đầu việc** sinh ra cho một chu kỳ, xếp theo thứ tự thời gian. Cowork dùng
bảng này để theo dõi / chủ động thực hiện đúng hạn (app chỉ tạo task, **người vẫn là người làm**).

### 🟦 Tuần Jack (Release − 2 tuần)
| Thứ | Giờ | Đầu việc | Template |
|-----|-----|----------|----------|
| T2 | 10:00 | Announcement - PMs | ✅ |

### 🟩 Tuần Develop (Release − 1 tuần)
| Thứ | Giờ | Đầu việc | Template |
|-----|-----|----------|----------|
| T2 | 10:00 | Book mtg release định kỳ với 2 phía JP và VN | – |
| T5 | 13:00 | Lock - Release Schedule | ✅ |
| T6 | 10:00 | Announcement - 研究開発部 | ✅ |
| T6 | 10:15 | Announcement - VN_Release | ✅ |

### 🟧 Tuần Staging / Release (Release = thứ 6)
| Thứ | Giờ | Đầu việc | Template |
|-----|-----|----------|----------|
| T2 | 13:00 | STG - Start - 研究開発部 | ✅ |
| T2 | 16:00 | STG - End - 研究開発部 | ✅ |
| T2 | 16:15 | Verify release schedule file (Staging) | – |
| **T6 (Release)** | 13:00 | Master - Start - 研究開発部 | ✅ |
| **T6 (Release)** | 13:15 | Master - Start - VN_Release | ✅ |
| **T6 (Release)** | 15:45 | Check tình hình test của các team | – |
| **T6 (Release)** | 16:00 | Master - End - 研究開発部 | ✅ |
| **T6 (Release)** | 16:15 | Master - End - VN_Release | ✅ |
| **T6 (Release)** | 16:30 | Verify file release schedule (master) | – |

### 🟨 Tuần Demo (Release + 1 tuần)
| Thứ | Giờ | Đầu việc | Template |
|-----|-----|----------|----------|
| T2 | 09:00 | Lock - API Monitoring | ✅ |
| T2 | 09:00 | Close redmine ticket | – |
| T2 | 14:00 | Confirm tình hình chuẩn bị deploy môi trường demo với member | – |
| T2 | 16:00 | Demo - Start - 研究開発部 | ✅ |
| T2 | 16:15 | Demo - Start - VN_Release | ✅ |
| T2 | 16:45 | Demo - End - VN_Release | ✅ |
| T2 | 17:00 | Demo - End - 研究開発部 | ✅ |
| T3 | 09:30 | Nhắc thầy Phú lấy data cho file Theo dõi API latency | – |
| T3 | 10:00 | verify file release schedule (demo) | – |
| T3 | 13:00 | Confirm kết quả lấy data cho file Theo dõi API latency | – |
| T3 | 14:00 | Đánh giá thành tích / issue của member trong sprint vừa qua | – |
| T4 | 10:00 | **Tạo target version mới** (đợt kế tiếp) | – |
| T4 | 10:00 | **Tạo ticket cha (Web / Mobile)** (đợt kế tiếp) | – |
| T4 | 10:00 | **Tạo File release schedule** (đợt kế tiếp) | – |
| T6 | 09:00 | Nhắc thầy Phú lấy kết quả monitoring | – |
| T6 | 14:00 | Confirm tình hình lấy kết quả monitoring của thầy Phú | – |

### 🟥 Sau tuần Demo (Release + 2 tuần)
| Thứ | Giờ | Đầu việc | Template |
|-----|-----|----------|----------|
| T2 | 10:00 | Tổng hợp các team chưa hoàn thành Task monitoring | – |

---

## 4. Lưu ý vận hành quan trọng cho cowork

1. **Task chốt chu kỳ kế tiếp:** bộ 3 đầu việc *"Tạo target version mới"* · *"Tạo ticket cha (Web /
   Mobile)"* · *"Tạo File release schedule"* (Tuần Demo, T4 10:00 — trước 07/08/2026 là MỘT task gộp tên
   *"Thực hiện công việc chuẩn bị cho Release định kỳ"*) chính là **lời nhắc bấm "Tạo task định kỳ" cho
   release tháng sau**. Khi gặp các task này → quay lại bước 2 ở mục 2.2 để chọn ngày Release tháng tiếp
   theo. Đây là cách luồng tự nối tiếp giữa các tháng.
2. **Chỉ tạo 1 lần / tháng.** Nếu lỡ chọn sai ngày, dùng *Tạo lại* (force) để app xoá sạch task
   định kỳ tháng đó và sinh lại — **không** xoá tay từng task.
3. **Không tự sửa ngày/giờ lung tung** sau khi tạo; nếu cần đổi mốc của cả chu kỳ thì sửa cấu hình
   "Quản lý task định kỳ" / template rồi tạo lại, để các tháng sau cũng đúng theo.
4. App **không tự gửi thông báo/deploy hộ**; nó chỉ đặt task đúng ngày giờ. Cowork vẫn phải thực
   hiện hành động thật (gửi announcement, lock file, deploy, verify…) khi đến hạn.
