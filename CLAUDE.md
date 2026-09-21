# CLAUDE.md — Hướng dẫn vận hành (tự nạp mỗi phiên)

> File này được Claude Code đọc tự động khi mở dự án — chỉ giữ phần **cần cho mọi task**. Chi tiết từng
> flow nằm ở `.claude/skills/` (tự trigger đúng lúc) và `docs/standards/` (đọc khi cần).
> Nguồn chân lý là code + `docs/` (canonical). Khi code và docs mâu thuẫn → tin code, sửa docs trong cùng lần giao.

## Đầu phiên, backlog & vấn đề còn mở

**Backlog canonical** [`docs/backlog/README.md`](docs/backlog/README.md) do **Leader quản lý** là nguồn duy nhất
cho việc chưa làm và thứ tự ưu tiên. Codex và Claude nối tiếp nhau qua **kênh trao đổi**
[`docs/exchanges/YYYY-MM-DD.md`](docs/exchanges/README.md) (bàn bạc/handoff — chưa chốt) + **sổ cái**
[`docs/delivery/`](docs/delivery/README.md) (CR/BUG — vĩnh viễn).

**Đầu phiên:** đọc backlog trước để biết item nào đang `Picked`, rồi đọc file `exchanges/` mới nhất để tiếp tục
đúng điểm dừng của item đó. Không tự bắt đầu item `Inbox`/`Ready`; chỉ Leader được pick/đổi ưu tiên. Việc mới
phát hiện phải vào backlog, trừ bug khẩn cấp/thoát cổng được phép mở BUG trực tiếp.

Khi user đưa **một vấn đề chưa rõ giải pháp** (trước khi chọn đường A/B/C bên dưới): Claude đề xuất
solution → Codex review/phản biện → hai bên đối thoại (user giám sát, có thể chen ngang) → **user chốt**
— tất cả ghi trong cùng file `exchanges/`. Mỗi lượt ghi vào `exchanges/` phải mở đầu bằng **1 đoạn tóm tắt
ngắn gọn, bằng lời thường, không thuật ngữ/code** — user không rành kỹ thuật đọc lướt là hiểu, phần chi
tiết kỹ thuật để bên dưới. **Điểm cần user quyết phải kẻ thành bảng** (phương án | ưu | nhược, hoặc câu
hỏi | lựa chọn) — không viết dạng văn xuôi dài. Chỉ sau khi chốt mới sang bước chọn đường. Bỏ qua pha này nếu
giải pháp đã rõ (bugfix rõ ràng, cosmetic).

## Pick từ backlog rồi chọn đường (BẮT BUỘC, làm trước khi triệu tập ai)

Đóng vai **Leader**: ghi nhận việc vào backlog, chống trùng và chỉ bắt đầu khi item đã `Picked` (user yêu cầu
làm ngay có thể được ghi + pick trong cùng lượt). Sau đó **CHỌN ĐƯỜNG**, không bắt tay code hay gọi BA trước:

| Đường | Khi nào | Chi tiết |
|---|---|---|
| **A — Nhanh** | Cosmetic: CSS, đổi chữ/nhãn, refactor không đổi hành vi | Sửa → `npm run check` → tự soi diff → commit. Không CR, không skill nào |
| **B — Bugfix** | Lỗi rõ, không đổi hợp đồng API/DB | Skill `bugfix-flow` |
| **C — Full flow** | Thêm/sửa/xoá chức năng; đụng DB, hợp đồng API, nhiều màn | Skill `delivery-flow` |

Phân loại: *"có làm ai đó phải học lại cách dùng, hay có thể hỏng dữ liệu/chức năng khác không?"*
→ **Có** ⇒ C. Phân vân B hay C ⇒ chọn **C**. Đừng bắt user đi full flow để sửa một cái nhãn.

Chạm **vùng nhạy cảm** (secret/spawn-AI/serve file/import/SQL động/đóng gói/endpoint mới) ở BẤT KỲ đường
nào ⇒ thêm skill `security-gate`. Đụng `docs/`/`README.md`/`CLAUDE.md` ⇒ thêm skill `docs-sync`.

## Cổng chất lượng luôn áp dụng (không thuộc skill riêng)

- Trước khi coi là xong: **`npm run check` phải xanh** (tsc + test + build + budget bundle + link markdown).
- **Đụng `server/` hoặc `src/` ⇒ chưa xong khi chưa `npm run package` + tắt/bật lại `TaskManager.exe`.**
  Code đã sửa mà app người dùng chưa đổi thì với họ là **chưa sửa** (bài học `L-009`: lỗi cấu hình automation
  đã vá 14/08 nhưng exe không đóng gói lại nên tái diễn nguyên vẹn 17/08). `npm run check` có cảnh báo
  "Exe khớp code chạy thật" nhắc việc này.
- **Không dùng Pull Request — merge thẳng `main`** ([ADR-P1](docs/standards/team-operating-standard.md)).
  Bù lại: **tự soi `git diff --staged`** trước mỗi commit như review code người khác; commit message ghi
  `Ref: CR-… (FR-x)` (nếu có CR) + đã chạy test gì — đây là nơi DUY NHẤT giữ ngữ cảnh này.

## Bộ chuẩn canonical (đọc khi liên quan)

- **Bản đồ tài liệu:** [docs/README.md](docs/README.md) · **Ô dù quy trình:** [team-operating](docs/standards/team-operating-standard.md)
- **Backlog** (còn gì, ưu tiên nào): [`docs/backlog/README.md`](docs/backlog/README.md) — Leader sở hữu
- **Spec hệ thống** (LÀ gì): [`docs/specs/`](docs/specs/) `01–05` · **Rules** (xây NHƯ THẾ NÀO): [`docs/rules/`](docs/rules/) `06–09`
- **Playbook** (khi **xây**): [`docs/playbooks/`](docs/playbooks/) · **Operations** (khi **chạy**): [`docs/operations/`](docs/operations/README.md)
- **Proposals** (chưa cam kết): [`docs/proposals/`](docs/proposals/README.md) · **Archive** (hết hiệu lực): [`docs/_archive/`](docs/_archive/README.md)

## Lệnh nhanh

```bash
npm run dev        # chạy dev (server 4000 + client 5173)
npm test           # test backend (node:test) + frontend (vitest)
npm run build      # tsc --noEmit + vite build
npm run check      # CỔNG CHẤT LƯỢNG: tsc + test + build + budget bundle + link md
npm run hooks:install  # cài pre-push hook (chạy 1 lần trên mỗi máy)
npm run package    # đóng gói SEA -> TaskManager.exe
npm run backup-db  # sao lưu DB (bắt buộc trước migration đụng dữ liệu)
```

## Kiến trúc (tóm tắt)

- **FE:** React + Vite + TS. `src/main.tsx` (App shell), màn lớn tách ở `src/screens/{project,weekly,release}.tsx`, dùng chung `src/components/`, `src/lib/`, `src/context.tsx`, `src/api.ts`, `src/types.ts` (re-export enum từ `server/types.ts`). Tab nặng code-split bằng `React.lazy`.
- **BE:** Express 5 + `node:sqlite`. `server/app.ts` (app, error middleware HttpError-aware), `server/routes/*` (throw `HttpError`, `withTransaction` cho thao tác đa bước), `server/db.ts` (schema + migration idempotent), `server/lib/*`. DB ở `%APPDATA%/TaskManager/data/tasks.sqlite`, bind `127.0.0.1`.
- **Phân phối:** Node SEA (`scripts/build-sea.mjs`); MCP server `server/mcp.ts`.
