# CR-20260925-doi-flow-dang-nhap-sang-legacy — Đổi `/auth/callback` sang flow "legacy" thật của auth.drjoy.vn

| Trường | Giá trị |
|---|---|
| Loại | ☑ Sửa hành vi |
| Mức tác động | ☑ Vừa (đụng hợp đồng API với hệ thống ngoài `auth.drjoy.vn`, vùng nhạy cảm bảo mật — auth) |
| Người đề xuất | Leader (qua Claude, phiên đăng nhập thật đầu tiên trên bản deploy) |
| Ngày | 2026-09-25 |
| Backlog item | `BL-20260925-001` |
| Trạng thái | ☑ Đã triển khai |
| Spec liên quan | [CR-20260913 FR-1](CR-20260913-nen-tang-da-nguoi-dung.md) (thiết kế gốc bị thay thế đúng phần flow đăng nhập) |

## 1. Bối cảnh & Vấn đề

`CR-20260913` FR-1 thiết kế đăng nhập theo Authorization Code: `auth.drjoy.vn` redirect về app kèm
`?code=` (dùng 1 lần), app tự `POST /auth/token/exchange` đổi lấy `access_token`/`refresh_token` ở phía
server — trình duyệt không bao giờ thấy token thật. Thiết kế này dựa trên đọc tài liệu/source
`dr-joy/infra-tool-auth` (`client_flows.indigo = "code"`), **chưa từng được xác nhận bằng một lần đăng
nhập thật** (ghi rõ trong code lúc đó: "GIẢ ĐỊNH chưa xác nhận trực tiếp bằng một JWT thật").

25/09, Leader bấm nút "Đăng nhập" thật lần đầu trên bản đã deploy (`indigo.drjoy.vn`) — lộ ra 2 giả định
sai (chi tiết điều tra: [exchange 2026-09-25](../../exchanges/2026-09-25.md)):

1. `auth.drjoy.vn` KHÔNG dùng flow "code" cho client `indigo` — dùng flow **"legacy"**: redirect thẳng
   `access_token`/`refresh_token` trên query của `redirect_uri`, không có `code`/exchange nào.
2. JWT thật có `iss`/`aud` khác hẳn giả định thiết kế (`iss="auth-service"` thay vì URL
   `auth.drjoy.vn`, `aud="api-gateway"` thay vì client id `"indigo"`).

## 2. Mục tiêu & Ngoài phạm vi

- **Mục tiêu (đo được):**
  - Đăng nhập thật qua `auth.drjoy.vn` (flow "legacy" đang chạy) thành công end-to-end, tạo/cập nhật
    user đúng, verify JWT qua JWKS đúng issuer/audience thật.
  - Không phá tương thích với thiết kế phân quyền/session đã có (FR-2→FR-4a của CR-20260913) — chỉ đổi
    ĐÚNG đoạn nhận token ở `/auth/callback` + đoạn verify issuer/audience.
- **Ngoài phạm vi (không làm lần này):**
  - Không tự đổi cấu hình phía `auth.drjoy.vn` (phương án A, không chọn — xem exchange).
  - Không vá thêm rủi ro "token lộ trên URL/log truy cập" — đây là đánh đổi đã biết và chấp nhận của
    phương án B, không phải bug cần sửa thêm trong CR này.
  - Không đổi cơ chế `login_nonce` (login-CSRF) — không liên quan tới flow code/legacy.

## 3. Người dùng & Kịch bản

Là người dùng bất kỳ của Task Manager (Admin/Leader/Member), tôi bấm "Đăng nhập", được `auth.drjoy.vn`
xác thực qua Google, quay lại app và vào được đúng tài khoản của mình — không gặp lỗi 400/502 do app
hiểu sai hình dạng dữ liệu `auth.drjoy.vn` trả về.

## 4. Yêu cầu chức năng

- **FR-1:** `GET /api/auth/callback` đọc `access_token` và `refresh_token` trực tiếp từ query string.
  Thiếu 1 trong 2 (rỗng/không có) → `400 AUTH_CALLBACK_INVALID`, không tạo/sửa user nào.
