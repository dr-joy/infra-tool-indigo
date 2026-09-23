import { inflateRawSync } from 'node:zlib';
import { fileTypeFromBuffer } from 'file-type';

// CR-20260913 Lát 5 (FR-32a/FR-43) — danh sách đóng định dạng đính kèm Mind Map, 3 lớp phải khớp
// nhau: đuôi tên khai báo + MIME khai báo (multipart) + loại phát hiện THẬT (magic bytes cho
// ảnh/PDF, "bộ phân loại nội dung" cho text, cấu trúc ZIP cho Office). Từ chối bất kỳ định dạng nào
// KHÔNG nằm trong danh sách này, kể cả khi 3 lớp khớp nhau (vd .svg luôn bị từ chối dù hợp lệ SVG).
export type AttachmentKind = 'image' | 'pdf' | 'text' | 'office';

export interface AttachmentTypeRule {
  kind: AttachmentKind;
  extensions: string[];
  mimes: string[];
}

// Đúng danh sách đã chốt 13/09 (Q10) + kỹ thuật hoá 19/09 (Council 74715c65) — KHÔNG tự thêm bớt.
export const ATTACHMENT_TYPE_RULES: AttachmentTypeRule[] = [
  { kind: 'image', extensions: ['.png'], mimes: ['image/png'] },
  { kind: 'image', extensions: ['.jpg', '.jpeg'], mimes: ['image/jpeg'] },
  { kind: 'image', extensions: ['.gif'], mimes: ['image/gif'] },
  { kind: 'image', extensions: ['.webp'], mimes: ['image/webp'] },
  { kind: 'pdf', extensions: ['.pdf'], mimes: ['application/pdf'] },
  { kind: 'text', extensions: ['.txt'], mimes: ['text/plain'] },
  { kind: 'text', extensions: ['.md'], mimes: ['text/markdown', 'text/plain', 'text/x-markdown'] },
  { kind: 'text', extensions: ['.csv'], mimes: ['text/csv', 'text/plain', 'application/vnd.ms-excel'] },
  { kind: 'text', extensions: ['.html'], mimes: ['text/html'] },
  {
    kind: 'office',
    extensions: ['.docx'],
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  },
  {
    kind: 'office',
    extensions: ['.xlsx'],
    mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  },
  {
    kind: 'office',
    extensions: ['.pptx'],
    mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation']
  }
];

export const ALLOWED_EXTENSIONS = new Set(ATTACHMENT_TYPE_RULES.flatMap((r) => r.extensions));

export function ruleForExtension(ext: string): AttachmentTypeRule | undefined {
  const lower = ext.toLowerCase();
  return ATTACHMENT_TYPE_RULES.find((r) => r.extensions.includes(lower));
}

export function describeAllowedFormats(): string {
  return ATTACHMENT_TYPE_RULES.flatMap((r) => r.extensions).join(', ');
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  detectedMime: string | null;
}

// ── Lớp 3a — ảnh/PDF: magic bytes thật qua thư viện file-type (đọc signature nhị phân) ───────────
async function validateBinarySignature(buffer: Buffer, rule: AttachmentTypeRule): Promise<ValidationResult> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return { ok: false, reason: 'Không nhận diện được nội dung file thật (magic bytes)', detectedMime: null };
  if (!rule.mimes.includes(detected.mime)) {
    return { ok: false, reason: `Nội dung file thật không khớp định dạng khai báo (phát hiện: ${detected.mime})`, detectedMime: detected.mime };
  }
  return { ok: true, detectedMime: detected.mime };
}

// ── Lớp 3b — text (.txt/.md/.csv/.html): KHÔNG có magic bytes chuẩn. Kiểm bằng UTF-8 hợp lệ +
// không chứa control byte bất thường ("bộ phân loại nội dung", KHÔNG gọi là magic bytes — CR §FR-32a).
const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0d]); // tab, LF, CR

function isValidUtf8NoWeirdControlBytes(buffer: Buffer): boolean {
  let text: string;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    text = decoder.decode(buffer);
  } catch {
    return false;
  }
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    if (b < 0x20 && !ALLOWED_CONTROL_BYTES.has(b)) return false;
    if (b === 0x00) return false;
  }
  void text;
  return true;
}

function classifyAsHtml(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 4096).toString('utf8').toLowerCase();
  return /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/.test(head);
}

function classifyAsPlainText(buffer: Buffer, extension: string): ValidationResult {
  if (!isValidUtf8NoWeirdControlBytes(buffer)) {
    return { ok: false, reason: 'Nội dung không phải văn bản UTF-8 hợp lệ (nghi ngờ file nhị phân giả mạo đuôi text)', detectedMime: null };
  }
  if (extension === '.html') {
    if (!classifyAsHtml(buffer)) {
      return { ok: false, reason: 'Nội dung không giống HTML thật (thiếu thẻ <html>/<head>/<body>)', detectedMime: null };
    }
    return { ok: true, detectedMime: 'text/html' };
  }
  return { ok: true, detectedMime: extension === '.md' ? 'text/markdown' : extension === '.csv' ? 'text/csv' : 'text/plain' };
}

