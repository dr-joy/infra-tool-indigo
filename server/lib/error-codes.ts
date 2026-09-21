// Registry mã lỗi máy-đọc-được (BL-20260913-005, CR-20260913-c).
//
// Kiểm kê 2026-09-13: toàn bộ `server/routes/*` chỉ có 6 mã lỗi machine-readable thật (`code` trong
// JSON response hoặc tham số thứ 3 của `HttpError`) — phần lớn lỗi khác chỉ có `message` tiếng Việt,
// không có code, và KHÔNG cần thêm code chỉ để cho đủ (out of scope: không bắt gắn code cho lỗi cũ).
//
// Namespace: mã theo đúng quy ước ĐÃ CÓ tự nhiên trong 6 mã dưới — `<NGỮ_CẢNH>_<LÝ_DO>` viết hoa,
// gạch dưới. Route MỚI thêm mã mới thì đặt tên theo đúng mẫu này rồi đăng ký ở đây; cổng
// `scripts/check-error-codes.mjs` chỉ chặn mã MỚI chưa đăng ký — không bắt sửa 6 mã cũ.
export interface ErrorCodeEntry {
  /** HTTP status đi kèm mã này trong response thật. */
  status: number;
  /** Khi nào dùng — 1 câu, để người thêm route mới biết có nên tái dùng hay tạo mã khác. */
  note: string;
}

export const ERROR_CODE_REGISTRY: Record<string, ErrorCodeEntry> = {
  GOAL_CONFLICT: {
    status: 409,
    note: 'Đổi ngày dự kiến của task ra khỏi tuần đang là mục tiêu (weekly goal), chưa xác nhận confirmRemoveGoal'
  },
  REGULAR_RELEASE_EXISTS: {
    status: 409,
    note: 'Release định kỳ của tháng đó đã sinh task, chưa xác nhận force để tạo lại'
  },
  EMERGENCY_RELEASE_EXISTS: {
    status: 409,
    note: 'Release khẩn cấp theo key đó đã sinh task, chưa xác nhận force/replace'
  },
  EMERGENCY_BATCH_TEAMS_MISMATCH: {
    status: 409,
    note: 'Team/hệ thống submit lên lệch với batch đã lưu cho release khẩn cấp đó'
  },
  REPORT_EXISTS: {
    status: 409,
    note: 'Báo cáo tuần (weekStart + kind + mode) đã tồn tại, chưa xác nhận ghi đè'
  }
};
