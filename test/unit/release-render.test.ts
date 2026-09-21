// CR-20260814-hop-nhat-dong-bo-definition-xuong-task — unit test cho nguồn duy nhất
// dựng nội dung task từ definition + so lệch (FR-8/FR-10). Test thuần, không đọc DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  releaseTokenDateMap, renderManagedReleaseTemplate, compareReleaseTaskDefinitions,
  buildDefinitionTargetPayload, diffTaskAgainstDefinition, buildReleaseUpdateStatement,
  type ReleaseTaskDefinitionRow, type TaskRowForDiff
} from '../../server/lib/release-render.js';

test('releaseTokenDateMap: release.date và staging.friday trùng ngày release', () => {
  const map = releaseTokenDateMap('2026-08-14');
  assert.equal(map['release.date'].toDateString(), map['staging.friday'].toDateString());
});

test('renderManagedReleaseTemplate: token hợp lệ được thay bằng ngày VN, nội dung tiếng Nhật thì format JP', () => {
  const vn = renderManagedReleaseTemplate('Hạn chót: {{release.date}}', '2026-08-14');
  assert.match(vn, /Hạn chót: \d{2}\/\d{2}\/2026 \(/);
  const jp = renderManagedReleaseTemplate('締切りです: {{release.date}}', '2026-08-14');
  assert.match(jp, /2026年08月14日/);
});

test('renderManagedReleaseTemplate: token lạ giữ nguyên, không thay', () => {
  const out = renderManagedReleaseTemplate('X {{khong.ton.tai}} Y', '2026-08-14');
  assert.equal(out, 'X {{khong.ton.tai}} Y');
});

test('compareReleaseTaskDefinitions: sắp theo tuần rồi giờ rồi tên', () => {
  const a = { date_token: 'develop.monday', start_time: '10:00', title: 'B' };
  const b = { date_token: 'jack.friday', start_time: '09:00', title: 'A' };
  assert.ok(compareReleaseTaskDefinitions(a, b) > 0); // jack (tuần 1) trước develop (tuần 2)
});

function makeDefinition(overrides: Partial<ReleaseTaskDefinitionRow> = {}): ReleaseTaskDefinitionRow {
  return {
    id: 'def-1', title: 'Thông báo release', start_time: '10:00', date_token: 'release.date',
    template_id: null, task_links: '[]', reply_to_definition_id: null,
    ...overrides
  };
}

function makeTask(overrides: Partial<TaskRowForDiff> = {}): TaskRowForDiff {
  return {
    ten_task: 'Thông báo release', ghi_chu: '', gio_bat_dau: '10:00', ngay_cu_the: '2026-08-14',
    task_links: '[]', reply_to_ref: null,
    ...overrides
  };
}

test('AC-4: definition KHÔNG có template -> target.ghiChu = null, diff KHÔNG báo lệch ghiChu dù Note khác gì', () => {
  const definition = makeDefinition({ template_id: null });
  const target = buildDefinitionTargetPayload(definition, '2026-08-14', null);
  assert.equal(target.ghiChu, null);
  const task = makeTask({ ghi_chu: 'Note tự tay 200 ký tự, hoàn toàn khác template' });
  const changed = diffTaskAgainstDefinition(task, target);
  assert.ok(!changed.includes('ghiChu'));
});

test('AC-4: câu UPDATE dựng ra KHÔNG chứa cột ghi_chu khi không có template', () => {
  const definition = makeDefinition({ template_id: null });
  const target = buildDefinitionTargetPayload(definition, '2026-08-14', null);
  const { sql, columns } = buildReleaseUpdateStatement(target, 42);
  assert.ok(!sql.includes('ghi_chu'), `SQL không được chứa ghi_chu: ${sql}`);
  assert.ok(!columns.includes('ghi_chu'));
});

test('AC-4b: definition CÓ template nhưng render ra rỗng -> target.ghiChu = "" (khác null), UPDATE set ghi_chu rỗng', () => {
  const definition = makeDefinition({ template_id: 'tpl-1' });
  const target = buildDefinitionTargetPayload(definition, '2026-08-14', ''); // template tồn tại nhưng content rỗng
  assert.equal(target.ghiChu, '');
  assert.notEqual(target.ghiChu, null);
  const { sql, columns, params } = buildReleaseUpdateStatement(target, 42);
  assert.ok(sql.includes('ghi_chu'));
  assert.equal(params[columns.indexOf('ghi_chu')], '');
});

test('AC-7: definition có reply_to_definition_id -> target.replyToRef khớp đúng giá trị đó', () => {
  const definition = makeDefinition({ reply_to_definition_id: 'def-goc' });
  const target = buildDefinitionTargetPayload(definition, '2026-08-14', null);
  assert.equal(target.replyToRef, 'def-goc');
});

test('AC-7b: definition KHÔNG có reply_to_definition_id -> target.replyToRef = null', () => {
  const definition = makeDefinition({ reply_to_definition_id: null });
  const target = buildDefinitionTargetPayload(definition, '2026-08-14', null);
  assert.equal(target.replyToRef, null);
});

test('AC-2: đổi tên definition -> chỉ tenTask lệch, không có field khác lệch theo', () => {
  const definition = makeDefinition({ title: 'Tên đã đổi' });
  const target = buildDefinitionTargetPayload(definition, '2026-08-14', null);
  const task = makeTask({ ten_task: 'Tên cũ' });
  const changed = diffTaskAgainstDefinition(task, target);
  assert.deepEqual(changed, ['tenTask']);
});

test('diff: chuẩn hoá trim + CRLF/LF trước khi so -> không false-positive vì khác cách render', () => {
  const definition = makeDefinition({ template_id: 'tpl-1' });
  const target = buildDefinitionTargetPayload(definition, '2026-08-14', 'Dòng 1\nDòng 2  ');
  const task = makeTask({ ghi_chu: '  Dòng 1\r\nDòng 2' });
  const changed = diffTaskAgainstDefinition(task, target);
  assert.ok(!changed.includes('ghiChu'));
});

test('AC-11: không lệch gì thì diff trả mảng rỗng', () => {
  const definition = makeDefinition();
  const target = buildDefinitionTargetPayload(definition, '2026-08-14', null);
  const task = makeTask({ gio_bat_dau: target.gioBatDau, ngay_cu_the: target.ngayCuThe });
  assert.deepEqual(diffTaskAgainstDefinition(task, target), []);
});
