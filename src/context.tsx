// Context dùng chung toàn app: danh sách PIC (Gantt) + toast thông báo.
// Tách khỏi main.tsx để mọi màn hình (kể cả mind-map) dùng
// qua hook thay vì truyền toast qua props.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { apiTeam } from './api';
import { useActiveTeamId } from './auth-context';
import type { PicItem, ToastItem, ToastKind } from './types';

// ── PIC (người phụ trách) ─────────────────────────────────────────────────────
const PicContext = createContext<{ pics: string[]; picColors: Record<string, string>; reloadPics: () => Promise<void> }>({ pics: [], picColors: {}, reloadPics: async () => {} });
export function usePics() {
  return useContext(PicContext);
}

// CR-20260913 (§6.2, server/routes/pics.ts): GET/POST/PATCH reorder /api/pics giờ bắt buộc `teamId`
// (bảng `pics` đã chuyển theo team) — dùng apiTeam() với activeTeamId (FR-13) thay vì api() trần như
// trước Lát 3-6. reloadPics() phải nạp lại mỗi khi đổi team đang chọn (PicProvider chỉ mount TRONG
// AuthShell lúc phase active, xem src/main.tsx, nên activeTeamId luôn có giá trị hợp lệ ở đây).
export function PicProvider({ children }: { children: React.ReactNode }) {
  const [pics, setPics] = useState<string[]>([]);
  const [picColors, setPicColors] = useState<Record<string, string>>({});
  const activeTeamId = useActiveTeamId();
  // aliveRef: cờ huỷ (cancellation guard) — chỉ dùng khi gọi TỪ effect nạp theo activeTeamId bên
  // dưới. Đổi team nhanh (A -> B trước khi response của A về) khiến danh sách PIC của A có thể set
  // state SAU khi đã hiển thị team B (dropdown PIC/màu Gantt sai team); effect cleanup đặt
  // aliveRef.current = false để response trễ tự bỏ qua (Council review Lát 7 giai đoạn 1). Nơi khác
  // gọi reloadPics() (sau thêm/sửa/xoá PIC ở settings.tsx) không truyền aliveRef -> giữ nguyên hành
  // vi cũ; kiểu tham số optional để reloadPics vẫn khớp type `() => Promise<void>` đã export qua
  // context.
  const reloadPics = useCallback(async (aliveRef?: { current: boolean }) => {
    if (activeTeamId == null) { setPics([]); setPicColors({}); return; }
    try {
      const data = await apiTeam<PicItem[]>(activeTeamId, '/api/pics');
      if (aliveRef && !aliveRef.current) return;
      setPics(data.map((p) => p.name));
      setPicColors(Object.fromEntries(data.filter((p) => p.color).map((p) => [p.name, p.color as string])));
    } catch { /* server chưa sẵn sàng hoặc chưa chọn được team thì giữ danh sách rỗng */ }
  }, [activeTeamId]);
  useEffect(() => {
    const aliveRef = { current: true };
    // Reset ngay: pics/picColors không có gate loading riêng ở nơi tiêu thụ (dropdown PIC, màu
    // Gantt...), nên nếu không reset thì dữ liệu team cũ vẫn hiện tới khi fetch team mới xong (Council
    // review Lát 7 giai đoạn 1, vòng 2 — điểm "dữ liệu team cũ hiện thoáng qua").
    setPics([]);
    setPicColors({});
    void reloadPics(aliveRef);
    return () => { aliveRef.current = false; };
  }, [reloadPics]);
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
