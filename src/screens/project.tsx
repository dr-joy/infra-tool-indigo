// Màn hình "Dự án" (Project): danh sách project + cây task + Gantt + roadmap.
// Tách khỏi main.tsx (khối ~2.500 dòng). Chỉ ManHinhProject được export; các popup/
// helper Gantt + lịch âm là nội bộ màn này. Phụ thuộc chỉ hướng tới module trung lập.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp, ArrowDownWideNarrow, ArrowUpNarrowWide, Bell, CalendarDays, CalendarRange, Check,
  ChartGantt, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, FileSpreadsheet, Github,
  GripVertical, History, Info, Paperclip, Pencil, Plus, Rocket, Search, Target, Trash2, X
} from 'lucide-react';
import { useLang } from '../useLang';
import type { TranslationKey } from '../i18n';
import { InfoTip, TimeInput } from '../ui';
import { api, apiTeam, ApiError } from '../api';
import { useActiveTeamId } from '../auth-context';
import { Modal } from '../components/Modal';
import { CopyNoteButton, TaskLinkIcon, TaskLinkBadges, TaskLinkEditor, SortIcon } from '../components/task-atoms';
import { PopupTaoProjectTask, PopupXacNhanXoa } from '../components/dialogs';
import { usePics, useToast } from '../context';
import {
  taoNgayTuInput, localDateInputValue, mondayOfWeek, congNgayInput, congThangInput,
  currentVietnamDateInputValue, dinhDangNgay, dinhDangNgayDayDu, addDays,
  timeToMinutes, minutesToTime, snapMinutes, clamp
} from '../lib/date';
import {
  PIC_COLOR_PALETTE, projectTaskProgressOptions, progressSelectOptions, splitAssignees, clientAutoStatus,
  parseGoalConflict, goalConflictMessage, buildProjectTaskNumbers, normalizedTaskLinks, taskLinkHref,
  quickProjectTaskCreatedEvent, tenTrangThai, trangThaiLabel, sapXepTask, taoSortHienTai, sortButtonClass,
  taskLinkTypeLabels, maxTaskLinks
} from '../lib/task-utils';
import type {
  ProjectItem, ProjectTaskItem, ProjectTaskAssignment, ProjectTaskProgress, ProjectCreateBody,
  ProjectTaskCreateBody, Task, TaskLink, TaskLinkType, DuLieuDashboard, SortState, TruongSort, HuongSort, PicItem
} from '../types';

function khoangCachNgay(start: string, end: string) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round((taoNgayTuInput(end).getTime() - taoNgayTuInput(start).getTime()) / oneDay);
}

function dauTuanInput(value: string) {
  return localDateInputValue(mondayOfWeek(taoNgayTuInput(value)));
}

function cuoiTuanInput(value: string) {
  return congNgayInput(dauTuanInput(value), 6);
}

function tuanTrongNam(value: string) {
  const date = taoNgayTuInput(value);
  const year = date.getFullYear();
  return Math.floor(khoangCachNgay(dauTuanInput(`${year}-01-01`), dauTuanInput(value)) / 7) + 1;
}

function jdFromDate(day: number, month: number, year: number) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  let jd = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  if (jd < 2299161) jd = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
  return jd;
}

function newMoon(k: number) {
  const t = k / 1236.85;
  const t2 = t * t;
  const t3 = t2 * t;
  const dr = Math.PI / 180;
  let jd = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3;
  jd += 0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * dr);
  const m = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3;
  const mpr = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3;
  const f = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3;
  let c1 = (0.1734 - 0.000393 * t) * Math.sin(m * dr) + 0.0021 * Math.sin(2 * dr * m);
  c1 -= 0.4068 * Math.sin(mpr * dr) + 0.0161 * Math.sin(2 * dr * mpr);
  c1 -= 0.0004 * Math.sin(3 * dr * mpr);
  c1 += 0.0104 * Math.sin(2 * dr * f) - 0.0051 * Math.sin((m + mpr) * dr);
  c1 -= 0.0074 * Math.sin((m - mpr) * dr) + 0.0004 * Math.sin((2 * f + m) * dr);
  c1 -= 0.0004 * Math.sin((2 * f - m) * dr) - 0.0006 * Math.sin((2 * f + mpr) * dr);
  c1 += 0.0010 * Math.sin((2 * f - mpr) * dr) + 0.0005 * Math.sin((2 * mpr + m) * dr);
  const deltaT = t < -11 ? 0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t * t3 : -0.000278 + 0.000265 * t + 0.000262 * t2;
  return jd + c1 - deltaT;
}

function sunLongitude(jdn: number) {
  const t = (jdn - 2451545.0) / 36525;
  const t2 = t * t;
  const dr = Math.PI / 180;
  const m = 357.52910 + 35999.05030 * t - 0.0001559 * t2 - 0.00000048 * t2 * t;
  const l0 = 280.46645 + 36000.76983 * t + 0.0003032 * t2;
  let dl = (1.914600 - 0.004817 * t - 0.000014 * t2) * Math.sin(dr * m);
  dl += (0.019993 - 0.000101 * t) * Math.sin(2 * dr * m) + 0.000290 * Math.sin(3 * dr * m);
  let l = (l0 + dl) * dr;
  l -= Math.PI * 2 * Math.floor(l / (Math.PI * 2));
  return l;
}

function getNewMoonDay(k: number, timeZone: number) {
  return Math.floor(newMoon(k) + 0.5 + timeZone / 24);
}

function getSunLongitude(dayNumber: number, timeZone: number) {
  return Math.floor(sunLongitude(dayNumber - 0.5 - timeZone / 24) / Math.PI * 6);
}

