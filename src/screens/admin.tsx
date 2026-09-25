// Khu Admin — CR-20260913 Giai đoạn 2 (Lát 8). FR-10: toàn bộ cấu hình quản trị (team/Leader, hiển
// thị chức năng, team điều phối Release, Tab cá nhân Release, tài khoản, yêu cầu tham gia, nhật ký,
// URL Redmine hệ thống) nằm trong MỘT khu vực duy nhất, chỉ Admin sửa được. 7 mục con dưới đây khớp
// đúng 7 nhóm route đã có sẵn ở backend (Lát 1-6) — không thêm nghiệp vụ mới, chỉ nối dây UI.
import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context';
import { useAuth } from '../auth-context';
import { Modal } from '../components/Modal';

function loiThanThien(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

const btnPrimary = 'rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50';
const btnSecondary = 'rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50';
const btnDanger = 'rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50';

// ── Kiểu dữ liệu — khớp NGUYÊN VĂN tên cột trả về từ server (không có tầng map camelCase ở các route
// này, khác vài route khác trong app — xem server/routes/teams.ts, admin-config.ts, auth.ts, onboarding.ts).
interface TeamRow { id: number; name: string; description: string | null; row_version: number; created_at: string; }
interface TeamMemberRow { id: number; email: string; display_name: string; avatar: string | null; role: 'leader' | 'member'; }
interface VisibilityRow { team_id: number; feature: string; level: 'off' | 'on'; row_version: number; updated_at: string; }
interface AutogenRow { team_id: number; enabled: 0 | 1; row_version: number; updated_at: string; }
interface JoinRequestRow {
  id: number; user_id: number; email: string; display_name: string;
  requested_team_id: number; requested_role: 'leader' | 'member'; row_version: number; created_at: string;
}
interface UserRow {
  id: number; email: string; display_name: string; avatar: string | null; status: 'pending' | 'active' | 'disabled';
  system_role: 'user' | 'admin'; row_version: number; created_at: string; last_login_at: string | null;
}
interface AuditEntryAdmin { id: number; actorUserId: number; teamId: number | null; action: string; createdAt: string; }

const FEATURES: { key: string; label: string }[] = [
  { key: 'personal_task', label: 'Task cá nhân' },
  { key: 'project', label: 'Project' },
  { key: 'weekly_report', label: 'Báo cáo tuần' },
  { key: 'release', label: 'Release' },
  { key: 'mind_map', label: 'Mind Map' }
];

// ── 1. Team (tạo, sửa tên/mô tả, đổi Leader) ────────────────────────────────────────────
function AdminTeams() {
  const toast = useToast();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [leaderPickerTeam, setLeaderPickerTeam] = useState<TeamRow | null>(null);

  async function tai(alive?: { current: boolean }) {
    try {
      const data = await api<{ teams: TeamRow[]; nextCursor: string | null }>('/api/admin/teams?limit=200');
      if (alive && !alive.current) return;
      setTeams(data.teams);
      setError('');
    } catch (e) {
      if (alive && !alive.current) return;
      setError(loiThanThien(e));
    } finally {
      if (!alive || alive.current) setLoading(false);
    }
  }
  // Cờ huỷ (cancellation guard) khi unmount giữa lúc đang tải — chuẩn Lát 7 (project.tsx). Không phải
  // rủi ro lộ dữ liệu chéo team (Admin không phụ thuộc activeTeamId), chỉ tránh set-state sau unmount.
  useEffect(() => {
    const alive = { current: true };
    void tai(alive);
    return () => { alive.current = false; };
  }, []);

  async function taoTeam() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/teams', { method: 'POST', body: JSON.stringify({ name, description: newDesc.trim() || undefined }) });
      setNewName('');
      setNewDesc('');
      await tai();
      toast('Đã tạo team');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  async function luuSua(team: TeamRow) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/teams/${team.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null, rowVersion: team.row_version })
      });
      setEditingId(null);
      await tai();
      toast('Đã sửa team');
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

      <div className="max-w-xl rounded-lg border bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Tạo team mới</h3>
        <div className="flex flex-col gap-2">
          <input className="rounded border px-3 py-1.5 text-sm" placeholder="Tên team…" value={newName} disabled={busy} onChange={(e) => setNewName(e.target.value)} />
          <input className="rounded border px-3 py-1.5 text-sm" placeholder="Mô tả (tuỳ chọn)…" value={newDesc} disabled={busy} onChange={(e) => setNewDesc(e.target.value)} />
          <button type="button" className={`${btnPrimary} flex w-fit items-center gap-1`} disabled={busy || !newName.trim()} onClick={taoTeam}>
            <Plus size={16} /> Tạo team
          </button>
        </div>
      </div>

      <div className="rounded-lg border bg-white">
        {teams.length === 0 && <div className="p-4 text-center text-sm text-slate-400">Chưa có team nào.</div>}
        {teams.map((team) => (
          <div key={team.id} className="flex items-center gap-2 border-b p-3 last:border-b-0">
            {editingId === team.id ? (
              <div className="flex flex-1 flex-col gap-2">
                <input className="rounded border px-2 py-1 text-sm" value={editName} autoFocus onChange={(e) => setEditName(e.target.value)} />
                <input className="rounded border px-2 py-1 text-sm" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Mô tả…" />
                <div className="flex gap-2">
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => luuSua(team)}><Check size={14} /></button>
                  <button type="button" className={btnSecondary} onClick={() => setEditingId(null)}><X size={14} /></button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1">
                  <div className="text-sm font-medium">{team.name}</div>
                  {team.description && <div className="text-xs text-slate-500">{team.description}</div>}
                </div>
                <button type="button" className={btnSecondary} onClick={() => setLeaderPickerTeam(team)}>Đổi Leader</button>
                <button
                  type="button"
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title="Sửa tên/mô tả"
                  onClick={() => { setEditingId(team.id); setEditName(team.name); setEditDesc(team.description || ''); }}
                >
                  <Pencil size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {leaderPickerTeam && (
        <PopupChonLeader team={leaderPickerTeam} onClose={() => setLeaderPickerTeam(null)} onDone={() => { setLeaderPickerTeam(null); void tai(); }} />
      )}
    </div>
  );
}

function PopupChonLeader({ team, onClose, onDone }: { team: TeamRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [members, setMembers] = useState<TeamMemberRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ members: TeamMemberRow[] }>(`/api/admin/teams/${team.id}/members`)
      .then((d) => { if (alive) setMembers(d.members); })
      .catch((e) => { if (alive) setError(loiThanThien(e)); });
    return () => { alive = false; };
  }, [team.id]);

  async function xacNhan() {
    if (picked == null) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/teams/${team.id}/leader`, {
        method: 'POST', body: JSON.stringify({ userId: picked, rowVersion: team.row_version })
      });
      toast('Đã đổi Leader');
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Đổi Leader — {team.name}</h2>
          <button type="button" className="nut-icon" onClick={onClose}><X size={18} /></button>
        </div>
        {members === null && !error && <div className="py-4 text-sm text-slate-400">Đang tải danh sách thành viên…</div>}
        {error && <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {members !== null && members.length === 0 && (
          <div className="py-4 text-sm text-slate-400">Team này chưa có thành viên nào — phải có người tham gia (qua duyệt yêu cầu) trước khi chỉ định Leader.</div>
        )}
        {members !== null && members.length > 0 && (
          <div className="flex flex-col gap-1">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 rounded border px-3 py-2 text-sm hover:bg-slate-50">
                <input type="radio" name="leader-pick" checked={picked === m.id} onChange={() => setPicked(m.id)} />
                <span className="flex-1">{m.display_name} <span className="text-xs text-slate-400">({m.email})</span></span>
                {m.role === 'leader' && <span className="rounded bg-teal-50 px-2 py-0.5 text-xs text-teal-700">Leader hiện tại</span>}
              </label>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Hủy</button>
          <button type="button" className={btnPrimary} disabled={busy || picked == null} onClick={xacNhan}>Xác nhận</button>
        </div>
      </div>
    </Modal>
  );
}

// ── 2. Hiển thị chức năng (tầng 2, FR-7) ────────────────────────────────────────────────
function AdminFeatureVisibility() {
  const toast = useToast();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [rows, setRows] = useState<VisibilityRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');

  async function tai(alive?: { current: boolean }) {
    try {
      const [t, v] = await Promise.all([
        api<{ teams: TeamRow[] }>('/api/admin/teams?limit=200'),
        api<{ visibility: VisibilityRow[] }>('/api/admin/feature-visibility')
      ]);
      if (alive && !alive.current) return;
      setTeams(t.teams);
      setRows(v.visibility);
      setError('');
    } catch (e) {
      if (alive && !alive.current) return;
      setError(loiThanThien(e));
    } finally {
      if (!alive || alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    const alive = { current: true };
    void tai(alive);
    return () => { alive.current = false; };
  }, []);

  async function toggle(teamId: number, feature: string) {
    const row = rows.find((r) => r.team_id === teamId && r.feature === feature);
    if (!row) return;
    const key = `${teamId}:${feature}`;
    const nextLevel = row.level === 'on' ? 'off' : 'on';
    setBusyKey(key);
    setError('');
    try {
      await api('/api/admin/feature-visibility', {
        method: 'PATCH', body: JSON.stringify({ teamId, feature, level: nextLevel, rowVersion: row.row_version })
      });
      await tai();
      toast(`Đã ${nextLevel === 'on' ? 'bật' : 'tắt'} ${feature} cho team`);
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusyKey('');
    }
  }

  if (loading) return <div className="p-4 text-sm text-slate-400">Đang tải…</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border bg-amber-50 p-3 text-xs text-amber-800">
        Tắt một chức năng không xoá dữ liệu đã có, chỉ ẩn giao diện. Tắt "Project" tự tắt theo "Báo cáo
        tuần" của đúng team đó (không tự bật lại khi bật Project lại).
      </div>
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="p-2 text-left font-medium">Team</th>
              {FEATURES.map((f) => <th key={f.key} className="p-2 text-center font-medium">{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id} className="border-b last:border-b-0">
                <td className="p-2 font-medium">{team.name}</td>
                {FEATURES.map((f) => {
                  const row = rows.find((r) => r.team_id === team.id && r.feature === f.key);
                  const on = row?.level === 'on';
                  const key = `${team.id}:${f.key}`;
                  return (
                    <td key={f.key} className="p-2 text-center">
                      <button
                        type="button"
                        disabled={!row || busyKey === key}
                        onClick={() => toggle(team.id, f.key)}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-teal-600 text-white hover:bg-teal-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'} disabled:opacity-50`}
                      >
                        {on ? 'Bật' : 'Tắt'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 3. Cấu hình Release (team điều phối + Tab cá nhân từng team) ───────────────────────
function AdminReleaseConfig() {
  const toast = useToast();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [coord, setCoord] = useState<{ release_coordinator_team_id: number | null; row_version: number } | null>(null);
  const [autogen, setAutogen] = useState<AutogenRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function tai(alive?: { current: boolean }) {
    try {
      const [t, c, a] = await Promise.all([
        api<{ teams: TeamRow[] }>('/api/admin/teams?limit=200'),
        api<{ release_coordinator_team_id: number | null; row_version: number }>('/api/admin/release-coordinator'),
        api<{ settings: AutogenRow[] }>('/api/admin/release-task-autogen')
      ]);
      if (alive && !alive.current) return;
      setTeams(t.teams);
      setCoord(c);
      setAutogen(a.settings);
      setError('');
    } catch (e) {
      if (alive && !alive.current) return;
      setError(loiThanThien(e));
    } finally {
      if (!alive || alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    const alive = { current: true };
    void tai(alive);
    return () => { alive.current = false; };
  }, []);

  async function doiDieuPhoi(teamId: number) {
    if (!coord) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/release-coordinator', { method: 'PUT', body: JSON.stringify({ teamId, rowVersion: coord.row_version }) });
      await tai();
      toast('Đã đổi team điều phối Release');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutogen(teamId: number) {
    const row = autogen.find((r) => r.team_id === teamId);
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/release-task-autogen', {
        method: 'PUT',
        body: JSON.stringify({ teamId, enabled: !(row?.enabled), rowVersion: row?.row_version ?? -1 })
      });
      await tai();
      toast('Đã đổi cấu hình Tab cá nhân Release');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-4 text-sm text-slate-400">Đang tải…</div>;

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="max-w-xl rounded-lg border bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Team điều phối Release</h3>
        <p className="mb-2 text-xs text-slate-500">
          Leader của team này có quyền khoá lịch/duyệt mở khoá/ép giờ chung trên MỌI team, độc lập với
          việc Release có đang Bật cho chính team này hay không.
        </p>
        <select
          className="w-full rounded border px-3 py-1.5 text-sm"
          disabled={busy}
          value={coord?.release_coordinator_team_id ?? ''}
          onChange={(e) => { const id = Number(e.target.value); if (Number.isInteger(id)) void doiDieuPhoi(id); }}
        >
          <option value="" disabled>— chọn team điều phối —</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">Tab cá nhân Release (FR-28a)</h3>
        <p className="mb-2 text-xs text-slate-500">
          Chỉ có tác dụng khi "Task cá nhân" đang Bật cho đúng team đó (xem tab Hiển thị chức năng).
        </p>
        <div className="divide-y">
          {teams.map((team) => {
            const row = autogen.find((r) => r.team_id === team.id);
            const on = !!row?.enabled;
            return (
              <div key={team.id} className="flex items-center justify-between py-2">
                <span className="text-sm">{team.name}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggleAutogen(team.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-teal-600 text-white hover:bg-teal-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'} disabled:opacity-50`}
                >
                  {on ? 'Bật' : 'Tắt'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 4. Yêu cầu tham gia team (FR-2/FR-3/FR-3a) ──────────────────────────────────────────
function AdminJoinRequests() {
  const toast = useToast();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [items, setItems] = useState<JoinRequestRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Sửa team/vai trò ngay lúc duyệt (FR-3) — override theo từng dòng, mặc định giữ nguyên yêu cầu gốc.
  const [overrideTeam, setOverrideTeam] = useState<Record<number, number>>({});
  const [overrideRole, setOverrideRole] = useState<Record<number, 'leader' | 'member'>>({});

  async function tai(alive?: { current: boolean }) {
    try {
      const [t, jr] = await Promise.all([
        api<{ teams: TeamRow[] }>('/api/admin/teams?limit=200'),
        api<{ joinRequests: JoinRequestRow[] }>('/api/admin/join-requests')
      ]);
      if (alive && !alive.current) return;
      setTeams(t.teams);
      setItems(jr.joinRequests);
      setError('');
    } catch (e) {
      if (alive && !alive.current) return;
      setError(loiThanThien(e));
    } finally {
      if (!alive || alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    const alive = { current: true };
    void tai(alive);
    return () => { alive.current = false; };
  }, []);

  function tenTeam(id: number) { return teams.find((t) => t.id === id)?.name || `team #${id}`; }

  async function duyet(jr: JoinRequestRow) {
    setBusyId(jr.id);
    setError('');
    try {
      await api(`/api/admin/join-requests/${jr.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          rowVersion: jr.row_version,
          approvedTeamId: overrideTeam[jr.id] ?? jr.requested_team_id,
          approvedRole: overrideRole[jr.id] ?? jr.requested_role
        })
      });
      await tai();
      toast(`Đã duyệt yêu cầu của ${jr.display_name}`);
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusyId(null);
    }
  }

  async function tuChoi(jr: JoinRequestRow) {
    setBusyId(jr.id);
    setError('');
    try {
      await api(`/api/admin/join-requests/${jr.id}/reject`, { method: 'POST', body: JSON.stringify({ rowVersion: jr.row_version }) });
      await tai();
      toast(`Đã từ chối yêu cầu của ${jr.display_name}`);
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="p-4 text-sm text-slate-400">Đang tải…</div>;

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {items.length === 0 && <div className="rounded-lg border bg-white p-4 text-center text-sm text-slate-400">Không có yêu cầu nào đang chờ.</div>}
      {items.map((jr) => (
        <div key={jr.id} className="rounded-lg border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{jr.display_name}</div>
              <div className="text-xs text-slate-500">{jr.email}</div>
            </div>
            <div className="text-xs text-slate-400">Yêu cầu: {tenTeam(jr.requested_team_id)} · {jr.requested_role === 'leader' ? 'Leader' : 'Member'}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded border px-2 py-1 text-sm"
              disabled={busyId === jr.id}
              value={overrideTeam[jr.id] ?? jr.requested_team_id}
              onChange={(e) => setOverrideTeam((cur) => ({ ...cur, [jr.id]: Number(e.target.value) }))}
            >
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select
              className="rounded border px-2 py-1 text-sm"
              disabled={busyId === jr.id}
              value={overrideRole[jr.id] ?? jr.requested_role}
              onChange={(e) => setOverrideRole((cur) => ({ ...cur, [jr.id]: e.target.value as 'leader' | 'member' }))}
            >
              <option value="member">Member</option>
              <option value="leader">Leader</option>
            </select>
            <button type="button" className={btnPrimary} disabled={busyId === jr.id} onClick={() => duyet(jr)}>Duyệt</button>
            <button type="button" className={btnDanger} disabled={busyId === jr.id} onClick={() => tuChoi(jr)}>Từ chối</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 5. Tài khoản (FR-4/FR-4a) ───────────────────────────────────────────────────────────
function AdminUsers() {
  const toast = useToast();
  const { actor } = useAuth();
  const [items, setItems] = useState<UserRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function tai(alive?: { current: boolean }) {
    try {
      const data = await api<{ users: UserRow[] }>('/api/admin/users');
      if (alive && !alive.current) return;
      setItems(data.users);
      setError('');
    } catch (e) {
      if (alive && !alive.current) return;
      setError(loiThanThien(e));
    } finally {
      if (!alive || alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    const alive = { current: true };
    void tai(alive);
    return () => { alive.current = false; };
  }, []);

  async function doiTrangThai(u: UserRow, status: 'active' | 'disabled') {
    setBusyId(u.id);
    setError('');
    try {
      await api(`/api/admin/users/${u.id}/${status === 'disabled' ? 'disable' : 'enable'}`, {
        method: 'POST', body: JSON.stringify({ rowVersion: u.row_version })
      });
      await tai();
      toast(status === 'disabled' ? 'Đã khoá tài khoản' : 'Đã mở lại tài khoản');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusyId(null);
    }
  }

  async function thuHoiPhien(u: UserRow) {
    setBusyId(u.id);
    setError('');
    try {
      await api(`/api/admin/users/${u.id}/revoke-sessions`, { method: 'POST' });
      toast('Đã thu hồi mọi phiên đăng nhập của người này');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusyId(null);
    }
  }

  // 2026-09-25 (docs/exchanges/2026-09-25.md) — gán/hạ quyền Admin cho nhau.
  async function doiQuyenAdmin(u: UserRow, action: 'promote' | 'demote') {
    setBusyId(u.id);
    setError('');
    try {
      await api(`/api/admin/users/${u.id}/${action === 'promote' ? 'promote-admin' : 'demote-admin'}`, {
        method: 'POST', body: JSON.stringify({ rowVersion: u.row_version })
      });
      await tai();
      toast(action === 'promote' ? 'Đã gán quyền Admin' : 'Đã hạ quyền Admin');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusyId(null);
    }
  }

  const soAdmin = items.filter((u) => u.system_role === 'admin').length;

  if (loading) return <div className="p-4 text-sm text-slate-400">Đang tải…</div>;

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="p-2 text-left font-medium">Người dùng</th>
              <th className="p-2 text-left font-medium">Trạng thái</th>
              <th className="p-2 text-left font-medium">Lần đăng nhập cuối</th>
              <th className="p-2 text-right font-medium">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => {
              const isSelf = actor?.id === u.id;
              return (
                <tr key={u.id} className="border-b last:border-b-0">
                  <td className="p-2">
                    <div className="font-medium">{u.display_name}{u.system_role === 'admin' && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">Admin</span>}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </td>
                  <td className="p-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${u.status === 'disabled' ? 'bg-rose-50 text-rose-600' : u.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {u.status === 'disabled' ? 'Đã khoá' : u.status === 'pending' ? 'Chờ duyệt' : 'Đang hoạt động'}
                    </span>
                  </td>
                  <td className="p-2 text-xs text-slate-500">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('vi-VN') : '—'}</td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-2">
                      {u.status === 'disabled' ? (
                        <button type="button" className={btnSecondary} disabled={busyId === u.id} onClick={() => doiTrangThai(u, 'active')}>Mở lại</button>
                      ) : (
                        <button
                          type="button"
                          className={btnDanger}
                          disabled={busyId === u.id || isSelf}
                          title={isSelf ? 'Không thể tự khoá chính mình' : undefined}
                          onClick={() => doiTrangThai(u, 'disabled')}
                        >
                          Khoá
                        </button>
                      )}
                      <button type="button" className={btnSecondary} disabled={busyId === u.id} onClick={() => thuHoiPhien(u)}>Thu hồi phiên</button>
                      {u.system_role === 'admin' ? (
                        <button
                          type="button"
                          className={btnDanger}
                          disabled={busyId === u.id || soAdmin <= 1}
                          title={soAdmin <= 1 ? 'Đây là Admin cuối cùng — gán thêm Admin khác trước khi hạ quyền' : undefined}
                          onClick={() => doiQuyenAdmin(u, 'demote')}
                        >
                          Hạ quyền Admin
                        </button>
                      ) : (
                        <button type="button" className={btnSecondary} disabled={busyId === u.id} onClick={() => doiQuyenAdmin(u, 'promote')}>
                          Gán quyền Admin
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 6. Nhật ký (FR-11a — Admin chỉ thấy metadata) ───────────────────────────────────────
function AdminAudit() {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [entries, setEntries] = useState<AuditEntryAdmin[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function tai(alive?: { current: boolean }) {
    try {
      const [t, u, a] = await Promise.all([
        api<{ teams: TeamRow[] }>('/api/admin/teams?limit=200'),
        api<{ users: UserRow[] }>('/api/admin/users'),
        api<{ entries: AuditEntryAdmin[]; nextCursor: string | null }>('/api/audit?limit=100')
      ]);
      if (alive && !alive.current) return;
      setTeams(t.teams);
      setUsers(u.users);
      setEntries(a.entries);
      setError('');
    } catch (e) {
      if (alive && !alive.current) return;
      setError(loiThanThien(e));
    } finally {
      if (!alive || alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    const alive = { current: true };
    void tai(alive);
    return () => { alive.current = false; };
  }, []);

  function tenNguoi(id: number) { return users.find((u) => u.id === id)?.display_name || `user #${id}`; }
  function tenTeam(id: number | null) { return id == null ? '—' : teams.find((t) => t.id === id)?.name || `team #${id}`; }

  if (loading) return <div className="p-4 text-sm text-slate-400">Đang tải…</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border bg-amber-50 p-3 text-xs text-amber-800">
        Admin chỉ thấy AI làm gì, team nào, lúc nào — không thấy nội dung nghiệp vụ chi tiết (FR-11a).
      </div>
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="p-2 text-left font-medium">Thời điểm</th>
              <th className="p-2 text-left font-medium">Ai</th>
              <th className="p-2 text-left font-medium">Hành động</th>
              <th className="p-2 text-left font-medium">Team</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b last:border-b-0">
                <td className="p-2 text-xs text-slate-500">{new Date(e.createdAt).toLocaleString('vi-VN')}</td>
                <td className="p-2">{tenNguoi(e.actorUserId)}</td>
                <td className="p-2 font-mono text-xs">{e.action}</td>
                <td className="p-2">{tenTeam(e.teamId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <div className="p-4 text-center text-sm text-slate-400">Chưa có nhật ký nào.</div>}
      </div>
    </div>
  );
}

// ── 7. URL Redmine hệ thống (FR-33) ─────────────────────────────────────────────────────
function AdminRedmine() {
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function tai(alive?: { current: boolean }) {
    try {
      const c = await api<{ baseUrl: string }>('/api/admin/redmine-url');
      if (alive && !alive.current) return;
      setBaseUrl(c.baseUrl);
    } catch (e) {
      if (alive && !alive.current) return;
      setError(loiThanThien(e));
    }
  }
  useEffect(() => {
    const alive = { current: true };
    void tai(alive);
    return () => { alive.current = false; };
  }, []);

  async function luu() {
    setBusy(true);
    setError('');
    try {
      const c = await api<{ baseUrl: string }>('/api/admin/redmine-url', { method: 'PUT', body: JSON.stringify({ baseUrl: input.trim() }) });
      setBaseUrl(c.baseUrl);
      setInput('');
      toast('Đã lưu URL Redmine hệ thống');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl rounded-lg border bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">URL Redmine hệ thống</h3>
      <p className="mb-3 text-xs text-slate-500">Công ty chỉ có một Redmine — mỗi người tự nhập API key riêng ở màn Cài đặt.</p>
      {error && <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      <div className="mb-2 rounded border bg-slate-50 px-3 py-2 text-sm text-slate-600">{baseUrl || '(chưa cấu hình)'}</div>
      <div className="flex gap-2">
        <input className="flex-1 rounded border px-3 py-1.5 text-sm" placeholder="https://redmine.example.com" value={input} disabled={busy} onChange={(e) => setInput(e.target.value)} />
        <button type="button" className={btnPrimary} disabled={busy || !input.trim()} onClick={luu}>Lưu</button>
      </div>
    </div>
  );
}

// ── Khung ngoài — 7 mục con ──────────────────────────────────────────────────────────────
type AdminMuc = 'teams' | 'feature_visibility' | 'release' | 'join_requests' | 'users' | 'audit' | 'redmine';

export function ManHinhAdmin() {
  const [muc, setMuc] = useState<AdminMuc>('teams');
  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-teal-600 text-white' : 'border bg-white text-slate-600 hover:bg-slate-50'}`;

  const MUCS: { key: AdminMuc; label: string }[] = [
    { key: 'teams', label: 'Team' },
    { key: 'feature_visibility', label: 'Hiển thị chức năng' },
    { key: 'release', label: 'Release' },
    { key: 'join_requests', label: 'Yêu cầu tham gia' },
    { key: 'users', label: 'Tài khoản' },
    { key: 'audit', label: 'Nhật ký' },
    { key: 'redmine', label: 'Redmine' }
  ];

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="rounded-lg border bg-white p-4">
        <h2 className="text-lg font-bold">Quản trị hệ thống</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {MUCS.map((m) => (
          <button key={m.key} type="button" className={tabClass(muc === m.key)} onClick={() => setMuc(m.key)}>{m.label}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {muc === 'teams' && <AdminTeams />}
        {muc === 'feature_visibility' && <AdminFeatureVisibility />}
        {muc === 'release' && <AdminReleaseConfig />}
        {muc === 'join_requests' && <AdminJoinRequests />}
        {muc === 'users' && <AdminUsers />}
        {muc === 'audit' && <AdminAudit />}
        {muc === 'redmine' && <AdminRedmine />}
      </div>
    </section>
  );
}
