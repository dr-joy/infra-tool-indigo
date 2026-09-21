// Test CỔNG máy FR-9 (scripts/check-release-sync.mjs) — Ref: CR-20260814-hop-nhat-dong-bo-definition-xuong-task.
//
// AC-12: "Given ai đó thêm lại DELETE FROM tasks … ten_task IN (…) vào vùng regular release, When
// npm run check, Then cổng check-release-sync ĐỎ; Given emergency có marker // ten-task-match-ok:
// <lý do>, Then xanh." Test này chốt hành vi đó lại để không tái diễn BUG-20260814.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — script build bằng JS thuần, không có .d.ts (chỉ test dùng tới)
import { quetNguon, ROUTE_KHONG_DUOC_MATCH_THEO_TEN } from '../../scripts/check-release-sync.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type KetQua = {
  viPham: { dong: number; route: string; text: string }[];
  thieuMarker: { dong: number; route: string; text: string }[];
};
const quet = (src: string): KetQua => quetNguon(src) as KetQua;

function routeMau(path: string, than: string) {
  return `router.post('${path}', (req, res) => {\n${than}\n});\n`;
}

test('AC-12 (hồi quy): DELETE ten_task quay lại route regular-release/task -> ĐỎ, không có đường miễn trừ marker', () => {
  const src = routeMau(ROUTE_KHONG_DUOC_MATCH_THEO_TEN, `
    // ten-task-match-ok: co-marker-cung-khong-duoc-mien-tru-o-day
    db.prepare(\`DELETE FROM tasks WHERE release_month = ? AND ten_task IN (\${placeholders})\`).run(releaseMonth, ...taskNames);
  `);
  const r = quet(src);
  assert.equal(r.viPham.length, 1, 'route số ít KHÔNG được phép match theo tên dù có marker');
});

test('route regular-release/task hiện tại (không ten_task) -> sạch', () => {
  const src = routeMau(ROUTE_KHONG_DUOC_MATCH_THEO_TEN, `
    db.prepare('SELECT * FROM tasks WHERE release_month = ? AND origin_ref = ?').get(releaseMonth, definitionId);
  `);
  const r = quet(src);
  assert.equal(r.viPham.length, 0);
  assert.equal(r.thieuMarker.length, 0);
});

test('route KHÁC (vd. emergency) DELETE dính ten_task NHƯNG có marker + lý do -> xanh', () => {
  const src = routeMau('/schedules/emergency-release/tasks', `
    // ten-task-match-ok: nguoi-dung-tu-chon-thay-the-theo-ten
    db.prepare(\`DELETE FROM tasks WHERE release_month = ? AND ten_task IN (\${placeholders})\`).run(releaseMonth, ...taskNames);
  `);
  const r = quet(src);
  assert.equal(r.viPham.length, 0);
  assert.equal(r.thieuMarker.length, 0);
});

test('route KHÁC DELETE dính ten_task nhưng THIẾU marker -> ĐỎ', () => {
  const src = routeMau('/schedules/emergency-release/tasks', `
    db.prepare(\`DELETE FROM tasks WHERE release_month = ? AND ten_task IN (\${placeholders})\`).run(releaseMonth, ...taskNames);
  `);
  const r = quet(src);
  assert.equal(r.thieuMarker.length, 1);
});

test('route KHÁC có marker nhưng RỖNG lý do -> vẫn ĐỎ (không được miễn trừ câm)', () => {
  const src = routeMau('/schedules/emergency-release/tasks', `
    // ten-task-match-ok:
    db.prepare(\`DELETE FROM tasks WHERE release_month = ? AND ten_task IN (\${placeholders})\`).run(releaseMonth, ...taskNames);
  `);
  const r = quet(src);
  assert.equal(r.thieuMarker.length, 1);
});

test('ten_task nội suy GIÁN TIẾP qua biến ${var} (ca thật legacyDeleteWhere) vẫn bị bắt', () => {
  const src = `
    const legacyDeleteWhere = placeholders
      ? \` OR (release_month IS NULL AND ten_task IN (\${placeholders}))\`
      : '';
    ${routeMau(ROUTE_KHONG_DUOC_MATCH_THEO_TEN, `
    db.prepare(\`DELETE FROM tasks WHERE release_month = ?\${legacyDeleteWhere}\`).run(releaseMonth);
    `)}
  `;
  const r = quet(src);
  assert.equal(r.viPham.length, 1, 'phải theo dõi được ten_task nội suy qua biến, không chỉ khớp text trực tiếp');
});

test('DELETE FROM tasks KHÔNG dính ten_task (vd. xoá theo release_month) -> luôn sạch dù ở route nào', () => {
  const src = routeMau(ROUTE_KHONG_DUOC_MATCH_THEO_TEN, `
    db.prepare('DELETE FROM tasks WHERE release_month = ?').run(releaseMonth);
  `);
  const r = quet(src);
  assert.equal(r.viPham.length, 0);
  assert.equal(r.thieuMarker.length, 0);
});

test('repo hiện tại (server/routes/schedules.ts) xanh: route số ít không match theo tên, route khác đủ marker', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'server/routes/schedules.ts'), 'utf8');
  const r = quet(src);
  assert.deepEqual(r.viPham, []);
  assert.deepEqual(r.thieuMarker, []);
});
