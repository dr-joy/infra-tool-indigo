// AuthContext — CR-20260913 (nền tảng đa người dùng), Giai đoạn 1.
// Theo đúng pattern PicProvider/ToastProvider đã có ở src/context.tsx: context + provider + hook,
// tách riêng file vì đây là mảng trạng thái độc lập (danh tính/phiên/team), không liên quan PIC/toast.
//
// Nạp GET /api/auth/me lúc khởi động (CR §6.1, luồng ASCII đăng nhập lần đầu) rồi suy ra ĐÚNG MỘT
// trong 5 trạng thái (`phase`) để src/main.tsx dựng đúng màn — không có "chưa biết" nào kéo dài ngoài
// `loading` (nháy đầu tiên):
//   loading      — chưa có kết quả GET /api/auth/me lần đầu.
//   logged_out   — 401 SESSION_REQUIRED -> chuyển sang OIDC (GET /api/auth/login).
//   disabled     — 403 ACCOUNT_DISABLED (kể cả phát hiện GIỮA lúc thao tác qua AUTH_ERROR_EVENT) ->
//                  thẳng trạng thái "không được phép truy cập" của vỏ xác thực, KHÔNG quay vòng
//                  login/logout (đúng yêu cầu FR-4a nhánh 3).
//   pending      — tài khoản chờ Admin duyệt (FR-2/FR-3/FR-3a) -> "Chọn team và vai trò" hoặc
//                  "Đang chờ duyệt" tuỳ có đơn `pending` hay không.
//   active       — vào app bình thường, có `myTeams` + `activeTeamId` (FR-13).
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError, AUTH_ERROR_EVENT } from './api';

export type SystemRole = 'user' | 'admin';
export type TeamRole = 'leader' | 'member';
export type AccountStatus = 'pending' | 'active' | 'disabled';

export interface Membership {
  teamId: number;
  role: TeamRole;
}

export interface AuthActor {
  id: number;
  email: string;
  displayName: string;
  avatar: string | null;
  status: AccountStatus;
  systemRole: SystemRole;
  memberships: Membership[];
}

export interface MyTeam {
  id: number;
  name: string;
  description: string | null;
  role: TeamRole;
  // Feature (personal_task/project/weekly_report/release/mind_map) đang 'on' cho team này — FE dùng
  // để ẩn hẳn tab tương ứng thay vì hiện tab rồi mới báo lỗi FEATURE_DISABLED bên trong.
  features: string[];
}

export interface JoinRequestInfo {
  id: number;
  teamId: number;
  teamName: string;
  role: TeamRole;
}

// FR-3 — popup bắt buộc "Đã cấp team X, vai trò Y" lần đầu sau khi được duyệt. Nguồn: notification
// kind='join_request_approved' CHƯA đọc (server/routes/onboarding.ts) — không phải state phù du, nên
// dù đóng app giữa chừng, lần đăng nhập sau vẫn còn thấy tới khi bấm "Đã hiểu" (mark-read).
export interface ApprovalNotice {
  notificationId: number;
  teamId: number;
  teamName: string;
  role: TeamRole;
}

export type AuthPhase = 'loading' | 'logged_out' | 'disabled' | 'pending' | 'active' | 'error';

interface AuthContextValue {
  phase: AuthPhase;
  actor: AuthActor | null;
  myTeams: MyTeam[];
  activeTeamId: number | null;
  setActiveTeamId: (teamId: number) => void;
  joinRequest: JoinRequestInfo | null;
  approvalNotice: ApprovalNotice | null;
  ackApprovalNotice: () => Promise<void>;
  permissionLostError: ApiError | null;
  clearPermissionLostError: () => void;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
}

// Giá trị mặc định AN TOÀN khi không có <AuthProvider> bao ngoài — cùng quy ước với PicContext/
// ToastContext/LangContext (src/context.tsx, src/useLang.ts): KHÔNG throw, để mount test/màn hình cô
// lập không cần biết tới auth vẫn chạy được. phase 'loading' + activeTeamId null khiến mọi nơi gọi
// apiTeam() với giá trị này tự trả lỗi rõ ràng ("Chưa chọn team") thay vì âm thầm gọi sai.
const DEFAULT_AUTH_CONTEXT: AuthContextValue = {
  phase: 'loading',
  actor: null,
  myTeams: [],
  activeTeamId: null,
  setActiveTeamId: () => {},
  joinRequest: null,
  approvalNotice: null,
  ackApprovalNotice: async () => {},
  permissionLostError: null,
  clearPermissionLostError: () => {},
  reload: async () => {},
  logout: async () => {}
};

