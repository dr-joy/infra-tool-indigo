// Màn hình "Lên lịch Release" (định kỳ + khẩn cấp): quản lý template/task định nghĩa,
// sinh task theo ngày release, timeline. Tách khỏi main.tsx (khối lớn nhất). ManHinhLenLich
// là export chính; `emergencyReleaseTaskPayloads` cũng export riêng (CR-20260819) vì nó là
// hàm THUẦN cần unit test không dựng DOM — cùng lý do `isPastReleaseTaskDate` tách khỏi
// route trong server/routes/schedules.ts. Phần helper/popup còn lại vẫn nội bộ.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp, ArrowDownWideNarrow, ArrowUpNarrowWide, Bell, CalendarDays, CalendarRange, Check,
  ChartGantt, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, FileSpreadsheet, Github,
  GripVertical, History, Info, Paperclip, Pencil, Plus, Rocket, Search, Target, Trash2, X
} from 'lucide-react';
import { useLang } from '../useLang';
import type { TranslationKey } from '../i18n';
import { InfoTip, TimeInput } from '../ui';
import { api, ApiError } from '../api';
import { Modal } from '../components/Modal';
import { CopyNoteButton, TaskLinkIcon, TaskLinkBadges, TaskLinkEditor, SortIcon } from '../components/task-atoms';
import { usePics, useToast } from '../context';
import {
  taoNgayTuInput, localDateInputValue, mondayOfWeek, congNgayInput, congThangInput, currentVietnamDateInputValue,
  dinhDangNgay, dinhDangNgayDayDu, addDays, timeToMinutes, minutesToTime, snapMinutes, clamp,
  layGioPhutVietNam, roundedImmediateStartTime, normalizeEmergencyTaskStartTime, parseLocalDateTime,
  formatRelativeOffset, relativeOffsetHourOptions, relativeOffsetMinuteOptions, splitRelativeOffset, mergeRelativeOffset
} from '../lib/date';
import {
  tenTrangThai, trangThaiLabel, taskLinkTypeLabels, maxTaskLinks, normalizedTaskLinks, taskLinkHref,
  sapXepTask, taoSortHienTai, sortButtonClass, tinhLaneTaskDinhKy, splitAssignees
} from '../lib/task-utils';
import type {
  Task, TaskLink, TaskLinkType, ReleaseType, ReleaseTemplateItem, ReleaseTaskDefinition,
  EmergencyReleaseTaskDefinition, ReleaseSyncPreview, EmergencyTimingToken
} from '../types';

function sortTemplatesByName(templates: ReleaseTemplateItem[]) {
  return [...templates].sort((a, b) => {
    const nameDiff = a.name.localeCompare(b.name, 'vi');
    if (nameDiff !== 0) return nameDiff;
    return a.id.localeCompare(b.id, 'vi');
  });
}

const releaseTemplateTokens = [
  { token: 'jack.monday', label: 'Thứ 2 tuần Jack' },
  { token: 'jack.tuesday', label: 'Thứ 3 tuần Jack' },
  { token: 'jack.wednesday', label: 'Thứ 4 tuần Jack' },
  { token: 'jack.thursday', label: 'Thứ 5 tuần Jack' },
  { token: 'jack.friday', label: 'Thứ 6 tuần Jack' },
  { token: 'develop.monday', label: 'Thứ 2 tuần Dev' },
  { token: 'develop.tuesday', label: 'Thứ 3 tuần Dev' },
  { token: 'develop.wednesday', label: 'Thứ 4 tuần Dev' },
  { token: 'develop.thursday', label: 'Thứ 5 tuần Dev' },
  { token: 'develop.friday', label: 'Thứ 6 tuần Dev' },
  { token: 'staging.monday', label: 'Thứ 2 tuần Staging' },
  { token: 'staging.tuesday', label: 'Thứ 3 tuần Staging' },
  { token: 'staging.wednesday', label: 'Thứ 4 tuần Staging' },
  { token: 'staging.thursday', label: 'Thứ 5 tuần Staging' },
  { token: 'staging.friday', label: 'Thứ 6 tuần Staging' },
  { token: 'release.date', label: 'Ngày Release' },
  { token: 'demo.monday', label: 'Thứ 2 tuần Demo' },
  { token: 'demo.tuesday', label: 'Thứ 3 tuần Demo' },
  { token: 'demo.wednesday', label: 'Thứ 4 tuần Demo' },
  { token: 'demo.thursday', label: 'Thứ 5 tuần Demo' },
  { token: 'demo.friday', label: 'Thứ 6 tuần Demo' },
  { token: 'afterDemo.monday', label: 'Thứ 2 sau tuần Demo' }
];

const emergencyReleaseTemplateTokens = [
  { token: 'staging.deployDate', label: 'Ngày deploy staging dự kiến' },
  { token: 'staging.deployAt', label: 'Ngày giờ deploy staging dự kiến' },
  { token: 'release.deployDate', label: 'Ngày release master dự kiến' },
  { token: 'release.deployAt', label: 'Ngày giờ release master dự kiến' },
  { token: 'demo.deployDate', label: 'Ngày deploy demo dự kiến' },
  { token: 'demo.deployAt', label: 'Ngày giờ deploy demo dự kiến' },
  // CR-20260819 (đổi thiết kế theo feedback Leader): thay vì DÒ dòng "@" trơ theo nội dung (dễ vỡ nếu
  // template có nhiều dòng "@"), dùng TOKEN tường minh. Đặt {{mention}} ở đâu cũng được, có thể lặp
  // nhiều lần — chỗ nào có token thì chỗ đó được thay. Không có tên nào -> thay bằng rỗng (dòng "@{{mention}}"
  // thành "@" trơ, giữ nguyên hành vi cũ để AI hỏi lúc precheck).
  { token: 'mention', label: 'Danh sách người mention (điền lúc tạo task, tự nối "A, B, C")' }
];

const releaseDateTokens = releaseTemplateTokens;
const validReleaseTemplateTokens = new Set(releaseTemplateTokens.map((item) => item.token));
const validEmergencyReleaseTemplateTokens = new Set(emergencyReleaseTemplateTokens.map((item) => item.token));

const releaseWeekLabels: Record<string, string> = {
  jack: 'Tuần Jack',
  develop: 'Tuần Develop',
  staging: 'Tuần Staging',
  demo: 'Tuần Demo',
  afterDemo: 'Sau tuần Demo'
};

const releaseWeekShortLabels: Record<string, string> = {
  jack: 'Jack',
  develop: 'Dev',
  staging: 'Staging',
  demo: 'Demo',
  afterDemo: 'After Demo'
};

const emergencyTimingOptions: { token: EmergencyTimingToken; label: string; offset: number }[] = [
  { token: 'before_hotfix', label: 'Trước HotFix 1 ngày', offset: -1 },
  { token: 'hotfix', label: 'Ngày HotFix', offset: 0 },
  { token: 'after_hotfix', label: 'Sau HotFix 1 ngày', offset: 1 },
  { token: 'staging_deploy', label: 'Theo giờ deploy staging', offset: 0 },
  { token: 'release_deploy', label: 'Theo giờ release master', offset: 0 },
  { token: 'demo_deploy', label: 'Theo giờ deploy demo', offset: 0 }
];

type EmergencyReleaseScheduleInput = {
  stagingDeployAt: string;
  releaseDeployAt: string;
  demoDeployAt: string;
};

const emergencyPendingStorageKey = 'task-manager:pending-emergency-release';
const emergencyReleaseDateStorageKey = 'task-manager:pending-emergency-release-date';
const emergencyAfterCreateEndStorageKey = 'task-manager:pending-emergency-after-create-end';
const relativeEmergencyTimingTokens = new Set<EmergencyTimingToken>(['staging_deploy', 'release_deploy', 'demo_deploy']);
const emergencyScheduleBaseFields: Record<string, keyof EmergencyReleaseScheduleInput> = {
  staging_deploy: 'stagingDeployAt',
  release_deploy: 'releaseDeployAt',
  demo_deploy: 'demoDeployAt'
};

function releaseTokenWeekKey(token: string) {
  if (token === 'release.date') return 'staging';
  return token.split('.')[0] || 'demo';
}

function releaseTokenDayOrder(token: string) {
  const day = token.split('.')[1];
  const order: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    date: 5
  };
  return order[day] || 99;
}

function releaseTokenSortValue(token: string) {
  const weekOrder: Record<string, number> = {
    jack: 1,
    develop: 2,
    staging: 3,
    demo: 4,
    afterDemo: 5
  };
  return (weekOrder[releaseTokenWeekKey(token)] || 99) * 10 + releaseTokenDayOrder(token);
}

function compareReleaseTaskDefinitions(a: ReleaseTaskDefinition, b: ReleaseTaskDefinition) {
  const dateDiff = releaseTokenSortValue(a.dateToken) - releaseTokenSortValue(b.dateToken);
  if (dateDiff !== 0) return dateDiff;
  const timeDiff = timeToMinutes(a.startTime, '00:00') - timeToMinutes(b.startTime, '00:00');
  if (timeDiff !== 0) return timeDiff;
  return a.title.localeCompare(b.title);
}




