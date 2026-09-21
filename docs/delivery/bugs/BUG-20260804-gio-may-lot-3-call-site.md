# BUG-20260804-gio-may-lot-3-call-site — Popup mời "chạy ngay" sớm 1.5 tiếng; nhật ký automation và release sync lệch ngày trên máy JST

| Trường | Giá trị |
|---|---|
| Ngày phát hiện | 2026-08-04 |
| Người phát hiện | Codex (rà soát) + Claude (kiểm chứng vòng 2) — [exchanges/2026-08-04](../../exchanges/2026-08-04.md) |
| Mức nghiêm trọng | ✅ Chặn dùng (§9 — ghi sai ra ngoài) ✅ Sai dữ liệu (§1, §7) ⬜ Khó chịu ⬜ Cosmetic |
| **Sinh ra bởi** | ✅ [CR-20260801-scheduler-automation-ve-server](../changes/CR-20260801-scheduler-automation-ve-server.md) — cùng ổ với [BUG-20260803](BUG-20260803-automation-sai-mui-gio.md), **sót lại sau lần sửa đó** ⬜ Có sẵn từ trước ⬜ Không truy được |
| **Cổng lẽ ra phải bắt** | ⬜ ① ⬜ ② ⬜ ③ ⬜ ④ ⬜ ⑤ ✅ ⑥ Cổng hạ tầng ✅ ⑦ Nghiệm thu ⬜ ⑧ |
| **Loại nguyên nhân** | ⬜ RC-REQ ⬜ RC-SPEC ✅ RC-IMPL ⬜ RC-TEST ⬜ RC-DATA ⬜ RC-INTEG ⬜ RC-PERF ⬜ RC-SEC ⬜ RC-DOC ✅ RC-PROC |
| Trạng thái | ⬜ Mới ⬜ Đã có test đỏ ✅ Đã sửa ✅ Đã rút kinh nghiệm |
| Test tái hiện | `test/client/automation-ask.test.ts` (nhóm `daQuaGioVN`, 6 ca) · `test/integration/automation.test.ts` (3 ca `BUG-20260804 §1`) · `test/unit/release-sync.test.ts` (5 ca) · **cổng máy** `scripts/check-tz.mjs` |

## 1. Triệu chứng

Máy làm việc đặt **Asia/Tokyo (+9)**. Ba biểu hiện, cùng một gốc:

| # | Người dùng thấy gì | Nơi |
|---|---|---|
| §9 | Task AI hẹn **10:00** (giờ VN): từ **08:30 VN** popup automation đã hiện banner *"⏰ Đã quá giờ chạy — thực hiện NGAY?"* và đổi nút thành **"Phê duyệt & chạy ngay"**. Bấm vào là Claude đăng bài **sớm 1 tiếng 30 phút**. | `src/main.tsx:1517` |
| §1 | Sau 22:00 VN, các event `approved`/`executed`/`partial_failure`/`failed` được ghi vào khóa occurrence của **ngày hôm sau**, trong khi `due`/`asked` (vòng tick + FE) vẫn ở ngày VN. Nhật ký của cùng một lần chạy bị **tách đôi**. | `server/routes/automation.ts` `occKeyOf` |
| §7 | Sau 22:00 VN, sync task release **bỏ im lặng** task của đúng hôm nay (xếp vào `skipped: 'past'`). Không có lỗi nào hiện ra — người dùng chỉ thấy task không được cập nhật. | `server/routes/schedules.ts` `todayLocalDate` |

§9 là mục **nặng nhất**: hai mục kia làm sai *nhật ký*, mục này làm **bài đăng sai giờ** — nó là đường duy nhất trong cả ba chọc qua được lớp chắn hành vi, vì không cần lách cổng nguyên tử nào, chỉ cần người dùng bấm đúng cái nút mà UI mời.

## 2. Tái hiện

**§9** (đã chạy thật, không phải suy luận):

1. Máy đặt `Asia/Tokyo`. Task định kỳ AI (`actionType=post`), giờ bắt đầu `10:00`.
2. Lúc **08:30 giờ VN** (= 10:30 JST), mở popup automation của task đó.

