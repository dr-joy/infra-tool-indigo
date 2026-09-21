import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Test frontend (React) chạy trên jsdom. Chỉ quét test trong src/ để không đụng
// tới test backend (chạy bằng node:test qua tsx — xem script "test:server").
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/client/setup.ts'],
    include: ['test/client/**/*.test.{ts,tsx}'],
    css: false
  }
});
