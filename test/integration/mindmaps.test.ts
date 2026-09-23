// Test tích hợp cho server/routes/mindmaps.ts — Lát 5 (CR-20260913, FR-32/FR-32a/FR-43).
//
// Viết lại toàn bộ so với bản trước Lát 5: route cũ hoàn toàn KHÔNG có auth và không có khái niệm
// sở hữu/chia sẻ (bug thật đã xác nhận ở CR §Nhóm D FR-32: `GET /api/mindmaps/files/:name` chỉ chặn
// path traversal, không tra quyền). Test này phủ: quyền đọc theo owner/chia sẻ team (AC-25), CHỈ
// owner mới ghi được dù đang chia sẻ, và 3 lớp xác thực file đính kèm mới (đuôi + MIME khai báo +
// nội dung thật — FR-32a/FR-43): đuôi nguy hiểm bị chặn, magic-bytes không khớp bị chặn, file rỗng bị
// chặn, và file phục vụ lại LUÔN attachment (không bao giờ inline).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import { createMockAuthServer, loginFlow, makeOnboardingHelpers } from './fixtures/auth-harness.js';

const ADMIN_EMAIL = 'admin@drjoy.jp';

const mockAuth = await createMockAuthServer();
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mindmaps-itest-'));
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

const adminSession = await flow.loginAs(ADMIN_EMAIL, 'Admin Thật', 'mindmaps-itest-admin-sub');
const teamA = await onboarding.makeTeam(adminSession, '[itest] Team Mindmap A');
const teamB = await onboarding.makeTeam(adminSession, '[itest] Team Mindmap B');
await onboarding.setFeatureVisibility(adminSession, teamA, 'mind_map', 'on');
await onboarding.setFeatureVisibility(adminSession, teamB, 'mind_map', 'on');
const owner = await onboarding.joinAndApprove('mindmaps-itest-owner@drjoy.jp', 'Owner A', teamA, 'member', adminSession);
const teammate = await onboarding.joinAndApprove('mindmaps-itest-teammate@drjoy.jp', 'Teammate A', teamA, 'member', adminSession);
const outsider = await onboarding.joinAndApprove('mindmaps-itest-outsider@drjoy.jp', 'Outsider B', teamB, 'member', adminSession);
const ownerHeaders = flow.H(owner.session);
const teammateHeaders = flow.H(teammate.session);
const outsiderHeaders = flow.H(outsider.session);

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mockAuth.close();
  try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* bỏ qua */ }
});

