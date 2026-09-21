// Tiện ích ngày thuần (tuần = Thứ 2 → Chủ nhật, theo giờ máy), dùng chung nhiều tính năng backend.
// Tách khỏi server/lib/weekly-report.ts (kế hoạch Council run 022dd1e5, xem
// docs/exchanges/2026-09-12.md) — trước đây server/routes/projects.ts phải import các hàm này từ
// lib riêng của tính năng Báo cáo tuần dù không liên quan, nay có shared lib đúng nghĩa.
//
// KHÔNG dùng cho quyết định nghiệp vụ theo giờ VN (xem server/lib/vn-time.ts cho việc đó) — các
// hàm ở đây thao tác thuần trên chuỗi ngày ISO đã có sẵn, không đọc giờ hệ thống hiện tại.

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function mondayOf(iso: string): string {
  const d = parseISO(iso);
  const day = d.getDay(); // 0=CN..6=T7
  const diff = day === 0 ? -6 : 1 - day; // về thứ 2
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

// Khoảng ngày dự kiến của task có giao với tuần [weekStart, weekEnd] không —
// điều kiện bắt buộc để task được làm mục tiêu tuần.
export function taskOverlapsWeek(planStart: string, planEnd: string, weekStart: string, weekEnd: string): boolean {
  return planStart <= weekEnd && planEnd >= weekStart;
}
