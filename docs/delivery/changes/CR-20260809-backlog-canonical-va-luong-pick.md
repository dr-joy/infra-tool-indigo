# CR-20260809-backlog-canonical-va-luong-pick — Backlog canonical và luồng pick việc

| Trường | Giá trị |
|---|---|
| Loại | ✅ Thêm mới ✅ Sửa hành vi |
| Mức tác động | ✅ Vừa (đổi quy trình bắt đầu và theo dõi công việc) |
| Người đề xuất | tuan.vu (Leader), phân tích/triển khai: Codex |
| Ngày | 2026-08-09 |
| Backlog item | `BL-20260809-009` |
| Trạng thái | ✅ Đã review ✅ Đã duyệt ✅ Đã triển khai ✅ Đã nghiệm thu |
| Spec liên quan | [team-operating-standard](../../standards/team-operating-standard.md) · [design-standard](../../standards/design-standard.md) · [docs-standard](../../standards/docs-standard.md) |

## 1. Bối cảnh & Vấn đề

Việc chưa làm đang nằm rải trong exchange, điểm dừng, CR, operations và proposal. CR vì vậy vừa bị dùng như
danh sách việc, vừa làm hồ sơ thiết kế/giao hàng; người đọc khó biết việc nào còn mở, ưu tiên nào cao và việc nào
đã bị thay thế. Leader chưa có một nơi duy nhất để quyết định việc tiếp theo.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Có đúng một backlog canonical do Leader sở hữu tại `docs/backlog/README.md`.
  - Mọi việc chưa được pick nằm ở backlog; chỉ sau khi pick mới phân loại A/B/C và mở CR/BUG khi đúng ngưỡng.
  - Backlog và CR/BUG không lặp nội dung: backlog giữ ưu tiên/trạng thái/link; hồ sơ delivery giữ thiết kế và bằng chứng.
  - Gom các việc còn mở đã biết tới ngày 2026-08-09 vào backlog ban đầu.
- **Ngoài phạm vi:**
  - Không triển khai UI quản lý backlog hay tích hợp Jira/GitHub Issues.
  - Không tự hoàn thành các item được gom vào backlog.
  - Không thay đổi code sản phẩm, API hoặc DB.

## 3. Người dùng & Kịch bản

- Là Leader, tôi muốn nhìn một danh sách canonical để chọn đúng việc tiếp theo và giới hạn việc đang làm.
- Là BA/Dev/Tester/Infra, khi một item được pick, tôi muốn biết phải đi đường A, BUG hay CR mà không phải tìm
  lại quyết định trong nhiều exchange.

## 4. Yêu cầu chức năng

- **FR-1:** Tạo backlog canonical với ID, loại, ưu tiên, trạng thái, owner, mô tả ngắn, bước tiếp theo và link hồ sơ.
- **FR-2:** Leader là owner chịu trách nhiệm cuối cho triage, ưu tiên, pick, WIP và đóng item.
- **FR-3:** Chuẩn hóa vòng đời `Inbox → Ready → Picked → Done`, cùng hai nhánh `Blocked` và `Dropped`.
- **FR-4:** Sau khi pick, Leader mới phân loại: đường A làm trực tiếp; đường B mở BUG khi đạt ngưỡng; đường C mở CR.
- **FR-5:** Finding thuộc phạm vi CR đang làm ở lại trong CR; việc ngoài phạm vi quay về backlog; bug khẩn cấp
  hoặc bug thoát cổng có thể mở BUG trực tiếp rồi liên kết backlog khi cần ưu tiên.
- **FR-6:** Đồng bộ hướng dẫn đầu phiên, delivery flow, taxonomy tài liệu, bản đồ docs và registry CR.

## 5. Yêu cầu phi chức năng

- Backlog phải đọc và sửa được bằng Markdown, không cần công cụ ngoài.
- Không sao chép FR/AC/thiết kế/test từ CR hoặc BUG sang backlog.
- Link nội bộ phải qua được cổng kiểm tài liệu hiện có.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng / UI

Không đổi UI sản phẩm. Leader quản lý bảng tại `docs/backlog/README.md`.

### 6.2. API & nghiệp vụ

Không đổi API. Quy trình mới:

```text
Nhu cầu → Backlog → triage/refine → Ready → Leader pick → A / B / C → giao hàng → đóng hồ sơ + item
```

### 6.3. Dữ liệu & schema

