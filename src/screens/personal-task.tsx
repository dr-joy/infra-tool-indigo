import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useLang } from '../useLang';
import { TimeInput } from '../ui';
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, History, Plus, Search, Trash2, X
} from 'lucide-react';
import {
  dinhDangNgay, dinhDangNgayDayDu, addDays, currentVietnamDateInputValue, currentVietnamTimeMinutes,
  localDateInputValue, taoNgayTuInput, timeToMinutes, minutesToTime, snapMinutes, clamp, layGioPhutVietNam
} from '../lib/date';
import {
  tenTrangThai, trangThaiLabel, quickProjectTaskCreatedEvent, buildProjectTaskNumbers, normalizedTaskLinks,
  sapXepTask, taoSortHienTai, sortButtonClass, tinhLaneTaskDinhKy
} from '../lib/task-utils';
import { CopyNoteButton, TaskLinkBadges, TaskLinkEditor, SortIcon } from '../components/task-atoms';
import { PopupTaoProjectTask } from '../components/dialogs';
import { useToast } from '../context';
import { Modal } from '../components/Modal';
import { api, apiTeam } from '../api';
import { useActiveTeamId } from '../auth-context';
import type {
  LoaiTask, TrangThai, TaskLink, Task, ProjectItem, ProjectTaskItem, ProjectTaskCreateBody,
  DuLieuDashboard, SortState
} from '../types';

// Tách khỏi src/main.tsx (kế hoạch Council run 022dd1e5, xem docs/exchanges/2026-09-12.md, hội tụ
// vòng 3) — toàn bộ state/effect/hàm nghiệp vụ của tính năng Task cá nhân (trước đây nằm trực tiếp
// trong App()) cùng CotTask/CotDinhKy/TaskDinhKy/7 popup liên quan, giữ nguyên văn logic.
//
// QUAN TRỌNG — ManHinhTaskCaNhan LUÔN ĐƯỢC MOUNT (không như các màn khác đã tách trước — Project/
// Weekly/Release/MindMap — vốn unmount hẳn khi đổi tab): trước khi tách, state của tính năng này sống
// trong App() nên không unmount khi đổi tab, popup vẫn nổi đè lên tab khác nếu đang mở (hành vi hiện tại,
// dù lạ, KHÔNG phải việc của đợt tách này để sửa — Council quyết định giữ nguyên qua prop `active`
// thay vì bắt chước cách 5 màn kia unmount).
//
// Giao tiếp với shell (App() trong main.tsx) qua đúng 2 kênh, tối giản, không truyền 15 prop lặt vặt:
// - Props xuôi: { active, notificationPermission } — active điều khiển ẩn/hiện phần lưới 3 cột (JSX
//   khác — banner tải + toàn bộ popup — vẫn render bất kể active, giữ đúng hành vi hiện tại nơi các
//   phần này không bị gate theo tabDangMo). notificationPermission là prop chỉ-đọc: quyền trình duyệt
//   và nút xin quyền vẫn ở shell (nút nằm trên thanh nav), module chỉ dùng giá trị để quyết định có bắn
//   Notification hay không.
// - Ref-handle: { openQuickAdd, openHistory, refresh(date?) } — shell gọi qua ref cho 2 phím tắt toàn cục
//   và cho callback onTasksCreated của ManHinhLenLich (màn Lên lịch).

export interface ManHinhTaskCaNhanHandle {
  openQuickAdd(): void;
  openHistory(): void;
  refresh(date?: string): Promise<void>;
}

interface ManHinhTaskCaNhanProps {
  active: boolean;
  notificationPermission: NotificationPermission;
}

const weekdays = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const weekdaysLamViec = weekdays.map((day, index) => ({ day, index })).filter(({ index }) => index >= 1 && index <= 5);

function supportsBrowserNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function taskSourceClass(task: Task) {
  if (task.releaseMonth?.startsWith('emergency:')) return 'task-source-emergency-release';
  if (task.releaseMonth || task.releaseDate) return 'task-source-regular-release';
  return 'task-source-manual';
}

