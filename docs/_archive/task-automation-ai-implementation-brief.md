# Task Automation: AI Implementation Brief

> 🗄️ **HẾT HIỆU LỰC — 2026-08-01.** Brief bàn giao cho vòng hiện thực đầu tiên; việc đã làm xong.
> Mô tả "điều phối Claude Desktop qua MCP" **không còn đúng** — app hiện gọi Claude Code headless từ backend.
>
> **Thay bằng:** [../specs/03-api-business-logic-spec.md](../specs/03-api-business-logic-spec.md) ·
> [../operations/automation-ai-go-live-guide.md](../operations/automation-ai-go-live-guide.md).
> Giữ lại làm **lịch sử**.

Tài liệu này là artifact bàn giao cho AI/developer lần sau. Mục tiêu là thiết kế cơ chế để Task Manager nhắc và điều phối Claude Desktop thực hiện một số công việc trong ngày qua MCP, nhưng vẫn giữ nguyên tắc: mọi hành động ghi ra ngoài phải có preview và được user approve.

## 1. Mục Tiêu

Task Manager cần hỗ trợ automation cho task trong ngày:

- `none`: task thường, không cần AI xử lý.
- `post`: AI hỗ trợ đăng bài Dr.JOY.
- `other`: AI hỗ trợ các việc khác qua MCP/connector, ví dụ Google Drive, Gmail, tài liệu nội bộ.

Claude Desktop đã có MCP/connector tới:

- Task Manager local.
- Google Drive.
- Dr.JOY app của công ty.

Thiết kế mong muốn:

- Task Manager canh giờ task.
- Trước giờ bắt đầu khoảng 5 phút, Task Manager phát hiện task cần AI xử lý.
- User được xem preview/kế hoạch.
- Claude chỉ thực hiện khi user approve.
- Nếu thiếu thông tin hoặc có điểm mù mờ, Claude phải hỏi lại, không tự đoán.
- Sau khi thực hiện, Claude báo kết quả ngắn gọn và Task Manager nên lưu log/trạng thái.

## 2. Nguyên Tắc An Toàn Bắt Buộc

Không được để AI tự ý ghi/post/sửa/xóa nếu user chưa đồng ý rõ ràng.

Hành động cần approve gồm:

- Post bài Dr.JOY.
- Reply vào bài Dr.JOY.
- Mention/to user/group trên Dr.JOY.
- Tạo/sửa/xóa file Google Drive.
- Gửi mail/chat.
- Đổi trạng thái task nếu user chưa yêu cầu trực tiếp.
- Bất kỳ thao tác nào tạo thay đổi ở hệ thống ngoài.

Claude phải luôn:

1. Show preview rõ ràng.
2. Ghi rõ đích đến: group/file/folder/article/task.
3. Ghi rõ hành động: post mới/reply/sửa file/tạo file/cập nhật status.
4. Hiển thị toàn văn nội dung sẽ ghi nếu có.
5. Hỏi xác nhận.
6. Chỉ thực hiện sau khi user approve.

Với task `post`, nội dung post mặc định phải lấy nguyên văn từ `note`, không tự ý thêm/bớt/sửa format.

## 3. Kiến Trúc Đề Xuất

Không coi Claude Desktop là scheduler chính. Claude Desktop không phải daemon chạy nền đáng tin cậy.

Thiết kế nên chia 3 lớp:

### 3.1 Task Manager

Task Manager là nơi lưu dữ liệu và canh giờ.

Trách nhiệm:

- Lưu task và metadata automation.
- Check task hôm nay.
- Phát hiện task `post`/`other` sắp tới giờ.
- Hiển thị popup cho user.
- Sinh prompt chuẩn cho Claude.
- Copy prompt vào clipboard hoặc mở Claude Desktop nếu có cách ổn định.
- Lưu trạng thái/log automation.

### 3.2 Claude Desktop

Claude là executor thông minh.

Trách nhiệm:

