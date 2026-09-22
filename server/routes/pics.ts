import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { sendRouteError, parseIdList } from '../lib/utils.js';

const router = Router();

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

// Tập tên PIC đang gắn cho task CHƯA hoàn thành (tien_do < 100), gồm cả phân công theo giai đoạn.
// assignee là chuỗi "A, B" nên phải tách phần tử để so khớp chính xác (tránh "An" khớp "Anh").
//
// CR-20260913 Lát 4 (§6.3): `project_task_assignments.pic` (chuỗi tự do) đã rebuild thành `user_id`
// (User thật, không phải chuỗi PIC) + `legacy_pic_label` (nhãn cũ chỉ-đọc sau di trú, `user_id` NULL).
// `pics` giờ chỉ còn là dữ liệu lịch sử chỉ-đọc (không còn là nguồn chọn người) — nên chỉ còn dòng
// LEGACY (`legacy_pic_label`) mới có thể khớp tên PIC; dòng đã gán User thật không khớp theo tên nữa.
function picsConTaskChuaXong(): Set<string> {
  const used = new Set<string>();
  const taskRows = db.prepare("SELECT assignee FROM project_tasks WHERE tien_do < 100 AND assignee IS NOT NULL AND assignee <> ''").all() as { assignee: string }[];
  for (const r of taskRows) r.assignee.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => used.add(n));
  const assignRows = db.prepare(`
    SELECT DISTINCT a.legacy_pic_label AS legacy_pic_label
    FROM project_task_assignments a JOIN project_tasks t ON t.id = a.project_task_id
    WHERE t.tien_do < 100 AND a.legacy_pic_label IS NOT NULL AND a.legacy_pic_label <> ''
  `).all() as { legacy_pic_label: string }[];
  for (const r of assignRows) if (r.legacy_pic_label) used.add(r.legacy_pic_label.trim());
  return used;
}

router.get('/pics', (_req, res) => {
  const rows = db.prepare('SELECT * FROM pics ORDER BY sort_order ASC, id ASC').all() as Record<string, unknown>[];
  const dangDung = picsConTaskChuaXong();
  res.json(rows.map((r) => ({ ...mapPic(r), dangSuDung: dangDung.has(String(r.name)) })));
});

router.post('/pics', (req, res) => {
  const name = (req.body as { name?: string }).name?.trim();
  if (!name) return res.status(400).json({ message: 'Tên PIC là bắt buộc' });
  // QA-2026-09-12 (xác nhận với người dùng): kiểm trùng KHÔNG phân biệt hoa/thường — "Nam" và "nam"
  // coi là cùng 1 người, tránh gõ nhầm case tạo ra 2 PIC trùng nhau trong dropdown.
  const existing = db.prepare('SELECT id FROM pics WHERE LOWER(name) = LOWER(?)').get(name);
  if (existing) return res.status(400).json({ message: 'PIC này đã tồn tại' });

  const now = new Date().toISOString();
  const next = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pics').get() as { n: number }).n;
  const color = normColor((req.body as { color?: string }).color);
  const result = db.prepare('INSERT INTO pics (name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(name, color, next, now, now);
  const row = db.prepare('SELECT * FROM pics WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  res.status(201).json(mapPic(row));
});

router.patch('/pics/reorder', (req, res) => {
  const ids = parseIdList((req.body as { picIds?: Array<string | number> }).picIds);
  if (!ids || ids.length === 0) {
    return res.status(400).json({ message: 'Thứ tự PIC không hợp lệ' });
  }
  const now = new Date().toISOString();
  const upd = db.prepare('UPDATE pics SET sort_order = ?, updated_at = ? WHERE id = ?');
  ids.forEach((id, index) => upd.run(index + 1, now, id));
  const rows = db.prepare('SELECT * FROM pics ORDER BY sort_order ASC, id ASC').all() as Record<string, unknown>[];
  res.json(rows.map(mapPic));
});

// Thay tên trong chuỗi PIC dạng "A, B, C" (project_tasks.assignee / weekly_goals.assignee)
function renameInList(value: string, oldName: string, newName: string): string {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === oldName ? newName : s))
    .join(', ');
}

router.patch('/pics/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'PIC không hợp lệ' });
  const pic = db.prepare('SELECT * FROM pics WHERE id = ?').get(id) as { name: string } | undefined;
  if (!pic) return res.status(404).json({ message: 'Không tìm thấy PIC' });

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
  const oldName = pic.name;
  try {
    withTransaction(() => {
      if (hasColor) {
        db.prepare('UPDATE pics SET color = ?, updated_at = ? WHERE id = ?').run(normColor(body.color), now, id);
      }
      if (!hasName || name === undefined) return;
      const nextName = name;
      db.prepare('UPDATE pics SET name = ?, updated_at = ? WHERE id = ?').run(nextName, now, id);
      if (nextName !== oldName) {
        // Đổi tên lan sang mọi nơi đang dùng tên cũ (pic/assignee có thể là chuỗi nhiều người "A, B")
        const projectRows = db.prepare("SELECT id, pic FROM projects WHERE pic IS NOT NULL AND pic <> ''").all() as { id: number; pic: string }[];
        const updProject = db.prepare('UPDATE projects SET pic = ?, updated_at = ? WHERE id = ?');
        for (const row of projectRows) {
          const replaced = renameInList(row.pic, oldName, nextName);
          if (replaced !== row.pic) updProject.run(replaced, now, row.id);
        }
        const taskRows = db.prepare("SELECT id, assignee FROM project_tasks WHERE assignee IS NOT NULL AND assignee <> ''").all() as { id: number; assignee: string }[];
        const updTask = db.prepare('UPDATE project_tasks SET assignee = ?, updated_at = ? WHERE id = ?');
        for (const row of taskRows) {
          const replaced = renameInList(row.assignee, oldName, nextName);
          if (replaced !== row.assignee) updTask.run(replaced, now, row.id);
        }
        const goalRows = db.prepare("SELECT id, assignee FROM weekly_goals WHERE assignee IS NOT NULL AND assignee <> ''").all() as { id: number; assignee: string }[];
        const updGoal = db.prepare('UPDATE weekly_goals SET assignee = ?, updated_at = ? WHERE id = ?');
        for (const row of goalRows) {
          const replaced = renameInList(row.assignee, oldName, nextName);
          if (replaced !== row.assignee) updGoal.run(replaced, now, row.id);
        }
      }
    });
  } catch (error) {
    return sendRouteError(res, error, 'Không thể cập nhật PIC');
  }

  const row = db.prepare('SELECT * FROM pics WHERE id = ?').get(id) as Record<string, unknown>;
  res.json(mapPic(row));
});

// Xóa khỏi danh sách chọn; chỉ cho xóa khi PIC không còn task nào chưa hoàn thành.
router.delete('/pics/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'PIC không hợp lệ' });
  const pic = db.prepare('SELECT name FROM pics WHERE id = ?').get(id) as { name: string } | undefined;
  if (!pic) return res.status(404).json({ message: 'Không tìm thấy PIC' });
  if (picsConTaskChuaXong().has(pic.name)) {
    return res.status(400).json({ message: 'Không thể xóa: PIC này còn task chưa hoàn thành.' });
  }
  db.prepare('DELETE FROM pics WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
