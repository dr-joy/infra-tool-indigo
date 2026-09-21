# BUG-20260814-ai-dang-bai-bang-huong-dan-cu — AI đăng bài Dr.JOY theo bản hướng dẫn cũ, không cảnh báo gì

| Trường | Giá trị |
|---|---|
| Ngày phát hiện | 2026-08-14 |
| Người phát hiện | Leader (thấy bài đã đăng khác hướng dẫn trong màn quản lý task) |
| Backlog item | `BL-20260814-014` |
| Mức nghiêm trọng | ⬜ Chặn dùng ✅ Sai dữ liệu (bài đã đăng sai ra hệ thống ngoài) ⬜ Khó chịu ⬜ Cosmetic |
| **Sinh ra bởi** | ✅ Có sẵn từ trước khi có CR — cơ chế snapshot definition→task đã như vậy từ khi làm task release; `ai_note`/`action_type` thừa hưởng cơ chế đó khi automation ra đời |
| **Cổng lẽ ra phải bắt** | ✅ ② Thiết kế (chi tiết §4) |
| **Loại nguyên nhân** | ✅ RC-SPEC |
| Trạng thái | ✅ Mới ✅ Đã có test đỏ ✅ Đã sửa ✅ **Đã rút kinh nghiệm (chấp nhận rủi ro — Leader đóng 2026-08-21 không chạy smoke đợt thật, xem `exchanges/2026-08-21.md` và §6 mục 4)** |
| Test tái hiện | *chưa có* — sẽ là AC-9 của [CR-20260814-hop-nhat](../changes/CR-20260814-hop-nhat-dong-bo-definition-xuong-task.md), viết đỏ TRƯỚC khi sửa |

## 1. Triệu chứng

Task `Announcement - VN_Release` ngày 14/08/2026 chạy AI và **đăng bài lên group Dr.JOY `【チーム】VN_Release`
sai so với hướng dẫn đang có trong màn quản lý task**: không hyperlink chữ `Link` tới file release schedule, và
người nhận đặt theo lối cũ ("To: toàn bộ mọi người") thay vì giữ `@Mọi người` trong thân bài **và** set mention
hệ thống cho toàn bộ thành viên group.

Không có cảnh báo nào trước, trong, hoặc sau khi chạy. App báo `done`.

Cùng ổ lỗi: 10 task AI của các ngày tiếp theo trong đợt đang ở `action_type='none'` với `ai_note` rỗng, tức tới
giờ sẽ **im lặng không chạy** chứ không báo lỗi.

## 2. Tái hiện

1. Tạo task release cho một đợt (task được COPY `ai_note`/`action_type` từ definition tại thời điểm tạo).
2. Sau đó sửa `ai_note` của definition trong màn quản lý task **trong lúc ô ngày release trên màn không trỏ đúng
   đợt đó** (hoặc sửa definition khác với definition vừa lưu).
3. Không bấm nút đồng bộ cả đợt.
4. Chờ tới giờ task chạy automation.

- **Kỳ vọng:** AI chạy theo hướng dẫn mới nhất, hoặc app dừng lại và nói "task đang giữ bản cũ".
- **Thực tế:** AI thi hành **trọn vẹn** bản `ai_note` cũ (374 ký tự) trong khi definition đã là 1005 ký tự; bài
  đăng ra Dr.JOY thiếu các quy tắc mới.

## 3. Nguyên nhân gốc

- **Sai ở đâu (kỹ thuật):** task release là **bản chụp** definition. Có hai đường lan truyền definition → task,
  **hai luật khác nhau**:
  - Lưu 1 definition → `POST /schedules/regular-release/task`: **DELETE theo `ten_task` + INSERT**, và chỉ chạy
    khi ô ngày release trên màn đang trỏ đúng đợt (`if (releaseDate)` ở [`src/screens/release.tsx`](../../../src/screens/release.tsx)).
  - Nút đồng bộ cả đợt → `POST /schedules/release/sync`: UPDATE theo `(release_month, origin_ref)`, nhưng
    **thủ công**, phải tự nhớ bấm.

  Không đường nào **phát hiện lệch**, và pha precheck của automation **không so** `ai_note`/`action_type` của
  task với definition gốc trước khi ghi ra ngoài.
- **Vì sao lọt qua:** thiết kế coi "task đã sinh" là bản ghi độc lập, nhưng người dùng lại coi definition là
  **nguồn chân lý duy nhất** ("sửa ở quản lý task là xong"). Khoảng cách giữa hai mô hình đó chưa bao giờ được
  hiện ra trên UI: app *biết* cách so lệch (chính `classifyReleaseSync` dùng cho preview) nhưng chỉ trả lời khi
  user chủ động bấm. Automation AI được cắm lên cơ chế snapshot này mà không thêm cổng nào, dù nó là đường
  **ghi ra ngoài** — nơi mọi giả định sai đều thành hậu quả thật.

## 4. Cổng nào hụt & vì sao

| Cổng | Đáng lẽ phải bắt bằng cách nào | Vì sao không bắt được |
|---|---|---|
| ② Thiết kế | Khi thêm `ai_note`/`action_type` vào cơ chế snapshot, thiết kế phải trả lời: "task giữ bản cũ thì ai phát hiện, và AI có được chạy không?" — rồi mới nối vào đường ghi ra ngoài | Thiết kế automation nhận `ai_note` của **task** là đầu vào đúng, không đặt câu hỏi nó có còn khớp definition hay không. Hai đường lan truyền cũng chưa từng được xem là *một* tính năng nên không ai so luật của chúng với nhau |

