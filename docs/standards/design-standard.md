# Bộ quy chuẩn Thiết kế / Change Spec — Task Manager

> Tài liệu **tham chiếu bắt buộc** cho BA/dev mỗi khi **thêm / sửa / xóa** một chức năng.
> Nguyên tắc gốc: **không code khi chưa có tài liệu thiết kế được duyệt** (trừ thay đổi vặt — xem mục 3).
> Bổ trợ: [QA-STANDARD.md](qa-standard.md) (chuẩn test) · bộ spec trạng thái hiện tại [docs 01–09](../README.md).

---

## 0. TL;DR

1. Mỗi thay đổi chức năng phải xuất phát từ một [backlog item](../backlog/README.md) đã được Leader `Picked` ⇒
   tạo **Change Spec** từ [template](../templates/change-spec-template.md), đặt tại
   `docs/delivery/changes/CR-<yyyymmdd>-<slug>.md` và ghi vào [sổ cái delivery](../delivery/README.md).
2. Change Spec phải đạt **Definition of Ready (mục 4)** trước khi bắt đầu code.
3. Change Spec là **DELTA** (mô tả thay đổi). Sau khi merge, **cập nhật lại nguồn chân lý** `docs/01–09`.
4. Mọi yêu cầu (FR) và tiêu chí nghiệm thu (AC) phải **đánh số** để truy vết sang code & test.
5. Thay đổi vặt (sửa chữ, CSS, bugfix ≤ vài dòng không đổi hợp đồng) ⇒ không cần Change Spec, chỉ cần commit message rõ + test.

---

## 1. Mục đích

- Đảm bảo mọi thay đổi có **cùng một khung tài liệu** để phân tích → thiết kế → triển khai → nghiệm thu.
- Tránh "code trước, nghĩ sau": buộc làm rõ phạm vi, tác động, tiêu chí nghiệm thu **trước**.
- Tạo **truy vết (traceability)**: Yêu cầu ↔ Thiết kế ↔ Code ↔ Test ↔ Nghiệm thu.
- Giữ bộ spec `docs/01–09` luôn phản ánh đúng hệ thống.

## 2. Nguyên tắc

1. **Tài liệu trước, code sau** (với thay đổi từ mức "Vừa" trở lên).
2. **Một nguồn chân lý**: `docs/01–09` mô tả *trạng thái hiện tại*; Change Spec mô tả *delta*. Khi code và docs mâu thuẫn → ưu tiên code, nhưng **phải sửa docs ngay trong cùng lần giao**.
3. **Đo được**: mục tiêu và tiêu chí nghiệm thu phải kiểm chứng được, không chung chung.
4. **Tối giản vừa đủ**: tài liệu phục vụ triển khai, không phải để trưng bày. Thay đổi nhỏ → spec ngắn.
5. **Tác động trước, tính năng sau**: luôn phân tích ảnh hưởng tới chức năng đang chạy + dữ liệu cũ.

---

## 3. Khi nào cần tài liệu (phân loại thay đổi)

| Loại | Ví dụ | Yêu cầu tài liệu |
|---|---|---|
| **Thêm mới** | Thêm loại task, thêm màn hình, thêm endpoint | **Change Spec đầy đủ** |
| **Sửa hành vi** | Đổi rule validation, đổi cách tính lịch, đổi flow automation | **Change Spec** (có thể rút gọn mục UI nếu không đổi UI) |
| **Xóa / Deprecate** | Bỏ một chức năng, gỡ cột DB | **Change Spec** + **kế hoạch gỡ & xử lý dữ liệu tồn** (mục 9.3) |
| **Bugfix nhỏ** | Sai nhãn, off-by-one, lỗi hiển thị | Không cần spec — mô tả trong commit message + regression test (QA-STANDARD mục 3) |
| **Cosmetic** | CSS, đổi chữ, refactor nội bộ không đổi hành vi | Không cần spec |

> Nếu phân vân "nhỏ hay vừa": cứ hỏi *"thay đổi này có làm ai đó phải học lại cách dùng, hay có thể làm hỏng dữ liệu/chức năng khác không?"* — Có ⇒ cần Change Spec.

---

## 4. Definition of Ready (DoR) — chốt trước khi code

Change Spec **sẵn sàng triển khai** khi:

