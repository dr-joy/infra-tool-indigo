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
function resolveReplyToDefinitionId(
  table: 'release_task_definitions' | 'emergency_release_task_definitions',
  selfId: string | undefined,
  raw: unknown
): { error: string } | { value: string | null } {
  if (raw === undefined || raw === null) return { value: null };
  const id = String(raw).trim();
  if (!id) return { value: null };
  if (selfId && id === selfId) return { error: 'Không thể tự chọn chính định nghĩa này làm nơi trả lời' };
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
  if (!exists) return { error: 'Định nghĩa được chọn để trả lời không tồn tại hoặc khác loại phát hành' };
  return { value: id };
}

// ── Release templates ─────────────────────────────────────────────────────────

router.get('/release/templates', (_req, res) => {
  const rows = db.prepare('SELECT * FROM release_templates ORDER BY updated_at DESC, name ASC').all() as Record<string, unknown>[];
  res.json(rows.map(mapReleaseTemplate));
});

router.post('/release/templates', (req, res) => {
  const body = req.body as ReleaseTemplateBody;
  const name = body.name?.trim();
  const content = sanitizeReleaseTemplateContent(body.content ?? '');
  if (!name) return res.status(400).json({ message: 'Tên template là bắt buộc' });
  const invalid = invalidTemplateTokens(content);
  if (invalid.length > 0) return res.status(400).json({ message: `Token không hợp lệ: ${invalid.join(', ')}` });

  const id = body.id?.trim() || `template_${Date.now()}`;
  if (idDaTonTai('release_templates', id)) return res.status(409).json({ message: 'ID template đã tồn tại, thử lại' });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO release_templates (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, content, now, now);
  res.status(201).json({ id });
});

