import { lazy, Suspense, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRef } from 'react';
import { useLayoutEffect } from 'react';
import { LangProvider, useLang } from './useLang';
import { type TranslationKey } from './i18n';
// Ba tab nặng & độc lập -> tải động (code-split) để bundle khởi động nhẹ hơn,
// chỉ nạp khi người dùng mở đúng tab.
// CR-20260819: release.tsx là 1 trong các file lớn nhất repo nhưng chưa code-split như 3 tab dưới —
// đây là nợ hiệu năng có sẵn (bundle chính chỉ còn 2.6 kB dư từ CR-20260814), lát này thêm vài dòng
// đã vượt ngân sách 500 kB. Áp đúng khuôn lazy đã dùng cho 3 tab kia thay vì nâng ngân sách lặng lẽ.
const ManHinhLenLich = lazy(() => import('./screens/release').then((m) => ({ default: m.ManHinhLenLich })));
const ManHinhLuyenDe = lazy(() => import('./luyen-de').then((m) => ({ default: m.ManHinhLuyenDe })));
const ManHinhMindMap = lazy(() => import('./mind-map').then((m) => ({ default: m.ManHinhMindMap })));
import { useGlobalShortcuts } from './shortcuts';
import { InfoTip } from './ui';
import {
  ArrowDownUp,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Bell,
  CalendarDays,
  CalendarRange,
  ChartGantt,
  Copy,
  FileSpreadsheet,
  Github,
  GripVertical,
  Info,
  Paperclip,
  Rocket,
  Target,
  X
} from 'lucide-react';
import './styles.css';
import { mondayOfWeek } from './lib/date';
import {
  taskLinkTypeLabels, maxTaskLinks, projectTaskProgressOptions, progressSelectOptions, splitAssignees,
  clientAutoStatus, parseGoalConflict, goalConflictMessage, taskLinkHref
} from './lib/task-utils';
import { TaskLinkIcon } from './components/task-atoms';
import { ManHinhProject } from './screens/project';
import { ManHinhBaoCaoTuan } from './screens/weekly';
import { ManHinhQuanLyDanhMuc } from './screens/settings';
import { ManHinhTaskCaNhan, type ManHinhTaskCaNhanHandle } from './screens/personal-task';
import { PicProvider, ToastProvider, useToast } from './context';
import { AuthProvider } from './auth-context';
import { AuthShell } from './screens/auth-shell';
import { TeamSwitcher } from './components/team-switcher';
import { ApiError } from './api';
import {
  VIETNAM_TIME_ZONE, dateTimePartsInVietnam, congNgayInput, congThangInput,
  roundedImmediateStartTime, normalizeEmergencyTaskStartTime,
  formatRelativeOffset, relativeOffsetHourOptions, relativeOffsetMinuteOptions, splitRelativeOffset, mergeRelativeOffset
} from './lib/date';
import type {
  TruongSort, HuongSort, TabChinh, ReleaseType, EmergencyTimingToken, TaskLinkType,
  ReleaseTemplateItem, ReleaseTaskDefinition, EmergencyReleaseTaskDefinition,
  ReleaseSyncPreview, ProjectTaskProgress, ProjectTaskAssignment,
  ProjectCreateBody, ToastKind, ToastItem
} from './types';





const tabsChinh: { key: TabChinh; i18nKey: TranslationKey }[] = [
  { key: 'task_ca_nhan', i18nKey: 'tab.personal' },
  { key: 'project', i18nKey: 'tab.project' },
  { key: 'bao_cao_tuan', i18nKey: 'tab.weekly' },
  { key: 'len_lich', i18nKey: 'tab.schedule' },
  { key: 'luyen_de', i18nKey: 'tab.luyen_de' },
  { key: 'so_do', i18nKey: 'tab.so_do' },
  { key: 'quan_ly_pic', i18nKey: 'tab.pics' }
];