Không đổi DB. Backlog là Markdown canonical; ID có dạng `BL-<yyyymmdd>-<nnn>` và không tái sử dụng.

### 6.4. Automation / tích hợp

Claude/Codex phải đọc backlog ở đầu phiên để biết ưu tiên, nhưng exchange mới nhất vẫn là nguồn handoff cho
việc đang `Picked`.

## 7. Phân tích tác động

- [ ] Frontend · [ ] API route · [ ] DB/migration · [ ] Automation/MCP
- [ ] i18n · [ ] Đóng gói · [ ] Bảo mật · [ ] Dữ liệu cũ/backward-compat
- [x] Quy trình · [x] Tài liệu canonical · [x] Hướng dẫn AI
- **Rủi ro:** backlog biến thành CR thứ hai. **Giảm thiểu:** giới hạn mô tả item ở vấn đề/giá trị/bước tiếp theo;
  cấm chứa thiết kế, FR/AC và test plan.
- **Rủi ro:** mọi ý tưởng bị biến thành cam kết. **Giảm thiểu:** `Inbox` không phải cam kết; chỉ `Picked` mới
  cấp quyền bắt đầu delivery.
- **Ảnh hưởng chức năng đang chạy:** không có; chỉ thay quy trình quản trị công việc.

## 8. Tiêu chí nghiệm thu

- **AC-1 (FR-1, FR-2):** Given repo có nhiều việc rải rác / When mở backlog / Then thấy một danh sách canonical,
  owner Leader và đủ trường tối thiểu để ưu tiên.
- **AC-2 (FR-3):** Given một item mới / When đọc quy trình / Then xác định được mọi transition hợp lệ và điều kiện
  `Ready`, `Picked`, `Done`.
- **AC-3 (FR-4, FR-5):** Given một item được pick / When phân loại / Then biết khi nào không cần hồ sơ, khi nào mở
  BUG, khi nào mở CR và finding nào không được tách hồ sơ.
- **AC-4 (FR-6):** Given người/AI bắt đầu phiên / When đọc `CLAUDE.md` và team standard / Then backlog là nguồn
  ưu tiên, exchange là handoff của việc đã pick, CR/BUG là hồ sơ delivery.
- **AC-5 (FR-6):** Tất cả link Markdown và cổng `npm run check` xanh.

## 9. Kế hoạch test

- Tầng test: kiểm nội dung/traceability bằng review diff; kiểm link và lệnh tài liệu bằng `npm run check`.
- Ca biên: bug production khẩn cấp; finding trong CR; việc đường A; item bị block/drop; proposal chưa cam kết.

## 10. Kế hoạch triển khai / rollback

- Tạo backlog và seed các việc mở đã biết.
- Đồng bộ `CLAUDE.md`, skill delivery, standards, docs map và delivery registry trong cùng lần giao.
- Rollback: revert riêng lần giao tài liệu này; không có dữ liệu sản phẩm cần phục hồi.

## 11. Docs đã cập nhật

- [x] `docs/backlog/README.md`
- [x] `CLAUDE.md`
- [x] `.claude/skills/delivery-flow/SKILL.md`
- [x] `docs/standards/team-operating-standard.md`
- [x] `docs/standards/design-standard.md`
- [x] `docs/standards/docs-standard.md`
- [x] `docs/README.md`
- [x] `docs/delivery/README.md`
- [x] `.claude/skills/bugfix-flow/SKILL.md` + `.claude/skills/docs-sync/SKILL.md`
- [x] `.claude/commands/mo-cr.md` + `.claude/commands/ket-phien.md`
- [x] `docs/templates/change-spec-template.md` + `docs/templates/bug-record-template.md`
- [x] `docs/exchanges/README.md` + `docs/proposals/README.md`

## 12. Duyệt

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| Leader/đề xuất | tuan.vu | 2026-08-09 | ✅ Chốt mô hình backlog → pick → CR/BUG trong hội thoại |
| BA/Dev/Infra | Codex | 2026-08-09 | ✅ Không đổi code/API/DB; ranh giới artifact rõ |
| QA nghiệm thu | Codex | 2026-08-09 | ✅ Review nội dung + `npm run check` |

### Bằng chứng kiểm chứng

- `npm run check`: xanh — 277 backend + 182 frontend; build đạt; bundle chính 488.1/500 kB;
  72 file Markdown, 0 link gãy.
- `git diff --check`: xanh; thay đổi chỉ thuộc backlog/quy trình/tài liệu, không sửa code sản phẩm.