function formatVNDate(date: Date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function formatVNTemplateDate(date: Date) {
  const weekday = new Intl.DateTimeFormat('vi-VN', { weekday: 'long' }).format(date);
  const normalizedWeekday = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`;
  return `${formatVNDate(date)} (${normalizedWeekday})`;
}

function hasJapaneseText(content: string) {
  return /[\u3040-\u30ff]/.test(content);
}

function formatJPDate(date: Date) {
  const weekdaysJP = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日 (${weekdaysJP[date.getDay()]})`;
}

function formatTemplateDate(date: Date, content: string) {
  return hasJapaneseText(content) ? formatJPDate(date) : formatVNTemplateDate(date);
}

function formatVNWeekdayDate(date: Date) {
  const weekday = new Intl.DateTimeFormat('vi-VN', { weekday: 'long' }).format(date);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${formatVNDate(date)}`;
}

function tinhNgayRelease(releaseDate: string) {
  const release = taoNgayTuInput(releaseDate);
  const stagingMonday = mondayOfWeek(release);
  const demoMonday = addDays(stagingMonday, 7);
  const developMonday = addDays(stagingMonday, -7);
  const jackMonday = addDays(stagingMonday, -14);

  return {
    release,
    stagingMonday,
    demoMonday,
    jackFriday: addDays(jackMonday, 4),
    developThursday: addDays(developMonday, 3),
    developFriday: addDays(developMonday, 4),
    jackMonday,
    developMonday,
    demoTuesday: addDays(demoMonday, 1),
    demoFriday: addDays(demoMonday, 4),
    afterDemoMonday: addDays(demoMonday, 7)
  };
}

function releaseTokenDateMap(releaseDate: string) {
  const dates = tinhNgayRelease(releaseDate);
  return {
    'jack.monday': dates.jackMonday,
    'jack.tuesday': addDays(dates.jackMonday, 1),
    'jack.wednesday': addDays(dates.jackMonday, 2),
    'jack.thursday': addDays(dates.jackMonday, 3),
    'jack.friday': dates.jackFriday,
    'develop.monday': dates.developMonday,
    'develop.tuesday': addDays(dates.developMonday, 1),
    'develop.wednesday': addDays(dates.developMonday, 2),
    'develop.thursday': dates.developThursday,
    'develop.friday': dates.developFriday,
    'staging.monday': dates.stagingMonday,
    'staging.tuesday': addDays(dates.stagingMonday, 1),
    'staging.wednesday': addDays(dates.stagingMonday, 2),
    'staging.thursday': addDays(dates.stagingMonday, 3),
    'staging.friday': dates.release,
    'release.date': dates.release,
    'demo.monday': dates.demoMonday,
    'demo.tuesday': dates.demoTuesday,
    'demo.wednesday': addDays(dates.demoMonday, 2),
    'demo.thursday': addDays(dates.demoMonday, 3),
    'demo.friday': dates.demoFriday,
    'afterDemo.monday': dates.afterDemoMonday
  };
}

function renderManagedReleaseTemplate(content: string, releaseDate: string) {
  const dateMap = releaseTokenDateMap(releaseDate);
  return content.replace(/\{\{([\w.]+)\}\}/g, (match, token: keyof typeof dateMap) => {
    const date = dateMap[token as keyof typeof dateMap];
    return date ? formatTemplateDate(date, content) : match;
  });
}

// Export (CR-20260819) để unit test không cần dựng DOM. `mentionText` là chuỗi ĐÃ NỐI sẵn theo quy tắc
// "A, B, C" (popup chịu trách nhiệm nối, xem PopupChonNgayReleaseKhanCap) — hàm này chỉ thay token.
//
// Token {{mention}} thay cho cách dò "dòng đầu đúng bằng @" trước đây: dò theo VỊ TRÍ DÒNG sẽ hỏng ngay
// nếu template có NHIỀU HƠN 1 dòng bắt đầu bằng "@" (chỉ dòng đầu được thay, các dòng "@" khác bị bỏ sót
// — feedback Leader 2026-08-19). Token là marker TƯỜNG MINH: đặt ở đâu cũng được, lặp bao nhiêu lần cũng
// được, mỗi chỗ có token đều được thay giống nhau — không còn phụ thuộc thứ tự/số lượng dòng "@".
export function renderEmergencyReleaseTemplate(content: string, releaseDate: string, mentionText = '') {
  const hotfixDate = taoNgayTuInput(releaseDate);
  const dateMap: Record<string, Date> = {
    'release.date': hotfixDate,
    'release.previousDate': addDays(hotfixDate, -1)
  };
  return content.replace(/\{\{([\w.]+)\}\}/g, (match, token: string) => {
    // Không có tên nào -> thay bằng rỗng: "@{{mention}}" thành "@" trơ, giữ nguyên hành vi cũ (AI hỏi
    // lúc precheck qua needsInput). Có tên -> thêm 1 khoảng trắng cố định trước danh sách đã nối sẵn.
    if (token === 'mention') return mentionText ? ` ${mentionText}` : '';
    const date = dateMap[token];
    return date ? formatTemplateDate(date, content) : match;
  });
}

function parseDateTimeInput(value: string) {
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function localDateTimeInputValue(date: Date) {
  return `${localDateInputValue(date)}T${minutesToTime(date.getHours() * 60 + date.getMinutes())}`;
}

function formatTemplateTime(date: Date) {
  return minutesToTime(date.getHours() * 60 + date.getMinutes());
}

function formatTemplateDateTime(date: Date, content: string) {
  return `${formatTemplateDate(date, content)} ${formatTemplateTime(date)}`;
}

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function renderEmergencyReleaseScheduleTemplate(
  content: string,
  schedule: EmergencyReleaseScheduleInput
) {
  const staging = parseDateTimeInput(schedule.stagingDeployAt);
  const release = parseDateTimeInput(schedule.releaseDeployAt);
  const demo = parseDateTimeInput(schedule.demoDeployAt);
  const dateMap: Record<string, Date> = {
    'release.date': release,
    'release.previousDate': addDays(release, -1),
    'staging.deployDate': staging,
    'staging.deployAt': staging,
    'release.deployDate': release,
    'release.deployAt': release,
    'demo.deployDate': demo,
    'demo.deployAt': demo
  };
  return content.replace(/\{\{([\w.]+)\}\}/g, (match, token: string) => {
    const date = dateMap[token];
    if (!date) return match;
    if (!token.endsWith('At')) return formatTemplateDate(date, content);
    const displayDateTime = hasJapaneseText(content) ? addMinutes(date, 120) : date;
    return formatTemplateDateTime(displayDateTime, content);
  });
}

function invalidTemplateTokens(content: string, validTokens = validReleaseTemplateTokens) {
  return [...content.matchAll(/\{\{([\w.]+)\}\}/g)]
    .map((match) => match[1])
    .filter((token) => !validTokens.has(token));
}

function releaseTaskPayloads(releaseDate: string) {
  const dates = tinhNgayRelease(releaseDate);
  const noteLinks = (urls: string[]) => urls.map((url) => `<a href="${url}">${url}</a>`).join('\n');
  const task = (tenTask: string, date: Date, gioBatDau: string, ghiChu = '') => ({
    tenTask,
    ghiChu,
    ngayCuThe: localDateInputValue(date),
    gioBatDau
  });

  return [
    task(
      'Tạo ticket cho web/mobile cho release định kỳ',
      addDays(dates.demoMonday, 2),
      '10:00',
      noteLinks([
        'https://redmine.famishare.jp/projects/drjoy_vn/versions/new',
        'https://docs.google.com/spreadsheets/d/18lSA-Ad1P0QDApBaoW3zK6L8KuoUE8PHVAH64aHaJ_g/edit?gid=2005030498#gid=2005030498&range=A1'
      ])
    ),
    task(
      'Tạo file release schedule',
      addDays(dates.demoMonday, 2),
      '10:15',
      noteLinks(['https://drive.google.com/drive/folders/15deyuUu6NVpRcemVG37a_8rperzXiDxg'])
    ),
    task('Đăng thông báo release định kỳ và remaind cho các PM', dates.jackMonday, '10:00'),
    task('Book mtg release định kỳ với 2 phía JP và VN', dates.developMonday, '10:00'),
    task('Báo lock file release schedule và check nội dung file', dates.developThursday, '13:00'),
    task('Thông báo lịch release trên kênh 研究開発部', dates.developFriday, '10:00'),
    task('Thông báo lịch release trên VN_Dev', dates.developFriday, '10:15'),
    task('Thông báo bắt đầu deploy môi trường staging trên kênh 研究開発部', dates.stagingMonday, '13:00'),
    task('Thông báo kết thúc deploy môi trường staging trên kênh 研究開発部', dates.stagingMonday, '16:00'),
    task('Verify release schedule file', dates.stagingMonday, '16:15'),
    task('Thông báo release trên kênh 研究開発部', dates.release, '13:00'),
    task('Thông báo release trên kênh Dev_VN', dates.release, '13:15'),
    task('Check tình hình test của các team và thông báo kết thúc release trên 2 kênh 研究開発部 và VN_dev', dates.release, '16:00'),
    task('Verify file release schedule', dates.release, '16:15'),
    task('Confirm tình hình chuẩn bị deploy môi trường demo với member', dates.demoMonday, '14:00'),
    task('Thông báo deploy môi trường demo trên kênh 研究開発部', dates.demoMonday, '16:00'),
    task('Thông báo deploy môi trường demo trên kênh Dev_VN', dates.demoMonday, '16:15'),
    task('Thông báo kết thúc deploy môi trường demo và báo các team test', dates.demoMonday, '16:45'),
    task('Thông báo deploy môi trường demo kết thúc  trên kênh 研究開発部', dates.demoMonday, '17:00'),
    task('verify file release schedule', dates.demoTuesday, '10:00'),
    task(
      'Khóa file monitoring API, list các team chưa điền',
      dates.demoMonday,
      '09:00',
      noteLinks(['https://docs.google.com/spreadsheets/d/1BdrS348f0J-4NMjQ5RFAnmTEL_OdWXCivyiUU6_boYA/edit?gid=208881862#gid=208881862&range=A1'])
    ),
    task('Nhắc thầy Phú lấy data cho file Theo dõi API latency', dates.demoMonday, '09:30'),
    task('Confirm kết quả lấy data cho file Theo dõi API latency', dates.demoTuesday, '13:00'),
    task(
      'Nhắc thầy Phú lấy kết quả monitoring',
      dates.demoFriday,
      '09:00',
      noteLinks(['https://docs.google.com/spreadsheets/d/13kWR4vqVDvlQWo1XZ_ZFL2iLJn382LTDep07PWt0gIU/edit?gid=549760443'])
    ),
    task('Confirm tình hình lấy kết quả monitoring của thầy Phú', dates.demoFriday, '14:00'),
    task(
      'Khóa file kết quả monitoring và API latency',
      dates.afterDemoMonday,
      '09:00',
      noteLinks([
        'https://docs.google.com/spreadsheets/d/13kWR4vqVDvlQWo1XZ_ZFL2iLJn382LTDep07PWt0gIU/edit?gid=549760443#gid=549760443&range=A1',
        'https://docs.google.com/spreadsheets/d/1BdrS348f0J-4NMjQ5RFAnmTEL_OdWXCivyiUU6_boYA/edit?gid=208881862#gid=208881862&range=1:1'
      ])
    ),
    task('Tổng hợp các team chưa hoàn thành Task monitoring', dates.afterDemoMonday, '10:00')
  ];
}

function releaseTaskPayloadsFromDefinitions(
  releaseDate: string,
  definitions: ReleaseTaskDefinition[],
  templates: ReleaseTemplateItem[]
) {
  const dateMap = releaseTokenDateMap(releaseDate);
  return [...definitions].sort(compareReleaseTaskDefinitions).map((definition) => {
    const templateContent = templates.find((item) => item.id === definition.templateId)?.content || '';
    const generatedNote = templateContent ? renderManagedReleaseTemplate(templateContent, releaseDate) : '';
    const date = dateMap[definition.dateToken as keyof typeof dateMap] || dateMap['release.date'];
    return {
      tenTask: definition.title,
      ghiChu: generatedNote,
      links: normalizedTaskLinks(definition.links || []),
      ngayCuThe: localDateInputValue(date),
      gioBatDau: definition.startTime,
      // Ref ổn định: origin = chính definition này. Backend tự tra `replyToRef` từ definition
      // (Council run 7fd3e4d1) — FE không còn gửi giá trị này nữa.
      originRef: definition.id
    };
  });
}

function releaseTaskTemplatePreview(
  definition: { templateId: string },
  templates: ReleaseTemplateItem[],
  releaseDate: string,
  variant: 'regular' | 'emergency'
) {
  const templateContent = templates.find((item) => item.id === definition.templateId)?.content || '';
  if (!templateContent) return '';
  if (!releaseDate) return templateContent;
  return variant === 'regular'
    ? renderManagedReleaseTemplate(templateContent, releaseDate)
    : renderEmergencyReleaseTemplate(templateContent, releaseDate);
}

function emergencyTaskDate(releaseDate: string, timingToken: EmergencyTimingToken) {
  const option = emergencyTimingOptions.find((item) => item.token === timingToken);
  return addDays(taoNgayTuInput(releaseDate), option?.offset || 0);
}

export function emergencyReleaseTaskPayloads(
  releaseDate: string,
  definitions: EmergencyReleaseTaskDefinition[],
  templates: ReleaseTemplateItem[],
  mentionName?: string
) {
  const immediateDate = taoNgayTuInput(currentVietnamDateInputValue());
  const immediateStartMinutes = clamp(timeToMinutes(roundedImmediateStartTime()), 7 * 60 + 30, 18 * 60);
  const todayImmediateSlots = Math.max(0, Math.floor((18 * 60 - immediateStartMinutes) / 15));
  const immediateSchedules = definitions
    .filter((definition) => definition.startTime === 'immediate')
    .sort((a, b) => (
      (a.immediatePriority || 99) - (b.immediatePriority || 99) ||
      a.title.localeCompare(b.title)
    ))
    .map((definition, index) => {
      const isToday = index < todayImmediateSlots;
      const startMinutes = isToday
        ? immediateStartMinutes + index * 15
        : 7 * 60 + 30 + (index - todayImmediateSlots) * 15;
      return {
        id: definition.id,
        ngayCuThe: localDateInputValue(isToday ? immediateDate : addDays(immediateDate, 1)),
        gioBatDau: minutesToTime(startMinutes)
      };
    });
  let immediateIndex = 0;
  return [...definitions]
    .sort((a, b) => (
      (a.startTime === 'immediate' ? immediateDate.getTime() : emergencyTaskDate(releaseDate, a.timingToken).getTime()) -
      (b.startTime === 'immediate' ? immediateDate.getTime() : emergencyTaskDate(releaseDate, b.timingToken).getTime()) ||
      (a.startTime === 'immediate' ? a.immediatePriority || 99 : 99) - (b.startTime === 'immediate' ? b.immediatePriority || 99 : 99) ||
      timeToMinutes(a.startTime === 'immediate' ? immediateSchedules.find((item) => item.id === a.id)?.gioBatDau : a.startTime, '00:00') -
      timeToMinutes(b.startTime === 'immediate' ? immediateSchedules.find((item) => item.id === b.id)?.gioBatDau : b.startTime, '00:00') ||
      emergencyTimingOptions.findIndex((item) => item.token === a.timingToken) - emergencyTimingOptions.findIndex((item) => item.token === b.timingToken) ||
      a.title.localeCompare(b.title)
    ))
    .map((definition) => {
      const templateContent = templates.find((item) => item.id === definition.templateId)?.content || '';
      // CR-20260819: token {{mention}} trong template (không phải dò dòng "@" theo vị trí — dò theo
      // dòng sẽ hỏng nếu template có nhiều hơn 1 dòng bắt đầu bằng "@", feedback Leader 2026-08-19).
      // `mentionName` là chuỗi NHIỀU người popup đã nối sẵn theo quy tắc "A, B, C".
      const generatedNote = templateContent
        ? renderEmergencyReleaseTemplate(templateContent, releaseDate, mentionName?.trim())
        : '';
      const immediateSchedule = definition.startTime === 'immediate' ? immediateSchedules[immediateIndex++] : null;
      return {
        tenTask: definition.title,
        ghiChu: generatedNote,
        links: normalizedTaskLinks(definition.links || []),
        ngayCuThe: immediateSchedule?.ngayCuThe || localDateInputValue(emergencyTaskDate(releaseDate, definition.timingToken)),
        gioBatDau: immediateSchedule?.gioBatDau || normalizeEmergencyTaskStartTime(definition.startTime),
        originRef: definition.id,
        definitionRevision: definition.revisionHash
      };
    });
}

// BUG-20260821: `afterCreateEndAt` là mốc lưu localStorage lúc tạo xong task "SAU TẠO TASK KHẨN CẤP"
// (giai đoạn 1). Nếu user để qua NGÀY KHÁC mới điền lịch deploy các môi trường (giai đoạn 2), mốc đó đã
// ở QUÁ KHỨ — task "SAU CHỌN NGÀY GIỜ" (announcement...) bị tạo với `ngayCuThe` của hôm tạo giai đoạn 1,
// một ngày đã trôi qua. Task định kỳ/đơn với ngày cụ thể đã qua không khớp `recurringMatchesDate` của bất
// kỳ hôm nào nữa ⇒ task vẫn NẰM TRONG DB (không lỗi, không mất) nhưng không hiện ở đâu trên UI — với
// người dùng coi như "không được tạo". Chốt lại: mốc bắt đầu của "sau chọn ngày giờ" không được sớm hơn
// `now` (lúc bấm tạo giai đoạn 2) — `now` bơm từ ngoài để hàm này vẫn thuần, test được không cần giả lập
// đồng hồ.
export function emergencyFixedReleaseTaskPayloads(
  schedule: EmergencyReleaseScheduleInput,
  definitions: EmergencyReleaseTaskDefinition[],
  templates: ReleaseTemplateItem[],
  afterCreateEndAt: string | undefined,
  now: Date
) {
  const buildTask = (definition: EmergencyReleaseTaskDefinition, start: Date) => {
    const templateContent = templates.find((item) => item.id === definition.templateId)?.content || '';
    const generatedNote = templateContent ? renderEmergencyReleaseScheduleTemplate(templateContent, schedule) : '';
    return {
      tenTask: definition.title,
      ghiChu: generatedNote,
      links: normalizedTaskLinks(definition.links || []),
      ngayCuThe: localDateInputValue(start),
      gioBatDau: minutesToTime(start.getHours() * 60 + start.getMinutes()),
      originRef: definition.id,
      definitionRevision: definition.revisionHash
    };
  };

  const afterScheduleDefinitions = definitions
    .filter((definition) => definition.scheduleMode === 'after_schedule')
    .sort((a, b) => (a.immediatePriority || 99) - (b.immediatePriority || 99) || a.title.localeCompare(b.title));
  const storedAnchor = afterCreateEndAt ? parseDateTimeInput(afterCreateEndAt) : null;
  const afterCreateEnd = storedAnchor && storedAnchor.getTime() > now.getTime() ? storedAnchor : now;
  const afterScheduleTasks = afterScheduleDefinitions.map((definition, index) => buildTask(definition, addMinutes(afterCreateEnd, index * 15)));

  const customTasks = definitions
    .filter((definition) => relativeEmergencyTimingTokens.has(definition.timingToken))
    .filter((definition) => definition.scheduleMode !== 'after_schedule')
    .sort((a, b) => {
      const baseDiff = Object.keys(emergencyScheduleBaseFields).indexOf(a.timingToken) - Object.keys(emergencyScheduleBaseFields).indexOf(b.timingToken);
      if (baseDiff !== 0) return baseDiff;
      return (a.relativeOffsetMinutes || 0) - (b.relativeOffsetMinutes || 0) || a.title.localeCompare(b.title);
    })
    .map((definition) => {
    const baseField = emergencyScheduleBaseFields[definition.timingToken];
    const start = addMinutes(parseDateTimeInput(schedule[baseField]), definition.relativeOffsetMinutes || 0);
    return buildTask(definition, start);
  });

  return [...afterScheduleTasks, ...customTasks];
}






export function ManHinhLenLich({ onTasksCreated }: { onTasksCreated: (date?: string) => Promise<void> }) {
  const { t } = useLang();
  const [releaseType, setReleaseType] = useState<ReleaseType>('khan_cap');

  return (
    <section className="man-hinh-len-lich">
      <div className="len-lich-header">
        <div>
          <h2>{t('release.title')}</h2>
          <p>
            {t('release.description')}
          </p>
        </div>
        <div className="release-type-field">
          <span className="release-type-label">{t('release.type')}</span>
          <div className="release-type-options">
            <button
              type="button"
              className={`release-type-button ${releaseType === 'khan_cap' ? 'release-type-button-active' : ''}`}
              onClick={() => setReleaseType('khan_cap')}
            >
              {t('release.emergency')}
            </button>
            <button
              type="button"
              className={`release-type-button ${releaseType === 'dinh_ky' ? 'release-type-button-active' : ''}`}
              onClick={() => setReleaseType('dinh_ky')}
            >
              {t('release.regular')}
            </button>
          </div>
        </div>
      </div>

      {releaseType === 'dinh_ky' ? <LayoutReleaseDinhKy onTasksCreated={onTasksCreated} /> : <LayoutReleaseKhanCap onTasksCreated={onTasksCreated} />}
    </section>
  );
}

function LayoutReleaseDinhKy({ onTasksCreated }: { onTasksCreated: (date?: string) => Promise<void> }) {
  const { t } = useLang();
  const [releaseDate, setReleaseDate] = useState('');
  const [managedTemplates, setManagedTemplates] = useState<ReleaseTemplateItem[]>([]);
  const [taskDefinitions, setTaskDefinitions] = useState<ReleaseTaskDefinition[]>([]);
  const [taskStatus, setTaskStatus] = useState('');
  const [moQuanLyTemplate, setMoQuanLyTemplate] = useState(false);
  const [moQuanLyTaskRelease, setMoQuanLyTaskRelease] = useState(false);
  const [showRecreateConfirm, setShowRecreateConfirm] = useState(false);
  const [isCreatingTasks, setIsCreatingTasks] = useState(false);
  const [syncPreview, setSyncPreview] = useState<ReleaseSyncPreview | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [releaseSaveStatus, setReleaseSaveStatus] = useState('');
  // FR-5 (CR-20260814): đếm task lệch definition CHỦ ĐỘNG, không cần bấm "Áp dụng thay đổi" mới biết.
  const [driftCount, setDriftCount] = useState<number | null>(null);
  const releaseDateInputRef = useRef<HTMLInputElement>(null);

  async function loadReleaseConfig() {
    const [templates, definitions] = await Promise.all([
      api<ReleaseTemplateItem[]>('/api/release/templates'),
      api<ReleaseTaskDefinition[]>('/api/release/task-definitions')
    ]);
    setManagedTemplates(sortTemplatesByName(templates));
    setTaskDefinitions(definitions);
  }

  async function loadDrift(date: string) {
    if (!date) { setDriftCount(null); return; }
    try {
      const drift = await api<{ lech: unknown[] }>(`/api/schedules/release/drift?releaseMonth=${date.slice(0, 7)}`);
      setDriftCount(drift.lech.length);
    } catch {
      setDriftCount(null);
    }
  }

  useEffect(() => {
    void loadDrift(releaseDate);
  }, [releaseDate, taskDefinitions]);

  useEffect(() => {
    void loadReleaseConfig();
  }, []);

  useEffect(() => {
    if (!releaseSaveStatus) return;
    const timeoutId = window.setTimeout(() => setReleaseSaveStatus(''), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [releaseSaveStatus]);

  async function createReleaseTasks(force = false) {
    if (!releaseDate) return;
    const tasks = taskDefinitions.length > 0
      ? releaseTaskPayloadsFromDefinitions(releaseDate, taskDefinitions, managedTemplates)
      : releaseTaskPayloads(releaseDate);
    setIsCreatingTasks(true);
    try {
      await api('/api/schedules/regular-release/tasks', {
        method: 'POST',
        body: JSON.stringify({ releaseDate, tasks, force })
      });
      await onTasksCreated(currentVietnamDateInputValue());
      setShowRecreateConfirm(false);
      setTaskStatus(`Đã tạo ${tasks.length} task định kỳ cho release ${formatVNDate(taoNgayTuInput(releaseDate))}.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setShowRecreateConfirm(true);
        return;
      }
      // Lỗi KHÁC 409 (vd 400 từ backend) trước đây chỉ `throw e` —
      // onClick không await nên throw thành unhandled rejection, người dùng bấm nút không thấy gì cả.
      // Hiện thông báo thay vì throw — không có nơi nào bắt throw này nên throw chỉ tạo unhandled
      // rejection vô ích (nhánh release khẩn cấp cũng làm vậy, cùng một vấn đề chưa lộ ra vì chưa có test).
      setTaskStatus(e instanceof Error ? e.message : 'Không thể tạo task định kỳ.');
    } finally {
      setIsCreatingTasks(false);
    }
  }

  // Đồng bộ (không phá) thay đổi definition xuống task đã sinh của đợt này. Xem trước rồi mới ghi.
  // CR-20260814 FR-10: BE tự đọc definition + template theo releaseMonth, FE chỉ còn báo đợt nào
  // (AC-13) — không tự dựng nội dung task nữa (đó chính là nguồn 2 luật lệch nhau của BUG-20260814).
  async function openReleaseSyncPreview() {
    if (!releaseDate || taskDefinitions.length === 0) return;
    const releaseMonth = releaseDate.slice(0, 7);
    setIsSyncing(true);
    try {
      const preview = await api<ReleaseSyncPreview>('/api/schedules/release/sync-preview', {
        method: 'POST',
        body: JSON.stringify({ releaseMonth })
      });
      setSyncPreview(preview);
    } finally {
      setIsSyncing(false);
    }
  }

  async function applyReleaseSync() {
    if (!releaseDate || taskDefinitions.length === 0) return;
    const releaseMonth = releaseDate.slice(0, 7);
    setIsSyncing(true);
    try {
      const result = await api<{ updated: number; skipped: number }>('/api/schedules/release/sync', {
        method: 'POST',
        body: JSON.stringify({ releaseMonth })
      });
      await onTasksCreated(currentVietnamDateInputValue());
      setSyncPreview(null);
      setTaskStatus(result.updated > 0 ? `Đã cập nhật ${result.updated} task.` : 'Không có task nào cần cập nhật.');
      await loadDrift(releaseDate);
    } finally {
      setIsSyncing(false);
    }
  }

  async function syncTasksUsingTemplate(savedTemplate: ReleaseTemplateItem) {
    if (!releaseDate) return;
    const affectedDefinitions = taskDefinitions.filter((definition) => definition.templateId === savedTemplate.id);
    if (affectedDefinitions.length === 0) return;

    for (const definition of affectedDefinitions) {
      await api('/api/schedules/regular-release/task', {
        method: 'POST',
        body: JSON.stringify({ releaseDate, definitionId: definition.id })
      });
    }
    const dateMap = releaseTokenDateMap(releaseDate);
    const firstDate = dateMap[affectedDefinitions[0].dateToken as keyof typeof dateMap] || dateMap['release.date'];
    await onTasksCreated(localDateInputValue(firstDate));
  }

  function openReleaseDatePicker() {
    const input = releaseDateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    input?.focus();
    input?.showPicker?.();
  }

  return (
    <>
      <div className="release-layout">
        <div className="release-form-panel">
          <h3>{t('release.reg.title')}</h3>
          <label className="field release-date-field">
            {t('release.reg.date_label')}
            <span className="release-date-picker">
              <input
                ref={releaseDateInputRef}
                type="date"
                value={releaseDate}
                onClick={openReleaseDatePicker}
                onChange={(event) => setReleaseDate(event.target.value)}
              />
              <button type="button" className="release-date-picker-button" onClick={openReleaseDatePicker} title={t('release.reg.pick_date')}>
                <CalendarDays size={18} />
              </button>
            </span>
          </label>
          {releaseDate && (
            <ReleaseDateSummary releaseDate={releaseDate} />
          )}
          <div className="release-primary-actions">
            <button type="button" className="nut-phu release-hover-emerald" disabled={!releaseDate || isCreatingTasks} onClick={() => createReleaseTasks()}>
              {t('release.reg.create')}
            </button>
          </div>
          <div className="release-management-actions">
            <button
              type="button"
              className="nut-phu release-hover-emerald"
              onClick={async () => {
                await loadReleaseConfig();
                setMoQuanLyTemplate(true);
              }}
            >
              {t('release.reg.manage_template')}
            </button>
            <button
              type="button"
              className="nut-phu release-hover-emerald"
              onClick={async () => {
                await loadReleaseConfig();
                setMoQuanLyTaskRelease(true);
              }}
            >
              {t('release.reg.manage_tasks')}
            </button>
            <span className="release-sync-action">
              <button
                type="button"
                className="nut-phu release-hover-emerald"
                disabled={!releaseDate || taskDefinitions.length === 0 || isSyncing}
                title="Áp dụng thay đổi definition (giờ, nội dung AI, template...) vào các task đã tạo của đợt này. Không đụng task đã hoàn thành/hủy."
                onClick={openReleaseSyncPreview}
              >
                Áp dụng thay đổi vào đợt này
              </button>
              {Boolean(driftCount) && (
                <span
                  className="badge ai-badge-pending"
                  title="Số task đang lệch definition gốc — bấm nút bên cạnh để xem chi tiết và đồng bộ"
                >
                  {driftCount} task lệch definition
                </span>
              )}
            </span>
          </div>
          {taskStatus && <p className="release-copy-status">{taskStatus}</p>}
        </div>
        <ReleaseTimelineDecoration />
      </div>
      {showRecreateConfirm && (
        <PopupXacNhanTaoLaiRelease
          onClose={() => setShowRecreateConfirm(false)}
          onConfirm={() => createReleaseTasks(true)}
        />
      )}
      {syncPreview && (
        <PopupXacNhanSyncRelease
          preview={syncPreview}
          busy={isSyncing}
          onClose={() => setSyncPreview(null)}
          onConfirm={applyReleaseSync}
        />
      )}
      {moQuanLyTemplate && (
        <PopupQuanLyReleaseTemplate
          templates={managedTemplates}
          onClose={() => setMoQuanLyTemplate(false)}
          onReload={loadReleaseConfig}
          onTemplateSaved={syncTasksUsingTemplate}
          onSaved={(message) => {
            setReleaseSaveStatus(message);
          }}
        />
      )}
      {moQuanLyTaskRelease && (
        <PopupQuanLyReleaseTask
          tasks={taskDefinitions}
          templates={managedTemplates}
          releaseDate={releaseDate}
          onClose={() => setMoQuanLyTaskRelease(false)}
          onReload={loadReleaseConfig}
          onSaved={(message) => {
            setReleaseSaveStatus(message);
          }}
          onTasksCreated={onTasksCreated}
        />
      )}
      {releaseSaveStatus && (
        <div className="release-save-success" role="status" aria-live="polite">
          <span className="release-save-success-icon">
            <Check size={42} strokeWidth={3} />
          </span>
          <span>{releaseSaveStatus}</span>
        </div>
      )}
    </>
  );
}

