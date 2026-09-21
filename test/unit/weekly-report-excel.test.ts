// Test cho server/lib/weekly-report-excel.ts (CR-20260915-xuat-excel-bao-cao-dm).
// buildDmReportRows() là hàm thuần (nhận WeekData, không đụng DB) -> test bằng fixture tay, không cần app/DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDmReportRows } from '../../server/lib/weekly-report-excel.js';
import type { WeekData, GoalView } from '../../server/lib/weekly-report.js';

function goal(overrides: Partial<GoalView>): GoalView {
  return {
    goalId: 1, text: 'Task mặc định', assignee: 'Nam', tienDo: 0, dueDate: '2026-09-14',
    taskId: '1', targetProgress: 100, status: 'dat', note: '', achieved: true,
    ...overrides,
  };
}

function weekData(groups: WeekData['groups']): WeekData {
  return { weekStart: '2026-09-14', weekEnd: '2026-09-20', prevWeekStart: '2026-09-07', groups, byMember: [] };
}

test('buildDmReportRows: task khong_dat -> Status "Không hoàn thành" kèm Note; dat -> "Hoàn thành" không Note', () => {
  const data = weekData([{
    projectId: '1', name: 'Cloud Run', doneCount: 0, totalCount: 2,
    lastWeekGoals: [
      goal({ goalId: 1, text: 'Việc A', assignee: 'Nam', status: 'khong_dat', note: 'Bận việc khác' }),
      goal({ goalId: 2, text: 'Việc B', assignee: 'Nam', status: 'dat', note: 'không nên xuất hiện' }),
    ],
    unplanned: [], summary: '', goals: [],
  }]);
  const rows = buildDmReportRows(data);
  const rowA = rows.find((r) => r.lastWeekText === 'Việc A')!;
  const rowB = rows.find((r) => r.lastWeekText === 'Việc B')!;
  assert.equal(rowA.lastWeekStatus, 'Không hoàn thành');
  assert.equal(rowA.lastWeekNote, 'Bận việc khác');
  assert.equal(rowB.lastWeekStatus, 'Hoàn thành');
  assert.equal(rowB.lastWeekNote, '', 'Hoàn thành không được kèm Note');
});

test('buildDmReportRows: status "vuot" cũng tính là Hoàn thành', () => {
  const data = weekData([{
    projectId: '1', name: 'P', doneCount: 1, totalCount: 1,
    lastWeekGoals: [goal({ text: 'Việc vượt', assignee: 'Nam', status: 'vuot' })],
    unplanned: [], summary: '', goals: [],
  }]);
  const rows = buildDmReportRows(data);
  assert.equal(rows[0].lastWeekStatus, 'Hoàn thành');
});

test('buildDmReportRows: task giao nhiều người ("A, B") nhân dòng dưới TỪNG người', () => {
  const data = weekData([{
    projectId: '1', name: 'P', doneCount: 0, totalCount: 0,
    lastWeekGoals: [], unplanned: [], summary: '',
    goals: [goal({ text: 'Verify output', assignee: 'Định, Cường, Phú', status: 'dat', targetProgress: 100 })],
  }]);
  const rows = buildDmReportRows(data);
  const pics = rows.map((r) => r.pic).sort((a, b) => a.localeCompare(b, 'vi'));
  assert.deepEqual(pics, ['Cường', 'Phú', 'Định'].sort((a, b) => a.localeCompare(b, 'vi')));
  rows.forEach((r) => assert.match(r.thisWeekText, /^Verify output \(→100%\)$/));
});

test('buildDmReportRows: 1 bên nhiều task hơn bên kia -> phía thiếu điền "-", không đụng dòng của PIC khác', () => {
  const data = weekData([{
    projectId: '1', name: 'P', doneCount: 0, totalCount: 0,
    lastWeekGoals: [
      goal({ text: 'Việc 1', assignee: 'Hoàng', status: 'dat' }),
      goal({ text: 'Việc 2', assignee: 'Hoàng', status: 'dat' }),
    ],
    unplanned: [], summary: '',
    goals: [goal({ text: 'Mục tiêu mới', assignee: 'Hoàng', targetProgress: 100 })],
  }]);
  const rows = buildDmReportRows(data);
  assert.equal(rows.length, 2, 'max(2 tuần trước, 1 tuần này) = 2 dòng cho Hoàng');
  assert.equal(rows[0].lastWeekText, 'Việc 1');
  assert.equal(rows[0].thisWeekText, 'Mục tiêu mới (→100%)');
  assert.equal(rows[1].lastWeekText, 'Việc 2');
  assert.equal(rows[1].thisWeekText, '-', 'dòng 2 không có mục tiêu tuần này tương ứng -> "-"');
});

test('buildDmReportRows: PIC hoàn toàn không có việc ở 1 vùng -> dòng đó "-" ở vùng rỗng, không mất người', () => {
  const data = weekData([{
    projectId: '1', name: 'P', doneCount: 0, totalCount: 0,
    lastWeekGoals: [], unplanned: [], summary: '',
    goals: [goal({ text: 'Việc mới', assignee: 'Nam', targetProgress: 100 })],
  }]);
  const rows = buildDmReportRows(data);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pic, 'Nam');
  assert.equal(rows[0].lastWeekText, '-');
  assert.equal(rows[0].lastWeekStatus, '-');
  assert.equal(rows[0].thisWeekText, 'Việc mới (→100%)');
});

test('buildDmReportRows: projectMergeSpan/picMergeSpan cộng đúng tổng số dòng của project/PIC', () => {
  const data = weekData([{
    projectId: '1', name: 'P', doneCount: 0, totalCount: 0,
    lastWeekGoals: [
      goal({ text: 'A1', assignee: 'Nam', status: 'dat' }),
      goal({ text: 'A2', assignee: 'Nam', status: 'dat' }),
      goal({ text: 'B1', assignee: 'Phú', status: 'dat' }),
    ],
    unplanned: [], summary: '', goals: [],
  }]);
  const rows = buildDmReportRows(data);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].projectMergeSpan, 3, 'project merge span = tổng mọi dòng của project');
  assert.equal(rows[0].picMergeSpan, 2, 'Nam có 2 dòng');
  assert.equal(rows[2].picMergeSpan, 1, 'Phú có 1 dòng');
});

test('buildDmReportRows: project không có gì ở cả 2 vùng -> bị loại khỏi kết quả', () => {
  const data = weekData([
    { projectId: '1', name: 'Rỗng', doneCount: 0, totalCount: 0, lastWeekGoals: [], unplanned: [], summary: '', goals: [] },
    { projectId: '2', name: 'Có việc', doneCount: 0, totalCount: 0, lastWeekGoals: [], unplanned: [], summary: '', goals: [goal({ text: 'X', assignee: 'Nam' })] },
  ]);
  const rows = buildDmReportRows(data);
  assert.ok(rows.every((r) => r.project === 'Có việc'));
});
