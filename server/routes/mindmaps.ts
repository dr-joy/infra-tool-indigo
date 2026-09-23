import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import Busboy from 'busboy';
import { db } from '../db.js';
import { dataDir } from '../paths.js';
import { HttpError, sendRouteError, parseIntId } from '../lib/utils.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize, type Actor } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';
import { validateAttachment, describeAllowedFormats } from '../lib/file-validation.js';

// CR-20260913 Lát 5 (FR-32/FR-32a/FR-43) — Mind Map giờ có chủ sở hữu + riêng tư/chia sẻ theo team,
// và file đính kèm có bản ghi riêng (mindmap_attachments) thay hẳn cơ chế cũ (URL tự do trong JSON,
// KHÔNG kiểm quyền sở hữu/chia sẻ tại đường tải — lỗ hổng thật đã xác nhận ở mindmaps.ts:142-153 bản
// cũ, xem CR §Nhóm D FR-32). authorize() dùng lại khuôn 'personal_task' (chỉ chủ sở hữu ghi) và
// 'cross_team_release' (gate "đang thuộc ≥1 team Bật Mind Map") đã tổng quát hoá ở authorize.ts —
// route KHÔNG tự lặp lại luật vai trò, chỉ tự lọc/kiểm THEO TỪNG BẢN GHI sau khi authorize() cho qua
// (đúng khuôn đã dùng cho project_task Member).
const router = Router();

const filesDir = path.join(dataDir, 'mindmap-files'); // thư mục CŨ (di sản trước Lát 5) — chỉ đọc lại
const attachmentsDir = path.join(dataDir, 'mindmap-attachments');
fs.mkdirSync(attachmentsDir, { recursive: true });

const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024; // 30MB — giữ nguyên hạn mức cũ
const PENDING_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h — dọn định kỳ file 'pending' quá hạn (FR-32a)

interface MindmapRow {
  id: number;
  owner_user_id: number | null;
  visibility: 'private' | 'team';
  shared_team_id: number | null;
  title: string;
  data: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: MindmapRow, withData = false) {
  const base = {
    id: Number(row.id),
    title: String(row.title || ''),
    ownerUserId: row.owner_user_id == null ? null : Number(row.owner_user_id),
    visibility: row.visibility,
    sharedTeamId: row.shared_team_id == null ? null : Number(row.shared_team_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  if (!withData) return base;
  return { ...base, data: String(row.data || '{}') };
}

function normalizeData(value: unknown): string | null {
  if (value == null) return null;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return JSON.stringify(parsed);
}

function loadMindmap(id: number): MindmapRow {
  const row = db.prepare('SELECT * FROM mindmaps WHERE id = ?').get(id) as MindmapRow | undefined;
  if (!row) throw new HttpError(404, 'Không tìm thấy sơ đồ');
  return row;
}

// Quyền ĐỌC — luôn tính lại từ trạng thái SỐNG của bản ghi (owner hoặc thành viên đúng team đang
// share), KHÔNG lưu cứng ở đâu khác (FR-32: đổi từ chia sẻ sang riêng tư phải thu hồi quyền ngay).
function canRead(actor: Actor, row: MindmapRow): boolean {
  if (row.owner_user_id === actor.userId) return true;
  if (row.visibility === 'team' && row.shared_team_id != null) {
    return actor.memberships.some((m) => m.teamId === row.shared_team_id);
  }
  return false;
}

function requireBrowseGate(req: Parameters<typeof actorFromRequest>[0]): Actor {
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'cross_team_release', resource: 'mind_map', action: 'browse', scope: {} });
  return actor;
}

function requireReadableMindmap(req: Parameters<typeof actorFromRequest>[0], id: number): { actor: Actor; row: MindmapRow } {
  const actor = requireBrowseGate(req);
  const row = loadMindmap(id);
  if (!canRead(actor, row)) throw new HttpError(403, 'Bạn không có quyền xem sơ đồ này', 'ROLE_FORBIDDEN');
  return { actor, row };
}

// Quyền GHI — CHỈ chủ sở hữu, dù riêng tư hay chia sẻ (FR-32). Dùng authorize() policyKind
// 'personal_task' với scope.ownerId = owner thật của bản ghi (không phải actor.userId tự khai).
function requireOwnedMindmap(req: Parameters<typeof actorFromRequest>[0], id: number, action: 'update' | 'delete' | 'upload_attachment' | 'delete_attachment'): { actor: Actor; row: MindmapRow } {
  const actor = actorFromRequest(req);
  const row = loadMindmap(id);
  authorize({ actor, policyKind: 'personal_task', resource: 'mind_map', action, scope: { ownerId: row.owner_user_id ?? -1 } });
  return { actor, row };
}

