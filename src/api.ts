
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  // teamId của request gây ra lỗi này (chỉ gắn khi gọi qua apiTeam()) — dùng để nơi nhận
  // AUTH_ERROR_EVENT (src/auth-context.tsx) phân biệt lỗi của team đang xem hiện tại với lỗi trễ của
  // một team đã rời đi (xem ghi chú tại nơi dispatch sự kiện bên dưới).
  teamId?: number;
  constructor(status: number, message: string, code?: string, details?: unknown, teamId?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.teamId = teamId;
  }
}

// CR-20260913 FR-4a — sự kiện toàn cục cho lỗi phiên/quyền, để AuthProvider (src/auth-context.tsx)
// phản ứng được mà KHÔNG bắt mọi màn hình tự bọc catch riêng cho từng lệnh gọi API. Mỗi màn vẫn nhận
// đúng ApiError như trước ở nhánh catch của chính nó (sự kiện này chỉ CỘNG THÊM, không thay thế).
export const AUTH_ERROR_EVENT = 'tm:auth-error';
const AUTH_ERROR_CODES = new Set([
  'SESSION_REQUIRED', 'ACCOUNT_DISABLED', 'ACCOUNT_PENDING', 'NOT_TEAM_MEMBER', 'ROLE_FORBIDDEN'
]);

// requestTeamId: chỉ gắn khi lệnh gọi đi qua apiTeam() bên dưới — gắn vào ApiError.teamId để nơi
// nhận AUTH_ERROR_EVENT biết lỗi này phát sinh từ request của team nào (xem ApiError.teamId).
export async function api<T>(url: string, options?: RequestInit, requestTeamId?: number): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    let body: { message?: string; code?: string; details?: unknown } | null = null;
    try { body = JSON.parse(text); } catch { /* body không phải JSON */ }
    const error = new ApiError(response.status, body?.message || text || `HTTP ${response.status}`, body?.code, body?.details, requestTeamId);
    if (error.code && AUTH_ERROR_CODES.has(error.code) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<ApiError>(AUTH_ERROR_EVENT, { detail: error }));
    }
    throw error;
  }
  return response.json() as Promise<T>;
}

// CR-20260913 FR-13 — nhiều route Lát 3-6 (project/weekly/pics...) bắt buộc `teamId` do bộ chọn team
// gửi lên (server/routes/projects.ts, weekly.ts, pics.ts: "teamId LUÔN lấy từ query/body do client
// chọn"); route có sẵn resource theo :id thì KHÔNG cần (team suy từ chính bản ghi). Hàm này gắn
// teamId tự động: GET/HEAD -> query string; còn lại -> merge vào JSON body (chỉ khi body là JSON hợp
// lệ hoặc rỗng — body khác dạng JSON, vd FormData, giữ nguyên không đụng vào).
export function apiTeam<T>(teamId: number | null, url: string, options?: RequestInit): Promise<T> {
  if (teamId == null) {
    return Promise.reject(new ApiError(400, 'Chưa chọn team hiện tại'));
  }
  const method = (options?.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    const sep = url.includes('?') ? '&' : '?';
    return api<T>(`${url}${sep}teamId=${teamId}`, options, teamId);
  }
  let bodyObj: Record<string, unknown> = {};
  if (typeof options?.body === 'string' && options.body.length > 0) {
    try {
      const parsed = JSON.parse(options.body) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) bodyObj = parsed as Record<string, unknown>;
    } catch { /* body không phải JSON (vd FormData đã stringify sai) — không đụng vào, gửi teamId qua query thay */ }
  }
  bodyObj.teamId = teamId;
  return api<T>(url, { ...options, body: JSON.stringify(bodyObj) }, teamId);
}
