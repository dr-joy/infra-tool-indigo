import type { DatabaseSync } from 'node:sqlite';

// Council review vòng 2 Lát 5 (CR-20260913, FR-32/FR-32a/FR-43) — đóng lỗ hổng thật mà vòng 1 để
// lại: route `GET /api/mindmaps/files/:name` (server/routes/mindmaps.ts) TRƯỚC ĐÂY quét SỐNG cột
// `mindmaps.data` (JSON actor tự ghi tự do qua POST/PUT /mindmaps, không kiểm nội dung chuỗi bên
// trong) mỗi lần có yêu cầu tải, để tìm mindmap nào "sở hữu" file di sản. Actor tự biết URL file di
// sản (rò rỉ qua chat/log/ảnh chụp) có thể tự nhét URL đó vào `data` của một mindmap RIÊNG do chính
// actor tạo — route sẽ thấy actor "sở hữu" 1 bản ghi tham chiếu và cấp quyền tải, dù actor không phải
// chủ thật của file gốc. Sửa: CHỤP MỘT LẦN DUY NHẤT (snapshot bất biến) ánh xạ "file di sản <-> mindmap
// sở hữu thật" tại đúng thời điểm hiện tại — trước khi actor có cơ hội tự nhét thêm tham chiếu giả sau
// đó — rồi route CHỈ tra bảng snapshot (server/schema/mindmap.ts: legacy_mindmap_file_owners), không
// quét sống nữa. Tham chiếu MỚI actor tự thêm SAU thời điểm chụp không còn tác dụng gì (không nằm
// trong bảng snapshot, route không bao giờ nhìn lại `mindmaps.data` để tìm chủ sở hữu nữa).
//
// Hàm ở đây CHỈ phục vụ đúng 1 lần chụp đó (gọi từ server/db-migrations.ts, runVersionedMigrations,
// gate bằng PRAGMA user_version — xem comment ở đó) cộng với test tích hợp gọi RAW trực tiếp để mô
// phỏng đúng thời điểm "chụp" (test/integration/mindmaps.test.ts). Route tải file KHÔNG import module
// này — route chỉ SELECT thẳng bảng snapshot.

// Cùng regex mà server/lib/mindmap-gc.ts (bản CŨ, đã xoá ở Lát 5 — xem lịch sử git trước Lát 5) từng
// dùng để dò URL file đính kèm cũ nhúng tự do trong cột mindmaps.data — tái dùng NGUYÊN VĂN logic dò
// URL đó (Council review vòng 1 Lát 5 yêu cầu, không viết lại từ đầu), giữ nguyên qua vòng 2.
const LEGACY_FILE_URL_RE = /\/api\/mindmaps\/files\/([^"'\s]+)/g;

interface MindmapDataRow {
  id: number;
  data: string;
}

// Quét TOÀN BỘ mindmaps.data hiện có tại thời điểm gọi, trả về map tên file di sản (đã decode) ->
// danh sách mindmap_id đang tham chiếu (mỗi mindmap chỉ tính 1 lần cho cùng 1 file, kể cả nhắc nhiều
// chỗ trong cùng cây JSON). Thuần đọc, không ghi gì — export riêng để test có thể kiểm logic quét độc
// lập với việc ghi snapshot nếu cần.
export function scanMindmapsForLegacyFileReferences(db: DatabaseSync): Map<string, number[]> {
  const rows = db.prepare('SELECT id, data FROM mindmaps').all() as unknown as MindmapDataRow[];
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const raw = String(row.data ?? '');
    const seenInThisRow = new Set<string>();
    for (const match of raw.matchAll(LEGACY_FILE_URL_RE)) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(match[1]);
      } catch {
        continue; // URL không decode được -> bỏ qua match này, không đoán (giống mindmap-gc.ts cũ)
      }
      if (seenInThisRow.has(decoded)) continue;
      seenInThisRow.add(decoded);
      const list = map.get(decoded);
      if (list) list.push(Number(row.id));
      else map.set(decoded, [Number(row.id)]);
    }
  }
  return map;
}

// Chụp snapshot: ghi mọi cặp (file_name, mindmap_id) hiện đang tham chiếu vào
// legacy_mindmap_file_owners. Bảng này BẤT BIẾN theo nghĩa: KHÔNG có đường "ghi đè" — dùng
// INSERT OR IGNORE trên PRIMARY KEY (file_name, mindmap_id), cặp đã tồn tại thì bỏ qua nguyên trạng,
// không đổi captured_at. Gọi hàm này nhiều lần AN TOÀN (không nhân đôi dòng) — nhưng ở sản phẩm thật
// chỉ được gọi ĐÚNG 1 LẦN (gate bằng PRAGMA user_version ở server/db-migrations.ts) vì tập file di sản
// (server/routes/mindmaps.ts: filesDir) đã đóng băng, không còn nhận file mới -> không có lý do hợp lệ
// nào để quét lại sau lần đầu. Test tích hợp gọi thẳng hàm RAW này (bỏ qua gate user_version) để mô
// phỏng đúng thời điểm "chụp" xảy ra giữa lúc test đang set up dữ liệu.
//
// Trả về số cặp (file_name, mindmap_id) MỚI vừa ghi (không tính cặp đã có từ trước bị INSERT OR
// IGNORE bỏ qua) — để bên gọi chỉ log khi thật sự có gì xảy ra (khớp quy ước log của các migration
// khác trong file này: DB rỗng/mới tinh thì im lặng, không log dòng vô nghĩa mỗi lần khởi động).
export function captureLegacyMindmapFileOwnersSnapshot(db: DatabaseSync): number {
  const map = scanMindmapsForLegacyFileReferences(db);
  if (map.size === 0) return 0;
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO legacy_mindmap_file_owners (file_name, mindmap_id, captured_at) VALUES (?, ?, ?)
  `);
  let insertedCount = 0;
  for (const [fileName, mindmapIds] of map) {
    for (const mindmapId of mindmapIds) {
      const result = insert.run(fileName, mindmapId, now);
      if (Number(result.changes) > 0) insertedCount++;
    }
  }
  return insertedCount;
}