function ReleaseTimelineDecoration() {
  return (
    <div className="release-timeline-decoration" aria-hidden="true">
      <div className="release-timeline-copy">
        <span>Release flow</span>
      </div>
      <div className="release-timeline-track">
        <span className="release-timeline-progress" />
        <span className="release-rocket-runner">
          <Rocket size={30} />
        </span>
        <span className="release-timeline-label release-timeline-label-start">Staging</span>
        <span className="release-timeline-label release-timeline-label-mid">Release</span>
        <span className="release-timeline-label release-timeline-label-end">Demo</span>
      </div>
    </div>
  );
}

function EmergencyReleaseMemeDecoration() {
  return (
    <div className="emergency-shape-playground" aria-hidden="true">
      <span className="emergency-shape emergency-shape-circle" />
      <span className="emergency-shape emergency-shape-square" />
      <span className="emergency-shape emergency-shape-diamond" />
      <span className="emergency-shape emergency-shape-pill" />
      <span className="emergency-impact emergency-impact-one" />
      <span className="emergency-impact emergency-impact-two" />
    </div>
  );
}

function ReleaseDateSummary({ releaseDate }: { releaseDate: string }) {
  const { t } = useLang();
  const dates = tinhNgayRelease(releaseDate);
  return (
    <div className="release-date-summary">
      <p><strong>{t('release.reg.staging')}:</strong> {formatVNWeekdayDate(dates.stagingMonday)}</p>
      <p><strong>{t('release.reg.release')}:</strong> {formatVNWeekdayDate(dates.release)}</p>
      <p><strong>{t('release.reg.demo')}:</strong> {formatVNWeekdayDate(dates.demoMonday)}</p>
    </div>
  );
}

