// validateAttachment (server/lib/file-validation.ts) — CR-20260913 Lát 5 (FR-32a/FR-43). Phần ảnh/
// PDF/text/đuôi-nguy-hiểm đã có test tích hợp ở test/integration/mindmaps.test.ts, nhưng lớp 3c
// (Office .docx/.xlsx/.pptx — parse ZIP tay, ~150 dòng riêng trong file-validation.ts) CHƯA có test
// nào (xác nhận bằng grep trước khi viết) — vi phạm "AC âm bắt buộc" của CR (dòng ~1784: "OOXML giả
// mạo, ZIP64 dị dạng, compression bomb đều bị từ chối") và AC-40 (macro .docm/.xlsm bị chặn). Phát
// hiện ở Council review vòng 1 Lát 5.
//
// Không dùng thư viện zip nào (jszip/zip-stream/unzipper có mặt trong node_modules nhưng CHỈ là dep
// bắc cầu của package khác — chưa từng khai trong package.json, không phải dependency thật của dự án)
// — tự dựng buffer ZIP tối thiểu đúng định dạng mà chính parseZipCentralDirectory() trong
// file-validation.ts đọc (local file header 0x04034b50 / central directory entry 0x02014b50 / EOCD
// 0x06054b50), để test độc lập với bất kỳ implementation ZIP ngoài nào và khớp chính xác byte-offset
// mà code sản phẩm kỳ vọng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { validateAttachment } from '../../server/lib/file-validation.js';

interface ZipEntrySpec {
  name: string;
  data: Buffer;
  method?: 0 | 8; // 0 = store, 8 = deflate
}

function buildZip(entries: ZipEntrySpec[]): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const localHeaderOffset = offset;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // general purpose flag
    localHeader.writeUInt16LE(method, 8); // compression method
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(0, 14); // crc32 (không kiểm bởi code sản phẩm)
    localHeader.writeUInt32LE(compressed.length, 18); // compressed size
    localHeader.writeUInt32LE(entry.data.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, compressed);
    offset += localHeader.length + nameBuf.length + compressed.length;

    const cdEntry = Buffer.alloc(46);
    cdEntry.writeUInt32LE(0x02014b50, 0);
    cdEntry.writeUInt16LE(20, 4); // version made by
    cdEntry.writeUInt16LE(20, 6); // version needed
    cdEntry.writeUInt16LE(0, 8); // general purpose flag
    cdEntry.writeUInt16LE(method, 10); // compression method
    cdEntry.writeUInt16LE(0, 12); // mod time
    cdEntry.writeUInt16LE(0, 14); // mod date
    cdEntry.writeUInt32LE(0, 16); // crc32
    cdEntry.writeUInt32LE(compressed.length, 20); // compressed size
    cdEntry.writeUInt32LE(entry.data.length, 24); // uncompressed size
    cdEntry.writeUInt16LE(nameBuf.length, 28);
    cdEntry.writeUInt16LE(0, 30); // extra field length
    cdEntry.writeUInt16LE(0, 32); // comment length
    cdEntry.writeUInt16LE(0, 34); // disk number start
    cdEntry.writeUInt16LE(0, 36); // internal attributes
    cdEntry.writeUInt32LE(0, 38); // external attributes (không phải symlink)
    cdEntry.writeUInt32LE(localHeaderOffset, 42);
    cdParts.push(cdEntry, nameBuf);
  }

  const cdOffset = offset;
  const cdBuf = Buffer.concat(cdParts);
  const cdSize = cdBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

const CONTENT_TYPES_XML = '<?xml version="1.0"?><Types xmlns="x"><Default Extension="xml" ContentType="application/xml"/></Types>';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function validDocxZip(): Buffer {
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from('<w:document/>', 'utf8') }
  ]);
}

