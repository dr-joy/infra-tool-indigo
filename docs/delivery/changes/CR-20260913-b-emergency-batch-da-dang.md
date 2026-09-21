# CR-20260913-b-emergency-batch-da-dang — Cờ "đã đăng bài" cho đợt release khẩn cấp

| Trường | Giá trị |
|---|---|
| Loại | ✅ Sửa hành vi |
| Mức tác động | ⬜ Nhỏ ✅ **Vừa** (đụng DB + hợp đồng API + thêm màn hiển thị mới) |
| Người đề xuất | Leader (user) — phân tích BA bởi Claude |
| Ngày | 2026-09-13 |
| Backlog item | `BL-20260913-003` (trạng thái `Picked`) |
| Trạng thái | ⬜ Draft ⬜ Đã review ⬜ Đã duyệt ⬜ Đã triển khai ✅ **Đã nghiệm thu** |
| Spec liên quan | [03](../../specs/03-api-business-logic-spec.md) · [04](../../specs/04-database-design.md) · [rules/07](../../rules/07-rules-backend.md) · [rules/08](../../rules/08-rules-database.md) |

## 1. Bối cảnh & Vấn đề

`PATCH /schedules/emergency-release/batches/:releaseMonth` là đường **duy nhất** được phép sửa
`teams`/`systems` của một đợt release khẩn cấp đã tồn tại (đường tạo task giai đoạn 1 tự ghi canonical
lần đầu, sau đó bị guard `409 EMERGENCY_BATCH_TEAMS_MISMATCH` chặn nếu gửi lại giá trị khác).

Trước khi xoá AI automation (CR-20260912), route này còn một lớp chặn thứ hai: không cho sửa nếu batch
còn task Announcement chưa ở trạng thái "idle" — dựa vào cột `automation_status`/`automation_contract`.
Cả hai cột đó đã bị xoá cùng AI automation. Comment ngay tại route (`server/routes/schedules.ts:566-572`)
tự ghi nhận: đây là **mất một lớp bảo vệ thật**, không phải chủ đích, vì giờ đăng bài là thao tác thủ
công nên không còn tín hiệu nào để dựa vào — và đề xuất sẵn hướng vá: "cờ đã đăng thủ công do người dùng
tự đánh dấu".

Đào sâu thêm khi kiểm kê: route này **không có UI nào gọi tới**, và dữ liệu `emergencyBatches` (đã
`fetch` ở `src/screens/release.tsx:2203-2217`) **chưa từng được render** — team/hệ thống của một đợt
khẩn cấp hiện không xem được ở bất kỳ đâu trên giao diện, kể cả muốn sửa cũng không có chỗ.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Một đợt release khẩn cấp có thể được đánh dấu **"đã đăng bài"** thủ công.
  - Sau khi đánh dấu, sửa `teams`/`systems` của đợt đó bị chặn (`409`) trừ khi người dùng **xác nhận rõ
    ràng** là biết bài đã đăng không còn khớp — xác nhận xong thì cờ tự về lại "chưa đăng" (nội dung cũ
    đã lỗi thời, phải đăng lại).
  - Có một chỗ trên giao diện xem được team/hệ thống + trạng thái đã đăng của từng đợt, và sửa được khi
    cần — không còn phải gọi API tay.
- **Ngoài phạm vi (không làm lần này):**
  - Không xây lại toàn bộ quy trình phân quyền nhiều team của CR-20260913 (route inventory FR-41 vẫn xử
    lý route này khi tới lát 3 — CR này chỉ vá đúng lỗ hổng hiện tại trên bản một-người-dùng).
  - Không đổi cơ chế tạo batch ở giai đoạn 1 (POST vẫn giữ nguyên).
  - Không thêm lịch sử/audit log cho việc đổi cờ (dự án chưa có bảng audit; việc này thuộc CR-20260913).

## 3. Người dùng & Kịch bản

- **Là người dùng đã đăng bài thông báo release khẩn cấp ra ngoài** (Dr.JOY/chat), tôi muốn đánh dấu đợt
  đó "đã đăng" trong app, để nếu sau này tôi (hoặc ai đó) lỡ sửa nhầm team/hệ thống, app nhắc tôi biết bài
  đã đăng sẽ không còn khớp nữa, thay vì âm thầm cho sửa.
- **Là người dùng phát hiện gõ sai tên team lúc tạo đợt**, tôi muốn có chỗ trên UI để sửa lại team/hệ
  thống của đợt đó, thay vì phải tự gọi API bằng tay.

## 4. Yêu cầu chức năng

- **FR-1:** Thêm cột `da_dang INTEGER NOT NULL DEFAULT 0` vào bảng `emergency_release_batches`, migration
  idempotent theo đúng khuôn `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` đã dùng trong
  `server/db-migrations.ts`.
