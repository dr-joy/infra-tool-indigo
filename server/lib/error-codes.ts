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
  },
  SESSION_REQUIRED: {
    status: 401,
    note: 'Chưa đăng nhập hoặc cookie phiên đã hết hạn/bị thu hồi (CR-20260913 FR-4, lớp 1 của authorize)'
  },
  ACCOUNT_DISABLED: {
    status: 403,
    note: 'Tài khoản bị Admin vô hiệu hoá — FE hiện popup yêu cầu xác nhận lại (CR-20260913 FR-4a, lớp 1.5)'
  },
  ACCOUNT_PENDING: {
    status: 403,
    note: 'Tài khoản chưa được Admin duyệt team/vai trò — chỉ được gọi route onboarding (CR-20260913 FR-2/FR-3a)'
  },
  LOGIN_NONCE_INVALID: {
    status: 400,
    note: 'Cookie login_nonce thiếu/hết hạn lúc /auth/callback — vá lỗ hổng login-CSRF thật (CR-20260913 FR-1)'
  },
  AUTH_CALLBACK_INVALID: {
    status: 400,
    note: 'Thiếu access_token/refresh_token trên query /auth/callback — flow "legacy" thật của auth.drjoy.vn (đổi 25/09 từ flow "code" giả định ban đầu, xem docs/exchanges/2026-09-25.md)'
  },
  JOIN_REQUEST_PENDING_EXISTS: {
    status: 409,
    note: 'User đã có 1 đơn xin tham gia team đang chờ duyệt (unique index (user_id) WHERE status=pending)'
  },
  JOIN_REQUEST_STALE: {
    status: 409,
    note: 'Đơn xin tham gia team đã được xử lý hoặc bị người khác duyệt/từ chối trước (row_version lệch)'
  },
  TEAM_ALREADY_HAS_LEADER: {
    status: 409,
    note: 'Duyệt đơn với role=leader nhưng team đó đã có Leader — tối đa 1 Leader/team (CR-20260913 FR-6)'
  },
  FEATURE_DISABLED: {
    status: 403,
    note: 'team_feature_visibility(teamId, feature) đang off (CR-20260913 FR-7/§6.2 tầng 2) — dùng ở authorize() policyKind=team_feature, VÀ ở assertTeamFeatureOn() (server/lib/authorize.ts, Council review vòng 2 Lát 6) cho 2 route sinh task cá nhân từ Release cần lọc riêng đúng 1 teamId cụ thể'
  },
  NOT_TEAM_MEMBER: {
    status: 403,
    note: 'authorize() policyKind=team_feature: actor không phải thành viên team đích (CR-20260913 §6.2 tầng 2)'
  },
  ROLE_FORBIDDEN: {
    status: 403,
    note: 'authorize(): vai trò (team leader/member, hoặc system_role cho route toàn cục) không nằm trong AUTHORIZATION_POLICY[resource][action] (CR-20260913 FR-8/§6.2 tầng 3)'
  },
  NOT_RELEASE_COORDINATOR: {
    status: 403,
    note: 'authorize() resource=release_coordinator: actor không phải Leader hiệu lực của team đang là app_config.release_coordinator_team_id (CR-20260913 FR-9/§6.2 tầng 4) — dành riêng cho Lát 6, chưa có route Lát 3 nào gọi'
  },
  VERSION_CONFLICT: {
    status: 409,
    note: 'Optimistic concurrency chung cho bảng nền Lát 3 (teams/users/join_requests/team_feature_visibility/app_config): UPDATE ... WHERE row_version=? không khớp dòng nào'
  },
  REGISTRATION_LOCKED: {
    status: 409,
    note: 'CR-20260913 Lát 6 (FR-26): team_release_registrations.status=locked — sửa/huỷ trực tiếp bị chặn, phải qua release_unlock_requests; hoặc cycle đang locked_at chặn tạo đăng ký MỚI cho team chưa từng có mặt'
  },
  UNLOCK_REQUEST_STALE: {
    status: 409,
    note: 'CR-20260913 Lát 6 (FR-26/FR-27): yêu cầu mở khoá/huỷ đã được duyệt/từ chối bởi người khác trước đó (UPDATE ... WHERE status=pending không khớp dòng nào)'
  },
  RELEASE_REGISTRATION_EXISTS: {
    status: 409,
    note: 'CR-20260913 Lát 6 (FR-23a/FR-25): team đã có đăng ký lịch khẩn cấp cho đúng cycle đó (UNIQUE (cycle_id, team_id))'
  },
  REGULAR_CYCLE_NOT_FOUND: {
    status: 404,
    note: 'CR-20260913 Lát 6 (FR-28a nhánh Định kỳ): cycleId gửi lên không khớp release_cycles kind=regular status=open nào — chọn lại đợt, không tự đoán'
  },
  LAST_ADMIN: {
    status: 409,
    note: 'Hạ quyền (POST /admin/users/:id/demote-admin) hoặc khoá (POST /admin/users/:id/disable) Admin cuối cùng còn active — chặn cứng, phải gán thêm Admin khác trước (docs/exchanges/2026-09-25.md)'
  }
};
