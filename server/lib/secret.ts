import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../paths.js';

// Mã hóa hai chiều (AES-256-GCM) cho các bí mật cần lấy lại được để dùng (vd: API
// key Redmine phải gắn vào header). KHÔNG dùng hash vì hash một chiều, không khôi
// phục được key gốc.
//
// Master key sinh ngẫu nhiên 32 byte, lưu trong file NẰM NGOÀI thư mục data
// (%APPDATA%\TaskManager\secret.key — trên 1 cấp so với data). Backup DB nằm trong
// data\backups nên không bao giờ chứa key này: leak DB/backup chỉ thấy chuỗi đã mã
// hóa, không giải được vì thiếu master key.
const keyFile = path.join(path.dirname(dataDir), 'secret.key');

let masterKey: Buffer | null = null;
function getMasterKey(): Buffer {
  if (masterKey) return masterKey;
  if (existsSync(keyFile)) {
    const buf = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
    if (buf.length === 32) {
      masterKey = buf;
      return masterKey;
    }
  }
  // Chưa có (hoặc hỏng) -> sinh mới và lưu, quyền chỉ chủ sở hữu đọc/ghi.
  masterKey = randomBytes(32);
  writeFileSync(keyFile, masterKey.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(keyFile, 0o600); } catch { /* Windows có thể bỏ qua chmod */ }
  return masterKey;
}

const PREFIX = 'enc:v1:';

// Mã hóa: trả về "enc:v1:<iv>:<tag>:<cipher>" (mỗi phần base64). Chuỗi rỗng giữ rỗng.
export function maHoa(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getMasterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, enc].map((b) => b.toString('base64')).join(':');
}

// Giải mã. Giá trị không có tiền tố (vd key cũ lưu plaintext) thì trả nguyên -> tương thích ngược.
export function giaiMa(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(PREFIX)) return stored;
  const [ivB, tagB, encB] = stored.slice(PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', getMasterKey(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}
