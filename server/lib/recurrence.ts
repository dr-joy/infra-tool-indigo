
export type RecurrenceSpec = {
  ngayCuThe?: string | null;                    // yyyy-mm-dd: occurrence một lần, đúng ngày này
  lapLaiKieu?: string | null;
  thuTrongTuan?: number[] | number | string | null;  // 0=CN … 6=T7 (DB lưu dạng "1,2,3")
  ngayTrongThang?: number | null;
};

export type DayContext = {
  dateKey: string;  // yyyy-mm-dd của ngày cần đối chiếu
  day: number;      // ngày trong tháng
  weekday: number;  // 0 = Chủ nhật
};

function weekdayList(value: RecurrenceSpec['thuTrongTuan']): number[] | null {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) return value.map(Number).filter(Number.isInteger);
  if (typeof value === 'number') return [value];
  const list = String(value).split(',').map((v) => Number(v.trim())).filter(Number.isInteger);
  return list.length > 0 ? list : null;
}

// Số ngày thật của tháng chứa `dateKey` (yyyy-mm-dd) — dùng để dồn "hàng tháng ngày 31" về đúng
// ngày cuối cùng có thật của tháng ngắn hơn (QA-2026-09-12, xác nhận với người dùng: tháng 2/4/6/9/11
// không có ngày 29/30/31 thì lặp vào ngày cuối tháng đó, không bỏ qua cả tháng).
// tz-ok: ngay-lich-round-trip, dung Date tu dateKey da co san, khong doc dong ho may
function soNgayCuoiThang(dateKey: string): number {
  const [year, month] = dateKey.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

// Occurrence của task này có rơi vào ngày `ctx` không.
export function recurrenceMatches(spec: RecurrenceSpec, ctx: DayContext): boolean {
  // Ngày cụ thể thắng mọi luật lặp: task một lần (task release sinh theo đợt).
  if (spec.ngayCuThe) return String(spec.ngayCuThe).slice(0, 10) === ctx.dateKey;

  const weekdays = weekdayList(spec.thuTrongTuan);
  if (spec.lapLaiKieu === 'hang_ngay') return true;
  if (spec.lapLaiKieu === 'thu_2_den_thu_6') return ctx.weekday >= 1 && ctx.weekday <= 5;
  if (spec.lapLaiKieu === 'hang_tuan') return weekdays != null && weekdays.includes(ctx.weekday);
  if (spec.lapLaiKieu === 'hang_thang') {
    if (spec.ngayTrongThang == null) return false;
    const ngayApDung = Math.min(spec.ngayTrongThang, soNgayCuoiThang(ctx.dateKey));
    return ctx.day === ngayApDung;
  }
  // Không khai báo kiểu lặp: khớp khi mọi điều kiện đã nêu đều thỏa (không nêu gì = mọi ngày).
  return (spec.ngayTrongThang == null || ctx.day === Math.min(spec.ngayTrongThang, soNgayCuoiThang(ctx.dateKey)))
    && (weekdays == null || weekdays.includes(ctx.weekday));
}