- [ ] Vấn đề & mục tiêu rõ, mục tiêu **đo được**.
- [ ] Phạm vi & **ngoài phạm vi** đã khoanh.
- [ ] Yêu cầu chức năng đánh số (FR-x), không mơ hồ.
- [ ] Thiết kế UI/API/DB đủ để dev bắt tay không phải đoán.
- [ ] **Tiêu chí nghiệm thu (AC)** viết theo Given/When/Then, mỗi AC map ≥1 test.
- [ ] **Phân tích tác động** (mục 8) đã tick + nêu rủi ro/giảm thiểu.
- [ ] Tương thích **dữ liệu cũ / backward-compat** đã xét (đặc biệt khi đụng DB).
- [ ] Đã có người **review & duyệt** (mục 10).

---

## 5. Vòng đời một thay đổi

```
Backlog → refine/Ready → Leader pick → Phân tích tác động → Thiết kế (Change Spec) → Review & Duyệt (DoR)
      → Triển khai (code + test theo QA-STANDARD) → Cập nhật docs 01–09
      → QA nghiệm thu theo AC → Đóng CR + backlog item
```

- Mỗi bước ánh xạ 1 mục trong Change Spec.
- "Triển khai" tuân [QA-STANDARD.md](qa-standard.md) (DoD test). "Nghiệm thu" = chạy qua từng AC.

---

## 6. Cấu trúc chuẩn của một Change Spec

Dùng đúng [template](../templates/change-spec-template.md). Các mục **bắt buộc**:

1. Header (loại, mức tác động, trạng thái, spec liên quan)
2. Bối cảnh & Vấn đề
3. Mục tiêu & Ngoài phạm vi
4. Người dùng & Kịch bản (user story)
5. **Yêu cầu chức năng (FR-x)**
6. Yêu cầu phi chức năng (nếu có)
7. **Thiết kế**: UI · API/nghiệp vụ · Dữ liệu/schema · Automation (nếu đụng)
8. **Phân tích tác động**
9. **Tiêu chí nghiệm thu (AC)**
10. Kế hoạch test
11. Kế hoạch triển khai / rollback
12. Docs cần cập nhật + Sign-off

---

## 7. Chuẩn viết Yêu cầu & Tiêu chí nghiệm thu

- **FR** (yêu cầu chức năng): 1 câu, chủ động, kiểm được. *"FR-2: Khi tạo task định kỳ, hệ thống cho chọn giờ bắt đầu trong khoảng 07:30–17:45."*
- **AC** (acceptance criteria): **Given / When / Then**, gắn với FR:
  > *AC-2 (FR-2): **Given** đang tạo task định kỳ / **When** nhập giờ 18:00 / **Then** hiện lỗi "Giờ không hợp lệ" và không lưu.*
- Mỗi AC ⇒ ít nhất 1 test (unit/integration/render/smoke). Số AC ≈ số ca test chính.
- Ưu tiên phủ **ca lỗi & biên**, không chỉ happy path.

### 7.1. Mục tiêu đo được: tránh chỉ số GIÁN TIẾP

"Đo được" chưa đủ — phải đo **đúng thứ mình quan tâm**. Chỉ số gián tiếp (proxy) dễ viết, dễ đếm, và
dễ sai: nó tương quan với mục tiêu thật *hôm nay*, rồi gãy ngay khi phạm vi đổi.

| Muốn đạt | ❌ Proxy (tránh) | ✅ Chỉ số trực tiếp |
|---|---|---|
| Bớt phức tạp một module | "file ≤ 170 dòng" | "xoá 4/4 ref chống-trùng"; "không còn phép so sánh thời gian trong `src/`" |
| Code dễ bảo trì hơn | "giảm 30% số dòng" | "một hành vi chỉ còn một nơi định nghĩa"; "hàm quyết định là hàm thuần, unit test được" |
| Nhanh hơn | "ít query hơn" | "p95 của thao tác X ≤ N ms" |
| An toàn hơn | "thêm 5 test" | "hai request song song ⇒ đúng 1 lần ghi ra ngoài" |

**Cách tự kiểm trước khi chốt một mục tiêu đo được:** hỏi *"nếu đạt đúng con số này mà mục tiêu thật
vẫn hỏng, có thể xảy ra không?"* Có ⇒ đó là proxy, đổi chỉ số khác.

Và ngược lại: *"có kịch bản nào mục tiêu thật đạt nhưng con số này trượt không?"* Có ⇒ AC sẽ báo động
giả, ép người làm bẻ cong code để chạy theo số.