router.get('/mindmaps', requireSession, requireActiveAccount, (req, res) => {
  const actor = requireBrowseGate(req);
  const teamIds = actor.memberships.map((m) => m.teamId);
  const placeholders = teamIds.map(() => '?').join(',');
  const rows = (teamIds.length > 0
    ? db.prepare(`
        SELECT id, owner_user_id, visibility, shared_team_id, title, created_at, updated_at FROM mindmaps
        WHERE owner_user_id = ? OR (visibility = 'team' AND shared_team_id IN (${placeholders}))
        ORDER BY updated_at DESC, id DESC
      `).all(actor.userId, ...teamIds)
    : db.prepare(`
        SELECT id, owner_user_id, visibility, shared_team_id, title, created_at, updated_at FROM mindmaps
        WHERE owner_user_id = ? ORDER BY updated_at DESC, id DESC
      `).all(actor.userId)
  ) as unknown as MindmapRow[];
  res.json(rows.map((r) => mapRow(r)));
});

router.get('/mindmaps/:id', requireSession, requireActiveAccount, (req, res) => {
  const id = parseIntId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'Sơ đồ không hợp lệ' });
  const { row } = requireReadableMindmap(req, id);
  res.json(mapRow(row, true));
});

router.post('/mindmaps', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  const body = req.body as { title?: string; data?: unknown; visibility?: string; sharedTeamId?: number };
  authorize({ actor, policyKind: 'personal_task', resource: 'mind_map', action: 'create', scope: { ownerId: actor.userId } });

  const visibility = body.visibility === 'team' ? 'team' : 'private';
  let sharedTeamId: number | null = null;
  if (visibility === 'team') {
    sharedTeamId = Number(body.sharedTeamId);
    if (!Number.isInteger(sharedTeamId) || !actor.memberships.some((m) => m.teamId === sharedTeamId)) {
      return res.status(400).json({ message: 'Chỉ chia sẻ được cho team bạn đang là thành viên' });
    }
  }
  const title = (body.title || '').trim() || 'Sơ đồ mới';
  const data = normalizeData(body.data) ?? '{}';
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO mindmaps (owner_user_id, visibility, shared_team_id, title, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(actor.userId, visibility, sharedTeamId, title, data, now, now);
  const row = loadMindmap(Number(result.lastInsertRowid));
  writeAudit(actor.userId, sharedTeamId, 'mindmap.create', `mindmap:${row.id}`, { title, visibility });
  res.status(201).json(mapRow(row, true));
});

router.put('/mindmaps/:id', requireSession, requireActiveAccount, (req, res) => {
  const id = parseIntId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'Sơ đồ không hợp lệ' });
  const { actor, row } = requireOwnedMindmap(req, id, 'update');

  const body = req.body as { title?: string; data?: unknown; visibility?: string; sharedTeamId?: number | null };
  const hasTitle = body.title !== undefined;
  const hasData = body.data !== undefined;
  const hasVisibility = body.visibility !== undefined;
  if (!hasTitle && !hasData && !hasVisibility) return res.status(400).json({ message: 'Không có gì để cập nhật' });

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
    if (hasVisibility) {
      const visibility = body.visibility === 'team' ? 'team' : 'private';
      let sharedTeamId: number | null = null;
      if (visibility === 'team') {
        sharedTeamId = Number(body.sharedTeamId);
        if (!Number.isInteger(sharedTeamId) || !actor.memberships.some((m) => m.teamId === sharedTeamId)) {
          return res.status(400).json({ message: 'Chỉ chia sẻ được cho team bạn đang là thành viên' });
        }
      }
      db.prepare('UPDATE mindmaps SET visibility = ?, shared_team_id = ?, updated_at = ? WHERE id = ?').run(visibility, sharedTeamId, now, id);
      // FR-32: đổi riêng tư/chia sẻ có thể thu hẹp/mở rộng quyền — không cần thao tác thêm, GET
      // /mindmaps/:id và đường tải attachment đều tự tính lại theo trạng thái SỐNG mỗi lần gọi.
      writeAudit(actor.userId, sharedTeamId, 'mindmap.visibility_change', `mindmap:${id}`, { visibility, sharedTeamId });
    }
  } catch (error) {
    return sendRouteError(res, error, 'Không thể lưu sơ đồ');
  }
  res.json(mapRow(loadMindmap(id), true));
});

