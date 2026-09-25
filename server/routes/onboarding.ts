import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { HttpError, sendRouteError } from '../lib/utils.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';
import { provisionTeam } from '../lib/team-provisioning.js';

// FR-2/FR-3/FR-3a — chọn team lúc đăng nhập lần đầu, Admin duyệt/từ chối, không cấp quyền nghiệp vụ
// nào cho tới khi được duyệt (users.status chuyển active). `teams`/`team_members` ở đây là bản kéo
// sớm tối thiểu từ Lát 3 (xem server/schema/auth.ts). URL: /api/onboarding/* (chủ thể là user đang
// onboarding) và /api/admin/join-requests* (chủ thể là Admin) — đúng access class tách riêng ở CR §6.2.
const router = Router();

router.get('/teams', requireSession, (_req, res) => {
  const rows = db.prepare('SELECT id, name, description FROM teams ORDER BY name').all();
  res.json({ teams: rows });
});

// FE cần biết "user pending này đã từng gửi đơn xin tham gia team chưa" để dựng đúng màn (CR §6.1:
// có đơn đang chờ -> "Đang chờ duyệt", hiện lại team/vai trò đã xin; chưa có/đã bị từ chối (FR-3a,
// không phải khoá vĩnh viễn) -> "Chọn team và vai trò"). Không có route nào khác trả về thông tin
// này cho CHÍNH user đó (chỉ có /admin/join-requests dành cho Admin) — bổ sung nhỏ, chỉ đọc, cùng
// access class `onboarding` (chủ thể là chính user), giữ đúng unique index (user_id) WHERE
// status='pending' -> tối đa 1 dòng.
router.get('/onboarding/my-join-request', requireSession, (req, res) => {
  const row = db.prepare(`
    SELECT jr.id, jr.requested_team_id, jr.requested_role, t.name AS team_name
    FROM join_requests jr JOIN teams t ON t.id = jr.requested_team_id
    WHERE jr.user_id = ? AND jr.status = 'pending'
  `).get(req.user!.id) as { id: number; requested_team_id: number; requested_role: string; team_name: string } | undefined;
  if (!row) return res.json({ joinRequest: null });
  res.json({
    joinRequest: {
      id: row.id,
      teamId: row.requested_team_id,
      teamName: row.team_name,
      role: row.requested_role
    }
  });
});

interface JoinRequestBody {
  teamId?: number;
  newTeamName?: string;
  role?: string;
}

