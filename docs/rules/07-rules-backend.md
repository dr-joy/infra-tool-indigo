# 07 - Backend Rules

> Nguồn: `docs/_archive/system-standardization-rules.md`, `server/app.ts`, `server/index.ts`, `server/routes/*`, `server/lib/utils.ts`.
> Đây là rule backend để thêm/sửa route mà không phá contract hiện có.

## 1. Route Organization

- Mỗi domain có route riêng trong `server/routes/*`.
- Mount router dưới `/api`.
- Path dùng danh từ/domain rõ nghĩa.

Ví dụ:

| Domain | Path |
|---|---|
| Tasks | `/api/tasks` |
| Project tasks | `/api/projects/:projectId/tasks` |
| Luyện đề | `/api/de-thi/ky-thi` |
| Weekly goals | `/api/weeks/:weekStart/goals` |

## 2. HTTP Method

| Method | Dùng cho |
|---|---|
| GET | Đọc dữ liệu |
| POST | Tạo resource hoặc action tạo kết quả mới |
| PATCH | Cập nhật một phần hoặc đổi trạng thái |
| PUT | Thay thế toàn bộ resource con |
| DELETE | Xóa |

## 3. Validation

Backend là lớp validate bắt buộc:

- ID phải parse và validate integer nếu DB dùng integer.
- Date-only dùng `YYYY-MM-DD`.
- Time-only dùng `HH:MM`.
- Enum so với danh sách hợp lệ.
- Text user input phải trim trước khi lưu.
- Optional field lưu `''` hay `null` theo schema hiện có của domain.
- Link task tối đa 4, type và URL scheme phải hợp lệ.

## 4. SQL & Transaction

- Luôn dùng prepared statement với placeholder `?`.
- Không nối trực tiếp user input vào SQL.
- SQL động chỉ được tạo từ phần đã validate hoặc nội bộ, ví dụ placeholder list từ ID đã validate.
- Nhiều bước ghi DB phải dùng transaction.
- Sau thao tác ảnh hưởng dữ liệu suy ra, gọi lại rollup/recalculate của domain.

## 5. Error Handling

| Status | Khi dùng |
|---|---|
| 400 | Input sai |
| 404 | Không tìm thấy resource |
| 409 | Conflict nghiệp vụ cần user xử lý |
| 500 | Lỗi ngoài dự kiến |
| 502 | Lỗi từ hệ thống tích hợp ngoài |
| 503 | Dịch vụ/cấu hình bắt buộc chưa sẵn sàng |

- Response lỗi chuẩn: `{ message, code? }`.
- Không trả stack trace, SQL raw, path secret, API key.
- Nếu domain đã dùng `HttpError` / `sendRouteError`, tiếp tục dùng pattern đó.

**Registry mã lỗi machine-readable** (`code`, chốt CR-20260913-c/BL-20260913-005): mọi `code` mới
phải đăng ký ở [`server/lib/error-codes.ts`](../../server/lib/error-codes.ts) — status HTTP thật + 1
câu note khi nào dùng. Đặt tên theo mẫu đã có: `<NGỮ_CẢNH>_<LÝ_DO>` viết hoa, gạch dưới (vd
`EMERGENCY_BATCH_ALREADY_POSTED`). Cổng `scripts/check-error-codes.mjs` (wired vào `npm run check`)
chỉ chặn mã **mới** chưa đăng ký — không bắt gắn code cho lỗi cũ chỉ có `message` (kiểm kê
2026-09-13: phần lớn lỗi không có code, đúng chủ ý, không phải thiếu sót).

## 6. Security Runtime

- App hiện không có auth người dùng; mô hình là local-first single-user, bind `127.0.0.1`.
- CORS chỉ cho localhost/127.0.0.1.
- Header bảo mật chung đặt trong Express app.
- Redmine API key mã hóa AES-256-GCM, không log secret/token.

### 6.2 Definition → task release: một nguồn ghi, cấm match theo tên (CR-20260814-hop-nhat-dong-bo-definition-xuong-task)

- Task release là **bản chụp** (snapshot) nội dung definition tại thời điểm sinh/đồng bộ — KHÔNG tự động
  theo definition sửa sau đó. Bài học 2026-08-14: hai đường ghi khác nhau (`/schedules/regular-release/task`
  và `/schedules/release/sync`) không đường nào phát hiện lệch, giữ lại nội dung task cũ.
