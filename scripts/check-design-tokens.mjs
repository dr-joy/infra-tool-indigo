#!/usr/bin/env node
// CỔNG design token (BL-20260913-005, CR-20260913-c) — chặn giá trị màu/typography/spacing
// hardcode MỚI trong CSS thay vì dùng token đã có ở src/styles.css `:root`.
//
// Vì sao "snapshot multiset" chứ không phải đếm tổng: đếm tổng bị vượt qua dễ dàng — xoá 1 hardcode
// cũ, thêm 1 hardcode MỚI khác, tổng số không đổi nên cổng đếm-tổng sẽ xanh nhầm. Cổng này so khớp
// TỪNG bộ ba (file, thuộc tính, giá trị) với bộ nền (baseline) đã chốt lúc viết CR — bất kỳ bộ ba
// nào KHÔNG có trong baseline (dù tổng dòng không đổi) đều bị chặn.
//
// Baseline là hàng rào cho giá trị ĐÃ CÓ trước CR này (không bắt migrate ngược — ngoài phạm vi CR),
// không phải danh sách được phép thêm mãi mãi. Giá trị mới thật sự cần thiết thì dùng token có sẵn
// (xem rules/06 §10), hoặc nếu đúng là ngoại lệ (vd toạ độ Gantt/canvas) thì đánh dấu ngay trên dòng:
//   padding: 3px; /* design-token-ok: canvas Gantt, không phải UI chuẩn */
//
// Script này CHỈ SO SÁNH — không tự ghi lại baseline. Sinh lại baseline có chủ đích (sau khi thêm
// token mới hoặc chấp nhận một hardcode mới có lý do) bằng `node scripts/gen-design-tokens-baseline.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// VÙNG QUÉT — chốt trong CR-20260913-c. Chỉ 1 file CSS thật trong repo lúc viết cổng này.
export const VUNG_QUET = ['src/styles.css'];

// Chỉ các thuộc tính CSS liên quan tới token (màu/typography/spacing) — CỐ Ý không qué́t
// width/height/toạ độ chung chung: false-positive tràn ngập ở Gantt/canvas/border 1px (rules/06 §10,
// quyết định Council run 0e0ddc52).
export const THUOC_TINH_THEO_DOI = [
  'font-size',
  'color',
  'background',
  'background-color',
  'border-color',
  'gap',
  'row-gap',
  'column-gap',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left'
];

// KHÔNG neo đầu dòng: CSS thật trong repo có cả khai báo compact 1 dòng (`.x { color: #fff; }`) lẫn
// khai báo nhiều dòng — regex neo `^` bỏ lọt dạng compact (Council review run ce616b1f phát hiện,
// vd `.ld-warn { color: #b45309; }`). Giá trị loại trừ `{`/`}` để không tràn qua ranh giới block,
// nên tự nhiên không khớp nhầm pseudo-selector (`.foo:hover {`) hay media breakpoint
// (`@media (min-width: 768px)`) — cả hai đều có `{`/`)` chắn trước dấu `;` cần thiết.
const KHAI_BAO = /([a-zA-Z-]+)\s*:\s*([^;{}]+);/g;
const MARKER = /\/\*\s*design-token-ok\s*:?(.*?)\*\//;
// Chỉ coi là "đã tokenize hoàn toàn" khi giá trị là ĐÚNG MỘT var(--...) và không còn gì khác — giá
// trị shorthand pha token (`margin: var(--space-sm) 3px;`) vẫn phải bị theo dõi vì phần `3px` là
// hardcode thật (Council review run ce616b1f phát hiện).
const CHI_VAR = /^var\(--[a-zA-Z0-9-]+\)$/;

function dongCuaViTri(src, viTri) {
  return src.slice(0, viTri).split('\n').length;
}

