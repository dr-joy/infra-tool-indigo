// CR-20260913 Lát 6 (FR-28a): tạo definition (regular/emergency) giờ đòi phiên đăng nhập thật + actor
// thuộc ≥1 team đang Bật "Task cá nhân" (server/routes/release.ts) — dùng chung harness OIDC giả ở
// fixtures/auth-harness.ts. Retrofit auth đợt sau (schedules.ts, cùng CR §6.3): 2 route /schedules/...
// dưới đây nay CŨNG đòi phiên đăng nhập + owner_user_id (cùng policyKind 'personal_task' — xem comment
// đầu server/routes/schedules.ts) nên dùng CHUNG 1 actor/authHeaders với route /release/... phía trên,
// không tách riêng như trước nữa.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-reply-to-def-itest-'));
process.env.APPDATA = tmpAppData;
process.env.AUTH_BASE_URL = mockAuth.authBaseUrl;
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

const flow = loginFlow(() => base, mockAuth.issueAuthCode);
const onboarding = makeOnboardingHelpers(() => base, flow);
const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'reply-to-def-itest-admin-sub');
const teamId = await onboarding.makeTeam(adminSession, '[itest] Team Reply To Def');
await onboarding.setFeatureVisibility(adminSession, teamId, 'personal_task', 'on');
const actor = await onboarding.joinAndApprove('reply-to-def-itest@drjoy.jp', 'Người test reply-to-def', teamId, 'member', adminSession);
const authHeaders = flow.H(actor.session);

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

// Cả /release/... lẫn /schedules/... nay đều đòi phiên đăng nhập thật (Lát 6, xem comment ở trên).
async function req(method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method, headers: authHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

let seq = 0;
function uniq(prefix: string) { seq += 1; return `${prefix}-${Date.now()}-${seq}`; }

// ── regular-single: POST /schedules/regular-release/task ──────────────────────

test('regular-single: definitionId không tồn tại -> 409, không tạo task nào', async () => {
  const releaseDate = '2099-03-01';
  const r = await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: 'khong-ton-tai-xyz' });
  assert.equal(r.status, 409);
  const total = (db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE origin_ref = 'khong-ton-tai-xyz'").get() as { c: number }).c;
  assert.equal(total, 0);
});

test('regular-single: definition có reply_to_definition_id -> task tạo ra mang đúng giá trị đó', async () => {
  const releaseDate = '2099-03-02';
  const targetDef = await req('POST', '/api/release/task-definitions', {
    title: uniq('[itest] target'), startTime: '09:00', dateToken: 'release.date'
  });
  const sourceDef = await req('POST', '/api/release/task-definitions', {
    title: uniq('[itest] source'), startTime: '09:15', dateToken: 'release.date',
    replyToDefinitionId: targetDef.json.id
  });
  const r = await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: sourceDef.json.id });
  assert.equal(r.status, 201);
  const row = db.prepare('SELECT reply_to_ref FROM tasks WHERE origin_ref = ?').get(sourceDef.json.id) as { reply_to_ref: string | null };
  assert.equal(row.reply_to_ref, targetDef.json.id);
});

test('regular-single: definition KHÔNG có reply_to_definition_id -> task tạo ra reply_to_ref = null', async () => {
  const releaseDate = '2099-03-03';
  const def = await req('POST', '/api/release/task-definitions', { title: uniq('[itest] no-reply'), startTime: '09:30', dateToken: 'release.date' });
  const r = await req('POST', '/api/schedules/regular-release/task', { releaseDate, definitionId: def.json.id });
  assert.equal(r.status, 201);
  const row = db.prepare('SELECT reply_to_ref FROM tasks WHERE origin_ref = ?').get(def.json.id) as { reply_to_ref: string | null };
  assert.equal(row.reply_to_ref, null);
});

// ── regular-bulk: POST /schedules/regular-release/tasks ────────────────────────

test('regular-bulk: task gửi replyToRef giả -> backend BỎ QUA, tự tính lại đúng từ definition thật', async () => {
  const releaseDate = '2099-04-01';
  const targetDef = await req('POST', '/api/release/task-definitions', { title: uniq('[itest] bulk target'), startTime: '10:00', dateToken: 'release.date' });
  const sourceDef = await req('POST', '/api/release/task-definitions', {
    title: uniq('[itest] bulk source'), startTime: '10:15', dateToken: 'release.date',
    replyToDefinitionId: targetDef.json.id
  });
  const tenTask = uniq('[itest] bulk task');
  const r = await req('POST', '/api/schedules/regular-release/tasks', {
    releaseDate,
    tasks: [{
      tenTask, ghiChu: '', links: [], ngayCuThe: releaseDate, gioBatDau: '10:15',
      originRef: sourceDef.json.id, replyToRef: 'FORGED_GIA_MAO'
    }]
  });
  assert.equal(r.status, 201);
  const row = db.prepare('SELECT reply_to_ref FROM tasks WHERE ten_task = ?').get(tenTask) as { reply_to_ref: string | null };
  assert.equal(row.reply_to_ref, targetDef.json.id);
});