- **Kỳ vọng:** không có banner "đã quá giờ"; nút chính là **"Phê duyệt"** (chờ tới 10:00 VN, tick server thực thi).
- **Thực tế:** có banner "đã quá giờ"; nút chính là **"Phê duyệt & chạy ngay"**.

```
gio VN hien tai: 08:30 | task 10:00 VN | quaGio (code cũ) = true | dung phai la: false
```

**§1:** duyệt/thực thi một task trong khoảng **22:00–23:59 VN** (= 00:00–01:59 JST hôm sau) ⇒ event mang khóa `2026-08-02:…` trong khi occurrence là `2026-08-01:…`.

**§7:** lúc **23:30 VN** ngày 04/08, sync một release có task `ngay_cu_the = 2026-08-04` ⇒ task bị xếp `past`, không được cập nhật.

## 3. Nguyên nhân gốc

- **Sai ở đâu (kỹ thuật):**
  - `occKeyOf` (§1) và `todayLocalDate` (§7) cắt ngày bằng `getFullYear/getMonth/getDate` = **múi giờ máy**.
  - `quaGio` (§9) **không dùng API nào bị cấm trực tiếp** — nó gọi hai *helper* giờ máy:
    `parseLocalDateTime(localDateInputValue(), …)`. Đây là chi tiết quan trọng nhất của hồ sơ này (xem mục 6).
  - Tầng lỗi phụ của §1: `occKeyOf(task)` gọi `new Date()` **mỗi lần dùng** và `executeApprovedTask` gọi nó 3 lần
    trong cùng một `withTransaction` ⇒ một lượt vắt qua nửa đêm ghi `executed` và `partial_failure` vào **hai khóa
    khác nhau**. Sửa múi giờ **không** chữa được tầng này; phải tính khóa một lần.
- **Vì sao lọt qua:** [BUG-20260803](BUG-20260803-automation-sai-mui-gio.md) đã sửa đúng gốc thời gian và mục 6 của nó
  **đã viết rule** cấm nguyên văn các API này. Nhưng:
  1. Mục *"Quét lân cận"* của lần sửa đó **tuyên bố đã đối chiếu `occurrenceKeyOf` ↔ `occKey` FE** — mà bỏ sót bản
     `occKeyOf` **riêng trong route**, `todayLocalDate` ở `schedules.ts`, và `quaGio` ở `main.tsx`. Quét theo **tên
     hàm đã biết**, không quét theo **API bị cấm** trên toàn vùng quyết định.
  2. Hành động cải tiến của lần đó dừng ở **viết rule cho người đọc**. `npm run check` không biết rule đó tồn tại ⇒
     rule bị vi phạm **3 lần ngay sau khi được viết** mà không cổng nào lên tiếng. **Rule mà máy không thi hành được
     thì lần sau vẫn lọt.**

## 4. Cổng nào hụt & vì sao

| Cổng | Đáng lẽ phải bắt bằng cách nào | Vì sao không bắt được |
|---|---|---|
| **⑥ Cổng hạ tầng** (chính) | `npm run check` phải có một bước thi hành rule gốc thời gian, để mọi lần giao sau đều bị gác — kể cả lần giao của chính người vừa viết rule | Rule chỉ tồn tại dưới dạng văn bản trong `rules/07 §8.1`. Không có cổng máy nào đọc nó. Ba vi phạm đi qua `npm run check` xanh |
| ⑦ Nghiệm thu (phụ) | Sau khi sửa BUG-20260803, bước quét lân cận phải grep theo **API** (`getFullYear`…) trên toàn vùng quyết định, không grep theo tên hàm đã biết | Hồ sơ ghi "đã đối chiếu `occurrenceKeyOf` ↔ `occKey`" — đúng với hai chỗ *được nhớ tới*, và điều đó tạo cảm giác đã quét xong |

## 5. Cách sửa

