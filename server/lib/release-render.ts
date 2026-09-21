
import { normalizeTaskLinks, parseTaskLinks, toMinutes, toTime } from './utils.js';

// ── Lịch thuần (không đọc đồng hồ máy) ─────────────────────────────────────────
// Các hàm dưới dựng Date CHỈ từ chuỗi yyyy-mm-dd do người dùng chọn (ngày release), không
// đọc `new Date()`/giờ hiện tại — nên không thuộc "quyết định theo giờ" của check-tz.mjs
// (file này không nằm trong VUNG_QUYET_DINH). Y hệt cách schedules.ts tự đánh dấu
// `tz-ok: ngay-lich-round-trip` cho cùng một loại phép lịch.

function taoNgayTuInput(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

function mondayOfWeek(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function localDateInputValue(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function tinhNgayRelease(releaseDate: string) {
  const release = taoNgayTuInput(releaseDate);
  const stagingMonday = mondayOfWeek(release);
  const demoMonday = addDays(stagingMonday, 7);
  const developMonday = addDays(stagingMonday, -7);
  const jackMonday = addDays(stagingMonday, -14);

  return {
    release, stagingMonday, demoMonday, jackFriday: addDays(jackMonday, 4),
    developThursday: addDays(developMonday, 3), developFriday: addDays(developMonday, 4),
    jackMonday, developMonday, demoTuesday: addDays(demoMonday, 1),
    demoFriday: addDays(demoMonday, 4), afterDemoMonday: addDays(demoMonday, 7)
  };
}

// Port nguyên xi từ src/screens/release.tsx — đổi một trong hai chỗ mà quên chỗ kia là
// đúng lớp lỗi CR này đang diệt, nên chỉ còn một bản duy nhất ở đây.
export function releaseTokenDateMap(releaseDate: string): Record<string, Date> {
  const dates = tinhNgayRelease(releaseDate);
  return {
    'jack.monday': dates.jackMonday,
    'jack.tuesday': addDays(dates.jackMonday, 1),
    'jack.wednesday': addDays(dates.jackMonday, 2),
    'jack.thursday': addDays(dates.jackMonday, 3),
    'jack.friday': dates.jackFriday,
    'develop.monday': dates.developMonday,
    'develop.tuesday': addDays(dates.developMonday, 1),
    'develop.wednesday': addDays(dates.developMonday, 2),
    'develop.thursday': dates.developThursday,
    'develop.friday': dates.developFriday,
    'staging.monday': dates.stagingMonday,
    'staging.tuesday': addDays(dates.stagingMonday, 1),
    'staging.wednesday': addDays(dates.stagingMonday, 2),
    'staging.thursday': addDays(dates.stagingMonday, 3),
    'staging.friday': dates.release,
    'release.date': dates.release,
    'demo.monday': dates.demoMonday,
    'demo.tuesday': dates.demoTuesday,
    'demo.wednesday': addDays(dates.demoMonday, 2),
    'demo.thursday': addDays(dates.demoMonday, 3),
    'demo.friday': dates.demoFriday,
    'afterDemo.monday': dates.afterDemoMonday
  };
}

function hasJapaneseText(content: string): boolean {
  return /[぀-ヿ]/.test(content);
}

function formatVNDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function formatVNTemplateDate(date: Date): string {
  const weekday = new Intl.DateTimeFormat('vi-VN', { weekday: 'long' }).format(date);
  const normalizedWeekday = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`;
  return `${formatVNDate(date)} (${normalizedWeekday})`;
}

function formatJPDate(date: Date): string {
  const weekdaysJP = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日 (${weekdaysJP[date.getDay()]})`;
}

function formatTemplateDate(date: Date, content: string): string {
  return hasJapaneseText(content) ? formatJPDate(date) : formatVNTemplateDate(date);
}

// Port nguyên xi từ src/screens/release.tsx (renderManagedReleaseTemplate).
export function renderManagedReleaseTemplate(content: string, releaseDate: string): string {
  const dateMap = releaseTokenDateMap(releaseDate);
  return content.replace(/\{\{([\w.]+)\}\}/g, (match, token: string) => {
    const date = dateMap[token];
    return date ? formatTemplateDate(date, content) : match;
  });
}

function releaseTokenWeekKey(token: string): string {
  if (token === 'release.date') return 'staging';
  return token.split('.')[0] || 'demo';
}

function releaseTokenDayOrder(token: string): number {
  const day = token.split('.')[1];
  const order: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, date: 5 };
  return order[day] || 99;
}

function releaseTokenSortValue(token: string): number {
  const weekOrder: Record<string, number> = { jack: 1, develop: 2, staging: 3, demo: 4, afterDemo: 5 };
  return (weekOrder[releaseTokenWeekKey(token)] || 99) * 10 + releaseTokenDayOrder(token);
}

// Port nguyên xi (compareReleaseTaskDefinitions) — dùng để sắp thứ tự ổn định khi liệt kê lệch.
// Nhận thẳng shape hàng DB (snake_case) vì đây là bản backend, không phải bản FE camelCase trong
// src/screens/release.tsx (2 bản riêng theo đúng thiết kế "định nghĩa ở phía nào dùng shape phía đó").
export function compareReleaseTaskDefinitions(
  a: { date_token: string; start_time: string; title: string },
  b: { date_token: string; start_time: string; title: string }
): number {
  const dateDiff = releaseTokenSortValue(a.date_token) - releaseTokenSortValue(b.date_token);
  if (dateDiff !== 0) return dateDiff;
  const timeDiff = toMinutes(a.start_time || '00:00') - toMinutes(b.start_time || '00:00');
  if (timeDiff !== 0) return timeDiff;
  return a.title.localeCompare(b.title);
}

// ── Dựng nội dung "đích" từ definition (FR-10: backend tự dựng, FE không còn tự dựng) ──

export interface ReleaseTaskDefinitionRow {
  id: string;
  title: string;
  start_time: string;
  date_token: string;
  template_id: string | null;
  task_links: unknown;
  reply_to_definition_id: string | null;
}

export interface DefinitionTargetPayload {
  tenTask: string;
  // null = definition không có template -> KHÔNG có nội dung để ghi đè Note (FR-4/AC-4).
  // '' (chuỗi rỗng) = có template nhưng render ra rỗng (AC-4b) -> vẫn là kết quả cần ghi.
  ghiChu: string | null;
  gioBatDau: string;
  gioKetThuc: string;
  ngayCuThe: string;
  linksJson: string;
  replyToRef: string | null;
}

// Giờ regular release luôn kẹp trong khung hành chính [07:30, 17:45] (giữ đúng luật sinh
// task cũ ở schedules.ts) — 15 phút/task.
function clampRegularStart(rawStart: number): number {
  return Math.min(17 * 60 + 45, Math.max(7 * 60 + 30, rawStart));
}

export function buildDefinitionTargetPayload(
  definition: ReleaseTaskDefinitionRow,
  releaseDate: string,
  templateContent: string | null
): DefinitionTargetPayload {
  const dateMap = releaseTokenDateMap(releaseDate);
  const date = dateMap[definition.date_token] || dateMap['release.date'];
  // `templateContent === null` -> không có template_id, HOẶC có template_id nhưng không tìm thấy
  // template (đã xoá). Cả hai case đều "không có gì để dựng" -> ghiChu = null (FR-4/AC-4).
  // `templateContent === ''` -> CÓ template, nội dung của nó rỗng -> vẫn là kết quả hợp lệ để ghi
  // (AC-4b) — khác hẳn "không có template", không được gộp chung bằng cách coi chuỗi rỗng là falsy.
  const hasTemplate = Boolean(definition.template_id) && templateContent !== null;
  const ghiChu = hasTemplate ? renderManagedReleaseTemplate(templateContent as string, releaseDate) : null;
  const start = clampRegularStart(toMinutes(definition.start_time));
  const links = normalizeTaskLinks(parseTaskLinks(definition.task_links));
  return {
    tenTask: definition.title,
    ghiChu,
    gioBatDau: toTime(start),
    gioKetThuc: toTime(start + 15),
    ngayCuThe: localDateInputValue(date),
    linksJson: JSON.stringify(links),
    replyToRef: definition.reply_to_definition_id || null
  };
}

// Chuẩn hoá trước khi so — không false-positive vì khác cách render xuống dòng (Codex §14 P1 #2).
function normalizeForCompare(value: string): string {
  return value.trim().replace(/\r\n/g, '\n');
}

export interface TaskRowForDiff {
  ten_task: unknown;
  ghi_chu: unknown;
  gio_bat_dau: unknown;
  ngay_cu_the: unknown;
  task_links: unknown;
  reply_to_ref: unknown;
}

export function diffTaskAgainstDefinition(task: TaskRowForDiff, target: DefinitionTargetPayload): string[] {
  const changed: string[] = [];
  if (normalizeForCompare(String(task.ten_task || '')) !== normalizeForCompare(target.tenTask)) changed.push('tenTask');
  if (target.ghiChu !== null && normalizeForCompare(String(task.ghi_chu || '')) !== normalizeForCompare(target.ghiChu)) {
    changed.push('ghiChu');
  }
  if ((task.gio_bat_dau == null ? '' : String(task.gio_bat_dau)) !== target.gioBatDau) changed.push('gioBatDau');
  if ((task.ngay_cu_the == null ? '' : String(task.ngay_cu_the)) !== target.ngayCuThe) changed.push('ngayCuThe');
  const oldLinksJson = JSON.stringify(normalizeTaskLinks(parseTaskLinks(task.task_links)));
  if (oldLinksJson !== target.linksJson) changed.push('links');
  if ((task.reply_to_ref == null ? null : String(task.reply_to_ref)) !== target.replyToRef) changed.push('replyToRef');
  return changed;
}

// FR-4/FR-8: dựng câu UPDATE ĐỘNG theo field cần đổi — cột `ghi_chu` chỉ xuất hiện trong
// SET khi definition CÓ template (target.ghiChu !== null). Không set cột nghĩa là KHÔNG
// đụng giá trị hiện tại trong DB -> tự động an toàn trước race "user sửa Note giữa preview
// và apply" (AC-10) vì không có bước đọc-rồi-ghi-lại giá trị cũ nào cả.
export function buildReleaseUpdateStatement(
  target: DefinitionTargetPayload,
  taskId: number
): { sql: string; params: (string | number | null)[]; columns: string[] } {
  const columns: [string, string | null][] = [
    ['ten_task', target.tenTask],
    ...(target.ghiChu !== null ? ([['ghi_chu', target.ghiChu]] as [string, string | null][]) : []),
    ['gio_bat_dau', target.gioBatDau],
    ['gio_ket_thuc', target.gioKetThuc],
    ['ngay_cu_the', target.ngayCuThe],
    ['task_links', target.linksJson],
    ['reply_to_ref', target.replyToRef]
  ];
  const sql = `UPDATE tasks SET ${columns.map(([col]) => `${col} = ?`).join(', ')} WHERE id = ?`;
  return { sql, params: [...columns.map(([, value]) => value), taskId], columns: columns.map(([col]) => col) };
}
