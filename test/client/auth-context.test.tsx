// CR-20260913 (nền tảng đa người dùng) — AuthProvider/useAuth() (src/auth-context.tsx).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth, useActiveTeamId } from '../../src/auth-context';
import { AUTH_ERROR_EVENT, ApiError } from '../../src/api';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockRoutes(routes: Record<string, unknown | ((url: URL) => unknown)>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const entry = routes[url.pathname];
    if (entry === undefined) return jsonResponse({ message: `unmocked ${url.pathname}` }, 404);
    const value = typeof entry === 'function' ? (entry as (u: URL) => unknown)(url) : entry;
    if (value && typeof value === 'object' && 'status' in (value as Record<string, unknown>) && 'body' in (value as Record<string, unknown>)) {
      const v = value as { status: number; body: unknown };
      return jsonResponse(v.body, v.status);
    }
    return jsonResponse(value);
  }) as unknown as typeof fetch;
}

// Component thăm dò: in ra state của useAuth() để assert bằng text nội dung.
function Probe() {
  const { phase, actor, myTeams, activeTeamId, joinRequest, permissionLostError } = useAuth();
  const activeTeamIdAgain = useActiveTeamId();
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="actor">{actor?.displayName || ''}</span>
      <span data-testid="teams">{myTeams.map((t) => t.name).join(',')}</span>
      <span data-testid="active-team">{String(activeTeamId)}</span>
      <span data-testid="active-team-hook">{String(activeTeamIdAgain)}</span>
      <span data-testid="join-request">{joinRequest ? `${joinRequest.teamName}:${joinRequest.role}` : ''}</span>
      <span data-testid="permission-lost">{permissionLostError?.code || ''}</span>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('AuthProvider — suy phase từ GET /api/auth/me (CR §6.1)', () => {
  it('active: nạp actor + myTeams, activeTeamId mặc định là team đầu tiên', async () => {
    mockRoutes({
      '/api/auth/me': { user: { id: 1, email: 'a@drjoy.jp', displayName: 'Vũ Tuấn', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'leader' }] } },
      '/api/me/teams': { teams: [{ id: 1, name: 'Dev13', description: null, role: 'leader' }] },
      '/api/notifications': { notifications: [] }
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('active'));
    expect(screen.getByTestId('actor').textContent).toBe('Vũ Tuấn');
    expect(screen.getByTestId('teams').textContent).toBe('Dev13');
    expect(screen.getByTestId('active-team').textContent).toBe('1');
    expect(screen.getByTestId('active-team-hook').textContent).toBe('1');
  });

  it('401 SESSION_REQUIRED -> phase logged_out', async () => {
    mockRoutes({ '/api/auth/me': { status: 401, body: { message: 'Chưa đăng nhập', code: 'SESSION_REQUIRED' } } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('logged_out'));
  });

  it('403 ACCOUNT_DISABLED (kể cả ngay lúc /api/auth/me) -> phase disabled', async () => {
    mockRoutes({ '/api/auth/me': { status: 403, body: { message: 'Bị khoá', code: 'ACCOUNT_DISABLED' } } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('disabled'));
  });

  it('pending CHƯA từng gửi đơn -> phase pending, joinRequest rỗng (FE tự hiện màn Chọn team)', async () => {
    mockRoutes({
      '/api/auth/me': { user: { id: 2, email: 'p@drjoy.jp', displayName: 'Đang chờ', avatar: null, status: 'pending', systemRole: 'user', memberships: [] } },
      '/api/onboarding/my-join-request': { joinRequest: null }
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('pending'));
    expect(screen.getByTestId('join-request').textContent).toBe('');
  });

  it('pending ĐÃ gửi đơn -> joinRequest có team/vai trò đã xin (FR-2/FR-3)', async () => {
    mockRoutes({
      '/api/auth/me': { user: { id: 3, email: 'p2@drjoy.jp', displayName: 'Đang chờ 2', avatar: null, status: 'pending', systemRole: 'user', memberships: [] } },
      '/api/onboarding/my-join-request': { joinRequest: { id: 9, teamId: 5, teamName: 'Dev13', role: 'leader' } }
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('join-request').textContent).toBe('Dev13:leader'));
  });

  it('nhớ activeTeamId cũ trong localStorage nếu vẫn còn thuộc team đó', async () => {
    window.localStorage.setItem('tm.activeTeamId', '2');
    mockRoutes({
      '/api/auth/me': { user: { id: 1, email: 'a@drjoy.jp', displayName: 'X', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'member' }, { teamId: 2, role: 'member' }] } },
      '/api/me/teams': { teams: [{ id: 1, name: 'Dev13', description: null, role: 'member' }, { id: 2, name: 'QA', description: null, role: 'member' }] },
      '/api/notifications': { notifications: [] }
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('active'));
    expect(screen.getByTestId('active-team').textContent).toBe('2');
  });
});

describe('AuthProvider — phản ứng AUTH_ERROR_EVENT (FR-4a, phát từ src/api.ts)', () => {
  it('NOT_TEAM_MEMBER giữa lúc active -> permissionLostError được set, KHÔNG đổi phase', async () => {
    mockRoutes({
      '/api/auth/me': { user: { id: 1, email: 'a@drjoy.jp', displayName: 'X', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'member' }] } },
      '/api/me/teams': { teams: [{ id: 1, name: 'Dev13', description: null, role: 'member' }] },
      '/api/notifications': { notifications: [] }
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('active'));

    const err = new ApiError(403, 'Bạn không phải thành viên của team này', 'NOT_TEAM_MEMBER');
    fireEvent(window, new CustomEvent(AUTH_ERROR_EVENT, { detail: err }));
    await waitFor(() => expect(screen.getByTestId('permission-lost').textContent).toBe('NOT_TEAM_MEMBER'));
    expect(screen.getByTestId('phase').textContent).toBe('active');
  });

  // Điểm phụ Council nêu (Lát 7 giai đoạn 1): response lỗi của team ĐÃ RỜI (không còn là
  // activeTeamId) không được hiện popup "mất quyền" — tránh hiểu lầm khi đang xem team khác.
  it('NOT_TEAM_MEMBER mang teamId khác activeTeamId hiện tại (đổi team rồi mới về) -> BỎ QUA, không popup', async () => {
    mockRoutes({
      '/api/auth/me': { user: { id: 1, email: 'a@drjoy.jp', displayName: 'X', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'member' }, { teamId: 2, role: 'member' }] } },
      '/api/me/teams': { teams: [{ id: 1, name: 'Dev13', description: null, role: 'member' }, { id: 2, name: 'QA', description: null, role: 'member' }] },
      '/api/notifications': { notifications: [] }
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('active'));
    expect(screen.getByTestId('active-team').textContent).toBe('1');

    // Lỗi phát sinh từ 1 request của team 1 nhưng response về SAU khi đã đổi sang team 2.
    const err = new ApiError(403, 'Bạn không phải thành viên của team này', 'NOT_TEAM_MEMBER', undefined, 1);
    fireEvent(window, new CustomEvent(AUTH_ERROR_EVENT, { detail: err }));
    // activeTeamId hiện tại vẫn là 1 -> phải hiện popup bình thường (không phải trường hợp stale).
    await waitFor(() => expect(screen.getByTestId('permission-lost').textContent).toBe('NOT_TEAM_MEMBER'));
  });

  it('NOT_TEAM_MEMBER của team cũ về SAU khi đã đổi sang team khác -> KHÔNG hiện popup', async () => {
    mockRoutes({
      '/api/auth/me': { user: { id: 1, email: 'a@drjoy.jp', displayName: 'X', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'member' }, { teamId: 2, role: 'member' }] } },
      '/api/me/teams': { teams: [{ id: 1, name: 'Dev13', description: null, role: 'member' }, { id: 2, name: 'QA', description: null, role: 'member' }] },
      '/api/notifications': { notifications: [] }
    });

    function ProbeWithSwitch() {
      const { setActiveTeamId } = useAuth();
      return (
        <>
          <button onClick={() => setActiveTeamId(2)}>Đổi sang QA</button>
          <Probe />
        </>
      );
    }

    render(<AuthProvider><ProbeWithSwitch /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('active-team').textContent).toBe('1'));

    fireEvent.click(screen.getByRole('button', { name: 'Đổi sang QA' }));
    await waitFor(() => expect(screen.getByTestId('active-team').textContent).toBe('2'));

    // Response lỗi của request cũ (team 1) tới trễ, sau khi đã chuyển hẳn sang team 2.
    const err = new ApiError(403, 'Bạn không phải thành viên của team này', 'NOT_TEAM_MEMBER', undefined, 1);
    fireEvent(window, new CustomEvent(AUTH_ERROR_EVENT, { detail: err }));
    // Đợi 1 nhịp để chắc chắn KHÔNG có popup xuất hiện (không có gì để waitFor thành true).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('permission-lost').textContent).toBe('');
  });

  it('ACCOUNT_DISABLED giữa lúc active -> tự reload và chuyển sang phase disabled (không popup)', async () => {
    let meCallCount = 0;
    mockRoutes({
      '/api/auth/me': () => {
        meCallCount += 1;
        if (meCallCount === 1) {
          return { user: { id: 1, email: 'a@drjoy.jp', displayName: 'X', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'member' }] } };
        }
        return { status: 403, body: { message: 'Bị khoá', code: 'ACCOUNT_DISABLED' } };
      },
      '/api/me/teams': { teams: [{ id: 1, name: 'Dev13', description: null, role: 'member' }] },
      '/api/notifications': { notifications: [] }
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('active'));

    const err = new ApiError(403, 'Bị khoá', 'ACCOUNT_DISABLED');
    fireEvent(window, new CustomEvent(AUTH_ERROR_EVENT, { detail: err }));
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('disabled'));
    expect(screen.getByTestId('permission-lost').textContent).toBe('');
  });
});
