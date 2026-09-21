import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { ICON_CATS, ICONS, ICON_ALL, type IconDef } from './icon-data';

const BY_SLUG = new Map<string, IconDef>(ICON_ALL.map((i) => [i.slug, i]));
const RECENT_KEY = 'mm-icon-recents';

function docRecents(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 16) : []; }
  catch { return []; }
}
function luuRecent(slug: string) {
  try {
    const cur = docRecents().filter((x) => x !== slug);
    localStorage.setItem(RECENT_KEY, JSON.stringify([slug, ...cur].slice(0, 16)));
  } catch { /* bỏ qua */ }
}

// Render 1 icon (SVG nhiều màu) theo slug, giữ nguyên màu gốc qua body + viewBox.
export function IconGlyph({ slug, size = 16 }: { slug: string; size?: number }) {
  const def = BY_SLUG.get(slug);
  if (!def) return null;
  return (
    <svg viewBox={def.vb} width={size} height={size} aria-label={def.title} role="img"
      dangerouslySetInnerHTML={{ __html: def.body }} />
  );
}

// Bộ chọn icon hạ tầng: tab theo nhóm + tìm kiếm + "hay dùng".
export function IconPicker({ onPick }: { onPick: (slug: string) => void }) {
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState('');
  const recents = useRef<string[]>(docRecents()).current;

  const ketQua = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return ICON_ALL.filter((i) => i.title.toLowerCase().includes(s) || i.slug.includes(s));
  }, [q]);

  function chon(slug: string) { luuRecent(slug); onPick(slug); }

  const cat = ICON_CATS[tab];
  const list = ketQua ?? ICONS.filter((i) => i.cat === cat.key);

  return (
    <div className="mm-emoji mm-iconlib" onMouseDown={(ev) => ev.stopPropagation()}>
      <div className="mm-emoji-tabs">
        {ICON_CATS.map((c, i) => (
          <button key={c.key} className={`mm-iconlib-tab ${!q && tab === i ? 'mm-emoji-tab-on' : ''}`} title={c.label}
            onClick={() => { setQ(''); setTab(i); }}>{c.label}</button>
        ))}
      </div>
      <div className="mm-emoji-search">
        <Search size={14} />
        <input value={q} placeholder="Tìm icon (docker, aws, redis…)" onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="mm-emoji-scroll">
        {!q && recents.length > 0 && (
          <>
            <div className="mm-emoji-head">Hay dùng</div>
            <div className="mm-iconlib-grid">
              {recents.map((s) => BY_SLUG.has(s) && (
                <button key={'r' + s} className="mm-iconlib-cell" title={BY_SLUG.get(s)!.title} onClick={() => chon(s)}>
                  <IconGlyph slug={s} size={22} />
                </button>
              ))}
            </div>
          </>
        )}
        <div className="mm-emoji-head">{ketQua ? `Kết quả (${list.length})` : cat.label}</div>
        {list.length ? (
          <div className="mm-iconlib-grid">
            {list.map((i) => (
              <button key={i.slug} className="mm-iconlib-cell" title={i.title} onClick={() => chon(i.slug)}>
                <IconGlyph slug={i.slug} size={22} />
              </button>
            ))}
          </div>
        ) : <div className="mm-emoji-empty">Không tìm thấy icon nào.</div>}
      </div>
    </div>
  );
}
