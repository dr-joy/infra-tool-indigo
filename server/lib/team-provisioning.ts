import type { DatabaseSync } from 'node:sqlite';
import { seedWeeklyReportKindsForTeam } from '../db-seed.js';

// Tách khỏi server/routes/teams.ts (POST /admin/teams) — 2 nơi cần đúng logic seed này: route Admin tạo
// team (đã có từ Lát 3) và nhánh Admin bootstrap tự lập team đầu tiên khi hệ thống chưa có team nào
// (server/routes/onboarding.ts, 2026-09-25 — xem docs/exchanges/2026-09-25.md). Giữ NGUYÊN VĂN hành vi
// cũ: 5 dòng feature-visibility off, 1 project hệ thống "Khác", 2 loại báo cáo tuần mặc định — không
// đổi gì, chỉ đổi chỗ ở. Phải gọi bên trong `withTransaction()` của caller (không tự mở transaction ở
// đây) vì INSERT team ở đây thường đi kèm 1 INSERT khác (audit, hoặc team_members) trong cùng 1 giao dịch.
const FEATURES = ['personal_task', 'project', 'weekly_report', 'release', 'mind_map'] as const;

export function provisionTeam(db: DatabaseSync, name: string, description: string | null, now: string): number {
  const result = db.prepare('INSERT INTO teams (name, description, created_at) VALUES (?, ?, ?)')
    .run(name, description, now);
  const id = Number(result.lastInsertRowid);
  const insertVisibility = db.prepare(`
    INSERT INTO team_feature_visibility (team_id, feature, level, updated_at) VALUES (?, ?, 'off', ?)
  `);
  for (const feature of FEATURES) insertVisibility.run(id, feature, now);
  db.prepare(`
    INSERT INTO projects (ten_project, pic, team_id, ngay_bat_dau, sort_order, is_system, created_at, updated_at)
    VALUES ('Khác', '', ?, ?, 1, 1, ?, ?)
  `).run(id, now.slice(0, 10), now, now);
  seedWeeklyReportKindsForTeam(db, id, now);
  return id;
}
