import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, Play, Trash2, ChevronLeft, ChevronRight,
  Check, X, ListChecks, Clock, FileText, Loader2, ArrowLeft,
  GraduationCap, FolderPlus, Download
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Module luyện đề thi: gom bộ đề về một chỗ, làm bài MCQ song ngữ Anh→Việt,
// chấm điểm, lưu lịch sử. Tự chứa (api helper + parser riêng) để không phụ thuộc
// nội bộ main.tsx — dễ tách/bảo trì khi file chính đã rất lớn.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from './api';

// ── Kiểu dữ liệu ─────────────────────────────────────────────────────────────
type LoaiCauHoi = 'single' | 'multi';

interface KyThi {
  id: number;
  nhom: string;
  ten: string;
  ghiChu: string;
  examSoCau: number | null;
  examThoiGianPhut: number | null;
  soBo: number;
  createdAt: string;
}

interface BoDeTomTat {
  id: number;
  kyThiId: number | null;
  ten: string;
  nguon: string;
  ghiChu: string;
  passPercent: number | null;
  durationSeconds: number | null;
  soCau: number;
  createdAt: string;
}

interface DapAn {
  id: number;
  noiDungEn: string;
  noiDungVi: string;
  laDapAnDung: boolean;
}

interface CauHoi {
  id: number;
  loai: LoaiCauHoi;
  noiDungEn: string;
  noiDungVi: string;
  giaiThichEn: string;
  giaiThichVi: string;
  chuDe: string;
  doKho: string;
  dichThuCong: boolean;
  dapAn: DapAn[];
}

interface BoDeChiTiet {
  id: number;
  ten: string;
  nguon: string;
  ghiChu: string;
  passPercent: number | null;
  durationSeconds: number | null;
  cauHoi: CauHoi[];
}

interface PhienLichSu {
  id: number;
  boId: number | null;
  boTen: string | null;
  cheDo: string;
  soCau: number;
  soDung: number;
  thoiGianGiay: number;
  createdAt: string;
}

// Cấu trúc import gửi lên server (khớp DeThiImportBody)
interface ImportBody {
  kyThiId?: number | null;
  ten: string;
  nguon: string;
  passPercent: number | null;
  durationSeconds: number | null;
  cauHoi: {
    loai: LoaiCauHoi;
    noiDungEn: string;
    giaiThichEn: string;
    dapAn: { noiDungEn: string; laDapAnDung: boolean }[];
  }[];
}

// ── Tiện ích ─────────────────────────────────────────────────────────────────
function decodeEntities(input: string): string {
  if (!input) return '';
  if (typeof document !== 'undefined') {
    const el = document.createElement('textarea');
    el.innerHTML = input;
    return el.value;
  }
  return input
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

// Bỏ thẻ HTML, giữ lại text (đề gốc đôi khi có <p>/<code>). Đủ dùng cho MCQ.
function stripHtml(input: string): string {
  if (!input) return '';
  const noTags = input.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '');
  return decodeEntities(noTags).replace(/\n{3,}/g, '\n\n').trim();
}

function fmtTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function suaMojibake(s: string): string {
  if (!/[ÂÃ][-¿]/.test(s)) return s; // dau hieu ma hoa kep
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) return s; // đã là UTF-8 đúng
  try {
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return s; // không giải mã được -> giữ nguyên cho an toàn
  }
}

// Bóc `quizData` nhúng trong file HTML xuất từ nguồn đề.
interface QuizDataRaw {
  quiz_title?: string;
  pass_percent?: number;
  duration?: number;
  questions?: {
    assessment_type?: string;
    prompt?: { question?: string; answers?: string[]; explanation?: string };
    correct_response?: string[];
  }[];
}

function parseQuizDataFromHtml(html: string): ImportBody | null {
  // Tìm "quizData = { ... };" rồi cắt đúng object bằng cách đếm ngoặc.
  const marker = html.indexOf('quizData');
  if (marker < 0) return null;
  const eq = html.indexOf('=', marker);
  const start = html.indexOf('{', eq);
  if (start < 0) return null;
  let depth = 0, end = -1, inStr = false, strCh = '', esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === strCh) inStr = false;
    } else if (c === '"' || c === "'") { inStr = true; strCh = c; }
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;

  let raw: QuizDataRaw;
  try { raw = JSON.parse(html.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) return null;

  const cauHoi: ImportBody['cauHoi'] = [];
  for (const q of raw.questions) {
    const answers = q.prompt?.answers || [];
    if (answers.length < 2) continue;
    const correct = new Set((q.correct_response || []).map((l) => String(l).toLowerCase()));
    const loai: LoaiCauHoi = q.assessment_type === 'multi-select' || correct.size > 1 ? 'multi' : 'single';
    cauHoi.push({
      loai,
      noiDungEn: stripHtml(q.prompt?.question || ''),
      giaiThichEn: stripHtml(q.prompt?.explanation || ''),
      dapAn: answers.map((ans, i) => ({
        noiDungEn: stripHtml(ans),
        laDapAnDung: correct.has(String.fromCharCode(97 + i))
      }))
    });
  }
  if (cauHoi.length === 0) return null;

  return {
    ten: decodeEntities(raw.quiz_title || 'Bộ đề mới').trim(),
    nguon: 'HTML import',
    passPercent: typeof raw.pass_percent === 'number' ? raw.pass_percent : null,
    durationSeconds: typeof raw.duration === 'number' ? raw.duration : null,
    cauHoi
  };
}

// JSON bộ đề tiếng Việt (đã dịch sẵn ngoài tool): { pass_percent, questions: [{ question, answers[], correct_response[], explanation }] }.
// correct_response là các chữ cái a/b/c... ánh xạ theo vị trí đáp án. Nội dung tiếng Việt lưu vào trường "En" (nội dung chính hiển thị).
interface QuizVietRaw {
  source_file?: string;
  quiz_title?: string;
  quiz_title_vi?: string;
  set?: string;
  pass_percent?: number;
  duration?: number;
  duration_seconds?: number;
  questions?: { assessment_type?: string; question?: string; answers?: string[]; correct_response?: string[]; explanation?: string }[];
}

