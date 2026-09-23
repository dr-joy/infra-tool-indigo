// CR-20260913 Lát 6 (FR-30) — render nội dung template cá nhân KHẨN CẤP: token `...At` phải đổi giờ
// VN -> JST đúng cách (Intl theo tên múi giờ IANA, không cộng cứng phút, không đoán ngôn ngữ đích từ
// nội dung) — đúng lớp lỗi thật đã xảy ra 2 lần trong dự án (BUG-20260803/BUG-20260804,
// addMinutes(date, 120) + hasJapaneseText() ở src/screens/release.tsx:322). Test thuần, không đọc DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmergencyPersonalTemplate, type EmergencyRegistrationInstants } from '../../server/lib/emergency-template-render.js';

function makeRegistration(overrides: Partial<EmergencyRegistrationInstants> = {}): EmergencyRegistrationInstants {
  return {
    deployStagingAt: '2026-09-20 13:00',
    releaseAt: '2026-09-20 15:00',
    deployDemoAt: '2026-09-20 16:00',
    ...overrides
  };
}

test('FR-30 ví dụ chuẩn CR: team đăng ký release 15:00 giờ VN -> tiếng Nhật hiển thị 17:00 (JST = VN+2h)', () => {
  const out = renderEmergencyPersonalTemplate('Release: {{release.deployAt}}', makeRegistration(), 'ja');
  assert.match(out, /17:00/);
  assert.doesNotMatch(out, /15:00/);
});

test('locale truyền tường minh "vi" -> hiển thị đúng giờ VN gốc, không cộng giờ', () => {
  const out = renderEmergencyPersonalTemplate('Release: {{release.deployAt}}', makeRegistration(), 'vi');
  assert.match(out, /15:00/);
});

test('locale KHÔNG được đoán từ nội dung — nội dung tiếng Nhật nhưng locale="vi" vẫn ra giờ VN', () => {
  const out = renderEmergencyPersonalTemplate('リリース: {{release.deployAt}}', makeRegistration(), 'vi');
  assert.match(out, /15:00/, 'nội dung có chữ Nhật không được khiến hàm tự đoán sang JST');
});

test('cả 3 token …At (staging/release/demo) đều đổi giờ đúng, độc lập nhau', () => {
  const reg = makeRegistration({ deployStagingAt: '2026-09-20 09:30', releaseAt: '2026-09-20 15:00', deployDemoAt: '2026-09-20 16:00' });
  const out = renderEmergencyPersonalTemplate('{{staging.deployAt}} / {{release.deployAt}} / {{demo.deployAt}}', reg, 'ja');
  assert.match(out, /11:30/); // staging 09:30 VN -> 11:30 JST
  assert.match(out, /17:00/); // release 15:00 VN -> 17:00 JST
  assert.match(out, /18:00/); // demo 16:00 VN -> 18:00 JST
});

test('qua nửa đêm: 23:30 giờ VN -> 01:30 JST NGÀY HÔM SAU (đổi cả ngày, không chỉ giờ)', () => {
  const reg = makeRegistration({ releaseAt: '2026-09-20 23:30' });
  const out = renderEmergencyPersonalTemplate('{{release.deployAt}}', reg, 'ja');
  assert.match(out, /09月21日/, 'phải sang ngày 21, không phải ngày 20');
  assert.match(out, /01:30/);
});

test('cuối tháng: 2026-01-31 23:00 giờ VN -> JST sang ngày 01/02/2026 (đổi cả tháng)', () => {
  const reg = makeRegistration({ releaseAt: '2026-01-31 23:00' });
  const out = renderEmergencyPersonalTemplate('{{release.deployAt}}', reg, 'ja');
  assert.match(out, /2026年02月01日/);
  assert.match(out, /01:00/);
});

test('cuối năm: 2026-12-31 23:30 giờ VN -> JST sang 2027-01-01 (đổi cả năm)', () => {
  const reg = makeRegistration({ releaseAt: '2026-12-31 23:30' });
  const out = renderEmergencyPersonalTemplate('{{release.deployAt}}', reg, 'ja');
  assert.match(out, /2027年01月01日/);
  assert.match(out, /01:30/);
});

test('...Date (chỉ ngày, không giờ) cũng đổi đúng ngày theo locale JST khi qua nửa đêm', () => {
  const reg = makeRegistration({ releaseAt: '2026-09-20 23:30' });
  const outJa = renderEmergencyPersonalTemplate('{{release.deployDate}}', reg, 'ja');
  assert.match(outJa, /09月21日/);
  const outVi = renderEmergencyPersonalTemplate('{{release.deployDate}}', reg, 'vi');
  assert.match(outVi, /20\/09\/2026/);
});

test('token không có nguồn dữ liệu thật (mention, release.previousDate) giữ nguyên literal, không bị lỗi', () => {
  const out = renderEmergencyPersonalTemplate('Gửi {{mention}}, hạn trước {{release.previousDate}}', makeRegistration(), 'ja');
  assert.equal(out, 'Gửi {{mention}}, hạn trước {{release.previousDate}}');
});

test('token lạ hoàn toàn giữ nguyên literal', () => {
  const out = renderEmergencyPersonalTemplate('X {{khong.ton.tai}} Y', makeRegistration(), 'vi');
  assert.equal(out, 'X {{khong.ton.tai}} Y');
});

// ── Bắt buộc: kết quả KHÔNG phụ thuộc múi giờ máy chạy tiến trình (khác hẳn lỗi addMinutes(date,120)
// đã xảy ra 2 lần — BUG-20260803/BUG-20260804 đều là lỗi tính giờ theo giờ MÁY) ─────────────────────
test('kết quả GIỐNG HỆT nhau dưới nhiều giá trị TZ khác nhau của máy chạy test', () => {
  const originalTz = process.env.TZ;
  const zonesToTry = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/London', 'Asia/Ho_Chi_Minh'];
  const reg = makeRegistration({ releaseAt: '2026-09-20 23:30' });
  const template = '{{staging.deployAt}} / {{release.deployAt}} / {{demo.deployAt}} / {{release.deployDate}}';
  try {
    const outputs = zonesToTry.map((tz) => {
      process.env.TZ = tz;
      return renderEmergencyPersonalTemplate(template, reg, 'ja');
    });
    for (const out of outputs) assert.equal(out, outputs[0], 'kết quả phải giống hệt nhau bất kể process.env.TZ của máy chạy');
  } finally {
    if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
  }
});
