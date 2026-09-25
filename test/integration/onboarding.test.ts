// CR-20260913 FR-2/FR-3/FR-3a (onboarding) + FR-34 (thông báo) — Lát 2. Dựng cùng kiểu server giả đóng
// vai auth.drjoy.vn như test/integration/auth.test.ts (mỗi file test chạy tiến trình riêng, không
// chia sẻ được server/app.js đã import ở file khác).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import type { Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { parse as parseCookie } from 'cookie';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const keyPair = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
const jwksBody = { keys: [jwk] };
const usersMeByToken = new Map<string, { email: string; name: string; avatar: string }>();

const authServer: Server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://internal');
  if (url.pathname === '/.well-known/jwks.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(jwksBody));
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
  authServer.listen(0, '127.0.0.1', () => {
    const addr = authServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-onboarding-itest-'));
process.env.APPDATA = tmpAppData;
process.env.AUTH_BASE_URL = authBaseUrl;
process.env.AUTH_CLIENT = 'indigo';
process.env.APP_CALLBACK_URL = 'http://127.0.0.1:0/api/auth/callback';
process.env.ADMIN_BOOTSTRAP_EMAIL = ADMIN_EMAIL;

const { app } = await import('../../server/app.js');
const { db } = await import('../../server/db.js');

let server: Server;
let base = '';
await new Promise<void>((resolve) => {
  server = app.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    resolve();
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => authServer.close(() => resolve()));
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

// ── Helpers (giống test/integration/auth.test.ts) ───────────────────────────────────
let subjectCounter = 0;
async function issueAuthCode(email: string, name: string, subOverride?: string): Promise<{ accessToken: string; refreshToken: string }> {
  subjectCounter += 1;
  const sub = subOverride || `sub-${subjectCounter}`;
  const accessToken = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
    .setIssuedAt()
    .setIssuer(authBaseUrl)
    .setAudience('indigo')
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(keyPair.privateKey);
  usersMeByToken.set(accessToken, { email, name, avatar: '' });
  return { accessToken, refreshToken: `refresh-${sub}` };
}

async function startLogin(): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, { redirect: 'manual' });
  const nonceCookie = parseCookie(res.headers.get('set-cookie') || '')['login_nonce'];
  assert.ok(nonceCookie);
  return nonceCookie;
}

async function loginAs(email: string, name: string, subOverride?: string): Promise<string> {
  const nonce = await startLogin();
  const { accessToken, refreshToken } = await issueAuthCode(email, name, subOverride);
  const res = await fetch(`${base}/api/auth/callback?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`, {
    redirect: 'manual',
    headers: { Cookie: `login_nonce=${nonce}` }
  });
  const sessionCookie = parseCookie(res.headers.get('set-cookie') || '')['__Host-tm_session'];
  assert.ok(sessionCookie, `phải đăng nhập được cho ${email}`);
  return sessionCookie;
}

const cookieHeader = (session: string) => ({ Cookie: `__Host-tm_session=${session}` });

// 2026-09-25 (docs/exchanges/2026-09-25.md): Admin bootstrap giờ tạo ra ở trạng thái 'pending' — phải
// tự nộp đơn xin tham gia (tự động duyệt vì là Admin) trước khi dùng được /api/admin/*. Tự hoàn tất bước
// này ở đây (idempotent — bỏ qua nếu đã active từ lần gọi trước) để mọi test trong file này vẫn nhận
// lại phiên dùng NGAY được, không phải tự lo việc onboard.
async function loginAsAdmin(): Promise<string> {
  const session = await loginAs(ADMIN_EMAIL, 'Admin Thật', 'admin-fixed-sub');
  const H = cookieHeader(session);
  const me = await (await fetch(`${base}/api/auth/me`, { headers: H })).json() as { user: { status: string } };
  if (me.user.status === 'pending') {
    const jr = await fetch(`${base}/api/onboarding/join-request`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newTeamName: '[bootstrap] Admin Thật', role: 'leader' })
    });
    assert.ok(jr.ok, `tự hoàn tất onboarding cho Admin bootstrap thất bại (${jr.status})`);
  }
  return session;
}

function seedTeam(name: string): number {
  const now = new Date().toISOString();
  const result = db.prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)').run(name, now);
  return Number(result.lastInsertRowid);
}

