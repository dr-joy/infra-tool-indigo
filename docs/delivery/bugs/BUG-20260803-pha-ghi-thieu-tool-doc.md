# BUG-20260803-pha-ghi-thieu-tool-doc — AI tạo 1 bài rác "probe" trên group PM thật, và bài đăng thành công lại bị ghi là thất bại

| Trường | Giá trị |
|---|---|
| Ngày phát hiện | 2026-08-03 (lần chạy thật đầu tiên trên group PM) |
| Người phát hiện | Leader (dùng thật) |
| Mức nghiêm trọng | ⬜ Chặn dùng ✅ Sai dữ liệu ⬜ Khó chịu ⬜ Cosmetic |
| **Sinh ra bởi** | ✅ Có sẵn từ khi làm Automation AI (pha ghi chưa bao giờ có tool đọc) + kịch bản bị kích hoạt bởi `aiNote` vá tay lúc 09:30 |
| **Cổng lẽ ra phải bắt** | ⬜ ① Yêu cầu ✅ ② Thiết kế ⬜ ③ Feedback sớm ⬜ ④ DoR ⬜ ⑤ Bàn giao test ✅ ⑥ Cổng hạ tầng ⬜ ⑦ Nghiệm thu ⬜ ⑧ Chốt/ship |
| **Loại nguyên nhân** | ⬜ RC-REQ ✅ RC-SPEC ⬜ RC-IMPL ✅ RC-TEST ⬜ RC-DATA ⬜ RC-INTEG ⬜ RC-PERF ⬜ RC-SEC ⬜ RC-DOC ⬜ RC-PROC |
| Trạng thái | ⬜ Mới ⬜ Đã có test đỏ ✅ Đã sửa ✅ Đã rút kinh nghiệm |
| Test tái hiện | `test/unit/claude-runner.test.ts` (nhóm `BUG-005`) · `test/integration/automation.test.ts` (nhóm `BUG-005`) |

## 1. Triệu chứng

Sau khi người dùng phê duyệt bản xem trước của task `Announcement - PMs`:

1. Trên group `【個別】PM` xuất hiện **2 bài**: một bài chỉ có chữ `probe` (10:17:59) và **bài thông báo
   release thật** (10:18:45, nội dung + 3 hyperlink đúng, nhưng `toUser: []` — không mention ai).
2. App báo task **`failed`**, `automation_result` rỗng, **không có event `executed`**, không lưu link bài.
   Người dùng nhìn vào tưởng chưa đăng.

Câu AI trả về: *"Thiếu quyền MCP cho get-group-members / list-group-to-presets / get-group-articles /
edit-group-article / delete-group-article: mention rỗng, không quét trùng được, và tồn 1 bài rác 'probe'
do tôi tạo khi thử quyền — phải xoá tay."*

## 2. Tái hiện

1. `CLAUDE_WRITE_TOOLS_POST` chỉ gồm 2 tool ghi (`create-group-article`, `create-group-comment`).
2. `aiNote` yêu cầu AI **kiểm tra group / soát trùng bài / lấy danh sách mention ngay trong pha ghi**.
3. Duyệt bản xem trước → pha ghi chạy.

- **Kỳ vọng:** AI đọc group + soát trùng, mention đúng người, đăng 1 bài duy nhất; app lưu link bài.
- **Thực tế:** AI không có tool đọc nào ⇒ nó dùng **tool duy nhất nó có** để thử quyền: `create-group-article`
  với nội dung `probe`. Rồi đăng bài thật với `toUser` rỗng, rồi báo `success=false`.

## 3. Nguyên nhân gốc

- **Sai ở đâu (kỹ thuật) — hai lỗi độc lập:**
  1. **Pha ghi không có tool ĐỌC.** `executeApprovedTask` truyền `allowedTools = writeToolsFor(actionType)`
     — đúng 2 tool create-*. Không có `get-group-articles` (soát trùng) / `get-group-members` (mention).
     Prompt lại yêu cầu "kiểm tra trước khi đăng" ⇒ **ra lệnh làm việc không có công cụ**, AI xoay sang
     dùng tool ghi để dò. Đây là *ra lệnh sai đi kèm quyền sai*, không phải AI vượt rào: `probe` được
     tạo bằng đúng tool mà con người đã cấp và đã duyệt.
  2. **`success=false` bị coi là "chưa ghi gì".** Nhánh else của `executeApprovedTask` ghi `failed` +
     bỏ luôn `report.link`/`articleId`. Nhưng `success` là *tự đánh giá của AI về toàn bộ nhiệm vụ*, còn
     `articleId` là **dấu vết đã ghi ra ngoài**. Lẫn hai thứ ⇒ mất bằng chứng đã đăng ⇒ `failed` là trạng
     thái mời-thử-lại ⇒ **đăng trùng**. Bài trùng trên group không hoàn tác sạch được.
- **Vì sao lọt qua:** mock Claude chỉ có 2 kịch bản `success=true` và `success=false + link=null`. Không có
  kịch bản *"đã đăng được nhưng báo lỗi"* — đúng kịch bản xảy ra thật. Và chưa có ca nào chạy thật trên
  group thật (trước hôm nay automation mới chỉ chạy với mock hoặc group test).

