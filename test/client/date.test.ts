import { describe, it, expect } from 'vitest';
import {
  timeToMinutes, minutesToTime, snapMinutes, clamp, addDays, mondayOfWeek,
  taoNgayTuInput, congNgayInput, congThangInput, dinhDangNgay, formatRelativeOffset,
  splitRelativeOffset, mergeRelativeOffset
} from '../../src/lib/date';

describe('lib/date', () => {
  it('timeToMinutes / minutesToTime khứ hồi', () => {
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes(null, '09:00')).toBe(540);
    expect(minutesToTime(510)).toBe('08:30');
    expect(minutesToTime(540)).toBe('09:00');
  });

  it('snapMinutes làm tròn theo bước', () => {
    expect(snapMinutes(38, 15)).toBe(45); // 38/15≈2.53 -> 3*15
    expect(snapMinutes(37, 15)).toBe(30); // 37/15≈2.47 -> 2*15
    expect(snapMinutes(7, 15)).toBe(0);
  });

  it('clamp giới hạn khoảng', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it('addDays không đột biến ngày gốc', () => {
    const base = new Date(2026, 0, 1);
    const next = addDays(base, 5);
    expect(next.getDate()).toBe(6);
    expect(base.getDate()).toBe(1);
  });

  it('mondayOfWeek trả về thứ 2 của tuần', () => {
    // 2026-01-01 là thứ 5 -> thứ 2 cùng tuần là 2025-12-29
    const monday = mondayOfWeek(new Date(2026, 0, 1));
    expect(monday.getFullYear()).toBe(2025);
    expect(monday.getMonth()).toBe(11);
    expect(monday.getDate()).toBe(29);
    // Chủ nhật 2026-01-04 -> thứ 2 trước đó 2025-12-29
    const fromSunday = mondayOfWeek(new Date(2026, 0, 4));
    expect(fromSunday.getDate()).toBe(29);
  });

  it('taoNgayTuInput / congNgayInput / congThangInput', () => {
    expect(taoNgayTuInput('2026-03-15').getMonth()).toBe(2);
    expect(congNgayInput('2026-01-30', 3)).toBe('2026-02-02');
    expect(congThangInput('2026-01-31', 1)).toBe('2026-03-03'); // 31/1 +1 tháng -> tràn sang 3
  });

  it('dinhDangNgay: rỗng -> "-", ngày hợp lệ -> dd/mm/yyyy', () => {
    expect(dinhDangNgay(null)).toBe('-');
    expect(dinhDangNgay('2026-07-24')).toBe('24/07/2026');
  });

  it('relative offset: format/split/merge', () => {
    expect(formatRelativeOffset(0)).toBe('+0p');
    expect(formatRelativeOffset(90)).toBe('+1h30p');
    expect(formatRelativeOffset(-45)).toBe('-45p');
    expect(splitRelativeOffset(-90)).toEqual({ sign: '-', hours: 1, minutes: 30 });
    expect(mergeRelativeOffset('-', 1, 30)).toBe(-90);
    expect(mergeRelativeOffset('+', 2, 0)).toBe(120);
  });
});