- **FR-2:** Bỏ hẳn bước `POST {authConfig.baseUrl}/auth/token/exchange` — không còn gọi tới endpoint
  này (client "indigo" không dùng flow "code").
- **FR-3:** `verifyAuthJwt()` cho phép override issuer kỳ vọng qua biến môi trường
  `AUTH_EXPECTED_ISSUER` (mẫu y hệt `AUTH_EXPECTED_AUDIENCE` đã có), mặc định fallback
  `authConfig.baseUrl` nếu không set (giữ tương thích test/mock hiện tại).
- **FR-4:** Toàn bộ luồng còn lại (verify JWT, `/users/me`, tạo/cập nhật user, bootstrap Admin fail-closed,
  lưu `refresh_token` mã hoá, set session cookie) giữ NGUYÊN — chỉ thay NGUỒN lấy `access_token`/
  `refresh_token`, không đổi logic sau đó.

## 5. Yêu cầu phi chức năng

- **Bảo mật (đánh đổi đã biết, KHÔNG che giấu):** `access_token`/`refresh_token` thật xuất hiện trên
  URL của request `/api/auth/callback` — nghĩa là chúng sẽ nằm trong: lịch sử trình duyệt, log truy cập
  của Nginx Proxy Manager/Express (nếu bật access log ghi query string), và mọi hệ thống trung gian đọc
  được URL đó. App vẫn `res.redirect('/')` ngay sau khi xử lý xong (route cũ đã làm vậy) nên URL hiển
  thị trên thanh địa chỉ trình duyệt trở về sạch ngay, không lưu token trong session/localStorage phía
  FE. Rủi ro còn lại nằm ở TẦNG LOG, không sửa được từ phía app — Infra cân nhắc có cần lọc query string
  chứa `access_token`/`refresh_token` khỏi access log hay không (không thuộc phạm vi CR này).
- **Vận hành bắt buộc sau khi deploy:** Infra phải set `AUTH_EXPECTED_ISSUER=auth-service` và
  `AUTH_EXPECTED_AUDIENCE=api-gateway` trên container thật — thiếu 1 trong 2 thì JWT verify luôn fail.

## 6. Thiết kế giải pháp

### 6.2. API & nghiệp vụ

`GET /api/auth/callback`:
- Trước: `code = query.code` → thiếu thì `400` → `POST /auth/token/exchange {code}` (timeout 8s) →
  `502` nếu lỗi mạng/không ok/response sai hình dạng → lấy `access_token`/`refresh_token` từ response.
- Sau: `accessToken = query.access_token`, `refreshToken = query.refresh_token` → thiếu 1 trong 2 →
  `400 AUTH_CALLBACK_INVALID`. Không còn nhánh `502` nào cho bước này (không còn gọi mạng ra ngoài ở
  đây nữa — `/users/me` vẫn gọi ra ngoài như cũ, giữ nguyên timeout/fallback FR-1 gốc).

`verifyAuthJwt()`: `issuer` kỳ vọng đổi từ hằng `authConfig.baseUrl` sang biến `expectedIssuer =
process.env.AUTH_EXPECTED_ISSUER || authConfig.baseUrl`.

### 6.3. Dữ liệu & schema

Không đổi schema. Không đổi cách lưu `refresh_token` (vẫn mã hoá qua `maHoa()` trước khi ghi
`user_identity_tokens`).

## 7. Phân tích tác động

- [x] API route (`server/routes/auth.ts`) · [x] Bảo mật (auth flow, xem §5) · [ ] Frontend · [ ] DB/migration
- **Rủi ro & giảm thiểu:** token lộ trên URL/log — chấp nhận, xem §5. Đổi issuer/audience kỳ vọng sai
  giá trị thật sẽ khoá đăng nhập của MỌI người — giảm thiểu bằng cách giữ giá trị mặc định fallback y
  hệt hành vi cũ khi không set env (không phá test hiện có), giá trị thật bắt buộc set ở môi trường
  production trước khi có ai đăng nhập được.
- **Ảnh hưởng chức năng đang chạy:** Không ai đăng nhập thật thành công trước CR này (mọi lần thử đều
  lỗi ở bước code/exchange hoặc issuer/audience) — CR này không phá tính năng đang chạy tốt, mà sửa
  tính năng đang HỎNG HOÀN TOÀN.

