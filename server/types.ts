export type LoaiTask = 'don_le' | 'dinh_ky';
export type TrangThai = 'chua_thuc_hien' | 'dang_tien_hanh' | 'da_hoan_thanh' | 'canceled';
export type TaskLinkType = 'chat' | 'file' | 'git' | 'release' | 'zoom';

export type EmergencyTimingToken = 'before_hotfix' | 'hotfix' | 'after_hotfix' | 'staging_deploy' | 'release_deploy' | 'demo_deploy';

export interface TaskLink {
  type: TaskLinkType;
  url: string;
}

export interface TaoTaskBody {
  tenTask: string;
  ghiChu?: string;
  links?: TaskLink[];
  loaiTask: LoaiTask;
  thucHienNgay?: boolean;
  gioBatDau?: string;
  gioKetThuc?: string;
  lapLaiKieu?: 'hang_ngay' | 'thu_2_den_thu_6' | 'hang_tuan' | 'hang_thang';
  ngayTrongThang?: number | null;
  thuTrongTuan?: number | number[] | null;
  ngayCuThe?: string | null;
}

export interface CapNhatTaskBody {
  tenTask: string;
  ghiChu?: string;
  links?: TaskLink[];
  gioBatDau?: string;
  gioKetThuc?: string;
  lapLaiKieu?: 'hang_ngay' | 'thu_2_den_thu_6' | 'hang_tuan' | 'hang_thang';
  ngayTrongThang?: number | null;
  thuTrongTuan?: number | number[] | null;
  updateRelated?: boolean;
}

export interface CapNhatLichBody {
  gioBatDau?: string;
  gioKetThuc?: string;
}

export interface ReleaseTaskPayload {
  tenTask?: string;
  ghiChu?: string;
  links?: TaskLink[];
  ngayCuThe?: string;
  gioBatDau?: string;
  // originRef = id definition sinh ra task này. Carry xuống task để map comment<->post bền vững.
  // Council thiết kế run 7fd3e4d1 (xem docs/exchanges/2026-09-12.md): KHÔNG còn field `replyToRef`
  // trong payload — backend LUÔN tự tra `reply_to_definition_id` từ definition (qua originRef) khi
  // ghi task, không tin giá trị FE gửi (từng là lỗ hổng toàn vẹn dữ liệu thật: FE có thể gửi giá trị
  // cũ/giả, backend trước đây ghi thẳng xuống DB không đối chiếu).
  originRef?: string | null;
  // CR-20260822 FR-2 (Codex §4.51 High — chống TOCTOU): revisionHash của definition TẠI THỜI ĐIỂM FE tải
  // để render task này (từ `GET /release/emergency/task-definitions`). CHỈ route emergency-release/tasks
  // đọc field này — bắt buộc khi có `originRef`, reject nếu khác revision LIVE lúc submit.
  definitionRevision?: string | null;
}

export interface TaoReleaseTasksBody {
  releaseDate?: string;
  releaseKey?: string;
  force?: boolean;
  replaceMatching?: boolean;
  tasks?: ReleaseTaskPayload[];
  // CR-20260822 FR-3 (Announcement release khẩn cấp nhiều team): bắt buộc CHỈ khi gọi từ giai đoạn 1
  // của route emergency-release/tasks (releaseKey KHÔNG có hậu tố `:schedule`) — nguồn canonical team/
  // hệ thống của cả đợt, ghi vào `emergency_release_batches`. Route regular-release/tasks không dùng.
  teams?: string[];
  systems?: string[];
}

// CR-20260814 FR-10: BE tự đọc definition + template rồi tự dựng nội dung — FE chỉ còn báo
// "definition nào, cho ngày release nào", không còn tự dựng payload rồi gửi lên (AC-13).
export interface TaoMotReleaseTaskBody {
  releaseDate?: string;
  definitionId?: string;
}

// Sync lại definition -> task đã sinh trong 1 đợt (không phá): match theo (release_month, origin_ref).
// CR-20260814 FR-10: BE tự load definitions + templates theo releaseMonth, không nhận payload FE
// resolve sẵn nữa. `originRefs` lọc theo definition cụ thể (tuỳ chọn); rỗng/thiếu = toàn bộ đợt.
export interface ReleaseSyncBody {
  releaseMonth?: string;
  originRefs?: string[];
}

export interface ReleaseTemplateBody {
  id?: string;
  name?: string;
  content?: string;
}

export interface ReleaseTaskDefinitionBody {
  id?: string;
  title?: string;
  note?: string;
  startTime?: string;
  dateToken?: string;
  templateId?: string | null;
  links?: TaskLink[];
  sortOrder?: number;
  replyToDefinitionId?: string | null;
}

export interface EmergencyReleaseTaskDefinitionBody {
  id?: string;
  title?: string;
  note?: string;
  timingToken?: string;
  startTime?: string;
  immediatePriority?: number | null;
  relativeOffsetMinutes?: number | null;
  scheduleMode?: 'after_schedule' | 'custom' | null;
  templateId?: string | null;
  links?: TaskLink[];
  sortOrder?: number;
  replyToDefinitionId?: string | null;
}

// CR-20260913 Lát 4 (§6.3, FR-15): `pic` (chuỗi tự do) đã bỏ hẳn khỏi route — bắt buộc chọn
// `responsibleUserId` (User thật). `teamId` bắt buộc khi tạo mới (route tự suy qua authorize(),
// không tin client — xem server/routes/projects.ts).
export interface ProjectBody {
  ten?: string;
  responsibleUserId?: number | string | null;
  teamId?: number | string;
  ngayBatDau?: string;
  rowVersion?: number;
}

