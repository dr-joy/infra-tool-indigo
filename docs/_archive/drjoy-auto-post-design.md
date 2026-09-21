# Thiết kế: Task có hành động AI (post Dr.JOY / thao tác khác) — có duyệt

> 🗄️ **HẾT HIỆU LỰC — 2026-08-01.** Tài liệu này tự ghi *"SPEC — chưa code"*, nhưng chức năng **đã được
> hiện thực** (`server/routes/automation.ts`, `server/lib/claude-runner.ts`, `src/useAutomation.ts`).
> Nội dung bên dưới **không còn phản ánh hệ thống thật** — đặc biệt phần "sinh prompt cho người dán tay":
> app hiện tự gọi Claude Code headless (`claude -p`) từ backend.
>
> **Thay bằng:** [../specs/03-api-business-logic-spec.md](../specs/03-api-business-logic-spec.md) (hợp đồng API) ·
> [../specs/04-database-design.md](../specs/04-database-design.md) (cột `action_type`/`ai_note`) ·
> [../operations/automation-ai-go-live-guide.md](../operations/automation-ai-go-live-guide.md) (cách bật).
> Giữ lại làm **lịch sử quyết định thiết kế**.

> Trạng thái: **SPEC — chưa code.** Tài liệu để triển khai sau.
> Nguyên tắc cốt lõi: với mọi hành động GHI ra ngoài (post bài, tạo/sửa file Drive...), **Claude phải show preview + XIN DUYỆT, chỉ làm sau khi người đồng ý.**

## 0. Tóm tắt thay đổi so với bản đầu
1. `action_type` **3 loại**: `none` | `post` | `other`.
2. Thêm trường **`ai_note`** = mô tả công việc cho AI (dùng chính cho `other`), có cả ở **task thường** lẫn **định nghĩa release (định kỳ + khẩn cấp)**.
3. Task **đính quan hệ theo ID** (`related_ids`) để AI hiểu task này liên quan task nào.

## 1. Mục tiêu & luồng

Một số task tới giờ cần AI làm hộ, 2 nhóm chính:

- **`post`** — lấy nguyên văn `note` đăng lên group Dr.JOY (VD "Master - End - 研究開発部").
- **`other`** — việc tự do mô tả trong `ai_note`, ví dụ tạo/sửa file trên **Google Drive** (đã có Google Drive MCP), soạn nội dung, tổng hợp... AI đọc `ai_note` (+ các task liên quan) rồi thực hiện.

Luồng chung (cả post lẫn other):
```
[task-manager app]  --tới giờ / khi mở app-->  popup + copy prompt vào clipboard
        │
        ▼
[bạn]  dán prompt vào Claude Desktop, gửi
        │
        ▼
[Claude Desktop + MCP phù hợp]  hiểu việc → PREVIEW → XIN DUYỆT → (bạn OK) → thực hiện
```
Post Dr.JOY diễn ra trong Desktop (nơi có Dr.JOY MCP). `other`/Drive cũng làm trong Desktop; riêng Google Drive connector còn có sẵn cho cả routine cloud (khác Dr.JOY) — mở đường tự động hơn sau này.

## 2. `action_type` (3 loại)

- `none` (mặc định) — task thường, app không auto gì.
- `post` — đăng `note` lên group Dr.JOY (chi tiết mục 4).
- `other` — AI làm theo `ai_note` (chi tiết mục 5). Mở rộng mọi thao tác qua MCP (Drive, Gmail, Redmine...).

## 3. Các trường mới

Áp cho **3 nơi**: bảng `tasks`, `release_task_definitions`, `emergency_release_task_definitions`.

| Trường (DB) | API | Kiểu | Ý nghĩa |
|---|---|---|---|
| `action_type` | `actionType` | TEXT default `none` | `none`\|`post`\|`other` |
| `ai_note` | `aiNote` | TEXT default `''` | Mô tả công việc cho AI (chủ yếu cho `other`) |
| `related_ids` | `relatedIds` | TEXT (JSON array) default `[]` | ID các task/định nghĩa liên quan |

### 3.1 Lưu ý ID quan hệ (`related_ids`)
- Bảng `tasks`: id là **INTEGER** → `related_ids` = mảng số `[912, 919]`.
- `release_task_definitions` / `emergency_release_task_definitions`: id là **TEXT** → `related_ids` = mảng chuỗi `["def-abc","def-xyz"]`.
- Khi sinh task thật từ definition: copy `action_type`, `ai_note` sang task; `related_ids` (text def-id) cần **map sang task-id** của các task cùng đợt sinh ra (nếu muốn quan hệ ở mức task chạy). → xem open question #5.
- AI dùng `related_ids` để đọc thêm ngữ cảnh: "task này phụ thuộc/nối tiếp task nào".

