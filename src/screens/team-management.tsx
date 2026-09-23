// Quản lý team — CR-20260913 Giai đoạn 2 (Lát 9). Màn cho Leader tự quản thành viên team mình (FR-12),
// cảnh báo trước khi bớt (FR-12a), và nhật ký team (FR-11a — Leader/Member đều xem chi tiết đầy đủ,
// khác Admin chỉ thấy metadata ở khu Admin). Team/Member đều xem được tab Thành viên+Nhật ký (đúng
// quyết định Leader 19/09 — team_member.list cho cả 2 vai); chỉ Leader thấy nút thêm/bớt.
import { useEffect, useState } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import { apiTeam } from '../api';
import { useToast } from '../context';
import { useAuth, useActiveTeamId } from '../auth-context';
import { Modal } from '../components/Modal';

function loiThanThien(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

const btnPrimary = 'rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50';
const btnSecondary = 'rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50';
const btnDanger = 'rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50';

// Khớp nguyên văn tên cột trả về từ server (server/routes/teams.ts, audit.ts) — xem ghi chú tương tự ở
// src/screens/admin.tsx.
interface MemberRow { id: number; email: string; display_name: string; avatar: string | null; role: 'leader' | 'member'; }
interface AuditEntryDetail { id: number; actorUserId: number; teamId: number | null; action: string; target: string; payload: unknown; createdAt: string; }

type Muc = 'members' | 'audit' | 'overview';

export function ManHinhQuanLyTeam() {
  const activeTeamId = useActiveTeamId();
  const { myTeams } = useAuth();
  const [muc, setMuc] = useState<Muc>('overview');
  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-teal-600 text-white' : 'border bg-white text-slate-600 hover:bg-slate-50'}`;

  const teamHienTai = myTeams.find((t) => t.id === activeTeamId);
  const laLeader = teamHienTai?.role === 'leader';

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="rounded-lg border bg-white p-4">
        <h2 className="text-lg font-bold">Quản lý team{teamHienTai ? ` — ${teamHienTai.name}` : ''}</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tabClass(muc === 'overview')} onClick={() => setMuc('overview')}>Tổng quan</button>
        <button type="button" className={tabClass(muc === 'members')} onClick={() => setMuc('members')}>Thành viên</button>
        <button type="button" className={tabClass(muc === 'audit')} onClick={() => setMuc('audit')}>Nhật ký</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {muc === 'overview' && <TabTongQuan teamId={activeTeamId} teamName={teamHienTai?.name} teamDesc={teamHienTai?.description} vaiTro={teamHienTai?.role} />}
        {muc === 'members' && <TabThanhVien teamId={activeTeamId} laLeader={laLeader} />}
        {muc === 'audit' && <TabNhatKy teamId={activeTeamId} />}
      </div>
    </section>
  );
}

// ── Tổng quan — chỉ dùng dữ liệu đã có sẵn (myTeams + roster), không cần route Admin-only mới ──────
function TabTongQuan({ teamId, teamName, teamDesc, vaiTro }: { teamId: number | null; teamName?: string; teamDesc?: string | null; vaiTro?: 'leader' | 'member' }) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const aliveRef = { current: true };
    setMembers(null);
    setError('');
    if (teamId == null) return () => { aliveRef.current = false; };
    apiTeam<{ members: MemberRow[] }>(teamId, `/api/teams/${teamId}/members`)
      .then((d) => { if (aliveRef.current) setMembers(d.members); })
      .catch((e) => { if (aliveRef.current) setError(loiThanThien(e)); });
    return () => { aliveRef.current = false; };
  }, [teamId]);

  if (teamId == null) return <div className="p-4 text-sm text-slate-400">Chưa chọn team.</div>;
  const leader = members?.find((m) => m.role === 'leader');

  return (
    <div className="flex max-w-xl flex-col gap-3">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="rounded-lg border bg-white p-4">
        <div className="text-base font-semibold">{teamName}</div>
        {teamDesc && <div className="mt-1 text-sm text-slate-500">{teamDesc}</div>}
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="text-slate-500">Vai trò của bạn</div>
          <div className="font-medium">{vaiTro === 'leader' ? 'Leader' : 'Member'}</div>
          <div className="text-slate-500">Leader hiện tại</div>
          <div className="font-medium">{leader ? leader.display_name : members ? '(chưa có)' : '…'}</div>
          <div className="text-slate-500">Số thành viên</div>
          <div className="font-medium">{members ? members.length : '…'}</div>
        </div>
      </div>
    </div>
  );
}

