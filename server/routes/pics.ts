import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { sendRouteError, parseIdList, HttpError } from '../lib/utils.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';

// CR-20260913 Lát 4 (§6.3, Council review run e6cd1c8c phát hiện lỗ hổng thật — không phải chi tiết kỹ
// thuật nhỏ, xem docs/exchanges/2026-09-22.md): trước bản sửa này cả 5 route KHÔNG có requireSession/
// authorize()/team scoping — ai gọi tới server, kể cả chưa đăng nhập, đều đọc/tạo/sửa/xoá được PIC của
// MỌI team. Bảng `pics` giờ chỉ còn là dữ liệu lịch sử chỉ-đọc (không còn là nguồn chọn người — đổi tên
// KHÔNG còn lan sang projects.pic/project_tasks.assignee, 2 cột đó đã có nguồn tính riêng ở mappers.ts/
// weekly-report.ts). Route vẫn giữ POST/PATCH/PATCH reorder/DELETE (không xoá tính năng) nhưng giới hạn
// Leader-only — GIẢ ĐỊNH cần Leader xác nhận lại: PIC không còn tạo mới tự do cho nghiệp vụ hiện tại,
// nhưng Leader có thể vẫn cần sửa nhãn/màu lịch sử cũ, nên không khoá chết toàn bộ quyền ghi.
const router = Router();

function parseTeamIdParam(raw: unknown): number {
  const teamId = Number(raw);
  if (!Number.isInteger(teamId)) throw new HttpError(400, 'teamId không hợp lệ');
  return teamId;
}

// Chỉ nhận mã màu hex hợp lệ (#rgb / #rrggbb) để tránh lưu rác
function normColor(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : null;
}

function mapPic(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    color: row.color == null ? null : String(row.color),
    sortOrder: Number(row.sort_order || 0),
  };
}

// Tập tên PIC đang gắn cho task CHƯA hoàn thành (tien_do < 100) CỦA ĐÚNG TEAM, gồm cả phân công theo
// giai đoạn. assignee là chuỗi "A, B" nên phải tách phần tử để so khớp chính xác (tránh "An" khớp "Anh").
//
// CR-20260913 Lát 4 (§6.3): `project_task_assignments.pic` (chuỗi tự do) đã rebuild thành `user_id`
// (User thật, không phải chuỗi PIC) + `legacy_pic_label` (nhãn cũ chỉ-đọc sau di trú, `user_id` NULL).
// `pics` giờ chỉ còn là dữ liệu lịch sử chỉ-đọc (không còn là nguồn chọn người) — nên chỉ còn dòng
// LEGACY (`legacy_pic_label`) mới có thể khớp tên PIC; dòng đã gán User thật không khớp theo tên nữa.
// `project_tasks` giờ có `team_id` thật — team_id == null (chưa từng xảy ra sau di trú, phòng hờ) thì
// coi như không có task nào đang dùng, không bind NULL vào tham số SQL.
function picsConTaskChuaXong(teamId: number | null): Set<string> {
  const used = new Set<string>();
  if (teamId == null) return used;
  const taskRows = db.prepare("SELECT assignee FROM project_tasks WHERE team_id = ? AND tien_do < 100 AND assignee IS NOT NULL AND assignee <> ''").all(teamId) as { assignee: string }[];
  for (const r of taskRows) r.assignee.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => used.add(n));
  const assignRows = db.prepare(`
    SELECT DISTINCT a.legacy_pic_label AS legacy_pic_label
    FROM project_task_assignments a JOIN project_tasks t ON t.id = a.project_task_id
    WHERE t.team_id = ? AND t.tien_do < 100 AND a.legacy_pic_label IS NOT NULL AND a.legacy_pic_label <> ''
  `).all(teamId) as { legacy_pic_label: string }[];
  for (const r of assignRows) if (r.legacy_pic_label) used.add(r.legacy_pic_label.trim());
  return used;
}

