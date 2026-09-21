import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { EMOJI_CATS, EMOJIS, EMOJI_ALL } from './emoji-data';

const RECENT_KEY = 'mm-emoji-recents';

function docRecents(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 24) : []; }
  catch { return []; }
}
function luuRecent(e: string) {
  try {
    const cur = docRecents().filter((x) => x !== e);
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...cur].slice(0, 24)));
  } catch { /* bỏ qua */ }
}

// Bộ chọn emoji: tab theo nhóm + ô tìm kiếm + mục "hay dùng".
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState('');
  const recents = useRef<string[]>(docRecents()).current;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const ketQua = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return EMOJI_ALL.filter((e) => e.k.includes(s) || e.c === s).map((e) => e.c);
  }, [q]);

  function chon(e: string) { luuRecent(e); onPick(e); }

  return (
    <div className="mm-emoji" onMouseDown={(ev) => ev.stopPropagation()}>
      {/* Tabs nhóm */}
      <div className="mm-emoji-tabs">
        {EMOJI_CATS.map((c, i) => (
          <button key={c.key} className={`mm-emoji-tab ${!q && tab === i ? 'mm-emoji-tab-on' : ''}`} title={c.label}
            onClick={() => { setQ(''); setTab(i); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}>{c.tab}</button>
        ))}
      </div>

      {/* Tìm kiếm */}
      <div className="mm-emoji-search">
        <Search size={14} />
        <input value={q} placeholder="Tìm emoji…" onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>

      <div className="mm-emoji-scroll" ref={scrollRef}>
        {ketQua ? (
          ketQua.length ? (
            <div className="mm-emoji-grid">
              {ketQua.map((e, i) => <button key={e + i} className="mm-emoji-cell" onClick={() => chon(e)}>{e}</button>)}
            </div>
          ) : <div className="mm-emoji-empty">Không tìm thấy emoji nào.</div>
        ) : (
          <>
            {recents.length > 0 && (
              <>
                <div className="mm-emoji-head">Hay dùng</div>
                <div className="mm-emoji-grid">
                  {recents.map((e, i) => <button key={'r' + e + i} className="mm-emoji-cell" onClick={() => chon(e)}>{e}</button>)}
                </div>
              </>
            )}
            <div className="mm-emoji-head">{EMOJI_CATS[tab].label}</div>
            <div className="mm-emoji-grid">
              {(EMOJIS[EMOJI_CATS[tab].key] || []).map(([e], i) => (
                <button key={e + i} className="mm-emoji-cell" onClick={() => chon(e)}>{e}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
