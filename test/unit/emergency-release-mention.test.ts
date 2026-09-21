// CR-20260819-o-nhap-nguoi-mention-emergency-giai-doan-1: ô nhập tên người mention lúc tạo task
// khẩn cấp giai đoạn 1 — thay vào token {{mention}} trong template.
//
// Thiết kế đã ĐỔI theo feedback Leader 2026-08-19: bản đầu dò "dòng đầu đúng bằng @" theo VỊ TRÍ —
// hỏng ngay nếu template có NHIỀU HƠN 1 dòng bắt đầu bằng "@" (chỉ dòng đầu được thay, các dòng "@"
// khác bị bỏ sót). Nay dùng TOKEN tường minh `{{mention}}`: đặt ở đâu cũng được, lặp bao nhiêu lần
// cũng được, mọi chỗ có token đều được thay giống nhau.
//
// Test cả 2 hàm thuần: `renderEmergencyReleaseTemplate` (thay token) và `emergencyReleaseTaskPayloads`
// (dùng hàm trên để dựng payload task) — pattern giống `isPastReleaseTaskDate` (server/routes/schedules.ts):
// tách hàm thuần khỏi component để test không cần dựng DOM/DB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emergencyReleaseTaskPayloads, renderEmergencyReleaseTemplate } from '../../src/screens/release.js';
import type { EmergencyReleaseTaskDefinition, ReleaseTemplateItem } from '../../src/types.js';

function def(over: Partial<EmergencyReleaseTaskDefinition>): EmergencyReleaseTaskDefinition {
  return {
    id: 'x', title: 'x', note: '', timingToken: 'release_deploy', startTime: 'relative',
    immediatePriority: null, relativeOffsetMinutes: 0, templateId: 't1', links: [], sortOrder: 0,
    ...over
  };
}

function tpl(id: string, content: string): ReleaseTemplateItem {
  return { id, name: id, content };
}

// Nội dung THẬT của template E1 sau khi đổi thiết kế (dòng đầu `@{{mention}}` thay cho `@` trơ) —
// xem CR §16 phần cập nhật template thật trong DB.
const E1 = def({
  id: 'emergency_release_task_1779781779061',
  title: 'Confirm các thông tin cần thiết',
  startTime: 'immediate',
  templateId: 'tpl-e1'
});
const TPL_E1 = tpl('tpl-e1', '@{{mention}}\nCho Dev13 confirm một số thông tin sau về lần release gấp này với.');

// ── renderEmergencyReleaseTemplate: hàm thay token, test trực tiếp không cần định nghĩa/task ────────

test('token {{mention}} có tên -> thay bằng " <tên>" (1 khoảng trắng cố định)', () => {
  assert.equal(renderEmergencyReleaseTemplate('@{{mention}}', '2026-08-21', 'Sơn'), '@ Sơn');
});

test('token {{mention}} không có tên (rỗng/undefined) -> thay bằng rỗng, giữ "@" trơ', () => {
  assert.equal(renderEmergencyReleaseTemplate('@{{mention}}', '2026-08-21'), '@');
  assert.equal(renderEmergencyReleaseTemplate('@{{mention}}', '2026-08-21', ''), '@');
});

// Đây chính là ca lỗi Leader chỉ ra ở bản dò-theo-dòng: template có NHIỀU HƠN 1 chỗ cần điền tên.
// Token phải thay ĐỦ cả hai, không chỉ chỗ đầu tiên.
test('NHIỀU token {{mention}} trong cùng template -> tất cả đều được thay, không chỉ chỗ đầu', () => {
  const content = '@{{mention}} bạn đọc phần dưới\n...\nNhắc lại: @{{mention}} xác nhận giúp mình nhé';
  const out = renderEmergencyReleaseTemplate(content, '2026-08-21', 'Sơn, Cường');
  assert.equal(
    out,
    '@ Sơn, Cường bạn đọc phần dưới\n...\nNhắc lại: @ Sơn, Cường xác nhận giúp mình nhé'
  );
});

test('template không có token {{mention}} -> không đụng gì dù có truyền tên', () => {
  assert.equal(renderEmergencyReleaseTemplate('@Mọi người\nNội dung', '2026-08-21', 'Sơn'), '@Mọi người\nNội dung');
  assert.equal(renderEmergencyReleaseTemplate('＠Mọi người \nNội dung', '2026-08-21', 'Sơn'), '＠Mọi người \nNội dung');
  assert.equal(renderEmergencyReleaseTemplate('皆様\nNội dung', '2026-08-21', 'Sơn'), '皆様\nNội dung');
});

