#!/usr/bin/env node
// CỔNG BE error-code registry (BL-20260913-005, CR-20260913-c) — chặn mã lỗi machine-readable MỚI
// (`code: 'XXX'` trong response JSON, hoặc tham số thứ 3 của `new HttpError(status, msg, 'XXX')`)
// không được đăng ký ở server/lib/error-codes.ts.
//
// Phạm vi CHỦ Ý hẹp: kiểm kê 2026-09-13 xác nhận server/routes/* chỉ có 6 mã machine-readable thật,
// phần lớn lỗi khác chỉ có message tiếng Việt (không có code) — cổng này KHÔNG bắt gắn code cho lỗi
// cũ, chỉ chặn mã MỚI không đăng ký đi kèm route mới/sửa route cũ thêm code.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const VUNG_QUET = ['server/routes'];
export const FILE_REGISTRY = 'server/lib/error-codes.ts';

function dongCua(src, viTri) {
  return src.slice(0, viTri).split('\n').length;
}

// Tìm `code: 'XXX'` dạng field JSON response trực tiếp (không qua HttpError).
function timMaJsonField(src, ten) {
  const ra = [];
  const re = /code:\s*'([A-Z0-9_]+)'/g;
  let m;
  while ((m = re.exec(src))) {
    ra.push({ file: ten, code: m[1], dong: dongCua(src, m.index) });
  }
  return ra;
}

// Tìm `new HttpError(status, msg, 'XXX')` — có thể nhiều dòng, nên cân ngoặc thay vì regex 1 dòng.
function timMaHttpError(src, ten) {
  const ra = [];
  let idx = 0;
  const tu = 'new HttpError(';
  while (true) {
    idx = src.indexOf(tu, idx);
    if (idx === -1) break;
    const start = idx + tu.length;
    let sau = 1;
    let i = start;
    while (sau > 0 && i < src.length) {
      if (src[i] === '(') sau++;
      else if (src[i] === ')') sau--;
      i++;
    }
    const args = src.slice(start, i - 1);
    const m = /'([A-Z0-9_]{3,})'\s*$/.exec(args.trim());
    if (m) ra.push({ file: ten, code: m[1], dong: dongCua(src, idx) });
    idx = i;
  }
  return ra;
}

// Quét MỘT nguồn route. Hàm thuần (không đọc đĩa) để test bơm chuỗi vào.
export function timMaLoiTrongFile(src, ten = '<nguon>') {
  return [...timMaJsonField(src, ten), ...timMaHttpError(src, ten)];
}

// Đọc danh sách mã ĐÃ đăng ký từ nội dung server/lib/error-codes.ts (regex trên object literal,
// không cần compile TS — cùng phong cách với các cổng .mjs khác trong scripts/).
export function layDanhSachDangKy(srcErrorCodesTs) {
  const re = /^\s{2}([A-Z][A-Z0-9_]*):\s*\{/gm;
  const ra = new Set();
  let m;
  while ((m = re.exec(srcErrorCodesTs))) ra.add(m[1]);
  return ra;
}

// So khớp mã tìm thấy với danh sách đã đăng ký. Trả về mã MỚI chưa đăng ký (mỗi vị trí một mục,
// không gộp trùng — để báo đúng tất cả chỗ phát sinh).
export function timMaChuaDangKy(maTimThay, dangKy) {
  return maTimThay.filter((m) => !dangKy.has(m.code));
}

// ── Chạy trên vùng quét ──────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-error-codes.mjs')) {
  const registryAbs = path.join(root, FILE_REGISTRY);
  if (!fs.existsSync(registryAbs)) {
    console.error(`  ✖ không thấy ${FILE_REGISTRY} — cổng cần file này để biết mã nào đã đăng ký`);
    process.exit(1);
  }
  const dangKy = layDanhSachDangKy(fs.readFileSync(registryAbs, 'utf8'));

  let tongViPham = 0;
  for (const relDir of VUNG_QUET) {
    const absDir = path.join(root, relDir);
    if (!fs.existsSync(absDir)) continue;
    const files = fs.readdirSync(absDir).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const rel = path.join(relDir, f).replace(/\\/g, '/');
      const src = fs.readFileSync(path.join(absDir, f), 'utf8');
      const timThay = timMaLoiTrongFile(src, rel);
      const chuaDangKy = timMaChuaDangKy(timThay, dangKy);
      for (const v of chuaDangKy) {
        console.error(`  ✖ ${v.file}:${v.dong} — mã lỗi "${v.code}" CHƯA đăng ký ở ${FILE_REGISTRY}`);
        tongViPham++;
      }
    }
  }

  if (tongViPham > 0) {
    console.error(`
✖ ${tongViPham} mã lỗi mới chưa đăng ký.

  Thêm entry vào ${FILE_REGISTRY} (status HTTP thật + 1 câu note khi nào dùng) rồi chạy lại cổng này.
  Mã lỗi cũ (đã có trước CR-20260913-c) không cần sửa gì — cổng chỉ chặn mã MỚI.
`);
    process.exit(1);
  }
  console.log(`✔ BE error-code registry: mọi mã lỗi trong ${VUNG_QUET.join(', ')} đều đã đăng ký`);
}
