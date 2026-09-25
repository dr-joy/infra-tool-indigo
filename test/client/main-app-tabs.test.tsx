// 2026-09-25 (docs/exchanges/2026-09-25.md) — App() (src/main.tsx) ẩn hẳn tab khi feature tương ứng
// đang 'off' cho team đang chọn (team_feature_visibility, CR-20260913 FR-7), thay vì hiện tab rồi mới
// báo lỗi 403 FEATURE_DISABLED bên trong. Team mới (provisionTeam) mặc định TẮT cả 5 feature.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { LangProvider } from '../../src/useLang';
import { PicProvider, ToastProvider } from '../../src/context';
import { AuthProvider } from '../../src/auth-context';
import { App } from '../../src/main';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface TeamStub { id: number; name: string; role: 'leader' | 'member'; features: string[] }

// Mock fetch tối thiểu cho mọi endpoint App() (và các màn con nó luôn mount) có thể gọi — bất kỳ
// route nào ngoài danh sách này trả rỗng, cùng quy ước với test/client/screens.test.tsx.
function mockApi(teams: TeamStub[], systemRole: 'user' | 'admin' = 'user') {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/auth/me') {
      return jsonResponse({
        user: {
          id: 1, email: 'a@drjoy.jp', displayName: 'Vũ Tuấn', avatar: null, status: 'active', systemRole,
          memberships: teams.map((t) => ({ teamId: t.id, role: t.role }))
        }
      });
    }
    if (url.pathname === '/api/me/teams') {
      return jsonResponse({ teams: teams.map(({ id, name, role, features }) => ({ id, name, description: null, role, features })) });
    }
    if (url.pathname === '/api/notifications') return jsonResponse({ notifications: [] });
    if (url.pathname.startsWith('/api/tasks')) return jsonResponse({ khoTask: [], taskHomNay: [], taskDinhKy: [], lichSu: [] });
    return jsonResponse([]);
  }) as unknown as typeof fetch;
}

function renderApp() {
  return render(
    <LangProvider>
      <AuthProvider>
        <ToastProvider>
          <PicProvider><App /></PicProvider>
        </ToastProvider>
      </AuthProvider>
    </LangProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('App() — ẩn tab theo team_feature_visibility (CR-20260913 FR-7)', () => {
  it('team mới (mọi feature off) -> chỉ còn tab không bị gate (Certificates/Settings/Team), ẩn hết Tasks/Projects/Reports/Releases/MindMap', async () => {
    mockApi([{ id: 1, name: 'Team Mới', role: 'leader', features: [] }]);
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Team' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Tasks' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Projects' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reports' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Releases' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'MindMap' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Certificates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('feature personal_task+project bật -> đúng 2 tab đó hiện thêm, còn lại vẫn ẩn', async () => {
    mockApi([{ id: 1, name: 'Team A', role: 'leader', features: ['personal_task', 'project'] }]);
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reports' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Releases' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'MindMap' })).toBeNull();
  });

  it('đổi sang team khác đang mở tab Projects nhưng team mới tắt feature project -> tự chuyển về tab còn hiện, không để màn trống', async () => {
    mockApi([
      { id: 1, name: 'Team A', role: 'leader', features: ['personal_task', 'project'] },
      { id: 2, name: 'Team B', role: 'member', features: ['weekly_report'] }
    ]);
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Projects' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Projects' })).toHaveClass('menu-tab-active'));

    // Đổi team qua TeamSwitcher (góc trên) sang Team B — Projects biến mất khỏi thanh tab.
    fireEvent.click(screen.getByRole('button', { name: /Team A/ }));
    fireEvent.click(screen.getByRole('option', { name: /Team B/ }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Projects' })).toBeNull());
    // Tasks (personal_task) cũng tắt ở Team B -> Reports (weekly_report, đang bật) phải là tab được
    // tự chuyển tới, không phải màn trống không tab nào active.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reports' })).toHaveClass('menu-tab-active'));
  });
});
