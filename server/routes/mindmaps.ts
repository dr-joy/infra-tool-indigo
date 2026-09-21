import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { dataDir } from '../paths.js';
import { sendRouteError, parseIntId } from '../lib/utils.js';

const router = Router();

// Thư mục chứa file đính kèm của mind map (ảnh không hỗ trợ — chỉ file tài liệu).
// LƯU Ý: KHÔNG nằm trong phạm vi sao lưu hiện tại — scripts/backup-db.mjs chỉ VACUUM INTO
// file tasks.sqlite, không chạm tới thư mục này (Council review, phiên a24496ba). Nếu máy hỏng
// và phục hồi bằng backup, sơ đồ vẫn còn nhưng file đính kèm ĐÃ MẤT — URL trong data sẽ trỏ tới
// file không còn tồn tại.
const filesDir = path.join(dataDir, 'mindmap-files');
fs.mkdirSync(filesDir, { recursive: true });

// Bỏ ký tự nguy hiểm khỏi tên file (chống path traversal); giữ phần đuôi để mở đúng app.
function sanitizeName(name: string): string {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\-() ]+/g, '_').slice(0, 120);
  return base || 'file';
}

// Council review (phiên a24496ba): file đính kèm không được kiểm tra loại, phục vụ lại bằng
// Content-Disposition: inline -> một file .html/.svg độc hại đính vào sơ đồ, khi mở ra sẽ được
// trình duyệt RENDER trực tiếp tại cùng origin với API (http://127.0.0.1:<port>) thay vì tải
// xuống, nên script trong file có thể gọi thẳng fetch('/api/...') và CRUD toàn bộ dữ liệu app mà
// không bị CORS chặn (CORS không chặn same-origin). Chặn ở CẢ hai lớp: (1) từ chối nhóm đuôi file
// "nội dung chủ động" ngay lúc tải lên, (2) LUÔN phục vụ bằng attachment (không bao giờ inline) để
// những file đã lỡ tải lên trước khi có bản vá này cũng không còn render được.
const DUOI_FILE_NOI_DUNG_CHU_DONG = new Set([
  '.html', '.htm', '.xhtml', '.shtml', '.svg', '.svgz', '.mhtml', '.mht', '.js', '.mjs', '.cjs'
]);
function laDuoiFileNguyHiem(tenFile: string): boolean {
  return DUOI_FILE_NOI_DUNG_CHU_DONG.has(path.extname(tenFile).toLowerCase());
}

// Một sơ đồ = 1 dòng trong bảng mindmaps. Cây node lưu trọn trong cột data (JSON).
// Danh sách (sidebar) chỉ cần id/title/updatedAt; mở 1 sơ đồ mới trả thêm data.