> **Nguồn:** [L-001](../delivery/README.md) — CR-20260801 đặt AC-12 lên số dòng, kết quả trượt (224/170)
> trong khi mọi mục tiêu thật đều đạt. Nguyên nhân: một FR khác trong cùng CR *thêm* việc cho module đó,
> điều mà chỉ số "số dòng" không phân biệt được.

---

## 8. Checklist Phân tích tác động (theo kiến trúc project)

Tick mọi lớp bị đụng và ghi rõ ảnh hưởng:

- [ ] **Frontend** — màn/component nào (`src/screens/*`, `src/components/*`, `src/main.tsx`)? Trạng thái rỗng/loading/lỗi?
- [ ] **API** — endpoint mới/đổi (`server/routes/*`)? Validation, status lỗi, hợp đồng response?
- [ ] **DB / schema** — thêm/sửa cột (`server/db.ts`)? **Migration idempotent**? Bản ghi cũ còn đọc được?
- [ ] **Giao dịch** — thao tác đa bước có cần `withTransaction`?
- [ ] **Automation / MCP** — đụng `action_type`/`ai_note`/`related_ids`/luồng preview-approve-execute? Quyền ghi? (mọi hành động ghi ra ngoài phải có người duyệt).
- [ ] **i18n** — chuỗi hiển thị mới (`src/i18n.ts`)?
- [ ] **Shared types** — đổi enum/interface dùng chung? Sửa ở `server/types.ts` (nguồn), client re-export tự theo.
- [ ] **Đóng gói** — ảnh hưởng SEA desktop (`scripts/build-sea.mjs`) hay container (`Dockerfile`)?
- [ ] **Bảo mật / dữ liệu nhạy cảm** — secret, API key, path traversal, kích thước body?
- [ ] **NFR** — hiệu năng (bundle, query), tính local/1-người-dùng, backup DB?
- [ ] **Chức năng đang chạy** — thay đổi có phá vỡ luồng nào đang dùng? Test hồi quy nào cần thêm?

---

## 9. Đặc thù theo loại thay đổi

### 9.1. Thêm mới
- Nêu rõ **giá trị & tiêu chí thành công** (đo được).
- Thiết kế trạng thái rỗng/lỗi ngay từ đầu.
- Xác định dữ liệu mặc định & migration nếu thêm cột.

### 9.2. Sửa hành vi
- **Nêu hành vi CŨ vs MỚI** cạnh nhau (bảng), để review thấy đúng phần thay đổi.
- Liệt kê nơi phụ thuộc hành vi cũ (grep code + docs) — tránh sót.
- Bắt buộc regression test cho hành vi cũ **không bị đổi ngoài ý muốn**.

### 9.3. Xóa / Deprecate (rủi ro cao nhất)
- **Kế hoạch gỡ dần**: ẩn UI → ngừng ghi → gỡ đọc → gỡ schema (không gỡ cột dữ liệu ngay khi còn bản ghi giá trị).
- **Xử lý dữ liệu tồn**: migrate/ archive / xác nhận mất mát chấp nhận được.
- Kiểm mọi nơi tham chiếu (route, UI, MCP tool, docs) đã gỡ.
- Ghi rõ **không thể rollback phần dữ liệu** nếu đã xóa.

### 9.4. Di chuyển logic giữa 2 tầng (FE↔BE, client↔server, đồng bộ↔nền)

Đây là loại thay đổi hay **rơi giả định ngầm** nhất: code chạy đúng ở tầng cũ vì môi trường tầng cũ
tình cờ thỏa một điều kiện không ai viết ra. Change Spec **phải liệt kê tường minh**:

| Giả định | Câu hỏi phải trả lời trong spec |
|---|---|
| **Gốc thời gian** | Giờ nào là giờ nghiệp vụ? Tầng mới lấy giờ ở đâu (máy? UTC? múi giờ cố định?) |
| **Phạm vi dữ liệu** | Tầng cũ được lọc sẵn bởi cái gì (query màn hình, state của tab)? Tầng mới có bộ lọc đó chưa? |
| **Nguồn chân lý** | Sau khi chuyển, ai là nguồn chân lý; hai bên còn giữ bản sao nào phải khớp nhau (khóa, id, ngày)? |
| **Định danh dùng chung** | Khóa/ID sinh ở cả hai phía có công thức giống nhau không? |
| **Số lượng tiến trình/phiên** | Giả định "chỉ có một" (một tab, một tiến trình, một scheduler) có được môi trường bảo đảm không? Nếu không ⇒ phải có **khóa liên-tiến-trình**, không phải health-check ([BUG-006](../delivery/bugs/BUG-20260803-bat-app-trung.md): Claude Desktop + Codex mỗi lần chuyển mode lại thêm một tiến trình) |

