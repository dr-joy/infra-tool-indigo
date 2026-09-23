import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../paths.js';
import { db } from '../db.js';

// Mã hóa hai chiều (AES-256-GCM) cho các bí mật cần lấy lại được để dùng (vd: API
// key Redmine phải gắn vào header). KHÔNG dùng hash vì hash một chiều, không khôi
// phục được key gốc.
//
// Master key sinh ngẫu nhiên 32 byte, lưu trong file BÊN TRONG thư mục data
// (`dataDir/secret.key`, cạnh `dataDir/backups/`). SỬA 2026-09-23 (BL-20260921-003,
// docs/exchanges/2026-09-23.md "Thiết kế: sửa vị trí lưu secret.key") — trước đây file
// này nằm 1 CẤP TRÊN dataDir để tách khỏi backup DB (`scripts/backup-db.mjs` chỉ VACUUM
// INTO đúng file .sqlite, không đụng thư mục cha) — vẫn đúng cho bản desktop, nhưng với
// container (CR-20260913 FR-36), `DATA_DIR=/data` là volume bền vững DUY NHẤT khai báo
// (`Dockerfile`); path.dirname(dataDir) rơi ra NGOÀI volume đó — container bị tạo lại
// (redeploy, restart hạ tầng, việc vận hành BÌNH THƯỜNG) sẽ mất file này, code cũ tự
// sinh key MỚI hoàn toàn ÂM THẦM, làm mọi secret đã mã hoá trước đó (API key Redmine cá
// nhân, `refresh_token` của `auth.drjoy.vn`) không giải mã lại được vĩnh viễn dù DB còn
// nguyên. Người dùng chọn ưu tiên tránh mất key (rủi ro chắc chắn xảy ra khi vận hành
// container) hơn rủi ro "lộ key qua snapshot hạ tầng chụp nguyên ổ /data" (cần quyền hạ
// tầng đặc quyền, hiếm hơn) — đã cập nhật `docs/standards/security-standard.md` khớp
// quyết định mới.
const keyFile = path.join(dataDir, 'secret.key');

let masterKey: Buffer | null = null;
function getMasterKey(): Buffer {
  if (masterKey) return masterKey;
  if (existsSync(keyFile)) {
    const buf = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
    if (buf.length === 32) {
      masterKey = buf;
      verifyOrBootstrapCanary(masterKey);
      return masterKey;
    }
  }
  // Chưa có (hoặc hỏng) -> sinh mới và lưu, quyền chỉ chủ sở hữu đọc/ghi.
  masterKey = randomBytes(32);
  writeFileSync(keyFile, masterKey.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(keyFile, 0o600); } catch { /* Windows có thể bỏ qua chmod */ }
  verifyOrBootstrapCanary(masterKey);
  return masterKey;
}

function encryptWithKey(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, enc].map((b) => b.toString('base64')).join(':');
}

function decryptWithKey(stored: string, key: Buffer): string {
  const [ivB, tagB, encB] = stored.slice(PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}

// Cờ đọc bởi /health/ready (server/app.ts, cùng khuôn `shutdownState` — SEC-PERF-013) — khác
// `giaiMa()` (vẫn coi lỗi giải mã TỪNG giá trị là "chưa cấu hình", không đổi hành vi route cá nhân),
// đây là tín hiệu cho VẬN HÀNH biết master key hiện tại KHÔNG khớp key đã dùng trước đó.
export const secretKeyState = { mismatch: false };

const CANARY_SETTING_KEY = 'secret_key_canary';
const CANARY_PLAINTEXT = 'task-manager-secret-key-canary-v1';

// Xác nhận master key đang nạp có khớp key đã dùng ở lần chạy trước hay không, bằng cách thử giải
// một giá trị canary cố định đã mã hoá lưu trong `app_settings`. Chưa có canary (DB mới/lần đầu thật)
// -> ghi canary bằng key hiện tại (bootstrap, không phải lỗi). Có canary nhưng giải không ra hoặc ra
// sai giá trị -> key đã đổi/mất giữa 2 lần chạy (vd secret.key bị mất còn DB vẫn còn, ĐÚNG kịch bản
// BL-20260921-003 cảnh báo) -> bật cờ mismatch + log rõ ràng, KHÔNG throw (không muốn sập cả server vì
// 1 secret cũ không đọc lại được — vẫn để `/health/ready` báo không sẵn sàng và vận hành tự quyết định
// xử lý tiếp, đúng khuôn `shutdownState`).
function verifyOrBootstrapCanary(key: Buffer): void {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CANARY_SETTING_KEY) as { value: string } | undefined;
  if (!row) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(CANARY_SETTING_KEY, encryptWithKey(CANARY_PLAINTEXT, key), now);
    return;
  }
  try {
    if (decryptWithKey(row.value, key) === CANARY_PLAINTEXT) return;
  } catch {
    // Rơi xuống nhánh mismatch bên dưới — lỗi xác thực GCM (sai key) cũng là bằng chứng mismatch.
  }
  secretKeyState.mismatch = true;
  console.error(
    '[secret] CẢNH BÁO: master key hiện tại KHÔNG khớp key đã dùng ở lần chạy trước (secret.key có thể ' +
    'đã bị mất/thay — xem docs/backlog/README.md BL-20260921-003). Mọi API key Redmine cá nhân + ' +
    'refresh_token đã lưu TRƯỚC ĐÂY sẽ không giải mã lại được. /health/ready sẽ báo không sẵn sàng.'
  );
}

const PREFIX = 'enc:v1:';

// Mã hóa: trả về "enc:v1:<iv>:<tag>:<cipher>" (mỗi phần base64). Chuỗi rỗng giữ rỗng.
export function maHoa(plain: string): string {
  if (!plain) return '';
  return encryptWithKey(plain, getMasterKey());
}

// Giải mã. Giá trị không có tiền tố (vd key cũ lưu plaintext) thì trả nguyên -> tương thích ngược.
export function giaiMa(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(PREFIX)) return stored;
  return decryptWithKey(stored, getMasterKey());
}
