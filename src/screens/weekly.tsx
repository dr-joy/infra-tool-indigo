// Màn hình "Báo cáo tuần": mục tiêu tuần theo project + tự đánh giá đạt/vượt,
// editor báo cáo (markdown -> HTML), quản lý rủi ro (RiskDM). Tách khỏi main.tsx.
// Chỉ ManHinhBaoCaoTuan được export; các popup/helper là nội bộ màn này.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell, CalendarDays, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Copy, Download, GripVertical, History, Info, Pencil, Plus, Search, Target, Trash2, X
} from 'lucide-react';
import { useLang } from '../useLang';
import type { TranslationKey } from '../i18n';
import { InfoTip } from '../ui';
import { api, apiTeam, ApiError } from '../api';
import { useActiveTeamId } from '../auth-context';
import { Modal } from '../components/Modal';
import { PopupXacNhanXoa } from '../components/dialogs';
import { usePics, useToast } from '../context';
import {
  taoNgayTuInput, localDateInputValue, mondayOfWeek, congNgayInput, currentVietnamDateInputValue,
  dinhDangNgay, dinhDangNgayDayDu, addDays, timeToMinutes, minutesToTime, clamp
} from '../lib/date';
import {
  splitAssignees, clientAutoStatus, parseGoalConflict, goalConflictMessage,
  tenTrangThai, trangThaiLabel, PIC_COLOR_PALETTE, progressSelectOptions, projectTaskProgressOptions
} from '../lib/task-utils';
import type {
  ProjectItem, ProjectTaskItem, Task, DuLieuDashboard, PicItem
} from '../types';

interface ReportKindInfo {
  id: string;
  label: string;
  lang: string;
}

function isoAddDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + n);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function ddmmLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

// Số tuần ISO (tuần chứa Thứ 5 đầu năm = tuần 1) + năm tương ứng, để hiển thị "Tuần 25, 2026".
function isoWeek(iso: string): { week: number; year: number } {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const dayNum = (dt.getUTCDay() + 6) % 7; // T2=0 … CN=6
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3); // về Thứ 5 cùng tuần
  const isoYear = dt.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((dt.getTime() - firstThu.getTime()) / 604800000);
  return { week, year: isoYear };
}

// ── Chuyển Markdown (subset của báo cáo DM) -> HTML để paste vào Google Docs/Word ra định dạng đẹp ──
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inlineMd(s: string): string {
  // escape HTML trước, rồi đổi `code` inline
  return escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}
