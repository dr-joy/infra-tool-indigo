// Test CỔNG design token (scripts/check-design-tokens.mjs) — Ref: CR-20260913-c (BL-20260913-005).
//
// Vì sao test chính cổng snapshot multiset: một cổng ĐẾM TỔNG bị vượt qua dễ dàng — xoá 1 hardcode
// cũ, thêm 1 hardcode MỚI khác đi, tổng số dòng không đổi nên cổng đếm-tổng xanh nhầm. Council (run
// 0e0ddc52) yêu cầu rõ 3 ca dưới đây phải test được cho CHÍNH script, không chỉ cho baseline thật.
//
// Council review (run ce616b1f, 2026-09-13) phát hiện bản đầu neo `^` (đầu dòng) nên bỏ lọt khai báo
// compact 1 dòng (`.ld-warn { color: #b45309; }`) và không theo dõi shorthand pha token
// (`margin: var(--space-sm) 3px;`) — cả hai lỗi này giờ có test riêng ở nhóm "Council review" dưới.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — script build bằng JS thuần, không có .d.ts (chỉ test dùng tới)
import { quetCssChoToken, soSanhBaseline } from '../../scripts/check-design-tokens.mjs';

type Muc = { file: string; thuocTinh: string; giaTri: string; dong: number; text: string };

function quet(css: string, ten = 'test.css'): { muc: Muc[]; loiMarker: { dong: number; text: string }[] } {
  return quetCssChoToken(css, ten);
}

// ── Ca (a): hardcode MỚI không có trong baseline -> chặn ────────────────────────

test('ca (a): hardcode mới hoàn toàn, baseline rỗng -> vi phạm', () => {
  const { muc } = quet('.box {\n  color: #ff00ff;\n}');
  const viPham = soSanhBaseline(muc, []);
  assert.equal(viPham.length, 1);
  assert.equal(viPham[0].giaTri, '#ff00ff');
});

test('ca (a): giá trị dùng var(--...) không phải hardcode -> không vi phạm dù baseline rỗng', () => {
  const { muc } = quet('.box {\n  color: var(--color-danger);\n}');
  assert.equal(muc.length, 0);
  assert.equal(soSanhBaseline(muc, []).length, 0);
});

// ── Ca (b): xoá 1 hardcode cũ + thêm 1 hardcode MỚI khác, tổng dòng không đổi ───

test('ca (b): thay #111111 (đã ở baseline) bằng #222222 (chưa từng thấy) -> vẫn bị chặn dù tổng số dòng bằng nhau', () => {
  const baseline = [{ file: 'test.css', thuocTinh: 'color', giaTri: '#111111' }];
  const cssMoi = '.box {\n  color: #222222;\n}'; // đã bỏ #111111, thêm #222222 — tổng vẫn 1 khai báo
  const { muc } = quet(cssMoi);
  const viPham = soSanhBaseline(muc, baseline);
  assert.equal(viPham.length, 1, 'đếm-tổng sẽ xanh nhầm ở ca này — multiset phải bắt được');
  assert.equal(viPham[0].giaTri, '#222222');
});

test('ca (b, đối chứng): giữ nguyên #111111 như baseline -> không vi phạm', () => {
  const baseline = [{ file: 'test.css', thuocTinh: 'color', giaTri: '#111111' }];
  const { muc } = quet('.box {\n  color: #111111;\n}');
  assert.equal(soSanhBaseline(muc, baseline).length, 0);
});

// ── Ca (c): marker ngoại lệ hợp lệ -> qua cổng ────────────────────────────────

test('ca (c): marker design-token-ok kèm lý do -> không đưa vào danh sách vi phạm dù baseline rỗng', () => {
  const { muc, loiMarker } = quet('.gantt-bar {\n  padding: 3px; /* design-token-ok: canvas Gantt, không phải UI chuẩn */\n}');
  assert.equal(muc.length, 0);
  assert.equal(loiMarker.length, 0);
});

test('ca (c, đối chứng): marker THIẾU lý do -> báo lỗi marker riêng, vẫn không tính là vi phạm hardcode', () => {
  const { muc, loiMarker } = quet('.gantt-bar {\n  padding: 3px; /* design-token-ok */\n}');
  assert.equal(muc.length, 0);
  assert.equal(loiMarker.length, 1);
});

// ── Thuộc tính không theo dõi -> không quét ──────────────────────────────────

test('thuộc tính ngoài danh sách theo dõi (vd width/height) -> không bị quét, tránh false-positive Gantt/canvas', () => {
  const { muc } = quet('.gantt-bar {\n  width: 137px;\n  height: 24px;\n}');
  assert.equal(muc.length, 0);
});

test('nhiều bộ ba khác thuộc tính cùng giá trị số không bị gộp nhầm (khoá theo cả property lẫn value)', () => {
  const baseline = [{ file: 'test.css', thuocTinh: 'gap', giaTri: '0.5rem' }];
  const { muc } = quet('.row {\n  padding: 0.5rem;\n}'); // cùng giá trị nhưng KHÁC thuộc tính (padding vs gap)
  const viPham = soSanhBaseline(muc, baseline);
  assert.equal(viPham.length, 1, 'baseline của gap không được che cho padding');
});

// ── Council review (run ce616b1f): 2 lỗi thật đã sửa ─────────────────────────

test('Council #1: khai báo COMPACT một dòng (selector + declaration cùng dòng) vẫn bị quét', () => {
  // Ca thật lọt qua ở bản đầu: `.ld-warn { color: #b45309; }` trong src/styles.css. Bản đầu neo `^`
  // đầu dòng nên bỏ qua toàn bộ dòng này (property không nằm ở đầu dòng).
  const { muc } = quet('.ld-warn { color: #b45309; }');
  assert.equal(muc.length, 1);
  assert.equal(muc[0].thuocTinh, 'color');
  assert.equal(muc[0].giaTri, '#b45309');
});

test('Council #1: nhiều khai báo compact cùng một dòng đều được bắt đủ, không chỉ khai báo đầu tiên', () => {
  const { muc } = quet('.x { color: #111111; background: #222222; }');
  assert.equal(muc.length, 2);
  assert.deepEqual(muc.map((m) => m.giaTri).sort(), ['#111111', '#222222']);
});

test('Council #2: shorthand pha token + hardcode (`margin: var(--space-sm) 3px;`) vẫn bị theo dõi, không được miễn chỉ vì bắt đầu bằng var(--...)', () => {
  const { muc } = quet('.x {\n  margin: var(--space-sm) 3px;\n}');
  assert.equal(muc.length, 1, 'giá trị còn phần hardcode "3px" sau var(), không phải token thuần');
  assert.equal(muc[0].giaTri, 'var(--space-sm) 3px');
});

test('Council #2 (đối chứng): giá trị là ĐÚNG MỘT var(--...) và không còn gì khác -> vẫn được miễn', () => {
  const { muc } = quet('.x {\n  margin: var(--space-sm);\n}');
  assert.equal(muc.length, 0);
});

test('Council #1+#2: khai báo compact vẫn nhận diện đúng marker ngoại lệ trên cùng dòng', () => {
  const { muc, loiMarker } = quet('.gantt-cell { padding: 3px; /* design-token-ok: canvas Gantt */ }');
  assert.equal(muc.length, 0);
  assert.equal(loiMarker.length, 0);
});
