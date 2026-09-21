import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'node:crypto';
import { type TaskLink, validTaskLinkTypes, maxTaskLinks, validReleaseTemplateTokens } from '../types.js';

// Bọc route async: mọi promise reject được forward về error middleware trung tâm
// (thay vì mỗi route tự try/catch). Nhờ đó HttpError ném ở bất kỳ đâu vẫn ra đúng status.
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { fn(req, res, next).catch(next); };
}

// Lỗi có chủ đích kèm HTTP status (validation, conflict...). Phân biệt với lỗi
// không lường trước (DB/bug) để không trả raw message ra client.
export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

// Dùng trong catch của route: HttpError -> trả đúng status + message (an toàn);
// lỗi khác -> log server-side, trả 500 với message generic (không lộ stack/SQL).
export function sendRouteError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof HttpError) {
    const body: { message: string; code?: string } = { message: error.message };
    if (error.code) body.code = error.code;
    return res.status(error.status).json(body);
  }
  console.error('[route-error]', error);
  return res.status(500).json({ message: fallbackMessage });
}

export function toMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function toTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function localDateInputValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

export function vietnamDateInputValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return [
    get('year'),
    String(get('month')).padStart(2, '0'),
    String(get('day')).padStart(2, '0')
  ].join('-');
}

function currentVietnamDate() {
  const [year, month, day] = vietnamDateInputValue().split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function normalizeTaskLinks(value: unknown): TaskLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const raw = item as Partial<TaskLink>;
      const type = raw.type;
      const url = String(raw.url || '').trim();
      if (!type || !validTaskLinkTypes.has(type) || !url) return null;
      if (!/^(https?|slack|zoommtg|file|vscode):\/\//i.test(url)) return null;
      return { type, url };
    })
    .filter((item): item is TaskLink => Boolean(item))
    .slice(0, maxTaskLinks);
}

export function parseTaskLinks(value: unknown): TaskLink[] {
  if (!value) return [];
  try {
    return normalizeTaskLinks(JSON.parse(String(value)));
  } catch {
    return [];
  }
}

export function parseDateParam(value: unknown) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return currentVietnamDate();
  const [year, month, day] = raw.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function isDateInput(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isTimeInput(value: unknown): value is string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);
}

// Parse id từ params/body -> số nguyên, hoặc null nếu không hợp lệ.
export function parseIntId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

// Parse mảng id (cho reorder) -> mảng số nguyên, hoặc null nếu có phần tử không hợp lệ.
export function parseIdList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map(Number);
  return ids.some((id) => !Number.isInteger(id)) ? null : ids;
}

export function isDateRangeValid(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return true;
  return end >= start;
}

export function parseProjectEstimateHours(value: unknown) {
  if (value == null || value === '') return null;
  const estimateHours = Number(value);
  return Number.isFinite(estimateHours) ? estimateHours : Number.NaN;
}

export function parseTaskDateValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

export function isSameLocalDate(value: string | null | undefined, date = new Date()) {
  if (!value) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value === localDateInputValue(date);
  return vietnamDateInputValue(parseTaskDateValue(value)) === localDateInputValue(date);
}

export function invalidTemplateTokens(content: string, validTokens = validReleaseTemplateTokens) {
  const tokens = [...content.matchAll(/\{\{([\w.]+)\}\}/g)].map((match) => match[1]);
  return tokens.filter((token) => !validTokens.has(token));
}

export function sanitizeReleaseTemplateContent(content: string) {
  return content
    .split(/\r?\n/)
    .filter((line) => !line.includes('Related Release Ticket'))
    .filter((line) => !(line.includes('{{') && line.includes('ticket')))
    .join('\n')
    .trim();
}

// CR-20260822 (Announcement release khẩn cấp nhiều team) FR-3: task giai đoạn 1 (E1-E5, hotfix/immediate)
// và task giai đoạn 2 (E6-E22, release_deploy/relative — gồm cả Announcement E6/E7) của CÙNG 1 đợt khẩn
// cấp có `release_month` KHÁC NHAU theo chuỗi — giai đoạn 2 luôn có hậu tố `:schedule`
// (`src/screens/release.tsx:2327`: `releaseKey: \`${pendingReleaseKey}:schedule\``). `emergency_release_batches`
// lưu theo khoá GỐC (giai đoạn 1) nên mọi nơi cần "task này thuộc batch nào" (PATCH guard, tra kết quả E3
// từ E6/E7, renderer đọc teams/systems) PHẢI chuẩn hoá về khoá gốc bằng hàm này, không so `release_month`
// trần — nếu không, task giai đoạn 2 sẽ không bao giờ khớp đúng batch đã tạo ở giai đoạn 1.
export function emergencyBatchKeyOf(releaseMonth: string | null | undefined): string | null {
  if (!releaseMonth) return null;
  return releaseMonth.endsWith(':schedule') ? releaseMonth.slice(0, -':schedule'.length) : releaseMonth;
}

// CR-20260822 FR-2 (giải quyết Codex §4.49 High #3): task release khẩn cấp KHÔNG có nguồn re-render
// server-side (khác regular release — nội dung dựng CLIENT-SIDE từ token ngày/giờ thật của batch, xem
// `renderEmergencyReleaseTemplate`/`renderEmergencyReleaseScheduleTemplate` ở src/screens/release.tsx).
// Không thể so lệch bằng cách re-render lại — nhưng VẪN cần phát hiện "definition đổi `note`/`template_id`/
// nội dung template kể từ lúc task được sinh" mà không cần dựng lại text thật. Giải pháp NHẸ: hash
// (note, template_id, nội dung template) — dùng làm (a) "revision" server trả về khi FE tải definition
// (FE mang theo lúc POST task — chống TOCTOU, Codex §4.51), và (b) snapshot lưu trên task lúc sinh, so
// lại với hash MỚI tính từ definition/template HIỆN TẠI ở đúng thời điểm precheck.
// Nghiêm ngặt hoá serialize (Codex §4.51): dùng `JSON.stringify` thay vì nối chuỗi bằng dấu `|` — dữ liệu
// hợp lệ (note/nội dung template) HOÀN TOÀN có thể chứa `|`, nối chuỗi thô có thể sinh 2 tổ hợp field
// khác nhau ra CÙNG 1 chuỗi input cho hash (vd note="a|b", templateId=null trùng note="a", templateId="b").
export function hashEmergencyDefinitionSnapshot(
  note: string | null | undefined, templateId: string | null | undefined, templateContent: string | null | undefined
): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([note ?? '', templateId ?? '', templateContent ?? '']))
    .digest('hex');
}
