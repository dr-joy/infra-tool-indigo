// Harness dùng chung cho test tích hợp cần đăng nhập thật (CR-20260913 Lát 2/3/4) — giả lập
// auth.drjoy.vn (JWKS + /auth/token/exchange + /users/me) y hệt boilerplate đã có ở
// test/integration/teams.test.ts/auth.test.ts. Tách ra đây để các file test route project/task/weekly
// (Lát 4 — giờ đòi hỏi phiên đăng nhập thật) không phải chép lại ~80 dòng cho mỗi file.
//
// LƯU Ý bắt buộc: phải gọi `createMockAuthServer()` rồi set các biến môi trường AUTH_*/APPDATA
// TRƯỚC khi `await import('../../server/app.js')` — server/lib/auth-config.ts đọc process.env một lần
// lúc module được nạp, set env sau khi đã import sẽ không có tác dụng (đúng cách teams.test.ts đã làm).
import http from 'node:http';
import type { Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { parse as parseCookie } from 'cookie';

export interface MockAuthServer {
  authServer: Server;
  authBaseUrl: string;
  issueAuthCode(email: string, name: string, subOverride?: string): Promise<string>;
  close(): Promise<void>;
}

// Dựng 1 server giả đóng vai auth.drjoy.vn thật: JWKS (RS256), /auth/token/exchange (đổi code lấy
// access_token JWT tự ký + refresh_token giả), /users/me (trả email/tên đã "issue" cho đúng token đó).
// `fixedPort` (mặc định: OS tự cấp, cổng ngẫu nhiên) — chỉ dùng khi test cần `authBaseUrl` (issuer)
// ỔN ĐỊNH giữa nhiều lần khởi động tiến trình con riêng biệt (vd redmine-secret-key-child.mjs, xem
// comment ở đó) — vì (issuer, subject) là khoá định danh user thật, cổng đổi giữa 2 lần chạy sẽ tạo
// ra 2 "issuer" khác nhau, tức 2 user khác nhau trong DB, dù cùng subject/email.
export async function createMockAuthServer(fixedPort?: number): Promise<MockAuthServer> {
  const keyPair = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
  const jwksBody = { keys: [jwk] };
  const pendingCodes = new Map<string, { accessToken: string; refreshToken: string }>();
  const usersMeByToken = new Map<string, { email: string; name: string; avatar: string }>();
  let subjectCounter = 0;

  const authServer: Server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://internal');
    if (url.pathname === '/.well-known/jwks.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(jwksBody));
      return;
    }
    if (url.pathname === '/auth/token/exchange' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { code?: string };
      const entry = body.code ? pendingCodes.get(body.code) : undefined;
      if (!entry) { res.statusCode = 400; res.end(JSON.stringify({ error: 'invalid_code' })); return; }
      pendingCodes.delete(body.code!);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ access_token: entry.accessToken, refresh_token: entry.refreshToken }));
      return;
    }
    if (url.pathname === '/users/me' && req.method === 'GET') {
      const authz = req.headers.authorization || '';
      const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
      const info = usersMeByToken.get(token);
      if (!info) { res.statusCode = 401; res.end(JSON.stringify({ error: 'invalid_token' })); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ user_id: '1', email: info.email, name: info.name, avatar: info.avatar, provider: 'google' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const authBaseUrl = await new Promise<string>((resolve) => {
    authServer.listen(fixedPort ?? 0, '127.0.0.1', () => {
      const addr = authServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  async function issueAuthCode(email: string, name: string, subOverride?: string): Promise<string> {
    subjectCounter += 1;
    const sub = subOverride || `sub-${subjectCounter}`;
    const accessToken = await new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
      .setIssuedAt().setIssuer(authBaseUrl).setAudience('indigo').setSubject(sub).setExpirationTime('1h')
      .sign(keyPair.privateKey);
    usersMeByToken.set(accessToken, { email, name, avatar: '' });
    const code = `code-${sub}-${Math.random().toString(36).slice(2)}`;
    pendingCodes.set(code, { accessToken, refreshToken: `refresh-${sub}` });
    return code;
  }

  return {
    authServer,
    authBaseUrl,
    issueAuthCode,
    close: () => new Promise<void>((resolve) => authServer.close(() => resolve())),
  };
}

export interface LoginFlow {
  startLogin(): Promise<string>;
  loginAs(email: string, name: string, subOverride?: string): Promise<string>;
  H(session: string): Record<string, string>;
}

// `getBase` là hàm (không phải giá trị) vì `base` (URL server app thật) chỉ biết được SAU khi
// app.listen() chạy xong — các file test dựng theo đúng thứ tự: mock auth server -> set env -> import
// app -> app.listen() -> mới gọi loginFlow(() => base, issueAuthCode).
export function loginFlow(getBase: () => string, issueAuthCode: MockAuthServer['issueAuthCode']): LoginFlow {
  async function startLogin(): Promise<string> {
    const res = await fetch(`${getBase()}/api/auth/login`, { redirect: 'manual' });
    const nonce = parseCookie(res.headers.get('set-cookie') || '')['login_nonce'];
    if (!nonce) throw new Error('startLogin(): không nhận được cookie login_nonce');
    return nonce;
  }
  async function loginAs(email: string, name: string, subOverride?: string): Promise<string> {
    const nonce = await startLogin();
    const code = await issueAuthCode(email, name, subOverride);
    const res = await fetch(`${getBase()}/api/auth/callback?code=${code}`, { redirect: 'manual', headers: { Cookie: `login_nonce=${nonce}` } });
    const sessionCookie = parseCookie(res.headers.get('set-cookie') || '')['__Host-tm_session'];
    if (!sessionCookie) throw new Error(`loginAs(): đăng nhập thất bại cho ${email}`);
    return sessionCookie;
  }
  function H(session: string): Record<string, string> {
    return { Cookie: `__Host-tm_session=${session}`, 'Content-Type': 'application/json' };
  }
  return { startLogin, loginAs, H };
}

// Tiện ích chung: đăng nhập + tạo team qua Admin + xin tham gia + duyệt — dùng lại đúng luồng onboarding
// thật (join-request -> admin duyệt) để test route Lát 4 có sẵn actor thuộc đúng team/vai trò cần.
export interface OnboardedActor {
  session: string;
  userId: number;
}

export function makeOnboardingHelpers(getBase: () => string, flow: LoginFlow) {
  async function makeTeam(adminSession: string, name: string): Promise<number> {
    const res = await fetch(`${getBase()}/api/admin/teams`, { method: 'POST', headers: flow.H(adminSession), body: JSON.stringify({ name }) });
    const body = await res.json() as { id: number; message?: string };
    if (!res.ok) throw new Error(`makeTeam(${name}) thất bại: ${body.message || res.status}`);
    return body.id;
  }

  async function setFeatureVisibility(adminSession: string, teamId: number, feature: string, level: 'on' | 'off'): Promise<void> {
    // row_version bắt buộc đúng giá trị hiện tại (VERSION_CONFLICT nếu thiếu/sai) — đọc lại trước khi
    // sửa thay vì đoán "luôn là 1" (team có thể đã bị sửa trước đó trong cùng test).
    const list = await (await fetch(`${getBase()}/api/admin/feature-visibility`, { headers: flow.H(adminSession) })).json() as
      { visibility: { team_id: number; feature: string; row_version: number }[] };
    const current = list.visibility.find((v) => v.team_id === teamId && v.feature === feature);
    if (!current) throw new Error(`setFeatureVisibility(${feature}): không tìm thấy dòng visibility cho team ${teamId}`);
    const res = await fetch(`${getBase()}/api/admin/feature-visibility`, {
      method: 'PATCH', headers: flow.H(adminSession), body: JSON.stringify({ teamId, feature, level, rowVersion: current.row_version })
    });
    if (!res.ok) throw new Error(`setFeatureVisibility(${feature}=${level}) thất bại: ${res.status}`);
  }

  // `subOverride` — mặc định để trống (mỗi lần gọi tự tăng số đếm nội bộ của mock auth server, đủ
  // dùng cho hầu hết test). Chỉ cần truyền tường minh khi test cần danh tính (issuer, subject) ỔN
  // ĐỊNH xuyên suốt NHIỀU tiến trình con riêng biệt (vd redmine-secret-key-child.mjs) — số đếm mặc
  // định KHÔNG ổn định giữa các tiến trình vì mỗi tiến trình có mock auth server + số đếm riêng.
  async function joinAndApprove(email: string, name: string, teamId: number, role: 'leader' | 'member', adminSession: string, subOverride?: string): Promise<OnboardedActor> {
    const session = await flow.loginAs(email, name, subOverride);
    const me = await (await fetch(`${getBase()}/api/auth/me`, { headers: flow.H(session) })).json() as { user: { id: number } };
    await fetch(`${getBase()}/api/onboarding/join-request`, { method: 'POST', headers: flow.H(session), body: JSON.stringify({ teamId, role }) });
    const list = await (await fetch(`${getBase()}/api/admin/join-requests`, { headers: flow.H(adminSession) })).json() as { joinRequests: { id: number; user_id: number; row_version: number }[] };
    const jr = list.joinRequests.find((r) => r.user_id === me.user.id);
    if (!jr) throw new Error(`joinAndApprove(${email}): không tìm thấy đơn vừa gửi`);
    const approveRes = await fetch(`${getBase()}/api/admin/join-requests/${jr.id}/approve`, { method: 'POST', headers: flow.H(adminSession), body: JSON.stringify({ rowVersion: jr.row_version }) });
    if (!approveRes.ok) throw new Error(`joinAndApprove(${email}): duyệt đơn thất bại (${approveRes.status})`);
    return { session, userId: me.user.id };
  }

  return { makeTeam, setFeatureVisibility, joinAndApprove };
}
