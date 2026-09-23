// CR-20260913 Giai đoạn 2 (Lát 10) — Lịch release chung (src/screens/release-calendar.tsx).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { AuthProvider } from '../../src/auth-context';
import { ToastProvider } from '../../src/context';
import { ManHinhLichReleaseChung } from '../../src/screens/release-calendar';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const TEAMS = [{ id: 1, name: 'Dev5', description: null }, { id: 2, name: 'Dev12', description: null }];

const REG_A_FULL = {
  id: 100, cycleId: 10, teamId: 1, deployStagingAt: '2026-10-05T13:00', releaseAt: '2026-10-05T15:00', deployDemoAt: '2026-10-05T16:00',
  affectedSystems: ['Dr.JOY'], platforms: ['Web'], ticketNumbers: [123], japanCoordinationLink: 'https://example.com/t/1',
  noJapanCoordinationReason: null, notes: '', status: 'submitted' as const, rowVersion: 1, createdAt: '', updatedAt: ''
};
const REG_B_BOARD = {
  id: 101, cycleId: 10, teamId: 2, deployStagingAt: '2026-10-05T14:00', releaseAt: '2026-10-05T16:30', deployDemoAt: '2026-10-05T16:00',
  affectedSystems: ['Pr.JOY'], platforms: ['Mobile'], status: 'submitted' as const
};

function baseFetchMock(opts: {
  role: 'leader' | 'member'; teamId: number; coordinatorTeamId: number | null;
  overrides?: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>>;
}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method || 'GET').toUpperCase();
    let parsedBody: unknown = null;
    if (typeof init?.body === 'string') { try { parsedBody = JSON.parse(init.body); } catch { /* ignore */ } }
    calls.push({ url: url.pathname + url.search, method, body: parsedBody });

    // Override đi TRƯỚC mọi mặc định cứng bên dưới — mỗi test tự chỉnh đúng phần mình cần (schedule-
    // board/unlock-requests/regular-cycles đều có thể bị override), không để nhánh mặc định "thắng"
    // trước khi override kịp chạy tới.
    const key = `${method} ${url.pathname}`;
    if (opts.overrides) {
      for (const [pattern, handler] of Object.entries(opts.overrides)) {
        if (key === pattern || key.startsWith(pattern)) return handler(url, init);
      }
    }

    if (url.pathname === '/api/auth/me') {
      return jsonResponse({ user: { id: 1, email: 'a@drjoy.jp', displayName: 'A', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: opts.teamId, role: opts.role }] } });
    }
    if (url.pathname === '/api/me/teams') return jsonResponse({ teams: [{ id: opts.teamId, name: TEAMS.find((t) => t.id === opts.teamId)!.name, description: null, role: opts.role }] });
    if (url.pathname === '/api/notifications') return jsonResponse({ notifications: [] });
    if (url.pathname === '/api/teams') return jsonResponse({ teams: TEAMS });
    if (url.pathname === '/api/release/schedule/regular-cycles' && method === 'GET') return jsonResponse([]);
    if (url.pathname === '/api/release/schedule-board' && method === 'GET') {
      return jsonResponse({
        cycles: [{ id: 10, releaseKey: 'emergency:2026-10-05', status: 'open', lockedAt: null, registrations: [REG_A_FULL, REG_B_BOARD], conflicts: [] }],
        coordinatorTeamId: opts.coordinatorTeamId
      });
    }
    if (url.pathname === '/api/release/schedule/unlock-requests' && method === 'GET') {
      if (opts.coordinatorTeamId !== opts.teamId) return jsonResponse({ message: 'not coordinator' }, 403);
      return jsonResponse([]);
    }

    return jsonResponse({ message: `unmocked ${key}` }, 404);
  }) as unknown as typeof fetch;
  return calls;
}

function renderScreen() {
  return render(<AuthProvider><ToastProvider><ManHinhLichReleaseChung /></ToastProvider></AuthProvider>);
}

beforeEach(() => { window.localStorage.clear(); });

