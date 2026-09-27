import { Info } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

// ── Nhập giờ dạng text + convert thông minh ───────────────────────────────────
// Quy tắc FE: MỌI ô nhập giờ trong hệ thống dùng <TimeInput> (KHÔNG dùng <input type="time">).
// User gõ tự do, chỉ nhận CHỮ SỐ và ':'. Khi rời ô (blur/Enter) tự convert -> "HH:MM" 24h.
//   "1000"->"10:00" · "930"->"09:30" · "9"->"09:00" · "9:5"->"09:05" · "" -> rỗng.
export function parseTimeSmart(raw: string): string | null {
  const s = (raw || '').replace(/[^0-9:]/g, '').trim();
  if (!s) return null;
  let h: number, m: number;
  if (s.includes(':')) {
    const [hp, mp = ''] = s.split(':');
    h = parseInt(hp || '0', 10);
    m = parseInt(mp || '0', 10);
  } else {
    const d = s;
    if (d.length <= 2) { h = parseInt(d, 10); m = 0; }
    else if (d.length === 3) { h = parseInt(d.slice(0, 1), 10); m = parseInt(d.slice(1), 10); }
    else { h = parseInt(d.slice(0, 2), 10); m = parseInt(d.slice(2, 4), 10); }
  }
  if (Number.isNaN(h)) h = 0;
  if (Number.isNaN(m)) m = 0;
  h = Math.min(23, Math.max(0, h));
  m = Math.min(59, Math.max(0, m));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}`;
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Ô nhập giờ chuẩn toàn hệ thống. value/onChange theo "HH:MM" 24h. min/max để kẹp khoảng.
export function TimeInput({
  value, onChange, disabled = false, className = '', min, max, name, placeholder = 'vd 1000 → 10:00'
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
  min?: string;
  max?: string;
  name?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value || '');
  useEffect(() => { setText(value || ''); }, [value]);

  function commit() {
    let norm = parseTimeSmart(text);
    if (norm) {
      if (min && toMin(norm) < toMin(min)) norm = min;
      if (max && toMin(norm) > toMin(max)) norm = max;
    }
    setText(norm || '');
    if ((norm || '') !== (value || '')) onChange(norm || '');
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      name={name}
      value={text}
      disabled={disabled}
      className={className}
      placeholder={placeholder}
      // Chỉ cho gõ số và ':' — chặn chữ/ký tự lạ ngay khi nhập.
      onChange={(e) => setText(e.target.value.replace(/[^0-9:]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      // Click/focus -> bôi đen toàn bộ để gõ đè ngay, không cần double-click.
      onFocus={(e) => e.target.select()}
      onMouseUp={(e) => e.preventDefault()}
    />
  );
}

// Icon (?) + tooltip hover: gom text hướng dẫn/giải thích dài vào đây cho gọn giao diện.
// Quy tắc FE: text mang tính hướng dẫn KHÔNG để inline chiếm chỗ — nhét vào InfoTip.
// Pha 3 CR-20260926 (FR-6): thêm tính lại vị trí lúc hover/focus (lật trên/dưới, kẹp trái/phải theo
// mép màn hình bằng `position:fixed`) — tooltip w-72 (288px) trước đây đặt cứng `left-0 top-full` có
// thể bị tràn ra ngoài màn hình hoặc bị vùng cuộn cha cắt mất nếu icon nằm gần mép; hiện/ẩn vẫn dùng
// đúng cơ chế CSS `group-hover:block` cũ (không đổi), JS chỉ chỉnh `top`/`left` ngay khi bắt đầu hover.
export function InfoTip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [tipStyle, setTipStyle] = useState<CSSProperties>({});

  function placeTip() {
    const icon = iconRef.current;
    const tip = tipRef.current;
    if (!icon || !tip) return;
    const gap = 6;
    const pad = 8;
    const r = icon.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = r.bottom + gap;
    if (top + th > vh - pad) top = r.top - th - gap;
    if (top < pad) top = pad;
    let left = r.left;
    if (left + tw > vw - pad) left = vw - tw - pad;
    if (left < pad) left = pad;
    setTipStyle({ position: 'fixed', top, left, margin: 0 });
  }

  return (
    <span
      ref={iconRef}
      className={`group relative inline-flex align-middle ${className}`}
      onMouseEnter={placeTip}
      onFocus={placeTip}
      tabIndex={0}
      role="button"
      aria-label="Xem giải thích thêm"
    >
      {/* Council review Pha 3 (run bc2f9540) phát hiện: icon KHÔNG được vừa aria-hidden vừa
          tabIndex — trình đọc màn hình bỏ qua hoàn toàn 1 điểm dừng Tab, không có tên. Chuyển
          tabIndex + nhãn lên span bao ngoài, icon bên trong giữ aria-hidden vì đã có nhãn ở ngoài. */}
      <Info size={16} className="cursor-help text-primary" aria-hidden="true" />
      <span
        ref={tipRef}
        style={tipStyle}
        className="pointer-events-none z-30 hidden w-72 max-w-[80vw] rounded-md border border-vien bg-surface px-3 py-2 text-xs leading-relaxed text-phu shadow-lg group-hover:block group-focus-within:block"
      >
        {children}
      </span>
    </span>
  );
}