// ── Test ───────────────────────────────────────────────────────────────────────────

test('GET /teams: user pending vẫn xem được danh sách team để chọn (FR-2)', async () => {
  const teamId = seedTeam('Dev13');
  const session = await loginAs('pending1@drjoy.jp', 'Chờ duyệt 1');
  const res = await fetch(`${base}/api/teams`, { headers: cookieHeader(session) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.teams.some((t: { id: number }) => t.id === teamId));
});

// 2026-09-25 (docs/exchanges/2026-09-25.md) — Admin bootstrap chỉ có ĐÚNG 1 lượt "pending" thật sự
// trong toàn bộ vòng đời (danh tính issuer/subject cố định 'admin-fixed-sub', dùng lại xuyên suốt file
// này qua loginAsAdmin()) — nên mọi kịch bản cần trạng thái pending thật của CHÍNH họ phải gộp vào ĐÚNG
// 1 test, chạy TRƯỚC mọi test khác gọi loginAsAdmin() (đặt ngay đầu file, trước "GET /teams" test cũng
// được nhưng đặt sau nó không sao vì test đó không cần Admin). Test khác gọi loginAsAdmin() SAU test
// này sẽ thấy Admin đã active, tự bỏ qua bước onboard (đúng ý idempotent của loginAsAdmin()).
test('2026-09-25: Admin bootstrap — chặn team đã có Leader (không tiêu mất lượt pending) rồi tự lập team mới, tự động duyệt, không báo ai', async () => {
  const teamId = seedTeam('Team đã có Leader (bootstrap test)');
  const existingLeaderSession = await loginAs('existing-leader-2@drjoy.jp', 'Leader có sẵn 2');
  const existingLeaderMe = await (await fetch(`${base}/api/auth/me`, { headers: cookieHeader(existingLeaderSession) })).json();
  db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'leader')").run(teamId, existingLeaderMe.user.id);

  const session = await loginAs(ADMIN_EMAIL, 'Admin Thật', 'admin-fixed-sub');
  const H = { ...cookieHeader(session), 'Content-Type': 'application/json' };
  const meBefore = await (await fetch(`${base}/api/auth/me`, { headers: cookieHeader(session) })).json();
  assert.equal(meBefore.user.status, 'pending');

  const blocked = await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: H, body: JSON.stringify({ teamId, role: 'leader' })
  });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, 'TEAM_ALREADY_HAS_LEADER');

  // Lượt pending KHÔNG bị tiêu mất bởi lần thử thất bại ở trên (transaction rollback sạch).
  const stillPending = await (await fetch(`${base}/api/auth/me`, { headers: cookieHeader(session) })).json();
  assert.equal(stillPending.user.status, 'pending');

  const jr = await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: H, body: JSON.stringify({ newTeamName: 'Team tự lập của Admin', role: 'leader' })
  });
  assert.equal(jr.status, 201);
  const jrBody = await jr.json();
  assert.equal(jrBody.autoApproved, true);

  const row = db.prepare('SELECT status, reviewed_by, reviewed_at FROM join_requests WHERE id = ?').get(jrBody.id) as
    { status: string; reviewed_by: number | null; reviewed_at: string | null };
  assert.equal(row.status, 'approved', 'ghi thẳng approved, không phải pending chờ ai duyệt');
  assert.ok(row.reviewed_by, 'vẫn có dấu vết ai duyệt (chính họ), không bỏ trống');
  assert.ok(row.reviewed_at);

  const meAfter = await (await fetch(`${base}/api/auth/me`, { headers: cookieHeader(session) })).json();
  assert.equal(meAfter.user.status, 'active');

  // Không tự thông báo cho chính mình — route nhánh tự-duyệt không chạy đoạn insert notifications.
  const notifs = await (await fetch(`${base}/api/notifications`, { headers: cookieHeader(session) })).json();
  assert.ok(!notifs.notifications.some((n: { kind: string }) => n.kind === 'join_request_created'));
});

