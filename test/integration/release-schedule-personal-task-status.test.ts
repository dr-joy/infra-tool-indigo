// CR-20260913 (2026-09-23, nối Tab cá nhân FR-28a vào release.tsx) — test tích hợp cho:
//   GET /release/schedule/personal-task-status
// Route CHỈ để FE ẩn/hiện nút "áp dụng checklist cá nhân theo lịch team" — không phải nguồn phân quyền
// (2 route personal-emergency-tasks/personal-regular-tasks tự kiểm lại đầy đủ khi thật sự gọi, đã có
// test riêng ở release-schedule-personal-regular.test.ts/release-schedule-personal-emergency.test.ts).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-release-personal-status-itest-'));
process.env.APPDATA = tmpAppData;
process.env.AUTH_BASE_URL = mockAuth.authBaseUrl;
process.env.AUTH_CLIENT = 'indigo';
process.env.APP_CALLBACK_URL = 'http://127.0.0.1:0/api/auth/callback';
process.env.ADMIN_BOOTSTRAP_EMAIL = ADMIN_EMAIL;

const { app } = await import('../../server/app.js');

let server: Server;
let base = '';
await new Promise<void>((resolve) => {
  server = app.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    resolve();
  });
});

const flow = loginFlow(() => base, mockAuth.issueAuthCode);
const onboarding = makeOnboardingHelpers(() => base, flow);
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'rs-personal-status-itest-admin-sub');

const teamWork = await onboarding.makeTeam(adminSession, '[itest] Team Personal Status');
// teamOutsider: có Bật personal_task — actor tham gia thêm team này để qua được gate CHUNG của
// authorize() (policyKind 'personal_task' chỉ đòi actor thuộc ÍT NHẤT 1 team đang Bật, không phân biệt
// team nào — giống đúng cơ chế 2 route sinh task thật), nhờ vậy các test dưới đây kiểm được ĐÚNG lớp
// kiểm riêng-teamWork (assertTeamFeatureOn + autogen) thay vì bị chặn sớm hơn bởi gate chung.
const teamOutsider = await onboarding.makeTeam(adminSession, '[itest] Team Personal Status Outsider');
await onboarding.setFeatureVisibility(adminSession, teamOutsider, 'personal_task', 'on');
const actor = await onboarding.joinAndApprove('rs-personal-status-itest@drjoy.jp', 'Member Personal Status', teamWork, 'member', adminSession);
const outsider = await onboarding.joinAndApprove('rs-personal-status-outsider@drjoy.jp', 'Outsider Personal Status', teamOutsider, 'member', adminSession);

// actor tham gia thêm teamOutsider (đã Bật personal_task) — dùng route thật team_member.create, Leader
// của teamOutsider (chính là `outsider`, do joinAndApprove gán role mặc định) mời vào.
{
  const outsiderAsLeader = await onboarding.joinAndApprove('rs-personal-status-outsider-lead@drjoy.jp', 'Leader Outsider Team', teamOutsider, 'leader', adminSession);
  const addMember = await fetch(`${base}/api/teams/${teamOutsider}/members`, {
    method: 'POST', headers: flow.H(outsiderAsLeader.session), body: JSON.stringify({ userId: actor.userId })
  });
  if (!addMember.ok) throw new Error(`thêm actor vào teamOutsider thất bại: ${addMember.status}`);
}

const authHeaders = flow.H(actor.session);
const outsiderHeaders = flow.H(outsider.session);

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

async function req(method: string, p: string, headers: Record<string, string> = authHeaders) {
  const res = await fetch(`${base}${p}`, { method, headers });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function enableAutogen(teamId: number): Promise<void> {
  const list = await (await fetch(`${base}/api/admin/release-task-autogen`, { headers: flow.H(adminSession) })).json() as
    { settings: { team_id: number; row_version: number }[] };
  const current = list.settings.find((s) => s.team_id === teamId);
  const res = await fetch(`${base}/api/admin/release-task-autogen`, {
    method: 'PUT', headers: flow.H(adminSession),
    body: JSON.stringify({ teamId, enabled: true, rowVersion: current?.row_version })
  });
  if (!res.ok) throw new Error(`enableAutogen thất bại: ${res.status}`);
}

// 2026-09-25 (docs/exchanges/2026-09-25.md) — Admin bật autogen team chỉ mở KHẢ NĂNG, actor còn phải tự
// bật riêng cho mình mới thật sự `enabled`.
async function setOwnPref(teamId: number, enabled: boolean, headers: Record<string, string> = authHeaders) {
  const res = await fetch(`${base}/api/release/schedule/personal-task-pref`, {
    method: 'PUT', headers, body: JSON.stringify({ teamId, enabled })
  });
  if (!res.ok) throw new Error(`setOwnPref thất bại: ${res.status}`);
}

test('GET personal-task-status: chưa đăng nhập -> 401', async () => {
  const r = await fetch(`${base}/api/release/schedule/personal-task-status?teamId=${teamWork}`);
  assert.equal(r.status, 401);
});

test('GET personal-task-status: actor không thuộc team -> 403 NOT_TEAM_MEMBER', async () => {
  const r = await req('GET', `/api/release/schedule/personal-task-status?teamId=${teamWork}`, outsiderHeaders);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NOT_TEAM_MEMBER');
});

test('GET personal-task-status: personal_task TẮT + autogen TẮT -> teamCapable=false, enabled=false', async () => {
  const r = await req('GET', `/api/release/schedule/personal-task-status?teamId=${teamWork}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.teamCapable, false);
  assert.equal(r.json.enabled, false);
});

test('GET personal-task-status: personal_task BẬT nhưng autogen còn TẮT -> vẫn teamCapable=false', async () => {
  await onboarding.setFeatureVisibility(adminSession, teamWork, 'personal_task', 'on');
  const r = await req('GET', `/api/release/schedule/personal-task-status?teamId=${teamWork}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.teamCapable, false, 'thiếu autogen Bật riêng cho team vẫn phải là false');
  assert.equal(r.json.enabled, false);
});

test('GET personal-task-status: personal_task BẬT + autogen team BẬT nhưng actor CHƯA tự bật -> teamCapable=true, enabled=false', async () => {
  await enableAutogen(teamWork);
  const r = await req('GET', `/api/release/schedule/personal-task-status?teamId=${teamWork}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.teamCapable, true);
  assert.equal(r.json.enabled, false, 'Admin bật cho team không tự bật hộ từng actor');
});

test('GET personal-task-status: actor tự bật riêng cho mình -> enabled=true', async () => {
  await setOwnPref(teamWork, true);
  const r = await req('GET', `/api/release/schedule/personal-task-status?teamId=${teamWork}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.teamCapable, true);
  assert.equal(r.json.enabled, true);
});

test('PUT personal-task-pref: actor tự tắt lại -> enabled=false ngay, không cần Admin', async () => {
  await setOwnPref(teamWork, false);
  const r = await req('GET', `/api/release/schedule/personal-task-status?teamId=${teamWork}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.enabled, false);
  await setOwnPref(teamWork, true); // trả lại true cho các test sau (nếu file này có thêm test sau này)
});