function mapRow(row: Record<string, unknown>, withData = false) {
  const base = {
    id: Number(row.id),
    title: String(row.title || ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  if (!withData) return base;
  return { ...base, data: String(row.data || '{}') };
}

// data phải là 1 object JSON (cây node). Không validate cấu trúc sâu — chỉ chặn rác
// để không lưu chuỗi không parse được hay kiểu sai.
function normalizeData(value: unknown): string | null {
  if (value == null) return null;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return JSON.stringify(parsed);
}

router.get('/mindmaps', (_req, res) => {
  const rows = db.prepare('SELECT id, title, created_at, updated_at FROM mindmaps ORDER BY updated_at DESC, id DESC').all() as Record<string, unknown>[];
  res.json(rows.map((r) => mapRow(r)));
});

router.get('/mindmaps/:id', (req, res) => {
  const id = parseIntId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'Sơ đồ không hợp lệ' });
  const row = db.prepare('SELECT * FROM mindmaps WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ message: 'Không tìm thấy sơ đồ' });
  res.json(mapRow(row, true));
});

router.post('/mindmaps', (req, res) => {
  const body = req.body as { title?: string; data?: unknown };
  const title = (body.title || '').trim() || 'Sơ đồ mới';
  const data = normalizeData(body.data) ?? '{}';
  const now = new Date().toISOString();
  const result = db.prepare('INSERT INTO mindmaps (title, data, created_at, updated_at) VALUES (?, ?, ?, ?)').run(title, data, now, now);
  const row = db.prepare('SELECT * FROM mindmaps WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  res.status(201).json(mapRow(row, true));
});

router.put('/mindmaps/:id', (req, res) => {
  const id = parseIntId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'Sơ đồ không hợp lệ' });
  const existing = db.prepare('SELECT id FROM mindmaps WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ message: 'Không tìm thấy sơ đồ' });

  const body = req.body as { title?: string; data?: unknown };
  const hasTitle = body.title !== undefined;
  const hasData = body.data !== undefined;
  if (!hasTitle && !hasData) return res.status(400).json({ message: 'Không có gì để cập nhật' });

  const now = new Date().toISOString();
  try {
    if (hasTitle) {
      const title = (body.title || '').trim() || 'Sơ đồ mới';
      db.prepare('UPDATE mindmaps SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id);
    }
    if (hasData) {
      const data = normalizeData(body.data);
      if (data == null) return res.status(400).json({ message: 'Dữ liệu sơ đồ không hợp lệ' });
      db.prepare('UPDATE mindmaps SET data = ?, updated_at = ? WHERE id = ?').run(data, now, id);
    }
  } catch (error) {
    return sendRouteError(res, error, 'Không thể lưu sơ đồ');
  }
  const row = db.prepare('SELECT * FROM mindmaps WHERE id = ?').get(id) as Record<string, unknown>;
  res.json(mapRow(row, true));
});

// Đính file: client gửi { name, dataBase64 } (data URL hoặc base64 thuần).
// Lưu xuống đĩa với tên ngẫu nhiên (tránh trùng/ghi đè), trả về URL để chèn vào node.
router.post('/mindmaps/upload', (req, res) => {
  const body = req.body as { name?: string; dataBase64?: string };
  const raw = body.dataBase64 || '';
  const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!b64) return res.status(400).json({ message: 'Thiếu dữ liệu file' });
  let buf: Buffer;
  try { buf = Buffer.from(b64, 'base64'); } catch { return res.status(400).json({ message: 'Dữ liệu file không hợp lệ' }); }
  if (!buf.length) return res.status(400).json({ message: 'File rỗng' });
  if (buf.length > 30 * 1024 * 1024) return res.status(413).json({ message: 'File quá lớn (tối đa 30MB)' });
  const safe = sanitizeName(body.name || 'file');
  if (laDuoiFileNguyHiem(safe)) {
    return res.status(400).json({ message: 'Không hỗ trợ loại file này (HTML/SVG/JS...) — chỉ nhận file tài liệu' });
  }
  const stored = `${randomBytes(8).toString('hex')}__${safe}`;
  try {
    fs.writeFileSync(path.join(filesDir, stored), buf);
  } catch (error) {
    return sendRouteError(res, error, 'Không thể lưu file');
  }
  res.status(201).json({ name: safe, url: `/api/mindmaps/files/${encodeURIComponent(stored)}` });
});

// Phục vụ file đính kèm. Chặn path traversal bằng basename + kiểm tra thư mục.
router.get('/mindmaps/files/:name', (req, res) => {
  const stored = path.basename(req.params.name);
  const full = path.join(filesDir, stored);
  if (!full.startsWith(filesDir) || !fs.existsSync(full)) return res.status(404).json({ message: 'Không tìm thấy file' });
  // Tên hiển thị = phần sau "__" (bỏ tiền tố ngẫu nhiên).
  const display = stored.includes('__') ? stored.slice(stored.indexOf('__') + 2) : stored;
  // LUÔN attachment, không bao giờ inline (Council review, phiên a24496ba) — kể cả file đã tải lên
  // TRƯỚC bản vá này (khi chưa có chặn đuôi file ở upload) cũng không còn render được nữa, trình
  // duyệt sẽ tải xuống thay vì chạy trực tiếp trong cùng origin với API.
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(display)}"`);
  res.sendFile(full);
});

router.delete('/mindmaps/:id', (req, res) => {
  const id = parseIntId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'Sơ đồ không hợp lệ' });
  db.prepare('DELETE FROM mindmaps WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
