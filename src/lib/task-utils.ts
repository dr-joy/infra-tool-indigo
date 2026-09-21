// Helper/hằng thuần dùng chung nhiều màn hình (task, project, mục tiêu tuần).
// Tách khỏi main.tsx để các màn Project/Weekly/Release import mà không tạo vòng lặp.
import { ApiError } from '../api';
import { timeToMinutes } from './date';
import type { TranslationKey } from '../i18n';
import type { ProjectTaskItem, ProjectTaskProgress, SortState, Task, TaskLink, TaskLinkType, TruongSort } from '../types';

// Xếp lane cho các task định kỳ trùng khung giờ (dùng ở cột task định kỳ + timeline release).
export function tinhLaneTaskDinhKy(tasks: Task[]) {
  const sorted = tasks
    .map((task) => ({
      task,
      start: timeToMinutes(task.gioBatDau, '08:00'),
      end: timeToMinutes(task.gioKetThuc || task.gioBatDau, '08:15')
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const layouts = new Map<number, { lane: number; laneCount: number }>();
  const groups: typeof sorted[] = [];

  for (const item of sorted) {
    const currentGroup = groups[groups.length - 1];
    const currentEnd = currentGroup?.reduce((max, value) => Math.max(max, value.end), -Infinity) ?? -Infinity;
    if (!currentGroup || item.start >= currentEnd) groups.push([item]);
    else currentGroup.push(item);
  }

  for (const group of groups) {
    const laneEnds: number[] = [];
    const assigned = new Map<number, number>();
    for (const item of group) {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[lane] = item.end;
      }
      assigned.set(item.task.id, lane);
    }

    const laneCount = Math.max(1, laneEnds.length);
    for (const item of group) {
      layouts.set(item.task.id, { lane: assigned.get(item.task.id) || 0, laneCount });
    }
  }

  return layouts;
}

export const tenTrangThai: Record<string, string> = {
  chua_thuc_hien: 'Chưa thực hiện',
  dang_tien_hanh: 'Đang tiến hành',
  da_hoan_thanh: 'Đã hoàn thành'
};
tenTrangThai.canceled = 'Canceled';

export function trangThaiLabel(trangThai: string, t: (key: TranslationKey) => string): string {
  const key = `status.${trangThai}` as TranslationKey;
  return t(key) || tenTrangThai[trangThai] || trangThai;
}

export const taskLinkTypeLabels: Record<TaskLinkType, string> = {
  chat: 'Chat',
  file: 'File',
  git: 'GitHub',
  release: 'Remine',
  zoom: 'Zoom'
};
export const maxTaskLinks = 4;
export const quickProjectTaskCreatedEvent = 'quick-project-task-created';

// Bảng màu chọn cho PIC (hiển thị trên Gantt)
export const PIC_COLOR_PALETTE: { value: string; label: string }[] = [
  { value: '#ef4444', label: 'Đỏ' },
  { value: '#f97316', label: 'Cam' },
  { value: '#eab308', label: 'Vàng' },
  { value: '#22c55e', label: 'Lục' },
  { value: '#14b8a6', label: 'Ngọc' },
  { value: '#3b82f6', label: 'Lam' },
  { value: '#6366f1', label: 'Chàm' },
  { value: '#a855f7', label: 'Tím' },
  { value: '#ec4899', label: 'Hồng' },
  { value: '#78716c', label: 'Nâu xám' },
];

// Tiến độ chọn theo bước 10%. Nếu giá trị hiện tại lệch bước (data cũ) thì thêm vào để select không bị trống.
export const projectTaskProgressOptions: ProjectTaskProgress[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
export function progressSelectOptions(current?: number): number[] {
  if (current == null || projectTaskProgressOptions.includes(current)) return projectTaskProgressOptions;
  return [...projectTaskProgressOptions, current].sort((a, b) => a - b);
}

// Tách chuỗi PIC "Định, Nam" thành mảng tên.
export function splitAssignees(value: string): string[] {
  return value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// Tự phân loại đạt/vượt/không đạt theo % (giống server) — tính phía client để không phải gọi server giữa chừng.
export function clientAutoStatus(current: number, target: number): 'dat' | 'vuot' | 'khong_dat' {
  if (current > target) return 'vuot';
  if (current >= target) return 'dat';
  return 'khong_dat';
}

// Lỗi 409 khi đổi ngày dự kiến làm task rớt khỏi tuần đang là mục tiêu.
export function parseGoalConflict(error: unknown): { weeks: string[] } | null {
  if (error instanceof ApiError && error.code === 'GOAL_CONFLICT') {
    const weeks = (error.details as { weeks?: string[] } | undefined)?.weeks;
    return { weeks: weeks || [] };
  }
  return null;
}

export function goalConflictMessage(weeks: string[]): string {
  const ds = weeks.map((w) => { const [, m, d] = w.split('-'); return `${d}/${m}`; }).join(', ');
  return `Ngày dự kiến mới không còn thuộc tuần mà task đang là MỤC TIÊU TUẦN (tuần ${ds}).\n\nBấm OK để vẫn cập nhật ngày — task sẽ bị gỡ khỏi mục tiêu tuần và mất badge 🎯.\nBấm Cancel để giữ nguyên.`;
}

export function buildProjectTaskNumbers(tasks: ProjectTaskItem[]) {
  const byParent = new Map<string, ProjectTaskItem[]>();
  for (const task of tasks) {
    const key = task.parentId || 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(task);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || Number(a.id) - Number(b.id));
  }
  const numberById = new Map<string, string>();
  const orderById = new Map<string, number>();
  let sequence = 0;
  const walk = (parentKey: string, prefix: string) => {
    const list = byParent.get(parentKey) || [];
    list.forEach((task, index) => {
      const num = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
      numberById.set(task.id, num);
      orderById.set(task.id, sequence++);
      walk(task.id, num);
    });
  };
  walk('root', '');
  return { numberById, orderById };
}

export function normalizedTaskLinks(links: TaskLink[]) {
  return links
    .map((link) => ({ type: link.type, url: link.url.trim() }))
    .filter((link) => link.url)
    .slice(0, maxTaskLinks);
}

export function taskLinkHref(url: string) {
  return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
}

export function sapXepTask(tasks: Task[], sort: SortState | null) {
  if (!sort) return tasks;
  return [...tasks].sort((a, b) => {
    const av = new Date(String(a[sort.truong] || 0)).getTime();
    const bv = new Date(String(b[sort.truong] || 0)).getTime();
    return sort.huong === 'asc' ? av - bv : bv - av;
  });
}

export function taoSortHienTai(current: SortState | null, truong: TruongSort): SortState {
  return { truong, huong: current?.truong === truong && current.huong === 'asc' ? 'desc' : 'asc' };
}

export function sortButtonClass(sort: SortState | null, truong: TruongSort) {
  return `nut-sort ${sort?.truong === truong ? 'nut-sort-active' : ''}`;
}