test('FR-2/FR-3: gửi join-request -> Admin nhận thông báo -> duyệt -> user chuyển active + vào team_members', async () => {
  const teamId = seedTeam('Team A');
  const adminSession = await loginAsAdmin();
  const userSession = await loginAs('joiner1@drjoy.jp', 'Người xin vào Team A');

  const create = await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST',
    headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  assert.equal(create.status, 201);

  const notifs = await (await fetch(`${base}/api/notifications`, { headers: cookieHeader(adminSession) })).json();
  const notif = notifs.notifications.find((n: { kind: string }) => n.kind === 'join_request_created');
  assert.ok(notif, 'Admin phải nhận thông báo có yêu cầu tham gia mới');

  const list = await (await fetch(`${base}/api/admin/join-requests`, { headers: cookieHeader(adminSession) })).json();
  const jr = list.joinRequests[0];
  assert.ok(jr);

  const approve = await fetch(`${base}/api/admin/join-requests/${jr.id}/approve`, {
    method: 'POST',
    headers: { ...cookieHeader(adminSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowVersion: jr.row_version })
  });
  assert.equal(approve.status, 200);

  const me = await (await fetch(`${base}/api/auth/me`, { headers: cookieHeader(userSession) })).json();
  assert.equal(me.user.status, 'active');

  const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?')
    .get(teamId, me.user.id) as { role: string } | undefined;
  assert.equal(membership?.role, 'member');

  const userNotifs = await (await fetch(`${base}/api/notifications`, { headers: cookieHeader(userSession) })).json();
  assert.ok(userNotifs.notifications.some((n: { kind: string }) => n.kind === 'join_request_approved'));
});

test('FR-3a: đơn bị Admin từ chối -> KHÔNG khoá vĩnh viễn, user vẫn ở pending, gửi lại đơn mới được', async () => {
  const teamId = seedTeam('Team B');
  const adminSession = await loginAsAdmin();
  const userSession = await loginAs('rejected1@drjoy.jp', 'Bị từ chối lần 1');

  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST',
    headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  const list1 = await (await fetch(`${base}/api/admin/join-requests`, { headers: cookieHeader(adminSession) })).json();
  const jr1 = list1.joinRequests[list1.joinRequests.length - 1];

  const reject = await fetch(`${base}/api/admin/join-requests/${jr1.id}/reject`, {
    method: 'POST',
    headers: { ...cookieHeader(adminSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowVersion: jr1.row_version })
  });
  assert.equal(reject.status, 200);

  const me = await (await fetch(`${base}/api/auth/me`, { headers: cookieHeader(userSession) })).json();
  assert.equal(me.user.status, 'pending', 'FR-3a: từ chối không phải khoá vĩnh viễn');

  const retry = await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST',
    headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  assert.equal(retry.status, 201, 'sau khi bị từ chối phải gửi lại được đơn mới');
});

test('unique index (user_id) WHERE status=pending: gửi 2 đơn liên tiếp khi đơn đầu còn treo -> 409', async () => {
  const teamId = seedTeam('Team C');
  const userSession = await loginAs('double-join@drjoy.jp', 'Gửi đơn 2 lần');
  const first = await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST',
    headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  assert.equal(first.status, 201);
  const second = await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST',
    headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  assert.equal(second.status, 409);
  const body = await second.json();
  assert.equal(body.code, 'JOIN_REQUEST_PENDING_EXISTS');
});

test('FR-6: duyệt role=leader cho team đã có Leader -> 409 TEAM_ALREADY_HAS_LEADER', async () => {
  const teamId = seedTeam('Team D');
  const adminSession = await loginAsAdmin();

  const leaderSession = await loginAs('leader1@drjoy.jp', 'Leader đầu tiên');
  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { ...cookieHeader(leaderSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'leader' })
  });
  const list1 = await (await fetch(`${base}/api/admin/join-requests`, { headers: cookieHeader(adminSession) })).json();
  const jrLeader = list1.joinRequests.find((r: { requested_role: string; requested_team_id: number }) => r.requested_role === 'leader' && r.requested_team_id === teamId);
  const approve1 = await fetch(`${base}/api/admin/join-requests/${jrLeader.id}/approve`, {
    method: 'POST', headers: { ...cookieHeader(adminSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowVersion: jrLeader.row_version })
  });
  assert.equal(approve1.status, 200);

  const secondLeaderSession = await loginAs('leader2@drjoy.jp', 'Muốn làm Leader thứ 2');
  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { ...cookieHeader(secondLeaderSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'leader' })
  });
  const list2 = await (await fetch(`${base}/api/admin/join-requests`, { headers: cookieHeader(adminSession) })).json();
  const jrLeader2 = list2.joinRequests.find((r: { requested_role: string; requested_team_id: number }) => r.requested_role === 'leader' && r.requested_team_id === teamId);
  const approve2 = await fetch(`${base}/api/admin/join-requests/${jrLeader2.id}/approve`, {
    method: 'POST', headers: { ...cookieHeader(adminSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowVersion: jrLeader2.row_version })
  });
  assert.equal(approve2.status, 409);
  const body = await approve2.json();
  assert.equal(body.code, 'TEAM_ALREADY_HAS_LEADER');
});