async function req(method: string, p: string, body?: unknown, headers: Record<string, string> = ownerHeaders) {
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

function multipartBody(fields: Record<string, string>, fileField: { name: string; filename: string; contentType: string; content: Buffer }): { body: Buffer; contentType: string } {
  const boundary = `----itestBoundary${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.contentType}\r\n\r\n`
  ));
  parts.push(fileField.content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function uploadAttachment(mindmapId: number, filename: string, contentType: string, content: Buffer, headers: Record<string, string> = ownerHeaders) {
  const { body, contentType: ct } = multipartBody({}, { name: 'file', filename, contentType, content });
  const authHeaders = { ...headers };
  delete authHeaders['Content-Type'];
  const res = await fetch(`${base}/api/mindmaps/${mindmapId}/attachments`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': ct },
    body
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

// PNG 1x1 THẬT (đủ signature + IHDR + IDAT hợp lệ) — file-type cần cấu trúc chunk thật, không chỉ
// 8 byte signature, mới nhận diện được (đã tự kiểm chứng bằng cách đọc source node_modules/file-type).
const PNG_SIGNATURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

// ── Quyền đọc/ghi theo owner + chia sẻ team (FR-32/AC-25) ─────────────────────────────────────────
test('SEC: chưa đăng nhập -> 401', async () => {
  const r = await fetch(`${base}/api/mindmaps`);
  assert.equal(r.status, 401);
});

test('SEC: tạo sơ đồ riêng tư -> chỉ owner đọc được, người khác cùng team bị 403', async () => {
  const created = await req('POST', '/api/mindmaps', { title: '[itest] riêng tư', data: { root: { id: 'r', text: 'root', children: [] } } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id;

  const asOwner = await req('GET', `/api/mindmaps/${id}`);
  assert.equal(asOwner.status, 200);

  const asTeammate = await req('GET', `/api/mindmaps/${id}`, undefined, teammateHeaders);
  assert.equal(asTeammate.status, 403);
});

test('SEC: đổi sang chia sẻ team -> teammate đọc được nhưng KHÔNG sửa/xoá được (chỉ owner ghi)', async () => {
  const created = await req('POST', '/api/mindmaps', { title: '[itest] sẽ chia sẻ', data: { root: { id: 'r', text: 'root', children: [] } } });
  const id = created.json.id;

  const shareRes = await req('PUT', `/api/mindmaps/${id}`, { visibility: 'team', sharedTeamId: teamA });
  assert.equal(shareRes.status, 200, JSON.stringify(shareRes.json));

  const readByTeammate = await req('GET', `/api/mindmaps/${id}`, undefined, teammateHeaders);
  assert.equal(readByTeammate.status, 200);

  const writeByTeammate = await req('PUT', `/api/mindmaps/${id}`, { title: '[itest] teammate cố sửa' }, teammateHeaders);
  assert.equal(writeByTeammate.status, 403, 'chỉ owner mới được sửa, kể cả khi đang chia sẻ (FR-32)');

  const deleteByTeammate = await req('DELETE', `/api/mindmaps/${id}`, undefined, teammateHeaders);
  assert.equal(deleteByTeammate.status, 403);

  const readByOutsider = await req('GET', `/api/mindmaps/${id}`, undefined, outsiderHeaders);
  assert.equal(readByOutsider.status, 403, 'team khác không thấy sơ đồ chia sẻ cho team A');
});

test('SEC: đổi lại về riêng tư -> thu hồi quyền đọc của teammate NGAY (không cache quyền cũ)', async () => {
  const created = await req('POST', '/api/mindmaps', { title: '[itest] share rồi thu hồi', data: { root: { id: 'r', text: 'root', children: [] } } });
  const id = created.json.id;
  await req('PUT', `/api/mindmaps/${id}`, { visibility: 'team', sharedTeamId: teamA });
  assert.equal((await req('GET', `/api/mindmaps/${id}`, undefined, teammateHeaders)).status, 200);

  await req('PUT', `/api/mindmaps/${id}`, { visibility: 'private' });
  assert.equal((await req('GET', `/api/mindmaps/${id}`, undefined, teammateHeaders)).status, 403);
});

test('SEC: không được chia sẻ cho team mình không thuộc về', async () => {
  const created = await req('POST', '/api/mindmaps', { title: '[itest] chia sẻ sai team', data: { root: { id: 'r', text: 'root', children: [] } } });
  const id = created.json.id;
  const r = await req('PUT', `/api/mindmaps/${id}`, { visibility: 'team', sharedTeamId: teamB });
  assert.equal(r.status, 400);
});

// ── File đính kèm — 3 lớp xác thực (FR-32a/FR-43) ─────────────────────────────────────────────────
let sharedMapId: number;
test('setup: tạo sơ đồ chia sẻ để test attachment', async () => {
  const created = await req('POST', '/api/mindmaps', { title: '[itest] map cho attachment', data: { root: { id: 'r', text: 'root', children: [] } } });
  sharedMapId = created.json.id;
  const share = await req('PUT', `/api/mindmaps/${sharedMapId}`, { visibility: 'team', sharedTeamId: teamA });
  assert.equal(share.status, 200);
});

const duoiNguyHiem = ['evil.html', 'evil.svg', 'evil.js'];
for (const filename of duoiNguyHiem) {
  test(`upload đuôi nguy hiểm ${filename} bị từ chối 400`, async () => {
    const r = await uploadAttachment(sharedMapId, filename, 'text/plain', Buffer.from('<script>alert(1)</script>'));
    assert.equal(r.status, 400);
  });
}

test('upload .txt hợp lệ (UTF-8, không control byte lạ) -> 201', async () => {
  const r = await uploadAttachment(sharedMapId, 'ghi-chu.txt', 'text/plain', Buffer.from('nội dung ghi chú bình thường', 'utf8'));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.originalName, 'ghi-chu.txt');
});

test('upload .png giả (đuôi/MIME đúng nhưng nội dung KHÔNG phải PNG thật) -> 400 (magic bytes không khớp)', async () => {
  const r = await uploadAttachment(sharedMapId, 'fake.png', 'image/png', Buffer.from('đây không phải ảnh PNG thật'));
  assert.equal(r.status, 400);
  assert.match(String(r.json.message), /không khớp|magic|nhận diện/i);
});

test('upload .png thật (đúng magic bytes) -> 201', async () => {
  const r = await uploadAttachment(sharedMapId, 'real.png', 'image/png', PNG_SIGNATURE);
  assert.equal(r.status, 201, JSON.stringify(r.json));
});

test('upload file rỗng -> 400', async () => {
  const r = await uploadAttachment(sharedMapId, 'empty.txt', 'text/plain', Buffer.alloc(0));
  assert.equal(r.status, 400);
});

test('upload người KHÔNG PHẢI owner (teammate cùng team, sơ đồ đang chia sẻ) -> 403 (chỉ owner ghi)', async () => {
  const r = await uploadAttachment(sharedMapId, 'teammate.txt', 'text/plain', Buffer.from('nội dung'), teammateHeaders);
  assert.equal(r.status, 403);
});

test('download attachment: teammate cùng team đọc được, outsider team khác bị 403, luôn Content-Disposition: attachment', async () => {
  const uploaded = await uploadAttachment(sharedMapId, 'download-test.txt', 'text/plain', Buffer.from('nội dung tải xuống'));
  assert.equal(uploaded.status, 201);
  const downloadUrl = `${base}${uploaded.json.downloadUrl}`;

  const byTeammate = await fetch(downloadUrl, { headers: teammateHeaders });
  assert.equal(byTeammate.status, 200);
  const disposition = byTeammate.headers.get('content-disposition') || '';
  assert.match(disposition, /^attachment/i);
  assert.doesNotMatch(disposition, /inline/i);

  const byOutsider = await fetch(downloadUrl, { headers: outsiderHeaders });
  assert.equal(byOutsider.status, 403);

  const anonymous = await fetch(downloadUrl);
  assert.equal(anonymous.status, 401);
});

test('đổi sơ đồ về riêng tư -> teammate KHÔNG tải được attachment nữa (thu hồi quyền theo trạng thái sống)', async () => {
  const uploaded = await uploadAttachment(sharedMapId, 'revoke-test.txt', 'text/plain', Buffer.from('nội dung'));
  const downloadUrl = `${base}${uploaded.json.downloadUrl}`;
  assert.equal((await fetch(downloadUrl, { headers: teammateHeaders })).status, 200);

  await req('PUT', `/api/mindmaps/${sharedMapId}`, { visibility: 'private' });
  assert.equal((await fetch(downloadUrl, { headers: teammateHeaders })).status, 403);

  // trả lại trạng thái chia sẻ cho các test khác chạy sau (nếu node:test không đảm bảo cô lập thứ tự)
  await req('PUT', `/api/mindmaps/${sharedMapId}`, { visibility: 'team', sharedTeamId: teamA });
});
