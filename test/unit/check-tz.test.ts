// Test CỔNG gốc thời gian (scripts/check-tz.mjs) — Ref: CR-20260804-cong-may-gio-vn.
//
// Vì sao test chính cái cổng: nó là lớp chắn cho một lỗi đã lọt 3 lần. Cổng sai kiểu "im lặng cho
// qua" thì tệ hơn không có cổng, vì nó tạo cảm giác đã được gác. Ca `${}` dưới đây là ca thật:
// bản đầu của script bỏ luôn code trong template literal nên `occKeyOf` — đúng lỗi nặng nhất —
// lọt qua; test này chốt lại để không tái diễn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — script build bằng JS thuần, không có .d.ts (chỉ test dùng tới)
import { quetNguon, boCommentVaString, VUNG_QUYET_DINH } from '../../scripts/check-tz.mjs';

type KetQua = {
  viPham: { dong: number; apis: string[]; text: string }[];
  loiMarker: { dong: number; loai: string }[];
};

const quet = (src: string): KetQua => quetNguon(src) as KetQua;

// ── FR-1: API giờ máy ────────────────────────────────────────────────────────

test('FR-1: getFullYear trong code thường -> vi phạm', () => {
  const r = quet('const d = now.getFullYear();');
  assert.equal(r.viPham.length, 1);
  assert.ok(r.viPham[0].apis.includes('.getFullYear()'));
});

