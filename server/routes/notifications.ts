import { Router } from 'express';
import { db } from '../db.js';
import { requireSession } from '../lib/auth-middleware.js';

// FR-34 — kênh thông báo trong app duy nhất (không email, không Telegram), có danh sách xem lại
// được và đánh dấu đã đọc.
const router = Router();

router.get('/notifications', requireSession, (req, res) => {
  const rows = db.prepare(`
    SELECT id, kind, payload, created_at, read_at FROM notifications
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(req.user!.id);
  res.json({ notifications: rows });
});

router.post('/notifications/:id/read', requireSession, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'id không hợp lệ' });
  const result = db.prepare(`
    UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL
  `).run(new Date().toISOString(), id, req.user!.id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy thông báo' });
  res.json({ ok: true });
});

export default router;