Mỗi ô trên phải thành **một AC kiểm được** hoặc một ràng buộc trong rule — không để dạng "hiển nhiên".
Nguồn: [BUG-20260803](../delivery/bugs/BUG-20260803-automation-sai-mui-gio.md) — chuyển vòng tick automation
từ FE sang BE, rơi cả 4 giả định: giờ VN, lọc theo ngày của dashboard, và khóa occurrence hai phía.

---

## 10. Cổng duyệt & Versioning

- Change Spec chuyển `Draft → Đã review → Đã duyệt` mới được code.
- Chỉ mở Change Spec sau khi backlog item đã được Leader `Picked`; CR không dùng làm danh sách ưu tiên.
- Với app cá nhân/1 người: "duyệt" tối thiểu = tự review lại đủ DoR + có người thứ hai đọc nếu mức tác động Lớn.
- Change Spec **bất biến sau khi duyệt**; thay đổi lớn giữa chừng ⇒ cập nhật spec + note lý do (không sửa lén).
- Đặt tên & lưu: `docs/delivery/changes/CR-<yyyymmdd>-<slug>.md`. Giữ lại làm lịch sử quyết định (kể cả sau khi đã fold vào 01–09).

---

## 11. Truy vết (Traceability)

Chuỗi liên kết cần giữ được:

```
Backlog item (priority/status → link CR)
   → Change Spec (FR-x, AC-y)
   → Commit (nhắc CR-… và FR-x trong message)
   → Code (comment tham chiếu khi phi hiển nhiên)
   → Test (tên test map AC-y — QA-STANDARD)
   → docs/01–09 (cập nhật trạng thái mới)
```

Mẹo: commit message ghi `Ref: CR-20260725-abc (FR-1, FR-2)`; tên test chứa mã AC khi hợp lý.
Dự án không dùng PR ([ADR-P1](team-operating-standard.md)) nên **commit message là nơi duy nhất** giữ
ngữ cảnh này — viết cho tử tế.

---

## 12. Quan hệ với bộ tài liệu hiện có

| Tài liệu | Vai trò |
|---|---|
| `docs/backlog/README.md` | Nguồn canonical cho việc chưa làm, ưu tiên và quyết định pick |
| `docs/01–09` | **Nguồn chân lý trạng thái hiện tại** (product, screen, API, DB, test criteria, rules) |
| **DESIGN-STANDARD.md** (đây) | Quy chuẩn *cách tạo tài liệu thay đổi* |
| `templates/change-spec-template.md` | Khuôn điền cho từng thay đổi |
| `docs/delivery/changes/CR-*.md` | Các delta cụ thể (lịch sử quyết định) |
| [QA-STANDARD.md](qa-standard.md) | Chuẩn *test* khi triển khai |

Quy tắc khép vòng: **Change Spec dùng để làm → sau khi làm xong, cập nhật `specs/01–05` + `rules/06–09` → Change Spec thành hồ sơ lịch sử.**

## 13. Khi CR sinh ra bug

Bug **thoát cổng** truy được về một CR ⇒ hồ sơ [`BUG-*`](../delivery/bugs/README.md) ghi mã CR ở trường
*"Sinh ra bởi"*, và cột *"Bug sinh ra"* của CR trong [sổ cái](../delivery/README.md) cập nhật ngược lại.

Mapping hai chiều này trả lời được câu hỏi khó nhất về chất lượng thiết kế:
**"CR nào đi qua DoR trót lọt nhưng vẫn đẻ ra lỗi — và thiếu sót nằm ở mục nào của Change Spec?"**
Nếu nhiều bug cùng mang `RC-SPEC`, vấn đề nằm ở chính bộ chuẩn này (mục 4 DoR hoặc mục 7 cách viết AC)
— sửa tại đây, đừng đổ cho người viết.

---

*Quy chuẩn này sống cùng project. Thấy nặng nề chỗ nào cho thay đổi nhỏ → tinh gọn ngay tại đây.*
