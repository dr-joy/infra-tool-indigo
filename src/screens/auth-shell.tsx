// "Vỏ xác thực" — CR-20260913 §6.1/§6.1a: màn hình cho từng trạng thái phiên TRƯỚC khi vào app thật
// (logged_out/disabled/pending/error), cộng 2 popup bắt buộc (FR-3 "Đã cấp team/vai trò", và
// PermissionLostModal dùng chung cho FR-4a khi mất quyền GIỮA lúc đang dùng app active — import từ
// src/components/auth-errors.tsx). src/main.tsx chỉ cần render <AuthShell> bọc ngoài <App>.
import { useEffect, useState } from 'react';
import { CheckCircle2, LogOut, RefreshCw, ShieldOff } from 'lucide-react';
import { useAuth, type TeamRole } from '../auth-context';
import { api, ApiError } from '../api';
import { PermissionLostModal } from '../components/auth-errors';
import { Modal } from '../components/Modal';

const roleLabel: Record<TeamRole, string> = { leader: 'Leader', member: 'Member' };

// CR §6.1: "Chưa đăng nhập ─► Chuyển sang hệ xác thực công ty". Tự redirect ngay, kèm nút bấm tay
// phòng khi redirect tự động bị trình duyệt chặn (popup blocker/extension) — không để người dùng kẹt
// trên trang trắng không biết làm gì.
function LoggedOutScreen() {
  useEffect(() => {
    window.location.href = '/api/auth/login';
  }, []);
  return (
    <div className="flex h-screen items-center justify-center bg-hoa-van">
      <div className="popup w-full max-w-sm text-center">
        <p className="mb-4 text-sm text-phu">Đang chuyển sang trang đăng nhập của công ty…</p>
        <a className="nut-chinh inline-flex" href="/api/auth/login">Đăng nhập ngay</a>
      </div>
    </div>
  );
}

// FR-4a nhánh 3: "tài khoản bị khoá hẳn — đưa thẳng về trạng thái không được phép truy cập của vỏ xác
// thực, không quay vòng login/logout". Không có nút "thử lại" tự động vì tình trạng chỉ đổi khi Admin
// mở lại — chỉ có đăng xuất, và nút kiểm tra lại (đề phòng Admin vừa mở lại trong lúc đang xem màn này).
function DisabledAccountScreen() {
  const { logout, reload } = useAuth();
  return (
    <div className="flex h-screen items-center justify-center bg-hoa-van">
      <div className="popup w-full max-w-md text-center">
        <ShieldOff size={40} className="mx-auto mb-3 text-rose-600" />
        <h1 className="mb-2 text-xl font-bold text-rose-700">Tài khoản của bạn đã bị vô hiệu hoá</h1>
        <p className="mb-5 text-sm leading-6 text-phu">
          Admin đã tạm khoá tài khoản này. Hãy liên hệ Admin nếu bạn cho rằng đây là nhầm lẫn.
        </p>
        <div className="flex justify-center gap-2">
          <button type="button" className="nut-phu" onClick={() => void reload()}>
            <RefreshCw size={14} className="mr-1 inline" /> Kiểm tra lại
          </button>
          <button type="button" className="nut-chinh" onClick={() => void logout()}>
            <LogOut size={14} className="mr-1 inline" /> Đăng xuất
          </button>
        </div>
      </div>
    </div>
  );
}

function GenericErrorScreen() {
  const { reload, logout } = useAuth();
  return (
    <div className="flex h-screen items-center justify-center bg-hoa-van">
      <div className="popup w-full max-w-md text-center">
        <h1 className="mb-2 text-xl font-bold text-rose-700">Không tải được thông tin đăng nhập</h1>
        <p className="mb-5 text-sm leading-6 text-phu">Có lỗi khi kết nối tới server. Thử lại hoặc đăng nhập lại.</p>
        <div className="flex justify-center gap-2">
          <button type="button" className="nut-phu" onClick={() => void reload()}>Thử lại</button>
          <button type="button" className="nut-chinh" onClick={() => void logout()}>Đăng xuất</button>
        </div>
      </div>
    </div>
  );
}

interface TeamOption { id: number; name: string; description: string | null; }

