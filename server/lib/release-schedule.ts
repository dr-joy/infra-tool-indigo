// CR-20260913 Lát 6 (§6.3, Release nhiều team) — thư viện thuần cho phần lịch release KHẨN CẤP:
// tìm-hoặc-tạo cycle, phát hiện/tự đóng xung đột (FR-25), và render/đồng bộ task cá nhân khẩn cấp sinh
// từ FR-28a (FR-26 bước 5 — PHẢI viết route/hàm MỚI HOÀN TOÀN, không tái dùng planReleaseWrite() của
// nhánh định kỳ, vì cơ chế đó không tồn tại cho khẩn cấp — xem CR dòng 748-761).
//
// File này thuộc VÙNG QUYẾT ĐỊNH của scripts/check-tz.mjs — mọi phép tính giờ PHẢI qua
// server/lib/vn-time.ts, không dùng `new Date(y,m,d,...)`/`getHours()`/`setHours()`.
import type { DatabaseSync } from 'node:sqlite';
import { vietnamInstant } from './vn-time.js';
import { toMinutes, toTime } from './utils.js';
import type { EmergencyTimingToken } from '../types.js';
import { renderEmergencyPersonalTemplate, type EmergencyTemplateLocale } from './emergency-template-render.js';

// ── Giờ nhập tay của registration — lưu "YYYY-MM-DD HH:mm" (giờ VN, không mang múi giờ) ───────────
export function parseWallClock(dateKey: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time)) return null;
  if (!vietnamInstant(dateKey, time)) return null; // chặn ngày/giờ không tồn tại thật (vd 2026-02-30)
  return `${dateKey} ${time}`;
}

export function wallClockDateKey(wallClock: string): string {
  return wallClock.slice(0, 10);
}

export function wallClockTime(wallClock: string): string {
  return wallClock.slice(11, 16);
}

// FR-23a chốt 19/09 lần 3: deploy_demo_at LUÔN tự tính = 16:00 CÙNG NGÀY release_at, không cho nhập tay.
export function computeDeployDemoAt(releaseAtWallClock: string): string {
  return `${wallClockDateKey(releaseAtWallClock)} 16:00`;
}

export function emergencyReleaseKeyOf(releaseDateKey: string): string {
  return `emergency:${releaseDateKey}`;
}

// ── Cycle khẩn cấp: tự tìm-hoặc-tạo theo NGÀY release (FR-25) ─────────────────────────────────────
export interface EmergencyCycleRef { id: number; releaseKey: string; }

export function findOrCreateEmergencyCycle(
  db: DatabaseSync, releaseDateKey: string, actorUserId: number, now: string
): EmergencyCycleRef {
  const releaseKey = emergencyReleaseKeyOf(releaseDateKey);
  const existing = db.prepare('SELECT id FROM release_cycles WHERE release_key = ?').get(releaseKey) as { id: number } | undefined;
  if (existing) return { id: existing.id, releaseKey };
  try {
    const result = db.prepare(
      `INSERT INTO release_cycles (release_key, kind, status, created_at, created_by) VALUES (?, 'emergency', 'open', ?, ?)`
    ).run(releaseKey, now, actorUserId);
    return { id: Number(result.lastInsertRowid), releaseKey };
  } catch (error) {
    // Race: 2 request cùng nộp registration đầu tiên của 1 ngày -> UNIQUE(release_key) văng ở 1 bên.
    const again = db.prepare('SELECT id FROM release_cycles WHERE release_key = ?').get(releaseKey) as { id: number } | undefined;
    if (again) return { id: again.id, releaseKey };
    throw error;
  }
}

// ── Xung đột (FR-25) — chỉ so release_at/deploy_staging_at, KHÔNG so hệ thống/nền tảng/ticket/ghi
// chú/link Nhật. Rà lại TOÀN BỘ cặp trong cycle mỗi lần 1 registration được lưu — mở 'open' mới cho cặp
// vừa lệch, tự đóng 'resolved' cặp đã hết lệch, không đụng cặp đã 'forced' (ép giờ chung, xem FR-25).
export interface RegistrationForConflict {
  id: number;
  deploy_staging_at: string;
  release_at: string;
}

function isMismatch(a: RegistrationForConflict, b: RegistrationForConflict): boolean {
  return a.release_at !== b.release_at || a.deploy_staging_at !== b.deploy_staging_at;
}

