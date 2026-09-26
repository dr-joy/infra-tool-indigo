// ⚠️ VÁ TẠM THỜI — XOÁ SAU KHI DÙNG XONG (2026-09-26, xem docs/exchanges/2026-09-26.md).
//
// `server/ops/slice4-migrate.ts` tự ghi rõ: "Các hàm ở đây KHÔNG được tự ý gọi nhắm vào file DB thật
// của Dev13 trong bất kỳ agent nào — người vận hành thật sẽ gọi CLI này... tự cung cấp đường dẫn +
// leaderUserId thật." Admin (Leader) không có SSH vào production để tự chạy CLI đó — 2 route dưới
// đây là kênh THAY THẾ để CHÍNH Admin tự bấm (không phải agent tự gọi), qua trình duyệt production:
//
// 1. GET /admin/legacy-data/backup — tải về bản sao DB (VACUUM INTO, an toàn ngay cả khi app đang
//    chạy), PHẢI làm trước khi chạy bước 2, vì production hiện chưa có cơ chế backup nào khác
//    (BL-20260924-001).
// 2. POST /admin/legacy-data/migrate — chạy đúng các hàm di trú đã có (ensureDev13Identity,
//    backfillDev13Scope, backfillReleasePersonalOwnership), gán dữ liệu cũ (project/task/mindmap/báo
//    cáo tuần) về team "Dev13" + gán task cá nhân/template Release cũ về CHÍNH Admin đang gọi
//    (leaderUserId = actor.userId, không nhận tham số ngoài) — không đụng PIC/assignee gốc của
//    project_task (giữ nguyên `legacy_pic_label`, không tự đoán/gán cho người khác — CR §6.3).
import { Router } from 'express';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.js';
import { dataDir } from '../paths.js';
import { requireSession, requireActiveAccount, actorFromRequest } from '../lib/auth-middleware.js';
import { authorize } from '../lib/authorize.js';
import { writeAudit } from '../lib/audit.js';
import { sendRouteError } from '../lib/utils.js';
import { createVerifiedBackup, ensureDev13Identity, backfillDev13Scope, backfillReleasePersonalOwnership } from '../ops/slice4-migrate.js';

const router = Router();

router.get('/admin/legacy-data/backup', requireSession, requireActiveAccount, async (req, res) => {
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'team', action: 'legacy_data_migration_temp', scope: {} });

  const tmpDir = join(dataDir, 'tmp-legacy-backup');
  try {
    const manifest = await createVerifiedBackup(join(dataDir, 'tasks.sqlite'), tmpDir);
    writeAudit(actor.userId, null, 'legacy_data.backup_download', 'db:tasks.sqlite', { sha256: manifest.sha256 });
    const fileBuffer = readFileSync(manifest.backupPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="tasks-backup-${Date.now()}.sqlite"`);
    res.send(fileBuffer);
    rmSync(manifest.backupPath, { force: true });
  } catch (error) {
    sendRouteError(res, error, 'Không tạo được bản backup');
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
});

router.post('/admin/legacy-data/migrate', requireSession, requireActiveAccount, (req, res) => {
  const actor = actorFromRequest(req);
  authorize({ actor, policyKind: 'team_feature', resource: 'team', action: 'legacy_data_migration_temp', scope: {} });

  try {
    mkdirSync(dataDir, { recursive: true });
    const { teamId } = ensureDev13Identity(db, actor.userId, 'Dev13');
    const scopeCounts = backfillDev13Scope(db, teamId, actor.userId);
    const releaseCounts = backfillReleasePersonalOwnership(db, actor.userId);
    writeAudit(actor.userId, teamId, 'legacy_data.migrate', `team:${teamId}`, { ...scopeCounts, ...releaseCounts });
    res.json({ ok: true, teamId, ...scopeCounts, ...releaseCounts });
  } catch (error) {
    sendRouteError(res, error, 'Không chạy được bước di trú dữ liệu cũ');
  }
});

export default router;
