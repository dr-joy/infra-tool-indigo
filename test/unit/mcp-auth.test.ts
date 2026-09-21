
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinhTrangThaiAuthMcp } from '../../server/lib/mcp-auth.js';

const CACHE_THAT = {
  'claude.ai Zoom for Claude': {}, 'claude.ai Indeed': {}, 'drjoy': {}, 'claude.ai freee': {}
};

test('BUG-20260808: mcpOAuth RỖNG + cache còn khoá `drjoy` cũ -> KHÔNG được báo cần auth', () => {
  const t = tinhTrangThaiAuthMcp({ oauth: {}, needsAuthCache: CACHE_THAT });
  assert.equal(t.needsAuth, false, 'không có bằng chứng gì mà vẫn báo động = banner nói dối');
  assert.equal(t.khongXacDinh, true, 'phải nói rõ là KHÔNG xác định được, thay vì khẳng định chưa auth');
  assert.equal(t.authed, null, 'không kết luận được thì đừng kết luận');
});

test('không có file nào đọc được -> cũng là không xác định, không báo động', () => {
  const t = tinhTrangThaiAuthMcp({ oauth: null, needsAuthCache: null });
  assert.equal(t.needsAuth, false);
  assert.equal(t.khongXacDinh, true);
});


test('có bản ghi nhưng KHÔNG có accessToken -> đúng là chưa auth, phải báo', () => {
  const t = tinhTrangThaiAuthMcp({ oauth: { drjoy: { refreshToken: 'r' } }, needsAuthCache: {} });
  assert.equal(t.needsAuth, true);
  assert.equal(t.khongXacDinh, false);
  assert.equal(t.authed, false);
});

test('có token + CLI flag cần auth + KHÔNG còn refresh -> phải báo (CLI không tự làm mới được)', () => {
  const t = tinhTrangThaiAuthMcp({ oauth: { drjoy: { accessToken: 'a' } }, needsAuthCache: CACHE_THAT });
  assert.equal(t.needsAuth, true);
});

test('có token + refresh, dù CLI có flag -> KHÔNG báo (CLI tự refresh được)', () => {
  const t = tinhTrangThaiAuthMcp({
    oauth: { drjoy: { accessToken: 'a', refreshToken: 'r' } }, needsAuthCache: CACHE_THAT
  });
  assert.equal(t.needsAuth, false);
  assert.equal(t.authed, true);
  assert.equal(t.khongXacDinh, false);
});


test('nhận diện được khoá dạng connector claude.ai, không chỉ mỗi `drjoy`', () => {
  const t = tinhTrangThaiAuthMcp({
    oauth: { 'claude.ai Dr.JOY MCP': { accessToken: 'a', refreshToken: 'r' } }, needsAuthCache: {}
  });
  assert.equal(t.hasToken, true, 'bỏ sót tên connector mới = tưởng chưa auth dù đã auth');
});

test('nhận diện được khoá dạng `drjoy|<hash>`', () => {
  const t = tinhTrangThaiAuthMcp({
    oauth: { 'drjoy|abc123': { accessToken: 'a' } }, needsAuthCache: {}
  });
  assert.equal(t.hasToken, true);
});

test('secondsLeft tính từ `now` bơm vào, không phụ thuộc đồng hồ lúc chạy test', () => {
  const now = 1_000_000_000_000;
  const t = tinhTrangThaiAuthMcp({
    oauth: { drjoy: { accessToken: 'a', refreshToken: 'r', expiresAt: now + 3600_000 } },
    needsAuthCache: {}, now
  });
  assert.equal(t.secondsLeft, 3600);
});
