// Lịch release chung — CR-20260913 Giai đoạn 2 (Lát 10). FR-24 (board xem chung), FR-23a (đăng ký/sửa
// lịch khẩn cấp của team mình), FR-25 (xung đột + ép giờ chung), FR-26 (khoá/mở khoá đầy đủ), FR-27
// (huỷ đợt), FR-23b (ấn định 1 ngày chính định kỳ). Route BE đã có sẵn từ Lát 6
// (server/routes/release-schedule.ts) — màn này CHỈ nối dây UI, không thêm nghiệp vụ mới ngoài 1 field
// nhỏ `coordinatorTeamId` được thêm vào response `GET /schedule-board` có sẵn (không phải route mới).
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, apiTeam } from '../api';
import { useToast } from '../context';
import { useAuth, useActiveTeamId } from '../auth-context';
import { Modal } from '../components/Modal';

function loiThanThien(e: unknown): string {
  return e instanceof Error ? e.message : 'Có lỗi xảy ra';
}

const btnPrimary = 'rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50';
const btnSecondary = 'rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50';
const btnDanger = 'rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50';

const VALID_SYSTEMS = ['Dr.JOY', 'Pr.JOY'];
const VALID_PLATFORMS = ['Web', 'Mobile'];

interface RegistrationBase {
  id: number; cycleId: number; teamId: number;
  deployStagingAt: string; releaseAt: string; deployDemoAt: string;
  affectedSystems: string[]; platforms: string[]; status: 'submitted' | 'locked' | 'cancelled';
}
interface RegistrationFull extends RegistrationBase {
  ticketNumbers: number[]; japanCoordinationLink: string | null; noJapanCoordinationReason: string | null;
  notes: string; rowVersion: number; createdAt: string; updatedAt: string;
}
type Registration = RegistrationFull | RegistrationBase;
function isFull(r: Registration): r is RegistrationFull { return 'rowVersion' in r; }

interface ConflictRow { id: number; registration_a_id: number; registration_b_id: number; status: 'open' | 'forced'; }
interface CycleBoard { id: number; releaseKey: string; status: string; lockedAt: string | null; registrations: Registration[]; conflicts: ConflictRow[]; }
interface BoardResponse { cycles: CycleBoard[]; coordinatorTeamId: number | null; }
interface TeamRow { id: number; name: string; description: string | null; }
interface RegularCycleRow { id: number; releaseKey: string; regularReleaseDate: string; }
interface UnlockRequestRow { id: number; registrationId: number; kind: 'edit' | 'cancel'; reason: string; createdAt: string; teamId: number; cycleId: number; }

function releaseDateOf(releaseKey: string): string {
  const idx = releaseKey.indexOf(':');
  return idx === -1 ? releaseKey : releaseKey.slice(idx + 1);
}

function splitWallClock(iso: string): { date: string; time: string } {
  // Server lưu wall-clock dạng ISO-like 'YYYY-MM-DDTHH:MM' (parseWallClock/wallClockDateKey) — tách
  // trực tiếp bằng chuỗi, không qua Date() để tránh lệch múi giờ trình duyệt.
  const [date, time] = iso.split('T');
  return { date: date || '', time: (time || '').slice(0, 5) };
}