const AuthContext = createContext<AuthContextValue>(DEFAULT_AUTH_CONTEXT);

const ACTIVE_TEAM_STORAGE_KEY = 'tm.activeTeamId';
// FR-2/FR-3 "Đang chờ duyệt": không có yêu cầu real-time (không WebSocket, §2 Ngoài phạm vi) — poll
// đơn giản là đủ, CR chỉ đòi "tự cập nhật" + nút "Kiểm tra lại" tự bấm tay.
const PENDING_POLL_MS = 15000;

function readStoredTeamId(): number | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_TEAM_STORAGE_KEY);
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  } catch {
    // Private window / storage bị chặn -> không nhớ được lựa chọn cũ, không phải lỗi chặn đứng.
    return null;
  }
}

function writeStoredTeamId(teamId: number) {
  try {
    window.localStorage.setItem(ACTIVE_TEAM_STORAGE_KEY, String(teamId));
  } catch { /* bỏ qua — chỉ là tiện lợi ghi nhớ, không phải nguồn sự thật */ }
}

interface NotificationRow {
  id: number;
  kind: string;
  payload: string;
  created_at: string;
  read_at: string | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>('loading');
  const [actor, setActor] = useState<AuthActor | null>(null);
  const [myTeams, setMyTeams] = useState<MyTeam[]>([]);
  const [activeTeamId, setActiveTeamIdState] = useState<number | null>(null);
  const [joinRequest, setJoinRequest] = useState<JoinRequestInfo | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<ApprovalNotice | null>(null);
  const [permissionLostError, setPermissionLostError] = useState<ApiError | null>(null);

  const setActiveTeamId = useCallback((teamId: number) => {
    setActiveTeamIdState(teamId);
    writeStoredTeamId(teamId);
  }, []);

  // Team đang chọn CHỈ nhớ phía trình duyệt (Council `1aa7fe8b`, 19/09 — không thêm cột server).
  async function checkApprovalNotice(teams: MyTeam[]) {
    try {
      const res = await api<{ notifications: NotificationRow[] }>('/api/notifications');
      const unread = res.notifications.find((n) => n.kind === 'join_request_approved' && !n.read_at);
      if (!unread) return;
      let payload: { teamId?: number; role?: TeamRole } = {};
      try { payload = JSON.parse(unread.payload); } catch { /* payload hỏng -> bỏ qua, không chặn app */ }
      if (typeof payload.teamId !== 'number' || (payload.role !== 'leader' && payload.role !== 'member')) return;
      const team = teams.find((t) => t.id === payload.teamId);
      setApprovalNotice({
        notificationId: unread.id,
        teamId: payload.teamId,
        teamName: team?.name || `team #${payload.teamId}`,
        role: payload.role
      });
    } catch {
      // Không chặn luồng chính (FR-3 là popup phụ trợ) nếu /api/notifications tạm lỗi.
    }
  }

