import { Router } from 'express';
import { db } from '../db.js';
import { maHoa, giaiMa } from '../lib/secret.js';

const router = Router();

// ── Cấu hình Redmine lưu trong bảng key-value app_settings ────────────────────────
// Key: redmine_base_url (URL gốc), redmine_api_key (API key của tài khoản).
// Key chỉ nằm trong DB local (%APPDATA%\TaskManager\data), không có trong source code.
const KEY_URL = 'redmine_base_url';
const KEY_API = 'redmine_api_key';

function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

function setSetting(key: string, value: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

// API key lưu dưới dạng đã mã hóa AES-GCM; giải mã ra giá trị gốc khi cần dùng.
// QA-2026-09-12: nếu secret.key (master key, nằm ngoài thư mục data — xem server/lib/secret.ts)
// bị mất/đổi (vd chỉ backup/restore riêng tasks.sqlite mà quên secret.key — đúng khoảng trống đã
// ghi chú ở đó), giaiMa() ném lỗi xác thực GCM ("Unsupported state or unable to authenticate
// data") — trước đây lỗi này rơi thẳng ra ngoài, làm GET /redmine/config (gọi mỗi lần mở màn
// Settings) vỡ 500 mù mờ, không có đường nào phục hồi qua UI. Giá trị cũ dù sao cũng không giải mã
// lại được nữa (mất master key là mất vĩnh viễn) — coi như CHƯA CÓ KEY, để người dùng nhập lại
// bình thường qua UI (ghi đè bằng key mới, mã hóa lại bằng master key hiện tại).
function getApiKey(): string {
  try {
    return giaiMa(getSetting(KEY_API));
  } catch (error) {
    console.error('[redmine] không giải mã được API key đã lưu (secret.key có thể đã mất/đổi) — coi như chưa cấu hình:', error);
    return '';
  }
}

// Che key: giữ 3 ký tự đầu + 3 cuối. Key ngắn -> chỉ hiện chấm.
function cheKey(key: string): string {
  if (!key) return '';
  if (key.length <= 6) return '••••••';
  return `${key.slice(0, 3)}••••••${key.slice(-3)}`;
}

// Chuẩn hóa URL: thêm https:// nếu thiếu, bỏ dấu / ở cuối.
function chuanUrl(raw: string): string {
  let u = (raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '');
}

// ── Lấy cấu hình hiện tại (không trả key thật, chỉ trả bản che) ───────────────────
router.get('/redmine/config', (_req, res) => {
  const apiKey = getApiKey();
  res.json({
    baseUrl: getSetting(KEY_URL),
    coKey: apiKey.length > 0,
    keyMask: cheKey(apiKey)
  });
});

// ── Lưu cấu hình. apiKey rỗng/không gửi -> giữ key cũ (cho phép sửa mỗi URL). ──────
router.put('/redmine/config', (req, res) => {
  const body = req.body as { baseUrl?: string; apiKey?: string };
  const baseUrl = chuanUrl(body.baseUrl || '');
  if (!baseUrl) return res.status(400).json({ message: 'URL Redmine là bắt buộc' });
  setSetting(KEY_URL, baseUrl);
  const apiKey = body.apiKey?.trim();
  if (apiKey) setSetting(KEY_API, maHoa(apiKey));
  const luuKey = getApiKey();
  res.json({ baseUrl, coKey: luuKey.length > 0, keyMask: cheKey(luuKey) });
});

// ── Xóa API key đã lưu (giữ URL). ─────────────────────────────────────────────────
router.delete('/redmine/config/key', (_req, res) => {
  setSetting(KEY_API, '');
  res.json({ ok: true });
});

// ── Test kết nối: gọi /users/current.json bằng key đã lưu, trả về tên tài khoản. ──
router.post('/redmine/test', async (_req, res) => {
  const baseUrl = getSetting(KEY_URL);
  const apiKey = getApiKey();
  if (!baseUrl) return res.status(400).json({ message: 'Chưa cấu hình URL Redmine' });
  if (!apiKey) return res.status(400).json({ message: 'Chưa nhập API key Redmine' });
  try {
    const r = await fetch(`${baseUrl}/users/current.json`, {
      headers: { 'X-Redmine-API-Key': apiKey, Accept: 'application/json' }
    });
    if (r.status === 401) return res.status(401).json({ message: 'API key sai hoặc không có quyền (401)' });
    if (!r.ok) return res.status(502).json({ message: `Redmine trả về lỗi ${r.status}` });
    const data = (await r.json()) as { user?: { id: number; login: string; firstname?: string; lastname?: string } };
    const u = data.user;
    const ten = u ? `${u.firstname ?? ''} ${u.lastname ?? ''}`.trim() || u.login : '';
    res.json({ ok: true, userId: u?.id, ten, login: u?.login });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Không kết nối được tới Redmine';
    res.status(502).json({ message: `Không kết nối được tới Redmine: ${msg}` });
  }
});

export default router;