export function reconcileConflictsForCycle(db: DatabaseSync, cycleId: number, now: string): void {
  const regs = db.prepare(
    `SELECT id, deploy_staging_at, release_at FROM team_release_registrations WHERE cycle_id = ? AND status != 'cancelled'`
  ).all(cycleId) as unknown as RegistrationForConflict[];
  const openRows = db.prepare(
    `SELECT id, registration_a_id, registration_b_id FROM release_schedule_conflicts WHERE cycle_id = ? AND status = 'open'`
  ).all(cycleId) as { id: number; registration_a_id: number; registration_b_id: number }[];
  const openByPair = new Map(openRows.map((r) => [`${r.registration_a_id}:${r.registration_b_id}`, r.id]));
  const insertOpen = db.prepare(
    `INSERT INTO release_schedule_conflicts (cycle_id, registration_a_id, registration_b_id, status, detected_at) VALUES (?, ?, ?, 'open', ?)`
  );
  const resolveOpen = db.prepare(`UPDATE release_schedule_conflicts SET status = 'resolved', resolved_at = ? WHERE id = ?`);

  const seenPairs = new Set<string>();
  for (let i = 0; i < regs.length; i++) {
    for (let j = i + 1; j < regs.length; j++) {
      const [lo, hi] = regs[i].id < regs[j].id ? [regs[i], regs[j]] : [regs[j], regs[i]];
      const key = `${lo.id}:${hi.id}`;
      seenPairs.add(key);
      const mismatch = isMismatch(lo, hi);
      const existingOpenId = openByPair.get(key);
      if (mismatch && existingOpenId === undefined) {
        insertOpen.run(cycleId, lo.id, hi.id, now);
      } else if (!mismatch && existingOpenId !== undefined) {
        resolveOpen.run(now, existingOpenId);
      }
    }
  }
  // Registration vừa cancelled (loại khỏi `regs` ở trên) -> mọi xung đột 'open' còn treo của nó tự đóng
  // (chốt 19/09 lần 11: "huỷ 1 bên -> xung đột tự đóng ngay").
  for (const row of openRows) {
    const key = `${row.registration_a_id}:${row.registration_b_id}`;
    if (!seenPairs.has(key)) resolveOpen.run(now, row.id);
  }
}

// ── "Ép giờ chung" (FR-25) — ngoại lệ duy nhất sửa trực tiếp dữ liệu team khác ────────────────────
export interface ForceTimeResult {
  registrationId: number;
  teamId: number;
  oldDeployStagingAt: string;
  oldReleaseAt: string;
  newDeployStagingAt: string;
  newReleaseAt: string;
  newDeployDemoAt: string;
}

// Ghi đè deploy_staging_at/release_at (deploy_demo_at tự tính lại theo release_at mới) lên TỪNG
// registration trong danh sách — route gọi hàm này rồi tự ghi audit_log cho MỖI team bị ép (actor thật/
// team bị ép/giá trị cũ-mới, đúng yêu cầu CR). Registration đang 'locked' vẫn ép được (chốt 19/09 lần 13).
export function forceRegistrationTimes(
  db: DatabaseSync, registrationIds: number[], deployStagingAt: string, releaseAt: string, actorUserId: number, now: string
): ForceTimeResult[] {
  const deployDemoAt = computeDeployDemoAt(releaseAt);
  const selectOld = db.prepare('SELECT id, team_id, deploy_staging_at, release_at FROM team_release_registrations WHERE id = ?');
  const update = db.prepare(`
    UPDATE team_release_registrations
    SET deploy_staging_at = ?, release_at = ?, deploy_demo_at = ?, updated_at = ?, updated_by = ?, row_version = row_version + 1
    WHERE id = ?
  `);
  const results: ForceTimeResult[] = [];
  for (const id of registrationIds) {
    const old = selectOld.get(id) as { id: number; team_id: number; deploy_staging_at: string; release_at: string } | undefined;
    if (!old) continue;
    update.run(deployStagingAt, releaseAt, deployDemoAt, now, actorUserId, id);
    results.push({
      registrationId: id, teamId: old.team_id,
      oldDeployStagingAt: old.deploy_staging_at, oldReleaseAt: old.release_at,
      newDeployStagingAt: deployStagingAt, newReleaseAt: releaseAt, newDeployDemoAt: deployDemoAt
    });
  }
  // Mọi xung đột 'open' TRỰC TIẾP giữa các registration vừa bị ép -> 'forced' (đã cùng giờ, không còn
  // là xung đột cần rà soát nữa). Cặp khác (vd registration vừa ép với 1 team thứ 3 chưa xử lý) vẫn để
  // reconcileConflictsForCycle() (gọi ngay sau hàm này) tự phân loại lại bình thường.
  if (registrationIds.length >= 2) {
    const idSet = new Set(registrationIds);
    const placeholders = registrationIds.map(() => '?').join(',');
    const openRows = db.prepare(
      `SELECT id, registration_a_id, registration_b_id FROM release_schedule_conflicts
       WHERE status = 'open' AND registration_a_id IN (${placeholders}) AND registration_b_id IN (${placeholders})`
    ).all(...registrationIds, ...registrationIds) as { id: number; registration_a_id: number; registration_b_id: number }[];
    const markForced = db.prepare(`UPDATE release_schedule_conflicts SET status = 'forced', resolved_at = ?, resolved_by = ? WHERE id = ?`);
    for (const row of openRows) {
      if (idSet.has(row.registration_a_id) && idSet.has(row.registration_b_id)) markForced.run(now, actorUserId, row.id);
    }
  }
  return results;
}

