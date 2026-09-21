// Context dùng chung toàn app: danh sách PIC (Gantt) + toast thông báo.
// Tách khỏi main.tsx để mọi màn hình (kể cả luyen-de/mind-map) dùng
// qua hook thay vì truyền toast qua props.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { api } from './api';
import type { PicItem, ToastItem, ToastKind } from './types';

// ── PIC (người phụ trách) ─────────────────────────────────────────────────────
const PicContext = createContext<{ pics: string[]; picColors: Record<string, string>; reloadPics: () => Promise<void> }>({ pics: [], picColors: {}, reloadPics: async () => {} });
export function usePics() {
  return useContext(PicContext);
}

export function PicProvider({ children }: { children: React.ReactNode }) {
  const [pics, setPics] = useState<string[]>([]);
  const [picColors, setPicColors] = useState<Record<string, string>>({});
  async function reloadPics() {
    try {
      const data = await api<PicItem[]>('/api/pics');
      setPics(data.map((p) => p.name));
      setPicColors(Object.fromEntries(data.filter((p) => p.color).map((p) => [p.name, p.color as string])));
    } catch { /* server chưa sẵn sàng thì giữ danh sách rỗng */ }
  }
  useEffect(() => { void reloadPics(); }, []);
  return <PicContext.Provider value={{ pics, picColors, reloadPics }}>{children}</PicContext.Provider>;
}

// ── Thông báo (toast) sau thao tác ───────────────────────────────────────────────
// Hiện GIỮA màn hình (tông tối, có icon), tự biến mất sau 1.5s hoặc ẩn ngay khi có thao tác
// (click/gõ phím/cuộn). Dùng: const toast = useToast(); toast('Đã lưu') / toast('Lỗi...', 'error').
const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {});
export function useToast() {
  return useContext(ToastContext);
}
let toastSeq = 0;
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimeoutsRef = useRef<number[]>([]);
  const show = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = ++toastSeq;
    setToasts((list) => [...list, { id, kind, message }]);
    const timeoutId = window.setTimeout(() => {
      toastTimeoutsRef.current = toastTimeoutsRef.current.filter((x) => x !== timeoutId);
      setToasts((list) => list.filter((toast) => toast.id !== id));
    }, 1500);
    toastTimeoutsRef.current.push(timeoutId);
  }, []);

  // Clear auto-dismiss timers on unmount so teardown does not receive late setState calls.
  useEffect(() => () => {
    for (const timeoutId of toastTimeoutsRef.current) window.clearTimeout(timeoutId);
    toastTimeoutsRef.current = [];
  }, []);

  // Ẩn ngay khi người dùng thao tác bất kỳ (đợi 1 nhịp để chính cú click vừa rồi không đóng liền).
  useEffect(() => {
    if (toasts.length === 0) return;
    const clear = () => setToasts([]);
    const arm = window.setTimeout(() => {
      window.addEventListener('mousedown', clear, { once: true });
      window.addEventListener('keydown', clear, { once: true });
      window.addEventListener('wheel', clear, { once: true });
    }, 0);
    return () => {
      window.clearTimeout(arm);
      window.removeEventListener('mousedown', clear);
      window.removeEventListener('keydown', clear);
      window.removeEventListener('wheel', clear);
    };
  }, [toasts]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-2">
            {toasts.map((toast) => (
              <div key={toast.id} className="flex items-center gap-2 rounded-xl bg-slate-900/90 px-6 py-4 text-base font-semibold text-white shadow-2xl">
                {toast.kind === 'error'
                  ? <X size={18} className="text-rose-400" />
                  : <Check size={18} className="text-emerald-400" />}
                {toast.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
