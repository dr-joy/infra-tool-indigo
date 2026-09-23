import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { maHoa, giaiMa } from '../lib/secret.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';
import { buildRedmineUrl, safeRedmineFetch } from '../lib/ssrf-guard.js';

// CR-20260913 Lát 5 (FR-33/FR-44) — công ty chỉ có MỘT Redmine: URL cấu hình cấp hệ thống (chỉ Admin
// sửa), mỗi người tự nhập API key riêng của mình (không còn khoá dùng chung — bản cũ ở đây trước Lát 5
// gộp cả hai vào 1 route dùng chung cho mọi người, đúng thiết kế 1-user cũ). Tách 2 route rõ ràng:
// GET|PUT /api/me/redmine (khoá cá nhân, mọi actor tự quản CỦA MÌNH) và PUT /api/admin/redmine-url
// (URL hệ thống, chỉ Admin) — Member không còn thấy/sửa được URL trong màn Cài đặt của mình.
const router = Router();

const KEY_URL = 'redmine_base_url'; // giữ đúng key app_settings đã chạy thật (không đổi sang app_config)

function getBaseUrl(): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY_URL) as { value: string } | undefined;
  return row?.value ?? '';
}

function setBaseUrl(value: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(KEY_URL, value, now);
}

function chuanUrl(raw: string): string {
  let u = (raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '');
}

function cheKey(key: string): string {
  if (!key) return '';
  if (key.length <= 6) return '••••••';
  return `${key.slice(0, 3)}••••••${key.slice(-3)}`;
}

interface UserRedmineRow { user_id: number; api_key_ciphertext: string; created_at: string; updated_at: string; }

function getOwnApiKey(userId: number): string {
  const row = db.prepare('SELECT api_key_ciphertext FROM user_redmine_config WHERE user_id = ?').get(userId) as UserRedmineRow | undefined;
  if (!row?.api_key_ciphertext) return '';
  try {
    return giaiMa(row.api_key_ciphertext);
  } catch (error) {
    // Cùng lý do QA-2026-09-12 ở bản cũ: mất/đổi secret.key -> coi như chưa có key, không vỡ 500.
    console.error(`[redmine] không giải mã được API key của user ${userId} (secret.key có thể đã mất/đổi) — coi như chưa cấu hình:`, error);
    return '';
  }
}

// ── Khoá Redmine cá nhân — mọi actor đã đăng nhập tự quản lý CỦA MÌNH (FR-33) ───────────────────────
router.get('/me/redmine', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'redmine_config', action: 'read_self', scope: {} });
  const apiKey = getOwnApiKey(actor.userId);
  res.json({ baseUrl: getBaseUrl(), hasKey: apiKey.length > 0, keyMask: cheKey(apiKey) });
});

router.put('/me/redmine', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'redmine_config', action: 'write_self', scope: {} });
  const body = req.body as { apiKey?: string };
  const apiKey = (body.apiKey || '').trim();
  if (!apiKey) return res.status(400).json({ message: 'API key là bắt buộc' });

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_redmine_config (user_id, api_key_ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET api_key_ciphertext = excluded.api_key_ciphertext, updated_at = excluded.updated_at
  `).run(actor.userId, maHoa(apiKey), now, now);
  const saved = getOwnApiKey(actor.userId);
  res.json({ baseUrl: getBaseUrl(), hasKey: saved.length > 0, keyMask: cheKey(saved) });
});

router.delete('/me/redmine/key', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'redmine_config', action: 'delete_self_key', scope: {} });
  db.prepare('DELETE FROM user_redmine_config WHERE user_id = ?').run(actor.userId);
  res.json({ ok: true });
});

// ── Test kết nối — dùng ĐÚNG khoá của actor gọi, qua safeRedmineFetch (chống SSRF, FR-44) ───────────
router.post('/me/redmine/test', requireSession, requireActiveAccount, async (req, res) => {
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'redmine_config', action: 'test_self', scope: {} });
  const baseUrl = getBaseUrl();
  const apiKey = getOwnApiKey(actor.userId);
  if (!baseUrl) return res.status(400).json({ message: 'Chưa cấu hình URL Redmine (liên hệ Admin)' });
  if (!apiKey) return res.status(400).json({ message: 'Chưa nhập API key Redmine của bạn' });

  const requestId = randomUUID();
  try {
    const target = buildRedmineUrl(baseUrl, '/users/current.json');
    const result = await safeRedmineFetch(target, {
      method: 'GET',
      headers: { 'X-Redmine-API-Key': apiKey, Accept: 'application/json' },
      actorUserId: actor.userId,
      requestId
    });
    if (result.status === 401) return res.status(401).json({ message: 'API key sai hoặc không có quyền (401)' });
    if (result.status < 200 || result.status >= 300) return res.status(502).json({ message: `Redmine trả về lỗi ${result.status}` });
    let data: { user?: { id: number; login: string; firstname?: string; lastname?: string } };
    try { data = JSON.parse(result.bodyText); } catch { return res.status(502).json({ message: 'Redmine trả về nội dung không phải JSON hợp lệ' }); }
    const u = data.user;
    const ten = u ? `${u.firstname ?? ''} ${u.lastname ?? ''}`.trim() || u.login : '';
    res.json({ ok: true, userId: u?.id, ten, login: u?.login });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Không kết nối được tới Redmine';
    const status = (e as { status?: number }).status;
    res.status(typeof status === 'number' ? status : 502).json({ message: `Không kết nối được tới Redmine: ${msg}` });
  }
});

// ── URL Redmine hệ thống — chỉ Admin đọc/sửa (FR-33) ─────────────────────────────────────────────
router.get('/admin/redmine-url', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'redmine_config', action: 'read_admin_url', scope: {} });
  res.json({ baseUrl: getBaseUrl() });
});

router.put('/admin/redmine-url', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'redmine_config', action: 'write_admin_url', scope: {} });
  const body = req.body as { baseUrl?: string };
  const baseUrl = chuanUrl(body.baseUrl || '');
  if (!baseUrl) return res.status(400).json({ message: 'URL Redmine là bắt buộc' });
  if (!/^https:\/\//i.test(baseUrl)) return res.status(400).json({ message: 'URL Redmine phải dùng https://' });
  setBaseUrl(baseUrl);
  writeAudit(actor.userId, null, 'redmine_config.url_change', 'app_settings:redmine_base_url', { baseUrl });
  res.json({ baseUrl });
});

export default router;
