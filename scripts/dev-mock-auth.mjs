// Dev-only: mô phỏng auth.drjoy.vn trên máy local để bấm tay qua UI thật cuối tuần/không cần Infra
// đăng ký redirect_uri. KHÔNG dùng cho CI/test tự động (đã có test/integration/fixtures/auth-harness.ts
// riêng, không cần server thật). Chạy: node scripts/dev-mock-auth.mjs
//
// Sau khi server này chạy, chạy app thật ở terminal khác với:
//   $env:AUTH_BASE_URL = "http://127.0.0.1:4100"
//   $env:ADMIN_BOOTSTRAP_EMAIL = "email-that-cua-anh@drjoy.jp"
//   npm start
// rồi mở http://localhost:4000, bấm đăng nhập -> rơi vào trang giả này -> gõ email -> vào app thật.
import http from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const PORT = Number(process.env.MOCK_AUTH_PORT || 4100);
const CLIENT = process.env.AUTH_CLIENT || 'indigo';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
const usersMe = new Map();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/.well-known/jwks.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
    return;
  }

  if (url.pathname === '/users/me') {
    const authz = req.headers.authorization || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    const info = usersMe.get(token);
    if (!info) { res.statusCode = 401; res.end(JSON.stringify({ error: 'invalid_token' })); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ user_id: info.email, email: info.email, name: info.name, avatar: '', provider: 'mock' }));
    return;
  }

  if (url.pathname === '/auth/google/login' && req.method === 'GET') {
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const client = url.searchParams.get('client') || '';
    const prefillEmail = process.env.ADMIN_BOOTSTRAP_EMAIL || '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><body style="font-family:sans-serif;max-width:420px;margin:60px auto">
      <h2>Mock auth.drjoy.vn (chỉ chạy local)</h2>
      <p style="color:#666">client=${escapeHtml(client)}</p>
      <form method="GET" action="/auth/google/login/submit">
        <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
        <label>Email<br/><input name="email" value="${escapeHtml(prefillEmail)}" style="width:100%;padding:6px"/></label><br/><br/>
        <label>Tên hiển thị<br/><input name="name" value="Nguoi Test" style="width:100%;padding:6px"/></label><br/><br/>
        <button type="submit" style="padding:8px 16px">Đăng nhập giả lập</button>
      </form>
    </body></html>`);
    return;
  }

  if (url.pathname === '/auth/google/login/submit' && req.method === 'GET') {
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const email = (url.searchParams.get('email') || '').trim();
    const name = url.searchParams.get('name') || email;
    if (!redirectUri || !email) { res.statusCode = 400; res.end('thiếu redirect_uri hoặc email'); return; }

    const sub = `mock-${Buffer.from(email).toString('hex').slice(0, 16)}`;
    const accessToken = await new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
      .setIssuedAt().setIssuer(`http://127.0.0.1:${PORT}`).setAudience(CLIENT)
      .setSubject(sub).setExpirationTime('1h')
      .sign(privateKey);
    usersMe.set(accessToken, { email, name });

    const target = new URL(redirectUri);
    target.searchParams.set('access_token', accessToken);
    target.searchParams.set('refresh_token', `mock-refresh-${sub}`);
    res.statusCode = 302;
    res.setHeader('Location', target.toString());
    res.end();
    return;
  }

  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-auth] dang chay tai http://127.0.0.1:${PORT}`);
  console.log(`[mock-auth] set AUTH_BASE_URL=http://127.0.0.1:${PORT} khi chay app that de dung server nay.`);
});
