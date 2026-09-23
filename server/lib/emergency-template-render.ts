// CR-20260913 Lát 6 (FR-30) — render nội dung template cá nhân KHẨN CẤP (bảng
// `emergency_release_templates`, dùng ở FR-23c/FR-28a) khi submit sinh task cá nhân. Token dạng
// `...At` (staging.deployAt/release.deployAt/demo.deployAt) phải đổi giờ VN -> JST ĐÚNG CÁCH khi nội
// dung có tiếng Nhật — không cộng cứng phút, không đoán ngôn ngữ đích từ nội dung mẫu (khác hẳn lỗi thật
// đã xác nhận ở `src/screens/release.tsx:322`: `addMinutes(date, 120)` + `hasJapaneseText(content)`).
//
// Giờ luôn điền ĐỘNG từ dữ liệu đăng ký thật (`team_release_registrations` — deploy_staging_at/
// release_at/deploy_demo_at, xem server/lib/release-schedule.ts), KHÔNG ghi cứng trong mẫu. Locale
// (`vi`/`ja`) được TRUYỀN TƯỜNG MINH bởi caller (route biết template nào actor chọn hiển thị), không tự
// suy ra từ nội dung.
//
// File này thuộc VÙNG QUYẾT ĐỊNH của scripts/check-tz.mjs (khai báo trong VUNG_QUYET_DINH) — mọi phép
// tính giờ ở đây PHẢI qua server/lib/vn-time.ts (vietnamInstant/vietnamParts/japanParts), không được
// dùng `new Date(y,m,d,...)`/`getHours()`/`setHours()` hay tương đương.
import { vietnamInstant, vietnamParts, japanParts } from './vn-time.js';

export type EmergencyTemplateLocale = 'vi' | 'ja';

// 3 mốc thật của 1 registration khẩn cấp — mỗi mốc lưu dạng chuỗi "YYYY-MM-DD HH:mm" (giờ VN, không
// mang theo múi giờ — xem server/lib/release-schedule.ts:parseWallClock/formatWallClock).
export interface EmergencyRegistrationInstants {
  deployStagingAt: string;
  releaseAt: string;
  deployDemoAt: string;
}

const JP_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const VI_WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Tách "YYYY-MM-DD HH:mm" -> (dateKey, time) rồi dựng thời điểm tuyệt đối bằng vietnamInstant() (dữ
// liệu đăng ký LUÔN là giờ VN người dùng nhập — đúng nguồn duy nhất CR yêu cầu, không suy từ nơi khác).
function toInstant(wallClock: string): Date | null {
  const [dateKey, time] = wallClock.split(' ');
  if (!dateKey || !time) return null;
  return vietnamInstant(dateKey, time);
}

function formatDateTime(date: Date, locale: EmergencyTemplateLocale): string {
  if (locale === 'ja') {
    const p = japanParts(date);
    return `${p.year}年${pad2(p.month)}月${pad2(p.day)}日 (${JP_WEEKDAYS[p.weekday]}) ${pad2(p.hour)}:${pad2(p.minute)}`;
  }
  const p = vietnamParts(date);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year} (${VI_WEEKDAYS[p.weekday]}) ${pad2(p.hour)}:${pad2(p.minute)}`;
}

function formatDateOnly(date: Date, locale: EmergencyTemplateLocale): string {
  if (locale === 'ja') {
    const p = japanParts(date);
    return `${p.year}年${pad2(p.month)}月${pad2(p.day)}日 (${JP_WEEKDAYS[p.weekday]})`;
  }
  const p = vietnamParts(date);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year} (${VI_WEEKDAYS[p.weekday]})`;
}

// Dựng map token -> giá trị hiển thị đã đổi múi giờ đúng locale. Token không có nguồn dữ liệu thật
// (`release.previousDate`, `mention`) KHÔNG có mặt trong map — replace() giữ nguyên token gốc, đúng
// hành vi cũ của renderManagedReleaseTemplate() với token lạ.
function buildTokenMap(registration: EmergencyRegistrationInstants, locale: EmergencyTemplateLocale): Record<string, string> {
  const map: Record<string, string> = {};
  const staging = toInstant(registration.deployStagingAt);
  const release = toInstant(registration.releaseAt);
  const demo = toInstant(registration.deployDemoAt);
  if (staging) {
    map['staging.deployAt'] = formatDateTime(staging, locale);
    map['staging.deployDate'] = formatDateOnly(staging, locale);
  }
  if (release) {
    map['release.deployAt'] = formatDateTime(release, locale);
    map['release.deployDate'] = formatDateOnly(release, locale);
    map['release.date'] = formatDateOnly(release, locale);
  }
  if (demo) {
    map['demo.deployAt'] = formatDateTime(demo, locale);
    map['demo.deployDate'] = formatDateOnly(demo, locale);
  }
  return map;
}

// Render nội dung template cá nhân khẩn cấp — thay {{token}} bằng giá trị thật, đúng locale truyền
// vào. Token không resolve được (thiếu dữ liệu, hoặc không thuộc 3 mốc trên — vd `mention`) giữ nguyên
// literal `{{token}}`, giống renderManagedReleaseTemplate().
export function renderEmergencyPersonalTemplate(
  content: string,
  registration: EmergencyRegistrationInstants,
  locale: EmergencyTemplateLocale
): string {
  const tokenMap = buildTokenMap(registration, locale);
  return content.replace(/\{\{([\w.]+)\}\}/g, (match, token: string) => tokenMap[token] ?? match);
}
