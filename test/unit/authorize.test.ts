// authorize() (server/lib/authorize.ts) — CR-20260913 FR-40, chốt qua Council 1aa7fe8b + f0a0e1bb.
// Test trực tiếp hàm (không qua route) vì 2 policyKind ('personal_task', 'cross_team_release') và
// nhánh resource==='release_coordinator' (bước 4) CHƯA có route Lát 3 nào gọi tới (Task cá nhân/
// Release liên team/vai điều phối thật thuộc Lát 5/6) — core phải đúng ngay từ bây giờ để Lát 5/6 chỉ
// cần gọi, không sửa lại (đúng nguyên tắc "Lát 4-6 không sửa core" đã chốt).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-authorize-utest-'));
process.env.APPDATA = tmpAppData;

const { db } = await import('../../server/db.js');
const { authorize } = await import('../../server/lib/authorize.js');
const { HttpError } = await import('../../server/lib/utils.js');
const { AUTHORIZATION_POLICY } = await import('../../server/lib/authorization-policy.js');

// Bước 4 (vai đặc biệt 'release_coordinator') chưa có route Lát 3 thật nào khai policy — Lát 6 sẽ tự
// khai đúng resource/action của nó. Thêm 1 dòng ví dụ CHỈ để kiểm cơ chế bước 4 hoạt động đúng, không
// phải policy sản phẩm thật.
AUTHORIZATION_POLICY.release_coordinator = { force_time: { feature: null, roles: ['leader'] } };

