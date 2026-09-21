import { db } from '../db.js';
import { HttpError } from './utils.js';
import { AUTHORIZATION_POLICY } from './authorization-policy.js';

// Hàm authorize() — MỘT cổng vào duy nhất (FR-40), chốt qua Council `1aa7fe8b` + `f0a0e1bb` (xem
// docs/exchanges/2026-09-19.md, 2026-09-21.md). Chạy SAU lớp 1 (phiên) + lớp 1.5 (trạng thái tài khoản)
// — hai lớp đó là middleware riêng ở server/lib/auth-middleware.ts, không nằm trong hàm này.
//
// Route KHÔNG được tự lặp lại điều kiện Member/Leader/Admin — luôn throw HttpError(403, ...) khi từ
// chối, không bao giờ trả false/true, để không route nào lỡ quên kiểm giá trị trả về.
export type TeamRole = 'leader' | 'member';
export type SystemRole = 'user' | 'admin';

export interface Membership {
  teamId: number;
  role: TeamRole;
}

export interface Actor {
  userId: number;
  systemRole: SystemRole;
  memberships: Membership[];
}

export type PolicyKind = 'team_feature' | 'personal_task' | 'cross_team_release' | 'audit';

export interface AuthorizeScope {
  teamId?: number;
  ownerId?: number;
}

export interface AuthorizeInput {
  actor: Actor;
  policyKind: PolicyKind;
  resource: string;
  action: string;
  scope: AuthorizeScope;
}

export interface AuthorizationDecision {
  viewerTeamId: number | null;
  effectiveRole: string | null;
  projection?: string;
  ownerOnly?: boolean;
}

// Nạp memberships hiện tại của actor — dùng ở auth-middleware.ts, load MỚI HOÀN TOÀN mỗi request,
// không cache (FR-4a/SEC-PERF-016).
export function loadMemberships(userId: number): Membership[] {
  return db.prepare('SELECT team_id as teamId, role FROM team_members WHERE user_id = ?').all(userId) as unknown as Membership[];
}

// policyKind: 'team_feature' — đường thường, đa số route (kể cả 6 route Admin toàn cục, coi
// scope.teamId là undefined thì bỏ qua bước 1-2, xem comment ở authorization-policy.ts).
function authorizeTeamFeature(input: AuthorizeInput): AuthorizationDecision {
  const { actor, resource, action, scope } = input;
  const policy = AUTHORIZATION_POLICY[resource]?.[action];
  if (!policy) {
    // Fail-closed: route chưa khai báo luật thì bị chặn, không mặc định cho qua (FR-40).
    throw new HttpError(403, `Chưa khai báo luật phân quyền cho ${resource}.${action}`, 'ROLE_FORBIDDEN');
  }

  const teamId = scope.teamId;
  let effectiveRole: string;

  if (teamId !== undefined) {
    // Bước 1 — tầng 2 hiển thị: chỉ áp khi resource này thật sự gắn với 1 trong 5 feature bật/tắt.
    if (policy.feature) {
      const row = db.prepare('SELECT level FROM team_feature_visibility WHERE team_id = ? AND feature = ?')
        .get(teamId, policy.feature) as { level: string } | undefined;
      if (!row || row.level !== 'on') {
        throw new HttpError(403, 'Chức năng này đang bị tắt cho team của bạn', 'FEATURE_DISABLED');
      }
    }
    // Bước 2 — ngữ cảnh team: actor phải là thành viên đúng team đích (suy từ DB, không tin client).
    const membership = actor.memberships.find((m) => m.teamId === teamId);
    if (!membership) {
      throw new HttpError(403, 'Bạn không phải thành viên của team này', 'NOT_TEAM_MEMBER');
    }
    effectiveRole = membership.role;
  } else {
    // Route toàn cục (không gắn 1 team cụ thể) — vai trò xét theo system_role.
    effectiveRole = actor.systemRole;
  }

  // Bước 3 — tầng 3 năng lực: luật cố định trong code.
  if (!policy.roles.includes(effectiveRole)) {
    throw new HttpError(403, 'Vai trò của bạn không được thực hiện hành động này', 'ROLE_FORBIDDEN');
  }

  // Bước 4 — tầng 4 vai đặc biệt: CHỈ áp khi resource là đúng tên dành riêng 'release_coordinator'
  // (Lát 6, chưa có route Lát 3 nào dùng — xem comment trong authorization-policy.ts). Độc lập với
  // trạng thái Bật/Tắt Release của chính team actor (FR-9).
  if (resource === 'release_coordinator') {
    const config = db.prepare('SELECT release_coordinator_team_id FROM app_config WHERE id = 1')
      .get() as { release_coordinator_team_id: number | null };
    const isCoordinatorLeader = config.release_coordinator_team_id != null
      && actor.memberships.some((m) => m.teamId === config.release_coordinator_team_id && m.role === 'leader');
    if (!isCoordinatorLeader) {
      throw new HttpError(403, 'Chỉ Leader của team điều phối Release mới thực hiện được hành động này', 'NOT_RELEASE_COORDINATOR');
    }
  }

  return { viewerTeamId: teamId ?? null, effectiveRole };
}