Không tính là ⑦ Nghiệm thu: nghiệm thu automation kiểm "AI đăng đúng nội dung Note/aiNote của task" — và theo
tiêu chí đó thì nó **đạt**. Lỗi nằm ở chỗ tiêu chí ấy chưa bao giờ hỏi "aiNote của task có còn đúng bản mới nhất".

## 5. Cách sửa

- **Test đỏ tái hiện** (viết TRƯỚC khi sửa): AC-9 của [CR-20260814-hop-nhat](../changes/CR-20260814-hop-nhat-dong-bo-definition-xuong-task.md)
  — dựng task giữ `ai_note` cũ + definition mới, chạy automation, khẳng định **không** có lệnh ghi nào ra ngoài
  (precheck fail-closed `ready=false` với `code='task_lech_definition'`).
- **Sửa:** theo CR đó — một luật ghi duy nhất (match `origin_ref`, UPDATE, không xoá task đã xong), phát hiện
  lệch chủ động (badge ở màn Release + dòng task định kỳ + popup automation), và **cổng precheck chặn** trước
  khi AI ghi ra ngoài.
- **Quét lân cận:** đã quét toàn DB tại thời điểm phát hiện — 14 task chưa chạy của đợt `2026-08` lệch (10 task
  còn `action_type='none'`), 4 task đợt 08 đã done/canceled, 34 task hai đợt khẩn cấp tháng 7. Đã vá **dữ liệu**
  bằng `PATCH /api/tasks/:id` (chỉ `actionType` + `aiNote`; giữ Note/giờ), backup DB trước khi vá
  (`tasks-2026-08-14_171720.sqlite`). Vá dữ liệu **không** phải sửa lỗi — cổng vẫn hụt cho tới khi CR xong.

## 6. Hành động cải tiến

| # | Thay đổi gì | Ở đâu | Trạng thái |
|---|---|---|---|
| 1 | **Fail-closed cho mọi đường AI ghi ra ngoài**: dữ liệu đầu vào của AI mà lệch nguồn định nghĩa ⇒ `ready=false`, không tự đồng bộ rồi chạy | [CR-20260814-hop-nhat](../changes/CR-20260814-hop-nhat-dong-bo-definition-xuong-task.md) FR-6 + AC-9 | ☑ Xong — AC-9 PASS (CR §17), test `automation.test.ts` |
| 2 | **Một luật ghi duy nhất** cho definition → task; cấm match theo `ten_task` | cùng CR FR-1/FR-2 + cổng máy FR-9 | ☑ Xong — AC-1/AC-2/AC-12 PASS (CR §17), cổng máy `check-release-sync.mjs` xanh |
| 3 | **Rule mới**: dữ liệu được COPY từ nguồn khác (snapshot) thì phải có cách phát hiện lệch **hiện chủ động**, không chỉ khi user bấm | [rules/07 §6.2](../../rules/07-rules-backend.md) | ☑ Xong — đã thêm khi triển khai CR |
| 4 | **Ca smoke bắt buộc** khi đụng automation: sửa nguồn định nghĩa rồi xác nhận task của đợt đang chạy phản ánh đúng bản mới | [qa-standard](../../standards/qa-standard.md) | ⚠️ **Bỏ qua có chủ đích** — Leader quyết định 2026-08-21 đóng hồ sơ dựa trên 13/13 AC PASS (test tự động + nghiệm thu Bob/Codex), không chạy 3 điểm smoke đợt thật đã lên kế hoạch ở CR §17. Rủi ro còn lại: chưa xác nhận bằng mắt trên DB thật rằng sửa `ai_note` một definition thật sự cập nhật đúng task đợt mở mà không đụng task đã xong/Note bị mất |

3/4 hành động đã xong qua triển khai CR + nghiệm thu Bob/Codex (13/13 AC PASS, CR §17); mục 4 được Leader
chấp nhận bỏ qua có ghi nhận rủi ro (không phải quên hay lỗi quy trình) — xem `exchanges/2026-08-21.md`.

## 7. Liên kết

- CR sửa: [CR-20260814-hop-nhat-dong-bo-definition-xuong-task](../changes/CR-20260814-hop-nhat-dong-bo-definition-xuong-task.md)
- Chẩn đoán + bằng chứng DB: [exchange 2026-08-14 §5](../../exchanges/2026-08-14.md)
- Bug cùng họ "automation ghi ra ngoài": [BUG-20260803-pha-ghi-thieu-tool-doc](BUG-20260803-pha-ghi-thieu-tool-doc.md)
  (AI dùng tool ghi để dò quyền), [BUG-20260803-precheck-khong-doc-duoc-mcp](BUG-20260803-precheck-khong-doc-duoc-mcp.md)
  (precheck không đối chiếu được nên không chống được đăng trùng) — cùng gốc: **pha ghi chạy trên giả định chưa
  được kiểm**.
- Commit sửa: `5d4fc68` (luật ghi + gate FR-6) · `dab3959` (mở rộng AC-6b: origin_ref còn nhưng definition đã xoá) · `4179853` (FR-5 đủ 3/3 nơi)
- Nghiệm thu: Bob thay Codex — [CR-20260814-hop-nhat §17](../changes/CR-20260814-hop-nhat-dong-bo-definition-xuong-task.md) — 13/13 AC PASS, chờ smoke đợt thật
