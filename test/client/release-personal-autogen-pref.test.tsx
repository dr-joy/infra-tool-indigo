// 2026-09-25 (docs/exchanges/2026-09-25.md) — Admin bật "Tab cá nhân" cho team chỉ mở KHẢ NĂNG, actor
// còn phải tự bật riêng cho mình (checkbox mới trong LayoutReleaseKhanCap/LayoutReleaseDinhKy) mới thật
// sự thấy được nút "Áp dụng checklist cá nhân theo lịch team".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from '../../src/auth-context';
import { ManHinhLenLich } from '../../src/screens/release';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// activeTeamId cố định = 1 (AuthProvider tự chọn team đầu tiên trong myTeams khi chưa có gì lưu ở
// localStorage) — mock đủ /api/auth/me + /api/me/teams để useActiveTeamId() không trả về null (nếu
// null, apiTeam() từ chối ngay với "Chưa chọn team hiện tại", effect trong release.tsx return sớm,
// personal-task-status không được gọi — không phải hành vi đang test).
function mockApi(personalTaskStatus: { teamCapable: boolean; enabled: boolean }, onPutPref?: (body: unknown) => void) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method || 'GET').toUpperCase();
    if (url.pathname === '/api/auth/me') {
      return jsonResponse({ user: { id: 1, email: 'a@drjoy.jp', displayName: 'Test', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'leader' }] } });
    }
    if (url.pathname === '/api/me/teams') return jsonResponse({ teams: [{ id: 1, name: 'Dev13', description: null, role: 'leader', features: ['release', 'personal_task'] }] });
    if (url.pathname === '/api/notifications') return jsonResponse({ notifications: [] });
    if (url.pathname === '/api/release/emergency/templates') return jsonResponse([]);
    if (url.pathname === '/api/release/emergency/task-definitions') return jsonResponse([]);
    if (url.pathname === '/api/release/schedule-board') return jsonResponse({ cycles: [] });
    if (url.pathname === '/api/release/schedule/personal-task-status') return jsonResponse(personalTaskStatus);
    if (url.pathname === '/api/release/schedule/personal-task-pref' && method === 'PUT') {
      onPutPref?.(JSON.parse(String(init?.body)));
      return jsonResponse({ teamCapable: personalTaskStatus.teamCapable, enabled: true });
    }
    return jsonResponse({ message: `unmocked ${url.pathname}` }, 404);
  }) as unknown as typeof fetch;
}

function renderScreen() {
  return render(
    <AuthProvider>
      <ManHinhLenLich onTasksCreated={async () => {}} />
    </AuthProvider>
  );
}

describe('Release — checkbox tự bật "áp dụng checklist cá nhân theo lịch team" (FR-28a, per-user opt-in)', () => {
  beforeEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('teamCapable=true nhưng actor CHƯA tự bật -> chỉ thấy checkbox (chưa check), KHÔNG thấy nút áp dụng', async () => {
    globalThis.fetch = mockApi({ teamCapable: true, enabled: false });
    renderScreen();

    const checkbox = await screen.findByRole('checkbox', { name: /Tự động sinh task cá nhân theo lịch team/i });
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByRole('button', { name: /Áp dụng checklist cá nhân theo lịch team/i })).toBeNull();
  });

  it('actor tự tích checkbox -> gọi đúng PUT personal-task-pref, sau đó thấy nút áp dụng', async () => {
    let putBody: unknown = null;
    globalThis.fetch = mockApi({ teamCapable: true, enabled: false }, (body) => { putBody = body; });
    renderScreen();

    const checkbox = await screen.findByRole('checkbox', { name: /Tự động sinh task cá nhân theo lịch team/i });
    fireEvent.click(checkbox);

    await waitFor(() => expect(putBody).toMatchObject({ enabled: true }));
    expect(await screen.findByRole('button', { name: /Áp dụng checklist cá nhân theo lịch team/i })).toBeInTheDocument();
  });

  it('teamCapable=false (Admin chưa bật cho team) -> KHÔNG thấy checkbox lẫn nút', async () => {
    globalThis.fetch = mockApi({ teamCapable: false, enabled: false });
    renderScreen();

    await screen.findByRole('heading', { name: 'Release khẩn cấp' });
    expect(screen.queryByRole('checkbox', { name: /Tự động sinh task cá nhân theo lịch team/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Áp dụng checklist cá nhân theo lịch team/i })).toBeNull();
  });
});