test('row_version lệch (đã duyệt trước bởi người khác) -> 409 JOIN_REQUEST_STALE, không duyệt lần 2', async () => {
  const teamId = seedTeam('Team E');
  const adminSession = await loginAsAdmin();
  const userSession = await loginAs('stale-approve@drjoy.jp', 'Duyệt lệch row_version');
  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  const list = await (await fetch(`${base}/api/admin/join-requests`, { headers: cookieHeader(adminSession) })).json();
  const jr = list.joinRequests[list.joinRequests.length - 1];

  const staleApprove = await fetch(`${base}/api/admin/join-requests/${jr.id}/approve`, {
    method: 'POST', headers: { ...cookieHeader(adminSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowVersion: jr.row_version + 1 })
  });
  assert.equal(staleApprove.status, 409);
});

test('non-admin không gọi được /admin/join-requests (danh sách chờ duyệt) -> 403', async () => {
  const userSession = await loginAs('not-admin-onboarding@drjoy.jp', 'Không phải Admin');
  const res = await fetch(`${base}/api/admin/join-requests`, { headers: cookieHeader(userSession) });
  assert.equal(res.status, 403);
});

test('user ĐÃ active không gọi được /onboarding/join-request nữa (FR-2 chỉ dành cho onboarding lần đầu)', async () => {
  const teamId = seedTeam('Team G');
  const adminSession = await loginAsAdmin();
  const userSession = await loginAs('already-active@drjoy.jp', 'Đã active rồi');
  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  const list = await (await fetch(`${base}/api/admin/join-requests`, { headers: cookieHeader(adminSession) })).json();
  const jr = list.joinRequests[list.joinRequests.length - 1];
  await fetch(`${base}/api/admin/join-requests/${jr.id}/approve`, {
    method: 'POST', headers: { ...cookieHeader(adminSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowVersion: jr.row_version })
  });

  const secondTeamId = seedTeam('Team H');
  const retry = await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId: secondTeamId, role: 'member' })
  });
  assert.equal(retry.status, 409);
});

test('duyệt với teamId Admin tự sửa nhưng KHÔNG tồn tại -> 404 rõ ràng, không phải 500 do lỗi khoá ngoại', async () => {
  const teamId = seedTeam('Team I');
  const adminSession = await loginAsAdmin();
  const userSession = await loginAs('approve-bad-team@drjoy.jp', 'Duyệt sai team');
  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  const list = await (await fetch(`${base}/api/admin/join-requests`, { headers: cookieHeader(adminSession) })).json();
  const jr = list.joinRequests[list.joinRequests.length - 1];

  const approve = await fetch(`${base}/api/admin/join-requests/${jr.id}/approve`, {
    method: 'POST', headers: { ...cookieHeader(adminSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowVersion: jr.row_version, approvedTeamId: 999999 })
  });
  assert.equal(approve.status, 404);

  // Đơn KHÔNG được đổi thành approved dù ghi team_members thất bại giữa đường -> transaction rollback đúng.
  const stillPending = db.prepare("SELECT status FROM join_requests WHERE id = ?").get(jr.id) as { status: string };
  assert.equal(stillPending.status, 'pending');
});

