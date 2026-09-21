#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FILE_DUOC_GAC = 'server/routes/schedules.ts';
export const ROUTE_KHONG_DUOC_MATCH_THEO_TEN = '/schedules/regular-release/task';
const MARKER = /\/\/\s*ten-task-match-ok\s*:?(.*)$/;

// Bỏ comment dòng + comment khối, GIỮ NGUYÊN string/template literal (đó chính là nội dung SQL cần
// soi) và giữ nguyên số dòng (thay bằng khoảng trắng) để báo lỗi đúng dòng.
export function boComment(src) {
  let ra = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { ra += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { ra += src[i] === '\n' ? '\n' : ' '; i++; }
      ra += '  '; i += 2;
      continue;
    }
    ra += c;
    i++;
  }
  return ra;
}

// Danh sách route đăng ký `router.<method>('/path'` cùng số dòng (1-based), để tìm "route hiện
// hành" của một vị trí bất kỳ (route gần nhất PHÍA TRƯỚC nó — file này chỉ có route tuần tự,
// không lồng nhau).
function timRoutes(dongs) {
  const routes = [];
  const re = /router\.(get|post|patch|delete)\(\s*['"]([^'"]+)['"]/;
  dongs.forEach((dong, idx) => {
    const m = re.exec(dong);
    if (m) routes.push({ dong: idx + 1, path: m[2] });
  });
  return routes;
}

function routeCuaDong(routes, soDong) {
  let hienHanh = null;
  for (const r of routes) {
    if (r.dong <= soDong) hienHanh = r;
    else break;
  }
  return hienHanh?.path || '(ngoài mọi route)';
}

// Cân ngoặc () bắt đầu từ vị trí mở ngoặc của `db.prepare(` -> trả text bên trong (không kể 2 ngoặc).
function layThamSoPrepare(src, viTriMoNgoac) {
  let sau = 1;
  let i = viTriMoNgoac + 1;
  while (i < src.length && sau > 0) {
    if (src[i] === '(') sau++;
    else if (src[i] === ')') { sau--; if (sau === 0) break; }
    i++;
  }
  return src.slice(viTriMoNgoac + 1, i);
}

// Nội suy MỘT lớp `${ten}` bằng cách tìm định nghĩa `const ten = ...;`/`let ten = ...;` gần nhất
// trong toàn file rồi ghép văn bản định nghĩa đó vào — đủ dùng cho ca thực tế (legacyDeleteWhere/
// legacyWhere là chuỗi literal có sẵn `ten_task`), không cần trình phân giải biến đầy đủ.
function noiSuyBien(src, ten, daXet = new Set()) {
  if (daXet.has(ten)) return '';
  daXet.add(ten);
  const re = new RegExp(`\\b(?:const|let)\\s+${ten}\\b[^;]*;`, 's');
  const m = re.exec(src);
  if (!m) return '';
  let text = m[0];
  for (const subMatch of text.matchAll(/\$\{(\w+)\}/g)) {
    text += ' ' + noiSuyBien(src, subMatch[1], daXet);
  }
  return text;
}

function chuaTenTask(src, thamSo) {
  if (thamSo.includes('ten_task')) return true;
  for (const m of thamSo.matchAll(/\$\{(\w+)\}/g)) {
    if (noiSuyBien(src, m[1]).includes('ten_task')) return true;
  }
  return false;
}

// Quét MỘT nguồn — hàm thuần để test bơm chuỗi vào (qa-standard §1.5).
export function quetNguon(srcGoc) {
  const src = boComment(srcGoc);
  const dongs = src.split(/\r?\n/);
  const dongsGoc = srcGoc.split(/\r?\n/);
  const routes = timRoutes(dongsGoc);

  const viPham = [];   // route KHÔNG được phép match theo tên nhưng vẫn còn
  const thieuMarker = []; // route khác, có match theo tên nhưng thiếu/marker rỗng

  const re = /db\.prepare\(/g;
  let m;
  while ((m = re.exec(src))) {
    const thamSo = layThamSoPrepare(src, m.index + 'db.prepare('.length - 1);
    if (!thamSo.includes('DELETE FROM tasks')) continue;
    const soDong = src.slice(0, m.index).split(/\r?\n/).length;
    const route = routeCuaDong(routes, soDong);
    const coTenTask = chuaTenTask(src, thamSo);
    if (!coTenTask) continue;

    if (route === ROUTE_KHONG_DUOC_MATCH_THEO_TEN) {
      viPham.push({ dong: soDong, route, text: dongsGoc[soDong - 1]?.trim() || '' });
      continue;
    }

    // Route khác: cho phép nếu có marker với lý do, tìm trong tối đa 6 dòng ngay phía trên.
    let coMarker = false;
    for (let i = soDong - 1; i >= Math.max(1, soDong - 6); i--) {
      const mk = MARKER.exec(dongsGoc[i - 1] || '');
      if (mk) { coMarker = Boolean(mk[1].replace(/^[\s—-]+/, '').trim()); break; }
    }
    if (!coMarker) thieuMarker.push({ dong: soDong, route, text: dongsGoc[soDong - 1]?.trim() || '' });
  }

  return { viPham, thieuMarker };
}

// ── Chạy trên file được gác ──────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-release-sync.mjs')) {
  const abs = path.join(root, FILE_DUOC_GAC);
  if (!fs.existsSync(abs)) {
    console.error(`  ✖ không thấy ${FILE_DUOC_GAC} — file bị đổi tên/xoá mà quên cập nhật scripts/check-release-sync.mjs`);
    process.exit(1);
  }
  const { viPham, thieuMarker } = quetNguon(fs.readFileSync(abs, 'utf8'));

  for (const v of viPham) {
    console.error(`  ✖ ${FILE_DUOC_GAC}:${v.dong} — route '${ROUTE_KHONG_DUOC_MATCH_THEO_TEN}' còn DELETE dính ten_task (không được phép, xem BUG-20260814)`);
    console.error(`      ${v.text}`);
  }
  for (const t of thieuMarker) {
    console.error(`  ✖ ${FILE_DUOC_GAC}:${t.dong} — route '${t.route}' DELETE dính ten_task nhưng THIẾU marker \`// ten-task-match-ok: <lý do>\``);
    console.error(`      ${t.text}`);
  }

  if (viPham.length + thieuMarker.length > 0) {
    console.error(`
✖ ${viPham.length} vi phạm route cấm match-theo-tên + ${thieuMarker.length} DELETE thiếu marker.

  CR-20260814 FR-1/FR-2: '${ROUTE_KHONG_DUOC_MATCH_THEO_TEN}' phải match DUY NHẤT theo
  (release_month, origin_ref), KHÔNG được DELETE theo ten_task nữa. Route khác nếu THẬT SỰ cần
  match theo tên (vd. emergency replaceMatching có người dùng xác nhận) thì dán marker kèm lý do
  ngay phía trên: // ten-task-match-ok: <lý-do>
`);
    process.exit(1);
  }
  console.log(`✔ cổng đồng bộ release: '${ROUTE_KHONG_DUOC_MATCH_THEO_TEN}' không match theo tên, mọi DELETE dính ten_task khác đều có marker + lý do`);
}
