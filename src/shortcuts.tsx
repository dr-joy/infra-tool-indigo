// Phím tắt toàn cục có thể cấu hình động. Người dùng gán tổ hợp phím cho từng chức năng
// ở màn Cài đặt > Phím tắt. Lưu localStorage (theo trình duyệt), áp dụng ngay không cần reload.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { InfoTip } from './ui';

// ── Danh mục hành động có thể gán phím ────────────────────────────────────────
// id ổn định (đừng đổi — là khóa lưu trong localStorage). label hiển thị ở màn cài đặt.
export interface ShortcutActionMeta {
  id: string;
  label: string;
  group: string;
  defaultCombo: string | null;
}

export const SHORTCUT_ACTIONS: ShortcutActionMeta[] = [
  { id: 'tab:task_ca_nhan', label: 'Chuyển tới: Task cá nhân', group: 'Chuyển màn', defaultCombo: 'alt+1' },
  { id: 'tab:project', label: 'Chuyển tới: Project', group: 'Chuyển màn', defaultCombo: 'alt+2' },
  { id: 'tab:bao_cao_tuan', label: 'Chuyển tới: Báo cáo tuần', group: 'Chuyển màn', defaultCombo: 'alt+3' },
  { id: 'tab:len_lich', label: 'Chuyển tới: Lên lịch', group: 'Chuyển màn', defaultCombo: 'alt+4' },
  { id: 'tab:luyen_de', label: 'Chuyển tới: Luyện đề', group: 'Chuyển màn', defaultCombo: 'alt+5' },
  { id: 'tab:so_do', label: 'Chuyển tới: Sơ đồ', group: 'Chuyển màn', defaultCombo: 'alt+6' },
  { id: 'tab:quan_ly_pic', label: 'Chuyển tới: Cài đặt (PIC/Chứng chỉ/Redmine/Phím tắt)', group: 'Chuyển màn', defaultCombo: 'alt+7' },
  { id: 'action:them_task_nhanh', label: 'Mở: Thêm task nhanh', group: 'Hành động', defaultCombo: 'ctrl+q' },
  { id: 'action:lich_su', label: 'Mở: Lịch sử task', group: 'Hành động', defaultCombo: null }
];

export type ShortcutBindings = Record<string, string | null>;

// ── Lưu trữ (localStorage) + store subscribe để handler cập nhật ngay ─────────
const STORAGE_KEY = 'taskmanager.shortcuts.v1';

function loadBindings(): ShortcutBindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as ShortcutBindings : {};
  } catch { return {}; }
}

let bindings: ShortcutBindings = loadBindings();
const listeners = new Set<() => void>();
function emit() { listeners.forEach((fn) => fn()); }
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch { /* bỏ qua */ }
}

function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function getSnapshot() { return bindings; }

// Combo hiệu lực của 1 action: override của user (kể cả null = đã tắt) > mặc định.
export function effectiveCombo(meta: ShortcutActionMeta, b: ShortcutBindings = bindings): string | null {
  return Object.prototype.hasOwnProperty.call(b, meta.id) ? b[meta.id] : meta.defaultCombo;
}

export function setBinding(id: string, combo: string | null) { bindings = { ...bindings, [id]: combo }; persist(); emit(); }
export function resetBinding(id: string) { const next = { ...bindings }; delete next[id]; bindings = next; persist(); emit(); }
export function resetAllBindings() { bindings = {}; persist(); emit(); }

function useBindings() { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }

// ── Tổ hợp phím: chuẩn hóa từ sự kiện + hiển thị ──────────────────────────────
const MOD_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const;
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

// Trả về combo chuẩn (vd "ctrl+alt+k") hoặc null nếu chỉ bấm phím bổ trợ.
export function comboFromEvent(event: KeyboardEvent | React.KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  if (event.metaKey) parts.push('meta');
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  parts.push(key);
  return parts.join('+');
}

const KEY_LABEL: Record<string, string> = {
  ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Del'
};

export function formatCombo(combo: string | null): string {
  if (!combo) return '(chưa gán)';
  return combo.split('+').map((p) => {
    if (p === 'ctrl') return 'Ctrl';
    if (p === 'alt') return 'Alt';
    if (p === 'shift') return 'Shift';
    if (p === 'meta') return 'Win';
    if (KEY_LABEL[p]) return KEY_LABEL[p];
    return p.length === 1 ? p.toUpperCase() : p;
  }).join(' + ');
}

// Cờ tắt handler khi đang ghi phím ở màn cài đặt (tránh kích hành động lúc thu phím).
let recording = false;
export function setRecording(v: boolean) { recording = v; }

// Không kích khi con trỏ đang ở ô nhập liệu (app nhiều input/textarea).
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

