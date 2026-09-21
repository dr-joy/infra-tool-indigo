// Setup chung cho test frontend (jsdom).
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Dọn DOM sau mỗi test để các render không rò rỉ sang nhau.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom thiếu vài API trình duyệt mà app dùng -> stub tối thiểu.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async () => {}, readText: async () => '' },
    configurable: true
  });
}

// Mặc định fetch trả rỗng để component mount không nổ khi gọi API lúc khởi tạo.
// Test nào cần dữ liệu cụ thể thì tự mock lại global.fetch.
if (!globalThis.fetch) {
  globalThis.fetch = (async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
}