test('regular-bulk: 1 originRef không resolve trong lô nhiều task -> 409, TOÀN BỘ transaction rollback', async () => {
  const releaseDate = '2099-04-02';
  const validDef = await req('POST', '/api/release/task-definitions', { title: uniq('[itest] valid in batch'), startTime: '11:00', dateToken: 'release.date' });
  const validName = uniq('[itest] valid task');
  const badName = uniq('[itest] bad origin task');
  const r = await req('POST', '/api/schedules/regular-release/tasks', {
    releaseDate,
    tasks: [
      { tenTask: validName, ghiChu: '', links: [], ngayCuThe: releaseDate, gioBatDau: '11:00', originRef: validDef.json.id },
      { tenTask: badName, ghiChu: '', links: [], ngayCuThe: releaseDate, gioBatDau: '11:15', originRef: 'khong-ton-tai-abc' }
    ]
  });
  assert.equal(r.status, 409);
  const totalValid = (db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE ten_task = ?').get(validName) as { c: number }).c;
  const totalBad = (db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE ten_task = ?').get(badName) as { c: number }).c;
  assert.equal(totalValid, 0, 'task hợp lệ đứng TRƯỚC task lỗi cũng không được commit — cả lô phải rollback');
  assert.equal(totalBad, 0);
});

// ── emergency: POST /schedules/emergency-release/tasks ──────────────────────────

async function makeEmergencyDef(overrides: Record<string, unknown> = {}) {
  const body = { title: uniq('[itest] emg def'), timingToken: 'hotfix', startTime: 'immediate', ...overrides };
  const created = await req('POST', '/api/release/emergency/task-definitions', body);
  assert.equal(created.status, 201);
  return created.json.id as string;
}

async function revisionHashOf(id: string): Promise<string> {
  const list = await req('GET', '/api/release/emergency/task-definitions');
  const def = (list.json as { id: string; revisionHash: string }[]).find((d) => d.id === id);
  assert.ok(def, 'definition phải tồn tại để lấy revisionHash');
  return def!.revisionHash;
}

test('emergency: task gửi replyToRef giả -> backend BỎ QUA, tự tính lại đúng từ definition thật', async () => {
  const targetId = await makeEmergencyDef();
  const sourceId = await makeEmergencyDef({ replyToDefinitionId: targetId });
  const revisionHash = await revisionHashOf(sourceId);
  const tenTask = uniq('[itest] emg bulk task');
  const r = await req('POST', '/api/schedules/emergency-release/tasks', {
    releaseDate: '2099-05-01',
    releaseKey: `emergency:${uniq('itest')}`,
    teams: ['Dev5'], systems: ['Dr.JOY'],
    tasks: [{
      tenTask, ghiChu: '', links: [], ngayCuThe: '2099-05-01', gioBatDau: '10:00',
      originRef: sourceId, definitionRevision: revisionHash, replyToRef: 'FORGED_GIA_MAO'
    }]
  });
  assert.equal(r.status, 201);
  const row = db.prepare('SELECT reply_to_ref FROM tasks WHERE ten_task = ?').get(tenTask) as { reply_to_ref: string | null };
  assert.equal(row.reply_to_ref, targetId);
});

test('emergency: definition KHÔNG có reply_to_definition_id -> task tạo ra reply_to_ref = null', async () => {
  const defId = await makeEmergencyDef();
  const revisionHash = await revisionHashOf(defId);
  const tenTask = uniq('[itest] emg no-reply task');
  const r = await req('POST', '/api/schedules/emergency-release/tasks', {
    releaseDate: '2099-05-02',
    releaseKey: `emergency:${uniq('itest')}`,
    teams: ['Dev5'], systems: ['Dr.JOY'],
    tasks: [{
      tenTask, ghiChu: '', links: [], ngayCuThe: '2099-05-02', gioBatDau: '10:00',
      originRef: defId, definitionRevision: revisionHash
    }]
  });
  assert.equal(r.status, 201);
  const row = db.prepare('SELECT reply_to_ref FROM tasks WHERE ten_task = ?').get(tenTask) as { reply_to_ref: string | null };
  assert.equal(row.reply_to_ref, null);
});

test('emergency: originRef không resolve -> 409, không tạo task nào (đã có test TOCTOU revision lệch riêng, đây là ca "chưa từng tồn tại")', async () => {
  const tenTask = uniq('[itest] emg bad origin task');
  const r = await req('POST', '/api/schedules/emergency-release/tasks', {
    releaseDate: '2099-05-03',
    releaseKey: `emergency:${uniq('itest')}`,
    teams: ['Dev5'], systems: ['Dr.JOY'],
    tasks: [{
      tenTask, ghiChu: '', links: [], ngayCuThe: '2099-05-03', gioBatDau: '10:00',
      originRef: 'khong-ton-tai-def', definitionRevision: 'bat-ky'
    }]
  });
  assert.equal(r.status, 409);
  const total = (db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE ten_task = ?').get(tenTask) as { c: number }).c;
  assert.equal(total, 0);
});