// ── Hook gắn handler toàn cục ở App root ──────────────────────────────────────
// handlers: map actionId -> hàm thực thi. Chỉ action nào có handler mới chạy.
export function useGlobalShortcuts(handlers: Record<string, () => void>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (recording) return;
      if (isTypingTarget(event.target)) return;
      const combo = comboFromEvent(event);
      if (!combo) return;
      // Tìm action có combo trùng (ưu tiên override user). Nhiều action trùng -> lấy cái đầu.
      for (const meta of SHORTCUT_ACTIONS) {
        if (effectiveCombo(meta) === combo && handlersRef.current[meta.id]) {
          event.preventDefault();
          handlersRef.current[meta.id]();
          return;
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

// ── Màn cài đặt phím tắt ──────────────────────────────────────────────────────
export function ShortcutSettingsScreen() {
  const b = useBindings();
  const [recordingId, setRecordingId] = useState<string | null>(null);

  // Phát hiện trùng: combo nào bị >1 action dùng.
  const comboCount = new Map<string, number>();
  for (const meta of SHORTCUT_ACTIONS) {
    const c = effectiveCombo(meta, b);
    if (c) comboCount.set(c, (comboCount.get(c) || 0) + 1);
  }

  function startRecord(id: string) { setRecordingId(id); setRecording(true); }
  function stopRecord() { setRecordingId(null); setRecording(false); }

  function onRecordKeyDown(event: React.KeyboardEvent, id: string) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { stopRecord(); return; }
    if (event.key === 'Backspace' || event.key === 'Delete') { setBinding(id, null); stopRecord(); return; }
    const combo = comboFromEvent(event);
    if (!combo) return; // mới bấm phím bổ trợ -> chờ phím chính
    setBinding(id, combo);
    stopRecord();
  }

  const groups = [...new Set(SHORTCUT_ACTIONS.map((a) => a.group))];

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {/* Header trong card trắng — đồng bộ các màn cài đặt khác. Hướng dẫn gom vào InfoTip. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4">
        <h2 className="flex items-center gap-1.5 text-lg font-bold text-slate-800">
          Phím tắt
          <InfoTip>
            Bấm <b className="text-teal-700">Ghi</b> rồi nhấn tổ hợp phím để gán.
            <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono">Esc</span> huỷ ·
            <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono">Backspace</span> xoá phím.
            Phím tắt không chạy khi con trỏ đang ở trong ô nhập liệu (input/textarea).
          </InfoTip>
        </h2>
        <button type="button" className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50" onClick={resetAllBindings}>
          Khôi phục mặc định tất cả
        </button>
      </div>

      {groups.map((group) => (
        <div key={group} className="overflow-hidden rounded-lg border bg-white">
          <div className="border-b bg-gradient-to-r from-teal-50 to-white px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-teal-700">{group}</div>
          <div className="divide-y divide-slate-100">
            {SHORTCUT_ACTIONS.filter((a) => a.group === group).map((meta) => {
              const combo = effectiveCombo(meta, b);
              const isRecording = recordingId === meta.id;
              const duplicated = combo != null && (comboCount.get(combo) || 0) > 1;
              return (
                <div key={meta.id} className="flex h-12 items-center gap-3 px-4 transition hover:bg-slate-50">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{meta.label}</span>
                  {/* Slot chiều cao cố định (h-8) -> đổi giữa input record và keycap không làm nhảy row */}
                  <div className="flex h-8 w-56 shrink-0 items-center justify-end gap-1">
                    {isRecording ? (
                      <input
                        autoFocus
                        readOnly
                        value="Nhấn tổ hợp phím…"
                        onKeyDown={(event) => onRecordKeyDown(event, meta.id)}
                        onBlur={stopRecord}
                        className="box-border h-8 w-44 animate-pulse rounded-md border-2 border-teal-500 bg-teal-50 px-2 text-center text-sm font-medium text-teal-700 outline-none"
                      />
                    ) : (
                      <ComboKeys combo={combo} duplicated={duplicated} />
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button type="button"
                      className={`box-border h-8 w-12 rounded-md text-xs font-semibold text-white transition ${isRecording ? 'bg-rose-500 hover:bg-rose-600' : 'bg-teal-600 hover:bg-teal-700'}`}
                      onClick={() => (isRecording ? stopRecord() : startRecord(meta.id))}>
                      {isRecording ? 'Huỷ' : 'Ghi'}
                    </button>
                    <button type="button" className="box-border h-8 w-8 rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                      onClick={() => resetBinding(meta.id)} title="Về mặc định">↺</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

// Hiển thị tổ hợp phím dạng "keycap" (từng phím 1 ô), đỏ nếu trùng.
function ComboKeys({ combo, duplicated }: { combo: string | null; duplicated: boolean }) {
  if (!combo) return <span className="flex h-8 items-center text-sm italic text-slate-400">chưa gán</span>;
  const keys = formatCombo(combo).split(' + ');
  return (
    <span className="flex h-8 items-center gap-1" title={duplicated ? 'Trùng với hành động khác' : undefined}>
      {keys.map((k, i) => (
        <kbd key={i}
          className={`box-border inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md border px-2 font-mono text-xs font-semibold shadow-sm ${
            duplicated ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300 bg-slate-50 text-slate-700'}`}>
          {k}
        </kbd>
      ))}
    </span>
  );
}
