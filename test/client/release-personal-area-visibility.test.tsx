// 2026-09-26 (docs/exchanges/2026-09-26.md) — nút "Cá nhân" cạnh "Lịch chung" ở màn Release giờ chỉ
// hiện khi Admin đã bật riêng cho user (GET /api/release/schedule/personal-area-status), thay vì luôn
// hiện như trước. Test này xác nhận cả 2 nhánh: ẩn khi false/lỗi, hiện khi true.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LangProvider } from '../../src/useLang';
import { PicProvider, ToastProvider } from '../../src/context';
import { AuthProvider } from '../../src/auth-context';
import { ManHinhLenLich } from '../../src/screens/release';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockApi(personalAreaEnabled: boolean | 'error') {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/auth/me') {
      return jsonResponse({ user: { id: 1, email: 'a@drjoy.jp', displayName: 'Test', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'leader' }] } });
    }
    if (url.pathname === '/api/me/teams') return jsonResponse({ teams: [{ id: 1, name: 'Dev13', description: null, role: 'leader', features: ['release'] }] });
    if (url.pathname === '/api/notifications') return jsonResponse({ notifications: [] });
    if (url.pathname === '/api/release/schedule/personal-area-status') {
      if (personalAreaEnabled === 'error') return jsonResponse({ message: 'lỗi' }, 500);
      return jsonResponse({ enabled: personalAreaEnabled });
    }
    if (url.pathname === '/api/release/schedule-board') return jsonResponse({ cycles: [], coordinatorTeamId: null });
    if (url.pathname === '/api/release/emergency/templates') return jsonResponse([]);
    if (url.pathname === '/api/release/emergency/task-definitions') return jsonResponse([]);
    if (url.pathname === '/api/release/schedule/personal-task-status') return jsonResponse({ enabled: false });
    return jsonResponse({ message: `unmocked ${url.pathname}` }, 404);
  }) as unknown as typeof fetch;
}

function renderRelease() {
  return render(
    <LangProvider>
      <AuthProvider>
        <ToastProvider>
          <PicProvider>
            <ManHinhLenLich onTasksCreated={async () => {}} />
          </PicProvider>
        </ToastProvider>
      </AuthProvider>
    </LangProvider>
  );
}

describe('ManHinhLenLich — ẩn/hiện nút "Cá nhân" theo quyền Admin cấp (2026-09-26)', () => {
  it('Admin CHƯA bật -> không thấy nút "Cá nhân", màn mặc định hiện "Lịch chung"', async () => {
    mockApi(false);
    renderRelease();
    await waitFor(() => expect(screen.getByText('Khu vực')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cá nhân' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Lịch chung' })).toHaveClass('release-type-button-active');
  });

  it('Fetch personal-area-status lỗi -> coi như chưa bật (an toàn), không throw', async () => {
    mockApi('error');
    renderRelease();
    await waitFor(() => expect(screen.getByText('Khu vực')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cá nhân' })).toBeNull();
  });

  it('Admin ĐÃ bật -> thấy nút "Cá nhân", mặc định mở đúng vùng đó', async () => {
    mockApi(true);
    renderRelease();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cá nhân' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Cá nhân' })).toHaveClass('release-type-button-active');
  });
});
