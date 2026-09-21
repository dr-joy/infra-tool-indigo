import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { HttpError, sendRouteError } from '../lib/utils.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';

// Lát 3 — Admin cấu hình tầng 2 (feature-visibility, FR-7/FR-7a) và vai điều phối Release (FR-9,
// chỉ phần "chọn team điều phối" — phần "Leader team điều phối dùng quyền điều phối" là Lát 6).
const router = Router();

// ── GET/PATCH /admin/feature-visibility — tầng 2, đúng 2 mức off/on ─────────────────
router.get('/admin/feature-visibility', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'feature_visibility', action: 'read', scope: {} });
  const rows = db.prepare(`
    SELECT team_id, feature, level, row_version, updated_at FROM team_feature_visibility ORDER BY team_id, feature
  `).all();
  res.json({ visibility: rows });
});

interface VisibilityBody {
  teamId?: number;
  feature?: string;
  level?: string;
  rowVersion?: number;
}

router.patch('/admin/feature-visibility', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'feature_visibility', action: 'update', scope: {} });
  const body = req.body as VisibilityBody;
  const teamId = Number(body.teamId);
  const feature = body.feature;
  const level = body.level;
  const validFeatures = ['personal_task', 'project', 'weekly_report', 'release', 'mind_map'];
  if (!Number.isInteger(teamId)) return res.status(400).json({ message: 'teamId không hợp lệ' });
  if (!feature || !validFeatures.includes(feature)) return res.status(400).json({ message: 'feature không hợp lệ' });
  if (level !== 'off' && level !== 'on') return res.status(400).json({ message: 'level phải là off hoặc on' });

  try {
    withTransaction(() => {
      const now = new Date().toISOString();
      const updated = db.prepare(`
        UPDATE team_feature_visibility SET level = ?, updated_at = ?, updated_by = ?, row_version = row_version + 1
        WHERE team_id = ? AND feature = ? AND row_version = ?
      `).run(level, now, req.user!.id, teamId, feature, body.rowVersion ?? -1);
      if (updated.changes === 0) throw new HttpError(409, 'Có người vừa đổi cấu hình này, vui lòng tải lại', 'VERSION_CONFLICT');
      writeAudit(req.user!.id, teamId, 'feature_visibility.update', `team:${teamId}:${feature}`, { feature, level });

      // FR-7a: tắt project -> tự tắt weekly_report CÙNG transaction, kèm audit riêng cho hệ quả cascade.
      // KHÔNG tự bật lại weekly_report khi bật lại project (bất biến 1 chiều).
      if (feature === 'project' && level === 'off') {
        const cascaded = db.prepare(`
          UPDATE team_feature_visibility SET level = 'off', updated_at = ?, updated_by = ?, row_version = row_version + 1
          WHERE team_id = ? AND feature = 'weekly_report' AND level = 'on'
        `).run(now, req.user!.id, teamId);
        if (cascaded.changes > 0) {
          writeAudit(req.user!.id, teamId, 'feature_visibility.cascade_off', `team:${teamId}:weekly_report`, {
            reason: 'project bị tắt', feature: 'weekly_report'
          });
        }
      }
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không sửa được cấu hình hiển thị');
  }
});

// ── GET/PUT /admin/release-coordinator — chọn team điều phối Release (FR-9) ─────────
// Resource 'release_coordinator_config' — KHÁC 'release_coordinator' (tên dành riêng cho bước 4 của
// authorize(), dùng ở Lát 6 để kiểm actor CÓ PHẢI Leader điều phối — không áp cho route Admin cấu hình
// này, vì Admin không cần là Leader của team đang được/sẽ được chỉ định).
router.get('/admin/release-coordinator', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'release_coordinator_config', action: 'read', scope: {} });
  const row = db.prepare('SELECT release_coordinator_team_id, row_version FROM app_config WHERE id = 1').get();
  res.json(row);
});

router.put('/admin/release-coordinator', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'release_coordinator_config', action: 'update', scope: {} });
  const body = req.body as { teamId?: number; rowVersion?: number };
  const teamId = Number(body.teamId);
  if (!Number.isInteger(teamId)) return res.status(400).json({ message: 'teamId không hợp lệ' });
  if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) {
    return res.status(404).json({ message: 'Không tìm thấy team' });
  }

  try {
    withTransaction(() => {
      const result = db.prepare(`
        UPDATE app_config SET release_coordinator_team_id = ?, updated_at = ?, row_version = row_version + 1
        WHERE id = 1 AND row_version = ?
      `).run(teamId, new Date().toISOString(), body.rowVersion ?? -1);
      if (result.changes === 0) {
        throw new HttpError(409, 'Có người vừa đổi cấu hình này, vui lòng tải lại', 'VERSION_CONFLICT');
      }
      writeAudit(req.user!.id, teamId, 'release_coordinator.change', `team:${teamId}`, { teamId });
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không đổi được team điều phối');
  }
});

export default router;
