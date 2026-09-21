
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ManHinhLenLich } from '../../src/screens/release';

function mockFetch(map: Record<string, unknown | { status: number; body: unknown }>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method || 'GET'} ${url}`;
    const entry = map[key];
    if (entry === undefined) throw new Error(`fetch chưa mock: ${key}`);
    const { status, body } = (entry as { status?: number }).status !== undefined
      ? (entry as { status: number; body: unknown })
      : { status: 200, body: entry };
    return {
      ok: status < 400, status,
      text: async () => JSON.stringify(body),
      json: async () => body
    } as Response;
  });
}

describe('Release định kỳ — tạo task báo lỗi khi BE từ chối', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('BE trả 400 (task release không hợp lệ) -> hiện thông báo lỗi, không im lặng', async () => {
    const fetchMock = mockFetch({
      'GET /api/release/templates': [],
      'GET /api/release/task-definitions': [
        { id: 'x', title: 'Task lỗi', note: '', startTime: '10:00', dateToken: 'release.date', templateId: '', links: [], sortOrder: 0 }
      ],
      'POST /api/schedules/regular-release/tasks': {
        status: 400,
        body: { message: 'Task release không hợp lệ' }
      },
      // Màn mặc định mở "Release khẩn cấp" trước khi bấm chuyển tab -> effect của nó vẫn chạy.
      'GET /api/release/emergency/templates': [],
      'GET /api/release/emergency/task-definitions': []
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManHinhLenLich onTasksCreated={async () => {}} />);

    // Chuyển sang tab "Release định kỳ" (mặc định màn hiện "Release khẩn cấp").
    fireEvent.click(screen.getByRole('button', { name: /Release định kỳ|định kỳ/i }));

    const dateInput = await screen.findByLabelText(/Ngày release/i);
    fireEvent.change(dateInput, { target: { value: '2026-09-18' } });

    const createButton = screen.getByRole('button', { name: /Tạo task định kỳ/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByText(/Task release không hợp lệ/i)).toBeTruthy();
    });
  });
});