function getLunarMonth11(year: number, timeZone: number) {
  const off = jdFromDate(31, 12, year) - 2415021;
  const k = Math.floor(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  const sunLong = getSunLongitude(nm, timeZone);
  if (sunLong >= 9) nm = getNewMoonDay(k - 1, timeZone);
  return nm;
}

function getLeapMonthOffset(a11: number, timeZone: number) {
  const k = Math.floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i += 1;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

function lunarDateOf(value: string) {
  const date = taoNgayTuInput(value);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const timeZone = 7;
  const dayNumber = jdFromDate(day, month, year);
  const k = Math.floor((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) monthStart = getNewMoonDay(k, timeZone);
  let a11 = getLunarMonth11(year, timeZone);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = year;
    a11 = getLunarMonth11(year - 1, timeZone);
  } else {
    lunarYear = year + 1;
    b11 = getLunarMonth11(year + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = Math.floor((monthStart - a11) / 29);
  let lunarLeap = false;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) lunarLeap = true;
    }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap };
}

function isVietnamPublicHoliday(value: string) {
  const [, month, day] = value.split('-');
  if (['01-01', '04-30', '05-01', '09-02', '09-03'].includes(`${month}-${day}`)) return true;
  const lunar = lunarDateOf(value);
  if (lunar.leap) return false;
  if (lunar.month === 1 && lunar.day >= 1 && lunar.day <= 5) return true;
  if (lunar.month === 3 && lunar.day === 10) return true;
  return false;
}

function thuTrongTuanGantt(value: string) {
  const weekday = taoNgayTuInput(value).getDay();
  if (weekday === 0 || isVietnamPublicHoliday(value)) return { label: weekday === 0 ? 'CN' : taoNgayTuInput(value).toLocaleDateString('vi-VN', { weekday: 'short' }), className: 'project-gantt-day-sunday' };
  if (weekday === 6) return { label: 'Thứ 7', className: 'project-gantt-day-saturday' };
  return { label: taoNgayTuInput(value).toLocaleDateString('vi-VN', { weekday: 'short' }), className: '' };
}

export function ManHinhProject({ openGanttOnMount = false }: { openGanttOnMount?: boolean }) {
  const { t } = useLang();
  // CR-20260913 FR-13 — mọi màn nghiệp vụ hiển thị theo đúng team đang chọn (server/routes/projects.ts
  // §6.2: GET /projects, GET /projects/closed, POST /projects, PATCH /projects/reorder bắt buộc teamId).
  const activeTeamId = useActiveTeamId();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  // Cho phép deep-link tới 1 project qua ?project=<id>
  const [projectDangChon, setProjectDangChon] = useState(() => new URLSearchParams(window.location.search).get('project') || '');
  const [projectTasks, setProjectTasks] = useState<ProjectTaskItem[]>([]);
  const [goalTaskIds, setGoalTaskIds] = useState<Set<string>>(new Set());
  const [atRiskTaskIds, setAtRiskTaskIds] = useState<Set<string>>(new Set());
  const [moTaoProject, setMoTaoProject] = useState(false);
  const [projectDangSua, setProjectDangSua] = useState<ProjectItem | null>(null);
  const [projectDangXoa, setProjectDangXoa] = useState<ProjectItem | null>(null);
  const [taskParentDangTao, setTaskParentDangTao] = useState<ProjectTaskItem | null>(null);
  const [projectTaskDangSua, setProjectTaskDangSua] = useState<ProjectTaskItem | null>(null);
  const [projectTaskDangXoa, setProjectTaskDangXoa] = useState<ProjectTaskItem | null>(null);
  const [moTaoProjectTask, setMoTaoProjectTask] = useState(false);
  const [moThongTinProject, setMoThongTinProject] = useState(false);
  const [moRoadmapProject, setMoRoadmapProject] = useState(false);
  const [moLichSuProjectClose, setMoLichSuProjectClose] = useState(false);
  const [roadmapTasksByProject, setRoadmapTasksByProject] = useState<Record<string, ProjectTaskItem[]>>({});
  const [dangTaiRoadmap, setDangTaiRoadmap] = useState(false);
  const [roadmapError, setRoadmapError] = useState('');
  // Gantt tổng (mọi project, lọc theo project/PIC)
  const [moGanttTong, setMoGanttTong] = useState(false);
  const [ganttTongTasks, setGanttTongTasks] = useState<Record<string, ProjectTaskItem[]>>({});
  const [dangTaiGanttTong, setDangTaiGanttTong] = useState(false);
  const [ganttTongError, setGanttTongError] = useState('');
  const [ganttTongTaskDangSua, setGanttTongTaskDangSua] = useState<ProjectTaskItem | null>(null);
  const autoOpenedGanttRef = useRef(false);
  const [closedProjects, setClosedProjects] = useState<ProjectItem[]>([]);
  const [dangTaiClosedProjects, setDangTaiClosedProjects] = useState(false);
  const [closedProjectsError, setClosedProjectsError] = useState('');
  const [dangTaiProject, setDangTaiProject] = useState(true);
  const [dangTaiProjectTask, setDangTaiProjectTask] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [projectTaskError, setProjectTaskError] = useState('');
  const [hienThiDanhSachProject, setHienThiDanhSachProject] = useState(true);
  const [projectDangKeo, setProjectDangKeo] = useState<string | null>(null);
  // 2026-09-26 (Council, run 9c9f21c4) — CHỈ project hệ thống "Khác": mặc định ẩn task đã xong 100%
  // ở danh sách chính (project này không có khái niệm dọn/archive, cứ dài mãi theo thời gian). Nút
  // "Hiện N task đã xong" bấm 1 chiều trong 1 lần mở; không nhớ giữa các lần mở (reset cùng effect
  // nạp lại projectTasks bên dưới).
  const [showCompletedInKhac, setShowCompletedInKhac] = useState(false);
  const selectedProject = projects.find((project) => project.id === projectDangChon);
  const projectTaskSummary = useMemo(() => {
    const parentIds = new Set(projectTasks.map((task) => task.parentId).filter((value): value is string => Boolean(value)));
    const estimateTasks = projectTasks.filter((task) => !parentIds.has(task.id));
    const estimateReadyTasks = estimateTasks.filter((task) => task.estimateHours != null && task.estimateHours > 1);
    const totalHours = estimateReadyTasks.reduce((total, task) => total + Math.max(0, task.estimateHours || 0), 0);
    const hasTaskWithoutEstimate = estimateTasks.some((task) => task.estimateHours == null);
    const completedHours = estimateTasks.reduce((total, task) => {
      if (task.estimateHours == null || task.estimateHours <= 1) return total;
      const estimateHours = Math.max(0, task.estimateHours);
      const progress = Math.max(0, Math.min(100, task.tienDo));
      return total + (estimateHours * progress / 100);
    }, 0);
    const projectProgress = totalHours > 0 ? completedHours / totalHours * 100 : 0;
    const manDays = totalHours / 7;
    const manMonths = manDays / 20;
    return {
      totalTasks: estimateTasks.length,
      totalHours,
      roundedTotalHours: Math.round(totalHours),
      completedHours,
      projectProgress,
      roundedProjectProgress: Math.round(projectProgress),
      hasTaskWithoutEstimate,
      manDays,
      roundedManDays: Math.round(manDays),
      manMonths,
      roundedManMonths: Math.round(manMonths)
    };
  }, [projectTasks]);

  // Chỉ tính cho project "Khác" — project thường không đổi hành vi gì (Council run 9c9f21c4).
  const completedTaskIdsInKhac = useMemo(() => {
    if (!selectedProject?.isSystem) return new Set<string>();
    return new Set(projectTasks.filter((task) => task.tienDo === 100).map((task) => task.id));
  }, [selectedProject?.isSystem, projectTasks]);

  // aliveRef: cờ huỷ (cancellation guard) — chỉ dùng khi gọi TỪ effect nạp theo activeTeamId bên
  // dưới. Đổi team nhanh (A -> B trước khi response của A về) khiến response cũ của A có thể set
  // state SAU khi đã hiển thị team B; effect cleanup đặt aliveRef.current = false để response trễ tự
  // bỏ qua, không ghi đè dữ liệu team đang xem (Council review Lát 7 giai đoạn 1, race condition khi
  // đổi team nhanh). Các nơi khác gọi 2 hàm này (nút bấm, sự kiện quick-add...) không truyền aliveRef
  // nên hành vi giữ nguyên như trước.
  async function taiProjects(aliveRef?: { current: boolean }) {
    if (activeTeamId == null) return;
    setDangTaiProject(true);
    try {
      const data = await apiTeam<ProjectItem[]>(activeTeamId, '/api/projects');
      if (aliveRef && !aliveRef.current) return;
      setProjects(data);
      setProjectDangChon((current) => current && data.some((project) => project.id === current) ? current : data[0]?.id || '');
      setProjectError('');
    } catch (error) {
      if (aliveRef && !aliveRef.current) return;
      setProjectError(error instanceof Error ? error.message : t('err.project_list'));
    } finally {
      if (!aliveRef || aliveRef.current) setDangTaiProject(false);
    }
  }

  // Badge 🎯 = mục tiêu của tuần có mục tiêu mới nhất, chưa 100%.
  // Báo đỏ = carry-over chưa xử lý (không được duyệt tiếp, chưa reschedule).
  async function taiBadgeIds(aliveRef?: { current: boolean }) {
    if (activeTeamId == null) return;
    try {
      const [goalIds, riskIds] = await Promise.all([
        apiTeam<string[]>(activeTeamId, '/api/weeks/goal-badge-ids'),
        apiTeam<string[]>(activeTeamId, '/api/weeks/at-risk-ids')
      ]);
      if (aliveRef && !aliveRef.current) return;
      setGoalTaskIds(new Set(goalIds));
      setAtRiskTaskIds(new Set(riskIds));
    } catch { /* ignore */ }
  }

  // Component này mount lại mỗi lần mở tab project nên badge luôn được làm mới. Thêm activeTeamId vào
  // dependency (FR-13): đổi team ở bộ chọn phải tự nạp lại, KHÔNG tải lại trang. aliveRef bị dọn
  // (false) khi effect cleanup chạy (đổi team lần nữa hoặc unmount) -> response trễ của team cũ bị bỏ.
  useEffect(() => {
    const aliveRef = { current: true };
    // Reset ngay để không hiện project/badge của team cũ trong lúc team mới đang tải: projects.map()
    // ở sidebar và goalTaskIds/atRiskTaskIds không có gate riêng theo dangTaiProject, nên nếu không
    // reset thì dữ liệu team cũ vẫn hiện tới khi fetch team mới xong (Council review Lát 7 giai đoạn
    // 1, vòng 2 — điểm "dữ liệu team cũ hiện thoáng qua").
    setProjects([]);
    setGoalTaskIds(new Set());
    setAtRiskTaskIds(new Set());
    void taiProjects(aliveRef);
    void taiBadgeIds(aliveRef);
    return () => { aliveRef.current = false; };
  }, [activeTeamId]);

  // Thêm activeTeamId vào dependency (Council review Lát 7 giai đoạn 1, vòng 2): trước đây effect
  // này chỉ phụ thuộc [projectDangChon] nên đổi team nhanh trong lúc đang mở chi tiết 1 project KHÔNG
  // làm effect này chạy lại/cleanup -> response taiProjectTasks cũ (gọi lúc còn ở team trước) có thể
  // set state SAU khi đã ở team mới. aliveRef bị dọn (false) khi effect cleanup chạy (đổi
  // project/team lần nữa hoặc unmount) -> response trễ tự bỏ qua, khớp pattern taiProjects/taiBadgeIds
  // ở trên.
  useEffect(() => {
    if (!projectDangChon) {
      setProjectTasks([]);
      setProjectTaskError('');
      return;
    }
    const aliveRef = { current: true };
    // Reset ngay: ProjectTaskTree (dưới) chỉ ẩn theo dangTaiProjectTask khi projectTasks ĐANG rỗng
    // (`dangTaiProjectTask && projectTasks.length === 0`), nên nếu không reset thì cây task của
    // project/team cũ vẫn hiện dưới tiêu đề project mới tới khi fetch xong.
    setProjectTasks([]);
    setProjectTaskError('');
    setShowCompletedInKhac(false);
    void taiProjectTasks(projectDangChon, aliveRef);
    return () => { aliveRef.current = false; };
  }, [projectDangChon, activeTeamId]);

  async function taoProject(project: ProjectCreateBody) {
    if (activeTeamId == null) throw new Error('Chưa chọn team hiện tại');
    const newProject = await apiTeam<ProjectItem>(activeTeamId, '/api/projects', {
      method: 'POST',
      body: JSON.stringify(project)
    });
    setProjects((current) => [...current, newProject]);
    setProjectDangChon(newProject.id);
    setMoTaoProject(false);
  }

  async function capNhatProject(project: ProjectCreateBody) {
    if (!projectDangSua) return;
    const updatedProject = await api<ProjectItem>(`/api/projects/${projectDangSua.id}`, {
      method: 'PATCH',
      body: JSON.stringify(project)
    });
    setProjects((current) => current.map((item) => item.id === updatedProject.id ? updatedProject : item));
    setProjectDangSua(null);
  }

  async function closeProject(project: ProjectItem) {
    const closedProject = await api<ProjectItem>(`/api/projects/${project.id}/close`, { method: 'PATCH' });
    setProjects((current) => {
      const next = current.filter((item) => item.id !== project.id);
      setProjectDangChon((currentId) => currentId === project.id ? next[0]?.id || '' : currentId);
      return next;
    });
    setClosedProjects((current) => [closedProject, ...current.filter((item) => item.id !== closedProject.id)]);
    setProjectDangSua(null);
  }

  async function pendingProject(project: ProjectItem) {
    const pending = await api<ProjectItem>(`/api/projects/${project.id}/pending`, { method: 'PATCH' });
    setProjects((current) => {
      const next = current.filter((item) => item.id !== project.id);
      setProjectDangChon((currentId) => currentId === project.id ? next[0]?.id || '' : currentId);
      return next;
    });
    setClosedProjects((current) => [pending, ...current.filter((item) => item.id !== pending.id)]);
    setProjectDangSua(null);
  }

  async function restorePendingProject(project: ProjectItem) {
    const restored = await api<ProjectItem>(`/api/projects/${project.id}/restore`, { method: 'PATCH' });
    setClosedProjects((current) => current.filter((item) => item.id !== restored.id));
    await taiProjects();
    setProjectDangChon(restored.id);
  }

  async function xoaProject(project: ProjectItem) {
    await api(`/api/projects/${project.id}`, { method: 'DELETE' });
    setProjects((current) => {
      const next = current.filter((item) => item.id !== project.id);
      setProjectDangChon((currentId) => currentId === project.id ? next[0]?.id || '' : currentId);
      return next;
    });
    setProjectDangXoa(null);
  }

  async function sapXepProjects(projectIds: string[]) {
    const previousProjects = projects;
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const nextProjects = projectIds
      .map((projectId, index) => {
        const project = projectById.get(projectId);
        return project ? { ...project, sortOrder: index + 1 } : null;
      })
      .filter((project): project is ProjectItem => Boolean(project));
    if (nextProjects.length !== projects.length) return;

    if (activeTeamId == null) return;
    setProjects(nextProjects);
    try {
      const data = await apiTeam<ProjectItem[]>(activeTeamId, '/api/projects/reorder', {
        method: 'PATCH',
        body: JSON.stringify({ projectIds })
      });
      setProjects(data);
      setProjectError('');
    } catch (error) {
      setProjects(previousProjects);
      setProjectError(error instanceof Error ? error.message : t('err.sort_project'));
    }
  }

  function dropProject(targetProjectId: string) {
    if (!projectDangKeo || projectDangKeo === targetProjectId) {
      setProjectDangKeo(null);
      return;
    }
    const sourceIndex = projects.findIndex((project) => project.id === projectDangKeo);
    const targetIndex = projects.findIndex((project) => project.id === targetProjectId);
    if (sourceIndex < 0 || targetIndex < 0) {
      setProjectDangKeo(null);
      return;
    }
    const nextProjectIds = projects.map((project) => project.id);
    const [movedProjectId] = nextProjectIds.splice(sourceIndex, 1);
    nextProjectIds.splice(targetIndex, 0, movedProjectId);
    setProjectDangKeo(null);
    void sapXepProjects(nextProjectIds);
  }

  // aliveRef: cờ huỷ (cancellation guard) — chỉ dùng khi gọi TỪ effect nạp theo [projectDangChon,
  // activeTeamId] bên trên. Đổi team nhanh trong lúc đang mở chi tiết 1 project khiến response cũ có
  // thể set state SAU khi đã ở team mới; effect cleanup đặt aliveRef.current = false để response trễ
  // tự bỏ qua (Council review Lát 7 giai đoạn 1, vòng 2). Các nơi khác gọi hàm này (sau tạo/sửa/xoá
  // task, sau đổi assignment trên Gantt tổng...) không truyền aliveRef -> giữ nguyên hành vi cũ, vì đó
  // là thao tác người dùng chủ động, đã chắc chắn đang ở đúng project/team lúc bấm.
  // Đổi sang apiTeam() (thay vì api() trần như trước) để lỗi quyền (NOT_TEAM_MEMBER/ROLE_FORBIDDEN)
  // mang được ApiError.teamId — AuthProvider (auth-context.tsx) dựa vào đó để nhận ra lỗi trễ của
  // team đã rời đi, không hiện nhầm popup "mất quyền". Route GET /projects/:id/tasks tự suy team từ
  // bản ghi project (không đọc query teamId, xem server/routes/projects.ts) nên teamId gắn thêm ở đây
  // chỉ phục vụ đúng mục đích gắn nhãn lỗi phía client, không đổi hành vi server.
  async function taiProjectTasks(projectId: string, aliveRef?: { current: boolean }) {
    if (activeTeamId == null) return;
    setDangTaiProjectTask(true);
    try {
      const data = await apiTeam<ProjectTaskItem[]>(activeTeamId, `/api/projects/${projectId}/tasks`);
      if (aliveRef && !aliveRef.current) return;
      setProjectTasks(data);
      setProjectTaskError('');
    } catch (error) {
      if (aliveRef && !aliveRef.current) return;
      setProjectTaskError(error instanceof Error ? error.message : t('err.project_tasks'));
    } finally {
      if (!aliveRef || aliveRef.current) setDangTaiProjectTask(false);
    }
  }

  function moPopupTaoProjectTask(parent: ProjectTaskItem | null) {
    setTaskParentDangTao(parent);
    setMoTaoProjectTask(true);
  }

  async function taoProjectTask(task: ProjectTaskCreateBody) {
    if (!selectedProject) return;
    await api<ProjectTaskItem>(`/api/projects/${selectedProject.id}/tasks`, {
      method: 'POST',
      body: JSON.stringify(task)
    });
    await taiProjectTasks(selectedProject.id);
    setMoTaoProjectTask(false);
    setTaskParentDangTao(null);
  }

  async function capNhatProjectTask(task: ProjectTaskCreateBody) {
    if (!selectedProject || !projectTaskDangSua) return;
    try {
      await api<ProjectTaskItem>(`/api/projects/${selectedProject.id}/tasks/${projectTaskDangSua.id}`, {
        method: 'PATCH',
        body: JSON.stringify(task)
      });
    } catch (error) {
      const conflict = parseGoalConflict(error);
      if (!conflict) throw error;
      // Ngày mới làm task rớt khỏi tuần mục tiêu -> hỏi xác nhận, OK thì gỡ khỏi mục tiêu tuần
      if (!window.confirm(goalConflictMessage(conflict.weeks))) return;
      await api<ProjectTaskItem>(`/api/projects/${selectedProject.id}/tasks/${projectTaskDangSua.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...task, confirmRemoveGoal: true })
      });
      void taiBadgeIds();
    }
    await taiProjectTasks(selectedProject.id);
    setProjectTaskDangSua(null);
  }

  async function taiRoadmapTasks() {
    setDangTaiRoadmap(true);
    setRoadmapError('');
    try {
      // Project hệ thống "Khác" (việc lẻ) không vào roadmap
      const entries = await Promise.all(projects.filter((p) => !p.isSystem).map(async (project) => {
        const tasks = await api<ProjectTaskItem[]>(`/api/projects/${project.id}/tasks`);
        return [project.id, tasks] as const;
      }));
      setRoadmapTasksByProject(Object.fromEntries(entries));
    } catch (error) {
      setRoadmapError(error instanceof Error ? error.message : t('err.roadmap'));
    } finally {
      setDangTaiRoadmap(false);
    }
  }

  // Gantt tổng: nạp task của TẤT CẢ project đang mở (gồm cả "Khác")
  async function taiGanttTongTasks() {
    setDangTaiGanttTong(true);
    setGanttTongError('');
    try {
      const entries = await Promise.all(projects.map(async (project) => {
        const tasks = await api<ProjectTaskItem[]>(`/api/projects/${project.id}/tasks`);
        return [project.id, tasks] as const;
      }));
      setGanttTongTasks(Object.fromEntries(entries));
    } catch (error) {
      setGanttTongError(error instanceof Error ? error.message : t('err.roadmap'));
    } finally {
      setDangTaiGanttTong(false);
    }
  }

  useEffect(() => {
    function refreshAfterQuickAdd(event: Event) {
      const projectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (!projectId) return;
      void (async () => {
        await taiProjects();
        if (projectDangChon === projectId) await taiProjectTasks(projectId);
        if (moGanttTong) await taiGanttTongTasks();
        if (moRoadmapProject) await taiRoadmapTasks();
        void taiBadgeIds();
      })();
    }
    window.addEventListener(quickProjectTaskCreatedEvent, refreshAfterQuickAdd);
    return () => window.removeEventListener(quickProjectTaskCreatedEvent, refreshAfterQuickAdd);
  }, [projectDangChon, moGanttTong, moRoadmapProject, projects]);

  useEffect(() => {
    if (!openGanttOnMount || autoOpenedGanttRef.current || dangTaiProject) return;
    autoOpenedGanttRef.current = true;
    setMoGanttTong(true);
    void taiGanttTongTasks();
  }, [openGanttOnMount, dangTaiProject, projects]);

  // Đổi ngày 1 task ở Gantt tổng (dùng projectId của task, không phụ thuộc project đang chọn)
  async function capNhatNgayTaskTong(task: ProjectTaskItem, start: string, end: string) {
    const payload = {
      parentId: task.parentId, tieuDe: task.tieuDe, ghiChu: task.ghiChu,
      links: normalizedTaskLinks(task.links), ngayBatDauDuKien: start, ngayKetThucDuKien: end,
      estimateHours: task.estimateHours, tienDo: task.tienDo, assignee: task.assignee
    };
    const url = `/api/projects/${task.projectId}/tasks/${task.id}`;
    try {
      await api<ProjectTaskItem>(url, { method: 'PATCH', body: JSON.stringify(payload) });
    } catch (error) {
      const conflict = parseGoalConflict(error);
      if (!conflict) { setGanttTongError(error instanceof Error ? error.message : t('err.update_dates')); return; }
      if (!window.confirm(goalConflictMessage(conflict.weeks))) return;
      await api<ProjectTaskItem>(url, { method: 'PATCH', body: JSON.stringify({ ...payload, confirmRemoveGoal: true }) });
      void taiBadgeIds();
    }
    await taiGanttTongTasks();
    if (selectedProject?.id === task.projectId) await taiProjectTasks(task.projectId);
  }

  // Kéo/resize giai đoạn (PIC) hoặc dời cả cụm trên Gantt tổng -> ghi đè ngày các giai đoạn rồi lưu cả mảng.
  // Endpoint assignments tự suy lại ngày/estimate/assignee của task lá và tính lại rollup.
  async function capNhatNgayAssignmentTong(task: ProjectTaskItem, updates: { index: number; start: string; end: string }[]) {
    const current = task.assignments || [];
    const byIndex = new Map(updates.map((u) => [u.index, u]));
    const assignments = current.map((a, i) => {
      const u = byIndex.get(i);
      return {
        pic: a.pic,
        startDate: u ? u.start : a.startDate,
        endDate: u ? u.end : a.endDate,
        estimateHours: a.estimateHours
      };
    });
    const url = `/api/projects/${task.projectId}/tasks/${task.id}/assignments`;
    try {
      await api<ProjectTaskItem>(url, { method: 'PUT', body: JSON.stringify({ assignments }) });
    } catch (error) {
      setGanttTongError(error instanceof Error ? error.message : t('err.update_dates'));
      return;
    }
    await taiGanttTongTasks();
    if (selectedProject?.id === task.projectId) await taiProjectTasks(task.projectId);
  }

  // Lưu chỉnh sửa task từ popup mở trên Gantt tổng -> ghi vào project của task + phản ánh lại danh sách
  async function capNhatProjectTaskTong(task: ProjectTaskItem, body: ProjectTaskCreateBody) {
    const url = `/api/projects/${task.projectId}/tasks/${task.id}`;
    try {
      await api<ProjectTaskItem>(url, { method: 'PATCH', body: JSON.stringify(body) });
    } catch (error) {
      const conflict = parseGoalConflict(error);
      if (!conflict) throw error; // để popup hiển thị lỗi
      if (!window.confirm(goalConflictMessage(conflict.weeks))) throw new Error('Đã hủy cập nhật');
      await api<ProjectTaskItem>(url, { method: 'PATCH', body: JSON.stringify({ ...body, confirmRemoveGoal: true }) });
    }
    setGanttTongTaskDangSua(null);
    await taiGanttTongTasks();
    if (selectedProject?.id === task.projectId) await taiProjectTasks(task.projectId);
    void taiBadgeIds();
  }

  async function sapXepTaskThucThiTrenGantt(projectId: string, taskIds: string[]) {
    const previous = ganttTongTasks[projectId] || [];
    const orderById = new Map(taskIds.map((id, index) => [id, index + 1]));
    const optimistic = previous.map((task) => (
      orderById.has(task.id) ? { ...task, executionOrder: orderById.get(task.id)! } : task
    ));
    setGanttTongTasks((current) => ({ ...current, [projectId]: optimistic }));
    if (selectedProject?.id === projectId) setProjectTasks(optimistic);
    try {
      const data = await api<ProjectTaskItem[]>(`/api/projects/${projectId}/tasks/execution-order`, {
        method: 'PATCH',
        body: JSON.stringify({ taskIds })
      });
      setGanttTongTasks((current) => ({ ...current, [projectId]: data }));
      if (selectedProject?.id === projectId) setProjectTasks(data);
      setGanttTongError('');
    } catch (error) {
      setGanttTongTasks((current) => ({ ...current, [projectId]: previous }));
      if (selectedProject?.id === projectId) setProjectTasks(previous);
      setGanttTongError(error instanceof Error ? error.message : t('err.sort_task'));
      await taiGanttTongTasks();
      if (selectedProject?.id === projectId) await taiProjectTasks(projectId);
    }
  }

  async function taiClosedProjects() {
    if (activeTeamId == null) return;
    setDangTaiClosedProjects(true);
    setClosedProjectsError('');
    try {
      const data = await apiTeam<ProjectItem[]>(activeTeamId, '/api/projects/closed');
      setClosedProjects(data);
    } catch (error) {
      setClosedProjectsError(error instanceof Error ? error.message : t('err.closed_projects'));
    } finally {
      setDangTaiClosedProjects(false);
    }
  }

  async function capNhatTienDoProjectTask(task: ProjectTaskItem, tienDo: number) {
    if (!selectedProject) return;
    setProjectTasks((current) => current.map((item) => (
      item.id === task.id ? { ...item, tienDo } : item
    )));
    try {
      await api<ProjectTaskItem>(`/api/projects/${selectedProject.id}/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          parentId: task.parentId,
          tieuDe: task.tieuDe,
          ghiChu: task.ghiChu,
          links: normalizedTaskLinks(task.links),
          ngayBatDauDuKien: task.ngayBatDauDuKien,
          ngayKetThucDuKien: task.ngayKetThucDuKien,
          estimateHours: task.estimateHours,
          tienDo,
          assignee: task.assignee
        })
      });
      await taiProjectTasks(selectedProject.id);
      setProjectTaskError('');
    } catch (error) {
      setProjectTaskError(error instanceof Error ? error.message : t('err.update_dates'));
      await taiProjectTasks(selectedProject.id);
    }
  }

  async function xoaProjectTask(task: ProjectTaskItem) {
    if (!selectedProject) return;
    await api(`/api/projects/${selectedProject.id}/tasks/${task.id}`, { method: 'DELETE' });
    await taiProjectTasks(selectedProject.id);
    setProjectTaskDangXoa(null);
  }

  async function sapXepProjectTasks(parentId: string | null, taskIds: string[]) {
    if (!selectedProject) return;
    const previousTasks = projectTasks;
    const orderById = new Map(taskIds.map((id, index) => [id, index]));
    setProjectTasks((current) => (
      current
        .map((task) => task.parentId === parentId && orderById.has(task.id) ? { ...task, sortOrder: (orderById.get(task.id) || 0) + 1 } : task)
        .sort((a, b) => (
          a.level - b.level
          || (a.parentId || '').localeCompare(b.parentId || '')
          || a.sortOrder - b.sortOrder
          || Number(a.id) - Number(b.id)
        ))
    ));
    try {
      const data = await api<ProjectTaskItem[]>(`/api/projects/${selectedProject.id}/tasks/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ parentId, taskIds })
      });
      setProjectTasks(data);
    } catch (error) {
      setProjectTasks(previousTasks);
      setProjectTaskError(error instanceof Error ? error.message : t('err.sort_task'));
    }
  }

  return (
    <>
      <section className={`man-hinh-project${hienThiDanhSachProject ? '' : ' project-sidebar-hidden'}`}>
        {hienThiDanhSachProject && (
        <aside className="project-sidebar" aria-label={t('project.sidebar_label')}>
          <div className="project-sidebar-header">
            <h2>{t('project.title')}</h2>
            <div className="project-sidebar-actions">
              <button
                type="button"
                className="project-roadmap-button"
                title={t('project.roadmap')}
                aria-label={t('project.roadmap')}
                onClick={() => {
                  setMoRoadmapProject(true);
                  void taiRoadmapTasks();
                }}
              >
                <ChartGantt size={18} />
              </button>
              <button
                type="button"
                className="project-roadmap-button"
                title="Gantt tổng (mọi project)"
                aria-label="Gantt tổng"
                onClick={() => {
                  setMoGanttTong(true);
                  void taiGanttTongTasks();
                }}
              >
                <CalendarRange size={18} />
              </button>
              <button
                type="button"
                className="project-roadmap-button"
                title={t('project.history_closed')}
                aria-label={t('project.history_closed')}
                onClick={() => {
                  setMoLichSuProjectClose(true);
                  void taiClosedProjects();
                }}
              >
                <History size={18} />
              </button>
              <button
                type="button"
                className="project-add-button"
                title={t('project.add')}
                aria-label={t('project.add')}
                onClick={() => setMoTaoProject(true)}
              >
                <Plus size={24} />
              </button>
            </div>
          </div>
          <div className="project-list">
            {dangTaiProject && <p className="project-list-state">{t('loading.project')}</p>}
            {!dangTaiProject && projectError && <p className="project-list-state project-list-error">{projectError}</p>}
            {!dangTaiProject && !projectError && projects.length === 0 && (
              <p className="project-list-state">{t('empty.project')}</p>
            )}
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`${project.id === projectDangChon ? 'project-item project-item-active' : 'project-item'}${project.id === projectDangKeo ? ' project-item-dragging' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', project.id);
                  setProjectDangKeo(project.id);
                }}
                onDragOver={(event) => {
                  if (!projectDangKeo || projectDangKeo === project.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropProject(project.id);
                }}
                onDragEnd={() => setProjectDangKeo(null)}
                onClick={() => setProjectDangChon(project.id)}
              >
                <span>{project.ten}</span>
              </button>
            ))}
          </div>
        </aside>
        )}
        <div className="project-detail">
          <div className="project-detail-header">
            <div className="project-title-group">
              <button
                type="button"
                className="nut-phu project-icon-button"
                onClick={() => setHienThiDanhSachProject((value) => !value)}
                title={hienThiDanhSachProject ? t('project.toggle_hide') : t('project.toggle_show')}
                aria-label={hienThiDanhSachProject ? t('project.toggle_hide') : t('project.toggle_show')}
              >
                {hienThiDanhSachProject
                  ? <ChevronLeft className="project-header-action-icon" size={20} strokeWidth={2.5} />
                  : <ChevronRight className="project-header-action-icon" size={20} strokeWidth={2.5} />}
              </button>
              <div className="project-title-content">
                <h2>{selectedProject?.ten || t('project.no_selected')}</h2>
                {selectedProject && !selectedProject.isSystem && (
                  <div className="project-task-summary project-header-summary">
                    <span className="project-summary-progress-item">
                      {t('project.summary.progress')}:
                      <span
                        className="project-summary-progress-circle"
                        style={{ '--progress': `${Math.max(0, Math.min(100, projectTaskSummary.projectProgress))}%` } as React.CSSProperties}
                        title={`${projectTaskSummary.completedHours.toFixed(1)}h / ${projectTaskSummary.totalHours.toFixed(1)}h`}
                        aria-label={`${t('project.summary.progress')} ${projectTaskSummary.roundedProjectProgress}%`}
                      >
                        <span>{projectTaskSummary.roundedProjectProgress}%</span>
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>
            {selectedProject && (
              <div className="project-detail-actions">
                {/* Project hệ thống "Khác" chỉ là việc lẻ: không Thông tin chi tiết, không Gantt, không xóa */}
                {!selectedProject.isSystem && (
                  <button type="button" className="nut-phu project-icon-button" onClick={() => setMoThongTinProject(true)} title={t('project.info')} aria-label={t('project.info')}>
                    <Info className="project-header-action-icon" size={20} strokeWidth={2.5} />
                  </button>
                )}
                <button type="button" className="nut-phu project-icon-button" onClick={() => setProjectDangSua(selectedProject)} title={t('project.edit')} aria-label={t('project.edit')}>
                  <Pencil className="project-header-action-icon" size={20} strokeWidth={2.5} />
                </button>
                {!selectedProject.isSystem && (
                  <button type="button" className="nut-nguy-hiem-text project-icon-button" onClick={() => setProjectDangXoa(selectedProject)} title={t('project.delete')} aria-label={t('project.delete')}>
                    <Trash2 className="project-header-action-icon" size={20} strokeWidth={2.5} />
                  </button>
                )}
                <button
                  type="button"
                  className="nut-chinh project-icon-button project-level-add-button project-level-add-button-root"
                  onClick={() => moPopupTaoProjectTask(null)}
                  title={t('project.add_task_l1')}
                  aria-label={t('project.add_task_l1')}
                >
                  <Plus size={24} />
                </button>
              </div>
            )}
          </div>
          <div>
            {selectedProject && (
              <div className="project-task-panel">
                <div className="project-task-panel-header">
                  <div>
                    <h3>{t('project.tasks_panel')}</h3>
                  </div>
                  {selectedProject.isSystem && !showCompletedInKhac && completedTaskIdsInKhac.size > 0 && (
                    <button type="button" className="nut-phu" onClick={() => setShowCompletedInKhac(true)}>
                      {`Hiện ${completedTaskIdsInKhac.size} task đã xong`}
                    </button>
                  )}
                </div>
                {dangTaiProjectTask && projectTasks.length === 0 && <p className="project-list-state">{t('loading.task')}</p>}
                {!dangTaiProjectTask && projectTaskError && <p className="project-list-state project-list-error">{projectTaskError}</p>}
                {!dangTaiProjectTask && !projectTaskError && projectTasks.length === 0 && (
                  <p className="project-list-state">{t('empty.project_task')}</p>
                )}
                {!projectTaskError && projectTasks.length > 0 && (
                  <ProjectTaskTree
                    key={selectedProject.id}
                    tasks={projectTasks}
                    goalTaskIds={goalTaskIds}
                    atRiskTaskIds={atRiskTaskIds}
                    allowChildren={!selectedProject.isSystem}
                    hiddenTaskIds={selectedProject.isSystem && !showCompletedInKhac ? completedTaskIdsInKhac : undefined}
                    onAddChild={moPopupTaoProjectTask}
                    onEdit={setProjectTaskDangSua}
                    onDelete={setProjectTaskDangXoa}
                    onProgressChange={capNhatTienDoProjectTask}
                    onReorder={sapXepProjectTasks}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      {moTaoProject && (
        <PopupTaoProject
          onClose={() => setMoTaoProject(false)}
          onCreated={taoProject}
        />
      )}
      {projectDangSua && (
        <PopupTaoProject
          project={projectDangSua}
          onClose={() => setProjectDangSua(null)}
          onCreated={capNhatProject}
          onCloseProject={closeProject}
          onPendingProject={pendingProject}
        />
      )}
      {moLichSuProjectClose && (
        <PopupLichSuProjectClose
          projects={closedProjects}
          isLoading={dangTaiClosedProjects}
          error={closedProjectsError}
          onClose={() => setMoLichSuProjectClose(false)}
          onReload={taiClosedProjects}
          onRestoreProject={restorePendingProject}
        />
      )}
      {projectDangXoa && (
        <PopupXacNhanXoa
          title={t('delete.project_title')}
          message={`${t('delete.project_title')} "${projectDangXoa.ten}"?`}
          onClose={() => setProjectDangXoa(null)}
          onConfirm={() => xoaProject(projectDangXoa)}
        />
      )}
      {moTaoProjectTask && selectedProject && (
        <PopupTaoProjectTask
          project={selectedProject}
          parentTask={taskParentDangTao}
          onClose={() => {
            setMoTaoProjectTask(false);
            setTaskParentDangTao(null);
          }}
          onCreated={taoProjectTask}
        />
      )}
      {projectTaskDangXoa && (
        <PopupXacNhanXoa
          title={t('delete.ptask_title')}
          message={`${t('delete.ptask_title')} "${projectTaskDangXoa.tieuDe}"?`}
          onClose={() => setProjectTaskDangXoa(null)}
          onConfirm={() => xoaProjectTask(projectTaskDangXoa)}
        />
      )}
      {moThongTinProject && selectedProject && (
        <PopupProjectInfo
          project={selectedProject}
          summary={projectTaskSummary}
          onClose={() => setMoThongTinProject(false)}
        />
      )}
      {moRoadmapProject && (
        <PopupProjectRoadmap
          projects={projects.filter((p) => !p.isSystem)}
          tasksByProject={roadmapTasksByProject}
          isLoading={dangTaiRoadmap}
          error={roadmapError}
          onClose={() => setMoRoadmapProject(false)}
          onReload={taiRoadmapTasks}
          onProjectsReorder={sapXepProjects}
        />
      )}
      {moGanttTong && (
        <PopupGanttTong
          projects={projects}
          tasksByProject={ganttTongTasks}
          isLoading={dangTaiGanttTong}
          error={ganttTongError}
          onClose={() => setMoGanttTong(false)}
          onReload={taiGanttTongTasks}
          onTaskOpen={(task) => setGanttTongTaskDangSua(task)}
          onTaskDatesChange={capNhatNgayTaskTong}
          onAssignmentDatesChange={capNhatNgayAssignmentTong}
          onTaskReorder={sapXepTaskThucThiTrenGantt}
        />
      )}
      {ganttTongTaskDangSua && (() => {
        const proj = projects.find((p) => p.id === ganttTongTaskDangSua.projectId);
        if (!proj) return null;
        const ptasks = ganttTongTasks[ganttTongTaskDangSua.projectId] || [];
        return (
          <PopupTaoProjectTask
            project={proj}
            parentTask={ptasks.find((tk) => tk.id === ganttTongTaskDangSua.parentId) || null}
            task={ganttTongTaskDangSua}
            hasChildren={ptasks.some((tk) => tk.parentId === ganttTongTaskDangSua.id)}
            onClose={() => setGanttTongTaskDangSua(null)}
            onCreated={(body) => capNhatProjectTaskTong(ganttTongTaskDangSua, body)}
          />
        );
      })()}
      {projectTaskDangSua && selectedProject && (
        <PopupTaoProjectTask
          project={selectedProject}
          parentTask={projectTasks.find((task) => task.id === projectTaskDangSua.parentId) || null}
          task={projectTaskDangSua}
          hasChildren={projectTasks.some((task) => task.parentId === projectTaskDangSua.id)}
          onClose={() => setProjectTaskDangSua(null)}
          onCreated={capNhatProjectTask}
        />
      )}
    </>
  );
}

function PopupTaoProject({
  project,
  onClose,
  onCreated,
  onCloseProject,
  onPendingProject
}: {
  project?: ProjectItem;
  onClose: () => void;
  onCreated: (project: ProjectCreateBody) => Promise<void>;
  onCloseProject?: (project: ProjectItem) => Promise<void>;
  onPendingProject?: (project: ProjectItem) => Promise<void>;
}) {
  const { t } = useLang();
  const [ten, setTen] = useState(project?.ten || '');
  const [pics, setPics] = useState<string[]>(project?.pic ? project.pic.split(',').map((item) => item.trim()).filter(Boolean) : []);
  const { pics: picOptions } = usePics();
  const [moDropdownPic, setMoDropdownPic] = useState(false);
  const [ngayBatDau, setNgayBatDau] = useState(project?.ngayBatDau || currentVietnamDateInputValue());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const dropdownPicRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!moDropdownPic) return;

    function dongKhiClickNgoai(event: MouseEvent) {
      if (!dropdownPicRef.current?.contains(event.target as Node)) {
        setMoDropdownPic(false);
      }
    }

    document.addEventListener('mousedown', dongKhiClickNgoai);
    return () => document.removeEventListener('mousedown', dongKhiClickNgoai);
  }, [moDropdownPic]);

  function doiPic(value: string) {
    setPics((current) => (
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    ));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      await onCreated({
        ten: ten.trim(),
        pic: pics.join(', '),
        ngayBatDau
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : t('err.register_project'));
    } finally {
      setIsSaving(false);
    }
  }

  async function closeCurrentProject() {
    if (!project || !onCloseProject) return;
    setIsSaving(true);
    setError('');
    try {
      await onCloseProject(project);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('err.close_project'));
    } finally {
      setIsSaving(false);
    }
  }

  async function pendingCurrentProject() {
    if (!project || !onPendingProject) return;
    setIsSaving(true);
    setError('');
    try {
      await onPendingProject(project);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('err.pending_project'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="popup popup-project-form w-full max-w-2xl" onSubmit={submit}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">{project ? t('project.form.edit') : t('project.form.register')}</h2>
          <button type="button" className="nut-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          {t('project.form.name')}
          <input value={ten} disabled={isSaving} onChange={(event) => setTen(event.target.value)} required autoFocus />
        </label>
        {/* Project hệ thống "Khác" (việc lẻ): không có PIC / ngày bắt đầu / đóng project */}
        {!project?.isSystem && (
          <>
            <div className="field">
              PIC
              <details ref={dropdownPicRef} className="multi-select" open={moDropdownPic}>
                <summary
                  onClick={(event) => {
                    event.preventDefault();
                    if (!isSaving) setMoDropdownPic((value) => !value);
                  }}
                >
                  <span>{pics.length > 0 ? pics.join(', ') : t('project.form.pic_placeholder')}</span>
                </summary>
                <div className="multi-select-menu">
                  {picOptions.map((pic) => (
                    <label key={pic} className="multi-select-option">
                      <input
                        type="checkbox"
                        checked={pics.includes(pic)}
                        disabled={isSaving}
                        onChange={() => doiPic(pic)}
                      />
                      <span>{pic}</span>
                    </label>
                  ))}
                </div>
              </details>
            </div>
            <label className="field">
              {t('project.form.start_date')}
              <input type="date" value={ngayBatDau} disabled={isSaving} onChange={(event) => setNgayBatDau(event.target.value)} required />
            </label>
          </>
        )}
        {error && <p className="release-error">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-between gap-3">
          <div>
            {project && !project.isSystem && (
              <div className="flex flex-wrap gap-3">
                <button type="button" className="nut-phu" disabled={isSaving} onClick={pendingCurrentProject}>
                  {t('project.form.pending')}
                </button>
                <button type="button" className="nut-nguy-hiem-text" disabled={isSaving} onClick={closeCurrentProject}>
                  {t('project.form.close')}
                </button>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="nut-phu" disabled={isSaving} onClick={onClose}>{t('btn.cancel')}</button>
            <button className="nut-chinh" type="submit" disabled={isSaving || pics.length === 0}>{t('btn.save')}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function PopupLichSuProjectClose({
  projects,
  isLoading,
  error,
  onClose,
  onReload,
  onRestoreProject
}: {
  projects: ProjectItem[];
  isLoading: boolean;
  error: string;
  onClose: () => void;
  onReload: () => Promise<void>;
  onRestoreProject: (project: ProjectItem) => Promise<void>;
}) {
  const { t } = useLang();
  const [restoringProjectId, setRestoringProjectId] = useState<string | null>(null);
  async function restore(project: ProjectItem) {
    setRestoringProjectId(project.id);
    try {
      await onRestoreProject(project);
    } finally {
      setRestoringProjectId(null);
    }
  }
  return (
    <Modal onClose={onClose}>
      <section className="popup flex h-[88vh] w-[min(98vw,1600px)] max-w-none flex-col">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{t('history.project.title')}</h2>
            <p className="text-sm text-phu">{t('history.project.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="nut-phu" disabled={isLoading} onClick={() => void onReload()}>{t('btn.reload')}</button>
            <button type="button" className="nut-icon" onClick={onClose} aria-label={t('history.project.close')}>
              <X size={18} />
            </button>
          </div>
        </div>
        {isLoading && <p className="project-list-state">{t('loading.project_history')}</p>}
        {!isLoading && error && <p className="project-list-state project-list-error">{error}</p>}
        {!isLoading && !error && projects.length === 0 && (
          <p className="project-list-state">{t('empty.closed_project')}</p>
        )}
        {!isLoading && !error && projects.length > 0 && (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-300">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-phu">
                <tr>
                  <th className="px-4 py-3">{t('history.project.col_project')}</th>
                  <th className="px-4 py-3">{t('history.project.col_pic')}</th>
                  <th className="px-4 py-3">{t('history.project.col_status')}</th>
                  <th className="px-4 py-3">{t('history.project.col_start')}</th>
                  <th className="px-4 py-3">{t('history.project.col_pending')}</th>
                  <th className="px-4 py-3">{t('history.project.col_closed')}</th>
                  <th className="px-4 py-3 text-right">{t('history.project.col_action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td className="px-4 py-3 font-bold text-muc">{project.ten}</td>
                    <td className="px-4 py-3 text-phu">{project.pic || '-'}</td>
                    <td className="px-4 py-3">{project.pendingAt ? t('project.status.pending') : t('project.status.closed')}</td>
                    <td className="px-4 py-3">{dinhDangNgay(project.ngayBatDau)}</td>
                    <td className="px-4 py-3">{dinhDangNgay(project.pendingAt)}</td>
                    <td className="px-4 py-3">{dinhDangNgay(project.closedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {project.pendingAt && !project.closedAt ? (
                        <button
                          type="button"
                          className="nut-phu"
                          disabled={restoringProjectId === project.id}
                          onClick={() => void restore(project)}
                        >
                          {t('project.action.restore_inprogress')}
                        </button>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Modal>
  );
}

const EMPTY_HIDDEN_TASK_IDS: ReadonlySet<string> = new Set();

function ProjectTaskTree({
  tasks,
  goalTaskIds,
  atRiskTaskIds,
  allowChildren = true,
  hiddenTaskIds,
  onAddChild,
  onEdit,
  onDelete,
  onProgressChange,
  onReorder
}: {
  tasks: ProjectTaskItem[];
  goalTaskIds: Set<string>;
  atRiskTaskIds: Set<string>;
  allowChildren?: boolean;
  // Task có id trong đây KHÔNG được render (project "Khác" ẩn task 100%, Council run 9c9f21c4) — vẫn
  // giữ NGUYÊN trong `tasks`/`tasksByParent` để dropTask() dựng payload reorder đủ id anh em (server
  // yêu cầu khớp chính xác toàn bộ tập id cùng parentId), chỉ bỏ qua ở tầng render + đánh số thứ tự.
  hiddenTaskIds?: ReadonlySet<string>;
  onAddChild: (task: ProjectTaskItem) => void;
  onEdit: (task: ProjectTaskItem) => void;
  onDelete: (task: ProjectTaskItem) => void;
  onProgressChange: (task: ProjectTaskItem, tienDo: number) => void;
  onReorder: (parentId: string | null, taskIds: string[]) => Promise<void>;
}) {
  const hidden = hiddenTaskIds ?? EMPTY_HIDDEN_TASK_IDS;
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(() => {
    const parentIds = new Set(tasks.map((task) => task.parentId).filter((value): value is string => Boolean(value)));
    return new Set(tasks.filter((task) => task.level === 1 && parentIds.has(task.id)).map((task) => task.id));
  });
  const tasksByParent = useMemo(() => {
    return tasks.reduce<Record<string, ProjectTaskItem[]>>((groups, task) => {
      const key = task.parentId || 'root';
      groups[key] = [...(groups[key] || []), task];
      return groups;
    }, {});
  }, [tasks]);

  function toggleCollapsed(taskId: string) {
    setCollapsedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  function dropTask(event: React.DragEvent, targetTask: ProjectTaskItem, siblingTasks: ProjectTaskItem[]) {
    event.preventDefault();
    event.stopPropagation();
    const draggedTaskId = event.dataTransfer.getData('text/project-task-id') || draggingTaskId;
    setDraggingTaskId(null);
    if (!draggedTaskId || draggedTaskId === targetTask.id) return;
    const draggedTask = tasks.find((task) => task.id === draggedTaskId);
    if (!draggedTask || draggedTask.parentId !== targetTask.parentId) return;

    const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const insertAfterTarget = event.clientY > targetRect.top + targetRect.height / 2;
    const nextIds = siblingTasks.map((task) => task.id).filter((id) => id !== draggedTaskId);
    const targetIndex = nextIds.indexOf(targetTask.id);
    if (targetIndex === -1) return;
    nextIds.splice(insertAfterTarget ? targetIndex + 1 : targetIndex, 0, draggedTaskId);
    void onReorder(targetTask.parentId, nextIds);
  }

  function renderTasks(parentId: string | null, parentNumber = '') {
    const items = tasksByParent[parentId || 'root'] || [];
    let visibleIndex = 0;
    return (
      <div className={parentId ? 'project-task-children' : 'project-task-tree'}>
        {items.map((task) => {
          if (hidden.has(task.id)) return null;
          const childrenCount = (tasksByParent[task.id] || []).length;
          const isCollapsed = collapsedTaskIds.has(task.id);
          const taskNumber = parentNumber ? `${parentNumber}.${visibleIndex + 1}` : `${visibleIndex + 1}`;
          visibleIndex += 1;
          return (
            <ProjectTaskRow
              key={task.id}
              task={task}
              isGoal={goalTaskIds.has(task.id)}
              isAtRisk={atRiskTaskIds.has(task.id)}
              allowChildren={allowChildren}
              taskNumber={taskNumber}
              childrenCount={childrenCount}
              isCollapsed={isCollapsed}
              onToggleCollapsed={() => toggleCollapsed(task.id)}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
              onProgressChange={onProgressChange}
              isDragging={draggingTaskId === task.id}
              onDragStart={(event) => {
                event.stopPropagation();
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/project-task-id', task.id);
                setDraggingTaskId(task.id);
              }}
              onDragEnd={() => setDraggingTaskId(null)}
              onDragOver={(event) => {
                const draggedTask = tasks.find((item) => item.id === draggingTaskId);
                if (draggedTask && draggedTask.id !== task.id && draggedTask.parentId === task.parentId) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => dropTask(event, task, items)}
            >
              {childrenCount > 0 && !isCollapsed && renderTasks(task.id, taskNumber)}
            </ProjectTaskRow>
          );
        })}
      </div>
    );
  }

  return renderTasks(null);
}

function ProjectTaskRow({
  task,
  isGoal,
  isAtRisk,
  allowChildren = true,
  taskNumber,
  childrenCount,
  isCollapsed,
  onToggleCollapsed,
  onAddChild,
  onEdit,
  onDelete,
  onProgressChange,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  children
}: {
  task: ProjectTaskItem;
  isGoal: boolean;
  isAtRisk: boolean;
  allowChildren?: boolean;
  taskNumber: string;
  childrenCount: number;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onAddChild: (task: ProjectTaskItem) => void;
  onEdit: (task: ProjectTaskItem) => void;
  onDelete: (task: ProjectTaskItem) => void;
  onProgressChange: (task: ProjectTaskItem, tienDo: number) => void;
  isDragging: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  const { t } = useLang();
  const taskIndent = task.level === 1 ? '0px' : task.level === 2 ? '36px' : '72px';
  const isCompleted = task.tienDo === 100;
  const isOverdue = !isCompleted && taoNgayTuInput(task.ngayKetThucDuKien).getTime() < taoNgayTuInput(currentVietnamDateInputValue()).getTime();
  const isExecutableWithoutEstimate = childrenCount === 0 && task.estimateHours == null;

  return (
    <article
      className={`project-task-item project-task-level-${task.level}${isOverdue ? ' project-task-overdue' : ''}${isAtRisk ? ' project-task-at-risk' : ''}${isDragging ? ' project-task-dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className="project-task-card project-task-card-clickable"
        style={{ '--project-task-indent': taskIndent } as React.CSSProperties}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, select, a, input, textarea')) return;
          onEdit(task);
        }}
        title={t('ptask.edit')}
      >
        <span className="project-task-index-stack">
          <span className="project-task-number">{taskNumber}</span>
          {childrenCount > 0 && (
            <button
              type="button"
              className="project-task-collapse-button"
              onClick={onToggleCollapsed}
              title={isCollapsed ? t('ptask.expand') : t('ptask.collapse')}
              aria-label={isCollapsed ? t('ptask.expand') : t('ptask.collapse')}
            >
              {isCollapsed ? <ChevronDown size={12} strokeWidth={3.6} /> : <ChevronUp size={12} strokeWidth={3.6} />}
            </button>
          )}
        </span>
        <div className="project-task-main">
          <div className="project-task-title-row">
            <div className="project-task-title-main">
              <h4>
                {isGoal && (
                  <span title="Mục tiêu tuần này" style={{ color: '#f59e0b', marginRight: 4, display: 'inline-flex', verticalAlign: 'middle' }}>
                    <Target size={14} />
                  </span>
                )}
                {task.tieuDe}
                {isAtRisk && (
                  <span className="project-task-atrisk-chip" title="Carry-over: mục tiêu đã được mang sang từ tuần trước vì chưa hoàn thành — cần lưu tâm để hoàn thành dứt điểm.">
                    ⚠ carry-over
                  </span>
                )}
              </h4>
            </div>
            <div className="project-task-title-actions">
            </div>
          </div>
        </div>
        <div className="project-task-fields">
          <div className="project-task-date-column">
            <span className="project-task-date-line" title={t('ptask.planned')}><strong>{t('ptask.planned')}:</strong><span>{dinhDangNgay(task.ngayBatDauDuKien)} - {dinhDangNgay(task.ngayKetThucDuKien)}</span></span>
            <span className="project-task-date-line" title={t('ptask.pic')}><strong>{t('ptask.pic')}:</strong><span style={{ fontWeight: 600, color: '#2563eb' }}>{task.assignee || '--'}</span></span>
          </div>
          <div className="project-task-status-column">
            <span className={isExecutableWithoutEstimate ? 'project-task-missing-estimate' : undefined}>
              <strong>Estimate time:</strong> {task.estimateHours == null ? '--' : `${task.estimateHours}h`}
            </span>
            <span className="project-task-meta-row">
              <strong>{t('ptask.progress')}:</strong>
              <span
                className="project-task-progress-bar"
                style={{ '--progress': `${Math.max(0, Math.min(100, task.tienDo))}%` } as React.CSSProperties}
                aria-label={`${t('ptask.progress')} ${task.tienDo}%`}
                title={childrenCount === 0 ? t('ptask.progress_quick') : undefined}
              >
                <span className="project-task-progress-fill" aria-hidden="true" />
                <span>{task.tienDo}%{childrenCount === 0 ? ' ▾' : ''}</span>
                {childrenCount === 0 && (
                  <select
                    className="project-task-progress-overlay"
                    value={task.tienDo}
                    onChange={(event) => onProgressChange(task, Number(event.target.value))}
                  >
                    {progressSelectOptions(task.tienDo).map((value) => (
                      <option key={value} value={value}>{value}%</option>
                    ))}
                  </select>
                )}
              </span>
              <TaskLinkBadges links={task.links} />
            </span>
          </div>
        </div>
        <div className="project-task-note-area">
          <div className="project-task-note-scroll">
            {task.ghiChu ? <p className="project-task-note">{task.ghiChu}</p> : <span>-</span>}
          </div>
        </div>
        <div className="project-task-actions">
          {allowChildren && (
            <button
              type="button"
              className="nut-chinh project-task-child-button project-level-add-button project-level-add-button-child"
              disabled={task.level >= 3}
              onClick={() => {
                if (task.level < 3) onAddChild(task);
              }}
              title={task.level >= 3 ? 'Task level 3 không thể thêm task con' : `${t('ptask.add_child')} ${task.level + 1}`}
              aria-label={task.level >= 3 ? 'Task level 3 không thể thêm task con' : `${t('ptask.add_child')} ${task.level + 1}`}
            >
              <Plus size={24} />
            </button>
          )}
          <button type="button" className="nut-nguy-hiem-text project-icon-button" onClick={() => onDelete(task)} title={t('ptask.delete')} aria-label={t('ptask.delete')}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      {children}
    </article>
  );
}

type GanttDragMode = 'move' | 'resize-start' | 'resize-end';

interface GanttDragState {
  task: ProjectTaskItem;
  // Khi kéo 1 đoạn (giai đoạn phân công) thay vì cả thanh task: chỉ số trong task.assignments.
  assignmentIndex?: number;
  // Khi kéo BAR CHA của task có phân công: dời CẢ CỤM. Chỉ có 'move' (không resize).
  // Lưu ngày gốc của mọi đoạn con để dời đồng loạt theo cùng một delta.
  parentSegs?: { index: number; start: string; end: string }[];
  mode: GanttDragMode;
  pointerId: number;
  startX: number;
  originalStart: string;
  originalEnd: string;
}

// Key của previewDates: 'planned:<taskId>' cho cả thanh, 'seg:<taskId>:<index>' cho 1 giai đoạn.
function ganttPreviewKey(drag: { task: ProjectTaskItem; assignmentIndex?: number }) {
  return drag.assignmentIndex != null ? `seg:${drag.task.id}:${drag.assignmentIndex}` : `planned:${drag.task.id}`;
}

const ganttDayWidth = 42;
const ganttMonthRowHeight = 22;
const ganttDayRowHeight = 38;
const ganttHeaderHeight = ganttMonthRowHeight + ganttDayRowHeight;
const ganttRowHeight = 56;
const roadmapWeekWidth = 118;
const roadmapHeaderHeight = 66;
const roadmapProjectHeaderHeight = 42;

function tinhNgayGanttKeo(drag: GanttDragState, clientX: number) {
  const deltaDays = Math.round((clientX - drag.startX) / ganttDayWidth);

  if (drag.mode === 'move') {
    return {
      start: congNgayInput(drag.originalStart, deltaDays),
      end: congNgayInput(drag.originalEnd, deltaDays)
    };
  }

  if (drag.mode === 'resize-start') {
    const rawStart = congNgayInput(drag.originalStart, deltaDays);
    const nextStart = khoangCachNgay(rawStart, drag.originalEnd) < 0 ? drag.originalEnd : rawStart;
    return { start: nextStart, end: drag.originalEnd };
  }

  const rawEnd = congNgayInput(drag.originalEnd, deltaDays);
  const nextEnd = khoangCachNgay(drag.originalStart, rawEnd) < 0 ? drag.originalStart : rawEnd;
  return { start: drag.originalStart, end: nextEnd };
}

function PopupProjectRoadmap({
  projects,
  tasksByProject,
  isLoading,
  error,
  onClose,
  onReload,
  onProjectsReorder
}: {
  projects: ProjectItem[];
  tasksByProject: Record<string, ProjectTaskItem[]>;
  isLoading: boolean;
  error: string;
  onClose: () => void;
  onReload: () => Promise<void>;
  onProjectsReorder: (projectIds: string[]) => Promise<void>;
}) {
  const { t } = useLang();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taskColumnRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef(0);
  const lastScrollTopRef = useRef(-1);
  function onRoadmapScroll(event: React.UIEvent<HTMLDivElement>) {
    const st = event.currentTarget.scrollTop;
    if (st === lastScrollTopRef.current) return;
    lastScrollTopRef.current = st;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (taskColumnRef.current) taskColumnRef.current.style.transform = `translateY(${-lastScrollTopRef.current}px)`;
    });
  }
  const didSetInitialRoadmapScrollRef = useRef(false);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [roadmapProjectDangKeo, setRoadmapProjectDangKeo] = useState<string | null>(null);
  const today = currentVietnamDateInputValue();
  const projectGroups = useMemo(() => projects.map((project) => {
    const tasks = (tasksByProject[project.id] || [])
      .filter((task) => task.level === 1)
      .sort((a, b) => a.sortOrder - b.sortOrder || Number(a.id) - Number(b.id));
    const totalProgress = tasks.reduce((sum, task) => sum + Math.max(0, Math.min(100, task.tienDo)), 0);
    return {
      project,
      tasks,
      progress: tasks.length > 0 ? Math.round(totalProgress / tasks.length) : 0
    };
  }), [projects, tasksByProject]);
  const rows = projectGroups.flatMap((group) => {
    const isCollapsed = collapsedProjectIds.has(group.project.id);
    return [
      { type: 'project' as const, key: `project:${group.project.id}`, group, isCollapsed },
      ...(
        isCollapsed
          ? []
          : group.tasks.map((task) => ({ type: 'task' as const, key: `task:${task.id}`, group, task }))
      )
    ];
  });
  const allLevelOneTasks = projectGroups.flatMap((group) => group.tasks);
  const roadmapDates = [
    today,
    ...allLevelOneTasks.map((task) => task.ngayBatDauDuKien).filter(Boolean),
    ...allLevelOneTasks.map((task) => task.ngayKetThucDuKien).filter(Boolean)
  ];
  const sortedRoadmapDates = [...roadmapDates].sort();
  const firstRoadmapYear = sortedRoadmapDates[0] ? taoNgayTuInput(sortedRoadmapDates[0]).getFullYear() : taoNgayTuInput(today).getFullYear();
  const lastRoadmapYear = sortedRoadmapDates.at(-1) ? taoNgayTuInput(sortedRoadmapDates.at(-1) as string).getFullYear() : firstRoadmapYear;
  const timelineStart = dauTuanInput(`${firstRoadmapYear}-01-01`);
  const timelineEnd = cuoiTuanInput(`${lastRoadmapYear}-12-31`);
  const totalWeeks = Math.max(1, Math.floor(khoangCachNgay(timelineStart, timelineEnd) / 7) + 1);
  const displayedWeeks = totalWeeks;
  const weeks = useMemo(() => (
    Array.from({ length: displayedWeeks }, (_, index) => {
      const start = congNgayInput(timelineStart, index * 7);
      const date = taoNgayTuInput(start);
      return {
        start,
        end: congNgayInput(start, 6),
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        weekNumber: tuanTrongNam(start)
      };
    })
  ), [timelineStart, displayedWeeks]);
  const monthGroups = useMemo(() => {
    const groups: { key: string; label: string; span: number }[] = [];
    for (const week of weeks) {
      const key = `${week.year}-${week.month}`;
      const label = `Tháng ${week.month}/${week.year}`;
      const last = groups.at(-1);
      if (last?.key === key) {
        last.span += 1;
      } else {
        groups.push({ key, label, span: 1 });
      }
    }
    return groups;
  }, [weeks]);
  const todayOffset = Math.floor(khoangCachNgay(timelineStart, today) / 7);

  useEffect(() => {
    if (isLoading) {
      didSetInitialRoadmapScrollRef.current = false;
    }
  }, [isLoading]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (isLoading || error) return;
    if (!scrollElement || didSetInitialRoadmapScrollRef.current) return;
    if (todayOffset < 0 || todayOffset >= displayedWeeks) return;

    didSetInitialRoadmapScrollRef.current = true;
    const targetScrollLeft = todayOffset * roadmapWeekWidth;
    const timeoutIds: number[] = [];
    let frameId = 0;

    const setCurrentWeekScroll = () => {
      const maxScrollLeft = Math.max(0, scrollElement.scrollWidth - scrollElement.clientWidth);
      scrollElement.scrollLeft = Math.min(targetScrollLeft, maxScrollLeft);
    };

    setCurrentWeekScroll();
    frameId = window.requestAnimationFrame(setCurrentWeekScroll);
    timeoutIds.push(window.setTimeout(setCurrentWeekScroll, 50));
    timeoutIds.push(window.setTimeout(setCurrentWeekScroll, 150));

    return () => {
      window.cancelAnimationFrame(frameId);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [displayedWeeks, isLoading, rows.length, timelineStart, todayOffset]);

  function dropRoadmapProject(targetProjectId: string) {
    if (!roadmapProjectDangKeo || roadmapProjectDangKeo === targetProjectId) {
      setRoadmapProjectDangKeo(null);
      return;
    }
    const sourceIndex = projects.findIndex((project) => project.id === roadmapProjectDangKeo);
    const targetIndex = projects.findIndex((project) => project.id === targetProjectId);
    if (sourceIndex < 0 || targetIndex < 0) {
      setRoadmapProjectDangKeo(null);
      return;
    }
    const nextProjectIds = projects.map((project) => project.id);
    const [movedProjectId] = nextProjectIds.splice(sourceIndex, 1);
    nextProjectIds.splice(targetIndex, 0, movedProjectId);
    setRoadmapProjectDangKeo(null);
    void onProjectsReorder(nextProjectIds);
  }

  return (
    <Modal onClose={onClose}>
      <section className="popup popup-project-gantt popup-project-roadmap w-full">
        <div className="project-gantt-header">
          <div>
            <h2>{t('roadmap.title')}</h2>
            <p>{t('roadmap.subtitle')}</p>
          </div>
          <div className="project-roadmap-header-actions">
            <button type="button" className="nut-phu" onClick={() => void onReload()} disabled={isLoading}>{t('roadmap.reload')}</button>
            <button type="button" className="nut-icon" onClick={onClose} aria-label={t('roadmap.close')}>
              <X size={18} />
            </button>
          </div>
        </div>
        {isLoading && <div className="project-gantt-empty">{t('loading.roadmap')}</div>}
        {!isLoading && error && <div className="project-gantt-empty project-list-error">{error}</div>}
        {!isLoading && !error && projects.length === 0 && <div className="project-gantt-empty">{t('empty.roadmap')}</div>}
        {!isLoading && !error && projects.length > 0 && (
          <div className="project-gantt-shell project-roadmap-shell">
            <div className="project-gantt-task-column project-roadmap-task-column">
              <div className="project-roadmap-task-column-spacer" />
              <div className="project-gantt-task-labels" ref={taskColumnRef}>
              {rows.map((row) => (
                <div
                  key={row.key}
                  className={row.type === 'project'
                    ? `project-roadmap-project-label${row.group.project.id === roadmapProjectDangKeo ? ' project-item-dragging' : ''}`
                    : 'project-gantt-task-label project-roadmap-task-label'}
                  title={row.type === 'project' ? row.group.project.ten : row.task.tieuDe}
                  draggable={row.type === 'project'}
                  onDragStart={(event) => {
                    if (row.type !== 'project') return;
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', row.group.project.id);
                    setRoadmapProjectDangKeo(row.group.project.id);
                  }}
                  onDragOver={(event) => {
                    if (row.type !== 'project' || !roadmapProjectDangKeo || roadmapProjectDangKeo === row.group.project.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    if (row.type !== 'project') return;
                    event.preventDefault();
                    dropRoadmapProject(row.group.project.id);
                  }}
                  onDragEnd={() => setRoadmapProjectDangKeo(null)}
                >
                  {row.type === 'project' ? (
                    <div className="project-roadmap-project-label-content">
                      <button
                        type="button"
                        className="project-roadmap-toggle"
                        onClick={() => {
                          setCollapsedProjectIds((current) => {
                            const next = new Set(current);
                            if (next.has(row.group.project.id)) {
                              next.delete(row.group.project.id);
                            } else {
                              next.add(row.group.project.id);
                            }
                            return next;
                          });
                        }}
                        title={row.isCollapsed ? t('roadmap.show_tasks') : t('roadmap.hide_tasks')}
                        aria-label={row.isCollapsed ? t('roadmap.show_tasks') : t('roadmap.hide_tasks')}
                      >
                        {row.isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                      </button>
                      <span className="project-roadmap-project-label-text">
                        <span className="project-gantt-task-title">{row.group.project.ten}</span>
                        <span className="project-gantt-task-progress">{row.group.progress}% · {row.group.tasks.length}{t('roadmap.task_count_suffix')}</span>
                      </span>
                    </div>
                  ) : (
                    <>
                      <span className="project-gantt-task-title">{row.task.tieuDe}</span>
                      <span className="project-gantt-task-progress">{row.task.tienDo}% · {dinhDangNgay(row.task.ngayBatDauDuKien)} - {dinhDangNgay(row.task.ngayKetThucDuKien)}</span>
                    </>
                  )}
                </div>
              ))}
              </div>
            </div>
            <div
              className="project-gantt-scroll"
              ref={scrollRef}
              onScroll={onRoadmapScroll}
            >
              <div className="project-gantt-timeline" style={{ width: displayedWeeks * roadmapWeekWidth }}>
                <div className="project-roadmap-calendar">
                  <div className="project-roadmap-months">
                    {monthGroups.map((month) => (
                      <div key={month.key} className="project-roadmap-month" style={{ width: month.span * roadmapWeekWidth }}>
                        {month.label}
                      </div>
                    ))}
                  </div>
                  <div className="project-roadmap-weeks">
                    {weeks.map((week) => (
                      <div key={week.start} className="project-roadmap-week" style={{ width: roadmapWeekWidth }}>
                        <strong>W{week.weekNumber}</strong>
                        <span>{dinhDangNgay(week.start)} - {dinhDangNgay(week.end)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {todayOffset >= 0 && todayOffset < displayedWeeks && (
                  <div
                    className="project-gantt-today-line"
                    style={{
                      left: todayOffset * roadmapWeekWidth + roadmapWeekWidth / 2,
                      top: roadmapHeaderHeight,
                      height: rows.reduce((sum, row) => sum + (row.type === 'project' ? roadmapProjectHeaderHeight : ganttRowHeight), 0)
                    }}
                  />
                )}
                <div className="project-gantt-rows">
                  {rows.map((row) => {
                    if (row.type === 'project') {
                      return <div key={row.key} className="project-roadmap-project-row" />;
                    }

                    const task = row.task;
                    const hasPlanned = Boolean(task.ngayBatDauDuKien && task.ngayKetThucDuKien);
                    const plannedSafeEnd = hasPlanned && khoangCachNgay(task.ngayBatDauDuKien, task.ngayKetThucDuKien) < 0 ? task.ngayBatDauDuKien : task.ngayKetThucDuKien;
                    const plannedLeft = hasPlanned ? Math.max(0, Math.floor(khoangCachNgay(timelineStart, task.ngayBatDauDuKien) / 7) * roadmapWeekWidth) : 0;
                    const plannedWidth = hasPlanned ? Math.max(roadmapWeekWidth, (Math.floor(khoangCachNgay(dauTuanInput(task.ngayBatDauDuKien), dauTuanInput(plannedSafeEnd)) / 7) + 1) * roadmapWeekWidth) : 0;
                    return (
                      <div key={row.key} className="project-gantt-row project-roadmap-task-row">
                        {hasPlanned && (
                          <div
                            className="project-gantt-bar project-gantt-planned-bar"
                            style={{ left: plannedLeft, width: plannedWidth }}
                            title={`${row.group.project.ten} / ${task.tieuDe} - Dự kiến: ${dinhDangNgay(task.ngayBatDauDuKien)} - ${dinhDangNgay(plannedSafeEnd)}`}
                          >
                            <span className="project-gantt-bar-body" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </Modal>
  );
}

function PopupProjectInfo({
  project,
  summary,
  onClose
}: {
  project: ProjectItem;
  summary: {
    totalTasks: number;
    roundedTotalHours: number;
    roundedManDays: number;
    roundedManMonths: number;
    roundedProjectProgress: number;
    completedHours: number;
    totalHours: number;
    hasTaskWithoutEstimate: boolean;
  };
  onClose: () => void;
}) {
  const { t } = useLang();
  const rows: { label: string; value: string }[] = [
    { label: t('project.summary.tasks'), value: `${summary.totalTasks} task` },
    { label: t('project.summary.hours'), value: `${summary.roundedTotalHours}h` },
    { label: t('project.info.man_days'), value: `${summary.roundedManDays} man / day` },
    { label: t('project.info.man_months'), value: `${summary.roundedManMonths} man / month` },
    {
      label: t('project.summary.progress'),
      value: `${summary.roundedProjectProgress}% (${summary.completedHours.toFixed(1)}h / ${summary.totalHours.toFixed(1)}h)`
    },
    {
      label: t('project.info.no_estimate_flag'),
      value: summary.hasTaskWithoutEstimate ? t('project.info.yes') : t('project.info.no')
    }
  ];

  return (
    <Modal onClose={onClose}>
      <section className="popup popup-project-info w-full">
        <div className="project-info-header">
          <div>
            <h2>{t('project.info.title')}</h2>
            <p>{project.ten}</p>
          </div>
          <button type="button" className="nut-icon" onClick={onClose} aria-label={t('gantt.close')}>
            <X size={18} />
          </button>
        </div>
        <div className="project-info-body">
          <table className="project-info-table">
            <thead>
              <tr>
                <th>{t('project.info.metric')}</th>
                <th>{t('project.info.value')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Modal>
  );
}


const ganttGroupHeight = 32;

// Gantt tổng: mọi project, lọc theo project/PIC, nhóm theo project, chỉ task thực thi (task lá).
function PopupGanttTong({
  projects,
  tasksByProject,
  isLoading,
  error,
  onClose,
  onReload,
  onTaskOpen,
  onTaskDatesChange,
  onAssignmentDatesChange,
  onTaskReorder
}: {
  projects: ProjectItem[];
  tasksByProject: Record<string, ProjectTaskItem[]>;
  isLoading: boolean;
  error: string;
  onClose: () => void;
  onReload: () => Promise<void>;
  onTaskOpen: (task: ProjectTaskItem) => void;
  onTaskDatesChange: (task: ProjectTaskItem, start: string, end: string) => Promise<void>;
  onAssignmentDatesChange: (task: ProjectTaskItem, updates: { index: number; start: string; end: string }[]) => Promise<void>;
  onTaskReorder: (projectId: string, taskIds: string[]) => Promise<void>;
}) {
  const { t } = useLang();
  const { pics: picList, picColors } = usePics();
  const picColorsForTask = (assignee: string): string[] =>
    splitAssignees(assignee).map((name) => picColors[name]).filter(Boolean) as string[];
  // Lane theo PIC cho task có phân công giai đoạn: mỗi PIC một dòng, mỗi giai đoạn một đoạn bar.
  const ganttLaneHeight = 16;
  function lanesOfTask(task: ProjectTaskItem) {
    const segs = task.assignments || [];
    if (segs.length === 0) return [] as { pic: string; color: string; segs: { start: string; end: string; index: number; estimateHours: number | null }[] }[];
    const order: string[] = [];
    const byPic = new Map<string, { start: string; end: string; index: number; estimateHours: number | null }[]>();
    segs.forEach((a, index) => {
      // Lọc theo PIC: bỏ qua giai đoạn của PIC không được chọn (giữ nguyên index gốc cho kéo/preview).
      if (activePic && a.pic !== activePic) return;
      if (!byPic.has(a.pic)) { byPic.set(a.pic, []); order.push(a.pic); }
      byPic.get(a.pic)!.push({ start: a.startDate, end: a.endDate, index, estimateHours: a.estimateHours });
    });
    return order.map((pic) => ({ pic, color: picColors[pic] || '#94a3b8', segs: byPic.get(pic)! }));
  }
  function rowHeightOf(task: ProjectTaskItem) {
    const segs = (task.assignments || []).filter((a) => !activePic || a.pic === activePic);
    const lanes = segs.length > 0 ? new Set(segs.map((a) => a.pic)).size : 0;
    return lanes > 0 ? Math.max(ganttRowHeight, lanes * ganttLaneHeight + 14) : ganttRowHeight;
  }
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taskColumnRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef(0);
  const lastScrollTopRef = useRef(-1);
  // Đồng bộ cuộn dọc của cột nhãn theo timeline: bỏ qua khi cuộn ngang (scrollTop không đổi)
  // và gom theo khung hình để không ghi transform mỗi sự kiện cuộn.
  function onGanttScroll(event: React.UIEvent<HTMLDivElement>) {
    const st = event.currentTarget.scrollTop;
    if (st === lastScrollTopRef.current) return;
    lastScrollTopRef.current = st;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (taskColumnRef.current) taskColumnRef.current.style.transform = `translateY(${-lastScrollTopRef.current}px)`;
    });
  }
  const [dragState, setDragState] = useState<GanttDragState | null>(null);
  const [orderDragTaskId, setOrderDragTaskId] = useState<string | null>(null);
  const [orderDropTaskId, setOrderDropTaskId] = useState<string | null>(null);
  const [previewDates, setPreviewDates] = useState<Record<string, { start: string; end: string }>>({});
  const [visibleDayCount, setVisibleDayCount] = useState(28);
  // '' = chưa chọn (màn trống); 'all' = tất cả; còn lại = giá trị cụ thể.
  // Mặc định mở Gantt tổng là "Tất cả dự án".
  const [filterProject, setFilterProject] = useState<string>('all');
  const [filterPic, setFilterPic] = useState<string>('');
  const [collapsedGanttProjectIds, setCollapsedGanttProjectIds] = useState<Set<string>>(new Set());
  // Ẩn task đã xong 100% ở MỌI project — mặc định BẬT (2026-09-26, Council), project "Khác" không
  // còn hardcode ẩn riêng nữa, dùng chung đúng 1 công tắc như mọi project khác.
  const [hide100, setHide100] = useState(true);
  const hasFilter = filterProject !== '' || filterPic !== '';
  const canCollapseGanttProjects = filterProject === 'all';
  // PIC đang lọc cụ thể (không phải '' rỗng hay 'all') -> chỉ vẽ lane/bar của PIC này.
  const activePic = filterPic !== '' && filterPic !== 'all' ? filterPic : null;
  const today = currentVietnamDateInputValue();
  const defaultStart = congNgayInput(today, -7);
  const defaultEnd = congNgayInput(today, 20);

  // Chưa chọn bộ lọc nào -> màn trống. Có lọc tới đâu hiện tới đó.
  // Nhóm theo project; trong mỗi project chỉ lấy task LÁ (không có con) có ngày dự kiến, lọc theo PIC.
  const groups = useMemo(() => {
    if (!hasFilter) return [] as { project: ProjectItem; tasks: ProjectTaskItem[]; numberById: Map<string, string> }[];
    return projects
      .filter((p) => filterProject === '' || filterProject === 'all' || p.id === filterProject)
      .map((p) => {
        const all = tasksByProject[p.id] || [];
        const parentIds = new Set(all.map((tk) => tk.parentId).filter((v): v is string => Boolean(v)));
        const { numberById, orderById } = buildProjectTaskNumbers(all);
        let tasks = all.filter((tk) => !parentIds.has(tk.id) && tk.ngayBatDauDuKien && tk.ngayKetThucDuKien && !(hide100 && tk.tienDo === 100));
        if (filterPic !== '' && filterPic !== 'all') tasks = tasks.filter((tk) => splitAssignees(tk.assignee).includes(filterPic));
        // Thứ tự trên Gantt = thứ tự từ trên xuống ở màn list task (duyệt cây theo sortOrder).
        tasks = [...tasks].sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
        return { project: p, tasks, numberById };
      })
      .filter((g) => g.tasks.length > 0);
  }, [projects, tasksByProject, filterProject, filterPic, hasFilter, hide100]);

  const visibleGroups = useMemo(() => (
    groups.map((group) => {
      const isCollapsed = canCollapseGanttProjects && collapsedGanttProjectIds.has(group.project.id);
      return { ...group, isCollapsed, visibleTasks: isCollapsed ? [] : group.tasks };
    })
  ), [groups, canCollapseGanttProjects, collapsedGanttProjectIds]);
  const allTasks = useMemo(() => visibleGroups.flatMap((g) => g.visibleTasks), [visibleGroups]);
  const plannedPreviewKey = (taskId: string) => `planned:${taskId}`;
  const previewValues = Object.values(previewDates);
  const timelineStart = [defaultStart, ...allTasks.map((tk) => tk.ngayBatDauDuKien), ...previewValues.map((d) => d.start)].sort()[0] || defaultStart;
  const latestEnd = allTasks.map((tk) => tk.ngayKetThucDuKien).filter(Boolean).sort().at(-1);
  const futurePadding = latestEnd ? congThangInput(latestEnd, 1) : defaultEnd;
  const timelineEnd = [defaultEnd, ...allTasks.map((tk) => tk.ngayKetThucDuKien), ...previewValues.map((d) => d.end), futurePadding].sort().at(-1) || defaultEnd;
  const totalDays = Math.max(1, khoangCachNgay(timelineStart, timelineEnd) + 1);
  const displayedDays = Math.max(totalDays, visibleDayCount);
  const days = useMemo(() => Array.from({ length: displayedDays }, (_, i) => congNgayInput(timelineStart, i)), [timelineStart, displayedDays]);
  const monthGroups = useMemo(() => {
    const out: { key: string; label: string; span: number }[] = [];
    for (const day of days) {
      const date = taoNgayTuInput(day);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const label = `Tháng ${date.getMonth() + 1}/${date.getFullYear()}`;
      const last = out.at(-1);
      if (last?.key === key) last.span += 1; else out.push({ key, label, span: 1 });
    }
    return out;
  }, [days]);
  const totalRowsHeight = visibleGroups.reduce((s, g) => s + ganttGroupHeight + g.visibleTasks.reduce((ts, tk) => ts + rowHeightOf(tk), 0), 0);
  const todayOffset = khoangCachNgay(timelineStart, today);
  const defaultScrollLeft = Math.max(0, khoangCachNgay(timelineStart, defaultStart) * ganttDayWidth);
  const didSetInitialScrollRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setVisibleDayCount(Math.max(1, Math.ceil(el.clientWidth / ganttDayWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (scrollRef.current && !didSetInitialScrollRef.current && allTasks.length > 0) {
      scrollRef.current.scrollLeft = defaultScrollLeft;
      didSetInitialScrollRef.current = true;
    }
  }, [defaultScrollLeft, allTasks.length]);
  useEffect(() => {
    if (!dragState) return;
    const d = dragState;
    const deltaDays = (clientX: number) => Math.round((clientX - d.startX) / ganttDayWidth);
    // Tập key + ngày preview tương ứng với vị trí con trỏ.
    // Kéo bar cha -> dời ĐỒNG LOẠT mọi đoạn con theo cùng delta. Còn lại -> 1 key.
    const previewAt = (clientX: number): Record<string, { start: string; end: string }> => {
      if (d.parentSegs) {
        const delta = deltaDays(clientX);
        const out: Record<string, { start: string; end: string }> = {};
        for (const s of d.parentSegs) {
          out[`seg:${d.task.id}:${s.index}`] = { start: congNgayInput(s.start, delta), end: congNgayInput(s.end, delta) };
        }
        return out;
      }
      return { [ganttPreviewKey(d)]: tinhNgayGanttKeo(d, clientX) };
    };
    const clearKeys = d.parentSegs ? d.parentSegs.map((s) => `seg:${d.task.id}:${s.index}`) : [ganttPreviewKey(d)];
    let rafId = 0;
    let pendingX = 0;
    let lastDelta: number | null = null;
    // Gom cập nhật theo khung hình; chỉ re-render khi delta (ngày đã snap) thực sự đổi.
    function flush() {
      rafId = 0;
      const delta = deltaDays(pendingX);
      if (delta === lastDelta) return;
      lastDelta = delta;
      setPreviewDates((c) => ({ ...c, ...previewAt(pendingX) }));
    }
    function move(e: PointerEvent) {
      if (e.pointerId !== d.pointerId) return;
      pendingX = e.clientX;
      if (!rafId) rafId = requestAnimationFrame(flush);
    }
    function up(e: PointerEvent) {
      if (e.pointerId !== d.pointerId) return;
      if (rafId) cancelAnimationFrame(rafId);
      setDragState(null);
      setPreviewDates((c) => { const rest = { ...c }; for (const k of clearKeys) delete rest[k]; return rest; });
      if (d.parentSegs) {
        const delta = deltaDays(e.clientX);
        if (delta !== 0) {
          const updates = d.parentSegs.map((s) => ({ index: s.index, start: congNgayInput(s.start, delta), end: congNgayInput(s.end, delta) }));
          void onAssignmentDatesChange(d.task, updates);
        }
        return;
      }
      const n = tinhNgayGanttKeo(d, e.clientX);
      if (n.start !== d.originalStart || n.end !== d.originalEnd) {
        if (d.assignmentIndex != null) void onAssignmentDatesChange(d.task, [{ index: d.assignmentIndex, start: n.start, end: n.end }]);
        else void onTaskDatesChange(d.task, n.start, n.end);
      }
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragState, onTaskDatesChange, onAssignmentDatesChange]);

  function startDrag(event: React.PointerEvent, task: ProjectTaskItem, mode: GanttDragMode, fallback: { start: string; end: string }, assignmentIndex?: number) {
    event.preventDefault();
    event.stopPropagation();
    const dates = previewDates[ganttPreviewKey({ task, assignmentIndex })] || fallback;
    setDragState({ task, assignmentIndex, mode, pointerId: event.pointerId, startX: event.clientX, originalStart: dates.start, originalEnd: khoangCachNgay(dates.start, dates.end) < 0 ? dates.start : dates.end });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function toggleGanttProject(projectId: string) {
    setCollapsedGanttProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function startOrderDrag(event: React.DragEvent, task: ProjectTaskItem) {
    setOrderDragTaskId(task.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    event.dataTransfer.setData('text/gantt-project-id', task.projectId);
    event.dataTransfer.setData('text/gantt-task-id', task.id);
  }

  function findGanttTask(taskId: string | null) {
    if (!taskId) return null;
    for (const tasks of Object.values(tasksByProject)) {
      const task = tasks.find((item) => item.id === taskId);
      if (task) return task;
    }
    return null;
  }

  function allowOrderDrop(event: React.DragEvent, targetTask: ProjectTaskItem) {
    const taskId = orderDragTaskId || event.dataTransfer.getData('text/gantt-task-id') || event.dataTransfer.getData('text/plain');
    const draggedTask = findGanttTask(taskId);
    if (!draggedTask || draggedTask.id === targetTask.id || draggedTask.projectId !== targetTask.projectId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setOrderDropTaskId(targetTask.id);
  }

  function reorderTaskAbove(draggedTask: ProjectTaskItem, targetTask: ProjectTaskItem) {
    if (draggedTask.id === targetTask.id || draggedTask.projectId !== targetTask.projectId) return;
    const allProjectTasks = tasksByProject[targetTask.projectId] || [];
    const parentIds = new Set(allProjectTasks.map((tk) => tk.parentId).filter((v): v is string => Boolean(v)));
    const executableTasks = allProjectTasks
      .filter((tk) => !parentIds.has(tk.id))
      .sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0) || a.sortOrder - b.sortOrder || Number(a.id) - Number(b.id));
    const nextIds = executableTasks.map((task) => task.id).filter((id) => id !== draggedTask.id);
    const targetIndex = nextIds.indexOf(targetTask.id);
    if (targetIndex < 0) return;
    nextIds.splice(targetIndex, 0, draggedTask.id);
    void onTaskReorder(targetTask.projectId, nextIds);
  }

  function dropOrderTask(event: React.DragEvent, targetTask: ProjectTaskItem) {
    event.preventDefault();
    const draggedTaskId = orderDragTaskId || event.dataTransfer.getData('text/gantt-task-id') || event.dataTransfer.getData('text/plain');
    const draggedTask = findGanttTask(draggedTaskId);
    setOrderDropTaskId(null);
    setOrderDragTaskId(null);
    if (!draggedTask) return;
    reorderTaskAbove(draggedTask, targetTask);
  }

  function taskFromPoint(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>('[data-gantt-task-id]');
    return findGanttTask(row?.dataset.ganttTaskId || null);
  }

  function startOrderPointerDrag(event: React.PointerEvent, task: ProjectTaskItem) {
    event.preventDefault();
    event.stopPropagation();
    setOrderDragTaskId(task.id);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer capture is best-effort */ }

    function move(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== event.pointerId) return;
      const targetTask = taskFromPoint(moveEvent.clientX, moveEvent.clientY);
      setOrderDropTaskId(targetTask && targetTask.id !== task.id && targetTask.projectId === task.projectId ? targetTask.id : null);
    }

    function up(upEvent: PointerEvent) {
      if (upEvent.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const targetTask = taskFromPoint(upEvent.clientX, upEvent.clientY);
      setOrderDragTaskId(null);
      setOrderDropTaskId(null);
      if (targetTask) reorderTaskAbove(task, targetTask);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Kéo BAR CHA của task có phân công: chỉ 'move' (dời cả cụm). Lưu ngày gốc (đã tính cả preview)
  // của mọi đoạn con để dời đồng loạt. Bar cha không có resize -> độ dài luôn suy từ con.
  const legendNames = [...new Set(allTasks.flatMap((tk) => splitAssignees(tk.assignee)))].filter((n) => picColors[n]);

  return (
    <Modal onClose={onClose}>
      <section className="popup popup-project-gantt w-full">
        <div className="project-gantt-header">
          <div>
            <h2>Gantt tổng</h2>
            {legendNames.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                {legendNames.map((n) => (
                  <span key={n} className="flex items-center gap-1 text-xs text-slate-600"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: picColors[n] }} />{n}</span>
                ))}
              </div>
            )}
          </div>
          <div className="ml-auto mr-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600" title="Ẩn task đã xong 100% ở mọi dự án">
              <input type="checkbox" checked={hide100} onChange={(e) => setHide100(e.target.checked)} />
              Ẩn task 100%
            </label>
            <select className="max-w-[13rem] truncate rounded border border-slate-300 py-1 pl-2 pr-7 text-xs" value={filterProject} onChange={(e) => setFilterProject(e.target.value)} title="Lọc theo dự án">
              <option value="">— Lọc dự án —</option>
              <option value="all">Tất cả dự án</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.ten}</option>)}
            </select>
            <select className="max-w-[11rem] truncate rounded border border-slate-300 py-1 pl-2 pr-7 text-xs" value={filterPic} onChange={(e) => setFilterPic(e.target.value)} title="Lọc theo PIC">
              <option value="">— Lọc PIC —</option>
              <option value="all">Tất cả PIC</option>
              {picList.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button type="button" className="nut-icon" onClick={onClose} aria-label={t('gantt.close')}><X size={18} /></button>
        </div>
        {/* Chỉ hiện màn "Đang tải" ở lần nạp đầu (chưa có dữ liệu). Khi lưu/kéo làm nạp lại,
            giữ nguyên lưới để không bị reset vị trí cuộn. */}
        {isLoading && groups.length === 0 ? (
          <div className="project-gantt-empty">{t('loading.roadmap')}</div>
        ) : error ? (
          <div className="project-gantt-empty project-list-error">{error}</div>
        ) : !hasFilter ? (
          <div className="project-gantt-empty">Chọn <b className="mx-1">dự án</b> hoặc <b className="mx-1">PIC</b> ở trên để hiển thị Gantt.</div>
        ) : groups.length === 0 ? (
          <div className="project-gantt-empty">Không có task thực thi nào khớp bộ lọc.</div>
        ) : (
          <div className="project-gantt-shell">
            <div className="project-gantt-task-column">
              <div className="project-gantt-task-column-spacer" />
              <div className="project-gantt-task-labels" ref={taskColumnRef}>
                {visibleGroups.map((g) => (
                  <div key={g.project.id}>
                    <div className="project-gantt-group-label" title={g.project.ten}>
                      {canCollapseGanttProjects && (
                        <button
                          type="button"
                          className="project-gantt-group-toggle"
                          onClick={() => toggleGanttProject(g.project.id)}
                          title={g.isCollapsed ? 'Sổ project' : 'Thu gọn project'}
                          aria-label={g.isCollapsed ? 'Sổ project' : 'Thu gọn project'}
                        >
                          {g.isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                        </button>
                      )}
                      <span className="truncate">{g.project.ten} ({g.tasks.length})</span>
                    </div>
                    {g.visibleTasks.map((task) => (
                      <div
                        key={task.id}
                        className={`project-gantt-task-label project-gantt-task-label-titleonly${orderDragTaskId === task.id ? ' project-gantt-task-label-dragging' : ''}${orderDropTaskId === task.id ? ' project-gantt-task-label-drop' : ''}`}
                        style={{ height: rowHeightOf(task) }}
                        title={`${g.numberById.get(task.id) || ''} · ${task.tieuDe}`}
                        data-gantt-task-id={task.id}
                        data-gantt-project-id={task.projectId}
                        onDragStart={(event) => startOrderDrag(event, task)}
                        onDragOver={(event) => allowOrderDrop(event, task)}
                        onDragLeave={() => setOrderDropTaskId((id) => id === task.id ? null : id)}
                        onDrop={(event) => dropOrderTask(event, task)}
                        onDragEnd={() => { setOrderDragTaskId(null); setOrderDropTaskId(null); }}
                      >
                        <GripVertical
                          size={14}
                          className="project-gantt-task-grip"
                          aria-hidden="true"
                          onPointerDown={(event) => startOrderPointerDrag(event, task)}
                        />
                        <span className="project-gantt-task-id">{g.numberById.get(task.id)}</span>
                        <span className="project-gantt-task-title project-gantt-task-title-wrap">{task.tieuDe}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div
              className="project-gantt-scroll"
              ref={scrollRef}
              onScroll={onGanttScroll}
            >
              <div className="project-gantt-timeline" style={{ width: displayedDays * ganttDayWidth }}>
                <div className="project-gantt-calendar">
                  <div className="project-gantt-months">
                    {monthGroups.map((m) => <div key={m.key} className="project-gantt-month" style={{ width: m.span * ganttDayWidth }}>{m.label}</div>)}
                  </div>
                  <div className="project-gantt-days">
                    {days.map((day) => {
                      const wm = thuTrongTuanGantt(day);
                      return <div key={day} className={`project-gantt-day ${wm.className}`} style={{ width: ganttDayWidth }}><strong>{taoNgayTuInput(day).getDate()}</strong><span>{wm.label}</span></div>;
                    })}
                  </div>
                </div>
                {days.map((day, index) => {
                  const wd = taoNgayTuInput(day).getDay();
                  if (wd !== 0 && wd !== 6 && !isVietnamPublicHoliday(day)) return null;
                  return <div key={`we-${day}`} className="project-gantt-weekend" style={{ left: index * ganttDayWidth, width: ganttDayWidth, top: ganttHeaderHeight, height: totalRowsHeight }} />;
                })}
                {todayOffset >= 0 && todayOffset < displayedDays && (
                  <div className="project-gantt-today-line" style={{ left: todayOffset * ganttDayWidth + ganttDayWidth / 2, top: ganttHeaderHeight, bottom: 0 }} />
                )}
                <div className="project-gantt-rows">
                  {visibleGroups.map((g) => (
                    <div key={g.project.id}>
                      <div className="project-gantt-group-row" />
                      {g.visibleTasks.map((task) => {
                        // Task có phân công theo giai đoạn -> vẽ lane theo PIC; mỗi đoạn kéo/resize được, lưu thẳng vào DB.
                        const lanes = lanesOfTask(task);
                        if (lanes.length > 0) {
                          // Ngày hiện tại của từng đoạn con (ưu tiên preview khi đang kéo) -> dựng bar cha bao trùm.
                          const segCurrent = (task.assignments || []).map((a, index) => {
                            const pv = previewDates[`seg:${task.id}:${index}`];
                            const start = pv ? pv.start : a.startDate;
                            let end = pv ? pv.end : a.endDate;
                            if (khoangCachNgay(start, end) < 0) end = start;
                            return { index, start, end, pic: a.pic };
                          }).filter((s) => !activePic || s.pic === activePic);
                          const parentStart = segCurrent.map((s) => s.start).sort()[0];
                          const parentEnd = segCurrent.map((s) => s.end).sort().at(-1) as string;
                          const parentLeft = Math.max(0, khoangCachNgay(timelineStart, parentStart) * ganttDayWidth);
                          const parentWidth = Math.max(ganttDayWidth, (khoangCachNgay(parentStart, parentEnd) + 1) * ganttDayWidth);
                          return (
                            <div
                              key={task.id}
                              className={`project-gantt-row project-gantt-row-lanes${orderDropTaskId === task.id ? ' project-gantt-row-drop' : ''}`}
                              style={{ height: rowHeightOf(task) }}
                              title={`${task.tieuDe} — ${task.assignee} (${task.tienDo}%)`}
                              data-gantt-task-id={task.id}
                              data-gantt-project-id={task.projectId}
                              onDragOver={(event) => allowOrderDrop(event, task)}
                              onDragLeave={() => setOrderDropTaskId((id) => id === task.id ? null : id)}
                              onDrop={(event) => dropOrderTask(event, task)}
                              onDoubleClick={() => onTaskOpen(task)}
                            >
                              {/* Bar cha: nền NEUTRAL bao trùm mọi đoạn con (min→max), CHỈ hiển thị (không kéo).
                                  Độ dài luôn suy từ con: kéo/giãn bar con vượt biên thì bar cha tự giãn, thu lại thì tự co. */}
                              <div
                                className="project-gantt-parent-bar"
                                style={{ left: parentLeft, width: parentWidth }}
                                title={`${task.tieuDe} — ${dinhDangNgay(parentStart)} - ${dinhDangNgay(parentEnd)} (${task.tienDo}%)`}
                                onDoubleClick={(e) => { e.stopPropagation(); onTaskOpen(task); }}
                              />
                              {/* % tiến độ luôn hiện ở mép phải bar cha */}
                              <span className="project-gantt-bar-progress-aside" style={{ left: parentLeft + parentWidth + 4 }}>{task.tienDo}%</span>
                              <div className="project-gantt-lanes-wrap">
                              {lanes.map((lane, li) => (
                                <div key={li} className="project-gantt-lane" style={{ height: ganttLaneHeight }}>
                                  {lane.segs.map((s, si) => {
                                    const segDates = previewDates[`seg:${task.id}:${s.index}`] || { start: s.start, end: s.end };
                                    const sEnd = khoangCachNgay(segDates.start, segDates.end) < 0 ? segDates.start : segDates.end;
                                    const sLeft = Math.max(0, khoangCachNgay(timelineStart, segDates.start) * ganttDayWidth);
                                    const sWidth = Math.max(ganttDayWidth, (khoangCachNgay(segDates.start, sEnd) + 1) * ganttDayWidth);
                                    const fallback = { start: segDates.start, end: sEnd };
                                    return (
                                      <span
                                        key={si}
                                        className="project-gantt-lane-bar"
                                        style={{ left: sLeft, width: sWidth, backgroundColor: lane.color }}
                                        title={`${lane.pic}: ${dinhDangNgay(segDates.start)} - ${dinhDangNgay(sEnd)}${s.estimateHours == null ? '' : ` · ${s.estimateHours}h`} — kéo để đổi ngày`}
                                        onDoubleClick={(e) => { e.stopPropagation(); onTaskOpen(task); }}
                                        onPointerDown={(event) => startDrag(event, task, 'move', fallback, s.index)}
                                      >
                                        {/* Estimate giờ NGAY TRÊN thân bar — chữ trắng + viền tối để đọc được trên
                                            mọi màu PIC, không phụ thuộc vị trí "0%" (progress-aside, z-index cao
                                            hơn lanes-wrap nên đặt cạnh bar từng bị đè mất khi chỉ có 1 PIC). */}
                                        {s.estimateHours != null && (
                                          <span className="project-gantt-lane-bar-hours" aria-hidden="true">{s.estimateHours}h</span>
                                        )}
                                        <button
                                          type="button"
                                          className="project-gantt-lane-resize project-gantt-lane-resize-start"
                                          onPointerDown={(event) => startDrag(event, task, 'resize-start', fallback, s.index)}
                                          aria-label={t('gantt.resize_start_planned')}
                                        />
                                        <button
                                          type="button"
                                          className="project-gantt-lane-resize project-gantt-lane-resize-end"
                                          onPointerDown={(event) => startDrag(event, task, 'resize-end', fallback, s.index)}
                                          aria-label={t('gantt.resize_end_planned')}
                                        />
                                      </span>
                                    );
                                  })}
                                </div>
                              ))}
                              </div>
                            </div>
                          );
                        }
                        const dates = previewDates[plannedPreviewKey(task.id)] || { start: task.ngayBatDauDuKien, end: task.ngayKetThucDuKien };
                        const safeEnd = khoangCachNgay(dates.start, dates.end) < 0 ? dates.start : dates.end;
                        const left = Math.max(0, khoangCachNgay(timelineStart, dates.start) * ganttDayWidth);
                        const width = Math.max(ganttDayWidth, (khoangCachNgay(dates.start, safeEnd) + 1) * ganttDayWidth);
                        const picCols = activePic
                          ? (picColors[activePic] ? [picColors[activePic]] : [])
                          : picColorsForTask(task.assignee);
                        return (
                          <div
                            key={task.id}
                            className={`project-gantt-row${orderDropTaskId === task.id ? ' project-gantt-row-drop' : ''}`}
                            data-gantt-task-id={task.id}
                            data-gantt-project-id={task.projectId}
                            onDragOver={(event) => allowOrderDrop(event, task)}
                            onDragLeave={() => setOrderDropTaskId((id) => id === task.id ? null : id)}
                            onDrop={(event) => dropOrderTask(event, task)}
                          >
                            <div
                              className={`project-gantt-bar project-gantt-bar-tall project-gantt-planned-bar project-gantt-bar-level-${task.level}${task.tienDo === 100 ? ' project-gantt-bar-done' : ''}`}
                              style={{ left, width }}
                              title={`${task.tieuDe} - ${t('ptask.planned')}: ${dinhDangNgay(dates.start)} - ${dinhDangNgay(safeEnd)} (${task.tienDo}%)${task.assignee ? ` — ${task.assignee}` : ''}`}
                              onDoubleClick={() => onTaskOpen(task)}
                              onPointerDown={(event) => startDrag(event, task, 'move', dates)}
                            >
                              {picCols.length > 0 && (
                                <span className="project-gantt-bar-pics" aria-hidden="true">
                                  {picCols.map((c, i) => <span key={i} style={{ flex: 1, backgroundColor: c }} />)}
                                </span>
                              )}
                              <button type="button" className="project-gantt-resize project-gantt-resize-start" onPointerDown={(event) => startDrag(event, task, 'resize-start', dates)} aria-label={t('gantt.resize_start_planned')} />
                              <span className="project-gantt-bar-body" />
                              <button type="button" className="project-gantt-resize project-gantt-resize-end" onPointerDown={(event) => startDrag(event, task, 'resize-end', dates)} aria-label={t('gantt.resize_end_planned')} />
                            </div>
                            {/* % tiến độ luôn hiện ở mép phải thanh */}
                            <span className="project-gantt-bar-progress-aside" style={{ left: left + width + 4 }}>{task.tienDo}%</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </Modal>
  );
}
