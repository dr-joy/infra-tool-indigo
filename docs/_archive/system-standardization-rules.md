# Quy chuẩn FE, BE, DB, API

> 🗄️ **HẾT HIỆU LỰC — 2026-08-01.** Toàn bộ nội dung đã được curate vào bộ rule canonical.
>
> **Thay bằng:** [../rules/06-rules-frontend.md](../rules/06-rules-frontend.md) ·
> [../rules/07-rules-backend.md](../rules/07-rules-backend.md) ·
> [../rules/08-rules-database.md](../rules/08-rules-database.md).
> Sửa rule ⇒ sửa ở `rules/`, **không sửa file này**.

Tài liệu này ghi lại các rule đang phù hợp với kiến trúc hiện tại của hệ thống để dùng làm checklist khi thêm feature, sửa bug hoặc refactor. Mục tiêu là giữ code nhất quán, dễ dò lỗi, và tránh làm mất dữ liệu runtime.

## 1. Tổng quan kiến trúc

- Frontend: React + Vite + TypeScript, entry chính ở `src/main.tsx`; các module lớn có file riêng như `src/luyen-de.tsx`, `src/mind-map.tsx`.
- Backend: Express + TypeScript, server entry ở `server/index.ts`, route theo domain trong `server/routes/*`.
- DB: SQLite qua `node:sqlite`, schema và migration tập trung trong `server/db.ts`.
- API: tất cả route backend mount dưới `/api`; frontend gọi qua helper `api<T>()`.
- Runtime DB dùng chung cho dev và exe nằm tại `%APPDATA%\TaskManager\data\tasks.sqlite`, không phải `data/tasks.sqlite` trong repo.

## 2. Naming và contract dữ liệu

- DB dùng `snake_case`: `ten_task`, `created_at`, `project_id`.
- API và frontend dùng `camelCase`: `tenTask`, `createdAt`, `projectId`.
- Việc đổi `snake_case -> camelCase` phải nằm ở mapper backend, ưu tiên `server/lib/mappers.ts` hoặc helper local trong route nếu domain chưa có mapper chung.
- Không để frontend biết tên cột DB.
- ID từ DB là integer; API hiện có 2 kiểu:
  - Task cá nhân và luyện đề trả `number`.
  - Project/project task/PIC hiện nhiều nơi trả `string`.
  Khi thêm endpoint mới trong cùng domain, giữ đúng kiểu ID đang dùng của domain đó để tránh vỡ UI.
- Date-only dùng chuỗi `YYYY-MM-DD`.
- Time-only dùng chuỗi `HH:mm`.
- Timestamp dùng `new Date().toISOString()`.
- Boolean trong DB lưu `INTEGER 0/1`; API trả boolean thật.
- JSON trong DB chỉ dùng cho dữ liệu phụ có schema nhỏ và ổn định, ví dụ `task_links`, `cau_hinh_json`, mindmap `data`.

## 3. Rule Frontend

- Mỗi module lớn nên tự chứa type UI, state, parser và helper nhỏ của mình nếu chưa có layer shared ổn định.
- Dùng helper `api<T>()` để gọi API:
  - Set `Content-Type: application/json` khi gửi JSON.
  - Nếu `res.ok === false`, đọc `{ message, code }` từ backend và throw Error có `status/code`.
  - Không swallow lỗi lưu dữ liệu; chỉ swallow lỗi non-critical như load danh mục phụ nếu UI vẫn chạy được.
- State frontend lưu theo contract API, không lưu raw DB row.
- Validate nhanh ở UI để trải nghiệm tốt, nhưng backend vẫn là nguồn validate bắt buộc.
- Sau thao tác ghi dữ liệu:
  - Nếu API trả entity mới/cập nhật, cập nhật state bằng response đó.
  - Nếu API trả `{ ok: true }`, reload lại danh sách liên quan hoặc cập nhật state cục bộ thật rõ.
- Với thao tác nguy hiểm như xóa, close, overwrite/import:
  - Có xác nhận ở UI.
  - Backend vẫn kiểm tra điều kiện nghiệp vụ.
- Dùng `lucide-react` cho icon action; tránh tự vẽ icon SVG nếu đã có icon phù hợp.
- Text hiển thị nên đi qua `i18n.ts` khi thuộc màn chính đa ngôn ngữ; text module riêng có thể giữ local nhưng nên gom lại khi phát sinh lặp.
- Không thêm UI landing/marketing; màn đầu là công cụ đang dùng.
- Không để component lớn phình thêm nếu feature có domain riêng. Ưu tiên tách file như cách `luyen-de.tsx` và `mind-map.tsx` đang làm.

