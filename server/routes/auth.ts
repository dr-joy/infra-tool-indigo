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
  USERS_ME_TIMEOUT_MS
} from '../lib/auth-config.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';

const router = Router();

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

// ── GET /auth/callback — bước 2+3 của FR-1: nhận access_token/refresh_token, verify JWT, gọi
// /users/me, tạo/cập nhật user, set cookie phiên riêng của app.
//
// 2026-09-25: thiết kế gốc CR-20260913 FR-1 giả định `client_flows.indigo = "code"` (redirect kèm
// ?code=, app tự POST /auth/token/exchange đổi lấy token — token KHÔNG bao giờ lộ ra trình duyệt).
// Xác nhận thật với đội quản auth.drjoy.vn (25/09): client "indigo" đang cấu hình flow **"legacy"**,
// trả thẳng access_token/refresh_token trên query của chính redirect_uri — không có bước code/exchange
// nào cả. Leader chọn PHƯƠNG ÁN B (đổi app theo đúng cấu hình thật đang chạy, chấp nhận đánh đổi bảo
// mật: token thật lộ ra URL — vào log truy cập của proxy/server — thay vì nhờ đổi cấu hình phía họ
// sang "code"). Xem docs/exchanges/2026-09-25.md.
router.get('/auth/callback', asyncHandler(async (req, res) => {
  // 2026-09-26 (docs/exchanges/2026-09-26.md, rà soát lại commit 2e27454e) — flow "legacy" nhận
  // access_token/refresh_token thật ngay trên query string của chính request này (đánh đổi bảo mật đã
  // chốt 25/09, không đổi lại ở đây). Chặn thêm ĐÚNG một việc còn thiếu: không cho trình duyệt/proxy
  // trung gian lưu cache response này — thiếu no-store thì URL kèm token có thể còn sống lại qua
  // "quay lại trang trước" (back/forward cache) hoặc cache trung gian, dù thanh địa chỉ đã đổi sau redirect.
  res.setHeader('Cache-Control', 'no-store');
  const cookies = parseCookie(req.headers.cookie || '');
  const nonce = cookies[LOGIN_NONCE_COOKIE_NAME];
  // Xoá cookie nonce ngay (dùng một lần) bất kể kết quả bên dưới thành hay bại.
  res.setHeader('Set-Cookie', serializeCookie(LOGIN_NONCE_COOKIE_NAME, '', {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/api/auth', maxAge: 0
  }));
  if (!nonce) {
    throw new HttpError(400, 'Thiếu hoặc hết hạn cookie chống giả mạo đăng nhập, vui lòng đăng nhập lại', 'LOGIN_NONCE_INVALID');
  }

  const accessToken = String(req.query.access_token || '');
  const refreshToken = String(req.query.refresh_token || '');
  if (!accessToken || !refreshToken) {
    throw new HttpError(400, 'Thiếu access_token/refresh_token từ auth.drjoy.vn', 'AUTH_CALLBACK_INVALID');
  }

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

    // 2026-09-25 (docs/exchanges/2026-09-25.md): Leader xác nhận Admin bootstrap phải trải qua ĐÚNG màn
    // "Chọn team và vai trò" như user thường, không được vào thẳng — nên `status` LUÔN là 'pending' bất
    // kể có phải bootstrap Admin hay không (đổi so với bản trước: bootstrap trước đây set 'active' ngay,
    // bỏ qua bước chọn team). `system_role='admin'` vẫn gán ngay lúc này (không đợi tới lúc chọn xong
    // team) — cần biết ngay để đơn xin tham gia CỦA CHÍNH HỌ tự động duyệt được (server/routes/
    // onboarding.ts), vì tại thời điểm này chắc chắn chưa có Admin nào khác để duyệt hộ.
    const displayName = usersMe?.name || email;
    const avatar = usersMe?.avatar ?? null;
    const info = db.prepare(`
      INSERT INTO users (issuer, subject, email, display_name, avatar, status, system_role, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      claims.iss, claims.sub, email, displayName, avatar,
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
// Chỉ Admin ĐANG HOẠT ĐỘNG mới duyệt được gì — Admin bị khoá/đang chờ không tính khi giữ bất biến
// "luôn còn ≥1 Admin", nếu không thì khoá/hạ nốt người cuối vẫn lọt khi còn 1 Admin đã bị khoá.
function assertNotLastActiveAdmin(targetId: number) {
  const target = db.prepare('SELECT system_role, status FROM users WHERE id = ?').get(targetId) as
    { system_role: string; status: string } | undefined;
  if (!target) throw new HttpError(404, 'Không tìm thấy tài khoản');
  if (target.system_role !== 'admin' || target.status !== 'active') return;
  const activeAdmins = (db.prepare("SELECT COUNT(*) as n FROM users WHERE system_role = 'admin' AND status = 'active'")
    .get() as { n: number }).n;
  if (activeAdmins <= 1) {
    throw new HttpError(409, 'Đây là Admin cuối cùng còn hoạt động — phải gán thêm ít nhất 1 Admin khác trước', 'LAST_ADMIN');
  }
}

function setUserStatus(status: 'active' | 'disabled') {
  return (req: import('express').Request, res: import('express').Response) => {
    const id = Number(req.params.id);
    const body = req.body as { rowVersion?: number };
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });
    try {
      withTransaction(() => {
        if (status === 'disabled') assertNotLastActiveAdmin(id);
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

// ── Gán/hạ quyền Admin (2026-09-25, docs/exchanges/2026-09-25.md) ───────────────────────────────────
// 2 route riêng (không gộp PATCH .../role) — cùng lý do đã áp cho disable/enable phía trên: 2
// resource.action riêng trong AUTHORIZATION_POLICY. `demote-admin` chặn cứng hạ Admin CUỐI CÙNG (Leader
// xác nhận trực tiếp) — tránh lặp lại đúng vấn đề "không còn ai duyệt được gì" vừa phát hiện ở Admin
// bootstrap. Admin ĐƯỢC tự hạ quyền chính mình, miễn còn ≥1 Admin khác sau khi hạ (kiểm tra đếm, không
// phân biệt actor có phải chính target hay không — cùng 1 điều kiện áp cho mọi trường hợp).
router.post('/admin/users/:id/promote-admin', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'user_account', action: 'promote_admin', scope: {} });
  const id = Number(req.params.id);
  const body = req.body as { rowVersion?: number };
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });
  try {
    withTransaction(() => {
      // Chỉ tài khoản đã active: Admin đang 'pending' được server coi là Admin bootstrap (tự duyệt đơn,
      // tự lập team ở server/routes/onboarding.ts) — không được mở lối đó cho user chưa được duyệt.
      const target = db.prepare('SELECT status FROM users WHERE id = ?').get(id) as { status: string } | undefined;
      if (!target) throw new HttpError(404, 'Không tìm thấy tài khoản');
      if (target.status !== 'active') {
        throw new HttpError(409, 'Chỉ gán quyền Admin cho tài khoản đang hoạt động (đã được duyệt vào team, không bị khoá)');
      }
      const result = db.prepare(`
        UPDATE users SET system_role = 'admin', row_version = row_version + 1 WHERE id = ? AND row_version = ?
      `).run(id, body.rowVersion ?? -1);
      if (result.changes === 0) {
        throw new HttpError(409, 'Có người vừa thay đổi tài khoản này, vui lòng tải lại', 'VERSION_CONFLICT');
      }
      writeAudit(req.user!.id, null, 'user_account.promote_admin', `user:${id}`, {});
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không gán được quyền Admin');
  }
});

router.post('/admin/users/:id/demote-admin', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'user_account', action: 'demote_admin', scope: {} });
  const id = Number(req.params.id);
  const body = req.body as { rowVersion?: number };
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });
  try {
    withTransaction(() => {
      assertNotLastActiveAdmin(id);
      const result = db.prepare(`
        UPDATE users SET system_role = 'user', row_version = row_version + 1 WHERE id = ? AND row_version = ?
      `).run(id, body.rowVersion ?? -1);
      if (result.changes === 0) {
        throw new HttpError(409, 'Có người vừa thay đổi tài khoản này, vui lòng tải lại', 'VERSION_CONFLICT');
      }
      writeAudit(req.user!.id, null, 'user_account.demote_admin', `user:${id}`, {});
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không hạ được quyền Admin');
  }
});

export default router;