- **Match task ↔ definition DUY NHẤT theo `(release_month, origin_ref)`**, không bao giờ theo `ten_task`.
  Đổi tên definition không được sinh task trùng và không được xoá task cũ (mất `trang_thai`/
  lịch sử). Ngoại lệ hợp lệ (bulk recreate có `force`/409 xác nhận người dùng; emergency `replaceMatching`) phải
  có marker tường minh `// ten-task-match-ok: <lý do>` ngay trên câu `DELETE` — cổng máy
  `scripts/check-release-sync.mjs` chặn route "lưu 1 definition" (`/schedules/regular-release/task`) match theo
  tên **kể cả có marker** (route đó không được phép match theo tên trong bất kỳ trường hợp nào).
- **Một hàm dựng nội dung, một hàm so lệch** — [`server/lib/release-render.ts`](../../server/lib/release-render.ts):
  `buildDefinitionTargetPayload` (dựng nội dung từ definition + template + ngày release) và
  `diffTaskAgainstDefinition` (so lệch, chuẩn hoá trim/xuống dòng trước khi so). Mọi route đồng bộ dùng chung
  hai hàm này.
- **Snapshot phải phát hiện lệch chủ động, không chỉ khi user bấm.** `GET /api/schedules/release/drift` (chỉ
  đọc, 1 lượt truy vấn/đợt) cho màn Release biết ngay có task nào lệch mà không cần thao tác gì.
- Cột `ghi_chu` (Note) trong câu UPDATE đồng bộ chỉ được SET khi definition **có** template — definition không
  có template thì câu UPDATE thật sự không chứa cột đó (không phải "đọc giá trị cũ rồi ghi lại", để tránh race
  giữa lúc preview và lúc apply thật sự ghi).
## 7. Business Rules Không Được Phá

- Project hệ thống "Khác" không xóa/đóng và chỉ hỗ trợ task level 1.
- Project task tối đa 3 cấp.
- Parent project task derive từ task con.
- Đổi ngày task làm mất overlap với weekly goal hiện tại/tương lai trả `409 GOAL_CONFLICT` nếu chưa xác nhận.
- Release template token phải hợp lệ.
- Luyện đề rút theo `lan_ra` rồi random, import dedupe theo `fileName`.

## 8. Tiến trình nền & quyết định theo thời gian

- **Mọi quyết định theo thời gian nằm ở server**, không ở frontend ([rules/06 §8](06-rules-frontend.md)).
- **Timer/scheduler khởi động ở `server/index.ts`, KHÔNG ở `server/app.ts`.** Test tích hợp import
  `app.ts`; timer trong đó sẽ giữ event loop và làm treo cả suite. `app.ts` phải thuần cấu hình.
- Scheduler export `startX()` / `stopX()` / **`tickOnce(now)`**. `tickOnce` nhận `now` từ ngoài để
  test chạy thẳng mọi mốc thời gian mà không cần giả lập đồng hồ ([qa-standard §1.5](../standards/qa-standard.md)).
- Logic quyết định tách thành **hàm thuần** trong `lib/*-helpers.ts` (không đụng DB, không gọi
  `Date.now()`); vòng tick chỉ thi hành.
- **Chống chồng lượt**: cờ `ticking` để lượt sau không chạy khi lượt trước còn `await`.
- **Trần đồng thời cho tiến trình con**: tick 30s × timeout spawn 5' ⇒ không có trần thì một lần treo
  để lại nhiều tiến trình song song. Mỗi lượt tick chỉ được spawn tối đa 1.
- **Một task lỗi không được làm chết vòng lặp**: bọc `try/catch` từng phần tử.
- `timer.unref()` để tiến trình vẫn thoát sạch; dừng scheduler ở `SIGINT`/`SIGTERM`/`exit`.

### 8.1 Gốc thời gian: GIỜ VIỆT NAM (bắt buộc)

Giờ người dùng nhập (task định kỳ, release) là **giờ VN**. Máy chạy app có thể đặt JST/UTC bất kỳ.

- Mọi phép so *"đã tới giờ chưa / hôm nay là ngày nào"* dùng [`server/lib/vn-time.ts`](../../server/lib/vn-time.ts)
  (`vietnamDateKey`, `vietnamInstant`, `minutesUntilVietnam`).
- **CẤM** trong logic quyết định: `new Date(y, m, d, h, m)`, `setHours()`, `getHours()`,
  `getMinutes()`, `getFullYear/getMonth/getDate/getDay` — chúng đọc múi giờ máy. (Vẫn dùng được cho
  *hiển thị* hoặc cho `Date` chỉ mang nghĩa "ngày lịch" đã dựng từ `yyyy-mm-dd`.)