// FR-2 — "chỉ hiện tên team + mô tả ngắn... không lộ danh sách thành viên hiện có cho người chưa được
// duyệt". Gửi yêu cầu tham gia (chưa cấp quyền nghiệp vụ nào — chỉ tạo join_request).
function ChooseTeamScreen() {
  const { actor, reload } = useAuth();
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loadError, setLoadError] = useState('');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [role, setRole] = useState<TeamRole>('member');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // 2026-09-25 (docs/exchanges/2026-09-25.md) — Admin bootstrap giờ đi qua ĐÚNG màn này như user
  // thường (trước đây vào thẳng app, bỏ qua bước chọn team). Chỉ Admin mới được tự lập team mới ngay
  // tại đây (server chặn 400 nếu user thường gửi `newTeamName` — FR-2 vẫn giữ nguyên "không tự tạo
  // team" cho user thường). Cần cho hệ thống mới tinh chưa có team nào để mà chọn.
  const laAdmin = actor?.systemRole === 'admin';
  const [tuLapTeam, setTuLapTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');

  useEffect(() => {
    let alive = true;
    api<{ teams: TeamOption[] }>('/api/teams')
      .then((res) => {
        if (!alive) return;
        setTeams(res.teams);
        setTeamId(res.teams[0]?.id ?? '');
        // Team rỗng + là Admin -> không có gì để chọn, tự bật sẵn chế độ "tự lập team mới" luôn.
        if (res.teams.length === 0 && actor?.systemRole === 'admin') setTuLapTeam(true);
      })
      .catch((error) => { if (alive) setLoadError(error instanceof Error ? error.message : 'Không tải được danh sách team'); });
    return () => { alive = false; };
  }, [actor?.systemRole]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tuLapTeam) {
      if (!newTeamName.trim()) { setSubmitError('Hãy nhập tên team'); return; }
    } else if (teamId === '') {
      setSubmitError('Hãy chọn một team');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const body = tuLapTeam ? { newTeamName: newTeamName.trim(), role } : { teamId, role };
      await api('/api/onboarding/join-request', { method: 'POST', body: JSON.stringify(body) });
      await reload();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'JOIN_REQUEST_PENDING_EXISTS') {
        // Race hiếm (đã gửi ở nơi khác/tab khác) — chỉ cần đồng bộ lại, màn sẽ tự chuyển sang "Đang chờ duyệt".
        await reload();
        return;
      }
      setSubmitError(error instanceof Error ? error.message : 'Không gửi được yêu cầu tham gia');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-hoa-van p-4">
      <form onSubmit={submit} className="popup w-full max-w-lg">
        <h1 className="mb-1 text-xl font-bold text-muc">Chọn team và vai trò</h1>
        <p className="mb-4 text-sm text-phu">
          Xin chào {actor?.displayName}. Chọn team bạn muốn tham gia và vai trò mong muốn{laAdmin ? '' : ' — Admin sẽ xem và duyệt yêu cầu này'}.
          {laAdmin
            ? ' Vì bạn là Admin, yêu cầu này tự động được duyệt ngay, không cần chờ.'
            : ' Đây chỉ là gửi yêu cầu, bạn chưa có quyền thao tác gì cho tới khi được duyệt.'}
        </p>

        {loadError && <p className="mb-3 text-sm text-rose-600">{loadError}</p>}

        {laAdmin && (
          <div className="field mb-3 flex gap-4 text-sm font-normal">
            <label className="inline-flex items-center gap-1.5">
              <input type="radio" name="team-mode" checked={!tuLapTeam} onChange={() => setTuLapTeam(false)} disabled={teams.length === 0} /> Chọn team có sẵn
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="radio" name="team-mode" checked={tuLapTeam} onChange={() => setTuLapTeam(true)} /> Tự lập team mới
            </label>
          </div>
        )}

        {tuLapTeam ? (
          <label className="field">
            Tên team mới
            <input
              type="text" value={newTeamName} disabled={submitting}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Ví dụ: Dev13" required
            />
          </label>
        ) : (
          <>
            <label className="field">
              Team
              <select value={teamId} disabled={submitting} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')} required>
                <option value="" disabled>— chọn team —</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            {teamId !== '' && teams.find((t) => t.id === teamId)?.description && (
              <p className="mb-2 text-xs text-phu">{teams.find((t) => t.id === teamId)?.description}</p>
            )}
          </>
        )}

        <fieldset className="field" disabled={submitting}>
          <legend className="mb-1">Vai trò mong muốn</legend>
          <label className="mr-4 inline-flex items-center gap-1.5 text-sm font-normal">
            <input type="radio" name="role" checked={role === 'member'} onChange={() => setRole('member')} /> Member
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm font-normal">
            <input type="radio" name="role" checked={role === 'leader'} onChange={() => setRole('leader')} /> Leader
          </label>
        </fieldset>

        {submitError && <p className="mb-3 text-sm text-rose-600">{submitError}</p>}

        <div className="mt-4 flex justify-end">
          <button type="submit" className="nut-chinh" disabled={submitting || (tuLapTeam ? !newTeamName.trim() : teamId === '')}>
            {submitting ? 'Đang gửi…' : laAdmin ? (tuLapTeam ? 'Tạo và tham gia' : 'Tham gia ngay') : 'Gửi yêu cầu tham gia'}
          </button>
        </div>
      </form>
    </div>
  );
}