## 4. Type `post` — suy info (không cần thêm gì vào note)

| Cần | Nguồn |
|---|---|
| **Body** | `note` nguyên văn |
| **Group** | `groupId` trong link chat Dr.JOY nếu có; không thì tên group = đuôi title sau ` - ` |
| **Mode** | link chat có `articleId` → `reply`; không → `new` |
| **Reply target** | `articleId` trong link |

Link chat dạng:
```
https://app.drjoy.jp/gr/copy?...&groupId=-NF7GH418toYu58i2I5R&articleId=-OvnHC1vi48q8xt2zV5o
```
Parse query `groupId`, `articleId`.

## 5. Type `other` — AI làm theo mô tả

- App copy prompt gồm: `ai_note` (chỉ thị chính) + tóm tắt task (title, note, links) + nội dung các task trong `related_ids`.
- Claude hiểu việc, chọn MCP phù hợp (Google Drive để tạo/sửa file, v.v.).
- **Mọi thao tác GHI (tạo/sửa/xóa file, gửi mail...) phải preview + xin duyệt trước.** Chỉ đọc thì không bắt buộc duyệt.

## 6. UI

### 6.1 Task thường — [src/main.tsx](../src/main.tsx) `PopupTaoTask` + form sửa
- `<select>` "Loại thao tác": None / Post Dr.JOY / Other.
- Ô textarea **"Mô tả cho AI"** (`aiNote`) — hiện khi chọn `other` (hoặc luôn hiện, tùy).
- Ô chọn **task liên quan** (`relatedIds`) — multi-select từ danh sách task.

### 6.2 Quản lý release (định kỳ + khẩn cấp)
Trong màn quản lý **release_task_definitions** và **emergency_release_task_definitions** (phần thêm/sửa 1 định nghĩa task release), thêm đúng 3 trường trên: `actionType`, `aiNote`, `relatedIds`. Đây là chỗ user yêu cầu rõ "mỗi task release thêm mô tả công việc cho AI".

## 7. DB / API / Mapper

### 7.1 DB — [server/db.ts](../server/db.ts)
Thêm cột vào CREATE TABLE (cho DB mới) của cả 3 bảng, và migration theo pattern dòng ~380:
```ts
// tasks
if (!taskColumns.some(c=>c.name==='action_type')) db.exec("ALTER TABLE tasks ADD COLUMN action_type TEXT NOT NULL DEFAULT 'none'");
if (!taskColumns.some(c=>c.name==='ai_note'))     db.exec("ALTER TABLE tasks ADD COLUMN ai_note TEXT NOT NULL DEFAULT ''");
if (!taskColumns.some(c=>c.name==='related_ids')) db.exec("ALTER TABLE tasks ADD COLUMN related_ids TEXT NOT NULL DEFAULT '[]'");
// tương tự cho release_task_definitions & emergency_release_task_definitions
```

### 7.2 Types — [server/types.ts](../server/types.ts)
```ts
export type ActionType = 'none' | 'post' | 'other';
// thêm actionType?, aiNote?, relatedIds? vào:
//  TaoTaskBody, CapNhatTaskBody, ReleaseTaskDefinitionBody, EmergencyReleaseTaskDefinitionBody
```

### 7.3 Mapper — [server/lib/mappers.ts](../server/lib/mappers.ts)
`mapTask` (và mapper của 2 loại definition) trả thêm:
```ts
actionType: (row.action_type as string) || 'none',
aiNote: String(row.ai_note || ''),
relatedIds: JSON.parse(String(row.related_ids || '[]')),
```

### 7.4 Routes
- [server/routes/tasks.ts](../server/routes/tasks.ts): POST (~58) + PATCH (~131) nhận 3 trường (validate `action_type` ∈ enum).
- [server/routes/release.ts](../server/routes/release.ts): INSERT/UPDATE của `release_task_definitions` (~184/201) và `emergency_release_task_definitions` (~128/152) thêm 3 cột.

## 8. Scheduler (tái dùng cái có sẵn)

