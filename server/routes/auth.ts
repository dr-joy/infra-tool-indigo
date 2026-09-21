import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { serialize as serializeCookie, parse as parseCookie } from 'cookie';
import { db, withTransaction } from '../db.js';
import { asyncHandler, HttpError, sendRouteError } from '../lib/utils.js';
import { maHoa } from '../lib/secret.js';
import { verifyAuthJwt } from '../lib/jwks-client.js';
import { createSession, revokeSession, revokeAllSessionsForUser } from '../lib/session.js';
import {
  authConfig,
  SESSION_COOKIE_NAME,
  LOGIN_NONCE_COOKIE_NAME,
  LOGIN_NONCE_TTL_MS,
  SESSION_TTL_MS,
  USERS_ME_TIMEOUT_MS,
  TOKEN_EXCHANGE_TIMEOUT_MS
} from '../lib/auth-config.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';

const router = Router();

interface TokenPair {
  access_token: string;
  refresh_token: string;
}

interface UsersMeResponse {
  user_id: string;
  email: string;
  name: string;
  avatar: string;
  provider: string;
}

interface UserRow {
  id: number;
  issuer: string;
  subject: string;
  email: string;
  display_name: string;
  avatar: string | null;
  status: string;
  system_role: string;
  row_version: number;
  created_at: string;
  last_login_at: string | null;
}

