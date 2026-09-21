import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { parse as parseCookie } from 'cookie';
import { db } from '../db.js';
import { HttpError } from './utils.js';
import { SESSION_COOKIE_NAME } from './auth-config.js';
import { getActiveSession } from './session.js';

// Lớp 1 (phiên) + lớp 1.5 (trạng thái tài khoản) của chuỗi gác 5 lớp ở CR §6.2 — đúng 2 lớp đứng
// TRƯỚC authorize(). authorize() (lớp ngữ cảnh team → hiển thị → năng lực → vai đặc biệt) thuộc Lát 3
// (Council 1aa7fe8b), CHƯA tồn tại — route Lát 2 tạm dùng guard viết tay (requireAdmin) thay cho
// authorize(), sẽ refactor lại khi Lát 3 có policyKind phù hợp (xem docs/exchanges/2026-09-21.md).
export interface AuthenticatedUser {
  id: number;
  email: string;
  displayName: string;
  avatar: string | null;
  status: 'pending' | 'active' | 'disabled';
  systemRole: 'user' | 'admin';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

interface UserRow {
  id: number;
  email: string;
  display_name: string;
  avatar: string | null;
  status: string;
  system_role: string;
}

function loadUserFromSessionCookie(req: Request): AuthenticatedUser | null {
  const cookies = parseCookie(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = getActiveSession(token);
  if (!session) return null;
  const row = db.prepare(`
    SELECT id, email, display_name, avatar, status, system_role FROM users WHERE id = ?
  `).get(session.user_id) as UserRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatar: row.avatar,
    status: row.status as AuthenticatedUser['status'],
    systemRole: row.system_role as AuthenticatedUser['systemRole']
  };
}

// Lớp 1 + 1.5: bắt buộc có phiên hợp lệ VÀ tài khoản không bị disabled. FR-4a: tra lại từ DB mỗi
// request, tài khoản bị vô hiệu có hiệu lực ngay ở request kế tiếp — không cache trong cookie/token.
export const requireSession: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const user = loadUserFromSessionCookie(req);
  if (!user) throw new HttpError(401, 'Chưa đăng nhập hoặc phiên đã hết hạn', 'SESSION_REQUIRED');
  if (user.status === 'disabled') {
    throw new HttpError(403, 'Tài khoản của bạn đã bị vô hiệu hoá', 'ACCOUNT_DISABLED');
  }
  req.user = user;
  next();
};

// requireSession KHÔNG chặn theo status ngoài disabled — pending vẫn qua được để gọi GET
// /api/auth/me, GET /api/teams, POST /api/onboarding/join-request (FR-2/FR-3a). Route nghiệp vụ khác
// ghép thêm requireActiveAccount ngay sau requireSession.

// Bắt buộc tài khoản đã active (đã được Admin duyệt) — dùng cho mọi route nghiệp vụ ngoài onboarding.
export const requireActiveAccount: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (req.user!.status !== 'active') {
    throw new HttpError(403, 'Tài khoản đang chờ Admin duyệt team/vai trò', 'ACCOUNT_PENDING');
  }
  next();
};

// Guard viết tay thay authorize() lớp vai đặc biệt (tạm thời — xem comment đầu file). Chỉ dùng cho
// route Admin thật rõ ràng (duyệt/từ chối join-request, thu hồi phiên) — KHÔNG dùng cho ngữ cảnh team
// (đó là việc của authorize() ở Lát 3).
export const requireAdmin: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (req.user!.systemRole !== 'admin') {
    throw new HttpError(403, 'Chỉ Admin được thực hiện hành động này', 'FORBIDDEN_ADMIN_ONLY');
  }
  next();
};