// ── Lớp 3c — Office (.docx/.xlsx/.pptx): phải là ZIP hợp lệ, không ZIP64, không mã hoá, giới hạn
// entry/dung lượng/tỉ lệ nén/độ sâu, có [Content_Types].xml + entry đặc trưng đúng loại, từ chối
// vbaProject.bin/content-type macro/path traversal/symlink. Đọc CENTRAL DIRECTORY (đã có sẵn
// compressed/uncompressed size KHÔNG cần giải nén) — không giải nén ra thư mục phục vụ.
const EOCD_SIG = 0x06054b50;
const CD_ENTRY_SIG = 0x02014b50;
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50;
const MAX_EOCD_COMMENT = 65535;
const MAX_ZIP_ENTRIES = 2000;
const MAX_ZIP_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024; // 200MB tổng, đủ rộng cho tài liệu văn phòng thật
const MAX_ZIP_RATIO = 300; // uncompressed/compressed tối đa — chặn zip-bomb
const MAX_ZIP_ENTRY_DEPTH = 15;
const MAX_CONTENT_TYPES_SIZE = 1 * 1024 * 1024;

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  generalPurposeFlag: number;
  localHeaderOffset: number;
  externalAttributes: number;
}

function findEocd(buf: Buffer): { offset: number } | null {
  const start = Math.max(0, buf.length - 22 - MAX_EOCD_COMMENT);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return { offset: i };
  }
  return null;
}

function parseZipCentralDirectory(buf: Buffer): { entries: ZipEntry[] } | { error: string } {
  if (buf.length < 22) return { error: 'File quá nhỏ để là ZIP hợp lệ' };
  const eocd = findEocd(buf);
  if (!eocd) return { error: 'Không tìm thấy End Of Central Directory — không phải ZIP hợp lệ' };
  const o = eocd.offset;

  // Vùng ngay trước EOCD có thể chứa ZIP64 EOCD locator — nếu có, hoặc các trường sentinel
  // 0xFFFF/0xFFFFFFFF trong EOCD thường, đây là ZIP64 -> từ chối (CR quy tắc "không ZIP64").
  if (o >= 20 && buf.readUInt32LE(o - 20) === ZIP64_EOCD_LOCATOR_SIG) {
    return { error: 'File dùng định dạng ZIP64 — không được hỗ trợ' };
  }
  const totalEntries = buf.readUInt16LE(o + 10);
  const cdSize = buf.readUInt32LE(o + 12);
  const cdOffset = buf.readUInt32LE(o + 16);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    return { error: 'File dùng định dạng ZIP64 — không được hỗ trợ' };
  }
  if (totalEntries > MAX_ZIP_ENTRIES) return { error: `Quá nhiều entry trong file nén (${totalEntries} > ${MAX_ZIP_ENTRIES})` };
  if (cdOffset + cdSize > buf.length) return { error: 'Central directory vượt ngoài file — ZIP hỏng hoặc bị chỉnh sửa' };

  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CD_ENTRY_SIG) {
      return { error: 'Central directory hỏng — không đọc được entry' };
    }
    const generalPurposeFlag = buf.readUInt16LE(pos + 8);
    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const externalAttributes = buf.readUInt32LE(pos + 38);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      return { error: 'File dùng định dạng ZIP64 — không được hỗ trợ' };
    }
    const nameStart = pos + 46;
    if (nameStart + nameLen > buf.length) return { error: 'Central directory hỏng — tên entry vượt ngoài file' };
    const name = buf.toString('utf8', nameStart, nameStart + nameLen);

    if (generalPurposeFlag & 0x1) return { error: 'File nén có entry đã mã hoá — không được hỗ trợ' };

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED) return { error: 'Tổng dung lượng giải nén vượt giới hạn cho phép' };
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_ZIP_RATIO) {
      return { error: `Tỉ lệ nén bất thường ở entry "${name}" — nghi ngờ zip-bomb` };
    }
    if (name.includes('..') || name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name) || name.includes('\0')) {
      return { error: `Tên entry không an toàn: "${name}"` };
    }
    const depth = name.split('/').length - 1;
    if (depth > MAX_ZIP_ENTRY_DEPTH) return { error: `Entry "${name}" sâu quá giới hạn thư mục cho phép` };
    // Symlink Unix (external attributes cao 16 bit = mode; S_IFLNK = 0xA000).
    if (((externalAttributes >>> 16) & 0xf000) === 0xa000) {
      return { error: `Entry "${name}" là symlink — không được hỗ trợ` };
    }
    const lowerName = name.toLowerCase();
    if (lowerName === 'vbaproject.bin' || lowerName.endsWith('/vbaproject.bin')) {
      return { error: 'File chứa vbaProject.bin (macro VBA) — không được chấp nhận' };
    }

    entries.push({ name, compressedSize, uncompressedSize, compressionMethod, generalPurposeFlag, localHeaderOffset, externalAttributes });
    pos = nameStart + nameLen + extraLen + commentLen;
  }
  return { entries };
}