router.patch('/release/templates/:id', (req, res) => {
  const body = req.body as ReleaseTemplateBody;
  const name = body.name?.trim();
  const content = sanitizeReleaseTemplateContent(body.content ?? '');
  if (!name) return res.status(400).json({ message: 'Tên template là bắt buộc' });
  const invalid = invalidTemplateTokens(content);
  if (invalid.length > 0) return res.status(400).json({ message: `Token không hợp lệ: ${invalid.join(', ')}` });

  const result = db.prepare('UPDATE release_templates SET name = ?, content = ?, updated_at = ? WHERE id = ?')
    .run(name, content, new Date().toISOString(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy template' });
  res.json({ ok: true });
});

router.delete('/release/templates/:id', (req, res) => {
  db.prepare('UPDATE release_task_definitions SET template_id = NULL WHERE template_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM release_templates WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy template' });
  res.json({ ok: true });
});

// ── Emergency release templates ───────────────────────────────────────────────

router.get('/release/emergency/templates', (_req, res) => {
  const rows = db.prepare('SELECT * FROM emergency_release_templates ORDER BY updated_at DESC, name ASC').all() as Record<string, unknown>[];
  res.json(rows.map(mapReleaseTemplate));
});

router.post('/release/emergency/templates', (req, res) => {
  const body = req.body as ReleaseTemplateBody;
  const name = body.name?.trim();
  const content = sanitizeReleaseTemplateContent(body.content ?? '');
  if (!name) return res.status(400).json({ message: 'Tên template là bắt buộc' });
  const invalid = invalidTemplateTokens(content, validEmergencyReleaseTemplateTokens);
  if (invalid.length > 0) return res.status(400).json({ message: `Token không hợp lệ: ${invalid.join(', ')}` });

  const id = body.id?.trim() || `emergency_template_${Date.now()}`;
  if (idDaTonTai('emergency_release_templates', id)) return res.status(409).json({ message: 'ID template đã tồn tại, thử lại' });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO emergency_release_templates (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, content, now, now);
  res.status(201).json({ id });
});

router.patch('/release/emergency/templates/:id', (req, res) => {
  const body = req.body as ReleaseTemplateBody;
  const name = body.name?.trim();
  const content = sanitizeReleaseTemplateContent(body.content ?? '');
  if (!name) return res.status(400).json({ message: 'Tên template là bắt buộc' });
  const invalid2 = invalidTemplateTokens(content, validEmergencyReleaseTemplateTokens);
  if (invalid2.length > 0) return res.status(400).json({ message: `Token không hợp lệ: ${invalid2.join(', ')}` });

  const result = db.prepare('UPDATE emergency_release_templates SET name = ?, content = ?, updated_at = ? WHERE id = ?')
    .run(name, content, new Date().toISOString(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy template' });
  res.json({ ok: true });
});

router.delete('/release/emergency/templates/:id', (req, res) => {
  db.prepare('UPDATE emergency_release_task_definitions SET template_id = NULL WHERE template_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM emergency_release_templates WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy template' });
  res.json({ ok: true });
});

// ── Emergency task definitions ────────────────────────────────────────────────

// CR-20260822 FR-2 (Codex §4.51 High — chống TOCTOU giữa lúc FE render và server tạo task): trả kèm
// `revisionHash` = hash(note, template_id, nội dung template) TẠI THỜI ĐIỂM ĐỌC này. FE phải mang giá trị
// này theo khi POST task (`definitionRevision`) — server sẽ so lại với hash LIVE ngay trong transaction
// tạo task (xem `POST /schedules/emergency-release/tasks`), reject nếu definition đã đổi giữa lúc FE tải
// và lúc submit — không cho lưu 1 snapshot hash server tự tính lại (không chứng minh được payload đang
// gửi lên THẬT SỰ dựng từ đúng revision đó).
router.get('/release/emergency/task-definitions', (_req, res) => {
  const rows = db.prepare('SELECT * FROM emergency_release_task_definitions ORDER BY task_date ASC, start_time ASC, sort_order ASC, title ASC').all() as Record<string, unknown>[];
  const templateContents = new Map(
    (db.prepare('SELECT id, content FROM emergency_release_templates').all() as { id: string; content: string }[])
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

router.post('/release/emergency/task-definitions', (req, res) => {
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
  const replyTo = resolveReplyToDefinitionId('emergency_release_task_definitions', id, body.replyToDefinitionId);
  if ('error' in replyTo) return res.status(400).json({ message: replyTo.error });
  db.prepare(`
    INSERT INTO emergency_release_task_definitions (id, title, note, task_date, start_time, immediate_priority, relative_offset_minutes, schedule_mode, template_id, task_links, sort_order, reply_to_definition_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, body.note?.trim() || '', timingToken, isRelativeTask ? 'relative' : startTime, immediatePriority, relativeOffsetMinutes, scheduleMode, body.templateId || null, JSON.stringify(taskLinks), body.sortOrder || 0, replyTo.value);
  res.status(201).json({ id });
});

router.patch('/release/emergency/task-definitions/:id', (req, res) => {
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
  const replyTo = resolveReplyToDefinitionId('emergency_release_task_definitions', req.params.id, body.replyToDefinitionId);
  if ('error' in replyTo) return res.status(400).json({ message: replyTo.error });

  const result = db.prepare(`
    UPDATE emergency_release_task_definitions
    SET title = ?, note = ?, task_date = ?, start_time = ?, immediate_priority = ?, relative_offset_minutes = ?, schedule_mode = ?, template_id = ?, task_links = ?, sort_order = ?, reply_to_definition_id = ?
    WHERE id = ?
  `).run(title, body.note?.trim() || '', timingToken, isRelativeTask ? 'relative' : startTime, immediatePriority, relativeOffsetMinutes, scheduleMode, body.templateId || null, JSON.stringify(normalizeTaskLinks(body.links)), body.sortOrder || 0, replyTo.value, req.params.id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy task release khẩn cấp' });
  res.json({ ok: true });
});

router.delete('/release/emergency/task-definitions/:id', (req, res) => {
  // Council thiết kế run 7fd3e4d1: xoá definition đang được definition khác chọn làm nơi trả lời
  // phải báo lỗi, không âm thầm để dangling reply_to_definition_id.
  const referencedBy = db.prepare('SELECT id, title FROM emergency_release_task_definitions WHERE reply_to_definition_id = ?')
    .all(req.params.id) as { id: string; title: string }[];
  if (referencedBy.length > 0) {
    return res.status(409).json({ message: 'Không thể xoá: đang được định nghĩa khác chọn làm nơi trả lời', referencedBy });
  }
  const result = db.prepare('DELETE FROM emergency_release_task_definitions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy task release khẩn cấp' });
  res.json({ ok: true });
});

// ── Regular release task definitions ─────────────────────────────────────────

router.get('/release/task-definitions', (_req, res) => {
  const rows = db.prepare('SELECT * FROM release_task_definitions ORDER BY sort_order ASC, title ASC').all() as Record<string, unknown>[];
  res.json(rows.map(mapReleaseTaskDefinition));
});

router.post('/release/task-definitions', (req, res) => {
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
  const replyTo = resolveReplyToDefinitionId('release_task_definitions', id, body.replyToDefinitionId);
  if ('error' in replyTo) return res.status(400).json({ message: replyTo.error });
  db.prepare(`
    INSERT INTO release_task_definitions (id, title, note, start_time, date_token, template_id, task_links, sort_order, reply_to_definition_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, body.note?.trim() || '', startTime, dateToken, body.templateId || null, JSON.stringify(taskLinks), body.sortOrder || 0, replyTo.value);
  res.status(201).json({ id });
});

router.patch('/release/task-definitions/:id', (req, res) => {
  const body = req.body as ReleaseTaskDefinitionBody;
  const title = body.title?.trim();
  const startTime = body.startTime?.trim();
  const dateToken = body.dateToken?.trim();
  if (!title) return res.status(400).json({ message: 'Tiêu đề task là bắt buộc' });
  if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) return res.status(400).json({ message: 'Giờ bắt đầu không hợp lệ' });
  if (!dateToken || !validReleaseTemplateTokens.has(dateToken)) return res.status(400).json({ message: 'Token ngày không hợp lệ' });
  const replyTo = resolveReplyToDefinitionId('release_task_definitions', req.params.id, body.replyToDefinitionId);
  if ('error' in replyTo) return res.status(400).json({ message: replyTo.error });

  const result = db.prepare(`
    UPDATE release_task_definitions
    SET title = ?, note = ?, start_time = ?, date_token = ?, template_id = ?, task_links = ?, sort_order = ?, reply_to_definition_id = ?
    WHERE id = ?
  `).run(title, body.note?.trim() || '', startTime, dateToken, body.templateId || null, JSON.stringify(normalizeTaskLinks(body.links)), body.sortOrder || 0, replyTo.value, req.params.id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy task định kỳ' });
  res.json({ ok: true });
});

router.delete('/release/task-definitions/:id', (req, res) => {
  const referencedBy = db.prepare('SELECT id, title FROM release_task_definitions WHERE reply_to_definition_id = ?')
    .all(req.params.id) as { id: string; title: string }[];
  if (referencedBy.length > 0) {
    return res.status(409).json({ message: 'Không thể xoá: đang được định nghĩa khác chọn làm nơi trả lời', referencedBy });
  }
  const result = db.prepare('DELETE FROM release_task_definitions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ message: 'Không tìm thấy task định kỳ' });
  res.json({ ok: true });
});


export default router;