export function ManHinhLichReleaseChung() {
  const activeTeamId = useActiveTeamId();
  const { myTeams } = useAuth();
  const toast = useToast();
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState<{ mode: 'create' } | { mode: 'edit'; reg: RegistrationFull } | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<RegistrationFull | null>(null);
  const [forceTimeTarget, setForceTimeTarget] = useState<{ conflict: ConflictRow; cycleId: number } | null>(null);
  const [regularDate, setRegularDate] = useState('');
  const [regularCycles, setRegularCycles] = useState<RegularCycleRow[]>([]);
  const [pendingUnlockRequests, setPendingUnlockRequests] = useState<UnlockRequestRow[]>([]);
  const [busy, setBusy] = useState(false);

  async function tai(alive?: { current: boolean }) {
    try {
      const [b, t, rc] = await Promise.all([
        api<BoardResponse>('/api/release/schedule-board'),
        api<{ teams: TeamRow[] }>('/api/teams'),
        api<RegularCycleRow[]>('/api/release/schedule/regular-cycles')
      ]);
      if (alive && !alive.current) return;
      setBoard(b);
      setTeams(t.teams);
      setRegularCycles(rc);
      setError('');
    } catch (e) {
      if (alive && !alive.current) return;
      setError(loiThanThien(e));
    } finally {
      if (!alive || alive.current) setLoading(false);
    }
  }
  // Board KHÔNG phụ thuộc activeTeamId (dữ liệu toàn cục, lọc field theo team ở server) nên effect này
  // chỉ chạy 1 lần lúc mount — cờ huỷ chỉ để tránh set-state sau unmount, không phải rủi ro lộ chéo team.
  useEffect(() => {
    const alive = { current: true };
    void tai(alive);
    return () => { alive.current = false; };
  }, []);

  // Tách riêng khỏi tai() ở trên: dùng đúng myTeams/board hiện tại qua dependency, không chụp closure
  // của myTeams tại thời điểm effect mount đầu tiên chạy (myTeams có thể chưa kịp nạp xong lúc đó nếu
  // AuthProvider chưa resolve reload() — chỉ Leader team điều phối gọi được route này, 403 với actor
  // khác, nên tải riêng thay vì gộp vào Promise.all trên để 1 route phụ 403 không chặn cả màn chính).
  useEffect(() => {
    let alive = true;
    const coordinatorTeamId = board?.coordinatorTeamId;
    if (coordinatorTeamId == null || !myTeams.some((mt) => mt.id === coordinatorTeamId && mt.role === 'leader')) {
      setPendingUnlockRequests([]);
      return () => { alive = false; };
    }
    api<UnlockRequestRow[]>('/api/release/schedule/unlock-requests')
      .then((rows) => { if (alive) setPendingUnlockRequests(rows); })
      .catch(() => { if (alive) setPendingUnlockRequests([]); });
    return () => { alive = false; };
  }, [board?.coordinatorTeamId, myTeams]);

  const myTeam = myTeams.find((t) => t.id === activeTeamId);
  const laLeader = myTeam?.role === 'leader';
  const laDieuPhoi = laLeader && board?.coordinatorTeamId != null && board.coordinatorTeamId === activeTeamId;
  function tenTeam(id: number) { return teams.find((t) => t.id === id)?.name || `team #${id}`; }

  async function guiYeuCauMoKhoa(reg: RegistrationFull, kind: 'edit' | 'cancel', reason: string) {
    if (activeTeamId == null) return;
    setBusy(true);
    setError('');
    try {
      await apiTeam(activeTeamId, `/api/release/schedule/registrations/${reg.id}/unlock-requests`, {
        method: 'POST', body: JSON.stringify({ kind, reason })
      });
      toast('Đã gửi yêu cầu tới Leader điều phối');
      setUnlockTarget(null);
      await tai();
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  async function huyTrucTiep(reg: RegistrationFull) {
    if (activeTeamId == null) return;
    setBusy(true);
    setError('');
    try {
      await apiTeam(activeTeamId, `/api/release/schedule/registrations/${reg.id}/cancel`, {
        method: 'POST', body: JSON.stringify({ rowVersion: reg.rowVersion })
      });
      toast('Đã huỷ đăng ký');
      await tai();
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  async function khoaCycle(cycleId: number) {
    if (!laDieuPhoi) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/release/schedule/cycles/${cycleId}/lock`, { method: 'POST' });
      toast('Đã khoá lịch đợt này');
      await tai();
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  async function duyetMoKhoa(requestId: number) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/release/schedule/unlock-requests/${requestId}/approve`, { method: 'POST' });
      toast('Đã duyệt yêu cầu');
      await tai();
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  async function anDinhNgayDinhKy() {
    if (!regularDate) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/release/schedule/regular-cycles', { method: 'POST', body: JSON.stringify({ regularReleaseDate: regularDate }) });
      toast('Đã ấn định ngày release định kỳ');
      setRegularDate('');
      await tai();
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

      {laDieuPhoi && (
        <div className="rounded-lg border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Ấn định ngày release định kỳ (team điều phối)</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className="rounded border px-3 py-1.5 text-sm" value={regularDate} disabled={busy} onChange={(e) => setRegularDate(e.target.value)} />
            <button type="button" className={btnPrimary} disabled={busy || !regularDate} onClick={anDinhNgayDinhKy}>Ấn định</button>
          </div>
          {regularCycles.length > 0 && (
            <div className="mt-2 text-xs text-slate-500">
              Đợt định kỳ đang mở: {regularCycles.map((c) => c.regularReleaseDate).join(', ')}
            </div>
          )}
        </div>
      )}

      {laDieuPhoi && pendingUnlockRequests.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Yêu cầu đang chờ duyệt</h3>
          <div className="flex flex-col gap-2">
            {pendingUnlockRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                <div>
                  <span className="font-medium">{tenTeam(r.teamId)}</span>
                  {' — '}{r.kind === 'edit' ? 'xin mở khoá để sửa' : 'xin huỷ đợt'}
                  <div className="text-xs text-slate-500">{r.reason}</div>
                </div>
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => duyetMoKhoa(r.id)}>Duyệt</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {laLeader && (
        <div>
          <button type="button" className={btnPrimary} onClick={() => setShowForm({ mode: 'create' })}>
            Đăng ký lịch release khẩn cấp cho team này
          </button>
        </div>
      )}

      {(board?.cycles.length ?? 0) === 0 && (
        <div className="rounded-lg border bg-white p-4 text-center text-sm text-slate-400">Chưa có đợt release khẩn cấp nào.</div>
      )}

      {board?.cycles.map((cycle) => (
        <div key={cycle.id} className="rounded-lg border bg-white">
          <div className="flex items-center justify-between border-b p-3">
            <div className="text-sm font-semibold">Đợt release {releaseDateOf(cycle.releaseKey)}</div>
            <div className="flex items-center gap-2">
              {cycle.lockedAt && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Đã khoá</span>}
              {laDieuPhoi && !cycle.lockedAt && (
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => khoaCycle(cycle.id)}>Khoá lịch</button>
              )}
            </div>
          </div>
          <div className="divide-y">
            {cycle.registrations.map((reg) => {
              const laTeamMinh = reg.teamId === activeTeamId;
              const full = isFull(reg) ? reg : null;
              return (
                <div key={reg.id} className="p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium">{tenTeam(reg.teamId)}</span>
                      {laTeamMinh && <span className="ml-1 rounded bg-teal-50 px-1.5 py-0.5 text-xs text-teal-700">Team bạn</span>}
                      {reg.status === 'locked' && <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">Khoá</span>}
                      {reg.status === 'cancelled' && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">Đã huỷ</span>}
                    </div>
                    {laTeamMinh && full && reg.status !== 'cancelled' && (
                      <div className="flex gap-2">
                        {reg.status === 'submitted' && (
                          <>
                            <button type="button" className={btnSecondary} onClick={() => setShowForm({ mode: 'edit', reg: full })}>Sửa</button>
                            <button type="button" className={btnDanger} disabled={busy} onClick={() => huyTrucTiep(full)}>Huỷ</button>
                          </>
                        )}
                        {reg.status === 'locked' && (
                          <button type="button" className={btnSecondary} onClick={() => setUnlockTarget(full)}>Gửi yêu cầu mở khoá / huỷ</button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-4">
                    <div>Deploy staging: <span className="text-slate-700">{splitWallClock(reg.deployStagingAt).date} {splitWallClock(reg.deployStagingAt).time}</span></div>
                    <div>Release: <span className="text-slate-700">{splitWallClock(reg.releaseAt).date} {splitWallClock(reg.releaseAt).time}</span></div>
                    <div>Deploy demo: <span className="text-slate-700">{splitWallClock(reg.deployDemoAt).time} (tự động)</span></div>
                    <div>Hệ thống/nền tảng: <span className="text-slate-700">{reg.affectedSystems.join(', ')} · {reg.platforms.join(', ')}</span></div>
                  </div>
                  {full && (
                    <div className="mt-1 text-xs text-slate-500">
                      Ticket: {full.ticketNumbers.length ? full.ticketNumbers.map((n) => `#${n}`).join(', ') : '—'}
                      {' · '}
                      {full.japanCoordinationLink ? <a className="underline" href={full.japanCoordinationLink} target="_blank" rel="noreferrer">Link Nhật</a> : `Không có link Nhật: ${full.noJapanCoordinationReason}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {cycle.conflicts.length > 0 && (
            <div className="border-t bg-amber-50 p-3">
              <div className="mb-1 text-xs font-semibold text-amber-800">Xung đột lịch</div>
              {cycle.conflicts.map((c) => {
                const a = cycle.registrations.find((r) => r.id === c.registration_a_id);
                const b = cycle.registrations.find((r) => r.id === c.registration_b_id);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2 py-1 text-xs">
                    <span>
                      {a ? tenTeam(a.teamId) : '?'} ↔ {b ? tenTeam(b.teamId) : '?'} — {c.status === 'open' ? 'chưa xử lý' : 'đã ép giờ chung'}
                    </span>
                    {laDieuPhoi && c.status === 'open' && (
                      <button type="button" className={btnSecondary} onClick={() => setForceTimeTarget({ conflict: c, cycleId: cycle.id })}>Ép giờ chung</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {showForm && activeTeamId != null && (
        <PopupDangKyLich
          teamId={activeTeamId}
          existing={showForm.mode === 'edit' ? showForm.reg : null}
          onClose={() => setShowForm(null)}
          onDone={() => { setShowForm(null); void tai(); }}
        />
      )}
      {unlockTarget && (
        <PopupYeuCauMoKhoa reg={unlockTarget} busy={busy} onClose={() => setUnlockTarget(null)} onSubmit={(kind, reason) => guiYeuCauMoKhoa(unlockTarget, kind, reason)} />
      )}
      {forceTimeTarget && (
        <PopupEpGioChung
          conflictId={forceTimeTarget.conflict.id}
          onClose={() => setForceTimeTarget(null)}
          onDone={() => { setForceTimeTarget(null); void tai(); }}
        />
      )}
    </div>
  );
}

function PopupDangKyLich({ teamId, existing, onClose, onDone }: {
  teamId: number; existing: RegistrationFull | null; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [stagingDate, setStagingDate] = useState(existing ? splitWallClock(existing.deployStagingAt).date : '');
  const [stagingTime, setStagingTime] = useState(existing ? splitWallClock(existing.deployStagingAt).time : '');
  const [releaseDate, setReleaseDate] = useState(existing ? splitWallClock(existing.releaseAt).date : '');
  const [releaseTime, setReleaseTime] = useState(existing ? splitWallClock(existing.releaseAt).time : '');
  const [systems, setSystems] = useState<string[]>(existing?.affectedSystems || []);
  const [platforms, setPlatforms] = useState<string[]>(existing?.platforms || []);
  const [ticketInput, setTicketInput] = useState('');
  const [tickets, setTickets] = useState<number[]>(existing?.ticketNumbers || []);
  const [japanLink, setJapanLink] = useState(existing?.japanCoordinationLink || '');
  const [japanReason, setJapanReason] = useState(existing?.noJapanCoordinationReason || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }
  function themTicket() {
    const n = Number(ticketInput.trim());
    if (Number.isInteger(n) && n > 0 && !tickets.includes(n)) setTickets([...tickets, n]);
    setTicketInput('');
  }

  async function luu() {
    setBusy(true);
    setError('');
    try {
      const body = {
        teamId,
        deployStagingAt: { date: stagingDate, time: stagingTime },
        releaseAt: { date: releaseDate, time: releaseTime },
        affectedSystems: systems, platforms, ticketNumbers: tickets,
        japanCoordinationLink: japanLink || undefined, noJapanCoordinationReason: japanReason || undefined,
        notes, rowVersion: existing?.rowVersion
      };
      if (existing) {
        await apiTeam(teamId, `/api/release/schedule/registrations/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast('Đã sửa đăng ký');
      } else {
        await apiTeam(teamId, '/api/release/schedule/registrations', { method: 'POST', body: JSON.stringify(body) });
        toast('Đã đăng ký lịch release khẩn cấp');
      }
      onDone();
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  // FR-23a: đúng 1 trong 2 (link Nhật HOẶC lý do không có), không cả hai cùng có/cùng trống.
  const dungMotJapan = Boolean(japanLink.trim()) !== Boolean(japanReason.trim());
  const hopLe = Boolean(stagingDate && stagingTime && releaseDate && releaseTime && systems.length > 0 && platforms.length > 0 && dungMotJapan);

  return (
    <Modal onClose={onClose} dismissable={!busy} scroll>
      <div className="popup w-full max-w-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{existing ? 'Sửa đăng ký lịch release khẩn cấp' : 'Đăng ký lịch release khẩn cấp'}</h2>
          <button type="button" className="nut-icon" onClick={onClose}><X size={18} /></button>
        </div>
        {error && <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">Ngày deploy staging</span>
              <input type="date" className="rounded border px-2 py-1" value={stagingDate} onChange={(e) => setStagingDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">Giờ deploy staging</span>
              <input type="time" className="rounded border px-2 py-1" value={stagingTime} onChange={(e) => setStagingTime(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">Ngày release</span>
              <input type="date" className="rounded border px-2 py-1" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600">Giờ release</span>
              <input type="time" className="rounded border px-2 py-1" value={releaseTime} onChange={(e) => setReleaseTime(e.target.value)} />
            </label>
          </div>
          <div className="text-xs text-slate-500">Deploy demo tự tính 16:00 cùng ngày release — không nhập tay được.</div>

          <div>
            <div className="mb-1 text-sm text-slate-600">Hệ thống bị ảnh hưởng</div>
            <div className="flex gap-2">
              {VALID_SYSTEMS.map((s) => (
                <label key={s} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={systems.includes(s)} onChange={() => toggle(systems, setSystems, s)} />{s}</label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm text-slate-600">Nền tảng bị ảnh hưởng</div>
            <div className="flex gap-2">
              {VALID_PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(platforms, setPlatforms, p)} />{p}</label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-sm text-slate-600">Mã ticket <span className="text-amber-700">(điền sai mã có thể làm bài thông báo sai)</span></div>
            <div className="flex flex-wrap items-center gap-1">
              {tickets.map((n) => (
                <span key={n} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs">
                  #{n} <button type="button" onClick={() => setTickets(tickets.filter((t) => t !== n))}><X size={10} /></button>
                </span>
              ))}
              <input
                className="w-20 rounded border px-2 py-1 text-sm"
                placeholder="Số…"
                value={ticketInput}
                onChange={(e) => setTicketInput(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); themTicket(); } }}
                onBlur={themTicket}
              />
            </div>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Link trao đổi với Nhật (hoặc điền lý do không có bên dưới)</span>
            <input className="rounded border px-2 py-1" value={japanLink} onChange={(e) => setJapanLink(e.target.value)} placeholder="https://…" disabled={Boolean(japanReason.trim())} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Lý do không có link (nếu không có link)</span>
            <input className="rounded border px-2 py-1" value={japanReason} onChange={(e) => setJapanReason(e.target.value)} disabled={Boolean(japanLink.trim())} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Ghi chú (tuỳ chọn)</span>
            <textarea className="rounded border px-2 py-1" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Hủy</button>
          <button type="button" className={btnPrimary} disabled={busy || !hopLe} onClick={luu}>{existing ? 'Lưu' : 'Đăng ký'}</button>
        </div>
      </div>
    </Modal>
  );
}

function PopupYeuCauMoKhoa({ reg, busy, onClose, onSubmit }: {
  reg: RegistrationFull; busy: boolean; onClose: () => void; onSubmit: (kind: 'edit' | 'cancel', reason: string) => void;
}) {
  const [kind, setKind] = useState<'edit' | 'cancel'>('edit');
  const [reason, setReason] = useState('');
  void reg;
  return (
    <Modal onClose={onClose} dismissable={!busy}>
      <div className="popup w-full max-w-md">
        <h2 className="mb-3 text-lg font-bold">Gửi yêu cầu tới Leader điều phối</h2>
        <div className="mb-2 flex gap-4 text-sm">
          <label className="flex items-center gap-1"><input type="radio" checked={kind === 'edit'} onChange={() => setKind('edit')} /> Mở khoá để sửa</label>
          <label className="flex items-center gap-1"><input type="radio" checked={kind === 'cancel'} onChange={() => setKind('cancel')} /> Huỷ đợt</label>
        </div>
        <textarea className="w-full rounded border px-2 py-1 text-sm" rows={3} placeholder="Lý do…" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Hủy</button>
          <button type="button" className={btnPrimary} disabled={busy || !reason.trim()} onClick={() => onSubmit(kind, reason.trim())}>Gửi yêu cầu</button>
        </div>
      </div>
    </Modal>
  );
}

function PopupEpGioChung({ conflictId, onClose, onDone }: { conflictId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [stagingTime, setStagingTime] = useState('');
  const [releaseTime, setReleaseTime] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function xacNhan() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/release/schedule/conflicts/${conflictId}/force-time`, {
        method: 'POST',
        body: JSON.stringify({
          deployStagingAt: { date, time: stagingTime },
          releaseAt: { date, time: releaseTime }
        })
      });
      toast('Đã ép giờ chung cho cả 2 team');
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
        <h2 className="mb-3 text-lg font-bold">Ép giờ chung</h2>
        <p className="mb-2 text-xs text-amber-700">Ghi đè trực tiếp giờ deploy staging/release của CẢ HAI team đang xung đột — không đụng ticket/nền tảng/ghi chú riêng của từng team.</p>
        {error && <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm"><span className="text-slate-600">Ngày (giữ nguyên ngày đợt hiện tại)</span><input type="date" className="rounded border px-2 py-1" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-slate-600">Giờ deploy staging</span><input type="time" className="rounded border px-2 py-1" value={stagingTime} onChange={(e) => setStagingTime(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-slate-600">Giờ release</span><input type="time" className="rounded border px-2 py-1" value={releaseTime} onChange={(e) => setReleaseTime(e.target.value)} /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Hủy</button>
          <button type="button" className={btnDanger} disabled={busy || !date || !stagingTime || !releaseTime} onClick={xacNhan}>Xác nhận ép giờ</button>
        </div>
      </div>
    </Modal>
  );
}
