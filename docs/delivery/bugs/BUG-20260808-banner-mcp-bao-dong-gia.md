# BUG-20260808-banner-mcp-bao-dong-gia — Banner "Dr.JOY chưa xác thực" luôn hiện dù Dr.JOY đang chạy tốt

| Trường | Giá trị |
|---|---|
| Ngày phát hiện | 2026-08-08 |
| Người phát hiện | Claude (lúc cài đặt môi trường thật cho Leader chạy thử task đầu tiên) |
| Mức nghiêm trọng | ☑ Khó chịu (không chặn chức năng, nhưng làm mất niềm tin vào cảnh báo) |
| **Sinh ra bởi** | ☑ Có sẵn từ trước — endpoint viết cho thời Dr.JOY còn là MCP server cấu hình local; hỏng dần khi connector chuyển sang cấp tài khoản claude.ai |
| **Cổng lẽ ra phải bắt** | ☑ ⑥ Cổng hạ tầng |
| **Loại nguyên nhân** | ☑ RC-INTEG (giả định về hệ thống ngoài đã đổi mà không ai kiểm lại) |
| Trạng thái | ☑ Đã sửa |
| Test tái hiện | `test/unit/mcp-auth.test.ts::BUG-20260808: mcpOAuth RỖNG + cache còn khoá `drjoy` cũ -> KHÔNG được báo cần auth` |

## 1. Triệu chứng

Ngay khi bật automation (`CLAUDE_BIN` được cấu hình), app hiện banner vàng ở đầu màn hình:

> ⚠ Dr.JOY (automation AI) chưa xác thực. Chạy `claude` → `/mcp` → chọn **drjoy** → Authenticate.
> Task AI sẽ không chạy tới khi auth.

Trong khi thực tế Dr.JOY **đang chạy hoàn hảo**: cùng lúc đó đã đọc được 146 group và đăng thành công
một bài thật lên group 【チーム】Dev13.

Banner còn chỉ người dùng đi tìm một connector tên `drjoy` **không còn tồn tại** trong danh sách `/mcp`.

## 2. Tái hiện

1. Cấu hình `CLAUDE_BIN` rồi khởi động app (banner chỉ hiện khi `configured=true`).
2. Gọi `GET /api/automation/mcp-auth-status`.

- **Kỳ vọng:** không báo cần auth, vì Dr.JOY đang dùng được bình thường.
- **Thực tế:** `{"authed":false,"needsAuth":true,"hasToken":false,"flaggedNeedsAuth":true}` → banner hiện.

Điều kiện dữ liệu thật trên máy Leader (2026-08-08):

| File | Nội dung |
|---|---|
| `~/.claude/.credentials.json` | `mcpOAuth` **rỗng** (0 khoá) |
| `~/.claude/mcp-needs-auth-cache.json` | vẫn còn khoá `drjoy` sót từ cấu hình cũ |

## 3. Nguyên nhân gốc

- **Sai ở đâu (kỹ thuật):** endpoint suy ra trạng thái auth bằng cách tìm token trong
  `~/.claude/.credentials.json` với khoá `drjoy`. Công thức `needsAuth = !hasToken || …` biến
  **"không tìm thấy bản ghi nào"** thành **"chắc chắn chưa auth"**. Thêm nữa, `flaggedNeedsAuth` lấy từ
  `mcp-needs-auth-cache.json` — nơi còn khoá `drjoy` rác của cấu hình cũ — nên càng củng cố kết luận sai.

- **Vì sao lọt qua:** giả định nền đã đổi mà không ai kiểm lại. Khi viết, Dr.JOY là **MCP server cấu hình
  local tên `drjoy`**, token nằm đúng file đó. Nay nó là **connector cấp tài khoản claude.ai**
  (`claude.ai Dr.JOY MCP`), token do claude.ai giữ, file kia rỗng vĩnh viễn. Không có test nào cho endpoint
  này, và bản thân triệu chứng bị che: banner chỉ hiện khi `configured=true`, mà suốt thời gian qua env
  `CLAUDE_BIN` **chưa từng được set bền** (kiểm 2026-08-08: không có biến `CLAUDE*` nào ở cấp User lẫn
  Machine). Lỗi nằm im vì điều kiện hiển thị của nó chưa bao giờ đúng.

## 4. Cổng nào hụt & vì sao

| Cổng | Đáng lẽ phải bắt bằng cách nào | Vì sao không bắt được |
|---|---|---|
| ⑥ Cổng hạ tầng | Khi tích hợp với hệ thống ngoài, phải có ca kiểm "nguồn dữ liệu vắng mặt thì kết luận thế nào", và phải kiểm lại giả định mỗi khi cách kết nối đổi | Endpoint không có test nào. Suy luận nằm thẳng trong route, đọc file từ `os.homedir()` nên không kiểm được các tổ hợp trạng thái. Việc connector đổi từ local sang claude.ai không kéo theo lần rà nào |

