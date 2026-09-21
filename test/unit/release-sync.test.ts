// BUG-20260804 §7: sync task release so "ngày đã qua" bằng ngày MÁY, không phải ngày VN.
//
// `classifyReleaseSync` xếp task có `ngay_cu_the < today` vào `skipped: 'past'` — bị bỏ IM LẶNG
// khỏi lượt sync. `today` lấy từ `todayLocalDate()` = giờ máy. Máy đặt Asia/Tokyo: sau 22:00 VN
// (= 00:00 JST hôm sau) `today` đã là ngày mai theo VN, nên task của ĐÚNG HÔM NAY bị coi là quá
// hạn và không được cập nhật. Người dùng không thấy lỗi nào — chỉ thấy task không đổi.
//
// Test hàm thuần `isPastReleaseTaskDate` thay vì `classifyReleaseSync`: hàm kia query DB bên trong
// vòng lặp nên unit test sẽ phải dựng DB fixture, lúc đó không còn là unit test (Codex nêu đúng).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// schedules.ts còn import DB ở cấp module; cô lập APPDATA trước dynamic import để unit test
// không bao giờ mở/migrate DB vận hành thật chỉ vì cần gọi một helper thuần.
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-release-sync-unit-'));
process.env.APPDATA = tmpAppData;
const { isPastReleaseTaskDate } = await import('../../server/routes/schedules.js');
after(() => { try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ } });

// 2026-08-04T16:30:00Z = 23:30 giờ VN ngày 04/08, nhưng đã 01:30 JST ngày 05/08.
const LUC_2330_VN = new Date('2026-08-04T16:30:00.000Z');
// 2026-08-04T03:00:00Z = 10:00 VN — giờ hành chính, ngày máy và ngày VN trùng nhau.
const LUC_1000_VN = new Date('2026-08-04T03:00:00.000Z');

test('§7: 23:30 VN — task của ĐÚNG HÔM NAY (theo VN) không phải là quá hạn', () => {
  // Bản cũ trên máy JST: today = 2026-08-05 -> '2026-08-04' < '2026-08-05' -> bị bỏ im lặng.
  assert.equal(isPastReleaseTaskDate('2026-08-04', LUC_2330_VN), false);
});

test('§7: 23:30 VN — task của ngày hôm qua vẫn là quá hạn', () => {
  assert.equal(isPastReleaseTaskDate('2026-08-03', LUC_2330_VN), true);
});

test('§7: 23:30 VN — task của ngày mai không phải quá hạn', () => {
  assert.equal(isPastReleaseTaskDate('2026-08-05', LUC_2330_VN), false);
});

test('§7: giờ hành chính (ngày máy trùng ngày VN) — hành vi không đổi', () => {
  assert.equal(isPastReleaseTaskDate('2026-08-03', LUC_1000_VN), true);
  assert.equal(isPastReleaseTaskDate('2026-08-04', LUC_1000_VN), false);
  assert.equal(isPastReleaseTaskDate('2026-08-05', LUC_1000_VN), false);
});

test('§7: không có ngày -> không coi là quá hạn (không đoán)', () => {
  assert.equal(isPastReleaseTaskDate(null, LUC_2330_VN), false);
  assert.equal(isPastReleaseTaskDate('', LUC_2330_VN), false);
});
