// Domain types dùng chung cho toàn bộ frontend.
// Các enum/union cốt lõi (LoaiTask, TrangThai, TaskLinkType,
// EmergencyTimingToken, TaskLink) được RE-EXPORT nguyên bản từ server/types.ts để
// client & server dùng chung MỘT nguồn — sửa một nơi, không lệch định nghĩa.
// (import type nên không kéo runtime của server vào bundle client.)
export type {
  LoaiTask,
  TrangThai,
  TaskLinkType,
  EmergencyTimingToken,
  TaskLink
} from '../server/types';

import type { EmergencyTimingToken, TaskLink, TaskLinkType, LoaiTask, TrangThai } from '../server/types';

export type TruongSort = 'ngayTao' | 'ngayHoanThanh';
export type HuongSort = 'asc' | 'desc';
export type TabChinh = 'task_ca_nhan' | 'project' | 'len_lich' | 'bao_cao_tuan' | 'quan_ly_pic' | 'so_do' | 'admin' | 'quan_ly_team';
export type ReleaseType = 'dinh_ky' | 'khan_cap';

export interface ReleaseTemplateItem {
  id: string;
  name: string;
  content: string;
}

export interface ReleaseTaskDefinition {
  id: string;
  title: string;
  note: string;
  startTime: string;
  dateToken: string;
  templateId: string;
  links: TaskLink[];
  sortOrder: number;
  replyToDefinitionId?: string | null;
}

export interface EmergencyReleaseTaskDefinition {
  id: string;
  title: string;
  note: string;
  timingToken: EmergencyTimingToken;
  startTime: string;
  immediatePriority: number | null;
  relativeOffsetMinutes: number | null;
  scheduleMode?: 'after_schedule' | 'custom' | null;
  templateId: string;
  links: TaskLink[];
  sortOrder: number;
  replyToDefinitionId?: string | null;
  // CR-20260822 FR-2 (Codex §4.51 High — chống TOCTOU): hash(note, template_id, nội dung template) tại
  // thời điểm server trả definition này. Phải mang nguyên giá trị này vào `definitionRevision` của task khi
  // POST /schedules/emergency-release/tasks — server so lại với hash LIVE, reject nếu definition đã đổi.
  // Optional: CHỈ vắng mặt ở draft cục bộ (form tạo/sửa definition chưa lưu) — definition đã tải từ GET
  // /release/emergency/task-definitions LUÔN có field này.
  revisionHash?: string;
}


export interface ReleaseSyncPreview {
  willUpdate: { taskId: number; originRef: string; title: string; changedFields: string[] }[];
  skipped: { originRef: string; title: string; reason: string }[];
}

export interface Task {
  id: number;
  tenTask: string;
  ghiChu: string;
  loaiTask: LoaiTask;
  trangThai: TrangThai;
  ngayTao: string;
  ngayHoanThanh: string | null;
  gioBatDau: string | null;
  gioKetThuc: string | null;
  lapLaiKieu: string | null;
  ngayTrongThang: number | null;
  thuTrongTuan: number | number[] | null;
  ngayCuThe: string | null;
  releaseMonth: string | null;
  releaseDate: string | null;
  links: TaskLink[];
  // FR-5 (CR-20260814-hop-nhat): task release đang lệch definition gốc — chỉ `true` khi CHẮC CHẮN
  // lệch (definition còn tồn tại và so được); thiếu/không tra được definition thì để `false`, không
  // báo động khi không biết. Do `GET /api/tasks` tính sẵn (bulk, không N+1).
  lechDefinition?: boolean;
}

export interface ProjectItem {
  id: string;
  ten: string;
  pic: string;
  ngayBatDau: string;
  moTa: string;
  sortOrder: number;
  closedAt: string | null;
  pendingAt: string | null;
  isSystem: boolean;
}

export type ProjectTaskProgress = number;

// Một giai đoạn phân công: PIC làm từ startDate → endDate, giờ dự kiến của giai đoạn.
export interface ProjectTaskAssignment {
  id?: string;
  pic: string;
  startDate: string;
  endDate: string;
  estimateHours: number | null;
  sortOrder?: number;
}

export interface ProjectTaskItem {
  id: string;
  projectId: string;
  parentId: string | null;
  level: number;
  tieuDe: string;
  ghiChu: string;
  ngayBatDauDuKien: string;
  ngayKetThucDuKien: string;
  estimateHours: number | null;
  tienDo: ProjectTaskProgress;
  assignee: string;
  sortOrder: number;
  executionOrder: number;
  links: TaskLink[];
  assignments?: ProjectTaskAssignment[];
}

export type ProjectCreateBody = Pick<ProjectItem, 'ten' | 'pic' | 'ngayBatDau'>;
export type ProjectTaskCreateBody = Omit<ProjectTaskItem, 'id' | 'projectId' | 'level' | 'sortOrder' | 'executionOrder'>;

export interface DuLieuDashboard {
  khoTask: Task[];
  taskHomNay: Task[];
  taskDinhKy: Task[];
  lichSu: Task[];
}

export interface SortState {
  truong: TruongSort;
  huong: HuongSort;
}

// Danh sách PIC quản lý động (tab "Quản lý PIC"), tải từ server thay cho hard-code.
export interface PicItem { id: string; name: string; color: string | null; sortOrder: number; dangSuDung?: boolean; }

// ── Thông báo (toast) ─────────────────────────────────────────────────────────
export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem { id: number; kind: ToastKind; message: string }