  const reload = useCallback(async () => {
    try {
      const { user } = await api<{ user: AuthActor }>('/api/auth/me');
      setActor(user);
      if (user.status === 'disabled') {
        setPhase('disabled');
        return;
      }
      if (user.status === 'pending') {
        setMyTeams([]);
        try {
          const jr = await api<{ joinRequest: JoinRequestInfo | null }>('/api/onboarding/my-join-request');
          setJoinRequest(jr.joinRequest);
        } catch {
          setJoinRequest(null);
        }
        setPhase('pending');
        return;
      }
      // active
      const teamsRes = await api<{ teams: MyTeam[] }>('/api/me/teams');
      setMyTeams(teamsRes.teams);
      setJoinRequest(null);
      setActiveTeamIdState((current) => {
        if (current != null && teamsRes.teams.some((t) => t.id === current)) return current;
        const stored = readStoredTeamId();
        if (stored != null && teamsRes.teams.some((t) => t.id === stored)) return stored;
        return teamsRes.teams[0]?.id ?? null;
      });
      setPhase('active');
      void checkApprovalNotice(teamsRes.teams);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) { setPhase('logged_out'); return; }
        if (error.code === 'ACCOUNT_DISABLED') { setPhase('disabled'); return; }
      }
      setPhase('error');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // FR-4a — lỗi phiên/quyền phát hiện GIỮA lúc thao tác (không chỉ lúc khởi động): api.ts phát sự
  // kiện toàn cục, ở đây phản ứng lại mà KHÔNG cần từng màn tự bọc catch riêng.
  //
  // QUAN TRỌNG — không gọi reload() cho SESSION_REQUIRED/ACCOUNT_DISABLED: reload() tự nó gọi
  // GET /api/auth/me qua api(), và NẾU chính lệnh gọi đó cũng trả về đúng 2 mã lỗi này thì api.ts lại
  // phát tiếp AUTH_ERROR_EVENT -> handler này chạy lại -> gọi reload() lần nữa -> vòng lặp vô hạn (bắt
  // được qua test thật: heap out of memory khi mô phỏng "tài khoản bị khoá giữa lúc active"). 2 mã này
  // đã đủ thông tin để chuyển thẳng `phase` mà KHÔNG cần hỏi lại server — không mất dữ liệu vì màn
  // logged_out/disabled không cần `actor` cũ. ACCOUNT_PENDING không có rủi ro này (route
  // GET /api/auth/me chỉ qua requireSession, không bao giờ tự trả ACCOUNT_PENDING) nên vẫn reload()
  // bình thường để lấy lại joinRequest cho đúng màn.
  // Điểm phụ Council nêu (Lát 7 giai đoạn 1, mức thấp — chỉ gây hiểu lầm thông báo, không rò dữ
  // liệu): AUTH_ERROR_EVENT là sự kiện toàn cục, không tự mang teamId của request gốc. Nếu response
  // lỗi (NOT_TEAM_MEMBER/ROLE_FORBIDDEN) của team A về SAU khi người dùng đã đổi sang team B, popup
  // "mất quyền" có thể hiện sai ngữ cảnh (nói "không còn là thành viên team này" trong khi đang xem
  // team B). activeTeamIdRef giữ activeTeamId mới nhất (cập nhật mỗi render, không đợi effect chạy
  // lại) để so sánh với error.teamId (api.ts gắn vào từ apiTeam()) ngay tại thời điểm sự kiện tới.
  const activeTeamIdRef = useRef(activeTeamId);
  activeTeamIdRef.current = activeTeamId;

  useEffect(() => {
    function onAuthError(event: Event) {
      const error = (event as CustomEvent<ApiError>).detail;
      if (!error) return;
      if (error.code === 'SESSION_REQUIRED') { setPhase('logged_out'); return; }
      if (error.code === 'ACCOUNT_DISABLED') { setPhase('disabled'); return; }
      if (error.code === 'ACCOUNT_PENDING') { void reload(); return; }
      if (error.code === 'NOT_TEAM_MEMBER' || error.code === 'ROLE_FORBIDDEN') {
        // error.teamId chỉ có khi lỗi tới từ apiTeam(); lỗi không mang teamId (vd api() trần) vẫn
        // hiện popup như trước — không đủ căn cứ để biết là stale hay không nên giữ hành vi an toàn cũ.
        if (error.teamId != null && error.teamId !== activeTeamIdRef.current) return;
        setPermissionLostError(error);
      }
    }
    window.addEventListener(AUTH_ERROR_EVENT, onAuthError);
    return () => window.removeEventListener(AUTH_ERROR_EVENT, onAuthError);
  }, [reload]);

  // Poll khi đang pending — "Đang chờ duyệt" phải tự cập nhật (CR §6.1a, không WebSocket -> poll đơn
  // giản). Dừng ngay khi rời phase pending, không rò rỉ interval.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    if (phase !== 'pending') return;
    const id = window.setInterval(() => { void reload(); }, PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [phase, reload]);

  const ackApprovalNotice = useCallback(async () => {
    if (!approvalNotice) return;
    const id = approvalNotice.notificationId;
    setApprovalNotice(null);
    try {
      await api(`/api/notifications/${id}/read`, { method: 'POST' });
    } catch {
      // Đã ẩn popup phía client — lần load sau nếu server vẫn coi là unread thì hiện lại, không mất
      // hẳn thông tin, chỉ phải bấm "Đã hiểu" thêm lần nữa (không phải lỗi nghiêm trọng).
    }
  }, [approvalNotice]);

  const clearPermissionLostError = useCallback(() => setPermissionLostError(null), []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/';
    }
  }, []);

  const value: AuthContextValue = {
    phase, actor, myTeams, activeTeamId, setActiveTeamId, joinRequest,
    approvalNotice, ackApprovalNotice, permissionLostError, clearPermissionLostError,
    reload, logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

// Tiện dùng ở các màn chỉ cần đúng teamId để gọi apiTeam() (project/weekly/pics) — tránh mỗi nơi tự
// destructure lại `activeTeamId` từ useAuth().
export function useActiveTeamId(): number | null {
  return useAuth().activeTeamId;
}