describe('ManHinhLichReleaseChung — board (FR-24)', () => {
  it('hiện đủ thông tin team mình (ticket/link Nhật), team khác chỉ thấy ngày/giờ/hệ thống/nền tảng', async () => {
    baseFetchMock({ role: 'leader', teamId: 1, coordinatorTeamId: null });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Dev5')).toBeInTheDocument());
    expect(screen.getByText('Dev12')).toBeInTheDocument();
    expect(screen.getByText(/#123/)).toBeInTheDocument();
    expect(screen.getByText(/Link Nhật/)).toBeInTheDocument();
  });

  it('Member không thấy nút Đăng ký', async () => {
    baseFetchMock({ role: 'member', teamId: 1, coordinatorTeamId: null });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Dev5')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Đăng ký lịch release khẩn cấp/ })).not.toBeInTheDocument();
  });
});

describe('ManHinhLichReleaseChung — đăng ký/sửa (FR-23a)', () => {
  it('Leader tạo đăng ký mới -> POST đúng payload theo teamId', async () => {
    const calls = baseFetchMock({
      role: 'leader', teamId: 1, coordinatorTeamId: null,
      overrides: { 'POST /api/release/schedule/registrations': () => jsonResponse({ ...REG_A_FULL, id: 999 }, 201) }
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Dev5')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Đăng ký lịch release khẩn cấp/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Ngày deploy staging'), { target: { value: '2026-11-01' } });
    fireEvent.change(within(dialog).getByLabelText('Giờ deploy staging'), { target: { value: '10:00' } });
    fireEvent.change(within(dialog).getByLabelText('Ngày release'), { target: { value: '2026-11-01' } });
    fireEvent.change(within(dialog).getByLabelText('Giờ release'), { target: { value: '13:00' } });
    fireEvent.click(within(dialog).getByLabelText('Dr.JOY'));
    fireEvent.click(within(dialog).getByLabelText('Web'));
    fireEvent.change(within(dialog).getByLabelText(/Lý do không có link/), { target: { value: 'Không cần báo Nhật' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Đăng ký' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/release/schedule/registrations')).toBe(true));
    const call = calls.find((c) => c.method === 'POST' && c.url === '/api/release/schedule/registrations');
    expect(call?.body).toMatchObject({
      teamId: 1, affectedSystems: ['Dr.JOY'], platforms: ['Web'], noJapanCoordinationReason: 'Không cần báo Nhật'
    });
  });

  it('Leader sửa đăng ký của team mình -> PATCH kèm rowVersion', async () => {
    const calls = baseFetchMock({
      role: 'leader', teamId: 1, coordinatorTeamId: null,
      overrides: { 'PATCH /api/release/schedule/registrations/100': () => jsonResponse({ ...REG_A_FULL, notes: 'đổi rồi' }) }
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Dev5')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url === '/api/release/schedule/registrations/100')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ rowVersion: 1 });
  });

  it('Leader huỷ trực tiếp (chưa khoá) -> POST cancel kèm rowVersion', async () => {
    const calls = baseFetchMock({
      role: 'leader', teamId: 1, coordinatorTeamId: null,
      overrides: { 'POST /api/release/schedule/registrations/100/cancel': () => jsonResponse({ ...REG_A_FULL, status: 'cancelled' }) }
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Dev5')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/release/schedule/registrations/100/cancel')).toBe(true));
    expect(calls.find((c) => c.url.includes('/cancel'))?.body).toMatchObject({ rowVersion: 1 });
  });
});

describe('ManHinhLichReleaseChung — khoá/mở khoá (FR-26)', () => {
  it('Leader điều phối thấy nút Khoá lịch, Leader thường thì không', async () => {
    baseFetchMock({ role: 'leader', teamId: 1, coordinatorTeamId: 1 });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Dev5')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Khoá lịch' })).toBeInTheDocument();
  });

  it('team đang locked -> Leader team đó thấy nút gửi yêu cầu, gửi đúng kind+reason', async () => {
    const lockedReg = { ...REG_A_FULL, status: 'locked' as const };
    const calls = baseFetchMock({
      role: 'leader', teamId: 1, coordinatorTeamId: null,
      overrides: {
        'GET /api/release/schedule-board': () => jsonResponse({
          cycles: [{ id: 10, releaseKey: 'emergency:2026-10-05', status: 'open', lockedAt: '2026-09-20T00:00:00Z', registrations: [lockedReg, REG_B_BOARD], conflicts: [] }],
          coordinatorTeamId: null
        }),
        'POST /api/release/schedule/registrations/100/unlock-requests': () => jsonResponse({ id: 500 }, 201)
      }
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Dev5')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Gửi yêu cầu mở khoá/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Lý do…'), { target: { value: 'cần đổi giờ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gửi yêu cầu' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/release/schedule/registrations/100/unlock-requests')).toBe(true));
    expect(calls.find((c) => c.url.includes('unlock-requests'))?.body).toMatchObject({ kind: 'edit', reason: 'cần đổi giờ' });
  });

  it('Leader điều phối thấy danh sách yêu cầu chờ duyệt + bấm Duyệt gọi đúng route', async () => {
    const calls = baseFetchMock({
      role: 'leader', teamId: 1, coordinatorTeamId: 1,
      overrides: {
        'GET /api/release/schedule/unlock-requests': () => jsonResponse([{ id: 500, registrationId: 101, kind: 'edit', reason: 'cần sửa', createdAt: '', teamId: 2, cycleId: 10 }]),
        'POST /api/release/schedule/unlock-requests/500/approve': () => jsonResponse({ ok: true })
      }
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Yêu cầu đang chờ duyệt')).toBeInTheDocument());
    expect(screen.getByText('cần sửa')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/release/schedule/unlock-requests/500/approve')).toBe(true));
  });
});

describe('ManHinhLichReleaseChung — xung đột + ép giờ chung (FR-25)', () => {
  it('Leader điều phối thấy nút Ép giờ chung khi có conflict open; gọi đúng route kèm giờ mới', async () => {
    const calls = baseFetchMock({
      role: 'leader', teamId: 1, coordinatorTeamId: 1,
      overrides: {
        'GET /api/release/schedule-board': () => jsonResponse({
          cycles: [{
            id: 10, releaseKey: 'emergency:2026-10-05', status: 'open', lockedAt: null,
            registrations: [REG_A_FULL, REG_B_BOARD],
            conflicts: [{ id: 700, registration_a_id: 100, registration_b_id: 101, status: 'open' }]
          }],
          coordinatorTeamId: 1
        }),
        'POST /api/release/schedule/conflicts/700/force-time': () => jsonResponse({ ok: true })
      }
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Xung đột lịch')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Ép giờ chung' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Ngày/), { target: { value: '2026-10-05' } });
    fireEvent.change(within(dialog).getByLabelText('Giờ deploy staging'), { target: { value: '13:00' } });
    fireEvent.change(within(dialog).getByLabelText('Giờ release'), { target: { value: '15:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận ép giờ' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/release/schedule/conflicts/700/force-time')).toBe(true));
    expect(calls.find((c) => c.url.includes('force-time'))?.body).toMatchObject({
      deployStagingAt: { date: '2026-10-05', time: '13:00' }, releaseAt: { date: '2026-10-05', time: '15:00' }
    });
  });
});

describe('ManHinhLichReleaseChung — định kỳ (FR-23b)', () => {
  it('Leader điều phối ấn định ngày -> POST đúng regularReleaseDate', async () => {
    const calls = baseFetchMock({
      role: 'leader', teamId: 1, coordinatorTeamId: 1,
      overrides: { 'POST /api/release/schedule/regular-cycles': () => jsonResponse({ id: 1, releaseKey: 'regular:2026-11-01', regularReleaseDate: '2026-11-01' }, 201) }
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Ấn định ngày release định kỳ/)).toBeInTheDocument());

    const dateInput = screen.getByText(/Ấn định ngày release định kỳ/).closest('div')!.parentElement!.querySelector('input[type="date"]')!;
    fireEvent.change(dateInput, { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ấn định' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/release/schedule/regular-cycles')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.includes('regular-cycles'))?.body).toMatchObject({ regularReleaseDate: '2026-11-01' });
  });
});