- **Test đỏ tái hiện** (viết TRƯỚC khi sửa — [qa-standard §3](../../standards/qa-standard.md)): **14 ca**, mốc luôn là
  thời điểm tuyệt đối (`Date.UTC` / ISO có `Z`) nên kết quả không phụ thuộc múi giờ máy chạy test:
  - `test/client/automation-ask.test.ts` — 6 ca `daQuaGioVN`, gồm ca `08:30 VN + task 10:00 → false` (bản cũ trả `true`)
    và hai ca ranh giới ngày `23:30 VN`.
  - `test/integration/automation.test.ts` — 3 ca: execute lúc `2026-08-01T16:00:00Z` (23:00 VN) phải cho khóa
    `2026-08-01:…`; `executed` + `partial_failure` cùng lượt phải **cùng một khóa**; `approve` ghi khóa ngày VN.
  - `test/unit/release-sync.test.ts` — 5 ca quanh mốc `2026-08-04T16:30:00Z` (23:30 VN / 01:30 JST hôm sau).
  - Ngoài ra **cổng máy** `scripts/check-tz.mjs` ([CR-20260804](../changes/CR-20260804-cong-may-gio-vn.md)) đỏ đúng 3
    chỗ trước khi sửa — đó là test đỏ ở mức *toàn vùng*, không chỉ mức từng hàm.
