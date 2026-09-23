import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LangProvider } from '../../src/useLang';
import { PicProvider, ToastProvider } from '../../src/context';
import { AuthProvider } from '../../src/auth-context';
import { ManHinhProject } from '../../src/screens/project';
import { ManHinhBaoCaoTuan } from '../../src/screens/weekly';
import { ManHinhLenLich } from '../../src/screens/release';

// Mock fetch trả dữ liệu tối thiểu hợp lệ cho mọi endpoint mà màn hình gọi lúc mount.
// CR-20260913 (nền tảng đa người dùng): mọi màn nghiệp vụ giờ đọc activeTeamId qua AuthContext
// (src/auth-context.tsx, xem useActiveTeamId()) -> AuthProvider tự gọi /api/auth/me + /api/me/teams
// lúc mount, phải mock đủ 2 route này để activeTeamId có giá trị hợp lệ (không rơi vào 400 "Chưa
// chọn team hiện tại" ở apiTeam()).
function mockApi() {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    let body: unknown = [];
    if (u.includes('/api/tasks?')) body = { khoTask: [], taskHomNay: [], taskDinhKy: [], lichSu: [] };
    else if (u.includes('/api/auth/me')) {
      body = { user: { id: 1, email: 'test@drjoy.jp', displayName: 'Test User', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'leader' }] } };
    } else if (u.includes('/api/me/teams')) {
      body = { teams: [{ id: 1, name: 'Dev13', description: null, role: 'leader' }] };
    } else if (u.includes('/api/notifications')) {
      body = { notifications: [] };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LangProvider>
      <AuthProvider>
        <ToastProvider>
          <PicProvider>{ui}</PicProvider>
        </ToastProvider>
      </AuthProvider>
    </LangProvider>
  );
}

describe('Render smoke — màn hình lớn (mount không nổ với fetch mock)', () => {
  beforeEach(() => mockApi());

  it('ManHinhProject mount + hiển thị mà không throw', async () => {
    const { container } = renderWithProviders(<ManHinhProject />);
    await waitFor(() => expect(container.querySelector('section, div')).toBeTruthy());
    expect(container).toBeTruthy();
  });

  it('ManHinhBaoCaoTuan mount không throw', async () => {
    const { container } = renderWithProviders(<ManHinhBaoCaoTuan />);
    await waitFor(() => expect(container.querySelector('section, div')).toBeTruthy());
    expect(container).toBeTruthy();
  });

  it('ManHinhLenLich (release) mount không throw', async () => {
    const { container } = renderWithProviders(<ManHinhLenLich onTasksCreated={async () => {}} />);
    await waitFor(() => expect(container.querySelector('section, div')).toBeTruthy());
    expect(container).toBeTruthy();
  });
});
