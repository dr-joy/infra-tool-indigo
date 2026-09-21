import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, FilePlus2, Loader2, ZoomIn, ZoomOut, Maximize2,
  ChevronRight, ChevronDown,
  PanelLeftClose, PanelLeft, Undo2, Redo2, Palette,
  Type, Baseline, AlignLeft, AlignCenter, AlignRight, List, Link2,
  Paperclip, Smile, X, Pencil, PaintBucket, Shapes,
  Square, Circle, Diamond, RectangleHorizontal, Squircle,
  Download, Copy, Check, HelpCircle, Minimize2, Pen, Eraser, ClipboardPaste
} from 'lucide-react';
import { EmojiPicker } from './emoji-picker';
import { IconPicker, IconGlyph } from './icon-picker';

// ─────────────────────────────────────────────────────────────────────────────
// Mind map: sơ đồ cây toả 2 bên để "rẽ nhánh nhanh khi suy nghĩ".
// Node gốc ở giữa, các nhánh con toả sang trái & phải cân đối. Node dạng pill,
// đường nối cong. Thao tác: Enter = ngang hàng, Tab = node con, Space/F2 = sửa,
// nút "+" thêm bằng chuột, kéo-thả đổi nhánh cha, đổi màu nhánh, undo/redo.
// Cả cây lưu JSON xuống SQLite (tự lưu). Tự chứa, không phụ thuộc nội bộ main.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from './api';

// ── Kiểu dữ liệu ─────────────────────────────────────────────────────────────
type Side = 'L' | 'R';
type DropMode = 'child' | 'before' | 'after';
type TextAlign = 'left' | 'center' | 'right';
interface FileAtt { name: string; url: string }
interface MindNode {
  id: string;
  text: string;
  collapsed?: boolean;
  color?: string;          // màu nhánh/viền (ghi đè màu kế thừa)
  bgColor?: string;        // màu nền box (mặc định trắng; gốc dùng màu nhánh)
  shape?: string;          // hình dạng box: rect/round/ellipse/diamond/parallelogram (mặc định pill)
  side?: Side;             // chỉ áp dụng cho con trực tiếp của gốc (toả trái/phải)
  // Định dạng chữ trong box (đều tuỳ chọn — không set thì dùng mặc định)
  font?: string;           // khoá font trong FONTS
  fontSize?: number;       // px
  textColor?: string;      // màu chữ (hex)
  align?: TextAlign;       // căn lề chữ
  bullet?: boolean;        // đánh đầu mục bằng dấu "・"
  links?: string[];        // các URL đính kèm
  files?: FileAtt[];       // file đính kèm (lưu trên đĩa, giữ URL)
  icon?: string;           // emoji chèn trong box
  svcIcon?: string;        // slug logo hạ tầng (AWS/GCP/Docker…) trong kho icon
  children: MindNode[];
}
interface MapInfo { id: number; title: string; createdAt: string; updatedAt: string }
interface MapFull extends MapInfo { data: string }
// Nét viết tay bằng chuột (toạ độ theo không gian nội dung, chưa nhân scale).
interface Stroke { color: string; width: number; pts: { x: number; y: number }[] }
const PEN_COLORS = ['#ef4444', '#1e293b', '#0d9488', '#22c55e', '#f97316'];

// ── Hằng số bố cục ───────────────────────────────────────────────────────────
const NODE_W = 188;
const NODE_H = 44;        // chiều cao tối thiểu; node dài tự giãn
const COL = 252;          // bước ngang giữa các cấp
const GAPX = COL - NODE_W;
const V_GAP = 16;         // khoảng cách dọc giữa các nhánh
const PAD = 200;          // lề quanh sơ đồ (rộng để kéo/pan tự do + thấy đủ thanh edit phía trên)
const CENTRAL_GAP = 90;   // khoảng cách dọc giữa các "ý tưởng trung tâm"
const SUPER_ID = '__super_root__'; // gốc ẩn chứa các ý tưởng trung tâm (không render)
const ROOT_HALF = NODE_W / 2;
const ROOT_COLOR = '#0d9488';
const PALETTE = ['#0d9488', '#f97316', '#2563eb', '#ef4444', '#22c55e', '#7c3aed', '#eab308', '#0891b2', '#db2777', '#64748b'];
const SWATCHES = ['#0d9488', '#f97316', '#2563eb', '#ef4444', '#22c55e', '#7c3aed', '#eab308', '#0891b2', '#db2777', '#64748b'];
// Màu chữ & màu nền dùng CHUNG một bảng (đồng nhất giao diện): đen/trắng + các màu đậm.
const TEXT_SWATCHES = ['#0f172a', '#ffffff', '#64748b', '#0d9488', '#0ea5e9', '#14b8a6', '#22c55e', '#0369a1', '#f97316', '#ef4444'];
const BG_SWATCHES = TEXT_SWATCHES;

// Font chữ: khoá -> (nhãn, font-family). 'inherit' = theo mặc định của sơ đồ.
const FONTS: { key: string; label: string; stack: string }[] = [
  { key: 'inherit', label: 'Mặc định', stack: '' },
  { key: 'sans', label: 'Sans', stack: 'system-ui, "Segoe UI", Roboto, sans-serif' },
  { key: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
  { key: 'mono', label: 'Mono', stack: 'ui-monospace, "Cascadia Code", Consolas, monospace' },
  { key: 'rounded', label: 'Tròn', stack: '"Segoe UI Rounded", "Comic Sans MS", "Trebuchet MS", sans-serif' },
];
function fontStack(key?: string): string | undefined {
  if (!key || key === 'inherit') return undefined;
  return FONTS.find((f) => f.key === key)?.stack || undefined;
}
const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 34];
const DEFAULT_FONT_SIZE = 14;

