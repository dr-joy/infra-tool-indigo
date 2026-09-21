#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// VÙNG QUYẾT ĐỊNH — chốt trong CR-20260804 §6.1, không phải danh sách tuỳ ý.
// Cố ý KHÔNG có mappers/utils/weekly-report/screens: gần như toàn bộ là hiển thị, kéo vào sẽ cần
// ~15 marker và biến cổng thành tiếng ồn. Giới hạn đã biết, xem CR §5.
export const VUNG_QUYET_DINH = [
  'server/lib/recurrence.ts',
  'server/routes/schedules.ts',
  'src/lib/date.ts',
  'src/main.tsx'
];

// FR-1: API đọc/ghi thành phần ngày-giờ theo múi giờ MÁY.
// KHÔNG có Date.now()/getTime(): chúng là thời điểm tuyệt đối, không phụ thuộc múi giờ.
const API_CAM = ['getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'setHours', 'setMinutes'];

// FR-1b: helper của repo tự dựng giờ máy. Dùng ở vùng quyết định là sai kể cả khi không thấy API gốc.
const HELPER_CAM = ['localDateInputValue', 'parseLocalDateTime', 'taoNgayTuInput', 'congNgayInput', 'congThangInput'];

const MARKER = /\/\/\s*tz-ok\s*:?(.*)$/;

// Bỏ comment + string literal, GIỮ NGUYÊN số dòng (thay bằng khoảng trắng) để báo lỗi đúng dòng.
// Cần bước này vì vn-time.ts và date.ts có comment NÊU TÊN các API bị cấm — chính hai file dạy về
// rule sẽ đỏ nếu khớp thô, và người dùng sẽ học cách tắt cổng.
export function boCommentVaString(src) {
  let ra = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    // comment dòng
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { ra += ' '; i++; }
      continue;
    }
    // comment khối
    if (c === '/' && c2 === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { ra += src[i] === '\n' ? '\n' : ' '; i++; }
      ra += '  '; i += 2;
      continue;
    }
    // string / template literal
    if (c === '"' || c === "'" || c === '`') {
      const dau = c;
      ra += ' '; i++;
      while (i < n) {
        if (src[i] === '\\') { ra += '  '; i += 2; continue; }
        if (src[i] === dau) { ra += ' '; i++; break; }
        // `${...}` trong template literal là CODE, không phải chuỗi — phải giữ lại.
        // Không giữ thì `occKeyOf` lọt cổng: nó gọi getFullYear/getMonth/getDate hoàn toàn
        // bên trong một template literal (đúng lỗi cổng này sinh ra để bắt).
        if (dau === '`' && src[i] === '$' && src[i + 1] === '{') {
          ra += '  '; i += 2;
          let sau = 1;
          while (i < n && sau > 0) {
            if (src[i] === '{') sau++;
            else if (src[i] === '}') { sau--; if (sau === 0) { ra += ' '; i++; break; } }
            ra += src[i];
            i++;
          }
          continue;
        }
        ra += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    ra += c;
    i++;
  }
  return ra;
}

// `new Date(...)` với >= 3 tham số ở cấp ngoặc ngoài cùng = dựng theo giờ máy.
// `new Date()`, `new Date(iso)`, `new Date(ms)` thì vô tội -> không được báo.
function viPhamNewDate(dong) {
  const vt = dong.indexOf('new Date(');
  if (vt === -1) return false;
  let sau = 0;
  let phay = 0;
  for (let i = vt + 'new Date('.length; i < dong.length; i++) {
    const c = dong[i];
    if (c === '(' || c === '[') sau++;
    else if (c === ']') sau--;
    else if (c === ')') { if (sau === 0) break; sau--; }
    else if (c === ',' && sau === 0) phay++;
  }
  return phay >= 2;   // 2 dấu phẩy = 3 tham số
}

// Xác định biên thân hàm bằng cách cân các dấu ngoặc lồng nhau.
// Cân CẢ `{}`, `[]`, `()` — không chỉ `{}` — vì thân hàm mũi tên hay là mảng/biểu thức:
//   const toDateInput = (d: Date) => [ d.getFullYear(), … ].join('-');
function cuoiKhoi(dongs, dongBatDau) {
  let sau = 0;
  let daVao = false;
  for (let i = dongBatDau; i < dongs.length; i++) {
    for (const c of dongs[i]) {
      if (c === '{' || c === '[' || c === '(') { sau++; daVao = true; }
      else if (c === '}' || c === ']' || c === ')') sau--;
    }
    if (daVao && sau <= 0) return i;
  }
  return dongs.length - 1;
}

// Dòng mở đầu một hàm/khối nhiều dòng: marker che tới hết khối. Ngược lại marker che ĐÚNG 1 dòng.
const KHAI_BAO_HAM = /\bfunction\b|=>|\bclass\b/;

// Quét MỘT nguồn. Hàm thuần (không đọc đĩa) để test bơm chuỗi vào — qa-standard §1.5.
export function quetNguon(src, ten = '<nguon>') {
  const sach = boCommentVaString(src);
  const dongsSach = sach.split(/\r?\n/);
  const dongsGoc = src.split(/\r?\n/);

  // 1. Thu marker + vùng nó che.
  const mien = [];   // { tu, den, lyDo, dongMarker, dungToi }
  for (let i = 0; i < dongsGoc.length; i++) {
    const m = MARKER.exec(dongsGoc[i]);
    if (!m) continue;
    const lyDo = m[1].replace(/^[\s—-]+/, '').trim();
    // Marker che: thân hàm nếu dòng kế là khai báo hàm, ngược lại đúng 1 dòng kế tiếp.
    const ke = i + 1;
    const laHam = ke < dongsSach.length && KHAI_BAO_HAM.test(dongsSach[ke]);
    mien.push({
      tu: ke,
      den: laHam ? cuoiKhoi(dongsSach, ke) : ke,
      lyDo,
      dongMarker: i + 1,
      dungToi: false
    });
  }

  const viPham = [];
  const loiMarker = [];

  for (const mi of mien) {
    if (!mi.lyDo) loiMarker.push({ dong: mi.dongMarker, loai: 'thieu-ly-do', text: dongsGoc[mi.dongMarker - 1].trim() });
  }

  // 2. Quét từng dòng đã bỏ comment/string.
  for (let i = 0; i < dongsSach.length; i++) {
    const dong = dongsSach[i];
    if (!dong.trim()) continue;
    // FR-3: dòng import chỉ là khai báo tên, không phải chỗ dùng.
    if (/^\s*(import|export)\b[^=]*\bfrom\b/.test(dong) || /^\s*import\s*\{/.test(dong)) continue;

    const thay = [];
    for (const api of API_CAM) {
      if (new RegExp(`\\.${api}\\s*\\(`).test(dong)) thay.push(`.${api}()`);
    }
    for (const h of HELPER_CAM) {
      if (new RegExp(`\\b${h}\\s*\\(`).test(dong)) thay.push(`${h}()`);
    }
    if (viPhamNewDate(dong)) thay.push('new Date(y,m,d,…)');
    if (thay.length === 0) continue;

    const che = mien.find((mi) => i >= mi.tu && i <= mi.den);
    if (che) { che.dungToi = true; continue; }
    viPham.push({ dong: i + 1, apis: thay, text: (dongsGoc[i] || '').trim() });
  }

  // 3. Marker mục ruỗng: code đổi nhưng marker còn nằm đó -> phải gỡ.
  for (const mi of mien) {
    if (mi.lyDo && !mi.dungToi) {
      loiMarker.push({ dong: mi.dongMarker, loai: 'muc-ruong', text: dongsGoc[mi.dongMarker - 1].trim() });
    }
  }

  return { ten, viPham, loiMarker };
}

// ── Chạy trên vùng quyết định ────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-tz.mjs')) {
  let tongViPham = 0;
  let tongLoiMarker = 0;
  const thieuFile = [];

  for (const rel of VUNG_QUYET_DINH) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { thieuFile.push(rel); continue; }
    const { viPham, loiMarker } = quetNguon(fs.readFileSync(abs, 'utf8'), rel);
    for (const v of viPham) {
      console.error(`  ✖ ${rel}:${v.dong} — ${v.apis.join(', ')} = giờ MÁY trong vùng quyết định`);
      console.error(`      ${v.text}`);
      tongViPham++;
    }
    for (const l of loiMarker) {
      const vi = l.loai === 'thieu-ly-do'
        ? 'marker `tz-ok` THIẾU LÝ DO (đúng cú pháp: `// tz-ok: hien-thi`)'
        : 'marker `tz-ok` KHÔNG che vi phạm nào — code đã đổi, gỡ marker đi';
      console.error(`  ✖ ${rel}:${l.dong} — ${vi}`);
      tongLoiMarker++;
    }
  }

  if (thieuFile.length > 0) {
    console.error(`  ✖ không thấy ${thieuFile.length} file trong VUNG_QUYET_DINH: ${thieuFile.join(', ')}`);
    console.error('      File bị đổi tên/xoá mà quên cập nhật scripts/check-tz.mjs -> cổng đang gác chỗ trống.');
  }

  if (tongViPham + tongLoiMarker + thieuFile.length > 0) {
    console.error(`
✖ ${tongViPham} vi phạm gốc thời gian${tongLoiMarker ? ` + ${tongLoiMarker} lỗi marker` : ''}.

  Giờ người dùng nhập là GIỜ VN; máy có thể đặt JST/UTC (rules/07 §8.1).
    • Backend: dùng server/lib/vn-time.ts — vietnamDateKey / vietnamInstant / minutesUntilVietnam.
    • Frontend: dùng src/lib/date.ts — currentVietnamDateInputValue / vietnamInstant.
    • Thật sự là chỗ HIỂN THỊ? Dán marker kèm lý do ngay trên hàm hoặc dòng đó:
        // tz-ok: hien-thi
`);
    process.exit(1);
  }
  console.log(`✔ gốc thời gian: ${VUNG_QUYET_DINH.length} file vùng quyết định, không dùng giờ máy`);
}
