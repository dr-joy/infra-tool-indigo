# Chiến lược test — Task Manager

Tài liệu này mô tả cách test toàn project: các tầng test, công cụ, quy ước, cách chạy, và phần còn thiếu.

> 📋 Cần **checklist thao tác** khi thêm chức năng / sửa bug? Xem [QA-STANDARD.md](qa-standard.md) — bộ chuẩn test (Definition of Done, playbook theo loại thay đổi, smoke thủ công, mẫu copy-paste).

## Tổng quan: 2 runner, tách bạch môi trường

| Phần | Runner | Môi trường | Vị trí test |
|---|---|---|---|
| Backend (Express + SQLite + lib) | `node --test` + `tsx` | Node thật | `test/unit/`, `test/integration/` |
| Frontend (React) | **Vitest** + Testing Library | jsdom | `test/client/` |

Hai runner tách nhau vì chạy trên môi trường khác nhau (Node vs jsdom). Không trộn glob.

### Lệnh chạy

```bash
npm test              # chạy CẢ backend + frontend (server trước, rồi client)
npm run test:server   # chỉ backend (node:test)
npm run test:client   # chỉ frontend (vitest run)
npm run test:client:watch  # frontend chế độ watch khi phát triển
```

## Tầng 1 — Unit (logic thuần, nhanh, không I/O)

Ưu tiên viết cho hàm thuần đã tách ra module riêng — dễ test, chạy mili-giây:

- **Backend:** các hàm thuần trong `server/lib/*` và `server/types.ts`. → `test/unit/*.test.ts`.
- **Frontend:** `src/lib/date.ts`, `src/lib/task-utils.ts`, `src/api.ts`. → `test/client/*.test.ts`.

Ví dụ: [test/client/date.test.ts](../../test/client/date.test.ts), [test/client/task-utils.test.ts](../../test/client/task-utils.test.ts).

## Tầng 2 — Integration backend (Express thật + DB cô lập)

Khuôn chuẩn (xem [test/integration/tasks.test.ts](../../test/integration/tasks.test.ts)):

1. **Cô lập DB TRƯỚC khi import app:** đặt `process.env.APPDATA` sang thư mục tạm (`fs.mkdtempSync`) — vì `server/db.ts` đọc `APPDATA` lúc import để chọn file SQLite. Import `app` bằng dynamic `import()` SAU khi set env.
2. **Không tự listen ở app:** `server/app.ts` export `app` không listen (side-effect listen/mở browser nằm ở `index.ts`) → test `app.listen(0, ...)` port ngẫu nhiên.
3. **Dọn dẹp:** `after()` đóng server + xóa thư mục tạm.

Nên phủ: mọi route CRUD (tasks ✓, cần thêm projects/schedules/weekly), các nhánh lỗi (400/404/409), và tương tác nhiều bước (transaction).

## Tầng 3 — Component frontend (render + tương tác, jsdom)

Dùng `@testing-library/react`. Xem [test/client/components.test.tsx](../../test/client/components.test.tsx).

- Setup chung ở [test/client/setup.ts](../../test/client/setup.ts): nạp matcher `jest-dom`, `cleanup` sau mỗi test, stub `matchMedia`/`clipboard`, và `fetch` mặc định trả `[]` để component gọi API lúc mount không nổ.
- Context `useLang`/`useToast`/`usePics` đều có **giá trị mặc định** → render atom được mà không cần bọc provider. Component nào cần dữ liệu PIC/toast thật thì bọc `PicProvider`/`ToastProvider`.
- Test nào cần dữ liệu API cụ thể: `globalThis.fetch = vi.fn(...)` trong test đó.

## Quy ước

- Test frontend đặt ở `test/client/`, đuôi `.test.ts(x)`.
- Backend `.test.ts` ở `test/unit/` hoặc `test/integration/`.
- File nguồn dùng CRLF; khi viết script sửa file so khớp bằng `includes` (tránh dính `\r`).
- Không commit DB test (nằm trong thư mục tạm, tự xóa).

## Phần còn thiếu / roadmap

1. **Render smoke test cho 3 màn lớn** (Project/Weekly/Release) — sẽ thêm khi tách chúng ra file riêng (đang làm dở P0.2). Mỗi màn: mount với `fetch` mock, assert render không nổ + vài tương tác chính. Đây là lưới bắt hồi quy khi refactor tiếp.
2. **Integration route còn trống:** projects, schedules, weekly, de-thi, mindmaps.
3. **E2E (tùy chọn):** Playwright chạy app SEA thật + click qua các tab — giá trị cao nhất cho app desktop, nhưng nặng; cân nhắc sau khi có render smoke test.
4. ~~**CI**~~ — đã chốt **không dùng CI** ([ADR-P2](team-operating-standard.md)); thay bằng `npm run check` + pre-push hook chạy tại máy.
