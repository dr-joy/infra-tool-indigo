// CR-20260913 Giai đoạn 2 (Lát 8) — khu Admin (src/screens/admin.tsx). Test render + hành vi cơ bản
// của 7 mục con, dùng đúng khuôn mock fetch đã có (test/client/screens.test.tsx, team-switcher.test.tsx).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { AuthProvider } from '../../src/auth-context';
import { ToastProvider } from '../../src/context';
import { ManHinhAdmin } from '../../src/screens/admin';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const TEAMS = [
  { id: 1, name: 'Dev5', description: null, row_version: 1, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 2, name: 'Dev12', description: 'Team backend', row_version: 3, created_at: '2026-01-02T00:00:00.000Z' }
];
const VISIBILITY = [
  { team_id: 1, feature: 'personal_task', level: 'on', row_version: 1, updated_at: '' },
  { team_id: 1, feature: 'project', level: 'off', row_version: 1, updated_at: '' },
  { team_id: 1, feature: 'weekly_report', level: 'off', row_version: 1, updated_at: '' },
  { team_id: 1, feature: 'release', level: 'off', row_version: 1, updated_at: '' },
  { team_id: 1, feature: 'mind_map', level: 'off', row_version: 1, updated_at: '' },
  { team_id: 2, feature: 'personal_task', level: 'on', row_version: 1, updated_at: '' },
  { team_id: 2, feature: 'project', level: 'on', row_version: 1, updated_at: '' },
  { team_id: 2, feature: 'weekly_report', level: 'off', row_version: 1, updated_at: '' },
  { team_id: 2, feature: 'release', level: 'off', row_version: 1, updated_at: '' },
  { team_id: 2, feature: 'mind_map', level: 'off', row_version: 1, updated_at: '' }
];
const USERS = [
  { id: 1, email: 'admin@drjoy.jp', display_name: 'Admin Thật', avatar: null, status: 'active', system_role: 'admin', row_version: 1, created_at: '', last_login_at: null },
  { id: 2, email: 'member@drjoy.jp', display_name: 'Nguyễn Văn A', avatar: null, status: 'active', system_role: 'user', row_version: 2, created_at: '', last_login_at: '2026-09-20T10:00:00.000Z' }
];
const JOIN_REQUESTS = [
  { id: 10, user_id: 3, email: 'moi@drjoy.jp', display_name: 'Người Mới', requested_team_id: 1, requested_role: 'member', row_version: 1, created_at: '2026-09-22T00:00:00.000Z' }
];

function baseFetchMock(overrides?: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method || 'GET').toUpperCase();
    let parsedBody: unknown = null;
    if (typeof init?.body === 'string') { try { parsedBody = JSON.parse(init.body); } catch { /* ignore */ } }
    calls.push({ url: url.pathname + url.search, method, body: parsedBody });

    // Override đi TRƯỚC mọi mặc định cứng bên dưới — nếu không, 1 route đã có mặc định (vd GET
    // /api/admin/users) sẽ luôn "thắng" trước khi override kịp chạy tới.
    const key = `${method} ${url.pathname}`;
    if (overrides) {
      for (const [pattern, handler] of Object.entries(overrides)) {
        if (key === pattern || url.pathname === pattern) return handler(url, init);
      }
    }

    if (url.pathname === '/api/auth/me') {
      return jsonResponse({ user: { id: 1, email: 'admin@drjoy.jp', displayName: 'Admin Thật', avatar: null, status: 'active', systemRole: 'admin', memberships: [] } });
    }
    if (url.pathname === '/api/me/teams') return jsonResponse({ teams: [] });
    if (url.pathname === '/api/notifications') return jsonResponse({ notifications: [] });
    if (url.pathname === '/api/admin/teams' && method === 'GET') return jsonResponse({ teams: TEAMS, nextCursor: null });
    if (url.pathname === '/api/admin/feature-visibility' && method === 'GET') return jsonResponse({ visibility: VISIBILITY });
    if (url.pathname === '/api/admin/release-coordinator' && method === 'GET') return jsonResponse({ release_coordinator_team_id: 1, row_version: 1 });
    if (url.pathname === '/api/admin/release-task-autogen' && method === 'GET') return jsonResponse({ settings: [{ team_id: 1, enabled: 0, row_version: 1, updated_at: '' }, { team_id: 2, enabled: 1, row_version: 2, updated_at: '' }] });
    if (url.pathname === '/api/admin/join-requests' && method === 'GET') return jsonResponse({ joinRequests: JOIN_REQUESTS });
    if (url.pathname === '/api/admin/users' && method === 'GET') return jsonResponse({ users: USERS });
    if (url.pathname === '/api/audit') return jsonResponse({ entries: [{ id: 1, actorUserId: 1, teamId: 1, action: 'team.create', createdAt: '2026-09-22T00:00:00.000Z' }], nextCursor: null });
    if (url.pathname === '/api/admin/redmine-url' && method === 'GET') return jsonResponse({ baseUrl: 'https://redmine.example.com' });

    return jsonResponse({ message: `unmocked ${key}` }, 404);
  }) as unknown as typeof fetch;
  return calls;
}