// 2026-09-25 (docs/exchanges/2026-09-25.md) — Admin bootstrap giờ cũng phải `pending` và đi qua đúng
// màn "Chọn team và vai trò" như user thường (trước đây bootstrap set 'active' ngay, bỏ qua bước này).
// 2 điểm KHÁC user thường, chỉ áp dụng khi actor CHÍNH LÀ Admin đang pending (tại thời điểm này chắc
// chắn là Admin bootstrap — không có đường nào khác để có system_role='admin' mà vẫn pending):
//   1. Được gửi `newTeamName` thay cho `teamId` để tự lập team đầu tiên (hệ thống mới tinh chưa có team
//      nào để chọn) — user thường KHÔNG được, giữ đúng FR-2 "không tự tạo team".
//   2. Đơn tự động DUYỆT NGAY trong cùng request (ghi thẳng team_members + users.status='active'),
//      không tạo dòng 'pending' chờ ai duyệt — vì chắc chắn không có Admin nào khác để duyệt hộ.
router.post('/onboarding/join-request', requireSession, (req, res) => {
  // FR-2 mô tả join-request là bước onboarding của "người đăng nhập lần đầu" — chỉ tài khoản
  // pending mới được gửi. User đã active muốn tham gia thêm team khác là nhu cầu Lát 3 (ngữ cảnh
  // team/authorize()), chưa có route riêng ở Lát 2 — từ chối rõ ràng thay vì âm thầm cho qua.
  if (req.user!.status !== 'pending') {
    return res.status(409).json({ message: 'Chỉ tài khoản đang chờ duyệt mới gửi được đơn xin tham gia team' });
  }
  const body = req.body as JoinRequestBody;
  const role = body.role;
  if (role !== 'leader' && role !== 'member') return res.status(400).json({ message: 'role phải là leader hoặc member' });

  const isBootstrapAdmin = req.user!.systemRole === 'admin';
  const newTeamName = typeof body.newTeamName === 'string' ? body.newTeamName.trim() : '';
  if (newTeamName && !isBootstrapAdmin) {
    return res.status(400).json({ message: 'Chỉ Admin mới lập được team mới ngay tại bước này — chọn 1 team có sẵn' });
  }

  let teamId = Number(body.teamId);
  if (!newTeamName) {
    if (!Number.isInteger(teamId)) return res.status(400).json({ message: 'teamId không hợp lệ' });
    const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.status(404).json({ message: 'Không tìm thấy team' });
  }

  try {
    const result = withTransaction(() => {
      const now = new Date().toISOString();

      if (newTeamName) {
        // Kiểm trước: để UNIQUE(teams.name) rơi xuống catch bên dưới sẽ bị báo nhầm thành "đã có đơn chờ".
        if (db.prepare('SELECT 1 FROM teams WHERE name = ?').get(newTeamName)) {
          throw new HttpError(409, 'Tên team này đã tồn tại — chọn team có sẵn hoặc đặt tên khác');
        }
        teamId = provisionTeam(db, newTeamName, null, now);
      }

      if (isBootstrapAdmin) {
        // Tự động duyệt — không tạo dòng 'pending' chờ ai (không ai duyệt được). Vẫn ghi join_requests
        // ở trạng thái 'approved' NGAY để giữ dấu vết lịch sử giống mọi đơn khác, không lặng lẽ bỏ qua.
        if (role === 'leader') {
          const hasLeader = db.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND role = 'leader'").get(teamId);
          if (hasLeader) throw new HttpError(409, 'Team này đã có Leader, không thể gán thêm', 'TEAM_ALREADY_HAS_LEADER');
        }
        const jr = db.prepare(`
          INSERT INTO join_requests (user_id, requested_team_id, requested_role, status, approved_team_id, approved_role, reviewed_by, reviewed_at, created_at)
          VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?)
        `).run(req.user!.id, teamId, role, teamId, role, req.user!.id, now, now);
        db.prepare("UPDATE users SET status = 'active', row_version = row_version + 1 WHERE id = ?").run(req.user!.id);
        db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(teamId, req.user!.id, role);
        writeAudit(req.user!.id, teamId, 'join_request.self_approve_bootstrap', `join_request:${jr.lastInsertRowid}`, {
          teamId, role, createdTeam: Boolean(newTeamName)
        });
        return { id: Number(jr.lastInsertRowid), autoApproved: true };
      }

      const result = db.prepare(`
        INSERT INTO join_requests (user_id, requested_team_id, requested_role, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
      `).run(req.user!.id, teamId, role, now);

      // FR-3: Admin nhận thông báo trong app ngay khi có yêu cầu tham gia mới — cùng transaction với
      // INSERT đơn, để không xảy ra "đơn đã tạo nhưng Admin không được báo" nếu 1 trong N lần ghi
      // thông báo lỗi giữa đường (Codex phát hiện lúc review — trước đó 2 việc này tách rời).
      const admins = db.prepare("SELECT id FROM users WHERE system_role = 'admin'").all() as { id: number }[];
      const insertNotif = db.prepare(`
        INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, 'join_request_created', ?, ?)
      `);
      const payload = JSON.stringify({ joinRequestId: result.lastInsertRowid, userId: req.user!.id, teamId, role });
      for (const admin of admins) insertNotif.run(admin.id, payload, now);
      return { id: Number(result.lastInsertRowid), autoApproved: false };
    });
    res.status(201).json(result);
  } catch (error) {
    // Unique index (user_id) WHERE status='pending' -> đã có đơn đang chờ.
    if (error instanceof Error && /UNIQUE/.test(error.message)) {
      return res.status(409).json({ message: 'Bạn đã có 1 đơn xin tham gia team đang chờ duyệt', code: 'JOIN_REQUEST_PENDING_EXISTS' });
    }
    sendRouteError(res, error, 'Không tạo được đơn xin tham gia team');
  }
});

// CR §6.2: 2 route duyệt/từ chối thuộc access class `admin`, không phải `onboarding` (chủ thể gọi là
// Admin, không phải user đang onboarding) — giữ đúng tiền tố /api/admin/... như CR đã liệt kê. Đi qua
// authorize() (Lát 3, policyKind 'team_feature' với scope.teamId bỏ trống -> xét system_role).
router.get('/admin/join-requests', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'join_request', action: 'list', scope: {} });
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
  approvedTeamId?: number;
  approvedRole?: string;
}

interface JoinRequestRow {
  id: number;
  user_id: number;
  requested_team_id: number;
  requested_role: string;
  approved_team_id: number | null;
  approved_role: string | null;
  status: string;
  row_version: number;
}