// GET /users/me có timeout riêng (FR-1: lỗi/timeout thì dùng tạm dữ liệu cũ trong DB, không chặn
// đăng nhập) — auth.drjoy.vn là phụ thuộc mạng, không được để 1 request treo cả luồng callback.
async function fetchUsersMe(accessToken: string): Promise<UsersMeResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USERS_ME_TIMEOUT_MS);
  try {
    const r = await fetch(`${authConfig.baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    });
    if (!r.ok) return null;
    return (await r.json()) as UsersMeResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── GET /auth/login — bước 1 của FR-1. auth.drjoy.vn tự làm silent SSO bên trong /auth/google/login
// khi trình duyệt có cookie drjoy_sso hợp lệ (xác nhận qua docs/openapi.yaml thật của
// dr-joy/infra-tool-auth — không cần app gọi riêng /auth/session, vì trong cả 2 trường hợp
// auth.drjoy.vn đều redirect về đúng redirect_uri kèm ?code= theo client_flows.indigo="code"). App chỉ
// cần tự đặt cookie login_nonce TRƯỚC khi redirect, để /auth/callback chống được login-CSRF.
router.get('/auth/login', (_req, res) => {
  const nonce = randomBytes(32).toString('base64url');
  res.setHeader('Set-Cookie', serializeCookie(LOGIN_NONCE_COOKIE_NAME, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/api/auth',
    maxAge: Math.floor(LOGIN_NONCE_TTL_MS / 1000)
  }));
  const url = new URL('/auth/google/login', authConfig.baseUrl);
  url.searchParams.set('client', authConfig.client);
  url.searchParams.set('redirect_uri', authConfig.callbackUrl);
  res.redirect(url.toString());
});

// ── GET /auth/callback — bước 2+3 của FR-1: nhận ?code=, đổi code lấy token, verify JWT, gọi
// /users/me, tạo/cập nhật user, set cookie phiên riêng của app.
router.get('/auth/callback', asyncHandler(async (req, res) => {
  const cookies = parseCookie(req.headers.cookie || '');
  const nonce = cookies[LOGIN_NONCE_COOKIE_NAME];
  // Xoá cookie nonce ngay (dùng một lần) bất kể kết quả bên dưới thành hay bại.
  res.setHeader('Set-Cookie', serializeCookie(LOGIN_NONCE_COOKIE_NAME, '', {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/api/auth', maxAge: 0
  }));
  if (!nonce) {
    throw new HttpError(400, 'Thiếu hoặc hết hạn cookie chống giả mạo đăng nhập, vui lòng đăng nhập lại', 'LOGIN_NONCE_INVALID');
  }

  const code = String(req.query.code || '');
  if (!code) throw new HttpError(400, 'Thiếu mã đăng nhập (code) từ auth.drjoy.vn');

  const exchangeController = new AbortController();
  const exchangeTimer = setTimeout(() => exchangeController.abort(), TOKEN_EXCHANGE_TIMEOUT_MS);
  let exchangeRes: Response;
  try {
    exchangeRes = await fetch(`${authConfig.baseUrl}/auth/token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: exchangeController.signal
    });
  } catch {
    // Timeout hoặc lỗi mạng — KHÁC /users/me: không có dữ liệu cũ để dùng tạm, phải báo lỗi rõ.
    throw new HttpError(502, 'Không kết nối được tới auth.drjoy.vn để đổi mã đăng nhập, vui lòng thử lại');
  } finally {
    clearTimeout(exchangeTimer);
  }
  if (!exchangeRes.ok) throw new HttpError(502, 'Không đổi được mã đăng nhập lấy token từ auth.drjoy.vn');
  const tokens = (await exchangeRes.json()) as Partial<TokenPair>;
  // auth.drjoy.vn là hệ thống ngoài — không tin response luôn đúng hình dạng dù status 200 (Codex
  // phát hiện: ép kiểu thẳng sang TokenPair mà không kiểm có thể lưu refresh_token rỗng/undefined
  // hoặc verifyAuthJwt nhận access_token không phải string, lỗi ra không rõ nghĩa).
  if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) {
    throw new HttpError(502, 'auth.drjoy.vn trả về dữ liệu token không hợp lệ');
  }
  const { access_token: accessToken, refresh_token: refreshToken } = tokens as TokenPair;

  const claims = await verifyAuthJwt(accessToken);
  const usersMe = await fetchUsersMe(accessToken);
  const email = (usersMe?.email || claims.email).trim();
  const now = new Date().toISOString();

  const user = withTransaction(() => {
    const existing = db.prepare('SELECT * FROM users WHERE issuer = ? AND subject = ?')
      .get(claims.iss, claims.sub) as UserRow | undefined;

    if (existing) {
      const displayName = usersMe?.name || existing.display_name;
      const avatar = usersMe?.avatar ?? existing.avatar;
      db.prepare(`
        UPDATE users SET display_name = ?, avatar = ?, email = ?, last_login_at = ?, row_version = row_version + 1
        WHERE id = ?
      `).run(displayName, avatar, email, now, existing.id);
      return { ...existing, display_name: displayName, avatar, email };
    }

    // FR-1a: bootstrap Admin đầu tiên — fail-closed nếu email không khớp cấu hình HOẶC đã có Admin
    // bootstrap trước đó. Nằm trong cùng transaction với INSERT để 2 callback đồng thời không tạo
    // ra 2 Admin (kiểm tra + ghi atomically).
    const alreadyHasAdmin = (db.prepare("SELECT COUNT(*) as n FROM users WHERE system_role = 'admin'")
      .get() as { n: number }).n > 0;
    const emailMatchesBootstrap = authConfig.adminBootstrapEmail.length > 0
      && email.toLowerCase() === authConfig.adminBootstrapEmail;
    const isBootstrapAdmin = emailMatchesBootstrap && !alreadyHasAdmin;
    // FR-1a: "Lần bind thứ hai hoặc xung đột... phải fail-closed VÀ GHI NHẬT KÝ" — audit_log thật
    // thuộc Lát 4 (chưa tồn tại), console.warn là mức ghi nhận tối thiểu ngay bây giờ, cùng quy ước
    // console.error/warn đã dùng ở server/routes/redmine.ts, server/lib/mindmap-gc.ts.
    if (emailMatchesBootstrap && alreadyHasAdmin) {
      console.warn(`[auth] Danh tính mới (issuer=${claims.iss}, subject=${claims.sub}) khớp email bootstrap Admin nhưng đã có Admin khác -> fail-closed, tạo tài khoản user/pending thay vì admin`);
    }

    const displayName = usersMe?.name || email;
    const avatar = usersMe?.avatar ?? null;
    const info = db.prepare(`
      INSERT INTO users (issuer, subject, email, display_name, avatar, status, system_role, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      claims.iss, claims.sub, email, displayName, avatar,
      isBootstrapAdmin ? 'active' : 'pending',
      isBootstrapAdmin ? 'admin' : 'user',
      now, now
    );
    return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as unknown as UserRow;
  });

  if (user.status === 'disabled') {
    throw new HttpError(403, 'Tài khoản của bạn đã bị vô hiệu hoá', 'ACCOUNT_DISABLED');
  }

  // Giữ lại refresh_token của auth.drjoy.vn để định kỳ đồng bộ display_name/avatar mỗi lần đăng nhập
  // lại (chốt Leader 21/09) — secret bên thứ ba, bắt buộc mã hoá trước khi lưu.
  db.prepare(`
    INSERT INTO user_identity_tokens (user_id, refresh_token_ciphertext, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET refresh_token_ciphertext = excluded.refresh_token_ciphertext, updated_at = excluded.updated_at
  `).run(user.id, maHoa(refreshToken), now);

  const session = createSession(user.id);
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  }));
  res.redirect('/');
}));

// ── GET /auth/me — FE dùng để biết trạng thái hiện tại (pending/active/disabled) và dựng đúng màn.
router.get('/auth/me', requireSession, (req, res) => {
  res.json({ user: req.user });
});

// ── POST /auth/logout — chỉ huỷ phiên riêng của Task Manager, KHÔNG đăng xuất SSO ở auth.drjoy.vn
// (người dùng vẫn đăng nhập được ở các tool *.drjoy.vn khác) — tách bạch 2 khái niệm theo đúng rủi ro
// Codex đã nêu khi review thiết kế.
router.post('/auth/logout', requireSession, (req, res) => {
  const cookies = parseCookie(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) revokeSession(token);
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE_NAME, '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0
  }));
  res.json({ ok: true });
});

// ── Quản lý tài khoản của Admin (FR-4/FR-4a, nhóm A) — đi qua authorize() (Lát 3, policyKind
// 'team_feature' với scope.teamId bỏ trống -> vai trò xét theo system_role, xem server/lib/authorize.ts).
router.get('/admin/users', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'user_account', action: 'list', scope: {} });
  const rows = db.prepare(`
    SELECT id, email, display_name, avatar, status, system_role, row_version, created_at, last_login_at
    FROM users ORDER BY created_at DESC
  `).all();
  res.json({ users: rows });
});

// disable/enable tách 2 route riêng (không gộp PATCH .../status) — khớp CR §6.2 đã chốt: đây là 2
// resource.action riêng trong AUTHORIZATION_POLICY, có thể sau này cấp quyền khác nhau (Council f0a0e1bb).
function setUserStatus(status: 'active' | 'disabled') {
  return (req: import('express').Request, res: import('express').Response) => {
    const id = Number(req.params.id);
    const body = req.body as { rowVersion?: number };
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });
    try {
      withTransaction(() => {
        const result = db.prepare(`
          UPDATE users SET status = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?
        `).run(status, id, body.rowVersion ?? -1);
        if (result.changes === 0) {
          throw new HttpError(409, 'Có người vừa thay đổi tài khoản này, vui lòng tải lại', 'VERSION_CONFLICT');
        }
        // KHÔNG tự thu hồi phiên ở đây: middleware (requireSession) tra status từ DB mỗi request nên
        // đã chặn ngay request kế tiếp (FR-4a). Nếu thu hồi phiên luôn, request kế tiếp của user rơi
        // vào 401 SESSION_REQUIRED (chung, như "phiên hết hạn") thay vì đúng 403 ACCOUNT_DISABLED —
        // làm mất đúng thông điệp rõ ràng FR-4a yêu cầu. Thu hồi phiên là hành động RIÊNG (route
        // /revoke-sessions).
        writeAudit(req.user!.id, null, `user_account.${status === 'disabled' ? 'disable' : 'enable'}`, `user:${id}`, {});
      });
      res.json({ ok: true });
    } catch (error) {
      sendRouteError(res, error, 'Không đổi được trạng thái tài khoản');
    }
  };
}

router.post('/admin/users/:id/disable', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'user_account', action: 'disable', scope: {} });
  setUserStatus('disabled')(req, res);
});

router.post('/admin/users/:id/enable', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'user_account', action: 'enable', scope: {} });
  setUserStatus('active')(req, res);
});

router.post('/admin/users/:id/revoke-sessions', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'user_account', action: 'revoke_sessions', scope: {} });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });
  withTransaction(() => {
    revokeAllSessionsForUser(id);
    writeAudit(req.user!.id, null, 'user_account.revoke_sessions', `user:${id}`, {});
  });
  res.json({ ok: true });
});

export default router;
