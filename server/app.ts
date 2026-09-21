// Cấu hình Express app (middleware + routers + static + error handler).
// Tách khỏi index.ts để test tích hợp import được `app` mà KHÔNG tự listen/mở browser.
// index.ts chỉ lo phần listen + side-effect (mở Chrome, xử lý tín hiệu process).

import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { appBaseDir, dataDir } from './paths.js';
import { sendRouteError } from './lib/utils.js';
import { shutdownState } from './lib/shutdown-state.js';
import { db } from './db.js';
import tasksRouter from './routes/tasks.js';
import projectsRouter from './routes/projects.js';
import releaseRouter from './routes/release.js';
import schedulesRouter from './routes/schedules.js';
import weeklyRouter from './routes/weekly.js';
import picsRouter from './routes/pics.js';
import deThiRouter from './routes/de-thi.js';
import redmineRouter from './routes/redmine.js';
import mindmapsRouter from './routes/mindmaps.js';
import authRouter from './routes/auth.js';
import onboardingRouter from './routes/onboarding.js';
import notificationsRouter from './routes/notifications.js';
import teamsRouter from './routes/teams.js';
import adminConfigRouter from './routes/admin-config.js';
import auditRouter from './routes/audit.js';

export const app = express();

// Không lộ Express qua header (giảm fingerprint).
app.disable('x-powered-by');

// Header bảo mật cơ bản (không dùng helmet để tránh CSP chặn inline script/style
// của bản Vite build và tránh thêm dependency phải bundle vào SEA).
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Health check (CR-20260913 FR-39) — đặt TRƯỚC mọi middleware khác, không phụ thuộc CORS/body-parser,
// để hạ tầng probe được ngay cả khi các lớp sau có vấn đề. Không cần auth (đọc §12 an toàn: không lộ
// thông tin nhạy cảm, chỉ true/false).
app.get('/health/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});
app.get('/health/ready', (_req: Request, res: Response) => {
  if (shutdownState.shuttingDown) {
    return res.status(503).json({ status: 'not_ready', reason: 'shutting_down' });
  }
  try {
    db.prepare('SELECT 1').get();
    fs.accessSync(dataDir, fs.constants.W_OK);
    res.status(200).json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', reason: err instanceof Error ? err.message : 'unknown' });
  }
});

app.use(cors({ origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ }));
// Giới hạn kích thước body: nới rộng để import/export ngân hàng câu hỏi JSON lớn không bị chặn.
app.use(express.json({ limit: '32mb' }));

app.use('/api', tasksRouter);
app.use('/api', projectsRouter);
app.use('/api', releaseRouter);
app.use('/api', schedulesRouter);
app.use('/api', weeklyRouter);
app.use('/api', picsRouter);
app.use('/api', deThiRouter);
app.use('/api', redmineRouter);
app.use('/api', mindmapsRouter);
app.use('/api', authRouter);
app.use('/api', onboardingRouter);
app.use('/api', notificationsRouter);
app.use('/api', teamsRouter);
app.use('/api', adminConfigRouter);
app.use('/api', auditRouter);

// Phục vụ giao diện đã build (chế độ chạy app 1 tiến trình).
// Chỉ bật khi đã có thư mục dist (đã chạy `npm run build`).
const clientDist = path.join(appBaseDir, 'dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  // SPA fallback: mọi đường dẫn GET không phải /api đều trả về index.html
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    } else {
      next();
    }
  });
}

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  // HttpError -> đúng status + message (an toàn); lỗi khác -> log + 500 generic
  // (không lộ stack/SQL). Dùng chung sendRouteError để mọi route throw HttpError
  // (kèm asyncHandler) đều ra kết quả nhất quán.
  if (res.headersSent) return next(err);
  sendRouteError(res, err, 'Lỗi server nội bộ');
});
