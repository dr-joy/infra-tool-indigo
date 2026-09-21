// Test CỔNG BE error-code registry (scripts/check-error-codes.mjs) — Ref: CR-20260913-c
// (BL-20260913-005). Phạm vi: chỉ chặn mã lỗi MỚI chưa đăng ký, không bắt sửa mã cũ.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — script build bằng JS thuần, không có .d.ts (chỉ test dùng tới)
import { timMaLoiTrongFile, layDanhSachDangKy, timMaChuaDangKy } from '../../scripts/check-error-codes.mjs';

const REGISTRY_MAU = [
  'export const ERROR_CODE_REGISTRY = {',
  "  GOAL_CONFLICT: { status: 409, note: 'x' },",
  "  REPORT_EXISTS: { status: 409, note: 'y' }",
  '};'
].join('\n');

test('nhận diện mã lỗi dạng field JSON `code: \'X\'`', () => {
  const src = "res.status(409).json({ message: 'trùng', code: 'GOAL_CONFLICT' });";
  const kq = timMaLoiTrongFile(src, 'routes/x.ts');
  assert.equal(kq.length, 1);
  assert.equal(kq[0].code, 'GOAL_CONFLICT');
});

test('nhận diện mã lỗi qua tham số thứ 3 của new HttpError(...), kể cả xuống dòng nhiều dòng', () => {
  const src = [
    'throw new HttpError(',
    '  409,',
    "  'đã tồn tại',",
    "  'MOT_MA_MOI'",
    ');'
  ].join('\n');
  const kq = timMaLoiTrongFile(src, 'routes/x.ts');
  assert.equal(kq.length, 1);
  assert.equal(kq[0].code, 'MOT_MA_MOI');
  assert.equal(kq[0].dong, 1);
});

test('new HttpError(status, msg) KHÔNG có tham số thứ 3 -> không bị tính là mã lỗi', () => {
  const src = "throw new HttpError(400, 'Thiếu release_month');";
  assert.equal(timMaLoiTrongFile(src, 'routes/x.ts').length, 0);
});

test('layDanhSachDangKy đọc đúng danh sách key top-level của registry', () => {
  const dk = layDanhSachDangKy(REGISTRY_MAU);
  assert.ok(dk.has('GOAL_CONFLICT'));
  assert.ok(dk.has('REPORT_EXISTS'));
  assert.equal(dk.size, 2);
});

test('mã đã đăng ký -> không bị coi là vi phạm', () => {
  const dk = layDanhSachDangKy(REGISTRY_MAU);
  const timThay = timMaLoiTrongFile("code: 'GOAL_CONFLICT'", 'routes/x.ts');
  assert.equal(timMaChuaDangKy(timThay, dk).length, 0);
});

test('mã MỚI chưa đăng ký -> bị chặn', () => {
  const dk = layDanhSachDangKy(REGISTRY_MAU);
  const timThay = timMaLoiTrongFile("code: 'MA_CHUA_TUNG_THAY'", 'routes/x.ts');
  const viPham = timMaChuaDangKy(timThay, dk);
  assert.equal(viPham.length, 1);
  assert.equal(viPham[0].code, 'MA_CHUA_TUNG_THAY');
});

test('mã cũ không đăng ký nhưng route KHÔNG đổi vẫn bị báo — cổng không phân biệt "cũ trong code thật" với "mới", chỉ phân biệt "có/không có trong registry" (đúng phạm vi: registry phải liệt kê ĐỦ 6 mã thật đang chạy)', () => {
  const dk = layDanhSachDangKy(REGISTRY_MAU); // registry mẫu CHỈ có 2/6 mã thật
  const timThay = timMaLoiTrongFile("code: 'EMERGENCY_BATCH_ALREADY_POSTED'", 'routes/schedules.ts');
  assert.equal(timMaChuaDangKy(timThay, dk).length, 1, 'registry thật (server/lib/error-codes.ts) phải liệt kê đủ, registry mẫu thiếu thì test này đúng là phải báo');
});