// ── Thành viên (FR-12: thêm/bớt, chỉ Leader) ─────────────────────────────────────────────
function TabThanhVien({ teamId, laLeader }: { teamId: number | null; laLeader: boolean }) {
  const toast = useToast();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);

  async function tai(aliveRef?: { current: boolean }) {
    if (teamId == null) { setMembers([]); setLoading(false); return; }
    try {
      const data = await apiTeam<{ members: MemberRow[] }>(teamId, `/api/teams/${teamId}/members`);
      if (aliveRef && !aliveRef.current) return;
      setMembers(data.members);
      setError('');
    } catch (e) {
      if (aliveRef && !aliveRef.current) return;
      setError(loiThanThien(e));
    } finally {
      if (!aliveRef || aliveRef.current) setLoading(false);
    }
  }
  useEffect(() => {
    const aliveRef = { current: true };
    setMembers([]);
    setError('');
    setLoading(true);
    // Đóng luôn popup thêm/bớt thành viên nếu đổi team khi đang mở — Council review (run ba1e14ed) nêu
    // rủi ro popup còn hiện dữ liệu team cũ trong lúc submit lại áp vào team mới. Đã tự kiểm chứng: popup
    // dùng chung <Modal> (`fixed inset-0 z-50`) che kín cả `TeamSwitcher` ở header nên KHÔNG bấm đổi team
    // được trong lúc popup mở qua thao tác chuột thường — không phải lỗ hổng đang khai thác được, nhưng
    // đóng popup ở đây vẫn đúng cùng nguyên tắc "reset toàn bộ state phụ thuộc team" đã dùng cho
    // members/error/loading ngay trên, phòng khi có đường khác đổi activeTeamId sau này (vd phím tắt).
    setShowAdd(false);
    setRemoveTarget(null);
    void tai(aliveRef);
    return () => { aliveRef.current = false; };
  }, [teamId]);

  async function boSau(userId: number) {
    if (teamId == null) return;
    setBusy(true);
    setError('');
    try {
      await apiTeam(teamId, `/api/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
      setRemoveTarget(null);
      await tai();
      toast('Đã bớt thành viên');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-4 text-sm text-slate-400">Đang tải…</div>;

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {laLeader && (
        <div>
          <button type="button" className={`${btnPrimary} flex w-fit items-center gap-1`} onClick={() => setShowAdd(true)}>
            <UserPlus size={16} /> Thêm thành viên
          </button>
        </div>
      )}
      <div className="rounded-lg border bg-white">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 border-b p-3 last:border-b-0">
            <div className="flex-1">
              <div className="text-sm font-medium">{m.display_name}</div>
              <div className="text-xs text-slate-500">{m.email}</div>
            </div>
            {m.role === 'leader' && <span className="rounded bg-teal-50 px-2 py-0.5 text-xs text-teal-700">Leader</span>}
            {laLeader && (
              <button type="button" className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Bớt khỏi team" onClick={() => setRemoveTarget(m)}>
                <UserMinus size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {showAdd && teamId != null && (
        <PopupThemThanhVien teamId={teamId} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); void tai(); }} />
      )}
      {removeTarget && teamId != null && (
        <PopupCanhBaoBotThanhVien
          teamId={teamId}
          member={removeTarget}
          busy={busy}
          onClose={() => setRemoveTarget(null)}
          onConfirm={() => boSau(removeTarget.id)}
        />
      )}
    </div>
  );
}

function PopupThemThanhVien({ teamId, onClose, onDone }: { teamId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [found, setFound] = useState<{ id: number; email: string; display_name: string } | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function traCuu() {
    const e = email.trim();
    if (!e) return;
    setBusy(true);
    setError('');
    setFound(undefined);
    try {
      const data = await apiTeam<{ user: { id: number; email: string; display_name: string } | null }>(
        teamId, `/api/teams/${teamId}/member-candidates?email=${encodeURIComponent(e)}`
      );
      setFound(data.user);
    } catch (e2) {
      setError(loiThanThien(e2));
    } finally {
      setBusy(false);
    }
  }

  async function xacNhanThem() {
    if (!found) return;
    setBusy(true);
    setError('');
    try {
      await apiTeam(teamId, `/api/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify({ userId: found.id }) });
      toast(`Đã thêm ${found.display_name}`);
      onDone();
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} dismissable={!busy}>
      <div className="popup w-full max-w-md">
        <h2 className="mb-3 text-lg font-bold">Thêm thành viên</h2>
        <p className="mb-2 text-xs text-slate-500">Chỉ thêm được người ĐÃ TỪNG đăng nhập vào hệ thống ít nhất một lần.</p>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border px-3 py-1.5 text-sm"
            placeholder="Email…"
            value={email}
            disabled={busy}
            onChange={(e) => { setEmail(e.target.value); setFound(undefined); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void traCuu(); } }}
          />
          <button type="button" className={btnSecondary} disabled={busy || !email.trim()} onClick={traCuu}>Tra cứu</button>
        </div>
        {error && <div className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {found === null && <div className="mt-2 text-sm text-amber-700">Không tìm thấy — người này chưa từng đăng nhập vào hệ thống.</div>}
        {found && (
          <div className="mt-2 rounded border bg-slate-50 px-3 py-2 text-sm">
            <span className="font-medium">{found.display_name}</span> <span className="text-slate-400">({found.email})</span>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Hủy</button>
          <button type="button" className={btnPrimary} disabled={busy || !found} onClick={xacNhanThem}>Thêm vào team</button>
        </div>
      </div>
    </Modal>
  );
}

// FR-12a — hiện số task project chưa xong TRƯỚC khi Leader xác nhận bớt (không chặn cứng, chỉ cảnh báo
// có thông tin).
function PopupCanhBaoBotThanhVien({ teamId, member, busy, onClose, onConfirm }: {
  teamId: number; member: MemberRow; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    apiTeam<{ count: number }>(teamId, `/api/teams/${teamId}/members/${member.id}/pending-task-count`)
      .then((d) => { if (alive) setCount(d.count); })
      .catch((e) => { if (alive) setError(loiThanThien(e)); });
    return () => { alive = false; };
  }, [teamId, member.id]);

  return (
    <Modal onClose={onClose} dismissable={!busy}>
      <div className="popup w-full max-w-md">
        <h2 className="mb-3 text-lg font-bold">Bớt {member.display_name} khỏi team?</h2>
        {error && <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {count === null && !error && <div className="text-sm text-slate-400">Đang kiểm tra task đang phụ trách…</div>}
        {count != null && count > 0 && (
          <div className="rounded border bg-amber-50 p-3 text-sm text-amber-800">
            Người này còn <strong>{count}</strong> task project chưa hoàn thành. Bớt khỏi team không xoá
            các task đó, nhưng bạn cần tự phân công lại người phụ trách sau.
          </div>
        )}
        {count === 0 && <div className="text-sm text-slate-500">Không có task project nào chưa hoàn thành.</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>Hủy</button>
          <button type="button" className={btnDanger} disabled={busy} onClick={onConfirm}>Xác nhận bớt</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Nhật ký (FR-11a — Leader/Member đều xem chi tiết đầy đủ đúng team mình) ─────────────
function TabNhatKy({ teamId }: { teamId: number | null }) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [entries, setEntries] = useState<AuditEntryDetail[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const aliveRef = { current: true };
    setEntries([]);
    setError('');
    setLoading(true);
    if (teamId == null) { setLoading(false); return () => { aliveRef.current = false; }; }
    Promise.all([
      apiTeam<{ members: MemberRow[] }>(teamId, `/api/teams/${teamId}/members`),
      apiTeam<{ entries: AuditEntryDetail[]; nextCursor: string | null }>(teamId, `/api/audit?limit=100`)
    ]).then(([m, a]) => {
      if (!aliveRef.current) return;
      setMembers(m.members);
      setEntries(a.entries);
    }).catch((e) => { if (aliveRef.current) setError(loiThanThien(e)); })
      .finally(() => { if (aliveRef.current) setLoading(false); });
    return () => { aliveRef.current = false; };
  }, [teamId]);

  function tenNguoi(id: number) { return members.find((m) => m.id === id)?.display_name || `user #${id}`; }

  if (teamId == null) return <div className="p-4 text-sm text-slate-400">Chưa chọn team.</div>;
  if (loading) return <div className="p-4 text-sm text-slate-400">Đang tải…</div>;

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="p-2 text-left font-medium">Thời điểm</th>
              <th className="p-2 text-left font-medium">Ai</th>
              <th className="p-2 text-left font-medium">Hành động</th>
              <th className="p-2 text-left font-medium">Đối tượng</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b last:border-b-0">
                <td className="p-2 text-xs text-slate-500">{new Date(e.createdAt).toLocaleString('vi-VN')}</td>
                <td className="p-2">{tenNguoi(e.actorUserId)}</td>
                <td className="p-2 font-mono text-xs">{e.action}</td>
                <td className="p-2 text-xs text-slate-500">{e.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <div className="p-4 text-center text-sm text-slate-400">Chưa có nhật ký nào.</div>}
      </div>
    </div>
  );
}
