
export const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const VIETNAM_UTC_OFFSET = '+07:00';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: VIETNAM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short'
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
};

export type VietnamParts = {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  weekday: number;   // 0 = Chủ nhật (khớp Date.getDay())
  dateKey: string;   // yyyy-mm-dd theo giờ VN
};

// Bóc các thành phần lịch/đồng hồ của MỘT thời điểm theo giờ VN.
export function vietnamParts(date: Date = new Date()): VietnamParts {
  const parts = partsFormatter.formatToParts(date);
  const num = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value || 0);
  const year = num('year');
  const month = num('month');
  const day = num('day');
  return {
    year, month, day,
    hour: num('hour'),
    minute: num('minute'),
    second: num('second'),
    weekday: WEEKDAY_INDEX[String(parts.find((p) => p.type === 'weekday')?.value || 'Sun')] ?? 0,
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  };
}

// Ngày (yyyy-mm-dd) theo giờ VN của một thời điểm.
export function vietnamDateKey(date: Date = new Date()): string {
  return vietnamParts(date).dateKey;
}

// Số phút từ 00:00 giờ VN tới thời điểm này.
export function vietnamMinutesOfDay(date: Date = new Date()): number {
  const { hour, minute, second } = vietnamParts(date);
  return hour * 60 + minute + second / 60;
}

// "Ngày VN + giờ VN" -> thời điểm tuyệt đối. Trả null nếu giờ sai định dạng.
export function vietnamInstant(dateKey: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${dateKey}T${time}:00.000${VIETNAM_UTC_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Còn bao nhiêu PHÚT nữa tới mốc (âm = đã quá giờ). Null nếu không dựng được mốc.
export function minutesUntilVietnam(dateKey: string, time: string, now: Date = new Date()): number | null {
  const target = vietnamInstant(dateKey, time);
  if (!target) return null;
  return (target.getTime() - now.getTime()) / 60000;
}
