# CR-20260817-giu-xuong-dong-khi-ai-dang-drjoy — App dựng sẵn HTML Dr.JOY, AI không tự định dạng nữa

| Trường | Giá trị |
|---|---|
| Loại | ⬜ Thêm mới ✅ Sửa hành vi ⬜ Xóa/Deprecate |
| Mức tác động | ⬜ Nhỏ ✅ Vừa (automation ghi ra ngoài + hợp đồng prompt) ⬜ Lớn |
| Người đề xuất | Leader |
| Ngày | 2026-08-17 |
| Backlog item | `BL-20260817-015` (`Picked`) |
| Trạng thái | ⬜ Draft ⬜ Đã review ⬜ Đã duyệt ⬜ Đã triển khai ✅ Đã nghiệm thu (8/8 AC + smoke thật 2 nhánh, §14) |
| Spec liên quan | [03 API §2](../../specs/03-api-business-logic-spec.md) · [security-standard §5](../../standards/security-standard.md) |

## 1. Bối cảnh & Vấn đề

Note của task có dòng trống giữa các đoạn, nhưng bài/comment AI đăng lên Dr.JOY mất hết dòng trống — các
đoạn dính sát nhau (thấy ngày 2026-08-17 ở 2 comment task `STG - Start/End - 研究開発部`).

Đã lần theo cả chuỗi, **loại trừ được** hai nghi phạm đầu:

| Bước | Trạng thái xuống dòng |
|---|---|
| `tasks.ghi_chu` trong DB | ✅ đúng: `皆様\nお疲れ様です。\n\nステージング…\n\n引き続き…` (2 dòng trống) |
| `automation_preview.content` (app gửi cho AI) | ✅ đúng, vẫn 2 dòng trống |
| HTML lưu trên Dr.JOY (comment 12:11) | ❌ `<p>皆様</p><p>お疲れ様です。</p><p>只今より…</p>` — dòng trống biến mất |
| HTML lưu trên Dr.JOY (comment 17:26, cùng buổi) | ❌ `<p>皆様<br>お疲れ様です。</p><p>ステージング…</p>` — **map kiểu khác** |
| Bài người viết | `<p>…</p><br><p>…</p>` — dòng trống = **một `<br>` giữa hai `<p>`** |
| Bài AI đăng 2026-08-14 (VN_Release) | `<p>@Mọi người</p><br><p>Thông báo…</p>` + `<a href>` — **đúng khuôn**, có `<br>` |

Tool MCP không phải nghi phạm: schema `create-group-comment` **bắt buộc** cả `contents` (plain-text) và
`contents_formatted` (*"Quill HTML contents, e.g. `<p>...</p>` (required by Dr.JOY)"*). Tức tool nhận HTML,
và bài 14/08 chứng minh AI gửi HTML qua đó được.

**Nguyên nhân gốc:** `contents_formatted` do **AI tự dựng, không có luật nào**. Cùng một dạng Note mà 14/08
dựng đúng, 17/08 dựng thiếu `<br>`, và hai comment trong cùng buổi còn map khác nhau. Đây là việc **tất
định** (text → Quill HTML) nhưng lại đang giao cho AI đoán — cùng lớp lỗi với `CLAUDE_BIN`
([CR-20260814](CR-20260814-cau-hinh-claude-bin-khong-phu-thuoc-env.md)) và với snapshot lệch
([CR-20260814-hop-nhat](CR-20260814-hop-nhat-dong-bo-definition-xuong-task.md)): thứ máy làm được chính xác
thì không để AI diễn giải.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Note có `N` dòng trống ⇒ HTML đăng lên Dr.JOY có **đúng `N`** thẻ `<br>` phân đoạn, tất định, không phụ
    thuộc lượt chạy hay model.
  - App là nơi dựng `contents_formatted`; AI chỉ **gửi nguyên văn**.
  - Task `post` mà app chưa dựng được HTML ⇒ **không** ghi ra ngoài (fail-closed).
