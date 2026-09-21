import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { HttpError, sendRouteError } from '../lib/utils.js';
import { requireSession, requireAdmin } from '../lib/auth-middleware.js';

// FR-2/FR-3/FR-3a — chọn team lúc đăng nhập lần đầu, Admin duyệt/từ chối, không cấp quyền nghiệp vụ
// nào cho tới khi được duyệt (users.status chuyển active). `teams`/`team_members` ở đây là bản kéo
// sớm tối thiểu từ Lát 3 (xem server/schema/auth.ts).
const router = Router();

router.get('/teams', requireSession, (_req, res) => {
  const rows = db.prepare('SELECT id, name, description FROM teams ORDER BY name').all();
  res.json({ teams: rows });
});

interface JoinRequestBody {
  teamId?: number;
  role?: string;
}

router.post('/onboarding/join-request', requireSession, (req, res) => {
  const body = req.body as JoinRequestBody;
  const teamId = Number(body.teamId);
  const role = body.role;
  if (!Number.isInteger(teamId)) return res.status(400).json({ message: 'teamId không hợp lệ' });
  if (role !== 'leader' && role !== 'member') return res.status(400).json({ message: 'role phải là leader hoặc member' });

  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ message: 'Không tìm thấy team' });

  try {
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO join_requests (user_id, requested_team_id, requested_role, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(req.user!.id, teamId, role, now);

    // FR-3: Admin nhận thông báo trong app ngay khi có yêu cầu tham gia mới.
    const admins = db.prepare("SELECT id FROM users WHERE system_role = 'admin'").all() as { id: number }[];
    const insertNotif = db.prepare(`
      INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, 'join_request_created', ?, ?)
    `);
    const payload = JSON.stringify({ joinRequestId: result.lastInsertRowid, userId: req.user!.id, teamId, role });
    for (const admin of admins) insertNotif.run(admin.id, payload, now);

    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (error) {
    // Unique index (user_id) WHERE status='pending' -> đã có đơn đang chờ.
    if (error instanceof Error && /UNIQUE/.test(error.message)) {
      return res.status(409).json({ message: 'Bạn đã có 1 đơn xin tham gia team đang chờ duyệt', code: 'JOIN_REQUEST_PENDING_EXISTS' });
    }
    sendRouteError(res, error, 'Không tạo được đơn xin tham gia team');
  }
});

router.get('/onboarding/join-requests', requireSession, requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT jr.id, jr.user_id, u.email, u.display_name, jr.requested_team_id, jr.requested_role,
           jr.row_version, jr.created_at
    FROM join_requests jr JOIN users u ON u.id = jr.user_id
    WHERE jr.status = 'pending'
    ORDER BY jr.created_at ASC
  `).all();
  res.json({ joinRequests: rows });
});

interface ReviewBody {
  rowVersion?: number;
  teamId?: number;
  role?: string;
}

router.post('/onboarding/join-requests/:id/approve', requireSession, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as ReviewBody;
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });

  try {
    withTransaction(() => {
      const jr = db.prepare('SELECT * FROM join_requests WHERE id = ? AND status = ?').get(id, 'pending') as
        { id: number; user_id: number; requested_team_id: number; requested_role: string; row_version: number } | undefined;
      if (!jr) throw new HttpError(404, 'Không tìm thấy đơn đang chờ duyệt (có thể đã được xử lý)');

      // Admin có thể sửa team/vai trò ngay lúc duyệt (FR-3) — mặc định giữ đúng yêu cầu gốc.
      const approvedTeamId = Number.isInteger(body.teamId) ? Number(body.teamId) : jr.requested_team_id;
      const approvedRole = body.role === 'leader' || body.role === 'member' ? body.role : jr.requested_role;

      if (approvedRole === 'leader') {
        const hasLeader = db.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND role = 'leader'")
          .get(approvedTeamId);
        if (hasLeader) throw new HttpError(409, 'Team này đã có Leader, không thể gán thêm', 'TEAM_ALREADY_HAS_LEADER');
      }

      const now = new Date().toISOString();
      const updated = db.prepare(`
        UPDATE join_requests
        SET status = 'approved', approved_team_id = ?, approved_role = ?, reviewed_by = ?, reviewed_at = ?,
            row_version = row_version + 1
        WHERE id = ? AND row_version = ?
      `).run(approvedTeamId, approvedRole, req.user!.id, now, id, body.rowVersion ?? jr.row_version);
      if (updated.changes === 0) throw new HttpError(409, 'Đơn này vừa được xử lý bởi người khác, vui lòng tải lại', 'JOIN_REQUEST_STALE');

      db.prepare("UPDATE users SET status = 'active', row_version = row_version + 1 WHERE id = ?").run(jr.user_id);
      db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(approvedTeamId, jr.user_id, approvedRole);

      // FR-3: lần đầu sau khi được duyệt phải hiện popup xác nhận rõ team/vai trò -> ghi thông báo,
      // FE bắt buộc người dùng bấm "Đã hiểu" trước khi vào màn khác.
      db.prepare(`
        INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, 'join_request_approved', ?, ?)
      `).run(jr.user_id, JSON.stringify({ teamId: approvedTeamId, role: approvedRole }), now);
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không duyệt được đơn xin tham gia team');
  }
});

router.post('/onboarding/join-requests/:id/reject', requireSession, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as { rowVersion?: number };
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });

  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE join_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, row_version = row_version + 1
    WHERE id = ? AND status = 'pending' AND row_version = ?
  `).run(req.user!.id, now, id, body.rowVersion ?? -1);
  if (result.changes === 0) {
    return res.status(409).json({ message: 'Đơn này vừa được xử lý bởi người khác, vui lòng tải lại', code: 'JOIN_REQUEST_STALE' });
  }
  // FR-3a: không phải khoá vĩnh viễn — user.status vẫn là 'pending', lần đăng nhập kế tiếp tự quay
  // lại đúng màn "Chọn team và vai trò" (không có đơn pending nào -> FE tự hiện lại màn chọn team).
  res.json({ ok: true });
});

export default router;
