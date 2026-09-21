# BUG-20260803-bat-app-trung — Mỗi lần Claude/Codex bật hoặc chuyển mode lại mọc thêm một tiến trình app

| Trường | Giá trị |
|---|---|
| Ngày phát hiện | 2026-08-03 |
| Người phát hiện | Leader (dùng thật) |
| Mức nghiêm trọng | ⬜ Chặn dùng ⬜ Sai dữ liệu ✅ Khó chịu ⬜ Cosmetic |
| **Sinh ra bởi** | ✅ Có sẵn từ khi làm MCP server (`ensureServer` chỉ kiểm HTTP, không có khóa) |
| **Cổng lẽ ra phải bắt** | ⬜ ① Yêu cầu ✅ ② Thiết kế ⬜ ③ Feedback sớm ⬜ ④ DoR ⬜ ⑤ Bàn giao test ✅ ⑥ Cổng hạ tầng ⬜ ⑦ Nghiệm thu ⬜ ⑧ Chốt/ship |
| **Loại nguyên nhân** | ⬜ RC-REQ ✅ RC-SPEC ⬜ RC-IMPL ✅ RC-TEST ⬜ RC-DATA ⬜ RC-INTEG ⬜ RC-PERF ⬜ RC-SEC ⬜ RC-DOC ⬜ RC-PROC |
| Trạng thái | ⬜ Mới ⬜ Đã có test đỏ ✅ Đã sửa ✅ Đã rút kinh nghiệm |
| Test tái hiện | `test/unit/app-singleton.test.ts` (9 ca) · `test/integration/app-single-instance.test.ts` |

## 1. Triệu chứng

Cứ bật Claude Desktop / Codex, hoặc chuyển mode trong đó, là **mọc thêm một tiến trình app**. Task Manager
của Windows đọng nhiều tiến trình `TaskManager.exe` / `node server/index.ts` cùng lúc.

Đo thực tế lúc phát hiện: **5 tiến trình MCP** (`dist-mcp/mcp.mjs`) sống song song — 2 do `claude.exe`, 3 do
`codex.exe` — cộng 1 `TaskManager.exe` đang giữ port 4000.

## 2. Tái hiện

1. Mở app (exe) — nó chiếm port 4000.
2. Bật Claude Desktop (hoặc Codex), rồi chuyển mode vài lần.
3. Xem tiến trình: mỗi lượt bật MCP lại có thêm tiến trình app.

- **Kỳ vọng:** đã có app đang chạy ⇒ MCP chỉ kết nối, không bật thêm gì.
- **Thực tế:** thêm tiến trình app mới, và tiến trình đó **không chết** dù không phục vụ được.

## 3. Nguyên nhân gốc

Ba lỗi cộng lại:

1. **`ensureServer()` chỉ kiểm HTTP.** Lúc app đang khởi động (2–10s) `isUp()` trả `false`, nên mọi tiến
   trình MCP chạy trong khoảng đó đều kết luận *"chưa có app"* và cùng spawn. Không có khóa nào giữa các
   tiến trình ⇒ **race** ở mức liên-tiến-trình.
2. **Không ai đếm số tiến trình MCP.** Thiết kế ngầm giả định *"mỗi lúc chỉ có một MCP"*. Thực tế Claude
   Desktop và Codex mỗi lần bật/chuyển mode lại spawn thêm một, tiến trình cũ vẫn sống ⇒ giả định sai từ gốc.
3. **`server/index.ts` gặp `EADDRINUSE` chỉ log rồi sống tiếp** — tiến trình không listen được, không có
   scheduler, không phục vụ gì, nhưng vẫn nằm trong danh sách tiến trình. Đây chính là thứ người dùng
   thấy là "app bị mở trùng".

**Vì sao lọt qua:** không có test nào mở app hai lần. Toàn bộ test tích hợp import `app.ts` (Express thuần)
chứ không chạy `index.ts` — mà lỗi nằm đúng ở `index.ts`, phần chỉ chạy khi khởi động thật.

## 4. Cổng nào hụt & vì sao

| Cổng | Đáng lẽ phải bắt bằng cách nào | Vì sao không bắt được |
|---|---|---|
| ② Thiết kế | Khi viết MCP tự bật app, phải coi *"nhiều tiến trình MCP cùng tồn tại"* là mặc định (Claude Desktop + Codex + mỗi lần chuyển mode), không phải ngoại lệ. Đơn-instance thì cần khóa liên-tiến-trình, không phải một câu kiểm HTTP | Giả định "chỉ một MCP" không được viết ra nên không ai chất vấn |
| ⑥ Cổng hạ tầng | Kịch bản "mở app lần 2" là kịch bản vận hành cơ bản, phải có ca test | `index.ts` chưa từng được test chạy thật; test chỉ import `app.ts` |

## 5. Cách sửa

- **Test đỏ trước:** 9 ca unit cho khóa + chọn launcher; 1 ca tích hợp chạy `index.ts` **thật** 2 lần.
- **Thêm [`server/lib/app-singleton.ts`](../../../server/lib/app-singleton.ts)** — 3 lớp chặn, rẻ trước chắc sau:
  1. `isUp()` — app trả HTTP ⇒ không làm gì.
  2. `isPortBusy(4000)` — port đã bị chiếm (app đang boot hoặc treo) ⇒ **không spawn**, chỉ chờ.
     Đây là lớp bù đúng cho khoảng trắng mà lớp 1 không thấy.
  3. `acquireLaunchLock()` — khóa file tạo bằng cờ `wx` (atomic ở tầng OS) tại `%APPDATA%/TaskManager/app-launch.lock`.
     Hai MCP cùng lúc thì chỉ một bên spawn, bên kia chờ. TTL 90s để khóa rác của tiến trình chết tự hết hiệu lực.
- **`server/index.ts`: `EADDRINUSE` ⇒ `process.exit(0)`** — thoát êm, không để lại tiến trình rác.
- **Ưu tiên bản đã đóng gói:** `chooseAppLauncher` chạy `release/TaskManager/TaskManager.exe` nếu có, không
  có thì fallback bản dev; `TASK_MANAGER_APP_BIN` để trỏ tay.
- **Quét lân cận:** `spawnHealthCheck` chỉ chạy khi `TASK_MANAGER_HEALTHCHECK` trỏ tới file tồn tại — hiện
  không set nên không góp phần vào bug này.

## 6. Hành động cải tiến

| # | Thay đổi gì | Ở đâu | Trạng thái |
|---|---|---|---|
| 1 | Rule: tiến trình đơn-instance phải chặn bằng **khóa liên-tiến-trình + kiểm port**, không bằng health-check HTTP. Và tiến trình không giành được port phải **thoát**, không được sống tiếp | [rules/07 §8.3](../../rules/07-rules-backend.md) | ✅ Xong |
| 2 | Rule: mọi giả định *"chỉ có một tiến trình/tab/phiên"* phải được viết ra trong Change Spec — nếu môi trường không bảo đảm thì phải có khóa | [design-standard §9.4](../../standards/design-standard.md) | ✅ Xong |
| 3 | Test: kịch bản **mở app lần 2** là ca bắt buộc; phải chạy `index.ts` thật, không chỉ import `app.ts` | [qa-standard §8.3](../../standards/qa-standard.md) | ✅ Xong |

## 7. Liên kết

- Cùng ngày: [BUG múi giờ](BUG-20260803-automation-sai-mui-gio.md) · [BUG precheck](BUG-20260803-precheck-khong-doc-duoc-mcp.md) · [BUG pha ghi](BUG-20260803-pha-ghi-thieu-tool-doc.md)
- Commit sửa: (điền sau khi commit)
