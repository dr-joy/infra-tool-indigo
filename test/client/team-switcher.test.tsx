// CR-20260913 FR-13 — bộ chọn team (src/components/team-switcher.tsx).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../../src/auth-context';
import { TeamSwitcher } from '../../src/components/team-switcher';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockActiveUser() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/auth/me') {
      return jsonResponse({ user: { id: 1, email: 'a@drjoy.jp', displayName: 'Vũ Tuấn', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'leader' }, { teamId: 2, role: 'member' }] } });
    }
    if (url.pathname === '/api/me/teams') {
      return jsonResponse({ teams: [{ id: 1, name: 'Dev13', description: null, role: 'leader' }, { id: 2, name: 'QA', description: null, role: 'member' }] });
    }
    if (url.pathname === '/api/notifications') return jsonResponse({ notifications: [] });
    if (url.pathname === '/api/auth/logout') return jsonResponse({ ok: true });
    return jsonResponse({ message: `unmocked ${url.pathname}` }, 404);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  mockActiveUser();
});

describe('TeamSwitcher', () => {
  it('hiện tên team đang chọn, mở dropdown liệt kê mọi team kèm vai trò', async () => {
    render(<AuthProvider><TeamSwitcher /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('Dev13')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Dev13/ }));
    expect(screen.getByRole('option', { name: /Dev13/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /QA/ })).toBeInTheDocument();
    expect(screen.getByText('Leader')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
  });

  it('chọn team khác -> đổi ngay label + ghi nhớ vào localStorage (không cần tải lại trang)', async () => {
    render(<AuthProvider><TeamSwitcher /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('Dev13')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Dev13/ }));
    fireEvent.click(screen.getByRole('option', { name: /QA/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /QA/ })).toBeInTheDocument());
    expect(window.localStorage.getItem('tm.activeTeamId')).toBe('2');
  });
});