- Đọc task qua Task Manager MCP.
- Check connector cần dùng.
- Phân tích task.
- Hỏi lại nếu thiếu thông tin.
- Preview hành động ghi.
- Sau khi user approve, gọi connector Dr.JOY/Drive để thực hiện.
- Báo kết quả.

### 3.3 MCP/Connectors

MCP là lớp giao tiếp.

Hiện có:

- Task Manager MCP: đọc/tạo/cập nhật task.
- Google Drive connector.
- Dr.JOY connector.

Lưu ý: nếu connector không kết nối được, Claude phải báo user cấu hình lại connector, không tự lách bằng cách khác.

## 4. Data Model Đề Xuất

Các field chính nên có trên task thường và task definition/release nếu cần sinh task định kỳ.

```ts
type ActionType = 'none' | 'post' | 'other';

type AutomationStatus =
  | 'idle'
  | 'scheduled'
  | 'needs_review'
  | 'approved'
  | 'running'
  | 'done'
  | 'failed'
  | 'canceled';
```

Field đề xuất:

- `actionType`: `none | post | other`.
- `aiNote`: hướng dẫn AI.
- `relatedIds`: task liên quan để Claude đọc thêm ngữ cảnh.
- `automationStatus`: trạng thái automation.
- `automationReminderAt`: thời điểm đã nhắc.
- `automationApprovedAt`: thời điểm user approve.
- `automationExecutedAt`: thời điểm đã chạy.
- `automationResult`: kết quả ngắn gọn.
- `automationError`: lỗi nếu thất bại.

Với `post`, nên có thêm metadata rõ ràng để giảm đoán:

- `targetType`: ví dụ `drjoy`.
- `drjoyGroupId`.
- `drjoyGroupName`.
- `drjoyArticleId`: nếu reply.
- `drjoyMode`: `new_post | reply`.
- `mentions`: danh sách user/group cần to/mention nếu có.

Nếu chưa có metadata riêng, Claude có thể suy từ `aiNote`, `note`, `links`, title, nhưng khi không chắc phải hỏi.

## 5. Luồng Tổng Quát

### 5.1 Scheduler Trong Task Manager

Mỗi 30s hoặc 60s khi app đang mở:

1. Lấy task hôm nay.
2. Bỏ qua task `actionType = none`.
3. Với task `post`/`other`:
   - Nếu còn khoảng 5 phút tới `startTime`, tạo automation prompt.
   - Nếu đã quá giờ nhưng chưa nhắc/chưa xử lý, đưa vào nhóm catch-up.
4. Hiện popup cho user.
5. Cho user chọn:
   - Mở/copy prompt sang Claude.
   - Hủy task automation lần này.
   - Nhắc lại sau.

### 5.2 Prompt Sang Claude

Prompt cần chứa:

- Task id.
- Title.
- Start/end time.
- `actionType`.
- `note`.
- `aiNote`.
- Links.
- Related tasks.
- Quy tắc approve bắt buộc.
- Yêu cầu không suy đoán khi thiếu thông tin.

Prompt nên yêu cầu Claude:

1. Gọi Task Manager MCP để đọc lại task mới nhất theo id/ngày.
2. Xác định loại việc.
3. Check connector cần dùng.
4. Tạo plan/preview.
5. Hỏi user xác nhận.
6. Sau khi user xác nhận, thực hiện.
7. Báo kết quả.

## 6. Luồng `post` Dr.JOY

Điều kiện:

- `actionType = post`.
- Nội dung post ưu tiên lấy từ `note`.
- Nếu `note` trống, hỏi user nhập nội dung.

Luồng:

1. Claude check connector Dr.JOY có dùng được không.
2. Nếu không dùng được:
   - Báo user cấu hình connector.
   - Sau khi user báo đã cấu hình, Claude verify lại.
3. Claude xác định:
   - Group nào.
   - Post mới hay reply.
   - Nếu reply thì article/thread nào.
   - To/mention ai.
4. Nếu thiếu hoặc mơ hồ:
   - Hỏi user.
   - Không post.
5. Claude show preview:
   - Group name/id.
   - Mode: post mới/reply.
   - Article id nếu reply.
   - Mentions.
   - Toàn văn nội dung post.