## 5. Cách sửa

- **Test đỏ tái hiện (viết TRƯỚC khi sửa):** tách suy luận ra hàm thuần `server/lib/mcp-auth.ts`
  **giữ nguyên lỗi**, rồi viết `test/unit/mcp-auth.test.ts`. 2/8 ca đỏ đúng chỗ hỏng, 6 ca còn lại xanh —
  chứng minh tái hiện đúng bug chứ không phá luật cũ.
- **Sửa:** không có bản ghi OAuth nào ⇒ **không kết luận được** → trả `authed: null`, `needsAuth: false`,
  `khongXacDinh: true`. Chỉ báo động khi có **bằng chứng dương**: có bản ghi mà thiếu token, hoặc CLI đã
  flag mà không còn refresh token. `flaggedNeedsAuth` **một mình** không còn đủ để báo động. Nhân tiện nới
  cách dò khoá (chuẩn hoá rồi tìm chuỗi con `drjoy`) để nhận cả `drjoy`, `drjoy|<hash>` lẫn
  `claude.ai Dr.JOY MCP`.
- **Quét lân cận:** lệnh chạy lại được —
  `rg -in "drjoy|credentials\.json|mcp-needs-auth-cache" --glob '!docs/**'`.
  Kết quả: 2 chỗ cùng gốc lỗi, đã sửa cả hai —
  1. `src/main.tsx` banner chỉ user chọn server **`drjoy`** (tên không còn tồn tại) → đổi thành connector **Dr.JOY**;
  2. `server/routes/automation.ts` ví dụ env ghi `mcp__drjoy__create_article` → thay bằng giá trị THẬT đã
     kiểm chứng (`mcp__claude_ai_Dr_JOY_MCP__create-group-article`).
  Các chỗ còn lại (`drjoy_posted_articles`, URL `app.drjoy.jp`, fixture `mcp__drjoy__*` trong test) không
  liên quan tới tên MCP server, giữ nguyên.

**Xác minh trên dữ liệu thật:** chạy đúng đoạn logic của route trên file thật của máy →
`{"authed":null,"needsAuth":false,"khongXacDinh":true,"flaggedNeedsAuth":true}`. Banner không còn hiện.

## 6. Hành động cải tiến

| # | Thay đổi gì | Ở đâu | Trạng thái |
|---|---|---|---|
| 1 | Suy luận đọc-file tách khỏi route thành hàm thuần có test — điều kiện để kiểm được các tổ hợp "dữ liệu vắng mặt" | `server/lib/mcp-auth.ts` + `test/unit/mcp-auth.test.ts` | ☑ Xong |
| 2 | **Nguyên tắc: không biết thì đừng báo động.** Cảnh báo cho người dùng chỉ được bật khi có bằng chứng dương; thiếu dữ liệu ⇒ trạng thái "không xác định", không phải "hỏng" | Đã ghi thành comment lý do ngay tại `mcp-auth.ts`; áp cho mọi banner/cảnh báo suy ra từ dữ liệu ngoài | ☑ Xong |
| 3 | Không ghi cứng tên server/connector của hệ thống ngoài vào chuỗi hướng dẫn người dùng | `src/main.tsx` | ☑ Xong |

**Ghi chú cho thống kê:** đây là bug loại *"giả định đúng lúc viết, sai lúc dùng"*. Không có cổng nào bắt
được nó bằng cách đọc code, vì code không sai so với thế giới lúc nó ra đời. Thứ bắt được chỉ có thể là
**đối chiếu với hệ thống thật** — nên hành động #2 (không báo động khi không biết) là phòng thủ đúng chỗ:
nó khiến lớp bug này biểu hiện thành "im lặng" thay vì "kêu sai".

## 7. Liên kết

- CR liên quan: [CR-20260807-cong-chong-trung-va-cuu-phien-do-dang](../changes/CR-20260807-cong-chong-trung-va-cuu-phien-do-dang.md) (không sinh ra bug này, nhưng cùng vùng automation)
- Bối cảnh phát hiện: [docs/exchanges/2026-08-08.md](../../exchanges/2026-08-08.md)
- Bug tương tự: BUG-20260804 (một luật, nhiều call-site, sót một chỗ) — cùng họ "giả định không được kiểm lại", khác chỗ: lần đó lệch giữa hai chỗ trong code, lần này lệch giữa code và thế giới bên ngoài.
