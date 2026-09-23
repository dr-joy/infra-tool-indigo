import { describe, it, expect, vi } from 'vitest';
import { api, apiTeam, ApiError, AUTH_ERROR_EVENT } from '../../src/api';

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

  // CR-20260913 FR-4a — lỗi phiên/quyền phải phát ra sự kiện toàn cục để AuthProvider phản ứng được
  // mà không cần từng màn tự bọc catch riêng (xem src/auth-context.tsx).
  it('phát AUTH_ERROR_EVENT khi lỗi có code thuộc nhóm phiên/quyền (vd NOT_TEAM_MEMBER)', async () => {
    mockFetch(403, { message: 'Bạn không phải thành viên của team này', code: 'NOT_TEAM_MEMBER' }, false);
    const handler = vi.fn();
    window.addEventListener(AUTH_ERROR_EVENT, handler);
    await api('/api/x').catch(() => {});
    window.removeEventListener(AUTH_ERROR_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent<ApiError>).detail;
    expect(detail.code).toBe('NOT_TEAM_MEMBER');
  });

  it('KHÔNG phát AUTH_ERROR_EVENT cho lỗi nghiệp vụ thường (vd VERSION_CONFLICT)', async () => {
    mockFetch(409, { message: 'Xung đột', code: 'VERSION_CONFLICT' }, false);
    const handler = vi.fn();
    window.addEventListener(AUTH_ERROR_EVENT, handler);
    await api('/api/x').catch(() => {});
    window.removeEventListener(AUTH_ERROR_EVENT, handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('apiTeam — tự gắn teamId (FR-13)', () => {
  it('GET: gắn teamId vào query string', async () => {
    mockFetch(200, []);
    await apiTeam(7, '/api/projects');
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/api/projects?teamId=7');
  });

  it('GET với query sẵn có: nối bằng &, không ghi đè', async () => {
    mockFetch(200, []);
    await apiTeam(7, '/api/weeks/2026-01-05/text?kind=internal');
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/api/weeks/2026-01-05/text?kind=internal&teamId=7');
  });

  it('POST: merge teamId vào JSON body sẵn có', async () => {
    mockFetch(201, { id: 'x' });
    await apiTeam(7, '/api/projects', { method: 'POST', body: JSON.stringify({ ten: 'Dự án mới' }) });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ ten: 'Dự án mới', teamId: 7 });
  });

  it('POST không có body: vẫn tạo body chỉ chứa teamId', async () => {
    mockFetch(200, { ok: true });
    await apiTeam(7, '/api/weeks/2026-01-05/goals', { method: 'DELETE' });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ teamId: 7 });
  });

  it('teamId null -> từ chối ngay bằng ApiError 400, không gọi fetch', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const err = await apiTeam(null, '/api/projects').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
