import { db } from '../db.js';

// FR-11a/FR-19 — payload luôn ghi ĐẦY ĐỦ (không tóm tắt), lọc field cho projection Admin/Leader+Member
// làm ở tầng đọc (authorize.ts's authorizeAudit + route GET /api/audit), không tách 2 bảng.
export function writeAudit(actorUserId: number, teamId: number | null, action: string, target: string, payload: unknown): void {
  db.prepare(`
    INSERT INTO audit_log (actor_user_id, team_id, action, target, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)
  `).run(actorUserId, teamId, action, target, JSON.stringify(payload ?? {}), new Date().toISOString());
}
