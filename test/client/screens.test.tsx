import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LangProvider } from '../../src/useLang';
import { PicProvider, ToastProvider, usePics } from '../../src/context';
import { AuthProvider, useAuth } from '../../src/auth-context';
import { ManHinhProject } from '../../src/screens/project';
import { ManHinhBaoCaoTuan } from '../../src/screens/weekly';
import { ManHinhLenLich } from '../../src/screens/release';
import { ManHinhQuanLyDanhMuc } from '../../src/screens/settings';

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Đổi team qua đúng context thật (setActiveTeamId của AuthContext) — tương đương thao tác bấm bộ
// chọn team ở TeamSwitcher, không giả lập tay state nội bộ màn hình.
function SwitchTeamButton({ toTeamId }: { toTeamId: number }) {
  const { setActiveTeamId } = useAuth();
  return <button type="button" onClick={() => setActiveTeamId(toTeamId)}>{`switch-to-${toTeamId}`}</button>;
}

function ActiveTeamProbe() {
  const { activeTeamId } = useAuth();
  return <span data-testid="active-team-probe">{String(activeTeamId)}</span>;
}

// Council review Lát 7 giai đoạn 1 tìm ra race condition: đổi team A -> B trước khi response của A
// (đang chậm) trả lời xong khiến dữ liệu team A cũ ghi đè lên màn đang hiển thị team B. Test dưới mô
// phỏng đúng kịch bản: team 1 trả lời CHẬM (delay), team 2 trả lời NGAY — bấm đổi 1 -> 2 trong lúc
// request của team 1 vẫn đang treo, rồi đợi đủ lâu hơn cả độ trễ của team 1 để nếu KHÔNG có
// cancellation guard (aliveRef) thì response cũ đã kịp ghi đè state.
function mockTwoTeamsRace(route: { match: (pathname: string) => boolean; slowBody: unknown; fastBody: unknown }) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/auth/me') {
      return jsonResponse({ user: { id: 1, email: 'a@drjoy.jp', displayName: 'X', avatar: null, status: 'active', systemRole: 'user', memberships: [{ teamId: 1, role: 'leader' }, { teamId: 2, role: 'member' }] } });
    }
    if (url.pathname === '/api/me/teams') {
      return jsonResponse({ teams: [{ id: 1, name: 'Dev13', description: null, role: 'leader' }, { id: 2, name: 'QA', description: null, role: 'member' }] });
    }
    if (url.pathname === '/api/notifications') return jsonResponse({ notifications: [] });
    const teamId = url.searchParams.get('teamId');
    if (route.match(url.pathname)) {
      if (teamId === '1') { await delay(60); return jsonResponse(route.slowBody); }
      if (teamId === '2') return jsonResponse(route.fastBody);
    }
    // fallback an toàn cho các route khác mà màn hình gọi lúc mount (pics, badge, week goals, tasks...)
    if (/^\/api\/weeks\/[^/]+\/goals$/.test(url.pathname)) return jsonResponse({ hasGoals: false, prevEvaluated: false, goals: [] });
    return jsonResponse([]);
  }) as unknown as typeof fetch;
}