// Quét MỘT nguồn CSS. Hàm thuần (không đọc đĩa) để test bơm chuỗi vào.
// Trả về: `muc` (ứng viên hardcode chưa miễn) + `loiMarker` (marker thiếu lý do).
export function quetCssChoToken(src, ten = '<nguon>') {
  const muc = [];
  const loiMarker = [];
  const dongsGoc = src.split(/\r?\n/);

  KHAI_BAO.lastIndex = 0;
  let m;
  while ((m = KHAI_BAO.exec(src))) {
    const thuocTinh = m[1].toLowerCase();
    if (!THUOC_TINH_THEO_DOI.includes(thuocTinh)) continue;

    const raw = m[2];
    const giaTri = raw.replace(/\/\*.*?\*\//g, '').trim();
    if (!giaTri || CHI_VAR.test(giaTri)) continue; // đúng 1 token thuần -> không phải hardcode

    const dong = dongCuaViTri(src, m.index);
    const text = (dongsGoc[dong - 1] ?? m[0]).trim();

    // Marker ngoại lệ có thể nằm TRONG giá trị (trước dấu `;`) hoặc ngay SAU dấu `;` trên cùng dòng
    // vật lý — kiểm cả hai chỗ, không giả định vị trí cố định.
    const ketThucKhaiBao = m.index + m[0].length;
    const xuongDong = src.indexOf('\n', ketThucKhaiBao);
    const cuoiDong = xuongDong === -1 ? src.length : xuongDong;
    const phanSauCungDong = src.slice(ketThucKhaiBao, cuoiDong);
    const markerMatch = MARKER.exec(raw) || MARKER.exec(phanSauCungDong);

    if (markerMatch) {
      const lyDo = markerMatch[1].replace(/^[\s—-]+/, '').trim();
      if (!lyDo) loiMarker.push({ dong, text });
      continue; // được miễn (dù thiếu lý do cũng miễn khỏi baseline — lỗi thiếu lý do báo riêng)
    }

    muc.push({ file: ten, thuocTinh, giaTri, dong, text });
  }

  return { muc, loiMarker };
}

function khoa(o) {
  return `${o.file} ${o.thuocTinh} ${o.giaTri}`;
}

// So khớp multiset hiện tại với baseline. Trả về danh sách vi phạm (ứng viên KHÔNG có suất trong
// baseline). Baseline là mảng {file, thuocTinh, giaTri} — số lần lặp lại của MỘT bộ ba = số suất
// được phép của đúng bộ ba đó, không cộng dồn sang bộ ba khác dù tổng dòng bằng nhau.
export function soSanhBaseline(hienTai, baseline) {
  const conLai = new Map();
  for (const b of baseline) {
    const k = khoa(b);
    conLai.set(k, (conLai.get(k) || 0) + 1);
  }
  const viPham = [];
  for (const h of hienTai) {
    const k = khoa(h);
    const con = conLai.get(k) || 0;
    if (con > 0) {
      conLai.set(k, con - 1);
    } else {
      viPham.push(h);
    }
  }
  return viPham;
}

// ── Chạy trên vùng quét ──────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-design-tokens.mjs')) {
  const baselinePath = path.join(root, 'scripts', 'design-tokens-baseline.json');
  const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : [];

  let tongViPham = 0;
  let tongLoiMarker = 0;
  const thieuFile = [];

  for (const rel of VUNG_QUET) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { thieuFile.push(rel); continue; }
    const { muc, loiMarker } = quetCssChoToken(fs.readFileSync(abs, 'utf8'), rel);
    const baselineCuaFile = baseline.filter((b) => b.file === rel);
    const viPham = soSanhBaseline(muc, baselineCuaFile);
    for (const v of viPham) {
      console.error(`  ✖ ${rel}:${v.dong} — giá trị "${v.giaTri}" (${v.thuocTinh}) hardcode MỚI, không có trong baseline`);
      console.error(`      ${v.text}`);
      tongViPham++;
    }
    for (const l of loiMarker) {
      console.error(`  ✖ ${rel}:${l.dong} — marker \`design-token-ok\` THIẾU LÝ DO`);
      console.error(`      ${l.text}`);
      tongLoiMarker++;
    }
  }

  if (thieuFile.length > 0) {
    console.error(`  ✖ không thấy ${thieuFile.length} file trong VUNG_QUET: ${thieuFile.join(', ')}`);
  }

  if (tongViPham + tongLoiMarker + thieuFile.length > 0) {
    console.error(`
✖ ${tongViPham} hardcode mới ngoài baseline${tongLoiMarker ? ` + ${tongLoiMarker} lỗi marker` : ''}.

  Dùng token có sẵn ở src/styles.css \`:root\` (xem tên + mục đích ở rules/06 §10) thay vì số/hex
  trực tiếp. Trường hợp thật sự cần ngoại lệ (vd toạ độ Gantt/canvas), đánh dấu NGAY DÒNG đó:
      padding: 3px; /* design-token-ok: canvas Gantt, không phải UI chuẩn */
  Nếu đây là một token MỚI cần thêm vào hệ thống (không phải ngoại lệ đơn lẻ), thêm vào
  src/styles.css :root + tailwind.config.js + rules/06 §10, rồi chạy \`node
  scripts/gen-design-tokens-baseline.mjs\` để SINH LẠI baseline có chủ đích (cổng này chỉ SO SÁNH,
  không tự cập nhật baseline) — soi diff của \`scripts/design-tokens-baseline.json\` trước khi commit
  để chắc chắn chỉ thêm đúng mục vừa quyết định, không lẫn hardcode khác.
`);
    process.exit(1);
  }
  console.log(`✔ design token: ${VUNG_QUET.length} file, không có hardcode mới ngoài baseline`);
}