function TokenGuideTable({
  tokens = releaseTemplateTokens,
  showLabels = true,
  copyable = false,
  groupByWeek = false,
  groupByPrefix = false
}: {
  tokens?: { token: string; label: string }[];
  showLabels?: boolean;
  copyable?: boolean;
  groupByWeek?: boolean;
  groupByPrefix?: boolean;
}) {
  const [copiedToken, setCopiedToken] = useState('');

  async function copyToken(token: string) {
    const text = `{{${token}}}`;
    await navigator.clipboard.writeText(text);
    setCopiedToken(token);
    window.setTimeout(() => setCopiedToken(''), 1400);
  }

  const renderToken = (item: { token: string; label: string }) => (
    <div key={item.token} className="release-token-guide-item">
      {copyable ? (
        <button
          type="button"
          className="release-token-copy"
          onClick={() => copyToken(item.token)}
          title={`Copy {{${item.token}}}`}
          aria-label={`Copy {{${item.token}}}`}
        >
          <code>{`{{${item.token}}}`}</code>
          {copiedToken === item.token ? <Check size={14} /> : <Copy size={14} />}
        </button>
      ) : (
        <code>{`{{${item.token}}}`}</code>
      )}
      {showLabels && <span>{item.label}</span>}
    </div>
  );

  if (groupByWeek) {
    const groupedTokens = tokens.reduce<Record<string, { token: string; label: string }[]>>((groups, item) => {
      const weekKey = releaseTokenWeekKey(item.token);
      groups[weekKey] = [...(groups[weekKey] || []), item];
      return groups;
    }, {});

    return (
      <div className="release-token-guide release-token-guide-vertical">
        {Object.entries(groupedTokens).map(([weekKey, items]) => (
          <div key={weekKey} className="release-token-guide-group">
            <div className="release-token-guide-title">{releaseWeekLabels[weekKey] || weekKey}</div>
            <div className="release-token-guide-row">
              {items.map(renderToken)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (groupByPrefix) {
    const groupedTokens = tokens.reduce<Record<string, { token: string; label: string }[]>>((groups, item) => {
      const prefix = item.token.split('.')[0] || 'other';
      groups[prefix] = [...(groups[prefix] || []), item];
      return groups;
    }, {});

    return (
      <div className="release-token-guide release-token-guide-vertical">
        {Object.entries(groupedTokens).map(([prefix, items]) => (
          <div key={prefix} className="release-token-guide-group">
            <div className="release-token-guide-title">{prefix}</div>
            <div className="release-token-guide-row">
              {items.map(renderToken)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="release-token-guide">
      {tokens.map(renderToken)}
    </div>
  );
}

function PopupQuanLyReleaseTemplate({
  title = 'Quản lý template',
  apiBasePath = '/api/release/templates',
  variant = 'regular',
  showTokenGuide = true,
  templates,
  onClose,
  onReload,
  onTemplateSaved,
  onSaved
}: {
  title?: string;
  apiBasePath?: string;
  variant?: 'regular' | 'emergency';
  showTokenGuide?: boolean;
  templates: ReleaseTemplateItem[];
  onClose: () => void;
  onReload: () => Promise<void>;
  onTemplateSaved?: (template: ReleaseTemplateItem) => Promise<void>;
  onSaved: (message: string) => void;
}) {
  const { t } = useLang();
  const [selectedId, setSelectedId] = useState(templates[0]?.id || '');
  const selected = templates.find((item) => item.id === selectedId);
  const [name, setName] = useState(selected?.name || templates[0]?.name || '');
  const [content, setContent] = useState(selected?.content || templates[0]?.content || '');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [templateDangXoa, setTemplateDangXoa] = useState<ReleaseTemplateItem | null>(null);
  const tokenGuideItems = variant === 'emergency' ? emergencyReleaseTemplateTokens : releaseTemplateTokens;
  const validTemplateTokens = variant === 'emergency' ? validEmergencyReleaseTemplateTokens : validReleaseTemplateTokens;

  useEffect(() => {
    if (!selected) return;
    setName(selected?.name || '');
    setContent(selected?.content || '');
    setError('');
  }, [selected?.id]);

  async function save() {
    const invalidTokens = invalidTemplateTokens(content, validTemplateTokens);
    if (!name.trim()) {
      setError(t('tmpl.name_required'));
      return;
    }
    if (invalidTokens.length > 0) {
      setError(t('tmpl.invalid_tokens_pre') + invalidTokens.join(', '));
      return;
    }
    setIsSaving(true);
    try {
      let savedTemplateId = selected?.id || '';
      if (selected?.id) {
        await api(`${apiBasePath}/${selected.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, content })
        });
      } else {
        const created = await api<{ id: string }>(apiBasePath, {
          method: 'POST',
          body: JSON.stringify({ name, content })
        });
        savedTemplateId = created.id;
      }
      await onReload();
      setSelectedId(savedTemplateId);
      if (savedTemplateId) {
        await onTemplateSaved?.({ id: savedTemplateId, name: name.trim(), content });
      }
      setError('');
      onSaved(`Đã lưu template "${name.trim()}".`);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('tmpl.save_err'));
    } finally {
      setIsSaving(false);
    }
  }

  function createNew() {
    setSelectedId('');
    setName('');
    setContent('');
    setError('');
  }

  async function remove() {
    if (!templateDangXoa?.id) return;
    await api(`${apiBasePath}/${templateDangXoa.id}`, { method: 'DELETE' });
    await onReload();
    setSelectedId('');
    setTemplateDangXoa(null);
  }

  return (
    <Modal onClose={onClose} scroll>
      <div className={`popup popup-release-manager popup-release-template-manager ${variant === 'emergency' ? 'popup-release-emergency-manager' : ''} w-full max-w-6xl`}>
        <div className="release-manager-header">
          <h2 className="text-xl font-bold">{variant === 'emergency' ? t('release.emg.manage_template') : t('tmpl.title')}</h2>
          <button type="button" className="nut-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="release-manager-layout">
          <aside className="release-manager-list">
            <button type="button" className="nut-chinh" disabled={isSaving} onClick={createNew}>{t('tmpl.add_new')}</button>
            {templates.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === selected?.id ? 'release-manager-item-active' : 'release-manager-item'}
                onClick={() => !isSaving && setSelectedId(item.id)}
              >
                {item.name}
              </button>
            ))}
          </aside>
          <div className="release-manager-detail">
            <label className="field">
              {t('tmpl.name_label')}
              <input value={name} disabled={isSaving} placeholder={t('tmpl.name_placeholder')} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              {t('tmpl.content_label')}
              <textarea value={content} disabled={isSaving} placeholder={t('tmpl.content_placeholder')} onChange={(event) => setContent(event.target.value)} rows={13} />
            </label>
            {showTokenGuide && (
              <TokenGuideTable
                tokens={tokenGuideItems}
                showLabels={false}
                copyable
                groupByWeek={variant === 'regular'}
                groupByPrefix={variant === 'emergency'}
              />
            )}
            {error && <p className="release-error">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className="nut-nguy-hiem-text" disabled={!selected?.id || isSaving} onClick={() => selected && setTemplateDangXoa(selected)}>{t('delete.btn')}</button>
              <button type="button" className="nut-phu" disabled={isSaving} onClick={onClose}>{t('btn.cancel')}</button>
              <button type="button" className="nut-chinh" disabled={isSaving} onClick={save}>{isSaving ? t('btn.saving') : t('btn.save')}</button>
            </div>
          </div>
        </div>
      </div>
      {templateDangXoa && (
        <PopupXacNhanXoaReleaseConfig
          title={t('tmpl.delete_title')}
          message={t('confirm.delete_msg_pre') + `"${templateDangXoa.name}"` + t('confirm.delete_msg_post')}
          onClose={() => setTemplateDangXoa(null)}
          onConfirm={remove}
        />
      )}
    </Modal>
  );
}

function PopupQuanLyReleaseTask({
  tasks,
  templates,
  releaseDate,
  onClose,
  onReload,
  onSaved,
  onTasksCreated
}: {
  tasks: ReleaseTaskDefinition[];
  templates: ReleaseTemplateItem[];
  releaseDate: string;
  onClose: () => void;
  onReload: () => Promise<void>;
  onSaved: (message: string) => void;
  onTasksCreated: (date?: string) => Promise<void>;
}) {
  const { t } = useLang();
  const [selectedId, setSelectedId] = useState(tasks[0]?.id || '');
  const selected = tasks.find((item) => item.id === selectedId);
  const [draft, setDraft] = useState<ReleaseTaskDefinition>(selected || {
    id: '',
    title: '',
    note: '',
    startTime: '09:00',
    dateToken: 'release.date',
    templateId: '',
    links: [],
    sortOrder: tasks.length
  });
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [taskDangXoa, setTaskDangXoa] = useState<ReleaseTaskDefinition | null>(null);
  const [dangThemMoi, setDangThemMoi] = useState(false);
  const dangHienThiForm = selectedId !== '' || dangThemMoi;
  const templatePreview = dangHienThiForm ? releaseTaskTemplatePreview(draft, templates, releaseDate, 'regular') : '';
  const sortedTasks = [...tasks].sort(compareReleaseTaskDefinitions);
  const groupedTasks = sortedTasks.reduce<Record<string, ReleaseTaskDefinition[]>>((groups, task) => {
    const weekKey = releaseTokenWeekKey(task.dateToken);
    groups[weekKey] = [...(groups[weekKey] || []), task];
    return groups;
  }, {});

  useEffect(() => {
    if (selected) {
      setDraft(selected);
      setDangThemMoi(false);
    }
    setError('');
  }, [selected?.id]);

  async function save() {
    if (!draft.title.trim()) {
      setError(t('rtask.title_required'));
      return;
    }
    setIsSaving(true);
    try {
      const body = JSON.stringify({ ...draft, links: normalizedTaskLinks(draft.links || []) });
      let savedDraft = draft;
      if (draft.id) {
        await api(`/api/release/task-definitions/${draft.id}`, { method: 'PATCH', body });
      } else {
        const result = await api<{ id: string }>('/api/release/task-definitions', { method: 'POST', body });
        savedDraft = { ...draft, id: result.id };
      }
      await onReload();
      if (releaseDate) {
        // CR-20260814 FR-1/FR-10: BE tự đọc definition vừa lưu theo id + tự match (release_month,
        // origin_ref) — không còn gửi `task`/`previousTitle` để BE match theo tên (BUG-20260814).
        await api('/api/schedules/regular-release/task', {
          method: 'POST',
          body: JSON.stringify({ releaseDate, definitionId: savedDraft.id })
        });
        const dateMap = releaseTokenDateMap(releaseDate);
        const targetDate = dateMap[savedDraft.dateToken as keyof typeof dateMap] || dateMap['release.date'];
        await onTasksCreated(localDateInputValue(targetDate));
        onSaved(`Đã lưu và tạo task "${savedDraft.title}" cho release ${formatVNDate(taoNgayTuInput(releaseDate))}.`);
      } else {
        onSaved('Đã lưu thay đổi task release.');
      }
      setSelectedId('');
      setDangThemMoi(false);
      setDraft({
        id: '',
        title: '',
        note: '',
        startTime: '09:00',
        dateToken: 'release.date',
        templateId: '',
        links: [],
        sortOrder: tasks.length
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : t('rtask.save_err'));
    } finally {
      setIsSaving(false);
    }
  }

  function createNew() {
    setSelectedId('');
    setDangThemMoi(true);
    setDraft({
      id: '',
      title: '',
      note: '',
      startTime: '09:00',
      dateToken: 'release.date',
      templateId: '',
      links: [],
      sortOrder: tasks.length
    });
  }

  async function remove() {
    if (!taskDangXoa?.id) return;
    await api(`/api/release/task-definitions/${taskDangXoa.id}`, { method: 'DELETE' });
    await onReload();
    setSelectedId('');
    setDangThemMoi(false);
    setDraft({
      id: '',
      title: '',
      note: '',
      startTime: '09:00',
      dateToken: 'release.date',
      templateId: '',
      links: [],
      sortOrder: tasks.length
    });
    setTaskDangXoa(null);
  }

  return (
    <Modal onClose={onClose} scroll>
      <div className="popup popup-release-manager popup-release-task-manager w-full max-w-[96vw]">
        <div className="release-manager-header">
          <h2 className="text-xl font-bold">{t('rtask.title')}</h2>
          <button type="button" className="nut-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="release-manager-layout release-task-manager-layout">
          <aside className="release-manager-list">
            <button type="button" className="nut-chinh" onClick={createNew}>{t('tmpl.add_new')}</button>
            {Object.entries(groupedTasks).map(([weekKey, weekTasks]) => (
              <div key={weekKey} className={`release-task-week-group release-week-${weekKey}`}>
                <div className="release-task-week-title">{releaseWeekLabels[weekKey] || weekKey}</div>
                {weekTasks.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${item.id === draft.id ? 'release-manager-item-active' : 'release-manager-item'} release-task-item`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="release-task-item-title">
                      <span className="release-task-week-badge">{releaseWeekShortLabels[weekKey] || weekKey}</span>
                      <span>{item.title}</span>
                      {item.templateId && (
                        <span
                          className="release-task-template-icon"
                          title={t('rtask.emg.template_attached_pre') + (templates.find((template) => template.id === item.templateId)?.name || item.templateId)}
                          aria-label={t('rtask.template_attached_label')}
                        >
                          <Paperclip size={10} />
                        </span>
                      )}
                    </span>
                    <small>{releaseDateTokens.find((token) => token.token === item.dateToken)?.label} - {item.startTime}</small>
                  </button>
                ))}
              </div>
            ))}
          </aside>
          <div className="release-manager-detail">
            {!dangHienThiForm ? (
              <div className="release-manager-empty">{t('rtask.empty')}</div>
            ) : (
            <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                {t('rtask.form.title')}
                <input value={draft.title} placeholder={t('rtask.form.title_placeholder')} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <label className="field">
                {t('rtask.form.start_time')}
                <TimeInput min="07:30" max="18:00" value={draft.startTime} onChange={(v) => setDraft({ ...draft, startTime: v })} />
              </label>
              <label className="field">
                {t('rtask.form.timing')}
                <select value={draft.dateToken} onChange={(event) => setDraft({ ...draft, dateToken: event.target.value })}>
                  {releaseDateTokens.map((item) => (
                    <option key={item.token} value={item.token}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t('rtask.form.template')}
                <select value={draft.templateId} onChange={(event) => setDraft({ ...draft, templateId: event.target.value })}>
                  <option value="">{t('rtask.form.no_template')}</option>
                  {templates.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="release-note-preview-grid">
              <label className="field">
                {t('task.form.note')}
                <textarea value={draft.note} placeholder={t('rtask.form.note_placeholder')} onChange={(event) => setDraft({ ...draft, note: event.target.value })} rows={7} />
              </label>
              <div className="field">
                {t('rtask.form.preview')}
                <pre className="release-template-preview">{templatePreview || t('rtask.form.no_preview')}</pre>
              </div>
            </div>
            <div className="field">
              {t('task.form.links')}
              <TaskLinkEditor links={draft.links || []} onChange={(links) => setDraft({ ...draft, links })} />
            </div>
            <label className="field">
              {t('rtask.form.reply_to')}
              <select
                value={draft.replyToDefinitionId || ''}
                onChange={(event) => setDraft({ ...draft, replyToDefinitionId: event.target.value || null })}
              >
                <option value="">{t('rtask.form.reply_to_none')}</option>
                {tasks.filter((x) => x.id !== draft.id).map((x) => (
                  <option key={x.id} value={x.id}>{x.title}</option>
                ))}
              </select>
            </label>
            {error && <p className="release-error">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className="nut-nguy-hiem-text" disabled={!draft.id || isSaving} onClick={() => draft.id && setTaskDangXoa(draft)}>{t('delete.btn')}</button>
              <button type="button" className="nut-phu" disabled={isSaving} onClick={onClose}>{t('btn.cancel')}</button>
              <button type="button" className="nut-chinh" disabled={isSaving} onClick={save}>{isSaving ? t('btn.saving') : t('btn.save')}</button>
            </div>
            </>
            )}
          </div>
        </div>
      </div>
      {taskDangXoa && (
        <PopupXacNhanXoaReleaseConfig
          title={t('rtask.delete_title')}
          message={t('confirm.delete_msg_pre') + `"${taskDangXoa.title}"` + t('confirm.delete_msg_post')}
          onClose={() => setTaskDangXoa(null)}
          onConfirm={remove}
        />
      )}
    </Modal>
  );
}

function PopupQuanLyEmergencyReleaseTask({
  tasks,
  templates,
  releaseDate,
  onClose,
  onReload,
  onSaved
}: {
  tasks: EmergencyReleaseTaskDefinition[];
  templates: ReleaseTemplateItem[];
  releaseDate: string;
  onClose: () => void;
  onReload: () => Promise<void>;
  onSaved: (message: string) => void;
}) {
  const { t } = useLang();
  const [selectedId, setSelectedId] = useState(tasks[0]?.id || '');
  const selected = tasks.find((item) => item.id === selectedId);
  const [draft, setDraft] = useState<EmergencyReleaseTaskDefinition>(selected || {
    id: '',
    title: '',
    note: '',
    timingToken: 'hotfix',
    startTime: '09:00',
    immediatePriority: null,
    relativeOffsetMinutes: null,
    scheduleMode: null,
    templateId: '',
    links: [],
    sortOrder: tasks.length
  });
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [taskDangXoa, setTaskDangXoa] = useState<EmergencyReleaseTaskDefinition | null>(null);
  const [dangThemMoi, setDangThemMoi] = useState(false);
  const dangHienThiForm = selectedId !== '' || dangThemMoi;
  const templatePreview = dangHienThiForm ? releaseTaskTemplatePreview(draft, templates, releaseDate, 'emergency') : '';
  const usedImmediatePriorities = new Set(
    tasks
      .filter((item) => item.startTime === 'immediate' && item.id !== draft.id && item.immediatePriority)
      .map((item) => item.immediatePriority)
  );
  const emergencyStageOrder = ['immediate', 'after_schedule', 'staging_deploy', 'release_deploy', 'demo_deploy'];
  const emergencyTaskStageKey = (task: EmergencyReleaseTaskDefinition) => {
    if (!relativeEmergencyTimingTokens.has(task.timingToken)) return 'immediate';
    if (task.scheduleMode === 'after_schedule') return 'after_schedule';
    return task.timingToken;
  };
  const usedAfterSchedulePriorities = new Set(
    tasks
      .filter((item) => emergencyTaskStageKey(item) === 'after_schedule' && item.id !== draft.id && item.immediatePriority)
      .map((item) => item.immediatePriority)
  );
  const nextImmediatePriority = Array.from({ length: 15 }, (_, index) => index + 1).find((priority) => !usedImmediatePriorities.has(priority)) || 1;
  const nextAfterSchedulePriority = Array.from({ length: 15 }, (_, index) => index + 1).find((priority) => !usedAfterSchedulePriorities.has(priority)) || 1;
  const draftOffset = splitRelativeOffset(draft.relativeOffsetMinutes);
  const draftTimingMode = !relativeEmergencyTimingTokens.has(draft.timingToken)
    ? 'after_create'
    : draft.scheduleMode === 'after_schedule'
      ? 'after_schedule'
      : 'custom';
  // Chỉ đẩy Template xuống khối preview khi mode 'custom' (row trên đã đủ 2 field: mốc + offset).
  // 'after_schedule' chỉ có 1 field Priority -> để Template NGANG HÀNG Priority ở row trên cho gọn.
  const showTemplateAbovePreview = draftTimingMode === 'custom';
  const sortedTasks = [...tasks].sort((a, b) => (
    emergencyStageOrder.indexOf(emergencyTaskStageKey(a)) - emergencyStageOrder.indexOf(emergencyTaskStageKey(b)) ||
    (emergencyTaskStageKey(a) === 'after_schedule' ? a.immediatePriority || 99 : 99) -
      (emergencyTaskStageKey(b) === 'after_schedule' ? b.immediatePriority || 99 : 99) ||
    (relativeEmergencyTimingTokens.has(a.timingToken) ? a.relativeOffsetMinutes || 0 : a.immediatePriority || 99) -
      (relativeEmergencyTimingTokens.has(b.timingToken) ? b.relativeOffsetMinutes || 0 : b.immediatePriority || 99) ||
    a.title.localeCompare(b.title)
  ));
  const groupedTasks = sortedTasks.reduce<Record<string, EmergencyReleaseTaskDefinition[]>>((groups, task) => {
    const stageKey = emergencyTaskStageKey(task);
    groups[stageKey] = [...(groups[stageKey] || []), task];
    return groups;
  }, {});

  useEffect(() => {
    if (selected) {
      setDraft(selected);
      setDangThemMoi(false);
    }
    setError('');
  }, [selected?.id]);

  function createNew() {
    setSelectedId('');
    setDangThemMoi(true);
    setDraft({
      id: '',
      title: '',
      note: '',
      timingToken: 'hotfix',
      startTime: 'immediate',
      immediatePriority: nextImmediatePriority,
      relativeOffsetMinutes: null,
      scheduleMode: null,
      templateId: '',
      links: [],
      sortOrder: tasks.length
    });
  }

  async function save() {
    if (!draft.title.trim()) {
      setError(t('rtask.title_required'));
      return;
    }
    setIsSaving(true);
    try {
      const isAfterCreate = draftTimingMode === 'after_create';
      const isCustom = draftTimingMode === 'custom';
      const body = JSON.stringify({
        ...draft,
        timingToken: isAfterCreate ? 'hotfix' : isCustom ? draft.timingToken : 'release_deploy',
        startTime: isAfterCreate ? 'immediate' : 'relative',
        immediatePriority: isAfterCreate || draftTimingMode === 'after_schedule' ? draft.immediatePriority || 1 : null,
        relativeOffsetMinutes: isAfterCreate ? null : isCustom ? draft.relativeOffsetMinutes || 0 : 0,
        scheduleMode: isAfterCreate ? null : draftTimingMode === 'after_schedule' ? 'after_schedule' : 'custom',
        links: normalizedTaskLinks(draft.links || [])
      });
      if (draft.id) {
        await api(`/api/release/emergency/task-definitions/${draft.id}`, { method: 'PATCH', body });
      } else {
        await api<{ id: string }>('/api/release/emergency/task-definitions', { method: 'POST', body });
      }
      await onReload();
      onSaved(`Đã lưu task khẩn cấp "${draft.title.trim()}".`);
      setSelectedId('');
      setDangThemMoi(false);
      setDraft({
        id: '',
        title: '',
        note: '',
        timingToken: 'hotfix',
        startTime: 'immediate',
        immediatePriority: 1,
        relativeOffsetMinutes: null,
        scheduleMode: null,
        templateId: '',
        links: [],
        sortOrder: tasks.length
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : t('rtask.emg.save_err'));
    } finally {
      setIsSaving(false);
    }
  }

  async function remove() {
    if (!taskDangXoa?.id) return;
    await api(`/api/release/emergency/task-definitions/${taskDangXoa.id}`, { method: 'DELETE' });
    await onReload();
    setSelectedId('');
    setDangThemMoi(false);
    setDraft({
      id: '',
      title: '',
      note: '',
      timingToken: 'hotfix',
      startTime: 'immediate',
      immediatePriority: 1,
      relativeOffsetMinutes: null,
      scheduleMode: null,
      templateId: '',
      links: [],
      sortOrder: tasks.length
    });
    setTaskDangXoa(null);
  }

  return (
    <Modal onClose={onClose} scroll>
      <div className="popup popup-release-manager popup-release-task-manager popup-release-emergency-manager popup-release-emergency-task-manager w-full max-w-[96vw]">
        <div className="release-manager-header">
          <h2 className="text-xl font-bold">{t('rtask.emg.title')}</h2>
          <button type="button" className="nut-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="release-manager-layout release-task-manager-layout">
          <aside className="release-manager-list">
            <button type="button" className="nut-chinh" disabled={isSaving} onClick={createNew}>{t('tmpl.add_new')}</button>
            {emergencyStageOrder.map((stageKey) => {
              const stageTasks = groupedTasks[stageKey] || [];
              if (stageTasks.length === 0) return null;
              return (
                <div key={stageKey} className="release-task-week-group release-emergency-stage-group">
                  <div className="release-task-week-title">{t(`rtask.emg.stage.${stageKey}` as Parameters<typeof t>[0])}</div>
                  {stageTasks.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`${item.id === draft.id ? 'release-manager-item-active' : 'release-manager-item'} release-task-item release-emergency-task-item`}
                      onClick={() => !isSaving && setSelectedId(item.id)}
                    >
                      <span className="release-task-item-title">
                        <span>{item.title}</span>
                        {item.startTime === 'immediate' && item.immediatePriority && (
                          <span className="release-task-priority-badge">P{item.immediatePriority}</span>
                        )}
                        {emergencyTaskStageKey(item) === 'after_schedule' && item.immediatePriority && (
                          <span className="release-task-priority-badge">P{item.immediatePriority}</span>
                        )}
                        {item.templateId && templates.some((template) => template.id === item.templateId) && (
                          <span
                            className="release-task-template-icon"
                            title={t('rtask.emg.template_attached_pre') + (templates.find((template) => template.id === item.templateId)?.name || item.templateId)}
                            aria-label={t('rtask.template_attached_label')}
                          >
                            <Paperclip size={10} />
                          </span>
                        )}
                      </span>
                      <small>
                        {emergencyTaskStageKey(item) === 'after_schedule'
                          ? t('rtask.emg.timing_after_schedule')
                          : relativeEmergencyTimingTokens.has(item.timingToken)
                            ? t('rtask.emg.custom_timing_pre') + t(`rtask.emg.stage.${item.timingToken}` as Parameters<typeof t>[0]) + ' ' + formatRelativeOffset(item.relativeOffsetMinutes)
                            : t('rtask.emg.timing_after_create')}
                      </small>
                    </button>
                  ))}
                </div>
              );
            })}
          </aside>
          <div className="release-manager-detail">
            {!dangHienThiForm ? (
              <div className="release-manager-empty">{t('rtask.emg.empty')}</div>
            ) : (
            <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                {t('rtask.form.title')}
                <input value={draft.title} disabled={isSaving} placeholder={t('rtask.form.title_placeholder')} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <label className="field">
                {t('rtask.emg.timing')}
                <select
                  value={draftTimingMode}
                  disabled={isSaving}
                  onChange={(event) => {
                    const value = event.target.value as 'after_schedule' | 'after_create' | 'custom';
                    setDraft({
                      ...draft,
                      timingToken: value === 'after_create'
                        ? 'hotfix'
                        : value === 'after_schedule'
                          ? 'release_deploy'
                          : relativeEmergencyTimingTokens.has(draft.timingToken) ? draft.timingToken : 'staging_deploy',
                      startTime: value === 'after_create' ? 'immediate' : 'relative',
                      immediatePriority: value === 'after_create'
                        ? draft.immediatePriority || nextImmediatePriority
                        : value === 'after_schedule'
                          ? draft.immediatePriority || nextAfterSchedulePriority
                          : null,
                      relativeOffsetMinutes: value === 'after_create' ? null : value === 'after_schedule' ? 0 : draft.relativeOffsetMinutes || 0,
                      scheduleMode: value === 'after_create' ? null : value === 'after_schedule' ? 'after_schedule' : 'custom'
                    });
                  }}
                >
                  <option value="after_schedule">{t('rtask.emg.timing_after_schedule')}</option>
                  <option value="after_create">{t('rtask.emg.timing_after_create')}</option>
                  <option value="custom">{t('rtask.emg.timing_custom')}</option>
                </select>
              </label>
            </div>
            <div className="release-offset-template-row">
              {draftTimingMode === 'after_create' || draftTimingMode === 'after_schedule' ? (
                <label className="field">
                  Priority
                  <select
                    value={draft.immediatePriority || (draftTimingMode === 'after_create' ? nextImmediatePriority : nextAfterSchedulePriority)}
                    disabled={isSaving}
                    onChange={(event) => setDraft({
                      ...draft,
                      startTime: draftTimingMode === 'after_create' ? 'immediate' : 'relative',
                      timingToken: draftTimingMode === 'after_create' ? 'hotfix' : 'release_deploy',
                      relativeOffsetMinutes: draftTimingMode === 'after_create' ? null : 0,
                      immediatePriority: Number(event.target.value)
                    })}
                  >
                    {Array.from({ length: 15 }, (_, index) => index + 1).map((priority) => (
                      <option
                        key={priority}
                        value={priority}
                        disabled={(draftTimingMode === 'after_create' ? usedImmediatePriorities : usedAfterSchedulePriorities).has(priority)}
                      >
                        {priority}
                      </option>
                    ))}
                  </select>
                </label>
              ) : draftTimingMode === 'custom' ? (
                <>
                  <label className="field">
                    {t('rtask.emg.relative_to')}
                    <select
                      value={draft.timingToken}
                      disabled={isSaving}
                      onChange={(event) => setDraft({
                        ...draft,
                        timingToken: event.target.value as EmergencyTimingToken,
                        startTime: 'relative',
                        immediatePriority: null,
                        scheduleMode: 'custom',
                        relativeOffsetMinutes: draft.relativeOffsetMinutes || 0
                      })}
                    >
                      <option value="staging_deploy">{t('rtask.emg.from_staging_deploy')}</option>
                      <option value="release_deploy">{t('rtask.emg.from_release_deploy')}</option>
                      <option value="demo_deploy">{t('rtask.emg.from_demo_deploy')}</option>
                    </select>
                  </label>
                  <div className="field release-offset-field">
                    {t('rtask.emg.offset')}
                    <div className="release-offset-controls">
                      <select
                        value={draftOffset.sign}
                        disabled={isSaving}
                        aria-label={t('rtask.emg.offset_sign_label')}
                        onChange={(event) => setDraft({
                          ...draft,
                          startTime: 'relative',
                          immediatePriority: null,
                          scheduleMode: 'custom',
                          relativeOffsetMinutes: mergeRelativeOffset(event.target.value, draftOffset.hours, draftOffset.minutes)
                        })}
                      >
                        <option value="+">{t('rtask.emg.after')}</option>
                        <option value="-">{t('rtask.emg.before')}</option>
                      </select>
                      <select
                        value={draftOffset.hours}
                        disabled={isSaving}
                        aria-label={t('rtask.emg.offset_hours_label')}
                        onChange={(event) => setDraft({
                          ...draft,
                          startTime: 'relative',
                          immediatePriority: null,
                          scheduleMode: 'custom',
                          relativeOffsetMinutes: mergeRelativeOffset(draftOffset.sign, Number(event.target.value), draftOffset.minutes)
                        })}
                      >
                        {relativeOffsetHourOptions.map((hour) => (
                          <option key={hour} value={hour}>{hour}{t('rtask.emg.hours_suffix')}</option>
                        ))}
                      </select>
                      <select
                        value={relativeOffsetMinuteOptions.includes(draftOffset.minutes) ? draftOffset.minutes : 0}
                        disabled={isSaving}
                        aria-label={t('rtask.emg.offset_minutes_label')}
                        onChange={(event) => setDraft({
                          ...draft,
                          startTime: 'relative',
                          immediatePriority: null,
                          scheduleMode: 'custom',
                          relativeOffsetMinutes: mergeRelativeOffset(draftOffset.sign, draftOffset.hours, Number(event.target.value))
                        })}
                      >
                        {relativeOffsetMinuteOptions.map((minute) => (
                          <option key={minute} value={minute}>{minute}{t('rtask.emg.minutes_suffix')}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              ) : null}
              {!showTemplateAbovePreview && (
              <label className="field">
                {t('rtask.form.template')}
                <select value={draft.templateId} disabled={isSaving} onChange={(event) => setDraft({ ...draft, templateId: event.target.value })}>
                  <option value="">{t('rtask.form.no_template')}</option>
                  {templates.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              )}
            </div>
            <div className={`release-note-preview-grid ${showTemplateAbovePreview ? 'release-note-preview-grid-with-template' : ''}`}>
              {showTemplateAbovePreview && <div className="release-template-spacer" aria-hidden="true" />}
              {showTemplateAbovePreview && (
              <label className="field release-template-above-preview">
                {t('rtask.form.template')}
                <select value={draft.templateId} disabled={isSaving} onChange={(event) => setDraft({ ...draft, templateId: event.target.value })}>
                  <option value="">{t('rtask.form.no_template')}</option>
                  {templates.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              )}
              <label className="field">
                {t('task.form.note')}
                <textarea value={draft.note} disabled={isSaving} placeholder={t('rtask.form.note_placeholder')} onChange={(event) => setDraft({ ...draft, note: event.target.value })} rows={7} />
              </label>
              <div className="field">
                {t('rtask.form.preview')}
                <pre className="release-template-preview">{templatePreview || t('rtask.form.no_preview')}</pre>
              </div>
            </div>
            <div className="field">
              {t('task.form.links')}
              <TaskLinkEditor links={draft.links || []} onChange={(links) => setDraft({ ...draft, links })} />
            </div>
            <label className="field">
              {t('rtask.form.reply_to')}
              <select
                value={draft.replyToDefinitionId || ''}
                onChange={(event) => setDraft({ ...draft, replyToDefinitionId: event.target.value || null })}
              >
                <option value="">{t('rtask.form.reply_to_none')}</option>
                {tasks.filter((x) => x.id !== draft.id).map((x) => (
                  <option key={x.id} value={x.id}>{x.title}</option>
                ))}
              </select>
            </label>
            {error && <p className="release-error">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className="nut-nguy-hiem-text" disabled={!draft.id || isSaving} onClick={() => draft.id && setTaskDangXoa(draft)}>{t('delete.btn')}</button>
              <button type="button" className="nut-phu" disabled={isSaving} onClick={onClose}>{t('btn.cancel')}</button>
              <button type="button" className="nut-chinh" disabled={isSaving} onClick={save}>{isSaving ? t('btn.saving') : t('btn.save')}</button>
            </div>
            </>
            )}
          </div>
        </div>
      </div>
      {taskDangXoa && (
        <PopupXacNhanXoaReleaseConfig
          title={t('rtask.emg.delete_title')}
          message={t('confirm.delete_msg_pre') + `"${taskDangXoa.title}"` + t('confirm.delete_msg_post')}
          onClose={() => setTaskDangXoa(null)}
          onConfirm={remove}
        />
      )}
    </Modal>
  );
}

function PopupXacNhanXoaReleaseConfig({
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onConfirm();
  }

  return (
    <Modal onClose={onClose} nested>
      <form className="popup w-full max-w-md" onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" className="nut-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="mb-5 text-sm leading-6 text-phu">{message}</p>
        <div className="flex justify-end gap-3">
          <button type="button" className="nut-phu" onClick={onClose}>{t('task.confirm.no')}</button>
          <button className="nut-nguy-hiem-text" type="submit" autoFocus>
            {t('task.confirm.yes')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PopupXacNhanTaoLaiRelease({
  onClose,
  onConfirm
}: {
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLang();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onConfirm();
  }

  return (
    <Modal onClose={onClose}>
      <form className="popup w-full max-w-md" onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{t('confirm.recreate_title')}</h2>
          <button type="button" className="nut-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="mb-5 text-sm leading-6 text-phu">
          {t('confirm.recreate_question')}
        </p>
        <div className="flex justify-end gap-3">
          <button type="button" className="nut-phu" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="nut-chinh" type="submit" autoFocus>{t('btn.submit')}</button>
        </div>
      </form>
    </Modal>
  );
}

const SYNC_FIELD_LABELS: Record<string, string> = {
  tenTask: 'tên', ghiChu: 'nội dung', gioBatDau: 'giờ', ngayCuThe: 'ngày',
  links: 'link', replyToRef: 'liên kết bài'
};
const SYNC_SKIP_LABELS: Record<string, string> = {
  done: 'đã hoàn thành', canceled: 'đã hủy', past: 'ngày đã qua',
  unchanged: 'không thay đổi', missing: 'chưa có trong đợt'
};

function PopupXacNhanSyncRelease({
  preview,
  busy,
  onClose,
  onConfirm
}: {
  preview: ReleaseSyncPreview;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLang();
  // Ẩn 'unchanged'/'missing' khỏi danh sách bỏ qua chi tiết (chỉ là nhiễu), gộp thành số đếm.
  const skipShown = preview.skipped.filter((item) => item.reason === 'done' || item.reason === 'canceled' || item.reason === 'past');
  const skipQuiet = preview.skipped.length - skipShown.length;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onConfirm();
  }

  return (
    <Modal onClose={onClose}>
      <form className="popup w-full max-w-lg" onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Áp dụng thay đổi vào đợt này</h2>
          <button type="button" className="nut-icon" onClick={onClose}><X size={18} /></button>
        </div>

        {preview.willUpdate.length === 0 ? (
          <p className="mb-5 text-sm leading-6 text-phu">Không có task nào cần cập nhật trong đợt này.</p>
        ) : (
          <div className="mb-4">
            <p className="mb-2 text-sm font-semibold">
              Sẽ cập nhật {preview.willUpdate.length} task
            </p>
            <ul className="max-h-60 overflow-y-auto text-sm leading-6">
              {preview.willUpdate.map((item) => (
                <li key={item.originRef} className="border-b border-black/5 py-1 last:border-0">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-phu"> — {item.changedFields.map((f) => SYNC_FIELD_LABELS[f] || f).join(', ')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {skipShown.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-sm font-semibold text-phu">Bỏ qua {skipShown.length} task (giữ nguyên):</p>
            <ul className="max-h-40 overflow-y-auto text-sm leading-6 text-phu">
              {skipShown.map((item) => (
                <li key={item.originRef} className="py-0.5">
                  {item.title} — {SYNC_SKIP_LABELS[item.reason] || item.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {skipQuiet > 0 && (
          <p className="mb-4 text-xs text-phu">({skipQuiet} task không đổi / chưa có trong đợt — bỏ qua)</p>
        )}

        <div className="flex justify-end gap-3">
          <button type="button" className="nut-phu" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="nut-chinh" type="submit" disabled={busy || preview.willUpdate.length === 0} autoFocus>
            {busy ? 'Đang áp dụng...' : `Áp dụng (${preview.willUpdate.length})`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Export riêng (CR-20260819) để render-test được ô nhập mention mà không phải dựng toàn bộ
// ManHinhLenLich (nặng: gọi nhiều API tải template/definition/batch lúc mount).
export function PopupChonNgayReleaseKhanCap({
  initialDate,
  onClose,
  onConfirm
}: {
  initialDate?: string;
  onClose: () => void;
  // `mentionName`: chuỗi ĐÃ JOIN nhiều tên theo quy tắc "A, B, C" (xem `submit` bên dưới) — CHỈ tên,
  // không kèm team, vì đây là thứ lộ nguyên văn vào bài đăng thật.
  onConfirm: (
    releaseDate: string, mentionName: string, teams: string[], systems: string[]
  ) => Promise<void>;
}) {
  const { t } = useLang();
  const [releaseDate, setReleaseDate] = useState(initialDate || '');
  const [mentionEntries, setMentionEntries] = useState<{ ten: string }[]>([{ ten: '' }]);
  // CR-20260822 FR-3: nguồn canonical team/hệ thống của cả đợt — khai báo chính thức của batch. Gõ
  // tự do, phân tách bằng dấu phẩy (đơn giản hơn multi-select, đủ dùng vì số team mỗi đợt nhỏ).
  const [teamsText, setTeamsText] = useState('');
  const [systemsChecked, setSystemsChecked] = useState<{ 'Dr.JOY': boolean; 'Pr.JOY': boolean }>({ 'Dr.JOY': false, 'Pr.JOY': false });
  const [batchValidationError, setBatchValidationError] = useState('');
  const releaseDateInputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const input = releaseDateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    input?.focus();
    input?.showPicker?.();
  }

  function suaTenTai(index: number, value: string) {
    setMentionEntries((prev) => prev.map((entry, i) => (i === index ? { ...entry, ten: value } : entry)));
  }

  function themOTen() {
    setMentionEntries((prev) => [...prev, { ten: '' }]);
  }

  function xoaOTen(index: number) {
    setMentionEntries((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!releaseDate) return;
    const teams = [...new Set(teamsText.split(',').map((v) => v.trim()).filter(Boolean))];
    const systems = (Object.keys(systemsChecked) as Array<keyof typeof systemsChecked>).filter((k) => systemsChecked[k]);
    if (teams.length === 0 || systems.length === 0) {
      setBatchValidationError(t('release.emg.batch_validation_error'));
      return;
    }
    setBatchValidationError('');
    // Quy tắc nối (Leader chốt): "@ A, B, C" — dấu phẩy+cách giữa các tên, KHÔNG có ở người cuối.
    // Lọc ô không có tên trước khi nối.
    const mentionText = mentionEntries
      .map((entry) => entry.ten.trim())
      .filter(Boolean)
      .join(', ');
    await onConfirm(releaseDate, mentionText, teams, systems);
  }

  return (
    <Modal onClose={onClose}>
      {/* max-w-xl (trước max-w-md): đủ chỗ cho tooltip InfoTip của ô mention không tràn ra ngoài popup
          gây giật lúc hover (xem ghi chú trong src/ui.tsx). */}
      <form className="popup w-full max-w-xl" onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{t('confirm.pick_date_title')}</h2>
          <button type="button" className="nut-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          Release date
          <span className="release-date-picker">
            <input
              ref={releaseDateInputRef}
              type="date"
              required
              value={releaseDate}
              onClick={openPicker}
              onChange={(event) => setReleaseDate(event.target.value)}
            />
            <button type="button" className="release-date-picker-button" onClick={openPicker} title={t('confirm.pick_date_btn')}>
              <CalendarDays size={18} />
            </button>
          </span>
        </label>
        <div className="field">
          <span className="flex items-center gap-1">
            {t('release.emg.mention_name')}
            <InfoTip>{t('release.emg.mention_name_hint')}</InfoTip>
          </span>
          <div className="flex flex-col gap-2">
            {mentionEntries.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={t('release.emg.mention_name_placeholder')}
                  value={entry.ten}
                  onChange={(event) => suaTenTai(index, event.target.value)}
                  className="flex-1"
                />
                {/* Dòng đầu không cho xoá (đủ 1 ô mention là trạng thái tối thiểu của form), chỉ từ
                    dòng 2 trở đi mới xoá được — theo yêu cầu Leader. Giữ layout cố định bằng
                    invisible thay vì bỏ hẳn nút, để các ô không bị lệch dọc khi so hàng. */}
                <button
                  type="button"
                  className={`nut-icon ${index === 0 ? 'invisible' : ''}`}
                  aria-label={`${t('release.emg.mention_remove')} ${index + 1}`}
                  disabled={index === 0}
                  onClick={() => xoaOTen(index)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button type="button" className="nut-phu flex w-fit items-center gap-1" onClick={themOTen}>
              <Plus size={16} /> {t('release.emg.mention_add')}
            </button>
          </div>
        </div>
        <label className="field">
          <span className="flex items-center gap-1">
            {t('release.emg.batch_teams')}
            <InfoTip>{t('release.emg.batch_teams_hint')}</InfoTip>
          </span>
          <input
            type="text"
            placeholder={t('release.emg.batch_teams_placeholder')}
            value={teamsText}
            onChange={(event) => setTeamsText(event.target.value)}
          />
        </label>
        <div className="field">
          <span>{t('release.emg.batch_systems')}</span>
          <div className="flex gap-4">
            {(['Dr.JOY', 'Pr.JOY'] as const).map((sys) => (
              <label key={sys} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={systemsChecked[sys]}
                  onChange={(event) => setSystemsChecked((prev) => ({ ...prev, [sys]: event.target.checked }))}
                />
                {sys}
              </label>
            ))}
          </div>
        </div>
        {batchValidationError && (
          <p role="alert" className="text-sm text-red-600">{batchValidationError}</p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className="nut-phu" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="nut-chinh" type="submit" autoFocus>{t('btn.submit')}</button>
        </div>
      </form>
    </Modal>
  );
}

function LayoutReleaseKhanCap({ onTasksCreated }: { onTasksCreated: (date?: string) => Promise<void> }) {
  const { t } = useLang();
  const [pendingReleaseKey, setPendingReleaseKey] = useState(() => window.localStorage.getItem(emergencyPendingStorageKey) || '');
  const [emergencyReleaseDate, setEmergencyReleaseDate] = useState(() => window.localStorage.getItem(emergencyReleaseDateStorageKey) || '');
  const [schedule, setSchedule] = useState<EmergencyReleaseScheduleInput>({
    stagingDeployAt: '',
    releaseDeployAt: '',
    demoDeployAt: ''
  });
  const [emergencyTemplates, setEmergencyTemplates] = useState<ReleaseTemplateItem[]>([]);
  const [emergencyTasks, setEmergencyTasks] = useState<EmergencyReleaseTaskDefinition[]>([]);
  const [moQuanLyTemplateKhanCap, setMoQuanLyTemplateKhanCap] = useState(false);
  const [moQuanLyTaskKhanCap, setMoQuanLyTaskKhanCap] = useState(false);
  const [showRecreateConfirm, setShowRecreateConfirm] = useState(false);
  const [showReleaseDatePopup, setShowReleaseDatePopup] = useState(false);
  const [status, setStatus] = useState('');
  const [isCreatingTasks, setIsCreatingTasks] = useState(false);
  const [releaseSaveStatus, setReleaseSaveStatus] = useState('');
  const stagingDeployInputRef = useRef<HTMLInputElement>(null);
  const demoDeployInputRef = useRef<HTMLInputElement>(null);
  // CR-20260822 FR-3: nhớ teams/systems lần khai gần nhất để nút "tạo lại" (force, không mở lại popup)
  // vẫn gửi đủ dữ liệu batch — không đổi API `createEmergencyTasks` để thêm state riêng nữa.
  const lastEmergencyBatchInput = useRef<{ teams: string[]; systems: string[] }>({ teams: [], systems: [] });
  const immediateDefinitions = emergencyTasks.filter((task) => task.startTime === 'immediate');
  const hasPendingRelease = Boolean(pendingReleaseKey);
  const isScheduleReady = Boolean(schedule.stagingDeployAt && schedule.releaseDeployAt && schedule.demoDeployAt);
  const releaseMasterTime = schedule.releaseDeployAt.includes('T') ? schedule.releaseDeployAt.split('T')[1] : '';

  async function loadEmergencyTemplates() {
    const templates = await api<ReleaseTemplateItem[]>('/api/release/emergency/templates');
    setEmergencyTemplates(sortTemplatesByName(templates));
  }

  async function loadEmergencyConfig() {
    const [templates, tasks] = await Promise.all([
      api<ReleaseTemplateItem[]>('/api/release/emergency/templates'),
      api<EmergencyReleaseTaskDefinition[]>('/api/release/emergency/task-definitions')
    ]);
    setEmergencyTemplates(sortTemplatesByName(templates));
    setEmergencyTasks(tasks);
  }

  useEffect(() => {
    void loadEmergencyConfig();
  }, []);

  useEffect(() => {
    if (!releaseSaveStatus) return;
    const timeoutId = window.setTimeout(() => setReleaseSaveStatus(''), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [releaseSaveStatus]);

  function openDateTimePicker(inputRef: React.RefObject<HTMLInputElement | null>) {
    const input = inputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    input?.focus();
    input?.showPicker?.();
  }

  function setReleaseMasterTime(value: string) {
    if (!emergencyReleaseDate) return;
    setSchedule({ ...schedule, releaseDeployAt: value ? `${emergencyReleaseDate}T${value}` : '' });
  }

  async function createEmergencyTasks(
    force = false,
    selectedReleaseDate?: string,
    mentionName?: string,
    teams?: string[],
    systems?: string[]
  ) {
    if (immediateDefinitions.length === 0) return;
    const releaseDate = selectedReleaseDate || emergencyReleaseDate;
    if (!releaseDate) {
      setShowReleaseDatePopup(true);
      return;
    }
    // CR-20260822 FR-3: nút "tạo lại" (force) không mở lại popup nên không có teams/systems mới —
    // dùng lại giá trị đã khai lần gần nhất (batch giữ nguyên team/hệ thống khi chỉ tạo lại task).
    const finalTeams = teams && teams.length > 0 ? teams : lastEmergencyBatchInput.current.teams;
    const finalSystems = systems && systems.length > 0 ? systems : lastEmergencyBatchInput.current.systems;
    lastEmergencyBatchInput.current = { teams: finalTeams, systems: finalSystems };
    const releaseKey = pendingReleaseKey || `emergency:${Date.now()}`;
    const tasks = emergencyReleaseTaskPayloads(
      releaseDate,
      immediateDefinitions,
      emergencyTemplates,
      mentionName
    );
    const lastTask = tasks[tasks.length - 1];
    const afterCreateEndAt = lastTask ? localDateTimeInputValue(addMinutes(parseLocalDateTime(lastTask.ngayCuThe, lastTask.gioBatDau), 15)) : '';
    setEmergencyReleaseDate(releaseDate);
    window.localStorage.setItem(emergencyReleaseDateStorageKey, releaseDate);
    if (afterCreateEndAt) window.localStorage.setItem(emergencyAfterCreateEndStorageKey, afterCreateEndAt);
    setIsCreatingTasks(true);
    try {
      await api('/api/schedules/emergency-release/tasks', {
        method: 'POST',
        body: JSON.stringify({ releaseDate, releaseKey, tasks, force, teams: finalTeams, systems: finalSystems })
      });
      setPendingReleaseKey(releaseKey);
      window.localStorage.setItem(emergencyPendingStorageKey, releaseKey);
      await onTasksCreated(tasks[0]?.ngayCuThe || releaseDate);
      setShowRecreateConfirm(false);
      setShowReleaseDatePopup(false);
      setStatus(`Đã tạo ${tasks.length} task ngay lập tức. Nhập lịch deploy/release để tạo task định kỳ.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setShowRecreateConfirm(true);
        return;
      }
      setStatus(e instanceof Error ? e.message : 'Không thể tạo task khẩn cấp.');
      throw e;
    } finally {
      setIsCreatingTasks(false);
    }
  }

  async function cancelPendingEmergencyRelease() {
    if (!pendingReleaseKey) return;
    setIsCreatingTasks(true);
    try {
      await api(`/api/schedules/emergency-release/tasks?releaseKey=${encodeURIComponent(pendingReleaseKey)}`, { method: 'DELETE' });
      setPendingReleaseKey('');
      setEmergencyReleaseDate('');
      window.localStorage.removeItem(emergencyPendingStorageKey);
      window.localStorage.removeItem(emergencyReleaseDateStorageKey);
      window.localStorage.removeItem(emergencyAfterCreateEndStorageKey);
      setSchedule({ stagingDeployAt: '', releaseDeployAt: '', demoDeployAt: '' });
      await onTasksCreated();
      setStatus('Đã hủy các task khẩn cấp vừa tạo.');
    } finally {
      setIsCreatingTasks(false);
    }
  }

  async function createFixedEmergencyScheduleTasks() {
    if (!pendingReleaseKey || !isScheduleReady) return;
    const releaseDate = emergencyReleaseDate || schedule.releaseDeployAt.slice(0, 10);
    const tasks = emergencyFixedReleaseTaskPayloads(
      schedule,
      emergencyTasks,
      emergencyTemplates,
      window.localStorage.getItem(emergencyAfterCreateEndStorageKey) || undefined,
      new Date()
    );
    if (tasks.length === 0) {
      setStatus('Chưa có task định kỳ khẩn cấp nào trong cấu hình.');
      return;
    }
    setIsCreatingTasks(true);
    try {
      await api('/api/schedules/emergency-release/tasks', {
        method: 'POST',
        body: JSON.stringify({
          releaseDate,
          releaseKey: `${pendingReleaseKey}:schedule`,
          tasks,
          force: true
        })
      });
      setPendingReleaseKey('');
      setEmergencyReleaseDate('');
      window.localStorage.removeItem(emergencyPendingStorageKey);
      window.localStorage.removeItem(emergencyReleaseDateStorageKey);
      window.localStorage.removeItem(emergencyAfterCreateEndStorageKey);
      setSchedule({ stagingDeployAt: '', releaseDeployAt: '', demoDeployAt: '' });
      await onTasksCreated(tasks[0]?.ngayCuThe || releaseDate);
      setStatus(`Đã tạo ${tasks.length} task định kỳ cho release khẩn cấp.`);
    } finally {
      setIsCreatingTasks(false);
    }
  }

  async function syncEmergencyTasksUsingTemplate(savedTemplate: ReleaseTemplateItem) {
    if (!pendingReleaseKey) return;
    const affectedDefinitions = emergencyTasks.filter((definition) => definition.templateId === savedTemplate.id && definition.startTime === 'immediate');
    if (affectedDefinitions.length === 0) return;
    const templates = sortTemplatesByName(emergencyTemplates.some((template) => template.id === savedTemplate.id)
      ? emergencyTemplates.map((template) => template.id === savedTemplate.id ? savedTemplate : template)
      : [...emergencyTemplates, savedTemplate]);
    const releaseDate = emergencyReleaseDate || currentVietnamDateInputValue();
    const tasks = emergencyReleaseTaskPayloads(releaseDate, affectedDefinitions, templates);

    await api('/api/schedules/emergency-release/tasks', {
      method: 'POST',
      body: JSON.stringify({ releaseDate, releaseKey: pendingReleaseKey, tasks, replaceMatching: true })
    });
    await onTasksCreated(tasks[0]?.ngayCuThe || releaseDate);
  }

  return (
    <div className="release-layout">
      <div className="release-form-panel">
        <h3>{t('release.emg.title')}</h3>
        <div className="release-primary-actions">
          <button
            type="button"
            className="nut-phu release-hover-emerald"
            disabled={isCreatingTasks || immediateDefinitions.length === 0}
            onClick={() => setShowReleaseDatePopup(true)}
          >
            {t('release.emg.create_phase1')}
          </button>
        </div>
        {hasPendingRelease && (
          <div className="release-emergency-schedule-form">
            <div className="release-emergency-grid">
              <label className="field">
                {t('release.emg.staging')}
                <span className="release-date-picker">
                  <input
                    ref={stagingDeployInputRef}
                    type="datetime-local"
                    value={schedule.stagingDeployAt}
                    onClick={() => openDateTimePicker(stagingDeployInputRef)}
                    onChange={(event) => setSchedule({ ...schedule, stagingDeployAt: event.target.value })}
                  />
                  <button type="button" className="release-date-picker-button" onClick={() => openDateTimePicker(stagingDeployInputRef)} title={t('release.emg.pick_staging')}>
                    <CalendarDays size={18} />
                  </button>
                </span>
              </label>
              <label className="field">
                {t('release.emg.master')}
                <div className="release-master-time-field">
                  <span className="release-master-date">
                    {emergencyReleaseDate ? dinhDangNgayDayDu(emergencyReleaseDate) : t('release.emg.no_date')}
                  </span>
                  <TimeInput
                    value={releaseMasterTime}
                    disabled={!emergencyReleaseDate}
                    onChange={(v) => setReleaseMasterTime(v)}
                  />
                </div>
              </label>
              <label className="field">
                {t('release.emg.demo')}
                <span className="release-date-picker">
                  <input
                    ref={demoDeployInputRef}
                    type="datetime-local"
                    value={schedule.demoDeployAt}
                    onClick={() => openDateTimePicker(demoDeployInputRef)}
                    onChange={(event) => setSchedule({ ...schedule, demoDeployAt: event.target.value })}
                  />
                  <button type="button" className="release-date-picker-button" onClick={() => openDateTimePicker(demoDeployInputRef)} title={t('release.emg.pick_demo')}>
                    <CalendarDays size={18} />
                  </button>
                </span>
              </label>
            </div>
            <div className="release-primary-actions">
              <button type="button" className="nut-phu" disabled={isCreatingTasks} onClick={cancelPendingEmergencyRelease}>
                {t('btn.cancel')}
              </button>
              <button type="button" className="nut-chinh release-hover-emerald" disabled={isCreatingTasks || !isScheduleReady} onClick={createFixedEmergencyScheduleTasks}>
                {t('release.emg.create_scheduled')}
              </button>
            </div>
          </div>
        )}
        <div className="release-management-actions">
          <button
            type="button"
            className="nut-phu release-hover-emerald"
            onClick={async () => {
              await loadEmergencyConfig();
              setMoQuanLyTemplateKhanCap(true);
            }}
          >
            {t('release.emg.manage_template')}
          </button>
          <button
            type="button"
            className="nut-phu release-hover-emerald"
            onClick={async () => {
              await loadEmergencyConfig();
              setMoQuanLyTaskKhanCap(true);
            }}
          >
            {t('release.emg.manage_tasks')}
          </button>
        </div>
        {status && <p className="release-copy-status">{status}</p>}
      </div>
      <EmergencyReleaseMemeDecoration />
      {moQuanLyTemplateKhanCap && (
        <PopupQuanLyReleaseTemplate
          title={t('release.emg.manage_template')}
          apiBasePath="/api/release/emergency/templates"
          variant="emergency"
          templates={emergencyTemplates}
          onClose={() => setMoQuanLyTemplateKhanCap(false)}
          onReload={loadEmergencyTemplates}
          onTemplateSaved={syncEmergencyTasksUsingTemplate}
          onSaved={(message) => {
            setReleaseSaveStatus(message);
          }}
        />
      )}
      {moQuanLyTaskKhanCap && (
        <PopupQuanLyEmergencyReleaseTask
          tasks={emergencyTasks}
          templates={emergencyTemplates}
          releaseDate={schedule.releaseDeployAt.slice(0, 10)}
          onClose={() => setMoQuanLyTaskKhanCap(false)}
          onReload={loadEmergencyConfig}
          onSaved={(message) => {
            setReleaseSaveStatus(message);
          }}
        />
      )}
      {releaseSaveStatus && (
        <div className="release-save-success" role="status" aria-live="polite">
          <span className="release-save-success-icon">
            <Check size={42} strokeWidth={3} />
          </span>
          <span>{releaseSaveStatus}</span>
        </div>
      )}
      {showRecreateConfirm && (
        <PopupXacNhanTaoLaiRelease
          onClose={() => setShowRecreateConfirm(false)}
          onConfirm={() => createEmergencyTasks(true)}
        />
      )}
      {showReleaseDatePopup && (
        <PopupChonNgayReleaseKhanCap
          initialDate={emergencyReleaseDate || schedule.releaseDeployAt.slice(0, 10) || ''}
          onClose={() => setShowReleaseDatePopup(false)}
          onConfirm={(releaseDate, mentionName, teams, systems) =>
            createEmergencyTasks(false, releaseDate, mentionName, teams, systems)
          }
        />
      )}
    </div>
  );
}