// ── Ca thuận (FR-43, nhãn con truy vết trong CR): upload docx hợp lệ tạo đúng bản ghi ────────────
test('ca thuận: .docx là ZIP hợp lệ, có [Content_Types].xml + thư mục word/ -> pass', async () => {
  const result = await validateAttachment({ originalName: 'bao-cao.docx', declaredMime: DOCX_MIME, buffer: validDocxZip() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.extension, '.docx');
});

// ── AC âm bắt buộc: "OOXML giả mạo" — đuôi .docx nhưng nội dung KHÔNG phải ZIP thật ─────────────
test('AC âm: .docx giả — nội dung hoàn toàn không phải ZIP (không có EOCD) -> bị từ chối', async () => {
  const result = await validateAttachment({
    originalName: 'gia-mao.docx',
    declaredMime: DOCX_MIME,
    buffer: Buffer.from('đây không phải file ZIP thật, chỉ là văn bản thường', 'utf8')
  });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /ZIP|End Of Central Directory/i);
});

// ── AC âm bắt buộc: "ZIP thật nhưng thiếu [Content_Types].xml hợp lệ" ────────────────────────────
test('AC âm: .docx là ZIP THẬT nhưng thiếu [Content_Types].xml -> bị từ chối', async () => {
  const zip = buildZip([{ name: 'word/document.xml', data: Buffer.from('<w:document/>', 'utf8') }]);
  const result = await validateAttachment({ originalName: 'thieu-content-types.docx', declaredMime: DOCX_MIME, buffer: zip });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /Content_Types/);
});

test('AC âm: .docx là ZIP thật, có [Content_Types].xml nhưng thiếu thư mục word/ đặc trưng -> bị từ chối (nghi đổi đuôi)', async () => {
  const zip = buildZip([{ name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') }]);
  const result = await validateAttachment({ originalName: 'doi-duoi.docx', declaredMime: DOCX_MIME, buffer: zip });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /word\/|đặc trưng/i);
});

// ── AC âm bắt buộc: "ZIP64 dị dạng" ───────────────────────────────────────────────────────────────
test('AC âm: ZIP64 (sentinel totalEntries=0xFFFF trong EOCD) -> bị từ chối, không crash', async () => {
  const zip = validDocxZip();
  // EOCD nằm ở 22 byte cuối — trường "tổng số entry" mà code đọc là offset +10 (buf.readUInt16LE(o+10),
  // xem file-validation.ts) — ghi đè đúng offset này thành sentinel ZIP64 (không phải +8, đó là
  // "số entry trên disk này", code không đọc trường đó).
  const eocdOffset = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocdOffset), 0x06054b50, 'test tự kiểm: offset EOCD phải đúng trước khi mô phỏng ZIP64');
  zip.writeUInt16LE(0xffff, eocdOffset + 10);
  const result = await validateAttachment({ originalName: 'zip64-gia.docx', declaredMime: DOCX_MIME, buffer: zip });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /ZIP64/i);
});

test('AC âm: ZIP64 EOCD locator ngay trước EOCD thường -> bị từ chối, không crash', async () => {
  const zip = validDocxZip();
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0); // ZIP64_EOCD_LOCATOR_SIG
  const withLocator = Buffer.concat([zip.subarray(0, zip.length - 22), locator, zip.subarray(zip.length - 22)]);
  const result = await validateAttachment({ originalName: 'zip64-locator.docx', declaredMime: DOCX_MIME, buffer: withLocator });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /ZIP64/i);
});