## 8. Tiêu chí nghiệm thu

- **AC-1 (FR-1):** Given callback thiếu `access_token` hoặc `refresh_token` / When gọi
  `GET /api/auth/callback` (có cookie `login_nonce` hợp lệ) / Then `400 AUTH_CALLBACK_INVALID`, không có
  user mới trong DB.
- **AC-2 (FR-2):** Given đăng nhập thành công qua mock auth server / When kiểm tra không có request nào
  tới `/auth/token/exchange` / Then đúng — mock không còn định nghĩa endpoint này, test vẫn xanh.
- **AC-3 (FR-3):** Given JWT có `iss`/`aud` khác `authConfig.baseUrl`/`client` mặc định / When set
  `AUTH_EXPECTED_ISSUER`/`AUTH_EXPECTED_AUDIENCE` khớp đúng giá trị JWT / Then verify JWT pass (đã xác
  nhận gián tiếp qua toàn bộ test hiện có vẫn xanh với giá trị mặc định — chưa có test riêng cho nhánh
  override vì mock hiện tại không cần dùng tới, ghi nhận khoảng trống này ở §9).

## 9. Kế hoạch test

- Tầng test: Integration route (`node:test`), toàn bộ 6 file mock server auth (1 fixture dùng chung
  `test/integration/fixtures/auth-harness.ts` cho 20 file + 5 file có mock riêng: `teams`, `onboarding`,
  `audit`, `auth`, `admin-config`) đổi mô phỏng sang trả thẳng token.
- `test/integration/auth.test.ts` (test chuyên sâu cho login) — sửa/xoá theo đúng thay đổi hành vi:
  xoá ca "code dùng lại 1 lần" (không còn khái niệm code), đổi ca "thiếu ?code=" → "thiếu
  access_token/refresh_token", đổi ca "response exchange hỏng" → "callback nhận refresh_token rỗng".
- **Khoảng trống chưa test:** override `AUTH_EXPECTED_ISSUER`/`AUTH_EXPECTED_AUDIENCE` chưa có test
  riêng (mock hiện tại tự nhất quán với giá trị mặc định nên không cần override để pass) — rủi ro thấp
  vì code chỉ là 1 dòng `||` fallback đối xứng với `AUTH_EXPECTED_AUDIENCE` đã có sẵn từ trước và đã
  chạy ổn trong production trước đó (theo lời kể — audience override tồn tại từ Lát 2).
- Kết quả: 464 test backend + 95 test frontend pass, `npm run check` xanh (trừ Design token, nợ cũ).

## 10. Kế hoạch triển khai / rollback

- Triển khai: merge code này, Infra set `AUTH_EXPECTED_ISSUER=auth-service` +
  `AUTH_EXPECTED_AUDIENCE=api-gateway` trên container thật, thử đăng nhập lại.
- Rollback: revert commit này (quay lại flow "code" cũ) — chỉ hợp lý nếu `auth.drjoy.vn` sau này đổi
  cấu hình `client_flows.indigo` sang `"code"` thật (phương án A), khi đó cần CR riêng, không phải
  rollback đơn thuần vì phương án A và B loại trừ nhau.

## 11. Docs cần cập nhật sau khi làm xong

- [x] Không cần cập nhật `docs/specs/01-05` — đây là sửa lỗi hiểu sai giao thức bên ngoài, không đổi
  spec nghiệp vụ nào của Task Manager.
- [x] `docs/backlog/README.md` — đóng `BL-20260925-001`.

## 12. Duyệt (sign-off)

| Vai trò | Tên | Ngày | OK? |
|---|---|---|---|
| BA/đề xuất | Leader (qua Claude) | 2026-09-25 | ✅ |
| Người triển khai | Claude | 2026-09-25 | ✅ |
| QA nghiệm thu | Claude (tự review — không có Council/Codex độc lập trong phiên này) | 2026-09-25 | ✅ test tự động xanh; **chưa smoke thật trên `indigo.drjoy.vn`** — cần Leader tự thử đăng nhập lại sau khi Infra set 2 biến môi trường |
