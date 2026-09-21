import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';

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
export function InfoTip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <Info size={16} className="cursor-help text-teal-600" aria-hidden="true" />
      {/* w-72 (288px, trước là 34rem=544px): bề rộng cứng cũ rộng hơn cả nhiều popup nhỏ (vd max-w-md
          =448px) — mỗi lần hover, container cha có overflow-y-auto (tự kéo theo overflow-x:auto theo
          quy tắc CSS) phải tính lại vùng cuộn ngang vì tooltip tràn ra ngoài, gây giật + cắt mất chữ
          không cuộn tới được (pointer-events-none nên không kéo được). 288px an toàn hơn nhiều với các
          popup hẹp; text dài hơn thì tự xuống dòng, không mất nội dung. */}
      <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-72 max-w-[80vw] rounded-md border border-teal-100 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 shadow-lg group-hover:block">
        {children}
      </span>
    </span>
  );
}