// Link: thêm scheme nếu thiếu để mở đúng; nhãn rút gọn cho chip.
function chuanLink(url: string): string {
  return /^[a-z][\w+.-]*:\/\//i.test(url) || url.startsWith('mailto:') ? url : `https://${url}`;
}
function nhanLink(url: string): string {
  return url.replace(/^[a-z][\w+.-]*:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

// Hình dạng box (để dựng flowchart sau này). Mặc định 'pill' = bo tròn 2 đầu.
function shapeCss(shape?: string): React.CSSProperties {
  switch (shape) {
    case 'rect': return { borderRadius: 4 };
    case 'round': return { borderRadius: 14 };
    case 'ellipse': return { borderRadius: '50%' };
    case 'diamond': return { borderRadius: 0, clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' };
    case 'parallelogram': return { borderRadius: 0, clipPath: 'polygon(14% 0%, 100% 0%, 86% 100%, 0% 100%)' };
    default: return {}; // pill: dùng border-radius 999px mặc định của .mm-node
  }
}

// ── Xuất sơ đồ để làm prompt cho AI ──────────────────────────────────────────
// Markdown: cây -> danh sách phân cấp (gốc thành tiêu đề). Kèm icon + link.
function treeToMarkdown(root: MindNode): string {
  const out: string[] = [`# ${(root.text || 'Sơ đồ').replace(/\n/g, ' ')}`, ''];
  const dòng = (n: MindNode, depth: number) => {
    const indent = '  '.repeat(depth);
    const emoji = n.icon ? `${n.icon} ` : '';
    const text = (n.text || '').replace(/\n+/g, ' · ').trim();
    const links = (n.links || []).map((u) => `[${nhanLink(u)}](${chuanLink(u)})`).join(' ');
    out.push(`${indent}- ${emoji}${text}${links ? ` ${links}` : ''}`);
    n.children.forEach((c) => dòng(c, depth + 1));
  };
  root.children.forEach((c) => dòng(c, 0));
  return out.join('\n');
}
// Mermaid flowchart TD: node + mũi tên cha→con; map vài hình dạng sang cú pháp mermaid.
function treeToMermaid(root: MindNode): string {
  const out: string[] = ['flowchart TD'];
  const ids = new Map<string, string>();
  let i = 0;
  const idOf = (n: MindNode) => { if (!ids.has(n.id)) ids.set(n.id, `N${i++}`); return ids.get(n.id)!; };
  const esc = (t: string) => (t || ' ').replace(/"/g, "'").replace(/\n+/g, ' ');
  const hinh = (n: MindNode, label: string) => {
    if (n.shape === 'diamond') return `{"${label}"}`;
    if (n.shape === 'ellipse') return `(("${label}"))`;
    if (n.shape === 'round' || n.shape === 'stadium' || n.shape === undefined) return `(["${label}"])`;
    return `["${label}"]`;
  };
  const walk = (n: MindNode) => {
    out.push(`  ${idOf(n)}${hinh(n, esc(n.text))}`);
    n.children.forEach((c) => { out.push(`  ${idOf(n)} --> ${idOf(c)}`); walk(c); });
  };
  walk(root);
  return out.join('\n');
}

let idSeq = 0;
function genId(): string {
  idSeq += 1;
  return `n${Date.now().toString(36)}${idSeq}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
function nodeMoi(text = ''): MindNode { return { id: genId(), text, children: [] }; }
function trungTamMoi(): MindNode { return { id: genId(), text: 'Ý tưởng trung tâm', children: [] }; }
// Gốc ẩn (super-root) chứa các ý tưởng trung tâm. Không render; chỉ là vùng chứa.
function rootMoi(): MindNode { return { id: SUPER_ID, text: '', children: [trungTamMoi()] }; }
// Bọc dữ liệu cũ (1 ý tưởng trung tâm) thành super-root để tương thích ngược.
function bocSuperRoot(r: MindNode): MindNode { return r.id === SUPER_ID ? r : { id: SUPER_ID, text: '', children: [r] }; }

function chuanHoa(node: unknown): MindNode {
  const n = (node && typeof node === 'object' ? node : {}) as Partial<MindNode>;
  // Tương thích ngược: dữ liệu cũ có thể là 1 string `link` -> chuyển thành mảng `links`.
  const rawLink = (n as { link?: unknown }).link;
  const links = Array.isArray(n.links)
    ? n.links.filter((x): x is string => typeof x === 'string' && !!x)
    : (typeof rawLink === 'string' && rawLink ? [rawLink] : undefined);
  const files = Array.isArray(n.files)
    ? n.files.filter((f): f is FileAtt => !!f && typeof f === 'object' && typeof (f as FileAtt).url === 'string')
        .map((f) => ({ name: String(f.name || 'file'), url: String(f.url) }))
    : undefined;
  return {
    id: typeof n.id === 'string' && n.id ? n.id : genId(),
    text: typeof n.text === 'string' ? n.text : '',
    collapsed: n.collapsed === true ? true : undefined,
    color: typeof n.color === 'string' ? n.color : undefined,
    bgColor: typeof n.bgColor === 'string' ? n.bgColor : undefined,
    shape: typeof n.shape === 'string' ? n.shape : undefined,
    side: n.side === 'L' || n.side === 'R' ? n.side : undefined,
    font: typeof n.font === 'string' ? n.font : undefined,
    fontSize: typeof n.fontSize === 'number' ? n.fontSize : undefined,
    textColor: typeof n.textColor === 'string' ? n.textColor : undefined,
    align: n.align === 'left' || n.align === 'center' || n.align === 'right' ? n.align : undefined,
    bullet: n.bullet === true ? true : undefined,
    links: links && links.length ? links : undefined,
    files: files && files.length ? files : undefined,
    icon: typeof n.icon === 'string' && n.icon ? n.icon : undefined,
    svcIcon: typeof n.svcIcon === 'string' && n.svcIcon ? n.svcIcon : undefined,
    children: Array.isArray(n.children) ? n.children.map(chuanHoa) : [],
  };
}

// ── Thao tác cây (bất biến) ──────────────────────────────────────────────────
function mapNode(node: MindNode, id: string, fn: (n: MindNode) => MindNode): MindNode {
  if (node.id === id) return fn(node);
  if (!node.children.length) return node;
  let changed = false;
  const children = node.children.map((c) => { const nx = mapNode(c, id, fn); if (nx !== c) changed = true; return nx; });
  return changed ? { ...node, children } : node;
}
function suaText(root: MindNode, id: string, text: string): MindNode { return mapNode(root, id, (n) => ({ ...n, text })); }
function doiMau(root: MindNode, id: string, color: string | undefined): MindNode { return mapNode(root, id, (n) => ({ ...n, color })); }
// Gộp một phần thuộc tính định dạng vào node (font/cỡ/màu chữ/align/bullet/link/files/icon).
function datThuocTinh(root: MindNode, id: string, patch: Partial<MindNode>): MindNode {
  return mapNode(root, id, (n) => ({ ...n, ...patch }));
}
// Nhân bản node + toàn bộ nhánh con với ID mới (cho copy/paste cả nhánh).
function nhanBan(node: MindNode): MindNode {
  return { ...node, id: genId(), files: node.files ? node.files.map((f) => ({ ...f })) : undefined, children: node.children.map(nhanBan) };
}
function toggleCollapse(root: MindNode, id: string): MindNode { return mapNode(root, id, (n) => (n.children.length ? { ...n, collapsed: !n.collapsed } : n)); }
function themCon(root: MindNode, parentId: string, child: MindNode): MindNode {
  return mapNode(root, parentId, (n) => ({ ...n, collapsed: undefined, children: [...n.children, child] }));
}
function themNgangHang(root: MindNode, id: string, sib: MindNode): { root: MindNode; ok: boolean } {
  let ok = false;
  function walk(node: MindNode): MindNode {
    const idx = node.children.findIndex((c) => c.id === id);
    if (idx >= 0) { ok = true; const children = [...node.children]; children.splice(idx + 1, 0, sib); return { ...node, children }; }
    if (!node.children.length) return node;
    return { ...node, children: node.children.map(walk) };
  }
  return { root: walk(root), ok };
}
function timCha(root: MindNode, id: string): MindNode | null {
  for (const c of root.children) { if (c.id === id) return root; const f = timCha(c, id); if (f) return f; }
  return null;
}
function timNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root;
  for (const c of root.children) { const f = timNode(c, id); if (f) return f; }
  return null;
}
function xoaNode(root: MindNode, id: string): { root: MindNode; nextSelect: string | null } {
  let nextSelect: string | null = null;
  function walk(node: MindNode): MindNode {
    const idx = node.children.findIndex((c) => c.id === id);
    if (idx >= 0) { const s = node.children; nextSelect = (s[idx + 1] || s[idx - 1])?.id ?? node.id; return { ...node, children: s.filter((c) => c.id !== id) }; }
    if (!node.children.length) return node;
    return { ...node, children: node.children.map(walk) };
  }
  return { root: walk(root), nextSelect };
}
function luiCap(root: MindNode, id: string): { root: MindNode; ok: boolean } {
  const cha = timCha(root, id);
  if (!cha || cha.id === root.id) return { root, ok: false };
  const ong = timCha(root, cha.id);
  if (!ong) return { root, ok: false };
  const node = cha.children.find((c) => c.id === id)!;
  const goBo = mapNode(root, cha.id, (n) => ({ ...n, children: n.children.filter((c) => c.id !== id) }));
  return themNgangHang(goBo, cha.id, node);
}
function laHauDue(node: MindNode, maybeId: string): boolean {
  if (node.id === maybeId) return true;
  return node.children.some((c) => laHauDue(c, maybeId));
}
// Chuyển node sang làm con của newParentId (đổi nhánh cha). Không cho thả vào chính nó/hậu duệ.
function chuyenNode(root: MindNode, id: string, newParentId: string, side?: Side): { root: MindNode; ok: boolean } {
  if (id === root.id || id === newParentId) return { root, ok: false };
  const node = timNode(root, id);
  if (!node || laHauDue(node, newParentId)) return { root, ok: false };
  const cha = timCha(root, id);
  const newParentIsCentral = timCha(root, newParentId)?.id === root.id;
  if (cha?.id === newParentId) {
    // Cùng cha: nếu cha là ý tưởng trung tâm thì vẫn cho đổi side trái/phải.
    if (newParentIsCentral && side) return { root: mapNode(root, id, (n) => ({ ...n, side })), ok: true };
    return { root, ok: false };
  }
  const goBo = mapNode(root, cha!.id, (n) => ({ ...n, children: n.children.filter((c) => c.id !== id) }));
  const moved: MindNode = { ...node, side: newParentIsCentral ? (side ?? node.side) : undefined };
  return { root: themCon(goBo, newParentId, moved), ok: true };
}

// Chuyển node thành anh em của targetId, chèn ngay trước/sau target.
// Nếu target là con trực tiếp của ý tưởng trung tâm thì node kéo theo cùng side L/R của target.
function chenNgangHang(root: MindNode, id: string, targetId: string, pos: 'before' | 'after'): { root: MindNode; ok: boolean } {
  if (id === root.id || id === targetId) return { root, ok: false };
  const node = timNode(root, id);
  const target = timNode(root, targetId);
  if (!node || !target || laHauDue(node, targetId)) return { root, ok: false };
  const targetParent = timCha(root, targetId);
  const oldParent = timCha(root, id);
  if (!targetParent || !oldParent) return { root, ok: false };
  // Không cho biến node thường thành một "ý tưởng trung tâm" mới bằng cách thả cạnh root trung tâm.
  if (targetParent.id === root.id) return { root, ok: false };

  const grand = timCha(root, targetParent.id);
  const moved: MindNode = {
    ...node,
    side: grand?.id === root.id ? target.side : undefined
  };
  const removed = mapNode(root, oldParent.id, (n) => ({ ...n, children: n.children.filter((c) => c.id !== id) }));
  let ok = false;
  const inserted = mapNode(removed, targetParent.id, (n) => {
    const idx = n.children.findIndex((c) => c.id === targetId);
    if (idx < 0) return n;
    ok = true;
    const children = [...n.children];
    children.splice(pos === 'before' ? idx : idx + 1, 0, moved);
    return { ...n, collapsed: undefined, children };
  });
  return { root: inserted, ok };
}

// ── Bố cục cây toả 2 bên ─────────────────────────────────────────────────────
interface Placed { node: MindNode; x: number; y: number; h: number; depth: number; side: 0 | 1 | -1; color: string; hasChildren: boolean; collapsed: boolean; hidden: boolean }
interface Edge { x1: number; y1: number; x2: number; y2: number; color: string }
interface Layout { placed: Placed[]; edges: Edge[]; width: number; height: number; byId: Map<string, Placed> }

function boCuc(superRoot: MindNode, heights: Map<string, number>): Layout {
  const hOf = (n: MindNode) => heights.get(n.id) ?? NODE_H;
  // DỒN GỌN: chỉ tính theo các node ĐANG HIỆN (nhánh thu gọn không chiếm chỗ) -> xoá/thu gọn
  // đều sắp xếp lại sát nhau, không để khoảng trống thừa.
  const visKids = (n: MindNode) => (n.collapsed ? [] : n.children);
  const sub = new Map<string, number>();
  function measure(node: MindNode): number {
    const kids = visKids(node);
    const s = kids.length === 0 ? hOf(node) : Math.max(hOf(node), kids.reduce((a, c) => a + measure(c), 0) + V_GAP * (kids.length - 1));
    sub.set(node.id, s);
    return s;
  }

  const placed: Placed[] = [];
  const edges: Edge[] = [];
  const blockH = (list: MindNode[]) => list.reduce((a, k) => a + (sub.get(k.id) ?? NODE_H), 0) + V_GAP * Math.max(0, list.length - 1);

  function place(node: MindNode, depth: number, top: number, color: string, side: 1 | -1): number {
    const leftEdge = side > 0 ? (ROOT_HALF + GAPX + (depth - 1) * COL) : -(ROOT_HALF + GAPX + (depth - 1) * COL) - NODE_W;
    const myColor = node.color ?? color;
    const h = hOf(node), sH = sub.get(node.id) ?? h;
    const k = visKids(node);
    let y: number;
    if (!k.length) { y = top + sH / 2; }
    else {
      const total = k.reduce((a, c) => a + (sub.get(c.id) ?? NODE_H), 0) + V_GAP * (k.length - 1);
      let cy = top + (sH - total) / 2;
      const centers: number[] = [];
      for (const c of k) { centers.push(place(c, depth + 1, cy, myColor, side)); cy += (sub.get(c.id) ?? NODE_H) + V_GAP; }
      y = (centers[0] + centers[centers.length - 1]) / 2;
    }
    placed.push({ node, x: leftEdge, y, h, depth, side, color: myColor, hasChildren: node.children.length > 0, collapsed: node.collapsed === true, hidden: false });
    for (const c of k) {
      const cp = placed.find((p) => p.node.id === c.id)!;
      edges.push({ x1: side > 0 ? leftEdge + NODE_W : leftEdge, y1: y, x2: side > 0 ? cp.x : cp.x + NODE_W, y2: cp.y, color: cp.color });
    }
    return y;
  }

  // Mỗi ý tưởng trung tâm = 1 cây toả 2 bên; xếp chồng theo chiều dọc.
  let cursorY = PAD;
  for (const central of superRoot.children) {
    measure(central);
    const kids = visKids(central);
    const right: MindNode[] = [], left: MindNode[] = [];
    let rh = 0, lh = 0;
    for (const k of kids) {
      const s = sub.get(k.id) ?? NODE_H;
      const toRight = k.side === 'R' ? true : k.side === 'L' ? false : rh <= lh;
      if (toRight) { right.push(k); rh += s; } else { left.push(k); lh += s; }
    }
    const rightBlock = blockH(right), leftBlock = blockH(left);
    const totalH = Math.max(rightBlock, leftBlock, hOf(central));
    const rootY = cursorY + totalH / 2;
    placed.push({ node: central, x: -ROOT_HALF, y: rootY, h: hOf(central), depth: 0, side: 0, color: ROOT_COLOR, hasChildren: central.children.length > 0, collapsed: central.collapsed === true, hidden: false });
    let ry = rootY - rightBlock / 2;
    right.forEach((k, i) => {
      place(k, 1, ry, k.color ?? PALETTE[i % PALETTE.length], 1);
      const cp = placed.find((p) => p.node.id === k.id)!;
      edges.push({ x1: ROOT_HALF, y1: rootY, x2: cp.x, y2: cp.y, color: cp.color });
      ry += (sub.get(k.id) ?? NODE_H) + V_GAP;
    });
    let ly = rootY - leftBlock / 2;
    left.forEach((k, i) => {
      place(k, 1, ly, k.color ?? PALETTE[(i + right.length) % PALETTE.length], -1);
      const cp = placed.find((p) => p.node.id === k.id)!;
      edges.push({ x1: -ROOT_HALF, y1: rootY, x2: cp.x + NODE_W, y2: cp.y, color: cp.color });
      ly += (sub.get(k.id) ?? NODE_H) + V_GAP;
    });
    cursorY += totalH + CENTRAL_GAP;
  }

  if (!placed.length) return { placed: [], edges: [], width: PAD * 2 + NODE_W, height: PAD * 2 + NODE_H, byId: new Map() };

  // Chuẩn hoá x về dương + lề.
  const minX = Math.min(...placed.map((p) => p.x));
  const maxX = Math.max(...placed.map((p) => p.x + NODE_W));
  const offX = PAD - minX;
  for (const p of placed) p.x += offX;
  for (const e of edges) { e.x1 += offX; e.x2 += offX; }
  const byId = new Map(placed.map((p) => [p.node.id, p]));
  const height = cursorY - CENTRAL_GAP + PAD; // cursorY đã cộng dư 1 lần CENTRAL_GAP ở cuối
  return { placed, edges, width: maxX - minX + PAD * 2, height, byId };
}

// Chọn bên ít hơn cho con mới của gốc (để toả cân đối)
function chonSide(root: MindNode): Side {
  let r = 0, l = 0;
  for (const c of root.children) { if (c.side === 'L') l++; else r++; }
  return r <= l ? 'R' : 'L';
}

// ── Component chính ──────────────────────────────────────────────────────────
type ToastFn = (m: string, k?: 'success' | 'error' | 'info') => void;
interface GuardApi { dirty: boolean; luu: () => Promise<void> }
export function ManHinhMindMap({ toast, guardRef }: { toast?: ToastFn; guardRef?: React.MutableRefObject<GuardApi | null> } = {}) {
  const [danhSach, setDanhSach] = useState<MapInfo[]>([]);
  const [dangTaiDS, setDangTaiDS] = useState(true);
  const [mapId, setMapId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null); // đổi tên sơ đồ trong sidebar
  const [renameText, setRenameText] = useState('');
  const [root, setRoot] = useState<MindNode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [loi, setLoi] = useState('');
  const [trangThaiLuu, setTrangThaiLuu] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const [scale, setScale] = useState(1);
  const [hienSidebar, setHienSidebar] = useState(true);
  const [heights, setHeights] = useState<Map<string, number>>(new Map());
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Popover nào đang mở trên thanh edit (mỗi lúc 1 cái): màu box, màu chữ, font, cỡ chữ, căn lề, link, icon.
  const [popover, setPopover] = useState<null | 'box' | 'bg' | 'shape' | 'text' | 'font' | 'size' | 'align' | 'link' | 'files' | 'emoji' | 'icon'>(null);
  const [linkInput, setLinkInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [coBoiDen, setCoBoiDen] = useState(false); // đang bôi đen text trong textarea? -> bật nút đầu mục
  const [xuat, setXuat] = useState<null | 'md' | 'mermaid'>(null); // modal export
  const [daCopy, setDaCopy] = useState(false);
  const [clip, setClip] = useState<MindNode | null>(null); // nhánh đã copy (kèm con cháu)
  const [pendingNav, setPendingNav] = useState<null | { type: 'open'; id: number } | { type: 'new' }>(null); // chờ xác nhận lưu khi rời map
  const [drawings, setDrawings] = useState<Stroke[]>([]); // nét viết tay
  const [penMode, setPenMode] = useState(false);
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [phongTo, setPhongTo] = useState(false); // khung sơ đồ chiếm hết cửa sổ trình duyệt
  const [showHelp, setShowHelp] = useState(false);
  const strokeRef = useRef<Stroke | null>(null); // nét đang vẽ
  const [drag, setDrag] = useState<{ id: string; targetId: string | null; mode: DropMode | null; side?: Side; x: number; y: number; gx: number; gy: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Neo 1 node về đúng vị trí màn hình sau khi bố cục đổi (thu gọn/mở rộng) để không bị "nhảy".
  const anchorRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const [, setScrollTick] = useState(0); // ép render lại để thanh nổi bám node khi cuộn

  const [past, setPast] = useState<MindNode[]>([]);
  const [future, setFuture] = useState<MindNode[]>([]);

  const nodeEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectInitRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layout = useMemo(() => (root ? boCuc(root, heights) : null), [root, heights]);
  const noiDungXuat = useMemo(() => {
    if (!xuat || !root) return '';
    return xuat === 'md' ? treeToMarkdown(root) : treeToMermaid(root);
  }, [xuat, root]);

  // ── Danh sách ──
  const taiDanhSach = useCallback(async () => {
    setDangTaiDS(true);
    try { setDanhSach(await api<MapInfo[]>('/api/mindmaps')); }
    catch (e) { setLoi(e instanceof Error ? e.message : 'Lỗi tải danh sách'); }
    finally { setDangTaiDS(false); }
  }, []);
  useEffect(() => { taiDanhSach(); }, [taiDanhSach]);

  const moMap = useCallback(async (id: number) => {
    try {
      const full = await api<MapFull>(`/api/mindmaps/${id}`);
      let parsed: unknown = {};
      try { parsed = JSON.parse(full.data); } catch { parsed = {}; }
      const r = bocSuperRoot((parsed && typeof parsed === 'object' && (parsed as { root?: unknown }).root) ? chuanHoa((parsed as { root: unknown }).root) : rootMoi());
      const dr = (parsed as { drawings?: unknown }).drawings;
      setMapId(full.id); setTitle(full.title); setRoot(r); setSelectedId(r.children[0]?.id ?? null);
      setDrawings(Array.isArray(dr) ? (dr as Stroke[]).filter((s) => s && Array.isArray(s.pts)) : []);
      setEditingId(null); setTrangThaiLuu('idle'); setScale(1); setPast([]); setFuture([]); setPopover(null); setPenMode(false);
    } catch (e) { setLoi(e instanceof Error ? e.message : 'Lỗi mở sơ đồ'); }
  }, []);

  const taoMap = useCallback(async () => {
    try {
      const r = rootMoi();
      const created = await api<MapFull>('/api/mindmaps', { method: 'POST', body: JSON.stringify({ title: 'Sơ đồ mới', data: { root: r } }) });
      await taiDanhSach();
      setMapId(created.id); setTitle(created.title); setRoot(r); setSelectedId(r.children[0]?.id ?? null);
      setDrawings([]); setPenMode(false);
      setEditingId(null); setTrangThaiLuu('idle'); setScale(1); setPast([]); setFuture([]);
      // Mở ngay ô đặt tên cho sơ đồ vừa tạo.
      setRenamingId(created.id); setRenameText(created.title);
    } catch (e) { setLoi(e instanceof Error ? e.message : 'Lỗi tạo sơ đồ'); }
  }, [taiDanhSach]);

  const xoaMap = useCallback(async (id: number) => {
    if (!window.confirm('Xoá sơ đồ này?')) return;
    try {
      await api(`/api/mindmaps/${id}`, { method: 'DELETE' });
      if (id === mapId) { setMapId(null); setRoot(null); setSelectedId(null); }
      await taiDanhSach();
    } catch (e) { setLoi(e instanceof Error ? e.message : 'Lỗi xoá sơ đồ'); }
  }, [mapId, taiDanhSach]);

  const doiTenMap = useCallback(async (id: number, name: string) => {
    const t = name.trim() || 'Sơ đồ mới';
    setRenamingId(null);
    try {
      await api(`/api/mindmaps/${id}`, { method: 'PUT', body: JSON.stringify({ title: t }) });
      if (id === mapId) setTitle(t);
      taiDanhSach();
    } catch (e) { setLoi(e instanceof Error ? e.message : 'Lỗi đổi tên'); }
  }, [mapId, taiDanhSach]);

  // ── Lưu thủ công (Ctrl+S) — KHÔNG tự lưu liên tục để giảm tải ──
  const luuMap = useCallback(async () => {
    if (!root || mapId == null) return;
    setTrangThaiLuu('saving');
    try {
      await api(`/api/mindmaps/${mapId}`, { method: 'PUT', body: JSON.stringify({ data: { root, drawings } }) });
      setTrangThaiLuu('saved'); toast?.('Đã lưu'); taiDanhSach();
    } catch (e) { setLoi(e instanceof Error ? e.message : 'Lỗi lưu'); setTrangThaiLuu('dirty'); toast?.('Lỗi khi lưu', 'error'); }
  }, [root, drawings, mapId, toast, taiDanhSach]);

  // Phơi trạng thái dirty + hàm lưu cho cha (để chặn khi chuyển tab).
  useEffect(() => { if (guardRef) guardRef.current = { dirty: trangThaiLuu === 'dirty', luu: luuMap }; });

  // Ctrl/⌘ + S = lưu (chặn hộp thoại lưu của trình duyệt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); luuMap(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [luuMap]);

  // Esc để thoát chế độ phóng to (khi không đang sửa / mở popup).
  useEffect(() => {
    if (!phongTo) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editingId && !popover) { setPhongTo(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phongTo, editingId, popover]);

  // ── Viết tay bằng chuột ──
  const toContentPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const wrap = scrollRef.current; if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    return { x: (e.clientX - rect.left + wrap.scrollLeft) / scale, y: (e.clientY - rect.top + wrap.scrollTop) / scale };
  }, [scale]);
  const penDown = useCallback((e: React.MouseEvent) => {
    const p = toContentPoint(e); if (!p) return;
    const s: Stroke = { color: penColor, width: 3, pts: [p] };
    strokeRef.current = s;
    setDrawings((d) => [...d, s]);
  }, [penColor, toContentPoint]);
  useEffect(() => {
    if (!penMode) return;
    const move = (e: MouseEvent) => {
      const s = strokeRef.current; if (!s) return;
      const p = toContentPoint(e); if (!p) return;
      s.pts.push(p); setDrawings((d) => d.slice());
    };
    const up = () => { if (strokeRef.current) { strokeRef.current = null; setTrangThaiLuu('dirty'); } };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [penMode, toContentPoint]);

  // Rời map đang có thay đổi -> hỏi lưu (mở map khác / tạo map mới).
  const yeuCauMoMap = useCallback((id: number) => {
    if (id === mapId) return;
    if (trangThaiLuu === 'dirty') setPendingNav({ type: 'open', id }); else moMap(id);
  }, [mapId, trangThaiLuu, moMap]);
  const yeuCauTaoMap = useCallback(() => {
    if (mapId != null && trangThaiLuu === 'dirty') setPendingNav({ type: 'new' }); else taoMap();
  }, [mapId, trangThaiLuu, taoMap]);
  const thucHienNav = useCallback((nav: { type: 'open'; id: number } | { type: 'new' }) => {
    if (nav.type === 'open') moMap(nav.id); else taoMap();
  }, [moMap, taoMap]);

  // Cập nhật cây + lưu lịch sử (cho undo)
  const capNhatRoot = useCallback((updater: (r: MindNode) => MindNode, history = true) => {
    setRoot((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      if (next === prev) return prev;
      if (history) { setPast((p) => [...p.slice(-49), prev]); setFuture([]); }
      return next;
    });
    setTrangThaiLuu('dirty');
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length || !root) return p;
      setFuture((f) => [root, ...f].slice(0, 50));
      setRoot(p[p.length - 1]);
      setTrangThaiLuu('dirty');
      return p.slice(0, -1);
    });
  }, [root]);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length || !root) return f;
      setPast((p) => [...p, root].slice(-50));
      setRoot(f[0]);
      setTrangThaiLuu('dirty');
      return f.slice(1);
    });
  }, [root]);

  function doiTitle(v: string) {
    setTitle(v);
    if (mapId == null) return;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      try { await api(`/api/mindmaps/${mapId}`, { method: 'PUT', body: JSON.stringify({ title: v }) }); taiDanhSach(); } catch { /* bỏ qua */ }
    }, 600);
  }

  // ── Soạn thảo node ──
  const batDauSua = useCallback((id: string, selectAll = true, initial?: string) => {
    const node = root ? timNode(root, id) : null;
    setPopover(null);
    setSelectedId(id); setEditingId(id);
    setEditText(initial !== undefined ? initial : node?.text ?? '');
    selectInitRef.current = selectAll && initial === undefined;
  }, [root]);

  const ketThucSua = useCallback((createSibling = false, createChild = false) => {
    if (!editingId || !root) return;
    const id = editingId, text = editText.trim();
    const node = timNode(root, id);
    const laTT = timCha(root, id)?.id === root.id; // node là ý tưởng trung tâm
    const coCon = (node?.children.length ?? 0) > 0;
    if (!text && !coCon) { // node rỗng, không con -> xoá (kể cả ý tưởng trung tâm rỗng)
      const { root: r2, nextSelect } = xoaNode(root, id);
      capNhatRoot(() => r2); setEditingId(null);
      setSelectedId(nextSelect === root.id ? (r2.children[0]?.id ?? null) : nextSelect); return;
    }
    let nextRoot = suaText(root, id, editText);
    setEditingId(null);
    if (createChild) {
      const child = nodeMoi(); if (laTT && node) child.side = chonSide(node);
      nextRoot = themCon(nextRoot, id, child); capNhatRoot(() => nextRoot);
      setTimeout(() => batDauSua(child.id, false, ''), 0); return;
    }
    if (createSibling) {
      const sib = nodeMoi(); sib.side = node?.side; // anh em giữ cùng bên (ý tưởng trung tâm: side rỗng)
      const { root: r2 } = themNgangHang(nextRoot, id, sib); capNhatRoot(() => r2);
      setTimeout(() => batDauSua(sib.id, false, ''), 0); return;
    }
    capNhatRoot(() => nextRoot);
  }, [editingId, editText, root, capNhatRoot, batDauSua]);

  useLayoutEffect(() => {
    if (editingId && editTextareaRef.current) {
      const ta = editTextareaRef.current; ta.focus();
      if (selectInitRef.current) ta.select(); else { const len = ta.value.length; ta.setSelectionRange(len, len); }
      setCoBoiDen(ta.selectionStart !== ta.selectionEnd);
    } else { setCoBoiDen(false); }
  }, [editingId]);
  useLayoutEffect(() => {
    const ta = editTextareaRef.current;
    if (editingId && ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; }
  }, [editText, editingId]);

  // Đo chiều cao thực -> bố cục lại. GIỮ lại chiều cao của node đang ẩn (thu gọn) để khi
  // mở lại không phải đo lại từ mặc định -> tránh xê dịch.
  useLayoutEffect(() => {
    if (!layout) return;
    let changed = false;
    const next = new Map(heights);
    for (const p of layout.placed) {
      const el = nodeEls.current.get(p.node.id);
      const h = el ? el.offsetHeight : (heights.get(p.node.id) ?? NODE_H);
      if (Math.abs((heights.get(p.node.id) ?? NODE_H) - h) > 0.5) { next.set(p.node.id, h); changed = true; }
    }
    if (changed) setHeights(next);
  });

  // Sau khi bố cục đổi do thu gọn/mở rộng: bù scroll để node được neo đứng yên trên màn hình.
  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a || !layout || !scrollRef.current) return;
    const np = layout.byId.get(a.id);
    if (np) {
      const dx = (np.x - a.x) * scale, dy = (np.y - a.y) * scale;
      if (dx || dy) { scrollRef.current.scrollLeft += dx; scrollRef.current.scrollTop += dy; }
    }
    anchorRef.current = null;
  }, [layout, scale]);

  // ── Thêm node bằng nút "+" ──
  const themConChoNode = useCallback((id: string) => {
    if (!root) return;
    const node = timNode(root, id);
    const laTT = timCha(root, id)?.id === root.id; // con của ý tưởng trung tâm -> chia 2 bên
    const child = nodeMoi(); if (laTT && node) child.side = chonSide(node);
    capNhatRoot((r) => themCon(r, id, child));
    setTimeout(() => batDauSua(child.id, false, ''), 0);
  }, [root, capNhatRoot, batDauSua]);

  // Thêm 1 ý tưởng trung tâm mới (con trực tiếp của super-root).
  const themTrungTam = useCallback(() => {
    if (!root) return;
    const tt = trungTamMoi(); tt.text = '';
    capNhatRoot((r) => themCon(r, r.id, tt));
    setTimeout(() => batDauSua(tt.id, false, ''), 0);
  }, [root, capNhatRoot, batDauSua]);

  // ── Thu gọn / mở rộng, neo node tại chỗ để layout không nhảy ──
  const thuGonNode = useCallback((id: string) => {
    const cur = layout?.byId.get(id);
    if (cur) anchorRef.current = { id, x: cur.x, y: cur.y };
    capNhatRoot((r) => toggleCollapse(r, id), false);
  }, [layout, capNhatRoot]);

  // ── Định dạng node đang chọn ──
  const datTT = useCallback((patch: Partial<MindNode>) => {
    if (!selectedId) return;
    capNhatRoot((r) => datThuocTinh(r, selectedId, patch));
  }, [selectedId, capNhatRoot]);

  // ── Copy / Paste cả nhánh (qua nút trên thanh edit) ──
  const copyNhanh = useCallback(() => {
    if (!root || !selectedId) return;
    const n = timNode(root, selectedId);
    if (n) { setClip(n); toast?.('Đã copy nhánh'); }
  }, [root, selectedId, toast]);
  const pasteNhanh = useCallback(() => {
    if (!root || !selectedId || !clip) return;
    const ban = nhanBan(clip);
    const sel = timNode(root, selectedId);
    const laTT = timCha(root, selectedId)?.id === root.id; // dán vào ý tưởng trung tâm -> con có side
    ban.side = laTT && sel ? chonSide(sel) : undefined;
    capNhatRoot((r) => themCon(r, selectedId, ban));
    setSelectedId(ban.id); toast?.('Đã dán nhánh');
  }, [root, selectedId, clip, capNhatRoot, toast]);

  // ── Đầu mục "・" theo dòng đang bôi đen (chỉ chạy khi đang sửa & có vùng chọn) ──
  const apDungBullet = useCallback(() => {
    const ta = editTextareaRef.current;
    if (!editingId || !ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) return; // không bôi đen -> vô hiệu
    const text = editText;
    const lineStart = text.lastIndexOf('\n', s - 1) + 1;
    let lineEnd = text.indexOf('\n', e); if (lineEnd === -1) lineEnd = text.length;
    const lines = text.slice(lineStart, lineEnd).split('\n');
    const coND = lines.filter((l) => l.trim() !== '');
    const dangCo = coND.length > 0 && coND.every((l) => /^\s*・/.test(l));
    const moi = lines.map((l) => {
      if (l.trim() === '') return l;
      return dangCo ? l.replace(/^(\s*)・\s?/, '$1') : l.replace(/^(\s*)/, '$1・ ');
    });
    const newText = text.slice(0, lineStart) + moi.join('\n') + text.slice(lineEnd);
    setEditText(newText);
    // giữ vùng chọn bao trùm khối vừa sửa
    requestAnimationFrame(() => { if (editTextareaRef.current) { editTextareaRef.current.selectionStart = lineStart; editTextareaRef.current.selectionEnd = lineStart + moi.join('\n').length; } });
  }, [editingId, editText]);

  // ── Đính file ──
  const onChonFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // cho phép chọn lại cùng file
    if (!file || !selectedId) return;
    setUploading(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Không đọc được file'));
        reader.readAsDataURL(file);
      });
      const saved = await api<FileAtt>('/api/mindmaps/upload', { method: 'POST', body: JSON.stringify({ name: file.name, dataBase64 }) });
      capNhatRoot((r) => datThuocTinh(r, selectedId, { files: [...(timNode(r, selectedId)?.files ?? []), saved] }));
    } catch (err) { setLoi(err instanceof Error ? err.message : 'Lỗi đính file'); }
    finally { setUploading(false); }
  }, [selectedId, capNhatRoot]);
  const goBoFile = useCallback((url: string) => {
    if (!selectedId) return;
    capNhatRoot((r) => {
      const next = (timNode(r, selectedId)?.files ?? []).filter((f) => f.url !== url);
      return datThuocTinh(r, selectedId, { files: next.length ? next : undefined });
    });
  }, [selectedId, capNhatRoot]);

  // ── Đính / gỡ link (nhiều link) ──
  const themLink = useCallback(() => {
    const v = linkInput.trim();
    if (!v || !selectedId) return;
    capNhatRoot((r) => datThuocTinh(r, selectedId, { links: [...(timNode(r, selectedId)?.links ?? []), v] }));
    setLinkInput('');
  }, [linkInput, selectedId, capNhatRoot]);
  const goBoLink = useCallback((idx: number) => {
    if (!selectedId) return;
    capNhatRoot((r) => {
      const cur = timNode(r, selectedId)?.links ?? [];
      const next = cur.filter((_, i) => i !== idx);
      return datThuocTinh(r, selectedId, { links: next.length ? next : undefined });
    });
  }, [selectedId, capNhatRoot]);

  // ── Điều hướng phím ──
  const dieuHuong = useCallback((huong: 'up' | 'down' | 'left' | 'right') => {
    if (!root || !layout || !selectedId) return;
    const cur = layout.byId.get(selectedId);
    if (!cur) return;
    if (huong === 'left' || huong === 'right') {
      // Trái/phải đi theo hướng nhánh: ra xa gốc = về phía con; về gần gốc = cha
      const node = timNode(root, selectedId);
      const raXa = (cur.side >= 0 && huong === 'right') || (cur.side < 0 && huong === 'left') || (cur.side === 0 && huong === 'right');
      if (raXa && node && node.children.length) {
        if (node.collapsed) capNhatRoot((r) => toggleCollapse(r, selectedId), false);
        // chọn con cùng phía (với gốc thì ưu tiên phía phải)
        const side: Side | undefined = cur.side === 0 ? (huong === 'right' ? 'R' : 'L') : undefined;
        const kid = side ? node.children.find((c) => (c.side ?? 'R') === side) ?? node.children[0] : node.children[0];
        setSelectedId(kid.id);
      } else { const cha = timCha(root, selectedId); if (cha && cha.id !== root.id) setSelectedId(cha.id); }
      return;
    }
    const sorted = [...layout.placed].sort((a, b) => a.y - b.y || a.x - b.x);
    const idx = sorted.findIndex((p) => p.node.id === selectedId);
    const next = huong === 'up' ? sorted[idx - 1] : sorted[idx + 1];
    if (next) setSelectedId(next.node.id);
  }, [root, layout, selectedId, capNhatRoot]);

  function onCanvasKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if (editingId || !root || !selectedId) return;
    if (e.key === 'Enter') {
      // Enter = thêm node ngang hàng (với ý tưởng trung tâm = thêm 1 ý tưởng trung tâm mới).
      e.preventDefault();
      const node = timNode(root, selectedId);
      const sib = nodeMoi(); sib.side = node?.side;
      capNhatRoot((r) => themNgangHang(r, selectedId, sib).root);
      setTimeout(() => batDauSua(sib.id, false, ''), 0);
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) capNhatRoot((r) => luiCap(r, selectedId).root); else themConChoNode(selectedId); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const { root: r2, nextSelect } = xoaNode(root, selectedId); capNhatRoot(() => r2); setSelectedId(nextSelect === root.id ? (r2.children[0]?.id ?? null) : nextSelect); return; }
    if (e.key === 'F2' || e.key === ' ') { e.preventDefault(); batDauSua(selectedId, true); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); dieuHuong('up'); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); dieuHuong('down'); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); dieuHuong('left'); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); dieuHuong('right'); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); batDauSua(selectedId, false, e.key); }
  }

  function onEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter') {
      if (e.altKey) {
        // Alt+Enter = chèn xuống dòng tại con trỏ.
        e.preventDefault();
        const ta = e.currentTarget;
        ta.setRangeText('\n', ta.selectionStart, ta.selectionEnd, 'end');
        setEditText(ta.value);
        return;
      }
      if (e.shiftKey) return;       // Shift+Enter = xuống dòng (textarea tự xử lý)
      e.preventDefault(); ketThucSua(true, false); return;   // Enter = thêm box cùng cấp
    }
    if (e.key === 'Tab') { e.preventDefault(); ketThucSua(false, true); }
    else if (e.key === 'Escape') { e.preventDefault(); ketThucSua(false, false); }
  }

  // ── Zoom / fit ──
  function zoom(delta: number, center?: { x: number; y: number }) {
    setScale((s) => {
      const ns = Math.min(2, Math.max(0.3, +(s + delta).toFixed(2)));
      const wrap = scrollRef.current;
      if (wrap && center && ns !== s) {
        const cx = (wrap.scrollLeft + center.x) / s, cy = (wrap.scrollTop + center.y) / s;
        requestAnimationFrame(() => { wrap.scrollLeft = cx * ns - center.x; wrap.scrollTop = cy * ns - center.y; });
      }
      return ns;
    });
  }
  function fitView() {
    if (!layout || !scrollRef.current) return;
    const wrap = scrollRef.current;
    const s = Math.min(2, Math.max(0.3, +Math.min((wrap.clientWidth - 32) / layout.width, (wrap.clientHeight - 32) / layout.height, 1.5).toFixed(2)));
    setScale(s);
    requestAnimationFrame(() => { if (!scrollRef.current) return; scrollRef.current.scrollLeft = (layout.width * s - scrollRef.current.clientWidth) / 2; scrollRef.current.scrollTop = (layout.height * s - scrollRef.current.clientHeight) / 2; });
  }
  // Ctrl/⌘ + cuộn để zoom (listener non-passive để chặn zoom trình duyệt)
  useEffect(() => {
    const wrap = scrollRef.current; if (!wrap) return;
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = wrap!.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 0.12 : -0.12, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // Cuộn node được chọn vào khung nhìn
  useEffect(() => {
    if (!layout || !selectedId || !scrollRef.current || drag) return;
    const p = layout.byId.get(selectedId); if (!p) return;
    const wrap = scrollRef.current, m = 60;
    const left = p.x * scale, top = (p.y - p.h / 2) * scale, right = (p.x + NODE_W) * scale, bottom = (p.y + p.h / 2) * scale;
    if (left < wrap.scrollLeft + m) wrap.scrollLeft = Math.max(0, left - m);
    else if (right > wrap.scrollLeft + wrap.clientWidth - m) wrap.scrollLeft = right - wrap.clientWidth + m;
    if (top < wrap.scrollTop + m) wrap.scrollTop = Math.max(0, top - m);
    else if (bottom > wrap.scrollTop + wrap.clientHeight - m) wrap.scrollTop = bottom - wrap.clientHeight + m;
  }, [selectedId, layout, scale, drag]);

  // ── Kéo nền để pan ──
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  function onBgMouseDown(e: React.MouseEvent) {
    // Click vào node thì node tự xử lý; mọi chỗ trống khác (nền, svg, vùng canvas) -> bỏ chọn + pan.
    if ((e.target as HTMLElement).closest('[data-node-id]')) return;
    const wrap = scrollRef.current; if (!wrap) return;
    // Đang sửa: ép blur để chạy onBlur -> ketThucSua (commit nội dung vừa gõ/dán) TRƯỚC khi bỏ chọn,
    // tránh textarea bị gỡ trước khi kịp lưu.
    if (editingId && editTextareaRef.current) editTextareaRef.current.blur();
    panRef.current = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    setEditingId(null); setPopover(null); setSelectedId(null); // bỏ chọn -> ẩn thanh edit
  }

  // ── Kéo-thả node để đổi nhánh cha ──
  const dragRef = useRef<{ id: string; startX: number; startY: number; grabX: number; grabY: number; moved: boolean } | null>(null);
  function dropActionAt(e: MouseEvent, draggedId: string): { targetId: string; mode: DropMode; side?: Side } | null {
    if (!root) return null;
    const draggedNode = timNode(root, draggedId);
    if (!draggedNode) return null;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const targetEl = el?.closest('[data-node-id]') as HTMLElement | null;
    const targetId = targetEl?.getAttribute('data-node-id') ?? null;
    if (!targetEl || !targetId || targetId === draggedId || laHauDue(draggedNode, targetId)) return null;

    const targetParent = timCha(root, targetId);
    const isCentral = targetParent?.id === root.id;
    const rect = targetEl.getBoundingClientRect();
    const yRatio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    if (!isCentral && yRatio < 0.28) return { targetId, mode: 'before' };
    if (!isCentral && yRatio > 0.72) return { targetId, mode: 'after' };

    const side = isCentral ? (e.clientX < rect.left + rect.width / 2 ? 'L' : 'R') : undefined;
    return { targetId, mode: 'child', side };
  }
  function onNodeMouseDown(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (id !== selectedId) setPopover(null);
    setSelectedId(id); scrollRef.current?.focus();
    if (root && root.id === id) return; // không kéo gốc
    // Ghi điểm "cầm" trong ô (lệch so với góc trên-trái) để ô bám đúng vị trí con trỏ khi kéo.
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, grabX: e.clientX - rect.left, grabY: e.clientY - rect.top, moved: false };
  }
  useEffect(() => {
    function move(e: MouseEvent) {
      if (panRef.current && scrollRef.current) {
        scrollRef.current.scrollLeft = panRef.current.sl - (e.clientX - panRef.current.x);
        scrollRef.current.scrollTop = panRef.current.st - (e.clientY - panRef.current.y);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
      d.moved = true;
      const action = dropActionAt(e, d.id);
      // Toạ độ con trỏ quy về khung sơ đồ (mm-stage) để đặt ghost bằng position:absolute.
      const sr = scrollRef.current?.getBoundingClientRect();
      setDrag({ id: d.id, targetId: action?.targetId ?? null, mode: action?.mode ?? null, side: action?.side, x: e.clientX - (sr?.left ?? 0), y: e.clientY - (sr?.top ?? 0), gx: d.grabX, gy: d.grabY });
    }
    function up(e: MouseEvent) {
      panRef.current = null;
      const d = dragRef.current; dragRef.current = null;
      if (d && d.moved && root) {
        const action = dropActionAt(e, d.id);
        if (action) {
          capNhatRoot((r) => {
            if (action.mode === 'before' || action.mode === 'after') return chenNgangHang(r, d.id, action.targetId, action.mode).root;
            return chuyenNode(r, d.id, action.targetId, action.side).root;
          });
        }
      }
      setDrag(null);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [root, capNhatRoot]);

  const selPlaced = selectedId && layout ? layout.byId.get(selectedId) : null;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <section className={`mm-root ${phongTo ? 'mm-root-full' : ''}`}>
      {hienSidebar && (
        <aside className="mm-sidebar">
          <div className="mm-sidebar-head">
            <span className="mm-sidebar-title">MindMap</span>
            <button className="mm-btn mm-btn-primary mm-btn-sm" onClick={yeuCauTaoMap} title="Tạo sơ đồ mới"><FilePlus2 size={15} /> Mới</button>
          </div>
          <div className="mm-sidebar-list">
            {dangTaiDS && danhSach.length === 0 && <div className="mm-muted mm-center"><Loader2 className="mm-spin" size={16} /> Đang tải…</div>}
            {!dangTaiDS && danhSach.length === 0 && <div className="mm-muted mm-center">Chưa có sơ đồ nào.<br />Bấm “Mới” để bắt đầu.</div>}
            {danhSach.map((m) => (
              <div key={m.id} className={`mm-list-item ${m.id === mapId ? 'mm-list-item-active' : ''}`} onClick={() => { if (renamingId !== m.id) yeuCauMoMap(m.id); }}>
                {renamingId === m.id ? (
                  <input
                    className="mm-rename-input" autoFocus value={renameText}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doiTenMap(m.id, renameText); } else if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); } }}
                    onBlur={() => doiTenMap(m.id, renameText)}
                  />
                ) : (
                  <span className="mm-list-item-title">{m.title || 'Không tên'}</span>
                )}
                {renamingId !== m.id && (
                  <button className="mm-icon-btn mm-list-del" title="Đổi tên" onClick={(e) => { e.stopPropagation(); setRenamingId(m.id); setRenameText(m.title); }}><Pencil size={13} /></button>
                )}
                <button className="mm-icon-btn mm-list-del" title="Xoá" onClick={(e) => { e.stopPropagation(); xoaMap(m.id); }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </aside>
      )}

      <div className="mm-main">
        <div className="mm-toolbar">
          <button className="mm-icon-btn" title={hienSidebar ? 'Ẩn danh sách' : 'Hiện danh sách'} onClick={() => setHienSidebar((v) => !v)}>
            {hienSidebar ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
          </button>
          {root ? (
            <>
              <input className="mm-title-input" value={title} onChange={(e) => doiTitle(e.target.value)} placeholder="Tên sơ đồ" />
              <div className="mm-toolbar-spacer" />
              <button className="mm-btn mm-btn-sm mm-btn-export" title="Xuất Markdown / Mermaid để prompt cho AI" onClick={() => { setXuat('md'); setDaCopy(false); }}><Download size={14} /> Export</button>
            </>
          ) : <span className="mm-muted">Chọn hoặc tạo một sơ đồ để bắt đầu vẽ.</span>}
        </div>

        {loi && <div className="mm-error" onClick={() => setLoi('')}>{loi} (bấm để ẩn)</div>}

        {root && layout ? (
          <div className={`mm-stage ${drag ? 'mm-dragging' : ''}`}>
            <div className="mm-scroll" ref={scrollRef} tabIndex={0} onKeyDown={onCanvasKeyDown} onMouseDown={onBgMouseDown} onScroll={() => setScrollTick((t) => t + 1)}>
              <div className="mm-canvas" style={{ width: layout.width * scale, height: layout.height * scale }} onMouseDown={onBgMouseDown}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: layout.width, height: layout.height, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                  <svg width={layout.width} height={layout.height} className="mm-edges">
                    {layout.edges.map((ed, i) => {
                      const mx = (ed.x1 + ed.x2) / 2;
                      return <path key={i} d={`M ${ed.x1} ${ed.y1} C ${mx} ${ed.y1}, ${mx} ${ed.y2}, ${ed.x2} ${ed.y2}`} fill="none" stroke={ed.color} strokeWidth={2.5} strokeOpacity={0.5} strokeLinecap="round" />;
                    })}
                  </svg>
                  {layout.placed.map((p) => {
                    const isSel = p.node.id === selectedId, isEdit = p.node.id === editingId, isRoot = p.depth === 0;
                    const isDragSrc = drag?.id === p.node.id, isDropTarget = drag?.targetId === p.node.id;
                    const dropMode = isDropTarget ? drag?.mode : null;
                    const showAddR = !isEdit && (isSel || hoverId === p.node.id) && (isRoot || p.side > 0);
                    const showAddL = !isEdit && (isSel || hoverId === p.node.id) && (isRoot || p.side < 0);
                    const textStyle: React.CSSProperties = {
                      fontFamily: fontStack(p.node.font),
                      fontSize: p.node.fontSize ? `${p.node.fontSize}px` : undefined,
                      color: p.node.textColor || undefined,
                      textAlign: p.node.align,
                    };
                    const alignItems = p.node.align === 'center' ? 'center' : p.node.align === 'right' ? 'flex-end' : 'flex-start';
                    const nLinks = p.node.links?.length ?? 0;
                    const nFiles = p.node.files?.length ?? 0;
                    return (
                      <div
                        key={p.node.id}
                        data-node-id={p.node.id}
                        ref={(el) => { if (el) nodeEls.current.set(p.node.id, el); else nodeEls.current.delete(p.node.id); }}
                        className={`mm-node ${isSel ? 'mm-node-sel' : ''} ${isRoot ? 'mm-node-root' : ''} ${isDragSrc ? 'mm-node-dragsrc' : ''} ${dropMode === 'child' ? 'mm-node-drop' : ''} ${dropMode === 'before' ? 'mm-node-drop-before' : ''} ${dropMode === 'after' ? 'mm-node-drop-after' : ''}`}
                        style={{
                          left: p.x, top: p.y - p.h / 2, width: NODE_W, minHeight: NODE_H,
                          border: isRoot ? 'none' : undefined, borderColor: p.color,
                          background: p.node.bgColor || (isRoot ? p.color : '#fff'), color: isRoot ? '#fff' : '#0f172a',
                          boxShadow: isSel ? `0 0 0 3px ${p.color}40, 0 4px 14px rgba(15,23,42,0.13)` : undefined,
                          ...shapeCss(p.node.shape),
                        }}
                        onMouseDown={(e) => onNodeMouseDown(e, p.node.id)}
                        onMouseEnter={() => setHoverId(p.node.id)}
                        onMouseLeave={() => setHoverId((h) => (h === p.node.id ? null : h))}
                        onDoubleClick={() => batDauSua(p.node.id, true)}
                      >
                        {isEdit ? (
                          <textarea ref={editTextareaRef} className="mm-edit" style={textStyle} value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={onEditKeyDown} onSelect={(e) => setCoBoiDen(e.currentTarget.selectionStart !== e.currentTarget.selectionEnd)} onBlur={() => ketThucSua(false, false)} onMouseDown={(e) => e.stopPropagation()} rows={1} />
                        ) : (
                          <div className="mm-node-content" style={{ alignItems }}>
                            <span className="mm-node-text" style={textStyle}>
                              {p.node.svcIcon && <span className="mm-node-svcicon"><IconGlyph slug={p.node.svcIcon} size={16} /></span>}
                              {p.node.icon && <span className="mm-node-icon">{p.node.icon}</span>}
                              {p.node.text || <span className="mm-node-empty">(trống)</span>}
                            </span>
                            {(nLinks > 0 || nFiles > 0) && (
                              <div className="mm-node-badges">
                                {nLinks > 0 && (
                                  <button className="mm-badge mm-badge-link" title={`${nLinks} link`}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => { e.stopPropagation(); setSelectedId(p.node.id); setPopover('link'); }}>
                                    <Link2 size={12} />{nLinks > 1 && <span className="mm-badge-num">{nLinks}</span>}
                                  </button>
                                )}
                                {nFiles > 0 && (
                                  <button className="mm-badge" title={`${nFiles} file`}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => { e.stopPropagation(); setSelectedId(p.node.id); setPopover('files'); }}>
                                    <Paperclip size={12} />{nFiles > 1 && <span className="mm-badge-num">{nFiles}</span>}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {p.hasChildren && !isEdit && (
                          <button
                            className={`mm-collapse ${p.side < 0 ? 'mm-collapse-l' : 'mm-collapse-r'}`}
                            style={{ borderColor: p.color, color: isRoot ? '#fff' : p.color, background: isRoot ? p.color : '#fff' }}
                            title={p.collapsed ? 'Mở rộng' : 'Thu gọn'}
                            onMouseDown={(e) => { e.stopPropagation(); }}
                            onClick={(e) => { e.stopPropagation(); thuGonNode(p.node.id); }}
                          >{p.collapsed ? (p.side < 0 ? <ChevronLeftMini /> : <ChevronRight size={13} />) : <ChevronDown size={13} />}</button>
                        )}
                        {showAddR && <button className="mm-add mm-add-r" title="Thêm nhánh" style={{ background: p.color }} onMouseDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.stopPropagation(); themConChoNode(p.node.id); }}><Plus size={14} /></button>}
                        {showAddL && <button className="mm-add mm-add-l" title="Thêm nhánh" style={{ background: p.color }} onMouseDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.stopPropagation(); themConChoNode(p.node.id); }}><Plus size={14} /></button>}
                      </div>
                    );
                  })}
                  {/* Lớp nét viết tay (trên các node) */}
                  {drawings.length > 0 && (
                    <svg width={layout.width} height={layout.height} className="mm-draw">
                      {drawings.map((s, i) => (s.pts.length > 1
                        ? <polyline key={i} points={s.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />
                        : <circle key={i} cx={s.pts[0].x} cy={s.pts[0].y} r={s.width / 2} fill={s.color} />))}
                    </svg>
                  )}
                </div>
              </div>
            </div>

            {/* Lớp bắt chuột để viết tay (chỉ khi bật bút) */}
            {penMode && <div className="mm-pen-overlay" onMouseDown={penDown} />}

            {/* Thanh công cụ bút */}
            {penMode && (
              <div className="mm-pen-bar" onMouseDown={(e) => e.stopPropagation()}>
                {PEN_COLORS.map((c) => (
                  <button key={c} className={`mm-pen-color ${penColor === c ? 'mm-pen-color-on' : ''}`} style={{ background: c }} title="Màu bút" onClick={() => setPenColor(c)} />
                ))}
                <div className="mm-fbtn-sep" />
                <button className="mm-fbtn" title="Xoá nét cuối" onClick={() => { setDrawings((d) => d.slice(0, -1)); setTrangThaiLuu('dirty'); }}><Eraser size={16} /></button>
                <button className="mm-fbtn" title="Xoá hết nét vẽ" onClick={() => { setDrawings([]); setTrangThaiLuu('dirty'); }}>Xoá hết</button>
                <button className="mm-fbtn mm-fbtn-on" title="Xong" onClick={() => setPenMode(false)}>Xong</button>
              </div>
            )}

            {/* Thanh công cụ nổi khi chọn node (hiện cả khi đang sửa để bôi đen + đánh đầu mục) */}
            {selPlaced && !drag && (() => {
              const wrap = scrollRef.current;
              const tx = selPlaced.x * scale - (wrap?.scrollLeft ?? 0) + (NODE_W * scale) / 2;
              const ty = (selPlaced.y - selPlaced.h / 2) * scale - (wrap?.scrollTop ?? 0);
              const selNode = root && selectedId ? timNode(root, selectedId) : null;
              const togglePop = (k: typeof popover) => setPopover((p) => (p === k ? null : k));
              const AlignIcon = selNode?.align === 'center' ? AlignCenter : selNode?.align === 'right' ? AlignRight : AlignLeft;
              return (
                <div className="mm-floating" style={{ left: tx, top: Math.max(8, ty - 8) }} onMouseDown={(e) => e.stopPropagation()}>
                  <button className={`mm-fbtn ${popover === 'bg' ? 'mm-fbtn-on' : ''}`} title="Màu nền box" onClick={() => togglePop('bg')}><PaintBucket size={16} /><i className="mm-fbtn-bar" style={{ background: selNode?.bgColor || '#fff' }} /></button>
                  <div className="mm-fbtn-sep" />
                  <button className={`mm-fbtn ${popover === 'font' ? 'mm-fbtn-on' : ''}`} title="Phông chữ" onClick={() => togglePop('font')}><Type size={16} /></button>
                  <button className={`mm-fbtn ${popover === 'size' ? 'mm-fbtn-on' : ''}`} title="Cỡ chữ" onClick={() => togglePop('size')}><span className="mm-fbtn-aa">{selNode?.fontSize ?? DEFAULT_FONT_SIZE}</span></button>
                  <button className={`mm-fbtn ${popover === 'text' ? 'mm-fbtn-on' : ''}`} title="Màu chữ" onClick={() => togglePop('text')}><Baseline size={16} /><i className="mm-fbtn-bar" style={{ background: selNode?.textColor || '#0f172a' }} /></button>
                  <button className={`mm-fbtn ${popover === 'box' ? 'mm-fbtn-on' : ''}`} title="Màu box" onClick={() => togglePop('box')}><Palette size={16} /></button>
                  <button className={`mm-fbtn ${popover === 'shape' ? 'mm-fbtn-on' : ''}`} title="Hình dạng box" onClick={() => togglePop('shape')}><Square size={16} /></button>
                  <div className="mm-fbtn-sep" />
                  <button className={`mm-fbtn ${popover === 'align' ? 'mm-fbtn-on' : ''}`} title="Căn lề" onClick={() => togglePop('align')}><AlignIcon size={16} /></button>
                  <button className="mm-fbtn" title={coBoiDen ? 'Đánh đầu mục ・ cho dòng đang bôi đen' : 'Bôi đen text trong box rồi mới đánh đầu mục'} disabled={!coBoiDen} onMouseDown={(e) => e.preventDefault()} onClick={apDungBullet}><List size={16} /></button>
                  <div className="mm-fbtn-sep" />
                  <button className={`mm-fbtn ${selNode?.links?.length ? 'mm-fbtn-active' : ''} ${popover === 'link' ? 'mm-fbtn-on' : ''}`} title="Đính link" onClick={() => { setLinkInput(''); togglePop('link'); }}><Link2 size={16} /></button>
                  <button className={`mm-fbtn ${selNode?.files?.length ? 'mm-fbtn-active' : ''} ${popover === 'files' ? 'mm-fbtn-on' : ''}`} title="Đính file" onClick={() => togglePop('files')}>{uploading ? <Loader2 className="mm-spin" size={16} /> : <Paperclip size={16} />}</button>
                  <button className={`mm-fbtn ${selNode?.icon ? 'mm-fbtn-active' : ''} ${popover === 'emoji' ? 'mm-fbtn-on' : ''}`} title="Chèn emoji" onClick={() => togglePop('emoji')}><Smile size={16} /></button>
                  <button className={`mm-fbtn ${selNode?.svcIcon ? 'mm-fbtn-active' : ''} ${popover === 'icon' ? 'mm-fbtn-on' : ''}`} title="Đính icon (AWS, GCP, Docker…)" onClick={() => togglePop('icon')}><Shapes size={16} /></button>
                  <div className="mm-fbtn-sep" />
                  <button className="mm-fbtn" title="Copy cả nhánh" onClick={copyNhanh}><Copy size={16} /></button>
                  <button className="mm-fbtn" title={clip ? 'Dán nhánh đã copy làm con' : 'Chưa có nhánh nào được copy'} disabled={!clip} onClick={pasteNhanh}><ClipboardPaste size={16} /></button>
                  {root && selectedId && (
                    <>
                      <div className="mm-fbtn-sep" />
                      <button className="mm-fbtn mm-fbtn-danger" title="Xoá node" onClick={() => { const { root: r2, nextSelect } = xoaNode(root, selectedId!); capNhatRoot(() => r2); setSelectedId(nextSelect === root.id ? (r2.children[0]?.id ?? null) : nextSelect); }}><Trash2 size={15} /></button>
                    </>
                  )}

                  {popover === 'font' && (
                    <div className="mm-pop mm-pop-list">
                      {FONTS.map((f) => (
                        <button key={f.key} className={`mm-pop-item ${(selNode?.font ?? 'inherit') === f.key ? 'mm-pop-item-on' : ''}`} style={{ fontFamily: f.stack || undefined }}
                          onClick={() => { datTT({ font: f.key === 'inherit' ? undefined : f.key }); setPopover(null); }}>{f.label}</button>
                      ))}
                    </div>
                  )}
                  {popover === 'size' && (
                    <div className="mm-pop mm-pop-sizes">
                      {FONT_SIZES.map((s) => (
                        <button key={s} className={`mm-pop-item ${(selNode?.fontSize ?? DEFAULT_FONT_SIZE) === s ? 'mm-pop-item-on' : ''}`}
                          onClick={() => { datTT({ fontSize: s === DEFAULT_FONT_SIZE ? undefined : s }); setPopover(null); }}>{s}</button>
                      ))}
                    </div>
                  )}
                  {popover === 'text' && (
                    <div className="mm-swatches">
                      {TEXT_SWATCHES.map((c) => (
                        <button key={c} className="mm-swatch" style={{ background: c }} title={c} onClick={() => { datTT({ textColor: c }); setPopover(null); }} />
                      ))}
                      <button className="mm-swatch mm-swatch-reset" title="Mặc định" onClick={() => { datTT({ textColor: undefined }); setPopover(null); }}>↺</button>
                    </div>
                  )}
                  {popover === 'box' && (
                    <div className="mm-swatches">
                      {SWATCHES.map((c) => (
                        <button key={c} className="mm-swatch" style={{ background: c }} title={c} onClick={() => { capNhatRoot((r) => doiMau(r, selectedId!, c)); setPopover(null); }} />
                      ))}
                      <button className="mm-swatch mm-swatch-reset" title="Mặc định" onClick={() => { capNhatRoot((r) => doiMau(r, selectedId!, undefined)); setPopover(null); }}>↺</button>
                    </div>
                  )}
                  {popover === 'bg' && (
                    <div className="mm-swatches">
                      {BG_SWATCHES.map((c) => (
                        <button key={c} className="mm-swatch" style={{ background: c, boxShadow: c === '#ffffff' ? '0 0 0 1px #cbd5e1' : undefined }} title={c} onClick={() => { datTT({ bgColor: c }); setPopover(null); }} />
                      ))}
                      <button className="mm-swatch mm-swatch-reset" title="Mặc định (trắng)" onClick={() => { datTT({ bgColor: undefined }); setPopover(null); }}>↺</button>
                    </div>
                  )}
                  {popover === 'shape' && (
                    <div className="mm-pop mm-pop-row">
                      {[
                        { key: 'pill', label: 'Bo tròn', el: <Squircle size={16} /> },
                        { key: 'round', label: 'Bo góc', el: <Square size={16} /> },
                        { key: 'rect', label: 'Chữ nhật', el: <RectangleHorizontal size={16} /> },
                        { key: 'ellipse', label: 'Tròn / Elip', el: <Circle size={16} /> },
                        { key: 'diamond', label: 'Hình thoi', el: <Diamond size={16} /> },
                        { key: 'parallelogram', label: 'Bình hành', el: <span className="mm-shape-glyph">▱</span> },
                      ].map((s) => (
                        <button key={s.key} className={`mm-fbtn ${(selNode?.shape ?? 'pill') === s.key ? 'mm-fbtn-on' : ''}`} title={s.label}
                          onClick={() => { datTT({ shape: s.key === 'pill' ? undefined : s.key }); setPopover(null); }}>{s.el}</button>
                      ))}
                    </div>
                  )}
                  {popover === 'align' && (
                    <div className="mm-pop mm-pop-row">
                      <button className={`mm-fbtn ${!selNode?.align || selNode?.align === 'left' ? 'mm-fbtn-on' : ''}`} title="Trái" onClick={() => { datTT({ align: undefined }); setPopover(null); }}><AlignLeft size={16} /></button>
                      <button className={`mm-fbtn ${selNode?.align === 'center' ? 'mm-fbtn-on' : ''}`} title="Giữa" onClick={() => { datTT({ align: 'center' }); setPopover(null); }}><AlignCenter size={16} /></button>
                      <button className={`mm-fbtn ${selNode?.align === 'right' ? 'mm-fbtn-on' : ''}`} title="Phải" onClick={() => { datTT({ align: 'right' }); setPopover(null); }}><AlignRight size={16} /></button>
                    </div>
                  )}
                  {popover === 'link' && (
                    <div className="mm-pop mm-pop-attlist">
                      <div className="mm-pop-addrow">
                        <input className="mm-pop-input" value={linkInput} autoFocus placeholder="https://… rồi Enter để thêm"
                          onChange={(e) => setLinkInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); themLink(); } else if (e.key === 'Escape') { e.preventDefault(); setPopover(null); } }} />
                        <button className="mm-pop-btn" onClick={themLink} disabled={!linkInput.trim()}>Thêm</button>
                      </div>
                      {(selNode?.links?.length ?? 0) > 0 && (
                        <div className="mm-att-items">
                          {selNode!.links!.map((u, i) => (
                            <div className="mm-att-item" key={i}>
                              <a className="mm-att-open" href={chuanLink(u)} target="_blank" rel="noreferrer" title={u}><Link2 size={12} /><span className="mm-chip-text">{nhanLink(u)}</span></a>
                              <button className="mm-att-del" title="Gỡ link" onClick={() => goBoLink(i)}><X size={13} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {popover === 'files' && (
                    <div className="mm-pop mm-pop-attlist">
                      <button className="mm-pop-btn mm-pop-addfile" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                        {uploading ? <><Loader2 className="mm-spin" size={13} /> Đang tải…</> : <><Paperclip size={13} /> Đính file…</>}
                      </button>
                      {(selNode?.files?.length ?? 0) > 0 && (
                        <div className="mm-att-items">
                          {selNode!.files!.map((f) => (
                            <div className="mm-att-item" key={f.url}>
                              <a className="mm-att-open" href={f.url} target="_blank" rel="noreferrer" title={f.name}><Paperclip size={12} /><span className="mm-chip-text">{f.name}</span></a>
                              <button className="mm-att-del" title="Gỡ file" onClick={() => goBoFile(f.url)}><X size={13} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {popover === 'emoji' && (
                    <div className="mm-pop mm-pop-emoji">
                      <EmojiPicker onPick={(e) => { datTT({ icon: e }); setPopover(null); }} />
                      {selNode?.icon && <button className="mm-pop-btn mm-pop-btn-ghost mm-pop-icon-clear" onClick={() => { datTT({ icon: undefined }); setPopover(null); }}><X size={13} /> Bỏ emoji</button>}
                    </div>
                  )}
                  {popover === 'icon' && (
                    <div className="mm-pop mm-pop-emoji">
                      <IconPicker onPick={(slug) => { datTT({ svcIcon: slug }); setPopover(null); }} />
                      {selNode?.svcIcon && <button className="mm-pop-btn mm-pop-btn-ghost mm-pop-icon-clear" onClick={() => { datTT({ svcIcon: undefined }); setPopover(null); }}><X size={13} /> Bỏ icon</button>}
                    </div>
                  )}
                </div>
              );
            })()}
            {/* input file ẩn dùng chung cho nút đính file */}
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={onChonFile} />

            {/* "Bóng" đi theo con trỏ khi kéo: tái hiện cả nhánh (box + con + đường nối) thu nhỏ */}
            {drag && (() => {
              const dragNode = root ? timNode(root, drag.id) : null;
              const dp = layout.byId.get(drag.id);
              if (!dragNode || !dp) return null;
              // Tập node thuộc nhánh đang kéo (theo những gì đang hiển thị).
              const ids = new Set<string>();
              (function collect(n: MindNode) { ids.add(n.id); if (!n.collapsed) n.children.forEach(collect); })(dragNode);
              const parts = layout.placed.filter((p) => ids.has(p.node.id));
              const gedges: Edge[] = [];
              for (const p of parts) {
                if (p.collapsed) continue;
                for (const c of p.node.children) {
                  const cp = layout.byId.get(c.id);
                  if (!cp || !ids.has(c.id)) continue;
                  gedges.push({ x1: p.side >= 0 ? p.x + NODE_W : p.x, y1: p.y, x2: p.side >= 0 ? cp.x : cp.x + NODE_W, y2: cp.y, color: cp.color });
                }
              }
              const rel = (v: number) => v * scale;
              const originTop = dp.y - dp.h / 2; // gốc toạ độ ghost = góc trên-trái box chính
              // Đặt TÂM box chính trùng con trỏ: lùi container nửa bề rộng & nửa chiều cao box chính.
              return (
                <div className={`mm-drag-ghost ${drag.targetId ? 'mm-drag-ghost-ok' : ''}`}
                  style={{ left: drag.x - (NODE_W * scale) / 2, top: drag.y - (dp.h * scale) / 2 }}>
                  <svg className="mm-ghost-edges" style={{ overflow: 'visible' }} width={1} height={1}>
                    {gedges.map((ed, i) => {
                      const x1 = rel(ed.x1 - dp.x), y1 = rel(ed.y1 - originTop), x2 = rel(ed.x2 - dp.x), y2 = rel(ed.y2 - originTop);
                      const mx = (x1 + x2) / 2;
                      return <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke={ed.color} strokeWidth={2.5 * scale} strokeOpacity={0.55} strokeLinecap="round" />;
                    })}
                  </svg>
                  {parts.map((p) => {
                    const isDr = p.node.id === drag.id;
                    return (
                      <div key={p.node.id} className={`mm-ghost-node ${isDr ? 'mm-ghost-node-main' : ''}`}
                        style={{ left: rel(p.x - dp.x), top: rel((p.y - p.h / 2) - originTop), width: NODE_W * scale, minHeight: p.h * scale,
                          borderColor: p.color, fontSize: `${(p.node.fontSize ?? DEFAULT_FONT_SIZE) * scale}px` }}>
                        {p.node.icon && <span className="mm-node-icon">{p.node.icon}</span>}
                        {p.node.bullet && <span className="mm-node-bullet">・</span>}
                        <span className="mm-ghost-text">{p.node.text || '…'}</span>
                      </div>
                    );
                  })}
                  {drag.targetId ? (
                    <span className="mm-drag-hint" style={{ left: 0, top: rel(dp.h) + 6 }}>
                      {drag.mode === 'before' ? 'chèn lên trên' : drag.mode === 'after' ? 'chèn xuống dưới' : drag.side ? `làm nhánh ${drag.side === 'L' ? 'trái' : 'phải'}` : 'làm node con'}
                    </span>
                  ) : null}
                </div>
              );
            })()}

            {/* Canvas trống (đã xoá hết ý tưởng trung tâm) -> mời thêm lại */}
            {layout.placed.length === 0 && (
              <div className="mm-empty-canvas">
                <p>Chưa có ý tưởng trung tâm nào.</p>
                <button className="mm-btn mm-btn-primary" onClick={themTrungTam}><Plus size={16} /> Thêm ý tưởng trung tâm</button>
              </div>
            )}

            {/* Điều khiển góc dưới phải */}
            <div className="mm-controls">
              <button className={`mm-icon-btn ${showHelp ? 'mm-icon-btn-on' : ''}`} title="Phím tắt" onClick={() => setShowHelp((v) => !v)}><HelpCircle size={17} /></button>
              <button className={`mm-icon-btn ${penMode ? 'mm-icon-btn-on' : ''}`} title="Viết tay bằng chuột" onClick={() => setPenMode((v) => !v)}><Pen size={17} /></button>
              {drawings.length > 0 && (
                <button className="mm-icon-btn" title="Xoá hết nét nháp đã vẽ" onClick={() => { setDrawings([]); setTrangThaiLuu('dirty'); }}><Eraser size={17} /></button>
              )}
              <button className="mm-icon-btn" title={phongTo ? 'Thu nhỏ khung sơ đồ' : 'Phóng khung sơ đồ chiếm hết cửa sổ'} onClick={() => setPhongTo((v) => !v)}>{phongTo ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
              <div className="mm-ctrl-sep" />
              <button className="mm-icon-btn" title="Hoàn tác (Ctrl+Z)" onClick={undo} disabled={!past.length}><Undo2 size={17} /></button>
              <button className="mm-icon-btn" title="Làm lại (Ctrl+Y)" onClick={redo} disabled={!future.length}><Redo2 size={17} /></button>
              <div className="mm-ctrl-sep" />
              <button className="mm-icon-btn" title="Thu nhỏ" onClick={() => zoom(-0.1)}><ZoomOut size={17} /></button>
              <span className="mm-zoom-val">{Math.round(scale * 100)}%</span>
              <button className="mm-icon-btn" title="Phóng to" onClick={() => zoom(0.1)}><ZoomIn size={17} /></button>
              <button className="mm-icon-btn" title="Vừa khung" onClick={fitView}><Maximize2 size={17} /></button>
            </div>

            {/* Bảng hướng dẫn phím tắt — dock góc phải, không che toàn màn hình */}
            {showHelp && (
              <div className="mm-help-panel" onMouseDown={(e) => e.stopPropagation()}>
                <div className="mm-help-head">
                  <span>Phím tắt</span>
                  <button className="mm-icon-btn" title="Đóng" onClick={() => setShowHelp(false)}><X size={16} /></button>
                </div>
                <table className="mm-help-table">
                  <tbody>
                    {[
                      ['Enter', 'Thêm node ngang hàng (ở ý tưởng trung tâm = thêm 1 ý tưởng mới)'],
                      ['Tab', 'Thêm node con'],
                      ['Shift + Tab', 'Lùi 1 cấp'],
                      ['Space / double-click', 'Sửa nội dung'],
                      ['Enter (khi đang sửa)', 'Lưu & thêm node ngang hàng'],
                      ['Alt/Shift + Enter (khi sửa)', 'Xuống dòng trong box'],
                      ['Delete / Backspace', 'Xoá node (kể cả ý tưởng trung tâm)'],
                      ['↑ ↓ ← →', 'Di chuyển chọn node'],
                      ['Ctrl + S', 'Lưu sơ đồ'],
                      ['Ctrl + Z', 'Hoàn tác / Làm lại'],
                      ['Ctrl + cuộn chuột', 'Phóng to / thu nhỏ'],
                      ['Kéo nền', 'Di chuyển khung nhìn'],
                      ['Kéo node thả lên node khác', 'Đổi nhánh cha'],
                    ].map(([k, v]) => (
                      <tr key={k}><td className="mm-help-key"><kbd>{k}</kbd></td><td className="mm-help-desc">{v}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="mm-empty">
            <div className="mm-empty-card">
              <h3>Vẽ biểu đồ rẽ nhánh khi suy nghĩ</h3>
              <p>Gõ ý chính, nhấn <b>Enter</b> để thêm ý ngang hàng, <b>Tab</b> để rẽ nhánh con. Các nhánh toả đều 2 bên, mọi thứ tự lưu.</p>
              <button className="mm-btn mm-btn-primary" onClick={yeuCauTaoMap}><FilePlus2 size={16} /> Tạo sơ đồ đầu tiên</button>
            </div>
          </div>
        )}
      </div>

      {/* Popup hỏi lưu khi rời map đang có thay đổi (UI theo chuẩn overlay/popup hệ thống) */}
      {pendingNav && (
        <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setPendingNav(null); }}>
          <div className="popup w-full max-w-md">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold">Lưu thay đổi?</h2>
              <button type="button" className="nut-icon" onClick={() => setPendingNav(null)}><X size={18} /></button>
            </div>
            <p className="mb-5 text-sm leading-6 text-phu">Sơ đồ hiện tại có thay đổi chưa lưu. Bạn muốn lưu trước khi chuyển không?</p>
            <div className="flex justify-end gap-2">
              <button className="mm-btn" onClick={() => setPendingNav(null)}>Huỷ</button>
              <button className="mm-btn" onClick={() => { const nav = pendingNav; setPendingNav(null); thucHienNav(nav); }}>Không lưu</button>
              <button className="mm-btn mm-btn-primary" onClick={async () => { const nav = pendingNav; await luuMap(); setPendingNav(null); thucHienNav(nav); }}>Lưu &amp; tiếp tục</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Export: Markdown / Mermaid để prompt cho AI */}
      {xuat && root && (
        <div className="mm-export-overlay" onMouseDown={() => setXuat(null)}>
          <div className="mm-export-card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mm-export-head">
              <div className="mm-export-tabs">
                <button className={xuat === 'md' ? 'mm-export-tab-on' : ''} onClick={() => { setXuat('md'); setDaCopy(false); }}>Markdown</button>
                <button className={xuat === 'mermaid' ? 'mm-export-tab-on' : ''} onClick={() => { setXuat('mermaid'); setDaCopy(false); }}>Mermaid</button>
              </div>
              <button className="mm-icon-btn" title="Đóng" onClick={() => setXuat(null)}><X size={18} /></button>
            </div>
            <textarea className="mm-export-text" readOnly value={noiDungXuat} onFocus={(e) => e.currentTarget.select()} />
            <div className="mm-export-actions">
              <button className="mm-btn mm-btn-primary" onClick={() => { navigator.clipboard?.writeText(noiDungXuat).then(() => { setDaCopy(true); setTimeout(() => setDaCopy(false), 1500); }); }}>
                {daCopy ? <><Check size={15} /> Đã copy</> : <><Copy size={15} /> Copy</>}
              </button>
              <button className="mm-btn" onClick={() => {
                const ext = xuat === 'md' ? 'md' : 'mmd';
                const blob = new Blob([noiDungXuat], { type: 'text/plain;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${(title || 'mindmap').replace(/[^\w\-]+/g, '_')}.${ext}`;
                a.click(); URL.revokeObjectURL(a.href);
              }}><Download size={15} /> Tải về</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Mũi tên trái nhỏ cho nút thu gọn ở nhánh bên trái (lucide không có size 13 mặc định khác hướng)
function ChevronLeftMini() {
  return <ChevronRight size={13} style={{ transform: 'rotate(180deg)' }} />;
}