Mở rộng `checkUpcomingRecurringTasks` (30s interval, [src/main.tsx:1443](../src/main.tsx#L1443)):
1. Với task `actionType ∈ {post, other}` tới giờ `gioBatDau`:
   - `post` → dựng `postPlan` (mục 4) → prompt post.
   - `other` → prompt gồm `aiNote` + task + related tasks.
2. `navigator.clipboard.writeText(prompt)` + modal "Đến giờ: <task>. Đã copy prompt, dán vào Claude Desktop."
3. Đánh dấu đã nhắc (giống `notifiedRecurringTaskRef`).
4. **Catch-up** khi load: task hôm nay quá giờ, chưa hoàn thành, chưa nhắc → liệt kê để dọn prompt.

Giới hạn: chỉ nhắc khi app/Desktop mở (mục cũ giữ nguyên).

## 9. Prompt bàn giao cho Claude

### 9.1 `post` (Dr.JOY)
```
Nhiệm vụ: đăng bài lên Dr.JOY từ nội dung task.
- Group: {{groupName|groupId}}   Kiểu: {{new|reply articleId=...}}
- Nội dung (ĐĂNG NGUYÊN VĂN):
---
{{note}}
---
BẮT BUỘC: (1) map group qua list-groups nếu cần, không chắc thì HỎI.
(2) chọn đúng tool Dr.JOY (đăng mới / reply).
(3) CHƯA POST — show preview (group+id, kiểu, toàn văn) rồi hỏi "Xác nhận đăng?".
(4) chỉ post sau khi tôi đồng ý. (5) xong báo link; lỗi thì báo rõ.
```

### 9.2 `other`
```
Nhiệm vụ (theo mô tả): {{aiNote}}

Bối cảnh task: {{title}} | note: {{note}} | links: {{links}}
Task liên quan (relatedIds):
{{với mỗi id: title + note tóm tắt}}

BẮT BUỘC: hiểu việc rồi làm. Nếu cần GHI ra ngoài (tạo/sửa/xóa file Drive,
gửi mail...) => show PREVIEW (làm gì, ở đâu, nội dung) và XIN DUYỆT trước;
chỉ thực hiện sau khi tôi đồng ý. Chỉ đọc thì không cần duyệt.
Xong báo kết quả (link file...). Lỗi/không đủ quyền => báo rõ, không tự ý cách khác.
```
Template gốc để ở `scripts/` (`drjoy-post-prompt.template.txt`, `ai-other-prompt.template.txt`), app thay `{{...}}`.

## 10. Open questions (chốt trước khi code)
1. Tên group ở title có khớp `list-groups` không? Không → bắt buộc gắn link chat có `groupId`.
2. Tên **tool ghi** Dr.JOY (post mới / reply)? (mở Desktop hỏi "liệt kê tool Dr.JOY MCP").
3. "Master - Start/End" post mới mỗi lần hay reply thread cố định?
4. Có lưu lịch sử "đã post/đã làm lúc nào, link gì" vào task không?
5. **Quan hệ `related_ids`**: giữ ở mức definition (text id) hay map sang task-id khi sinh task? Cần cả 2 hay chỉ mức task chạy?
6. `aiNote` chỉ hiện khi `other`, hay luôn hiện cho mọi type?
7. Với `other`/Drive: mức duyệt — duyệt từng file hay duyệt cả lô?

## 11. Phạm vi & giới hạn
- Không tự động 100%: hành động ghi ra ngoài luôn cần người duyệt (chủ ý an toàn).
- Nhắc chỉ chạy khi app/Desktop mở.
- Dr.JOY: mọi call trong Desktop. Google Drive: connector có sẵn rộng hơn (kể cả cloud routine) — có thể nâng cấp tự động hơn ở giai đoạn sau.

## 12. Checklist triển khai
- [ ] DB: 3 cột (`action_type`, `ai_note`, `related_ids`) × 3 bảng (tasks + 2 release def) + migration — [server/db.ts](../server/db.ts)
- [ ] Type `ActionType` + 4 body — [server/types.ts](../server/types.ts)
- [ ] Mapper trả 3 field (task + 2 definition) — [server/lib/mappers.ts](../server/lib/mappers.ts)
- [ ] Routes tasks POST/PATCH — [server/routes/tasks.ts](../server/routes/tasks.ts)
- [ ] Routes release INSERT/UPDATE (định kỳ + khẩn cấp) — [server/routes/release.ts](../server/routes/release.ts)
- [ ] UI task form: select action_type + aiNote + relatedIds — [src/main.tsx](../src/main.tsx) `PopupTaoTask`
- [ ] UI quản lý release (định kỳ + khẩn cấp): 3 trường
- [ ] Sinh task từ definition: copy action_type/ai_note (+ xử lý related_ids) — [server/routes/release.ts](../server/routes/release.ts)
- [ ] Parse link Dr.JOY (groupId/articleId)
- [ ] Mở rộng `checkUpcomingRecurringTasks` + modal + clipboard — [src/main.tsx:1443](../src/main.tsx#L1443)
- [ ] Catch-up khi load
- [ ] Template prompt (`post`, `other`) trong `scripts/`
- [ ] (Ngoài code) tên tool ghi Dr.JOY + xác nhận map tên group