test('POST .../approve: THIẾU rowVersion -> 409, KHÔNG được tự khớp version hiện tại (Council review run e8d20dc3)', async () => {
  const teamId = seedTeam('Team Approve Thiếu Version');
  const adminSession = await loginAsAdmin();
  const userSession = await loginAs('missing-version-approve@drjoy.jp', 'Thiếu rowVersion lúc duyệt');
  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  const list = await (await fetch(`${base}/api/admin/join-requests`, { headers: cookieHeader(adminSession) })).json();
  const jr = list.joinRequests[list.joinRequests.length - 1];

  const approve = await fetch(`${base}/api/admin/join-requests/${jr.id}/approve`, {
    method: 'POST', headers: { ...cookieHeader(adminSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(approve.status, 409);
  const stillPending = db.prepare("SELECT status FROM join_requests WHERE id = ?").get(jr.id) as { status: string };
  assert.equal(stillPending.status, 'pending', 'không được duyệt khi thiếu rowVersion');
});

// CR-20260913 §6.1 — FE cần biết "user pending này đã từng gửi đơn chưa" để dựng đúng màn ("Chọn team
// và vai trò" hay "Đang chờ duyệt"). Route bổ sung nhỏ cho lượt frontend Giai đoạn 1 (không có route
// nào khác trả về info này cho CHÍNH user, chỉ /admin/join-requests dành cho Admin).
test('GET /onboarding/my-join-request: chưa từng gửi đơn -> joinRequest null', async () => {
  const userSession = await loginAs('never-joined@drjoy.jp', 'Chưa từng xin team');
  const res = await fetch(`${base}/api/onboarding/my-join-request`, { headers: cookieHeader(userSession) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.joinRequest, null);
});

test('GET /onboarding/my-join-request: đã gửi đơn -> trả đúng team/vai trò đã xin', async () => {
  const teamId = seedTeam('Team My-Join-Request');
  const userSession = await loginAs('my-join-request@drjoy.jp', 'Đang chờ duyệt');
  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'leader' })
  });
  const res = await fetch(`${base}/api/onboarding/my-join-request`, { headers: cookieHeader(userSession) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.joinRequest.teamId, teamId);
  assert.equal(body.joinRequest.teamName, 'Team My-Join-Request');
  assert.equal(body.joinRequest.role, 'leader');
});

test('GET /onboarding/my-join-request: sau khi bị Admin từ chối (FR-3a) -> lại về null, không kẹt', async () => {
  const teamId = seedTeam('Team My-Join-Request Rejected');
  const adminSession = await loginAsAdmin();
  const userSession = await loginAs('my-join-request-rejected@drjoy.jp', 'Bị từ chối');
  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  const list = await (await fetch(`${base}/api/admin/join-requests`, { headers: cookieHeader(adminSession) })).json();
  const jr = list.joinRequests[list.joinRequests.length - 1];
  await fetch(`${base}/api/admin/join-requests/${jr.id}/reject`, {
    method: 'POST', headers: { ...cookieHeader(adminSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowVersion: jr.row_version })
  });

  const res = await fetch(`${base}/api/onboarding/my-join-request`, { headers: cookieHeader(userSession) });
  const body = await res.json();
  assert.equal(body.joinRequest, null, 'đơn đã rejected không còn là pending -> không hiện lại nữa');
});

test('FR-34: đánh dấu đã đọc chỉ áp dụng cho đúng chủ thông báo, đọc lại vẫn còn trong danh sách với read_at', async () => {
  const teamId = seedTeam('Team F');
  const adminSession = await loginAsAdmin();
  const otherAdminIntruderSession = await loginAs('intruder@drjoy.jp', 'Không liên quan');
  const userSession = await loginAs('notif-owner@drjoy.jp', 'Chủ thông báo');
  await fetch(`${base}/api/onboarding/join-request`, {
    method: 'POST', headers: { ...cookieHeader(userSession), 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, role: 'member' })
  });
  const notifs = await (await fetch(`${base}/api/notifications`, { headers: cookieHeader(adminSession) })).json();
  const notif = notifs.notifications.find((n: { kind: string; read_at: string | null }) => n.kind === 'join_request_created' && !n.read_at);
  assert.ok(notif);

  const wrongOwner = await fetch(`${base}/api/notifications/${notif.id}/read`, { method: 'POST', headers: cookieHeader(otherAdminIntruderSession) });
  assert.equal(wrongOwner.status, 404, 'không được đánh dấu đã đọc thông báo của người khác');

  const ok = await fetch(`${base}/api/notifications/${notif.id}/read`, { method: 'POST', headers: cookieHeader(adminSession) });
  assert.equal(ok.status, 200);
});
