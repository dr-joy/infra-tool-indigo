// QA-2026-09-12: review toàn diện tính năng Task cá nhân — recurrenceMatches() (server/lib/recurrence.ts)
// chưa có test riêng dù là luật lặp DUY NHẤT quyết định task định kỳ có hiện ra ngày nào hay không.
//
// 2 bug thật tìm thấy khi đọc code + tái hiện qua HTTP:
//   1. lapLaiKieu='hang_tuan' với thuTrongTuan rỗng/null, hoặc lapLaiKieu='hang_thang' với
//      ngayTrongThang rỗng/null -> không bao giờ khớp ngày nào -> task sinh ra nằm im vĩnh viễn.
//      Đã chặn ở tầng route (server/routes/tasks.ts: xacThucKieuLapDinhKy), test HTTP tương ứng ở
//      test/integration/tasks.test.ts. File này chỉ test bản thân hàm thuần recurrenceMatches().
//   2. hang_thang chọn ngày 29/30/31 -> tháng ngắn hơn không có ngày đó -> im lặng bỏ qua cả tháng.
//      Xác nhận với người dùng: phải dồn về ngày CUỐI THÁNG của tháng ngắn hơn, không bỏ qua.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recurrenceMatches } from '../../server/lib/recurrence.js';

function ctx(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return { dateKey, day: d, weekday: date.getDay() };
}

test('hang_ngay: khớp mọi ngày', () => {
  assert.equal(recurrenceMatches({ lapLaiKieu: 'hang_ngay' }, ctx('2026-09-12')), true);
  assert.equal(recurrenceMatches({ lapLaiKieu: 'hang_ngay' }, ctx('2026-01-01')), true);
});

test('thu_2_den_thu_6: chỉ khớp thứ 2 -> thứ 6, không khớp CN/T7', () => {
  // 2026-09-12 là thứ Bảy, 2026-09-14 là thứ Hai.
  assert.equal(recurrenceMatches({ lapLaiKieu: 'thu_2_den_thu_6' }, ctx('2026-09-12')), false);
  assert.equal(recurrenceMatches({ lapLaiKieu: 'thu_2_den_thu_6' }, ctx('2026-09-13')), false); // Chủ nhật
  assert.equal(recurrenceMatches({ lapLaiKieu: 'thu_2_den_thu_6' }, ctx('2026-09-14')), true);
  assert.equal(recurrenceMatches({ lapLaiKieu: 'thu_2_den_thu_6' }, ctx('2026-09-18')), true); // thứ Sáu
});

test('hang_tuan: chỉ khớp đúng thứ đã chọn', () => {
  const spec = { lapLaiKieu: 'hang_tuan', thuTrongTuan: [1, 3] }; // thứ Hai, thứ Tư
  assert.equal(recurrenceMatches(spec, ctx('2026-09-14')), true); // thứ Hai
  assert.equal(recurrenceMatches(spec, ctx('2026-09-16')), true); // thứ Tư
  assert.equal(recurrenceMatches(spec, ctx('2026-09-15')), false); // thứ Ba
});

test('BUG (đã sửa ở tầng route, test đây cho rõ bất biến): hang_tuan không có thuTrongTuan -> KHÔNG BAO GIỜ khớp', () => {
  assert.equal(recurrenceMatches({ lapLaiKieu: 'hang_tuan', thuTrongTuan: null }, ctx('2026-09-12')), false);
  assert.equal(recurrenceMatches({ lapLaiKieu: 'hang_tuan', thuTrongTuan: [] }, ctx('2026-09-19')), false);
});

test('hang_thang: khớp đúng ngày trong tháng khi ngày đó tồn tại', () => {
  assert.equal(recurrenceMatches({ lapLaiKieu: 'hang_thang', ngayTrongThang: 15 }, ctx('2026-09-15')), true);
  assert.equal(recurrenceMatches({ lapLaiKieu: 'hang_thang', ngayTrongThang: 15 }, ctx('2026-09-14')), false);
});

test('BUG (đã sửa ở tầng route): hang_thang không có ngayTrongThang -> KHÔNG BAO GIỜ khớp', () => {
  assert.equal(recurrenceMatches({ lapLaiKieu: 'hang_thang', ngayTrongThang: null }, ctx('2026-09-12')), false);
});

test('QA-2026-09-12 (xác nhận người dùng): hang_thang ngày 31, tháng chỉ có 30 ngày -> dồn về ngày cuối tháng (30)', () => {
  const spec = { lapLaiKieu: 'hang_thang', ngayTrongThang: 31 };
  assert.equal(recurrenceMatches(spec, ctx('2026-04-30')), true, 'Tháng 4 chỉ có 30 ngày -> phải khớp ngày 30');
  assert.equal(recurrenceMatches(spec, ctx('2026-04-29')), false, 'Không được khớp sớm hơn ngày cuối tháng');
});

test('hang_thang ngày 31, tháng CÓ đủ 31 ngày -> khớp đúng ngày 31, KHÔNG khớp ngày 30', () => {
  const spec = { lapLaiKieu: 'hang_thang', ngayTrongThang: 31 };
  assert.equal(recurrenceMatches(spec, ctx('2026-08-31')), true);
  assert.equal(recurrenceMatches(spec, ctx('2026-08-30')), false, 'Tháng có ngày 31 thật thì không được dồn sớm về ngày 30');
});

test('hang_thang ngày 29, tháng 2 năm KHÔNG nhuận (2026, 28 ngày) -> dồn về ngày 28', () => {
  const spec = { lapLaiKieu: 'hang_thang', ngayTrongThang: 29 };
  assert.equal(recurrenceMatches(spec, ctx('2026-02-28')), true);
});

test('hang_thang ngày 29, tháng 2 năm NHUẬN (2028, 29 ngày) -> khớp đúng ngày 29, không dồn', () => {
  const spec = { lapLaiKieu: 'hang_thang', ngayTrongThang: 29 };
  assert.equal(recurrenceMatches(spec, ctx('2028-02-29')), true);
  assert.equal(recurrenceMatches(spec, ctx('2028-02-28')), false, 'Năm nhuận có ngày 29 thật thì không được dồn sớm về 28');
});

test('ngayCuThe thắng mọi luật lặp khác (task release sinh theo đợt, một lần)', () => {
  const spec = { ngayCuThe: '2026-09-20', lapLaiKieu: 'hang_ngay' };
  assert.equal(recurrenceMatches(spec, ctx('2026-09-20')), true);
  assert.equal(recurrenceMatches(spec, ctx('2026-09-21')), false, 'hang_ngay bị ngayCuThe đè, không lặp hàng ngày nữa');
});

test('không khai báo lapLaiKieu: khớp khi MỌI điều kiện đã nêu đều thoả (không nêu gì = mọi ngày)', () => {
  assert.equal(recurrenceMatches({}, ctx('2026-09-12')), true, 'không có điều kiện nào -> khớp mọi ngày');
  const specNgay = { ngayTrongThang: 12 };
  assert.equal(recurrenceMatches(specNgay, ctx('2026-09-12')), true);
  assert.equal(recurrenceMatches(specNgay, ctx('2026-09-13')), false);
});