export const ManHinhTaskCaNhan = forwardRef<ManHinhTaskCaNhanHandle, ManHinhTaskCaNhanProps>(function ManHinhTaskCaNhan(
  { active, notificationPermission },
  ref
) {
  const { t } = useLang();
  const [duLieu, setDuLieu] = useState<DuLieuDashboard>({ khoTask: [], taskHomNay: [], taskDinhKy: [], lichSu: [] });
  const [dangTai, setDangTai] = useState(true);
  const [moTaoTask, setMoTaoTask] = useState(false);
  const [moThemTaskNhanh, setMoThemTaskNhanh] = useState(false);
  const [moLichSu, setMoLichSu] = useState(false);
  const [taskDangSua, setTaskDangSua] = useState<Task | null>(null);
  const [taskDangCancel, setTaskDangCancel] = useState<Task | null>(null);
  const [taskDangHoanThanh, setTaskDangHoanThanh] = useState<Task | null>(null);
  const [ngayDinhKy, setNgayDinhKy] = useState(() => currentVietnamDateInputValue());
  const requestTaiDuLieuSeqRef = useRef(0);
  const notifiedRecurringTaskRef = useRef<Set<string>>(new Set());

  async function taiDuLieu(date = ngayDinhKy) {
    const seq = ++requestTaiDuLieuSeqRef.current;
    if (date !== ngayDinhKy) setNgayDinhKy(date);
    setDangTai(true);
    try {
      const data = await api<DuLieuDashboard>(`/api/tasks?date=${encodeURIComponent(date)}`);
      if (seq === requestTaiDuLieuSeqRef.current) setDuLieu(data);
      return data;
    } finally {
      if (seq === requestTaiDuLieuSeqRef.current) setDangTai(false);
    }
  }

  useEffect(() => {
    taiDuLieu().catch(() => setDangTai(false));
  }, [ngayDinhKy]);

  useEffect(() => {
    if (!supportsBrowserNotifications() || notificationPermission !== 'granted') return;
    if (ngayDinhKy !== currentVietnamDateInputValue()) return;

    function checkUpcomingRecurringTasks() {
      const today = currentVietnamDateInputValue();
      const nowMinutes = currentVietnamTimeMinutes();
      const leadTimeMinutes = 5;

      for (const task of duLieu.taskDinhKy) {
        if (!task.gioBatDau || task.trangThai === 'da_hoan_thanh' || task.trangThai === 'canceled') continue;
        const diffMinutes = timeToMinutes(task.gioBatDau) - nowMinutes;
        if (diffMinutes <= 0 || diffMinutes > leadTimeMinutes) continue;

        const key = `${today}:${task.id}:${task.gioBatDau}`;
        if (notifiedRecurringTaskRef.current.has(key)) continue;
        notifiedRecurringTaskRef.current.add(key);

        const notification = new Notification('Sắp tới task định kỳ', {
          body: `${task.tenTask}\nBắt đầu lúc ${task.gioBatDau}`,
          tag: key
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      }
    }

    checkUpcomingRecurringTasks();
    const intervalId = window.setInterval(checkUpcomingRecurringTasks, 30 * 1000);
    return () => window.clearInterval(intervalId);
  }, [duLieu.taskDinhKy, ngayDinhKy, notificationPermission]);

  async function doiTrangThai(id: number, trangThai: TrangThai) {
    await api(`/api/tasks/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ trangThai })
    });
    await taiDuLieu();
  }

  async function xoaTask(id: number) {
    await api(`/api/tasks/${id}`, {
      method: 'DELETE'
    });
    await taiDuLieu();
  }

  async function capNhatGioDinhKy(id: number, gioBatDau: string, gioKetThuc: string) {
    await api(`/api/tasks/${id}/schedule`, {
      method: 'PATCH',
      body: JSON.stringify({ gioBatDau, gioKetThuc })
    });
    await taiDuLieu();
  }

  function batDauKeo(event: React.DragEvent, task: Task) {
    event.dataTransfer.setData('text/plain', String(task.id));
    event.dataTransfer.effectAllowed = 'move';
  }

  async function thaVaoCot(event: React.DragEvent, trangThai: TrangThai) {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData('text/plain'));
    if (id) await doiTrangThai(id, trangThai);
  }

  // Council round 2-3 (docs/exchanges/2026-09-12.md, vòng 2-3): hợp đồng Release -> Task PHẢI giữ
  // đúng tham số ngày và việc chờ hoàn tất — ManHinhLenLich gọi `onTasksCreated(date?: string) =>
  // Promise<void>` với ngày cụ thể ở nhiều call site và `await` kết quả. LƯU Ý QUAN TRỌNG (phát hiện
  // khi tự đọc lại code thật, khác giả định ban đầu của Council): hành vi HIỆN TẠI của main.tsx (TRƯỚC
  // khi tách) đã KHÔNG forward tham số `date` này cho taiDuLieu —
  // `onTasksCreated={() => taiDuLieu().then(() => {})}` luôn bỏ qua ngày ManHinhLenLich truyền, chỉ
  // refresh theo `ngayDinhKy` đang chọn trên dashboard. Đây CÓ THỂ là một khiếm khuyết có sẵn (task
  // release tạo cho ngày tương lai không tự nhảy dashboard tới đúng ngày đó), nhưng đây là REFACTOR
  // THUẦN (không đổi hành vi) nên `refresh` ở đây giữ NGUYÊN Y HỆT cách bỏ qua `date` — không tự sửa.
  // Nếu cần sửa, đó là một quyết định nghiệp vụ riêng (đổi hành vi thật), phải tách thành backlog/CR
  // khác, không lẫn vào đợt tách module này.
  async function refresh(_date?: string): Promise<void> {
    await taiDuLieu();
  }

  useImperativeHandle(ref, () => ({
    openQuickAdd: () => setMoThemTaskNhanh(true),
    openHistory: () => setMoLichSu(true),
    refresh
  }));

  return (
    <>
      {active && (
          <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_1fr_1.08fr]">
            <CotTask
              title={t('col.warehouse')}
              tone="green"
              tasks={duLieu.khoTask}
              onDrop={(event) => thaVaoCot(event, 'chua_thuc_hien')}
              onDragStart={batDauKeo}
              onEdit={setTaskDangSua}
              onComplete={setTaskDangHoanThanh}
              onCancel={setTaskDangCancel}
              action={
                <button className="nut-them" onClick={() => setMoTaoTask(true)} title={t('task.create')}>
                  <Plus size={28} />
                </button>
              }
              rightAction={
                <button className="nut-chinh nut-lich-su" onClick={() => setMoLichSu(true)}>
                  <History size={18} />
                  {t('header.history')}
                </button>
              }
            />
            <CotTask
              title={t('col.today')}
              tone="blue"
              tasks={duLieu.taskHomNay}
              onDrop={(event) => thaVaoCot(event, 'dang_tien_hanh')}
              onDragStart={batDauKeo}
              onEdit={setTaskDangSua}
              onComplete={setTaskDangHoanThanh}
              onCancel={setTaskDangCancel}
            />
            <CotDinhKy
              tasks={duLieu.taskDinhKy}
              ngayDinhKy={ngayDinhKy}
              onChangeNgay={setNgayDinhKy}
              onToday={() => setNgayDinhKy(currentVietnamDateInputValue())}
              onComplete={setTaskDangHoanThanh}
              onEdit={setTaskDangSua}
              onTimeChange={capNhatGioDinhKy}
            />
          </section>
      )}
      {dangTai &&<div className="fixed bottom-5 right-5 rounded-md bg-white px-4 py-3 text-sm">{t('loading.data')}</div>}
      {moTaoTask && <PopupTaoTask onClose={() => setMoTaoTask(false)} onCreated={() => taiDuLieu().then(() => {})} />}
      {moThemTaskNhanh && (
        <PopupThemTaskNhanh
          onClose={() => setMoThemTaskNhanh(false)}
          onPersonalCreated={() => taiDuLieu().then(() => {})}
        />
      )}
      {moLichSu && <PopupLichSu tasks={duLieu.lichSu} onClose={() => setMoLichSu(false)} />}
      {taskDangSua && (
        <PopupSuaTask
          task={taskDangSua}
          onClose={() => setTaskDangSua(null)}
          onUpdated={async () => {
            await taiDuLieu();
            setTaskDangSua(null);
          }}
          onReloadTask={async () => {
            const data = await taiDuLieu();
            return data.taskDinhKy.find((tk) => tk.id === taskDangSua.id)
              || data.taskHomNay.find((tk) => tk.id === taskDangSua.id)
              || data.khoTask.find((tk) => tk.id === taskDangSua.id)
              || data.lichSu.find((tk) => tk.id === taskDangSua.id)
              || null;
          }}
          onCancelTask={setTaskDangCancel}
        />
      )}
      {taskDangCancel && (
        <PopupXacNhanCancel
          task={taskDangCancel}
          onClose={() => setTaskDangCancel(null)}
          onConfirm={async () => {
            if (taskDangCancel.loaiTask === 'dinh_ky') {
              await xoaTask(taskDangCancel.id);
            } else {
              await doiTrangThai(taskDangCancel.id, 'canceled');
            }
            setTaskDangCancel(null);
            setTaskDangSua(null);
          }}
        />
      )}
      {taskDangHoanThanh && (
        <PopupXacNhanHoanThanh
          task={taskDangHoanThanh}
          onClose={() => setTaskDangHoanThanh(null)}
          onConfirm={async () => {
            await doiTrangThai(taskDangHoanThanh.id, 'da_hoan_thanh');
            setTaskDangHoanThanh(null);
          }}
        />
      )}
    </>
  );
});

function CotTask(props: {
  title: string;
  tone: 'green' | 'blue';
  tasks: Task[];
  action?: React.ReactNode;
  rightAction?: React.ReactNode;
  onDrop: (event: React.DragEvent) => void;
  onDragStart: (event: React.DragEvent, task: Task) => void;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => void;
  onCancel: (task: Task) => void;
}) {
  const { t } = useLang();
  return (
    <section className="cot-kanban" onDragOver={(event) => event.preventDefault()} onDrop={props.onDrop}>
      <div className="mb-3 flex min-h-12 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {props.action}
          <h2 className="text-lg font-bold">{props.title}</h2>
          <span className="dem-task">{props.tasks.length}</span>
        </div>
        {props.rightAction && <div className="flex shrink-0 items-center gap-2">{props.rightAction}</div>}
      </div>

      <div className="task-list">
        {props.tasks.map((task) => (
          <article
            key={task.id}
            className={`task-row ${taskSourceClass(task)}`}
            draggable
            onClick={() => props.onEdit(task)}
            onDragStart={(event) => props.onDragStart(event, task)}
          >
            <div className="min-w-0 flex-1 overflow-hidden">
              <h3 className="task-title-wrap text-sm font-bold" title={task.tenTask}>{task.tenTask}</h3>
              <p className="mt-0.5 min-h-3 truncate text-xs text-phu">{task.ghiChu}</p>
              <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-phu">
                <TaskLinkBadges links={task.links} />
              </div>
            </div>
            <div className="task-actions">
              {props.onComplete && (
                <label className="checkbox-xong" title={t('task.complete')} onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" onClick={(event) => event.stopPropagation()} onChange={() => props.onComplete(task)} />
                  <Check size={14} />
                </label>
              )}
              <button
                type="button"
                className="nut-cancel-record nut-trash-icon"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCancel(task);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        ))}
        {props.tasks.length === 0 && <div className="empty">{t('empty.cot_task')}</div>}
      </div>
    </section>
  );
}

export function CotDinhKy({
  tasks,
  ngayDinhKy,
  onChangeNgay,
  onToday,
  onComplete,
  onEdit,
  onTimeChange
}: {
  tasks: Task[];
  ngayDinhKy: string;
  onChangeNgay: (value: string) => void;
  onToday: () => void;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onTimeChange: (id: number, gioBatDau: string, gioKetThuc: string) => Promise<void>;
}) {
  const [thoiGianHienTai, setThoiGianHienTai] = useState(() => layGioPhutVietNam());
  const mocGio = Array.from({ length: 22 }, (_, index) => {
    const total = 7 * 60 + 30 + index * 30;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  });
  const batDauNgay = 7 * 60 + 30;
  const ketThucNgay = 18 * 60;
  const tongPhut = ketThucNgay - batDauNgay;
  const lunchStartTop = ((11 * 60 + 45 - batDauNgay) / tongPhut) * 100;
  const lunchHeight = ((13 * 60 - (11 * 60 + 45)) / tongPhut) * 100;
  const timeTop = (value: string) => `${((timeToMinutes(value) - batDauNgay) / tongPhut) * 100}%`;
  const nowMinutes = thoiGianHienTai.hour * 60 + thoiGianHienTai.minute + thoiGianHienTai.second / 60;
  const lineTop = Math.min(100, Math.max(0, ((nowMinutes - batDauNgay) / tongPhut) * 100));
  const nowLabel = `${String(thoiGianHienTai.hour).padStart(2, '0')}:${String(thoiGianHienTai.minute).padStart(2, '0')}:${String(thoiGianHienTai.second).padStart(2, '0')}`;
  const laHomNay = ngayDinhKy === currentVietnamDateInputValue();
  const minDuration = tasks.length
    ? tasks.reduce((min, task) => {
        const start = timeToMinutes(task.gioBatDau, '08:00');
        const end = timeToMinutes(task.gioKetThuc || task.gioBatDau, '08:30');
        return Math.min(min, Math.max(15, end - start));
      }, Infinity)
    : 30;
  const timelineHeight = Math.max(520, Math.ceil((tongPhut / minDuration) * 30));
  const coVachHienTai = laHomNay && nowMinutes >= batDauNgay && nowMinutes <= ketThucNgay;
  const { t } = useLang();
  const taskLayouts = useMemo(() => tinhLaneTaskDinhKy(tasks), [tasks]);
  // tz-ok: dieu-huong-ngay-tren-form — lui/tien ngay tren input, khong phai quyet dinh theo gio
  const doiNgay = (days: number) => onChangeNgay(localDateInputValue(addDays(taoNgayTuInput(ngayDinhKy), days)));
  const ngayDinhKyInputRef = useRef<HTMLInputElement>(null);

  function openNgayDinhKyPicker() {
    const input = ngayDinhKyInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    input?.focus();
    try {
      input?.showPicker?.();
    } catch {
      // Browser may ignore duplicate picker calls while the native picker is already opening.
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      setThoiGianHienTai(layGioPhutVietNam());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="cot-kanban">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t('col.recurring')}</h2>
          <p className="text-base font-extrabold capitalize text-slate-800">{dinhDangNgayDayDu(ngayDinhKy)}</p>
        </div>
        <div className="lich-dinh-ky">
          <button type="button" className="nut-ngay-dinh-ky" onClick={() => doiNgay(-1)} aria-label={t('cot.prev_day')}>
            <ChevronLeft size={18} />
          </button>
          <label className="nut-lich-dinh-ky" onClick={openNgayDinhKyPicker}>
            <input
              ref={ngayDinhKyInputRef}
              type="date"
              value={ngayDinhKy}
              onChange={(event) => onChangeNgay(event.target.value)}
              aria-label={t('cot.pick_date')}
            />
          </label>
          <button type="button" className="nut-ngay-dinh-ky" onClick={() => doiNgay(1)} aria-label={t('cot.next_day')}>
            <ChevronRight size={18} />
          </button>
          <button type="button" className="nut-hom-nay" disabled={laHomNay} onClick={onToday}>
            {t('cot.today')}
          </button>
        </div>
      </div>
      <div className="timeline">
        <div className="timeline-canvas" style={{ height: `${timelineHeight}px` }}>
          <div className="absolute inset-y-3 left-0 right-0">
            <div
              className="absolute left-[72px] right-3 rounded-md border border-slate-400 bg-slate-400"
              style={{ top: `${lunchStartTop}%`, height: `${lunchHeight}%` }}
            >
              <span className="absolute left-3 top-1/2 -translate-y-1/2 rounded bg-slate-500 px-2 py-1 text-xs font-bold text-white">
                {t('cot.lunch_break')}
              </span>
            </div>
            <div className="absolute inset-y-0 left-[72px] right-0">
              {mocGio.map((moc) => (
                <div
                  key={moc}
                  className="absolute left-0 right-0 border-t border-dashed border-slate-500"
                  style={{ top: timeTop(moc) }}
                />
              ))}
              {coVachHienTai && (
                <div className="absolute left-0 right-0 z-20" style={{ top: `${lineTop}%` }}>
                  <span className="absolute -top-5 right-1 rounded bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {nowLabel}
                  </span>
                  <div className="h-0.5 bg-rose-500" />
                </div>
              )}
            </div>
            <div className="relative z-10 h-full">
            {mocGio.map((moc) => (
              <div
                key={moc}
                className="absolute grid -translate-y-1/2 grid-cols-[60px_1fr] gap-3 text-[15px] font-semibold leading-none text-slate-700"
                style={{ top: timeTop(moc) }}
              >
                  <span>{moc}</span>
                </div>
              ))}
              <div className="timeline-task-layer absolute bottom-0 left-[72px] right-3 top-0">
                {tasks.map((task) => (
                  <TaskDinhKy
                    key={task.id}
                    task={task}
                    tongPhut={tongPhut}
                    layout={taskLayouts.get(task.id)}
                    onComplete={onComplete}
                    onEdit={onEdit}
                    onTimeChange={onTimeChange}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TaskDinhKy({
  task,
  tongPhut,
  layout,
  onComplete,
  onEdit,
  onTimeChange
}: {
  task: Task;
  tongPhut: number;
  layout?: { lane: number; laneCount: number };
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onTimeChange: (id: number, gioBatDau: string, gioKetThuc: string) => Promise<void>;
}) {
  const batDauNgay = 7 * 60 + 30;
  const ketThucNgay = 18 * 60;
  const originalStart = timeToMinutes(task.gioBatDau, '08:00');
  const originalEnd = timeToMinutes(task.gioKetThuc || task.gioBatDau, '08:30');
  const [draftRange, setDraftRange] = useState<{ start: number; end: number } | null>(null);
  const suppressClickRef = useRef(false);
  const minutes = draftRange?.start ?? originalStart;
  const endMinutes = draftRange?.end ?? originalEnd;
  const durationMinutes = Math.max(15, endMinutes - minutes);
  const top = Math.min(100, Math.max(0, ((minutes - batDauNgay) / tongPhut) * 100));
  const height = Math.min(100 - top, (durationMinutes / tongPhut) * 100);
  const { t } = useLang();
  const daHoanThanh = task.trangThai === 'da_hoan_thanh';
  const lane = layout?.lane ?? 0;
  const laneCount = layout?.laneCount ?? 1;
  const laneWidth = 100 / laneCount;

  function batDauKeoGio(event: React.MouseEvent<HTMLElement>, mode: 'move' | 'resize-end') {
    if (daHoanThanh) return;
    event.preventDefault();
    event.stopPropagation();

    const layer = (event.currentTarget.closest('.timeline-task-layer') as HTMLElement | null);
    if (!layer) return;

    const layerHeight = layer.getBoundingClientRect().height;
    const pixelsPerMinute = layerHeight / tongPhut;
    const mouseStartY = event.clientY;
    const rangeStart = minutes;
    const rangeEnd = endMinutes;
    let latestStart = rangeStart;
    let latestEnd = rangeEnd;
    let moved = false;

    function update(nextClientY: number) {
      const deltaMinutes = snapMinutes((nextClientY - mouseStartY) / pixelsPerMinute);
      if (Math.abs(deltaMinutes) >= 15) moved = true;

      if (mode === 'move') {
        const duration = Math.max(15, rangeEnd - rangeStart);
        latestStart = clamp(rangeStart + deltaMinutes, batDauNgay, ketThucNgay - duration);
        latestEnd = latestStart + duration;
      } else {
        latestStart = rangeStart;
        latestEnd = clamp(rangeEnd + deltaMinutes, rangeStart + 15, ketThucNgay);
      }

      setDraftRange({ start: latestStart, end: latestEnd });
    }

    function onMouseMove(moveEvent: MouseEvent) {
      update(moveEvent.clientY);
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      suppressClickRef.current = moved;

      if (moved && (latestStart !== originalStart || latestEnd !== originalEnd)) {
        void onTimeChange(task.id, minutesToTime(latestStart), minutesToTime(latestEnd)).finally(() => {
          setDraftRange(null);
        });
      } else {
        setDraftRange(null);
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  return (
    <article
      className={`task-dinh-ky ${taskSourceClass(task)} ${daHoanThanh ? 'task-dinh-ky-done' : ''}`}
      style={{
        top: `${top}%`,
        height: `${height}%`,
        left: `calc(${lane * laneWidth}% + ${lane > 0 ? 3 : 0}px)`,
        width: `calc(${laneWidth}% - ${laneCount > 1 ? 3 : 0}px)`
      }}
      onMouseDown={(event) => batDauKeoGio(event, 'move')}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onEdit(task);
      }}
    >
      <button
        type="button"
        className={`nut-hoan-thanh-timeline ${daHoanThanh ? 'nut-hoan-thanh-timeline-done' : ''}`}
        disabled={daHoanThanh}
        title={t('task.complete_btn')}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onComplete(task);
        }}
      >
        <Check size={11} />
      </button>
      <div className="task-dinh-ky-content">
        <h3 title={task.tenTask}>{task.tenTask}</h3>
        <span>
          {minutesToTime(minutes)}
          {` - ${minutesToTime(endMinutes)}`}
        </span>
        {task.lechDefinition && (
          <span
            className="drift-flag"
            title="Nội dung task đang khác với definition gốc — mở màn Release và đồng bộ lại"
          >
            <AlertTriangle size={11} />
          </span>
        )}
      </div>
      <TaskLinkBadges links={task.links} variant="timeline" />
      <div
        className="resize-thoi-gian"
        title={t('task.drag_end_time')}
        onMouseDown={(event) => batDauKeoGio(event, 'resize-end')}
      />
    </article>
  );
}

// QA-2026-09-12: dropdown "Kiểu lặp" cho phép chọn hang_tuan/hang_thang độc lập với ô chi tiết
// (thứ trong tuần / ngày trong tháng) — trước đây không có gì chặn lưu ở trạng thái vô nghĩa
// (hang_tuan không tick thứ nào, hoặc hang_thang không nhập ngày). `recurrenceMatches()`
// (server/lib/recurrence.ts) coi 2 trạng thái này là "không bao giờ khớp ngày nào" — task sinh ra
// bị NẰM IM VĨNH VIỄN, không hiện ở đâu và (với task cá nhân) không có màn nào liệt kê lại để sửa/
// xoá. Chặn ngay tại đây, cả 3 form tạo/sửa task đều gọi chung hàm này trước khi gửi request.
function loiDinhKyKhongHopLe(lapLaiKieu: string, thuDaChon: number[], ngayTrongThang: string): string | null {
  if (lapLaiKieu === 'hang_tuan' && thuDaChon.length === 0) {
    return 'Kiểu lặp "Hàng tuần" cần tick ít nhất 1 thứ trong tuần, nếu không task sẽ không bao giờ hiện ra.';
  }
  if (lapLaiKieu === 'hang_thang' && !ngayTrongThang) {
    return 'Kiểu lặp "Hàng tháng" cần nhập ngày trong tháng, nếu không task sẽ không bao giờ hiện ra.';
  }
  return null;
}

function PopupSuaTask({
  task,
  onClose,
  onUpdated,
  onReloadTask,
  onCancelTask
}: {
  task: Task;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onReloadTask: () => Promise<Task | null>;
  onCancelTask: (task: Task) => void;
}) {
  const { t } = useLang();
  const toast = useToast();
  const [tenTask, setTenTask] = useState(task.tenTask);
  const [ghiChu, setGhiChu] = useState(task.ghiChu);
  const [links, setLinks] = useState<TaskLink[]>(task.links || []);
  const [gioBatDau, setGioBatDau] = useState(task.gioBatDau || '09:00');
  const [gioKetThuc, setGioKetThuc] = useState(task.gioKetThuc || '09:30');
  const [lapLaiKieu, setLapLaiKieu] = useState(task.lapLaiKieu || 'hang_ngay');
  const [ngayTrongThang, setNgayTrongThang] = useState(task.ngayTrongThang == null ? '' : String(task.ngayTrongThang));
  const [thuDaChon, setThuDaChon] = useState<number[]>(Array.isArray(task.thuTrongTuan) ? task.thuTrongTuan : task.thuTrongTuan == null ? [] : [task.thuTrongTuan]);
  const [moDropdownThu, setMoDropdownThu] = useState(false);
  const dropdownThuRef = useRef<HTMLDetailsElement>(null);
  const [moXacNhanScopeDinhKy, setMoXacNhanScopeDinhKy] = useState(false);
  const laTaskDinhKy = task.loaiTask === 'dinh_ky';
  const laTaskDinhKyThuCong = laTaskDinhKy && !task.releaseMonth && !task.releaseDate;
  const coTheCancel = laTaskDinhKy || ['chua_thuc_hien', 'dang_tien_hanh'].includes(task.trangThai);
  const normalizedInitialLinks = JSON.stringify(normalizedTaskLinks(task.links || []));
  const normalizedCurrentLinks = JSON.stringify(normalizedTaskLinks(links));
  const khoaKieuLap = thuDaChon.length > 0 || ngayTrongThang !== '';
  const coThayDoi =
    tenTask.trim() !== task.tenTask ||
    ghiChu.trim() !== task.ghiChu ||
    (laTaskDinhKyThuCong && (
      gioBatDau !== (task.gioBatDau || '09:00') ||
      gioKetThuc !== (task.gioKetThuc || '09:30') ||
      lapLaiKieu !== (task.lapLaiKieu || 'hang_ngay') ||
      ngayTrongThang !== (task.ngayTrongThang == null ? '' : String(task.ngayTrongThang)) ||
      JSON.stringify(thuDaChon) !== JSON.stringify(Array.isArray(task.thuTrongTuan) ? task.thuTrongTuan : task.thuTrongTuan == null ? [] : [task.thuTrongTuan])
    )) ||
    normalizedCurrentLinks !== normalizedInitialLinks;

  useEffect(() => {
    if (!moDropdownThu) return;
    function dongKhiClickNgoai(event: MouseEvent) {
      if (!dropdownThuRef.current?.contains(event.target as Node)) {
        setMoDropdownThu(false);
      }
    }
    document.addEventListener('mousedown', dongKhiClickNgoai);
    return () => document.removeEventListener('mousedown', dongKhiClickNgoai);
  }, [moDropdownThu]);

  function doiThuTrongTuan(index: number) {
    setThuDaChon((current) => {
      const next = current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((a, b) => a - b);
      setLapLaiKieu(next.length > 0 ? 'hang_tuan' : 'hang_ngay');
      if (next.length > 0) setNgayTrongThang('');
      return next;
    });
  }

  function doiNgayTrongThang(value: string) {
    if (!value) {
      setNgayTrongThang('');
      if (thuDaChon.length === 0) setLapLaiKieu('hang_ngay');
      return;
    }
    const validValue = String(Math.min(31, Math.max(1, Number(value))));
    setNgayTrongThang(validValue);
    setThuDaChon([]);
    setLapLaiKieu('hang_thang');
  }

  async function saveTask(updateRelated = false) {
    await api(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        tenTask,
        ghiChu,
        links: normalizedTaskLinks(links),
        gioBatDau,
        gioKetThuc,
        lapLaiKieu,
        ngayTrongThang: ngayTrongThang ? Number(ngayTrongThang) : null,
        thuTrongTuan: thuDaChon,
        updateRelated
      })
    });
    await onUpdated();
    toast('Đã lưu thay đổi');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!coThayDoi) return;
    if (laTaskDinhKyThuCong) {
      const loi = loiDinhKyKhongHopLe(lapLaiKieu, thuDaChon, ngayTrongThang);
      if (loi) {
        toast(loi, 'error');
        return;
      }
      setMoXacNhanScopeDinhKy(true);
      return;
    }
    await saveTask(false);
  }

  return (
    <Modal onClose={onClose}>
      <form className="popup w-full max-w-4xl" onSubmit={submit}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">{t('task.form.title_edit')}</h2>
          <button type="button" className="nut-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          {t('task.form.name')}
          <input value={tenTask} onChange={(event) => setTenTask(event.target.value)} required />
        </label>
        {!laTaskDinhKy && (
          <div className="field-readonly mb-4">
            <span>{t('task.form.created_date')}</span>
            <p>{dinhDangNgay(task.ngayTao)}</p>
          </div>
        )}
        <div className="field">
          <label htmlFor={`task-note-${task.id}`}>{t('task.form.note')}</label>
          {laTaskDinhKy && (
            <span className="note-header-action">
              <CopyNoteButton text={ghiChu} />
            </span>
          )}
          <textarea
            id={`task-note-${task.id}`}
            value={ghiChu}
            onChange={(event) => setGhiChu(event.target.value)}
            rows={10}
          />
        </div>
        <div className="field">
          {t('task.form.links')}
          <TaskLinkEditor links={links} onChange={setLinks} />
        </div>
        {laTaskDinhKyThuCong && (
          <div className="rounded-md border border-slate-300 bg-slate-50/80 p-4">
            <p className="mb-3 text-sm font-bold">{t('task.form.repeat_settings')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                {t('task.form.start_time')}
                <TimeInput value={gioBatDau} min="07:30" max="18:00" onChange={setGioBatDau} />
              </label>
              <label className="field">
                {t('task.form.end_time')}
                <TimeInput value={gioKetThuc} min="07:30" max="18:00" onChange={setGioKetThuc} />
              </label>
              <label className="field">
                {t('task.form.recurrence_type')}
                <select value={lapLaiKieu} disabled={khoaKieuLap} onChange={(event) => setLapLaiKieu(event.target.value)}>
                  <option value="hang_ngay">{t('task.form.daily')}</option>
                  <option value="thu_2_den_thu_6">{t('task.form.weekdays_only')}</option>
                  <option value="hang_tuan">{t('task.form.weekly')}</option>
                  <option value="hang_thang">{t('task.form.monthly')}</option>
                </select>
              </label>
              <div className="field">
                {t('task.form.day_of_week')}
                <details ref={dropdownThuRef} className="multi-select" open={moDropdownThu}>
                  <summary
                    onClick={(event) => {
                      event.preventDefault();
                      setMoDropdownThu((value) => !value);
                    }}
                  >
                    <span>{thuDaChon.length > 0 ? thuDaChon.map((index) => t(`weekday.${index}` as Parameters<typeof t>[0])).join(', ') : t('task.form.day_of_week_placeholder')}</span>
                  </summary>
                  <div className="multi-select-menu">
                  {weekdaysLamViec.map(({ index }) => (
                    <label key={index} className="multi-select-option">
                      <input
                        type="checkbox"
                        checked={thuDaChon.includes(index)}
                        onChange={() => doiThuTrongTuan(index)}
                      />
                      <span>{t(`weekday.${index}` as Parameters<typeof t>[0])}</span>
                    </label>
                  ))}
                  </div>
                </details>
              </div>
              <label className="field">
                {t('task.form.day_of_month')}
                <input
                  type="number"
                  min="1"
                  max="31"
                  placeholder="1-31"
                  value={ngayTrongThang}
                  onChange={(event) => doiNgayTrongThang(event.target.value)}
                />
              </label>
            </div>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-3">
          {coTheCancel && (
            <button type="button" className="nut-nguy-hiem nut-trash-icon" onClick={() => onCancelTask(task)} title={t('task.cancel')}>
              <Trash2 size={18} />
            </button>
          )}
          <button type="button" className="nut-phu" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="nut-chinh" type="submit" disabled={!coThayDoi}>{t('btn.save')}</button>
        </div>
      </form>
      {moXacNhanScopeDinhKy && (
        <PopupXacNhanSuaTaskDinhKy
          onClose={() => setMoXacNhanScopeDinhKy(false)}
          onConfirm={async (updateRelated) => {
            await saveTask(updateRelated);
            setMoXacNhanScopeDinhKy(false);
          }}
        />
      )}
    </Modal>
  );
}

function PopupXacNhanSuaTaskDinhKy({
  onClose,
  onConfirm
}: {
  onClose: () => void;
  onConfirm: (updateRelated: boolean) => Promise<void>;
}) {
  const { t } = useLang();
  const [scope, setScope] = useState<'single' | 'related'>('single');
  const [dangXuLy, setDangXuLy] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dangXuLy) return;
    setDangXuLy(true);
    setLoi(null);
    try {
      await onConfirm(scope === 'related');
    } catch (error) {
      setLoi(error instanceof Error ? error.message : 'Không lưu được thay đổi');
      setDangXuLy(false);
    }
  }

  return (
    <Modal onClose={onClose} nested dismissable={!dangXuLy}>
      <form className="popup w-full max-w-md" onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{t('task.confirm.change_title')}</h2>
          <button type="button" className="nut-icon" onClick={onClose} disabled={dangXuLy}>
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-sm leading-6 text-phu">{t('task.confirm.change_question')}</p>
        <div className="mb-5 grid gap-2">
          <label className="field-checkbox">
            <input
              type="radio"
              name="scope"
              checked={scope === 'single'}
              onChange={() => setScope('single')}
            />
            <span>{t('task.confirm.only_this')}</span>
          </label>
          <label className="field-checkbox">
            <input
              type="radio"
              name="scope"
              checked={scope === 'related'}
              onChange={() => setScope('related')}
            />
            <span>{t('task.confirm.all_related')}</span>
          </label>
        </div>
        {loi && (
          <p className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
            Chưa lưu được: {loi}. Hãy thử lại.
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className="nut-phu" onClick={onClose} disabled={dangXuLy}>{t('btn.cancel')}</button>
          <button className="nut-chinh" type="submit" autoFocus disabled={dangXuLy}>
            {dangXuLy ? 'Đang lưu…' : t('btn.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Export để test double-submit guard trực tiếp (Codex code-review vòng 3 §8.3), không cần dựng cả App.
export function PopupXacNhanCancel({
  task,
  onClose,
  onConfirm
}: {
  task: Task;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLang();
  const toast = useToast();
  // Chốt submit-once (Codex code-review vòng 3 §8.3): bấm 2 lần liên tiếp trước khi response đầu
  // settle KHÔNG được gọi `onConfirm()` (và qua đó `handle.cancel()`/API huỷ task) hai lần — reducer
  // no-op ở lần `cancel()` thứ hai (nhờ so khớp `reconcileId`) không thay được việc UI vẫn bắn 2 API
  // call/consume handle hai lần. `dangXuLy` khoá cả submit lẫn nút X/"Không".
  const [dangXuLy, setDangXuLy] = useState(false);
  // Codex code-review vòng 5 §13.2 — `onConfirm()` lỗi (PATCH/DELETE thật hỏng) KHÔNG được thoát ra
  // ngoài thành unhandled rejection: bắt tại ĐÚNG owner (chính popup này), hạ `dangXuLy`, GIỮ popup +
  // báo lỗi để user thử lại — không đóng, không mất `handle` (nơi gọi `onConfirm` chỉ consume handle
  // ở nhánh thành công, xem `main.tsx` `PopupXacNhanCancel` call site).
  const [loi, setLoi] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dangXuLy) return;
    setDangXuLy(true);
    setLoi(null);
    try {
      await onConfirm();
      toast('Đã hủy task');
    } catch (err) {
      setLoi(err instanceof Error ? err.message : 'Không huỷ được, thử lại');
    } finally {
      setDangXuLy(false);
    }
  }

  return (
    <Modal onClose={onClose} dismissable={!dangXuLy}>
      <form className="popup w-full max-w-md" onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{t('task.confirm.cancel_title')}</h2>
          <button type="button" className="nut-icon" onClick={onClose} disabled={dangXuLy}>
            <X size={18} />
          </button>
        </div>
        <p className="mb-5 text-sm leading-6 text-phu">
          {t('task.confirm.cancel_question')}
        </p>
        {loi && (
          <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
            Chưa huỷ được: {loi}. Bấm "{t('task.confirm.yes')}" để thử lại.
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className="nut-phu" onClick={onClose} disabled={dangXuLy}>{t('task.confirm.no')}</button>
          <button className="nut-nguy-hiem-text" type="submit" autoFocus disabled={dangXuLy}>
            {dangXuLy ? 'Đang xử lý…' : t('task.confirm.yes')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PopupXacNhanHoanThanh({
  onClose,
  onConfirm
}: {
  task: Task;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLang();
  const toast = useToast();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onConfirm();
    toast('Đã đánh dấu hoàn thành');
  }

  return (
    <Modal onClose={onClose}>
      <form className="popup w-full max-w-md" onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{t('task.confirm.complete_title')}</h2>
          <button type="button" className="nut-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="mb-5 text-sm leading-6 text-phu">{t('task.confirm.complete_question')}</p>
        <div className="flex justify-end gap-3">
          <button type="button" className="nut-phu" onClick={onClose}>{t('task.confirm.no')}</button>
          <button className="nut-chinh" type="submit" autoFocus>
            {t('task.confirm.yes')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PopupTaoTask({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const { t } = useLang();
  const toast = useToast();
  const [loaiTask, setLoaiTask] = useState<LoaiTask>('don_le');
  const [thucHienNgay, setThucHienNgay] = useState(false);
  const [ghiChu, setGhiChu] = useState('');
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [lapLaiKieu, setLapLaiKieu] = useState('hang_ngay');
  const [ngayTrongThang, setNgayTrongThang] = useState('');
  const [thuDaChon, setThuDaChon] = useState<number[]>([]);
  const [gioBatDau, setGioBatDau] = useState('09:00');
  const [gioKetThuc, setGioKetThuc] = useState('09:30');
  const [moDropdownThu, setMoDropdownThu] = useState(false);
  const dropdownThuRef = useRef<HTMLDetailsElement>(null);
  const khoaKieuLap = thuDaChon.length > 0 || ngayTrongThang !== '';

  useEffect(() => {
    if (!moDropdownThu) return;

    function dongKhiClickNgoai(event: MouseEvent) {
      if (!dropdownThuRef.current?.contains(event.target as Node)) {
        setMoDropdownThu(false);
      }
    }

    document.addEventListener('mousedown', dongKhiClickNgoai);
    return () => document.removeEventListener('mousedown', dongKhiClickNgoai);
  }, [moDropdownThu]);

  function doiLoaiTask(value: LoaiTask) {
    setLoaiTask(value);
    if (value === 'dinh_ky') {
      setThucHienNgay(false);
    }
  }

  function doiThuTrongTuan(index: number) {
    setThuDaChon((current) => {
      const next = current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((a, b) => a - b);
      setLapLaiKieu(next.length > 0 ? 'hang_tuan' : 'hang_ngay');
      if (next.length > 0) setNgayTrongThang('');
      return next;
    });
  }

  function doiNgayTrongThang(value: string) {
    if (!value) {
      setNgayTrongThang('');
      if (thuDaChon.length === 0) setLapLaiKieu('hang_ngay');
      return;
    }

    const validValue = String(Math.min(31, Math.max(1, Number(value))));
    setNgayTrongThang(validValue);
    setThuDaChon([]);
    setLapLaiKieu('hang_thang');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loaiTask === 'dinh_ky') {
      const loi = loiDinhKyKhongHopLe(lapLaiKieu, thuDaChon, ngayTrongThang);
      if (loi) {
        toast(loi, 'error');
        return;
      }
    }
    const form = new FormData(event.currentTarget);
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        tenTask: form.get('tenTask'),
        ghiChu,
        links: normalizedTaskLinks(links),
        loaiTask,
        thucHienNgay: loaiTask === 'don_le' && thucHienNgay,
        gioBatDau,
        gioKetThuc,
        lapLaiKieu,
        ngayTrongThang: ngayTrongThang ? Number(ngayTrongThang) : null,
        thuTrongTuan: thuDaChon
      })
    });
    await onCreated();
    toast('Đã tạo task mới');
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <form className="popup w-full max-w-xl" onSubmit={submit}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">{t('task.form.title_create')}</h2>
          <button type="button" className="nut-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          {t('task.form.name')}
          <input name="tenTask" required placeholder={t('task.form.name_placeholder')} />
        </label>
        <label className="field">
          {t('task.form.note')}
          <textarea
            name="ghiChu"
            value={ghiChu}
            onChange={(event) => setGhiChu(event.target.value)}
            rows={3}
            placeholder={t('task.form.note_short')}
          />
        </label>
        <div className="field">
          {t('task.form.links')}
          <TaskLinkEditor links={links} onChange={setLinks} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field">
            {t('task.form.type')}
            <select name="loaiTask" value={loaiTask} onChange={(event) => doiLoaiTask(event.target.value as LoaiTask)}>
              <option value="don_le">{t('task.form.type_single')}</option>
              <option value="dinh_ky">{t('task.form.type_recurring')}</option>
            </select>
          </label>
        </div>
        <label className="field-checkbox">
          <input
            name="thucHienNgay"
            type="checkbox"
            checked={thucHienNgay}
            disabled={loaiTask === 'dinh_ky'}
            onChange={(event) => setThucHienNgay(event.target.checked)}
          />
          <span>{t('task.form.execute_now')}</span>
        </label>
        {loaiTask === 'dinh_ky' && (
          <div className="rounded-md border border-slate-300 bg-slate-50/80 p-4">
            <p className="mb-3 text-sm font-bold">{t('task.form.repeat_settings')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                {t('task.form.start_time')}
                <TimeInput value={gioBatDau} min="07:30" max="18:00" onChange={setGioBatDau} />
              </label>
              <label className="field">
                {t('task.form.end_time')}
                <TimeInput value={gioKetThuc} min="07:30" max="18:00" onChange={setGioKetThuc} />
              </label>
              <label className="field">
                {t('task.form.recurrence_type')}
                <select name="lapLaiKieu" value={lapLaiKieu} disabled={khoaKieuLap} onChange={(event) => setLapLaiKieu(event.target.value)}>
                  <option value="hang_ngay">{t('task.form.daily')}</option>
                  <option value="thu_2_den_thu_6">{t('task.form.weekdays_only')}</option>
                  <option value="hang_tuan">{t('task.form.weekly')}</option>
                  <option value="hang_thang">{t('task.form.monthly')}</option>
                </select>
              </label>
              <div className="field">
                {t('task.form.day_of_week')}
                <details ref={dropdownThuRef} className="multi-select" open={moDropdownThu}>
                  <summary
                    onClick={(event) => {
                      event.preventDefault();
                      setMoDropdownThu((value) => !value);
                    }}
                  >
                    <span>{thuDaChon.length > 0 ? thuDaChon.map((index) => t(`weekday.${index}` as Parameters<typeof t>[0])).join(', ') : t('task.form.day_of_week_placeholder')}</span>
                  </summary>
                  <div className="multi-select-menu">
                  {weekdaysLamViec.map(({ index }) => (
                    <label key={index} className="multi-select-option">
                      <input
                        type="checkbox"
                        checked={thuDaChon.includes(index)}
                        onChange={() => doiThuTrongTuan(index)}
                      />
                      <span>{t(`weekday.${index}` as Parameters<typeof t>[0])}</span>
                    </label>
                  ))}
                  </div>
                </details>
              </div>
              <label className="field">
                {t('task.form.day_of_month')}
                <input
                  name="ngayTrongThang"
                  type="number"
                  min="1"
                  max="31"
                  placeholder="1-31"
                  value={ngayTrongThang}
                  onChange={(event) => doiNgayTrongThang(event.target.value)}
                />
              </label>
            </div>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" className="nut-phu" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="nut-chinh" type="submit">{t('btn.submit')}</button>
        </div>
      </form>
    </Modal>
  );
}

function PopupThemTaskNhanh({
  onClose,
  onPersonalCreated
}: {
  onClose: () => void;
  onPersonalCreated: () => Promise<void>;
}) {
  const { t } = useLang();
  const toast = useToast();
  // Task cá nhân (FR-31/FR-14) tự nó không gắn team gì — nhưng khu "chuyển thành task project" trong
  // popup này gọi thẳng route GET /api/projects (CR §6.2), nay bắt buộc teamId (FR-13).
  const activeTeamId = useActiveTeamId();
  const [mode, setMode] = useState<'personal' | 'project'>('personal');
  const [loaiTask, setLoaiTask] = useState<LoaiTask>('don_le');
  const [tenTask, setTenTask] = useState('');
  const [ghiChu, setGhiChu] = useState('');
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [thucHienNgay, setThucHienNgay] = useState(false);
  const [gioBatDau, setGioBatDau] = useState('09:00');
  const [gioKetThuc, setGioKetThuc] = useState('09:30');
  const [lapLaiKieu, setLapLaiKieu] = useState('hang_ngay');
  const [ngayTrongThang, setNgayTrongThang] = useState('');
  const [thuDaChon, setThuDaChon] = useState<number[]>([]);
  const [moDropdownThu, setMoDropdownThu] = useState(false);
  const dropdownThuRef = useRef<HTMLDetailsElement>(null);
  const khoaKieuLap = thuDaChon.length > 0 || ngayTrongThang !== '';
  const [isSavingPersonal, setIsSavingPersonal] = useState(false);
  const [personalError, setPersonalError] = useState('');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectTasks, setProjectTasks] = useState<ProjectTaskItem[]>([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [parentDangTao, setParentDangTao] = useState<ProjectTaskItem | null | undefined>(undefined);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const taskNumbers = useMemo(() => buildProjectTaskNumbers(projectTasks), [projectTasks]);
  const tasksByParent = useMemo(() => {
    return projectTasks.reduce<Record<string, ProjectTaskItem[]>>((groups, task) => {
      const key = task.parentId || 'root';
      groups[key] = [...(groups[key] || []), task];
      return groups;
    }, {});
  }, [projectTasks]);

  useEffect(() => {
    if (!moDropdownThu) return;
    function dongKhiClickNgoai(event: MouseEvent) {
      if (!dropdownThuRef.current?.contains(event.target as Node)) setMoDropdownThu(false);
    }
    document.addEventListener('mousedown', dongKhiClickNgoai);
    return () => document.removeEventListener('mousedown', dongKhiClickNgoai);
  }, [moDropdownThu]);

  useEffect(() => {
    if (activeTeamId == null) { setProjects([]); return; }
    let alive = true;
    apiTeam<ProjectItem[]>(activeTeamId, '/api/projects')
      .then((data) => {
        if (!alive) return;
        setProjects(data);
        setSelectedProjectId((current) => current && data.some((p) => p.id === current) ? current : data.find((p) => !p.isSystem)?.id || data[0]?.id || '');
      })
      .catch((error) => {
        if (alive) setProjectError(error instanceof Error ? error.message : t('err.project_list'));
      });
    return () => { alive = false; };
  }, [t, activeTeamId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectTasks([]);
      return;
    }
    let alive = true;
    setProjectLoading(true);
    setProjectError('');
    api<ProjectTaskItem[]>(`/api/projects/${selectedProjectId}/tasks`)
      .then((data) => { if (alive) setProjectTasks(data); })
      .catch((error) => { if (alive) setProjectError(error instanceof Error ? error.message : t('err.project_tasks')); })
      .finally(() => { if (alive) setProjectLoading(false); });
    return () => { alive = false; };
  }, [selectedProjectId, t]);

  function doiLoaiTask(value: LoaiTask) {
    setLoaiTask(value);
    if (value === 'dinh_ky') setThucHienNgay(false);
  }

  function doiThuTrongTuan(index: number) {
    setThuDaChon((current) => {
      const next = current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((a, b) => a - b);
      setLapLaiKieu(next.length > 0 ? 'hang_tuan' : 'hang_ngay');
      if (next.length > 0) setNgayTrongThang('');
      return next;
    });
  }

  function doiNgayTrongThang(value: string) {
    if (!value) {
      setNgayTrongThang('');
      if (thuDaChon.length === 0) setLapLaiKieu('hang_ngay');
      return;
    }
    const validValue = String(Math.min(31, Math.max(1, Number(value))));
    setNgayTrongThang(validValue);
    setThuDaChon([]);
    setLapLaiKieu('hang_thang');
  }

  async function submitPersonal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loaiTask === 'dinh_ky') {
      const loi = loiDinhKyKhongHopLe(lapLaiKieu, thuDaChon, ngayTrongThang);
      if (loi) {
        setPersonalError(loi);
        return;
      }
    }
    setIsSavingPersonal(true);
    setPersonalError('');
    try {
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          tenTask,
          ghiChu,
          links: normalizedTaskLinks(links),
          loaiTask,
          thucHienNgay: loaiTask === 'don_le' && thucHienNgay,
          gioBatDau,
          gioKetThuc,
          lapLaiKieu,
          ngayTrongThang: ngayTrongThang ? Number(ngayTrongThang) : null,
          thuTrongTuan: thuDaChon
        })
      });
      await onPersonalCreated();
      toast('Đã tạo task mới');
      onClose();
    } catch (error) {
      setPersonalError(error instanceof Error ? error.message : t('err.create_task'));
    } finally {
      setIsSavingPersonal(false);
    }
  }

  async function reloadProjectTasks(projectId = selectedProjectId) {
    if (!projectId) return;
    const data = await api<ProjectTaskItem[]>(`/api/projects/${projectId}/tasks`);
    setProjectTasks(data);
  }

  async function taoProjectTask(task: ProjectTaskCreateBody) {
    if (!selectedProject) return;
    await api<ProjectTaskItem>(`/api/projects/${selectedProject.id}/tasks`, {
      method: 'POST',
      body: JSON.stringify(task)
    });
    await reloadProjectTasks(selectedProject.id);
    window.dispatchEvent(new CustomEvent(quickProjectTaskCreatedEvent, { detail: { projectId: selectedProject.id } }));
    setParentDangTao(undefined);
    toast('Đã tạo task project');
  }

  function renderQuickProjectTasks(parentId: string | null, level = 1): React.ReactNode {
    const rows = tasksByParent[parentId || 'root'] || [];
    if (rows.length === 0 && level === 1) {
      return <div className="quick-add-empty">Chưa có task trong project này.</div>;
    }
    return rows.map((task) => (
      <div key={task.id} className="quick-project-task-row" style={{ paddingLeft: (level - 1) * 18 }}>
        <div className="quick-project-task-main">
          <span className="quick-project-task-number">{taskNumbers.numberById.get(task.id) || '-'}</span>
          <span className="quick-project-task-title" title={task.tieuDe}>{task.tieuDe}</span>
          <span className="quick-project-task-progress">{task.tienDo}%</span>
          <button
            type="button"
            className="quick-project-task-add"
            disabled={task.level >= 3}
            onClick={() => {
              if (task.level < 3) setParentDangTao(task);
            }}
            title={task.level >= 3 ? 'Task level 3 không thể thêm task con' : 'Thêm task con'}
            aria-label={task.level >= 3 ? 'Task level 3 không thể thêm task con' : 'Thêm task con'}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="quick-project-task-children">
          {renderQuickProjectTasks(task.id, level + 1)}
        </div>
      </div>
    ));
  }

  return (
    <Modal onClose={onClose}>
      <section className="popup quick-add-popup">
        <div className="quick-add-header">
          <div>
            <h2 className="text-xl font-bold">Thêm task nhanh</h2>
          </div>
          <div className="quick-add-type-bar" aria-label="Task type">
            <button
              type="button"
              className={`quick-add-type-button ${mode === 'personal' ? 'quick-add-type-button-active' : ''}`}
              onClick={() => setMode('personal')}
            >
              Tasks
            </button>
            <button
              type="button"
              className={`quick-add-type-button ${mode === 'project' ? 'quick-add-type-button-active' : ''}`}
              onClick={() => setMode('project')}
            >
              Project
            </button>
          </div>
          <button type="button" className="nut-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="quick-add-body">
          {mode === 'personal' ? (
            <form className="quick-add-panel" onSubmit={submitPersonal}>
              <label className="field">
                {t('task.form.name')}
                <input value={tenTask} disabled={isSavingPersonal} onChange={(event) => setTenTask(event.target.value)} required autoFocus placeholder={t('task.form.name_placeholder')} />
              </label>
              <label className="field">
                {t('task.form.note')}
                <textarea value={ghiChu} disabled={isSavingPersonal} onChange={(event) => setGhiChu(event.target.value)} rows={4} placeholder={t('task.form.note_short')} />
              </label>
              <div className="field">
                {t('task.form.links')}
                <TaskLinkEditor links={links} onChange={setLinks} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field">
                  {t('task.form.type')}
                  <select value={loaiTask} disabled={isSavingPersonal} onChange={(event) => doiLoaiTask(event.target.value as LoaiTask)}>
                    <option value="don_le">{t('task.form.type_single')}</option>
                    <option value="dinh_ky">{t('task.form.type_recurring')}</option>
                  </select>
                </label>
                <label className="field-checkbox mt-6">
                  <input type="checkbox" checked={thucHienNgay} disabled={isSavingPersonal || loaiTask === 'dinh_ky'} onChange={(event) => setThucHienNgay(event.target.checked)} />
                  <span>{t('task.form.execute_now')}</span>
                </label>
              </div>
              {loaiTask === 'dinh_ky' && (
                <div className="rounded-md border border-slate-300 bg-slate-50/80 p-4">
                  <p className="mb-3 text-sm font-bold">{t('task.form.repeat_settings')}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="field">
                      {t('task.form.start_time')}
                      <TimeInput value={gioBatDau} min="07:30" max="18:00" disabled={isSavingPersonal} onChange={setGioBatDau} />
                    </label>
                    <label className="field">
                      {t('task.form.end_time')}
                      <TimeInput value={gioKetThuc} min="07:30" max="18:00" disabled={isSavingPersonal} onChange={setGioKetThuc} />
                    </label>
                    <label className="field">
                      {t('task.form.recurrence_type')}
                      <select value={lapLaiKieu} disabled={isSavingPersonal || khoaKieuLap} onChange={(event) => setLapLaiKieu(event.target.value)}>
                        <option value="hang_ngay">{t('task.form.daily')}</option>
                        <option value="thu_2_den_thu_6">{t('task.form.weekdays_only')}</option>
                        <option value="hang_tuan">{t('task.form.weekly')}</option>
                        <option value="hang_thang">{t('task.form.monthly')}</option>
                      </select>
                    </label>
                    <div className="field">
                      {t('task.form.day_of_week')}
                      <details ref={dropdownThuRef} className="multi-select" open={moDropdownThu}>
                        <summary onClick={(event) => { event.preventDefault(); if (!isSavingPersonal) setMoDropdownThu((value) => !value); }}>
                          <span>{thuDaChon.length > 0 ? thuDaChon.map((index) => t(`weekday.${index}` as Parameters<typeof t>[0])).join(', ') : t('task.form.day_of_week_placeholder')}</span>
                        </summary>
                        <div className="multi-select-menu">
                          {weekdaysLamViec.map(({ index }) => (
                            <label key={index} className="multi-select-option">
                              <input type="checkbox" checked={thuDaChon.includes(index)} disabled={isSavingPersonal} onChange={() => doiThuTrongTuan(index)} />
                              <span>{t(`weekday.${index}` as Parameters<typeof t>[0])}</span>
                            </label>
                          ))}
                        </div>
                      </details>
                    </div>
                    <label className="field">
                      {t('task.form.day_of_month')}
                      <input type="number" min="1" max="31" placeholder="1-31" value={ngayTrongThang} disabled={isSavingPersonal} onChange={(event) => doiNgayTrongThang(event.target.value)} />
                    </label>
                  </div>
                </div>
              )}
              {personalError && <p className="release-error">{personalError}</p>}
              <div className="quick-add-footer">
                <button type="button" className="nut-phu" disabled={isSavingPersonal} onClick={onClose}>{t('btn.cancel')}</button>
                <button className="nut-chinh" type="submit" disabled={isSavingPersonal}>{t('btn.submit')}</button>
              </div>
            </form>
          ) : (
            <div className="quick-add-panel quick-add-project-panel">
              <div className="quick-project-columns">
                <div className="quick-project-list">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className={`quick-project-item ${selectedProjectId === project.id ? 'quick-project-item-active' : ''}`}
                      onClick={() => setSelectedProjectId(project.id)}
                    >
                      <span>{project.ten}</span>
                      <small>{project.pic || '-'}</small>
                    </button>
                  ))}
                  {projects.length === 0 && <div className="quick-add-empty">{t('empty.project')}</div>}
                </div>
                <div className="quick-project-task-list">
                  <div className="quick-project-task-toolbar">
                    <div className="min-w-0">
                      <h3>{selectedProject?.ten || t('project.no_selected')}</h3>
                      <p>{projectTasks.length} task</p>
                    </div>
                    {selectedProject && !selectedProject.isSystem && (
                      <button type="button" className="quick-project-level1-add" onClick={() => setParentDangTao(null)} title={t('project.add_task_l1')} aria-label={t('project.add_task_l1')}>
                        <Plus size={24} />
                      </button>
                    )}
                  </div>
                  {projectLoading && <div className="quick-add-empty">{t('loading.project')}</div>}
                  {!projectLoading && projectError && <div className="quick-add-empty quick-add-error">{projectError}</div>}
                  {/* Project hệ thống "Khác": việc lẻ 1 level -> không liệt kê task cũ, chỉ 1 nút tạo task mới. */}
                  {!projectLoading && !projectError && selectedProject?.isSystem && (
                    <div className="quick-project-khac-create">
                      <button type="button" className="nut-chinh" onClick={() => setParentDangTao(null)}>
                        <Plus size={18} /> Tạo task mới trong &quot;{selectedProject.ten}&quot;
                      </button>
                    </div>
                  )}
                  {!projectLoading && !projectError && !selectedProject?.isSystem && renderQuickProjectTasks(null)}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
      {parentDangTao !== undefined && selectedProject && (
        <PopupTaoProjectTask
          project={selectedProject}
          parentTask={parentDangTao}
          onClose={() => setParentDangTao(undefined)}
          onCreated={taoProjectTask}
          nested
          skipEmptyAssignmentConfirm
        />
      )}
    </Modal>
  );
}

function PopupLichSu({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const { t } = useLang();
  const [tuKhoaNhap, setTuKhoaNhap] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [trangHienTai, setTrangHienTai] = useState(1);
  const [ketQuaDb, setKetQuaDb] = useState<Task[]>(tasks);
  const [taskLichSuDangXem, setTaskLichSuDangXem] = useState<Task | null>(null);
  const soRecordMoiTrang = 25;
  const filtered = useMemo(() => {
    if (sort) return sapXepTask(ketQuaDb, sort);
    return [...ketQuaDb].sort((a, b) => new Date(b.ngayHoanThanh || 0).getTime() - new Date(a.ngayHoanThanh || 0).getTime());
  }, [ketQuaDb, sort]);
  const tongTrang = Math.max(1, Math.ceil(filtered.length / soRecordMoiTrang));
  const trangHopLe = Math.min(trangHienTai, tongTrang);
  const lichSuTrang = filtered.slice((trangHopLe - 1) * soRecordMoiTrang, trangHopLe * soRecordMoiTrang);

  useEffect(() => {
    setTrangHienTai(1);
  }, [keyword, sort]);

  function submitSearch(event?: React.FormEvent) {
    event?.preventDefault();
    setKeyword(tuKhoaNhap.trim());
  }

  useEffect(() => {
    let active = true;
    api<Task[]>(`/api/history?keyword=${encodeURIComponent(keyword)}`)
      .then((result) => {
        if (active) setKetQuaDb(result);
      });
    return () => {
      active = false;
    };
  }, [keyword]);

  return (
    <Modal onClose={onClose}>
      <section className="popup flex h-[min(900px,calc(100vh-24px))] w-[min(1500px,calc(100vw-24px))] flex-col">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{t('history.title')}</h2>
            <p className="text-sm text-phu">{t('history.subtitle')}</p>
          </div>
          <button className="nut-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <form className="search-box" onSubmit={submitSearch}>
            <button type="submit" className="text-phu transition hover:text-sky-700" title={t('history.search_title')}>
              <Search size={16} />
            </button>
            <input value={tuKhoaNhap} onChange={(event) => setTuKhoaNhap(event.target.value)} placeholder={t('history.search_placeholder')} />
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-phu">{t('history.sort_by')}</span>
            <button className={sortButtonClass(sort, 'ngayTao')} onClick={() => setSort((current) => taoSortHienTai(current, 'ngayTao'))}>
              <SortIcon sort={sort} truong="ngayTao" /> {t('history.sort.created')}
            </button>
            <button className={sortButtonClass(sort, 'ngayHoanThanh')} onClick={() => setSort((current) => taoSortHienTai(current, 'ngayHoanThanh'))}>
              <SortIcon sort={sort} truong="ngayHoanThanh" /> {t('history.sort.completed')}
            </button>
            {sort && <button className="nut-huy" onClick={() => setSort(null)}><X size={14} /></button>}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-vien">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-phu">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">{t('history.col.name')}</th>
                <th className="px-4 py-3">{t('history.col.note')}</th>
                <th className="px-4 py-3">{t('history.col.created')}</th>
                <th className="px-4 py-3">{t('history.col.completed')}</th>
                <th className="px-4 py-3">{t('history.col.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vien bg-white">
              {lichSuTrang.map((task, index) => (
                <tr key={task.id} className="h-11 cursor-pointer hover:bg-slate-50" onClick={() => setTaskLichSuDangXem(task)}>
                  <td className="px-4 py-2">{(trangHopLe - 1) * soRecordMoiTrang + index + 1}</td>
                  <td className="max-w-[260px] truncate px-4 py-2 font-semibold">{task.tenTask}</td>
                  <td className="max-w-[420px] px-4 py-2 text-phu">
                    <div className="note-inline-preview">
                      <p className="truncate">
                        {task.ghiChu || '-'}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-2">{dinhDangNgay(task.ngayTao)}</td>
                  <td className="px-4 py-2">{dinhDangNgay(task.ngayHoanThanh)}</td>
                  <td className="px-4 py-2">{tenTrangThai[task.trangThai]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-phu">
          <span>
            {t('history.count_prefix')}{lichSuTrang.length} / {filtered.length}{t('history.count_suffix')}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="nut-phu"
              disabled={trangHopLe === 1}
              onClick={() => setTrangHienTai((value) => Math.max(1, value - 1))}
            >
              {t('history.prev')}
            </button>
            <span className="rounded-md bg-slate-100 px-3 py-2 font-bold text-muc">
              {trangHopLe} / {tongTrang}
            </span>
            <button
              className="nut-phu"
              disabled={trangHopLe === tongTrang}
              onClick={() => setTrangHienTai((value) => Math.min(tongTrang, value + 1))}
            >
              {t('history.next')}
            </button>
          </div>
        </div>
        {taskLichSuDangXem && (
          <PopupChiTietLichSu task={taskLichSuDangXem} onClose={() => setTaskLichSuDangXem(null)} />
        )}
      </section>
    </Modal>
  );
}

function PopupChiTietLichSu({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t } = useLang();
  return (
    <Modal onClose={onClose}>
      <section className="popup w-full max-w-4xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">{t('history.detail_title')}</h2>
          <button type="button" className="nut-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field-readonly sm:col-span-2">
            <span>{t('history.col.name')}</span>
            <p>{task.tenTask}</p>
          </div>
          <div className="field-readonly sm:col-span-2">
            <span>{t('history.col.note')}</span>
            <p className="min-h-36 whitespace-pre-wrap">
              {task.ghiChu || '-'}
            </p>
          </div>
          <div className="field-readonly">
            <span>{t('history.col.status')}</span>
            <p>{trangThaiLabel(task.trangThai, t)}</p>
          </div>
          <div className="field-readonly">
            <span>{t('history.col.created')}</span>
            <p>{dinhDangNgay(task.ngayTao)}</p>
          </div>
          <div className="field-readonly">
            <span>{t('history.col.completed')}</span>
            <p>{dinhDangNgay(task.ngayHoanThanh)}</p>
          </div>
        </div>
      </section>
    </Modal>
  );
}
