# CR-20260914-xoa-danh-sach-emergency-batch — Xoá màn "Các đợt release khẩn cấp"

| Trường | Giá trị |
|---|---|
| Loại | ✅ Xóa/Deprecate |
| Mức tác động | ⬜ Nhỏ ✅ **Vừa** (đụng DB + hợp đồng API + xoá 1 khu vực UI) |
| Người đề xuất | Leader (user) — phân tích BA bởi Claude |
| Ngày | 2026-09-14 |
| Backlog item | `BL-20260914-001` (`Picked`) |
| Trạng thái | ⬜ Draft ⬜ Đã review ⬜ Đã duyệt ⬜ Đã triển khai ✅ **Đã nghiệm thu** |
| Spec liên quan | [03](../../specs/03-api-business-logic-spec.md) · [04](../../specs/04-database-design.md) |

## 1. Bối cảnh & Vấn đề

`BL-20260913-003`/`CR-20260913-b` (2026-09-13) thêm màn "Các đợt release khẩn cấp" (danh sách batch +
badge "đã đăng bài" + popup "Sửa" team/hệ thống) — nhưng CR đó tự ghi rõ **"chưa qua Leader xác nhận UI
thật"**. Nay Leader đã xem UI thật (ảnh chụp màn hình) và đánh giá thiết kế tệ, yêu cầu xoá hẳn khu vực
này (FE hiển thị + popup sửa + toggle đăng bài) cùng phần BE/DB CHỈ phục vụ riêng nó.

Đào lại trước khi xoá: `emergency_release_batches` (bảng) và guard `409
EMERGENCY_BATCH_TEAMS_MISMATCH` trong `POST /schedules/emergency-release/tasks` **không thuộc phạm vi
này** — route POST đó là luồng tạo task giai đoạn 1/2 (màn "Quản lý task release khẩn cấp" đang giữ), vẫn
ghi/đọc `teams`/`systems` của bảng này làm canonical guard, không liên quan tới màn danh sách đang xoá.

Leader xác nhận đánh đổi: chấp nhận **không còn UI** để sửa `teams`/`systems` sau khi tạo (phải xoá task
tạo lại nếu gõ sai), nhưng **giữ route PATCH sửa team/hệ thống ở tầng API** (gọi tay khi cần) — chỉ bỏ
phần `daDang`/"đã đăng bài" (cột `da_dang`, guard `409 EMERGENCY_BATCH_ALREADY_POSTED`) vì tính năng theo
dõi đăng bài thủ công không còn UI nào dùng tới.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Màn Release khẩn cấp không còn hiển thị danh sách "Các đợt release khẩn cấp".
  - `GET /schedules/emergency-release/batches` (chỉ phục vụ danh sách) bị xoá.
  - `PATCH /schedules/emergency-release/batches/:releaseMonth` **vẫn còn**, chỉ nhận `teams`/`systems`
    (bỏ `daDang`/`xacNhanDoiSauKhiDaDang`, bỏ guard `409 EMERGENCY_BATCH_ALREADY_POSTED`).
  - Cột `emergency_release_batches.da_dang` được archive rồi drop (migration idempotent, có backup).
- **Ngoài phạm vi (không làm lần này):**
  - Không đụng `POST /schedules/emergency-release/tasks`, bảng `emergency_release_batches`
    (giữ cột `teams`/`systems`), guard `409 EMERGENCY_BATCH_TEAMS_MISMATCH`.
  - Không đụng "Quản lý template khẩn cấp"/"Quản lý task release khẩn cấp".
  - Không xây UI thay thế để sửa team/hệ thống sau khi tạo — chấp nhận chỉ còn đường API.

## 3. Người dùng & Kịch bản

- Là Leader, tôi thấy danh sách batch hiện tại không có giá trị thực tế (thiết kế tệ, chưa từng dùng
  trong vận hành thật), tôi muốn bỏ nó khỏi UI để màn Release khẩn cấp gọn lại đúng 2 chức năng còn giá
  trị: quản lý template và quản lý task định nghĩa.

## 4. Yêu cầu chức năng

- **FR-1:** Xoá khu vực UI "Các đợt release khẩn cấp" (`release-emergency-batches` list) khỏi
  `src/screens/release.tsx`.
- **FR-2:** Xoá component `PopupSuaEmergencyBatch` (UI sửa team/hệ thống + toggle đã đăng) khỏi
  `src/screens/release.tsx`.
