import { describe, it, expect, vi } from 'vitest';
import { api, ApiError } from '../../src/api';

function mockFetch(status: number, body: unknown, ok = status < 400) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  globalThis.fetch = vi.fn(async () => ({
    ok, status,
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body)
  })) as unknown as typeof fetch;
}

describe('api client', () => {
  it('trả JSON khi response ok', async () => {
    mockFetch(200, { hello: 'world' });
    await expect(api<{ hello: string }>('/api/x')).resolves.toEqual({ hello: 'world' });
  });

  it('ném ApiError kèm status + code + details khi lỗi', async () => {
    mockFetch(409, { message: 'Xung đột', code: 'GOAL_CONFLICT', details: { weeks: [] } }, false);
    const err = await api('/api/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('GOAL_CONFLICT');
    expect(err.message).toBe('Xung đột');
  });

  it('body không phải JSON -> message là text thô hoặc HTTP <status>', async () => {
    mockFetch(500, 'Internal boom', false);
    const err = await api('/api/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('Internal boom');
  });

  it('gửi Content-Type application/json mặc định', async () => {
    mockFetch(200, {});
    await api('/api/x', { method: 'POST', body: '{}' });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((call[1] as RequestInit).headers).toMatchObject({ 'Content-Type': 'application/json' });
  });
});
