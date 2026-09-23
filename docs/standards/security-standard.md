# Security Baseline Standard — Task Manager

> Chuẩn **bảo mật bắt buộc** khi phát triển. Mỗi thay đổi phải không phá vỡ baseline dưới đây + qua checklist mục 9.
> Nguồn: `server/app.ts`, `server/lib/secret.ts`, `server/lib/utils.ts`, `server/routes/*`, `scripts/build-sea.mjs`, `Dockerfile`.
> Liên quan: [../09-non-functional-requirements.md §2](../rules/09-non-functional-requirements.md) (mục tiêu) · [docs-standard.md](docs-standard.md).

---

## 0. TL;DR

1. **Không secret ra ngoài**: không log/không trả về client/không commit. Chỉ hiển thị **masked**.
2. **Không tin input**: validate shape + size + scheme trước khi ghi DB; luôn **prepared statement**.
4. **Lỗi ra client = message generic**; stack/SQL/path nhạy cảm chỉ ở log server.
5. Thêm dependency = qua **`npm audit`** + cân nhắc bундle SEA; không thêm dep thừa.
6. Đổi vùng nhạy cảm (secret, spawn, serve file, import, đóng gói) ⇒ bắt buộc review theo checklist mục 9.

---

## 1. Mô hình tin cậy (threat model)

App **local, 1 người dùng**, server bind `127.0.0.1` → **không có auth theo thiết kế** (rủi ro chấp nhận được: đã ở máy người dùng). Vì vậy trọng tâm bảo mật KHÔNG phải auth mà là:

| Tài sản cần bảo vệ | Mối đe dọa chính | Kiểm soát |
|---|---|---|
| Secret (Redmine key, master key) | Đọc trộm file DB/log | AES-256-GCM, key **ngoài** thư mục data, `0600`, không log |
| Toàn vẹn dữ liệu | Input độc/hỏng, thao tác đa bước lỗi | Validate + prepared SQL + `withTransaction` |
| Máy người dùng | Supply-chain qua dependency bundle vào SEA | `npm audit`, tối giản dep, lockfile |
| Trình duyệt | XSS qua nội dung import/upload (HTML/SVG) | `nosniff`, sanitize/attachment, allowlist scheme |

**Non-goals (rủi ro chấp nhận):** không auth app; không chống kẻ tấn công đã có quyền admin trên máy.

---

## 2. Baseline hạ tầng (KHÔNG được phá)

