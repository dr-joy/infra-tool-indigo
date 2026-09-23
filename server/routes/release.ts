import { Router } from 'express';
import { db } from '../db.js';
import {
  type ReleaseTemplateBody,
  type ReleaseTaskDefinitionBody,
  type EmergencyReleaseTaskDefinitionBody,
  type EmergencyTimingToken,
  validReleaseTemplateTokens,
  validEmergencyReleaseTemplateTokens,
  validEmergencyTimingTokens,
  relativeEmergencyTimingTokens
} from '../types.js';
import { normalizeTaskLinks, invalidTemplateTokens, sanitizeReleaseTemplateContent, hashEmergencyDefinitionSnapshot } from '../lib/utils.js';
import { mapReleaseTemplate, mapReleaseTaskDefinition, mapEmergencyReleaseTaskDefinition } from '../lib/mappers.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';

// CR-20260913 Lát 6 (§6.3, FR-23c/FR-28a) — 4 bảng ở file này ("checklist cá nhân": template + định
// nghĩa task, định kỳ + khẩn cấp) đã đổi từ "dùng chung toàn app" (thời desktop 1 người) sang MỖI
// NGƯỜI MỘT BỘ RIÊNG (owner_user_id, không chia sẻ). Route trước Lát 6 KHÔNG hề qua requireSession/
// authorize() (giống lỗ hổng đã tìm thấy ở PIC, Council review run e6cd1c8c) — bản sửa này thêm đủ
// requireSession + requireActiveAccount + authorize() (policyKind 'personal_task', đúng khuôn đã dùng
// cho mind_map: feature 'personal_task' — điều kiện bắt buộc CR nêu là "chỉ có tác dụng khi Task cá
// nhân đang Bật cho đúng team", KHÔNG phải feature 'release') + lọc owner_user_id ở mọi route.
//
// Dữ liệu MẶC ĐỊNH toàn app cũ (server/db-seed.ts, seed lúc DB rỗng) có owner_user_id = NULL — theo
// đúng nguyên tắc "mỗi User mới tự tạo bộ của mình từ đầu, không tự chia sẻ dữ liệu cũ" (CR §6.3), các
// dòng đó đơn giản KHÔNG hiện cho ai qua route dưới đây nữa (không phải bug, là thiết kế).
//
// row_version: tăng dần mỗi lần ghi (bookkeeping, đồng dạng các bảng khác) nhưng CHƯA ép client phải
// gửi đúng giá trị hiện tại mới cho sửa (khác hẳn optimistic concurrency thật của FR-16/FR-46) — ngoài
// phạm vi đợt việc này, xem báo cáo bàn giao Lát 6.
const router = Router();

// QA-2026-09-12: gửi `id` trùng (tự đặt tay, hoặc do 2 request quá gần nhau khiến id tự sinh theo
// Date.now() trùng nhau) trước đây vỡ ràng buộc PRIMARY KEY của SQLite -> lộ ra 500 "Lỗi server nội
// bộ" thay vì báo lỗi rõ ràng. Kiểm tồn tại trước khi INSERT ở cả 4 route POST tạo mới trong file này.
function idDaTonTai(table: string, id: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id));
}