router.post('/admin/join-requests/:id/approve', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'join_request', action: 'approve', scope: {} });
  const id = Number(req.params.id);
  const body = req.body as ReviewBody;
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });

  try {
    const result = withTransaction(() => {
      const jr = db.prepare('SELECT * FROM join_requests WHERE id = ?').get(id) as JoinRequestRow | undefined;
      if (!jr) throw new HttpError(404, 'Không tìm thấy đơn xin tham gia team');

      // Semantic-idempotent (chốt qua Council f0a0e1bb): đơn ĐÃ approved gọi lại approve lần 2 trả
      // đúng trạng thái hiện tại, không lỗi — vd double-click hoặc client retry sau timeout mạng.
      if (jr.status === 'approved') {
        return { approvedTeamId: jr.approved_team_id, approvedRole: jr.approved_role };
      }
      if (jr.status !== 'pending') {
        throw new HttpError(409, 'Đơn này đã bị từ chối trước đó, không thể duyệt', 'JOIN_REQUEST_STALE');
      }

      // Admin có thể sửa team/vai trò ngay lúc duyệt (FR-3) — mặc định giữ đúng yêu cầu gốc.
      const approvedTeamId = Number.isInteger(body.approvedTeamId) ? Number(body.approvedTeamId) : jr.requested_team_id;
      const approvedRole = body.approvedRole === 'leader' || body.approvedRole === 'member' ? body.approvedRole : jr.requested_role;

      // teamId do Admin tự sửa tay lúc duyệt (không phải teamId gốc đã được kiểm ở lúc tạo đơn) —
      // phải xác nhận tồn tại trước khi ghi, không để lỗi khoá ngoại rơi thành 500 (Codex phát hiện).
      if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(approvedTeamId)) {
        throw new HttpError(404, 'Team được chọn để duyệt không tồn tại');
      }

      if (approvedRole === 'leader') {
        const hasLeader = db.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND role = 'leader'")
          .get(approvedTeamId);
        if (hasLeader) throw new HttpError(409, 'Team này đã có Leader, không thể gán thêm', 'TEAM_ALREADY_HAS_LEADER');
      }

      const now = new Date().toISOString();
      // KHÔNG fallback về jr.row_version vừa đọc (tự khớp mọi lần, vô hiệu hoá optimistic concurrency
      // khi client quên gửi rowVersion) — dùng -1 giống route reject, ép client phải gửi đúng giá trị
      // (Council review run e8d20dc3, phát hiện độc lập cả 2 agent).
      const updated = db.prepare(`
        UPDATE join_requests
        SET status = 'approved', approved_team_id = ?, approved_role = ?, reviewed_by = ?, reviewed_at = ?,
            row_version = row_version + 1
        WHERE id = ? AND row_version = ?
      `).run(approvedTeamId, approvedRole, req.user!.id, now, id, body.rowVersion ?? -1);
      if (updated.changes === 0) throw new HttpError(409, 'Đơn này vừa được xử lý bởi người khác, vui lòng tải lại', 'JOIN_REQUEST_STALE');

      db.prepare("UPDATE users SET status = 'active', row_version = row_version + 1 WHERE id = ?").run(jr.user_id);
      db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(approvedTeamId, jr.user_id, approvedRole);

      // FR-3: lần đầu sau khi được duyệt phải hiện popup xác nhận rõ team/vai trò -> ghi thông báo,
      // FE bắt buộc người dùng bấm "Đã hiểu" trước khi vào màn khác.
      db.prepare(`
        INSERT INTO notifications (user_id, kind, payload, created_at) VALUES (?, 'join_request_approved', ?, ?)
      `).run(jr.user_id, JSON.stringify({ teamId: approvedTeamId, role: approvedRole }), now);

      writeAudit(req.user!.id, approvedTeamId, 'join_request.approve', `join_request:${id}`, {
        userId: jr.user_id, approvedTeamId, approvedRole
      });
      return { approvedTeamId, approvedRole };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    sendRouteError(res, error, 'Không duyệt được đơn xin tham gia team');
  }
});

router.post('/admin/join-requests/:id/reject', requireSession, requireActiveAccount, (req, res) => {
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'join_request', action: 'reject', scope: {} });
  const id = Number(req.params.id);
  const body = req.body as { rowVersion?: number };
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });

  // Semantic-idempotent: đơn đã rejected gọi lại trả cùng kết quả, không lỗi.
  const existing = db.prepare('SELECT status FROM join_requests WHERE id = ?').get(id) as { status: string } | undefined;
  if (!existing) return res.status(404).json({ message: 'Không tìm thấy đơn xin tham gia team' });
  if (existing.status === 'rejected') return res.json({ ok: true });
  if (existing.status === 'approved') {
    return res.status(409).json({ message: 'Đơn này đã được duyệt trước đó, không thể từ chối', code: 'JOIN_REQUEST_STALE' });
  }

  try {
    withTransaction(() => {
      const now = new Date().toISOString();
      const result = db.prepare(`
        UPDATE join_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, row_version = row_version + 1
        WHERE id = ? AND status = 'pending' AND row_version = ?
      `).run(req.user!.id, now, id, body.rowVersion ?? -1);
      if (result.changes === 0) {
        throw new HttpError(409, 'Đơn này vừa được xử lý bởi người khác, vui lòng tải lại', 'JOIN_REQUEST_STALE');
      }
      writeAudit(req.user!.id, null, 'join_request.reject', `join_request:${id}`, {});
    });
    // FR-3a: không phải khoá vĩnh viễn — user.status vẫn là 'pending', lần đăng nhập kế tiếp tự quay
    // lại đúng màn "Chọn team và vai trò" (không có đơn pending nào -> FE tự hiện lại màn chọn team).
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Không từ chối được đơn xin tham gia team');
  }
});

export default router;