## 4. Rule Backend

- Mỗi domain có route riêng trong `server/routes/*` và được mount trong `server/index.ts` qua `app.use('/api', router)`.
- Route path dùng danh từ/domain rõ ràng:
  - `/tasks`
  - `/projects/:projectId/tasks`
  - `/de-thi/ky-thi`
  - `/weeks/:weekStart/goals`
- Dùng HTTP method theo ý nghĩa:
  - `GET`: đọc.
  - `POST`: tạo hoặc action nghiệp vụ tạo kết quả mới.
  - `PATCH`: cập nhật một phần hoặc action đổi trạng thái.
  - `PUT`: thay thế toàn bộ resource con, ví dụ assignments.
  - `DELETE`: xóa.
- Validate tất cả input ở backend trước khi ghi DB:
  - ID phải là integer.
  - Date dùng `isDateInput`.
  - Time dùng `isTimeInput` hoặc regex `HH:mm`.
  - Range ngày dùng `isDateRangeValid`.
  - Enum dùng danh sách hợp lệ trong `server/types.ts`.
- Luôn trim text người dùng nhập trước khi lưu; text optional lưu `''` hoặc `null` theo schema hiện tại của domain.
- Dùng prepared statement với `?`; không nối trực tiếp input user vào SQL.
- SQL động chỉ được dùng cho phần kiểm soát nội bộ như placeholder `?,?,?` từ mảng ID đã validate.
- Route trả lỗi có chủ đích bằng status phù hợp:
  - `400`: input sai.
  - `404`: không tìm thấy resource.
  - `409`: conflict cần người dùng xác nhận hoặc xử lý tiếp.
  - `500`: lỗi ngoài dự kiến, không trả stack/SQL.
- Với route có `try/catch`, dùng `HttpError` và `sendRouteError`.
- Với thao tác nhiều bước, dùng `withTransaction`.
- Sau thay đổi ảnh hưởng rollup hoặc dữ liệu suy ra, gọi lại hàm tính toán domain, ví dụ `recalculateProjectTaskRollups(projectId)`.
- Không log dữ liệu nhạy cảm như API key, secret, token.

## 5. Rule Database

- Schema và migration đặt trong `server/db.ts`.
- Khi thêm bảng mới:
  - Tạo bằng `CREATE TABLE IF NOT EXISTS`.
  - Có `id INTEGER PRIMARY KEY AUTOINCREMENT` nếu là entity thường.
  - Có `created_at`, `updated_at` nếu entity được chỉnh sửa bởi user.
  - Có `sort_order` nếu UI có reorder hoặc cần thứ tự ổn định.
  - Tạo index cho foreign key hoặc truy vấn thường dùng.
- Khi thêm cột:
  - Kiểm tra `PRAGMA table_info` trước.
  - Dùng `ALTER TABLE ... ADD COLUMN` với default an toàn nếu `NOT NULL`.
  - Không assume DB runtime đã giống DB source.
- Khi cần đổi constraint hoặc drop cột:
  - Tạo bảng mới.
  - Copy dữ liệu.
  - Drop bảng cũ.
  - Rename bảng mới.
  - Tạo lại index nếu cần.
- Foreign key phải bật qua `PRAGMA foreign_keys = ON`.
- WAL được bật qua `PRAGMA journal_mode = WAL`; khi backup nên dùng `VACUUM INTO` để gom dữ liệu nhất quán.
- Không sửa trực tiếp DB runtime nếu chưa backup khi thao tác bulk/update hàng loạt.
- DB runtime chuẩn là `%APPDATA%\TaskManager\data\tasks.sqlite`; `data/tasks.sqlite` trong repo chỉ là dữ liệu dev/cũ và có thể không đầy đủ.
- Tránh lưu dữ liệu dịch/hiển thị sai cột. Với luyện đề:
  - `noi_dung_en`, `giai_thich_en` là nội dung gốc/import chính.
  - `noi_dung_vi`, `giai_thich_vi` là bản dịch/chỉnh sửa tiếng Việt.
  - Nếu dữ liệu lịch sử đã nhập tiếng Việt vào cột `_en`, cần ghi chú migration hoặc script sửa rõ ràng.

## 6. Rule API Response

- Response thành công nên là:
  - Entity/entity list đã map camelCase.
  - `{ ok: true }` cho action không cần trả entity.
  - `{ updated: true }`, `{ deleted }`, hoặc object nhỏ nếu UI cần số lượng.