// ── Task cá nhân khẩn cấp (FR-28a nhánh "Khẩn cấp" + FR-26 bước 5 "tự cập nhật giờ") ──────────────
//
// Phạm vi CỐ Ý thu hẹp (ghi rõ, không giấu): chỉ 3 token TƯƠNG ĐỐI có mỏ neo thật
// (`staging_deploy`/`release_deploy`/`demo_deploy`, đúng `relativeEmergencyTimingTokens` ở
// server/types.ts) được tính giờ tự động = mỏ neo + relative_offset_minutes, và CHỈ 3 token này được
// đồng bộ lại khi registration đổi giờ (FR-26 bước 5) — 3 token còn lại (`before_hotfix`/`hotfix`/
// `after_hotfix`) không neo theo mốc registration nào (giờ cố định hoặc "immediate" nhập tay), không
// nằm trong phạm vi tự-cập-nhật này. KHÔNG port lại thuật toán xếp giờ theo `immediate_priority`/
// `schedule_mode` của client cũ (src/screens/release.tsx) — đó là quy tắc GIÃN CÁCH hiển thị nhiều task
// trùng mỏ neo trên UI, không phải quy tắc múi giờ, và chưa được đọc/kiểm chứng trực tiếp trong phạm vi
// việc này (R-CODE: không đoán hành vi chưa đọc code). Nhiều task trùng giờ vẫn hợp lệ ở tầng dữ liệu.
export interface EmergencyRegistrationAnchors {
  teamId: number;
  cycleId: number;
  cycleReleaseKey: string;
  deployStagingAt: string;
  releaseAt: string;
  deployDemoAt: string;
}

export interface EmergencyDefinitionForGenerate {
  id: string;
  title: string;
  note: string;
  taskDate: string; // EmergencyTimingToken
  startTime: string; // 'immediate' | 'relative' | 'HH:mm'
  relativeOffsetMinutes: number | null;
  templateContent: string | null;
  taskLinksJson: string;
  replyToDefinitionId: string | null;
}

export interface RenderedEmergencyPersonalTask {
  definitionId: string;
  title: string;
  ghiChu: string;
  ngayCuThe: string;
  gioBatDau: string;
  gioKetThuc: string;
  linksJson: string;
  replyToRef: string | null;
}

const ANCHOR_FIELD: Record<'staging_deploy' | 'release_deploy' | 'demo_deploy', keyof EmergencyRegistrationAnchors> = {
  staging_deploy: 'deployStagingAt',
  release_deploy: 'releaseAt',
  demo_deploy: 'deployDemoAt'
};

// Tính giờ bắt đầu (phút trong ngày của MỎ NEO, kẹp [0, 1440-15]) — mỏ neo + offset, đúng phép cộng
// phút thuần trên chuỗi "HH:mm" (không đọc đồng hồ máy). `null` = definition này không thuộc 3 token có
// mỏ neo (before/after/hotfix) — route "generate"/"sync" bỏ qua, không tính được giờ tự động.
export function renderEmergencyPersonalTask(
  definition: EmergencyDefinitionForGenerate, anchors: EmergencyRegistrationAnchors, locale: EmergencyTemplateLocale
): RenderedEmergencyPersonalTask | null {
  const timingToken = definition.taskDate as EmergencyTimingToken;
  const anchorKey = ANCHOR_FIELD[timingToken as 'staging_deploy' | 'release_deploy' | 'demo_deploy'];
  if (!anchorKey) return null; // before_hotfix/hotfix/after_hotfix — ngoài phạm vi tự tính giờ
  const anchorWallClock = anchors[anchorKey] as string;
  const anchorDateKey = wallClockDateKey(anchorWallClock);
  const anchorMinutes = toMinutes(wallClockTime(anchorWallClock));
  const offset = definition.relativeOffsetMinutes ?? 0;
  const start = Math.min(24 * 60 - 15, Math.max(0, anchorMinutes + offset));
  const end = start + 15;

  const ghiChu = definition.templateContent
    ? renderEmergencyPersonalTemplate(definition.templateContent, {
        deployStagingAt: anchors.deployStagingAt, releaseAt: anchors.releaseAt, deployDemoAt: anchors.deployDemoAt
      }, locale)
    : definition.note;

  return {
    definitionId: definition.id, title: definition.title, ghiChu,
    ngayCuThe: anchorDateKey, gioBatDau: toTime(start), gioKetThuc: toTime(end),
    linksJson: definition.taskLinksJson, replyToRef: definition.replyToDefinitionId
  };
}