// Một giai đoạn phân công của task lá: 1 User thật làm từ startDate → endDate (CR §6.3 Lát 4 — đổi
// từ `pic` chuỗi tự do sang `userId`).
export interface ProjectTaskAssignmentInput {
  userId?: number | string;
  startDate?: string;
  endDate?: string;
  estimateHours?: number | string | null;
}

export interface ProjectTaskAssignmentsBody {
  assignments?: ProjectTaskAssignmentInput[];
  // row_version của project_tasks đọc lúc mở popup (FR-16 vòng làm rõ 18 — khoá theo cả danh sách,
  // không phải theo từng dòng phân công riêng lẻ).
  rowVersion?: number;
}

export interface ProjectTaskBody {
  parentId?: string | number | null;
  tieuDe?: string;
  ghiChu?: string;
  links?: TaskLink[];
  ngayBatDauDuKien?: string;
  ngayKetThucDuKien?: string;
  estimateHours?: number | string | null;
  tienDo?: number;
  // CR-20260913 Lát 4 (FR-15, vòng làm rõ 19/09 lần 20): route ngừng nhận `assignee` — ô chữ tự do đã
  // bỏ hẳn, người phụ trách chỉ đi qua `assignments` (kể cả 1 người). Field giữ lại trong type CHỈ để
  // không phá interface cũ đang được tham chiếu ở nơi khác — route KHÔNG đọc field này nữa.
  assignee?: string | null;
  // Xác nhận gỡ task khỏi mục tiêu tuần khi ngày dự kiến mới không còn thuộc tuần đó
  confirmRemoveGoal?: boolean;
  // Giai đoạn phân công (task lá). undefined = không đụng tới; [] = xóa hết giai đoạn.
  assignments?: ProjectTaskAssignmentInput[];
  rowVersion?: number;
}


export const validEmergencyTimingTokens = new Set<EmergencyTimingToken>(['before_hotfix', 'hotfix', 'after_hotfix', 'staging_deploy', 'release_deploy', 'demo_deploy']);
export const relativeEmergencyTimingTokens = new Set<EmergencyTimingToken>(['staging_deploy', 'release_deploy', 'demo_deploy']);
export const validTaskLinkTypes = new Set<TaskLinkType>(['chat', 'file', 'git', 'release', 'zoom']);

// Cho phép nhập % tự do (0–100); UI chọn theo bước 10.
export const isValidProjectTaskProgress = (n: number) => Number.isInteger(n) && n >= 0 && n <= 100;
export const maxTaskLinks = 4;

export const validReleaseTemplateTokens = new Set([
  'jack.monday', 'jack.tuesday', 'jack.wednesday', 'jack.thursday', 'jack.friday',
  'develop.monday', 'develop.tuesday', 'develop.wednesday', 'develop.thursday', 'develop.friday',
  'staging.monday', 'staging.tuesday', 'staging.wednesday', 'staging.thursday', 'staging.friday',
  'release.date',
  'demo.monday', 'demo.tuesday', 'demo.wednesday', 'demo.thursday', 'demo.friday',
  'afterDemo.monday'
]);

// ── Luyện đề thi ────────────────────────────────────────────────────────────────
export type DeThiLoaiCauHoi = 'single' | 'multi';

export interface DeThiDapAnImport {
  noiDungEn: string;
  noiDungVi?: string;
  laDapAnDung?: boolean;
}

export interface DeThiCauHoiImport {
  loai?: DeThiLoaiCauHoi;
  noiDungEn: string;
  noiDungVi?: string;
  giaiThichEn?: string;
  giaiThichVi?: string;
  chuDe?: string;
  doKho?: string;
  dapAn: DeThiDapAnImport[];
}

export interface DeThiKyThiBody {
  nhom?: string;
  ten?: string;
  ghiChu?: string;
  // Cấu hình thi thử chuẩn của chứng chỉ (vd SAA-C03: 65 câu / 130 phút). null = chưa đặt.
  examSoCau?: number | null;
  examThoiGianPhut?: number | null;
}

export interface DeThiImportBody {
  kyThiId?: number | null;
  ten?: string;
  nguon?: string;
  ghiChu?: string;
  fileName?: string;   // tên file gốc đã import (để chặn import trùng tên)
  passPercent?: number | null;
  durationSeconds?: number | null;
  cauHoi?: DeThiCauHoiImport[];
}

export interface DeThiCapNhatCauHoiBody {
  noiDungVi?: string;
  giaiThichVi?: string;
  chuDe?: string;
  doKho?: string;
  // Đánh dấu bản dịch đã sửa tay (để "Dịch lại" không ghi đè)
  dichThuCong?: boolean;
  dapAnVi?: { id: number; noiDungVi: string }[];
}

export interface DeThiLuuPhienBody {
  boId?: number | null;
  cheDo?: string;
  thoiGianGiay?: number;
  cauHinh?: Record<string, unknown>;
  traLoi?: { cauHoiId: number; dapAnChon: number[]; dungSai: boolean }[];
}

export interface DeThiDichBody {
  // Danh sách id câu hỏi cần dịch (bỏ qua câu đã dịch tay).
  cauHoiIds?: number[];
}

export const validEmergencyReleaseTemplateTokens = new Set([
  'release.date', 'release.previousDate',
  'staging.deployDate', 'staging.deployAt',
  'release.deployDate', 'release.deployAt',
  'demo.deployDate', 'demo.deployAt',
  // CR-20260819: token thay danh sách người mention (đã nối "A, B, C") lúc tạo task giai đoạn 1.
  'mention'
]);