- Response lỗi nên là JSON:
  - `{ message: string }`
  - `{ message: string, code: string }` nếu UI cần xử lý flow đặc biệt.
  - Có thể thêm `details` cho conflict có dữ liệu phụ, như `GOAL_CONFLICT`.
- Không trả raw SQLite row ra frontend.
- Không trả stack trace, SQL raw, path secret hoặc API key.
- Danh sách có thứ tự phải ORDER BY ổn định, thường là `sort_order ASC, id ASC/DESC` theo domain.
- API import/export phải ghi rõ shape dữ liệu; tránh chấp nhận nhiều format trong cùng endpoint nếu có thể tách route.

## 7. Rule nghiệp vụ quan trọng hiện có

- Project hệ thống `"Khác"`:
  - Không được xóa.
  - Không được close.
  - Chỉ hỗ trợ task level 1.
- Project task:
  - Tối đa 3 level.
  - Parent task lấy ngày/estimate/progress từ task con.
  - Task lá có thể có assignments theo giai đoạn.
  - Assignments suy ra start/end/estimate/assignee của task lá, nhưng không suy ra progress.
- Weekly goals:
  - Khi đổi ngày task làm mất overlap với tuần goal hiện tại/tương lai, API trả `409 GOAL_CONFLICT` nếu chưa xác nhận.
- Release templates:
  - Token phải nằm trong danh sách hợp lệ.
  - Nội dung cần sanitize các dòng ticket không còn dùng.
- Task links:
  - Tối đa 4 link.
  - Type nằm trong `validTaskLinkTypes`.
  - URL chỉ cho scheme hợp lệ: `http`, `https`, `slack`, `zoommtg`, `file`, `vscode`.
- Luyện đề:
  - Một câu hỏi là `single` hoặc `multi`.
  - Rút câu ưu tiên `lan_ra` thấp nhất rồi random trong cùng mức.
  - Import phải chống trùng `file_name` trong cùng kỳ thi.

## 8. Quy trình thêm feature mới

1. Xác định domain: dùng route/file hiện có hay tạo route module mới.
2. Thiết kế DB:
   - Bảng/cột snake_case.
   - Migration trong `server/db.ts`.
   - Index cho truy vấn chính.
3. Thiết kế API contract:
   - Path/method/status.
   - Request body camelCase.
   - Response camelCase.
   - Error `{ message, code? }`.
4. Thêm type backend trong `server/types.ts` nếu body/enum dùng lại.
5. Thêm mapper backend nếu response là entity.
6. Viết route:
   - Validate.
   - Prepared SQL.
   - Transaction nếu nhiều bước.
   - Map response.
7. Thêm/điều chỉnh frontend:
   - Type UI khớp response.
   - Gọi qua `api<T>()`.
   - Loading/error state rõ.
   - Toast sau thao tác.
8. Chạy build:
   - `npm run build`
9. Nếu sửa DB runtime hoặc migration lớn:
   - Backup trước.
   - Test bằng DB runtime thật nếu feature phụ thuộc dữ liệu thật.

## 9. Điểm nên chuẩn hóa dần

- Tách type API shared để giảm lặp giữa `server/types.ts`, `src/main.tsx`, `src/luyen-de.tsx`, `src/mind-map.tsx`.
- Tách `api<T>()` thành helper frontend chung thay vì mỗi module có một bản.
- Tách `src/main.tsx` thành nhiều module nhỏ hơn theo domain: personal tasks, projects, weekly report, schedules, settings.
- Chuẩn hóa kiểu ID giữa các domain nếu có cơ hội refactor lớn. Hiện nên giữ nguyên theo từng domain để tránh vỡ UI.
- Chuẩn hóa encoding comment/source nếu thấy file hiển thị mojibake; tránh chỉnh hàng loạt chung với feature logic.
- Với luyện đề, cần migration/script riêng để đưa nội dung tiếng Việt đang nằm trong cột `_en` về đúng cột `_vi` nếu muốn dữ liệu song ngữ sạch hoàn toàn.

## 10. Checklist review nhanh

- DB có migration an toàn và không phụ thuộc DB source cũ?
- API đã validate input và trả lỗi JSON chuẩn?
- SQL có dùng prepared statement?
- Ghi nhiều bảng có transaction?
- Response đã map camelCase?
- Frontend không dùng raw DB field?
- UI có loading/error/empty state hợp lý?
- Có reload hoặc cập nhật state sau khi ghi?
- Có backup nếu thao tác trực tiếp DB runtime?
- `npm run build` chạy qua?