router.delete('/mindmaps/:id', requireSession, requireActiveAccount, (req, res) => {
  const id = parseIntId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'Sơ đồ không hợp lệ' });
  const { actor } = requireOwnedMindmap(req, id, 'delete');
  db.prepare('DELETE FROM mindmaps WHERE id = ?').run(id); // ON DELETE CASCADE dọn theo mindmap_attachments
  writeAudit(actor.userId, null, 'mindmap.delete', `mindmap:${id}`, {});
  res.json({ ok: true });
});

// ── File đính kèm (FR-32a/FR-43) ────────────────────────────────────────────────────────────────

interface AttachmentRow {
  id: string;
  mindmap_id: number;
  owner_user_id: number | null;
  original_name: string;
  storage_key: string;
  extension: string;
  declared_mime: string;
  detected_mime: string | null;
  byte_size: number;
  sha256: string;
  status: string;
  created_at: string;
  ready_at: string | null;
}

function mapAttachment(row: AttachmentRow) {
  return {
    id: row.id,
    mindmapId: Number(row.mindmap_id),
    originalName: row.original_name,
    extension: row.extension,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    status: row.status,
    createdAt: row.created_at,
    downloadUrl: `/api/mindmaps/attachments/${encodeURIComponent(row.id)}/download`,
  };
}

router.get('/mindmaps/:id/attachments', requireSession, requireActiveAccount, (req, res) => {
  const id = parseIntId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'Sơ đồ không hợp lệ' });
  requireReadableMindmap(req, id);
  const rows = db.prepare(`
    SELECT * FROM mindmap_attachments WHERE mindmap_id = ? AND status = 'ready' ORDER BY created_at DESC
  `).all(id) as unknown as AttachmentRow[];
  res.json(rows.map(mapAttachment));
});

// Upload multipart/form-data — stream vào file tạm, tính SHA-256 khi ghi, KHÔNG decode base64 nguyên
// khối vào RAM (FR-43). 3 lớp xác thực (đuôi + MIME khai báo + nội dung thật) trước khi publish.
router.post('/mindmaps/:id/attachments', requireSession, requireActiveAccount, (req, res) => {
  const id = parseIntId(req.params.id);
  if (id == null) return res.status(400).json({ message: 'Sơ đồ không hợp lệ' });
  const { actor } = requireOwnedMindmap(req, id, 'upload_attachment');

  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('multipart/form-data')) {
    return res.status(400).json({ message: 'Yêu cầu phải là multipart/form-data' });
  }

  let bb: Busboy.Busboy;
  try {
    bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_ATTACHMENT_BYTES } });
  } catch {
    return res.status(400).json({ message: 'Yêu cầu multipart không hợp lệ' });
  }

  let responded = false;
  let sawFile = false;
  const send = (status: number, body: Record<string, unknown>) => {
    if (responded) return;
    responded = true;
    res.status(status).json(body);
  };

  bb.on('file', (_field, fileStream, info) => {
    sawFile = true;
    const originalName = String(info.filename || 'file');
    const declaredMime = String(info.mimeType || 'application/octet-stream');
    const storageKey = randomBytes(16).toString('hex');
    const tempPath = path.join(attachmentsDir, `.upload-${storageKey}`);
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;

    const writeStream = fs.createWriteStream(tempPath);
    fileStream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      hash.update(chunk);
      chunks.push(chunk);
    });
    fileStream.on('limit', () => {
      tooLarge = true;
      writeStream.destroy();
    });
    fileStream.pipe(writeStream);

    writeStream.on('finish', () => {
      (async () => {
        if (tooLarge) {
          try { fs.unlinkSync(tempPath); } catch { /* bỏ qua */ }
          return send(413, { message: `File quá lớn (tối đa ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)` });
        }
        if (total === 0) {
          try { fs.unlinkSync(tempPath); } catch { /* bỏ qua */ }
          return send(400, { message: 'File rỗng' });
        }
        const buffer = Buffer.concat(chunks);
        const validation = await validateAttachment({ originalName, declaredMime, buffer });
        if (!validation.ok) {
          try { fs.unlinkSync(tempPath); } catch { /* bỏ qua */ }
          return send(400, { message: validation.reason || `Định dạng không được hỗ trợ. Cho phép: ${describeAllowedFormats()}` });
        }

        const now = new Date().toISOString();
        const attachmentId = randomUUID();
        const sha256 = hash.digest('hex');
        try {
          db.prepare(`
            INSERT INTO mindmap_attachments (
              id, mindmap_id, owner_user_id, team_id, original_name, storage_key, extension,
              declared_mime, detected_mime, byte_size, sha256, status, created_at, created_by
            ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          `).run(
            attachmentId, id, actor.userId, originalName, storageKey, validation.extension as string,
            declaredMime, validation.detectedMime ?? null, total, sha256, now, actor.userId
          );
          // Rename nguyên tử pending -> ready (CR §FR-32a). Nếu rename lỗi, dòng DB giữ 'pending' và
          // GC định kỳ (24h) sẽ dọn — không publish nửa vời.
          const finalPath = path.join(attachmentsDir, storageKey);
          fs.renameSync(tempPath, finalPath);
          db.prepare("UPDATE mindmap_attachments SET status = 'ready', ready_at = ? WHERE id = ?").run(new Date().toISOString(), attachmentId);
          writeAudit(actor.userId, null, 'mindmap_attachment.upload', `mindmap_attachment:${attachmentId}`, { mindmapId: id, originalName, byteSize: total, sha256 });
          const row = db.prepare('SELECT * FROM mindmap_attachments WHERE id = ?').get(attachmentId) as unknown as AttachmentRow;
          send(201, mapAttachment(row));
        } catch (error) {
          try { fs.unlinkSync(tempPath); } catch { /* bỏ qua */ }
          sendRouteError(res, error, 'Không thể lưu file đính kèm');
          responded = true;
        }
      })().catch((error) => { sendRouteError(res, error, 'Không thể lưu file đính kèm'); responded = true; });
    });
    writeStream.on('error', (error) => {
      try { fs.unlinkSync(tempPath); } catch { /* bỏ qua */ }
      sendRouteError(res, error, 'Không thể lưu file đính kèm');
      responded = true;
    });
  });

  bb.on('error', (error) => { sendRouteError(res, error, 'Lỗi đọc multipart'); responded = true; });
  bb.on('close', () => {
    if (!sawFile) send(400, { message: 'Thiếu file đính kèm (field "file")' });
  });

  req.pipe(bb);
});