// ── AC âm bắt buộc: "compression bomb" (tỉ lệ nén bất thường) ───────────────────────────────────────
test('AC âm: entry khai tỉ lệ nén > 300 lần (compressed nhỏ, uncompressed khổng lồ) -> bị từ chối', async () => {
  // Chỉ cần đúng SỐ LIỆU khai trong central directory là đủ để trigger — parseZipCentralDirectory()
  // tính tỉ lệ từ compressedSize/uncompressedSize đọc trực tiếp trong CD, KHÔNG giải nén thật entry
  // này (đã đọc code để xác nhận, không đoán) nên không cần dữ liệu nén thật khớp kích thước khai.
  const entries: ZipEntrySpec[] = [
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
    { name: 'word/bomb.bin', data: Buffer.alloc(10, 0x41), method: 0 }
  ];
  const zip = buildZip(entries);
  // Tìm central directory entry của "word/bomb.bin" và ghi đè compressedSize/uncompressedSize để khai
  // tỉ lệ 1000 lần (vượt MAX_ZIP_RATIO=300) mà không cần entry ZIP thật sự nén được tới mức đó.
  const marker = Buffer.from('word/bomb.bin', 'utf8');
  const idx = zip.lastIndexOf(marker); // lần xuất hiện cuối = trong central directory (sau local header)
  assert.ok(idx > 0);
  const cdHeaderStart = idx - 46; // tên nằm ngay sau 46-byte header cố định của CD entry
  assert.equal(zip.readUInt32LE(cdHeaderStart), 0x02014b50, 'test tự kiểm: phải đúng vị trí CD entry trước khi ghi đè');
  zip.writeUInt32LE(10, cdHeaderStart + 20); // compressedSize = 10 byte thật
  zip.writeUInt32LE(10 * 1000, cdHeaderStart + 24); // uncompressedSize khai khống = 10000 byte -> tỉ lệ 1000
  const result = await validateAttachment({ originalName: 'bomb.docx', declaredMime: DOCX_MIME, buffer: zip });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /tỉ lệ nén|zip-bomb/i);
});

test('AC âm: tổng dung lượng giải nén vượt trần 200MB -> bị từ chối', async () => {
  const entries: ZipEntrySpec[] = [{ name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') }];
  const zip = buildZip(entries);
  const marker = Buffer.from('[Content_Types].xml', 'utf8');
  const idx = zip.lastIndexOf(marker);
  const cdHeaderStart = idx - 46;
  assert.equal(zip.readUInt32LE(cdHeaderStart), 0x02014b50);
  // Giữ compressedSize nhỏ (để không đụng trần tỉ lệ nén 300 lần trước) nhưng khai uncompressedSize
  // vượt hẳn 200MB — đủ nhỏ tỉ lệ (< 300) để không bị chặn NHẦM bởi kiểm tra tỉ lệ nén trước đó.
  zip.writeUInt32LE(1_000_000, cdHeaderStart + 20); // compressed 1MB
  zip.writeUInt32LE(250 * 1024 * 1024, cdHeaderStart + 24); // uncompressed 250MB, tỉ lệ = 250 < 300
  const result = await validateAttachment({ originalName: 'khong-lo.docx', declaredMime: DOCX_MIME, buffer: zip });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /vượt giới hạn/i);
});

// ── AC-40: macro .docm bị từ chối ────────────────────────────────────────────────────────────────
for (const filename of ['macro.docm', 'macro.xlsm', 'macro.pptm']) {
  test(`AC-40: đuôi macro ${filename} bị từ chối ngay ở bước đuôi file (chưa mở rộng danh sách cho macro)`, async () => {
    const result = await validateAttachment({ originalName: filename, declaredMime: 'application/octet-stream', buffer: validDocxZip() });
    assert.equal(result.ok, false);
    assert.match(result.reason || '', /Đuôi file không được hỗ trợ/);
  });
}

test('AC-40 (phòng thủ theo chiều sâu): .docx hợp lệ nhưng ZIP chứa vbaProject.bin -> vẫn bị từ chối dù đuôi/MIME đúng', async () => {
  const zip = buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from('<w:document/>', 'utf8') },
    { name: 'word/vbaProject.bin', data: Buffer.from([0x01, 0x02, 0x03]) }
  ]);
  const result = await validateAttachment({ originalName: 'co-macro.docx', declaredMime: DOCX_MIME, buffer: zip });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /vbaProject/i);
});

test('AC-40 (phòng thủ theo chiều sâu): [Content_Types].xml khai content type macroEnabled -> bị từ chối', async () => {
  const macroContentTypes = '<?xml version="1.0"?><Types xmlns="x"><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>';
  const zip = buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(macroContentTypes, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from('<w:document/>', 'utf8') }
  ]);
  const result = await validateAttachment({ originalName: 'macro-content-type.docx', declaredMime: DOCX_MIME, buffer: zip });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /macroEnabled|macro/i);
});
