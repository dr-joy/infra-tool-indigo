import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { usePics, useToast } from '../context';
import { PopupXacNhanXoa } from '../components/dialogs';
import { PIC_COLOR_PALETTE } from '../lib/task-utils';
import { ShortcutSettingsScreen } from '../shortcuts';
import type { PicItem } from '../types';
import { ManHinhQuanLyCategory } from './luyen-de-category';

// Tách khỏi src/main.tsx (kế hoạch Council run 022dd1e5, xem docs/exchanges/2026-09-12.md) — nội
// dung 3 màn (ManHinhQuanLyDanhMuc, ManHinhQuanLyPic, ManHinhCauHinhRedmine) giữ nguyên văn. Cả ba
// cùng quy mô nhỏ và đã tự chủ hoàn toàn (không nhận prop nào từ màn cha, tự gọi API riêng, tự quản
// state riêng) nên gộp 1 file không tạo prop rối. Riêng ManHinhQuanLyCategory thuộc nghiệp vụ
// Luyện đề (pick-list de_thi_category) nên đặt ở file riêng, import về đây để mount.

// Tab "Quản lý PIC": thêm / đổi tên / xóa / sắp xếp danh sách người phụ trách.
// Đổi tên sẽ tự cập nhật mọi nơi đang dùng (project, task, mục tiêu tuần).
function ManHinhQuanLyPic() {
  const { reloadPics } = usePics();
  const toast = useToast();
  const [items, setItems] = useState<PicItem[]>([]);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [picDangXoa, setPicDangXoa] = useState<PicItem | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function loiThanThien(e: unknown): string {
    // api() đã rút message thân thiện vào ApiError.message, nên chỉ cần đọc thẳng.
    return e instanceof Error ? e.message : 'Có lỗi xảy ra';
  }

  async function taiDanhSach() {
    try {
      setItems(await api<PicItem[]>('/api/pics'));
      setError('');
    } catch (e) {
      setError(loiThanThien(e));
    }
  }
  useEffect(() => { void taiDanhSach(); }, []);

  async function capNhatXong() {
    await taiDanhSach();
    await reloadPics();
  }

  async function themPic() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/pics', { method: 'POST', body: JSON.stringify({ name }) });
      setNewName('');
      await capNhatXong();
      toast('Đã thêm PIC');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  async function luuTen(item: PicItem) {
    const name = editName.trim();
    if (!name || name === item.name) { setEditingId(null); return; }
    setBusy(true);
    setError('');
    try {
      await api(`/api/pics/${item.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      setEditingId(null);
      await capNhatXong();
      toast('Đã đổi tên PIC');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  async function xoaPic(item: PicItem) {
    try {
      await api(`/api/pics/${item.id}`, { method: 'DELETE' });
      setPicDangXoa(null);
      await capNhatXong();
      toast('Đã xóa PIC');
    } catch (e) {
      setPicDangXoa(null);
      setError(loiThanThien(e));
    }
  }

  // Đổi màu hiển thị PIC trên Gantt
  async function doiMau(item: PicItem, color: string) {
    setItems((cur) => cur.map((p) => (p.id === item.id ? { ...p, color: color || null } : p)));
    try {
      await api(`/api/pics/${item.id}`, { method: 'PATCH', body: JSON.stringify({ color: color || null }) });
      await reloadPics();
    } catch (e) {
      setError(loiThanThien(e));
      await taiDanhSach();
    }
  }

  async function diChuyen(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    try {
      await api('/api/pics/reorder', { method: 'PATCH', body: JSON.stringify({ picIds: next.map((p) => p.id) }) });
      await reloadPics();
    } catch (e) {
      setError(loiThanThien(e));
      await taiDanhSach();
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="rounded-lg border bg-white p-4">
        <h2 className="text-lg font-bold">Quản lý PIC</h2>
      </div>

      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="max-w-xl rounded-lg border bg-white p-4">
        <div className="mb-3 flex gap-2">
          <input
            className="flex-1 rounded border px-3 py-1.5 text-sm"
            placeholder="Tên PIC mới…"
            value={newName}
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              // Bỏ qua Enter khi đang gõ tiếng Việt bằng bộ gõ (IME) để không "ăn" mất ký tự / gửi tên dở
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              void themPic();
            }}
          />
          <button
            type="button"
            className="flex items-center gap-1 rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            disabled={busy || !newName.trim()}
            onClick={themPic}
          >
            <Plus size={16} /> Thêm
          </button>
        </div>

        {items.length === 0 && <div className="py-4 text-center text-sm text-slate-400">Chưa có PIC nào.</div>}
        {items.map((item, index) => (
          <div key={item.id} className="flex items-center gap-2 border-b py-2 last:border-b-0">
            <div className="flex flex-col">
              <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" disabled={index === 0 || busy} title="Chuyển lên" onClick={() => diChuyen(index, -1)}>
                <ChevronUp size={14} />
              </button>
              <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" disabled={index === items.length - 1 || busy} title="Chuyển xuống" onClick={() => diChuyen(index, 1)}>
                <ChevronDown size={14} />
              </button>
            </div>
            {editingId === item.id ? (
              <>
                <input
                  className="flex-1 rounded border px-2 py-1 text-sm"
                  value={editName}
                  autoFocus
                  disabled={busy}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void luuTen(item); }
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
                <button type="button" className="rounded bg-teal-600 p-1.5 text-white hover:bg-teal-700 disabled:opacity-50" disabled={busy} title="Lưu tên" onClick={() => luuTen(item)}>
                  <Check size={14} />
                </button>
                <button type="button" className="rounded border p-1.5 hover:bg-slate-50" title="Hủy" onClick={() => setEditingId(null)}>
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm font-medium">{item.name}</span>
                {/* Màu hiển thị trên Gantt: ô xem trước + droplist chọn màu */}
                <span className="h-5 w-5 shrink-0 rounded border border-slate-300" style={{ backgroundColor: item.color || 'transparent' }} title="Màu trên Gantt" />
                <select
                  className="shrink-0 rounded border border-slate-300 px-1 py-1 text-xs"
                  value={item.color || ''}
                  disabled={busy}
                  title="Chọn màu hiển thị trên Gantt"
                  onChange={(e) => doiMau(item, e.target.value)}
                >
                  <option value="">— màu —</option>
                  {PIC_COLOR_PALETTE.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  {item.color && !PIC_COLOR_PALETTE.some((c) => c.value === item.color) && <option value={item.color}>Khác</option>}
                </select>
                <button type="button" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Đổi tên" onClick={() => { setEditingId(item.id); setEditName(item.name); }}>
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                  title={item.dangSuDung ? 'Không thể xóa: còn task chưa hoàn thành' : 'Xóa khỏi danh sách'}
                  disabled={item.dangSuDung}
                  onClick={() => setPicDangXoa(item)}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {picDangXoa && (
        <PopupXacNhanXoa
          title="Xóa PIC"
          message={`Xóa "${picDangXoa.name}" khỏi danh sách PIC? Task/project đang gán tên này vẫn giữ nguyên, chỉ không chọn được nữa khi gán mới.`}
          onClose={() => setPicDangXoa(null)}
          onConfirm={() => xoaPic(picDangXoa)}
        />
      )}
    </section>
  );
}

interface RedmineConfig { baseUrl: string; coKey: boolean; keyMask: string; }

// Cấu hình Redmine: nhập URL + API key, lưu vào DB local (không nằm trong source code).
// Có nút Test kết nối để xác nhận key gọi được API trước khi dùng lấy data.
function ManHinhCauHinhRedmine() {
  const toast = useToast();
  const [cfg, setCfg] = useState<RedmineConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function tai() {
    try {
      const c = await api<RedmineConfig>('/api/redmine/config');
      setCfg(c);
      setBaseUrl(c.baseUrl);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được cấu hình');
    }
  }
  useEffect(() => { void tai(); }, []);

  async function luu() {
    if (!baseUrl.trim()) { setError('URL Redmine là bắt buộc'); return; }
    setBusy(true);
    setError('');
    try {
      const c = await api<RedmineConfig>('/api/redmine/config', {
        method: 'PUT',
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined })
      });
      setCfg(c);
      setBaseUrl(c.baseUrl);
      setApiKey('');
      toast('Đã lưu cấu hình Redmine');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ ten?: string; login?: string; userId?: number }>('/api/redmine/test', { method: 'POST' });
      toast(`Kết nối OK — ${r.ten || r.login} (id ${r.userId})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test kết nối thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function xoaKey() {
    setBusy(true);
    setError('');
    try {
      await api('/api/redmine/config/key', { method: 'DELETE' });
      await tai();
      toast('Đã xóa API key');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xóa thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="rounded-md border bg-amber-50 p-3 text-xs text-amber-800">
        API key chỉ lưu trong DB cục bộ trên máy này, <strong>không</strong> nằm trong source code.
        Key có quyền đúng bằng tài khoản của bạn (xem ticket trong các project bạn là thành viên).
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-600">URL Redmine</span>
        <input
          className="rounded-md border px-3 py-2 text-sm"
          placeholder="redmine.famishare.jp"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-600">API key</span>
        <input
          type="password"
          className="rounded-md border px-3 py-2 text-sm"
          placeholder={cfg?.coKey ? `Đang lưu: ${cfg.keyMask} — để trống nếu không đổi` : 'Dán API key Redmine vào đây'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />
        {cfg?.coKey && (
          <span className="text-xs text-slate-500">
            Đã có key ({cfg.keyMask}). Để trống ô trên khi lưu nếu chỉ muốn đổi URL.
          </span>
        )}
      </label>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          onClick={luu}
          disabled={busy}
        >
          Lưu
        </button>
        <button
          type="button"
          className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          onClick={test}
          disabled={busy || !cfg?.coKey}
        >
          Test kết nối
        </button>
        {cfg?.coKey && (
          <button
            type="button"
            className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            onClick={xoaKey}
            disabled={busy}
          >
            Xóa key
          </button>
        )}
      </div>
    </div>
  );
}

// Tab "Settings": 4 mục con — PIC (người phụ trách), Chứng chỉ (category đề luyện),
// Redmine (cấu hình URL/API key) và Phím tắt. Chọn mục con để hiện nội dung tương ứng.
export function ManHinhQuanLyDanhMuc() {
  const [muc, setMuc] = useState<'pic' | 'category' | 'redmine' | 'phim_tat'>('pic');
  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-teal-600 text-white' : 'border bg-white text-slate-600 hover:bg-slate-50'}`;
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-2">
        <button type="button" className={tabClass(muc === 'pic')} onClick={() => setMuc('pic')}>PIC</button>
        <button type="button" className={tabClass(muc === 'category')} onClick={() => setMuc('category')}>Chứng chỉ</button>
        <button type="button" className={tabClass(muc === 'redmine')} onClick={() => setMuc('redmine')}>Redmine</button>
        <button type="button" className={tabClass(muc === 'phim_tat')} onClick={() => setMuc('phim_tat')}>Phím tắt</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {muc === 'pic' && <ManHinhQuanLyPic />}
        {muc === 'category' && <ManHinhQuanLyCategory />}
        {muc === 'redmine' && <ManHinhCauHinhRedmine />}
        {muc === 'phim_tat' && <ShortcutSettingsScreen />}
      </div>
    </section>
  );
}
