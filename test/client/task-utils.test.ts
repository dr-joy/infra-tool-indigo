import { describe, it, expect } from 'vitest';
import {
  trangThaiLabel, splitAssignees, clientAutoStatus, parseGoalConflict, goalConflictMessage,
  buildProjectTaskNumbers, normalizedTaskLinks, sapXepTask, taoSortHienTai, sortButtonClass,
  progressSelectOptions
} from '../../src/lib/task-utils';
import { ApiError } from '../../src/api';
import type { ProjectTaskItem, Task } from '../../src/types';

describe('lib/task-utils', () => {
  it('trangThaiLabel: ưu tiên i18n rồi tới nhãn mặc định', () => {
    const t = ((k: string) => (k === 'status.canceled' ? 'Đã hủy' : '')) as never;
    expect(trangThaiLabel('canceled', t)).toBe('Đã hủy');
    const empty = (() => '') as never;
    expect(trangThaiLabel('dang_tien_hanh', empty)).toBe('Đang tiến hành');
    expect(trangThaiLabel('la_gi', empty)).toBe('la_gi');
  });

  it('splitAssignees tách chuỗi PIC', () => {
    expect(splitAssignees('Định, Nam ,')).toEqual(['Định', 'Nam']);
    expect(splitAssignees('')).toEqual([]);
  });

  it('clientAutoStatus phân loại đạt/vượt/không đạt', () => {
    expect(clientAutoStatus(80, 70)).toBe('vuot');
    expect(clientAutoStatus(70, 70)).toBe('dat');
    expect(clientAutoStatus(50, 70)).toBe('khong_dat');
  });

  it('parseGoalConflict chỉ nhận ApiError GOAL_CONFLICT', () => {
    const err = new ApiError(409, 'x', 'GOAL_CONFLICT', { weeks: ['2026-01-05'] });
    expect(parseGoalConflict(err)).toEqual({ weeks: ['2026-01-05'] });
    expect(parseGoalConflict(new ApiError(400, 'x', 'OTHER'))).toBeNull();
    expect(parseGoalConflict(new Error('x'))).toBeNull();
    expect(goalConflictMessage(['2026-01-05'])).toContain('05/01');
  });

  it('buildProjectTaskNumbers đánh số cây phân cấp', () => {
    const tasks = [
      { id: 'a', parentId: null, sortOrder: 0 },
      { id: 'b', parentId: null, sortOrder: 1 },
      { id: 'a1', parentId: 'a', sortOrder: 0 }
    ] as ProjectTaskItem[];
    const { numberById } = buildProjectTaskNumbers(tasks);
    expect(numberById.get('a')).toBe('1');
    expect(numberById.get('a1')).toBe('1.1');
    expect(numberById.get('b')).toBe('2');
  });

  it('normalizedTaskLinks bỏ url rỗng + giới hạn 4', () => {
    const links = normalizedTaskLinks([
      { type: 'chat', url: ' https://a ' }, { type: 'git', url: '' }
    ]);
    expect(links).toEqual([{ type: 'chat', url: 'https://a' }]);
  });

  it('sapXepTask sắp theo ngày + hướng', () => {
    const tasks = [
      { ngayTao: '2026-01-02' }, { ngayTao: '2026-01-01' }
    ] as Task[];
    const asc = sapXepTask(tasks, { truong: 'ngayTao', huong: 'asc' });
    expect(asc[0].ngayTao).toBe('2026-01-01');
    const desc = sapXepTask(tasks, { truong: 'ngayTao', huong: 'desc' });
    expect(desc[0].ngayTao).toBe('2026-01-02');
    expect(sapXepTask(tasks, null)).toBe(tasks); // null -> giữ nguyên
  });

  it('taoSortHienTai đảo hướng khi cùng trường', () => {
    expect(taoSortHienTai(null, 'ngayTao')).toEqual({ truong: 'ngayTao', huong: 'asc' });
    expect(taoSortHienTai({ truong: 'ngayTao', huong: 'asc' }, 'ngayTao')).toEqual({ truong: 'ngayTao', huong: 'desc' });
    expect(sortButtonClass({ truong: 'ngayTao', huong: 'asc' }, 'ngayTao')).toContain('nut-sort-active');
  });

  it('progressSelectOptions thêm giá trị lệch bước', () => {
    expect(progressSelectOptions(20)).toContain(20);
    expect(progressSelectOptions(25)).toContain(25);
    expect(progressSelectOptions(25)).toContain(20);
  });
});