test('FR-1: bắt đủ nhóm API tách ngày/giờ theo múi giờ máy', () => {
  for (const api of ['getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'setHours']) {
    assert.equal(quet(`x.${api}();`).viPham.length, 1, `thiếu ${api}`);
  }
});

test('FR-1: new Date() / new Date(iso) / new Date(ms) KHÔNG phải vi phạm', () => {
  assert.equal(quet('const a = new Date();').viPham.length, 0);
  assert.equal(quet("const b = new Date('2026-08-04T00:00:00Z');").viPham.length, 0);
  assert.equal(quet('const c = new Date(1754265600000);').viPham.length, 0);
  assert.equal(quet('const d = new Date(other);').viPham.length, 0);
});

test('FR-1: new Date(y, m, d, …) từ 3 tham số trở lên -> vi phạm', () => {
  assert.equal(quet('const a = new Date(y, m - 1, d);').viPham.length, 1);
  assert.equal(quet('const b = new Date(y, m - 1, d, h, mi);').viPham.length, 1);
});

test('FR-1: Date.now() và getTime() KHÔNG bị cấm (thời điểm tuyệt đối)', () => {
  assert.equal(quet('const a = Date.now() < moc.getTime();').viPham.length, 0);
});

// ── FR-1b: helper giờ máy (không có luật này thì §9 lọt) ─────────────────────

test('FR-1b: gọi helper giờ máy -> vi phạm dù không thấy API gốc', () => {
  const r = quet('const quaGio = parseLocalDateTime(localDateInputValue(), gio).getTime() < Date.now();');
  assert.equal(r.viPham.length, 1);
  assert.ok(r.viPham[0].apis.includes('parseLocalDateTime()'));
  assert.ok(r.viPham[0].apis.includes('localDateInputValue()'));
});

test('FR-1b: bắt đủ 5 helper', () => {
  for (const h of ['localDateInputValue', 'parseLocalDateTime', 'taoNgayTuInput', 'congNgayInput', 'congThangInput']) {
    assert.equal(quet(`const x = ${h}(v);`).viPham.length, 1, `thiếu ${h}`);
  }
});

// ── FR-3: bỏ comment / string / import ───────────────────────────────────────

test('FR-3: API nằm trong COMMENT không phải vi phạm', () => {
  // Ca thật: vn-time.ts và date.ts có comment nêu tên API bị cấm để DẠY về rule này.
  assert.equal(quet('// KHÔNG dùng getHours() hay setHours()').viPham.length, 0);
  assert.equal(quet('/* new Date(y, m, d) đọc giờ máy */').viPham.length, 0);
});

test('FR-3: API nằm trong STRING không phải vi phạm', () => {
  assert.equal(quet("const s = 'dùng getFullYear() là sai';").viPham.length, 0);
  assert.equal(quet('const s = "new Date(y, m, d)";').viPham.length, 0);
});

test('FR-3: dòng import chỉ khai báo tên, không phải chỗ dùng', () => {
  assert.equal(quet("import { localDateInputValue, taoNgayTuInput } from './lib/date';").viPham.length, 0);
  assert.equal(quet("import { parseLocalDateTime } from '../lib/date';").viPham.length, 0);
});

test('FR-3: code trong ${…} của template literal VẪN bị bắt (ca occKeyOf)', () => {
  // Bản đầu của script bỏ cả nội dung template literal -> occKeyOf lọt cổng. Không được tái diễn.
  const r = quet('const d = `${n.getFullYear()}-${String(n.getMonth() + 1)}`;');
  assert.equal(r.viPham.length, 1);
  assert.ok(r.viPham[0].apis.includes('.getFullYear()'));
  assert.ok(r.viPham[0].apis.includes('.getMonth()'));
});

test('FR-3: phần CHỮ của template literal vẫn được bỏ', () => {
  assert.equal(quet('const s = `nhớ đừng dùng getHours() nhé`;').viPham.length, 0);
});

test('boCommentVaString: giữ nguyên số dòng để báo lỗi đúng dòng', () => {
  const src = 'a\n// b\n`c`\nd';
  assert.equal(boCommentVaString(src).split('\n').length, src.split('\n').length);
});

// ── FR-2: marker ─────────────────────────────────────────────────────────────

test('FR-2: marker trên function che CẢ thân hàm', () => {
  const src = [
    '// tz-ok: hien-thi',
    'export function nhan(date: Date) {',
    '  return [date.getFullYear(), date.getMonth(), date.getDate()].join("-");',
    '}',
    'const ngoai = other.getHours();'
  ].join('\n');
  const r = quet(src);
  assert.equal(r.viPham.length, 1, 'chỉ dòng NGOÀI hàm được che còn vi phạm');
  assert.equal(r.viPham[0].dong, 5);
});

test('FR-2: marker che được arrow function có thân là mảng (ca toDateInput)', () => {
  const src = [
    '// tz-ok: ngay-lich-round-trip',
    'const toDateInput = (date: Date) => [',
    '  date.getFullYear(),',
    '  date.getDate()',
    "].join('-');"
  ].join('\n');
  assert.equal(quet(src).viPham.length, 0);
});

test('FR-2: marker trên dòng thường chỉ che ĐÚNG dòng kế tiếp', () => {
  const src = [
    '// tz-ok: ngay-lich-round-trip',
    'const a = new Date(y, m, 0);',
    'const b = new Date(y, m, 35);'
  ].join('\n');
  const r = quet(src);
  assert.equal(r.viPham.length, 1);
  assert.equal(r.viPham[0].dong, 3);
});

test('FR-2: marker THIẾU LÝ DO -> lỗi marker', () => {
  const r = quet('// tz-ok:\nconst d = x.getHours();');
  assert.equal(r.loiMarker.length, 1);
  assert.equal(r.loiMarker[0].loai, 'thieu-ly-do');
});

test('FR-2: marker KHÔNG che vi phạm nào (mục ruỗng) -> lỗi marker', () => {
  // Code đã được sửa sang giờ VN nhưng marker còn nằm lại -> phải gỡ, nếu không lần sau nó che
  // một vi phạm mới mà không ai để ý.
  const r = quet('// tz-ok: hien-thi\nconst d = vietnamDateKey(now);');
  assert.equal(r.loiMarker.length, 1);
  assert.equal(r.loiMarker[0].loai, 'muc-ruong');
});

test('FR-2: marker hợp lệ + có che -> không lỗi gì', () => {
  const r = quet('// tz-ok: hien-thi\nconst d = x.getHours();');
  assert.equal(r.viPham.length, 0);
  assert.equal(r.loiMarker.length, 0);
});

// ── Vùng quét ────────────────────────────────────────────────────────────────

test('vùng quyết định gồm cả FE — cổng chỉ quét server sẽ bỏ lọt lỗi popup (§9)', () => {
  const ds = VUNG_QUYET_DINH as string[];
  for (const f of ['src/main.tsx', 'src/lib/date.ts']) {
    assert.ok(ds.includes(f), `thiếu ${f} trong vùng quyết định`);
  }
  for (const f of ['server/routes/schedules.ts', 'server/lib/recurrence.ts']) {
    assert.ok(ds.includes(f), `thiếu ${f} trong vùng quyết định`);
  }
});