// Tải file đính kèm — quyền LUÔN join trạng thái SỐNG của mindmaps (owner/visibility/shared_team_id),
// KHÔNG lưu cứng theo lúc upload (FR-32/FR-43). LUÔN attachment + nosniff, không bao giờ inline.
router.get('/mindmaps/attachments/:attachmentId/download', requireSession, requireActiveAccount, (req, res) => {
  const attachmentId = String(req.params.attachmentId || '');
  const attachment = db.prepare('SELECT * FROM mindmap_attachments WHERE id = ? AND status = ?').get(attachmentId, 'ready') as AttachmentRow | undefined;
  if (!attachment) return res.status(404).json({ message: 'Không tìm thấy file đính kèm' });
  const { row: mindmap } = requireReadableMindmap(req, attachment.mindmap_id);
  void mindmap;

  const full = path.join(attachmentsDir, attachment.storage_key);
  if (!full.startsWith(attachmentsDir) || !fs.existsSync(full)) return res.status(404).json({ message: 'Không tìm thấy file' });
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.original_name)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(full);
});

router.delete('/mindmaps/attachments/:attachmentId', requireSession, requireActiveAccount, (req, res) => {
  const attachmentId = String(req.params.attachmentId || '');
  const attachment = db.prepare('SELECT * FROM mindmap_attachments WHERE id = ?').get(attachmentId) as AttachmentRow | undefined;
  if (!attachment) return res.status(404).json({ message: 'Không tìm thấy file đính kèm' });
  const { actor } = requireOwnedMindmap(req, attachment.mindmap_id, 'delete_attachment');

  const now = new Date().toISOString();
  db.prepare("UPDATE mindmap_attachments SET status = 'deleted', deleted_at = ? WHERE id = ?").run(now, attachmentId);
  try { fs.unlinkSync(path.join(attachmentsDir, attachment.storage_key)); } catch { /* file đã mất -> bỏ qua */ }
  writeAudit(actor.userId, null, 'mindmap_attachment.delete', `mindmap_attachment:${attachmentId}`, { mindmapId: attachment.mindmap_id });
  res.json({ ok: true });
});