6. Claude hỏi: "Xác nhận đăng?"
7. Nếu user approve:
   - Claude gọi đúng tool Dr.JOY.
   - Báo thành công/thất bại.
   - Nếu có link bài viết, báo link.
8. Nếu user không approve:
   - Hủy tiến trình.

Nếu user đã approve trước giờ task, nhưng tới giờ Claude/session không còn hoạt động, Task Manager không nên giả định là đã post. Cần giữ trạng thái `approved` hoặc `needs_run` và nhắc lại/catch-up khi app/Claude hoạt động.

## 7. Luồng `other`

Điều kiện:

- `actionType = other`.
- `aiNote` mô tả việc AI cần làm.

Luồng:

1. Claude đọc `aiNote`, task, related tasks.
2. Claude xác định connector cần dùng, ví dụ Google Drive.
3. Claude check connector có dùng được không.
4. Nếu không dùng được:
   - Báo user cấu hình connector.
   - Verify lại sau khi user báo đã cấu hình.
5. Claude phân tích có thể làm đủ yêu cầu không.
6. Nếu không đủ:
   - Báo rõ thiếu gì/không chắc gì.
   - Hỏi user chỉ thị.
7. Nếu có hành động ghi:
   - Show preview/plan.
   - Với file Drive: ghi rõ folder/file, tên file, nội dung sẽ tạo/sửa, vùng thay đổi nếu có.
   - Hỏi xác nhận.
8. Sau khi user approve:
   - Thực hiện.
   - Báo kết quả ngắn gọn, kèm link nếu có.

Lưu ý: không được "có thể làm là tự làm" nếu hành động có ghi ra ngoài. Chỉ đọc/search/list thì có thể làm trước mà không cần approve.

## 8. Prompt Template Đề Xuất

### 8.1 Prompt Cho Task `post`

```text
Bạn đang xử lý task automation từ Task Manager.

Task:
- ID: {{taskId}}
- Title: {{title}}
- Time: {{startTime}} - {{endTime}}
- Action type: post
- Note/content, phải giữ nguyên văn nếu đăng:
---
{{note}}
---
- AI instruction:
{{aiNote}}
- Links:
{{links}}
- Related tasks:
{{relatedTasks}}

Yêu cầu:
1. Gọi Task Manager MCP để đọc lại task mới nhất nếu cần.
2. Check connector Dr.JOY.
3. Xác định group, mode post mới/reply, article id nếu reply, mention/to nếu có.
4. Nếu thiếu hoặc mơ hồ, hỏi user. Không suy đoán.
5. Trước khi post, show preview gồm đích đến, mode, mention/to và toàn văn nội dung.
6. Hỏi user "Xác nhận đăng?".
7. Chỉ gọi tool Dr.JOY sau khi user xác nhận.
8. Xong báo kết quả ngắn gọn, kèm link nếu có. Nếu lỗi, báo rõ lỗi.
```

### 8.2 Prompt Cho Task `other`

```text
Bạn đang xử lý task automation từ Task Manager.

Task:
- ID: {{taskId}}
- Title: {{title}}
- Time: {{startTime}} - {{endTime}}
- Action type: other
- Note:
{{note}}
- AI instruction:
{{aiNote}}
- Links:
{{links}}
- Related tasks:
{{relatedTasks}}

Yêu cầu:
1. Gọi Task Manager MCP để đọc lại task mới nhất nếu cần.
2. Xác định connector cần dùng, ví dụ Google Drive.
3. Check connector có hoạt động không.
4. Nếu thiếu quyền/kết nối, báo user cấu hình rồi verify lại.
5. Phân tích có thể làm đủ yêu cầu không. Nếu không chắc, hỏi user.
6. Nếu cần ghi/tạo/sửa/xóa/gửi ở hệ thống ngoài, show preview/plan và hỏi xác nhận trước.
7. Chỉ thực hiện hành động ghi sau khi user xác nhận.
8. Xong báo kết quả ngắn gọn, kèm link nếu có. Nếu lỗi, báo rõ lỗi.
```