// policyKind: 'personal_task' (FR-14, FR-31 — chưa có route Lát 3 nào gọi, Task cá nhân thuộc Lát 5;
// implement đủ ngay theo đúng câu chữ CR đã chốt để Lát 5 chỉ cần gọi, không sửa core).
function authorizePersonalTask(input: AuthorizeInput): AuthorizationDecision {
  const { actor, scope } = input;
  if (scope.ownerId !== actor.userId) {
    throw new HttpError(403, 'Chỉ chủ sở hữu mới thao tác được task cá nhân này', 'ROLE_FORBIDDEN');
  }
  const teamIds = actor.memberships.map((m) => m.teamId);
  if (teamIds.length > 0) {
    const placeholders = teamIds.map(() => '?').join(',');
    const row = db.prepare(
      `SELECT 1 FROM team_feature_visibility WHERE feature = 'personal_task' AND level = 'on' AND team_id IN (${placeholders})`
    ).get(...teamIds);
    if (row) return { viewerTeamId: null, effectiveRole: null, ownerOnly: true };
  }
  throw new HttpError(403, 'Bạn chưa thuộc team nào đang Bật Task cá nhân', 'FEATURE_DISABLED');
}

// policyKind: 'cross_team_release' (FR-24 — chưa có route Lát 3 nào gọi, lịch Release liên team thuộc
// Lát 6). Không phải allow/deny theo team đích — mọi Member/Leader của MỘT team đang Bật Release đều
// đọc được toàn bộ lịch chung, khác biệt chỉ ở field trả về (route tự áp `projection`).
function authorizeCrossTeamRelease(input: AuthorizeInput): AuthorizationDecision {
  const { actor } = input;
  const teamIds = actor.memberships.map((m) => m.teamId);
  if (teamIds.length > 0) {
    const placeholders = teamIds.map(() => '?').join(',');
    const row = db.prepare(
      `SELECT 1 FROM team_feature_visibility WHERE feature = 'release' AND level = 'on' AND team_id IN (${placeholders})`
    ).get(...teamIds);
    if (row) return { viewerTeamId: null, effectiveRole: null, projection: 'schedule_board' };
  }
  throw new HttpError(403, 'Bạn chưa thuộc team nào đang Bật Release', 'FEATURE_DISABLED');
}

// policyKind: 'audit' (FR-11a) — Admin đọc toàn cục (metadata), Leader/Member chỉ đọc đúng team mình
// (chi tiết đầy đủ, sửa 19/09 lần 14 thêm Member). Không phải role-list đơn giản như team_feature nên
// xử lý riêng, không tra AUTHORIZATION_POLICY.
function authorizeAudit(input: AuthorizeInput): AuthorizationDecision {
  const { actor, scope } = input;
  if (actor.systemRole === 'admin') {
    return { viewerTeamId: scope.teamId ?? null, effectiveRole: 'admin', projection: 'admin_metadata' };
  }
  if (scope.teamId === undefined) {
    throw new HttpError(403, 'Chỉ Admin xem được nhật ký toàn cục — bạn phải chọn đúng team của mình', 'NOT_TEAM_MEMBER');
  }
  const membership = actor.memberships.find((m) => m.teamId === scope.teamId);
  if (!membership) {
    throw new HttpError(403, 'Bạn không phải thành viên của team này', 'NOT_TEAM_MEMBER');
  }
  return { viewerTeamId: scope.teamId, effectiveRole: membership.role, projection: 'team_detail' };
}

export function authorize(input: AuthorizeInput): AuthorizationDecision {
  switch (input.policyKind) {
    case 'team_feature': return authorizeTeamFeature(input);
    case 'personal_task': return authorizePersonalTask(input);
    case 'cross_team_release': return authorizeCrossTeamRelease(input);
    case 'audit': return authorizeAudit(input);
    default: throw new HttpError(403, 'policyKind không hợp lệ', 'ROLE_FORBIDDEN');
  }
}