- **Ngoài phạm vi:**
  - Markdown/định dạng phong phú trong Note (bold, list, bảng) — Note hiện là text thuần, giữ vậy.
  - Hyperlink do AI chèn (chữ `Link`, số ticket): vẫn do AI làm vì nó phải tra URL. App chỉ dựng khung đoạn;
    AI được phép thay **một cụm chữ trong đoạn** thành `<a href>`, và luật đó ghi rõ trong prompt.
  - Sửa MCP server Dr.JOY (không nằm trong repo này).

## 3. Người dùng & Kịch bản

- Là **người vận hành**, tôi viết Note có cách dòng thì bài AI đăng phải xuống dòng y như vậy — không phải
  đăng xong mới phát hiện dính chữ rồi đi sửa tay trên Dr.JOY.

## 4. Yêu cầu chức năng

- **FR-1 — Hàm thuần dựng Quill HTML.** `server/lib/drjoy-html.ts`: `noteToQuillHtml(note: string): string`.
  Luật (khớp bài người viết):
  - escape `&`, `<`, `>` trước khi bọc thẻ;
  - mỗi dòng **không rỗng** → `<p>…</p>`, giữ nguyên khoảng trắng đầu dòng (kể cả full-width `　`);
  - mỗi dòng **rỗng** → `<br>`;
  - `\r\n` và `\r` chuẩn hoá thành `\n` trước khi tách dòng;
  - Note rỗng → `''` (không sinh thẻ nào).
- **FR-2 — App dựng, AI gửi nguyên văn.** Precheck của task `post`: app tự tính `contentHtml` từ
  `preview.content` và ghi vào preview snapshot. Prompt pha thực thi ra lệnh: `contents_formatted` = **nguyên
  văn `contentHtml`**, `contents` = nguyên văn `content`; **không** tự định dạng lại.
- **FR-3 — Fail-closed.** Task `post` có `ready=true` mà không dựng được `contentHtml` (content rỗng) ⇒
  precheck trả `ready=false`, reason `code='thieu_content_html'`. Không ghi ra ngoài với nội dung không dựng
  được khung.
- **FR-4 — Luật hyperlink.** Prompt nói rõ: được thay một cụm chữ **bên trong** một `<p>` thành
  `<a href="…" rel="noopener noreferrer" target="_blank">…</a>`; **không** được xoá/gộp `<p>`, **không** được
  bỏ `<br>`.

## 5. Yêu cầu phi chức năng

- `noteToQuillHtml` là hàm **thuần**, không I/O, có unit test — nó là nơi duy nhất quyết định khung HTML.
- **Bảo mật:** escape trước khi bọc thẻ, nên Note chứa `<script>` không thành thẻ thật khi hiển thị trên
  Dr.JOY ([security-standard §5](../../standards/security-standard.md): nội dung do người dùng nhập, đi ra hệ
  thống ngoài, phải escape). Không thêm endpoint, không thêm quyền tool.
- Không đổi DB, không migration: `contentHtml` nằm trong JSON `automation_preview` đã có.

## 6. Thiết kế giải pháp

### 6.2. API & nghiệp vụ
- `server/lib/drjoy-html.ts` (mới) — FR-1.
- `server/routes/automation.ts` — sau khi parse preview của Claude: nếu `kind='post'`/task `post` và
  `ready=true`, tính `contentHtml = noteToQuillHtml(preview.content)`; rỗng ⇒ chuyển `ready=false` (FR-3).
- `server/lib/automation-prompts.ts` — `CONTRACT_DOC` mô tả `contentHtml` là **do app điền** (AI không cần
  sinh); `buildExecutePrompt` thêm luật FR-2 + FR-4.

## 7. Phân tích tác động

- [ ] Frontend · [x] API route (automation preview/execute) · [ ] DB/migration · [x] Automation/MCP
- [ ] i18n · [ ] Đóng gói SEA · [x] Bảo mật (escape nội dung ra hệ thống ngoài) · [x] Dữ liệu cũ (preview cũ
  không có `contentHtml` ⇒ execute vẫn chạy được, AI tự dựng như trước — không làm task đang chờ duyệt bị kẹt)