## 9. MVP Đề Xuất

Không làm full auto ngay. Làm theo từng giai đoạn.

### Phase 1: Reminder + Prompt

- Thêm/làm rõ field `actionType`, `aiNote`, `relatedIds`.
- Scheduler trong Task Manager check task hôm nay.
- Trước giờ 5 phút, hiện popup.
- Popup có nút copy prompt cho Claude.
- Claude xử lý thủ công theo prompt.
- Mọi action ghi vẫn approve trong Claude chat.

Độ phức tạp: thấp đến trung bình.

### Phase 2: Automation State + Log

- Lưu `automationStatus`.
- Lưu lịch sử nhắc/approve/chạy/lỗi.
- Có catch-up cho task quá giờ.
- Có màn hình xem task automation pending/failed.

Độ phức tạp: trung bình.

### Phase 3: Approve Trước, Chạy Sau

- User approve kế hoạch trước giờ.
- Tới giờ Task Manager nhắc/chuyển prompt chạy.
- Vẫn phải đảm bảo Claude/session/connector sẵn sàng.
- Nếu không sẵn sàng, không tự coi là đã chạy; lưu failed/pending và nhắc lại.

Độ phức tạp: khá cao.

### Phase 4: Local Daemon Riêng Nếu Cần Full Background

Nếu thật sự cần tự chạy nền ổn định không phụ thuộc browser/app đang mở, cân nhắc local daemon/service riêng.

Daemon có thể:

- Canh giờ độc lập.
- Gọi API Task Manager.
- Mở notification.
- Không nên tự gọi action ghi nếu không có approve rõ ràng.

Độ phức tạp: cao.

## 10. Checklist Cho AI Khi Bắt Đầu Code

Trước khi code:

- Đọc `server/mcp.ts` để hiểu tool hiện tại.
- Đọc `server/db.ts`, `server/types.ts`, `server/lib/mappers.ts`.
- Đọc `server/routes/tasks.ts` và `server/routes/release.ts`.
- Đọc phần scheduler hiện có trong `src/main.tsx`.
- Đọc `docs/drjoy-auto-post-design.md`.
- Đọc `docs/ai-daily-playbook.md`.

Khi code:

- Giữ thay đổi nhỏ theo phase.
- Không làm full automation ngay nếu user chưa chốt.
- Không hard-code path local Claude Desktop.
- Không commit config local.
- Không tạo cơ chế tự post/sửa file không cần approve.
- Sau mỗi phase chạy `npm run build`.

## 11. Open Questions Cần User Chốt

1. Task `post` lấy group từ đâu là nguồn chính: link Dr.JOY, field riêng, title, hay `aiNote`?
2. Có cần lưu `drjoyGroupId`, `articleId`, `mentions` thành field riêng không?
3. User muốn approve ngay trong Task Manager hay trong Claude chat?
4. Nếu approve trong Task Manager, Claude có cách nào nhận và chạy ổn định tại đúng giờ không?
5. Với `other`, phạm vi ban đầu chỉ Google Drive hay mở rộng Gmail/Redmine/các connector khác?
6. Có cần lưu log kết quả vào task không?
7. Nếu task quá giờ và chưa xử lý, nên nhắc lại bao nhiêu lần?
8. Nếu connector lỗi, task chuyển `failed` hay `needs_review`?

## 12. Kết Luận Thiết Kế

Ý tưởng khả thi nếu Task Manager giữ vai trò scheduler và Claude Desktop giữ vai trò executor qua MCP.

Không nên kỳ vọng Claude Desktop tự chạy nền như service. MVP nên bắt đầu bằng: Task Manager nhắc trước giờ, sinh prompt chuẩn, user mở/copy sang Claude, Claude preview và xin approve trước khi thực hiện.

Nguyên tắc quan trọng nhất: AI được hỗ trợ tối đa, nhưng không được tự ý ghi/post/sửa/xóa nếu user chưa approve rõ ràng.