- [ ] Server chỉ bind `127.0.0.1` (không `0.0.0.0`).
- [ ] CORS chỉ `localhost`/`127.0.0.1`.
- [ ] Header: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`; `x-powered-by` tắt.
- [ ] Error middleware trung tâm: chỉ trả `message` generic ở 500; log chi tiết server-side (`sendRouteError`).
- [ ] Không tạo endpoint mở ra mạng ngoài loopback; không proxy tùy tiện tới host ngoài.

## 3. Secret & dữ liệu tại chỗ (at-rest)

- [ ] Secret (API key…) **mã hóa AES-256-GCM** trước khi lưu (`lib/secret.ts`), có prefix version (`enc:v1:`).
- [ ] Master key lưu **bên trong** thư mục `data/` (cạnh `data/backups/`), file `mode 0600` — SỬA 2026-09-23
  (BL-20260921-003): trước đây yêu cầu lưu **ngoài** `data/` để backup DB không kéo theo key, nhưng bản
  container (CR-20260913 FR-36) chỉ có đúng 1 volume bền vững (`/data`) — key ngoài đó bị container tái
  tạo xoá mất, làm mọi secret đã mã hoá cũ không giải lại được. `scripts/backup-db.mjs` chỉ `VACUUM INTO`
  đúng file `.sqlite`, không copy cả thư mục, nên nguy cơ gốc (backup DB kéo theo key) không xảy ra qua
  kênh backup của app — đổi lại, chấp nhận đánh đổi: ai có quyền snapshot nguyên ổ hạ tầng `/data` sẽ có
  cả DB lẫn key (rủi ro hẹp hơn, cần quyền hạ tầng đặc quyền). Có thêm cơ chế canary (`server/lib/secret.ts`)
  phát hiện key bị mất/đổi giữa 2 lần chạy, báo qua `/health/ready` thay vì âm thầm sinh key mới.
- [ ] **Không log** secret/token/key/password ở bất kỳ đâu (server & client).
- [ ] Không trả secret về client; nếu cần hiển thị → **masked** (vd `••••1234`).
- [ ] Setting chứa secret phải có trạng thái rõ: *đã cấu hình / chưa cấu hình*.
- [ ] Không commit config local chứa secret/path riêng (`.claude/settings.local.json`, `claude_desktop_config.json`…).

## 4. Input & nội dung

- [ ] **Validate mọi input** trước khi ghi DB (shape + kiểu + biên). Cast `req.body as T` KHÔNG phải validate.
- [ ] **Prepared statement** cho mọi giá trị; `${...}` trong SQL chỉ được là placeholder sinh động (`IN (?, ?)`) hoặc mảnh hằng số — **không nội suy giá trị user**.
- [ ] URL người dùng nhập: validate scheme trong allowlist (`http/https/slack/zoommtg/file/vscode` theo `normalizeTaskLinks`).
- [ ] Import (đề thi/JSON lớn): giới hạn kích thước + validate shape trước khi xử lý.
- [ ] **Body limit**: nới rộng (32MB) **chỉ cho route import** cần; route khác giữ mặc định để giảm bề mặt DoS bộ nhớ. *(hiện đang áp toàn cục — cần thu hẹp, xem mục 10)*.
- [ ] Serve file upload (mindmap attachment…): chặn path traversal bằng `path.basename` + kiểm prefix; ưu tiên `Content-Disposition: attachment` hoặc whitelist MIME cho file HTML/SVG (tránh stored-XSS).

## 5. Thao tác nguy hiểm

- [ ] Xóa/overwrite/bulk-import/close-project/delete-template: **confirm UI** + backend **tự kiểm điều kiện nghiệp vụ** (không tin UI).
- [ ] Bulk update DB runtime: **backup trước** (`scripts/backup-db.mjs`).
- [ ] Không tự xóa dấu vết automation (missed/log) một cách im lặng.

## 6. Dependency & Supply-chain

- [ ] Thêm dep mới: chạy `npm audit`, đánh giá **kích thước & cần thiết** (mọi dep runtime bị bundle vào SEA → phình exe + tăng bề mặt tấn công).
- [ ] Ưu tiên API built-in (vd `node:sqlite`, `node:crypto`) hơn thư viện ngoài.
- [ ] Commit `package-lock.json`; không cập nhật major bừa (Express 5/React 19/Vite 7 đang dùng — đọc changelog trước khi nâng).
- [ ] Cảnh giác dep có `postinstall` script lạ.

## 7. Đóng gói & phân phối (SEA)

- [ ] Bản `.exe` **không nhúng secret**; chỉ nhúng runtime + server + `dist/`.
- [ ] DB tạo cạnh exe tại `%APPDATA%\TaskManager\data\` — không đặt trong thư mục build/temp dễ mất.
- [ ] Không ship file cấu hình local/máy khác.
- [ ] `dist-mcp/` là build local, không commit.

## 8. Cổng review bảo mật (bắt buộc khi đụng vùng nhạy cảm)

Vùng nhạy cảm = *secret, spawn/AI, serve file, import, SQL động, đóng gói, endpoint mới*. Checklist thực
thi (gate trước khi merge, kể cả phần riêng spawn AI/serve file/đóng gói) đã chuyển sang skill
[`.claude/skills/security-gate/SKILL.md`](../../.claude/skills/security-gate/SKILL.md) — nguồn thật duy
nhất cho phần "check gì". File này (mục 1–8, 10) giữ baseline kỹ thuật chi tiết + threat model + nợ bảo mật.

## 9. Nợ bảo mật / cần cải thiện (theo dõi)

1. **Body limit 32MB áp toàn cục** ([app.ts](../../server/app.ts)) → thu hẹp chỉ cho route import.
3. **Serve mindmap file inline** → cân nhắc `attachment`/whitelist MIME cho HTML/SVG.
4. **Chưa có module config validate env lúc khởi động** → sai cấu hình chỉ lộ lúc chạy; nên fail-fast + không log giá trị secret.

---

*Chuẩn này bổ sung, không thay thế, các ràng buộc ở [09-NFR](../rules/09-non-functional-requirements.md). Thấy lỗi thời → sửa tại đây trong cùng lần giao.*