- **Rủi ro:** AI vẫn có thể phớt lờ `contentHtml`. Giảm thiểu: luật tường minh trong prompt + smoke thật đọc
  lại HTML sau khi đăng. Không có cổng máy nào chặn được việc AI chọn sai field ⇒ **ghi rõ giới hạn này**,
  không hứa suông.

## 8. Tiêu chí nghiệm thu

- **AC-1 (FR-1):** Given Note `"皆様\nお疲れ様です。\n\nステージング…\n\n引き続き…"`, When `noteToQuillHtml`,
  Then đúng `<p>皆様</p><p>お疲れ様です。</p><br><p>ステージング…</p><br><p>引き続き…</p>`.
- **AC-2 (FR-1):** Given Note có `&`, `<`, `>`, When dựng, Then chúng thành `&amp;`, `&lt;`, `&gt;` — không
  thành thẻ thật.
- **AC-3 (FR-1):** Given Note có 2 dòng trống liên tiếp, Then sinh 2 `<br>` (không gộp); dòng trống ở đầu/cuối
  cũng giữ.
- **AC-4 (FR-1):** Given Note rỗng/toàn khoảng trắng, Then trả `''`.
- **AC-5 (FR-1):** Given dòng có khoảng trắng full-width `　` đầu dòng, Then giữ nguyên trong `<p>`.
- **AC-6 (FR-2):** Given task `post` precheck `ready=true`, When đọc preview snapshot, Then có `contentHtml`
  khớp `noteToQuillHtml(content)`.
- **AC-7 (FR-3):** Given task `post`, AI trả `ready=true` nhưng `content` rỗng, Then preview thành
  `ready=false` với reason `thieu_content_html`, và trạng thái task **không** phải `preview` sẵn-sàng-chạy.
- **AC-8 (tương thích):** Given task `other`, Then preview **không** có `contentHtml` (không áp luật post cho
  việc khác).

## 9. Kế hoạch test

- ✅ Unit (`drjoy-html`): AC-1…AC-5 + `\r\n`, ký tự `"`/`'`, Note 1 dòng.
- ✅ Integration route: AC-6, AC-7, AC-8 (mock Claude).
- ✅ Smoke thật (sau khi đóng gói): chạy 1 task post nháp, đọc lại HTML bằng tool đọc, đếm `<br>`.
- **Test đỏ trước**: viết AC-1 (ca thật của sự cố) và chạy cho **đỏ** trước khi có hàm.

## 10. Triển khai / rollback

- Bước: (1) test đỏ AC-1; (2) `drjoy-html.ts`; (3) route + prompt; (4) integration test; (5) `npm run check`;
  (6) `npm run package` + bật lại exe (`L-009`); (7) smoke thật; (8) `docs-sync` spec 03.
- Rollback: revert commit. Preview đã lưu có thêm 1 field JSON — bản cũ bỏ qua field lạ, không cần dọn.

## 11. Docs cập nhật

- [ ] [specs/03 §2](../../specs/03-api-business-logic-spec.md) — `contentHtml` trong hợp đồng preview + luật gửi
- [ ] [operations/automation-ai-go-live-guide](../../operations/automation-ai-go-live-guide.md) — nếu đổi cách kiểm

## 13. Kết quả triển khai (2026-08-17)

| File | Việc |
|---|---|
| [`server/lib/drjoy-html.ts`](../../../server/lib/drjoy-html.ts) **(mới)** | `noteToQuillHtml` — hàm thuần, FR-1 |
| [`server/routes/automation.ts`](../../../server/routes/automation.ts) | precheck task `post`: dựng `contentHtml`, rỗng ⇒ `blocked` `thieu_content_html` (FR-2, FR-3) |
| [`server/lib/automation-prompts.ts`](../../../server/lib/automation-prompts.ts) | contract: `content` là text thuần, `contentHtml` do app điền; luật gửi nguyên văn + luật hyperlink (FR-2, FR-4) |
| [`scripts/mock-claude.mjs`](../../../scripts/mock-claude.mjs) | thêm `MOCK_CONTENT` để test bơm nội dung thật (hạ tầng test) |

