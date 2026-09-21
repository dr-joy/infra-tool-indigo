// BUG-20260821: task "SAU CHỌN NGÀY GIỜ" (scheduleMode='after_schedule') bị đặt `ngayCuThe` ở QUÁ KHỨ
// nếu user điền lịch deploy các môi trường (giai đoạn 2) ở NGÀY KHÁC với lúc tạo task khẩn cấp ban đầu
// (giai đoạn 1) — mốc neo `afterCreateEndAt` lưu localStorage từ giai đoạn 1 đã trôi qua. Task với ngày cụ
// thể đã qua không khớp `recurringMatchesDate` của bất kỳ hôm nào nữa ⇒ tồn tại trong DB nhưng không hiện
// ở đâu trên UI, với user coi như "task sau chọn ngày giờ hoàn toàn không được tạo".
//
// Tái hiện thật: xem docs/exchanges/2026-08-21.md — user tạo giai đoạn 1 ngày 2026-08-20, qua ngày
// 2026-08-21 mới điền lịch deploy (staging 08-26, release 08-28) và bấm tạo giai đoạn 2. Task
// "Announcement - ..." bị tạo với ngayCuThe=2026-08-20 (hôm giai đoạn 1), không phải quanh 08-26/08-28.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emergencyFixedReleaseTaskPayloads } from '../../src/screens/release.js';
import type { EmergencyReleaseTaskDefinition, ReleaseTemplateItem } from '../../src/types.js';

function def(over: Partial<EmergencyReleaseTaskDefinition>): EmergencyReleaseTaskDefinition {
  return {
    id: 'x', title: 'x', note: '', timingToken: 'release_deploy', startTime: 'relative',
    immediatePriority: 1, relativeOffsetMinutes: 0, scheduleMode: 'after_schedule', templateId: null,
    links: [], sortOrder: 0,
    ...over
  };
}

const NO_TEMPLATES: ReleaseTemplateItem[] = [];

test('BUG-20260821: mốc neo giai đoạn 1 đã qua (ngày khác) -> task sau chọn ngày giờ vẫn phải nằm ở TƯƠNG LAI, không kẹt ở ngày cũ', () => {
  // Giai đoạn 1 xong lúc 2026-08-20 16:40 (lưu vào localStorage) — mốc neo cũ.
  const staleAnchor = '2026-08-20T16:40';
  // Giai đoạn 2 (điền lịch + bấm tạo) xảy ra NGÀY SAU, 2026-08-21 09:00.
  // `parseDateTimeInput` trong release.tsx dùng `new Date(y, m, d, h, min)` (giờ máy), nên `now` ở test
  // này phải dựng CÙNG KIỂU (không dùng ISO có offset) để không tự dính lỗi lệch giờ máy khi test chạy
  // trên máy múi giờ khác VN — đúng cái BUG-002 đã cảnh báo ở nơi khác trong codebase.
  const now = new Date(2026, 7, 21, 9, 0);

  const schedule = { stagingDeployAt: '2026-08-26T13:00', releaseDeployAt: '2026-08-28T09:00', demoDeployAt: '2026-08-28T16:00' };
  const announcement = def({ id: 'a1', title: 'Announcement - VN_Release' });

  const tasks = emergencyFixedReleaseTaskPayloads(schedule, [announcement], NO_TEMPLATES, staleAnchor, now);

  assert.equal(tasks.length, 1);
  assert.notEqual(tasks[0].ngayCuThe, '2026-08-20', 'không được kẹt lại đúng ngày mốc neo cũ (đã qua)');
  assert.ok(tasks[0].ngayCuThe >= '2026-08-21', 'task sau chọn ngày giờ phải nằm từ hôm bấm tạo giai đoạn 2 trở đi');
});

test('mốc neo giai đoạn 1 vẫn ở TƯƠNG LAI (submit ngay, cùng phiên) -> dùng đúng mốc neo như cũ', () => {
  const freshAnchor = '2026-08-21T09:15';
  const now = new Date(2026, 7, 21, 9, 0);
  const schedule = { stagingDeployAt: '2026-08-26T13:00', releaseDeployAt: '2026-08-28T09:00', demoDeployAt: '2026-08-28T16:00' };
  const announcement = def({ id: 'a1', title: 'Announcement - VN_Release' });

  const tasks = emergencyFixedReleaseTaskPayloads(schedule, [announcement], NO_TEMPLATES, freshAnchor, now);

  assert.equal(tasks[0].ngayCuThe, '2026-08-21');
  assert.equal(tasks[0].gioBatDau, '09:15');
});