// Bản sao nhỏ, cố ý trùng với hàm cùng tên trong screens/personal-task.tsx: shell cần hàm này cho
// state notificationPermission khởi tạo + nút xin quyền trên nav, module Task cá nhân cũng cần nó
// cho effect kiểm tra task định kỳ sắp tới — dùng chung 1 file cho một hàm thuần 1 dòng sẽ tạo phụ
// thuộc chéo không cần thiết giữa shell và module (kế hoạch Council run 022dd1e5).
function supportsBrowserNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

// Export (không chỉ dùng nội bộ file) để test tích hợp render được thật (Codex code-review vòng 3
// §8.3 — không được lấy unit test reducer/store làm thay cho việc chưa từng render `main.tsx`).
export function App() {
  const { t } = useLang();
  // Cho phép mở thẳng tab qua URL: ?tab=project / len_lich / bao_cao_tuan
  const [tabDangMo, setTabDangMo] = useState<TabChinh>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    return tabsChinh.some((tab) => tab.key === fromUrl) ? (fromUrl as TabChinh) : 'task_ca_nhan';
  });
  // Chặn chuyển tab khi MindMap có thay đổi chưa lưu.
  const toast = useToast();
  const mmGuard = useRef<{ dirty: boolean; luu: () => Promise<void> } | null>(null);
  const [pendingTab, setPendingTab] = useState<TabChinh | null>(null);
  const chuyenTab = useCallback((next: TabChinh) => {
    if (next === tabDangMo) return;
    if (tabDangMo === 'so_do' && mmGuard.current?.dirty) { setPendingTab(next); return; }
    setTabDangMo(next);
  }, [tabDangMo]);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => (
    supportsBrowserNotifications() ? Notification.permission : 'denied'
  ));
  // Council run 022dd1e5 (docs/exchanges/2026-09-12.md): ref-handle mỏng để shell điều khiển
  // module Task cá nhân (mở popup nhanh/lịch sử qua phím tắt, làm mới sau khi Lên lịch tạo task)
  // mà không phải nâng state của module đó lên đây.
  const personalTaskRef = useRef<ManHinhTaskCaNhanHandle>(null);

  // Phím tắt toàn cục cấu hình động (màn Cài đặt > Phím tắt). Chuyển tab + mở popup.
  useGlobalShortcuts({
    'tab:task_ca_nhan': () => chuyenTab('task_ca_nhan'),
    'tab:project': () => chuyenTab('project'),
    'tab:bao_cao_tuan': () => chuyenTab('bao_cao_tuan'),
    'tab:len_lich': () => chuyenTab('len_lich'),
    'tab:luyen_de': () => chuyenTab('luyen_de'),
    'tab:so_do': () => chuyenTab('so_do'),
    'tab:quan_ly_pic': () => chuyenTab('quan_ly_pic'),
    'action:them_task_nhanh': () => personalTaskRef.current?.openQuickAdd(),
    'action:lich_su': () => personalTaskRef.current?.openHistory()
  });

  async function batThongBaoTaskDinhKy() {
    if (!supportsBrowserNotifications()) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }

  return (
    <main className="h-screen overflow-hidden bg-hoa-van text-muc">
      <div className="mx-auto flex h-full w-full max-w-[calc(100vw-128px)] flex-col px-4 py-3 2xl:max-w-[calc(100vw-160px)]">
        <div className="app-brand">Personal Tool</div>
        <nav className="menu-tabs" aria-label="Chức năng chính">
          <div className="menu-tab-list">
            {tabsChinh.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`menu-tab ${tabDangMo === tab.key ? 'menu-tab-active' : ''}`}
                onClick={() => chuyenTab(tab.key)}
              >
                {t(tab.i18nKey)}
              </button>
            ))}
          </div>
          <div className="menu-tab-actions">
            {tabDangMo === 'task_ca_nhan' && supportsBrowserNotifications() && notificationPermission !== 'granted' && (
              <button
                className="nut-phu"
                disabled={notificationPermission === 'denied'}
                onClick={batThongBaoTaskDinhKy}
                title={notificationPermission === 'denied' ? t('header.notify_blocked_title') : t('header.notify_enable_title')}
              >
                <Bell size={18} />
                {notificationPermission === 'denied' ? t('header.notify_blocked') : t('header.notify_enable')}
              </button>
            )}
            {/* CR-20260913 FR-13 — bộ chọn team, góc trên cạnh tên người dùng (kiểu chuyển workspace
                Slack/Notion), chuyển ngay không tải lại trang. */}
            <TeamSwitcher />
          </div>
        </nav>

        <ManHinhTaskCaNhan
          ref={personalTaskRef}
          active={tabDangMo === 'task_ca_nhan'}
          notificationPermission={notificationPermission}
        />

        {tabDangMo === 'project' && (
          <ManHinhProject openGanttOnMount />
        )}

        {tabDangMo === 'len_lich' && (
          <Suspense fallback={<div className="p-6 text-sm">{t('loading.data')}</div>}>
            <ManHinhLenLich onTasksCreated={(date) => personalTaskRef.current?.refresh(date) ?? Promise.resolve()} />
          </Suspense>
        )}

        {tabDangMo === 'bao_cao_tuan' && (
          <ManHinhBaoCaoTuan />
        )}

        {tabDangMo === 'quan_ly_pic' && (
          <ManHinhQuanLyDanhMuc />
        )}

        {tabDangMo === 'luyen_de' && (
          <Suspense fallback={<div className="p-6 text-sm">{t('loading.data')}</div>}>
            <ManHinhLuyenDe />
          </Suspense>
        )}

        {tabDangMo === 'so_do' && (
          <Suspense fallback={<div className="p-6 text-sm">{t('loading.data')}</div>}>
            <ManHinhMindMap toast={toast} guardRef={mmGuard} />
          </Suspense>
        )}
      </div>

      {pendingTab && (
        <div className="overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setPendingTab(null); }}>
          <div className="popup w-full max-w-md">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold">Lưu thay đổi?</h2>
              <button type="button" className="nut-icon" onClick={() => setPendingTab(null)}><X size={18} /></button>
            </div>
            <p className="mb-5 text-sm leading-6 text-phu">Sơ đồ tư duy có thay đổi chưa lưu. Lưu trước khi rời đi?</p>
            <div className="flex justify-end gap-2">
              <button className="mm-btn" onClick={() => setPendingTab(null)}>Huỷ</button>
              <button className="mm-btn" onClick={() => { const n = pendingTab; setPendingTab(null); if (n) setTabDangMo(n); }}>Không lưu</button>
              <button className="mm-btn mm-btn-primary" onClick={async () => { const n = pendingTab; await mmGuard.current?.luu(); setPendingTab(null); if (n) setTabDangMo(n); }}>Lưu &amp; rời</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}




// Guard `rootEl` (không `!`): file này cũng bị import để lấy `App` cho test tích hợp (không có
// `#root` trong jsdom) — bỏ qua render thật ở ngữ cảnh đó, không đổi gì hành vi lúc chạy app thật
// (`index.html` luôn có `#root`).
const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    // CR-20260913 (nền tảng đa người dùng) — AuthProvider bọc ngoài cùng (trừ LangProvider): mọi
    // Provider/màn hình bên trong đều có thể cần biết trạng thái đăng nhập/team đang chọn. AuthShell
    // tự quyết định hiện màn nào theo `phase` (logged_out/disabled/pending/active/...) — chỉ khi
    // active mới mount PicProvider + App thật (PicProvider cần activeTeamId từ AuthContext, xem
    // src/context.tsx).
    <LangProvider>
      <AuthProvider>
        <ToastProvider>
          <AuthShell>
            <PicProvider><App /></PicProvider>
          </AuthShell>
        </ToastProvider>
      </AuthProvider>
    </LangProvider>
  );
}