// Khoá nhóm task cá nhân khẩn cấp — bắt buộc theo (user_id, team_id, cycle_id, definition_id), không
// chỉ (release_key, origin_ref) như nhánh định kỳ cũ (CR §6.3 Lát 6, Council 95a26ee6): 1 User có thể
// thuộc nhiều team, mỗi (team, cycle) phải là 1 nhóm riêng dù cùng 1 User. Vẫn giữ tiền tố `emergency:`
// (bắt buộc, FR-28a — để nguyên màu đỏ hồng của `taskSourceClass()` phía FE, xem
// src/screens/personal-task.tsx:63) nhưng thêm hậu tố `:teamN:userM:<locale>` để KHÔNG đụng khoá
// `emergency:YYYY-MM-DD` của cơ chế batch toàn-team cũ (`emergency_release_batches`/schedules.ts).
//
// `locale` được MÃ HOÁ vào chính khoá này (thay vì thêm cột mới) để route "sync" (FR-26 bước 5, chạy
// KHÔNG có tham số locale từ người gọi — nó chạy tự động khi registration đổi giờ) biết render lại
// `ghi_chu` bằng đúng locale actor đã chọn lúc "generate" (FR-30: locale phải TƯỜNG MINH, không đoán).
export function emergencyPersonalReleaseMonthKey(
  cycleReleaseKey: string, teamId: number, ownerUserId: number, locale: EmergencyTemplateLocale
): string {
  return `${cycleReleaseKey}:team${teamId}:user${ownerUserId}:${locale}`;
}

// Tiền tố dùng để tìm TOÀN BỘ task cá nhân khẩn cấp của 1 team trong 1 cycle, BẤT KỂ user/locale nào —
// dùng cho cascade huỷ (FR-26 bước 6) và đồng bộ giờ (FR-26 bước 5), vốn phải áp dụng cho MỌI User đã
// từng tự áp dụng checklist của mình cho đúng team+đợt đó.
export function emergencyPersonalReleaseMonthPrefix(cycleReleaseKey: string, teamId: number): string {
  return `${cycleReleaseKey}:team${teamId}:user`;
}

// Suy ngược locale từ release_month đã sinh — mặc định 'vi' nếu không parse được (dữ liệu cũ/hỏng).
export function parseEmergencyPersonalLocale(releaseMonth: string): EmergencyTemplateLocale {
  return releaseMonth.endsWith(':ja') ? 'ja' : 'vi';
}

// Escape 3 ký tự đặc biệt của LIKE (`%`, `_`, và chính ký tự escape) — release_key/teamId là dữ liệu
// nội bộ (ngày ISO + số nguyên) nên thực tế không chứa `%`/`_`, nhưng escape tường minh vẫn rẻ và an
// toàn hơn là giả định câm.
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// ── Task cá nhân ĐỊNH KỲ (FR-28a nhánh "Định kỳ") — khoá nhóm theo (cycle_id, owner_user_id) TRỰC
// TIẾP, không suy từ tháng dương lịch. CR §6.3 "Cảnh báo kỹ thuật" (dòng ~1513): 2 release_cycles
// kind='regular' cùng tháng dương lịch cùng mở (đã cho phép) không được lẫn task cá nhân của nhau nếu
// dùng chung 1 khoá `release_month`. Route MỚI (server/routes/release-schedule.ts,
// POST /release/schedule/personal-regular-tasks) dùng khoá này ngay từ đầu — không suy từ
// `releaseDate.slice(0,7)` như nhánh cũ (server/routes/schedules.ts, NGOÀI PHẠM VI đổi ở đây, xem báo
// cáo bàn giao Lát 6 phần "định kỳ"). Vẫn tái dùng cột `tasks.release_month` như một khoá batch dạng
// chuỗi chung (đúng khuôn `emergencyPersonalReleaseMonthKey` ở trên) — không thêm cột mới, không cần
// migration schema. Không bắt đầu bằng `emergency:` nên `taskSourceClass()` (FE) vẫn tô màu tím release
// định kỳ như cũ (src/screens/personal-task.tsx:62-66).
export function regularPersonalReleaseMonthKey(cycleId: number, ownerUserId: number): string {
  return `regular:cycle${cycleId}:user${ownerUserId}`;
}
