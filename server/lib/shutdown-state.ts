// Cờ dùng chung: index.ts bật lên khi nhận SIGINT/SIGTERM (bắt đầu drain), app.ts đọc ở
// /health/ready để báo hạ tầng ngừng gửi traffic mới ngay lập tức (CR-20260913 FR-39/SEC-PERF-013).
export const shutdownState = { shuttingDown: false };
