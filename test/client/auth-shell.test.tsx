// CR-20260913 §6.1/§6.1a — vỏ xác thực: "Chọn team và vai trò" <-> "Đang chờ duyệt" (src/screens/auth-shell.tsx).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../../src/auth-context';
import { AuthShell } from '../../src/screens/auth-shell';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('AuthShell — luồng onboarding (FR-2/FR-3/FR-3a)', () => {
  it('pending chưa từng gửi đơn -> màn "Chọn team và vai trò", gửi xong -> chuyển "Đang chờ duyệt"', async () => {
    let joinRequestSubmitted = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/auth/me') {
        return jsonResponse({ user: { id: 5, email: 'p@drjoy.jp', displayName: 'Người mới', avatar: null, status: 'pending', systemRole: 'user', memberships: [] } });
      }
      if (url.pathname === '/api/onboarding/my-join-request') {
        return jsonResponse({ joinRequest: joinRequestSubmitted ? { id: 1, teamId: 10, teamName: 'Dev13', role: 'member' } : null });
      }
      if (url.pathname === '/api/teams') {
        return jsonResponse({ teams: [{ id: 10, name: 'Dev13', description: 'Team phát triển' }] });
      }
      if (url.pathname === '/api/onboarding/join-request' && init?.method === 'POST') {
        joinRequestSubmitted = true;
        return jsonResponse({ id: 1 }, 201);
      }
      return jsonResponse({ message: `unmocked ${url.pathname}` }, 404);
    }) as unknown as typeof fetch;

    render(<AuthProvider><AuthShell><div>App thật</div></AuthShell></AuthProvider>);

    await waitFor(() => expect(screen.getByText('Chọn team và vai trò')).toBeInTheDocument());
    // Đợi danh sách team nạp xong (select có option Dev13) trước khi submit — giống người dùng thật
    // phải thấy dropdown có dữ liệu mới bấm gửi.
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('10'));
    fireEvent.submit(screen.getByRole('button', { name: /Gửi yêu cầu tham gia/ }).closest('form')!);

    await waitFor(() => expect(screen.getByText('Đang chờ Admin duyệt')).toBeInTheDocument());
    expect(screen.getByText('Dev13')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
  });

  it('active -> render children (app thật), không hiện màn onboarding nào', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/auth/me') {
        return jsonResponse({ user: { id: 1, email: 'a@drjoy.jp', displayName: 'X', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'member' }] } });
      }
      if (url.pathname === '/api/me/teams') return jsonResponse({ teams: [{ id: 1, name: 'Dev13', description: null, role: 'member' }] });
      if (url.pathname === '/api/notifications') return jsonResponse({ notifications: [] });
      return jsonResponse({ message: `unmocked ${url.pathname}` }, 404);
    }) as unknown as typeof fetch;

    render(<AuthProvider><AuthShell><div>App thật</div></AuthShell></AuthProvider>);
    await waitFor(() => expect(screen.getByText('App thật')).toBeInTheDocument());
  });
});
