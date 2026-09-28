// CR-20260913 FR-17: bảng màu Gantt cố định 15 màu (không phải color picker tự do — team thực tế
// không vượt 15 người). `color_key` là token bất biến lưu trong DB (`team_member_gantt_colors`),
// hex chỉ tra ở tầng code — đổi thẩm mỹ sau này không làm lệch dữ liệu đã lưu.
export const GANTT_COLOR_KEYS = [
  'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple', 'pink'
] as const;

export type GanttColorKey = typeof GANTT_COLOR_KEYS[number];

export function isGanttColorKey(value: unknown): value is GanttColorKey {
  return typeof value === 'string' && (GANTT_COLOR_KEYS as readonly string[]).includes(value);
}