// GET — Leader+Member xem đúng team mình. teamId bắt buộc qua query, giống GET /projects (§6.2): actor
// KHÔNG có "team hiện tại" ngầm định nào trong session/req.user — mọi route Lát 4 khác (projects.ts,
// weekly.ts) đều để client tự truyền teamId rồi authorize() xác nhận actor thật sự là thành viên, không
// có cơ chế nào khác đã có sẵn trong repo để suy ra team từ actor một mình.
router.get('/pics', requireSession, requireActiveAccount, (req, res) => {
  const teamId = parseTeamIdParam(req.query.teamId);
  authorize({ actor: actorFromRequest(req), policyKind: 'team_feature', resource: 'pic', action: 'list', scope: { teamId } });
  const rows = db.prepare('SELECT * FROM pics WHERE team_id = ? ORDER BY sort_order ASC, id ASC').all(teamId) as Record<string, unknown>[];
  const dangDung = picsConTaskChuaXong(teamId);
  res.json(rows.map((r) => ({ ...mapPic(r), dangSuDung: dangDung.has(String(r.name)) })));
});

router.post('/pics', requireSession, requireActiveAccount, (req, res) => {
  const body = req.body as { name?: string; color?: string; teamId?: number | string };
  const teamId = parseTeamIdParam(body.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'pic', action: 'create', scope: { teamId } });

  const name = body.name?.trim();
  if (!name) return res.status(400).json({ message: 'Tên PIC là bắt buộc' });
  // QA-2026-09-12 (xác nhận với người dùng): kiểm trùng KHÔNG phân biệt hoa/thường — "Nam" và "nam"
  // coi là cùng 1 người, tránh gõ nhầm case tạo ra 2 PIC trùng nhau trong dropdown. Kiểm TOÀN CỤC (không
  // scoped theo team) vì cột `name` vẫn là UNIQUE toàn bảng (server/schema/pic.ts, không đổi ở bản sửa
  // này — nằm ngoài phạm vi lỗ hổng phân quyền đang xử lý).
  const existing = db.prepare('SELECT id FROM pics WHERE LOWER(name) = LOWER(?)').get(name);
  if (existing) return res.status(400).json({ message: 'PIC này đã tồn tại' });

  const now = new Date().toISOString();
  const next = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pics WHERE team_id = ?').get(teamId) as { n: number }).n;
  const color = normColor(body.color);
  const result = db.prepare('INSERT INTO pics (name, color, team_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(name, color, teamId, next, now, now);
  const newId = Number(result.lastInsertRowid);
  writeAudit(actor.userId, teamId, 'pic.create', `pic:${newId}`, { name, color });
  const row = db.prepare('SELECT * FROM pics WHERE id = ?').get(newId) as Record<string, unknown>;
  res.status(201).json(mapPic(row));
});

router.patch('/pics/reorder', requireSession, requireActiveAccount, (req, res) => {
  const body = req.body as { teamId?: number | string; picIds?: Array<string | number> };
  const teamId = parseTeamIdParam(body.teamId);
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'pic', action: 'reorder', scope: { teamId } });

  const ids = parseIdList(body.picIds);
  if (!ids || ids.length === 0) {
    return res.status(400).json({ message: 'Thứ tự PIC không hợp lệ' });
  }
  // Chặn actor gửi lẫn id PIC của team khác vào mảng thứ tự — trước đây route áp index bừa lên bất kỳ
  // id nào client gửi, không kiểm id có thuộc team này không.
  const existingRows = db.prepare('SELECT id FROM pics WHERE team_id = ?').all(teamId) as { id: number }[];
  const existingIds = existingRows.map((r) => r.id);
  const existingSet = new Set(existingIds);
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length || uniqueIds.length !== existingIds.length || uniqueIds.some((id) => !existingSet.has(id))) {
    return res.status(400).json({ message: 'Danh sách PIC không khớp' });
  }

  const now = new Date().toISOString();
  const upd = db.prepare('UPDATE pics SET sort_order = ?, updated_at = ? WHERE id = ? AND team_id = ?');
  withTransaction(() => {
    ids.forEach((id, index) => upd.run(index + 1, now, id, teamId));
    writeAudit(actor.userId, teamId, 'pic.reorder', `team:${teamId}`, { picIds: ids });
  });
  const rows = db.prepare('SELECT * FROM pics WHERE team_id = ? ORDER BY sort_order ASC, id ASC').all(teamId) as Record<string, unknown>[];
  res.json(rows.map(mapPic));
});

