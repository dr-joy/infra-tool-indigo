// Helper ngày/giờ thuần (không phụ thuộc React/DOM state) — tách khỏi main.tsx để
// mọi màn hình dùng chung thay vì chép lại logic giờ Việt Nam / cộng trừ ngày.

export const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function dateTimePartsInVietnam(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    hour12: false
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second')
  };
}

export function currentVietnamDateInputValue(date = new Date()) {
  const parts = dateTimePartsInVietnam(date);
  return [
    parts.year,
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0')
  ].join('-');
}

export function currentVietnamTimeMinutes(date = new Date()) {
  const parts = dateTimePartsInVietnam(date);
  return parts.hour * 60 + parts.minute + (parts.second > 0 ? 1 / 60 : 0);
}

// Việt Nam không có DST -> offset cố định. Ghép "ngày VN + giờ VN" thành thời điểm tuyệt đối.
// Dùng cho mọi phép so "đã tới giờ chưa": `new Date(y,m,d,h,m)` lấy giờ MÁY nên máy đặt
// JST/UTC sẽ lệch (BUG-002). Phải khớp server/lib/vn-time.ts.
export const VIETNAM_UTC_OFFSET = '+07:00';

export function vietnamInstant(dateValue: string, timeValue: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) return null;
  const d = new Date(`${dateValue}T${timeValue}:00.000${VIETNAM_UTC_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// tz-ok: ngay-lich-round-trip — doc lai ngay cua mot Date bang chinh mui gio may da dung no
export function localDateInputValue(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

// tz-ok: ngay-lich-round-trip — dung Date mang nghia NGAY LICH tu yyyy-mm-dd, khong phai thoi diem
export function taoNgayTuInput(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// tz-ok: dieu-huong-ngay-tren-form — lui/tien ngay tren input, khong phai quyet dinh theo gio
export function congNgayInput(value: string, days: number) {
  const date = taoNgayTuInput(value);
  date.setDate(date.getDate() + days);
  return localDateInputValue(date);
}

// tz-ok: dieu-huong-ngay-tren-form — lui/tien thang tren input, khong phai quyet dinh theo gio
export function congThangInput(value: string, months: number) {
  const date = taoNgayTuInput(value);
  date.setMonth(date.getMonth() + months);
  return localDateInputValue(date);
}

export function timeToMinutes(value?: string | null, fallback = '08:00') {
  const [hour, minute] = String(value || fallback).split(':').map(Number);
  return hour * 60 + minute;
}

export function minutesToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function snapMinutes(value: number, step = 15) {
  return Math.round(value / step) * step;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function layGioPhutVietNam() {
  const { hour, minute, second } = dateTimePartsInVietnam();
  return { hour, minute, second };
}

export function roundedImmediateStartTime() {
  const now = layGioPhutVietNam();
  const rounded = Math.ceil((now.hour * 60 + now.minute + (now.second > 0 ? 1 : 0)) / 5) * 5;
  return minutesToTime(rounded);
}

export function normalizeEmergencyTaskStartTime(startTime: string) {
  return minutesToTime(clamp(timeToMinutes(startTime, '07:30'), 7 * 60 + 30, 17 * 60 + 45));
}

export function formatRelativeOffset(minutes: number | null | undefined) {
  const value = minutes || 0;
  if (value === 0) return '+0p';
  const sign = value > 0 ? '+' : '-';
  const absolute = Math.abs(value);
  const hours = Math.floor(absolute / 60);
  const mins = absolute % 60;
  return `${sign}${hours ? `${hours}h` : ''}${mins ? `${mins}p` : ''}`;
}

export const relativeOffsetHourOptions = Array.from({ length: 6 }, (_, index) => index);
export const relativeOffsetMinuteOptions = [0, 5, 15, 30, 45];

export function splitRelativeOffset(minutes: number | null | undefined) {
  const value = minutes || 0;
  const absolute = Math.abs(value);
  return {
    sign: value < 0 ? '-' : '+',
    hours: Math.floor(absolute / 60),
    minutes: absolute % 60
  };
}

export function mergeRelativeOffset(sign: string, hours: number, minutes: number) {
  const value = Math.min(24 * 60, hours * 60 + minutes);
  return sign === '-' ? -value : value;
}

// tz-ok: hien-thi — dinh dang nhan ngay cho nguoi doc
export function dinhDangNgay(value?: string | null) {
  if (!value) return '-';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? taoNgayTuInput(value) : new Date(value);
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

// tz-ok: hien-thi — dinh dang nhan ngay day du cho nguoi doc
export function dinhDangNgayDayDu(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(taoNgayTuInput(value));
}

// tz-ok: ngay-lich-round-trip — cong ngay tren Date da dung san, khong doc dong ho
export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

// tz-ok: ngay-lich-round-trip — thu cua Date da dung san (khong phai "hom nay la thu may")
export function mondayOfWeek(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

// tz-ok: ngay-lich-round-trip — Date này biểu diễn ngày giờ người dùng nhập, không dùng để quyết định "hôm nay".
export function parseLocalDateTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = timeValue.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}