- **FR-2:** `PATCH /schedules/emergency-release/batches/:releaseMonth` nhận thêm 2 trường tuỳ chọn trong
  body: `daDang?: boolean` và `xacNhanDoiSauKhiDaDang?: boolean`.
  - Gửi `daDang` (không kèm `teams`/`systems`) → chỉ set cờ, không đụng team/hệ thống.
  - Gửi `teams`/`systems` như hiện tại: nếu batch đang có `da_dang = 1` **và** giá trị mới khác giá trị
    đang lưu **và** `xacNhanDoiSauKhiDaDang` không phải `true` → trả `409` với `code:
    'EMERGENCY_BATCH_ALREADY_POSTED'` và message giải thích rõ.
  - Nếu `xacNhanDoiSauKhiDaDang: true` → cho sửa **và tự động đặt lại `da_dang = 0`** (nội dung đã đăng
    không còn khớp thực tế, buộc phải đánh dấu lại sau khi đăng bản mới).
- **FR-3:** `GET /schedules/emergency-release/batches` trả thêm `teams: string[]`, `systems: string[]`,
  `daDang: boolean` cho mỗi đợt — lấy từ `emergency_release_batches` theo đúng **khoá giai đoạn 1**
  (dùng lại `emergencyBatchKeyOf()` đã có, vì giai đoạn 2 không có dòng riêng trong bảng batch).
- **FR-4:** Thêm một khu vực hiển thị trong tab Release khẩn cấp: danh sách đợt (`emergencyBatches`, đã
  fetch sẵn nhưng chưa từng render) — mỗi dòng hiện ngày release, team, hệ thống, trạng thái đã đăng
  (badge), nút sửa team/hệ thống (mở lại đúng luồng nhập đã có), nút bật/tắt "Đã đăng bài".

## 5. Yêu cầu phi chức năng

- Giữ nguyên transaction pattern `withTransaction()` đã dùng trong route.
- Không đổi hành vi của route POST tạo task giai đoạn 1/2.
- Migration phải chạy lại an toàn nhiều lần (idempotent).

## 6. Thiết kế giải pháp

### 6.1. UI (tham chiếu `src/screens/release.tsx`)

Thêm section "Các đợt release khẩn cấp" ngay dưới khu vực đăng ký lịch hiện có, dùng lại
`emergencyBatches` đã fetch. Mỗi dòng:

```
[Ngày release] [Team: Dev1, Dev2] [Hệ thống: Dr.JOY]  [● Đã đăng bài]  [Sửa]
```

Badge "Đã đăng bài" bấm được để toggle (gọi FR-2 với `daDang`). Nút "Sửa" mở lại đúng form nhập
team/hệ thống hiện có (tái dùng, không viết mới); nếu server trả `409 EMERGENCY_BATCH_ALREADY_POSTED`,
hiện popup xác nhận "Đợt này đã đánh dấu đã đăng — sửa sẽ tự bỏ đánh dấu, bạn có chắc?" rồi gửi lại kèm
`xacNhanDoiSauKhiDaDang: true` nếu đồng ý.

### 6.2. API

Xem FR-2, FR-3. Không thêm endpoint mới — mở rộng đúng 2 route đã có.

### 6.3. Dữ liệu & schema

```sql
ALTER TABLE emergency_release_batches ADD COLUMN da_dang INTEGER NOT NULL DEFAULT 0;
```

Không cần backfill — batch cũ mặc định `da_dang = 0` (chưa đăng), đúng thực tế vì cờ này mới xuất hiện.

## 7. Phân tích tác động

- ✅ Frontend (`release.tsx`) · ✅ API route (`schedules.ts`) · ✅ DB/migration · ⬜ Automation/MCP
- ⬜ i18n · ⬜ Đóng gói · ✅ Bảo mật (vá đúng lỗ hổng đã nêu) · ✅ Dữ liệu cũ/backward-compat (cột mới, default an toàn)

**Rủi ro & giảm thiểu:**

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Người dùng bấm nhầm "Đã đăng" rồi không nhớ | Thấp | Toggle 2 chiều, tắt lại được bất cứ lúc nào không cần xác nhận |
| Guard chặn nhầm khi teams/systems gửi lên giống hệt giá trị cũ | Thấp | Chỉ chặn khi giá trị **khác** giá trị đang lưu — so sánh JSON đã chuẩn hoá |

**Ảnh hưởng chức năng đang chạy:** không đổi hành vi tạo task giai đoạn 1/2; chỉ thêm khả năng sửa
sau và một khu vực hiển thị mới, hiện tại đang là dữ liệu chết (fetch nhưng không render).

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1):** Given DB cũ chưa có cột `da_dang` / When migration chạy / Then cột được thêm với
  default `0`; chạy migration lần hai không lỗi, không đổi dữ liệu.
- **AC-2 (FR-2):** Given batch có `da_dang = 0` / When PATCH đổi `teams` khác giá trị cũ, không kèm
  `xacNhanDoiSauKhiDaDang` / Then thành công (không có gì để chặn).
