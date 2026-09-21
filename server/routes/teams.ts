import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { HttpError, sendRouteError } from '../lib/utils.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';

// Lát 3 (FR-6, FR-12) — Admin quản lý team/Leader (toàn cục, policyKind 'team_feature' với
// scope.teamId bỏ trống), Leader/Member tự quản thành viên đúng team mình (scope.teamId thật).
const router = Router();

const FEATURES = ['personal_task', 'project', 'weekly_report', 'release', 'mind_map'] as const;

interface TeamRow {
  id: number;
  name: string;
  description: string | null;
  row_version: number;
  created_at: string;
}

function encodeCursor(name: string, id: number): string {
  return Buffer.from(JSON.stringify([name, id])).toString('base64url');
}
function decodeCursor(cursor: string): [string, number] | null {
  try {
    const [name, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return typeof name === 'string' && Number.isInteger(id) ? [name, id] : null;
  } catch {
    return null;
  }
}

// ── GET /admin/teams — Admin liệt kê toàn bộ team ───────────────────────────────────
router.get('/admin/teams', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'team', action: 'list', scope: {} });
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const cursor = typeof req.query.cursor === 'string' ? decodeCursor(req.query.cursor) : null;
  const rows = (cursor
    ? db.prepare('SELECT * FROM teams WHERE (name, id) > (?, ?) ORDER BY name, id LIMIT ?').all(cursor[0], cursor[1], limit)
    : db.prepare('SELECT * FROM teams ORDER BY name, id LIMIT ?').all(limit)) as unknown as TeamRow[];
  const nextCursor = rows.length === limit ? encodeCursor(rows[rows.length - 1].name, rows[rows.length - 1].id) : null;
  res.json({ teams: rows, nextCursor });
});

// ── POST /admin/teams — tạo team mới, seed đủ 5 dòng feature-visibility off (fail-closed) ─────────
router.post('/admin/teams', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'team', action: 'create', scope: {} });
  const body = req.body as { name?: string; description?: string };
  const name = (body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Tên team là bắt buộc' });

  try {
    const teamId = withTransaction(() => {
      const now = new Date().toISOString();
      const result = db.prepare('INSERT INTO teams (name, description, created_at) VALUES (?, ?, ?)')
        .run(name, body.description || null, now);
      const id = Number(result.lastInsertRowid);
      const insertVisibility = db.prepare(`
        INSERT INTO team_feature_visibility (team_id, feature, level, updated_at) VALUES (?, ?, 'off', ?)
      `);
      for (const feature of FEATURES) insertVisibility.run(id, feature, now);
      writeAudit(req.user!.id, id, 'team.create', `team:${id}`, { name, description: body.description || null });
      return id;
    });
    res.status(201).json({ id: teamId });
  } catch (error) {
    // UNIQUE(name) -> tên team đã tồn tại (không có kho idempotency-key thật ở Lát 3, dựa vào
    // ràng buộc unique để chặn double-click tạo trùng).
    if (error instanceof Error && /UNIQUE/.test(error.message)) {
      return res.status(409).json({ message: 'Tên team này đã tồn tại' });
    }
    sendRouteError(res, error, 'Không tạo được team');
  }
});

// ── PATCH /admin/teams/:id — sửa tên/mô tả ──────────────────────────────────────────
router.patch('/admin/teams/:id', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'team', action: 'update', scope: {} });
  const id = Number(req.params.id);
  const body = req.body as { name?: string; description?: string; rowVersion?: number };
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });

  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name.trim()); }
  if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description); }
  if (fields.length === 0) return res.status(400).json({ message: 'Không có gì để sửa' });
  fields.push('row_version = row_version + 1');

  try {
    withTransaction(() => {
      const result = db.prepare(`UPDATE teams SET ${fields.join(', ')} WHERE id = ? AND row_version = ?`)
        .run(...values, id, body.rowVersion ?? -1);
      if (result.changes === 0) {
        throw new HttpError(409, 'Có người vừa sửa team này, vui lòng tải lại', 'VERSION_CONFLICT');
      }
      writeAudit(req.user!.id, id, 'team.update', `team:${id}`, { name: body.name, description: body.description });
    });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/.test(error.message)) {
      return res.status(409).json({ message: 'Tên team này đã tồn tại' });
    }
    sendRouteError(res, error, 'Không sửa được team');
  }
});

