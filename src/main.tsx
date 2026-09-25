import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
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
// Tab Admin (CR-20260913 Giai đoạn 2, Lát 8) — chỉ Admin mới thấy (lọc ở tabsChinhChoActor bên dưới),
// nên cũng lazy-load giống 3 tab kia: đa số user không phải Admin, không cần tải bundle này bao giờ.
const ManHinhAdmin = lazy(() => import('./screens/admin').then((m) => ({ default: m.ManHinhAdmin })));
// Tab Quản lý team (Lát 9) — hiện cho MỌI actor đã active (không gate theo vai trò, khác tab Admin):
// mọi người đều thuộc ít nhất 1 team, Member xem tab Thành viên/Nhật ký được (FR-11a/quyết định 19/09),
// chỉ Leader mới thấy nút thêm/bớt (tự kiểm bên trong màn, không phải ở đây).
const ManHinhQuanLyTeam = lazy(() => import('./screens/team-management').then((m) => ({ default: m.ManHinhQuanLyTeam })));
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
import { AuthProvider, useAuth } from './auth-context';
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
  { key: 'quan_ly_pic', i18nKey: 'tab.pics' },
  // Lát 9 — hiện cho MỌI actor active (không gate, xem ghi chú ở khai báo ManHinhQuanLyTeam trên).
  { key: 'quan_ly_team', i18nKey: 'tab.team' },
  // CR-20260913 Giai đoạn 2 (Lát 8) — chỉ hiện cho Admin (systemRole==='admin'), lọc ở
  // tabsHienThi bên trong App(), không xoá khỏi mảng gốc để chỗ khác (phím tắt, ?tab= URL) vẫn
  // nhận diện được key này.
  { key: 'admin', i18nKey: 'tab.admin' }
];

// 2026-09-25: tab nào ứng với 1 feature trong team_feature_visibility (CR-20260913 FR-7) thì đưa vào
// đây — team mới (provisionTeam) mặc định TẮT cả 5 feature này. Tab KHÔNG có mặt ở map (luyen_de,
// quan_ly_pic, quan_ly_team, admin) không bị gate theo team, giữ nguyên logic hiện có. Trước đây các
// tab này vẫn hiện, bấm vào mới thấy lỗi "Chức năng này đang bị tắt cho team của bạn" (403
// FEATURE_DISABLED từ server) — giờ ẩn hẳn nút, không để user bấm vào rồi mới biết.
const TAB_FEATURE: Partial<Record<TabChinh, string>> = {
  task_ca_nhan: 'personal_task',
  project: 'project',
  bao_cao_tuan: 'weekly_report',
  len_lich: 'release',
  so_do: 'mind_map'
};



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
  const { actor, myTeams, activeTeamId } = useAuth();
  const laAdmin = actor?.systemRole === 'admin';
  // Feature đang 'on' của team đang chọn (FR-7) — team mới mặc định tắt cả 5, xem TAB_FEATURE.
  const activeTeam = myTeams.find((team) => team.id === activeTeamId);
  const enabledFeatures = new Set(activeTeam?.features ?? []);
  // Tab 'admin' chỉ hiện/mở được cho Admin; tab có trong TAB_FEATURE chỉ hiện khi feature tương ứng
  // đang 'on' cho team đang chọn — lọc cả lúc hiện nút LẪN lúc nhận ?tab=... từ URL, để không ai mở
  // thẳng bằng URL rồi thấy màn render lỗi 403 rải rác (tabsChinh giữ đủ mọi key cho phím tắt/URL nhận
  // diện, tabsHienThi mới là danh sách thật sự render nút + cho phép mở).
  const tabsHienThi = tabsChinh.filter((tab) => {
    if (tab.key === 'admin' && !laAdmin) return false;
    const feature = TAB_FEATURE[tab.key];
    if (feature && !enabledFeatures.has(feature)) return false;
    return true;
  });
  // Cho phép mở thẳng tab qua URL: ?tab=project / len_lich / bao_cao_tuan
  const [tabDangMo, setTabDangMo] = useState<TabChinh>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    return tabsHienThi.some((tab) => tab.key === fromUrl) ? (fromUrl as TabChinh) : 'task_ca_nhan';
  });
  // Đổi team (TeamSwitcher) có thể làm tab đang mở biến mất khỏi tabsHienThi (feature team mới tắt) —
  // tự chuyển về tab đầu tiên còn hiện, không để lại màn trống không ai bấm được.
  const tabsHienThiKeys = tabsHienThi.map((tab) => tab.key).join(',');
  useEffect(() => {
    if (!tabsHienThi.some((tab) => tab.key === tabDangMo) && tabsHienThi.length > 0) {
      setTabDangMo(tabsHienThi[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsHienThiKeys]);
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
            {tabsHienThi.map((tab) => (
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
          active={tabDangMo === 'task_ca_nhan' && enabledFeatures.has('personal_task')}
          notificationPermission={notificationPermission}
        />

        {/* Chốt kép cùng enabledFeatures (không chỉ ẩn nút ở nav) — cùng lý do đã áp cho tab 'admin'
            bên dưới: phòng trường hợp tabDangMo còn sót lại đúng 1 tick trước khi effect đổi team tự
            chuyển tab (xem tabsHienThiKeys ở trên), không để lọt 1 tick render nội dung tab đã tắt. */}
        {tabDangMo === 'project' && enabledFeatures.has('project') && (
          <ManHinhProject openGanttOnMount />
        )}

        {tabDangMo === 'len_lich' && enabledFeatures.has('release') && (
          <Suspense fallback={<div className="p-6 text-sm">{t('loading.data')}</div>}>
            <ManHinhLenLich onTasksCreated={(date) => personalTaskRef.current?.refresh(date) ?? Promise.resolve()} />
          </Suspense>
        )}

        {tabDangMo === 'bao_cao_tuan' && enabledFeatures.has('weekly_report') && (
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

        {tabDangMo === 'so_do' && enabledFeatures.has('mind_map') && (
          <Suspense fallback={<div className="p-6 text-sm">{t('loading.data')}</div>}>
            <ManHinhMindMap toast={toast} guardRef={mmGuard} />
          </Suspense>
        )}

        {/* Chốt kép cùng laAdmin (không chỉ ẩn nút ở nav) — phòng trường hợp tabDangMo='admin' còn sót
            lại từ trước khi actor mất quyền Admin giữa phiên (vd Admin khác vừa đổi system_role). */}
        {tabDangMo === 'admin' && laAdmin && (
          <Suspense fallback={<div className="p-6 text-sm">{t('loading.data')}</div>}>
            <ManHinhAdmin />
          </Suspense>
        )}

        {tabDangMo === 'quan_ly_team' && (
          <Suspense fallback={<div className="p-6 text-sm">{t('loading.data')}</div>}>
            <ManHinhQuanLyTeam />
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
