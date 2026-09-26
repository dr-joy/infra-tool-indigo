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

// ── GET/PUT /admin/release-task-autogen — bật/tắt riêng "Tab cá nhân" cho từng team (FR-28a) ────
// Điều kiện bắt buộc (route KHÔNG tự enforce ở đây, chỉ báo rõ cho FE): chỉ có tác dụng khi Task cá
// nhân (`personal_task`) đang Bật cho ĐÚNG team đó — kiểm tra thật nằm ở 2 route sinh task cá nhân
// khẩn cấp/định kỳ (server/routes/release-schedule.ts, gọi assertTeamFeatureOn() từ
// server/lib/authorize.ts), vì đây là hành vi lúc DÙNG, không phải lúc CẤU HÌNH. Vá lỗ hổng Council
// review vòng 2 (2026-09-23): trước đó lời hứa này KHÔNG được thực hiện thật — 2 route đó chỉ kiểm
// personal_task Bật cho MỘT team BẤT KỲ của actor (qua policyKind 'personal_task'), không lọc riêng
// đúng teamId đang thao tác.
router.get('/admin/release-task-autogen', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'release_task_autogen_setting', action: 'read', scope: {} });
  const rows = db.prepare(`
    SELECT team_id, enabled, row_version, updated_at FROM team_release_task_autogen_settings ORDER BY team_id
  `).all();
  res.json({ settings: rows });
});

router.put('/admin/release-task-autogen', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'release_task_autogen_setting', action: 'update', scope: {} });
  const body = req.body as { teamId?: number; enabled?: boolean; rowVersion?: number };
  const teamId = Number(body.teamId);
  if (!Number.isInteger(teamId)) return res.status(400).json({ message: 'teamId không hợp lệ' });
  if (typeof body.enabled !== 'boolean') return res.status(400).json({ message: 'enabled phải là boolean' });
  if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) return res.status(404).json({ message: 'Không tìm thấy team' });

  try {
    withTransaction(() => {
      const now = new Date().toISOString();
      const existing = db.prepare('SELECT row_version FROM team_release_task_autogen_settings WHERE team_id = ?').get(teamId) as { row_version: number } | undefined;
      if (!existing) {
        db.prepare(`
          INSERT INTO team_release_task_autogen_settings (team_id, enabled, updated_at, updated_by, row_version) VALUES (?, ?, ?, ?, 1)
        `).run(teamId, body.enabled ? 1 : 0, now, req.user!.id);
      } else {
        const updated = db.prepare(`
          UPDATE team_release_task_autogen_settings SET enabled = ?, updated_at = ?, updated_by = ?, row_version = row_version + 1
          WHERE team_id = ? AND row_version = ?
        `).run(body.enabled ? 1 : 0, now, req.user!.id, teamId, body.rowVersion ?? -1);
        if (updated.changes === 0) throw new HttpError(409, 'Có người vừa đổi cấu hình này, vui lòng tải lại', 'VERSION_CONFLICT');
      }
      writeAudit(req.user!.id, teamId, 'release_task_autogen_setting.update', `team:${teamId}`, { enabled: body.enabled });
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không đổi được cấu hình Tab cá nhân');
  }
});

// ── GET/PUT /admin/release-personal-area-users — bật/tắt riêng "vùng cá nhân" Release cho TỪNG USER
// (2026-09-26, docs/exchanges/2026-09-26.md) — KHÁC 'release-task-autogen' ở trên (theo từng TEAM).
// Chỉ liệt kê user thuộc ÍT NHẤT 1 team đã đủ 3 cờ (release + personal_task + autogen team) — user
// không thuộc team nào đủ điều kiện thì Admin không thấy/không sửa được gì cho họ ở đây (đúng yêu cầu
// "không phải user nào cũng setting được"). Xem server/lib/authorize.ts:assertPersonalReleaseAreaEnabled()
// cho phía enforce thật.
router.get('/admin/release-personal-area-users', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'release_personal_area_pref', action: 'read', scope: {} });
  const rows = db.prepare(`
    SELECT DISTINCT u.id, u.email, u.display_name, u.avatar,
      COALESCE(p.enabled, 0) as enabled, COALESCE(p.row_version, 0) as row_version
    FROM users u
    JOIN team_members tm ON tm.user_id = u.id
    JOIN team_release_task_autogen_settings a ON a.team_id = tm.team_id AND a.enabled = 1
    JOIN team_feature_visibility rv ON rv.team_id = tm.team_id AND rv.feature = 'release' AND rv.level = 'on'
    JOIN team_feature_visibility pv ON pv.team_id = tm.team_id AND pv.feature = 'personal_task' AND pv.level = 'on'
    LEFT JOIN user_release_personal_area_pref p ON p.user_id = u.id
    ORDER BY u.display_name
  `).all();
  res.json({ users: rows });
});

// "Không phải user nào cũng setting được" (yêu cầu trực tiếp, docs/exchanges/2026-09-26.md) — PUT tự
// chặn user chưa đủ 3 điều kiện team (release + personal_task + autogen), không chỉ ẩn ở danh sách GET.
function isEligibleForPersonalArea(userId: number): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM team_members tm
    JOIN team_release_task_autogen_settings a ON a.team_id = tm.team_id AND a.enabled = 1
    JOIN team_feature_visibility rv ON rv.team_id = tm.team_id AND rv.feature = 'release' AND rv.level = 'on'
    JOIN team_feature_visibility pv ON pv.team_id = tm.team_id AND pv.feature = 'personal_task' AND pv.level = 'on'
    WHERE tm.user_id = ?
  `).get(userId));
}

router.put('/admin/release-personal-area-pref', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'release_personal_area_pref', action: 'update', scope: {} });
  const body = req.body as { userId?: number; enabled?: boolean; rowVersion?: number };
  const userId = Number(body.userId);
  if (!Number.isInteger(userId)) return res.status(400).json({ message: 'userId không hợp lệ' });
  if (typeof body.enabled !== 'boolean') return res.status(400).json({ message: 'enabled phải là boolean' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return res.status(404).json({ message: 'Không tìm thấy user' });
  if (!isEligibleForPersonalArea(userId)) {
    return res.status(404).json({ message: 'User chưa thuộc team nào đủ điều kiện (release + personal_task + autogen)' });
  }

  try {
    withTransaction(() => {
      const now = new Date().toISOString();
      const existing = db.prepare('SELECT row_version FROM user_release_personal_area_pref WHERE user_id = ?').get(userId) as { row_version: number } | undefined;
      if (!existing) {
        db.prepare(`
          INSERT INTO user_release_personal_area_pref (user_id, enabled, updated_at, updated_by, row_version) VALUES (?, ?, ?, ?, 1)
        `).run(userId, body.enabled ? 1 : 0, now, req.user!.id);
      } else {
        const updated = db.prepare(`
          UPDATE user_release_personal_area_pref SET enabled = ?, updated_at = ?, updated_by = ?, row_version = row_version + 1
          WHERE user_id = ? AND row_version = ?
        `).run(body.enabled ? 1 : 0, now, req.user!.id, userId, body.rowVersion ?? -1);
        if (updated.changes === 0) throw new HttpError(409, 'Có người vừa đổi cấu hình này, vui lòng tải lại', 'VERSION_CONFLICT');
      }
      writeAudit(req.user!.id, null, 'release_personal_area_pref.update', `user:${userId}`, { enabled: body.enabled });
    });
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không đổi được quyền dùng vùng cá nhân');
  }
});

export default router;