- **Sửa:**
  - §9: thêm hàm thuần `daQuaGioVN(gioBatDau, now)` vào [`src/lib/automation-ask.ts`](../../../src/lib/automation-ask.ts)
    (dùng `vietnamInstant` + `currentVietnamDateInputValue`); `main.tsx` gọi nó, còn một dòng.
    **Cố ý chỉ 2 tham số, không nhận `ngay`**: ngày suy ra từ chính `now` theo giờ VN nên caller không có chỗ nào để
    truyền ngày máy vào — đúng cánh cửa đã sinh ra lỗi này (Codex đề nghị 3 tham số, đã rút lại sau khi bàn).
  - §1: xoá `occKeyOf` khỏi route, dùng `occurrenceKeyOf` chung; `executeApprovedTask(taskId, now = new Date())` tính
    khóa **một lần** ở đầu hàm; vòng tick truyền `now` của lượt nó xuống ⇒ khóa `due` và khóa `executed` bằng nhau
    **theo định nghĩa**.
  - §7: tách hàm thuần `isPastReleaseTaskDate(ngay, now)` dùng `vietnamDateKey`; `classifyReleaseSync(…, now)` gọi nó.
    Không export `classifyReleaseSync` (nó query DB bên trong vòng lặp nên unit test sẽ phải dựng DB fixture).
  - Sửa doc-comment `parseLocalDateTime` — câu cũ (*"Dùng ở nhiều nơi: App reconcile, màn release, **popup
    automation**"*) đang **mời** dùng sai đúng ở chỗ đã sinh ra §9.
  - [spec 03](../../specs/03-api-business-logic-spec.md): ghi thành đặc tả rằng khóa occurrence **tính một lần cho cả
    lượt** — trước đó đây là giả định ngầm, và chính nó là tầng lỗi thứ hai của §1.
- **Quét lân cận** (lần này quét theo **API + helper**, bằng máy, không bằng ký ức):
  - `scripts/check-tz.mjs` chạy trên 9 file vùng quyết định ⇒ sau khi sửa: **0 vi phạm**.
  - `src/screens/release.tsx:2098` cũng dùng `parseLocalDateTime` — đã xem: dựng giờ **kết thúc hiển thị** cho
    emergency release, không phải quyết định. Chưa nằm trong vùng quét (giới hạn đã biết của CR-20260804).
  - **Dữ liệu lịch sử: KHÔNG cần vá.** Đã query DB thật (12 event): **0 event có khóa lệch ngày VN**. Lý do thoát:
    mọi event do route ghi đều rơi vào giờ hành chính VN (09:55–17:03), còn cửa sổ nổ của §1 là 22:00–23:59 VN.
    Câu kiểm dùng lại được:
    ```js
    // so ngày trong occurrence_key với ngày VN của created_at
    rows.filter(r => r.occurrence_key.slice(0,10) !== vnDate(r.created_at))
    ```
  - Nợ tồn **riêng của BUG-005**, không thuộc hồ sơ này: occurrence `2026-08-03:1068:10:00` đang có cả `failed` (id 13,
    do code ghi) lẫn `executed`+`partial_failure` (id 14–15, chèn tay lúc vá) ⇒ hai kết luận cuối ngược nhau; và
    `tasks.automation_error` của task 1068 còn ghi *"bài rác probe `-Oz4cC8eKbxfATWkHga5` cần xoá tay"*. Cả hai chờ
    Leader duyệt xử lý — xem [exchanges/2026-08-04](../../exchanges/2026-08-04.md) §11.

## 6. Hành động cải tiến

| # | Thay đổi gì | Ở đâu | Trạng thái |
|---|---|---|---|
| 1 | **Cổng máy thi hành rule gốc thời gian** — `npm run check` có bước "Gốc thời gian (giờ VN)" quét 9 file vùng quyết định. Đây là hành động chính: rule đã tồn tại và đã đúng, cái thiếu là người thi hành nó | [`scripts/check-tz.mjs`](../../../scripts/check-tz.mjs) + [CR-20260804](../changes/CR-20260804-cong-may-gio-vn.md) | ✅ Xong |
| 2 | **Cấm cả *helper* giờ máy, không chỉ API gốc** (`localDateInputValue`, `parseLocalDateTime`, `taoNgayTuInput`, `congNgayInput`, `congThangInput`). Bài học riêng của §9: `main.tsx` có **0** lần dùng API bị cấm — cổng chỉ khớp API sẽ **xanh ở đúng lỗi nặng nhất** | [rules/07 §8.1](../../rules/07-rules-backend.md) · [rules/06](../../rules/06-rules-frontend.md) | ✅ Xong |
| 3 | **Vùng quét phải gồm cả `src/`**, không chỉ server. Bản đề xuất đầu (Codex) chỉ liệt kê file server ⇒ sẽ bỏ lọt §9 | `VUNG_QUYET_DINH` trong [`scripts/check-tz.mjs`](../../../scripts/check-tz.mjs) (có test khoá lại) | ✅ Xong |
| 4 | Rule: **"quét lân cận" phải quét theo API/hành vi bằng máy, không theo tên hàm bằng ký ức.** Hồ sơ BUG chỉ được ghi "đã quét lân cận" khi có một lệnh chạy được kèm theo | [qa-standard](../../standards/qa-standard.md) | ✅ Xong |
| 5 | Rule: **mỗi hành động cải tiến phải trả lời "cổng nào thi hành điều này"**; nếu câu trả lời là "người tự nhớ" thì phải nói rõ đó là điểm yếu còn lại | [ADR-P2](../../standards/team-operating-standard.md) | ✅ Xong |
| 6 | Đặc tả: khóa occurrence **tính một lần cho cả lượt** (giả định ngầm ⇒ tầng lỗi thứ hai của §1) | [spec 03](../../specs/03-api-business-logic-spec.md) | ✅ Xong |

## 7. Liên kết

- CR liên quan: [CR-20260804-cong-may-gio-vn](../changes/CR-20260804-cong-may-gio-vn.md) (cổng máy — dựng trước, cố ý
  để đỏ, trạng thái đỏ của nó chính là test đỏ của hồ sơ này) · [CR-20260801](../changes/CR-20260801-scheduler-automation-ve-server.md) (sinh ra lỗi)
- Commit sửa: (điền sau khi commit)
- **Bug tương tự đã từng gặp:** [BUG-20260803-automation-sai-mui-gio](BUG-20260803-automation-sai-mui-gio.md) — **cùng
  root cause**. Đây là lần **thứ hai** của cùng một gốc lỗi; giá trị lớn nhất của hồ sơ này là dữ kiện *"một lần sửa
  đã tuyên bố quét lân cận xong mà vẫn để sót 3 call site"*, và nó chỉ nhìn thấy được ở lần thứ hai.
- Rà soát sinh ra hồ sơ: [exchanges/2026-08-04](../../exchanges/2026-08-04.md) §1, §7, §9, §10, §13.