function renderAdmin() {
  return render(<AuthProvider><ToastProvider><ManHinhAdmin /></ToastProvider></AuthProvider>);
}

beforeEach(() => { window.localStorage.clear(); });

describe('ManHinhAdmin — mục Team', () => {
  it('hiện danh sách team đã có, tạo team mới gọi đúng POST /api/admin/teams', async () => {
    const calls = baseFetchMock();
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Dev5')).toBeInTheDocument());
    expect(screen.getByText('Dev12')).toBeInTheDocument();
    expect(screen.getByText('Team backend')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Tên team…'), { target: { value: 'Team Mới' } });
    fireEvent.click(screen.getByRole('button', { name: /Tạo team/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/teams')).toBe(true));
    const createCall = calls.find((c) => c.method === 'POST' && c.url === '/api/admin/teams');
    expect(createCall?.body).toMatchObject({ name: 'Team Mới' });
  });

  it('bấm "Đổi Leader" -> mở popup gọi GET /api/admin/teams/:id/members, chọn người -> POST /api/admin/teams/:id/leader kèm rowVersion', async () => {
    const calls = baseFetchMock({
      'GET /api/admin/teams/1/members': () => jsonResponse({ members: [{ id: 5, email: 'a@drjoy.jp', display_name: 'Ứng viên A', avatar: null, role: 'member' }] })
    });
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Dev5')).toBeInTheDocument());

    // TEAMS[0] = Dev5 -> nút "Đổi Leader" đầu tiên theo đúng thứ tự render.
    fireEvent.click(screen.getAllByRole('button', { name: 'Đổi Leader' })[0]);

    await waitFor(() => expect(screen.getByText(/Ứng viên A/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/teams/1/leader')).toBe(true));
    const call = calls.find((c) => c.method === 'POST' && c.url === '/api/admin/teams/1/leader');
    expect(call?.body).toMatchObject({ userId: 5, rowVersion: 1 });
  });
});

describe('ManHinhAdmin — mục Hiển thị chức năng', () => {
  it('bấm toggle dạng switch gọi đúng PATCH kèm team/feature/level/rowVersion', async () => {
    const calls = baseFetchMock();
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Hiển thị chức năng' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Task cá nhân — Dev5' })).toBeInTheDocument());

    // Dev5 x personal_task đang 'on' -> bấm để tắt.
    const switchEl = screen.getByRole('switch', { name: 'Task cá nhân — Dev5' });
    expect(switchEl).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(switchEl);

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url === '/api/admin/feature-visibility')).toBe(true));
    const call = calls.find((c) => c.method === 'PATCH' && c.url === '/api/admin/feature-visibility');
    expect(call?.body).toMatchObject({ teamId: 1, feature: 'personal_task', level: 'off', rowVersion: 1 });

    // Dev5 x project đang 'off' -> đúng aria-checked="false".
    expect(screen.getByRole('switch', { name: 'Project — Dev5' })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('ManHinhAdmin — mục Release', () => {
  it('đổi team điều phối gọi PUT /api/admin/release-coordinator; đổi Tab cá nhân gọi PUT /api/admin/release-task-autogen', async () => {
    const calls = baseFetchMock();
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(screen.getByText('Team điều phối Release')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/admin/release-coordinator')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/admin/release-coordinator')?.body).toMatchObject({ teamId: 2, rowVersion: 1 });

    // Fixture: Dev5 autogen enabled=0 ("Tắt", nút duy nhất mang chữ này trong tab Release — Dev12 đang
    // "Bật") -> bấm nút này để bật Dev5.
    fireEvent.click(screen.getByText('Tắt'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/admin/release-task-autogen')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/admin/release-task-autogen')?.body).toMatchObject({ teamId: 1, enabled: true, rowVersion: 1 });
  });
});

describe('ManHinhAdmin — mục Yêu cầu tham gia', () => {
  it('duyệt yêu cầu -> POST approve kèm rowVersion + team/vai trò mặc định giữ nguyên yêu cầu gốc', async () => {
    const calls = baseFetchMock();
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu tham gia' }));
    await waitFor(() => expect(screen.getByText('Người Mới')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/join-requests/10/approve')).toBe(true));
    const call = calls.find((c) => c.url === '/api/admin/join-requests/10/approve');
    expect(call?.body).toMatchObject({ rowVersion: 1, approvedTeamId: 1, approvedRole: 'member' });
  });

  it('từ chối yêu cầu -> POST reject kèm rowVersion', async () => {
    const calls = baseFetchMock();
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu tham gia' }));
    await waitFor(() => expect(screen.getByText('Người Mới')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/join-requests/10/reject')).toBe(true));
  });
});

describe('ManHinhAdmin — mục Tài khoản', () => {
  it('không cho tự khoá chính mình (nút Khoá bị disable ở đúng dòng của actor)', async () => {
    baseFetchMock();
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    await waitFor(() => expect(screen.getByText('Admin Thật')).toBeInTheDocument());

    const adminRow = screen.getByText('Admin Thật').closest('tr')!;
    expect(within(adminRow).getByRole('button', { name: 'Khoá' })).toBeDisabled();

    const otherRow = screen.getByText('Nguyễn Văn A').closest('tr')!;
    expect(within(otherRow).getByRole('button', { name: 'Khoá' })).not.toBeDisabled();
  });

  it('khoá tài khoản người khác -> POST disable kèm rowVersion', async () => {
    const calls = baseFetchMock();
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    await waitFor(() => expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument());

    const otherRow = screen.getByText('Nguyễn Văn A').closest('tr')!;
    fireEvent.click(within(otherRow).getByRole('button', { name: 'Khoá' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/users/2/disable')).toBe(true));
    expect(calls.find((c) => c.url === '/api/admin/users/2/disable')?.body).toMatchObject({ rowVersion: 2 });
  });

  it('chỉ còn 1 Admin -> nút Hạ quyền Admin bị disable (chặn phía client, khớp luật server)', async () => {
    baseFetchMock();
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    await waitFor(() => expect(screen.getByText('Admin Thật')).toBeInTheDocument());

    const adminRow = screen.getByText('Admin Thật').closest('tr')!;
    expect(within(adminRow).getByRole('button', { name: 'Hạ quyền Admin' })).toBeDisabled();
  });

  it('gán quyền Admin cho user thường -> POST promote-admin kèm rowVersion', async () => {
    const calls = baseFetchMock();
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    await waitFor(() => expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument());

    const otherRow = screen.getByText('Nguyễn Văn A').closest('tr')!;
    fireEvent.click(within(otherRow).getByRole('button', { name: 'Gán quyền Admin' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/users/2/promote-admin')).toBe(true));
    expect(calls.find((c) => c.url === '/api/admin/users/2/promote-admin')?.body).toMatchObject({ rowVersion: 2 });
  });

  it('còn ≥2 Admin -> hạ quyền Admin của người khác gọi đúng POST demote-admin', async () => {
    const calls = baseFetchMock({
      'GET /api/admin/users': () => jsonResponse({
        users: [...USERS, { id: 3, email: 'admin2@drjoy.jp', display_name: 'Admin Hai', avatar: null, status: 'active', system_role: 'admin', row_version: 1, created_at: '', last_login_at: null }]
      })
    });
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    await waitFor(() => expect(screen.getByText('Admin Hai')).toBeInTheDocument());

    const secondAdminRow = screen.getByText('Admin Hai').closest('tr')!;
    const btn = within(secondAdminRow).getByRole('button', { name: 'Hạ quyền Admin' });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/users/3/demote-admin')).toBe(true));
    expect(calls.find((c) => c.url === '/api/admin/users/3/demote-admin')?.body).toMatchObject({ rowVersion: 1 });
  });

  it('Admin thứ 2 đã bị khoá không tính -> Admin active duy nhất vẫn không hạ quyền được; user pending không có nút Gán quyền Admin', async () => {
    baseFetchMock({
      'GET /api/admin/users': () => jsonResponse({
        users: [
          ...USERS,
          { id: 3, email: 'admin2@drjoy.jp', display_name: 'Admin Bị Khoá', avatar: null, status: 'disabled', system_role: 'admin', row_version: 1, created_at: '', last_login_at: null },
          { id: 4, email: 'moi@drjoy.jp', display_name: 'Người Chờ Duyệt', avatar: null, status: 'pending', system_role: 'user', row_version: 1, created_at: '', last_login_at: null }
        ]
      })
    });
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    await waitFor(() => expect(screen.getByText('Người Chờ Duyệt')).toBeInTheDocument());

    expect(within(screen.getByText('Admin Thật').closest('tr')!).getByRole('button', { name: 'Hạ quyền Admin' })).toBeDisabled();
    expect(within(screen.getByText('Admin Bị Khoá').closest('tr')!).getByRole('button', { name: 'Hạ quyền Admin' })).not.toBeDisabled();
    expect(within(screen.getByText('Người Chờ Duyệt').closest('tr')!).queryByRole('button', { name: 'Gán quyền Admin' })).toBeNull();
  });
});

describe('ManHinhAdmin — mục Nhật ký', () => {
  it('hiện đúng tên người + tên team (join phía FE từ users/teams đã tải), không lộ payload', async () => {
    baseFetchMock();
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Nhật ký' }));
    await waitFor(() => expect(screen.getByText('team.create')).toBeInTheDocument());
    expect(screen.getByText('Admin Thật')).toBeInTheDocument();
    expect(screen.getByText('Dev5')).toBeInTheDocument();
  });
});

describe('ManHinhAdmin — mục Redmine', () => {
  it('hiện URL hiện tại, lưu URL mới -> PUT kèm https bắt buộc', async () => {
    const calls = baseFetchMock({
      'PUT /api/admin/redmine-url': (_u, init) => {
        const body = JSON.parse(String(init?.body));
        return jsonResponse({ baseUrl: body.baseUrl });
      }
    });
    renderAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'Redmine' }));
    await waitFor(() => expect(screen.getByText('https://redmine.example.com')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('https://redmine.example.com'), { target: { value: 'https://redmine2.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/admin/redmine-url')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/admin/redmine-url')?.body).toMatchObject({ baseUrl: 'https://redmine2.example.com' });
  });
});