function parseQuizJsonViet(raw: QuizVietRaw, tenMacDinh: string): ImportBody | null {
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) return null;
  const cauHoi: ImportBody['cauHoi'] = [];
  for (const q of raw.questions) {
    const answers = q.answers || [];
    if (answers.length < 2) continue;
    const correct = new Set((q.correct_response || []).map((l) => String(l).toLowerCase()));
    const loai: LoaiCauHoi = q.assessment_type === 'multi-select' || correct.size > 1 ? 'multi' : 'single';
    cauHoi.push({
      loai,
      noiDungEn: stripHtml(q.question || ''),
      giaiThichEn: stripHtml(q.explanation || ''),
      dapAn: answers.map((ans, i) => ({
        noiDungEn: stripHtml(ans),
        laDapAnDung: correct.has(String.fromCharCode(97 + i))
      }))
    });
  }
  if (cauHoi.length === 0) return null;
  const ten = (raw.quiz_title_vi || raw.quiz_title || (raw.source_file || '').replace(/\.[^.]+$/, '')).trim() || tenMacDinh;
  return {
    ten,
    nguon: 'JSON import',
    passPercent: typeof raw.pass_percent === 'number' ? raw.pass_percent : null,
    durationSeconds: typeof raw.duration_seconds === 'number' ? raw.duration_seconds
      : typeof raw.duration === 'number' ? raw.duration : null,
    cauHoi
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Component chính
// ═══════════════════════════════════════════════════════════════════════════════
type Khung = 'ky_thi' | 'bo_list' | 'import' | 'quiz' | 'lich_su' | 'ngan_hang';

// Nguồn của phiên đang làm — để "Làm lại" tái tạo đúng pool.
// 'bo'/'tong_hop' rút lại từ server (công bằng); 'co_dinh' lặp lại đúng tập câu đã có (ôn câu sai).
type NguonLam =
  | { kind: 'bo'; boId: number; soCau: number | 'all'; tron: boolean }
  | { kind: 'tong_hop'; kyThiId: number; soCau: number | 'all'; tron: boolean }
  | { kind: 'co_dinh'; ten: string; cauHoi: CauHoi[]; passPercent: number | null; durationSeconds: number | null };

interface RutCauResp {
  ten: string;
  nhom: string;
  passPercent: number | null;
  durationSeconds: number | null;
  soCauNguon: number;
  cauHoi: CauHoi[];
}

export function ManHinhLuyenDe() {
  const [khung, setKhung] = useState<Khung>('ky_thi');
  const [kyThiChon, setKyThiChon] = useState<KyThi | null>(null);
  const [boDangLam, setBoDangLam] = useState<BoDeChiTiet | null>(null);
  const [cheDoLam, setCheDoLam] = useState<'review' | 'exam'>('review');
  const [cauHoiLam, setCauHoiLam] = useState<CauHoi[]>([]);
  const [nguonLam, setNguonLam] = useState<NguonLam | null>(null);

  // Rút câu từ server theo kiểu công bằng (lan_ra ASC) rồi vào làm bài.
  // overrideDurationSeconds: ép thời lượng thi (vd theo cấu hình chuẩn của chứng chỉ).
  const batDauRut = useCallback(async (
    nguon: { boId: number } | { kyThiId: number },
    cheDo: 'review' | 'exam',
    soCau: number | 'all',
    tron: boolean,
    overrideDurationSeconds?: number | null
  ) => {
    try {
      const data = await api<RutCauResp>('/api/de-thi/rut-cau', { method: 'POST', body: JSON.stringify({ ...nguon, soCau }) });
      if (data.cauHoi.length === 0) { alert('Chưa có câu hỏi nào để luyện.'); return; }
      // Server đã rút đúng số câu (công bằng); FE chỉ trộn thứ tự hiển thị nếu cần.
      const ds = tron ? shuffle(data.cauHoi) : data.cauHoi;
      setBoDangLam({
        id: 'boId' in nguon ? nguon.boId : 0, // pool tổng hợp -> id 0 -> lưu phiên boId null
        ten: data.ten, nguon: '', ghiChu: '',
        passPercent: data.passPercent,
        durationSeconds: overrideDurationSeconds != null ? overrideDurationSeconds : data.durationSeconds,
        cauHoi: ds
      });
      setCauHoiLam(ds);
      setCheDoLam(cheDo);
      setNguonLam('boId' in nguon
        ? { kind: 'bo', boId: nguon.boId, soCau, tron }
        : { kind: 'tong_hop', kyThiId: nguon.kyThiId, soCau, tron });
      setKhung('quiz');
    } catch (e) {
      alert(`Không mở được bài luyện: ${(e as Error).message}`);
    }
  }, []);

  const batDauLam = useCallback((boId: number, cheDo: 'review' | 'exam', soCau: number | 'all', tron: boolean) =>
    batDauRut({ boId }, cheDo, soCau, tron), [batDauRut]);
  // Thi thử tổng hợp: nếu chứng chỉ có cấu hình thời gian chuẩn -> ép đếm ngược đúng số phút đó.
  const batDauTongHop = useCallback((kyThiId: number, cheDo: 'review' | 'exam', soCau: number | 'all', tron: boolean) => {
    const override = cheDo === 'exam' && kyThiChon?.examThoiGianPhut ? kyThiChon.examThoiGianPhut * 60 : undefined;
    return batDauRut({ kyThiId }, cheDo, soCau, tron, override);
  }, [batDauRut, kyThiChon]);

  // Ôn câu sai: làm lại đúng tập câu chưa đúng của phiên vừa rồi, ở chế độ Luyện tập (xem giải thích).
  const luyenCauSai = useCallback((cauHoiSai: CauHoi[]) => {
    if (cauHoiSai.length === 0) return;
    const ten = `Ôn câu sai · ${boDangLam?.ten ?? ''}`;
    const passPercent = boDangLam?.passPercent ?? null;
    const ds = shuffle(cauHoiSai);
    setBoDangLam({ id: 0, ten, nguon: '', ghiChu: '', passPercent, durationSeconds: null, cauHoi: ds });
    setCauHoiLam(ds);
    setCheDoLam('review');
    setNguonLam({ kind: 'co_dinh', ten, cauHoi: cauHoiSai, passPercent, durationSeconds: null });
    setKhung('quiz');
  }, [boDangLam]);

  const lamLai = useCallback(() => {
    if (!nguonLam) return;
    if (nguonLam.kind === 'bo') batDauLam(nguonLam.boId, cheDoLam, nguonLam.soCau, nguonLam.tron);
    else if (nguonLam.kind === 'tong_hop') batDauTongHop(nguonLam.kyThiId, cheDoLam, nguonLam.soCau, nguonLam.tron);
    else {
      const ds = shuffle(nguonLam.cauHoi);
      setBoDangLam({ id: 0, ten: nguonLam.ten, nguon: '', ghiChu: '', passPercent: nguonLam.passPercent, durationSeconds: nguonLam.durationSeconds, cauHoi: ds });
      setCauHoiLam(ds);
      setKhung('quiz');
    }
  }, [nguonLam, cheDoLam, batDauLam, batDauTongHop]);

  return (
    <section className="ld-root">
      {khung === 'ky_thi' && (
        <KyThiList
          onChon={(k) => { setKyThiChon(k); setKhung('bo_list'); }}
          onLichSu={() => setKhung('lich_su')}
        />
      )}
      {khung === 'bo_list' && kyThiChon && (
        <BoDeList
          kyThi={kyThiChon}
          onBack={() => setKhung('ky_thi')}
          onImport={() => setKhung('import')}
          onXemNganHang={() => setKhung('ngan_hang')}
          onBatDauTongHop={batDauTongHop}
        />
      )}
      {khung === 'ngan_hang' && kyThiChon && (
        <NganHangCauHoi kyThi={kyThiChon} onBack={() => setKhung('bo_list')} />
      )}
      {khung === 'import' && (
        <ImportPanel
          kyThi={kyThiChon}
          onXong={() => setKhung('bo_list')}
          onHuy={() => setKhung('bo_list')}
        />
      )}
      {khung === 'lich_su' && (
        <LichSuPanel onQuayLai={() => setKhung('ky_thi')} />
      )}
      {khung === 'quiz' && boDangLam && (
        <QuizRunner
          bo={boDangLam}
          cauHoi={cauHoiLam}
          cheDo={cheDoLam}
          onThoat={() => setKhung('bo_list')}
          onLamLai={lamLai}
          onLuyenCauSai={luyenCauSai}
        />
      )}
    </section>
  );
}

// ── Màn danh sách chứng chỉ (group theo nhà cung cấp) ─────────────────────────
function KyThiList({ onChon, onLichSu }: { onChon: (k: KyThi) => void; onLichSu: () => void }) {
  const [rows, setRows] = useState<KyThi[]>([]);
  const [dangTai, setDangTai] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [moDangKy, setMoDangKy] = useState(false);

  const tai = useCallback(async () => {
    setDangTai(true);
    setLoi(null);
    try { setRows(await api<KyThi[]>('/api/de-thi/ky-thi')); }
    catch (e) { setLoi((e as Error).message); }
    finally { setDangTai(false); }
  }, []);
  useEffect(() => { tai(); }, [tai]);

  async function xoa(k: KyThi) {
    if (!confirm(`Xóa chứng chỉ "${k.ten}" cùng toàn bộ ${k.soBo} bộ đề bên trong?`)) return;
    await api(`/api/de-thi/ky-thi/${k.id}`, { method: 'DELETE' });
    tai();
  }

  // Gom theo nhóm để hiển thị AWS / Scrum / ...
  const theoNhom = useMemo(() => {
    const map = new Map<string, KyThi[]>();
    for (const k of rows) {
      const key = k.nhom || 'Khác';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(k);
    }
    return Array.from(map.entries());
  }, [rows]);

  return (
    <div className="ld-list">
      <div className="ld-list-header">
        <div>
          <h2 className="ld-title">Certificates</h2>
        </div>
        <div className="ld-list-actions">
          <button className="ld-btn ld-btn-ghost" onClick={onLichSu}><Clock size={16} /> Lịch sử</button>
          <button className="ld-btn ld-btn-primary" onClick={() => setMoDangKy(true)}><FolderPlus size={16} /> Đăng ký chứng chỉ</button>
        </div>
      </div>

      {loi && <div className="ld-banner ld-banner-error">{loi}</div>}
      {dangTai && rows.length === 0 && <div className="ld-empty"><Loader2 className="ld-spin" size={20} /> Đang tải…</div>}

      {theoNhom.map(([nhom, list]) => (
        <div key={nhom} className="ld-cat-panel">
          <div className="ld-cat-head">
            <span>{nhom}</span>
            <span className="ld-cat-count">{list.length} chứng chỉ</span>
          </div>
          <div className="ld-cards ld-cat-cards">
            {list.map((k) => (
              <div key={k.id} className="ld-card ld-card-cert" onClick={() => onChon(k)}>
                <div className="ld-card-body">
                  <div className="ld-card-title"><GraduationCap size={16} /> {k.ten}</div>
                  <div className="ld-card-meta"><span><FileText size={14} /> {k.soBo} bộ đề</span></div>
                </div>
                <div className="ld-card-foot">
                  <button className="ld-btn ld-btn-ghost ld-btn-sm ld-btn-danger" onClick={(e) => { e.stopPropagation(); xoa(k); }} title="Xóa chứng chỉ">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {moDangKy && (
        <DangKyKyThi onHuy={() => setMoDangKy(false)} onXong={() => { setMoDangKy(false); tai(); }} />
      )}
    </div>
  );
}

// ── Modal đăng ký chứng chỉ ───────────────────────────────────────────────────
interface CategoryItem { id: number; name: string; sortOrder: number; }

function DangKyKyThi({ onHuy, onXong }: { onHuy: () => void; onXong: () => void }) {
  const [nhom, setNhom] = useState('');
  const [ten, setTen] = useState('');
  const [examSoCau, setExamSoCau] = useState('');
  const [examPhut, setExamPhut] = useState('');
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [dangLuu, setDangLuu] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  // Category quản lý ở tab "Quản lý danh mục"; ở đây chỉ chọn từ danh sách đó.
  useEffect(() => {
    api<CategoryItem[]>('/api/de-thi/category').then(setCategories).catch(() => {});
  }, []);

  const hopLe = nhom.trim() !== '' && ten.trim() !== '' && Number(examSoCau) > 0 && Number(examPhut) > 0;

  async function luu() {
    if (!nhom.trim()) { setLoi('Chọn nhóm / nhà cung cấp'); return; }
    if (!ten.trim()) { setLoi('Nhập tên chứng chỉ'); return; }
    if (!(Number(examSoCau) > 0)) { setLoi('Nhập số câu thi thật'); return; }
    if (!(Number(examPhut) > 0)) { setLoi('Nhập thời gian thi thật'); return; }
    setDangLuu(true);
    setLoi(null);
    try {
      await api('/api/de-thi/ky-thi', {
        method: 'POST',
        body: JSON.stringify({
          nhom: nhom.trim(),
          ten: ten.trim(),
          examSoCau: Number(examSoCau),
          examThoiGianPhut: Number(examPhut)
        })
      });
      onXong();
    } catch (e) { setLoi((e as Error).message); setDangLuu(false); }
  }

  return (
    <div className="ld-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onHuy(); }}>
      <div className="ld-modal" role="dialog" aria-modal="true">
        <div className="ld-modal-title">Đăng ký chứng chỉ</div>
        <div className="ld-form-row">
          <label>Nhóm / nhà cung cấp</label>
          <select value={nhom} onChange={(e) => setNhom(e.target.value)}>
            <option value="">— Chọn nhóm —</option>
            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div className="ld-form-row">
          <label>Tên chứng chỉ</label>
          <input value={ten} onChange={(e) => setTen(e.target.value)} autoFocus />
        </div>
        <div className="ld-form-grid">
          <div className="ld-form-row">
            <label>Thi thử — số câu</label>
            <input type="number" min={1} value={examSoCau} onChange={(e) => setExamSoCau(e.target.value)} />
          </div>
          <div className="ld-form-row">
            <label>Thi thử — thời gian (phút)</label>
            <input type="number" min={1} value={examPhut} onChange={(e) => setExamPhut(e.target.value)} />
          </div>
        </div>
        {loi && <div className="ld-banner ld-banner-error">{loi}</div>}
        <div className="ld-modal-actions">
          <button className="ld-btn ld-btn-ghost" onClick={onHuy}>Hủy</button>
          <button className="ld-btn ld-btn-primary" onClick={luu} disabled={dangLuu || !hopLe}>
            {dangLuu ? <Loader2 size={16} className="ld-spin" /> : <Check size={16} />} Lưu
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Màn danh sách bộ đề trong một chứng chỉ ───────────────────────────────────
function BoDeList({ kyThi, onBack, onImport, onXemNganHang, onBatDauTongHop }: {
  kyThi: KyThi;
  onBack: () => void;
  onImport: () => void;
  onXemNganHang: () => void;
  onBatDauTongHop: (kyThiId: number, cheDo: 'review' | 'exam', soCau: number | 'all', tron: boolean) => void;
}) {
  const [boList, setBoList] = useState<BoDeTomTat[]>([]);
  const [dangTai, setDangTai] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [thongBao, setThongBao] = useState<string | null>(null);

  // Toàn bộ chứng chỉ là 1 pool: gộp số câu + thời lượng + pass của mọi bộ đề (không liệt kê từng bộ).
  const tongCau = useMemo(() => boList.reduce((s, b) => s + b.soCau, 0), [boList]);
  const tongThoiLuong = useMemo(() => boList.reduce((s, b) => s + (b.durationSeconds || 0), 0), [boList]);
  const passTongHop = useMemo(() => boList.find((b) => b.passPercent != null)?.passPercent ?? null, [boList]);

  const onReload = useCallback(async () => {
    setDangTai(true);
    setLoi(null);
    try { setBoList(await api<BoDeTomTat[]>(`/api/de-thi/bo?kyThiId=${kyThi.id}`)); }
    catch (e) { setLoi((e as Error).message); }
    finally { setDangTai(false); }
  }, [kyThi.id]);
  useEffect(() => { onReload(); }, [onReload]);

  // Xuất ngân hàng câu hỏi ra file JSON song ngữ (để nhờ AI dịch ngoài tool).
  async function xuatJson() {
    setThongBao(null);
    try {
      const data = await api<unknown>(`/api/de-thi/ky-thi/${kyThi.id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kyThi.nhom ? kyThi.nhom + '-' : ''}${kyThi.ten}.json`.replace(/[\\/:*?"<>|]+/g, '_');
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setThongBao(`Lỗi xuất JSON: ${(e as Error).message}`);
    }
  }

  // Xóa toàn bộ ngân hàng (mọi bộ đề + câu hỏi) của chứng chỉ.
  async function xoaNganHang() {
    if (!confirm(`Xóa TOÀN BỘ ngân hàng của "${kyThi.ten}" (${tongCau} câu)? Không thể hoàn tác.`)) return;
    setThongBao(null);
    try {
      await api(`/api/de-thi/ky-thi/${kyThi.id}/bo`, { method: 'DELETE' });
      setThongBao('Đã xóa toàn bộ ngân hàng câu hỏi.');
      onReload();
    } catch (e) {
      setThongBao(`Lỗi xóa ngân hàng: ${(e as Error).message}`);
    }
  }

  return (
    <div className="ld-list">
      <div className="ld-list-header">
        <div className="ld-crumb">
          <button className="ld-btn ld-btn-ghost ld-btn-sm" onClick={onBack}><ArrowLeft size={15} /> Chứng chỉ</button>
          <h2 className="ld-title">{kyThi.nhom ? `${kyThi.nhom} · ` : ''}{kyThi.ten}</h2>
        </div>
        <div className="ld-list-actions">
          <button className="ld-btn ld-btn-primary" onClick={onImport}><Upload size={16} /> Import bộ đề</button>
          {tongCau > 0 && (
            <>
              <button className="ld-btn ld-btn-primary" onClick={xuatJson} title="Xuất ngân hàng câu hỏi ra file JSON để nhờ AI dịch">
                <Download size={16} /> Export bộ đề
              </button>
              <button className="ld-btn ld-btn-ghost" onClick={onXemNganHang} title="Xem toàn bộ câu hỏi trong ngân hàng">
                <FileText size={16} /> Ngân hàng câu hỏi ({tongCau})
              </button>
              <button className="ld-btn ld-btn-danger-solid" onClick={xoaNganHang} title="Xóa toàn bộ ngân hàng câu hỏi của chứng chỉ này">
                <Trash2 size={16} /> Xóa ngân hàng câu hỏi
              </button>
            </>
          )}
        </div>
      </div>

      {thongBao && <div className="ld-banner">{thongBao}</div>}
      {loi && <div className="ld-banner ld-banner-error">{loi}</div>}

      {dangTai && boList.length === 0 && <div className="ld-empty"><Loader2 className="ld-spin" size={20} /> Đang tải…</div>}

      {tongCau > 0 && (
        <CauHinhLamBai
          inline
          bo={{
            id: -1,
            kyThiId: kyThi.id,
            ten: `${kyThi.ten} (${tongCau} câu)`,
            nguon: '', ghiChu: '',
            passPercent: passTongHop,
            durationSeconds: tongThoiLuong || null,
            soCau: tongCau,
            createdAt: ''
          }}
          examInfo={{ soCau: kyThi.examSoCau, phut: kyThi.examThoiGianPhut }}
          onBatDau={(cheDo, soCau, tron) => onBatDauTongHop(kyThi.id, cheDo, soCau, tron)}
        />
      )}
    </div>
  );
}

// ── Cấu hình trước khi làm (modal hoặc inline) ────────────────────────────────
// examInfo (tùy chọn): cấu hình thi chuẩn của chứng chỉ -> mặc định số câu + thời gian cho mode Thi thử.
// inline = true: hiển thị thẳng trên trang (không overlay/nút Hủy).
function CauHinhLamBai({ bo, examInfo, inline, onHuy, onBatDau }: {
  bo: BoDeTomTat;
  examInfo?: { soCau: number | null; phut: number | null };
  inline?: boolean;
  onHuy?: () => void;
  onBatDau: (cheDo: 'review' | 'exam', soCau: number | 'all', tron: boolean) => void;
}) {
  // Thi thử: số câu cố định theo chứng chỉ (nếu vượt quá pool thì lấy tất cả).
  const examSoCauFix: number | 'all' | null = examInfo?.soCau != null ? (examInfo.soCau < bo.soCau ? examInfo.soCau : 'all') : null;
  // Luyện tập: mặc định 20 câu (hoặc tất cả nếu pool ít hơn 20).
  const defaultLuyen: number | 'all' = bo.soCau > 20 ? 20 : 'all';
  const [cheDo, setCheDo] = useState<'review' | 'exam'>('review');
  const [soCau, setSoCau] = useState<number | 'all'>(defaultLuyen);

  // Thi thử -> khóa cứng số câu theo chứng chỉ. Về Luyện tập -> trả lại mặc định 20.
  function chonCheDo(mode: 'review' | 'exam') {
    setCheDo(mode);
    if (mode === 'exam') { if (examSoCauFix != null) setSoCau(examSoCauFix); }
    else setSoCau(defaultLuyen);
  }

  const mocSoCau = [10, 20, 30, 50, 65, 100, 150, 200].filter((n) => n < bo.soCau);
  // Thi thử dùng cấu hình chuẩn của chứng chỉ -> khóa cứng số câu + thời gian (không cho chỉnh).
  const khoaThiThu = cheDo === 'exam' && examInfo?.phut != null && examSoCauFix != null;

  const noiDung = (
    <>
        <div className="ld-modal-title">{bo.ten}</div>
        <div className="ld-mode-cards">
          <button className={`ld-mode-card ${cheDo === 'review' ? 'active' : ''}`} onClick={() => chonCheDo('review')}>
            <div className="ld-mode-icon practice"><FileText size={22} /></div>
            <div>
              <div className="ld-mode-name">Luyện tập</div>
              <div className="ld-mode-desc">Kiểm tra từng câu và xem đáp án ngay.</div>
            </div>
          </button>
          <button className={`ld-mode-card ${cheDo === 'exam' ? 'active' : ''}`} onClick={() => chonCheDo('exam')}>
            <div className="ld-mode-icon exam"><Clock size={22} /></div>
            <div>
              <div className="ld-mode-name">Thi thử</div>
              <div className="ld-mode-desc">
                {examInfo?.phut
                  ? `Theo chuẩn thi: ${examSoCauFix === 'all' ? bo.soCau : examSoCauFix} câu / ${examInfo.phut} phút (cố định).`
                  : `Làm hết rồi mới chấm${bo.durationSeconds ? `, có đếm giờ ${Math.round(bo.durationSeconds / 60)} phút` : ''}.`}
              </div>
            </div>
          </button>
        </div>

        {khoaThiThu ? (
          <div className="ld-config-row">
            <label>Đề thi</label>
            <span className="ld-config-fixed">{examSoCauFix === 'all' ? `Tất cả (${bo.soCau})` : `${examSoCauFix} câu`} · {examInfo!.phut} phút — cố định theo chứng chỉ</span>
          </div>
        ) : (
          <div className="ld-config-row">
            <label>Số câu</label>
            <select value={String(soCau)} onChange={(e) => setSoCau(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">Tất cả ({bo.soCau})</option>
              {mocSoCau.map((n) => <option key={n} value={n}>{n} câu</option>)}
            </select>
          </div>
        )}

        <div className="ld-modal-actions">
          {!inline && onHuy && <button className="ld-btn ld-btn-ghost" onClick={onHuy}>Hủy</button>}
          <button className="ld-btn ld-btn-primary" onClick={() => onBatDau(cheDo, soCau, true)}><Play size={16} /> Bắt đầu</button>
        </div>
    </>
  );

  if (inline) return <div className="ld-config-inline">{noiDung}</div>;
  return (
    <div className="ld-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onHuy?.(); }}>
      <div className="ld-modal" role="dialog" aria-modal="true">{noiDung}</div>
    </div>
  );
}

// ── Import (kéo-thả nhiều file HTML + JSON, validate từng file) ───────────────
// HTML / JSON(questions) = thêm bộ đề mới; JSON(boDe) = cập nhật bản dịch (đã xuất ra rồi nhờ AI dịch).
type ImportTrangThai = 'valid' | 'invalid' | 'done' | 'failed';
// html / json-de = bộ đề mới (gửi /import) · json = cập nhật bản dịch (gửi /import-json)
type ImportKieu = 'html' | 'json' | 'json-de';
interface FileMuc {
  id: number;
  ten: string;          // tên bộ đề (quiz_title hoặc tên file)
  fileName: string;
  kieu: ImportKieu;
  status: ImportTrangThai;
  data?: ImportBody;    // cho HTML và JSON bộ đề mới (json-de)
  jsonData?: unknown;   // cho JSON cập nhật dịch (gửi nguyên sang /import-json)
  soCau?: number;
  loi?: string;         // lý do không hợp lệ / import lỗi
}

function ImportPanel({ kyThi, onXong, onHuy }: { kyThi: KyThi | null; onXong: () => void; onHuy: () => void }) {
  const [files, setFiles] = useState<FileMuc[]>([]);
  const [dangLuu, setDangLuu] = useState(false);
  const [daImport, setDaImport] = useState(false);
  const [keoVao, setKeoVao] = useState(false);
  const [tenDaImport, setTenDaImport] = useState<Set<string>>(new Set()); // tên file đã import trước đó (lowercase)
  const fileRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const nextId = () => ++idRef.current;

  // Nạp tên các file đã import của chứng chỉ để chặn import trùng tên.
  useEffect(() => {
    if (!kyThi) return;
    api<string[]>(`/api/de-thi/ky-thi/${kyThi.id}/file-names`)
      .then((ns) => setTenDaImport(new Set(ns.map((n) => n.toLowerCase()))))
      .catch(() => {});
  }, [kyThi]);

  // Đọc + validate từng file, gắn vào danh sách (cho phép thêm nhiều lần).
  async function themFiles(danhSach: FileList | File[]) {
    const arr = Array.from(danhSach);
    const moi: FileMuc[] = [];
    // Tên HTML đã dùng = đã import trước đó + đang chờ trong danh sách (chặn cả trùng trong cùng lượt thả).
    const daDung = new Set(tenDaImport);
    files.forEach((f) => { if (f.kieu === 'html' && f.status !== 'failed') daDung.add(f.fileName.toLowerCase()); });
    for (const f of arr) {
      const baseName = f.name.replace(/\.[^.]+$/, '');
      const laHtml = /\.(html?|htm)$/i.test(f.name);
      const laJson = /\.json$/i.test(f.name);
      if (!laHtml && !laJson) {
        moi.push({ id: nextId(), ten: f.name, fileName: f.name, kieu: 'html', status: 'invalid', loi: 'Không phải file HTML hoặc JSON' });
        continue;
      }
      if (laHtml && daDung.has(f.name.toLowerCase())) {
        moi.push({ id: nextId(), ten: f.name, fileName: f.name, kieu: 'html', status: 'invalid', loi: 'Tên file đã được import trước đó' });
        continue;
      }
      try {
        const text = suaMojibake(await f.text()); // tự sửa nếu file bị mã hóa kép (mojibake)
        if (laJson) {
          // JSON 3 dạng: "boDe" -> cập nhật bản dịch (khớp id); "questions" -> 1 bộ đề mới;
          // "sets" -> nhiều bộ đề mới (mỗi set là 1 bộ đề riêng). Tất cả đều đã dịch sẵn.
          let parsed: { boDe?: { cauHoi?: unknown[] }[]; questions?: unknown[]; sets?: unknown[] };
          try { parsed = JSON.parse(text); } catch { moi.push({ id: nextId(), ten: f.name, fileName: f.name, kieu: 'json', status: 'invalid', loi: 'JSON không hợp lệ (không phân tích được)' }); continue; }
          if (parsed && Array.isArray(parsed.sets)) {
            // Mỗi set -> 1 bộ đề mới. fileName gắn tên set để không trùng khi import nhiều set cùng file.
            if (parsed.sets.length === 0) {
              moi.push({ id: nextId(), ten: f.name, fileName: f.name, kieu: 'json-de', status: 'invalid', loi: 'JSON có mảng "sets" rỗng' });
            }
            parsed.sets.forEach((rawSet, si) => {
              const raw = rawSet as QuizVietRaw;
              const tenSet = (raw.set || String(si + 1)).trim();
              const fileSet = `${baseName} - Set ${tenSet}`;
              const body = parseQuizJsonViet(raw, fileSet);
              if (!body) {
                moi.push({ id: nextId(), ten: fileSet, fileName: fileSet, kieu: 'json-de', status: 'invalid', loi: `Set ${tenSet}: không có câu hỏi hợp lệ` });
              } else {
                moi.push({ id: nextId(), ten: body.ten || fileSet, fileName: fileSet, kieu: 'json-de', status: 'valid', data: body, soCau: body.cauHoi.length });
              }
            });
          } else if (parsed && Array.isArray(parsed.boDe)) {
            const soCau = parsed.boDe.reduce((s, b) => s + (Array.isArray(b.cauHoi) ? b.cauHoi.length : 0), 0);
            moi.push({ id: nextId(), ten: baseName, fileName: f.name, kieu: 'json', status: 'valid', jsonData: parsed, soCau });
          } else if (parsed && Array.isArray(parsed.questions)) {
            // Bộ đề mới từ JSON tiếng Việt đã dịch sẵn.
            const body = parseQuizJsonViet(parsed as unknown as QuizVietRaw, baseName);
            if (!body) {
              moi.push({ id: nextId(), ten: f.name, fileName: f.name, kieu: 'json-de', status: 'invalid', loi: 'JSON không có câu hỏi hợp lệ (mỗi câu cần >= 2 đáp án)' });
            } else {
              moi.push({ id: nextId(), ten: body.ten || baseName, fileName: f.name, kieu: 'json-de', status: 'valid', data: body, soCau: body.cauHoi.length });
            }
          } else {
            moi.push({ id: nextId(), ten: f.name, fileName: f.name, kieu: 'json', status: 'invalid', loi: 'JSON không đúng định dạng — cần mảng "boDe" (cập nhật dịch), "questions" hoặc "sets" (bộ đề mới)' });
          }
        } else {
          const parsed = parseQuizDataFromHtml(text);
          if (!parsed) {
            moi.push({ id: nextId(), ten: f.name, fileName: f.name, kieu: 'html', status: 'invalid', loi: 'Không tìm thấy dữ liệu quizData hợp lệ trong file' });
          } else {
            const ten = parsed.ten && parsed.ten !== 'Bộ đề mới' ? parsed.ten : baseName;
            moi.push({ id: nextId(), ten, fileName: f.name, kieu: 'html', status: 'valid', data: { ...parsed, ten }, soCau: parsed.cauHoi.length });
            daDung.add(f.name.toLowerCase()); // chặn file cùng tên xuất hiện sau trong cùng lượt
          }
        }
      } catch {
        moi.push({ id: nextId(), ten: f.name, fileName: f.name, kieu: laJson ? 'json' : 'html', status: 'invalid', loi: 'Không đọc được nội dung file' });
      }
    }
    setDaImport(false);
    setFiles((cur) => [...cur, ...moi]);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setKeoVao(false);
    if (e.dataTransfer.files?.length) void themFiles(e.dataTransfer.files);
  }

  function xoaMuc(id: number) {
    setFiles((cur) => cur.filter((f) => f.id !== id));
  }

  // Import lần lượt các file hợp lệ; file nào lỗi giữ lại + ghi lý do, không chặn các file khác.
  // HTML & JSON(questions) -> /import (bộ đề mới); JSON(boDe) -> /import-json (cập nhật bản dịch theo id).
  async function importTatCa() {
    const hopLe = files.filter((f) => f.status === 'valid');
    if (hopLe.length === 0) return;
    setDangLuu(true);
    let soLoiImport = 0;
    for (const f of hopLe) {
      try {
        if (f.kieu === 'json') {
          const r = await api<{ capNhat: number; boQua: number }>('/api/de-thi/import-json', { method: 'POST', body: JSON.stringify(f.jsonData) });
          setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, status: 'done', loi: `Cập nhật dịch ${r.capNhat} câu${r.boQua ? `, bỏ qua ${r.boQua}` : ''}` } : x)));
        } else {
          await api('/api/de-thi/import', { method: 'POST', body: JSON.stringify({ ...f.data!, kyThiId: kyThi?.id ?? null, fileName: f.fileName }) });
          setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, status: 'done' } : x)));
        }
      } catch (e) {
        soLoiImport++;
        setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, status: 'failed', loi: (e as Error).message } : x)));
      }
    }
    setDangLuu(false);
    setDaImport(true);
    const conFileKhongHopLe = files.some((f) => f.status === 'invalid');
    if (soLoiImport === 0 && !conFileKhongHopLe) onXong();
  }

  const soHopLe = files.filter((f) => f.status === 'valid').length;
  const soLoi = files.filter((f) => f.status === 'invalid' || f.status === 'failed').length;
  const soXong = files.filter((f) => f.status === 'done').length;

  const icon = (s: ImportTrangThai) => {
    if (s === 'valid' || s === 'done') return <Check size={16} className="ld-ok" />;
    if (s === 'failed' || s === 'invalid') return <X size={16} className="ld-err" />;
    return null;
  };
  const nhan = (f: FileMuc) => {
    if (f.status === 'valid') return f.kieu === 'json' ? 'JSON dịch' : 'Bộ đề mới';
    if (f.status === 'done') return f.kieu === 'json' ? 'Đã cập nhật' : 'Đã import';
    if (f.status === 'failed') return 'Lỗi';
    return 'Không hợp lệ';
  };

  return (
    <div className="ld-import">
      <div className="ld-list-header">
        <button className="ld-btn ld-btn-ghost" onClick={onHuy}><ArrowLeft size={16} /> Quay lại</button>
        <h2 className="ld-title">Import bộ đề · {kyThi ? `${kyThi.nhom ? kyThi.nhom + ' · ' : ''}${kyThi.ten}` : '(chưa chọn)'}</h2>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".html,.htm,.json,text/html,application/json"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files?.length) void themFiles(e.target.files); e.target.value = ''; }}
      />

      <div
        className={`ld-dropzone ${keoVao ? 'drag' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setKeoVao(true); }}
        onDragLeave={(e) => { e.preventDefault(); setKeoVao(false); }}
        onDrop={onDrop}
      >
        <Upload size={28} className="ld-dropzone-icon" />
        <div className="ld-dropzone-text">
          <strong>Kéo &amp; thả file vào đây</strong> hoặc bấm để chọn (nhiều file)
          <div className="ld-dropzone-note">HTML / JSON (questions, sets) = bộ đề mới · JSON (boDe) = cập nhật bản dịch</div>
        </div>
      </div>

      {files.length > 0 && (
        <div className="ld-file-summary">
          <span className="ld-ok">{soHopLe} hợp lệ</span>
          {soXong > 0 && <span className="ld-ok">· {soXong} đã import</span>}
          {soLoi > 0 && <span className="ld-err">· {soLoi} lỗi</span>}
        </div>
      )}

      {files.length > 0 && (
        <ul className="ld-file-list">
          {files.map((f) => (
            <li key={f.id} className={`ld-file-item status-${f.status}`}>
              <span className="ld-file-ico">{icon(f.status)}</span>
              <span className="ld-file-main">
                <span className="ld-file-name">{f.ten}</span>
                <span className="ld-file-sub">
                  {f.fileName}
                  {f.status === 'valid' || f.status === 'done' ? ` · ${f.soCau} câu` : ''}
                  {f.loi ? ` · ${f.loi}` : ''}
                </span>
              </span>
              <span className={`ld-file-tag tag-${f.status}`}>{nhan(f)}</span>
              {f.status !== 'done' && (
                <button className="ld-file-del" title="Bỏ khỏi danh sách" onClick={() => xoaMuc(f.id)} disabled={dangLuu}>
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {daImport && (
        <div className={`ld-banner ${soLoi > 0 ? 'ld-banner-error' : ''}`}>
          Đã xử lý {soXong} file thành công{soLoi > 0 ? `, ${soLoi} file không thành công (xem lý do ở danh sách).` : '.'}
        </div>
      )}

      <div className="ld-import-footer">
        <button className="ld-btn ld-btn-ghost" onClick={onXong}>{soXong > 0 ? 'Xong' : 'Đóng'}</button>
        <button className="ld-btn ld-btn-primary" onClick={importTatCa} disabled={dangLuu || soHopLe === 0}>
          {dangLuu ? <Loader2 size={16} className="ld-spin" /> : <Upload size={16} />} Import {soHopLe > 0 ? `${soHopLe} file` : ''}
        </button>
      </div>
    </div>
  );
}

// ── Ngân hàng câu hỏi: liệt kê toàn bộ câu hỏi của chứng chỉ (chỉ nội dung câu hỏi) ──
interface CauHoiNganHang { id: number; noiDungEn: string; noiDungVi: string; }

function NganHangCauHoi({ kyThi, onBack }: { kyThi: KyThi; onBack: () => void }) {
  const [rows, setRows] = useState<CauHoiNganHang[]>([]);
  const [dangTai, setDangTai] = useState(true);
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    setDangTai(true);
    api<CauHoiNganHang[]>(`/api/de-thi/ky-thi/${kyThi.id}/cau-hoi`)
      .then(setRows)
      .catch((e) => setLoi((e as Error).message))
      .finally(() => setDangTai(false));
  }, [kyThi.id]);

  return (
    <div className="ld-list">
      <div className="ld-list-header">
        <div className="ld-crumb">
          <button className="ld-btn ld-btn-ghost ld-btn-sm" onClick={onBack}><ArrowLeft size={15} /> Bộ đề</button>
          <h2 className="ld-title">Ngân hàng câu hỏi · {kyThi.nhom ? `${kyThi.nhom} · ` : ''}{kyThi.ten}</h2>
        </div>
      </div>

      <div className="ld-dich-status"><span>Tổng số câu hỏi: <strong>{rows.length}</strong></span></div>
      {loi && <div className="ld-banner ld-banner-error">{loi}</div>}

      {dangTai ? (
        <div className="ld-empty"><Loader2 className="ld-spin" size={20} /> Đang tải…</div>
      ) : rows.length === 0 ? (
        <div className="ld-empty"><p>Chưa có câu hỏi nào trong ngân hàng.</p></div>
      ) : (
        <ol className="ld-nh-list">
          {rows.map((c, i) => (
            <li key={c.id} className="ld-nh-item">
              <span className="ld-nh-num">{i + 1}</span>
              <span className="ld-nh-text">{c.noiDungVi || c.noiDungEn}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Lịch sử phiên làm bài ─────────────────────────────────────────────────────
function LichSuPanel({ onQuayLai }: { onQuayLai: () => void }) {
  const [rows, setRows] = useState<PhienLichSu[]>([]);
  const [dangTai, setDangTai] = useState(true);
  useEffect(() => {
    api<PhienLichSu[]>('/api/de-thi/phien').then(setRows).catch(() => {}).finally(() => setDangTai(false));
  }, []);
  return (
    <div className="ld-list">
      <div className="ld-list-header">
        <button className="ld-btn ld-btn-ghost" onClick={onQuayLai}><ArrowLeft size={16} /> Quay lại</button>
        <h2 className="ld-title">Lịch sử làm bài</h2>
      </div>
      {dangTai ? <div className="ld-empty"><Loader2 className="ld-spin" size={20} /> Đang tải…</div> : rows.length === 0 ? (
        <div className="ld-empty"><p>Chưa có phiên làm bài nào.</p></div>
      ) : (
        <table className="ld-table">
          <thead><tr><th>Thời gian</th><th>Bộ đề</th><th>Chế độ</th><th>Điểm</th><th>Thời lượng</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString('vi-VN')}</td>
                <td>{r.boTen || '—'}</td>
                <td>{r.cheDo === 'exam' ? 'Thi thử' : 'Luyện tập'}</td>
                <td>{r.soDung}/{r.soCau} ({r.soCau ? Math.round((r.soDung / r.soCau) * 100) : 0}%)</td>
                <td>{fmtTime(r.thoiGianGiay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Làm bài
// ═══════════════════════════════════════════════════════════════════════════════
function QuizRunner({ bo, cauHoi, cheDo, onThoat, onLamLai, onLuyenCauSai }: {
  bo: BoDeChiTiet;
  cauHoi: CauHoi[];
  cheDo: 'review' | 'exam';
  onThoat: () => void;
  onLamLai: () => void;
  onLuyenCauSai: (cauHoiSai: CauHoi[]) => void;
}) {
  const isExam = cheDo === 'exam';
  const [idx, setIdx] = useState(0);
  const [chon, setChon] = useState<Record<number, number[]>>({});      // cauHoiId -> [dapAnId]
  const [daKiemTra, setDaKiemTra] = useState<Record<number, boolean>>({}); // luyện tập: đã bấm "Kiểm tra"
  const [ketThuc, setKetThuc] = useState(false);
  const [giay, setGiay] = useState(isExam && bo.durationSeconds ? bo.durationSeconds : 0);
  const [reviewSauThi, setReviewSauThi] = useState(false);
  const [xemCauSai, setXemCauSai] = useState(false); // popup liệt kê câu đã làm sai
  const [lyDo, setLyDo] = useState<Record<number, string>>({}); // cauHoiId -> lý do tự luận user nhập
  const daLuu = useRef(false);

  const dem = isExam && !!bo.durationSeconds;
  const cur = cauHoi[idx];

  // Đồng hồ: đếm xuôi khi luyện tập, đếm ngược khi thi có thời lượng.
  useEffect(() => {
    if (ketThuc) return;
    const t = setInterval(() => {
      setGiay((g) => {
        if (dem) {
          if (g <= 1) { clearInterval(t); setKetThuc(true); return 0; }
          return g - 1;
        }
        return g + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [dem, ketThuc]);

  const dungCauHoi = useCallback((q: CauHoi, selected: number[]) => {
    const dungIds = q.dapAn.filter((d) => d.laDapAnDung).map((d) => d.id).sort();
    const sel = [...selected].sort();
    return dungIds.length === sel.length && dungIds.every((v, i) => v === sel[i]);
  }, []);

  const ketQua = useMemo(() => {
    let dung = 0, sai = 0, boTrong = 0;
    for (const q of cauHoi) {
      const sel = chon[q.id] || [];
      if (sel.length === 0) boTrong++;
      else if (dungCauHoi(q, sel)) dung++;
      else sai++;
    }
    return { dung, sai, boTrong, tong: cauHoi.length };
  }, [cauHoi, chon, dungCauHoi]);

  // Lưu phiên 1 lần khi kết thúc.
  useEffect(() => {
    if (!ketThuc || daLuu.current) return;
    daLuu.current = true;
    api('/api/de-thi/phien', {
      method: 'POST',
      body: JSON.stringify({
        boId: bo.id || null, // pool tổng hợp (id = 0) -> không gắn bộ đề cụ thể
        cheDo,
        thoiGianGiay: dem ? (bo.durationSeconds || 0) - giay : giay,
        cauHinh: { soCau: cauHoi.length },
        traLoi: cauHoi.map((q) => ({ cauHoiId: q.id, dapAnChon: chon[q.id] || [], dungSai: dungCauHoi(q, chon[q.id] || []) }))
      })
    }).catch(() => { /* lưu lịch sử lỗi không chặn UI */ });
  }, [ketThuc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Xuất file JSON: câu hỏi + đáp án đã chọn + đáp án đúng + lý do user nhập, để nhờ AI phân tích.
  function xuatPhanTich() {
    const data = {
      boDe: bo.ten,
      cheDo: isExam ? 'Thi thử' : 'Luyện tập',
      ketQua: {
        dung: ketQua.dung,
        sai: ketQua.sai,
        boTrong: ketQua.boTrong,
        tong: ketQua.tong,
        phanTram: ketQua.tong ? Math.round((ketQua.dung / ketQua.tong) * 100) : 0
      },
      cauHoi: cauHoi.map((q, i) => {
        const sel = chon[q.id] || [];
        const trangThai = sel.length === 0 ? 'bo_trong' : dungCauHoi(q, sel) ? 'dung' : 'sai';
        return {
          stt: i + 1,
          noiDung: q.noiDungVi || q.noiDungEn,
          noiDungEn: q.noiDungEn || undefined,
          dapAn: q.dapAn.map((d) => ({
            noiDung: d.noiDungVi || d.noiDungEn,
            dapAnDung: d.laDapAnDung,
            daChon: sel.includes(d.id)
          })),
          ketQua: trangThai,
          lyDoChon: (lyDo[q.id] || '').trim()
        };
      })
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phan-tich-${bo.ten || 'bai-lam'}.json`.replace(/[\\/:*?"<>|]+/g, '_');
    a.click();
    URL.revokeObjectURL(url);
  }

  function togggleChon(qid: number, daId: number, loai: LoaiCauHoi) {
    if (!isExam && daKiemTra[qid]) return; // đã chốt câu này
    setChon((prev) => {
      const cur = prev[qid] || [];
      if (loai === 'single') return { ...prev, [qid]: [daId] };
      return { ...prev, [qid]: cur.includes(daId) ? cur.filter((x) => x !== daId) : [...cur, daId] };
    });
  }

  const reviewMode = ketThuc || reviewSauThi || (!isExam && daKiemTra[cur?.id]);
  const tienDo = Math.round(((idx + 1) / cauHoi.length) * 100);

  // ── Màn xem lại bài: liệt kê TẤT CẢ câu hỏi kèm đáp án đã chọn, đúng/sai và giải thích ──
  if (ketThuc && reviewSauThi) {
    return (
      <div className="ld-result">
        <div className="ld-result-card ld-review-all">
          <div className="ld-review-head">
            <h2 className="ld-title">Xem lại bài · <span className="ld-ok">{ketQua.dung}</span>/{ketQua.tong} đúng</h2>
            <button className="ld-btn ld-btn-ghost" onClick={() => setReviewSauThi(false)}><ArrowLeft size={15} /> Quay lại kết quả</button>
          </div>
          <div className="ld-saiwrong-list">
            {cauHoi.map((q, i) => {
              const sel = chon[q.id] || [];
              const trangThai = sel.length === 0 ? 'bo_trong' : dungCauHoi(q, sel) ? 'dung' : 'sai';
              const nhan = trangThai === 'dung' ? '✓ Đúng' : trangThai === 'sai' ? '✗ Sai' : '• Bỏ trống';
              const cls = trangThai === 'dung' ? 'ld-ok' : trangThai === 'sai' ? 'ld-err' : 'ld-muted';
              return (
                <div key={q.id} className="ld-saiwrong-item">
                  <div className="ld-q-body">
                    <p><strong>Câu {i + 1}.</strong> <span className={cls}>{nhan}</span></p>
                    <p>{q.noiDungEn}</p>
                    {q.noiDungVi && <p className="ld-vi">{q.noiDungVi}</p>}
                  </div>
                  <ul className="ld-options">
                    {q.dapAn.map((d) => {
                      const chosen = sel.includes(d.id);
                      const oc = d.laDapAnDung ? 'show-correct' : chosen ? 'user-wrong' : '';
                      return (
                        <li key={d.id} className={`ld-option locked ${oc}`}>
                          <div className="ld-option-row">
                            <span className="ld-chk">{d.laDapAnDung ? <Check size={14} /> : chosen ? <X size={14} /> : ''}</span>
                            <div className="ld-option-text">
                              <span>{d.noiDungEn}</span>
                              {d.noiDungVi && <span className="ld-vi">{d.noiDungVi}</span>}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {(q.giaiThichEn || q.giaiThichVi) && (
                    <div className="ld-explain">
                      <h4>Giải thích</h4>
                      {q.giaiThichEn && <p>{q.giaiThichEn}</p>}
                      {q.giaiThichVi && <p className="ld-vi">{q.giaiThichVi}</p>}
                    </div>
                  )}
                  {(lyDo[q.id] || '').trim() && (
                    <div className="ld-explain"><h4>Lý do bạn chọn</h4><p>{lyDo[q.id]}</p></div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ld-result-actions">
            <button className="ld-btn ld-btn-ghost" onClick={() => setReviewSauThi(false)}><ArrowLeft size={15} /> Quay lại kết quả</button>
            <button className="ld-btn ld-btn-ghost" onClick={onThoat}>Về danh sách</button>
            <button className="ld-btn ld-btn-outline" onClick={xuatPhanTich} title="Xuất JSON câu trả lời + lý do để nhờ AI phân tích">
              <Download size={16} /> Xuất JSON phân tích
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Màn kết quả ──
  if (ketThuc && !reviewSauThi) {
    const pct = ketQua.tong ? Math.round((ketQua.dung / ketQua.tong) * 100) : 0;
    const dat = bo.passPercent != null ? pct >= bo.passPercent : pct >= 70;
    // Câu đã làm sai = có chọn đáp án nhưng sai (không tính bỏ trống) -> để xem lại trong popup.
    const cauSai = cauHoi.filter((q) => { const sel = chon[q.id] || []; return sel.length > 0 && !dungCauHoi(q, sel); });
    return (
      <div className="ld-result">
        <div className="ld-result-card">
          <div className="ld-score-line">
            <span className="ld-score-big">{pct}%</span>
            <span className="ld-score-detail">đúng ({ketQua.dung}/{ketQua.tong})</span>
          </div>
          <div className={`ld-score-msg ${dat ? 'ld-ok' : 'ld-warn'}`}>
            {dat ? '🎉 Đạt! Làm tốt lắm.' : 'Chưa đạt — luyện thêm nhé!'}
          </div>
          <div className="ld-donut" style={{ ['--pct' as string]: `${pct}` }}>
            <span>{pct}%</span>
          </div>
          <div className="ld-stats-grid">
            <div className="ld-stat"><span className="ld-stat-val ld-ok">{ketQua.dung}</span><span className="ld-stat-lbl">Đúng</span></div>
            <button
              type="button"
              className="ld-stat ld-stat-btn"
              onClick={() => setXemCauSai(true)}
              disabled={ketQua.sai === 0}
              title={ketQua.sai > 0 ? 'Xem các câu đã làm sai' : 'Không có câu nào làm sai'}
            >
              <span className="ld-stat-val ld-err">{ketQua.sai}</span><span className="ld-stat-lbl">Sai</span>
            </button>
            <div className="ld-stat"><span className="ld-stat-val ld-muted">{ketQua.boTrong}</span><span className="ld-stat-lbl">Bỏ trống</span></div>
          </div>
          <div className="ld-result-actions">
            <button className="ld-btn ld-btn-ghost" onClick={onThoat}>Về danh sách</button>
            <button className="ld-btn ld-btn-primary" onClick={() => setReviewSauThi(true)}><ListChecks size={16} /> Xem lại bài</button>
            <button className="ld-btn ld-btn-outline" onClick={xuatPhanTich} title="Xuất JSON câu trả lời + lý do để nhờ AI phân tích">
              <Download size={16} /> Xuất JSON phân tích
            </button>
          </div>
        </div>

        {xemCauSai && (
          <div className="ld-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setXemCauSai(false); }}>
            <div className="ld-modal ld-modal-wide" role="dialog" aria-modal="true">
              <div className="ld-modal-title">Câu đã làm sai ({cauSai.length})</div>
              <div className="ld-saiwrong-list">
                {cauSai.map((q) => (
                  <div key={q.id} className="ld-saiwrong-item">
                    <div className="ld-q-body">
                      <p><strong>Câu {cauHoi.indexOf(q) + 1}.</strong> {q.noiDungEn}</p>
                      {q.noiDungVi && <p className="ld-vi">{q.noiDungVi}</p>}
                    </div>
                    <ul className="ld-options">
                      {q.dapAn.map((da) => {
                        const sel = (chon[q.id] || []).includes(da.id);
                        const cls = da.laDapAnDung ? 'show-correct' : sel ? 'user-wrong' : '';
                        return (
                          <li key={da.id} className={`ld-option locked ${cls}`}>
                            <div className="ld-option-row">
                              <span className="ld-chk">
                                {da.laDapAnDung ? <Check size={14} /> : sel ? <X size={14} /> : ''}
                              </span>
                              <div className="ld-option-text">
                                <span>{da.noiDungEn}</span>
                                {da.noiDungVi && <span className="ld-vi">{da.noiDungVi}</span>}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {(q.giaiThichEn || q.giaiThichVi) && (
                      <div className="ld-explain">
                        <h4>Giải thích</h4>
                        {q.giaiThichEn && <p>{q.giaiThichEn}</p>}
                        {q.giaiThichVi && <p className="ld-vi">{q.giaiThichVi}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="ld-modal-actions">
                <button className="ld-btn ld-btn-primary" onClick={() => setXemCauSai(false)}>Đóng</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!cur) return null;

  return (
    <div className="ld-quiz">
      {/* Sidebar trái: danh sách câu */}
      <aside className="ld-quiz-sidebar">
        <div className="ld-quiz-sidebar-head">Tất cả câu hỏi</div>
        <ul className="ld-quiz-sidebar-list">
          {cauHoi.map((q, i) => {
            const sel = chon[q.id] || [];
            const answered = sel.length > 0;
            let trangThai: '' | 'correct' | 'incorrect' = '';
            if (reviewMode || ketThuc) trangThai = answered ? (dungCauHoi(q, sel) ? 'correct' : 'incorrect') : '';
            return (
              <li key={q.id} className={`ld-qs-item ${i === idx ? 'active' : ''}`} onClick={() => setIdx(i)}>
                <span className="ld-qs-num">Câu {i + 1}</span>
                {trangThai === 'correct' && <Check size={14} className="ld-ok" />}
                {trangThai === 'incorrect' && <X size={14} className="ld-err" />}
                <span className={`ld-qs-dot ${answered ? 'answered' : ''}`} />
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Nội dung chính */}
      <div className="ld-quiz-main">
        <div className="ld-quiz-topbar">
          <span className={`ld-badge ${isExam ? 'exam' : 'review'}`}>{isExam ? 'THI THỬ' : 'LUYỆN TẬP'}</span>
          <span className="ld-progress-info">{idx + 1}/{cauHoi.length}</span>
          <div className="ld-progress-bar"><div className="ld-progress-fill" style={{ width: `${tienDo}%` }} /></div>
          {(dem || isExam) && <span className={`ld-timer ${dem && giay <= 60 ? 'critical' : ''}`}>{fmtTime(giay)}</span>}
          <button className="ld-btn ld-btn-primary ld-btn-sm" onClick={() => { if (confirm('Kết thúc và xem kết quả?')) setKetThuc(true); }}>Nộp bài</button>
        </div>

        <div className="ld-quiz-area">
          <div className="ld-question-card">
            <div className="ld-q-label">
              <span className="ld-q-num">Câu {idx + 1}</span>
              {cur.loai === 'multi' && <span className="ld-q-multi">Chọn nhiều đáp án</span>}
            </div>
            <div className="ld-q-body">
              <p>{cur.noiDungEn}</p>
              {cur.noiDungVi && <p className="ld-vi">{cur.noiDungVi}</p>}
            </div>

            {reviewMode && (() => {
              const s = chon[cur.id] || [];
              if (s.length === 0) return <div className="ld-q-verdict blank">Bỏ trống — bạn chưa chọn đáp án nào</div>;
              return dungCauHoi(cur, s)
                ? <div className="ld-q-verdict ok"><Check size={16} /> Bạn trả lời ĐÚNG câu này</div>
                : <div className="ld-q-verdict err"><X size={16} /> Bạn trả lời SAI câu này</div>;
            })()}

            <ul className="ld-options">
              {cur.dapAn.map((da) => {
                const sel = (chon[cur.id] || []).includes(da.id);
                let cls = '';
                let tag: { text: string; kind: 'ok' | 'miss' | 'err' } | null = null;
                if (reviewMode) {
                  if (da.laDapAnDung && sel) { cls = 'show-correct chosen'; tag = { text: 'Bạn chọn · Đúng', kind: 'ok' }; }
                  else if (da.laDapAnDung) { cls = 'show-correct missed'; tag = { text: 'Đáp án đúng · bạn bỏ lỡ', kind: 'miss' }; }
                  else if (sel) { cls = 'user-wrong'; tag = { text: 'Bạn chọn · Sai', kind: 'err' }; }
                } else if (sel) cls = 'selected';
                return (
                  <li
                    key={da.id}
                    className={`ld-option ${cls} ${reviewMode ? 'locked' : ''}`}
                    onClick={() => togggleChon(cur.id, da.id, cur.loai)}
                  >
                    <div className="ld-option-row">
                      <span className={`ld-chk ${cur.loai === 'multi' ? 'box' : ''} ${sel ? 'sel' : ''}`}>
                        {reviewMode && da.laDapAnDung ? <Check size={14} /> : reviewMode && sel ? <X size={14} /> : sel ? <Check size={14} /> : ''}
                      </span>
                      <div className="ld-option-text">
                        <span>{da.noiDungEn}</span>
                        {da.noiDungVi && <span className="ld-vi">{da.noiDungVi}</span>}
                      </div>
                      {tag && <span className={`ld-option-tag ${tag.kind}`}>{tag.text}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="ld-lydo">
              <label htmlFor="ld-lydo-input">Lý do chọn <span className="ld-muted">(tùy chọn — để AI phân tích sau khi nộp)</span></label>
              <textarea
                id="ld-lydo-input"
                className="ld-lydo-input"
                placeholder="Giải thích vì sao bạn chọn đáp án này… (Enter để xuống dòng, Tab để thụt lề — dán JSON được)"
                rows={8}
                wrap="off"
                spellCheck={false}
                value={lyDo[cur.id] || ''}
                onChange={(e) => setLyDo((p) => ({ ...p, [cur.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Tab') return;
                  // Tab thụt 2 space tại con trỏ thay vì nhảy focus, tiện gõ/format JSON.
                  e.preventDefault();
                  const ta = e.currentTarget;
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  const next = ta.value.slice(0, start) + '  ' + ta.value.slice(end);
                  setLyDo((p) => ({ ...p, [cur.id]: next }));
                  requestAnimationFrame(() => {
                    ta.selectionStart = ta.selectionEnd = start + 2;
                  });
                }}
              />
            </div>

            {reviewMode && (cur.giaiThichEn || cur.giaiThichVi) && (
              <div className="ld-explain">
                <h4>Giải thích</h4>
                {cur.giaiThichEn && <p>{cur.giaiThichEn}</p>}
                {cur.giaiThichVi && <p className="ld-vi">{cur.giaiThichVi}</p>}
              </div>
            )}

            <div className="ld-q-actions">
              <button className="ld-btn ld-btn-primary" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
                <ChevronLeft size={16} /> Trước
              </button>
              <div className="ld-q-actions-right">
                {!isExam && !ketThuc && !reviewSauThi && !daKiemTra[cur.id] && (chon[cur.id]?.length ?? 0) > 0 && (
                  <button className="ld-btn ld-btn-primary" onClick={() => setDaKiemTra((p) => ({ ...p, [cur.id]: true }))}>
                    Kiểm tra
                  </button>
                )}
                {idx < cauHoi.length - 1 ? (
                  <button className="ld-btn ld-btn-primary" onClick={() => setIdx((i) => i + 1)}>Tiếp <ChevronRight size={16} /></button>
                ) : (
                  !ketThuc && <button className="ld-btn ld-btn-primary" onClick={() => setKetThuc(true)}>Nộp bài</button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