// Cùng regex mà server/lib/mindmap-gc.ts (bản CŨ, đã xoá ở Lát 5 — xem lịch sử git trước Lát 5) từng
// dùng để dò URL file đính kèm cũ nhúng tự do trong cột mindmaps.data — tái dùng NGUYÊN VĂN logic dò
// URL đó (Council review vòng 1 Lát 5 yêu cầu, không viết lại từ đầu) để xác định mindmap nào đang
// tham chiếu một file di sản cụ thể.
const LEGACY_FILE_URL_RE = /\/api\/mindmaps\/files\/([^"'\s]+)/g;

// Tìm mọi mindmap còn tham chiếu tới storedName trong cột data. Bình thường chỉ có đúng 1 mindmap sở
// hữu; nếu >1 (vd dữ liệu bị copy/paste trùng URL) trả về cả tập, route gọi hàm này tự quyết cách xử lý
// (cấp quyền nếu actor đọc được ÍT NHẤT MỘT bản ghi trong tập — không có căn cứ nào để chọn đúng 1
// trong nhiều bản ghi làm "chủ thật sự", nên không tự bịa quy tắc chọn 1).
function findMindmapsReferencingLegacyFile(storedName: string): MindmapRow[] {
  const rows = db.prepare('SELECT * FROM mindmaps').all() as unknown as MindmapRow[];
  const matches: MindmapRow[] = [];
  for (const row of rows) {
    const raw = String(row.data ?? '');
    for (const match of raw.matchAll(LEGACY_FILE_URL_RE)) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(match[1]);
      } catch {
        continue; // URL không decode được -> bỏ qua match này, không đoán (giống mindmap-gc.ts cũ)
      }
      if (decoded === storedName) {
        matches.push(row);
        break;
      }
    }
  }
  return matches;
}

// ── Đường DI SẢN (trước Lát 5) — CHỈ còn phục vụ lại file đã tải trước khi có mindmap_attachments,
// không nhận upload mới. Quyền tải: dò trong mindmaps.data xem mindmap nào tham chiếu file này (đúng
// cách mindmap-gc.ts cũ dò để GC), rồi áp ĐÚNG quyền đọc như route
// /mindmaps/attachments/:attachmentId/download (requireBrowseGate + canRead — owner hoặc cùng team +
// visibility 'shared'). Không tìm thấy mindmap nào tham chiếu (file mồ côi thật sự, vd JSON đã bị sửa
// xoá tham chiếu) thì KHÔNG chặn được theo sở hữu — giữ hành vi cũ làm phương án cuối (chỉ cần đăng
// nhập), nhưng log cảnh báo rõ để sau này biết còn bao nhiêu file mồ côi thật (Council review vòng 1
// Lát 5).
router.get('/mindmaps/files/:name', requireSession, requireActiveAccount, (req, res) => {
  const stored = path.basename(String(req.params.name));
  const full = path.join(filesDir, stored);
  if (!full.startsWith(filesDir) || !fs.existsSync(full)) return res.status(404).json({ message: 'Không tìm thấy file' });

  const owners = findMindmapsReferencingLegacyFile(stored);
  if (owners.length > 0) {
    const actor = requireBrowseGate(req);
    const canAccess = owners.some((row) => canRead(actor, row));
    if (!canAccess) throw new HttpError(403, 'Bạn không có quyền tải file này', 'ROLE_FORBIDDEN');
    if (owners.length > 1) {
      console.warn(`[mindmap-legacy-file] file "${stored}" được ${owners.length} mindmap tham chiếu (id: ${owners.map((r) => r.id).join(', ')}) — đã cấp quyền vì actor đọc được ít nhất một trong số đó.`);
    }
  } else {
    console.warn(`[mindmap-legacy-file] không tìm thấy mindmap nào còn tham chiếu file "${stored}" — coi là file mồ côi thật, chỉ áp dụng yêu cầu đăng nhập (hạn chế đã biết của dữ liệu lịch sử).`);
  }

  const display = stored.includes('__') ? stored.slice(stored.indexOf('__') + 2) : stored;
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(display)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(full);
});

// Dọn định kỳ (gọi 1 lần lúc khởi động, giống pattern GC hiện có): quét theo CỘT status, không dò URL
// trong JSON (khác GC cũ) — mindmap_attachment 'pending' quá 24h coi là bỏ dở (crash giữa lúc upload),
// chuyển 'quarantined' + xoá file vật lý nếu còn.
export function purgeStalePendingAttachments(): void {
  const cutoff = new Date(Date.now() - PENDING_EXPIRY_MS).toISOString();
  const stale = db.prepare("SELECT id, storage_key FROM mindmap_attachments WHERE status = 'pending' AND created_at < ?").all(cutoff) as { id: string; storage_key: string }[];
  for (const row of stale) {
    try { fs.unlinkSync(path.join(attachmentsDir, `.upload-${row.storage_key}`)); } catch { /* có thể chưa từng ghi/xoá rồi */ }
    try { fs.unlinkSync(path.join(attachmentsDir, row.storage_key)); } catch { /* chưa rename tới bước này */ }
    db.prepare("UPDATE mindmap_attachments SET status = 'quarantined' WHERE id = ?").run(row.id);
  }
  if (stale.length > 0) console.log(`[mindmap-attachment-gc] đã dọn ${stale.length} file đính kèm 'pending' quá hạn 24h`);
}

export default router;