function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '') { closeList(); i += 1; continue; }
    if (line === '---') { closeList(); out.push('<hr>'); i += 1; continue; }
    if (line.startsWith('## ')) { closeList(); out.push(`<h2>${inlineMd(line.slice(3))}</h2>`); i += 1; continue; }
    if (line.startsWith('# ')) { closeList(); out.push(`<h1>${inlineMd(line.slice(2))}</h1>`); i += 1; continue; }
    if (line.startsWith('* ') || line.startsWith('- ')) {
      if (!listOpen) { out.push('<ul>'); listOpen = true; }
      out.push(`<li>${inlineMd(line.slice(2))}</li>`);
      i += 1; continue;
    }
    if (line.startsWith('|')) {
      closeList();
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { tableLines.push(lines[i].trim()); i += 1; }
      const splitRow = (r: string) => r.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const header = splitRow(tableLines[0] || '');
      const body = tableLines.slice(2).map(splitRow); // bỏ dòng "| --- |"
      const th = header.map((c) => `<th style="border:1px solid #999;padding:4px">${inlineMd(c)}</th>`).join('');
      const trs = body.map((r) => '<tr>' + r.map((c) => `<td style="border:1px solid #999;padding:4px">${inlineMd(c)}</td>`).join('') + '</tr>').join('');
      out.push(`<table style="border-collapse:collapse"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
      continue;
    }
    closeList();
    out.push(`<p>${inlineMd(line)}</p>`);
    i += 1;
  }
  closeList();
  return out.join('');
}

interface ReportHistoryItem {
  id: string;
  weekStart: string;
  kind: string;
  mode: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface WeekGoalItem {
  id: string;
  projectId: string | null;
  projectName: string;
  projectOrder: number;
  taskNumber: string;
  taskOrder: number;
  text: string;
  assignee: string;
  targetProgress: number | null;
  isManual: boolean;
}

interface WeekGoalsResponse {
  hasGoals: boolean;
  prevEvaluated: boolean;
  goals: WeekGoalItem[];
}

interface DmRiskInput { projectId: string | null; risk: string; mitigation: string }

// Bước 1 của Báo cáo DM: nhập Risk + biện pháp đối ứng cho từng project có mục tiêu tuần này (bắt buộc).
function PopupRiskDM({
  projects,
  onClose,
  onNext,
}: {
  projects: { key: string; name: string }[];
  onClose: () => void;
  onNext: (risks: DmRiskInput[]) => Promise<void>;
}) {
  const [vals, setVals] = useState<Record<string, { risk: string; mitigation: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function setField(key: string, field: 'risk' | 'mitigation', value: string) {
    setVals((cur) => ({
      ...cur,
      [key]: { risk: cur[key]?.risk || '', mitigation: cur[key]?.mitigation || '', [field]: value },
    }));
  }

  const allFilled = projects.every((p) => vals[p.key]?.risk?.trim() && vals[p.key]?.mitigation?.trim());

  async function next(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allFilled) { setError('Vui lòng nhập Risk và biện pháp xử lý cho tất cả project.'); return; }
    setBusy(true);
    setError('');
    try {
      await onNext(projects.map((p) => ({
        projectId: p.key === 'other' ? null : p.key,
        risk: vals[p.key].risk.trim(),
        mitigation: vals[p.key].mitigation.trim(),
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tạo báo cáo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal scroll onClose={onClose} dismissable={!busy}>
      <form className="popup w-full max-w-2xl" onSubmit={next}>
        <div className="mb-4 flex items-center justify-between border-b border-vien pb-3">
          <h2 className="text-xl font-bold text-muc">Risk &amp; biện pháp xử lý — Báo cáo DM</h2>
          <button type="button" className="nut-icon" disabled={busy} onClick={onClose}><X size={18} /></button>
        </div>
        <p className="mb-4 text-sm text-phu">Nhập Risk và biện pháp đối ứng cho từng project có mục tiêu tuần này (bắt buộc).</p>
        {projects.length === 0 ? (
          <p className="text-sm text-phu">Tuần này chưa có mục tiêu nào để nhập Risk.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {projects.map((p) => (
              <div key={p.key} className="rounded-md border border-vien p-3">
                <div className="mb-2 font-bold text-muc">{p.name}</div>
                <label className="field">
                  Risk
                  <textarea rows={2} value={vals[p.key]?.risk || ''} onChange={(e) => setField(p.key, 'risk', e.target.value)} required />
                </label>
                <label className="field">
                  Biện pháp xử lý Risk
                  <textarea rows={2} value={vals[p.key]?.mitigation || ''} onChange={(e) => setField(p.key, 'mitigation', e.target.value)} required />
                </label>
              </div>
            ))}
          </div>
        )}
        {error && <p className="release-error mt-3">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" className="nut-phu" disabled={busy} onClick={onClose}>Hủy</button>
          <button type="submit" className="nut-chinh" disabled={busy || projects.length === 0}>Next →</button>
        </div>
      </form>
    </Modal>
  );
}

export function ManHinhBaoCaoTuan() {
  const { t } = useLang();
  const toast = useToast();
  // CR-20260913 FR-13 — mọi route weekly.ts bắt buộc teamId (query/body do bộ chọn team gửi lên).
  const activeTeamId = useActiveTeamId();
  const [weekStart, setWeekStart] = useState('');
  const [currentWeek, setCurrentWeek] = useState('');
  const [kinds, setKinds] = useState<ReportKindInfo[]>([]);
  const [kind, setKind] = useState('internal');
  // draft = nội dung báo cáo nháp; null = chưa tạo (màn hình trống khi mới vào)
  const [draft, setDraft] = useState<string | null>(null);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
  const [viewingHistory, setViewingHistory] = useState<ReportHistoryItem | null>(null);
  const [historyDangXoa, setHistoryDangXoa] = useState<ReportHistoryItem | null>(null);
  const [weekGoals, setWeekGoals] = useState<WeekGoalItem[]>([]);
  const [prevEvaluated, setPrevEvaluated] = useState(false);
  const [goalDangXoa, setGoalDangXoa] = useState<WeekGoalItem | null>(null);
  const [moXoaAllGoals, setMoXoaAllGoals] = useState(false);
  // Đã chạy wizard xong cho tuần này (chốt mục tiêu + đánh giá tuần trước) -> khóa "Tạo báo cáo"
  const reportLocked = weekGoals.length > 0 && prevEvaluated;
  const [needOverwrite, setNeedOverwrite] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [moWizard, setMoWizard] = useState(false);
  const [moRisk, setMoRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  // Đã lưu báo cáo nháp hiện tại vào history -> khóa edit + ẩn nút Lưu/Xóa nháp
  const [daLuu, setDaLuu] = useState(false);
  const [moChonTuan, setMoChonTuan] = useState(false);
  const weekPickerRef = useRef<HTMLDivElement>(null);
  const currentWeekRowRef = useRef<HTMLButtonElement>(null);
  const isDM = kind === 'vn_management';

  // Danh sách tuần để chọn: ±52 tuần quanh tuần hiện tại (mặc định thấy ~11 tuần, scroll xem xa hơn).
  const weekOptions = useMemo(() => {
    if (!currentWeek) return [] as { ws: string; week: number; year: number }[];
    const arr: { ws: string; week: number; year: number }[] = [];
    for (let i = -52; i <= 52; i++) {
      const ws = isoAddDays(currentWeek, i * 7);
      const { week, year } = isoWeek(ws);
      arr.push({ ws, week, year });
    }
    return arr;
  }, [currentWeek]);

  // Đóng box chọn tuần khi bấm ra ngoài
  useEffect(() => {
    if (!moChonTuan) return;
    function onClickOutside(e: MouseEvent) {
      if (!weekPickerRef.current?.contains(e.target as Node)) setMoChonTuan(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMoChonTuan(false); }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [moChonTuan]);

  // Mở box -> cuộn để tuần hiện tại nằm giữa
  useEffect(() => {
    if (moChonTuan) currentWeekRowRef.current?.scrollIntoView({ block: 'center' });
  }, [moChonTuan]);

  // aliveRef: cờ huỷ (cancellation guard, giống pattern `alive` ở personal-task.tsx) — chỉ dùng khi
  // gọi TỪ effect nạp theo activeTeamId bên dưới. Đổi team nhanh khiến response cũ có thể set state
  // SAU khi đã hiển thị team mới; effect cleanup đặt aliveRef.current = false để response trễ tự bỏ
  // qua (Council review Lát 7 giai đoạn 1). Nơi khác gọi 2 hàm này không truyền aliveRef -> giữ
  // nguyên hành vi cũ.
  async function taiHistory(aliveRef?: { current: boolean }) {
    if (activeTeamId == null) return;
    try {
      const data = await apiTeam<ReportHistoryItem[]>(activeTeamId, '/api/weeks/report-history');
      if (aliveRef && !aliveRef.current) return;
      setHistory(data);
    } catch { /* ignore */ }
  }

  async function taiWeekGoals(week: string, aliveRef?: { current: boolean }) {
    if (!week || activeTeamId == null) return;
    try {
      const res = await apiTeam<WeekGoalsResponse>(activeTeamId, `/api/weeks/${week}/goals`);
      if (aliveRef && !aliveRef.current) return;
      setWeekGoals(res.goals);
      setPrevEvaluated(res.prevEvaluated);
    } catch { /* ignore */ }
  }

  // Mục tiêu tuần gom theo project, sort theo project rồi theo "ID task" (1, 1.1, …)
  const weekGoalGroups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; order: number; items: WeekGoalItem[] }>();
    for (const g of weekGoals) {
      const key = g.projectId ?? 'other';
      if (!map.has(key)) map.set(key, { key, name: g.projectName, order: g.projectOrder, items: [] });
      map.get(key)!.items.push(g);
    }
    const groups = [...map.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'));
    groups.forEach((grp) => grp.items.sort((a, b) => a.taskOrder - b.taskOrder));
    return groups;
  }, [weekGoals]);

  // Chỉ hiển thị history của TUẦN ĐANG CHỌN (Nội bộ + DM cùng tuần đi 1 cặp).
  // history đã được server sắp xếp theo kind tăng dần nên giữ nguyên thứ tự là đủ.
  const historyThisWeek = useMemo(
    () => history.filter((h) => h.weekStart === weekStart),
    [history, weekStart],
  );
  // Tuần này đã có báo cáo (đúng loại đang chọn) trong history -> khóa nút "Tạo báo cáo".
  // Muốn tạo lại phải xóa báo cáo cũ ở History trước.
  const daCoBaoCao = historyThisWeek.some((h) => h.kind === kind);

  async function xoaAllGoals() {
    if (activeTeamId == null) return;
    await apiTeam(activeTeamId, `/api/weeks/${weekStart}/goals`, { method: 'DELETE' });
    setMoXoaAllGoals(false);
    setDraft(null);
    await taiWeekGoals(weekStart);
  }

  useEffect(() => {
    if (activeTeamId == null) return;
    const aliveRef = { current: true };
    (async () => {
      try {
        const meta = await apiTeam<{ currentWeek: string; kinds: ReportKindInfo[] }>(activeTeamId, '/api/weeks/report-kinds');
        if (!aliveRef.current) return;
        setKinds(meta.kinds);
        if (meta.kinds.length > 0) setKind(meta.kinds[0].id);
        setCurrentWeek(meta.currentWeek);
        setWeekStart(meta.currentWeek);
        await taiHistory(aliveRef);
        await taiWeekGoals(meta.currentWeek, aliveRef);
      } catch (e) {
        if (aliveRef.current) setError(e instanceof Error ? e.message : 'Lỗi tải dữ liệu');
      }
    })();
    // Đổi team ở bộ chọn (FR-13) phải tự nạp lại toàn bộ màn Báo cáo tuần, KHÔNG tải lại trang.
    // aliveRef bị dọn khi effect cleanup chạy (đổi team lần nữa/unmount) -> response trễ của team cũ
    // (report-kinds/history/goals) bị bỏ, không ghi đè lên dữ liệu team đang xem.
    return () => { aliveRef.current = false; };
  }, [activeTeamId]);

  async function generateDraft(week = weekStart, k = kind) {
    if (!week || activeTeamId == null) return;
    try {
      const res = await apiTeam<{ text: string }>(activeTeamId, `/api/weeks/${week}/text?kind=${k}`);
      setDraft(res.text);
      setDaLuu(false);
      setViewingHistory(null);
      setNeedOverwrite(false);
      setSavedMsg('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi tải báo cáo');
    }
  }

  // Báo cáo DM: sinh nội dung sau khi đã nhập Risk ở bước 1.
  async function generateDmDraft(risks: DmRiskInput[]) {
    if (activeTeamId == null) return;
    const res = await apiTeam<{ text: string }>(activeTeamId, `/api/weeks/${weekStart}/dm-report`, {
      method: 'POST',
      body: JSON.stringify({ risks }),
    });
    setDraft(res.text);
    setDaLuu(false);
    setViewingHistory(null);
    setNeedOverwrite(false);
    setSavedMsg('');
    setMoRisk(false);
  }

  function changeWeek(next: string) {
    setWeekStart(next);
    setDraft(null);
    setDaLuu(false);
    setViewingHistory(null);
    setNeedOverwrite(false);
    setSavedMsg('');
    setError('');
    void taiWeekGoals(next);
  }

  async function xoaGoal(item: WeekGoalItem) {
    // DELETE /weeks/:weekStart/goals/:id suy team_id từ chính dòng weekly_goals (server/routes/
    // weekly.ts) — không cần client gửi teamId, khác các route list/tạo mới bên dưới.
    await api(`/api/weeks/${weekStart}/goals/${item.id}`, { method: 'DELETE' });
    setGoalDangXoa(null);
    await taiWeekGoals(weekStart);
    // nháp đang mở thì sinh lại cho khớp với danh sách mục tiêu mới
    if (draft != null) await generateDraft();
  }

  // Đổi loại báo cáo: DM phải đi qua bước nhập Risk nên xóa nháp; loại khác thì sinh lại nếu đang có nháp.
  function changeKind(k: string) {
    setKind(k);
    setNeedOverwrite(false);
    setDaLuu(false);
    if (k === 'vn_management') { setDraft(null); return; }
    if (draft != null) void generateDraft(weekStart, k);
  }

  // Phê duyệt: validate báo cáo tuần đã tồn tại chưa; force = ghi đè
  async function approve(force = false) {
    if (!draft || !draft.trim() || activeTeamId == null) return;
    setBusy(true);
    setError('');
    setSavedMsg('');
    try {
      await apiTeam(activeTeamId, `/api/weeks/${weekStart}/report-history`, {
        method: 'POST',
        body: JSON.stringify({ kind, content: draft, force })
      });
      setNeedOverwrite(false);
      setDaLuu(true);
      toast(force ? 'Đã ghi đè báo cáo' : 'Đã lưu báo cáo');
      await taiHistory();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REPORT_EXISTS') {
        setNeedOverwrite(true);
        setError('Báo cáo của tuần này (cùng loại) đã tồn tại trong history. Bấm "Ghi đè" nếu muốn thay thế.');
      } else {
        setError(e instanceof Error ? e.message : 'Không thể lưu báo cáo');
      }
    } finally {
      setBusy(false);
    }
  }

  async function xoaHistory(item: ReportHistoryItem) {
    await api(`/api/weeks/report-history/${item.id}`, { method: 'DELETE' });
    if (viewingHistory?.id === item.id) setViewingHistory(null);
    setHistoryDangXoa(null);
    await taiHistory();
  }

  async function copyText() {
    const content = viewingHistory ? viewingHistory.content : draft || '';
    // Báo cáo dạng markdown (có tiêu đề ## / bảng | --- |) -> copy kèm HTML để dán vào
    // Google Docs/Word ra định dạng đẹp (tiêu đề, bảng thật). Báo cáo thường -> copy text thuần.
    const looksMarkdown = content.includes('## ') || content.includes('| ---');
    try {
      if (looksMarkdown && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const html = markdownToHtml(content);
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([content], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(content);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  // Xuất Excel cho Báo cáo DM (CR-20260915-xuat-excel-bao-cao-dm) — không phụ thuộc draft/Risk đang gõ,
  // luôn dựng lại từ dữ liệu mới nhất của tuần trên server. 404 (tuần rỗng) hiện qua banner lỗi có sẵn.
  const [dangXuatExcel, setDangXuatExcel] = useState(false);
  async function xuatExcelDM() {
    if (activeTeamId == null) return;
    setDangXuatExcel(true);
    setError('');
    try {
      const res = await fetch(`/api/weeks/${weekStart}/dm-report.xlsx?teamId=${activeTeamId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        setError(body?.message || 'Không thể xuất file Excel');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bao-cao-dm-tuan-${weekStart}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể xuất file Excel');
    } finally {
      setDangXuatExcel(false);
    }
  }

  function kindLabel(id: string) {
    return kinds.find((k) => k.id === id)?.label || id;
  }

  if (!weekStart) {
    return <section className="flex-1 p-4 text-sm text-slate-500">{t('loading.data')}</section>;
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Thanh chọn tuần + nút tạo báo cáo */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 shadow-sm">
        {/* Bộ chọn tuần dạng segmented: ‹ | tuần (bấm để mở box chọn) | › */}
        <div className="relative" ref={weekPickerRef}>
          <div className="flex items-center overflow-hidden rounded-lg border border-slate-300 shadow-sm">
            <button
              type="button"
              className="nav-step-button"
              onClick={() => changeWeek(isoAddDays(weekStart, -7))}
              title="Tuần trước"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="flex h-9 min-w-[180px] flex-col items-center justify-center border-x border-slate-300 bg-slate-50 px-3 leading-tight text-slate-700 transition hover:bg-slate-100"
              onClick={() => setMoChonTuan((v) => !v)}
              title="Bấm để chọn tuần"
            >
              <span className="flex items-center gap-1 text-sm font-semibold">
                <CalendarDays size={14} className="text-slate-400" /> Tuần {isoWeek(weekStart).week}, {isoWeek(weekStart).year}
              </span>
              <span className="text-[11px] text-slate-400">{ddmmLabel(weekStart)} – {ddmmLabel(isoAddDays(weekStart, 4))}</span>
            </button>
            <button
              type="button"
              className="nav-step-button"
              onClick={() => changeWeek(isoAddDays(weekStart, 7))}
              title="Tuần sau"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {moChonTuan && (
            <div className="absolute left-0 top-full z-50 mt-1 w-[260px] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg">
              <div className="max-h-[352px] overflow-y-auto py-1">
                {weekOptions.map((opt) => {
                  const isCurrent = opt.ws === currentWeek;
                  const isSelected = opt.ws === weekStart;
                  return (
                    <button
                      key={opt.ws}
                      ref={isCurrent ? currentWeekRowRef : undefined}
                      type="button"
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-teal-50 ${isSelected ? 'bg-teal-100 font-semibold text-teal-600' : 'text-slate-700'}`}
                      onClick={() => { changeWeek(opt.ws); setMoChonTuan(false); }}
                    >
                      <span className="flex items-center gap-1.5">
                        <span>Tuần {opt.week}, {opt.year}</span>
                        {isCurrent && <span className="rounded bg-teal-100 px-1 text-[10px] font-medium text-teal-600">Tuần này</span>}
                      </span>
                      <span className="text-[11px] text-slate-400">{ddmmLabel(opt.ws)} – {ddmmLabel(isoAddDays(opt.ws, 4))}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={weekStart === currentWeek}
          onClick={() => changeWeek(currentWeek)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            weekStart === currentWeek
              ? 'cursor-default border border-slate-200 bg-slate-50 text-slate-400'
              : 'bg-teal-600 text-white shadow-sm hover:bg-teal-700'
          }`}
          title={weekStart === currentWeek ? 'Bạn đang ở tuần hiện tại' : 'Về tuần hiện tại'}
        >
          Tuần này
        </button>
        <div className="flex items-center gap-2">
          {!viewingHistory && (
            <select className="rounded border border-slate-300 py-1.5 pl-2 pr-8 text-xs" value={kind} onChange={(e) => changeKind(e.target.value)} title="Loại báo cáo">
              {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          )}
          <button
            className="flex items-center gap-1 rounded bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={() => (isDM ? setMoRisk(true) : setMoWizard(true))}
            disabled={daCoBaoCao || (isDM ? weekGoals.length === 0 : reportLocked)}
            title={daCoBaoCao
              ? `Tuần này đã có báo cáo "${kindLabel(kind)}" trong History. Muốn tạo lại, hãy xóa báo cáo cũ ở History trước.`
              : isDM
                ? (weekGoals.length === 0
                  ? 'Chưa có mục tiêu tuần. Hãy tạo Báo cáo nội bộ Dev13 trước (chốt mục tiêu + đánh giá), rồi mới tạo Báo cáo DM.'
                  : 'Nhập Risk & biện pháp cho từng project rồi sinh nội dung Báo cáo DM')
                : (reportLocked
                  ? 'Tuần này đã chốt mục tiêu và đánh giá tuần trước. Xóa toàn bộ mục tiêu tuần (nút bên phải) rồi mới tạo lại được.'
                  : 'Quy trình: nhập tiến độ → lý do & ghi chú → summary → duyệt mục tiêu tuần')}
          >
            <Target size={14} /> Tạo báo cáo
          </button>
          {isDM && !viewingHistory && (
            <button
              type="button"
              className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={xuatExcelDM}
              disabled={dangXuatExcel}
              title="Xuất file Excel (Project → PIC → Task) cho báo cáo DM tuần này"
            >
              <Download size={14} /> {dangXuatExcel ? 'Đang xuất…' : 'Tải Excel'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {savedMsg && <div className="rounded bg-teal-50 px-3 py-2 text-sm text-teal-600">{savedMsg}</div>}

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Khu nội dung báo cáo — rộng hơn (cột phải đã thu hẹp ~30%) */}
        <div className="flex min-h-0 flex-[3] min-w-0 flex-col rounded-lg border border-slate-400 bg-white p-3 shadow-md">
          <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
            <h3 className="text-sm font-bold text-teal-600">{viewingHistory ? `History tuần ${ddmmLabel(viewingHistory.weekStart)}` : 'Nội dung báo cáo'}</h3>
            {viewingHistory && (
              <span className="text-xs text-slate-500">{kindLabel(viewingHistory.kind)}</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {(viewingHistory || draft != null) && (
                <button className="flex items-center gap-1 rounded border px-2 py-1.5 text-xs hover:bg-slate-50" onClick={copyText}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Đã copy' : 'Copy'}
                </button>
              )}
              {viewingHistory ? (
                <button className="rounded border px-3 py-1.5 text-xs hover:bg-slate-50" onClick={() => setViewingHistory(null)}>Đóng</button>
              ) : draft != null && !daLuu && (
                <>
                  <button className="rounded border px-2 py-1.5 text-xs text-red-600 hover:bg-red-50" onClick={() => { setDraft(null); setNeedOverwrite(false); setSavedMsg(''); }}>Xóa nháp</button>
                  {needOverwrite ? (
                    <button className="rounded bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50" disabled={busy} onClick={() => approve(true)}>Ghi đè</button>
                  ) : (
                    <button className="rounded bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50" disabled={busy} onClick={() => approve(false)}>Lưu báo cáo</button>
                  )}
                </>
              )}
            </div>
          </div>
          {viewingHistory ? (
            <textarea
              className="min-h-0 flex-1 resize-none rounded border bg-slate-50 p-2 font-mono text-xs leading-relaxed"
              value={viewingHistory.content}
              readOnly
              spellCheck={false}
            />
          ) : draft == null ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded border border-dashed bg-slate-50 text-sm text-slate-500">
              <p>Chưa có nội dung báo cáo cho tuần này.</p>
              <p>Bấm <b>Tạo báo cáo</b> và hoàn thành các bước để sinh nội dung.</p>
            </div>
          ) : (
            <textarea
              className={`min-h-0 flex-1 resize-none rounded border p-2 font-mono text-xs leading-relaxed ${daLuu ? 'bg-slate-50' : 'bg-white'}`}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setSavedMsg(''); }}
              readOnly={daLuu}
              spellCheck={false}
            />
          )}
        </div>

        {/* Cột phải: mục tiêu tuần này + history (thu hẹp ~30% nhường chỗ cho nội dung) */}
        <div className="flex flex-[2] min-w-0 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-400 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-2 border-b border-slate-300 pb-2">
            <h3 className="flex items-center gap-1 text-sm font-bold text-teal-600"><Target size={14} className="text-teal-600" /> Mục tiêu tuần này ({weekGoals.length})</h3>
            {weekGoals.length > 0 && (
              <button
                type="button"
                className="ml-auto flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                title="Xóa toàn bộ mục tiêu của tuần này"
                onClick={() => setMoXoaAllGoals(true)}
              >
                <Trash2 size={13} /> Xóa tất cả
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {weekGoals.length === 0 && <div className="text-xs text-slate-400">Chưa có mục tiêu nào. Chạy &quot;Tạo báo cáo&quot; để duyệt mục tiêu.</div>}
            {weekGoalGroups.map((grp) => (
              <div key={grp.key} className="mb-2">
                <div className="mb-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-sm font-bold text-teal-600">{grp.name}</div>
                {grp.items.map((g) => (
                  <div key={g.id} className="mb-1 flex items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm last:mb-0">
                    <span className="w-10 shrink-0 font-semibold text-slate-500">{g.isManual ? '—' : g.taskNumber}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{g.text}</div>
                      <div className="text-xs text-slate-400">
                        {g.assignee ? g.assignee : '(chưa gán)'}{g.targetProgress != null ? ` · mục tiêu ${g.targetProgress}%` : ''}{g.isManual ? ' · gõ tay' : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="nut-icon nut-trash-icon shrink-0 self-center"
                      title="Xóa mục tiêu này khỏi tuần"
                      onClick={() => setGoalDangXoa(g)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* History báo cáo của tuần đang chọn — cao vừa khít nội dung */}
        <div className="flex shrink-0 flex-col rounded-lg border border-slate-400 bg-white p-3 shadow-sm">
          <h3 className="mb-2 border-b border-slate-300 pb-2 text-sm font-bold text-teal-600">History báo cáo</h3>
          <div>
            {historyThisWeek.length === 0 ? (
              <div className="text-xs text-slate-400">Chưa có báo cáo nào cho tuần này.</div>
            ) : (
              <div className="rounded border border-slate-300 bg-slate-50 p-2 shadow-sm">
                <div className="mb-1.5 flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                  <CalendarDays size={15} className="shrink-0 text-slate-400" />
                  <span className="text-sm font-bold text-slate-700">Tuần {isoWeek(weekStart).week}, {isoWeek(weekStart).year}</span>
                  <span className="text-xs text-slate-400">({ddmmLabel(weekStart)} – {ddmmLabel(isoAddDays(weekStart, 4))})</span>
                </div>
                <div className="flex flex-col gap-1">
                  {historyThisWeek.map((item) => (
                    <div
                      key={item.id}
                      className={`flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-sm hover:border-teal-200 hover:bg-teal-50 ${viewingHistory?.id === item.id ? 'border-teal-300 bg-teal-50 ring-1 ring-teal-300' : ''}`}
                      onClick={() => { setViewingHistory(item); setSavedMsg(''); setError(''); }}
                    >
                      <span className="font-medium text-slate-700">{kindLabel(item.kind)}</span>
                      <span className="text-xs text-slate-400">· {new Date(item.updatedAt).toLocaleDateString('vi-VN')}</span>
                      <button
                        type="button"
                        className="nut-icon nut-trash-icon ml-auto shrink-0"
                        title="Xóa báo cáo này khỏi history"
                        onClick={(e) => { e.stopPropagation(); setHistoryDangXoa(item); }}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {moWizard && (
        <PopupTaoBaoCao
          weekStart={weekStart}
          onClose={() => setMoWizard(false)}
          onDone={async () => { await generateDraft(); await taiWeekGoals(weekStart); }}
        />
      )}
      {moRisk && (
        <PopupRiskDM
          projects={weekGoalGroups.map((g) => ({ key: g.key, name: g.name }))}
          onClose={() => setMoRisk(false)}
          onNext={generateDmDraft}
        />
      )}
      {historyDangXoa && (
        <PopupXacNhanXoa
          title="Xóa báo cáo khỏi history"
          message={`Xóa báo cáo tuần ${ddmmLabel(historyDangXoa.weekStart)} (${kindLabel(historyDangXoa.kind)})? Hành động này không hoàn tác được.`}
          onClose={() => setHistoryDangXoa(null)}
          onConfirm={() => xoaHistory(historyDangXoa)}
        />
      )}
      {goalDangXoa && (
        <PopupXacNhanXoa
          title="Xóa mục tiêu tuần"
          message={`Bỏ mục tiêu "${goalDangXoa.text}" khỏi tuần ${ddmmLabel(weekStart)}? Task trong project không bị ảnh hưởng.`}
          onClose={() => setGoalDangXoa(null)}
          onConfirm={() => xoaGoal(goalDangXoa)}
        />
      )}
      {moXoaAllGoals && (
        <PopupXacNhanXoa
          title="Xóa toàn bộ mục tiêu tuần"
          message={`Xóa tất cả ${weekGoals.length} mục tiêu của tuần ${ddmmLabel(weekStart)}? Task trong project không bị ảnh hưởng. Sau khi xóa bạn có thể bấm "Tạo báo cáo" để chạy lại từ đầu.`}
          onClose={() => setMoXoaAllGoals(false)}
          onConfirm={xoaAllGoals}
        />
      )}
    </section>
  );
}

type EvalStatusUI = 'dat' | 'vuot' | 'khong_dat';
const evalStatusLabels: Record<EvalStatusUI, string> = {
  dat: '✅ Hoàn thành',
  vuot: '🔼 Vượt chỉ tiêu',
  khong_dat: '❌ Không hoàn thành'
};

interface EvalGoalView {
  taskId: string; taskNumber: string; taskOrder: number; title: string; assignee: string; currentProgress: number; startProgress: number | null; targetProgress: number;
  autoStatus: EvalStatusUI; status: EvalStatusUI; note: string;
}
interface EvalProjectView { projectId: string; name: string; goals: EvalGoalView[]; }
interface SavedUnplannedView { taskId: string; taskNumber: string; taskOrder: number; projectId: string; projectName: string; title: string; currentProgress: number; note: string; }
interface ManualGoalPlanView { goalId: string; projectName: string; text: string; assignee: string; done: boolean; note: string; }
interface ProposedGoalView {
  taskId: string; taskNumber: string; taskOrder: number; projectId: string; projectName: string; title: string; assignee: string; dueDate: string;
  currentProgress: number; computedTarget: number; estimateHours: number | null; isCarryOver: boolean; explanation: string;
  remainingDays: number; thisWeekDays: number;
}
interface ReportPlanView {
  weekStart: string; weekEnd: string; today: string;
  evaluation: EvalProjectView[]; manualGoals: ManualGoalPlanView[]; savedUnplanned: SavedUnplannedView[];
  projectSummaries: { projectId: string; content: string }[];
  summaryProjects: { projectId: string; name: string }[];
  proposals: ProposedGoalView[];
}

// Droplist PIC chọn được NHIỀU người (giá trị là chuỗi "A, B"), gọn cho dùng trong bảng.
// Menu dùng position:fixed neo theo nút -> không bị khung cuộn (overflow) của wizard cắt mất,
// và tự lật lên trên nếu gần đáy màn hình. Đóng khi click ngoài hoặc cuộn.
function MultiPicSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const selected = splitAssignees(value);
  const allOptions = [...options];
  selected.forEach((name) => { if (!allOptions.includes(name)) allOptions.push(name); });

  useEffect(() => {
    if (!open) return;
    function reposition() {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const menuH = Math.min(allOptions.length * 30 + 10, 240);
      const openUp = r.bottom + menuH + 6 > window.innerHeight;
      setMenuStyle({
        position: 'fixed',
        left: r.left,
        width: Math.max(r.width, 144),
        zIndex: 60,
        ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    }
    reposition();
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onScrollOrResize() { setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, allOptions.length]);

  return (
    <div className="multi-pic" ref={ref}>
      <button ref={btnRef} type="button" className="multi-pic-trigger" onClick={() => setOpen((v) => !v)}>
        <span className={`truncate ${selected.length > 0 ? '' : 'text-slate-400'}`}>{selected.length > 0 ? selected.join(', ') : 'PIC'}</span>
        <ChevronDown size={14} className="shrink-0 text-slate-500" />
      </button>
      {open && (
        <div className="multi-pic-menu" style={menuStyle}>
          {allOptions.map((name) => (
            <label key={name} className="multi-pic-option">
              <input
                type="checkbox"
                checked={selected.includes(name)}
                onChange={() => {
                  const next = selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name];
                  onChange(next.join(', '));
                }}
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Wizard tạo báo cáo tuần: 1. nhập tiến độ -> 2. lý do & ghi chú từng task -> 3. summary -> 4. duyệt mục tiêu.
function PopupTaoBaoCao({ weekStart, onClose, onDone }: { weekStart: string; onClose: () => void; onDone: () => void }) {
  const { pics: picOptions } = usePics();
  const activeTeamId = useActiveTeamId();
  const [step, setStep] = useState(1);
  const [plan, setPlan] = useState<ReportPlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progressDraft, setProgressDraft] = useState<Record<string, number>>({});
  const [evalDraft, setEvalDraft] = useState<Record<string, { status: EvalStatusUI; note: string }>>({});
  const [unplannedNotes, setUnplannedNotes] = useState<Record<string, string>>({});
  // Mục tiêu gõ tay tuần trước: tick đã xong + ghi chú
  const [manualGoalDraft, setManualGoalDraft] = useState<Record<string, { done: boolean; note: string }>>({});
  // Đánh giá chung theo project (bước Summary)
  const [projectSummaryDraft, setProjectSummaryDraft] = useState<Record<string, string>>({});
  // target = null -> dùng mục tiêu gợi ý (tự tính theo % thực tế); có số -> người dùng đã chỉnh tay.
  const [approvals, setApprovals] = useState<Record<string, { approved: boolean; target: number | null; assignee: string }>>({});
  // Mục tiêu "Khác" gõ tay thêm mới cho tuần này (bước 4) -> tạo task thật trong project "Khác"
  const [newManualGoals, setNewManualGoals] = useState<{ text: string; assignee: string; target: number }[]>([]);
  const [newManualText, setNewManualText] = useState('');
  const [newManualAssignee, setNewManualAssignee] = useState('');
  const [newManualTarget, setNewManualTarget] = useState(100);
  // (c) Màn xác nhận tổng hợp trước khi lưu
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);

  function applyPlan(p: ReportPlanView, isFirstLoad: boolean) {
    setPlan(p);
    const prog: Record<string, number> = {};
    p.evaluation.forEach((ep) => ep.goals.forEach((g) => { prog[g.taskId] = g.currentProgress; }));
    p.proposals.forEach((pr) => { prog[pr.taskId] = pr.currentProgress; });
    p.savedUnplanned.forEach((u) => { if (prog[u.taskId] == null) prog[u.taskId] = u.currentProgress; });
    if (isFirstLoad) {
      setProgressDraft(prog);
    }
    // đánh giá: giữ phần người dùng đã sửa trong phiên, bổ sung mặc định cho task mới
    setEvalDraft((cur) => {
      const next = { ...cur };
      p.evaluation.forEach((ep) => ep.goals.forEach((g) => {
        if (!next[g.taskId]) next[g.taskId] = { status: g.status, note: g.note };
      }));
      return next;
    });
    setUnplannedNotes((cur) => {
      const next = { ...cur };
      p.savedUnplanned.forEach((u) => { if (next[u.taskId] == null) next[u.taskId] = u.note; });
      return next;
    });
    setManualGoalDraft((cur) => {
      const next = { ...cur };
      p.manualGoals.forEach((m) => { if (!next[m.goalId]) next[m.goalId] = { done: m.done, note: m.note }; });
      return next;
    });
    setProjectSummaryDraft((cur) => {
      const next = { ...cur };
      p.projectSummaries.forEach((s) => { if (next[s.projectId] == null) next[s.projectId] = s.content; });
      return next;
    });
    setApprovals((cur) => {
      const next: Record<string, { approved: boolean; target: number | null; assignee: string }> = {};
      p.proposals.forEach((pr) => { next[pr.taskId] = cur[pr.taskId] || { approved: true, target: null, assignee: pr.assignee }; });
      return next;
    });
  }

  // aliveRef: cờ huỷ — wizard này cũng đọc activeTeamId riêng, đổi team trong lúc wizard đang mở
  // (nếu bộ chọn team vẫn bấm được) phải bỏ response trễ của team cũ, không áp kế hoạch sai team lên
  // form (Council review Lát 7 giai đoạn 1).
  async function loadPlan(aliveRef?: { current: boolean }) {
    if (activeTeamId == null) return;
    setLoading(true);
    try {
      const p = await apiTeam<ReportPlanView>(activeTeamId, `/api/weeks/${weekStart}/plan`);
      if (aliveRef && !aliveRef.current) return;
      applyPlan(p, true);
    } catch (e) {
      if (aliveRef && !aliveRef.current) return;
      setError(e instanceof Error ? e.message : 'Lỗi tải kế hoạch');
    } finally {
      if (!aliveRef || aliveRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    const aliveRef = { current: true };
    void loadPlan(aliveRef);
    return () => { aliveRef.current = false; };
  }, [activeTeamId]);

  const prevWeekStart = isoAddDays(weekStart, -7);

  // BƯỚC 1: tiến độ các task MỤC TIÊU TUẦN TRƯỚC (+ task ngoài kế hoạch đã ghi nhận).
  // Chỉ tuần trước — không trộn mục tiêu tuần này (mục tiêu tuần này đặt ở bước 4).
  const progressGroups = useMemo(() => {
    if (!plan) return [] as { projectId: string; name: string; rows: { taskId: string; num: string; order: number; title: string; currentProgress: number; startProgress: number | null; targetProgress: number | null }[] }[];
    const map = new Map<string, { projectId: string; name: string; rows: { taskId: string; num: string; order: number; title: string; currentProgress: number; startProgress: number | null; targetProgress: number | null }[] }>();
    const push = (projectId: string, name: string, taskId: string, num: string, order: number, title: string, currentProgress: number, startProgress: number | null, targetProgress: number | null) => {
      if (!map.has(projectId)) map.set(projectId, { projectId, name, rows: [] });
      const group = map.get(projectId)!;
      if (!group.rows.some((r) => r.taskId === taskId)) group.rows.push({ taskId, num, order, title, currentProgress, startProgress, targetProgress });
    };
    plan.evaluation.forEach((ep) => ep.goals.forEach((g) => push(ep.projectId, ep.name, g.taskId, g.taskNumber, g.taskOrder, g.title, g.currentProgress, g.startProgress, g.targetProgress)));
    plan.savedUnplanned.forEach((u) => push(u.projectId, u.projectName, u.taskId, u.taskNumber, u.taskOrder, u.title, u.currentProgress, null, null));
    const groups = [...map.values()];
    groups.forEach((g) => g.rows.sort((a, b) => a.order - b.order));
    return groups;
  }, [plan]);

  // Task ngoài kế hoạch tuần trước đã lưu trước đó. Step 1 không còn là nơi nhập % tiến độ.
  const unplannedTasks = useMemo(() => {
    if (!plan) return [] as { taskId: string; num: string; order: number; projectName: string; title: string; currentProgress: number }[];
    return plan.savedUnplanned
      .map((u) => ({ taskId: u.taskId, num: u.taskNumber, order: u.taskOrder, projectName: u.projectName, title: u.title, currentProgress: u.currentProgress }))
      .sort((a, b) => a.order - b.order);
  }, [plan]);

  // Đề xuất mục tiêu tuần này, đồng bộ với tiến độ thực tế đã update trên Gantt:
  //  - currentProgress = % thực tế mới nhất từ plan
  //  - computedTarget tính lại theo % thực tế (cùng công thức server, dựa trên số ngày còn lại)
  //  - task đã đạt 100% -> loại khỏi đề xuất
  const activeProposals = useMemo(() => {
    if (!plan) return [] as ProposedGoalView[];
    return plan.proposals
      .map((pr) => {
        const cur = progressDraft[pr.taskId] ?? pr.currentProgress;
        const target = pr.remainingDays <= 0
          ? 100
          : Math.min(100, cur + Math.round(((100 - cur) / pr.remainingDays) * pr.thisWeekDays));
        return { ...pr, currentProgress: cur, computedTarget: target };
      })
      .filter((pr) => pr.currentProgress < 100);
  }, [plan, progressDraft]);

  function goToStep2() {
    // KHÔNG ghi tiến độ ở đây — chỉ tính trạng thái đạt/không đạt theo % mới nhất từ Gantt.
    // Mọi thứ chỉ lưu 1 lần khi phê duyệt cuối (finish).
    if (plan) {
      setEvalDraft((cur) => {
        const next = { ...cur };
        plan.evaluation.forEach((ep) => ep.goals.forEach((g) => {
          const prog = progressDraft[g.taskId] ?? g.currentProgress;
          next[g.taskId] = { status: clientAutoStatus(prog, g.targetProgress), note: next[g.taskId]?.note ?? g.note };
        }));
        return next;
      });
    }
    setError('');
    setStep(2);
  }

  // Sang bước 3: bắt buộc nhập lý do cho mọi task "không đạt" (enforce bước "tìm hiểu lý do")
  function goToStep3() {
    if (plan) {
      const thieuLyDo = plan.evaluation.flatMap((ep) => ep.goals).filter((g) => {
        const d = evalDraft[g.taskId] || { status: g.autoStatus, note: g.note };
        return d.status === 'khong_dat' && !d.note.trim();
      });
      if (thieuLyDo.length > 0) {
        setError(`Còn ${thieuLyDo.length} task "không đạt" chưa nhập lý do. Vui lòng điền lý do trước khi tiếp tục.`);
        return;
      }
    }
    setError('');
    setStep(3);
  }

  // (b) Sang bước 4: bắt buộc nhập đánh giá chung cho mỗi project có task đánh giá
  function goToStep4() {
    if (plan) {
      const thieu = plan.evaluation.filter((ep) => ep.goals.length > 0 && !(projectSummaryDraft[ep.projectId] || '').trim());
      if (thieu.length > 0) {
        setError(`Còn ${thieu.length} dự án chưa nhập đánh giá chung: ${thieu.map((e) => e.name).join(', ')}.`);
        return;
      }
    }
    setError('');
    setStep(4);
  }

  async function finish() {
    if (!plan || activeTeamId == null) return;
    setBusy(true);
    setError('');
    try {
      const evaluations = [
        ...plan.evaluation.flatMap((ep) => ep.goals.map((g) => ({
          taskId: g.taskId,
          status: evalDraft[g.taskId]?.status || g.autoStatus,
          note: evalDraft[g.taskId]?.note || '',
          unplanned: false
        }))),
        ...unplannedTasks.map((u) => ({
          taskId: u.taskId,
          status: 'dat',
          note: unplannedNotes[u.taskId] || '',
          unplanned: true
        }))
      ];
      const manualGoalUpdates = plan.manualGoals.map((m) => ({
        goalId: m.goalId,
        done: manualGoalDraft[m.goalId]?.done ?? m.done,
        note: manualGoalDraft[m.goalId]?.note ?? m.note
      }));
      const approvedGoals = activeProposals
        .filter((pr) => approvals[pr.taskId]?.approved)
        .map((pr) => ({ projectTaskId: pr.taskId, projectId: pr.projectId, assignee: approvals[pr.taskId].assignee, targetProgress: approvals[pr.taskId].target ?? pr.computedTarget }));
      // mục tiêu "Khác" gõ tay -> server tạo task thật trong project "Khác".
      // Gồm cả dòng đang gõ dở chưa bấm "Thêm" để không bị mất khi duyệt.
      const pendingManual = newManualText.trim()
        ? [{ text: newManualText.trim(), assignee: newManualAssignee, target: newManualTarget }]
        : [];
      const newKhacGoals = [...newManualGoals, ...pendingManual]
        .filter((g) => g.text.trim())
        .map((g) => ({ text: g.text.trim(), assignee: g.assignee, targetProgress: g.target }));
      const projectSummaries = plan.summaryProjects.map((sp) => ({ projectId: sp.projectId, content: projectSummaryDraft[sp.projectId] || '' }));
      await apiTeam(activeTeamId, `/api/weeks/${weekStart}/apply`, { method: 'POST', body: JSON.stringify({ evaluations, manualGoalUpdates, projectSummaries, approvedGoals, newKhacGoals }) });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi lưu báo cáo');
    } finally {
      setBusy(false);
    }
  }

  const approvedCount = activeProposals.filter((pr) => approvals[pr.taskId]?.approved).length
    + newManualGoals.filter((g) => g.text.trim()).length
    + (newManualText.trim() ? 1 : 0);

  // (c) Tổng hợp cho màn xác nhận trước khi lưu
  const finalCounts = useMemo(() => {
    const c = { dat: 0, vuot: 0, khong_dat: 0 };
    if (plan) plan.evaluation.forEach((ep) => ep.goals.forEach((g) => { c[evalDraft[g.taskId]?.status || g.autoStatus] += 1; }));
    return c;
  }, [plan, evalDraft]);

  // BƯỚC 4: gom đề xuất theo project (giữ thứ tự server đã sort theo ID task)
  const proposalGroups = useMemo(() => {
    const map = new Map<string, { projectId: string; name: string; items: ProposedGoalView[] }>();
    activeProposals.forEach((pr) => {
      if (!map.has(pr.projectId)) map.set(pr.projectId, { projectId: pr.projectId, name: pr.projectName, items: [] });
      map.get(pr.projectId)!.items.push(pr);
    });
    return [...map.values()];
  }, [activeProposals]);

  return (
    <Modal onClose={onClose}>
      <form className="popup w-full max-w-6xl" onSubmit={(e) => e.preventDefault()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-xl font-bold">
            Tạo báo cáo tuần — bước {step}/4
            {/* Quy trình thứ 2 hàng tuần — gom vào tooltip cho gọn */}
            <InfoTip>
              <b>Quy trình họp đầu tuần:</b> ① Xem tiến độ task <b>tuần trước</b> ({ddmmLabel(prevWeekStart)}–{ddmmLabel(isoAddDays(prevWeekStart, 4))})
              → ② Đánh giá đạt / không đạt + lý do → ③ Tổng kết theo dự án → ④ Đặt mục tiêu <b>tuần này</b> ({ddmmLabel(weekStart)}–{ddmmLabel(isoAddDays(weekStart, 4))}).
            </InfoTip>
          </h2>
          <button type="button" className="nut-icon" onClick={onClose}><X size={18} /></button>
        </div>
        {/* thanh bước */}
        <div className="mb-3 flex gap-2 text-xs">
          {['1. Xem tiến độ tuần trước', '2. Đánh giá & lý do', '3. Tổng kết', '4. Mục tiêu tuần này'].map((label, i) => (
            <div key={label} className={`rounded px-2 py-1 ${step === i + 1 ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{label}</div>
          ))}
        </div>

        {error && <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {loading ? <div className="py-10 text-center text-sm text-slate-500">Đang tải…</div> : (
          <div className="h-[72vh] overflow-auto">
            {/* BƯỚC 1: xem tiến độ thực tế các task mục tiêu TUẦN TRƯỚC */}
            {step === 1 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                  Tiến độ task mục tiêu tuần trước
                  <InfoTip>
                    Tiến độ task mục tiêu <b>tuần trước</b> ({ddmmLabel(prevWeekStart)}–{ddmmLabel(isoAddDays(prevWeekStart, 4))}) được lấy từ Gantt chart.
                  </InfoTip>
                </p>
                {progressGroups.length === 0 && <div className="rounded border border-dashed bg-slate-50 p-3 text-sm text-slate-400">Tuần trước chưa có mục tiêu nào. Bấm &quot;Tiếp tục&quot; để sang bước đặt mục tiêu tuần này.</div>}
                {progressGroups.map((group) => (
                  <div key={group.projectId} className="mb-3 overflow-hidden rounded border">
                    <div className="border-b bg-slate-100 px-2 py-1.5 text-sm font-bold">{group.name}</div>
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col className="w-14" />
                        <col />
                        <col className="w-56" />
                        <col className="w-36" />
                      </colgroup>
                      <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                        <tr>
                          <th className="px-2 py-1.5 text-left">ID</th>
                          <th className="px-2 py-1.5 text-left">Task</th>
                          <th className="px-2 py-1.5 text-left">Mục tiêu tuần trước</th>
                          <th className="px-2 py-1.5 text-right">Hiện tại</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => {
                          const isReached = row.targetProgress == null ? false : row.currentProgress >= row.targetProgress;
                          const targetLabel = row.targetProgress == null
                            ? 'Ngoài kế hoạch'
                            : `${row.startProgress == null ? '?' : `${row.startProgress}%`} -> ${row.targetProgress}%`;
                          return (
                          <tr key={row.taskId} className="border-b last:border-b-0 hover:bg-slate-50">
                            <td className="px-2 py-2 align-top text-xs font-semibold text-slate-500">{row.num}</td>
                            <td className="px-2 py-2 align-top">
                              <div className="font-medium text-slate-700">{row.title}</div>
                            </td>
                            <td className="px-2 py-2 align-top">
                              <div className="text-sm font-semibold text-slate-700">{targetLabel}</div>
                              {row.startProgress == null && row.targetProgress != null && (
                                <div className="mt-0.5 text-xs text-slate-400">Mục tiêu cũ chưa có mốc đầu</div>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right align-top">
                              <span className={`inline-flex min-w-16 justify-center rounded px-2 py-1 text-sm font-semibold ${isReached ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-700'}`}>
                                {row.currentProgress}%
                              </span>
                              {row.targetProgress != null && (
                                <div className={`mt-1 text-xs ${isReached ? 'text-teal-600' : 'text-slate-400'}`}>{isReached ? 'Đạt mục tiêu' : 'Chưa đạt'}</div>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            {/* BƯỚC 2: lý do & ghi chú từng task */}
            {step === 2 && plan && (
              <div>
                <p className="mb-2 text-sm text-gray-600">
                  Đánh giá từng task tuần trước: <b>đạt / không đạt / vượt</b>. Task <b>không đạt bắt buộc nhập lý do</b> trước khi qua bước sau.
                </p>
                {plan.evaluation.length === 0 && unplannedTasks.length === 0 && (
                  <div className="text-sm text-slate-400">Tuần trước không có mục tiêu nào để đánh giá.</div>
                )}
                {plan.evaluation.map((ep) => (
                  <div key={ep.projectId} className="mb-3 overflow-hidden rounded-lg border border-slate-400 shadow-sm">
                    <div className="border-b border-slate-400 bg-slate-200 px-3 py-1.5 text-sm font-bold text-slate-800">{ep.name}</div>
                    <div className="divide-y divide-slate-200 bg-white px-2">
                    {ep.goals.map((g) => {
                      const draft = evalDraft[g.taskId] || { status: g.autoStatus, note: g.note };
                      const thieuLyDo = draft.status === 'khong_dat' && !draft.note.trim();
                      const curProg = progressDraft[g.taskId] ?? g.currentProgress;
                      return (
                        <div key={g.taskId} className="py-1.5">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="w-12 text-xs font-semibold text-slate-500">{g.taskNumber}</span>
                            <span className="flex-1 truncate">{g.title}</span>
                            {g.assignee && <span className="shrink-0 text-xs text-slate-400">[{g.assignee}]</span>}
                            <span className={`shrink-0 text-xs ${draft.status === 'khong_dat' ? 'text-red-500' : 'text-teal-600'}`}>{curProg}% / {g.targetProgress}%</span>
                            <select className="w-40 shrink-0 rounded border border-slate-300 py-0.5 pl-2 pr-6 text-xs"
                              value={draft.status}
                              onChange={(e) => setEvalDraft((c) => ({ ...c, [g.taskId]: { ...draft, status: e.target.value as EvalStatusUI } }))}>
                              {(Object.keys(evalStatusLabels) as EvalStatusUI[]).map((s) => (
                                <option key={s} value={s}>{evalStatusLabels[s]}</option>
                              ))}
                            </select>
                          </div>
                          {draft.status !== 'dat' && (
                            <input className={`mt-1 w-full rounded border px-2 py-1 text-sm ${thieuLyDo ? 'border-red-400 bg-red-50 placeholder:text-red-400' : 'border-slate-300'}`}
                              placeholder={draft.status === 'khong_dat' ? 'Lý do không hoàn thành (bắt buộc)…' : 'Lý do vượt chỉ tiêu (nếu cần)…'}
                              value={draft.note}
                              onChange={(e) => setEvalDraft((c) => ({ ...c, [g.taskId]: { ...draft, note: e.target.value } }))} />
                          )}
                        </div>
                      );
                    })}
                    </div>
                  </div>
                ))}
                {unplannedTasks.length > 0 && (
                  <div className="mb-3 rounded-lg border border-teal-300 bg-teal-50 p-2 shadow-sm">
                    <div className="mb-1 font-semibold text-teal-600">Task ngoài kế hoạch tuần trước</div>
                    {unplannedTasks.map((u) => (
                      <div key={u.taskId} className="border-b border-slate-300 py-1.5 last:border-b-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="w-12 text-xs font-semibold text-slate-500">{u.num}</span>
                          <span className="text-xs text-slate-400">{u.projectName}</span>
                          <span className="flex-1 truncate">{u.title}</span>
                          <span className="text-xs text-slate-500">{u.currentProgress}%</span>
                        </div>
                        <input className="mt-1 w-full rounded border px-2 py-1 text-sm"
                          placeholder="Ghi chú (vì sao làm task này, phát sinh từ đâu)…"
                          value={unplannedNotes[u.taskId] || ''}
                          onChange={(e) => setUnplannedNotes((c) => ({ ...c, [u.taskId]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                )}
                {plan.manualGoals.length > 0 && (
                  <div className="mb-3 rounded-lg border border-slate-400 p-2 shadow-sm">
                    <div className="mb-1 font-semibold">Mục tiêu gõ tay tuần trước (việc lẻ)</div>
                    {plan.manualGoals.map((m) => {
                      const draft = manualGoalDraft[m.goalId] || { done: m.done, note: m.note };
                      return (
                        <div key={m.goalId} className="border-b py-1.5 last:border-b-0">
                          <div className="flex items-center gap-2 text-sm">
                            <label className="flex items-center gap-1.5">
                              <input type="checkbox" checked={draft.done}
                                onChange={(e) => setManualGoalDraft((c) => ({ ...c, [m.goalId]: { ...draft, done: e.target.checked } }))} />
                              <span>{draft.done ? '✅' : '❌'}</span>
                            </label>
                            <span className="text-xs text-slate-400">{m.projectName}</span>
                            <span className="flex-1 truncate">{m.text}</span>
                            {m.assignee && <span className="text-xs text-slate-400">[{m.assignee}]</span>}
                          </div>
                          {!draft.done && (
                            <input className="mt-1 w-full rounded border px-2 py-1 text-sm"
                              placeholder="Lý do chưa xong…"
                              value={draft.note}
                              onChange={(e) => setManualGoalDraft((c) => ({ ...c, [m.goalId]: { ...draft, note: e.target.value } }))} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* BƯỚC 3: đánh giá chung theo project (project tuần trước ∪ tuần này) + số task ✅/🔼/❌ nếu có */}
            {step === 3 && plan && (
              <div>
                {plan.summaryProjects.length === 0 && <div className="text-sm text-slate-400">Chưa có project nào để tổng kết.</div>}
                {plan.summaryProjects.map((sp) => {
                  const ep = plan.evaluation.find((e) => e.projectId === sp.projectId);
                  const counts = { dat: 0, vuot: 0, khong_dat: 0 };
                  ep?.goals.forEach((g) => { counts[evalDraft[g.taskId]?.status || g.autoStatus] += 1; });
                  return (
                    <div key={sp.projectId} className="mb-3 rounded border p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-3">
                        <span className="text-base font-bold">{sp.name}</span>
                        {ep ? (
                          <div className="ml-auto flex flex-wrap items-center gap-3">
                            <span className="rounded bg-teal-50 px-2 py-0.5 text-sm font-semibold text-teal-600">✅ {counts.dat} hoàn thành</span>
                            <span className="rounded bg-teal-50 px-2 py-0.5 text-sm font-semibold text-teal-600">🔼 {counts.vuot} vượt chỉ tiêu</span>
                            <span className="rounded bg-red-50 px-2 py-0.5 text-sm font-semibold text-red-600">❌ {counts.khong_dat} không hoàn thành</span>
                          </div>
                        ) : (
                          <span className="ml-auto text-xs text-slate-400">(Tuần trước không có mục tiêu)</span>
                        )}
                      </div>
                      <textarea
                        className="w-full rounded border px-3 py-2 text-sm"
                        rows={4}
                        placeholder={`Đánh giá chung cho ${sp.name} (sẽ hiện trong báo cáo)…`}
                        value={projectSummaryDraft[sp.projectId] || ''}
                        onChange={(e) => setProjectSummaryDraft((c) => ({ ...c, [sp.projectId]: e.target.value }))}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* BƯỚC 4: duyệt mục tiêu tuần */}
            {step === 4 && plan && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                  Mục tiêu tuần này ({ddmmLabel(weekStart)}–{ddmmLabel(isoAddDays(weekStart, 4))})
                  <InfoTip>
                    Mục tiêu <b>tuần này</b> ({ddmmLabel(weekStart)}–{ddmmLabel(isoAddDays(weekStart, 4))}): gồm <b>carry-over</b> (mục tiêu tuần trước chưa xong — mặc định tích để tiếp tục, bỏ tích nếu không muốn) và task có hạn rơi vào tuần. Chỉnh % mục tiêu &amp; PIC nếu cần.
                  </InfoTip>
                </p>
                {plan.proposals.length === 0 && <div className="text-sm text-slate-400">Không có task nào trùng tuần này.</div>}
                {proposalGroups.map((group) => (
                  <div key={group.projectId} className="mb-3 overflow-hidden rounded border">
                    <div className="border-b bg-slate-100 px-2 py-1.5 text-sm font-bold">{group.name}</div>
                    <table className="w-full text-sm">
                      <tbody>
                        {group.items.map((pr) => {
                          const a = approvals[pr.taskId] || { approved: true, target: null, assignee: pr.assignee };
                          const targetVal = a.target ?? pr.computedTarget;
                          return (
                            <tr key={pr.taskId} className={`border-b last:border-b-0 hover:bg-slate-50 ${a.approved ? '' : 'opacity-50'}`}>
                              <td className="w-8 px-2 py-1.5 text-center">
                                <input type="checkbox" checked={a.approved} onChange={(e) => setApprovals((c) => ({ ...c, [pr.taskId]: { ...a, approved: e.target.checked } }))} />
                              </td>
                              <td className="w-14 px-2 py-1.5 text-xs font-semibold text-slate-500">{pr.taskNumber}</td>
                              <td className="px-2 py-1.5">
                                <span className="font-medium" title={pr.explanation}>{pr.title}</span>
                                {pr.isCarryOver && <span className="ml-1.5 rounded bg-teal-100 px-1 text-xs text-teal-600">carry-over</span>}
                              </td>
                              <td className="w-36 whitespace-nowrap px-2 py-1 text-right">
                                <span className="mr-1 text-xs text-slate-400">{pr.currentProgress}% →</span>
                                <select className="w-24 rounded border px-2 py-1"
                                  value={targetVal}
                                  onChange={(e) => setApprovals((c) => ({ ...c, [pr.taskId]: { ...a, target: Number(e.target.value) } }))}>
                                  {progressSelectOptions(targetVal).filter((v) => v >= 10 || v === targetVal).map((v) => <option key={v} value={v}>{v}%</option>)}
                                </select>
                              </td>
                              <td className="w-36 px-2 py-1">
                                <MultiPicSelect
                                  value={a.assignee}
                                  options={picOptions}
                                  onChange={(next) => setApprovals((c) => ({ ...c, [pr.taskId]: { ...a, assignee: next } }))}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}

                {/* Các Task Khác — việc lẻ, tạo task thật trong project hệ thống "Khác" */}
                <div className="mb-3 rounded border p-2">
                  <div className="mb-1 font-semibold">Các Task Khác</div>
                  {newManualGoals.map((g, index) => (
                    <div key={`${g.text}-${index}`} className="flex items-center gap-2 border-b py-1 text-sm last:border-b-0">
                      <span className="flex-1 truncate">{g.text}</span>
                      <span className="shrink-0 text-xs text-slate-400">mục tiêu {g.target}%</span>
                      {g.assignee && <span className="shrink-0 text-xs text-slate-400">[{g.assignee}]</span>}
                      <button type="button" className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Bỏ mục tiêu này"
                        onClick={() => setNewManualGoals((c) => c.filter((_item, i) => i !== index))}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="mt-1.5 flex items-center gap-2">
                    <input className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
                      placeholder="VD: Rotate cluster credentials…"
                      value={newManualText}
                      onChange={(e) => setNewManualText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newManualText.trim()) {
                          e.preventDefault();
                          setNewManualGoals((c) => [...c, { text: newManualText.trim(), assignee: newManualAssignee, target: newManualTarget }]);
                          setNewManualText('');
                        }
                      }} />
                    <select className="w-20 shrink-0 rounded border py-1 pl-2 pr-6 text-xs" value={newManualTarget} onChange={(e) => setNewManualTarget(Number(e.target.value))} title="% mục tiêu tuần">
                      {progressSelectOptions(newManualTarget).filter((v) => v >= 10 || v === newManualTarget).map((v) => <option key={v} value={v}>{v}%</option>)}
                    </select>
                    <div className="w-36 shrink-0">
                      <MultiPicSelect value={newManualAssignee} options={picOptions} onChange={setNewManualAssignee} />
                    </div>
                    <button type="button" className="shrink-0 rounded border px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
                      disabled={!newManualText.trim()}
                      onClick={() => {
                        setNewManualGoals((c) => [...c, { text: newManualText.trim(), assignee: newManualAssignee, target: newManualTarget }]);
                        setNewManualText('');
                      }}>
                      Thêm
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* nút điều hướng */}
        <div className="mt-3 flex items-center justify-between">
          <button type="button" className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={onClose} disabled={busy}>Hủy</button>
          <div className="flex gap-2">
            {step > 1 && <button type="button" className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => setStep(step - 1)} disabled={busy}>← Quay lại</button>}
            {step === 1 && <button type="button" className="rounded bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50" onClick={goToStep2} disabled={busy || loading}>Tiếp tục →</button>}
            {step === 2 && <button type="button" className="rounded bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700" onClick={goToStep3} disabled={busy}>Tiếp tục →</button>}
            {step === 3 && <button type="button" className="rounded bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700" onClick={goToStep4} disabled={busy}>Tiếp tục →</button>}
            {step === 4 && <button type="button" className="rounded bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50" onClick={() => { setError(''); setShowFinalConfirm(true); }} disabled={busy}>Duyệt tiến độ tuần trước &amp; mục tiêu tuần này</button>}
          </div>
        </div>

        {/* (c) Màn xác nhận tổng hợp trước khi lưu */}
        {showFinalConfirm && (
          <Modal onClose={() => setShowFinalConfirm(false)}>
            <div className="popup w-full max-w-lg">
              <h3 className="mb-4 text-2xl font-bold text-slate-800">Xác nhận lưu báo cáo</h3>
              <div className="space-y-3 text-base">
                <div className="rounded-lg border bg-slate-50 p-3">
                  <div className="mb-2 text-base font-bold text-slate-800">Đánh giá tuần trước ({ddmmLabel(prevWeekStart)}–{ddmmLabel(isoAddDays(prevWeekStart, 4))})</div>
                  <div className="flex flex-wrap gap-4 text-base font-bold">
                    <span className="text-teal-600">✅ {finalCounts.dat} hoàn thành</span>
                    <span className="text-sky-600">🔼 {finalCounts.vuot} vượt</span>
                    <span className="text-red-600">❌ {finalCounts.khong_dat} không đạt</span>
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <div className="text-base font-bold text-slate-800">Mục tiêu tuần này ({ddmmLabel(weekStart)}–{ddmmLabel(isoAddDays(weekStart, 4))})</div>
                  <div className="mt-1 text-base text-slate-700">Sẽ tạo <b className="text-teal-700">{approvedCount}</b> mục tiêu (đã tick duyệt + việc lẻ &quot;Khác&quot;).</div>
                </div>
                <p className="text-sm text-slate-500">Tiến độ task, đánh giá và mục tiêu sẽ được ghi vào hệ thống.</p>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="rounded border px-4 py-2 text-base hover:bg-slate-50" disabled={busy} onClick={() => setShowFinalConfirm(false)}>Quay lại</button>
                <button type="button" className="rounded bg-teal-600 px-5 py-2 text-base font-semibold text-white hover:bg-teal-700 disabled:opacity-50" disabled={busy} onClick={() => { setShowFinalConfirm(false); void finish(); }}>Xác nhận &amp; lưu</button>
              </div>
            </div>
          </Modal>
        )}
      </form>
    </Modal>
  );
}
