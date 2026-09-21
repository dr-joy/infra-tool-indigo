# CR-20260808-luong-duyet-cho-dung-gio-bao-ket-qua — Duyệt xong thì chờ đúng giờ, chạy xong thì báo kết quả

| Trường | Giá trị |
|---|---|
| Loại | ☑ Sửa hành vi ☑ Thêm mới |
| Mức tác động | ☑ Lớn (hợp đồng `/execute`, UI orchestration, hành động AI ghi ra ngoài) |
| Người đề xuất | tuan.vu (Leader — phát hiện khi test thật), BA: Claude, phản biện: Codex |
| Ngày | 2026-08-08 |
| Trạng thái | ⬜ Draft ✅ Đã review ✅ Đã duyệt ✅ Đã triển khai ✅ Đã nghiệm thu |
| Spec liên quan | [docs/specs/03-api-business-logic-spec.md §2](../../specs/03-api-business-logic-spec.md) · [docs/specs/04-database-design.md §4](../../specs/04-database-design.md) · [docs/exchanges/2026-08-08.md §10–11](../../exchanges/2026-08-08.md) |

## 1. Bối cảnh & Vấn đề

Ngày 2026-08-08, Leader test thật 3 task cách nhau 5 phút. Task đầu tiên lộ ngay vấn đề — và nó **gây hậu
quả thật, không phải góp ý về cảm giác**.

Task hẹn **10:45** nhưng chạy lúc **10:43:42** — sớm 1 phút 18 giây. Nhật ký chứng minh không phải vòng
tick (`decideAutomationAction` chỉ trả `execute` khi `diffMin <= 0`), mà đến từ nút **"Chạy ngay"** trên
popup sau khi duyệt.

Gốc rễ có hai tầng:

1. **Tầng giao diện:** sau khi bấm Phê duyệt, popup ở lại và bày ba nút — *Mở task* · *Hủy lịch* ·
   **"Chạy ngay"** (nút chính, màu nổi). Hành động người dùng thật sự muốn — *đợi tới giờ* — **không có nút
   nào**, phải bấm dấu X. Mặc định an toàn là lựa chọn duy nhất không được biểu diễn thành nút, còn nút nổi
   nhất lại phá vỡ lịch.
2. **Tầng backend (Codex phát hiện — quan trọng hơn):** `/api/automation/execute` chỉ kiểm task đã
   `approved`, **không kiểm đã tới giờ chưa**. Nút UI chỉ là *cách lỗi biểu hiện lần này*; một lỗi giao diện
   khác hoặc một lời gọi API trực tiếp vẫn cho chạy sớm. Sửa nút mà không sửa backend là vá triệu chứng.

Cộng thêm hai khoảng trống nữa cùng nằm trên đoạn dây *duyệt → chạy → phản chiếu kết quả*:

3. **Không bao giờ có popup báo kết quả.** `useAutomation` không đồng bộ phiên từ server; vòng poll 30s chỉ
   làm mới danh sách task. Duyệt xong đóng popup thì lúc server chạy xong **không có gì hiện lên**. Luồng
   Leader mong muốn (*xong thì báo*) hiện chưa tồn tại.
4. **UI biến `done_with_warning` và `unknown_outcome` thành `failed`** kèm nút "Thử lại"
   (`executeAutomation`). Backend đã giữ khoá đúng, nhưng người dùng nhận thông điệp sai và nếu bấm sẽ gặp
   409 thay vì được chỉ dẫn đi đối chiếu.

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Không lượt nào chạy trước giờ hẹn, **kể cả khi gọi thẳng API** — ràng buộc ở backend, không dựa vào UI.
  - "Phê duyệt" mang đúng một nghĩa: *đồng ý kế hoạch và chờ đúng giờ*. Duyệt xong popup đóng.
  - Lượt chạy xong thì kết quả **tự hiện**, đúng một lần, đúng occurrence — kể cả khi app đã đóng rồi mở lại.
  - Mọi trạng thái cuối hiển thị đúng tên **và đúng hành động cho phép**; `done_with_warning` /
    `unknown_outcome` **không** được bày "Thử lại".
  - Nhật ký ghi được **ai kích hoạt** lượt chạy (scheduler hay người).
