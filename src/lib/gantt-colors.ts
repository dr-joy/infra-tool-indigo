// CR-20260913 FR-17: bảng màu Gantt cố định 15 màu theo User thật, thay cho màu PIC chữ tự do cũ
// (xem PIC_COLOR_PALETTE ở task-utils.ts — vẫn giữ nguyên cho tính năng Quản lý PIC cũ, không liên
// quan). `key` phải khớp đúng `server/lib/gantt-colors.ts` (GANTT_COLOR_KEYS) — đổi 1 bên phải đổi cả 2.
export const GANTT_COLOR_TOKENS: { key: string; hex: string; label: string }[] = [
  { key: 'red', hex: '#ef4444', label: 'Đỏ' },
  { key: 'orange', hex: '#f97316', label: 'Cam' },
  { key: 'amber', hex: '#f59e0b', label: 'Hổ phách' },
  { key: 'yellow', hex: '#eab308', label: 'Vàng' },
  { key: 'lime', hex: '#84cc16', label: 'Chanh' },
  { key: 'green', hex: '#22c55e', label: 'Lục' },
  { key: 'emerald', hex: '#10b981', label: 'Ngọc lục bảo' },
  { key: 'teal', hex: '#14b8a6', label: 'Ngọc' },
  { key: 'cyan', hex: '#06b6d4', label: 'Lam ngọc' },
  { key: 'sky', hex: '#0ea5e9', label: 'Xanh da trời' },
  { key: 'blue', hex: '#3b82f6', label: 'Lam' },
  { key: 'indigo', hex: '#6366f1', label: 'Chàm' },
  { key: 'violet', hex: '#8b5cf6', label: 'Tím violet' },
  { key: 'purple', hex: '#a855f7', label: 'Tím' },
  { key: 'pink', hex: '#ec4899', label: 'Hồng' }
];

const HEX_BY_KEY: Record<string, string> = Object.fromEntries(GANTT_COLOR_TOKENS.map((t) => [t.key, t.hex]));

export function ganttColorHex(key: string | null | undefined): string | null {
  return key ? HEX_BY_KEY[key] || null : null;
}
