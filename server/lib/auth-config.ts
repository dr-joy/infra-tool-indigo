// Cấu hình Lát 2 (CR-20260913 FR-1) đọc từ biến môi trường — không hard-code, vì domain/thật của
// auth.drjoy.vn khác nhau giữa môi trường dev và container triển khai thật (indigo.drjoy.vn:7749).
//
// AUTH_BASE_URL: gốc dịch vụ auth dùng chung của công ty, ví dụ https://auth.drjoy.vn.
// AUTH_CLIENT: khoá "indigo" đã đăng ký sẵn ở phía auth.drjoy.vn (allowed_clients/client_flows) — xem
// docs/exchanges/2026-09-21.md, đợt 5.
// APP_CALLBACK_URL: URL callback đầy đủ app tự khai khi redirect sang auth.drjoy.vn — phải khớp đúng
// giá trị đã đăng ký ở allowed_clients phía auth.drjoy.vn.
// ADMIN_BOOTSTRAP_EMAIL: FR-1a — email của Admin đầu tiên, cấu hình trước khi triển khai, KHÔNG lưu
// trong DB (đã sửa 19/09, xem CR §6.3 app_config).
export const authConfig = {
  baseUrl: (process.env.AUTH_BASE_URL || 'https://auth.drjoy.vn').replace(/\/+$/, ''),
  client: process.env.AUTH_CLIENT || 'indigo',
  callbackUrl: process.env.APP_CALLBACK_URL || 'http://localhost:4000/api/auth/callback',
  adminBootstrapEmail: (process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase()
};

// Tên cookie phiên riêng của app — FR-4: `__Host-<tên>` (ràng buộc vào đúng origin, không đặt Domain).
export const SESSION_COOKIE_NAME = '__Host-tm_session';
// Cookie chống login-CSRF (FR-1) — sống vài phút, chỉ dùng trong lúc chờ callback.
export const LOGIN_NONCE_COOKIE_NAME = 'login_nonce';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 tuần (FR-4)
export const LOGIN_NONCE_TTL_MS = 5 * 60 * 1000; // vài phút, đủ cho cả vòng Google OAuth
export const USERS_ME_TIMEOUT_MS = 5000; // FR-1: lỗi/timeout thì dùng tạm dữ liệu cũ, không chặn đăng nhập