describe('Race condition khi đổi team nhanh (Council review Lát 7 giai đoạn 1)', () => {
  // setActiveTeamId() ghi vào localStorage (ghi nhớ lựa chọn qua reload) -> phải dọn giữa các test,
  // nếu không test sau sẽ tự động khởi động ở team 2 do readStoredTeamId() đọc thấy giá trị test
  // trước để lại (xem test/client/team-switcher.test.tsx — cùng cần beforeEach này).
  beforeEach(() => window.localStorage.clear());

  it('ManHinhProject: đổi team A -> B trước khi response project của A về -> danh sách vẫn đúng team B, không bị ghi đè', async () => {
    mockTwoTeamsRace({
      match: (p) => p === '/api/projects',
      slowBody: [{ id: 'p1', ten: 'Du an team Dev13 (cu)', pic: '', ngayBatDau: '2026-01-01', moTa: '', sortOrder: 1, closedAt: null, pendingAt: null, isSystem: false }],
      fastBody: [{ id: 'p2', ten: 'Du an team QA (moi)', pic: '', ngayBatDau: '2026-01-01', moTa: '', sortOrder: 1, closedAt: null, pendingAt: null, isSystem: false }]
    });

    render(
      <LangProvider>
        <AuthProvider>
          <ToastProvider>
            <PicProvider>
              <ActiveTeamProbe />
              <SwitchTeamButton toTeamId={2} />
              <ManHinhProject />
            </PicProvider>
          </ToastProvider>
        </AuthProvider>
      </LangProvider>
    );

    // Đợi tới khi team 1 THỰC SỰ đang là team hiện tại (request chậm của team 1 đã bắt đầu) rồi mới đổi.
    await waitFor(() => expect(screen.getByTestId('active-team-probe').textContent).toBe('1'));
    fireEvent.click(screen.getByText('switch-to-2'));

    // "Du an team QA (moi)" xuất hiện 2 chỗ (item trong sidebar + tiêu đề chi tiết project) nên dùng
    // getAllByText thay vì getByText (getByText đòi đúng 1 phần tử khớp).
    await waitFor(() => expect(screen.getAllByText('Du an team QA (moi)').length).toBeGreaterThan(0));
    await delay(120);
    expect(screen.queryAllByText('Du an team Dev13 (cu)')).toHaveLength(0);
    expect(screen.getAllByText('Du an team QA (moi)').length).toBeGreaterThan(0);
  });

  it('ManHinhBaoCaoTuan: đổi team A -> B trước khi response report-kinds của A về -> vẫn hiển thị đúng loại báo cáo của team B', async () => {
    mockTwoTeamsRace({
      match: (p) => p === '/api/weeks/report-kinds',
      slowBody: { currentWeek: '2026-01-05', kinds: [{ id: 'internal', label: 'Bao cao Dev13 (cu)', lang: 'vi' }] },
      fastBody: { currentWeek: '2026-02-02', kinds: [{ id: 'internal', label: 'Bao cao QA (moi)', lang: 'vi' }] }
    });

    render(
      <LangProvider>
        <AuthProvider>
          <ToastProvider>
            <PicProvider>
              <ActiveTeamProbe />
              <SwitchTeamButton toTeamId={2} />
              <ManHinhBaoCaoTuan />
            </PicProvider>
          </ToastProvider>
        </AuthProvider>
      </LangProvider>
    );

    await waitFor(() => expect(screen.getByTestId('active-team-probe').textContent).toBe('1'));
    fireEvent.click(screen.getByText('switch-to-2'));

    await waitFor(() => expect(screen.getByText('Bao cao QA (moi)')).toBeInTheDocument());
    await delay(120);
    expect(screen.queryByText('Bao cao Dev13 (cu)')).not.toBeInTheDocument();
    expect(screen.getByText('Bao cao QA (moi)')).toBeInTheDocument();
  });

  it('PicProvider.reloadPics(): đổi team A -> B trước khi response PIC của A về -> danh sách PIC vẫn đúng team B', async () => {
    mockTwoTeamsRace({
      match: (p) => p === '/api/pics',
      slowBody: [{ id: 'x1', name: 'PIC Dev13 cu', color: null, sortOrder: 1 }],
      fastBody: [{ id: 'x2', name: 'PIC QA moi', color: null, sortOrder: 1 }]
    });

    function PicsProbe() {
      const { pics } = usePics();
      return <div data-testid="pics">{pics.join(',')}</div>;
    }

    render(
      <LangProvider>
        <AuthProvider>
          <ToastProvider>
            <PicProvider>
              <ActiveTeamProbe />
              <SwitchTeamButton toTeamId={2} />
              <PicsProbe />
            </PicProvider>
          </ToastProvider>
        </AuthProvider>
      </LangProvider>
    );

    await waitFor(() => expect(screen.getByTestId('active-team-probe').textContent).toBe('1'));
    fireEvent.click(screen.getByText('switch-to-2'));

    await waitFor(() => expect(screen.getByTestId('pics').textContent).toBe('PIC QA moi'));
    await delay(120);
    expect(screen.getByTestId('pics').textContent).toBe('PIC QA moi');
  });

  it('Màn Cài đặt (Quản lý PIC): đổi team A -> B trước khi response /api/pics của A về -> danh sách PIC hiển thị vẫn đúng team B', async () => {
    mockTwoTeamsRace({
      match: (p) => p === '/api/pics',
      slowBody: [{ id: 'x1', name: 'PIC Dev13 cu', color: null, sortOrder: 1 }],
      fastBody: [{ id: 'x2', name: 'PIC QA moi', color: null, sortOrder: 1 }]
    });

    render(
      <LangProvider>
        <AuthProvider>
          <ToastProvider>
            <PicProvider>
              <ActiveTeamProbe />
              <SwitchTeamButton toTeamId={2} />
              <ManHinhQuanLyDanhMuc />
            </PicProvider>
          </ToastProvider>
        </AuthProvider>
      </LangProvider>
    );

    await waitFor(() => expect(screen.getByTestId('active-team-probe').textContent).toBe('1'));
    fireEvent.click(screen.getByText('switch-to-2'));

    await waitFor(() => expect(screen.getByText('PIC QA moi')).toBeInTheDocument());
    await delay(120);
    expect(screen.queryByText('PIC Dev13 cu')).not.toBeInTheDocument();
    expect(screen.getByText('PIC QA moi')).toBeInTheDocument();
  });
});