- **FR-3:** Xoá `GET /schedules/emergency-release/batches` khỏi `server/routes/schedules.ts`.
- **FR-4:** Sửa `PATCH /schedules/emergency-release/batches/:releaseMonth`: bỏ nhánh `daDang`, bỏ guard
  `409 EMERGENCY_BATCH_ALREADY_POSTED`/`xacNhanDoiSauKhiDaDang`; giữ nguyên nhánh sửa `teams`/`systems`.
- **FR-5:** Archive rồi drop cột `emergency_release_batches.da_dang` (migration idempotent, cùng khuôn
  `archiveAndDropTanDuAiCu`/`archiveAndDropAutomationSchema` đã có trong `server/db-migrations.ts`).
- **FR-6:** Xoá type `EmergencyReleaseBatch` không còn dùng (nếu sau khi xoá #1-2 không còn call-site),
  i18n key riêng của màn này, test riêng của phần bị xoá — giữ nguyên test/i18n dùng chung với luồng tạo
  batch (POST) đang ở lại.

## 5. Yêu cầu phi chức năng

- Migration idempotent, có backup snapshot JSON+checksum trước khi drop (đúng khuôn đã dùng).
- Không đổi hành vi `POST /schedules/emergency-release/tasks`.

## 6. Thiết kế giải pháp

### 6.1. UI

Xoá hẳn `<div className="release-emergency-batches">…</div>` và mount point
`{suaEmergencyBatch && <PopupSuaEmergencyBatch .../>}`; xoá state `emergencyBatches`/`suaEmergencyBatch`,
hàm `loadEmergencyBatches`/`toggleEmergencyBatchDaDang`; sửa `loadEmergencyConfig` để không fetch
`/batches` nữa (chỉ còn template + task-definitions).

### 6.2. API & nghiệp vụ

- Xoá route GET list.
- PATCH chỉ còn nhận `{ teams, systems }`, validate qua `parseEmergencyBatchTeamsSystems()` (giữ), không
  còn nhánh `daDang`/`xacNhanDoiSauKhiDaDang`/409 already-posted.

### 6.3. Dữ liệu & schema

```sql
ALTER TABLE emergency_release_batches DROP COLUMN da_dang;
```

Archive toàn bộ giá trị `da_dang` hiện có (kể cả `NULL`/`0`) ra `data/archive/emergency-batch-da-dang-removed-<ts>.json` + `.sha256`, bọc DROP trong transaction, idempotent (kiểm tra cột còn tồn tại qua `PRAGMA table_info` trước khi archive/drop).

## 7. Phân tích tác động

- ✅ Frontend · ✅ API route · ✅ DB/migration · ⬜ Automation/MCP
- ✅ i18n (xoá key riêng) · ⬜ Đóng gói SEA (rebuild sau khi xong) · ⬜ Bảo mật · ✅ Dữ liệu cũ (archive trước khi drop)

**Rủi ro & giảm thiểu:**

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Xoá nhầm phần POST/guard mismatch (dùng chung bảng) | Trung bình | Đã xác nhận qua Explore agent: route POST + cột `teams`/`systems` không đụng, chỉ xoá đúng cột `da_dang` + 2 route/UI liệt kê |
| Test cũ còn assert hành vi đã xoá (đã đăng/daDang) làm `npm run check` đỏ oan | Thấp | Xoá/sửa đúng phần test tương ứng, giữ phần test POST/mismatch nguyên vẹn |

**Ảnh hưởng chức năng đang chạy:** không đổi luồng tạo task khẩn cấp giai đoạn 1/2; chỉ mất khả năng xem
danh sách batch + sửa qua UI + theo dõi "đã đăng" thủ công (Leader đã chấp nhận đánh đổi).

## 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC-1 (FR-1, FR-2):** Given màn Release khẩn cấp / When mở tab / Then không còn thấy khu vực "Các đợt
  release khẩn cấp" hay nút "Sửa"/badge đã đăng bài.
- **AC-2 (FR-3):** Given gọi `GET /api/schedules/emergency-release/batches` / Then route không tồn tại
  (404 do Express không match route, không phải lỗi nghiệp vụ).
- **AC-3 (FR-4):** Given batch tồn tại / When `PATCH .../batches/:releaseMonth` với `{teams, systems}` /
  Then cập nhật thành công như cũ (hành vi POST-guard giữ nguyên, test cũ liên quan vẫn PASS).
- **AC-4 (FR-4):** Given gọi PATCH kèm `daDang` / Then trường này bị bỏ qua (không còn cột để ghi, không
  lỗi 500).
- **AC-5 (FR-5):** Given DB có cột `da_dang` / When migration chạy / Then cột bị xoá, có file archive +
  checksum; chạy lại migration lần hai không lỗi (idempotent, không còn gì để archive/drop).

## 9. Kế hoạch test

- Tầng test: ✅ Integration route (`test/integration/emergency-release-batches.test.ts` — xoá phần
  GET/daDang/already-posted, giữ phần POST mismatch/force) ✅ Unit (`check-error-codes.test.ts` bỏ assertion
  `EMERGENCY_BATCH_ALREADY_POSTED`) ✅ tsc --noEmit ✅ `npm run test`
- Ca biên: PATCH không còn nhánh daDang vẫn phải cho sửa teams/systems bình thường; migration chạy trên
  DB đã có `da_dang` lẫn DB mới toanh (không có cột) đều không lỗi.

## 10. Kế hoạch triển khai / rollback

- Migration tự chạy lúc server khởi động lần kế (giống mọi migration khác).
- Backup DB (`npm run backup-db`) trước khi khởi động lại app sau khi build.
- Rollback: archive JSON giữ nguyên giá trị `da_dang` cũ nếu cần khôi phục thủ công; revert code nếu cần
  lùi tính năng.

## 11. Docs cần cập nhật sau khi làm xong

- [x] [docs/03](../../specs/03-api-business-logic-spec.md) — bỏ mô tả GET batches/`daDang`, còn PATCH
      chỉ sửa teams/systems
- [x] [docs/04](../../specs/04-database-design.md) — bỏ cột `da_dang` khỏi mô tả bảng

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-09-14 | ✅ |
| Người triển khai | Claude | 2026-09-14 | ✅ |
| QA nghiệm thu | Claude (tự đối chiếu AC, chưa qua Leader xác nhận UI thật) | 2026-09-14 | ✅ 5/5 AC PASS |

**Tự soi 3 góc nhìn (quy mô Vừa, tự đóng, không cần Council):**

- **Dev:** rủi ro chính là tách nhầm route POST/PATCH dùng chung bảng — đã Explore trước khi sửa, xác
  nhận rõ ranh giới ở §1.
- **Tester:** phải giữ nguyên toàn bộ test POST mismatch/force (không được xoá nhầm theo phản xạ "xoá
  hết file test có tên batches").
- **Infra:** migration DROP COLUMN có backup+archive, không cần thay đổi đóng gói/hạ tầng nào khác.

**Kết quả thật (2026-09-14):** Xoá khu vực UI + `PopupSuaEmergencyBatch` + state/hàm liên quan trong
`src/screens/release.tsx`; xoá `GET .../batches`, đơn giản hoá `PATCH .../batches/:releaseMonth` (bỏ
`daDang`/`xacNhanDoiSauKhiDaDang`/409 already-posted, giữ nguyên sửa `teams`/`systems`) trong
`server/routes/schedules.ts`; archive-rồi-drop cột `da_dang` (migration idempotent mới trong
`server/db-migrations.ts`, bỏ luôn migration ADD COLUMN cũ vì không còn cần thêm cột này nữa); xoá type
`EmergencyReleaseBatch` (`src/types.ts`) + import chết ở `src/main.tsx`; xoá 8 i18n key riêng của màn này
(giữ 5 key dùng chung với popup tạo batch); xoá `EMERGENCY_BATCH_ALREADY_POSTED` khỏi
`server/lib/error-codes.ts`; sửa `test/integration/emergency-release-batches.test.ts` (xoá phần
GET/daDang/already-posted, giữ nguyên toàn bộ test POST mismatch/force/enum) + dọn mock chết ở
`test/client/release-regular-create-error.test.tsx`. `tsc --noEmit` sạch, `npm run test` 235 backend +
40 frontend PASS, `npm run check`: 10/11 cổng xanh — 1 cổng đỏ (design-token hardcode ở
`EmergencyReleaseMemeDecoration`, `src/styles.css:1534/1551/1618`) là **nợ có từ trước** (commit `3d984de`,
trước cả baseline design-token), không thuộc phạm vi CR này — ghi backlog riêng `BL-20260914-002`, không
tự mở rộng CR để vá. **Chưa `npm run package`/khởi động lại exe** — Leader tự làm khi sẵn sàng dùng bản
mới.