- **AC-3 (FR-2):** Given batch có `da_dang = 1` / When PATCH đổi `teams`/`systems` khác giá trị cũ, không
  kèm `xacNhanDoiSauKhiDaDang` / Then `409 EMERGENCY_BATCH_ALREADY_POSTED`, dữ liệu không đổi.
- **AC-4 (FR-2):** Given batch có `da_dang = 1` / When PATCH kèm `xacNhanDoiSauKhiDaDang: true` và
  `teams`/`systems` mới / Then cập nhật thành công **và** `da_dang` tự về `0`.
- **AC-5 (FR-2):** Given batch bất kỳ / When PATCH chỉ gửi `daDang: true`, không gửi `teams`/`systems` /
  Then chỉ cờ đổi, `teams`/`systems` giữ nguyên.
- **AC-6 (FR-2):** Given batch có `da_dang = 1` / When PATCH gửi `teams`/`systems` **giống hệt** giá trị
  đang lưu / Then thành công, không bị chặn (không có gì thay đổi thật).
- **AC-7 (FR-3):** Given batch giai đoạn 1 có `teams=['Dev1'], systems=['Dr.JOY'], da_dang=1` / When GET
  danh sách đợt / Then cả giai đoạn 1 và giai đoạn 2 cùng `release_month` gốc đều trả đúng 3 trường này
  (giai đoạn 2 đọc qua khoá giai đoạn 1).
- **AC-8 (FR-4):** Given có ít nhất 1 đợt khẩn cấp / When mở tab Release khẩn cấp / Then thấy danh sách
  đợt với team/hệ thống/trạng thái đã đăng; bấm "Sửa" mở đúng form nhập.

## 9. Kế hoạch test

- Tầng test: ✅ Unit (helper so sánh teams/systems) ✅ Integration route (`test/integration/schedules*`)
- Ca chính + ca biên: cả 8 AC ở trên; thêm ca "sửa systems nhưng teams giữ nguyên" (chỉ 1 trong 2 mảng
  đổi vẫn phải bị chặn/qua đúng như đổi cả hai); ca release-month không tồn tại vẫn `404` như cũ.

## 10. Kế hoạch triển khai / rollback

- Migration chạy tự động lúc khởi động server (như mọi migration khác trong `db-migrations.ts`).
- Rollback: cột mới có default an toàn, không cần rollback dữ liệu; revert code là đủ nếu cần lùi.

## 11. Docs cần cập nhật sau khi làm xong

- [ ] [docs/03](../../specs/03-api-business-logic-spec.md) — hợp đồng PATCH/GET batches mới
- [ ] [docs/04](../../specs/04-database-design.md) — cột `da_dang`

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-09-13 | ✅ |
| Người triển khai | Claude | 2026-09-13 | ✅ code + test xong |
| QA nghiệm thu | Claude (tự đối chiếu AC, chưa qua Leader) | 2026-09-13 | ✅ 8/8 AC có test PASS |

**Tự soi 3 góc nhìn (bước 6 delivery-flow, quy mô nhỏ nên tự đóng, không cần Council):**

- **Dev:** rủi ro duy nhất đáng kể là so sánh `teams`/`systems` mới-cũ phải chuẩn hoá đúng cách (thứ tự
  mảng, khoảng trắng) trước khi so — nếu so sai chuỗi JSON thô, thứ tự khác nhau nhưng nội dung giống
  nhau sẽ bị chặn oan. Dùng lại `parseEmergencyBatchTeamsSystems()` đã có sẵn logic chuẩn hoá.
- **Tester:** AC-6 (giá trị giống hệt không bị chặn) dễ bị bỏ sót nếu chỉ test đường "khác nhau" — phải
  có ca riêng.
- **Infra:** không đụng gì tới đóng gói/hạ tầng; migration chạy an toàn trên DB đang có dữ liệu thật.

**Kết quả thật (2026-09-13):** 7 test integration mới (`test/integration/emergency-release-batches.test.ts`,
phủ đúng AC-1, AC-3, AC-4, AC-5, AC-6, AC-7; AC-2 đã có sẵn từ test cũ "PATCH batch tồn tại... ghi đè
teams/systems"; AC-8 xác nhận bằng đọc code UI + `npm run build`). `npm run check` xanh toàn bộ 9/9 cổng
máy kiểm được (302 test backend+frontend PASS). Đã `npm run package` — exe cập nhật, TaskManager.exe lúc
kiểm tra **không đang chạy** nên không cần khởi động lại. **QA nghiệm thu tự đối chiếu**, chưa qua Leader
xác nhận UI thật trên máy — Leader nên tự mở app một lần để xác nhận màn "Các đợt release khẩn cấp" và
luồng sửa/đánh dấu hoạt động đúng ý trước khi coi là khép hẳn.
