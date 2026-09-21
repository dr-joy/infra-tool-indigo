import { Router } from 'express';
import { db } from '../db.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';

// FR-11a — Admin đọc metadata toàn cục, Leader/Member đọc chi tiết đầy đủ đúng team mình (sửa 19/09
// lần 14, thêm Member). Một nguồn duy nhất (audit_log), 2 hình dạng response khác nhau theo projection.
const router = Router();

interface AuditRow {
  id: number;
  actor_user_id: number;
  team_id: number | null;
  action: string;
  target: string;
  payload: string;
  created_at: string;
}

function encodeCursor(createdAt: string, id: number): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString('base64url');
}
function decodeCursor(cursor: string): [string, number] | null {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return typeof createdAt === 'string' && Number.isInteger(id) ? [createdAt, id] : null;
  } catch {
    return null;
  }
}

router.get('/audit', requireSession, requireActiveAccount, (req, res) => {
  const teamIdParam = req.query.teamId !== undefined ? Number(req.query.teamId) : undefined;
  const decision = authorize({
    actor: actorFromRequest(req),
    policyKind: 'audit',
    resource: 'audit_log',
    action: 'read',
    scope: { teamId: teamIdParam }
  });

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const cursor = typeof req.query.cursor === 'string' ? decodeCursor(req.query.cursor) : null;

  let rows: AuditRow[];
  if (decision.viewerTeamId != null) {
    rows = (cursor
      ? db.prepare('SELECT * FROM audit_log WHERE team_id = ? AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(decision.viewerTeamId, cursor[0], cursor[1], limit)
      : db.prepare('SELECT * FROM audit_log WHERE team_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(decision.viewerTeamId, limit)) as unknown as AuditRow[];
  } else {
    rows = (cursor
      ? db.prepare('SELECT * FROM audit_log WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(cursor[0], cursor[1], limit)
      : db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ?').all(limit)) as unknown as AuditRow[];
  }

  const entries = rows.map((row) => {
    if (decision.projection === 'team_detail') {
      return {
        id: row.id, actorUserId: row.actor_user_id, teamId: row.team_id, action: row.action,
        target: row.target, payload: JSON.parse(row.payload), createdAt: row.created_at
      };
    }
    // Admin: metadata thôi, không lộ payload (FR-11a).
    return { id: row.id, actorUserId: row.actor_user_id, teamId: row.team_id, action: row.action, createdAt: row.created_at };
  });

  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit && last ? encodeCursor(last.created_at, last.id) : null;
  res.json({ entries, nextCursor });
});

export default router;
