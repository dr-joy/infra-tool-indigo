import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context';
import { PopupXacNhanXoa } from '../components/dialogs';

// Tách khỏi src/main.tsx (kế hoạch Council run 022dd1e5, xem docs/exchanges/2026-09-12.md) — nội
// dung giữ nguyên văn. File RIÊNG (không định nghĩa trong src/luyen-de.tsx) vì luyen-de.tsx được
// React.lazy() từ shell: nếu settings.tsx import thẳng từ đó, mở tab Cài đặt sẽ vô tình tải và
// khởi tạo cả module Luyện đề. Category (nhóm/nhà cung cấp chứng chỉ) là pick-list thuộc nghiệp vụ
// Luyện đề (bảng de_thi_category, dùng làm nhom cho de_thi_ky_thi), nên đặt ở screens/ theo miền đó,
// chỉ được settings.tsx import về để mount trong vỏ Cài đặt.
export interface CategoryItem { id: string; name: string; sortOrder: number; soChungChi?: number; }

// Quản lý Category đề luyện (nhóm/nhà cung cấp chứng chỉ) — thêm/đổi tên/xóa/sắp xếp.
// Đổi tên lan sang mọi chứng chỉ đang gắn nhóm cũ; xóa chỉ bỏ khỏi danh sách chọn.
export function ManHinhQuanLyCategory() {
  const toast = useToast();
  const [items, setItems] = useState<CategoryItem[]>([]);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [dangXoa, setDangXoa] = useState<CategoryItem | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function loiThanThien(e: unknown): string {
    return e instanceof Error ? e.message : 'Có lỗi xảy ra';
  }

  async function taiDanhSach() {
    try {
      setItems(await api<CategoryItem[]>('/api/de-thi/category'));
      setError('');
    } catch (e) {
      setError(loiThanThien(e));
    }
  }
  useEffect(() => { void taiDanhSach(); }, []);

  async function themCategory() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/de-thi/category', { method: 'POST', body: JSON.stringify({ name }) });
      setNewName('');
      await taiDanhSach();
      toast('Đã thêm category');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  async function luuTen(item: CategoryItem) {
    const name = editName.trim();
    if (!name || name === item.name) { setEditingId(null); return; }
    setBusy(true);
    setError('');
    try {
      await api(`/api/de-thi/category/${item.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      setEditingId(null);
      await taiDanhSach();
      toast('Đã đổi tên category');
    } catch (e) {
      setError(loiThanThien(e));
    } finally {
      setBusy(false);
    }
  }

  async function xoaCategory(item: CategoryItem) {
    try {
      await api(`/api/de-thi/category/${item.id}`, { method: 'DELETE' });
      setDangXoa(null);
      await taiDanhSach();
      toast('Đã xóa category');
    } catch (e) {
      setDangXoa(null);
      setError(loiThanThien(e));
    }
  }

  async function diChuyen(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    try {
      await api('/api/de-thi/category/reorder', { method: 'PATCH', body: JSON.stringify({ ids: next.map((c) => c.id) }) });
    } catch (e) {
      setError(loiThanThien(e));
      await taiDanhSach();
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="rounded-lg border bg-white p-4">
        <h2 className="text-lg font-bold">Category đề luyện</h2>
      </div>

      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="max-w-xl rounded-lg border bg-white p-4">
        <div className="mb-3 flex gap-2">
          <input
            className="flex-1 rounded border px-3 py-1.5 text-sm"
            placeholder="Tên category mới…"
            value={newName}
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              void themCategory();
            }}
          />
          <button
            type="button"
            className="flex items-center gap-1 rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            disabled={busy || !newName.trim()}
            onClick={themCategory}
          >
            <Plus size={16} /> Thêm
          </button>
        </div>

        {items.length === 0 && <div className="py-4 text-center text-sm text-slate-400">Chưa có category nào.</div>}
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
                {(item.soChungChi ?? 0) > 0 && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{item.soChungChi} chứng chỉ</span>
                )}
                <button type="button" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Đổi tên" onClick={() => { setEditingId(item.id); setEditName(item.name); }}>
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                  title={(item.soChungChi ?? 0) > 0 ? 'Không thể xóa: còn chứng chỉ đang dùng category này' : 'Xóa khỏi danh sách'}
                  disabled={(item.soChungChi ?? 0) > 0}
                  onClick={() => setDangXoa(item)}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {dangXoa && (
        <PopupXacNhanXoa
          title="Xóa category"
          message={`Xóa "${dangXoa.name}" khỏi danh sách category? Chứng chỉ đang gắn nhóm này vẫn giữ nguyên, chỉ không chọn được nữa khi đăng ký mới.`}
          onClose={() => setDangXoa(null)}
          onConfirm={() => xoaCategory(dangXoa)}
        />
      )}
    </section>
  );
}
