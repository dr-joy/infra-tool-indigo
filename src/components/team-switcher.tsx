// Bộ chọn team hiện tại (CR-20260913 FR-13) — đặt ở thanh điều hướng, góc trên cạnh tên người dùng
// (CR §6.1: "kiểu chuyển workspace quen thuộc Slack/Notion"). Chuyển NGAY không tải lại trang: chỉ
// đổi state activeTeamId ở AuthContext, các màn phụ thuộc team tự re-fetch qua dependency effect.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, Users } from 'lucide-react';
import { useAuth } from '../auth-context';

export function TeamSwitcher() {
  const { actor, myTeams, activeTeamId, setActiveTeamId, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  if (!actor) return null;
  const activeTeam = myTeams.find((t) => t.id === activeTeamId) || null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-md border border-vien bg-white px-3 py-1.5 text-sm font-medium text-muc hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Users size={16} className="text-teal-600" />
        <span className="max-w-[12rem] truncate">{activeTeam ? activeTeam.name : 'Chưa chọn team'}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded-md border border-vien bg-white py-1 shadow-mem"
          role="listbox"
        >
          <div className="border-b px-3 py-2 text-xs text-phu">
            <div className="font-semibold text-muc">{actor.displayName}</div>
            <div className="truncate">{actor.email}</div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {myTeams.length === 0 && (
              <div className="px-3 py-2 text-sm text-phu">Bạn chưa thuộc team nào.</div>
            )}
            {myTeams.map((team) => (
              <button
                key={team.id}
                type="button"
                role="option"
                aria-selected={team.id === activeTeamId}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${team.id === activeTeamId ? 'bg-teal-50 font-semibold text-teal-700' : 'text-muc'}`}
                onClick={() => { setActiveTeamId(team.id); setOpen(false); }}
              >
                <span className="truncate">{team.name}</span>
                <span className="shrink-0 text-xs text-phu">{team.role === 'leader' ? 'Leader' : 'Member'}</span>
              </button>
            ))}
          </div>
          <div className="border-t pt-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
              onClick={() => { setOpen(false); void logout(); }}
            >
              <LogOut size={14} /> Đăng xuất
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
