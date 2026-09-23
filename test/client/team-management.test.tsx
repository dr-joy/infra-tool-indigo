// CR-20260913 Giai đoạn 2 (Lát 9) — màn Quản lý team (src/screens/team-management.tsx).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { AuthProvider } from '../../src/auth-context';
import { ToastProvider } from '../../src/context';
import { ManHinhQuanLyTeam } from '../../src/screens/team-management';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const MEMBERS = [
  { id: 1, email: 'leader@drjoy.jp', display_name: 'Leader Chính', avatar: null, role: 'leader' as const },
  { id: 2, email: 'member@drjoy.jp', display_name: 'Member Phụ', avatar: null, role: 'member' as const }
];

function baseFetchMock(actorRole: 'leader' | 'member', overrides?: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method || 'GET').toUpperCase();
    let parsedBody: unknown = null;
    if (typeof init?.body === 'string') { try { parsedBody = JSON.parse(init.body); } catch { /* ignore */ } }
    calls.push({ url: url.pathname + url.search, method, body: parsedBody });

    if (url.pathname === '/api/auth/me') {
      const actorId = actorRole === 'leader' ? 1 : 2;
      return jsonResponse({ user: { id: actorId, email: MEMBERS.find((m) => m.id === actorId)!.email, displayName: MEMBERS.find((m) => m.id === actorId)!.display_name, avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: actorRole }] } });
    }
    if (url.pathname === '/api/me/teams') return jsonResponse({ teams: [{ id: 1, name: 'Dev5', description: 'Team backend', role: actorRole }] });
    if (url.pathname === '/api/notifications') return jsonResponse({ notifications: [] });
    if (url.pathname === '/api/teams/1/members' && method === 'GET') return jsonResponse({ members: MEMBERS });
    if (url.pathname === '/api/audit' && method === 'GET') {
      return jsonResponse({ entries: [{ id: 1, actorUserId: 1, teamId: 1, action: 'team_member.add', target: 'user:2', payload: {}, createdAt: '2026-09-22T00:00:00.000Z' }], nextCursor: null });
    }

    const key = `${method} ${url.pathname}${url.search}`;
    if (overrides) {
      for (const [pattern, handler] of Object.entries(overrides)) {
        if (key === pattern || key.startsWith(pattern) || url.pathname === pattern) return handler(url, init);
      }
    }
    return jsonResponse({ message: `unmocked ${key}` }, 404);
  }) as unknown as typeof fetch;
  return calls;
}

function renderScreen() {
  return render(<AuthProvider><ToastProvider><ManHinhQuanLyTeam /></ToastProvider></AuthProvider>);
}

beforeEach(() => { window.localStorage.clear(); });

describe('ManHinhQuanLyTeam — Tổng quan', () => {
  it('hiện tên team, vai trò, Leader hiện tại, số thành viên', async () => {
    baseFetchMock('leader');
    renderScreen();
    await waitFor(() => expect(screen.getByRole('heading', { name: /Dev5/ })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Leader Chính')).toBeInTheDocument());
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('ManHinhQuanLyTeam — Thành viên', () => {
  it('Member KHÔNG thấy nút Thêm/Bớt, chỉ xem danh sách', async () => {
    baseFetchMock('member');
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Thành viên' }));
    await waitFor(() => expect(screen.getByText('Leader Chính')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Thêm thành viên/ })).not.toBeInTheDocument();
  });

  it('Leader tra email tìm thấy -> thêm thành viên gọi đúng POST kèm userId', async () => {
    const calls = baseFetchMock('leader', {
      'GET /api/teams/1/member-candidates': () => jsonResponse({ user: { id: 3, email: 'new@drjoy.jp', display_name: 'Người Mới' } }),
      'POST /api/teams/1/members': () => jsonResponse({ ok: true }, 201)
    });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Thành viên' }));
    await waitFor(() => expect(screen.getByText('Leader Chính')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Thêm thành viên/ }));
    fireEvent.change(screen.getByPlaceholderText('Email…'), { target: { value: 'new@drjoy.jp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tra cứu' }));

    await waitFor(() => expect(screen.getByText('Người Mới')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Thêm vào team' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/teams/1/members')).toBe(true));
    const call = calls.find((c) => c.method === 'POST' && c.url === '/api/teams/1/members');
    expect(call?.body).toMatchObject({ userId: 3, teamId: 1 });
  });

  it('Leader bớt thành viên -> hiện cảnh báo số task chưa xong TRƯỚC khi xác nhận, xác nhận gọi đúng DELETE', async () => {
    const calls = baseFetchMock('leader', {
      'GET /api/teams/1/members/2/pending-task-count': () => jsonResponse({ count: 3 }),
      'DELETE /api/teams/1/members/2': () => jsonResponse({ ok: true })
    });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Thành viên' }));
    await waitFor(() => expect(screen.getByText('Member Phụ')).toBeInTheDocument());

    const memberRow = screen.getByText('Member Phụ').closest('div')!.parentElement!.parentElement!;
    fireEvent.click(within(memberRow).getByTitle('Bớt khỏi team'));

    await waitFor(() => expect(screen.getByText(/3/)).toBeInTheDocument());
    expect(screen.getByText(/task project chưa hoàn thành/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận bớt' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/teams/1/members/2')).toBe(true));
  });
});

describe('ManHinhQuanLyTeam — Nhật ký', () => {
  it('Member cũng xem được nhật ký chi tiết đầy đủ (FR-11a), hiện đúng tên người + target', async () => {
    baseFetchMock('member');
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Nhật ký' }));
    await waitFor(() => expect(screen.getByText('team_member.add')).toBeInTheDocument());
    expect(screen.getByText('Leader Chính')).toBeInTheDocument();
    expect(screen.getByText('user:2')).toBeInTheDocument();
  });
});
