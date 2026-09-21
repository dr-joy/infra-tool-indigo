// verifyAuthJwt (server/lib/jwks-client.ts) — CR-20260913 FR-1: JWT RS256 phát hành bởi auth.drjoy.vn,
// tự verify tại chỗ qua JWKS. Kiểm thử đúng rủi ro Codex nêu lúc thiết kế (docs/exchanges/2026-09-21.md):
// ràng buộc issuer/audience/algorithm, không chỉ tin chữ ký đúng là đủ; JWKS nhiều khoá (xoay kid).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPair, exportJWK, SignJWT, generateSecret } from 'jose';
import type { KeyLike } from 'jose';

const AUDIENCE = 'test-client';

// CHẠY Ở TOP-LEVEL (top-level await), KHÔNG bọc trong before(): before() chỉ ĐĂNG KÝ hook, chạy sau
// khi toàn bộ phần còn lại của module (kể cả dynamic import bên dưới) đã eval xong — dùng before() ở
// đây sẽ khiến jwks-client.ts đọc authConfig.baseUrl lúc AUTH_BASE_URL CHƯA được set, tự rơi về default
// https://auth.drjoy.vn thật (đã tự bắt lỗi này khi thấy verify test gọi thật ra ngoài internet).
const key1 = await generateKeyPair('RS256');
const key2 = await generateKeyPair('RS256');
const jwk1 = { ...(await exportJWK(key1.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
const jwk2 = { ...(await exportJWK(key2.publicKey)), kid: 'kid-2', alg: 'RS256', use: 'sig' };
// Cả 2 khoá có mặt từ đầu -> đúng cửa sổ chuyển tiếp thật lúc xoay khoá (JWKS công ty vẫn phục vụ
// khoá cũ song song khoá mới, không đổi phựt một lần).
const jwksBody: { keys: unknown[] } = { keys: [jwk1, jwk2] };

const server = http.createServer((req, res) => {
  if (req.url === '/.well-known/jwks.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(jwksBody));
    return;
  }
  res.statusCode = 404;
  res.end();
});
const baseUrl = await new Promise<string>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    resolve(`http://127.0.0.1:${port}`);
  });
});
process.env.AUTH_BASE_URL = baseUrl;
process.env.AUTH_CLIENT = AUDIENCE;

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Import SAU khi đã set AUTH_BASE_URL -> module đọc authConfig.baseUrl đúng 1 lần lúc load để dựng
// createRemoteJWKSet, không đoán được URL nào nếu import trước.
const { verifyAuthJwt, JwtVerifyError } = await import('../../server/lib/jwks-client.js');

function baseClaims() {
  return { email: 'a@b.com' };
}

async function signValid(key: KeyLike, kid: string, overrides: Record<string, unknown> = {}) {
  return new SignJWT({ ...baseClaims(), ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setIssuer(baseUrl)
    .setAudience(AUDIENCE)
    .setSubject('user-1')
    .setExpirationTime('1h')
    .sign(key);
}

test('token hợp lệ, ký bởi khoá đầu tiên trong JWKS -> verify thành công, claim đúng', async () => {
  const token = await signValid(key1.privateKey, 'kid-1');
  const claims = await verifyAuthJwt(token);
  assert.equal(claims.sub, 'user-1');
  assert.equal(claims.iss, baseUrl);
  assert.equal(claims.email, 'a@b.com');
});

test('token hợp lệ, ký bởi khoá THỨ HAI (xoay kid) -> vẫn verify được vì JWKS phục vụ cả 2 khoá', async () => {
  const token = await signValid(key2.privateKey, 'kid-2');
  const claims = await verifyAuthJwt(token);
  assert.equal(claims.sub, 'user-1');
});

test('kid không tồn tại trong JWKS (chưa từng công bố) -> fail-closed, không crash', async () => {
  const token = await signValid(key1.privateKey, 'kid-never-published');
  await assert.rejects(() => verifyAuthJwt(token), JwtVerifyError);
});

test('issuer sai -> từ chối dù chữ ký đúng', async () => {
  const token = await new SignJWT(baseClaims())
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuedAt()
    .setIssuer('https://evil.example.com')
    .setAudience(AUDIENCE)
    .setSubject('user-1')
    .setExpirationTime('1h')
    .sign(key1.privateKey);
  await assert.rejects(() => verifyAuthJwt(token), JwtVerifyError);
});

test('audience sai -> từ chối dù chữ ký đúng', async () => {
  const token = await new SignJWT(baseClaims())
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuedAt()
    .setIssuer(baseUrl)
    .setAudience('mot-app-khac')
    .setSubject('user-1')
    .setExpirationTime('1h')
    .sign(key1.privateKey);
  await assert.rejects(() => verifyAuthJwt(token), JwtVerifyError);
});

test('token đã hết hạn -> từ chối', async () => {
  const token = await new SignJWT(baseClaims())
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setIssuer(baseUrl)
    .setAudience(AUDIENCE)
    .setSubject('user-1')
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(key1.privateKey);
  await assert.rejects(() => verifyAuthJwt(token), JwtVerifyError);
});

test('thuật toán HS256 (không phải RS256) -> từ chối ngay, không được tin JWKS phía RS256', async () => {
  const secret = await generateSecret('HS256');
  const token = await new SignJWT(baseClaims())
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(baseUrl)
    .setAudience(AUDIENCE)
    .setSubject('user-1')
    .setExpirationTime('1h')
    .sign(secret);
  await assert.rejects(() => verifyAuthJwt(token), JwtVerifyError);
});

test('chữ ký bị giả mạo (lật 1 bit ở byte GIỮA phần signature) -> từ chối', async () => {
  const token = await signValid(key1.privateKey, 'kid-1');
  const parts = token.split('.');
  // Lật bit ở byte giữa (không phải byte cuối) -> tránh đúng nhóm base64 cuối của chữ ký RS256
  // (256 byte, 256 mod 3 = 1) có vài bit đệm không mang nghĩa, đổi ký tự cuối có thể trùng giá trị
  // giải mã ra và làm test chập chờn (đã tự bắt được lúc chạy thật, không phải suy diễn).
  const sigBytes = Buffer.from(parts[2], 'base64url');
  const midIndex = Math.floor(sigBytes.length / 2);
  sigBytes[midIndex] ^= 0xff;
  parts[2] = sigBytes.toString('base64url');
  await assert.rejects(() => verifyAuthJwt(parts.join('.')), JwtVerifyError);
});
