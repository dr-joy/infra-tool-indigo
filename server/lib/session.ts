import { randomBytes, createHash } from 'node:crypto';
import { db } from '../db.js';
import { SESSION_TTL_MS } from './auth-config.js';

// Phiên riêng của app (FR-4) — cookie giá trị ngẫu nhiên ≥256 bit, DB chỉ lưu HASH (sha256) của giá
// trị đó, không lưu giá trị thật -> lộ DB không lộ được cookie đang hiệu lực.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionRow {
  id: number;
  user_id: number;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string;
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url'); // 256 bit
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, hashToken(token), now.toISOString(), expiresAt, now.toISOString());
  return { token, expiresAt };
}

// Tra phiên còn hiệu lực (chưa hết hạn tuyệt đối, chưa bị thu hồi) — FR-4a: tra lại từ DB mỗi request,
// không tin cache. Cập nhật last_seen_at để phục vụ UI "Người dùng" của Admin.
export function getActiveSession(token: string): SessionRow | undefined {
  const row = db.prepare(`
    SELECT * FROM user_sessions
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(hashToken(token), new Date().toISOString()) as SessionRow | undefined;
  if (row) {
    db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  }
  return row;
}

export function revokeSession(token: string): void {
  db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), hashToken(token));
}

// Thu hồi toàn bộ phiên của 1 user (Q4/FR-4) — dùng khi Admin "đăng xuất từ xa" hoặc khi tài khoản
// chuyển disabled.
export function revokeAllSessionsForUser(userId: number): void {
  db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), userId);
}