- **Ngoài phạm vi:**
  - KHÔNG đổi cơ chế cổng chống ghi trùng của CR-20260807 (giữ nguyên claim + reservation).
  - KHÔNG đo/lưu thời lượng thật của mỗi lượt (Codex: chưa đủ mẫu — để hồ sơ sau).
  - KHÔNG làm thanh tiến trình / streaming tool-call (thuộc hướng B', xem exchanges §6b).
  - KHÔNG mở lại 2 task `other` bị khoá vì thiếu capability.

## 3. Người dùng & Kịch bản

- Là **operator**, khi tôi bấm Phê duyệt lúc 10:40 cho task hẹn 10:45, tôi muốn popup đóng lại và **yên tâm
  rằng nó sẽ chạy lúc 10:45**, để tôi quay lại làm việc khác mà không sợ bấm nhầm làm nó chạy sớm.
- Là operator, khi task chạy xong tôi muốn **được báo**, kể cả lúc đó tôi đang mở màn hình khác hoặc vừa mở
  lại app — thay vì phải tự nhớ đi mở task ra xem.
- Là operator, khi kết quả là "không rõ đã ghi hay chưa", tôi muốn UI **chỉ tôi đi đối chiếu**, chứ không
  mời tôi bấm "Thử lại" một việc có thể đã làm rồi.

## 4. Yêu cầu chức năng

### Nhóm A — Chặn chạy sớm ở tầng dữ liệu/nghiệp vụ

- **FR-1 (cổng thời gian ở backend):** `executeApprovedTask` từ chối khi **chưa tới giờ hẹn**
  (`minutesUntilVietnam(ngày VN, gioBatDau, now) > 0`) → `HttpError(409)` nêu rõ giờ hẹn, **KHÔNG spawn
  Claude, KHÔNG tạo reservation**. Đặt guard **trước** claim và reservation — Codex xác nhận thứ tự đúng
  (§14.1 câu 3): race giữa guard và claim không tạo lỗ, vì thời gian chỉ tiến về phía "được phép hơn", và
  hai request cùng lọt qua guard vẫn bị claim nguyên tử `approved→running` chặn còn một.
  - **Fail closed khi không xác định được giờ** (Codex bổ sung): `minutesUntilVietnam(...) === null` (thiếu
    hoặc sai định dạng) → coi như **CHƯA tới giờ**, từ chối — không được coi thiếu dữ liệu là "đã tới giờ".
  - **Một `now` duy nhất cho cả lượt** (Codex bổ sung): bơm cùng một `now` vào guard, occurrence key và
    claim flow — giống cách vòng tick đang làm. Không gọi `new Date()` lại giữa các bước, tránh lệch định
    nghĩa ở test/ranh giới nửa đêm.
  - Vòng tick không bị ảnh hưởng: nó vốn chỉ gọi khi `diffMin <= 0`.
  - Lời hứa chính xác là **"không chạy trước HH:MM"**, không phải "chạy đúng HH:MM" — scheduler tick 30s
    nên thực tế bắt đầu ở lượt tick đầu tiên từ HH:MM trở đi. UI viết "sẽ chạy từ HH:MM".
- **FR-2 (ghi nguồn kích hoạt — sửa theo Codex §14.1 câu 3):** `executeApprovedTask` nhận thêm tham số
  `nguon: 'scheduler' | 'user_overdue'` — **bắt buộc, không có giá trị mặc định**, để call-site mới/sót
  fail lúc biên dịch thay vì âm thầm ghi sai nguồn. (`'user_overdue'` chứ không phải `'user'` chung — chỉ
  còn xảy ra khi user bấm "Phê duyệt & chạy ngay" lúc **đã quá giờ**, vì luồng bấm sớm đã bị FR-3 loại bỏ.)
  Ghi vào `detail` của event `execute_reserved`.

### Nhóm B — Luồng phê duyệt

- **FR-3 (bỏ "Chạy ngay" trước giờ — Leader chốt):** màn preview:

  | Tình huống | Nút chính | Sau khi thành công |
  |---|---|---|
  | **Chưa tới giờ** | `Phê duyệt — chạy lúc HH:MM` | **Đóng popup** + toast **đúng chữ**: *"Đã duyệt, sẽ chạy từ HH:MM"* |
  | **Đã quá giờ** | `Phê duyệt & chạy ngay` (giữ nguyên) | Chuyển sang màn đang chạy |

  Bỏ hẳn màn `approved` trung gian — không tự mở popup chỉ để hỏi lại. Không còn đường chạy sớm nào trong
  luồng thường (Leader chốt phương án A của Codex §11.7). Nội dung toast là một phần bắt buộc của AC-3
  (Codex §14.6.2 — trước đó AC chỉ kiểm popup đóng/trạng thái task, thiếu kiểm nội dung toast).

### Nhóm C — Báo kết quả theo occurrence

- **FR-4 (typed result feed, đọc SNAPSHOT — sửa theo Codex §16.1/§16.2/§16.3, thay hẳn cách suy diễn cũ):**
  Bản trước định suy `status` từ **tổ hợp tên event** (`executed` có/không kèm `partial_failure`) —
  Codex chỉ ra ngay một ca sai thật: khi user reconcile "đã ghi rồi" từ `unknown_outcome`
  (`server/routes/automation.ts` nhánh `laDaGhi`), backend ghi `executed` với detail là câu xác nhận thủ
  công, **không có `partial_failure`** — nhưng trạng thái đúng đã chốt là `done_with_warning`. Suy theo tổ
  hợp tên event sẽ trả sai thành `done`. **Đã tự kiểm chứng bằng code thật, xác nhận đúng.**

  Đổi sang: tại **mọi điểm chuyển sang trạng thái cuối**, backend ghi thêm một event server-only
  **`result_recorded`** với `detail` là JSON snapshot đã chốt sẵn `status` — không để nơi đọc phải suy:

  ```ts
  type ResultSnapshot = {
    status: 'done' | 'done_with_warning' | 'unknown_outcome' | 'failed';
    message: string | null; error: string | null; link: string | null;
    actionType: 'post' | 'other' | null;
    target: { connector?: string; groupName?: string; groupId?: string | null; mode?: string | null; articleId?: string | null } | null;
  }
  ```

  - **Dedupe theo TRANSITION, không theo occurrence trần (sửa theo Codex §18.1 — blocker logic thật)**: bản
    trước dùng `dedupe_key = '<occurrence>:result_recorded'` (một occurrence chỉ ghi được MỘT snapshot vĩnh
    viễn) đồng thời đòi hỏi "lấy bản mới nhất khi có nhiều transition" — **hai điều này không thể cùng
    đúng**: lượt reconcile ghi sau sẽ bị chính UNIQUE index chặn, feed vẫn trả `unknown_outcome` cũ, đúng ca
    cần sửa lại không được sửa. Chọn phương án **append theo transition** (Codex khuyến nghị, giữ được nhật
    ký bất biến/audit được, thay vì UPSERT làm mất lịch sử):

    ```text
    dedupe_key = '<occurrence>:result_recorded:auto'       -- ghi bởi executeApprovedTask / tick mark_unknown
    dedupe_key = '<occurrence>:result_recorded:reconcile'   -- ghi bởi route /cancel khi user tự xác nhận
    ```

    Tối đa 2 snapshot/occurrence trong toàn bộ thiết kế hiện tại (`auto` luôn xảy ra trước — nó là điều
    kiện để `unknown_outcome` tồn tại; `reconcile` chỉ có thể xảy ra sau, đúng một lần vì
    `chotReconcile` là compare-and-set). Không bỏ hẳn dedupe: retry cùng call-site (crash rồi chạy lại đúng
    nhánh) vẫn phải bị chặn tạo bản trùng trong CÙNG một transition.

  - **Ghi STRICT và ATOMIC với chuyển trạng thái (blocker, sửa theo Codex §21.1 — đã tự kiểm chứng bằng
    code thật)**: `logEvent()` hiện tại **nuốt lỗi** (`try { insertEvent.run(...) } catch {}`). Gọi nó bên
    trong `withTransaction()` **không** làm nó atomic — insert lỗi bị nuốt, transaction vẫn commit phần đổi
    `automation_status`. Nếu dùng nguyên hàm này cho `result_recorded`, task có thể hiện "đã xong"/"không rõ
    kết quả" mà **không có gì để result feed đọc** — đúng thứ CR này sinh ra để chống.

    Thêm writer mới, riêng cho `result_recorded`, KHÔNG nuốt lỗi (không dùng `logEvent()`, cũng không dùng
    nguyên `logEventStrict()` vì hàm đó tự ghép `<occurrence>:<event>`, chưa biểu diễn được transition):
    nhận `occKey`, `transition: 'auto' | 'reconcile'`, snapshot → tự ghép
    `dedupe_key = '<occKey>:result_recorded:<transition>'`. Gọi hàm này **trong cùng transaction** với CAS
    chuyển trạng thái cuối — insert lỗi thì cả transaction rollback, task không được phép "đã xong" mà
    thiếu snapshot. `created_at` của snapshot lấy **cùng một `now`/timestamp** với chính transition đó,
    không gọi đồng hồ rời rạc giữa các dòng ghi trong cùng transaction.

  - **Danh sách điểm ghi — theo CALL-SITE/TRANSACTION, không theo status (sửa theo Codex §24.1, lần thứ 3
    audit vẫn hụt)**: hai vòng trước tự nhận "6 điểm" nhưng bảng thật có 7 dòng (tự mâu thuẫn số đếm), và
    dòng "#3 Claude ném lỗi" gộp nhầm **hai call-site khác nhau**: nhánh `catch (error)` (Claude thật sự
    ném exception) và nhánh report `success=false` không có `link`/`articleId` (Claude **không ném gì cả**,
    chỉ trả về báo cáo nói thất bại) — hai đường code khác nhau, cùng dẫn tới `unknown_outcome`. Liệt kê lại
    đúng theo call-site, một call-site có thể sinh nhiều status khác nhau tuỳ nhánh:

    | # | Call-site | Transition | Status có thể sinh ra |
    |---|---|---|---|
    | 1 | `executeApprovedTask` — transaction thành công (`daGhiRaNgoai`) | `auto` | `done` hoặc `done_with_warning` (tuỳ `thanhCongTronVen`) |
    | 2 | `executeApprovedTask` — report `success=false`, không `link`/`articleId`, **không ném exception** | `auto` | `unknown_outcome` — xem **AC-30** |
    | 3 | `executeApprovedTask` — khối `catch (error)`, Claude **ném** exception | `auto` | `failed` (chưa từng spawn) hoặc `unknown_outcome` (đã spawn, không rõ) |
    | 4 | Route `/cancel` — user reconcile "đã ghi rồi" | `reconcile` | `done_with_warning` |
    | 5 | `executeApprovedTask` — đụng bản giữ chỗ đã tồn tại lúc claim (nhánh `catch` sau `matClaim=false`) | `auto` | `unknown_outcome` |
    | 6 | Tick `mark_unknown` khi lease `running` quá hạn (`automation-scheduler.ts`) | `auto` | `unknown_outcome` |

    **6 call-site**, một số sinh 2 status khác nhau tuỳ nhánh con — đây là lý do đếm theo call-site thay vì
    đếm theo status, để không lặp lại đúng lỗi vừa mắc (nói "6" nhưng liệt kê lệch số dòng).

    **Một điểm đã kiểm và xác nhận KHÔNG cần sửa**: nhánh `occurrenceDaGhiRaNgoai(occKey)` ở đầu
    `executeApprovedTask` (chuyển sang `done_with_warning` khi occurrence đã có `executed` từ trước) —
    occurrence đó **đã có** snapshot gốc từ lần thành công đầu tiên (call-site #1 ở trên), nên đây chỉ là
    dọn lại trạng thái `approved` cũ bị stale, không phải một transition mới cần snapshot riêng.

  - **Occurrence dùng để ghi snapshot PHẢI là occurrence đã lưu, không tính lại (blocker, sửa theo Codex
    §24.2 — đã tự kiểm chứng bằng code thật)**: `tickOnce` hiện tính `occKey = occurrenceKeyOf(taskId, gio,
    now)` từ **giờ hiện tại của task + thời điểm tick** (dòng đầu vòng lặp, dùng chung cho MỌI hành động).
    Với call-site #6 (`mark_unknown`), task đang `running` đã có occurrence **thật** lưu sẵn ở
    `tasks.automation_occurrence_key` từ lúc giành quyền — nếu giờ task bị sửa hoặc lượt chạy vắt qua ranh
    giới ngày, khoá tính lại sẽ khác khoá đã lưu, và snapshot bị gắn nhầm occurrence (phá cả dedupe lẫn đối
    chiếu với `execute_reserved`).

    Quy tắc cho **mọi** recovery của một lượt đang chạy: ưu tiên tuyệt đối `automation_occurrence_key` đã
    lưu; bản ghi cũ thiếu cột này thì fallback đúng nguyên tắc "chỉ nhận khi có ĐÚNG MỘT reservation chưa
    giải quyết" (giống route reconcile ở CR-20260807, không tự dựng khoá mới từ giờ hiện tại); không xác
    định được duy nhất thì fail-closed, không gắn snapshot vào một khoá đoán.

    Nguyên tắc chung thay cho đếm số (Codex): **mọi CAS/UPDATE thực sự chuyển task vào một trong bốn
    terminal status phải ghi snapshot atomic trong cùng transaction** — bảng trên là kết quả audit tại thời
    điểm viết CR, không phải danh sách đóng cứng; nếu sau này thêm call-site mới, phải áp đúng nguyên tắc
    này, không copy số 6/7.
  - **Dữ liệu cũ (trước CR này) không có snapshot** → xem "resolver dùng chung" ở FR-5, không tự suy riêng
    ở đây nữa (Codex §18.2 — sửa cả hai chỗ bằng một nguồn duy nhất).
  - Endpoint:

    ```text
    GET /api/automation/results?unseen=true&days=7
    → [{ occurrenceKey, taskId, taskTitle, actionType, status, message, error, link, target, completedAt }]
    ```

  - **Một occurrence = một record trả về** (Codex §16.3/§18.1): resolver chọn snapshot có `created_at` lớn
    nhất trong tối đa 2 bản (`auto`, `reconcile`), tie-break bằng `id`. Không trả cả hai.
  - Sắp xếp toàn danh sách theo `completedAt` ASC (phục vụ FIFO ở FR-6), lọc occurrence **chưa có**
    `result_seen`.
  - `days` mặc định 7, cap `[1, 90]`; `unseen` validate boolean. JSON snapshot cap độ dài, không lộ
    stack/path (`security-gate`).

  | Nguồn (event `result_recorded`, KHÔNG suy từ event khác) | `status` |
  |---|---|
  | Ghi xong trọn vẹn | `done` |
  | Ghi xong nhưng có phần lỗi | `done_with_warning` |
  | User reconcile "đã ghi rồi" (từ `unknown_outcome`) | `done_with_warning` — **đúng ca vừa sửa** |
  | Claude ném lỗi, không rõ đã ghi hay chưa | `unknown_outcome` |
  | Chưa từng spawn Claude | `failed` |
  | `missed`, `expired`, `checking_timeout`, `reset`, `reserve_released` | **Không ghi `result_recorded`** — lifecycle/recovery nội bộ, không phải kết quả cho người dùng. `missed` đã có digest riêng (một dòng duy nhất — bản trước lặp dòng này hai lần, Codex §18.3) |

- **FR-5 (đánh dấu đã xem — dùng CHUNG một resolver với FR-4, sửa theo Codex §14.4 + §16.5 + §18.2 blocker):**
  **Không** dùng `/automation/event` chung (route đó nhận input tự do từ client — xem FR-7). Thêm
  `POST /automation/results/:occurrenceKey/seen`.

  **Blocker đã sửa:** bản trước chỉ cho ghi `result_seen` khi "đã tồn tại `result_recorded`" — nhưng dữ
  liệu legacy (trước CR) theo định nghĩa **không có** event đó, nên mọi kết quả cũ báo bù ra sẽ không bao
  giờ ghi được "đã xem", modal không thoát, poll sau lại báo lại vô hạn. Sửa: route `seen` gọi **đúng cùng
  một hàm resolver** mà `GET /results` dùng để dựng danh sách (snapshot mới nếu có, fallback best-effort
  cho legacy nếu không) — không tự suy loại riêng, không cho client tự khai là legacy.

  Chỉ ghi `result_seen` khi:
  1. occurrence key đúng định dạng (`OCC_KEY_RE` đã có);
  2. **resolver trả được một kết quả hợp lệ** cho occurrence đó (snapshot mới HOẶC legacy fallback resolve
     được — không nhất thiết phải là `result_recorded`);
  3. **chưa có** `result_seen` cho occurrence đó (idempotent — gửi lại vẫn 200, không tạo bản thứ hai).

  Không giới hạn theo ngày hôm nay: cửa sổ báo bù là **7 ngày** (khớp `days` mặc định của FR-4), để mở app
  đóng cả buổi hoặc qua ngày khác vẫn thấy đúng kết quả cũ — không quét lại từ trạng thái task hiện tại
  (task có thể đã đổi giờ hoặc reset sang chu kỳ mới, xem Codex §14.3).

  **Xử lý khi request "đã xem" lỗi (Codex §16.5):** disable nút trong lúc gửi; chỉ gỡ item khỏi
  active/queue **sau khi** server trả 200; lỗi mạng/HTTP → giữ nguyên modal, hiện lỗi + nút thử lại, KHÔNG
  tự đóng (nếu đóng mà chưa 200 thì poll sau sẽ bật lại — đúng hành vi mong muốn, nhưng người dùng tưởng đã
  xong). Với digest nhiều occurrence: gọi FR-5 **cho từng occurrence riêng**; occurrence thành công thì bỏ
  khỏi digest, occurrence lỗi vẫn còn và digest hiện rõ số chưa xác nhận — không coi cả nhóm là đã xem chỉ
  vì phần lớn đã xong.

- **FR-6 (hàng đợi FIFO, không dùng "magic number", không đụng modal khác — sửa theo Codex §14.1 câu 2 +
  §16.4):**
  - **Không ghi đè bất kỳ automation modal/confirmation/digest đang mở** — mở rộng danh sách "đang bận" từ
    `checking/needs_input/preview` thành: **`checking`, `needs_input`, `preview`, `blocked`, `running`**,
    popup hỏi `automationReconfirm`, digest "việc lỡ" (`missed`), và **result modal/digest đang mở**. Bất
    kỳ cái nào đang mở → kết quả mới **xếp hàng**, không ghi đè.
  - UI rảnh và hàng đợi có **đúng 1** kết quả → popup chi tiết như cũ.
  - UI rảnh và hàng đợi có **từ 2 trở lên** → **một digest** cho toàn bộ hàng đợi (không phải "≥3").
  - Đóng popup chi tiết / đóng digest (đúng cách, xem FR-5) → áp lại hai quy tắc trên cho phần còn lại.
  - **Dedupe giữa response `/execute` và poll (Codex §16.4 mục 1):** khi user bấm "Phê duyệt & chạy ngay"
    lúc đã quá giờ, response của chính request đó **và** vòng poll kế tiếp có thể cùng thấy occurrence này
    chưa `result_seen`. Active-item + queue chỉ được chứa **mỗi occurrence đúng một lần** — kiểm trùng bằng
    `occurrenceKey` trước khi thêm vào queue, không thêm hai lần chỉ vì hai nguồn cùng báo.
  - **Poll kết quả CHẠY ĐỘC LẬP với ngày đang xem trên dashboard (Codex §16.4 mục 2):** effect hiện tại của
    `useAutomation` return sớm khi `ngayDinhKy !== hôm nay` — đó là logic đúng cho "có nên hỏi task sắp tới
    không", **không** áp dụng cho việc tải/hiện kết quả. Vòng poll kết quả phải chạy trong mọi trường hợp,
    kể cả khi dashboard đang xem một ngày khác.
- **FR-7 (whitelist event cho client — sửa theo Codex §14.1 câu 1, ĐÃ SỬA SAI Ở BẢN TRƯỚC):** `POST
  /automation/event` hiện **không có whitelist nào** — đây là lỗ hổng **có sẵn từ trước CR này**, không
  phải do CR gây ra, nhưng CR phải vá vì đang chạm đúng route đó.

  Whitelist chỉ gồm đúng 4 event mà FE thật sự đang gửi hôm nay — **KHÔNG** có `result_seen` (đi qua FR-5
  riêng, không qua route này) và **KHÔNG** có bất kỳ event server-only nào:

  ```text
  CLIENT_EVENT_WHITELIST = ['asked', 'declined', 'snoozed', 'acknowledged']
  ```

  Ngoài danh sách → **400**. Đặc biệt cấm: `executed`, `execute_reserved`, `due`, `approved`,
  `partial_failure`, `failed`, `missed`, `reset`, `expired`, `checking_timeout`, `unknown_outcome`,
  `reserve_released` — đây là các dấu vết server dùng để chống ghi trùng; client gửi được thì giả mạo được
  chính bằng chứng đó.

### Nhóm D — Hiển thị đúng trạng thái cuối

- **FR-8 (map đúng + hành động đúng — Codex §11.5, ràng buộc thêm ở §14.6.4):**
  - Bất biến phải giữ và có test: `failed` **chỉ** sinh ra từ nhánh `ClaudeNotConfiguredError` /
    `spawn_failed` (chưa từng spawn Claude) — đây là điều kiện DUY NHẤT được phép bày nút "Thử lại". Nếu
    sau này state machine nới thêm nhánh khác dẫn tới `failed`, nút Thử lại sẽ thành nguy hiểm; test phải
    khoá đúng bất biến này, không chỉ khoá tên hiển thị.

  | Backend trả | Popup hiện | Hành động cho phép |
  |---|---|---|
  | `done` | Hoàn thành + link/nội dung | Đóng · Mở task |
  | `done_with_warning` | Đã ghi nhưng **cần xem lại** + cảnh báo | Đóng · Mở task — **KHÔNG retry** |
  | `unknown_outcome` | **Không rõ đã ghi hay chưa** + hướng dẫn đối chiếu | Mở task để xử lý (2 nút xác nhận ở `AiKetQua`) — **KHÔNG retry** |
  | `failed` (chưa từng spawn) | Chưa ghi gì | Có thể Thử lại |
  | Lỗi HTTP/mất kết nối | **Không tự suy trạng thái** | Tải lại task rồi phản chiếu trạng thái server |

## 5. Yêu cầu phi chức năng

- **Sửa theo Codex §16.7 mục 1** (bản trước mâu thuẫn với FR-4 đã đổi endpoint): không thêm timer mới —
  dùng cùng nhịp poll 30s hiện có, nhưng gọi **typed result feed mới** (`GET /automation/results`), không
  còn gọi `GET /automation/events?occurrenceKeys=` cho mục đích này (endpoint đó vẫn giữ nguyên cho mục
  đích cũ — hỏi `declined`/`asked`).
- Không thêm bảng/cột DB — `result_recorded` và `result_seen` là hai giá trị `event` mới trong
  `automation_events`.
- **Validate input/output cho 2 endpoint mới (Codex §16.7 mục 2):** `days` cap `[1, 90]`, mặc định 7;
  `unseen` validate boolean; giới hạn số record trả về (theo mẫu `LIMIT 500` đã có ở `/automation/events`);
  JSON snapshot trong `detail` cap độ dài, không lộ stack/path/secret ra UI.
- Cổng chống ghi trùng của CR-20260807 giữ nguyên; CR này chỉ **thêm** rào, không nới.
- Chạm vùng nhạy cảm (endpoint điều khiển AI ghi ra ngoài) → áp `security-gate`.

## 6. Thiết kế giải pháp

### 6.1. Luồng người dùng

```
10:40  popup nhắc "Nhờ AI làm task này?"  → [Có]
10:40  precheck (read-only) → preview
       [ Hủy ]  [ Phê duyệt — chạy lúc 10:45 ]
              ↓ bấm duyệt
       popup ĐÓNG + toast "Đã duyệt, sẽ chạy từ 10:45"
10:45  scheduler chạy (backend từ chối mọi lệnh chạy trước mốc này)
≤30s   poll GET /automation/results?unseen=true thấy kết quả ĐÚNG occurrence → popup KẾT QUẢ
       user đóng → POST /automation/results/:occurrenceKey/seen → không bật lại
```

Modal kết quả **không dismissable bằng click-outside/ESC** (khác Modal thường): đóng = acknowledge, nên
phải qua đúng nút trong popup để chắc chắn gọi FR-5 — tránh trường hợp đóng ngoài ý muốn làm mất dấu "đã
xem" (Codex §14.6.3).

### 6.2. API & nghiệp vụ

- `POST /api/automation/execute` — thêm **409** khi chưa tới giờ hẹn (kèm giờ hẹn trong message).
- `POST /api/automation/event` — thêm **400** khi `event` ngoài whitelist `[asked, declined, snoozed,
  acknowledged]`. **Không** thêm `result_seen` vào route này (đi qua FR-5 riêng).
- `GET /api/automation/results?unseen=true&days=7` **(mới)** — typed result feed, xem FR-4.
- `POST /api/automation/results/:occurrenceKey/seen` **(mới)** — xem FR-5.
- `GET /api/automation/events?occurrenceKeys=…` — **không đổi**, vẫn dùng cho mục đích cũ (FE hỏi
  `declined`/`asked` để quyết định có mời lại hay không).

### 6.3. Dữ liệu & schema

- Không thêm bảng/cột. Giá trị `event` mới (sửa theo Codex §21.3 — bản trước chỉ liệt kê `result_seen`,
  thiếu `result_recorded`):
  - **`result_recorded`** — snapshot kết quả, dedupe theo TRANSITION: `<occurrence>:result_recorded:auto`
    hoặc `<occurrence>:result_recorded:reconcile` (xem FR-4). `detail` là JSON `ResultSnapshot`.
  - **`result_seen`** — dedupe theo occurrence (`<occurrence>:result_seen`), chỉ ghi qua route
    `/results/:occurrenceKey/seen`, không qua `/automation/event`.
- `execute_reserved.detail` nay chứa nguồn kích hoạt (`scheduler` / `user_overdue`).

### 6.4. Automation / tích hợp

- Không đổi whitelist tool, không đổi permission-mode, không đổi cách truyền prompt.
- Thay đổi **giảm** số lần spawn (chặn sớm trước khi spawn).

## 7. Phân tích tác động

- [x] Frontend (`src/useAutomation.ts`, `src/components/automation-popup.tsx`, `src/main.tsx`, `src/types.ts`)
- [x] API route (`server/routes/automation.ts` — 2 endpoint mới) · [x] Automation (vòng tick truyền `nguon`)
- [ ] DB/migration (không thêm cột) · [ ] i18n · [ ] Đóng gói SEA
- [x] Bảo mật (endpoint điều khiển ghi ra ngoài → `security-gate`; whitelist event chặn giả mạo bằng chứng)
- [x] Dữ liệu cũ (occurrence đã kết thúc trước CR chưa có `result_seen` → báo bù qua cửa sổ 7 ngày)
- **Rủi ro & giảm thiểu:**
  - *Báo bù nổ hàng loạt lần đầu tiên sau khi ship*: mọi occurrence trong 7 ngày qua đều "chưa xem". Giảm
    thiểu: quy tắc FR-6 tự gom digest khi có ≥2 kết quả, không cần ngưỡng riêng cho lần đầu.
  - *Client giả mạo bằng chứng chống trùng* (Codex §14.1 câu 1, blocker bảo mật): whitelist event ở FR-7
    hẹp lại đúng 4 giá trị FE thật đang gửi — đóng luôn một lỗ hổng **có sẵn từ trước CR này**.
  - *Chặn chạy sớm làm kẹt ca hợp lệ*: task đã quá giờ vẫn chạy được (guard chỉ chặn `> 0` phút).
  - *Mất "Chạy ngay" gây bất tiện*: Leader đã chốt bỏ; nếu sau này cần, phải là ý định tường minh riêng.
- **Ảnh hưởng chức năng đang chạy:** đường "duyệt rồi để tick chạy" **không đổi hành vi**; chỉ bịt đường
  chạy sớm và thêm phần báo kết quả.

## 8. Tiêu chí nghiệm thu

Lấy nguyên bộ AC tối thiểu Codex đề nghị (§11.6), đánh số lại:

| AC | Given / When / Then |
|---|---|
| **AC-1** | Given task hẹn 10:45 đã duyệt / When gọi `/execute` lúc 10:44:59 / Then **409**, không spawn Claude, **không** tạo `execute_reserved` |
| **AC-2** | Given task hẹn 10:45 / When tick chạy lúc 10:45:00 hoặc sau / Then thực thi **đúng một lần** |
| **AC-3** | Given preview trước giờ / When bấm Phê duyệt / Then popup đóng **và hiện đúng toast "Đã duyệt, sẽ chạy từ HH:MM"**, task ở `approved`, **chưa có** `execute_reserved` |
| **AC-4** | Given lượt chạy bởi scheduler / Then `execute_reserved.detail` ghi `scheduler`; chạy do user bấm "Phê duyệt & chạy ngay" lúc đã quá giờ → ghi `user_overdue` |
| **AC-5** | Given occurrence đã duyệt chạy xong / When poll nhận event kết thúc đúng occurrence / Then bật popup kết quả **đúng một lần** trong tối đa một chu kỳ poll |
| **AC-6** | Given hai occurrence xong gần nhau / When popup thứ nhất đang mở / Then kết quả thứ hai **xếp hàng**, không ghi đè |
| **AC-7** | Given backend trả `done_with_warning` hoặc `unknown_outcome` / Then UI **không** bày "Thử lại" và chỉ đúng hành động |
| **AC-8** | Given request execute mất kết nối sau khi server đã claim / When FE refresh / Then hiển thị trạng thái **từ server**, không tự gắn `failed` |
| **AC-9** | Given task định kỳ đã xong **hôm qua và đã `result_seen`** / When mở app hôm nay / Then **không** bật lại popup kết quả cũ |
| **AC-10** | Given user sửa giờ sau khi duyệt / When poll chạy / Then **không** ghép event của occurrence cũ vào lịch mới |
| **AC-11** | Given hàng đợi có **từ 2 kết quả chưa xem trở lên** khi UI rảnh / Then hiện **một digest** cho toàn bộ hàng đợi (không phải popup từng cái); đóng digest → tất cả được đánh dấu `result_seen` |
| **AC-12** | Given `POST /automation/event` với `event` ngoài whitelist `[asked, declined, snoozed, acknowledged]` / Then **400**, không ghi gì. Riêng thử gửi `executed` hoặc `execute_reserved` → cũng 400 (xem AC-17) |
| **AC-13** | Given task hoàn tất **hôm qua** và chưa `result_seen` / When mở app hôm nay / Then vẫn báo bù đúng occurrence cũ (cửa sổ 7 ngày, không chỉ hôm nay) |
| **AC-14** | Given task đổi giờ **sau khi** occurrence cũ đã hoàn tất / When tải danh sách kết quả chưa xem / Then kết quả cũ vẫn giữ đúng khoá/giờ cũ, không bị mất và không bị gắn sang lịch mới |
| **AC-15** | Given occurrence mà resolver **không** resolve được một kết quả hợp lệ (không snapshot, không legacy) / When gọi `POST /automation/results/:occurrenceKey/seen` / Then **404/409**, không ghi `result_seen` (sửa theo Codex §18.3 — trước đây nói "chưa có terminal event", nay khớp đúng resolver dùng chung) |
| **AC-16** | Given occurrence đã có kết quả / When gọi seen **hai lần** / Then cả hai request đều thành công (idempotent), DB chỉ có **một** dòng `result_seen` |
| **AC-17** | Given client gửi `event=executed` hoặc `event=execute_reserved` qua `POST /automation/event` / Then **400**, không tạo được bằng chứng giả trong `automation_events` |
| **AC-18** | Given occurrence từng `unknown_outcome` (snapshot `auto`) rồi user reconcile "đã ghi rồi" (snapshot `reconcile` ghi THÊM, không bị chặn bởi snapshot `auto`) / When đọc result feed / Then trả đúng **một** item `done_with_warning`, không trả `done` và không còn item `unknown_outcome` cũ. Kiểm ở tầng DB: cả 2 dòng `result_recorded` cùng tồn tại, feed chọn đúng dòng `reconcile` vì `created_at` lớn hơn |
| **AC-19** | Given một occurrence có cả snapshot `auto` và `reconcile` / When đọc feed / Then tối đa **một** item, nội dung theo snapshot có `created_at` lớn nhất, tie-break `id` |
| **AC-20** | Given bất kỳ automation modal/digest đang mở (`blocked`/`running`/`automationReconfirm`/digest `missed`/result modal) / When unseen result tới / Then **enqueue**, không render modal chồng lên hoặc ghi đè |
| **AC-21** | Given response `/execute` (chạy ngay lúc quá giờ) và vòng poll kết quả cùng thấy một occurrence / Then active + queue chỉ chứa occurrence đó **đúng một lần** |
| **AC-22** | Given dashboard đang xem ngày khác hôm nay / When unseen result xuất hiện / Then vẫn báo trong tối đa một chu kỳ poll; không ảnh hưởng logic nhắc task của ngày đang xem |
| **AC-23** | Given request "đã xem" lỗi / When user bấm nút xem trong popup kết quả / Then modal **không** biến mất, hiện lỗi + nút thử lại; thử lại không tạo `result_seen` trùng |
| **AC-24** | Given digest có nhiều occurrence và chỉ một request "đã xem" lỗi / Then occurrence thành công được bỏ khỏi digest; occurrence lỗi vẫn còn, digest hiện đúng số chưa xác nhận |
| **AC-25** | Given occurrence **legacy** (trước CR, không có `result_recorded`) mà resolver vẫn tổng hợp được một kết quả hợp lệ từ event cũ / When gọi `seen` / Then **200**, ghi đúng một `result_seen`; feed `unseen` sau đó không còn trả occurrence này |
| **AC-26** | Given occurrence không có snapshot mới **và** resolver không tổng hợp được gì hợp lệ từ event cũ / When gọi `seen` / Then **404/409**, không ghi gì |
| **AC-27** | Given insert `result_recorded` thất bại (giả lập lỗi ghi) / When một nhánh đang chuyển task sang trạng thái cuối / Then **toàn bộ transaction rollback** — task KHÔNG được ở trạng thái cuối mà thiếu snapshot tương ứng |
| **AC-28** | Given reservation collision lúc claim, hoặc lease `running` quá hạn ở tick / When backend chuyển task sang `unknown_outcome` / Then có đúng một snapshot `result_recorded:auto` cùng transaction, và `GET /automation/results` trả được đúng item đó |
| **AC-29** | Given task đang `running` có `automation_occurrence_key` của lượt cũ và giờ task đã bị sửa hoặc ngày đã đổi / When lease quá hạn / Then `unknown_outcome` + snapshot dùng đúng occurrence đã lưu, không dùng key tính lại từ lịch hiện tại |
| **AC-30** | Given Claude trả report `success=false`, không `link`/`articleId` và **không ném exception** (call-site #2, dòng 693-713) / When `executeApprovedTask` kết thúc / Then task là `unknown_outcome`, có đúng một `result_recorded:auto` ghi atomic cùng transition, reservation vẫn giữ (không giải phóng), và `GET /automation/results` trả đúng item `unknown_outcome` cho đúng occurrence |

## 9. Kế hoạch test

- Tầng: ☑ Unit (guard thời gian, chọn occurrence, queue) ☑ Integration route (`/execute` 409, `/event` 400)
  ☑ Render component (map trạng thái, không có nút retry) ☑ Hook/wiring (`API response → session`)
  ☑ Smoke thủ công
- Ca biên bắt buộc: **1 ms trước giờ bị chặn** / đúng giờ chạy được · occurrence của ngày khác · sửa giờ sau
  khi duyệt · hai kết quả về cùng lúc · reload giữa chừng.

## 10. Kế hoạch triển khai / rollback

- Thứ tự: FR-1/FR-2 (backend guard + nguồn) → FR-7 (whitelist event — vá lỗ hổng có sẵn trước, độc lập với
  phần còn lại) → FR-8 (map trạng thái) → FR-3 (UI duyệt) → FR-4/5/6 (typed result feed + seen + queue).
- **Rollback (sửa theo Codex §14.6.5 — "revert commit" là chưa đủ):** revert code sạch về mặt schema (không
  có migration). Nhưng nếu bản mới đã ghi `result_seen` cho các occurrence thật, đó là **dữ liệu
  acknowledgement có chủ ý của người dùng** — không phải rác. Nếu sau đó roll-forward lại (deploy lại bản
  mới), các `result_seen` đó sẽ tiếp tục đúng vai trò của nó (không hiện lại kết quả đã xem). Không script
  nào được xoá các dòng `result_seen` khi rollback.

## 11. Docs cần cập nhật sau khi làm xong

- [x] `docs/specs/03-api-business-logic-spec.md` — 409 chưa tới giờ, whitelist `/event`, 2 endpoint mới
  (`/results`, `/results/:occurrenceKey/seen`), nguồn kích hoạt (nhân tiện dọn một đoạn nội dung bị trùng/cắt
  giữa dòng có sẵn từ trước ở §2, phát hiện khi sửa đúng đoạn đó)
- [x] `docs/specs/04-database-design.md` — event `result_recorded` (dedupe `:auto`/`:reconcile`/`:failed:<ts>`) +
  `result_seen`, contract JSON snapshot, `detail` của `execute_reserved` (sửa theo Codex §18.3 — bản trước
  chỉ liệt kê `result_seen`, thiếu `result_recorded`)
- [x] `docs/operations/automation-ai-go-live-guide.md` — cập nhật B6 (luồng duyệt mới, không còn "Chạy
  ngay" trước giờ) + §5 (409 chưa tới giờ, whitelist event, 2 endpoint mới)

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Claude | 2026-08-08 | |
| Phản biện — thiết kế, vòng 1 | Codex | 2026-08-08 | ✅ chẩn đoán + yêu cầu hàng rào (§11.1–11.6) |
| Leader | tuan.vu | 2026-08-08 | ✅ chốt 3 câu §11.7: bỏ "Chạy ngay" trước giờ · có báo bù theo occurrence · một popup + digest |
| Phản biện — thiết kế, vòng 2 (DoR) | Codex | 2026-08-08 | ❌ **Chưa đạt DoR** — 3 blocker (§14.2 typed result feed, §14.3 cửa sổ 7 ngày, §14.4 acknowledgement có điều kiện) + whitelist event sai ở bản trước (đã sửa ở CR này) |
| Phản biện — thiết kế, vòng 3 (DoR) | Codex | 2026-08-08 | ❌ **Chưa đạt DoR** — bảng mapping suy từ tổ hợp tên event sai 1 ca thật (§16.2); cần snapshot kết quả có kiểu + latest-terminal-wins (§16.1/16.3) + mở rộng race modal (§16.4) + xử lý lỗi acknowledgement (§16.5) — đã sửa ở CR này |
| Phản biện — thiết kế, vòng 4 (DoR) | Codex | 2026-08-08 | ❌ **Chưa đạt DoR** — UNIQUE `result_recorded` đang chặn terminal transition mới nhất; fallback dữ liệu cũ không thể acknowledge theo FR-5 (§18 exchange) |
| Phản biện — thiết kế, vòng 5 (DoR) | Codex | 2026-08-08 | ❌ **Chưa đạt DoR** — chưa bắt buộc snapshot được ghi strict + atomic với terminal state; danh sách điểm ghi còn thiếu các nhánh recovery thật (§21 exchange) |
| Phản biện — thiết kế, vòng 6 (DoR) | Codex | 2026-08-08 | ❌ **Chưa đạt DoR** — audit vẫn thiếu nhánh report thất bại không ném; tick recovery chưa khóa nguồn occurrence gốc (§24 exchange) |
| Phản biện — thiết kế, vòng 7 (DoR) | Codex | 2026-08-08 | ❌ **Chưa đạt DoR** — hai blocker thiết kế đã đóng; còn thiếu AC snapshot/feed cho call-site report thất bại vừa bổ sung (§26 exchange) |
| Phản biện — thiết kế, vòng 8 (DoR cuối) | Codex | 2026-08-08 | ✅ **Đạt DoR** — AC-30 đã phủ call-site cuối; contract khả thi, khả test, legacy/rollback/security đã khép; `npm.cmd run check` xanh (§28 exchange) |
| Người triển khai | Claude | 2026-08-08 | Code xong theo §10, `npm run check` xanh — chưa smoke thủ công (§29/§30 exchange) |
| Phản biện — triển khai, vòng 1 | Codex | 2026-08-08 | ❌ **Chưa đạt review/DoD** — 5 blocker: attempt dedupe, popup trùng, `/seen` nuốt lỗi, HTTP state reflection, queue/modal stale (§29 exchange) |
| Sửa theo review triển khai, vòng 1 | Claude | 2026-08-08 | Đã sửa cả 5 blocker + 3 test mới (hook + integration) — xem §19; `npm run check` xanh (§31 exchange) |
| Phản biện — triển khai, vòng 2 | Codex | 2026-08-08 | ❌ **Chưa đạt review/DoD** — còn 3 blocker frontend: đóng popup trước khi `/seen` thành công, recovery mất response có thể kẹt `running` và che result feed, điều phối modal/reconcile chưa khép (§32 exchange) |
| Sửa theo review triển khai, vòng 2 | Claude | 2026-08-08 | Đã sửa cả 3 + 3 test mới, có kiểm chứng test ĐỎ khi hoàn nguyên fix — xem §20; `npm run check` xanh 266 BE + 99 FE (§33 exchange) |
| Phản biện — triển khai, vòng 3 | Codex | 2026-08-08 | ❌ **Chưa đạt review/DoD** — recovery bỏ qua occurrence gốc server, reload lỗi vẫn để session chặn result feed, refresh sau reconcile đóng modal trước khi tải feed xong nên còn flash snapshot cũ (§34 exchange) |
| Sửa theo review triển khai, vòng 3 | Claude | 2026-08-08 | Đã sửa cả 3 + 2 test mới (tổng 8 ca hook), kiểm chứng test ĐỎ khi hoàn nguyên từng fix — xem §21; `npm run check` xanh 266 BE + 101 FE (§35 exchange) |
| Phản biện — triển khai, vòng 4 | Codex | 2026-08-08 | ❌ **Chưa đạt review/DoD** — terminal đã xóa occurrence gốc vẫn bị FE tính lại khóa; refresh feed thất bại tắt suppress và làm snapshot cũ hiện lại (§36 exchange) |
| Sửa theo review triển khai, vòng 4 | Claude | 2026-08-08 | Đã sửa cả 2 + 2 test mới (tổng 10 ca hook), kiểm chứng test ĐỎ khi hoàn nguyên từng fix — xem §22; `npm run check` xanh 266 BE + 103 FE (§37 exchange) |
| Phản biện — triển khai, vòng 5 | Codex | 2026-08-08 | ❌ **Chưa đạt review/DoD** — reconcile một occurrence đang đánh dấu nghi ngờ/ẩn toàn bộ queue; refresh lỗi làm các kết quả không liên quan biến mất và không có tín hiệu retry (§38 exchange) |
| Sửa theo review triển khai, vòng 5 | Claude | 2026-08-08 | Đã sửa + 1 test multi-item mới (tổng 11 ca hook), kiểm chứng test ĐỎ khi hoàn nguyên — xem §23; `npm run check` xanh 266 BE + 104 FE (§39 exchange) |
| Phản biện — triển khai, vòng 6 | Codex | 2026-08-08 | ❌ **Chưa đạt review/DoD** — digest làm mất row occurrence khi cùng task có nhiều lượt; edit-context có thể giữ key cũ; poll phục hồi feed nhưng không dọn banner lỗi (§40 exchange) |
| Sửa theo review triển khai, vòng 6 | Claude | 2026-08-08 | Đã sửa cả 2 + 2 test mới (12 hook + 7 component), kiểm chứng test ĐỎ khi hoàn nguyên — xem §24; `npm run check` xanh 266 BE + 106 FE (§41 exchange) |
| Phản biện — triển khai, vòng 7 | Codex | 2026-08-08 | ❌ **Chưa đạt review/DoD** — poll và refresh feed không có generation/serialization; response cũ đến muộn có thể ghi đè snapshot mới hoặc dựng banner lỗi giả sau khi đã hồi phục (§42 exchange) |
| Sửa theo review triển khai, vòng 7 | Claude | 2026-08-08 | Đã thêm generation cho mọi fetch feed + 2 test deferred-promise, kiểm chứng test ĐỎ khi hoàn nguyên — xem §25; `npm run check` xanh 266 BE + 108 FE (§43 exchange) |
| Phản biện — triển khai, vòng 8 | Codex | 2026-08-08 | ❌ **Chưa đạt review/DoD** — generation “request bắt đầu sau cùng thắng” cho phép poll nền vô hiệu refresh foreground rồi fail im lặng; poll >30s có thể generation-starve (§44 exchange) |
| Đánh giá nguyên nhân gốc | Codex | 2026-08-08 | ⛔ **Dừng vá cục bộ** — FE orchestration của result/recovery sai cấp trừu tượng; yêu cầu chốt thiết kế coordinator + invariant + test matrix trước khi code (§45 exchange) |
| Phản hồi thiết kế refactor | Claude | 2026-08-08 | Đã nộp thiết kế `useAutomationResults` (single-flight + ưu tiên, bỏ generation; state per-occurrence) + 10 invariant + 14 ca test — **chưa code**, chờ Codex duyệt (§46 exchange) |
| Phản biện thiết kế refactor, vòng 1 | Codex | 2026-08-08 | ❌ **Chưa đạt DoR refactor** — fetch job thiếu current targets/waiters; invariant hidden/error mâu thuẫn pending; boundary dashboard/edit-context và nguồn direct terminal chưa chốt; yêu cầu matrix 21 ca (§47 exchange) |
| Thiết kế refactor bản 2 | Claude | 2026-08-08 | `FetchJob{id,targets,controller}` + waiter theo target; `RefreshState`/`AckState` union thay boolean+error; UI bỏ hẳn `occurrenceKey` (`ketThucReconcile()` không tham số); direct terminal **feed-only**; matrix 21 ca — **chưa code** (§48 exchange) |
| Phản biện thiết kế refactor, vòng 2 | Codex | 2026-08-08 | ❌ **Chưa đạt DoR refactor** — poll không clear được failed entry; reducer thuần đang chứa controller/waiter; reconcile singleton và direct-session API chưa khép; test side effect đặt sai tầng (§49 exchange) |
| Thiết kế refactor bản 3 | Claude | 2026-08-08 | Bỏ "luật 5 bước theo target", thay bằng **CAS theo revision per-entry** (một quy tắc, không case riêng theo target/priority); tách reducer thuần khỏi runtime driver qua `Effect[]`; `activeReconcileKey` singleton (+ `cancel()` khi không map được Task); direct terminal dùng chung cổng `enqueueForeground` với retry; matrix 24 ca chia 3 tầng reducer/driver/integration — **chưa code** (§50 exchange) |
| Phản biện thiết kế refactor, vòng 3 | Codex | 2026-08-08 | ❌ **Chưa đạt DoR refactor** — revision tổng hợp làm UI metadata vô hiệu fetch; CAS thiếu key mới/tombstone; side effect chạy trong React updater; waiter/reconcile/recovery lifecycle chưa idempotent (§51 exchange) |
| Thiết kế refactor bản 4 | Claude | 2026-08-08 | `syncEpoch` chỉ bump đúng sự kiện liệt kê tường minh (không còn "mọi transition"); CAS phủ cả tombstone (loại trừ entry `ganVoiPhien`/`choTerminal`); coordinator chuyển thành **external store + `useSyncExternalStore`** (bỏ effect trong updater); waiter chỉ resolve từ effect `RESOLVE_WAITERS` (bỏ nguồn resolve thứ 2 ở `.finally`); reconcile handle CAS theo `reconcileId`; recovery hợp nhất thành `choTerminalTrongPhien()`; matrix 32 ca — **chưa code** (§52 exchange) |
| Phản biện thiết kế refactor, vòng 4 | Codex | 2026-08-08 | ❌ **Chưa đạt DoR refactor** — thiết kế dựa vào `seenAt` không tồn tại trong API; tombstone attached có thể chờ vô hạn; hook tạo store riêng cho mỗi caller thay vì một owner; `stop`/timeout/waiter chưa khép lifecycle (§53 exchange) |
| Thiết kế refactor bản 5 | Claude | 2026-08-08 | Xác nhận `seenAt` không tồn tại (đọc lại `server/routes/automation.ts`) — bỏ hẳn, dùng `unseen=false` cho mọi fetch có target rõ, không đổi BE/API; `SnapshotState` theo phase (`none/ready/awaiting/not_found`) có `maxAttempts` do nơi gọi quyết định, không giữ vô hạn; một `AutomationResultsStore` duy nhất qua `AutomationResultsProvider` (Context), không phải mỗi hook một store; `lifecycleId` chặn callback trễ sau `stop()`, timeout dispatch thẳng `FETCH_ABORTED` không phụ thuộc transport tôn trọng `AbortSignal`; matrix 38 ca — **chưa code** (§54 exchange) |
| Phản biện thiết kế refactor, vòng 5 | Codex | 2026-08-08 | ❌ **Chưa đạt DoR refactor** — `unseen=false` vẫn là full feed cap 500/retention nên không authoritative theo target và có thể hồi sinh item đã ACK; recovery `maxAttempts:null` vẫn vô hạn; lifecycle token chưa phủ mọi fetch callback (§55 exchange) |
| Thiết kế refactor bản 6 | Claude | 2026-08-08 | **Đổi phạm vi: thêm 1 endpoint BE** `GET /automation/results/lookup?occurrenceKeys=` (dùng lại `giaiQuyetKetQua()`, không business logic mới) làm tra cứu theo khoá thay cho suy diễn từ full feed; foreground luôn gọi endpoint này, background vẫn `unseen=true` — hai loại job không còn coalesce lẫn nhau; `SnapshotState.awaiting` đổi từ đếm `maxAttempts` sang `deadline` tuyệt đối (một cơ chế cho cả `ganVaoPhien`/`choTerminalTrongPhien`), sweep mỗi nhịp poll, lặp lookup cho entry đang chờ để không lọt ca "ACK tab khác trước poll"; `nextJobId` không reset qua lifecycle + guard lifecycle ở mọi nhánh async kể cả `finally`; reset lúc `stop()` đi qua reducer, bỏ gán field tay — **chưa code** (§56 exchange) |
| Phản biện thiết kế refactor, vòng 6 | Codex | 2026-08-08 | ❌ **Chưa đạt DoR refactor** — `stop()` có thể promote và chạy queued job; lookup chưa apply target vắng response; deadline recovery chưa có công thức/detach contract; batch cap 20 lệch queued coalescing không giới hạn (§57 exchange) |
| Thiết kế refactor bản 7 | Claude | 2026-08-08 | `STORE_STOPPED` là transition nguyên tử thay cho tái dùng `FETCH_ABORTED` (đóng race promote-queued-lúc-stop); foreground apply lặp theo `job.targets` (kể cả key vắng response → `awaiting`), không lặp theo response keys; deadline recovery có công thức cụ thể từ hằng số BE có sẵn (`automationUpdatedAt + RUNNING_LEASE_MINUTES + grace scheduler/poll` ≈ 11 phút 30s), tách timer 5s riêng cho direct-terminal (fail-fast) khỏi nhịp poll 30s của recovery; `SWEEP_DEADLINES` đặt `not_found` + tự detach trong cùng 1 transition; hàng đợi foreground đổi sang danh sách chưa gộp, chunk ≤20 lúc promote thay vì gộp trước — **chưa code** (§58 exchange) |
| Phản biện thiết kế refactor, vòng 7 | Codex | 2026-08-08 | ❌ **Chưa đạt DoR refactor** — `Set` target làm mất missing-policy/deadline của reconcile; queued request chưa giữ invariant một claim/key nên poll có thể nhân backlog; direct timer chưa có lifecycle và invalid `automationUpdatedAt` tạo deadline `NaN`/fallback 24h mơ hồ (§59 exchange) |
| Thiết kế refactor bản 8 | Claude | 2026-08-08 | Đơn giản hoá theo gợi ý cuối của Codex thay vì thêm registry: entry tự giữ `snapshotState` (đặt lúc attach) để apply đọc và diễn giải "vắng response" — không cần metadata riêng trong job; hàng đợi đổi sang `Map<occurrenceKey, Claim>` cho cả `current` lẫn `queuedClaims` — "một claim/key" thành bất biến cấu trúc, không cần luật quét trùng; bỏ hẳn timer 5s riêng cho direct-terminal (`ganVaoPhien` chỉ 1 lookup one-shot, vắng dữ liệu coi là anomaly → bàn giao); sửa `NaN`/fallback-24h của deadline recovery — deadline không hợp lệ thì không attach; detach dùng `detachReason` tường minh thay suy luận qua cạnh boolean — **chưa code** (§60 exchange) |
| Duyệt DoR refactor bản 8 | Codex | 2026-08-08 | ✅ **Đạt DoR refactor — được phép code theo 5 lát có review gate**; giữ 3 AC tích hợp: auto-detach atomic với typed reason, invalid recovery metadata không được chặn queue, chỉ snapshot `ready` được visible; chưa phải DoD (§61 exchange) |
| Chốt implementation protocol | Codex | 2026-08-08 | Claude implement 5 lát, mỗi lát có slice brief → test/negative proof → `npm run check` → một commit → handoff packet → **dừng chờ Codex PASS**; lệch thiết kế phải `DESIGN REOPEN`, không tự suy diễn; bắt đầu chỉ lát 1 endpoint BE (§62 exchange) |
| Implementation lát 1/5 — BE lookup endpoint | Claude | 2026-08-08 | Commit `ffe5880`: thêm batch lookup theo key, validation/dedupe/cap 20, dùng chung resolver, API spec và integration tests; handoff tại §63 — chờ review |
| Code review lát 1, vòng 1 | Codex | 2026-08-08 | `REWORK` hẹp — code endpoint đúng, targeted/full check xanh; thiếu test contract target nằm ngoài top 500 của full feed như gate §62.2 đã cam kết, handoff đếm sai số ca mới; chưa sang lát 2 (§64 exchange) |
| REWORK lát 1 — cap-500 regression | Claude | 2026-08-08 | Commit `10c345d`: thêm test target thứ 501 bị full feed cắt nhưng targeted lookup vẫn trả; negative proof tái dùng full-feed path làm test đỏ; sửa handoff thành 14 cũ + 11 mới (§65 exchange) |
| Code review lát 1, vòng 2 | Codex | 2026-08-08 | `PASS` — endpoint/API contract lát 1 được khóa; test mục tiêu 25/25, full gate 277 BE + 108 FE xanh; được nộp brief và triển khai lát 2 core thuần, chưa đụng driver/React (§66 exchange) |
| Implementation lát 2/5 — reducer thuần | Claude | 2026-08-08 | Commit `2853de1`: `src/lib/automation-results-reducer.ts` — CAS theo `syncEpoch`, `SnapshotState` theo phase, hàng đợi `Map<key,Claim>`, `STORE_STOPPED` không phát `START_FETCH`, atomic detach+`detachReason`, reconcile singleton; 26 test + 5 negative-proof; chưa fetch/timer/React (lát 3-4); handoff chờ review (§67 exchange) |
| Code review lát 2, vòng 1 | Codex | 2026-08-08 | `REWORK` — recovery attach thiếu `ganVoiPhien` nên có thể hiện trùng queue; CAS miss để orphan `refresh=pending`; detach reason có thể bị poll tombstone trước khi UI consume; `visibleQueue` chưa sort FIFO theo `completedAt`; chưa sang driver lát 3 (§68 exchange) |
| REWORK lát 2 — 4 invariant reducer | Claude | 2026-08-08 | Recovery attach đặt cả `ganVoiPhien`+`choTerminal`; CAS miss tách khỏi claim-lifecycle (luôn dọn `refresh=pending`→`idle`), bỏ bump epoch vô lý ở `ACK_FAILED`; action mới `DETACH_REASON_CONSUMED{key,epoch}` dùng `syncEpoch` làm token (không thêm field Entry); `visibleQueue` sort FIFO theo `completedAt`; 31 test + 5 negative-proof (§69 exchange) |
| Code review lát 2, vòng 2 | Codex | 2026-08-08 | `REWORK` — bốn finding §68 đã sửa đúng và 31/31 test xanh, nhưng retry/reattach có thể coalesce vào current job đã mất CAS authority sau `SWEEP_DEADLINES`; response cũ chỉ dọn pending rồi resolve nhầm waiter, không tạo lookup thay thế, để entry/session mắc ở `not_found`; chưa sang lát 3 (§70 exchange) |
| REWORK lát 2 vòng 2 — coalesce xét thẩm quyền | Claude | 2026-08-08 | `timThamQuyenClaim()` trả `'current'\|'queued'\|null` dựa trên baseline job có còn khớp epoch hiện tại của key không (không chỉ tra membership Map); claim mất thẩm quyền trong `current.claims` tự hoàn tất vòng đời riêng, yêu cầu mới luôn có claim/lookup TƯƠI trong `queuedClaims`; tự phát hiện thêm 1 biên (2 reclaim liên tiếp phải gộp đúng 1 claim mới) trong lúc sửa; 33 test + 2 negative-proof mới (§71 exchange) |
| Code review lát 2, vòng 3 | Codex | 2026-08-08 | `PASS WITH NOTES` — race §70 đã đóng, targeted 33/33 và full gate 277 BE + 141 FE xanh; mở brief lát 3. Note bắt buộc: invariant đúng là tối đa một claim **còn authority**/key; stale current predecessor được tạm cùng tồn tại với queued successor, waiter/lifecycle không được trộn (§72 exchange) |
| Slice brief lát 3/5 — runtime driver | Claude | 2026-08-08 | Sửa lại phát biểu invariant ownership trong Amendment §26 theo đúng note §72 (không phải `DESIGN REOPEN` — không đổi shape state); nộp brief lát 3: driver thật thực thi `Effect[]`, single-flight, timeout/lifecycle token, poll/sweep, lộ bộ lệnh public async cho lát 4; chưa code (§73 exchange) |
| Review slice brief lát 3 | Codex | 2026-08-08 | `REWORK BRIEF` — poll thiếu targeted lookup lặp cho entry `awaiting`; lifecycle token không chặn stale `.finally` của job cũ phá registry successor trong cùng lifecycle nên cần job/controller ownership; semantics finish/cancel reconcile, ACK lane và settle khi stop chưa khóa; chưa được code driver (§74 exchange) |
| Implementation lát 3/5 — runtime driver | Claude | 2026-08-08 | `src/lib/automation-results-store.ts` — brief sửa khép cả 3 blocker §74 rồi mới code (nhận đã lỡ code trước theo brief cũ, chưa commit nên không có gì sai lọt lịch sử): `pollTick` đúng thứ tự sweep→targeted retry lặp cho `awaiting`→background; registry `Map<job.id,...>` xác nhận bằng test dựng đúng race predecessor/successor; `finish()` reconcile enqueue đúng key khi còn active, `cancel()` không refresh; ACK tách lane độc lập có timeout riêng; `stop()` drain cả 2 lane. 23 test + 4 negative-proof; handoff tại §75.6 — chờ review (§75 exchange) |
| Code review lát 3/5 | Codex | 2026-08-09 | `REWORK` — test hiện tại 23/23 xanh nhưng 3 ca tái hiện bổ sung đều đỏ: `start()` có thể đổi lifecycle và làm waiter pre-start treo; ACK lặp cùng key để callback cũ xoá timer/ghi state của ACK mới; result-fetch timeout không dọn registry nếu transport phớt lờ abort. Phải khép ownership/settle-once và cleanup trước khi mở lát 4 (§76 exchange) |
| REWORK lát 3/5 — lifecycle/ownership | Claude | 2026-08-09 | `drainLifecycle()` dùng chung cho `start()`/`stop()` — request pre-start không còn mồ côi; lane ACK gộp 1 Map `ackAttempts{token,...}`, `isOwner()` theo token gác mọi nhánh (thay tra Map theo key rồi giả định luôn là mình); timeout result-fetch dọn registry NGAY tại callback, không phụ thuộc `.finally()`. 26 test (+3) + 3/3 negative-proof đúng yêu cầu §76.5; handoff tại §77.5 — chờ review (§77 exchange) |
| Re-review lát 3/5 | Codex | 2026-08-09 | `REWORK` hẹp — ba fix §76 đúng, nhưng `drainLifecycle()` chỉ resolve/clear ACK runtime mà không chuyển `ResultEntry.ack` khỏi `sending`; public reproduction đỏ trong khi 26/26 test hiện tại xanh. Sau `start/stop`, UI có thể kẹt “đang gửi” dù không còn request. Cần settle state ACK cùng lifecycle và siết test registry (§78 exchange) |
| REWORK lát 3/5 (vòng 2) — ACK state + getter | Claude | 2026-08-09 | `drainLifecycle()` dispatch `ACK_FAILED` cho mọi key đang `sending` trước khi resolve/clear — `entry.ack` không còn mắc kẹt `sending` sau `start()`/`stop()`; getter `soLuongRegistryChoTest` tách `resultFetchTimers`/`resultFetchControllers` riêng (không gộp qua 1 field). 27 test (+1) + negative-proof 2 lượt độc lập cho 2 dòng cleanup registry; handoff tại §79.4 — chờ review (§79 exchange) |
| Re-review lát 3 vòng 2 | Codex | 2026-08-09 | `REWORK` — fix ACK state và registry đạt, nhưng `stop()` vẫn return sớm khi `running=false`; command pre-start được phép phát fetch, nên pre-start request + `stop()` không drain/settle và callback còn có thể chạy sau stop. Public reproduction đỏ trong khi 27/27 store test xanh; phải khép shutdown đối xứng trước lát 4 (§80 exchange) |
| REWORK lát 3/5 (vòng 3) — stop() idempotent theo work thật | Claude | 2026-08-09 | `stop()` idempotent theo còn `current`/`queuedClaims`/`queuedBackground`/`ackAttempts` hay không, không chỉ theo cờ `running` — pre-start job/ACK vẫn được drain đúng khi `stop()` gọi trước `start()`; lần gọi thứ hai sau khi đã drain hết vẫn no-op sạch. 30 test (+3) + negative-proof khôi phục guard cũ; handoff tại §81.3 — chờ review (§81 exchange) |
| Re-review lát 3 vòng 3 | Codex | 2026-08-09 | `PASS WITH NOTES` — pre-start foreground/ACK đều drain đúng, late callback không apply, stop lần hai no-op; targeted 63/63 và full gate 277 BE + 171 FE xanh. Khóa runtime driver tại `39ba07f`, mở quyền nộp slice brief lát 4; note non-blocking: work detection đang dựa reducer invariant, không được tạo registry ngoài state ở lát tích hợp (§82 exchange) |
| Slice brief lát 4/5 — Provider + tích hợp | Claude | 2026-08-09 | Chuyển sang `docs/exchanges/2026-08-09.md` theo quy ước 1 file/ngày (file 2026-08-08.md đã đóng ở §82). Nộp brief lát 4: `AutomationResultsProvider` duy nhất ở App root; bảng ánh xạ đầy đủ hành vi cũ (`useAutomation.ts`/`main.tsx` commit `7a11a5a`) → lệnh/selector coordinator mới; ownership popup direct/recovery/digest/reconcile + detach-reason consume; test matrix integration/UI; non-goals (chưa xoá legacy, chưa đổi endpoint/reducer/driver). Chưa code — chờ review (§1, `docs/exchanges/2026-08-09.md`) |
| QA nghiệm thu | | | |

## 13. Amendment (2026-08-08): sửa theo Codex review vòng DoR

Bản Draft đầu có 2 lỗi thiết kế bị Codex bắt trước khi code — ghi lại để không lặp:

1. **Whitelist event sai hướng.** Bản đầu liệt kê CẢ event server-only (`executed`, `execute_reserved`,
   `unknown_outcome`…) vào whitelist cho client — nghĩa là vô tình MỞ đường cho client giả mạo chính bằng
   chứng chống ghi trùng của CR-20260807. Đã sửa: whitelist chỉ 4 giá trị FE thật đang gửi; `result_seen` đi
   qua route riêng có validate, không qua `/automation/event`.
2. **Dựa vào API không đủ dữ liệu.** Bản đầu định tái dùng `GET /automation/events?occurrenceKeys=` (chỉ
   trả tên event) để dựng popup kết quả — không đủ cho link/nội dung/thứ tự/phân biệt `done` với
   `done_with_warning`. Đã đổi sang typed result feed (`GET /automation/results`) do server tổng hợp.

Ba blocker của Codex (§14.2–14.4) đã xử lý trong bản CR hiện tại (không phải bản riêng — sửa trực tiếp vào
FR-4/5/6/7 vì CR còn ở giai đoạn Draft, chưa code).

## 14. Amendment (2026-08-08, vòng 2): sửa theo Codex review — bảng mapping sai một ca thật

Codex đọc lại bản sửa và bắt được **một lỗi thật trong chính bảng mapping vừa viết ở §13**: suy `status`
từ tổ hợp tên event (`executed` có/không kèm `partial_failure`) sai đúng ca người dùng tự reconcile "đã ghi
rồi" — backend ghi `executed` không kèm `partial_failure`, nhưng trạng thái thật đã chốt là
`done_with_warning`. **Tự kiểm chứng lại bằng code thật (`server/routes/automation.ts` dòng 857), xác nhận
Codex đúng.**

| # | Vấn đề | Đã sửa |
|---|---|---|
| 1 | Suy `status` từ tổ hợp tên event — sai ca reconcile thủ công (bằng chứng: code thật) | FR-4: đổi sang ghi event server-only `result_recorded` với JSON snapshot **đã chốt sẵn `status`** ngay tại mọi điểm chuyển trạng thái cuối — không suy diễn ở phía đọc nữa |
| 2 | Field chưa đủ để tái tạo popup độc lập với dòng task hiện tại | FR-4: thêm `actionType`, `target` vào snapshot |
| 3 | Một occurrence có thể có nhiều terminal transition | FR-4: chỉ trả **một** record/occurrence — bản `result_recorded` mới nhất theo `created_at`/`id` |
| 4 | Danh sách "modal đang bận" ở FR-6 quá hẹp, còn 2 race chưa khoá | FR-6: mở rộng thành `blocked`/`running`/`automationReconfirm`/digest `missed`/result modal; dedupe active+queue theo occurrence; poll kết quả chạy độc lập với ngày dashboard đang xem |
| 5 | Chưa định nghĩa khi request "đã xem" lỗi | FR-5: disable nút khi gửi, chỉ gỡ khỏi queue sau 200, lỗi thì giữ modal + nút thử lại; digest ack từng occurrence riêng |
| 6 | NFR còn nói "dùng endpoint `/automation/events` đã có" — mâu thuẫn với FR-4 đã đổi | §5: sửa lại đúng theo endpoint mới |
| 7 | Chưa validate input/output 2 endpoint mới | §5: cap `days`, validate `unseen`, cap độ dài snapshot |

Thêm AC-18 → AC-24. Trả lời 2 câu Claude hỏi ở vòng trước: (1) field còn thiếu `actionType`/`target` — đã
bổ sung; (2) digest `missed` — **Codex xác nhận không gộp sửa trong CR này**, ghi thành nợ kỹ thuật riêng
(digest đó vẫn dựa vào `task.automationStatus` toàn cục, chỉ đáng tin trong rào "hôm nay"; chưa có bằng
chứng lỗi thoát cổng nên chưa cần mở BUG).

## 15. Amendment (2026-08-08, vòng 3): sửa 2 blocker logic trong chính thiết kế snapshot vừa viết

Codex đọc lại §14 và bắt được **mâu thuẫn logic thật** trong chính thiết kế Claude vừa viết — không phải
lỗi tái diễn từ trước, mà là hai yêu cầu Claude tự đặt ra trong CÙNG một đoạn không thể cùng đúng.

| # | Vấn đề | Đã sửa |
|---|---|---|
| 1 (blocker, §18.1) | `dedupe_key='<occ>:result_recorded'` (UNIQUE, một occurrence chỉ ghi được MỘT snapshot vĩnh viễn) **mâu thuẫn** với yêu cầu "lấy bản mới nhất khi có nhiều terminal transition" — lượt reconcile ghi sau sẽ bị chính UNIQUE index chặn, đúng ca cần sửa (§14 vấn đề 1) lại không được sửa | Đổi dedupe theo **transition**: `<occ>:result_recorded:auto` (ghi bởi `executeApprovedTask`/tick) và `<occ>:result_recorded:reconcile` (ghi bởi route `/cancel`). Tối đa 2 bản/occurrence, append không UPSERT (giữ nhật ký bất biến — đúng khuyến nghị Codex, không chọn phương án UPSERT vì mất lịch sử) |
| 2 (blocker, §18.2) | FR-5 chỉ cho ghi `result_seen` khi "đã tồn tại `result_recorded`" — nhưng dữ liệu legacy theo định nghĩa KHÔNG có event đó, nên mọi kết quả cũ báo bù ra sẽ never-acknowledge: bấm "đã xem" luôn 404/409, modal không thoát, poll báo lại vô hạn | FR-5 dùng **đúng cùng một resolver** mà `GET /results` dùng để dựng feed (snapshot mới hoặc legacy fallback) — không tự suy điều kiện riêng, không cho client tự khai loại legacy. Thêm AC-25, AC-26 |
| 3 (§18.3, nhất quán) | Bảng FR-4 lặp dòng `expired/checking_timeout/reset/reserve_released` hai lần | Gộp còn một dòng |
| 4 (§18.3) | AC-15 nói "chưa có terminal event" — không khớp resolver dùng chung mới | Đổi thành "resolver không resolve được kết quả hợp lệ" |
| 5 (§18.3) | §11 (docs cần cập nhật) chưa liệt kê event `result_recorded` | Bổ sung |

Sửa AC-18/AC-19 để khớp đúng cơ chế 2-snapshot (`auto` + `reconcile`) thay vì nói chung "terminal event mới
nhất". Không có câu hỏi mở nào ở vòng này — cả 2 blocker đều là lỗi logic tự mâu thuẫn trong chính spec,
không phải điểm cần Codex quyết thêm.

## 16. Amendment (2026-08-08, vòng 4): ghi strict/atomic + audit lại toàn bộ điểm ghi

Codex đọc lại §15 và tìm ra 2 blocker mới — lần này không phải mâu thuẫn logic trong spec mà là **thiết kế
đúng nhưng chưa đủ chặt** so với hạ tầng ghi log hiện có, cộng với danh sách điểm ghi audit chưa hết.

| # | Vấn đề | Đã sửa |
|---|---|---|
| 1 (blocker, §21.1) | `logEvent()` — hàm dự định dùng để ghi `result_recorded` — **nuốt lỗi** (`try{...}catch{}`). Gọi trong `withTransaction()` KHÔNG làm nó atomic: insert lỗi bị nuốt, transaction vẫn commit phần đổi trạng thái. Task có thể hiện "đã xong" mà không có snapshot. **Tự kiểm chứng bằng code thật, xác nhận đúng** | Thêm writer riêng cho `result_recorded`, KHÔNG dùng `logEvent()` (nuốt lỗi) cũng không dùng nguyên `logEventStrict()` (tự ghép sai định dạng dedupe key). Bắt buộc gọi trong CÙNG transaction với CAS chuyển trạng thái cuối — lỗi insert thì rollback cả transaction. `created_at` lấy cùng timestamp với chính transition. Thêm AC-27 |
| 2 (blocker, §21.2) | Danh sách "5 điểm ghi" ở §14 thiếu ít nhất 2 nhánh recovery thật: reservation collision lúc claim, và lease `running` quá hạn ở tick — cả hai chuyển sang `unknown_outcome` mà không nằm trong danh sách | **Tự audit lại bằng `grep` toàn bộ `server/routes/automation.ts` + `automation-scheduler.ts`**, tìm ra tổng **6 điểm** (không phải 5, không phải chỉ +2 của Codex — có thêm 1 điểm nữa khi audit kỹ). Liệt kê đủ trong bảng ở FR-4, kèm nguyên tắc chung ("mọi CAS chuyển vào 1 trong 4 terminal status phải ghi snapshot atomic") để không đóng đinh số lượng. Thêm AC-28 |
| 3 (§21.3, nhất quán) | §6.3 chỉ liệt kê `result_seen`, thiếu `result_recorded` dù §11 đã có | Bổ sung §6.3 |

**Một điểm Claude tự tìm khi audit, không phải Codex chỉ ra**: nhánh `occurrenceDaGhiRaNgoai(occKey)` ở
đầu `executeApprovedTask` (chuyển `done_with_warning` khi occurrence đã có `executed` từ trước) — kiểm kỹ
thì đây **không** cần snapshot riêng, vì occurrence đó đã có snapshot gốc từ lần thành công đầu tiên. Ghi
rõ vào CR để người triển khai không tưởng đây là điểm thứ 7 bị bỏ sót.

Không có câu hỏi mở — cả 2 blocker được sửa dứt điểm bằng nguyên tắc chung, không cần Codex chọn phương án.

## 17. Amendment (2026-08-08, vòng 5): tách đúng call-site + khoá occurrence gốc cho recovery

Codex đọc lại §16 và bắt tiếp 2 vấn đề — lần này là chính cách audit ở vòng 4 vẫn chưa triệt để, không phải
lỗi mới sinh ra.

| # | Vấn đề | Đã sửa |
|---|---|---|
| 1 (blocker, §24.1) | Bảng "6 điểm ghi" ở §16 tự mâu thuẫn: nói "6" nhưng liệt kê 7 dòng, và dòng #3 ("Claude ném lỗi, đã từng spawn") **gộp nhầm hai call-site khác nhau** — khối `catch (error)` (Claude thật sự ném exception, dòng 714+) và nhánh report `success=false` không `link`/`articleId` **nhưng không ném gì** (dòng 693-713, `logEvent` gọi trên đường return bình thường). Hai đường code riêng biệt, cùng ra `unknown_outcome`, nhưng phải audit/test riêng vì điều kiện vào khác nhau | Liệt kê lại theo **call-site/transaction** (không theo status): đúng 6 call-site, một số call-site sinh 2 status khác nhau tuỳ nhánh con (xem bảng FR-4 đã sửa). Tách rõ call-site #2 (report thất bại không ném) khỏi call-site #3 (catch exception) |
| 2 (blocker, §24.2) | `automation-scheduler.ts` `tickOnce()` tính `occKey = occurrenceKeyOf(taskId, gio, now)` từ **lịch hiện tại** cho MỌI hành động kể cả `mark_unknown` — recovery của một lượt đang `running` phải dùng occurrence **đã lưu lúc giành quyền** (`tasks.automation_occurrence_key`), không tính lại; nếu giờ task bị sửa hoặc lượt chạy vắt qua ranh giới ngày, khoá tính lại sẽ lệch khoá thật, snapshot gắn nhầm occurrence | Thêm quy tắc bắt buộc: recovery của lượt đang chạy ưu tiên tuyệt đối `automation_occurrence_key` đã lưu; thiếu cột (dữ liệu cũ) thì fallback theo "chỉ nhận khi có ĐÚNG MỘT reservation chưa giải quyết" (cùng nguyên tắc route reconcile CR-20260807); không xác định được duy nhất → fail-closed, không đoán khoá từ giờ hiện tại. Thêm AC-29 đúng nguyên văn Codex đề xuất |

Tự kiểm chứng cả hai bằng code thật trước khi sửa CR: đọc `server/routes/automation.ts` dòng 690-720 xác
nhận dòng 693-713 (report thất bại, không throw) và dòng 714+ (`catch(error)`) là hai khối tách biệt; đọc
`server/lib/automation-scheduler.ts` dòng 78-125 xác nhận dòng 108 tính `occKey` không điều kiện trước khi
rẽ nhánh hành động, và không có tham chiếu nào tới `automation_occurrence_key` trong hàm này.

Không có câu hỏi mở — cả 2 blocker đều xác nhận đúng bằng code thật, sửa dứt điểm bằng cách đổi cách đếm
(theo call-site) và thêm một quy tắc chung (ưu tiên occurrence đã lưu), không cần Codex chọn phương án.

## 18. Amendment (2026-08-08, vòng 6): bổ sung AC cho call-site report thất bại không ném

Codex xác nhận 2 blocker của vòng 5 (§17) đã đóng đúng — không còn mâu thuẫn thiết kế. Còn một gap
**nghiệm thu**: call-site #2 vừa được tách ra trong bảng FR-4 (report `success=false`, không
`link`/`articleId`, không ném exception) chưa có AC riêng chứng minh nó thực sự ghi `result_recorded:auto`
và lên được feed — các AC hiện có chỉ chạm ca này gián tiếp (AC-7 kiểm cách UI hiện một status backend đã
trả sẵn, AC-27 kiểm rollback khi insert lỗi, AC-28 chỉ kiểm 2 call-site khác).

| # | Vấn đề | Đã sửa |
|---|---|---|
| 1 (§26.1) | Thiếu AC chứng minh call-site #2 (report thất bại không ném) ghi đúng snapshot + lên đúng feed | Thêm **AC-30**: given report `success=false` không `link`/`articleId` và không ném / then `unknown_outcome` + đúng một `result_recorded:auto` atomic + reservation vẫn giữ + feed trả đúng item. Trỏ thẳng từ dòng #2 trong bảng call-site ở FR-4 sang AC-30, tránh lặp lại kiểu thiếu liên kết đã bị bắt ở vòng trước |

Không có câu hỏi mở — chỉ thêm AC, không đổi thiết kế. Codex ghi rõ: "không cần sửa lại thiết kế".

## 19. Amendment (2026-08-08, code-review vòng 1): sửa 5 blocker phát hiện SAU KHI code, trước smoke

CR đã đạt DoR ở §18 và được triển khai (commit `762d270`), nhưng Codex review trực tiếp CODE (không chỉ
thiết kế) tìm ra 5 blocker thật, tất cả đều là lỗi *thực thi thiết kế*, không phải lỗi thiết kế đã duyệt.

| # | Vấn đề (code review) | Đã sửa |
|---|---|---|
| 1 (cao) | `writeResultSnapshot` dedupe cố định `<occ>:result_recorded:<transition>` — giả định `auto`/`reconcile` mỗi thứ chỉ xảy ra ĐÚNG 1 LẦN/occurrence. Sai: `unknown_outcome` → user xác nhận "chưa ghi gì" (route `/cancel` mở khóa) → retry CÙNG occKey → lượt mới đụng UNIQUE của lượt cũ → transaction chuyển trạng thái ROLLBACK → task kẹt `running` vĩnh viễn | Dedupe theo TỪNG LƯỢT: thêm `:<now.getTime()>` vào mọi dedupe key của `writeResultSnapshot` (không riêng `failed` như bản trước tự sửa hụt). Không cap số snapshot/occurrence; resolver luôn lấy `created_at` lớn nhất. Đồng thời tách khối `try/catch` của `executeApprovedTask`: lỗi Claude ném (spawn/timeout/CLI) và lỗi GHI KẾT QUẢ (DB) giờ có 2 catch riêng — lỗi ghi DB không còn bị phân loại nhầm thành "không rõ Claude có chạy hay chưa" |
| 2 (cao) | `executeAutomation()` hiện kết quả trực tiếp qua `automationSession`, ĐỒNG THỜI poll cũng thấy cùng occurrence chưa `result_seen` và thêm vào hàng đợi — báo cùng kết quả 2 lần; đóng popup trực tiếp không gọi FR-5 nên poll sau bật lại | `POST /execute` trả thêm `occurrenceKey`; `AutomationSessionState` lưu lại field này; poll loại occurrenceKey của phiên đang hiển thị trực tiếp khỏi hàng đợi; `closeAutomation()` tự gọi `POST /seen` khi đóng một kết quả cuối (done/done_with_warning/unknown_outcome/failed) |
| 3 (cao) | `POST /results/:occurrenceKey/seen` bọc insert bằng `catch{}` coi MỌI lỗi là "đã ghi rồi" → disk-full/lỗi schema cũng trả 200 giả, FE xoá item khỏi hàng đợi dù chưa hề ghi được | Kiểm `result_seen` đã tồn tại chưa TRƯỚC (không có `await` xen giữa nên không có khe hở race trong tiến trình đơn luồng này); chưa có mới insert, không bọc try/catch nuốt lỗi — lỗi thật lộ ra 500 |
| 4 (cao) | `executeAutomation()` khi lỗi HTTP/mất kết nối set `status:'error'` nhưng BỎ kết quả `taiDuLieu()` sau đó — không phản chiếu trạng thái thật (trái AC-8). `status` lạ từ response 200 bị map thẳng thành `'failed'` — bày "Thử lại" gọi `/execute` lần 2 dù không biết chắc trạng thái | Thêm `phanChieuTuServer()`: mọi nhánh không xác định được (status lạ, hoặc lỗi HTTP) đều tải lại task rồi PHẢN CHIẾU đúng `automationStatus` thật từ server — không đoán, không tự gắn `'failed'` |
| 5 (trung) | Poll chỉ APPEND occurrence chưa có vào hàng đợi, không thay/loại theo response mới nhất — giữ mãi snapshot cũ; "Mở task" từ kết quả không được tính là "đang bận" nên result popup chồng lên popup sửa task | Poll RECONCILE toàn bộ hàng đợi bằng danh sách `unseen=true` mới nhất mỗi lần (không chỉ append); `main.tsx` thêm `taskDangSua` vào điều kiện "UI đang bận" — item vẫn ở trong hàng đợi (chỉ ẩn hiển thị) tới khi user xử lý xong |

**Test mới**: `automation-cr20260808.test.ts` +2 ca (retry hợp lệ sau "chưa ghi gì" không kẹt running;
`seen` không nuốt lỗi DB thật — tái hiện bằng cách đổi tên bảng tạm thời), `useAutomation.test.tsx` mới +3
ca (dedupe active+queue, tự gọi `seen` khi đóng, poll reconcile không giữ bản cũ). `npm run check` xanh:
**266 backend + 96 frontend**.

Không có câu hỏi mở — cả 5 đều là lỗi lộ ra khi review code thật, không phải điểm cần Codex chọn phương án.

## 20. Amendment (2026-08-08, code-review vòng 2): khép các ĐƯỜNG LỖI/RACE của FR-5/FR-6

Codex xác nhận 2 blocker backend (#1 attempt dedupe, #3 `/seen` nuốt lỗi) đã đóng đúng, nhưng chỉ ra ba
điểm còn hở — tất cả nằm ở **đường lỗi/race của frontend**, nơi test vòng trước chỉ phủ đường thành công.

| # | Vấn đề (code review vòng 2) | Đã sửa |
|---|---|---|
| 1 (cao, §32.1) | `closeAutomation()` xoá session NGAY rồi mới fire-and-forget `/seen` — POST hỏng thì popup đã biến mất trong khi `result_seen` chưa hề tồn tại, và occurrence cũng vừa bị poll loại khỏi hàng đợi → mất kết quả. Trái FR-5/AC-23 ("chỉ đóng sau 200; lỗi giữ modal + cho thử lại") | `closeAutomation()` thành **async**: đặt `busy` khi gửi, `await` FR-5, **chỉ clear session sau 200**; lỗi → giữ nguyên popup + `loiXacNhan` + nút đổi thành "Thử lại". `xacNhanDaXemKetQua()` đổi kiểu trả về thành `Promise<boolean>` để nơi gọi phân biệt được thành công/thất bại (trước trả `void`) |
| 2 (cao, §32.2) | `phanChieuTuServer()` chỉ tải lại MỘT LẦN. Bắt đúng lúc server còn `running` → session kẹt `running` vĩnh viễn, và vì `main.tsx` chặn hàng đợi khi còn session nên nó **che luôn kết quả thật**. Resolver cũng chỉ tìm trong `taskDinhKy`, hẹp hơn resolver mà UI kết quả dùng | Thêm cờ `choKetQua` cho phiên PHỤC HỒI (trạng thái đọc được chưa phải trạng thái cuối) + một effect nâng phiên đó lên trạng thái cuối **ngay khi result feed có kết quả đúng occurrence**. Poll KHÔNG loại occurrence của phiên `choKetQua` khỏi hàng đợi (loại đi là khoá chặt cửa thoát duy nhất). Resolver mở rộng tìm cả `khoTask`/`taskHomNay`/`taskDinhKy`/`lichSu`. Bấm X trên phiên `choKetQua` = đóng hẳn (không acknowledge) thay vì `hidden` — vì `hidden` vẫn giữ session sống và tiếp tục chặn hàng đợi |
| 3 (trung, §32.3) | Điều kiện "UI rảnh" vá từng biến (`taskDangSua`) nên các modal thật khác (`moTaoTask`, `moThemTaskNhanh`, `moLichSu`, `taskDangCancel`, `taskDangHoanThanh`, `pendingTab`) vẫn bị popup kết quả render chồng. Và "Mở task" → `onUpdated` không làm mới result feed nên snapshot `unknown_outcome` CŨ flash lại khi đóng popup sửa | Gom **một nguồn duy nhất** `dangCoModalKhac` ở `main.tsx` (lần sau thêm modal chỉ sửa đúng một chỗ). Thêm `lamMoiKetQua()` — nạp lại feed NGAY khi đóng/cập nhật popup sửa task, không chờ hết chu kỳ 30s. Tách `dongPhienDeMoTask()` khỏi `closeAutomation()`: "Mở task" đóng phiên nhưng **cố ý KHÔNG acknowledge**, giữ occurrence trong feed để sau khi reconcile xong kết quả MỚI NHẤT được báo lại |

**Test mới** (`useAutomation.test.tsx`, +3 ca → 6): `/seen` trả 500 khi đóng → popup ở lại, có `loiXacNhan`,
thử lại thành công mới đóng; mất response `/execute` lúc server còn `running` → phiên `choKetQua` rồi được
feed nâng lên terminal; phiên `choKetQua` không bị loại khỏi hàng đợi.

**Đã kiểm chứng test THỰC SỰ bắt lỗi** (không chỉ pass): tạm hoàn nguyên từng fix rồi chạy lại —
bỏ điều kiện "chỉ đóng sau 200" → ca §32.1 đỏ; cho poll loại cả phiên `choKetQua` → 2 ca §32.2 đỏ. Sau đó
khôi phục. `npm run check` xanh: **266 backend + 99 frontend**.

**Nợ kỹ thuật ghi nhận (Codex nêu, không chặn vòng này):** dedupe lượt đang dùng `now.getTime()` (mili-giây).
Chạy đúng với các call-site production hiện tại, nhưng một **attempt ID bền vững cấp từ lúc claim** sẽ chắc
hơn nếu sau này thêm call-site — để hồ sơ sau, không gộp vào CR này.

## 21. Amendment (2026-08-08, code-review vòng 3): recovery dùng ĐÚNG nguồn occurrence, không chặn feed

Codex xác nhận §32.1 đã đóng đúng và danh sách `dangCoModalKhac` đã đủ. Ba vấn đề còn lại đều nằm ở
**cơ chế recovery vừa thêm ở §20** — nó mới chỉ đúng khi cả ba giả định cùng thoả: đọc lại dashboard thành
công, tìm thấy task, và khóa client tự tính trùng khóa server.

| # | Vấn đề (code review vòng 3) | Đã sửa |
|---|---|---|
| 1 (cao, §34.1) | `phanChieuTuServer()` gán `occurrenceKey: occKey(moi)` — **tự tính lại ở FE** từ ngày hiện tại + `gioBatDau` hiện tại, trong khi `mapTask` đã trả sẵn `automationOccurrenceKey` (khóa server lưu nguyên tử lúc claim). ĐÚNG lớp lỗi backend đã phải sửa bằng AC-29: lượt vắt qua nửa đêm VN hoặc user đổi giờ giữa chừng → khóa lệch → feed không match (phiên kẹt `running`), hoặc nút Đóng POST `/seen` sai khóa và nhận 404. `Task` cũng chưa khai báo field này nên FE không dùng được | Khai báo `automationOccurrenceKey?: string \| null` trong `Task`; recovery **ưu tiên tuyệt đối** khóa server. Không có khóa server + chưa terminal → KHÔNG dựng phiên chờ (nó sẽ không bao giờ match feed) mà bàn giao hẳn cho result feed |
| 2 (cao, §34.2) | `taiDuLieu()` lỗi / không tìm thấy task → dựng session `error` **không** có `choKetQua`, **không** có occurrence. Session đó vẫn tính là "UI đang bận" nên chặn hàng đợi VĨNH VIỄN: poll hồi phục, nhận terminal thật, nhưng người dùng không thấy gì cho tới khi tự tay đóng popup lỗi — hỏng đúng ca mất mạng mà §32.2 sinh ra để chữa | Thêm `banGiaoChoResultFeed()`: nhánh "chưa phản chiếu được" đóng phiên + toast lỗi + nạp lại feed, thay vì dựng session chặn. Result feed chạy độc lập với phiên nên sẽ tự báo đúng một lần khi lượt chạy kết thúc |
| 3 (trung, §34.3) | `lamMoiKetQua()` được gọi fire-and-forget SAU `setTaskDangSua(null)` — React có thể render một nhịp với "modal sửa đã đóng + `ketQuaHangDoi` vẫn là snapshot CŨ", nên vẫn flash kết quả cũ, chỉ rút từ ≤30s xuống thời gian request | Thêm cờ `dangLamMoiKetQua` **bên trong** `lamMoiKetQua()` (không phải ở nơi gọi — để mọi call-site đều được bảo vệ), đưa vào `dangCoModalKhac`. Đồng thời đảo thứ tự: gọi `lamMoiKetQua()` TRƯỚC khi đóng modal để cờ có hiệu lực ngay trong cùng lượt render |

**Test mới** (`useAutomation.test.tsx`, +2 ca → 8; 2 ca cũ được siết lại): fixture recovery nay dùng
`automationOccurrenceKey='2026-08-08:1:23:59'` **khác hẳn** khóa FE tính từ `gioBatDau='10:00'` — code tính
lại là đỏ ngay. Thêm ca "tải lại hỏng → không dựng phiên chặn feed, feed vẫn báo được" và ca "cờ suppress
bật trong lúc refresh còn pending, tắt sau khi xong".

**Kiểm chứng test thật sự bắt lỗi** (hoàn nguyên từng fix rồi chạy lại): tính lại khóa ở FE → 2 ca §34.1 đỏ;
dựng lại session `error` → ca §34.2 đỏ; bỏ cờ suppress → ca §34.3 đỏ. Sau đó khôi phục. `npm run check`
xanh: **266 backend + 101 frontend**.

## 22. Amendment (2026-08-08, code-review vòng 4): bỏ HẲN khóa đoán + chống flash cả khi refresh lỗi

Hai nhánh lỗi liền kề của chính hai fix vừa làm ở §21 — cùng contract, chỉ khác nhánh.

| # | Vấn đề (code review vòng 4) | Đã sửa |
|---|---|---|
| 1 (cao, §36.1) | Fix §34.1 chỉ bàn giao feed khi `!laCuoi && !occServer`; với **terminal** vẫn dùng `occServer \|\| occKey(moi)`. Nhưng đường `done`/`done_with_warning` gọi `ghiOccurrenceTreo.run(null, taskId)` NGAY khi hoàn tất, nên ca rất thật "/execute xong nhưng mất response, reload thấy `done`" **thường không còn** `automation_occurrence_key` → lại rơi về khóa FE tự tính. Lượt vắt qua nửa đêm/đổi giờ → popup mang khóa sai → bấm Đóng POST `/seen` sai khóa nhận 404, trong khi feed đang giữ snapshot theo khóa gốc | Bỏ HẲN nhánh tính khóa ở FE trong `phanChieuTuServer`: **không có `automationOccurrenceKey` → bàn giao feed**, bất kể terminal hay không. Feed luôn có khóa gốc do chính server ghi, nên `/seen` không thể sai khóa |
| 2 (trung, §36.2) | `lamMoiKetQua()` bật cờ suppress nhưng `finally` **luôn** tắt, kể cả khi request lỗi → refresh sau reconcile trả 500/mất mạng thì `ketQuaHangDoi` vẫn giữ snapshot cũ, modal sửa đã đóng, suppress tắt → popup cũ hiện lại. Fix §34.3 mới chỉ khép nhánh pending+success. Ngoài ra cờ boolean sai nếu 2 refresh chồng nhau | Hai lớp: (a) đổi cờ pending sang **đếm request đang bay** (`soRefreshDangBay`) — request xong sớm không tắt suppress của request còn bay; (b) thêm `occNghiNgoCu` — các occurrence có trong hàng đợi lúc bắt đầu refresh bị ẩn cho tới khi có **fetch THÀNH CÔNG** (poll định kỳ cũng tính là authoritative). Cố ý ẩn theo TỪNG occurrence, không chặn toàn bộ: kết quả MỚI vẫn báo bình thường, không "suppress vô hạn khi mạng chậm" |

Kèm theo: `ketQuaHangDoi` trả ra cho UI nay là bản **đã lọc** (`ketQuaHangDoiRaw` trừ `occNghiNgoCu`); riêng
effect nâng phiên `choKetQua` đọc từ **raw** — việc nâng phiên là chuyện của phiên trực tiếp, lọc ở đó sẽ
làm phiên kẹt `running` oan trong lúc có nghi ngờ.

**Test mới** (`useAutomation.test.tsx`, +2 ca → 10): terminal `done` + `automationOccurrenceKey=null` +
giờ/ngày hiện tại khác occurrence gốc → phải nhường feed và `/seen` đúng khóa gốc (`2026-08-07:1:23:30`);
refresh feed reject → snapshot cũ KHÔNG hiện lại, chỉ hiện lại sau một fetch thành công.

**Kiểm chứng test thật sự bắt lỗi**: quay lại `occServer || occKey(moi)` → ca §36.1 đỏ; gỡ `occNghiNgoCu`
trong nhánh `catch` → ca §36.2 đỏ. Sau đó khôi phục. `npm run check` xanh: **266 backend + 103 frontend**.

## 23. Amendment (2026-08-08, code-review vòng 5): suppress ĐÚNG occurrence mục tiêu, không ẩn cả hàng đợi

| # | Vấn đề (code review vòng 5) | Đã sửa |
|---|---|---|
| 1 (trung, §38.1) | `lamMoiKetQua()` snapshot **toàn bộ** hàng đợi thành nghi ngờ (`ketQuaHangDoiRawRef.current.map(...)`). Reconcile occurrence A mà refresh trả 500 thì B, C — không hề bị chỉnh sửa — cũng biến mất khỏi UI cho tới một poll thành công. FR-6 là hàng đợi NHIỀU kết quả nên lỗi đồng bộ của A không được làm mất khả năng đọc/xử lý B, C. Chú thích code nói "ẩn theo từng occurrence" nhưng call-site thực tế không truyền occurrence mục tiêu. Ngoài ra nhánh `catch` nuốt lỗi hoàn toàn — user chỉ thấy item biến mất, không biết vì sao, không có đường thử lại | `lamMoiKetQua(occMucTieu?)` — CHỈ suppress occurrence được truyền vào; không truyền = refresh thuần, không suppress gì. `main.tsx` nhớ `occDangXuLy` khi user bấm "Mở task" từ kết quả (cả 3 đường: popup trực tiếp, popup 1 kết quả, digest) và truyền đúng nó lúc đóng popup sửa. Thêm state `loiLamMoiKetQua` + **banner cảnh báo có nút "Thử lại"** ở `main.tsx`, thay cho việc nuốt lỗi |

**Test mới** (`useAutomation.test.tsx`, +1 ca → 11): queue có A + B; reconcile A → refresh 500 → **chỉ A bị
ẩn, B vẫn hiển thị**, `loiLamMoiKetQua` trỏ đúng A; thử lại thành công → cả hai phản chiếu đúng server và
lỗi được xoá. Ca §36.2 cũ cũng được siết lại: nay truyền đúng occurrence mục tiêu thay vì gọi trống.

**Kiểm chứng test thật sự bắt lỗi**: hoàn nguyên về `setOccNghiNgoCu(toàn bộ queue)` → ca §38.1 đỏ. Sau đó
khôi phục. `npm run check` xanh: **266 backend + 104 frontend**.

## 24. Amendment (2026-08-08, code-review vòng 6): giữ identity occurrence xuyên UI + dọn lỗi khi tự hồi phục

| # | Vấn đề (code review vòng 6) | Đã sửa |
|---|---|---|
| 1 (cao, §40.1) | `PopupDigestKetQua.onOpenTask(task)` **đánh rơi identity của row**; `main.tsx` dựng lại occurrence bằng `ketQuaHangDoi.find(r => r.taskId === t.id)`. Feed giữ 7 ngày nên một task định kỳ có thể có NHIỀU occurrence chưa xem → bấm "Mở task" ở row thứ hai lấy nhầm occurrence đầu tiên → reconcile B nhưng suppress A: tái tạo đúng lỗi phạm vi vừa sửa ở §23. Ngoài ra `occDangXuLy` là state RỜI khỏi `taskDangSua`, chưa clear ở mọi lối thoát (`onMoLaiPhienHoi`, xác nhận huỷ task) nên lần mở task thông thường kế tiếp có thể dùng lại key cũ | Đổi chữ ký thành `onOpenTask(task, occurrenceKey)` — digest truyền `item.occurrenceKey` của ĐÚNG row, nơi nhận không còn tìm ngược theo `taskId`. Gộp `taskDangSua` + `occDangXuLy` thành **một** state `nguCanhSuaTask: { task, occurrenceKey? }`, mọi đường mở/đóng đi qua cùng một setter — không thể sót lối thoát nào |
| 2 (trung, §40.2) | `nhanFeedThanhCong()` gỡ nghi ngờ nhưng **không** xoá `loiLamMoiKetQua`. Vòng poll định kỳ cũng gọi hàm này, nên kịch bản "refresh A lỗi → 30s sau poll tự thành công" để lại banner "chưa cập nhật được" + nút Thử lại vĩnh viễn, dù dữ liệu đã đúng và nghi ngờ đã gỡ — báo lỗi giả sau khi hệ thống đã tự hồi phục | `nhanFeedThanhCong()` xoá luôn `loiLamMoiKetQua`. Mọi full-feed fetch thành công đều là authoritative nên phải dọn lỗi tương ứng, không chỉ khi user tự bấm "Thử lại" |

**Test mới**: `automation-result-popup.test.tsx` +1 (hai occurrence CÙNG `taskId`, bấm row thứ hai → trả
đúng `occurrenceKey` của row đó); `useAutomation.test.tsx` +1 (refresh lỗi → **poll tự thành công, không bấm
retry** → queue đúng và `loiLamMoiKetQua` về null).

**Kiểm chứng test thật sự bắt lỗi**: cho digest truyền `items[0].occurrenceKey` (mô phỏng tìm ngược theo
`taskId`) → ca §40.1 đỏ; bỏ dòng dọn lỗi trong `nhanFeedThanhCong` → ca §40.2 đỏ. Sau đó khôi phục.
`npm run check` xanh: **266 backend + 106 frontend**.

## 25. Amendment (2026-08-08, code-review vòng 7): generation cho mọi fetch feed

| # | Vấn đề (code review vòng 7) | Đã sửa |
|---|---|---|
| 1 (cao, §42.1) | `pollKetQua()` và `lamMoiKetQua()` cùng gọi `GET /automation/results` rồi gọi thẳng `nhanFeedThanhCong(list)` — **không có request id/generation/serialize**. Vì vậy *thứ tự response về* quyết định trạng thái UI thay vì thứ tự nghiệp vụ: (a) poll P khởi tạo TRƯỚC lúc reconcile A (response chứa A CŨ) nhưng về CHẬM hơn refresh R → P ghi đè bản mới, gỡ luôn suspect + lỗi → snapshot cũ sống lại; (b) chiều ngược: R cũ còn bay, P mới thành công đã dọn banner, rồi R cũ reject → `catch` dựng **banner lỗi giả** sau khi hệ thống đã hồi phục. `soRefreshDangBay` chỉ đếm refresh, không version hoá poll và không ngăn callback cũ ghi state | Thêm `feedGenRef` — **mọi** fetch feed (poll định kỳ lẫn refresh thủ công) lấy một generation tại lúc **BẮT ĐẦU**; chỉ fetch còn là mới nhất mới được apply, ở **cả nhánh success LẪN nhánh error**. Gắn theo lúc bắt đầu (không phải lúc response về) là điểm mấu chốt: một poll khởi tạo trước mốc reconcile không bao giờ được phép gỡ suspect của reconcile đó |

**Test mới** (`useAutomation.test.tsx`, +2 ca → 14), dùng **deferred promise** để điều khiển chính xác thứ
tự hoàn tất độc lập với thứ tự khởi tạo:
- P-old bắt đầu → R-new bắt đầu sau và success → thả P-old success sau cùng → queue phải giữ bản new;
- R-old bắt đầu → P-new success (dọn lỗi) → thả R-old reject sau cùng → không dựng banner lỗi giả, không
  suppress lại occurrence đã có authoritative success mới hơn.

**Kiểm chứng test thật sự bắt lỗi**: cho `conLaMoiNhat()` luôn trả `true` (bỏ ordering) → cả 2 ca đỏ. Sau đó
khôi phục. `npm run check` xanh: **266 backend + 108 frontend**.

## 26. Amendment (2026-08-08): chốt kiến trúc coordinator refactor (đạt DoR sau 8 vòng thiết kế + 7 vòng review)

Sau vòng review triển khai 7 (§25 ở trên), Codex đánh giá nguyên nhân gốc: FE orchestration của result/recovery
(`useAutomation.ts` + `main.tsx`) là "state machine viết thành state/effect/callback rải rác" — mỗi vòng review chỉ
bắt được đúng một trong ~15 cặp cần đồng bộ. Yêu cầu dừng vá cục bộ, chốt thiết kế coordinator trước khi code tiếp
(`docs/exchanges/2026-08-08.md` §45). Qua **8 bản thiết kế** (§46, §48, §50, §52, §54, §56, §58, §60) và **7 vòng
Codex phản biện** (§47, §49, §51, §53, §55, §57, §59), bản 8 đạt DoR refactor ở §61. Ghi lại đây **hợp đồng cuối
cùng được duyệt** để implementation (5 lát, §62) bám theo — không cần đọc lại toàn bộ 8 vòng thiết kế mới biết
contract là gì.

### 26.1. Phạm vi đổi so với CR gốc

Từ "chỉ refactor FE" (dự kiến ban đầu) sang **có thêm 1 endpoint BE nhỏ**: `GET /automation/results/lookup`, dùng
lại 100% resolver `giaiQuyetKetQua()` đã có (không business logic mới) — lý do: endpoint liệt kê hiện có
(`GET /automation/results?unseen&days`) có cap 500 + cửa sổ ngày + lọc seen nên không thể đóng vai tra cứu-theo-khoá
authoritative cho một occurrence cụ thể (§55.2). Không đổi bảng/migration, không đổi contract 2 endpoint FR-4/FR-5
đã có.

### 26.2. Kiến trúc được duyệt (tóm tắt để implement, chi tiết đủ ở §60 exchange)

- **`AutomationResultsStore`**: external store thuần (class thường, không phải React state) sở hữu
  `Map<occurrenceKey, ResultEntry>` + `FetchState`; React chỉ đọc qua `useSyncExternalStore`. Một instance duy nhất
  cho toàn app, tạo trong `AutomationResultsProvider` (Context) ở App root — `main.tsx` và `useAutomation()` đều lấy
  cùng instance, không mỗi hook một store.
- **`ResultEntry`**: `{occurrenceKey, syncEpoch, snapshot, snapshotState, refresh, ack, ganVoiPhien, choTerminal,
  detachReason}`. `snapshotState` ∈ `none | ready | awaiting{deadline} | not_found | confirmed_absent` — union thay
  boolean+nullable, trạng thái sai không biểu diễn được.
- **CAS theo `syncEpoch` per-entry**: mỗi job chụp `sinceEpoch` của từng key lúc dispatch; response chỉ được áp nếu
  epoch hiện tại của key vẫn khớp baseline (không ai chen vào sửa key đó từ lúc hỏi tới lúc nghe). Một quy tắc, áp
  cho mọi key, mọi loại response (success/failed/absent).
- **Hai loại job, hai endpoint, không coalesce lẫn nhau**: background (`targets=∅`) gọi
  `GET /results?unseen=true&days=7`, được quyền discover key mới + tombstone (trừ entry `ganVoiPhien`/`choTerminal`);
  foreground (`targets` cụ thể) gọi `GET /results/lookup?occurrenceKeys=`, chỉ áp cho đúng key đã hỏi — "vắng nghĩa
  là gì" đọc từ `snapshotState` **sẵn có** của entry (đặt lúc attach), không cần metadata trong job.
- **Hàng đợi single-flight**: `current: {job, claims: Map<key,Claim>} | null`, `queuedClaims: Map<key,Claim>`.
  Invariant chính xác (sửa lại theo Codex code-review lát 2 vòng 2-3, §70/§72 — bản đầu phát biểu quá tuyệt đối):
  **mỗi key tối đa MỘT claim CÒN THẨM QUYỀN để coalesce vào** (`timThamQuyenClaim()` xét baseline job có còn khớp
  `syncEpoch` hiện tại của key không, không chỉ tra có mặt trong Map); cho phép tối đa MỘT claim cũ đã mất thẩm
  quyền ("predecessor", nằm trong `current.claims`, chỉ chờ job đó terminal để resolve waiter cũ) tồn tại **tạm
  thời** song song với một claim mới còn thẩm quyền ("successor", trong `queuedClaims`) — waiter không bao giờ
  chuyển chéo giữa hai bên; predecessor terminal (success/failure/abort) đều phải tự động promote successor.
  Promote lúc slot rảnh lấy tối đa 20 key/job (khớp cap endpoint), phần dư ở lại `queuedClaims` cho job kế tiếp.
- **Deadline (không phải đếm lần thử)**: `ganVaoPhien` (direct-terminal) là **one-shot**, không timer, không deadline
  — vắng dữ liệu = `confirmed_absent` (anomaly), bàn giao ngay. `choTerminalTrongPhien` (recovery) có
  `deadlineMs = automationUpdatedAt + RUNNING_LEASE_MINUTES(10p) + 2×TICK_INTERVAL_MS(60s) + POLL_INTERVAL_MS(30s)`
  ≈ 11 phút 30s, tính từ hằng số BE có sẵn (`server/lib/automation-helpers.ts`, `server/lib/automation-scheduler.ts`)
  — không có `automationUpdatedAt` hợp lệ thì **không attach**, không đoán bừa. `SWEEP_DEADLINES` chạy kèm mỗi nhịp
  poll, chuyển `awaiting` quá hạn thành `not_found` **và** tự detach (`ganVoiPhien/choTerminal=false` +
  `detachReason`) trong cùng một transition — không có trạng thái lửng "not_found nhưng vẫn attached".
- **Lifecycle store**: `running` (idempotent `start()`/`stop()`), `lifecycleId` (bump mỗi `start()`/`stop()`, mọi
  callback async guard token này ở dòng đầu tiên kể cả `finally`), `nextJobId` tăng dần suốt vòng đời (không reset)
  để id không va chạm giữa hai lifecycle. `stop()` là transition `STORE_STOPPED` nguyên tử (không đi qua đường
  `FETCH_ABORTED` bình thường vốn có thể promote queued).
- **Reconcile**: `activeReconcile: {id, key} | null` ở cấp store — singleton theo cấu trúc; handle trả về từ
  `batDauReconcile()` mang `reconcileId`, gọi `finish()/cancel()` sau khi active đã đổi là no-op tuyệt đối.

### 26.3. 3 điều kiện tích hợp bắt buộc (Codex §61.2 — phải thành AC/test, không được tự diễn giải khác)

1. `confirmed_absent`/`not_found` phải **atomically** clear `ganVoiPhien`/`choTerminal` đồng thời set
   `detachReason` — UI chỉ đọc và close/toast idempotent theo reason, không tự suy qua cạnh boolean.
2. `automationUpdatedAt` thiếu/không parse được: **không attach** coordinator; `useAutomation` phải tự đóng/bàn giao
   session đang có và đảm bảo queue không bị chặn, báo rõ "cần kiểm tra thủ công".
3. `confirmed_absent` không được hiển thị như kết quả authoritative — chỉ `snapshotState.phase === 'ready'` mới
   visible ở mọi selector.

### 26.4. Kế hoạch triển khai đã duyệt (Codex §62 — 5 lát, dừng review sau mỗi lát)

1. BE lookup endpoint + API spec + test validation/resolver (qua `security-gate` vì là endpoint mới).
2. Reducer/coordinator thuần (type/state/action/effect/CAS/claim Map) + property/race test — chưa fetch/React.
3. Runtime driver (fetch/single-flight/timeout/lifecycle) — chưa đổi owner ở `main.tsx`/`useAutomation`.
4. Provider + tích hợp `useAutomation`/`main.tsx` + regression hành vi cũ (bảng ánh xạ §61.3).
5. Tháo legacy (`feedGenRef`, suspect/suppress flags, fetch/poll cũ) + nghiệm thu toàn bộ.

Mỗi lát: slice brief trước khi code → code + test (có negative-proof: đảo/bỏ guard thì test phải đỏ) →
`npm run check` → tự soi `git diff --staged` → **một commit riêng** → handoff packet theo mẫu §62.3 → dừng chờ
Codex trả `PASS`/`PASS WITH NOTES`/`REWORK`/`DESIGN REOPEN`. Không gộp nhiều lát, không tự "điều chỉnh hợp lý" khi
code thật mâu thuẫn thiết kế — phải quay lại exchange trước.

## 27. Amendment (2026-08-09): review slice brief lát 4 — REWORK BRIEF

Codex review brief Provider + tích hợp trước khi code và trả **REWORK BRIEF** tại
[`docs/exchanges/2026-08-09.md` §2](../../exchanges/2026-08-09.md). Bốn blocker cần đóng trong brief sửa:

1. lát 4 phải vô hiệu hoá runtime legacy để chỉ còn một owner, dù lát 5 mới xoá source vật lý;
2. phải khóa decision table đầy đủ cho `/execute` mất/thiếu response, recovery và nguồn công thức deadline;
3. không được dùng `isSyncing()` (bao gồm poll nền) thay thẳng cờ foreground để chặn popup;
4. Provider phải bọc ngoài `<App />`, và UI phải giữ `{task, ReconcileHandle}` thay vì chỉ `Task` để
   `finish/cancel` đúng một lần.

Không có code lát 4 nào được duyệt hoặc cho phép bắt đầu ở vòng này. Reducer/driver vẫn giữ nguyên contract đã
khóa; đây là sửa brief tích hợp, chưa phải DESIGN REOPEN.

## 28. Amendment (2026-08-09): review brief lát 4 v2 — REWORK BRIEF vòng 2

Codex đối chiếu brief v2 với command/reducer và lifecycle popup thật, trả **REWORK BRIEF vòng 2** tại
[`docs/exchanges/2026-08-09.md` §4](../../exchanges/2026-08-09.md):

1. `choTerminalTrongPhien()` chỉ chờ một HTTP job, không chờ terminal/deadline — recovery phải subscribe
   `snapshotState`/`detachReason`;
2. decision table vẫn thiếu terminal response không có `occurrenceKey`;
3. không được cancel reconcile lúc mới mở popup xác nhận huỷ, hoặc mở result editor với `handle:null`;
4. refresh sau `finish()` lỗi phải còn banner + capability retry đúng key qua `errorsByKey`/`thuLaiLamMoi`.

Cho phép ngoại lệ tích hợp hẹp: export `POLL_INTERVAL_MS` đã có từ driver để tính deadline dùng chung; không đổi
giá trị, timer, lifecycle hay logic driver. Chưa có code lát 4 nào được duyệt ở vòng này.

## 29. Amendment (2026-08-09): brief lát 4 v3 đạt gate — PASS WITH NOTES

Codex duyệt brief v3 tại [`docs/exchanges/2026-08-09.md` §6](../../exchanges/2026-08-09.md): bốn blocker vòng 2
đã đóng đúng bằng flow state-driven cho recovery, fail-safe khi thiếu key, ownership `ReconcileHandle` xuyên nested
cancel và retry refresh theo từng key.

**Cho phép bắt đầu implementation lát 4** theo §5 exchange. Ràng buộc không chặn: một effect duy nhất được quyền
consume detach reason của session; nhánh không key chờ background tick kế tiếp thay vì tự fetch; cờ foreground do
nơi giữ handle quản lý; double-submit chỉ consume handle một lần; driver chỉ được thêm `export` cho
`POLL_INTERVAL_MS`. Đây là PASS brief, **chưa phải PASS code lát 4**.

## 30. Amendment (2026-08-09): review implementation lát 4 `07c73be` — REWORK

Codex review code tại [`docs/exchanges/2026-08-09.md` §8](../../exchanges/2026-08-09.md), trả **REWORK**:

1. post-terminal `taiDuLieu()` lỗi và effect đổi ngày có thể clear session mà không detach coordinator claim;
2. direct lookup `confirmed_absent` không consume `detachReason`, để entry không được tombstone;
3. test matrix integration/UI đã duyệt chưa được viết, đặc biệt lifecycle nested cancel, banner retry A/B,
   background poll không chặn UI và double-submit consume handle đúng một lần;
4. direct path chưa tuân behavior state-driven chung đã ghi ở note duyệt brief.

Provider/one-owner/deadline/recovery-awaiting cơ bản đạt, nhưng **lát 4 chưa PASS và chưa được sang lát 5**. Cần
commit REWORK riêng với test/negative-proof + full check + smoke UI rồi gửi handoff mới.

## 31. Amendment (2026-08-09): re-review REWORK lát 4 `611fe47` — REWORK

Codex re-review tại [`docs/exchanges/2026-08-09.md` §10](../../exchanges/2026-08-09.md). Hai lỗi ownership
§30.1/§30.2 và double-submit đã đóng đúng, nhưng lát 4 vẫn chưa đạt:

1. post-success `taiDuLieu()` reject bị nuốt ở hook trong khi helper thật chỉ hạ `dangTai` ở success → badge
   loading của App có thể treo vô hạn;
2. integration matrix bắt buộc vẫn thiếu `onUpdated` success/fail + banner/retry A/B, `onMoLaiPhienHoi`, ba
   nhánh nested cancel, date đổi khi lookup đang bay và detach-reason idempotent/tombstone;
3. test tự gọi là background poll chậm dùng response resolve ngay, nên không dựng request pending và không chứng
   minh UI B còn thao tác được trong lúc poll thật sự đang bay;
4. smoke UI được yêu cầu ở review trước vẫn chưa chạy.

`npm run check` trong phiên re-review xanh: 277 backend + 182 frontend, build đạt, bundle 488.1/500 kB,
0 link Markdown gãy. **Chưa PASS lát 4; chưa sang lát 5.**

## 32. Amendment (2026-08-09): gate UAT theo mọi đường tạo/cập nhật task

Theo yêu cầu nghiệm thu của user tại [`docs/exchanges/2026-08-09.md` §11](../../exchanges/2026-08-09.md), sau khi sửa
xong code và test máy, team phải tạo gói task `[UAT BL-001]` phủ cả hai chiều:

- mọi pattern automation đang hỗ trợ: duyệt trước/đúng/quá giờ, hủy, hỏi thêm, blocked, đổi giờ xác nhận lại, missed,
  nhận kết quả khi app mở/đóng, nhiều kết quả, refresh lỗi và `unknown_outcome` an toàn;
- mọi đường tạo/cập nhật có thể ảnh hưởng task automation: form đầy đủ, tạo nhanh, release định kỳ, release khẩn cấp,
  sửa đơn, đổi lịch, cập nhật task liên quan và sync release.

Với mỗi ô áp dụng được, user phải kiểm tra dữ liệu lưu, trạng thái automation, popup/toast và occurrence ownership. Dùng
đích nháp an toàn cho ghi thật; capability `other` còn bị khoá thì ghi Blocked thay vì nới quyền. CR chỉ được nghiệm thu
và `BL-20260809-001` chỉ được chuyển `Done` sau khi user xác nhận gói UAT này.

## 33. Amendment (2026-08-09): review implementation `5de5456` — REWORK

Codex review tại [`docs/exchanges/2026-08-09.md` §13](../../exchanges/2026-08-09.md). Fix loading và deferred poll đạt,
nhưng lát 4 vẫn thiếu gate:

1. chưa có nhánh `PopupSuaTask.onUpdated → handle.finish()` thành công trực tiếp; retry banner dùng command khác và không
   thay thế được test wiring này;
2. test lookup pending dùng Esc, chưa đổi ngày thật để kiểm effect `ngayDinhKy` nhả claim và chặn response cũ hồi sinh;
3. nested-cancel API fail tạo `unhandledRejection`, không báo lỗi cho user; test đang dùng global process listener để nuốt
   lỗi thay vì chứng minh UI failure hoạt động đúng;
4. manual UI smoke vẫn chưa chạy.

Full check review xanh: 277 backend + 188 frontend, build/bundle/docs đạt. **Chưa PASS lát 4; chưa sang lát 5 và chưa mở
gói UAT user.**

## 34. Amendment (2026-08-09): review implementation `8c08d2c` — PASS WITH NOTES / HOLD

Codex review tại [`docs/exchanges/2026-08-09.md` §15](../../exchanges/2026-08-09.md): ba finding §13 đã đóng đúng;
không phát hiện finding code mới. Full check xanh: 277 backend + 190 frontend, build/docs đạt, bundle 488.4/500 kB.

Manual UI smoke vẫn chưa có bằng chứng. Codex thử khởi động app (HTTP 200) và kết nối Browser nhưng runtime không có
browser khả dụng, sau đó đã dừng app để không để scheduler chạy nền. **Code review PASS WITH NOTES; delivery HOLD:** lát 4
chỉ hoàn tất và lát 5 chỉ được mở sau khi smoke UI thật đạt. Gói UAT user chỉ tạo sau khi toàn bộ implementation PASS.

## 35. Amendment (2026-08-09): smoke phát hiện scheduler không hồi sinh task chu kỳ sau — REWORK

Trong smoke, user đặt đúng câu hỏi về việc task đã chạy thành công phải được đánh hoàn thành. Code execute thật đã làm
đúng việc đó trong transaction (`markTaskDone`); `Đã xem` chỉ ACK notification. Tuy nhiên trạng thái hoàn thành thật lại
lộ ra một lỗi khác: query đầu vào scheduler loại mọi task `trang_thai=da_hoan_thanh`, khiến task định kỳ không thể đi tới
logic `daXongTrongNgay()`/`reset_idle` để hồi sinh ở occurrence ngày sau. Test scheduler hiện tại chưa bắt lỗi vì chỉ đặt
`automation_status=done`, không mô phỏng đồng thời `trang_thai=da_hoan_thanh` như execution thật.

Chi tiết và acceptance sửa tại [`docs/exchanges/2026-08-09.md` §16](../../exchanges/2026-08-09.md). Finding thuộc luồng
CR chưa nghiệm thu nên giữ trong CR này. **Delivery chuyển từ HOLD sang REWORK:** phải có test tích hợp hai ngày trên trạng
thái thật và sửa selection scheduler trước khi tiếp tục lát 5/UAT.

## 36. Amendment (2026-08-09): thiếu retry sau khi sửa task bị blocked — REWORK

Smoke của user phát hiện task `blocked` không có đường thao tác hoàn chỉnh sau khi user sửa dữ liệu. Nút recheck hiện chỉ
nằm trong popup blocked; editor `AiKetQua` chỉ hiển thị reasons, sau lưu không dựng lại precheck. Ngoài ra `Mở task` từ
popup blocked đang dùng flow result reconcile cần `occurrenceKey`, dù precheck blocked thường chưa có key.

Chi tiết nguyên nhân và acceptance tại [`docs/exchanges/2026-08-09.md` §18](../../exchanges/2026-08-09.md). Phải bổ sung
đường `Mở task để sửa → Lưu & kiểm tra lại`, CTA retry bền vững cho task blocked đã reopen, busy/error/double-submit guard
và test UI; retry chỉ được chạy precheck read-only, không tự duyệt hoặc ghi ra ngoài. **Finding ở trong CR hiện tại và giữ
delivery ở REWORK.**

## 37. Amendment (2026-08-09): review fix scheduler `a383dd2` — PASS riêng finding

Codex review tại [`docs/exchanges/2026-08-09.md` §19](../../exchanges/2026-08-09.md): selection scheduler mới đúng với
luật per-occurrence, dữ liệu test mô phỏng đúng transaction thành công thật, ca qua hai ngày/cùng ngày/canceled đều được
phủ. Full gate xanh 279 backend + 190 frontend, build/docs/bundle đạt. **Fix scheduler PASS; BL-005 được đóng như đã hấp
thụ vào BL-001.**

Toàn CR vẫn **REWORK** vì finding UI §18/§36 về đường `blocked → sửa → retry` chưa có implementation/test.

## 38. Amendment (2026-08-09): review §18 phát hiện retry dùng dữ liệu cũ — sửa nối tiếp, chờ Claude review

Review `f5bc658` phát hiện CTA retry gọi preview trực tiếp bằng snapshot task cũ và không lưu form, trái acceptance
`Bị chặn → sửa → Lưu & kiểm tra lại`. Phần sửa nối tiếp bắt buộc thứ tự `PATCH → reload DB → preview`, giữ popup chọn scope của task
định kỳ thủ công, chống submit đôi và giữ editor/popup để retry khi lưu lỗi. Refresh dành cho recheck không được finish reconcile/đóng
editor trước khi preview thành công. Nhãn textarea Ghi chú cũng được tách khỏi nút copy để accessibility và thao tác test trỏ đúng control.

Bằng chứng: test mục tiêu 32/32; full gate 279 backend + 202 frontend, build/docs đạt, bundle 490.5/500 kB. Chi tiết review/handoff ở
[exchange §22](../../exchanges/2026-08-09.md). **Trạng thái vẫn HOLD:** chờ Claude review working diff và smoke UI thật; chưa mở lát 5/UAT.

## 39. Amendment (2026-08-09): refresh sau preview có thể tạo unhandled rejection — đã sửa, chờ re-review

Review `aa1a81b` xác nhận fix overlap popup của Claude đúng, nhưng phát hiện `startAutomationPreview()` vẫn có thể reject từ
`await taiDuLieu()` trong `finally`; call site fire-and-forget khi đó không có owner bắt lỗi. Đã cô lập lỗi refresh dashboard, giữ nguyên
session preview/error đã hiển thị và bổ sung test negative-proof cho `preview blocked → refresh reject → Promise vẫn resolve`.

Bằng chứng: targeted 50/50; full gate 279 backend + 204 frontend, build/docs đạt, bundle 490.5/500 kB. Chi tiết ở
[exchange §24](../../exchanges/2026-08-09.md). **HOLD:** chờ Claude re-review và smoke UI thật; chưa mở lát 5/UAT.

## 40. Amendment (2026-08-09): final review `c5667e7` — PASS code, chờ smoke UI

Claude review độc lập §25 PASS; Codex kiểm tra lại commit và full gate tại §26 không phát hiện finding mới. Full gate hiện tại:
279 backend + 204 frontend, build/docs đạt, bundle 490.5/500 kB.

**Implementation đường `blocked → sửa → retry` PASS code.** CR vẫn HOLD delivery vì còn thiếu smoke UI thật; smoke đạt mới tiếp tục
lát 5 và tạo gói UAT toàn luồng.

## 41. Amendment (2026-08-09): đã chuẩn bị dữ liệu smoke UI

Codex đã tạo gói `[UAT BL-001]` qua API local với task IDs `27–37`, phủ task blocked/retry, preview, đổi giờ, cập nhật related,
chu kỳ tuần/tháng, tạo nhanh cá nhân và task sinh từ release thường/emergency. Task `27` đã được precheck read-only và vào `blocked`
đúng kỳ vọng; không có lượt approve/execute nào được gọi. Danh sách và hướng dẫn chi tiết ở
[exchange §27](../../exchanges/2026-08-09.md).

CR vẫn **HOLD** cho tới khi user smoke UI thật và xác nhận kết quả; việc tạo fixture không thay thế nghiệm thu.

## 42. Amendment (2026-08-09): UAT máy/API PASS, UI/manual còn HOLD

Kết quả chi tiết tại [exchange §28](../../exchanges/2026-08-09.md): full gate đạt 279 backend + 204 frontend; các đường đổi giờ,
`updateRelated`, recurrence tuần/tháng, tạo nhanh, regular-release sync `needs_reconfirm` và emergency-release sync hồi sinh `idle`
đều lưu đúng trên API local. Không approve/execute và không ghi ra hệ thống ngoài.

Một precheck đã hoàn tất ở server nhưng lâu hơn timeout 40 giây của client kiểm thử; frontend hiện không có timeout riêng. Ghi nhận
là quan sát UX/latency, chưa kết luận API server timeout. **CR tiếp tục HOLD** cho phần popup/toast và occurrence ownership cần UI/manual UAT.

## 43. Amendment (2026-08-09): Leader chấp nhận UAT UI — mở lát 5/5

Leader xác nhận coi phần UAT UI đã hoàn thành. Gate UAT gồm quyết định manual này và bằng chứng máy/API tại
[exchange §28–§29](../../exchanges/2026-08-09.md) không còn blocker.

CR chuyển từ `HOLD UAT` sang **Ready for final audit**. Việc còn lại của lát 5/5 chỉ gồm rà import/type/code mồ côi và đối chiếu
checklist DoD toàn CR; không thêm chức năng. Chỉ sau khi audit sạch mới đánh dấu `Đã nghiệm thu` và đóng BL-001.

## 44. Amendment (2026-08-09): lát 5/5 final audit PASS — CR đã nghiệm thu

Final audit xác nhận cơ chế result-feed legacy (`feedGenRef`, fetch/poll/queue/suspect/suppress cũ) không còn trong runtime.
Đã dọn năm type automation import mồ côi khỏi `src/main.tsx`. Khi đối chiếu 30 AC, audit phát hiện AC-27 mới chỉ được mô tả
trong code mà chưa có fault-injection test trực tiếp; đã bổ sung SQLite trigger ép insert `result_recorded` lỗi và chứng minh
transaction không commit trạng thái terminal thiếu snapshot. Không cần sửa code sản phẩm.

Bằng chứng cuối:

- targeted `automation-cr20260808.test.ts`: 26/26;
- full gate: 280 backend + 204 frontend, TypeScript/build/bundle/docs/gốc thời gian đều đạt;
- UAT máy/API PASS tại §42; Leader chấp nhận UAT UI tại §43;
- không mở capability `other`, không có approve/execute ra hệ thống ngoài trong lượt UAT của Codex.

**Verdict: ✅ Đã nghiệm thu.** Toàn bộ 5 lát và DoD của CR đã khép; `BL-20260809-001` chuyển `Done`. Việc tiếp theo
thuộc `BL-20260809-002`: rà remote và push lịch sử `main` an toàn.

## 45. Amendment (2026-08-09): tiếp thu review rộng — sửa 4 điểm refresh phụ làm Promise reject

Review muộn của Claude tại [exchange §26](../../exchanges/2026-08-09.md) chỉ ra ba thao tác còn gọi `taiDuLieu()` không tự bắt lỗi sau khi
kết quả chính đã được xử lý: trả lời câu hỏi, phê duyệt chạy ngay và phê duyệt chờ giờ. Codex xác nhận cả ba finding bằng test đỏ. Quét tiếp theo
cùng hành vi còn phát hiện điểm thứ tư ở thao tác hủy automation; test riêng cũng đỏ với cùng lỗi `refresh dashboard lỗi`.

Đã gom chính sách refresh hậu thao tác vào `dongBoDashboardPhuTro()`: dashboard refresh chỉ là đồng bộ phụ, vì vậy lỗi refresh không được phủ
nhận kết quả API/session/toast chính và không được bật ra khỏi React `onClick` thành unhandled rejection. Áp dụng nhất quán cho preview, answer,
approve, approve-now, execute terminal và cancel; các refresh phục vụ quyết định nghiệp vụ vẫn giữ cách xử lý riêng.

Bằng chứng:

- negative-proof trước sửa: ba test theo review cùng fail vì Promise reject; test bổ sung cho cancel cũng fail độc lập với cùng nguyên nhân;
- targeted `useAutomation.test.tsx`: 21/21 xanh sau sửa;
- full `npm run check`: 280 backend + 208 frontend xanh; TypeScript/build/bundle/docs/gốc thời gian đều đạt.

Amendment này mở lại kết luận §44 do có code đổi sau audit. **Trạng thái hiện tại: HOLD re-review**; `BL-20260809-001` quay lại `Picked`. Chỉ sau
khi Claude review diff này PASS mới khôi phục `Đã nghiệm thu`, đóng BL-001 và chuyển sang việc push remote.

## 46. Amendment (2026-08-09): Claude review diff §45 — PASS, khôi phục Đã nghiệm thu

Claude review độc lập (đọc diff, tự chạy lại 21/21 test, tự sabotage `dongBoDashboardPhuTro()` xác nhận đúng 6 test đỏ — 5 test mới +
1 test cũ dùng chung call site — rồi khôi phục và chạy lại xanh, cuối cùng `npm run check` toàn bộ 280 backend + 208 frontend xanh).
Xác nhận cả 4 vị trí sửa đúng và nhất quán, không sót call site nào khác (đã tự grep lại toàn file, xác nhận 2 chỗ còn gọi `taiDuLieu()`
trực tiếp là hợp lệ — không phải cùng lỗi). Chi tiết ở [exchange §32](../../exchanges/2026-08-09.md).

**Verdict: ✅ PASS. Khôi phục `Đã nghiệm thu`.** Không còn finding mở cho CR-20260808. Bước kế tiếp thuộc `BL-20260809-002`
(rà remote + push `main`).