// ── POST /admin/teams/:id/leader — thay Leader, nguyên tử (gỡ Leader cũ + gán mới cùng transaction) ──
router.post('/admin/teams/:id/leader', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'team', action: 'change_leader', scope: {} });
  const id = Number(req.params.id);
  const body = req.body as { userId?: number; rowVersion?: number };
  const newLeaderId = Number(body.userId);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });
  if (!Number.isInteger(newLeaderId)) return res.status(400).json({ message: 'userId không hợp lệ' });

  try {
    withTransaction(() => {
      const team = db.prepare('SELECT row_version FROM teams WHERE id = ?').get(id) as { row_version: number } | undefined;
      if (!team) throw new HttpError(404, 'Không tìm thấy team');
      const membership = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(id, newLeaderId);
      if (!membership) throw new HttpError(400, 'Người được chỉ định phải đang là thành viên của team này');

      // KHÔNG fallback về team.row_version vừa đọc (tự khớp mọi lần, vô hiệu hoá optimistic
      // concurrency khi client quên gửi rowVersion) — dùng -1 giống mọi route row_version khác, ép
      // client phải gửi đúng giá trị (Council review run e8d20dc3, phát hiện độc lập cả 2 agent).
      const updated = db.prepare('UPDATE teams SET row_version = row_version + 1 WHERE id = ? AND row_version = ?')
        .run(id, body.rowVersion ?? -1);
      if (updated.changes === 0) throw new HttpError(409, 'Có người vừa thay đổi team này, vui lòng tải lại', 'VERSION_CONFLICT');

      db.prepare("UPDATE team_members SET role = 'member' WHERE team_id = ? AND role = 'leader'").run(id);
      db.prepare("UPDATE team_members SET role = 'leader' WHERE team_id = ? AND user_id = ?").run(id, newLeaderId);
      writeAudit(req.user!.id, id, 'team.leader_change', `team:${id}`, { newLeaderId });
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không đổi được Leader');
  }
});

// ── GET /me/teams — actor tự xem team mình thuộc, kèm role ─────────────────────────
router.get('/me/teams', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'team_member', action: 'list_own', scope: {} });
  const rows = db.prepare(`
    SELECT t.id, t.name, t.description, tm.role
    FROM team_members tm JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ? ORDER BY t.name
  `).all(req.user!.id);
  res.json({ teams: rows });
});

// ── GET/POST/DELETE /teams/:teamId/members — Leader tự quản, Member cũng xem được (Leader quyết 19/09) ──
router.get('/teams/:teamId/members', requireSession, requireActiveAccount, (req, res) => {
  const teamId = Number(req.params.teamId);
  if (!Number.isInteger(teamId)) return res.status(400).json({ message: 'teamId không hợp lệ' });
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'team_member', action: 'list', scope: { teamId } });
  const rows = db.prepare(`
    SELECT u.id, u.email, u.display_name, u.avatar, tm.role
    FROM team_members tm JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ? ORDER BY tm.role, u.display_name
  `).all(teamId);
  res.json({ members: rows });
});

router.post('/teams/:teamId/members', requireSession, requireActiveAccount, (req, res) => {
  const teamId = Number(req.params.teamId);
  const body = req.body as { userId?: number };
  const userId = Number(body.userId);
  if (!Number.isInteger(teamId)) return res.status(400).json({ message: 'teamId không hợp lệ' });
  if (!Number.isInteger(userId)) return res.status(400).json({ message: 'userId không hợp lệ' });
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'team_member', action: 'create', scope: { teamId } });

  // FR-12: chỉ thêm được người ĐÃ TỪNG đăng nhập (đã tồn tại trong users), không tạo tài khoản hộ.
  const user = db.prepare("SELECT status FROM users WHERE id = ?").get(userId) as { status: string } | undefined;
  if (!user) return res.status(404).json({ message: 'Người này chưa từng đăng nhập vào hệ thống' });

  try {
    withTransaction(() => {
      db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").run(teamId, userId);
      writeAudit(req.user!.id, teamId, 'team_member.add', `user:${userId}`, { teamId, userId });
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    if (error instanceof Error && /UNIQUE|PRIMARY KEY/.test(error.message)) {
      return res.status(409).json({ message: 'Người này đã là thành viên của team' });
    }
    sendRouteError(res, error, 'Không thêm được thành viên');
  }
});

router.delete('/teams/:teamId/members/:userId', requireSession, requireActiveAccount, (req, res) => {
  const teamId = Number(req.params.teamId);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(teamId) || !Number.isInteger(userId)) return res.status(400).json({ message: 'Tham số không hợp lệ' });
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'team_member', action: 'delete', scope: { teamId } });

  try {
    withTransaction(() => {
      const result = db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, userId);
      if (result.changes === 0) throw new HttpError(404, 'Người này không phải thành viên của team');
      writeAudit(req.user!.id, teamId, 'team_member.remove', `user:${userId}`, { teamId, userId });
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không xoá được thành viên');
  }
});

export default router;