## 4. Cổng nào hụt & vì sao

| Cổng | Đáng lẽ phải bắt bằng cách nào | Vì sao không bắt được |
|---|---|---|
| ② Thiết kế | Khi thiết kế 2 pha, phải hỏi *"pha ghi cần ĐỌC gì để kiểm tra trước khi ghi?"*. Chống trùng là yêu cầu đã biết, mà công cụ để chống trùng lại không được cấp | Spec chỉ nghĩ theo trục "pha nào được ghi", không nghĩ theo trục "pha nào cần đọc gì để ghi an toàn" |
| ⑥ Cổng hạ tầng | Lần chạy thật đầu tiên trên group thật lẽ ra phải làm trên **group nháp** trước (go-live guide đã ghi khuyến nghị này nhưng không phải cổng bắt buộc) | Khuyến nghị nằm ở dạng văn xuôi, không có checkbox nào chặn |

## 5. Cách sửa

- **Test đỏ trước:** 2 ca unit (`BUG-005` trong `claude-runner.test.ts`) + 2 ca integration
  (`BUG-005` trong `automation.test.ts`) + thêm `MOCK_MODE=partial` vào `scripts/mock-claude.mjs`
  (đã-đăng-nhưng-báo-lỗi).
- **Sửa 1 — pha ghi được cấp tool đọc:** `buildArgs` mode `write` nay = tool ghi **∪** tool đọc đã lọc từ
  `CLAUDE_READ_TOOLS`. Tool đọc vẫn qua `sanitizeReadTools` nên không lọt tool ghi ngoài whitelist.
- **Sửa 2 — dấu vết ghi thắng cờ `success`:** `executeApprovedTask` xét `daGhiRaNgoai = success || articleId || link`.
  Khi đã ghi ra ngoài mà `success=false` ⇒ trạng thái mới **`done_with_warning`**: vẫn là trạng thái CUỐI
  (không tự chạy lại hôm nay, mai được hồi sinh), **lưu bài vào `drjoy_posted_articles`**, ghi event
  `executed` (bằng chứng chống trùng) + `partial_failure` (phần chưa xong). Badge UI: *"Xong, cần xem lại"*
  — cố ý không dùng badge xanh để người dùng không bỏ qua phần thiếu.
- **Dọn dữ liệu thật:** task 1068 chuyển `failed → done_with_warning`, bổ sung bản ghi bài
  `-Oz4cNWCNOmmgNHgJm66` vào sổ bài đã đăng + 2 event còn thiếu. Bài rác `-Oz4cC8eKbxfATWkHga5` và việc
  set To cho bài thật: người dùng tự xử trên web (đã quyết).
- **Quét lân cận:** `aiNote` của task 1068 vẫn là bản vá 09:30 (dồn kiểm tra sang pha ghi) — phải dán lại
  bản A1 trong playbook (đẩy kiểm tra về precheck).

## 6. Hành động cải tiến

| # | Thay đổi gì | Ở đâu | Trạng thái |
|---|---|---|---|
| 1 | Rule: pha ghi **phải** được cấp tool ĐỌC cần cho việc tự kiểm tra trước khi ghi. Không bao giờ ra lệnh "kiểm tra X" mà không cấp tool đọc X — AI sẽ dùng tool ghi để dò | [security-standard §5](../../standards/security-standard.md) | ✅ Xong |
| 2 | Rule: **dấu vết đã-ghi-ra-ngoài (id/link) thắng cờ tự đánh giá của AI.** Có dấu vết ⇒ phải lưu + ghi nhật ký + KHÔNG để trạng thái mời-thử-lại | [rules/07 §9](../../rules/07-rules-backend.md) | ✅ Xong |
| 3 | Mock thêm kịch bản `partial` (đã ghi nhưng báo lỗi) — kịch bản này phải có test cho mọi hành động ghi ra ngoài | `scripts/mock-claude.mjs` + [qa-standard §8.1](../../standards/qa-standard.md) | ✅ Xong |
| 4 | Cổng bắt buộc: **lần chạy thật đầu tiên của một task ghi ra ngoài phải nhắm group/đích NHÁP**, không phải group thật | [security-standard §5](../../standards/security-standard.md) | ✅ Xong |

## 7. Liên kết

- Cùng ngày, cùng vùng: [BUG-20260803-precheck-khong-doc-duoc-mcp](BUG-20260803-precheck-khong-doc-duoc-mcp.md)
  ([CR-20260803](../changes/CR-20260803-precheck-doc-duoc-mcp.md)) — sửa pha ĐỌC. Bug này là **nửa còn
  lại cùng gốc**: sửa pha ĐỌC nhưng chưa nghĩ tới pha GHI cũng cần đọc.
- Bài rác trên group PM: `-Oz4cC8eKbxfATWkHga5` (người dùng tự xoá).
- Bài thật: https://app.drjoy.jp/gr/detail/-Nj5qERhLyOobEbMTUJV/-Oz4cNWCNOmmgNHgJm66 (mention set tay).
- Commit sửa: (điền sau khi commit)