// Đọc + giải nén (nếu cần) đúng 1 entry nhỏ (local header nằm ở localHeaderOffset) — dùng để soi
// nội dung [Content_Types].xml tìm dấu hiệu macro. Giới hạn kích thước trước khi inflate.
function readZipEntryContent(buf: Buffer, entry: ZipEntry): Buffer | null {
  if (entry.uncompressedSize > MAX_CONTENT_TYPES_SIZE) return null;
  const lh = entry.localHeaderOffset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) return null;
  const raw = buf.subarray(dataStart, dataEnd);
  if (entry.compressionMethod === 0) return Buffer.from(raw);
  if (entry.compressionMethod === 8) {
    try { return inflateRawSync(raw); } catch { return null; }
  }
  return null; // phương thức nén khác -> không soi được, coi như không tìm thấy dấu hiệu macro (không chặn)
}

const OFFICE_MARKER_PREFIX: Record<string, string> = {
  '.docx': 'word/',
  '.xlsx': 'xl/',
  '.pptx': 'ppt/'
};

function validateOfficeZip(buffer: Buffer, extension: string): ValidationResult {
  const parsed = parseZipCentralDirectory(buffer);
  if ('error' in parsed) return { ok: false, reason: parsed.error, detectedMime: null };
  const { entries } = parsed;

  const contentTypes = entries.find((e) => e.name === '[Content_Types].xml');
  if (!contentTypes) return { ok: false, reason: 'Thiếu [Content_Types].xml — không phải file Office hợp lệ', detectedMime: null };

  const markerPrefix = OFFICE_MARKER_PREFIX[extension];
  if (markerPrefix && !entries.some((e) => e.name.startsWith(markerPrefix))) {
    return { ok: false, reason: `Thiếu thư mục "${markerPrefix}" đặc trưng cho ${extension} — nghi ngờ đổi đuôi file`, detectedMime: null };
  }

  const contentTypesBuf = readZipEntryContent(buffer, contentTypes);
  if (contentTypesBuf) {
    const text = contentTypesBuf.toString('utf8');
    if (/macroenabled/i.test(text)) {
      return { ok: false, reason: 'File khai báo content type macro (macroEnabled) — không được chấp nhận', detectedMime: null };
    }
  }

  const rule = ruleForExtension(extension);
  return { ok: true, detectedMime: rule?.mimes[0] ?? 'application/zip' };
}

export interface ValidateAttachmentInput {
  originalName: string;
  declaredMime: string;
  buffer: Buffer;
}

export interface ValidateAttachmentOutput {
  ok: boolean;
  reason?: string;
  extension?: string;
  detectedMime?: string | null;
}

// Cổng kiểm 3 lớp duy nhất — gọi từ route upload. Không cho qua nếu bất kỳ lớp nào thiếu khớp.
export async function validateAttachment(input: ValidateAttachmentInput): Promise<ValidateAttachmentOutput> {
  const extMatch = /\.[a-z0-9]+$/i.exec(input.originalName);
  const extension = (extMatch?.[0] || '').toLowerCase();
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    return { ok: false, reason: `Đuôi file không được hỗ trợ. Định dạng cho phép: ${describeAllowedFormats()}` };
  }
  const rule = ruleForExtension(extension)!;
  if (!rule.mimes.includes(input.declaredMime)) {
    return { ok: false, reason: `MIME khai báo (${input.declaredMime || 'không rõ'}) không khớp đuôi file ${extension}. Định dạng cho phép: ${describeAllowedFormats()}` };
  }
  if (input.buffer.length === 0) return { ok: false, reason: 'File rỗng' };

  let result: ValidationResult;
  if (rule.kind === 'image' || rule.kind === 'pdf') {
    result = await validateBinarySignature(input.buffer, rule);
  } else if (rule.kind === 'text') {
    result = classifyAsPlainText(input.buffer, extension);
  } else {
    result = validateOfficeZip(input.buffer, extension);
  }
  if (!result.ok) {
    return { ok: false, reason: `${result.reason}. Định dạng cho phép: ${describeAllowedFormats()}`, extension, detectedMime: result.detectedMime };
  }
  return { ok: true, extension, detectedMime: result.detectedMime };
}