after(() => {
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

// ── Fixture: 2 team, vài user, vài membership, vài dòng feature-visibility ──────────
function makeUser(email: string, systemRole: 'user' | 'admin' = 'user'): number {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO users (issuer, subject, email, display_name, status, system_role, created_at)
    VALUES ('test-iss', ?, ?, ?, 'active', ?, ?)
  `).run(email, email, email, systemRole, now);
  return Number(info.lastInsertRowid);
}
function makeTeam(name: string): number {
  const info = db.prepare("INSERT INTO teams (name, created_at) VALUES (?, ?)").run(name, new Date().toISOString());
  return Number(info.lastInsertRowid);
}
function addMember(teamId: number, userId: number, role: 'leader' | 'member'): void {
  db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(teamId, userId, role);
}
function setVisibility(teamId: number, feature: string, level: 'off' | 'on'): void {
  db.prepare(`
    INSERT INTO team_feature_visibility (team_id, feature, level, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(team_id, feature) DO UPDATE SET level = excluded.level
  `).run(teamId, feature, level, new Date().toISOString());
}

const teamA = makeTeam('Team A');
const teamB = makeTeam('Team B');
const adminUser = makeUser('admin@test.local', 'admin');
const leaderA = makeUser('leader-a@test.local');
const memberA = makeUser('member-a@test.local');
const memberB = makeUser('member-b@test.local');
addMember(teamA, leaderA, 'leader');
addMember(teamA, memberA, 'member');
addMember(teamB, memberB, 'member');

function actorOf(userId: number, systemRole: 'user' | 'admin', memberships: { teamId: number; role: 'leader' | 'member' }[]) {
  return { userId, systemRole, memberships };
}

// ── policyKind: 'team_feature' — route toàn cục (scope.teamId bỏ trống) ─────────────
test("team_feature, route toàn cục ('user_account.list'): Admin qua, user thường bị ROLE_FORBIDDEN", () => {
  const decision = authorize({
    actor: actorOf(adminUser, 'admin', []), policyKind: 'team_feature', resource: 'user_account', action: 'list', scope: {}
  });
  assert.equal(decision.effectiveRole, 'admin');

  assert.throws(() => authorize({
    actor: actorOf(memberA, 'user', []), policyKind: 'team_feature', resource: 'user_account', action: 'list', scope: {}
  }), (err: unknown) => err instanceof HttpError && err.code === 'ROLE_FORBIDDEN');
});

test("team_feature, resource/action chưa khai báo trong AUTHORIZATION_POLICY -> fail-closed ROLE_FORBIDDEN", () => {
  assert.throws(() => authorize({
    actor: actorOf(adminUser, 'admin', []), policyKind: 'team_feature', resource: 'khong_ton_tai', action: 'lam_gi_do', scope: {}
  }), (err: unknown) => err instanceof HttpError && err.code === 'ROLE_FORBIDDEN');
});

test("team_feature, route theo team ('team_member.list'): thành viên team đó qua, người ngoài NOT_TEAM_MEMBER", () => {
  const decision = authorize({
    actor: actorOf(memberA, 'user', [{ teamId: teamA, role: 'member' }]),
    policyKind: 'team_feature', resource: 'team_member', action: 'list', scope: { teamId: teamA }
  });
  assert.equal(decision.effectiveRole, 'member');
  assert.equal(decision.viewerTeamId, teamA);

  assert.throws(() => authorize({
    actor: actorOf(memberB, 'user', [{ teamId: teamB, role: 'member' }]),
    policyKind: 'team_feature', resource: 'team_member', action: 'list', scope: { teamId: teamA }
  }), (err: unknown) => err instanceof HttpError && err.code === 'NOT_TEAM_MEMBER');
});

test("team_feature, route theo team ('team_member.create'): Member bị ROLE_FORBIDDEN, chỉ Leader qua", () => {
  assert.throws(() => authorize({
    actor: actorOf(memberA, 'user', [{ teamId: teamA, role: 'member' }]),
    policyKind: 'team_feature', resource: 'team_member', action: 'create', scope: { teamId: teamA }
  }), (err: unknown) => err instanceof HttpError && err.code === 'ROLE_FORBIDDEN');

  const decision = authorize({
    actor: actorOf(leaderA, 'user', [{ teamId: teamA, role: 'leader' }]),
    policyKind: 'team_feature', resource: 'team_member', action: 'create', scope: { teamId: teamA }
  });
  assert.equal(decision.effectiveRole, 'leader');
});

test("team_feature, resource CÓ feature gắn (Lát 4+ sẽ khai như vậy) -> FEATURE_DISABLED khi off, qua khi on", () => {
  // Không có resource THẬT nào của Lát 3 gắn 1 trong 5 feature (tất cả feature=null ở Lát 3) — thêm 1
  // dòng policy ví dụ (mô phỏng đúng cách Lát 4 sẽ khai, vd resource 'project') để phủ được nhánh bước 1
  // (team_feature_visibility) của chính authorizeTeamFeature, không lẫn với policyKind riêng
  // 'personal_task' (có luật EXISTS-qua-nhiều-team khác hẳn, xem test riêng bên dưới).
  AUTHORIZATION_POLICY.project_example = { read: { feature: 'project', roles: ['leader', 'member'] } };
  setVisibility(teamA, 'project', 'off');
  assert.throws(() => authorize({
    actor: actorOf(memberA, 'user', [{ teamId: teamA, role: 'member' }]),
    policyKind: 'team_feature', resource: 'project_example', action: 'read', scope: { teamId: teamA }
  }), (err: unknown) => err instanceof HttpError && err.code === 'FEATURE_DISABLED');

  setVisibility(teamA, 'project', 'on');
  const decision = authorize({
    actor: actorOf(memberA, 'user', [{ teamId: teamA, role: 'member' }]),
    policyKind: 'team_feature', resource: 'project_example', action: 'read', scope: { teamId: teamA }
  });
  assert.equal(decision.effectiveRole, 'member');
});

// ── Bước 4 — vai đặc biệt 'release_coordinator' (Lát 6, chưa có route Lát 3 gọi) ────
test("team_feature, resource='release_coordinator': Leader của ĐÚNG team điều phối qua, Leader team KHÁC bị NOT_RELEASE_COORDINATOR", () => {
  db.prepare('UPDATE app_config SET release_coordinator_team_id = ? WHERE id = 1').run(teamA);

  // leaderA là Leader của teamA, và teamA CHÍNH LÀ team điều phối -> phải qua được.
  const decision = authorize({
    actor: actorOf(leaderA, 'user', [{ teamId: teamA, role: 'leader' }]),
    policyKind: 'team_feature', resource: 'release_coordinator', action: 'force_time', scope: { teamId: teamA }
  });
  assert.equal(decision.effectiveRole, 'leader');

  // Tạo 1 Leader khác cho teamB (không phải team điều phối) để test đúng vai trò leader ở team SAI.
  const leaderB = makeUser('leader-b@test.local');
  addMember(teamB, leaderB, 'leader');
  assert.throws(() => authorize({
    actor: actorOf(leaderB, 'user', [{ teamId: teamB, role: 'leader' }]),
    policyKind: 'team_feature', resource: 'release_coordinator', action: 'force_time', scope: { teamId: teamB }
  }), (err: unknown) => err instanceof HttpError && err.code === 'NOT_RELEASE_COORDINATOR');
});

// ── policyKind: 'personal_task' (FR-14/FR-31, Lát 5) ────────────────────────────────
// Lát 5: resource/action đổi sang 'personal_task'/'own' — ĐÚNG lời gọi thật của
// server/routes/tasks.ts (requireOwnPersonalTask()), khớp policy đã khai ở
// AUTHORIZATION_POLICY['personal_task']['own']. Bản trước Lát 5 dùng placeholder 'task'/'update'
// (vô hại lúc đó vì authorizePersonalTask() không tra AUTHORIZATION_POLICY) — Lát 5 tổng quát hoá
// hàm này để đọc `feature` từ policy (cho Mind Map dùng lại), nên placeholder không còn hợp lệ.
test('personal_task: chủ sở hữu thuộc team đang Bật personal_task -> qua; team đang Tắt -> FEATURE_DISABLED', () => {
  setVisibility(teamA, 'personal_task', 'on');
  const decision = authorize({
    actor: actorOf(memberA, 'user', [{ teamId: teamA, role: 'member' }]),
    policyKind: 'personal_task', resource: 'personal_task', action: 'own', scope: { ownerId: memberA }
  });
  assert.equal(decision.ownerOnly, true);

  setVisibility(teamB, 'personal_task', 'off');
  assert.throws(() => authorize({
    actor: actorOf(memberB, 'user', [{ teamId: teamB, role: 'member' }]),
    policyKind: 'personal_task', resource: 'personal_task', action: 'own', scope: { ownerId: memberB }
  }), (err: unknown) => err instanceof HttpError && err.code === 'FEATURE_DISABLED');
});

test('personal_task: không phải chủ sở hữu -> ROLE_FORBIDDEN dù team đang Bật', () => {
  assert.throws(() => authorize({
    actor: actorOf(memberA, 'user', [{ teamId: teamA, role: 'member' }]),
    policyKind: 'personal_task', resource: 'personal_task', action: 'own', scope: { ownerId: memberB }
  }), (err: unknown) => err instanceof HttpError && err.code === 'ROLE_FORBIDDEN');
});

// ── policyKind: 'cross_team_release' (FR-24, Lát 6) ─────────────────────────────────
test('cross_team_release: có ít nhất 1 team đang Bật release -> qua; không thuộc team nào Bật -> FEATURE_DISABLED', () => {
  setVisibility(teamA, 'release', 'on');
  const decision = authorize({
    actor: actorOf(memberA, 'user', [{ teamId: teamA, role: 'member' }]),
    // 'release_schedule'.'read' khai TRƯỚC cho Lát 6 ở authorization-policy.ts (chưa có route gọi) —
    // đúng tên resource CR §6.2 đã chốt cho GET /api/release/schedule-board.
    policyKind: 'cross_team_release', resource: 'release_schedule', action: 'read', scope: {}
  });
  assert.equal(decision.projection, 'schedule_board');

  setVisibility(teamB, 'release', 'off');
  assert.throws(() => authorize({
    actor: actorOf(memberB, 'user', [{ teamId: teamB, role: 'member' }]),
    policyKind: 'cross_team_release', resource: 'release_schedule', action: 'read', scope: {}
  }), (err: unknown) => err instanceof HttpError && err.code === 'FEATURE_DISABLED');
});

// ── Lát 5 (FR-32) — Mind Map dùng lại policyKind 'personal_task'/'cross_team_release' đã tổng quát
// hoá, với feature 'mind_map' thay vì 'personal_task'/'release'. Test này khoá lại đúng phần tổng
// quát hoá (đọc `feature` từ policy thay vì hardcode) không làm hỏng ý nghĩa gate của resource khác.
test("mind_map: policyKind 'personal_task' áp đúng feature 'mind_map' (không lẫn với 'personal_task')", () => {
  setVisibility(teamA, 'mind_map', 'on');
  setVisibility(teamA, 'personal_task', 'off');
  // Team đang Bật mind_map nhưng TẮT personal_task -> vẫn phải qua vì hàm tra đúng feature 'mind_map'
  // (không lẫn sang feature 'personal_task' của resource khác cùng policyKind).
  const decision = authorize({
    actor: actorOf(memberA, 'user', [{ teamId: teamA, role: 'member' }]),
    policyKind: 'personal_task', resource: 'mind_map', action: 'create', scope: { ownerId: memberA }
  });
  assert.equal(decision.ownerOnly, true);
});

test("mind_map: policyKind 'cross_team_release' áp đúng feature 'mind_map' (gate riêng, không lẫn 'release')", () => {
  setVisibility(teamA, 'mind_map', 'on');
  setVisibility(teamA, 'release', 'off');
  const decision = authorize({
    actor: actorOf(memberA, 'user', [{ teamId: teamA, role: 'member' }]),
    policyKind: 'cross_team_release', resource: 'mind_map', action: 'browse', scope: {}
  });
  assert.equal(decision.projection, 'schedule_board');

  setVisibility(teamB, 'mind_map', 'off');
  assert.throws(() => authorize({
    actor: actorOf(memberB, 'user', [{ teamId: teamB, role: 'member' }]),
    policyKind: 'cross_team_release', resource: 'mind_map', action: 'browse', scope: {}
  }), (err: unknown) => err instanceof HttpError && err.code === 'FEATURE_DISABLED');
});

// ── policyKind: 'audit' (FR-11a) ─────────────────────────────────────────────────────
test('audit: Admin luôn qua (projection metadata); Leader/Member chỉ qua khi teamId đúng team mình (projection chi tiết)', () => {
  const adminDecision = authorize({
    actor: actorOf(adminUser, 'admin', []), policyKind: 'audit', resource: 'audit_log', action: 'read', scope: {}
  });
  assert.equal(adminDecision.projection, 'admin_metadata');

  const leaderDecision = authorize({
    actor: actorOf(leaderA, 'user', [{ teamId: teamA, role: 'leader' }]),
    policyKind: 'audit', resource: 'audit_log', action: 'read', scope: { teamId: teamA }
  });
  assert.equal(leaderDecision.projection, 'team_detail');

  assert.throws(() => authorize({
    actor: actorOf(memberA, 'user', [{ teamId: teamA, role: 'member' }]),
    policyKind: 'audit', resource: 'audit_log', action: 'read', scope: {}
  }), (err: unknown) => err instanceof HttpError && err.code === 'NOT_TEAM_MEMBER');

  assert.throws(() => authorize({
    actor: actorOf(memberB, 'user', [{ teamId: teamB, role: 'member' }]),
    policyKind: 'audit', resource: 'audit_log', action: 'read', scope: { teamId: teamA }
  }), (err: unknown) => err instanceof HttpError && err.code === 'NOT_TEAM_MEMBER');
});
