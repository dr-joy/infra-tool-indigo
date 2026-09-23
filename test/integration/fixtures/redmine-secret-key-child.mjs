// Fixture chạy trong tiến trình CON riêng (không phải qua node:test) — cần thiết vì bug bị test
// (server/lib/secret.ts: masterKey cache theo module, chỉ đọc lại file lúc IMPORT ĐẦU TIÊN của
// tiến trình) chỉ tái hiện được khi mất secret.key GIỮA 2 LẦN KHỞI ĐỘNG tiến trình thật — không thể
// tái hiện trong cùng 1 process của node:test vì module đã cache masterKey trong bộ nhớ.
//
// Lát 5 (FR-33): route cũ /api/redmine/config (không auth, khoá dùng chung) đã tách thành
// GET|PUT /api/me/redmine (khoá cá nhân, cần đăng nhập) + PUT /api/admin/redmine-url (URL hệ thống,
// chỉ Admin) — fixture phải tự đăng nhập (Admin để set URL, 1 user thường để set/get khoá của mình)
// bằng đúng harness OIDC giả test/integration/fixtures/auth-harness.ts đã dùng cho các test khác.
// Dùng: node --import tsx redmine-secret-key-child.mjs <tmpAppDataDir> <set|get>
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , tmpAppData, action] = process.argv;
process.env.APPDATA = tmpAppData;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createMockAuthServer, loginFlow, makeOnboardingHelpers } = await import(
  `file://${path.join(repoRoot, 'test', 'integration', 'fixtures', 'auth-harness.js')}`
);

const ADMIN_EMAIL = 'admin@drjoy.jp';
// CỐ Ý dùng CỔNG CỐ ĐỊNH cho mock auth server (khác `createMockAuthServer()` mặc định — cổng ngẫu
// nhiên OS cấp): danh tính user (issuer, subject) phải GIỐNG HỆT nhau giữa 2 lần chạy tiến trình con
// riêng biệt (set rồi get) để cùng trỏ về đúng 1 user_id trong DB (issuer = authBaseUrl bao gồm cổng).
// Cổng ngẫu nhiên mỗi lần listen(0) sẽ tạo 2 "issuer" khác nhau -> 2 user khác nhau -> test sai ý
// nghĩa (khoá lưu ở lần 'set' sẽ thuộc user KHÁC với user đọc lại ở lần 'get').
const FIXED_AUTH_PORT = 48231;
const mockAuth = await createMockAuthServer(FIXED_AUTH_PORT);
process.env.AUTH_BASE_URL = mockAuth.authBaseUrl;
process.env.AUTH_CLIENT = 'indigo';
process.env.APP_CALLBACK_URL = 'http://127.0.0.1:0/api/auth/callback';
process.env.ADMIN_BOOTSTRAP_EMAIL = ADMIN_EMAIL;

const { app } = await import(`file://${path.join(repoRoot, 'server', 'app.js')}`);

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.on('listening', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const flow = loginFlow(() => base, mockAuth.issueAuthCode);
const onboarding = makeOnboardingHelpers(() => base, flow);

// Subject CỐ ĐỊNH cho member — bắt buộc GIỐNG HỆT giữa lần 'set' và lần 'get' (2 tiến trình riêng
// biệt) để cùng trỏ về đúng 1 user_id (issuer+subject là khoá định danh user thật, xem auth.ts).
const MEMBER_SUB = 'redmine-itest-member-sub';
const MEMBER_EMAIL = 'redmine-itest-user@drjoy.jp';

try {
  if (action === 'set') {
    // Lần đầu: cần Admin để tạo team + duyệt đơn tham gia + cấu hình URL hệ thống.
    const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'redmine-itest-admin-sub');
    const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Redmine');
    const member = await onboarding.joinAndApprove(MEMBER_EMAIL, 'User Thật', teamId, 'member', adminSession, MEMBER_SUB);
    const memberHeaders = flow.H(member.session);

    const urlRes = await fetch(`${base}/api/admin/redmine-url`, {
      method: 'PUT', headers: flow.H(adminSession),
      body: JSON.stringify({ baseUrl: 'https://redmine.example.com' })
    });
    if (!urlRes.ok) throw new Error(`set admin url thất bại: ${urlRes.status} ${await urlRes.text()}`);

    const keyRes = await fetch(`${base}/api/me/redmine`, {
      method: 'PUT', headers: memberHeaders,
      body: JSON.stringify({ apiKey: 'super-secret-key-123' })
    });
    process.stdout.write(JSON.stringify({ status: keyRes.status, body: await keyRes.json() }));
  } else {
    // Lần 2 (tiến trình MỚI, cùng DB tmpAppData): user đã active từ lần 'set' — chỉ cần đăng nhập
    // lại (issuer+subject giống hệt -> cùng user_id), không tạo team/join-request lại (đã tồn tại).
    const memberSession = await flow.loginAs(MEMBER_EMAIL, 'User Thật', MEMBER_SUB);
    const res = await fetch(`${base}/api/me/redmine`, { headers: flow.H(memberSession) });
    process.stdout.write(JSON.stringify({ status: res.status, body: await res.json() }));
  }
} finally {
  server.close();
  await mockAuth.close();
}