Test: **10 unit** ([`test/unit/drjoy-html.test.ts`](../../../test/unit/drjoy-html.test.ts)) + **3 integration**
([`test/integration/automation-content-html.test.ts`](../../../test/integration/automation-content-html.test.ts)).
AC-1 được viết **đỏ trước** (chạy khi chưa có hàm ⇒ `ERR_MODULE_NOT_FOUND`), rồi mới viết hàm. `npm run check` xanh.

**Hai lỗi tự bắt được trong lúc làm — ở chính cổng máy `check-exe-fresh` vừa thêm hôm nay:**

1. Cổng in cảnh báo bằng `console.warn` (stderr), mà `check.mjs` chỉ đọc stdout ⇒ `npm run check` báo ✔ dù
   exe đã cũ. Đã đổi sang `console.log`.
2. Cổng dùng `git ls-files` trơn ⇒ **không thấy file mới chưa `git add`** — mà file mới chính là thứ dễ quên
   đóng gói nhất (`drjoy-html.ts` bị bỏ qua đúng lần này). Đã đổi sang `git ls-files --cached --others --exclude-standard`.

Nếu không tình cờ nhìn lại dòng "✔ Exe khớp code chạy thật" thì cổng vừa dựng đã im lặng vô dụng — cùng đúng
lớp lỗi `L-009` mà nó ra đời để chặn.

## 14. Smoke thật (2026-08-17) — PASS cả hai nhánh

Đích **nháp**, không phải group đang vận hành: tạo group `TEST TM smoke` (`-P-Dw8rwGUYebFEsMqoV`) chỉ có mình,
chạy task thật qua đúng luồng app (`preview → approve → execute`) với **Claude thật + connector Dr.JOY thật**,
rồi đọc lại HTML bằng tool đọc, xoá group + task sau khi xong.

| Nhánh | Kết quả |
|---|---|
| **Bài mới** (`mode=new_post`, task 1125) | `contentHtml` app dựng = `<p>皆様</p><p>お疲れ様です。</p><br><p>ステージング…</p><br><p>引き続き…</p>`. HTML **lưu trên Dr.JOY khớp từng ký tự**, đúng **2** `<br>` (`articleId=-P-DwPUzqt50v9_ibjuI`) |
| **Comment** (`mode=reply`, task 1127) — đúng nhánh gây sự cố | HTML lưu: `<p>皆様</p><p>お疲れ様です。</p><br><p>Comment smoke…</p><br><p>よろしく…</p>` — đúng **2** `<br>`, khớp `contentHtml` (`commentId=-P-DwuLz-7KbCkLQiZnZ`) |

So sánh trước/sau trên cùng nhánh comment:

```
17/08 trước CR:  <p>皆様</p><p>お疲れ様です。</p><p>ステージング…</p>          (mất dòng trống)
17/08 trước CR:  <p>皆様<br>お疲れ様です。</p><p>ステージング…</p>             (kiểu thứ hai, cùng buổi)
17/08 sau  CR:   <p>皆様</p><p>お疲れ様です。</p><br><p>…</p><br><p>…</p>   (đúng khuôn bài người viết)
```

Ghi nhận thêm (không phải lỗi): task đầu tiên đặt giờ 15:30 trong khi giờ VN đã 15:58 ⇒ scheduler đánh
`missed` theo cửa sổ OVERDUE 15 phút, `execute` bị từ chối đúng như thiết kế. Phải đặt lại giờ sát hiện tại
mới chạy được — bằng chứng phụ rằng cổng thời gian vẫn hoạt động.

Dọn sau smoke: xoá 3 task test trong app, xoá group nháp trên Dr.JOY (`deleted: true`). Không để lại rác.

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-08-17 | ✅ |
| Leader duyệt | Leader | 2026-08-17 | ✅ "tạo CR nhỏ và tiến hành + test luôn" |
| Người triển khai | Claude | 2026-08-17 | ✅ 13 test (test đỏ AC-1 trước), `npm run check` xanh, exe đã đóng gói lại |
| QA nghiệm thu | Claude (Leader uỷ quyền "tự smoke đầy đủ") | 2026-08-17 | ✅ 8/8 AC + smoke thật 2 nhánh trên đích nháp (§14) |
