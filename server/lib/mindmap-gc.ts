import path from 'node:path';
import fs from 'node:fs';
import { db } from '../db.js';
import { dataDir } from '../paths.js';

// File đính kèm mindmap không đi qua khoá ngoại — sơ đồ chỉ nhắc URL trong JSON tự do,
// nên xoá/sửa sơ đồ để lại rác trên đĩa vô hạn (BL-20260831-001). GC này chạy mark-and-sweep:
// gom mọi storedName còn được nhắc tới trong cột data, rồi cách ly (không xoá thẳng) file lạ.
const filesDir = path.join(dataDir, 'mindmap-files');
const quarantineDir = path.join(filesDir, '.quarantine');

const QUARANTINE_TTL_MS = 24 * 60 * 60 * 1000;
const URL_RE = /\/api\/mindmaps\/files\/([^"'\s]+)/g;

// Codex chi ra phan doi chan that (review BL-20260831-001): ban truoc, loi doc DB tra ve MOT
// SET RONG - runMindmapGc() van tiep tuc sweep voi set rong do, coi TOAN BO file la rac va
// quarantine het (fail-OPEN, nguoc han thiet ke "loi doc DB thi khong don gi ca"). Tuong tu, 1
// dong JSON hong chi duoc "co gang bao ve rieng file cua dong do bang regex" roi VAN tiep tuc
// sweep binh thuong cho cac dong khac - khong dung "khong dong gi" nhu thiet ke goc yeu cau, va
// regex/decodeURIComponent that bai co the bo sot dung mot URL that.
//
// Sua: tra ve KET QUA CO PHAN BIET ro rang (ok:false = khong the tin tuong duoc tap tham chieu
// luc nay) thay vi mot Set luon "thanh cong". runMindmapGc() PHAI bo qua CA sweep LAN purge khi
// ok:false - dung dung nghia "khong dong gi ca" cho ca loi doc DB, loi parse JSON, va loi decode
// URL (ca ba deu la dau hieu du lieu khong dang tin, khong chi rieng loi doc DB).
type CollectResult = { ok: true; referenced: Set<string> } | { ok: false };

function collectReferencedStoredNames(): CollectResult {
  const referenced = new Set<string>();
  let rows: Record<string, unknown>[];
  try {
    rows = db.prepare('SELECT id, data FROM mindmaps').all() as Record<string, unknown>[];
  } catch (error) {
    console.error('[mindmap-gc] không đọc được bảng mindmaps -> huỷ cả lượt GC, không đụng gì cả:', error);
    return { ok: false };
  }

  for (const row of rows) {
    const raw = String(row.data ?? '');
    try {
      JSON.parse(raw);
    } catch {
      console.error(`[mindmap-gc] mindmap id=${row.id} có data không parse được JSON -> huỷ cả lượt GC, không đụng gì cả`);
      return { ok: false };
    }
    for (const match of raw.matchAll(URL_RE)) {
      try {
        referenced.add(decodeURIComponent(match[1]));
      } catch (error) {
        console.error(`[mindmap-gc] mindmap id=${row.id} có URL file không decode được -> huỷ cả lượt GC, không đụng gì cả:`, error);
        return { ok: false };
      }
    }
  }
  return { ok: true, referenced };
}

function sweepUnreferencedFiles(referenced: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(filesDir, { withFileTypes: true });
  } catch (error) {
    console.error('[mindmap-gc] không đọc được filesDir:', error);
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (referenced.has(entry.name)) continue;
    try {
      fs.mkdirSync(quarantineDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const dest = path.join(quarantineDir, `${timestamp}__${entry.name}`);
      fs.renameSync(path.join(filesDir, entry.name), dest);
    } catch (error) {
      console.error(`[mindmap-gc] không quarantine được file rác "${entry.name}":`, error);
    }
  }
}

// Tên file trong .quarantine/: <ISO-timestamp với ":" đổi thành "-">__<tên gốc>. Đọc lại
// timestamp từ CHÍNH tên file (không dùng mtime hệ thống) vì mtime không đáng tin xuyên nền
// tảng/khi copy file. Date.toISOString() luôn ra đúng 24 ký tự "YYYY-MM-DDTHH-mm-ss.sssZ"
// (sau khi đổi ":" -> "-") nên ghép lại 2 dấu ":" theo đúng vị trí cố định; sai định dạng/độ
// dài -> bỏ qua, không đoán, không xoá.
function parseQuarantineTimestamp(fileName: string): number | null {
  const sep = fileName.indexOf('__');
  if (sep === -1) return null;
  const rawTimestamp = fileName.slice(0, sep);
  if (rawTimestamp.length !== 24) return null;
  const iso = `${rawTimestamp.slice(0, 13)}:${rawTimestamp.slice(14, 16)}:${rawTimestamp.slice(17)}`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function purgeExpiredQuarantine(now: number): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(quarantineDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const timestamp = parseQuarantineTimestamp(entry.name);
    if (timestamp == null) continue;
    if (now - timestamp < QUARANTINE_TTL_MS) continue;
    try {
      fs.unlinkSync(path.join(quarantineDir, entry.name));
    } catch (error) {
      console.error(`[mindmap-gc] không xoá được file quarantine hết hạn "${entry.name}":`, error);
    }
  }
}

export function runMindmapGc(): void {
  const result = collectReferencedStoredNames();
  if (!result.ok) {
    console.error('[mindmap-gc] không xác định được tập file đang được tham chiếu -> bỏ qua toàn bộ lượt GC này (cả sweep lẫn purge), thử lại ở lần khởi động sau.');
    return;
  }
  sweepUnreferencedFiles(result.referenced);
  purgeExpiredQuarantine(Date.now());
}
