import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { authConfig } from './auth-config.js';

// Verify JWT RS256 phát hành bởi auth.drjoy.vn — FR-1: tự verify chữ ký tại chỗ qua JWKS, không gọi
// lại auth.drjoy.vn mỗi lần dùng token.
//
// `createRemoteJWKSet` tự cache theo `kid` và tự làm mới cache khi gặp `kid` lạ (xoay khoá) — không tự
// viết cơ chế cache riêng (jose@6.2.12, xác nhận qua npm view — xem docs/exchanges/2026-09-21.md).
const jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', authConfig.baseUrl));

export interface AuthJwtClaims extends JWTPayload {
  sub: string;
  iss: string;
  email: string;
}

export class JwtVerifyError extends Error {}

// Ràng buộc CHẶT issuer/audience/algorithm — theo đúng rủi ro Codex nêu (không chỉ tin JWKS ký đúng
// là đủ, phải khớp cả issuer/audience). `audience` mặc định bằng client id "indigo" — GIẢ ĐỊNH chưa
// xác nhận trực tiếp bằng một JWT thật (auth.drjoy.vn chưa cấp được token thử qua flow thật lúc thiết
// kế); có thể ghi đè bằng AUTH_EXPECTED_AUDIENCE nếu JWT thật cho giá trị khác — cần xác nhận lại ở lần
// đăng nhập thật đầu tiên trên môi trường dev trước khi coi là chốt.
const expectedAudience = process.env.AUTH_EXPECTED_AUDIENCE || authConfig.client;

export async function verifyAuthJwt(token: string): Promise<AuthJwtClaims> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: authConfig.baseUrl,
      audience: expectedAudience,
      algorithms: ['RS256']
    });
    if (typeof payload.sub !== 'string' || typeof payload.iss !== 'string' || typeof payload.email !== 'string') {
      throw new JwtVerifyError('JWT thiếu claim sub/iss/email bắt buộc');
    }
    return payload as AuthJwtClaims;
  } catch (error) {
    if (error instanceof JwtVerifyError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new JwtVerifyError(`Xác minh JWT thất bại: ${message}`);
  }
}