// Council thiết kế run 7fd3e4d1 (xem docs/exchanges/2026-09-12.md): validate `replyToDefinitionId` —
// phải trỏ tới ĐÚNG MỘT definition khác CÙNG BẢNG (cùng loại regular/emergency, vì mỗi loại có bảng
// riêng), không tự trỏ chính nó. Trả `{ error }` thay vì throw để khớp mẫu `res.status(400).json(...)`
// đang dùng xuyên suốt file này (không dùng HttpError ở đây).
//
// CR-20260913 Lát 6: từ nay còn phải CÙNG CHỦ SỞ HỮU (owner_user_id = actor.userId) — không cho trả lời
// định nghĩa của người khác, dù cùng bảng.
function resolveReplyToDefinitionId(
  table: 'release_task_definitions' | 'emergency_release_task_definitions',
  ownerUserId: number,
  selfId: string | undefined,
  raw: unknown
): { error: string } | { value: string | null } {
  if (raw === undefined || raw === null) return { value: null };
  const id = String(raw).trim();
  if (!id) return { value: null };
  if (selfId && id === selfId) return { error: 'Không thể tự chọn chính định nghĩa này làm nơi trả lời' };
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND owner_user_id = ?`).get(id, ownerUserId);
  if (!exists) return { error: 'Định nghĩa được chọn để trả lời không tồn tại, khác loại phát hành, hoặc không phải của bạn' };
  return { value: id };
}

function requirePersonalOwn(req: Parameters<typeof actorFromRequest>[0], resource: string) {
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'personal_task', resource, action: 'own', scope: { ownerId: actor.userId } });
  return actor;
}

// ── Release templates (định kỳ, cá nhân) ──────────────────────────────────────

router.get('/release/templates', requireSession, requireActiveAccount, (req, res) => {
  const actor = requirePersonalOwn(req, 'release_template_personal');
  const rows = db.prepare('SELECT * FROM release_templates WHERE owner_user_id = ? ORDER BY updated_at DESC, name ASC')
    .all(actor.userId) as Record<string, unknown>[];
  res.json(rows.map(mapReleaseTemplate));
});

router.post('/release/templates', requireSession, requireActiveAccount, (req, res) => {
  const actor = requirePersonalOwn(req, 'release_template_personal');
  const body = req.body as ReleaseTemplateBody;
  const name = body.name?.trim();
  const content = sanitizeReleaseTemplateContent(body.content ?? '');
  if (!name) return res.status(400).json({ message: 'Tên template là bắt buộc' });
  const invalid = invalidTemplateTokens(content);
  if (invalid.length > 0) return res.status(400).json({ message: `Token không hợp lệ: ${invalid.join(', ')}` });

  const id = body.id?.trim() || `template_${Date.now()}`;
  if (idDaTonTai('release_templates', id)) return res.status(409).json({ message: 'ID template đã tồn tại, thử lại' });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO release_templates (id, name, content, owner_user_id, row_version, created_at, updated_at, created_by, updated_by)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, name, content, actor.userId, now, now, actor.userId, actor.userId);
  writeAudit(actor.userId, null, 'release_template.create', `release_template:${id}`, { name });
  res.status(201).json({ id });
});

router.patch('/release/templates/:id', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  const row = db.prepare('SELECT owner_user_id FROM release_templates WHERE id = ?').get(String(req.params.id)) as { owner_user_id: number | null } | undefined;
  authorize({ actor, policyKind: 'personal_task', resource: 'release_template_personal', action: 'own', scope: { ownerId: row?.owner_user_id ?? -1 } });
  const body = req.body as ReleaseTemplateBody;
  const name = body.name?.trim();
  const content = sanitizeReleaseTemplateContent(body.content ?? '');
  if (!name) return res.status(400).json({ message: 'Tên template là bắt buộc' });
  const invalid = invalidTemplateTokens(content);
  if (invalid.length > 0) return res.status(400).json({ message: `Token không hợp lệ: ${invalid.join(', ')}` });

  const result = db.prepare('UPDATE release_templates SET name = ?, content = ?, updated_at = ?, updated_by = ?, row_version = row_version + 1 WHERE id = ?')
    .run(name, content, new Date().toISOString(), actor.userId, String(req.params.id));
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy template' });
  writeAudit(actor.userId, null, 'release_template.update', `release_template:${String(req.params.id)}`, { name });
  res.json({ ok: true });
});

router.delete('/release/templates/:id', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  const row = db.prepare('SELECT owner_user_id FROM release_templates WHERE id = ?').get(String(req.params.id)) as { owner_user_id: number | null } | undefined;
  authorize({ actor, policyKind: 'personal_task', resource: 'release_template_personal', action: 'own', scope: { ownerId: row?.owner_user_id ?? -1 } });
  db.prepare('UPDATE release_task_definitions SET template_id = NULL WHERE template_id = ? AND owner_user_id = ?').run(String(req.params.id), actor.userId);
  const result = db.prepare('DELETE FROM release_templates WHERE id = ?').run(String(req.params.id));
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy template' });
  writeAudit(actor.userId, null, 'release_template.delete', `release_template:${String(req.params.id)}`, {});
  res.json({ ok: true });
});

// ── Emergency release templates (khẩn cấp, cá nhân) ───────────────────────────

router.get('/release/emergency/templates', requireSession, requireActiveAccount, (req, res) => {
  const actor = requirePersonalOwn(req, 'emergency_release_template_personal');
  const rows = db.prepare('SELECT * FROM emergency_release_templates WHERE owner_user_id = ? ORDER BY updated_at DESC, name ASC')
    .all(actor.userId) as Record<string, unknown>[];
  res.json(rows.map(mapReleaseTemplate));
});

router.post('/release/emergency/templates', requireSession, requireActiveAccount, (req, res) => {
  const actor = requirePersonalOwn(req, 'emergency_release_template_personal');
  const body = req.body as ReleaseTemplateBody;
  const name = body.name?.trim();
  const content = sanitizeReleaseTemplateContent(body.content ?? '');
  if (!name) return res.status(400).json({ message: 'Tên template là bắt buộc' });
  const invalid = invalidTemplateTokens(content, validEmergencyReleaseTemplateTokens);
  if (invalid.length > 0) return res.status(400).json({ message: `Token không hợp lệ: ${invalid.join(', ')}` });

  const id = body.id?.trim() || `emergency_template_${Date.now()}`;
  if (idDaTonTai('emergency_release_templates', id)) return res.status(409).json({ message: 'ID template đã tồn tại, thử lại' });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO emergency_release_templates (id, name, content, owner_user_id, row_version, created_at, updated_at, created_by, updated_by)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, name, content, actor.userId, now, now, actor.userId, actor.userId);
  writeAudit(actor.userId, null, 'emergency_release_template.create', `emergency_release_template:${id}`, { name });
  res.status(201).json({ id });
});

router.patch('/release/emergency/templates/:id', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  const row = db.prepare('SELECT owner_user_id FROM emergency_release_templates WHERE id = ?').get(String(req.params.id)) as { owner_user_id: number | null } | undefined;
  authorize({ actor, policyKind: 'personal_task', resource: 'emergency_release_template_personal', action: 'own', scope: { ownerId: row?.owner_user_id ?? -1 } });
  const body = req.body as ReleaseTemplateBody;
  const name = body.name?.trim();
  const content = sanitizeReleaseTemplateContent(body.content ?? '');
  if (!name) return res.status(400).json({ message: 'Tên template là bắt buộc' });
  const invalid2 = invalidTemplateTokens(content, validEmergencyReleaseTemplateTokens);
  if (invalid2.length > 0) return res.status(400).json({ message: `Token không hợp lệ: ${invalid2.join(', ')}` });

  const result = db.prepare('UPDATE emergency_release_templates SET name = ?, content = ?, updated_at = ?, updated_by = ?, row_version = row_version + 1 WHERE id = ?')
    .run(name, content, new Date().toISOString(), actor.userId, String(req.params.id));
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy template' });
  writeAudit(actor.userId, null, 'emergency_release_template.update', `emergency_release_template:${String(req.params.id)}`, { name });
  res.json({ ok: true });
});

router.delete('/release/emergency/templates/:id', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  const row = db.prepare('SELECT owner_user_id FROM emergency_release_templates WHERE id = ?').get(String(req.params.id)) as { owner_user_id: number | null } | undefined;
  authorize({ actor, policyKind: 'personal_task', resource: 'emergency_release_template_personal', action: 'own', scope: { ownerId: row?.owner_user_id ?? -1 } });
  db.prepare('UPDATE emergency_release_task_definitions SET template_id = NULL WHERE template_id = ? AND owner_user_id = ?').run(String(req.params.id), actor.userId);
  const result = db.prepare('DELETE FROM emergency_release_templates WHERE id = ?').run(String(req.params.id));
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy template' });
  writeAudit(actor.userId, null, 'emergency_release_template.delete', `emergency_release_template:${String(req.params.id)}`, {});
  res.json({ ok: true });
});

// ── Emergency task definitions (cá nhân) ──────────────────────────────────────

// CR-20260822 FR-2 (Codex §4.51 High — chống TOCTOU giữa lúc FE render và server tạo task): trả kèm
// `revisionHash` = hash(note, template_id, nội dung template) TẠI THỜI ĐIỂM ĐỌC này.
router.get('/release/emergency/task-definitions', requireSession, requireActiveAccount, (req, res) => {
  const actor = requirePersonalOwn(req, 'emergency_release_task_definition_personal');
  const rows = db.prepare('SELECT * FROM emergency_release_task_definitions WHERE owner_user_id = ? ORDER BY task_date ASC, start_time ASC, sort_order ASC, title ASC')
    .all(actor.userId) as Record<string, unknown>[];
  const templateContents = new Map(
    (db.prepare('SELECT id, content FROM emergency_release_templates WHERE owner_user_id = ?').all(actor.userId) as { id: string; content: string }[])
      .map((t) => [t.id, t.content])
  );
  res.json(rows.map((row) => ({
    ...mapEmergencyReleaseTaskDefinition(row),
    revisionHash: hashEmergencyDefinitionSnapshot(
      row.note == null ? '' : String(row.note),
      row.template_id == null ? null : String(row.template_id),
      row.template_id ? (templateContents.get(String(row.template_id)) ?? null) : null
    )
  })));
});

router.post('/release/emergency/task-definitions', requireSession, requireActiveAccount, (req, res) => {
  const actor = requirePersonalOwn(req, 'emergency_release_task_definition_personal');
  const body = req.body as EmergencyReleaseTaskDefinitionBody;
  const title = body.title?.trim();
  const timingToken = body.timingToken?.trim() as EmergencyTimingToken | undefined;
  const startTime = body.startTime?.trim();
  if (!title) return res.status(400).json({ message: 'Tiêu đề task là bắt buộc' });
  if (!timingToken || !validEmergencyTimingTokens.has(timingToken)) return res.status(400).json({ message: 'Thời điểm không hợp lệ' });
  if (!startTime || (startTime !== 'immediate' && startTime !== 'relative' && !/^\d{2}:\d{2}$/.test(startTime))) return res.status(400).json({ message: 'Giờ bắt đầu không hợp lệ' });

  const isRelativeTask = relativeEmergencyTimingTokens.has(timingToken);
  const relativeOffsetMinutes = isRelativeTask ? Math.min(24 * 60, Math.max(-24 * 60, Number(body.relativeOffsetMinutes || 0))) : null;
  const scheduleMode = isRelativeTask ? body.scheduleMode === 'after_schedule' ? 'after_schedule' : 'custom' : null;
  const isAfterScheduleTask = scheduleMode === 'after_schedule';
  const immediatePriority = (!isRelativeTask && startTime === 'immediate') || isAfterScheduleTask
    ? Math.min(15, Math.max(1, Number(body.immediatePriority || 1)))
    : null;
  const id = body.id?.trim() || `emergency_release_task_${Date.now()}`;
  if (idDaTonTai('emergency_release_task_definitions', id)) return res.status(409).json({ message: 'ID task đã tồn tại, thử lại' });
  const taskLinks = normalizeTaskLinks(body.links);
  const replyTo = resolveReplyToDefinitionId('emergency_release_task_definitions', actor.userId, id, body.replyToDefinitionId);
  if ('error' in replyTo) return res.status(400).json({ message: replyTo.error });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO emergency_release_task_definitions (
      id, title, note, task_date, start_time, immediate_priority, relative_offset_minutes, schedule_mode, template_id, task_links, sort_order,
      reply_to_definition_id, owner_user_id, row_version, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(
    id, title, body.note?.trim() || '', timingToken, isRelativeTask ? 'relative' : startTime, immediatePriority, relativeOffsetMinutes,
    scheduleMode, body.templateId || null, JSON.stringify(taskLinks), body.sortOrder || 0, replyTo.value,
    actor.userId, now, now, actor.userId, actor.userId
  );
  writeAudit(actor.userId, null, 'emergency_release_task_definition.create', `emergency_release_task_definition:${id}`, { title });
  res.status(201).json({ id });
});

router.patch('/release/emergency/task-definitions/:id', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  const existing = db.prepare('SELECT owner_user_id FROM emergency_release_task_definitions WHERE id = ?').get(String(req.params.id)) as { owner_user_id: number | null } | undefined;
  authorize({ actor, policyKind: 'personal_task', resource: 'emergency_release_task_definition_personal', action: 'own', scope: { ownerId: existing?.owner_user_id ?? -1 } });
  const body = req.body as EmergencyReleaseTaskDefinitionBody;
  const title = body.title?.trim();
  const timingToken = body.timingToken?.trim() as EmergencyTimingToken | undefined;
  const startTime = body.startTime?.trim();
  if (!title) return res.status(400).json({ message: 'Tiêu đề task là bắt buộc' });
  if (!timingToken || !validEmergencyTimingTokens.has(timingToken)) return res.status(400).json({ message: 'Thời điểm không hợp lệ' });
  if (!startTime || (startTime !== 'immediate' && startTime !== 'relative' && !/^\d{2}:\d{2}$/.test(startTime))) return res.status(400).json({ message: 'Giờ bắt đầu không hợp lệ' });

  const isRelativeTask = relativeEmergencyTimingTokens.has(timingToken);
  const relativeOffsetMinutes = isRelativeTask ? Math.min(24 * 60, Math.max(-24 * 60, Number(body.relativeOffsetMinutes || 0))) : null;
  const scheduleMode = isRelativeTask ? body.scheduleMode === 'after_schedule' ? 'after_schedule' : 'custom' : null;
  const isAfterScheduleTask = scheduleMode === 'after_schedule';
  const immediatePriority = (!isRelativeTask && startTime === 'immediate') || isAfterScheduleTask
    ? Math.min(15, Math.max(1, Number(body.immediatePriority || 1)))
    : null;
  const replyTo = resolveReplyToDefinitionId('emergency_release_task_definitions', actor.userId, String(req.params.id), body.replyToDefinitionId);
  if ('error' in replyTo) return res.status(400).json({ message: replyTo.error });

  const result = db.prepare(`
    UPDATE emergency_release_task_definitions
    SET title = ?, note = ?, task_date = ?, start_time = ?, immediate_priority = ?, relative_offset_minutes = ?, schedule_mode = ?, template_id = ?,
        task_links = ?, sort_order = ?, reply_to_definition_id = ?, updated_at = ?, updated_by = ?, row_version = row_version + 1
    WHERE id = ?
  `).run(
    title, body.note?.trim() || '', timingToken, isRelativeTask ? 'relative' : startTime, immediatePriority, relativeOffsetMinutes, scheduleMode,
    body.templateId || null, JSON.stringify(normalizeTaskLinks(body.links)), body.sortOrder || 0, replyTo.value,
    new Date().toISOString(), actor.userId, String(req.params.id)
  );
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy task release khẩn cấp' });
  writeAudit(actor.userId, null, 'emergency_release_task_definition.update', `emergency_release_task_definition:${String(req.params.id)}`, { title });
  res.json({ ok: true });
});

router.delete('/release/emergency/task-definitions/:id', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  const existing = db.prepare('SELECT owner_user_id FROM emergency_release_task_definitions WHERE id = ?').get(String(req.params.id)) as { owner_user_id: number | null } | undefined;
  authorize({ actor, policyKind: 'personal_task', resource: 'emergency_release_task_definition_personal', action: 'own', scope: { ownerId: existing?.owner_user_id ?? -1 } });
  // Council thiết kế run 7fd3e4d1: xoá definition đang được definition khác chọn làm nơi trả lời
  // phải báo lỗi, không âm thầm để dangling reply_to_definition_id.
  const referencedBy = db.prepare('SELECT id, title FROM emergency_release_task_definitions WHERE reply_to_definition_id = ? AND owner_user_id = ?')
    .all(String(req.params.id), actor.userId) as { id: string; title: string }[];
  if (referencedBy.length > 0) {
    return res.status(409).json({ message: 'Không thể xoá: đang được định nghĩa khác chọn làm nơi trả lời', referencedBy });
  }
  const result = db.prepare('DELETE FROM emergency_release_task_definitions WHERE id = ?').run(String(req.params.id));
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy task release khẩn cấp' });
  writeAudit(actor.userId, null, 'emergency_release_task_definition.delete', `emergency_release_task_definition:${String(req.params.id)}`, {});
  res.json({ ok: true });
});

// ── Regular release task definitions (cá nhân) ────────────────────────────────

router.get('/release/task-definitions', requireSession, requireActiveAccount, (req, res) => {
  const actor = requirePersonalOwn(req, 'release_task_definition_personal');
  const rows = db.prepare('SELECT * FROM release_task_definitions WHERE owner_user_id = ? ORDER BY sort_order ASC, title ASC')
    .all(actor.userId) as Record<string, unknown>[];
  res.json(rows.map(mapReleaseTaskDefinition));
});

router.post('/release/task-definitions', requireSession, requireActiveAccount, (req, res) => {
  const actor = requirePersonalOwn(req, 'release_task_definition_personal');
  const body = req.body as ReleaseTaskDefinitionBody;
  const title = body.title?.trim();
  const startTime = body.startTime?.trim();
  const dateToken = body.dateToken?.trim();
  if (!title) return res.status(400).json({ message: 'Tiêu đề task là bắt buộc' });
  if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) return res.status(400).json({ message: 'Giờ bắt đầu không hợp lệ' });
  if (!dateToken || !validReleaseTemplateTokens.has(dateToken)) return res.status(400).json({ message: 'Token ngày không hợp lệ' });

  const id = body.id?.trim() || `release_task_${Date.now()}`;
  if (idDaTonTai('release_task_definitions', id)) return res.status(409).json({ message: 'ID task đã tồn tại, thử lại' });
  const taskLinks = normalizeTaskLinks(body.links);
  const replyTo = resolveReplyToDefinitionId('release_task_definitions', actor.userId, id, body.replyToDefinitionId);
  if ('error' in replyTo) return res.status(400).json({ message: replyTo.error });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO release_task_definitions (
      id, title, note, start_time, date_token, template_id, task_links, sort_order, reply_to_definition_id,
      owner_user_id, row_version, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, title, body.note?.trim() || '', startTime, dateToken, body.templateId || null, JSON.stringify(taskLinks), body.sortOrder || 0, replyTo.value,
    actor.userId, now, now, actor.userId, actor.userId);
  writeAudit(actor.userId, null, 'release_task_definition.create', `release_task_definition:${id}`, { title });
  res.status(201).json({ id });
});

router.patch('/release/task-definitions/:id', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  const existing = db.prepare('SELECT owner_user_id FROM release_task_definitions WHERE id = ?').get(String(req.params.id)) as { owner_user_id: number | null } | undefined;
  authorize({ actor, policyKind: 'personal_task', resource: 'release_task_definition_personal', action: 'own', scope: { ownerId: existing?.owner_user_id ?? -1 } });
  const body = req.body as ReleaseTaskDefinitionBody;
  const title = body.title?.trim();
  const startTime = body.startTime?.trim();
  const dateToken = body.dateToken?.trim();
  if (!title) return res.status(400).json({ message: 'Tiêu đề task là bắt buộc' });
  if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) return res.status(400).json({ message: 'Giờ bắt đầu không hợp lệ' });
  if (!dateToken || !validReleaseTemplateTokens.has(dateToken)) return res.status(400).json({ message: 'Token ngày không hợp lệ' });
  const replyTo = resolveReplyToDefinitionId('release_task_definitions', actor.userId, String(req.params.id), body.replyToDefinitionId);
  if ('error' in replyTo) return res.status(400).json({ message: replyTo.error });

  const result = db.prepare(`
    UPDATE release_task_definitions
    SET title = ?, note = ?, start_time = ?, date_token = ?, template_id = ?, task_links = ?, sort_order = ?, reply_to_definition_id = ?,
        updated_at = ?, updated_by = ?, row_version = row_version + 1
    WHERE id = ?
  `).run(title, body.note?.trim() || '', startTime, dateToken, body.templateId || null, JSON.stringify(normalizeTaskLinks(body.links)), body.sortOrder || 0, replyTo.value,
    new Date().toISOString(), actor.userId, String(req.params.id));
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy task định kỳ' });
  writeAudit(actor.userId, null, 'release_task_definition.update', `release_task_definition:${String(req.params.id)}`, { title });
  res.json({ ok: true });
});

router.delete('/release/task-definitions/:id', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  const existing = db.prepare('SELECT owner_user_id FROM release_task_definitions WHERE id = ?').get(String(req.params.id)) as { owner_user_id: number | null } | undefined;
  authorize({ actor, policyKind: 'personal_task', resource: 'release_task_definition_personal', action: 'own', scope: { ownerId: existing?.owner_user_id ?? -1 } });
  const referencedBy = db.prepare('SELECT id, title FROM release_task_definitions WHERE reply_to_definition_id = ? AND owner_user_id = ?')
    .all(String(req.params.id), actor.userId) as { id: string; title: string }[];
  if (referencedBy.length > 0) {
    return res.status(409).json({ message: 'Không thể xoá: đang được định nghĩa khác chọn làm nơi trả lời', referencedBy });
  }
  const result = db.prepare('DELETE FROM release_task_definitions WHERE id = ?').run(String(req.params.id));
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy task định kỳ' });
  writeAudit(actor.userId, null, 'release_task_definition.delete', `release_task_definition:${String(req.params.id)}`, {});
  res.json({ ok: true });
});

export default router;