- **CẤM luôn các helper dựng giờ máy** trong vùng quyết định: `localDateInputValue`,
  `parseLocalDateTime`, `taoNgayTuInput`, `congNgayInput`, `congThangInput`. Lý do: `src/main.tsx`
  từng sai **mà không dùng API nào bị cấm trực tiếp** — nó sai hoàn toàn qua helper (BUG-20260804 §9).
- **Máy thi hành rule này**, không chỉ người: [`scripts/check-tz.mjs`](../../scripts/check-tz.mjs)
  (bước "Gốc thời gian (giờ VN)" trong `npm run check`). Vùng quét là danh sách file trong chính
  script đó. Thật sự là chỗ hiển thị/phép-lịch ⇒ khai báo bằng marker **có lý do**, đặt ngay trên
  hàm (che cả thân hàm) hoặc ngay trên một dòng:
  ```ts
  // tz-ok: hien-thi
  export function localDateInputValue(date = new Date()) { … }
  ```
  Marker thiếu lý do, hoặc còn nằm lại sau khi code đã sửa (không che vi phạm nào) ⇒ cổng **đỏ**.
- Rule này đã bị vi phạm **3 lần ngay sau khi được viết** (`occKeyOf`, `todayLocalDate`, `quaGio`)
  vì lúc đó chỉ có người gác. Đó là lý do có cổng máy — xem
  [CR-20260804](../delivery/changes/CR-20260804-cong-may-gio-vn.md).
- **Khóa occurrence phải trùng FE**: ngày trong khóa là ngày VN ở cả hai phía, nếu không nhật ký
  `asked`/`declined` ghi lệch occurrence sau 22:00 VN.
- Việt Nam không có DST ⇒ ghép chuỗi ISO offset `+07:00` là đủ, không cần thư viện timezone.

### 8.2 Phạm vi ngày: chỉ occurrence của hôm nay

- Vòng tick **phải** hỏi luật lặp trước khi hành động, không chỉ so giờ-trong-ngày; nếu không, task của
  ngày khác (`ngay_cu_the` tương lai) bị đánh `missed` ngay hôm nay.
- Luật lặp có **đúng một định nghĩa**: [`server/lib/recurrence.ts`](../../server/lib/recurrence.ts).
  Dashboard (`recurringMatchesDate`) và scheduler (`occurrenceIsToday`) cùng gọi vào đó — không viết lại.
- Ngoại lệ có chủ đích: nhánh **hồi sinh trạng thái cuối** (`reset_idle`) chạy *trước* cổng ngày, để task
  một-lần không mắc ở trạng thái cuối vĩnh viễn. Reset không ghi gì ra ngoài nên an toàn.

> Nguồn: [BUG-20260803-automation-sai-mui-gio](../delivery/bugs/BUG-20260803-automation-sai-mui-gio.md).

### 8.3 Đơn-instance: khóa liên-tiến-trình, và tiến trình thua phải THOÁT

App chỉ được có **một** tiến trình phục vụ. Tác nhân bên ngoài (Claude Desktop, Codex, shortcut) có thể
gọi "bật app" nhiều lần đồng thời — coi đó là mặc định, không phải ngoại lệ.

- **Không** dùng health-check HTTP làm cơ chế chống trùng: lúc app đang boot (2–10s) mọi tiến trình đều
  thấy "chưa có app" rồi cùng spawn.
- Ba lớp, dùng [`server/lib/app-singleton.ts`](../../server/lib/app-singleton.ts): HTTP OK → **port đã bị
  chiếm** (đủ để kết luận đã có tiến trình app, kể cả đang boot) → **khóa file tạo bằng cờ `wx`** (atomic
  ở tầng OS, có TTL để khóa rác tự hết hiệu lực).
- Tiến trình **không giành được port phải `process.exit(0)`**. Giữ nó sống = tiến trình rác: không listen,
  không scheduler, nhưng vẫn hiện trong Task Manager và làm người dùng tưởng app mở trùng.
- Không mở browser / không làm side-effect ở nhánh thua port — instance đang chạy đã làm rồi.

> Nguồn: [BUG-20260803-bat-app-trung](../delivery/bugs/BUG-20260803-bat-app-trung.md) — đã đọng 5 tiến
> trình MCP + tiến trình app rác.

## 10. Cần Bổ Sung

> ⏳ User điền nốt: có cần auth/phân quyền khi mở rộng nhiều người dùng không.
> ⏳ User điền nốt: có cần API versioning `/api/v1` không.
