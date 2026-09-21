// Popup dùng chung nhiều màn hình (xác nhận xóa, tạo/sửa task project).
// Tách khỏi main.tsx để Project/Weekly + màn chính import mà không tạo vòng lặp.
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useLang } from '../useLang';
import { useToast, usePics } from '../context';
import { Modal } from './Modal';
import { TaskLinkEditor } from './task-atoms';
import { normalizedTaskLinks, progressSelectOptions } from '../lib/task-utils';
import { currentVietnamDateInputValue } from '../lib/date';
import type { ProjectItem, ProjectTaskCreateBody, ProjectTaskItem, ProjectTaskProgress, TaskLink } from '../types';

export function PopupTaoProjectTask({
  project,
  parentTask,
  task,
  hasChildren = false,
  onClose,
  onCreated,
  nested = false,
  skipEmptyAssignmentConfirm = false
}: {
  project: ProjectItem;
  parentTask: ProjectTaskItem | null;
  task?: ProjectTaskItem;
  hasChildren?: boolean;
  onClose: () => void;
  onCreated: (task: ProjectTaskCreateBody) => Promise<void>;
  nested?: boolean;
  skipEmptyAssignmentConfirm?: boolean;
}) {
  const { t } = useLang();
  const [tieuDe, setTieuDe] = useState(task?.tieuDe || '');
  const [ghiChu, setGhiChu] = useState(task?.ghiChu || '');
  const [links, setLinks] = useState<TaskLink[]>(task?.links || []);
  const [ngayBatDauDuKien, setNgayBatDauDuKien] = useState(task?.ngayBatDauDuKien || currentVietnamDateInputValue());
  const [ngayKetThucDuKien, setNgayKetThucDuKien] = useState(task?.ngayKetThucDuKien || currentVietnamDateInputValue());
  const [estimateHours, setEstimateHours] = useState(task?.estimateHours == null ? '' : String(task.estimateHours));
  // Tiến độ task lá nhập tay (không suy ra từ giai đoạn).
  const [tienDo, setTienDo] = useState<ProjectTaskProgress>(task?.tienDo || 0);
  // Giai đoạn phân công (chỉ task lá): ai làm từ ngày nào tới ngày nào + giờ dự kiến. gio: chuỗi cho ô input.
  type SegRow = { pic: string; startDate: string; endDate: string; gio: string };
  const blankSeg = (): SegRow => ({ pic: '', startDate: '', endDate: '', gio: '' });
  const isSegBlank = (r: SegRow) => !r.pic && !r.startDate && !r.endDate && !r.gio.trim();
  // Luôn giữ 1 dòng trống ở cuối để thêm giai đoạn mới (không cần nút bấm).
  const withTrailingBlank = (rows: SegRow[]): SegRow[] =>
    (rows.length === 0 || !isSegBlank(rows[rows.length - 1])) ? [...rows, blankSeg()] : rows;
  const [segRows, setSegRows] = useState<SegRow[]>(() =>
    withTrailingBlank((task?.assignments || []).map((a) => ({
      pic: a.pic, startDate: a.startDate, endDate: a.endDate,
      gio: a.estimateHours == null ? '' : String(a.estimateHours)
    })))
  );
  const { pics: picOptions } = usePics();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const taskHasChildren = hasChildren;
  // Giai đoạn "thật" = dòng đã điền (bỏ dòng trống ở cuối). % task suy ra từ các dòng này (server tính).
  const realSegs = segRows.filter((r) => !isSegBlank(r));

  function suaGiaiDoan(index: number, patch: Partial<SegRow>) {
    setSegRows((cur) => withTrailingBlank(cur.map((r, i) => (i === index ? { ...r, ...patch } : r))));
  }
  function xoaGiaiDoan(index: number) {
    setSegRows((cur) => withTrailingBlank(cur.filter((_, i) => i !== index)));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let validSegs: SegRow[] = [];
    if (!taskHasChildren) {
      // Ngày sai thứ tự -> chặn cứng (lỗi rõ ràng).
      for (const [i, r] of realSegs.entries()) {
        if (r.startDate && r.endDate && r.endDate < r.startDate) {
          setError(`Giai đoạn #${i + 1}: ngày kết thúc không thể trước ngày bắt đầu`); return;
        }
      }
      validSegs = realSegs.filter((r) => r.pic && r.startDate && r.endDate);
      // Cho phép lưu dù thiếu thông tin, nhưng cảnh báo. Dòng thiếu PIC/ngày sẽ KHÔNG được lưu.
      const thieu = realSegs.length - validSegs.length;
      if (!skipEmptyAssignmentConfirm && (thieu > 0 || validSegs.length === 0)) {
        const msg = validSegs.length === 0
          ? 'Bạn chưa thêm giai đoạn phân công nào (cần PIC + ngày). Nên thêm ít nhất 1 giai đoạn. Vẫn lưu?'
          : `Có ${thieu} giai đoạn chưa điền đủ PIC/ngày — các giai đoạn này sẽ KHÔNG được lưu. Bạn nên điền đầy đủ. Vẫn lưu?`;
        if (!window.confirm(msg)) return;
      }
    }
    setIsSaving(true);
    try {
      // Task lá không có giai đoạn hợp lệ -> dùng ngày fallback (ngày cũ hoặc hôm nay) cho cột NOT NULL.
      const fallbackStart = task?.ngayBatDauDuKien || ngayBatDauDuKien;
      const fallbackEnd = task?.ngayKetThucDuKien || ngayKetThucDuKien;
      const hasValid = !taskHasChildren && validSegs.length > 0;
      const vStart = validSegs.map((r) => r.startDate).sort()[0];
      const vEnd = validSegs.map((r) => r.endDate).sort().at(-1);
      const vAssignee = [...new Set(validSegs.map((r) => r.pic))].join(', ');
      await onCreated({
        parentId: parentTask?.id || null,
        tieuDe: tieuDe.trim(),
        ghiChu,
        links: normalizedTaskLinks(links),
        ngayBatDauDuKien: taskHasChildren ? (task?.ngayBatDauDuKien || ngayBatDauDuKien) : hasValid ? vStart : fallbackStart,
        ngayKetThucDuKien: taskHasChildren ? (task?.ngayKetThucDuKien || ngayKetThucDuKien) : hasValid ? (vEnd as string) : fallbackEnd,
        // Task lá: estimate do server suy ra từ giai đoạn (body null). Tiến độ nhập tay.
        estimateHours: taskHasChildren ? (task?.estimateHours ?? null) : null,
        tienDo: taskHasChildren ? (task?.tienDo ?? 0) : tienDo,
        assignee: hasValid ? vAssignee : taskHasChildren ? (task?.assignee || '') : '',
        // Task lá: luôn gửi mảng giai đoạn HỢP LỆ ([] = không có giai đoạn). Task có con: không đụng tới.
        assignments: taskHasChildren ? undefined : validSegs.map((r, i) => ({
          pic: r.pic, startDate: r.startDate, endDate: r.endDate,
          estimateHours: r.gio.trim() === '' ? null : Number(r.gio), sortOrder: i
        }))
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : t('ptask.form.err_create'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} nested={nested}>
      <form className="popup popup-ptask-form w-full max-w-5xl" onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{task ? t('ptask.form.edit') : t('ptask.form.add')}</h2>
          </div>
          <button type="button" className="nut-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          {t('ptask.form.title')}
          <input value={tieuDe} disabled={isSaving} onChange={(event) => setTieuDe(event.target.value)} required autoFocus />
        </label>
        <label className="field">
          {t('ptask.form.note')}
          <textarea
            className="project-task-note-input"
            value={ghiChu}
            disabled={isSaving}
            onChange={(event) => setGhiChu(event.target.value)}
            rows={7}
            placeholder={t('ptask.form.note_placeholder')}
          />
        </label>
        <div className="field">
          {t('ptask.form.links')}
          <TaskLinkEditor links={links} onChange={setLinks} />
        </div>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {taskHasChildren && (
            <>
              <label className="field">
                {t('ptask.form.planned_start')}
                <input type="date" value={ngayBatDauDuKien} disabled onChange={(event) => setNgayBatDauDuKien(event.target.value)} />
              </label>
              <label className="field">
                {t('ptask.form.planned_end')}
                <input type="date" value={ngayKetThucDuKien} disabled onChange={(event) => setNgayKetThucDuKien(event.target.value)} />
              </label>
              <label className="field">
                {t('ptask.form.estimate')}
                <input type="number" value={estimateHours} disabled onChange={(event) => setEstimateHours(event.target.value)} />
              </label>
            </>
          )}
          <label className="field">
            {t('ptask.form.progress')}
            <select value={tienDo} disabled={isSaving || taskHasChildren} onChange={(event) => setTienDo(Number(event.target.value) as ProjectTaskProgress)}>
              {progressSelectOptions(task?.tienDo).map((value) => (
                <option key={value} value={value}>{value}%</option>
              ))}
            </select>
          </label>
        </div>

        {!taskHasChildren && (
          <div className="field">
            <div className="ptask-seg-head">
              <span>Phân công theo giai đoạn</span>
            </div>
            <div className="ptask-seg-list">
              <div className="ptask-seg-row ptask-seg-row-head">
                <span>PIC</span><span>Từ ngày</span><span>Đến ngày</span><span>estimate time</span><span />
              </div>
              {segRows.map((r, i) => (
                <div key={i} className="ptask-seg-row">
                  <select value={r.pic} disabled={isSaving} onChange={(e) => suaGiaiDoan(i, { pic: e.target.value })}>
                    <option value="">— chọn PIC —</option>
                    {picOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <input type="date" value={r.startDate} disabled={isSaving} onChange={(e) => suaGiaiDoan(i, { startDate: e.target.value })} />
                  <input type="date" value={r.endDate} disabled={isSaving} onChange={(e) => suaGiaiDoan(i, { endDate: e.target.value })} />
                  <input type="number" min="0" step="any" placeholder="giờ" value={r.gio} disabled={isSaving} onChange={(e) => suaGiaiDoan(i, { gio: e.target.value })} />
                  {isSegBlank(r)
                    ? <span />
                    : <button type="button" className="nut-icon" disabled={isSaving} onClick={() => xoaGiaiDoan(i)} title="Xóa giai đoạn"><X size={14} /></button>}
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <p className="release-error">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" className="nut-phu" disabled={isSaving} onClick={onClose}>{t('btn.cancel')}</button>
          <button className="nut-chinh" type="submit" disabled={isSaving}>{t('btn.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

export function PopupXacNhanXoa({
  title,
  message,
  onClose,
  onConfirm
}: {
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLang();
  const toast = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsDeleting(true);
    try {
      await onConfirm();
      toast('Đã xóa');
    } catch (error) {
      setError(error instanceof Error ? error.message : t('delete.err'));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Modal onClose={onClose} dismissable={!isDeleting}>
      <form className="popup w-full max-w-md" onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" className="nut-icon" disabled={isDeleting} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="mb-5 text-sm leading-6 text-phu">{message}</p>
        {error && <p className="release-error">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" className="nut-phu" disabled={isDeleting} onClick={onClose}>{t('btn.cancel')}</button>
          <button className="nut-nguy-hiem-text" type="submit" disabled={isDeleting} autoFocus>
            {t('delete.btn')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