// FR-2/FR-3/FR-3a — "hiện lại team/vai trò đã xin, nút Kiểm tra lại, tự chuyển màn ngay khi Admin
// duyệt/từ chối trong lúc trang đang mở". AuthProvider đã tự poll (PENDING_POLL_MS) nên "tự chuyển
// màn" xảy ra tự nhiên khi `phase`/`joinRequest` đổi; nút này chỉ để người dùng chủ động kiểm ngay.
function PendingApprovalScreen() {
  const { actor, joinRequest, reload, logout } = useAuth();
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    try { await reload(); } finally { setChecking(false); }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-hoa-van p-4">
      <div className="popup w-full max-w-md text-center">
        <h1 className="mb-2 text-xl font-bold text-muc">Đang chờ Admin duyệt</h1>
        <p className="mb-4 text-sm leading-6 text-phu">
          Xin chào {actor?.displayName}. Yêu cầu tham gia team của bạn đang chờ Admin xem xét.
        </p>
        {joinRequest && (
          <div className="mb-5 rounded-md border border-vien bg-slate-50 px-4 py-3 text-left text-sm">
            <div><span className="font-semibold">Team đã xin:</span> {joinRequest.teamName}</div>
            <div><span className="font-semibold">Vai trò đã xin:</span> {roleLabel[joinRequest.role]}</div>
          </div>
        )}
        <div className="flex justify-center gap-2">
          <button type="button" className="nut-phu" onClick={() => void logout()}><LogOut size={14} className="mr-1 inline" />Đăng xuất</button>
          <button type="button" className="nut-chinh" disabled={checking} onClick={checkNow}>
            <RefreshCw size={14} className={`mr-1 inline ${checking ? 'animate-spin' : ''}`} /> Kiểm tra lại
          </button>
        </div>
      </div>
    </div>
  );
}

// FR-3 — popup bắt buộc "Đã cấp team/vai trò", chỉ cần bấm "Đã hiểu" một lần, không bắt chọn lại gì.
function ApprovalNoticeModal() {
  const { approvalNotice, ackApprovalNotice } = useAuth();
  if (!approvalNotice) return null;
  return (
    <Modal onClose={() => void ackApprovalNotice()}>
      <div className="popup w-full max-w-md text-center">
        <CheckCircle2 size={36} className="mx-auto mb-3 text-emerald-600" />
        <h2 className="mb-2 text-xl font-bold text-muc">Bạn đã được cấp quyền</h2>
        <p className="mb-5 text-sm leading-6 text-phu">
          Admin đã duyệt yêu cầu của bạn — team <b>{approvalNotice.teamName}</b>, vai trò{' '}
          <b>{roleLabel[approvalNotice.role]}</b>.
        </p>
        <button type="button" className="nut-chinh" onClick={() => void ackApprovalNotice()}>Đã hiểu</button>
      </div>
    </Modal>
  );
}

// Component gốc — bọc App ở src/main.tsx. Chỉ render children (app thật) khi phase === 'active'.
export function AuthShell({ children }: { children: React.ReactNode }) {
  const { phase, permissionLostError, clearPermissionLostError } = useAuth();

  if (phase === 'loading') {
    return <div className="flex h-screen items-center justify-center bg-hoa-van text-sm text-phu">Đang tải…</div>;
  }
  if (phase === 'logged_out') return <LoggedOutScreen />;
  if (phase === 'disabled') return <DisabledAccountScreen />;
  if (phase === 'error') return <GenericErrorScreen />;
  if (phase === 'pending') return <PendingOrChooseTeam />;

  // active
  return (
    <>
      {children}
      <ApprovalNoticeModal />
      {permissionLostError && <PermissionLostModal error={permissionLostError} onClose={clearPermissionLostError} />}
    </>
  );
}

function PendingOrChooseTeam() {
  const { joinRequest } = useAuth();
  return joinRequest ? <PendingApprovalScreen /> : <ChooseTeamScreen />;
}