test('token ngày ({{release.date}}...) và {{mention}} cùng lúc trong 1 template -> cả hai đều thay đúng', () => {
  const out = renderEmergencyReleaseTemplate('@{{mention}}\nNgày: {{release.date}}', '2026-08-21', 'Sơn');
  assert.match(out.split('\n')[0], /^@ Sơn$/);
  assert.match(out.split('\n')[1], /^Ngày: /);
  assert.doesNotMatch(out, /\{\{/); // không còn token nào chưa thay
});

// ── emergencyReleaseTaskPayloads: đường thật app dùng khi tạo task giai đoạn 1 ───────────────────────

test('1 người: dòng đầu template có token -> thay thành "@ <tên>"', () => {
  const out = emergencyReleaseTaskPayloads('2026-08-21', [E1], [TPL_E1], 'Sơn');
  assert.equal(out.length, 1);
  const lines = out[0].ghiChu.split('\n');
  assert.equal(lines[0], '@ Sơn');
  assert.equal(lines[1], 'Cho Dev13 confirm một số thông tin sau về lần release gấp này với.');
});

// Quy tắc nối nhiều người (feedback Leader sau khi xem popup): "@ A, B, C" — dấu cách tuân thủ chính
// xác, người cuối cùng KHÔNG có dấu ",". Popup chịu trách nhiệm join mảng tên thành 1 chuỗi theo đúng
// quy tắc này rồi mới truyền xuống `mentionName`; hàm này chỉ chèn nguyên văn sau "@ ".
test('nhiều người: mentionName đã join theo quy tắc "A, B, C" -> chèn nguyên văn sau "@ "', () => {
  const out = emergencyReleaseTaskPayloads('2026-08-21', [E1], [TPL_E1], 'Sơn, Cường, Anh Tuấn');
  assert.equal(out[0].ghiChu.split('\n')[0], '@ Sơn, Cường, Anh Tuấn');
});

test('đúng 2 người: không có dấu phẩy thừa ở cuối', () => {
  const out = emergencyReleaseTaskPayloads('2026-08-21', [E1], [TPL_E1], 'Sơn, Cường');
  assert.equal(out[0].ghiChu.split('\n')[0], '@ Sơn, Cường');
});

test('mentionName rỗng/undefined -> giữ nguyên "@" trơ (hành vi cũ, needsInput xử lý)', () => {
  const outUndefined = emergencyReleaseTaskPayloads('2026-08-21', [E1], [TPL_E1]);
  assert.equal(outUndefined[0].ghiChu.split('\n')[0], '@');

  const outEmpty = emergencyReleaseTaskPayloads('2026-08-21', [E1], [TPL_E1], '');
  assert.equal(outEmpty[0].ghiChu.split('\n')[0], '@');
});

// `emergencyReleaseTaskPayloads` trim TRƯỚC khi gọi render (khác `renderEmergencyReleaseTemplate` ở
// trên — hàm đó không tự trim, đây mới là nơi thật sự trim theo hợp đồng của mentionName).
test('mentionName toàn khoảng trắng (đã join từ mảng rỗng ở popup) -> trim rồi coi là rỗng', () => {
  const out = emergencyReleaseTaskPayloads('2026-08-21', [E1], [TPL_E1], '   ');
  assert.equal(out[0].ghiChu.split('\n')[0], '@');
});

test('template KHÔNG có token {{mention}} (vd "@Mọi người", "皆様") -> không bị đụng dù có mentionName', () => {
  const bienThe = [
    def({ id: 'a', templateId: 'ta' }),
    def({ id: 'b', templateId: 'tb' }),
    def({ id: 'c', templateId: 'tc' })
  ];
  const templates = [
    tpl('ta', '@Mọi người\nNội dung A'),
    tpl('tb', '＠Mọi người \nNội dung B'),
    tpl('tc', '皆様\nNội dung C')
  ];
  const out = emergencyReleaseTaskPayloads('2026-08-21', bienThe, templates, 'Sơn');
  assert.equal(out[0].ghiChu, '@Mọi người\nNội dung A');
  assert.equal(out[1].ghiChu, '＠Mọi người \nNội dung B');
  assert.equal(out[2].ghiChu, '皆様\nNội dung C');
});

test('mentionName có khoảng trắng thừa -> trim trước khi chèn', () => {
  const out = emergencyReleaseTaskPayloads('2026-08-21', [E1], [TPL_E1], '  Sơn  ');
  assert.equal(out[0].ghiChu.split('\n')[0], '@ Sơn');
});

test('nhiều definition cùng lúc: chỉ đúng task có token {{mention}} bị thay, các task khác giữ nguyên', () => {
  const other = def({ id: 'other', templateId: 'to' });
  const templates = [TPL_E1, tpl('to', '@Mọi người\nKhác')];
  const out = emergencyReleaseTaskPayloads('2026-08-21', [E1, other], templates, 'Cường');
  const e1Result = out.find((t) => t.originRef === 'emergency_release_task_1779781779061');
  const otherResult = out.find((t) => t.originRef === 'other');
  assert.equal(e1Result?.ghiChu.split('\n')[0], '@ Cường');
  assert.equal(otherResult?.ghiChu, '@Mọi người\nKhác');
});

// Ca lỗi Leader chỉ ra, tái hiện qua đúng đường app dùng (không chỉ qua hàm render trực tiếp ở trên):
// template thật của E1 có 2 chỗ cần điền tên (vd nhắc lại ở cuối bài) -> cả 2 phải ra cùng 1 danh sách.
test('template có NHIỀU token {{mention}} qua đúng đường emergencyReleaseTaskPayloads -> cả 2 đều thay đúng', () => {
  const tpl2Cho = tpl('tpl-e1-2cho', '@{{mention}}\nNội dung...\nNhắc: @{{mention}} xác nhận nhé.');
  const out = emergencyReleaseTaskPayloads('2026-08-21', [{ ...E1, templateId: 'tpl-e1-2cho' }], [tpl2Cho], 'Sơn, Cường');
  const dong = out[0].ghiChu.split('\n');
  assert.equal(dong[0], '@ Sơn, Cường');
  assert.equal(dong[2], 'Nhắc: @ Sơn, Cường xác nhận nhé.');
});