router.patch('/pics/:id', requireSession, requireActiveAccount, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'PIC không hợp lệ' });
  const pic = db.prepare('SELECT * FROM pics WHERE id = ?').get(id) as { name: string; team_id: number | null } | undefined;
  if (!pic) return res.status(404).json({ message: 'Không tìm thấy PIC' });
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'pic', action: 'update', scope: { teamId: pic.team_id ?? undefined } });

  const body = req.body as { name?: string; color?: string | null };
  const hasName = body.name !== undefined;
  const hasColor = body.color !== undefined;
  if (!hasName && !hasColor) return res.status(400).json({ message: 'Không có gì để cập nhật' });

  // QA-2026-09-12: validate HẾT (tên trống, tên trùng) TRƯỚC KHI ghi bất kỳ gì — trước đây cập nhật
  // màu chạy trước rồi mới kiểm trùng tên, nên gửi {name trùng, color mới} khiến màu bị lưu THẬT dù
  // response trả về 400 (client tưởng không có gì xảy ra). Tái hiện được qua HTTP thật.
  let name: string | undefined;
  if (hasName) {
    name = body.name?.trim();
    if (!name) return res.status(400).json({ message: 'Tên PIC là bắt buộc' });
    const dup = db.prepare('SELECT id FROM pics WHERE LOWER(name) = LOWER(?) AND id <> ?').get(name, id);
    if (dup) return res.status(400).json({ message: 'PIC này đã tồn tại' });
  }

  const now = new Date().toISOString();
  try {
    withTransaction(() => {
      if (hasColor) {
        db.prepare('UPDATE pics SET color = ?, updated_at = ? WHERE id = ?').run(normColor(body.color), now, id);
      }
      // CR-20260913 Lát 4 (§6.3, Council review): đổi tên PIC KHÔNG còn lan sang projects.pic/
      // project_tasks.assignee — 2 cột đó chỉ do server tự tính (deriveLeafFromAssignments ở
      // mappers.ts, weekly-report.ts), PIC ghi tay vào đó là ghi đè cơ chế cache, không phải nguồn
      // sự thật. Đổi tên giờ chỉ đổi đúng bảng `pics`.
      if (hasName && name !== undefined) {
        db.prepare('UPDATE pics SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
      }
      writeAudit(actor.userId, pic.team_id, 'pic.update', `pic:${id}`, { name, color: hasColor ? body.color : undefined });
    });
  } catch (error) {
    return sendRouteError(res, error, 'Không thể cập nhật PIC');
  }

  const row = db.prepare('SELECT * FROM pics WHERE id = ?').get(id) as Record<string, unknown>;
  res.json(mapPic(row));
});

// Xóa khỏi danh sách chọn; chỉ cho xóa khi PIC không còn task nào chưa hoàn thành (đúng team).
router.delete('/pics/:id', requireSession, requireActiveAccount, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'PIC không hợp lệ' });
  const pic = db.prepare('SELECT name, team_id FROM pics WHERE id = ?').get(id) as { name: string; team_id: number | null } | undefined;
  if (!pic) return res.status(404).json({ message: 'Không tìm thấy PIC' });
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'pic', action: 'delete', scope: { teamId: pic.team_id ?? undefined } });

  if (picsConTaskChuaXong(pic.team_id).has(pic.name)) {
    return res.status(400).json({ message: 'Không thể xóa: PIC này còn task chưa hoàn thành.' });
  }
  db.prepare('DELETE FROM pics WHERE id = ?').run(id);
  writeAudit(actor.userId, pic.team_id, 'pic.delete', `pic:${id}`, { name: pic.name });
  res.json({ ok: true });
});

export default router;
